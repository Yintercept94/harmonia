// How the corpus reaches the browser.
//
// The corpus used to be `import`ed — the whole of pieces.json plus an eager glob
// over every engraving — which compiles the entire library into the JS bundle.
// That is fine at 30 pieces and fatal at 300: the payload is ~200 KB per piece,
// so the bundle grows without bound and every visitor downloads the whole
// library to read one page of it.
//
// So: one small index for the list, one file per piece for the page.
//
//   public/data/index.json          CorpusIndex        ~180 bytes per piece
//   public/data/pieces/<id>.json    the full Piece     fetched when it opens
//   public/data/engraved/<id>.bin   the notation       see lib/engraved.ts
//
// The single-file build (tools/inline.mjs) has no server to fetch from, so it
// injects the same data on `window` instead. Both paths are checked here, in
// that order, and nothing above this module knows which one it got.

import type { ComposerMeta, CorpusIndex, Piece, PieceMeta } from "./music";

export interface Inlined {
  generator: string;
  composers: Record<string, ComposerMeta>;
  index: PieceMeta[];
  pieces: Record<string, Piece>;
  /** id -> base64 of the gzipped engraving; read by lib/engraved.ts. */
  engraved: Record<string, string>;
}

declare global {
  interface Window {
    __HARMONIA__?: Inlined;
  }
}

export const inlined = (): Inlined | undefined =>
  typeof window === "undefined" ? undefined : window.__HARMONIA__;

/** BASE_URL keeps this working when the site is served from a sub-path. */
const url = (rel: string) => `${import.meta.env.BASE_URL}data/${rel}`;

async function getJSON<T>(rel: string): Promise<T> {
  const r = await fetch(url(rel));
  if (!r.ok) throw new Error(`${rel}: ${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

let indexPromise: Promise<CorpusIndex> | null = null;

export function loadIndex(): Promise<CorpusIndex> {
  if (!indexPromise) {
    const inline = inlined();
    indexPromise = inline
      ? Promise.resolve({ generator: inline.generator, composers: inline.composers,
                         pieces: inline.index })
      : getJSON<CorpusIndex>("index.json");
  }
  return indexPromise;
}

const pieces = new Map<string, Promise<Piece>>();

export function loadPiece(id: string): Promise<Piece> {
  let p = pieces.get(id);
  if (!p) {
    const inline = inlined()?.pieces[id];
    p = inline ? Promise.resolve(inline) : getJSON<Piece>(`pieces/${id}.json`);
    pieces.set(id, p);
  }
  return p;
}
