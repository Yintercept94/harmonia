// The browse, as arithmetic. No React, no DOM, nothing async — which is the
// point: filter logic is the part of a faceted list that is easy to get subtly
// wrong and impossible to check by looking at it. See facets.test.ts.
//
// Four rules, and the third is the one that bites:
//
//   1. Within a facet, OR. Across facets, AND.  Baroque *or* Classical, *and* minor.
//   2. The query applies last, over the already-filtered set — so the search box
//      always searches under the current selection.
//   3. A facet's own counts ignore its own selections. Picking "Romantic" has to
//      update the composer counts without collapsing the period list to one row,
//      or a selection could never be widened, only cleared.
//   4. An option that reaches zero is kept and disabled, never hidden. "No
//      Renaissance piano sonatas" is true and worth being able to see.

import type { CorpusIndex, PieceMeta } from "./music";

export type FacetKey =
  | "composer" | "period" | "genre" | "mode" | "tonic" | "length" | "analysis";

export const FACET_KEYS: FacetKey[] = [
  "composer", "period", "genre", "mode", "tonic", "length", "analysis",
];

export type Sort = "alpha" | "date" | "composer";

export interface Filters {
  q: string;
  sort: Sort;
  composer: string[];
  period: string[];
  genre: string[];
  mode: string[];
  tonic: string[];
  length: string[];
  /** "human" | "model". An array like the rest so every facet behaves alike. */
  analysis: string[];
}

export const EMPTY: Filters = {
  q: "", sort: "alpha",
  composer: [], period: [], genre: [],
  mode: [], tonic: [], length: [], analysis: [],
};

export const PERIODS = ["Renaissance", "Baroque", "Classical", "Romantic", "Modern"];

/** Bottom-heavy on purpose: the median piece is 20 bars, because 409 of them are
 *  chorales. Even quartiles would put four fifths of the corpus in one bucket. */
export const LENGTHS: { id: string; label: string; max: number }[] = [
  { id: "xs", label: "up to 32 bars", max: 32 },
  { id: "s", label: "33 to 64 bars", max: 64 },
  { id: "m", label: "65 to 128 bars", max: 128 },
  { id: "l", label: "129 bars and over", max: Infinity },
];

export const ANALYSIS = [
  { id: "human", label: "has a human analysis" },
  { id: "model", label: "model labels only" },
];

export function lengthOf(bars: number): string {
  return (LENGTHS.find((b) => bars <= b.max) ?? LENGTHS[LENGTHS.length - 1]).id;
}

/** "Bb major" / "f# minor" — the only two shapes the corpus produces. Minor keys
 *  are spelled in lower case, so the tonic needs its capital back before it can
 *  be shown beside a major one. */
export function parseKey(keyName: string): { mode: string; tonic: string } {
  const [tonic = "", mode = ""] = keyName.split(" ");
  return { mode, tonic: tonic.charAt(0).toUpperCase() + tonic.slice(1) };
}

/** Sharps and flats sorted as a musician reads them, not as ASCII does. */
const TONIC_ORDER = ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb",
                     "G", "G#", "Ab", "A", "A#", "Bb", "B"];

// --- filtering ---------------------------------------------------------------

function has(list: string[], v: string): boolean {
  return list.length === 0 || list.includes(v);
}

/** Everything but the query. `skip` drops one facet, for rule 3. */
function matches(p: PieceMeta, f: Filters, skip?: FacetKey): boolean {
  const key = parseKey(p.keyName);
  const analysis = p.hasAnalysis ? "human" : "model";
  return (
    (skip === "composer" || has(f.composer, p.composerId)) &&
    (skip === "genre" || has(f.genre, p.genre)) &&
    (skip === "mode" || has(f.mode, key.mode)) &&
    (skip === "tonic" || has(f.tonic, key.tonic)) &&
    (skip === "length" || has(f.length, lengthOf(p.bars))) &&
    (skip === "analysis" || has(f.analysis, analysis))
  );
}

/** The one facet that is a property of the composer rather than the piece. */
function periodOf(p: PieceMeta, index: CorpusIndex): string {
  return index.composers[p.composerId]?.period ?? "";
}

function haystack(p: PieceMeta, index: CorpusIndex): string {
  const c = index.composers[p.composerId];
  return [c?.name, c?.sort, p.title, p.collection, p.catNo, p.genre, p.keyName, p.year]
    .filter(Boolean).join(" ").toLowerCase();
}

export function applyFilters(index: CorpusIndex, f: Filters, skip?: FacetKey): PieceMeta[] {
  const needle = f.q.trim().toLowerCase();
  return index.pieces.filter(
    (p) =>
      matches(p, f, skip) &&
      (skip === "period" || has(f.period, periodOf(p, index))) &&
      (!needle || haystack(p, index).includes(needle)),
  );
}

export function sortPieces(rows: PieceMeta[], index: CorpusIndex, sort: Sort): PieceMeta[] {
  const name = (p: PieceMeta) => index.composers[p.composerId]?.sort ?? "";
  const byTitle = (a: PieceMeta, b: PieceMeta) =>
    a.title.localeCompare(b.title, undefined, { numeric: true });
  return [...rows].sort((a, b) =>
    sort === "date"
      ? a.year - b.year || name(a).localeCompare(name(b)) || byTitle(a, b)
      : sort === "composer"
        ? name(a).localeCompare(name(b)) || a.year - b.year || byTitle(a, b)
        : byTitle(a, b) || name(a).localeCompare(name(b)),
  );
}

// --- options and counts ------------------------------------------------------

export interface Option {
  id: string;
  label: string;
  /** A second line: a composer's dates, a period's span. */
  note?: string;
  count: number;
}

/**
 * Every value a facet can take, with the number of pieces behind it *given the
 * other facets* (rule 3). Zeroes are included — the caller disables them.
 */
export function options(index: CorpusIndex, f: Filters, key: FacetKey): Option[] {
  const rows = applyFilters(index, f, key);
  const n = new Map<string, number>();
  const bump = (id: string) => n.set(id, (n.get(id) ?? 0) + 1);

  for (const p of rows) {
    if (key === "composer") bump(p.composerId);
    else if (key === "period") bump(periodOf(p, index));
    else if (key === "genre") bump(p.genre);
    else if (key === "mode") bump(parseKey(p.keyName).mode);
    else if (key === "tonic") bump(parseKey(p.keyName).tonic);
    else if (key === "length") bump(lengthOf(p.bars));
    else bump(p.hasAnalysis ? "human" : "model");
  }

  const at = (id: string) => n.get(id) ?? 0;
  switch (key) {
    case "composer": {
      // Everyone who has a piece anywhere in the corpus, so the list does not
      // change length as you filter — only its counts do.
      const present = new Set(index.pieces.map((p) => p.composerId));
      return [...present]
        .map((id) => {
          const c = index.composers[id];
          return { id, label: c?.name ?? id, note: c ? `${c.born}–${c.died}` : undefined,
                   count: at(id) };
        })
        .sort((a, b) => (index.composers[a.id]?.sort ?? a.label)
          .localeCompare(index.composers[b.id]?.sort ?? b.label));
    }
    case "period":
      return PERIODS.filter((p) => index.pieces.some((x) => periodOf(x, index) === p))
        .map((p) => ({ id: p, label: p, count: at(p) }));
    case "length":
      return LENGTHS.map((b) => ({ id: b.id, label: b.label, count: at(b.id) }));
    case "analysis":
      return ANALYSIS.map((a) => ({ id: a.id, label: a.label, count: at(a.id) }));
    case "tonic":
      return [...new Set(index.pieces.map((p) => parseKey(p.keyName).tonic))]
        .sort((a, b) => TONIC_ORDER.indexOf(a) - TONIC_ORDER.indexOf(b))
        .map((t) => ({ id: t, label: t, count: at(t) }));
    case "mode":
      return ["major", "minor"].map((m) => ({ id: m, label: m, count: at(m) }));
    default:
      // Genre. Its vocabulary is fixed but only what the corpus actually holds
      // is worth listing, so the counted keys are the list.
      return [...n.keys()].sort((a, b) => a.localeCompare(b))
        .map((g) => ({ id: g, label: g, count: at(g) }));
  }
}

// --- filter manipulation -----------------------------------------------------

export function toggle(f: Filters, key: FacetKey, id: string): Filters {
  const cur = f[key];
  return { ...f, [key]: cur.includes(id) ? cur.filter((v) => v !== id) : [...cur, id] };
}

export function clear(f: Filters, key?: FacetKey): Filters {
  if (!key) return { ...EMPTY, sort: f.sort };
  return { ...f, [key]: [] };
}

export function active(f: Filters): { key: FacetKey; id: string }[] {
  return FACET_KEYS.flatMap((key) => f[key].map((id) => ({ key, id })));
}

export function isFiltered(f: Filters): boolean {
  return f.q.trim() !== "" || active(f).length > 0;
}

// --- folding the list into folders -------------------------------------------

export type Row =
  | { kind: "piece"; key: string; piece: PieceMeta }
  | { kind: "folder"; key: string; label: string; composer: string; note: string;
      pieces: PieceMeta[] };

/**
 * A folder for one piece is not a folder, it is a click. 38 of the corpus's 102
 * collections hold a single work; those and the 14 genuinely standalone pieces
 * render as ordinary rows that go straight to the score.
 */
const FOLDER_MIN = 2;

function composerOf(rows: PieceMeta[], index: CorpusIndex): string {
  const ids = new Set(rows.map((p) => p.composerId));
  return ids.size === 1
    ? index.composers[rows[0].composerId]?.name ?? rows[0].composerId
    : `${ids.size} composers`;
}

/** The second line of a folder row. A piece row spends it on key and bar count,
 *  which a set has no single answer for; genre and span it does. */
function noteOf(rows: PieceMeta[]): string {
  const genres = [...new Set(rows.map((p) => p.genre))];
  const years = rows.map((p) => p.year);
  const lo = Math.min(...years), hi = Math.max(...years);
  return [genres.length === 1 ? genres[0] : `${genres.length} genres`,
          lo === hi ? `${lo}` : `${lo}–${hi}`].join("  ·  ");
}

/**
 * The listing, folded. 767 rows is not a list anyone reads; the same corpus
 * grouped by collection is about 78, and Bach's 409 chorales stop being 409
 * rows of German incipit.
 *
 * Folding is off while the query is non-empty. Typing a title means hunting for
 * one piece, and a folder standing between you and the thing you just named is
 * the opposite of an answer.
 */
export function foldRows(rows: PieceMeta[], index: CorpusIndex, f: Filters): Row[] {
  const flat = (p: PieceMeta): Row => ({ kind: "piece", key: p.id, piece: p });
  if (f.q.trim()) return sortRows(rows.map(flat), index, f.sort);

  const groups = new Map<string, PieceMeta[]>();
  const loose: Row[] = [];
  for (const p of rows) {
    if (!p.collection) loose.push(flat(p));
    else groups.set(p.collection, [...(groups.get(p.collection) ?? []), p]);
  }

  const out: Row[] = [...loose];
  for (const [label, members] of groups) {
    if (members.length < FOLDER_MIN) out.push(flat(members[0]));
    else out.push({ kind: "folder", key: label, label,
                    composer: composerOf(members, index), note: noteOf(members),
                    pieces: members });
  }
  return sortRows(out, index, f.sort);
}

/** Numeric-aware: "no. 10" belongs after "no. 9", not after "no. 1". */
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function sortRows(rows: Row[], index: CorpusIndex, sort: Sort): Row[] {
  const name = (r: Row) => r.kind === "piece"
    ? index.composers[r.piece.composerId]?.sort ?? ""
    : index.composers[r.pieces[0].composerId]?.sort ?? "";
  // A folder's year is its earliest, so a set sits where its first piece would.
  const year = (r: Row) => r.kind === "piece"
    ? r.piece.year
    : Math.min(...r.pieces.map((p) => p.year));
  const label = (r: Row) => (r.kind === "piece" ? r.piece.title : r.label);

  return [...rows].sort((a, b) =>
    sort === "date"
      ? year(a) - year(b) || byName(name(a), name(b)) || byName(label(a), label(b))
      : sort === "composer"
        ? byName(name(a), name(b)) || year(a) - year(b) || byName(label(a), label(b))
        : byName(label(a), label(b)) || byName(name(a), name(b)),
  );
}

/**
 * A piece's title with its collection's name taken off the front.
 *
 * The corpus spells these out in full — "Winterreise, D.911 - 5: Der Lindenbaum" —
 * which is right in a flat list and absurd stacked under a folder already headed
 * *Winterreise, D.911*.
 *
 * The prefix must be followed by a separator, or it is not a prefix: "Winterreisen"
 * begins with "Winterreise" and is a different word, and a plain startsWith would
 * leave it as "n".
 */
const SEPARATOR = /^[\s\-–—:,·.]/;

export function shortTitle(title: string, collection: string): string {
  if (!collection || !title.toLowerCase().startsWith(collection.toLowerCase())) return title;
  const tail = title.slice(collection.length);
  if (!tail || !SEPARATOR.test(tail)) return title;
  return tail.replace(/^[\s\-–—:,·.]+/, "") || title;
}

/** Inside an open folder, always in the order the set runs. */
export function foldedPieces(row: Row, index: CorpusIndex, sort: Sort): PieceMeta[] {
  if (row.kind !== "folder") return [];
  return sortPieces(row.pieces, index, sort);
}
