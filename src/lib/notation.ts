// Enough notation to draw a chord or a scale on five lines.
//
// The score itself is engraved by Verovio at build time and the browser does no
// layout for it (§5 of the README). The hover card is the exception: what it has
// to draw depends on what you point at, so it cannot be baked. It is also a much
// smaller problem — a handful of noteheads, no beams, no stems, no spacing
// algorithm — so this is a few dozen lines rather than 7 MB of WebAssembly.
//
// The glyph outlines are the real Bravura ones, lifted out of Verovio's own font
// data by tools/engrave.py, so a notehead here is the same shape as a notehead in
// the score above it.

import GLYPHS from "@/data/glyphs.json";

/** Bravura is drawn on a 1000-unit em, and a staff space is a quarter of it. */
export const UNITS_PER_SPACE = 250;

export type Glyph = keyof typeof GLYPHS;
export const glyph = (g: Glyph): string => GLYPHS[g];

const LETTERS = "CDEFGAB";

export interface Pitch {
  name: string; // as written, "F#4"
  step: number; // diatonic position: octave * 7 + letter, so a second is 1
  alter: number; // -2..2
  midi: number;
}

const SEMIS = [0, 2, 4, 5, 7, 9, 11];
const PITCH = /^([A-G])(#*|b*)(-?\d+)$/;

export function parsePitch(name: string): Pitch | null {
  const m = PITCH.exec(name.trim());
  if (!m) return null;
  const letter = LETTERS.indexOf(m[1]);
  const alter = m[2].startsWith("#") ? m[2].length : -m[2].length;
  const oct = Number(m[3]);
  return {
    name,
    step: oct * 7 + letter,
    alter,
    midi: (oct + 1) * 12 + SEMIS[letter] + alter,
  };
}

export const midiOfPitch = (name: string): number => parsePitch(name)?.midi ?? 60;

/** "F#4" -> "F♯4". Sharps and flats read as accidentals, not as punctuation. */
export function prettyPitch(name: string): string {
  return name.replace(/##/g, "×").replace(/#/g, "♯").replace(/b/g, "♭");
}

export const ACCIDENTAL: Record<number, Glyph | null> = {
  [-2]: "flatflat",
  [-1]: "flat",
  0: null,
  1: "sharp",
  2: "sharpsharp",
};

/** Which chord member a note is. 1/3/5/7 is all a tertian chord ever has. */
export function degreeName(d: number): string {
  return { 1: "root", 2: "9th", 3: "3rd", 4: "11th", 5: "5th", 6: "13th", 7: "7th" }[d] ?? `${d}`;
}

export interface Staff {
  clef: Glyph;
  clefStep: number; // the line the clef's own curl sits on
  lines: number[]; // the five line positions, bottom to top
}

const TREBLE: Staff = { clef: "clefG", clefStep: 32, lines: [30, 32, 34, 36, 38] };
const BASS: Staff = { clef: "clefF", clefStep: 24, lines: [18, 20, 22, 24, 26] };

/** The clef that puts these notes nearest the staff. */
export function staffFor(pitches: Pitch[]): Staff {
  if (!pitches.length) return TREBLE;
  const mean = pitches.reduce((s, p) => s + p.midi, 0) / pitches.length;
  return mean < 57 ? BASS : TREBLE;
}

/**
 * Ledger line positions for one note — every line-step between the staff and it.
 * Returned in staff steps, so the caller only has to convert to y.
 */
export function ledgers(staff: Staff, step: number): number[] {
  const [lo, , , , hi] = staff.lines;
  const out: number[] = [];
  for (let s = hi + 2; s <= step; s += 2) out.push(s);
  for (let s = lo - 2; s >= step; s -= 2) out.push(s);
  return out;
}

/**
 * Horizontal offsets for a stack of noteheads, in notehead widths.
 *
 * Two notes a second apart cannot share a stem position — one has to sit to the
 * right of the other. Every seventh chord in first inversion has such a pair.
 */
export function seconds(steps: number[]): number[] {
  const out = steps.map(() => 0);
  for (let i = 1; i < steps.length; i++) {
    if (steps[i] - steps[i - 1] === 1 && out[i - 1] === 0) out[i] = 1;
  }
  return out;
}

/**
 * Left offsets for accidentals, in accidental widths, so two of them in a stack
 * do not print on top of each other.
 */
export function accidentalLanes(steps: number[], has: boolean[]): number[] {
  const lane = steps.map(() => 0);
  const taken: number[][] = [];
  for (let i = steps.length - 1; i >= 0; i--) {
    if (!has[i]) continue;
    let l = 0;
    while (taken[l]?.some((s) => Math.abs(s - steps[i]) < 6)) l++;
    (taken[l] ??= []).push(steps[i]);
    lane[i] = l;
  }
  return lane;
}
