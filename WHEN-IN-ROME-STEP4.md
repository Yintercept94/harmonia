# Step 4 — When in Rome: what is in this archive, and what to run

Unzip over `D:\Stuff\AI_Music_Analysis\harmonia\`. Nothing here is destructive except the five
files listed under "changed" — take a copy of those first if you want a clean diff.

## The number

**506 held-out works, 136,674 sampled beats: 46% exact, 67% chord.** Full tables, and the
reason "held out" is in that sentence, are in README §4.1 and §4.1.1.

## New files

| path | what |
|---|---|
| `tools/wir.py` | Indexes a When in Rome checkout; reads AugmentedNet's training splits back out of its own dataset modules. |
| `tools/ingest_wir.py` | Turns the 335 analyses that ship a score into a normal catalogue. |
| `tools/catalogue_wir.json` | Generated: those 335 works. |
| `tools/bench_results.json` | Every scored piece with its split, plus the aggregates. |
| `tools/rn/wir-*.json` | 334 files of raw network output — checked in, as `tools/rn/` already is. |
| `public/data/pieces/wir-*.json` | 335 analysed pieces. |

## Changed files

| path | change |
|---|---|
| `README.md` | §4.1 rewritten around the real numbers; new §4.1.1 on training contamination; header stats; §3 file map; §9 build steps; licence and `yearApprox` notes in §10. |
| `tools/bench.py` | Walks a corpus instead of four hardcoded pairs. Split-aware. Also fixes a stale default that still pointed at `src/data/pieces.json`, which the step-1 refactor removed — it could not have run as it stood. |
| `tools/analyze.py` | Loads a score the same way `engrave.py` does (see below); `--merge`; accepts several catalogues comma-separated. |
| `tools/engrave.py` | New `strip_harmony_xml()`; corpus-path-vs-file decided by whether the file exists rather than by a leading `/`. |
| `public/data/index.json` | 468 + 335 = 803 entries. |

## What is NOT here

**Engravings.** `public/data/engraved/*.bin` for the new works would be ~90 MB, past what is
worth pushing through this channel — and `engrave.py` needs no model, no network and no
TensorFlow, so it is cheaper to run locally. Until you do, the 335 new pieces are in the index
but will not render.

```bash
python3 tools/engrave.py tools/catalogue_wir.json     # ~25 min
python3 tools/validate.py --drop                      # drops anything that fails its invariants
npm run dev
```

Verified here on three of them (a Beethoven quartet movement, a Mozart sonata movement and a
Hensel song) — 38, 25 and 6 systems, engraving clean.

## Two failures worth knowing about

- **Chopin, Étude Op. 10 No. 12** — AugmentedNet raises `ZeroDivisionError` on it. One piece of
  335; it has no `tools/rn/` file and no piece JSON, and is absent from the index.
- **Beethoven quartets, all 70** — failed on the first pass with `HarmonyException`, because the
  DCML scores carry the analyst's own labels as MusicXML `<harmony>`. Fixed in `engrave.py`
  (`strip_harmony_xml`) and re-run; they are all here. README §9 explains why that fix matters
  for more than parsing.

## Reproducing

```bash
git clone https://github.com/MarkGotham/When-in-Rome.git ../When-in-Rome
python3 tools/ingest_wir.py --wir ../When-in-Rome --augmentednet ../AugmentedNet-main
python3 tools/bench.py --wir ../When-in-Rome --augmentednet ../AugmentedNet-main \
        --catalogue tools/catalogue.json,tools/catalogue_wir.json
```

`bench.py` with no `--wir` still works and still scores the four analyses music21 ships, so the
benchmark does not require a checkout to run at all.
