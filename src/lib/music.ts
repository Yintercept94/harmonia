// Domain types, mirroring tools/analyze.py's JSON output.

export type Clef = "treble" | "bass";
export type Fn = "T" | "PD" | "D" | "X";

/** [pitch, onsetBeats, durBeats, staff, tiedToNext] */
export type RawNote = [string, number, number, number, number];

export interface RawChord {
  on: number;
  end: number;
  rn: string;
  sup: string | null;
  sub: string | null;
  fn: Fn;
  conf: number;
  key: string;
  /** The chord spelled out, bass first — what the hover card draws. */
  pcs: string[];
  /** Which member each of those is: 1 root, 3 third, 5 fifth, 7 seventh. */
  dg: number[];
}

export interface Measure {
  n: number;
  start: number;
  len: number;
}

/**
 * What the home page needs, and nothing else. One of these per piece is fetched
 * for the whole corpus at startup, so it has to stay small — a few hundred bytes.
 * `bars` is carried here precisely so the list never has to load `measures`.
 */
export interface PieceMeta {
  id: string;
  /** Into `CorpusIndex.composers`. The display name is not repeated here: it is
   *  the same string 409 times for Bach alone. */
  composerId: string;
  title: string;
  /** From the vocabulary in tools/composers.py. */
  genre: string;
  /** The parent work or set — "Winterreise", "String Quartet, Op. 18 no. 1" —
   *  and the third level of the browse. Absent for a piece that stands alone:
   *  reindex.py omits an empty field rather than writing 767 empty strings. */
  collection?: string;
  /** Printed, never grouped on. Absent where the corpus has no number for it. */
  catNo?: string;
  year: number;
  keyName: string;
  bars: number;
  /** Whether a human wrote an analysis of this piece to score the model against. */
  hasAnalysis: boolean;
}

/** One person, as the index carries them. */
export interface ComposerMeta {
  name: string;
  /** Surname first, so van Beethoven files under B. */
  sort: string;
  period: string;
  born: number;
  died: number;
  nationality: string;
}

/** public/data/index.json in full: the pieces, and the people they are by. */
export interface CorpusIndex {
  generator: string;
  composers: Record<string, ComposerMeta>;
  pieces: PieceMeta[];
}

/** One piece in full. Fetched only when its page opens — and unlike the index
 *  entry it carries the composer's name and its own provenance, because the page
 *  that credits an encoding loads this and not the index. */
export interface Piece extends PieceMeta {
  composer: string;
  source?: string;
  license?: string;
  editor?: string;
  meter: [number, number];
  keySig: number;
  clefs: [Clef, Clef];
  pickup: number;
  tempo: number;
  measures: Measure[];
  notes: RawNote[];
  chords: RawChord[];
  /** Local key name -> its scale, one octave. */
  scales: Record<string, string[]>;
}

export const FN_LABEL: Record<Fn, string> = {
  T: "Tonic",
  PD: "Predominant",
  D: "Dominant",
  X: "Other / chromatic",
};

// Staff geometry used to live here — clef offsets, accidentals, notehead shapes.
// Notation is now engraved by Verovio at build time (tools/engrave.py), so the
// only thing the runtime still needs from a pitch is which recording to play.

const SEMIS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MIDI note number. The sampler picks its recording from this. */
export function midiOf(p: string): number {
  const oct = parseInt(p.slice(-1), 10);
  // Accidentals stack: the corpus really does contain Fbb and F##. Count them
  // rather than testing for one, and only past the letter, or the flats in "Bb"
  // and the B in "Bb" would be the same character.
  const acc = p.slice(1, -1);
  const alt = acc.startsWith("#") ? acc.length : -acc.length;
  return (oct + 1) * 12 + SEMIS[p[0].toUpperCase()] + alt;
}
