// What the analysis says about a single note, as opposed to about a chord.
//
// One rule governs this file: it is the *only* place that decides whether a note
// belongs to the harmony under it. A notehead coloured as a non-chord tone whose
// hover card calls it the third of the chord is worse than not colouring it at
// all, so Score.tsx and Inspector.tsx both read this rather than each working it
// out for themselves. They used to be the same three lines in two places, which
// is a disagreement waiting to be written.

import type { Piece, RawChord } from "@/lib/music";
import { midiOfPitch } from "@/lib/notation";

const EPS = 1e-6;

/** A notehead id, written by tools/engrave.py: `nt-F#4-12.5` — pitch and beat. */
export const NOTE_ID = /^nt-([A-G][#b]*-?\d+)-(-?[\d.]+)$/;

/** Pitch class of a spelled pitch, 0–11. */
const pc = (p: string): number => ((midiOfPitch(p) % 12) + 12) % 12;

/**
 * The chord sounding at a beat, or `null` where the analysis says nothing —
 * before the first label, after the last, or in a gap one of them left.
 *
 * Binary search rather than a scan, because this is called once per notehead on
 * every system that mounts: a few hundred labels times a few thousand notes is
 * work for nothing on a long movement. `chords[]` is ordered and non-overlapping
 * and tools/validate.py asserts both, so the search is safe.
 */
export function chordAt(piece: Piece, beat: number): RawChord | null {
  const cs = piece.chords;
  let lo = 0;
  let hi = cs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (beat < cs[mid].on - EPS) hi = mid - 1;
    else if (beat >= cs[mid].end - EPS) lo = mid + 1;
    else return cs[mid];
  }
  return null;
}

/**
 * Which member of the chord a pitch is — an index into `pcs` and `dg` — or -1
 * for a note the chord does not contain.
 *
 * Matched by pitch class, not by spelling. analyze.py centres a chord wherever
 * it reads best on the hover card's staff and the score spells it however the
 * composer wrote it, so G# and Ab have to answer the same question the same way.
 */
export function memberOf(c: RawChord, pitch: string): number {
  const q = pc(pitch);
  return c.pcs.findIndex((p) => pc(p) === q);
}

/**
 * Is this note foreign to the harmony under it?
 *
 * `null`, not `false`, where there is no chord to be foreign to. Absence of an
 * analysis is not a claim that a note is consonant, and a note in an unanalysed
 * gap should be left in ink rather than coloured either way.
 *
 * Note what this does *not* say: which kind of non-chord tone it is. Passing,
 * neighbour, suspension and appoggiatura are claims about one voice over time,
 * and `notes[]` is a flattened two-staff reduction with no voices in it (§5).
 * Naming them needs voice separation; membership does not.
 */
export function isNonChordTone(piece: Piece, pitch: string, beat: number): boolean | null {
  const c = chordAt(piece, beat);
  return c ? memberOf(c, pitch) < 0 : null;
}

/** `<g id="nt-F#4-12.5" class="note">` — the id, then the rest of the tag. */
const NOTE_TAG = /<g id="(nt-[^"]+)"([^>]*)>/g;

/**
 * Add a `nct` class to every notehead in an engraved system that the harmony
 * under it does not contain, and hand back the markup. `index.css` does the rest.
 *
 * This edits the SVG *string*, before React ever sees it, rather than walking
 * the DOM once it is mounted. That is not a micro-optimisation — the DOM version
 * of this was wrong. `Score.tsx` hands each system to React as
 * `dangerouslySetInnerHTML`, and React can build a system's markup during a render
 * pass it then throws away and redoes; the wrapper element survives that, its
 * contents do not. Classes added by an effect were silently discarded on the first
 * system of every piece and on no other, because only the first is mounted before
 * the IntersectionObserver's first update. Marking the string means the classes are
 * part of the html React sets, so there is no window in which they can be lost, no
 * flag to keep, and no ordering to reason about.
 *
 * One pass per system when a piece loads, which is where the engraving is being
 * inflated and parsed anyway.
 */
export function markNonChordTones(svg: string, piece: Piece): string {
  return svg.replace(NOTE_TAG, (tag, id: string, attrs: string) => {
    if (/\bnct\b/.test(attrs)) return tag; // already marked; stay idempotent
    const m = NOTE_ID.exec(id);
    if (!m || !isNonChordTone(piece, m[1], Number(m[2]))) return tag;
    // Verovio writes `class="note"`; keep whatever is there and prepend, rather
    // than assuming, so a self-closing tag or a second class still comes out valid.
    const next = attrs.includes('class="')
      ? attrs.replace('class="', 'class="nct ')
      : ` class="nct"${attrs}`;
    return `<g id="${id}"${next}>`;
  });
}
