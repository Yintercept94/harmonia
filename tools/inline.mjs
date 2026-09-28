// Folds dist/ into one self-contained file: dist/harmonia.html — openable
// straight from disk, no server.
//
// The bundle is built as an IIFE (see vite.config.ts), so it is emitted as a
// classic <script>: module scripts have extra origin rules that classic scripts
// do not, and none of them help a file:// page.
//
// The corpus is no longer part of the bundle — it is fetched from public/data
// at runtime (src/lib/corpus.ts) — and a file:// page cannot fetch. So this
// script inlines a *subset* of the corpus onto `window.__HARMONIA__`, which
// corpus.ts and engraved.ts check before reaching for the network.
//
// A subset, not the whole thing, because that is the honest limit of the format:
// the payload is ~200 KB per piece and a browser has to parse all of it before
// the page appears. tools/single_file.json names the subset — it holds the
// thirty works the site opened with. Delete it and pieces are taken in index
// order until BUDGET is spent, which is a worse sampler: the index is sorted by
// date, so that is every Bach chorale and nothing after 1730.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const BUDGET = 6 << 20; // bytes of inlined payload, base64 included

const dist = "dist";
const assets = join(dist, "assets");
const pick = (ext) => readdirSync(assets).find((f) => f.endsWith(ext));
const read = (f) => readFileSync(join(assets, f), "utf8");
const data = (...p) => join(dist, "data", ...p);

// --- pick the subset --------------------------------------------------------

const index = JSON.parse(readFileSync(data("index.json"), "utf8"));
const wanted = existsSync("tools/single_file.json")
  ? new Set(JSON.parse(readFileSync("tools/single_file.json", "utf8")))
  : null;

// `composers` is carried whole: it is 43 rows and 4 KB, and the browse needs
// every one of them to sort, file and label a name — a subset of the pieces does
// not imply a subset of the people.
const payload = { generator: index.generator, composers: index.composers,
                  index: [], pieces: {}, engraved: {} };
let spent = 0;
let dropped = 0;

for (const meta of index.pieces) {
  if (wanted && !wanted.has(meta.id)) continue;
  const eng = data("engraved", `${meta.id}.bin`);
  const b64 = existsSync(eng) ? readFileSync(eng).toString("base64") : null;
  const piece = readFileSync(data("pieces", `${meta.id}.json`), "utf8");
  const cost = (b64?.length ?? 0) + piece.length;
  if (!wanted && spent + cost > BUDGET) {
    dropped++;
    continue;
  }
  spent += cost;
  payload.index.push(meta);
  payload.pieces[meta.id] = JSON.parse(piece);
  if (b64) payload.engraved[meta.id] = b64;
}

if (dropped) console.log(`  single file: ${dropped} pieces over the ${BUDGET >> 20} MB budget, left out`);

// --- fold it all into one file ---------------------------------------------

let html = readFileSync(join(dist, "index.html"), "utf8");

// Replacements go through functions: bundles contain $` and $& sequences, which
// a string replacement would expand into the output.
const escape = (s) => s.replace(/<\/script>/gi, "<\\/script>"); // would close the tag early

html = html
  // CSS is usually folded into the JS chunk by the IIFE build; this covers the
  // case where Vite emits it separately instead.
  .replace(/<link[^>]+href="[^"]*\.css"[^>]*>/, () => `<style>\n${read(pick(".css"))}\n</style>`)
  .replace(/<script[^>]+src="[^"]*\.js"[^>]*><\/script>\s*/, "");

// A classic script runs where it sits, so it goes last — #root has to exist by
// the time it does. (`defer` is ignored on inline scripts.) The corpus has to be
// assigned before the bundle runs, so it is the first of the two.
const corpus = `<script>window.__HARMONIA__=${escape(JSON.stringify(payload))}</script>`;
const js = `<script>\n${escape(read(pick(".js")))}\n</script>`;
html = html.replace(/<\/body>/, () => `  ${corpus}\n  ${js}\n  </body>`);

if (/<script[^>]+src=|<link[^>]+\.css/.test(html)) throw new Error("an asset was left external");

writeFileSync(join(dist, "harmonia.html"), html);
console.log(
  `dist/harmonia.html  ${(html.length / 1024).toFixed(0)} kB  (${payload.index.length} pieces)`,
);
