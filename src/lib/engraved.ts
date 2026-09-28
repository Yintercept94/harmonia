// Notation engraved by Verovio at build time (see tools/engrave.py). Each system
// arrives as a finished SVG plus a quarter-note -> x map, which is all the app
// needs to put the Roman-numeral ribbon and the playhead on top of it.
//
// One file per piece, fetched when that piece opens: the engraving is by far the
// largest thing in the corpus (90 KB for a song, 740 KB for a sonata movement,
// gzipped), so it must never be bundled. See lib/corpus.ts for the reasoning.
//
// The payload is stored as **raw gzip**, not base64-in-JSON, which is a quarter
// smaller on the wire and on disk. The `.bin` extension is deliberate: served as
// `.gz`, static hosts add `Content-Encoding: gzip` and the browser unzips it
// before we do, so `DecompressionStream` then fails on plain JSON. An opaque
// extension keeps decompression ours alone.

import { inlined } from "./corpus";

export interface EngravedSystem {
  svg: string;
  h: number; // viewBox height, px; width is shared across the piece
  from: number; // first beat on this system
  to: number; // first beat of the next one
  ax: [number, number][]; // [beat, x] anchors, ascending
}

export interface Engraved {
  w: number;
  systems: EngravedSystem[];
}

const cache = new Map<string, Promise<Engraved>>();

// The cast is the DOM lib's problem, not ours: DecompressionStream is typed as
// accepting BufferSource, which is not assignable to a ReadableStream<Uint8Array>.
const gunzip = (s: ReadableStream<Uint8Array>) =>
  new Response(
    s.pipeThrough(new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>),
  ).text();

/** The single-file build carries the payload as base64 on `window`. */
async function fromInline(b64: string): Promise<Engraved> {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(await gunzip(new Blob([bin]).stream())) as Engraved;
}

async function fromNetwork(id: string): Promise<Engraved> {
  const r = await fetch(`${import.meta.env.BASE_URL}data/engraved/${id}.bin`);
  if (!r.ok) throw new Error(`engraving ${id}: ${r.status} ${r.statusText}`);
  // r.body is null only for a body-less response, which a 200 here never is.
  return JSON.parse(await gunzip(r.body!)) as Engraved;
}

const EMPTY: Engraved = { w: 0, systems: [] };

export function loadEngraved(id: string): Promise<Engraved> {
  let p = cache.get(id);
  if (!p) {
    const b64 = inlined()?.engraved[id];
    // A missing or unreadable engraving is not worth taking the page down for:
    // Score.tsx renders "no engraving for this piece" and everything else works.
    p = (b64 ? fromInline(b64) : fromNetwork(id)).catch((e) => {
      console.error(e);
      return EMPTY;
    });
    cache.set(id, p);
  }
  return p;
}

/** x for a beat inside one system, interpolating between anchors. */
export function xAt(sys: EngravedSystem, beat: number): number | null {
  const a = sys.ax;
  if (!a.length) return null;
  if (beat <= a[0][0]) return a[0][1];
  if (beat >= a[a.length - 1][0]) return a[a.length - 1][1];
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (a[mid][0] <= beat) lo = mid;
    else hi = mid;
  }
  const [b0, x0] = a[lo];
  const [b1, x1] = a[hi];
  return b1 === b0 ? x0 : x0 + ((beat - b0) / (b1 - b0)) * (x1 - x0);
}

/** Which system holds a beat, its index, and the x for that beat inside it. */
export function locate(
  e: Engraved,
  beat: number,
): { index: number; sys: EngravedSystem; x: number } | null {
  for (let i = 0; i < e.systems.length; i++) {
    const s = e.systems[i];
    const last = i === e.systems.length - 1;
    if (beat >= s.from - 1e-6 && (beat < s.to - 1e-6 || last)) {
      const x = xAt(s, beat);
      if (x !== null) return { index: i, sys: s, x };
    }
  }
  return null;
}

/** Inverse of `xAt`: an x in system space back to a beat. */
export function beatAt(sys: EngravedSystem, x: number): number {
  const a = sys.ax;
  if (!a.length) return sys.from;
  if (x <= a[0][1]) return a[0][0];
  for (let i = 1; i < a.length; i++) {
    if (x < a[i][1]) {
      const [b0, x0] = a[i - 1];
      const [b1, x1] = a[i];
      return x1 === x0 ? b0 : b0 + ((x - x0) / (x1 - x0)) * (b1 - b0);
    }
  }
  return a[a.length - 1][0];
}
