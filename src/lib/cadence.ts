// Cadences: where the music arrives, as opposed to what each chord is.
//
// This is the second feature of the harmony layer and, like the first, it is
// *derived* — nothing on disk changes for it. `chords[]` already carries the
// numeral, the figures and the local key; `measures[]` carries the metre;
// `notes[]` carries the soprano. A cadence is a claim about two adjacent chords
// and where they fall, and all three of those are already here.
//
// What this cannot do is find a phrase. A textbook half cadence is "the phrase
// stops on V", and this has no notion of phrase, so it uses the one proxy the
// data does offer: a cadential chord is *held*. That is why every rule below
// tests duration as well as harmony, and it is the reason the numbers in §5.3
// of the README are quoted with a caveat rather than a benchmark.

import type { Piece, RawChord } from "@/lib/music";
import { midiOfPitch } from "@/lib/notation";

const EPS = 1e-6;

export type CadenceType = "PAC" | "IAC" | "HC" | "DC" | "PC";

export const CADENCE_NAME: Record<CadenceType, string> = {
  PAC: "Perfect authentic",
  IAC: "Imperfect authentic",
  HC: "Half",
  DC: "Deceptive",
  PC: "Plagal",
};

/** The one-line gloss the hover card prints under the name. */
export const CADENCE_GLOSS: Record<CadenceType, string> = {
  PAC: "V–I, both in root position, tonic in the top voice — the strongest close there is.",
  IAC: "V–I, but inverted or without the tonic on top: an arrival that stays open.",
  HC: "Comes to rest on V rather than resolving it. Needs what follows to make sense.",
  DC: "V sets up the tonic and goes to vi instead.",
  PC: "IV–I. An afterword to a close already made, more often than a close itself.",
};

export interface Cadence {
  type: CadenceType;
  /** Indices into `piece.chords` — the approach chord and the arrival. */
  from: number;
  to: number;
  /** Beats: the span of the two chords together, which is what gets drawn. */
  on: number;
  end: number;
  /** The local key both chords are read in. */
  key: string;
  /** The bar the arrival lands in, for the card. */
  bar: number;
}

// --- reading a Roman numeral ------------------------------------------------
// Everything AugmentedNet emits that is *not* an ordinary triad or seventh fails
// this on purpose: `Fr43`, `Ger65`, `It6`, `Cad64` and `N` all start with a
// letter outside the set or carry a figure inside `rn`, so they parse as null
// and take no part in a cadence. That is the right answer for the augmented
// sixths — they approach a cadence, they are not one — and `Cad64` is a tonic
// six-four dressed as a dominant, whose cadence is the *next* pair along.
const ROMAN = /^([b#]*)([ivIV]+)(o|ø|\+)?$/;
const DEGREE: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };

interface Read {
  degree: number;
  /** Upper case in the source — major or dominant rather than minor or diminished. */
  major: boolean;
  /** 0 root position, 1 first inversion, 2 six-four, 3 third. */
  inv: number;
  rootPosition: boolean;
  /** A seventh chord rather than a triad, by its figure. */
  seventh: boolean;
}

/** Root position, first, second or third inversion, from the printed figure. */
const INVERSION: Record<string, { inv: number; seventh: boolean }> = {
  "": { inv: 0, seventh: false },
  "7": { inv: 0, seventh: true },
  "6": { inv: 1, seventh: false },
  "65": { inv: 1, seventh: true },
  "64": { inv: 2, seventh: false },
  "43": { inv: 2, seventh: true },
  "42": { inv: 3, seventh: true },
  "2": { inv: 3, seventh: true },
};

/** True for an applied chord — `V65/V` carries its denominator in `sub`. */
export const isApplied = (c: RawChord): boolean => (c.sub ?? "").includes("/");

export function read(c: RawChord): Read | null {
  // `Cad64` is the same sonority as `I64` and the model uses the two
  // interchangeably — one appears where the other might have. Reading only the
  // second would make a cadence appear or vanish on the analyser's choice of
  // spelling, which is not a fact about the music.
  if (c.rn === "Cad64") {
    return { degree: 1, major: true, inv: 2, rootPosition: false, seventh: false };
  }
  const m = ROMAN.exec(c.rn);
  if (!m) return null;
  const degree = DEGREE[m[2].toLowerCase()];
  if (!degree) return null;
  // The applied denominator lives in `sub` alongside the figure; the figure is
  // whatever precedes the slash.
  const figure = (c.sup ?? "") + (c.sub ?? "").split("/")[0];
  const inv = INVERSION[figure];
  if (!inv) return null;
  return {
    degree,
    major: m[2][0] === m[2][0].toUpperCase(),
    inv: inv.inv,
    rootPosition: inv.inv === 0,
    seventh: inv.seventh,
  };
}

// --- metre and voice --------------------------------------------------------

/** The measure a beat falls in, or null past the end. */
function measureAt(piece: Piece, beat: number) {
  const ms = piece.measures;
  let lo = 0;
  let hi = ms.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beat < ms[mid].start - EPS) hi = mid - 1;
    else if (beat >= ms[mid].start + ms[mid].len - EPS) lo = mid + 1;
    else return ms[mid];
  }
  return null;
}

/**
 * Does this beat carry metrical weight? The downbeat, or the middle of the bar.
 *
 * A cadence that lands off the beat is possible and this will miss it. The
 * alternative — accepting any beat — makes every passing V–I in a bar of eighths
 * a cadence, and the whole difficulty here is telling arrival from traffic.
 */
function strong(piece: Piece, beat: number): boolean {
  const m = measureAt(piece, beat);
  if (!m) return false;
  const off = beat - m.start;
  return off < EPS || Math.abs(off - m.len / 2) < EPS;
}

/**
 * The top sounding pitch at a beat — the soprano, for telling PAC from IAC.
 *
 * A full scan, not a search: `notes[]` is grouped by part and only sorted within
 * one, so the soprano's entry can sit anywhere in the array. It runs once per
 * candidate cadence, of which a piece has a handful.
 */
function soprano(piece: Piece, beat: number): string | null {
  let best: string | null = null;
  let top = -Infinity;
  for (const [pitch, on, dur] of piece.notes) {
    if (on <= beat + EPS && beat < on + dur - EPS) {
      const midi = midiOfPitch(pitch);
      if (midi > top) {
        top = midi;
        best = pitch;
      }
    }
  }
  return best;
}

/** Pitch class of a key's tonic. "G major" -> 7, "c# minor" -> 1. */
const TONIC = /^[A-Ga-g][#b]*$/;
export function tonicPc(key: string): number | null {
  const tonic = key.split(" ")[0] ?? "";
  if (!TONIC.test(tonic)) return null;
  const midi = midiOfPitch(tonic[0].toUpperCase() + tonic.slice(1) + "4");
  return ((midi % 12) + 12) % 12;
}

// --- the rules --------------------------------------------------------------

/**
 * A cadential arrival is *held*. Without it every V–I inside a phrase is a
 * cadence and a chorale comes back with thirty of them.
 *
 * The bar is the median chord length in the piece rather than a fixed number of
 * beats, because a Bach chorale changes harmony every crotchet and a Mozart
 * andante every bar, and "longer than usual here" is the thing both mean by it.
 */
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

/**
 * Every cadence in a piece, in order.
 *
 * Deliberately conservative. Applied chords take no part — `V/V–V` reads as a
 * half cadence to a human and as a modulation to this data, and guessing between
 * them would put marks in places the numerals underneath do not support. Nor does
 * anything here cross a change of local key: a cadence is a claim *within* a key,
 * and if the model changed its mind between the two chords there is no single key
 * to make the claim in.
 */
export function findCadences(piece: Piece): Cadence[] {
  const cs = piece.chords;
  if (cs.length < 2) return [];

  const held = median(cs.map((c) => c.end - c.on));
  const out: Cadence[] = [];

  for (let i = 0; i + 1 < cs.length; i++) {
    const a = cs[i];
    const b = cs[i + 1];
    if (a.key !== b.key) continue;
    if (isApplied(a) || isApplied(b)) continue;
    if (!strong(piece, b.on)) continue;
    // The arrival has to be at least as long as the piece's usual harmony, or be
    // the last chord in it — a final cadence is not always the longest.
    const last = i + 1 === cs.length - 1;
    if (!last && b.end - b.on < held - EPS) continue;

    const A = read(a);
    const B = read(b);
    if (!A || !B) continue;
    // Nothing cadences onto a six-four. A tonic in second inversion is a
    // dissonance waiting on the dominant, not a place the music has arrived;
    // `V7 - I64` read as an authentic cadence is how the C major prelude
    // acquired a cadence in bar 25 that no edition marks.
    if (B.inv === 2) continue;

    let type: CadenceType | null = null;

    if (B.degree === 1 && (A.degree === 5 || A.degree === 7)) {
      // Authentic. Perfect needs all three: root-position dominant, root-position
      // tonic, and the tonic in the top voice. A leading-tone approach (viio6-I)
      // is authentic but never perfect.
      const sop = soprano(piece, b.on);
      const tonic = tonicPc(b.key);
      const sopIsTonic =
        sop !== null && tonic !== null && ((midiOfPitch(sop) % 12) + 12) % 12 === tonic;
      type =
        A.degree === 5 && A.rootPosition && B.rootPosition && sopIsTonic ? "PAC" : "IAC";
    } else if (A.degree === 5 && A.rootPosition && B.degree === 6) {
      type = "DC";
    } else if (A.degree === 4 && B.degree === 1 && B.rootPosition) {
      type = "PC";
    } else if (B.degree === 5 && B.major && B.rootPosition && A.degree !== 5) {
      // Half — a stop *on* the dominant. So it is only one if the dominant does
      // not then resolve: `I64 - V - I` is a cadential six-four whose cadence is
      // the second pair, and reading the first pair as a half cadence both
      // mislabels it and swallows the real one, since a chord cannot be the
      // arrival of one cadence and the approach to the next.
      const after = cs[i + 2];
      const resolves =
        after !== undefined &&
        after.key === b.key &&
        !isApplied(after) &&
        [1, 6].includes(read(after)?.degree ?? 0);
      // The weakest of the five even so, because "the phrase stops here" is what
      // this cannot see. Gated harder on length than the rest for that reason.
      if (!resolves && b.end - b.on >= held * 1.5 - EPS) type = "HC";
    }

    if (!type) continue;

    const bar = measureAt(piece, b.on)?.n ?? 0;
    out.push({ type, from: i, to: i + 1, on: a.on, end: b.end, key: b.key, bar });
    i++; // a chord cannot be both the arrival of one cadence and the approach to the next
  }

  return out;
}
