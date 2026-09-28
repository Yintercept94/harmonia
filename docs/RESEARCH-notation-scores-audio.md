# Where Harmonia stands, and three ways forward

August 2026. Everything below was measured in this environment, not quoted from
documentation. Commands and numbers are reproducible.

---

## 0. The short version

| Question | Answer |
|---|---|
| Should we import scores from IMSLP? | **No.** IMSLP is a PDF library. You already have better data than IMSLP would give you — you are throwing it away. |
| Why is the notation non-standard? | Not a renderer problem. `pieces.json` has no rests, no voices, no slurs, no dynamics, because `analyze.py` never wrote them. The source scores have all of it. |
| Best fix for notation? | **Verovio.** Same 30 pieces, no new sources, publication-grade output. Two deployment shapes, both measured below. |
| Why are labels wrong? | Measured against expert analyses: the chord is right ~62–75% of the time, the *numeral* only 28–69%. The gap is almost entirely **missed modulations**. |
| Why doesn't it sound like a piano? | A `PeriodicWave` is mathematically incapable of it — real piano partials are stretched, and a harmonic wavetable cannot be. Two ways out, one of which is a genuine sampled piano at ~1 MB. |

There is also a **bug**: 12 of the 30 pieces have a corrupt measure map (§1.3).

---

## 1. What is actually wrong today

### 1.1 The notation problem is a data problem

`src/data/pieces.json` stores five numbers per note and nothing else. No rests, no
voices, no slurs, no dynamics, no clef changes, no ornaments — so no renderer, however
good, can draw them. The README calls this a deliberate simplification, and it was, but
it is now the binding constraint.

The information is not missing upstream. Parsing the same corpus entry:

```
mozart/k545/movement1_exposition   →  2 parts, 12 rests
beethoven/opus59no1/movement3      →  4 parts: 1st Violin, 2nd Violin, Viola, Cello
```

The quartets are stored as four real parts. The app collapses them to a two-staff
reduction and drops the rests. That is where "weird notation" comes from.

### 1.2 The analysis is wrong more often than the README implies

music21 ships 68 expert Roman-numeral analyses in RomanText format, and **four of them
cover pieces already in your corpus** (BWV 269, BWV 347, BWV 277 via the Riemenschneider
numbering, and Monteverdi madrigal 4.5). No download needed — they are in the pip package.

Scored beat-by-beat against those, searching over time-shifts so that alignment error
cannot be blamed for a low score:

| piece | beats | exact numeral | same pitch-classes |
|---|---:|---:|---:|
| bach-bwv269 | 126 | **69%** | 75% |
| bach-bwv347 | 104 | **28%** | 62% |
| bach-bwv277 | 98 | **10%** | 21% |
| monteverdi-madrigal.4.5 | 814 | **8%** | 12% |

Read the two columns together — that is the whole diagnosis:

- On BWV 347 the analyser picks the **right chord 62% of the time but the right numeral
  only 28%**. It is hearing the harmony and mislabelling it, because it is in the wrong key.
- The human analysis of BWV 347 uses three keys (A 36 labels, E 13, b 7). The app uses one.
- Same story on BWV 277: human uses d (33), a (20), F (5); the app never leaves d minor.
  Global key detection is *correct* on all three — music21 and the annotator agree — so the
  fault is entirely in stage 5, local key tracking. `HOME_BONUS` and `KEY_SWITCH_MARGIN` are
  too sticky.
- Monteverdi at 8% is the expected result and not a defect; the README already says
  Roman numerals on modal repertoire are anachronistic by construction.

**The highest-value analysis fix is not a better chord model. It is modulation tracking.**

### 1.3 Bug: 12 of 30 pieces have a corrupt measure map

Measure starts should be contiguous and increasing. In 12 pieces they are neither:

```
bach-bwv269                       gap  m7@19.0 +3.0  →  m7@21.0     (duplicate bar number)
bach-bwv277                       gap  m4@13.0 +4.0  →  m0@16.0     (bar 0 in the middle)
chopin-mazurka06-2                gap  m8@21.0 +3.0  →  m0@23.0
beethoven-opus59no1-movement3     gap  m14@26.0 +2.0 →  m15@27.625
haydn-opus74no1-movement2         gap  m46@67.5 +1.5 →  m47@68.5
```

Affected: bwv269, bwv347, bwv153-1, bwv6-6, bwv438, bwv277, bwv133-6, monteverdi-madrigal.4.5,
haydn-opus1no1-mvt1, haydn-opus74no1-mvt2, beethoven-opus59no1-mvt3, chopin-mazurka06-2.

Consequences: the "bar N / M" readout is wrong, click-to-seek lands on the wrong bar, and
`locate`/`beatAt` disagree. The shape (repeated bar numbers, bar 0 reappearing mid-piece,
sub-beat gaps) points at repeat expansion and pickup handling in `analyze.py`. **Worth fixing
regardless of which direction you take below** — it is cheap and it corrupts everything downstream.

---

## 2. Notation

### 2.1 IMSLP is the wrong tool

IMSLP's own file-format page: *"PDF is the main type of document used here on IMSLP for
music scores."* It accepts MusicXML and MuseScore files, but only as optional extras
alongside a mandatory PDF, and there is no way to query the library by format. It hosts
no MEI at all. Getting notation out of an IMSLP scan means optical music recognition,
which is a project in itself and would produce data *worse* than what you already have.

### 2.2 What to use instead: what you already have

music21 exports the existing corpus to MusicXML in one call. Measured across all 30:

- 28 of 30 export cleanly. **9.1 MB** total as MusicXML, **8.0 MB** as MEI, **0.72 MB gzipped**.
- Two fail and need attention: `josquin-milleregrets` (write error) and
  `beethoven-opus59no2-movement2` (*"Cannot convert inexpressible durations"* — needs
  quantisation via `makeNotation` before export).

### 2.3 Renderer comparison

| | **Verovio 6.2.0** | **OpenSheetMusicDisplay 2.1.2** | **keep the current renderer** |
|---|---|---|---|
| Licence | LGPL-3.0-or-later | BSD-3-Clause | — |
| Runtime size | 7.0 MB (WASM-in-JS) | 1.3 MB (pure JS) | 0 |
| Input | MEI, MusicXML, Humdrum, ABC, PAE | MusicXML | custom JSON |
| Output | SVG, SMuFL | SVG/canvas via VexFlow | SVG |
| Playback hooks | `renderToTimemap` → `qstamp` + element ids; `getElementsAtTime` | built-in cursor | `locate`/`beatAt` |
| Engraving quality | reference standard | good | reduction |

I rendered your own data through Verovio to check rather than trust the reputation.
`beethoven/opus59no1/movement3` came out with four staves, correct instrument names and
abbreviations, alto clef for the viola, dynamics (`p`, `f`, `sf`), text directions
(*sotto voce*, *morendo*, *cresc.*), hairpins, slurs, ties, trills, rests and correct
beaming. K. 545 came out with its mid-staff treble↔bass clef changes intact and the
`Allegro` tempo mark. Screenshots accompany this document.

The timemap is the part that matters for keeping your app's identity. It returns entries
keyed by **`qstamp` — quarter-note position**, which is the exact axis `chords[]` already
uses. So the Roman-numeral ribbon survives the transplant unchanged: look up the element
at a qstamp, read its `x`, draw the ribbon under it. `locate`/`beatAt` become thin wrappers.

### 2.4 Two deployment shapes, both measured

The single-file constraint is the interesting part. Measured, not estimated:

**(a) Ship Verovio, render in the browser.**
Inlined `verovio-toolkit-wasm.js` + one movement, opened from `file://`:

```
single file           8.2 MB
open → first system   4.0 s     (WASM init 129 ms, MusicXML parse 2020 ms, render 403 ms)
```

With MEI instead of MusicXML the parse drops: 0.02–0.68 s per piece (0.68 s is op. 59 no. 1,
the largest). So ~9 MB total, roughly 0.5–1.5 s to open a piece, and layout still reflows on
resize. Note the licence: **LGPL**, which asks that users be able to relink the library — fine
for personal use, worth a thought if you ever publish it.

**(b) Pre-render at build time, ship no renderer.**
Verovio also runs in Python (`pip install verovio`), so the SVG can be baked in `analyze.py`
alongside the labels. Measured on op. 59 no. 1 mvt 3, the largest movement:

```
render at build time  1.5 s
SVG                   4.5 MB raw / 431 KB gzipped
```

All 30 would be roughly 2.5 MB gzipped, ~3.4 MB as base64, decompressed in the browser with
`DecompressionStream` (supported in Edge/Chrome). That is **smaller than shipping Verovio**,
opens instantly, and keeps your existing per-system lazy mounting — each Verovio system is
already its own `<g>` and can be split out. The cost is that layout is baked at one width and
scales rather than reflows, the way a PDF does.

**Recommendation: (b).** It is smaller, faster, keeps the single-file property comfortably,
and moves the heavy dependency into the offline step where the rest of the analysis already
lives — which is the architectural split the README already argues for. Take (a) only if
reflow-on-resize matters more than open speed.

---

## 3. Better analyses, if you want them

Two independent options, both usable without changing the renderer.

**Ground truth you already have.** The 68 RomanText analyses in music21 give you a
regression test today, for free. Wire the table in §1.2 into `tools/` and every tuning change
gets a number instead of an impression.

**Published corpora**, if you want more coverage:

| corpus | contents | format | licence |
|---|---|---|---|
| [When in Rome](https://github.com/MarkGotham/When-in-Rome) | ~2,000 analyses over ~1,500 works, aligned to scores | RomanText + compressed MusicXML | CC BY-SA 4.0 |
| [DCML ABC](https://github.com/DCMLab/ABC) | all 76 Beethoven quartet movements, ~18,500 labels | MuseScore + TSV | CC BY-NC-**SA**, non-commercial |

When in Rome is the better fit: music21 parses RomanText natively, it ships scores, and the
licence is not non-commercial.

**Better models.** The README's note that AugmentedNet is unreachable is still true — it
pins TensorFlow 2.5. The landscape has moved:

- **RNBert** (ISMIR 2024) is the current best at ~0.574 on Roman numerals, and the author has
  since ported MusicBERT to HuggingFace `transformers` (`musicbert_hf`), so it is PyTorch and
  installable rather than blocked on an old TensorFlow.
- **AnalysisGNN** (2025) does 20+ tasks in one model, scoring 0.530/0.516 on Roman numerals —
  below RNBert on its home corpus, but notably more robust across corpora.

Both are heavier than this project probably wants. Given that your own numbers show the chord
identification is already at 62–75% and the *numerals* are what fail, **fixing modulation
tracking is likely to buy more than swapping in a neural model** — and it is a weekend, not a
research project.

---

## 4. Audio

### 4.1 Why the current voice cannot sound like a piano

The voice uses `createPeriodicWave`, which builds a strictly harmonic spectrum: partial *n*
sits at exactly *n·f₀*. Real piano strings are stiff, and their partials are stretched —
*fₙ = n·f₀·√(1 + Bn²)*. That inharmonicity is a large part of what the ear identifies as
"piano" rather than "organ". **A `PeriodicWave` cannot express it at any setting.** The
filter envelope and detuning I added help, but they cannot fix this.

### 4.2 Option A — a real sampled piano (recommended)

The **Salamander Grand Piano V3** (Alexander Holm, Yamaha C5, 48 kHz/24-bit, 16 velocity
layers, sampled in minor thirds) is **CC-BY 3.0** — usable with attribution. The full set is
1.9 GB, which is not the thing to ship. A subset is:

Measured Opus encoding, 4 s mono:

| bitrate | per note | 30 notes (minor thirds) | 61 notes (every semitone) |
|---|---:|---:|---:|
| 32 kbps | 21.8 KB | **639 KB** | 1.3 MB |
| 48 kbps | 30.9 KB | **904 KB** | 1.8 MB |
| 64 kbps | 38.9 KB | 1.1 MB | 2.3 MB |

So: one velocity layer, minor thirds, 4 s, Opus 48k → **~900 KB**, ~1.2 MB as base64,
decoded with `decodeAudioData` and pitch-shifted up to ±1 semitone by `playbackRate`. Two
velocity layers doubles it and is probably worth it. Add the release/damper samples and it is
still comfortably under 2 MB — the same order as the notation change.

This is what `@tonejs/piano` and Tone.js's `Sampler` do; there is no need to invent the
technique, only to bake the pack offline instead of fetching it from a CDN.

**One caveat:** I could not download the samples from here — this environment allows package
registries but not arbitrary file fetches, and there is no npm package that bundles the audio
(`midi-js-soundfonts` is an empty stub; `smplr` and `@tonejs/piano` stream from a CDN). You
would need to fetch Salamander once, or approve me doing so.

### 4.3 Option B — a physical model, no download

If staying download-free matters more: an `AudioWorklet` running a **digital waveguide** —
Karplus-Strong with a dispersion allpass filter to produce the stretched partials, a hammer
excitation, and a short soundboard impulse response. This is how synthetic pianos are built
without samples, and it would be a clear step up from the current voice. It will not be
mistaken for a recording.

**Recommendation: A.** It is less code than B, sounds unambiguously like a piano, and the
size fits. B is the fallback if the download is unacceptable.

---

## 5. Suggested order

1. **Fix the measure map** (§1.3). Small, self-contained, and everything downstream depends on it.
2. **Pre-render with Verovio at build time** (§2.4b). The big visible win; the analysis pipeline
   and the label ribbon survive intact.
3. **Sampled piano** (§4.2). Independent of 1 and 2, can be done in any order.
4. **Modulation tracking** (§1.2), with the music21 analyses wired up as a regression test so
   the change is measured rather than eyeballed.

1 and 3 are small. 2 is a real rewrite of `Score.tsx` and the `pieces.json` schema. 4 is
tuning work with a scoreboard attached.
