import { describe, expect, it } from "vitest";
import type { Piece, RawChord } from "@/lib/music";
import { chordAt, isNonChordTone, markNonChordTones, memberOf } from "@/lib/harmony";

const chord = (on: number, end: number, pcs: string[], dg: number[]): RawChord => ({
  on,
  end,
  rn: "I",
  sup: null,
  sub: null,
  fn: "T",
  conf: 0.9,
  key: "C major",
  pcs,
  dg,
});

// Three labels with a deliberate gap between the second and the third: the
// analyser does leave them, and a note in one must not be called dissonant.
const piece = {
  chords: [
    chord(0, 4, ["C4", "E4", "G4"], [1, 3, 5]),
    chord(4, 8, ["G4", "B4", "D5"], [1, 3, 5]),
    chord(12, 16, ["Ab4", "C5", "Eb5"], [1, 3, 5]),
  ],
} as unknown as Piece;

describe("chordAt", () => {
  it("finds the label covering a beat", () => {
    expect(chordAt(piece, 0)?.pcs[0]).toBe("C4");
    expect(chordAt(piece, 3.99)?.pcs[0]).toBe("C4");
    expect(chordAt(piece, 4)?.pcs[0]).toBe("G4");
  });

  it("is half-open: a label owns its start, never its end", () => {
    // The boundary is the whole reason this is not a scan with a <= in it. Get
    // it wrong and two labels claim the same beat, which shows up as one
    // notehead at every chord change wearing the wrong colour.
    expect(chordAt(piece, 8)).toBeNull();
    expect(chordAt(piece, 12)?.pcs[0]).toBe("Ab4");
  });

  it("returns null outside the analysis and in gaps", () => {
    expect(chordAt(piece, -1)).toBeNull();
    expect(chordAt(piece, 10)).toBeNull();
    expect(chordAt(piece, 99)).toBeNull();
  });
});

describe("memberOf", () => {
  const c = piece.chords[0];

  it("finds a member in any octave", () => {
    expect(memberOf(c, "E4")).toBe(1);
    expect(memberOf(c, "E2")).toBe(1);
    expect(memberOf(c, "G7")).toBe(2);
  });

  it("returns -1 for a note the chord does not contain", () => {
    expect(memberOf(c, "D4")).toBe(-1);
    expect(memberOf(c, "F#5")).toBe(-1);
  });

  it("matches enharmonically", () => {
    // analyze.py spells a chord wherever it reads best on the card's staff; the
    // score spells it however the composer wrote it. G# in the score over an Ab
    // in the label is the same note and must not be called foreign to it.
    const ab = piece.chords[2];
    expect(memberOf(ab, "G#4")).toBe(0);
    expect(memberOf(ab, "D#5")).toBe(2);
    expect(memberOf(ab, "B#4")).toBe(1); // B# is C
  });
});

describe("isNonChordTone", () => {
  it("is false for a chord tone and true for a foreign one", () => {
    expect(isNonChordTone(piece, "E4", 1)).toBe(false);
    expect(isNonChordTone(piece, "D4", 1)).toBe(true);
  });

  it("is null where there is no analysis, not false", () => {
    // Absence of a label is not a claim that the note is consonant. Score.tsx
    // leaves these in ink, and `false` here would silently say the opposite.
    expect(isNonChordTone(piece, "D4", 10)).toBeNull();
    expect(isNonChordTone(piece, "D4", 99)).toBeNull();
  });
});

describe("markNonChordTones", () => {
  // Exactly the shape tools/engrave.py emits, via Verovio.
  const note = (id: string) =>
    `<g id="${id}" class="note"><g class="notehead"><use href="#E0A3-x"/></g></g>`;

  it("adds the class only to notes outside the chord", () => {
    const svg = note("nt-E4-1.0") + note("nt-D4-1.0") + note("nt-G4-2.0");
    const out = markNonChordTones(svg, piece);
    expect(out).toContain('<g id="nt-D4-1.0" class="nct note">');
    expect(out).toContain('<g id="nt-E4-1.0" class="note">');
    expect(out).toContain('<g id="nt-G4-2.0" class="note">');
  });

  it("leaves notes in an unanalysed gap alone", () => {
    expect(markNonChordTones(note("nt-D4-10.0"), piece)).toBe(note("nt-D4-10.0"));
  });

  it("touches nothing else in the markup", () => {
    // The engraving is 50 kB of staff lines, slurs and beams per system, and
    // the only thing this may rewrite is the opening tag of a notehead group.
    const svg = `<svg id="keep-me"><g class="staff"><path d="M1 2"/></g>${note("nt-D4-1.0")}</svg>`;
    const out = markNonChordTones(svg, piece);
    expect(out).toContain('<svg id="keep-me">');
    expect(out).toContain('<g class="staff"><path d="M1 2"/></g>');
    expect(out.length).toBe(svg.length + 4); // "nct " and nothing more
  });

  it("is idempotent", () => {
    const once = markNonChordTones(note("nt-D4-1.0"), piece);
    expect(markNonChordTones(once, piece)).toBe(once);
  });
});
