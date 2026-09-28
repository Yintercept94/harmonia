# Harmonia

Automatic harmonic analysis of classical scores, rendered as engraved notation with
Roman numerals set beneath the staves.

**767 complete works · 40 composers · 1520–1917 · 44,226 bars · 695,165 notes · 75,058 chord labels.**
Every label in `public/data/` was predicted by a trained network, not written by hand. Works that
were analysed and then thrown away by `tools/validate.py` are not counted, which is the point of
it (§4.2). **648 of those works also have a human analysis to be scored against** (§4.1) — which
is how the accuracy figure below stopped being an anecdote, and which is a filter on the home
page (§1.1).

---

## 1. What this is

Two pages, nothing more:

| Page | Contains |
|---|---|
| **Home** (`src/components/Home.tsx`) | The listing: search, a Filters button, and the pieces with their collections folded into folders. See §1.1. |
| **Analysis** (`src/components/Analysis.tsx`) | Score with Roman numerals, function legend, play button, draggable playhead, noteheads coloured where the harmony under them does not contain them (§5.2), a cadence marked under the numerals wherever the music arrives (§5.3), and a hover card on every label, note, key and cadence (§5.1). |

There is no login, no backend, no database. The piano is compiled into the bundle; **the corpus
is not** — it is static JSON fetched a piece at a time (§2). That distinction is what lets the
corpus grow: the JavaScript is 251 kB whether the site holds thirty pieces or four thousand.
At 767 works the engraved payload is past what belongs in a git repo — build it in CI, or move
`public/data/engraved/` to object storage, before the corpus grows again.

### 1.1 The listing

A flat list with a search box answers one question — *find the thing you can already
name* — and at 767 works that is the only question it answers. So the home page is a
listing with two things above it: a search box and a `Filters` button.

**Collections are folders.** 767 rows fold into **116**: 102 collections plus the
pieces that belong to none. A folder names its collection, its composer, its genre and
its span, and carries the piece count and a chevron on the right. Clicking one expands
it **in place** — the pieces appear indented beneath it and the rest of the list stays
where it was. Nothing navigates, so there is nothing to come back from; clicking again
closes it, and so does the browser's Back, because which folders are open lives in the
URL. Inside a folder a title has its collection's name stripped off the front, since
*Winterreise, D.911 — 5: Der Lindenbaum* under a folder headed *Winterreise, D.911* is
saying it twice.

A collection of one is not folded. 38 of the 102 hold a single work, and a folder you
have to open to find one piece is a click that tells you nothing.

**Every filter is behind one button, and none of them navigate.** `Filters` expands a
panel between the search box and the list, holding all six groups at once: **composer**
(filed by surname), **period**, **genre**, **key** (tonic and mode), **length**, and
**has a human analysis**. Each shows its largest few values with counts and an
"all 40" that expands that group *in place*. Selecting applies immediately, the list
underneath updates, and the panel stays open — so picking three filters costs three
clicks rather than three round trips.

That last part is the whole design. The first version of this was IMSLP's: six cards
on the front door, each opening its own page at `#/browse/<facet>`. It read well and
was miserable to use, because every filter meant leaving the page and coming back.
Those routes are gone.

Four rules govern the filtering, and the third is the one that is easy to get wrong:

1. Within a facet, OR. Across facets, AND.
2. The query applies **last**, over the already-filtered set — the search box always
   searches under the current selection, and never clears one. It also **unfolds the
   list**: typing a title means hunting for one piece, and a folder standing between
   you and the thing you just named is the opposite of an answer.
3. A facet's own counts ignore its own selections. Picking *Romantic* updates the
   composer counts but must not collapse the period list to one row, or a selection
   could never be widened, only cleared.
4. An option that reaches zero is **disabled, not hidden**. A list that shrinks as you
   filter hides the shape of the corpus; *no Renaissance piano sonatas* is true and
   worth seeing.

All of that lives in `src/lib/facets.ts`, which is pure — no React, no DOM, no fetch —
and is the one part of `src/` checked by assertion rather than by a browser
(`src/lib/facets.test.ts`, `npm test`). Facet arithmetic is entirely decidable and
completely invisible on screen until somebody counts a list by hand, which is the
opposite of what `tools/smoke.mjs` guards against. Two bugs have already been caught
there rather than in front of a user; one of them is the next paragraph.

**The URL is the state**, not a copy of it (`src/lib/route.ts`). The open piece used to
live in `useState`, which cost one broken back button; now the filters, the sort and
the open folders all serialise to the hash, so a view can be linked, a bug report can
be a URL, and Back does what Back should:

```
#/                                  the listing
#/?composer=schumann-r&mode=minor    filtered
#/?open=Winterreise%2C+D.911         with that folder expanded
#/piece/bach-bwv253                  an analysis
```

Multiple values **repeat the key** — `?composer=a&composer=b` — rather than joining on
a comma. The comma version shipped and was wrong: 83 of the 102 collection names
contain one, so `Winterreise, D.911` round-tripped as two values that matched nothing
and the list came back empty. It looked intermittent because `Chorales` has no comma.
Repeating the key has no reserved character to trip over.

Hash rather than History, because the one-file build (§9) opens from a `file://` URL.

---

## 2. Architecture

```
                    OFFLINE (Python, run once)                    RUNTIME (browser)
  ┌─────────────────────────────────────────────────┐       ┌────────────────────────────┐
  │ music21 core corpus  (3,194 scores, bundled)    │       │  lib/corpus.ts             │
  │            ↓                                    │       │   loadIndex / loadPiece    │
  │ tools/composers.tsv   who is who, and when      │       │            ↓               │
  │            ↓                                    │       │  lib/route.ts  (the hash   │
  │ tools/build_catalogue.py  → catalogue.json      │       │   IS the state)            │
  │   413 chorales generated + tools/works.tsv      │       │            ↓               │
  │            ↓                                    │       │  App.tsx                   │
  │ tools/predict_rn.py   AugmentedNet (9 heads)    │       │       ↙          ↘         │
  │            ↓          → tools/rn/*.json         │       │   Home.tsx   Analysis.tsx  │
  │ tools/analyze.py         tools/engrave.py       │       │   + lib/facets.ts  ↓       │
  │  score → grid, notes      music21 → MusicXML    │       │  lib/engraved.ts           │
  │  + read the labels        → Verovio → SVG       │       │   (fetch + gunzip + beat↔x)│
  │            ↓                     ↓              │       │            ↓               │
  │  public/data/            public/data/           │──────►│   Score.tsx  (SVG + ribbon │
  │    index.json              engraved/*.bin       │ fetch │    + key marks + playhead) │
  │    pieces/*.json                                │       │   lib/playback.ts (sampler)│
  │            ↓                                    │       └────────────────────────────┘
  │ tools/reindex.py    metadata only, no music21   │
  │            ↓                                    │
  │ tools/validate.py   asserts the three clocks    │
  │            ↓        agree; drops what fails     │
  │  tools/build_piano.py → src/assets/piano/*.webm │
  │  engrave.py also → src/data/glyphs.json         │
  └─────────────────────────────────────────────────┘
```

Three splits matter.

**Analysis and engraving are build steps, not requests.** Nothing is computed in the browser —
it inflates finished SVG and draws a ribbon on it. Adding a piece means a row in
`tools/works.tsv` and re-running `predict_rn.py`, `analyze.py`, `engrave.py`, `validate.py`.
Only `predict_rn.py` needs the model; `tools/rn/*.json` is checked in, so the app rebuilds
without TensorFlow, a GPU or the weights.

**Metadata is not music.** A title correction, a genre, a composer's name normalised — none of
that touches a score, and running 767 of them back through music21 to write it down costs half an
hour and risks churning ids. `tools/reindex.py` rewrites `index.json`, and optionally the metadata
half of every piece file, from the catalogues alone. `analyze.py` remains the only thing that
parses a score.

**The corpus is fetched, not bundled.** It used to be `import`ed — the whole of `pieces.json`
plus an eager `import.meta.glob` over every engraving — which compiles the entire library into
the JavaScript every visitor downloads. At 30 pieces that was a 6.5 MB bundle and merely
wasteful. At 767 it would be 50 MB, and at the 1,300-work corpora this is heading for
(`../corpus_scaling_research.md`) it would not build at all. So:

| File | What | Size today |
|---|---|---|
| `public/data/index.json` | a `composers` block, then one ~180-byte record per piece: id, composerId, title, genre, collection, catNo, year, key, bars, hasAnalysis | 184 KB |
| `public/data/pieces/<id>.json` | the piece in full — measure grid, notes, labels, spellings, provenance | 28 MB total |
| `public/data/engraved/<id>.bin` | the notation: gzipped SVG systems + the beat→x map | ~80 MB total |

Only `index.json` is loaded on arrival. A piece's own two files are fetched when it opens, and
the JS bundle stays at 251 kB (80 kB gzipped) whatever the corpus does.

The index got **smaller** when the listing added six fields to it, which is worth explaining. The
composer's display name was the same string 409 times over for Bach; it is now a short
`composerId` into a `composers` block at the head, which also hands the listing its sort names,
periods and dates for nothing. `source` and `license` — two long strings repeated on all 767
records, 50 KB of an index that never read them — moved out entirely to the piece files, which is
where the page that credits an encoding loads from. 244 KB before, 184 KB after.

The engraving is stored as **raw gzip rather than base64-in-JSON** — base64 costs a third of the
payload for nothing, and `DecompressionStream` inflates it either way. The `.bin` extension is
deliberate: named `.gz`, static hosts helpfully add `Content-Encoding: gzip` and the browser
unzips it before we do, leaving `DecompressionStream` to fail on plain JSON.

---

## 3. File map

| File | Lines | Responsibility |
|---|---:|---|
| `tools/composers.tsv` | 43 rows | **The people.** id, sort name, display name, period, dates, nationality, and every alias the corpus has ever produced for them. Both ingest paths resolve through it and neither may guess: 49 strings for 43 people is what made a by-composer page impossible before it existed. See §1.1. |
| `tools/composers.py` | 108 | Loads the above and resolves a name to a person — exact match on id, sort, display or alias after collapsing whitespace and case, and a hard error otherwise. Also holds the period order and the genre vocabulary. |
| `tools/build_catalogue.py` | 206 | *Which* works to analyse. Bach's 413 chorales are generated from music21's BWV index; everything else is read from `works.tsv`. A corpus path in neither is skipped and reported, never guessed at. |
| `tools/works.tsv` | 67 rows | **The curation.** One row per non-chorale work: path, composer, title, genre, collection, catNo, year, tempo. music21's MusicXML carries no usable title or date — `work-title` is the filename — so there is nothing to derive and this table is the source of truth. The three metadata columns used to be one `cat` string doing three jobs; splitting them is what the genre facet and the collection folders are made of. Later sources (kern, OpenScore) carry their own metadata and will invert that. |
| `tools/predict_rn.py` | 166 | **The analyser.** Runs AugmentedNet over the corpus → `tools/rn/*.json`. Needs the model; nothing else does. See §4. |
| `tools/rn/*.json` | — | Generated and checked in. One file per piece: `[{on, rn, key, conf}]` straight from the network. |
| `tools/analyze.py` | 468 | Score parsing — measure grid, notes for playback, metre, clefs — plus reading `tools/rn/` back. Corpus + labels → `pieces.json`. See §4. |
| `tools/bench.py` | 262 | Scores the corpus against human analyses — the four music21 ships, or the 707 a When in Rome checkout provides. Reports held-out and trained-on separately. See §4.1. |
| `tools/wir.py` | 204 | **The When in Rome index.** Walks a checkout, works out how each analysis reaches its score (local `.mxl`, music21 corpus path, MuseScore, kern, or nowhere), and reads AugmentedNet's own training splits back out so `bench.py` knows what the model has already seen. `scored_ids()` also answers the home page's "has a human analysis" filter, which a catalogue cannot: only the pieces whose analysis ships beside their score carry an `analysis` field, and 349 more reach one through music21's corpus. See §4.1.1. |
| `tools/ingest_wir.py` | 255 | Turns the 335 analyses that ship their own score into an ordinary catalogue, so the rest of the pipeline needs no special case. Metadata is derived, not curated; the one field that cannot be — the year — is filled from a per-composer table and flagged `yearApprox`. The composer comes from the folder tree and is resolved through `composers.tsv`; it is emphatically *not* taken from the RomanText header any more, which is free text an analyst typed and where "J.S. Bach" beside "Bach" came from. |
| `tools/catalogue_wir.json` | — | Generated. 335 entries, the When in Rome half of the corpus. Its `path` and `analysis` fields are absolute, so a copy from another machine needs `ingest_wir.py --repath` before anything will find a score. |
| `tools/bench_results.json` | — | Generated by `bench.py`: every scored piece with its split, plus the aggregates in §4.1. |
| `tools/validate.py` | 288 | **The gate.** Per-piece invariants — the three clocks, the measure grid, label sanity, the engraving's anchors — plus `--drop`, which removes what fails from the index, plus an assert that every piece resolves to a person in `composers.tsv` and a genre in the vocabulary, so the next ingest cannot quietly reintroduce two spellings of Beethoven. See §4.2. |
| `tools/reindex.py` | 149 | Rewrites `index.json`, and with `--pieces` the metadata half of every piece file, from the catalogues alone — no music21, no re-parsing. This is how a metadata change reaches the site. `--only` chunks the piece pass for a slow disk. |
| `tools/smoke.mjs` | 120 | Browser smoke test over `dist/`, and over `dist/harmonia.html` with `--single`. Both faults in §5 build cleanly and leave a blank page, so this drives a real browser and checks that notation actually painted. |
| `tools/single_file.json` | 30 ids | Which pieces the one-file build carries (§9). |
| `tools/catalogue.json` | — | Generated. 477 entries: `{id, path, composer, composerId, title, genre, collection, catNo, year, tempo, source, license}`. |
| `tools/engrave.py` | 369 | **The engraver.** Corpus → MusicXML → Verovio → one SVG per system, plus the beat→x map. See §5. |
| `tools/build_piano.py` | 80 | Renders the sampled piano into `src/assets/piano/`. See §6. |
| `tools/inline.mjs` | 89 | Build step. Folds `dist/index.html` + its assets into `dist/harmonia.html`. |
| `serve.py` | 54 | Serves `dist/` over http for `run-harmonia.bat`, with `no-store` on HTML so a cached `index.html` cannot go on naming the previous build's JavaScript. See §9. |
| `public/data/index.json` | — | Generated, 184 KB. The composer table, then one small record per piece; the only corpus file loaded on arrival. |
| `public/data/pieces/*.json` | — | Generated, 28 MB total. Labels, measure grid, notes for playback, chord tones, scales and provenance. |
| `public/data/engraved/*.bin` | — | Generated, 80 MB total, one file per piece: raw gzip of the engraved systems. |
| `public/data/rejects.json` | — | Generated by `validate.py`: what failed, and why. |
| `src/lib/corpus.ts` | 71 | Fetches the index and a piece, or reads them off `window.__HARMONIA__` in the one-file build. Nothing above it knows which. |
| `src/data/glyphs.json` | 5 KB | Generated. The eight Bravura outlines the hover card draws with — clefs, notehead, accidentals. |
| `src/lib/music.ts` | 115 | Domain types and `midiOf`. Pure functions, no React. |
| `src/lib/harmony.ts` | 106 | **What the analysis says about one note**, as opposed to about a chord: `chordAt`, `memberOf`, `isNonChordTone`, and `markNonChordTones`, which writes the answer into a system's markup. The only place that decides whether a note belongs to the harmony under it — the notehead's colour comes from it and so does `Inspector.tsx`'s card, because the same three lines in two files is a disagreement waiting to be written. See §5.2. |
| `src/lib/harmony.test.ts` | 120 | 12 assertions over the above — `npm test`. Most of them are the half-open boundary, enharmonic spelling and the markup rewrite, which are the three ways this goes wrong while looking entirely correct. |
| `src/lib/cadence.ts` | 271 | **Where the music arrives.** Reads a Roman numeral into degree, quality and inversion, and walks adjacent pairs for the five cadences in §5.3. Pure, and derived from `chords[]` + `measures[]` + `notes[]` — nothing on disk changes for it either. |
| `src/lib/cadence.test.ts` | 147 | 16 assertions — `npm test`. Four of them are regressions for rules that looked right and were not: the six-four arrival, `Cad64` spelling, the cadential six-four swallowing the cadence after it, and one chord serving as two cadences' worth of duty. |
| `src/lib/facets.ts` | 324 | **The listing, as arithmetic.** Filtering, counting, sorting, folding pieces into collection folders, the length buckets and the key parser. No React, no DOM, no fetch. See §1.1. |
| `src/lib/facets.test.ts` | 233 | 25 assertions over `facets.ts` and `route.ts` — `npm test`. The pure modules are the only part of `src/` checkable without a browser, and the part where a wrong answer looks entirely plausible on screen. Two of them are regressions for bugs that shipped. |
| `src/lib/route.ts` | 80 | The hash ↔ `{view, id, filters, open}`. Also pure. The URL is the state, not a copy of it. |
| `src/lib/notation.ts` | 124 | Enough notation to place a note on a staff: pitch parsing, staff steps, ledger lines, seconds, accidental lanes. |
| `src/lib/engraved.ts` | 120 | Fetches and inflates one piece's engraving on demand and maps beats↔pixels (`locate`, `xAt`, `beatAt`). |
| `src/lib/playback.ts` | 284 | `Player` class. Web Audio, the sampled piano (§6), look-ahead scheduling, `seek`/`play`/`pause`, `onTick`, and `preview`/`previewChords` for the hover card — the second because a cadence is two chords and the motion between them is the point. |
| `src/components/Score.tsx` | 526 | Mounts each engraved system lazily and draws the ribbon, numerals, local-key marks, cadence bars and playhead over it. Runs each system's markup through `markNonChordTones` on load (§5.2). Owns what the pointer is resting on. |
| `src/components/Inspector.tsx` | 241 | The hover card: what a label, a note, a key or a cadence actually is, and the buttons that play it. See §5.1. |
| `src/components/MiniStaff.tsx` | 173 | Draws a chord or a scale on five lines, with clickable noteheads. |
| `src/components/Analysis.tsx` | 301 | Page shell: header, transport, playback settings (§6.1), colour key, spacebar shortcut. |
| `src/components/Home.tsx` | 150 | Search, sort, the Filters button and the listing. One component: the search box has to sit in the same place whether the panel is open or shut. |
| `src/components/Facets.tsx` | 153 | The filters panel — all six groups at once, each expanding in place. Counts on everything; zeroes disabled rather than hidden. Nothing in it navigates. |
| `src/components/Chips.tsx` | 54 | The active selections, removable. With the panel shut they are the only account of what is filtering, and the only way to drop one without opening it again. |
| `src/components/PieceList.tsx` | 176 | Folder rows and piece rows, 120 at a time behind an `IntersectionObserver`. A plain `<ul>` of 767 rows is a slow first paint and a janky search; a virtualiser would cost a dependency and give up find-in-page, so it pages instead. |
| `src/App.tsx` | 120 | Hash router, and the two async loads: the index on arrival, a piece when one opens. |
| `src/main.tsx` | 42 | Mount + error boundary. A render error prints its message instead of leaving a white page. |
| `src/assets/piano/*.webm` | ~1 MB | 30 piano recordings, one per minor third (§6). |
| `src/index.css` | — | Design tokens (see §7). |

---

## 4. How the analysis works (`tools/predict_rn.py` + `tools/analyze.py`)

The Roman numerals come from **AugmentedNet** (Nápoles López, Gymer & Fujinaga, ISMIR 2021) —
a convolutional-recurrent network trained on the annotated corpora (ABC, BPS, HaydnSun,
TAVERN, When-in-Rome). It is not a classifier over chord labels. It has **nine output heads**,
predicted jointly at a 32nd-note frame rate:

| head | predicts |
|---|---|
| `LocalKey38` | the key in force right now |
| `TonicizedKey38` | the key being tonicised, if any |
| `RomanNumeral31` | the scale degree |
| `PitchClassSet121` | which pitch classes are sounding |
| `Bass35` `Tenor35` `Alto35` `Soprano35` | the four voices, spelled |
| `HarmonicRhythm7` | where the harmony changes |

`HarmonicRhythm7` is what segments the music — no fixed beat grid — and the final numeral is
resolved by cosine similarity between the predicted pitch-class vector and the chord
vocabulary, which is why a head can be individually wrong and the label still come out right.

The pipeline is two scripts, and they are separate on purpose:

1. **`tools/predict_rn.py`** stages the AugmentedNet checkout into `tools/_anet/`, patches it
   for a current music21 (it pins 6.7.1; `.flat` was removed in 9), loads the weights under
   `tf-keras`, and runs each score. Output: `tools/rn/<id>.json`, one row per chord segment —
   `{on, rn, key, conf}` in quarter notes from the start.
   It drives **AugmentedNet's own `predict()`** and watches it with two small spies, one on the
   model and one on the segmenter, rather than reimplementing the inference path. That is not
   fastidiousness: a reimplementation that looked right segmented the Monteverdi into 134 chords
   where the real pipeline finds 163, and scored 15% against the annotator instead of 54%.
2. **`tools/analyze.py`** parses the score for everything else — measure grid, notes for
   playback, metre, clefs, key signature, pickup — reads `tools/rn/` back, converts each figure
   into the display form (`V65/V` → numeral `V`, superscript `6`, subscript `5/V`), classifies
   it T/PD/D/X by scale degree, and merges adjacent identical labels.

   It also spells each label out: `pcs` is the chord's own notes in sounding order, `dg` says
   which member each of them is (1 root, 3 third, 5 fifth, 7 seventh), and `scales` gives every
   local key's scale. That is what the hover card draws, and it is worked out here for one
   reason — **the browser should never have to know what a Roman numeral means.** music21
   already does, and it does it correctly for `viio7/iv` in D minor at four in the morning.
   Chords are transposed by whole octaves until they sit around the middle of a treble staff:
   a numeral carries no register, and music21 spells V65 in G as F#5–A5–C6–D6, four ledger
   lines up.

Splitting them this way means the corpus rebuilds without TensorFlow. Only re-predicting needs
the model.

### 4.1 How good is it, actually

`tools/bench.py` scores `public/data/` against human analyses. It used to compare **four**
pieces, because four of the 68 RomanText analyses music21 ships cover pieces in this corpus.
Four is an anecdote. With a [When in Rome](https://github.com/MarkGotham/When-in-Rome) checkout
(§4.1.1) it compares **506**, and the answer changed.

Two columns, and the gap between them is the diagnosis:

- **exact** — the same Roman numeral the annotator wrote.
- **chord** — the same pitch classes, whatever the numeral says.

A high chord score with a low exact score means the harmony is being heard and mislabelled,
which is what a wrong local key does.

**506 held-out works, 136,674 sampled beats: 46% exact, 67% chord.**

| era | works | beats | exact | chord |
|---|---:|---:|---:|---:|
| Baroque | 353 | 39,262 | **51%** | 76% |
| Romantic | 43 | 11,997 | 48% | 71% |
| Classical | 102 | 82,690 | 44% | 63% |
| Modern (to 1917) | 8 | 2,725 | 36% | 64% |

The old headline was 36% exact on four pieces. The real number is 46% on 506, and the four-piece
sample was not so much wrong as uninformative — three Bach chorales and one madrigal cannot tell
you anything about the other 502 works.

**The surprise is where it fails.** The prior was that a network trained mostly on common-practice
tonality would collapse on chromatic Romantic song. It does not: Schubert scores 58% exact and
Louise Reichardt 62%, both above the Bach chorales. What collapses is **Beethoven's quartets — 36%
exact, 58% chord across 97,579 beats**, by a distance the weakest repertoire here. Those are also
the longest movements in the corpus, so they dominate the Classical row above; strip them out and
the era table flattens. Whatever is going wrong is not chromaticism. The plausible culprit is
texture — four independent lines, suspensions resolving across bar lines, and long stretches where
the harmony is implied by voice leading rather than stated. That is the next thing to look at.

| collection | works | beats | exact | chord |
|---|---:|---:|---:|---:|
| Early_Choral (Bach chorales, Monteverdi) | 371 | 40,514 | 52% | 77% |
| Piano_Sonatas (Mozart, Beethoven) | 53 | 46,346 | 52% | 72% |
| OpenScore Lieder | 179 | 50,027 | 51% | 71% |
| Variations_and_Grounds | 4 | 4,486 | 44% | 63% |
| Quartets (Beethoven) | 70 | 97,579 | **36%** | 58% |
| Keyboard_Other (WTC, Chopin) | 26 | 7,071 | 36% | 58% |

Against the rule-based analyser this replaced, on the three chorales both versions cover, same
metric, same alignment:

| piece | rule-based exact | network exact | rule-based chord | network chord |
|---|---:|---:|---:|---:|
| bach-bwv269 | 69% | **84%** | 75% | **94%** |
| bach-bwv347 | 30% | **59%** | 62% | **85%** |
| bach-bwv277 | 10% | **45%** | 21% | **81%** |
| **all three** | **39%** | **64%** | **55%** | **87%** |

That is the reason for the swap: +25 points on exact numerals and +32 on chord identity, and
the old analyser's tuning knobs — window widths, triad priors, key-switch margins — are gone
with it. Two qualitative differences matter as much as the numbers:

- **Applied chords.** 23% of labels are now secondary functions (`V65/V`, `viio7/iv`). The old
  analyser produced **none**: it labelled every chord against the prevailing key, so a
  tonicisation came out as an unexplained chromatic chord.
- **Confidence means something.** `conf` is the softmax over `RomanNumeral31` and ranges
  0.31–0.99 across the corpus. The old analyser's was a hand-built score that mostly sat near
  its own mean.

For context, 57% on the standard benchmark is the published state of the art. 46% across an
era-spread corpus is not embarrassing, and it is not a solved problem: **more than half the
numerals in this corpus disagree with a human**, and the site says so rather than not.

#### 4.1.1 Why every table above says "held out"

**AugmentedNet was trained on When in Rome.** That is not a footnote — it is the difference
between a benchmark and a press release. Its dataset modules (`AugmentedNet/data/*.py`) name
their training pairs by path, and 275 of the 1,294 analyses in the corpus are pieces the model
has already been shown:

| split | analyses |
|---|---:|
| unseen | 1,018 |
| training | 191 |
| validation | 42 |
| test | 42 |

`tools/wir.py` reads those splits out of AugmentedNet itself, so the labels stay true if the
model is ever retrained, and `bench.py` reports each split separately. **Only `unseen` is quoted
anywhere.** The path table in AugmentedNet was written against an older layout of the corpus —
folders have been renamed and zero-padded since — so `wir.py` normalises both sides before
joining; without that, 104 of the 275 look unseen and quietly inflate the score.

Having measured it, the interesting result is that **it barely matters**:

| split | works | beats | exact | chord |
|---|---:|---:|---:|---:|
| unseen | 506 | 136,674 | 46% | 67% |
| validation | 30 | 14,839 | 48% | 71% |
| test | 29 | 15,102 | 43% | 68% |
| training | 139 | 81,756 | 42% | 64% |

The model scores *lower* on its own training data than on music it has never seen. It has not
memorised this corpus; the training rows are simply harder music (they are quartet-heavy). That
is a good result and worth stating plainly — but it is a result, not an assumption, and it only
became one because the splits were checked.

### Alignment, and why it kept going wrong

Three clocks have to agree: the analysis (`chords[]`), the notes (`notes[]`), and the engraving
(Verovio's `qstamp`). Every alignment bug in this project has been one of them drifting from
the others, and none of them announces itself — the ribbon just sits under the wrong chord.

There are guards for each cause found so far:

- **Repeats.** Verovio's timemap plays a repeated section twice; music21's offsets do not.
  `strip_repeats()` removes the signs before engraving. Measured at up to 584 px of drift on a
  690 px system.
- **Bars split by a repeat sign.** A repeated section usually ends mid-bar — BWV 277 closes its
  repeat after three beats and opens the next with a one-beat upbeat, stored as two short
  Measures. MusicXML has no such thing, so the writer pads *each* out to a full bar and the
  score comes back four quarter notes longer than it went in. `merge_partial_bars()` puts them
  back together. This one cost BWV 277 19 points of exact accuracy while looking like a bad
  analysis.
- **Durations MusicXML cannot spell.** C.P.E. Bach's ornaments arrive as 171/1024 of a quarter.
  Repairing them changes the lengths Verovio adds up: on Op. 59 no. 2 the engraving ran 58
  quarter notes ahead of the analysis by the last system. `bar_clock()` maps Verovio's clock
  onto the analysis clock through the bar lines, which both sides agree on.
- **A corpus file whose voices do not line up.** music21's `monteverdi/madrigal.4.5` has five
  parts that end at 352, 356, 368, 404 and 412 quarter notes — bar 82 starts in a different
  place in every voice. Nothing can be aligned to it, and it was dropped for `madrigal.5.8`.

`tools/bench.py` aligns by **bar and beat**, not by raw offset, for the same reason: a
RomanText file carries its own time signatures, and when they disagree with the score's, the
two timelines drift apart while both remain internally consistent.

### 4.2 The validator, and what it caught

Every fault above was found by reading a score and noticing the ribbon was under the wrong
chord. That works at thirty pieces. It does not work at four hundred, and it will not work at
four thousand, so the invariants are now asserted by `tools/validate.py`:

| Check | The fault it is aimed at |
|---|---|
| engraving's last beat ≈ the measure grid's last beat | repeats played twice, repeat-split bars, unspellable durations — all three land here |
| every system's beat→x anchors ascend in both axes | a page holding two systems, or a timemap entry attached to the wrong one |
| systems are contiguous: each one's `to` is the next one's `from` | a page with no notes on it, whose empty range propagates backwards |
| labels ordered, non-overlapping, inside the score | analysis and score on different clocks |
| labels per bar within 0.15–12, mean confidence ≥ 0.25 | inference that silently did nothing |
| every local key has a scale; index agrees with the piece | a hover card with an empty staff; a wrong bar count on the list page |
| bars not wildly off the usual length, after folding repeat-split pairs | genuine garbage, without flagging metre changes |

`--drop` removes what fails from `index.json` instead of failing the build, and every failure
lands in `public/data/rejects.json` with its reason.

It earned this on the first run. Three findings, in order of how badly they would have aged:

- **Mille regretz was already wrong on the live site.** Josquin's chanson is encoded on one
  staff, and `pageHeight: 600` was only "small enough for one system per page" for scores with
  two or more. Verovio fitted three systems onto a page, all three sets of anchors were merged
  into one list, and the ribbon for two thirds of the piece was drawn at another row's x. The
  page rendered, the notation was correct, and the analysis on top of it was nonsense.
  `pageHeight` is 150 now — Verovio always emits at least one system per page, so erring low
  costs nothing — and `engrave.py` raises if a page ever holds two.
- **Pages with no notes voided their neighbours.** In long movements Verovio emits pages that
  carry no timemap entry. Those took `from`/`to` of 0.0, and since each system's `to` is the
  next one's `from`, the zero propagated backwards. They are dropped before the systems are
  built.
- **Nine of 477 works failed and were dropped**, at 1.9%. Three because music21 exports a
  2048th note that MusicXML cannot spell, so neither the model nor the engraver ever saw them;
  four with anchors that go backwards in the middle of a long movement; one where the network
  emitted 28 labels for 270 bars; one chorale whose analysis runs 13 beats past its own last
  bar. The remaining anchor fault is the open one — it is in `rejects.json`, not in the site.

**A rejection rate is a feature.** The alternative is not a corpus without faults; it is the
same faults, shipped.

### What this is not

It is not an analysis you should trust unexamined, and it is not doing theory — it is a
sequence model that has read a lot of annotated scores. It has no notion of phrase, cadence or
form, and nothing stops it from contradicting itself two bars apart.

### Known weaknesses

- **Modal repertoire** (Palestrina, Josquin, Monteverdi). Roman numerals presuppose functional
  tonality; on 16th-century music the output is anachronistic by construction, and the
  benchmark row for the madrigal shows exactly that — the chords are right, the keys are a
  matter of opinion.
- **Ragtime** (`joplin-maple-leaf-rag`). Chromatic passing sonorities over a wide-leaping bass;
  the model finds six local keys in it, which is defensible but not what most editions print.
- **Atonal music** (`schoenberg-opus19-movement2`) is included deliberately as a control. Mean
  confidence there is 0.50, the lowest in the corpus, and the labels are meaningless — which is
  the correct result.
- **Long movements are unverified.** No ground truth exists here for anything past a chorale.

---

## 5. How the engraver works (`tools/engrave.py` + `Score.tsx`)

Notation is engraved by **Verovio 6.2** at build time and shipped as finished SVG. The app
does no layout at all.

Why build time rather than the browser: shipping Verovio means a 7 MB WebAssembly toolkit
and ~0.5–1.5 s to lay out each piece on open. Baking it costs 16 MB of SVG, but that
compresses to 3.9 MB and opens instantly. Measured both ways before choosing;
`docs/RESEARCH-notation-scores-audio.md` has the numbers.

`tools/engrave.py`, per piece:

1. **music21 → MusicXML.** The same corpus entry `analyze.py` reads and the same file
   `predict_rn.py` feeds the network, exported with part labels stripped, repeats removed and
   repeat-split bars rejoined (§4, "Alignment"). Two files need further repair: zero-length
   notes and durations like 171/1024 of a quarter exist in the corpus and MusicXML can express
   neither, so they are quantised onto sixteenths, triplets and sextuplets and whatever
   survives that is forced onto a 1/12 grid.
2. **One system per page.** `pageHeight` is set small enough that only one system fits, so
   Verovio's own pagination does the splitting and each page arrives as a standalone `<svg>`
   with a correct viewBox. No SVG surgery needed. "Small enough" means 150, not the 600 it
   used to be: a single-staff score fitted three systems into 600 and merged their anchor
   lists (§4.2). Verovio never emits less than one system per page, so a low value is free,
   and the loop raises if a page holds two anyway.
3. **The beat→x map.** `renderToTimemap` gives `qstamp` (quarter-note position) against
   element ids; each id is found in a page's SVG and its `translate(x, …)` read off. The
   result is a sorted `[beat, x]` anchor list per system, which is all `Score.tsx` needs to
   place the ribbon and the playhead. `qstamp` is *usually* the same axis `chords[]` uses;
   `bar_clock()` maps it through the bar lines for the scores where it is not (§4).
4. **Payload.** Each piece is gzipped into its own `public/data/engraved/<id>.bin` and
   inflated with `DecompressionStream` when you open it — all 468 at once would be 184 MB of
   markup for a page that shows one. Raw gzip, not base64: see §2.

`locate(eng, beat)` → `{index, sys, x}`; `beatAt(sys, x)` → the inverse, for click-and-drag
seeking; `xAt(sys, beat)` for the ribbon. All three interpolate the same anchor list, so they
cannot disagree.

Each notehead also keeps an id, rewritten from Verovio's random one to say what it is:
`nt-F#4-12.5` — the pitch and the beat it falls on. That is how pointing at a note in the
score finds the note in the analysis. The pitch comes from Verovio itself (`pname` and `oct`,
with the accidental recovered from the sounding MIDI value), so it cannot drift from the
notation, and it costs about ten bytes a note — the same as shipping a lookup table, with one
fewer thing to keep in step.

### 5.1 The hover card

Rest on anything in the analysis for a second and a card appears beside it. There are three:

| Point at | It says |
|---|---|
| a Roman numeral or its ribbon | the chord drawn on a staff, the key it is read in, its function, and the model's confidence |
| a notehead in the score | which chord member it is — root, third, fifth, seventh — over the same staff with that note picked out in red, or "non-chord tone" when it is none of them, in the colour that notehead is already wearing (§5.2) |
| a key mark | that key's scale on a staff |
| a cadence bar | which of the five it is, the two chords that make it, its key and its bar — both chords drawn on staves and playable, and a button that plays the cadence itself (§5.3) |

Every notehead in the card plays when clicked, and each card has a button that plays the whole
chord, or walks up the scale.

Three things about it are worth knowing:

- **It draws real notation, not an approximation.** `src/data/glyphs.json` holds eight Bravura
  outlines lifted straight out of Verovio's own font data by `engrave.py`, so a notehead in the
  card is the same shape as a notehead in the score above it. `src/lib/notation.ts` is the rest:
  staff steps, ledger lines, the rule that two notes a second apart cannot share a stem
  position, and lanes so stacked accidentals do not print on top of each other. Bravura is drawn
  on a 1000-unit em and a staff space is a quarter of it, which is the only magic number.
- **The notation layer sits on top of the ribbon layer**, so its noteheads can be pointed at.
  Everything else in it is `pointer-events: none`, so clicks fall through to the seek handler,
  which is why seeking still works when you start the drag on a notehead. The seek handlers live
  on the system wrapper rather than on either layer for the same reason.
- **It waits a second before opening, and lets go the moment you look elsewhere.** Opening on
  contact put a box over the notation as soon as the pointer crossed a numeral, and then you
  could not reach what was underneath: moving towards it only kept the box alive. A second of
  stillness is longer than any movement across the score and shorter than a deliberate look, and
  pointing at a *different* target dismisses the open card immediately — while the new one is
  still counting — so the region clears itself. Esc dismisses too. A tap opens straight away,
  since a touch screen has no hover to time.
- **The whole thing runs off one `pointermove` listener, and uses neither `pointerenter` nor
  `pointerleave`.** Not for want of trying: leaving a notehead fires no `pointerout` and no
  `pointerleave` at all in some browsers, and the card then sticks to the screen until you
  reload. Asking "what is under the pointer" on every move cannot be dodged that way, and it
  costs one `closest()` call per move. Each target carries a `data-hover` marker and an id — a
  chord index, a notehead's `nt-…`, a key and its position — so resting on the same thing does
  not restart the clock and returning to it does not reopen. Closing is delayed 160 ms, so the
  pointer can cross the gap into the card without it vanishing on the way.

Two rules in `engrave.py` that look like details and are not:

- **The root `<svg>` keeps its id.** Verovio scopes its stylesheet by it —
  `#<root-id> ellipse, path, polygon, rect {stroke:currentColor}`. Element ids elsewhere are
  stripped (27% smaller gzipped), but strip that one and every staff line, barline, stem and
  slur silently loses its stroke while the noteheads, being filled glyphs, carry on as though
  nothing were wrong. `tools/`-side stripping and a `getComputedStyle(...).stroke` assertion in
  the browser sweep both guard it now.
- **Staff labels only survive when the parts differ.** "1st Violin / 2nd Violin / Viola / Cello"
  is the point of having four staves; a piano exported as two parts would otherwise print
  "Piano" twice down the side of one grand staff, and music21's placeholder prints
  "MusicXML Part".

The bottom page margin is inflated (`BOTTOM = 100`) to leave ~31 px under the staves for the
local-key mark, the ribbon and the numerals. `Score.tsx` overlays those in a second, transparent `<svg>` sharing
the system's viewBox, rather than injecting into Verovio's markup.

**Layout is baked at one width** and scales to the container, the way a PDF does. That is the
one thing given up by pre-rendering; it does not reflow on resize.

### 5.2 Non-chord tones

A notehead the harmony under it does not contain is drawn in violet rather than
ink. `src/lib/harmony.ts` decides — pitch class against the label's `pcs` — and
`markNonChordTones` adds a class to the `g.note` in the engraved **markup**, once,
as the piece loads and before React is handed it.

**Nothing on disk changes for this.** Not `pieces.json`, not the engraving. Every
notehead already carries its pitch and its beat in its id (`nt-F#4-12.5`, §5), and
the chord covering that beat is already in `chords[]`, so the answer is a lookup at
load time rather than a field in a file. That is deliberate rather than convenient:
the engraving knows nothing about the analysis — they meet only on the beat axis —
and baking a colour into the SVG on disk would mean re-engraving all 767 works
every time the analyser changes its mind about a chord.

**Marking the string rather than the mounted DOM is the whole trick, and the
obvious version of this is broken.** Walking `g.note` in a `useLayoutEffect` after
each system mounts looks right, passes a unit test, and silently loses **the first
system of every piece and no other**. `Score.tsx` hands each system to React as
`dangerouslySetInnerHTML`; React may build a system's markup during a render pass
it then discards and redoes, and the wrapper `div` survives that while its contents
are replaced. System 0 is the only one mounted before the `IntersectionObserver`'s
first update, so it is the only one whose classes are added before that second pass
and thrown away by it — and a `data-nct` guard flag on the wrapper makes it worse,
because the flag survives and stops the system ever being marked again. Every count
was right, every element was in the document, and 115 noteheads were black.
Marking the html means the classes are part of what React sets: no window in which
they can be lost, no flag to keep, no ordering to reason about.

Three things worth knowing about what it means:

- **It is membership, not a name.** Passing, neighbour, suspension, appoggiatura
  and escape are claims about *one voice over time*, and `notes[]` is a flattened
  two-staff reduction with no voices in it. Naming them needs voice separation;
  asking whether a note is in the chord does not. The card says "non-chord tone"
  for the same reason — it used to say "passing or neighbour tone", which named the
  two things this specifically cannot yet tell apart.
- **A note in an unanalysed gap is left in ink.** `isNonChordTone` returns `null`
  there rather than `false`: absence of a label is not a claim that a note is
  consonant, and colouring it either way would be an assertion nothing made.
- **It shows the analyser's failures as readily as the composer's dissonances.**
  A run of violet where the harmony plainly is not moving is the model having lost
  the chord, and that is a feature — it is the first thing on this site that makes
  a wrong label *visible* without reading the numerals against the notation
  yourself. The rate is diagnostic in itself: 1.9% on BWV 324, a note-against-note
  chorale with a label on every beat; 7.3% on the C major prelude, which is
  arpeggios and little else; 10.6% on the Chopin mazurka; **26.6% on K. 155 ii**,
  the same quartet texture §4.1 measures worst.

Colour is the only channel a notehead has — it cannot change shape without
re-engraving the corpus — so this is the one place the site breaks the rule in §7
that colour is never the sole carrier of meaning. The mitigations are that the
violet is lighter than ink as well as a different hue, so the distinction survives
greyscale; that the legend carries it; and that the hover card remains where the
claim is actually made. Treat the colour as a way of finding these notes at a
glance, not as the statement itself.

### 5.3 Cadences

Where the music *arrives*, marked by a thin magenta bar under the numerals
spanning both chords of the cadence. Resting on it names the cadence, prints the
two chords and the key, draws both on staves whose noteheads play when clicked,
and offers a button that plays the cadence itself. Five types: **perfect
authentic**, **imperfect authentic**, **half**, **deceptive**, **plagal**.

`src/lib/cadence.ts` derives them from `chords[]`, `measures[]` and `notes[]` —
the numeral gives the degree, the figure gives the inversion, the measure grid
gives the metre, and the top sounding note tells a perfect authentic cadence from
an imperfect one. As in §5.2 nothing on disk changes and no model is involved.

Four rules do most of the work, and each is there because its absence produced a
wrong answer:

- **The arrival must be metrically strong** — a downbeat, or the middle of the
  bar. Without it every passing V–I inside a bar of quavers is a cadence.
- **The arrival must be held**, at least as long as the piece's median chord.
  This is the one proxy the data offers for "the phrase stops here", and it is the
  median rather than a fixed number of beats because a chorale changes harmony
  every crotchet and an andante every bar — "longer than usual *here*" is what
  both of them mean by it.
- **Nothing cadences onto a six-four.** A tonic in second inversion is a
  dissonance waiting on the dominant, not a place the music has arrived. Without
  this the C major prelude acquires a cadence in bar 25 that no edition marks.
- **A half cadence is a stop *on* the dominant, so it is one only if the dominant
  does not then resolve.** `I64–V–I` is a cadential six-four whose cadence is the
  second pair; reading the first pair as a half cadence both mislabels it and
  *swallows the real one*, since a chord cannot be the arrival of one cadence and
  the approach to the next. That fault deleted the final cadence of BWV 324 — a
  chorale whose last bar is a plain V–i.

Applied chords take no part, and nothing crosses a change of local key: `V/V–V`
reads as a half cadence to a human and as a modulation to this data, and a cadence
is a claim *within* a key. `Cad64` and `I64` are read identically, because the
model uses them interchangeably and a cadence should not appear or vanish on its
choice of spelling.

**This is not benchmarked, and that is the next thing to do.** §4.1 exists because
`bench.py` scores the numerals against 506 human analyses; there is no equivalent
number here yet. The [Annotated Mozart
Sonatas](https://github.com/DCMLab/mozart_piano_sonatas) carry cadence labels and
53 Mozart and Beethoven sonata works are already in this corpus, so the
measurement is available and simply has not been made. Until it is, read the
counts below as a sanity check rather than an accuracy claim — they are what the
rules find, not what is there:

| piece | cadences | of which |
|---|---:|---|
| BWV 324 (chorale, 9 bars) | 4 | 2 PAC, 2 IAC |
| WTC I/1 prelude (35 bars) | 5 | 2 PAC, 1 IAC, 2 HC |
| Chopin mazurka op. 6 no. 2 (75 bars) | 9 | 2 PAC, 7 IAC |
| Mozart K. 155 ii (50 bars) | 6 | 3 IAC, 3 HC |

**Half cadences are the weakest of the five** and will stay that way until there
is a phrase layer, because "the phrase stops here" is precisely what this cannot
see. They are gated harder than the rest — held half again as long as the median,
and not resolving — and they remain the type to distrust first.

A cadence that falls across a line break draws its half on each system, the way
the ribbon does; the hover card opens beside whichever half the pointer is on.

The bar sits in its own lane 3.3 units above the foot of a system, and that number
is measured rather than chosen. The notation ends 39 units above the foot, the key
marks already overlap the last of it, and what is left below the numeral baseline
is **3.6 units on every system of every piece** — the baseline is fixed and its
largest figure is a known size. The lane is 2.5 of those 3.6, and its pointer
target takes the remaining 6 units up into the numerals' descenders. There is no
room for a third thing down here: a fourth lane means raising `BOTTOM` in
`tools/engrave.py` and re-engraving all 767 works. That is the vertical budget §5
has been spending, and it is now spent.

### One SVG per system

Each system is mounted as a separate element inside a placeholder that reserves its height.
**This is not an optimisation — it is a correctness requirement.** A single SVG spanning a
whole movement reaches 16,000–25,000 px tall; browsers rasterise an element that size as one
GPU texture and silently paint nothing past the limit, so the score renders as a blank page.
(Headless Chromium does not use that path, which is why it does not reproduce there.)

An `IntersectionObserver` (700 px margin) mounts systems as they approach the viewport and
keeps them mounted; system 0 and whichever system holds the playhead are always mounted.

**The playhead never passes through React.** A `requestAnimationFrame` loop writes one CSS
transform on a single element for the whole score; React re-renders only when the playhead
crosses into another system. `Labels` is memoised for the same reason — a few hundred elements
per system reconciled on every frame, on every mounted system, is what a naive implementation
costs. The transport's bar readout is throttled to a quarter-beat, because it is a number that
changes once a bar.

### When the score goes blank

Two unrelated faults have produced the same symptom — home page fine, score page empty — and
neither reproduces in a stock headless browser. Check both:

1. **The layer limit above.** Only ever a problem if something reintroduces a single tall SVG.
2. **An effect returning a non-cleanup.** `useEffect(() => window.scrollTo({ top: 0 }), [id])`
   hands React `scrollTo`'s return value as the effect's cleanup, and React calls it on the next
   navigation. It is `undefined` in a stock browser, so this is invisible — until an extension or
   a browser build wraps `scrollTo` and returns something, and then opening any piece throws
   `l is not a function` out of React's commit phase and unmounts the tree. Braces on every
   effect body, always.

The error boundary in `main.tsx` exists because of these: a blank page says nothing, and both of
these were diagnosed from the message it prints. `Score.tsx` is verified against a browser whose
`scrollTo` returns a value, so fault 2 cannot come back unnoticed.

### What the notation now shows

Everything the source encodes: real staves per part (four for a quartet, not a two-staff
reduction), rests, independent voices, slurs, ties, ornaments, dynamics, text directions and
mid-staff clef changes. The list of simplifications that used to live here is gone — it
described the hand-written renderer, which no longer exists.

Two things are still worth knowing:

- **Playback reads `pieces.json`, not the engraving.** `notes[]` is still the flattened
  two-staff view, so what you hear is a reduction of what you see. They share a beat axis, so
  the playhead stays honest.
- **The playhead is clipped to the score box.** It is a full-width element shifted right by a
  percentage, so at the end of a system its right edge sits at 200% — which the page counts as
  content and lets you scroll to, 383 px of blank paper. A clipping wrapper costs nothing and
  keeps the transform resolution-independent, which is what makes the playhead free to animate.
- **The key the numerals are read in is printed above the ribbon**, in italic, wherever it
  changes — and again at the start of every system, since a reader who scrolls into the middle
  of a movement has not seen the last change. Without it a numeral means nothing: the model
  changes key 3.6 times per piece on average and eleven times in Op. 59 no. 1.
- **`beethoven-opus59no2-movement2` and `cpebach-h186` are quantised** during engraving to make
  them expressible as MusicXML (§5, step 1). Their notation is a hair off their recording in a
  few bars.

---

## 6. Playback (`src/lib/playback.ts`)

A **sampled** grand piano: 30 recordings, one per minor third from A0 to C8, in
`src/assets/piano/` as Opus at 56 kbps mono (~1 MB, inlined as data URLs by the build).
`tools/build_piano.py` regenerates them.

Why sampled and not synthesised. The previous voice used `createPeriodicWave`, which builds a
strictly harmonic spectrum — partial *n* at exactly *n·f₀*. Real piano strings are stiff and
their partials are stretched, *fₙ = n·f₀·√(1 + Bn²)*. That inharmonicity is a large part of
what the ear identifies as a piano, and **no setting of a `PeriodicWave` can express it**. The
filter envelopes and detuning that used to be here were working around a wall.

The source is the Splendid Grand in MuseScore_General (MIT; the piano itself is verified public
domain), rendered note-by-note with fluidsynth. The soundfont renders about 20 dB below full
scale, so `build_piano.py` applies a uniform +18.8 dB — uniform, so the natural loudness
differences between registers survive.

Playback per note is then almost nothing: pick the nearest recording, set `playbackRate` to
shift it by at most a semitone, and apply a damper on key release (80–300 ms, slower in the
bass). The recording carries the strike, the partials and the decay. Two nodes per voice
instead of six.

One `AudioContext` per piece — forced to **48 kHz** to match the pack, since a 44.1 kHz context
resamples every voice for its whole life — with a `DynamicsCompressor` on the master so dense
chords ride rather than clip (measured peak 0.75, no clipped samples, on K. 545).

Notes are scheduled **500 ms ahead on a 50 ms timer** rather than all at once, so a 4,000-note
movement costs the same as a 40-note one. The half second of runway is the important number:
the main thread is not a real-time clock, and on a dense score its 50 ms tick has been measured
stretching past 150 ms. Anything scheduled inside a stall gets clamped to *now* by
`Math.max(now, at)` and arrives late and bunched — which is exactly what "the audio is laggy on
Maple Leaf Rag" was. With 250 ms of runway the fifth-percentile headroom was 93 ms and notes
were landing late; with 500 ms it is over 300 ms and 2 notes in 326 are late, both of them the
first ones after pressing play.

Each voice tears itself down in `onended`. A stopped source is released on its own, but the
gain node it fed stays wired to the master and keeps being summed — at 24 notes a second that
is a graph growing by 1,400 dead nodes a minute.

`player.beat` is derived from `ctx.currentTime`, never from a frame counter, so the playhead
cannot drift from the audio.

### 6.1 Playback settings

Behind the **Playback** button in the transport: tempo, volume and whether the page scrolls to
follow the playhead.

`setTempo` re-anchors the clock (`startBeat`/`startedAt`) so the playhead does not jump; the
half-second already scheduled keeps its old spacing, which is not worth chasing. Volume is
expressed as a percentage of `DEFAULT_GAIN`, the level the pack is tuned to, so 100% means
"as intended" rather than an arbitrary point on a slider.

Note that the engraved score shows the composer's own metronome mark where there is one, which
is not the tempo the app plays at — that comes from the hand-entered `tempo` column in
`build_catalogue.py`. The Chopin mazurka is marked ♩=189 and plays at 138.

`play()` is async: the pack decodes on the first press (~200 ms) and the transport waits.
`starting` and `aborted` keep a double-press or a pause during that window from stacking.

Tempo comes from the `tempo` column in `build_catalogue.py` (quarter-notes per minute).
There is no pedal and no velocity: the corpus carries neither.

---

## 7. Design tokens (`src/index.css`)

Everything is a CSS custom property; there are no hard-coded colours in components.

| Token | Role |
|---|---|
| `--paper`, `--paper-2/3` | Surfaces (cream `#faf7f0`) |
| `--ink`, `--ink-soft`, `--ink-mute` | Text and notation |
| `--rule`, `--rule-strong` | Hairlines and borders |
| `--fn-t / --fn-pd / --fn-d / --fn-x` | Harmonic function: tonic, predominant, dominant, other |
| `--nct` | Non-chord tone (§5.2). Noteheads only, never a ribbon — violet, because the four function hues and the playhead have the rest of the wheel |
| `--cad` | Cadence (§5.3). Its own lane under the numerals, so it is never beside a function colour; magenta keeps it clear of all four regardless |
| `--playhead` | Transport cue only — never used for data |
| `--serif`, `--mono` | Georgia stack; system mono |

The engraving itself is Verovio's, drawn in its own black rather than `--ink`; `.engraved svg`
only sizes it. That is the one place a colour is not a token.

The four function colours were checked with a colour-blindness / contrast validator against the
cream surface (all pairs pass CVD separation, normal-vision separation and 3:1 contrast). A dark
set is declared under `:root[data-theme="dark"]`; no toggle is currently wired up.

**Roman numerals are always drawn in ink, never in the function colour.** The coloured ribbon
sits beneath them. Colour is therefore redundant, and the analysis is fully readable in
greyscale.

`--nct` is the one exception, and it is an exception because a notehead has no other channel:
it cannot change shape without re-engraving the corpus. The violet is 5.4:1 against paper and
3:1 against ink, so it is a *lighter* mark as well as a differently coloured one and the
distinction survives greyscale — and the hover card, not the colour, is where the claim is
made. See §5.2.

---

## 8. Extension points

| Want to… | Do this |
|---|---|
| Add or remove pieces | Add a row to `tools/works.tsv`, then re-run `build_catalogue.py`, `predict_rn.py`, `analyze.py`, `engrave.py` and `validate.py`. All three generators take `--only <ids>` so one new piece costs one piece. |
| Add a composer, or a name the corpus spells differently | A row or an alias in `tools/composers.tsv`, then `reindex.py`. Never a special case in an ingest script: an unknown name is a hard error on purpose. |
| Correct a title, genre or collection | Edit `works.tsv`, re-run `build_catalogue.py`, then `reindex.py --pieces`. No music21 involved. |
| Add a facet | A field on `PieceMeta`, a branch in `options()` and one in `matches()` — both in `src/lib/facets.ts` — a row in `FACETS`, and a test. Give it its own `case` in the `options()` switch: the `default` arm belongs to genre, and a facet that falls through to it silently shows genre's answer under its own heading. |
| Add a whole new source (kern, OpenScore…) | Write an `ingest_<source>.py` that emits catalogue rows — `{id, path, composer, composerId, title, genre, collection, catNo, year, tempo, source, license}` — resolving composers through `composers.py`, and nothing else changes. `../corpus_scaling_research.md` has the survey. |
| Use a different analyser | Write `tools/rn/<id>.json` — `[{on, rn, key, conf}]`, quarter notes from the start, numerals relative to `key` — and re-run `analyze.py`. Nothing downstream knows or cares what produced them. |
| Re-predict after changing the corpus | `python3 tools/predict_rn.py --repo <AugmentedNet checkout>`. Needs `tf-keras` and the 60 MB `AugmentedNet.hdf5`; ~4 min for 30 pieces on CPU. |
| Try a newer model | ChordGNN and RNBert both publish weights and both beat AugmentedNet on the standard benchmark. The swap-in point is `tools/rn/*.json`. |
| Analyse a user's own upload | The current pipeline is offline. A minimal server would be: FastAPI endpoint → the same `analyse()` → the same JSON → the existing front end unchanged. |
| Show confidence | Already shown — it is on the hover card (§5.1). `conf` is per-label in the JSON. |
| Show modulations | Already shown — `Score.tsx` prints the local key above the ribbon wherever it changes. `key` is per-label in the JSON. |
| Add another hover card | `Target` in `Inspector.tsx` is a union of four; add a case and a marker (`data-hover`, or a class the delegated listener recognises) on whatever you want to point at. |
| Measure the cadences | `tools/bench.py` scores numerals; nothing scores cadences yet (§5.3). The ground truth is the cadence column of the Annotated Mozart Sonatas, against the 53 sonata works already in the corpus. Until that number exists the rules in `src/lib/cadence.ts` are tuned on four pieces, which §4.1 has already shown is not a sample. |
| Name the non-chord tones | §5.2 marks them but does not classify them, because passing / neighbour / suspension are claims about one voice and `notes[]` has no voices. The prerequisite is voice separation, not a better rule: either carry the parts through `analyze.py` instead of flattening to two staves, or read them off the engraving, where `engrave.py` already keeps a staff per part. |
| Reflow on resize | Engrave at two or three widths and pick by container width, or ship the Verovio WASM toolkit and lay out in the browser (~9 MB, 0.5–1.5 s per piece). Both measured in `docs/RESEARCH-notation-scores-audio.md`. |
| Measure the analyser | `python3 tools/bench.py`. music21 ships 68 expert RomanText analyses; more of them cover the corpus now that all 413 chorales are in it. See §4.1. |
| Check the corpus | `python3 tools/validate.py`, and `npm run smoke` for the browser. See §4.2. |
| A better piano | More velocity layers, or every semitone rather than every minor third — change `STEP` and re-run `build_piano.py`. Salamander (CC-BY, 16 velocity layers) is the obvious upgrade if size stops mattering. |

---

## 9. Running it

```bash
# build steps (only needed when the corpus changes)
pip install -r tools/requirements.txt
python3 tools/build_catalogue.py      # -> tools/catalogue.json
python3 tools/analyze.py              # -> public/data/{index,pieces/*}.json  (~14 min)
python3 tools/engrave.py              # -> public/data/engraved/*.bin        (~40 min)
python3 tools/validate.py --drop      # -> public/data/rejects.json
python3 tools/build_piano.py          # -> src/assets/piano/*.webm  (needs fluidsynth + ffmpeg)

# the When in Rome half of the corpus (see 4.1.1), from a checkout beside this folder:
#   git clone https://github.com/MarkGotham/When-in-Rome.git ../When-in-Rome
python3 tools/ingest_wir.py --wir ../When-in-Rome \
        --augmentednet ../AugmentedNet-main       # -> tools/catalogue_wir.json  (335 works)
# ...or, if catalogue_wir.json came from someone else's machine, keep its ids and
# only re-point its paths at your checkout:
python3 tools/ingest_wir.py --wir ../When-in-Rome --repath tools/catalogue_wir.json
python3 tools/predict_rn.py --catalogue tools/catalogue_wir.json   # needs the model
python3 tools/analyze.py tools/catalogue_wir.json public/data --merge
python3 tools/engrave.py tools/catalogue_wir.json --merge
python3 tools/validate.py --drop

# the number (see 4.1) — needs no model, only the analyses
python3 tools/bench.py --wir ../When-in-Rome --augmentednet ../AugmentedNet-main \
        --catalogue tools/catalogue.json,tools/catalogue_wir.json

# metadata only — a title, a genre, a composer's name. No music21, no re-parsing.
python3 tools/reindex.py --pieces     # -> public/data/{index.json, pieces/*.json}
python3 tools/reindex.py --dry-run    # say what would change and write nothing

# web app
npm install
npm run dev                           # http://localhost:5173
npm run test                          # 53 assertions over lib/{facets,route,harmony,cadence}.ts
npm run build                         # -> dist/
npm run smoke                         # drives dist/ in a real browser
npm run smoke:single                  # ...and dist/harmonia.html over file://

# no Node on this machine: serve the *already built* dist/ over http
run-harmonia.bat
```

**`run-harmonia.bat` compiles nothing.** It copies `public/data` into `dist/data` and
serves `dist/` with Python, which is the point of it — the site runs with no Node and
no npm. So it shows whatever `dist/assets/*.js` was last built, and a change under
`src/` will not appear until someone runs `npm run build`. If an edit to the front end
seems to have done nothing, this is why. Note also that `vite build` empties `dist/`
first, so `dist/data` goes with it and the `.bat` repopulates it on the next run.

**It serves through `serve.py`, and that is not decoration.** `python -m http.server`
sends `Last-Modified` and no `Cache-Control`, which leaves a browser to decide for
itself how long a file stays fresh; it decides by age, so a copy of `index.html` that
was already old when first cached stays "fresh" for hours. Every other file is
content-hashed and so cannot go stale — but `index.html` is the one whose name never
changes and whose contents name all the others, and the previous build's JavaScript is
still sitting in `dist/assets` under its own hash, still loading perfectly. The result
is a page showing an old build out of files that are every one of them correct, which
is a genuinely hard thing to diagnose from the outside; it cost two rounds of "why is
it not updating" before it was. `serve.py` sends `no-store` for HTML and `no-cache` for
everything else — the second, not the first, because the corpus is 28 MB and
revalidating it with 304s is cheap where re-downloading it is not.

`reindex.py` is the one to reach for after editing `works.tsv` or `composers.tsv`. It reads the
catalogues and the existing index, and writes the metadata; everything score-derived — keyName,
bars, the measure grid — it does not touch. A full `analyze.py` pass for a corrected title is
half an hour of music21 to change one string, and it can churn ids while it is at it.

`--merge` adds a catalogue to the index, or to the engravings, instead of replacing it — which
is what makes the two halves of the corpus independent. It matters most in `engrave.py`: a full
run owns `public/data/engraved/` and clears it first, so that a `.bin` for a piece no longer in
any catalogue cannot sit there forever. Run a partial catalogue through it without `--merge` and
it will do exactly that to the corpus you already had. `analyze.py`, `engrave.py` and `bench.py`
all also take several catalogues comma-separated. The timings are for all 477 music21 catalogue entries on one CPU core. `predict_rn.py` adds ~35 min on
top and is the only step that needs the model. All three generators take `--only <id>,<id>`, so
adding one piece to a corpus of hundreds costs one piece; nothing here re-does work it need not.
The obvious parallelism is across pieces, not within one — the bottleneck is music21's parser,
which is single-threaded Python, and the network itself is 105,084 parameters and 144 ms a pass.
A GPU buys nothing.

`tools/rn/*.json` is checked in, so **`predict_rn.py` is only needed when the corpus changes**.
Everything else builds with `pip install -r tools/requirements.txt` alone — no TensorFlow, no
GPU, no 60 MB of weights. To re-predict, download the AugmentedNet release (source zip plus
`AugmentedNet.hdf5`), unzip it next to this folder, and `pip install tf-keras mlflow`.

All three scripts measure time in quarter notes from the start of the piece, which is the
invariant that lets the ribbon sit on the notation. §4 lists the ways that invariant has been
broken so far and the guard for each; run `validate.py` after touching any of them, and
`bench.py` if you have touched the analysis.

Two things bit during the When in Rome ingest and are now guarded, because both fail loudly in
one place and silently in another:

- **Scores that already contain an analysis.** The DCML-derived Beethoven quartets carry the
  annotator's labels as MusicXML `<harmony>`, in DCML's own syntax (`Eb.I`). music21 10 raises
  `HarmonyException` on those — not a warning, a dead parse, and all 70 quartets failed with it.
  `engrave.strip_harmony_xml()` removes them before music21 sees the file. Worth being explicit
  about the second reason: leaving them in would print a *human* analysis under a staff this site
  labels as machine-predicted, and feed the ground truth to a pipeline being scored against it.
- **`analyze.py` and `engrave.py` loading a score differently.** They parse the same file by two
  separate routes, so any divergence in how it is loaded puts their clocks out of step — the
  fault §4 is entirely about. `analyze.py` now calls the same loader. Both decide corpus-path
  versus file by asking whether the file exists, rather than by looking for a leading `/`, which
  also stops the file branch being unreachable on Windows.

`npm run build` also emits `dist/harmonia.html` — the app, notation and piano in one file you
can open straight from disk with no server. It carries **thirty pieces, not all 767**: a
`file://` page cannot fetch, so `inline.mjs` puts the corpus on `window.__HARMONIA__` instead,
and the browser has to parse all of it before the page appears. `tools/single_file.json` names
the subset — the thirty works the site opened with. Treat this build as the offline sampler it
now is, not as the product.

Five details in `inline.mjs` are load-bearing:

- The corpus script is emitted **before** the bundle, since the bundle reads it on start-up.
- The `composers` block is carried **whole**, not subsetted with the pieces. It is 43 rows and
  4 KB, and the listing needs every one of them to sort, file and label a name — a subset of the
  pieces does not imply a subset of the people.

- The bundle is built as an **IIFE**, not an ES module (`vite.config.ts`). Module scripts carry
  origin rules that classic scripts do not, and none of them help a `file://` page.
- A classic script runs where it sits, so it is appended at the **end of `<body>`** — `#root`
  has to exist by then, and `defer` is ignored on inline scripts.
- `assetsInlineLimit` is raised so the piano samples become data URLs, and the CSS is folded
  into the bundle. `inline.mjs` throws if anything is left external.

### 9.1 What the repository tracks

Version control is rooted one level up, at `AI_Music_Analysis/`, so the research notes are
kept beside the code they argue about. Tracked: `src/` (including `src/assets/piano/`, which
`build_piano.py` can only rebuild with fluidsynth and ffmpeg installed), `tools/` minus its
outputs, the catalogues, the configs, `docs/`, and this file.

Ignored, because each is regenerable by the commands above and together they are ~460 MB --
which is the §1 warning about the engraved payload, enforced:

| Ignored | Rebuilt by |
|---|---|
| `public/data/` (113 MB) | `analyze.py`, `engrave.py`, `validate.py` |
| `tools/_mxl/` (229 MB) | `ingest_wir.py`, from the When in Rome checkout |
| `tools/rn/` (6 MB) | `predict_rn.py` |
| `dist/` (114 MB) | `npm run build` |
| `../When-in-Rome/`, `../AugmentedNet-main/` | `git clone` (see above) |

So a fresh clone is ~10 MB and has no corpus: it needs the build steps in §9, and the model
for `predict_rn.py`, before the app shows anything. Keep `catalogue.json` and
`catalogue_wir.json` tracked -- they carry the piece ids, and regenerating them can churn ids
that the analyses and engravings are keyed by.

---

## 10. Data shape

`public/data/index.json` — the listing, and the only corpus file loaded on arrival. A composer
table, then one entry per piece, and nothing in it that the listing does not draw:

```jsonc
{
  "version": 3,
  "generator": "music21 10.5.0 + AugmentedNet 1.9.0",
  "composers": {
    "bach-js": { "name": "Johann Sebastian Bach", "sort": "Bach, Johann Sebastian",
                 "period": "Baroque", "born": 1685, "died": 1750,
                 "nationality": "German" }, …
  },
  "pieces": [{
    "id": "bach-bwv269",
    "composerId": "bach-js", "title": "Aus meines Herzens Grunde",
    "genre": "Chorale", "collection": "Chorales", "catNo": "BWV 269",
    "year": 1730, "keyName": "G major", "bars": 34,
    "hasAnalysis": true
  }, …]
}
```

`bars` is carried here so the list never has to load `measures`. Everything else is what the
listing needs and nothing more (§1.1): `composerId` points into the `composers` block rather than
repeating a name that is identical on 409 records, and `mode`, `tonic` and the length bucket are
absent because they are one-line functions of `keyName` and `bars`. `source` and `license` are
absent too — they are long, they repeat on every record, and only the analysis page reads them,
so they live in the piece file.

`source` and `license` travel with every **piece file** because the corpus no longer comes from
one place: music21's own
`corpus/license.txt` says its encodings carry mixed terms and that some restrict commercial
use, and the kern and OpenScore material this is heading for is CC BY-NC-SA and CC0
respectively. The analysis page prints them under the score. Attribution is a licence
condition for most of it and good practice for all of it.

That is now load-bearing rather than anticipatory. 335 works come from **When in Rome**
(CC BY-SA 4.0 for its own content) and the scores inside it carry their sources' own terms —
CC0 for the OpenScore Lieder, CC BY-NC-SA for the DCML-derived Beethoven quartets and sonatas.
**The site as it stands therefore contains non-commercial material**, which is a decision about
what this can ever be, not a formality. `corpus_scaling_research.md` §8 flagged it; it has now
happened. If the answer is that the site must stay commercially unencumbered, the quartets and
sonatas have to come out, and `ingest_wir.py` is the one place to do it.

`yearApprox` marks the other honest gap. When in Rome records no composition date anywhere, and
the home page sorts by year, so those 335 works carry a representative year for their composer
rather than for themselves. It is also why **period is a property of the composer** rather than
something derived from a piece's year: all 409 chorales carry one placeholder year too, and a
period read off those would be a guess about a guess. The flag exists so that a placement hint is never mistaken for a
fact; a real per-work date belongs in `works.tsv`, which already overrides.

`public/data/pieces/<id>.json` — the piece in full, fetched when it opens. A superset of its
index entry:

```jsonc
{
    "id": "bach-bwv269",
    "composer": "Johann Sebastian Bach", "composerId": "bach-js",
    "title": "Aus meines Herzens Grunde",
    "genre": "Chorale", "collection": "Chorales", "catNo": "BWV 269",
    "year": 1730, "hasAnalysis": true,
    "keyName": "G major", "bars": 34, "meter": [3, 4], "keySig": 1,
    "clefs": ["treble", "bass"],
    "pickup": 1.0,            // beats before the first full bar
    "tempo": 72,              // quarter-notes per minute
    "measures": [{ "n": 0, "start": 0.0, "len": 1.0 }, …],
    "notes":    [["G4", 0.0, 1.0, 0, 0], …],   // [pitch, onset, duration, staff, tiedToNext]
    "chords":   [{ "on": 0.0, "end": 3.0, "rn": "I", "sup": null, "sub": null,
                   "fn": "T", "conf": 0.96, "key": "G major",
                   "pcs": ["G4", "B4", "D5"],   // the chord spelled out, bass first
                   "dg":  [1, 3, 5] }, …]       // which member each of those is
                  // an applied chord carries its denominator in `sub`: V65/V is
                  // { "rn": "V", "sup": "6", "sub": "5/V" }
    "scales":   { "G major": ["G4", "A4", "B4", "C5", "D5", "E5", "F#5", "G5"] }
}
```

All times are in quarter-note beats from the start of the piece. `staff` is 0 (upper) or 1 (lower).

`public/data/engraved/<id>.bin` — gzip of `{ w, systems: [{ svg, h, from, to, ax }] }`, where
`ax` is the `[beat, x]` anchor list §5 describes. Not JSON on disk and not base64: see §2.
