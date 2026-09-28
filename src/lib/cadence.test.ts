import { describe, expect, it } from "vitest";
import type { Piece, RawChord } from "@/lib/music";
import { findCadences, isApplied, read, tonicPc } from "@/lib/cadence";

const chord = (
  on: number,
  end: number,
  rn: string,
  pcs: string[],
  extra: Partial<RawChord> = {},
): RawChord => ({
  on, end, rn, sup: null, sub: null, fn: "T", conf: 0.9, key: "C major",
  pcs, dg: [1, 3, 5], ...extra,
});

/** Four bars of 4/4, whatever chords and notes are handed in. */
const piece = (chords: RawChord[], notes: Piece["notes"] = []): Piece =>
  ({
    chords,
    notes,
    measures: [0, 1, 2, 3, 4, 5].map((i) => ({ n: i + 1, start: i * 4, len: 4 })),
    meter: [4, 4],
  }) as unknown as Piece;

const G = ["G3", "B3", "D4"];
const C = ["C4", "E4", "G4"];
const F = ["F3", "A3", "C4"];
const Am = ["A3", "C4", "E4"];
/** A soprano C, so an authentic cadence can be perfect. */
const sopC = (at: number): Piece["notes"] => [["C6", at, 4, 0, 0]];

describe("read", () => {
  it("reads degree, quality and inversion off the figure", () => {
    expect(read(chord(0, 1, "V", G))).toMatchObject({ degree: 5, major: true, inv: 0 });
    expect(read(chord(0, 1, "i", C))).toMatchObject({ degree: 1, major: false, inv: 0 });
    expect(read(chord(0, 1, "V", G, { sup: "6", sub: "5" }))).toMatchObject({ degree: 5, inv: 1, seventh: true });
    expect(read(chord(0, 1, "I", C, { sup: "6", sub: "4" }))).toMatchObject({ degree: 1, inv: 2 });
    expect(read(chord(0, 1, "V", G, { sup: "7" }))).toMatchObject({ degree: 5, inv: 0, seventh: true });
    expect(read(chord(0, 1, "viio", G))).toMatchObject({ degree: 7 });
  });

  it("declines what is not a plain triad or seventh", () => {
    // Augmented sixths approach a cadence; they are not one, and their figure is
    // baked into `rn` where nothing can read it as an inversion.
    for (const rn of ["Fr43", "Ger65", "It6", "N"]) expect(read(chord(0, 1, rn, G))).toBeNull();
  });

  it("reads Cad64 as the six-four it is", () => {
    // The model uses `Cad64` and `I64` interchangeably. If only one parsed, a
    // cadence would appear or vanish on the analyser's choice of spelling.
    expect(read(chord(0, 1, "Cad64", C))).toMatchObject({ degree: 1, inv: 2 });
  });

  it("ignores the applied denominator when reading the figure", () => {
    const c = chord(0, 1, "V", G, { sup: "6", sub: "5/V" });
    expect(read(c)).toMatchObject({ degree: 5, inv: 1 });
    expect(isApplied(c)).toBe(true);
    expect(isApplied(chord(0, 1, "V", G, { sup: "6", sub: "5" }))).toBe(false);
  });
});

describe("tonicPc", () => {
  it("takes the tonic from either case, with accidentals", () => {
    expect(tonicPc("C major")).toBe(0);
    expect(tonicPc("G major")).toBe(7);
    expect(tonicPc("c# minor")).toBe(1);
    expect(tonicPc("Bb major")).toBe(10);
  });
  it("returns null for nonsense rather than a wrong answer", () => {
    expect(tonicPc("")).toBeNull();
    expect(tonicPc("H major")).toBeNull();
  });
});

describe("findCadences", () => {
  it("finds a perfect authentic cadence", () => {
    const cs = findCadences(piece([chord(0, 4, "V", G), chord(4, 8, "I", C)], sopC(4)));
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ type: "PAC", from: 0, to: 1, on: 0, end: 8, bar: 2 });
  });

  it("calls it imperfect when the soprano is not the tonic", () => {
    const cs = findCadences(piece([chord(0, 4, "V", G), chord(4, 8, "I", C)], [["E6", 4, 4, 0, 0]]));
    expect(cs[0].type).toBe("IAC");
  });

  it("calls it imperfect when either chord is inverted", () => {
    const cs = findCadences(
      piece([chord(0, 4, "V", G, { sup: "6" }), chord(4, 8, "I", C)], sopC(4)),
    );
    expect(cs[0].type).toBe("IAC");
  });

  it("finds deceptive and plagal cadences", () => {
    expect(findCadences(piece([chord(0, 4, "V", G), chord(4, 8, "vi", Am)]))[0].type).toBe("DC");
    expect(findCadences(piece([chord(0, 4, "IV", F), chord(4, 8, "I", C)]))[0].type).toBe("PC");
  });

  it("does not cadence onto a six-four", () => {
    // The fault this is here for: `V7 - I64` is a dominant with the tonic
    // suspended over it, not an arrival.
    const cs = findCadences(
      piece([chord(0, 4, "V", G, { sup: "7" }), chord(4, 8, "I", C, { sup: "6", sub: "4" })], sopC(4)),
    );
    expect(cs).toHaveLength(0);
  });

  it("reads I64-V-I as one cadence on the second pair, not a half cadence on the first", () => {
    // The bug this replaced: the half cadence claimed the V, and because a chord
    // cannot be both an arrival and the next approach, the real cadence vanished.
    const cs = findCadences(
      piece(
        [chord(0, 4, "I", C, { sup: "6", sub: "4" }), chord(4, 8, "V", G), chord(8, 12, "I", C)],
        sopC(8),
      ),
    );
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ type: "PAC", from: 1, to: 2 });
  });

  it("finds a half cadence when the dominant is held and does not resolve", () => {
    const cs = findCadences(
      piece([chord(0, 2, "ii", F), chord(2, 4, "I", C), chord(4, 12, "V", G), chord(12, 14, "IV", F)]),
    );
    expect(cs.map((c) => c.type)).toEqual(["HC"]);
  });

  it("ignores applied chords and changes of key", () => {
    expect(findCadences(piece([chord(0, 4, "V", G, { sub: "/V" }), chord(4, 8, "I", C)]))).toHaveLength(0);
    expect(
      findCadences(piece([chord(0, 4, "V", G, { key: "F major" }), chord(4, 8, "I", C)])),
    ).toHaveLength(0);
  });

  it("ignores an arrival off the beat", () => {
    // Every passing V-I inside a bar of quavers would otherwise be a cadence.
    expect(findCadences(piece([chord(0, 1, "V", G), chord(1, 4, "I", C)], sopC(1)))).toHaveLength(0);
  });

  it("never lets one chord be both an arrival and the next approach", () => {
    const cs = findCadences(
      piece([chord(0, 4, "V", G), chord(4, 8, "I", C), chord(8, 12, "vi", Am)], sopC(4)),
    );
    expect(cs).toHaveLength(1);
    expect(cs[0].to).toBe(1);
  });
});
