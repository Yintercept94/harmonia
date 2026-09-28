# Home page redesign — browsing a corpus that outgrew its list

Status: **implemented, 2026-08-19.** Written as a proposal against
`public/data/index.json` as it stood — **767 pieces, 49 composer strings** — and kept as
written; §11 records where the build departed from it.

The home page is a flat list of every piece with a search box over it. That is the
right design at thirty works and an indefensible one at 767: it answers "find the
thing you can already name" and nothing else. Nobody arriving here knows the corpus
holds four Renaissance works, or that 413 of the rows are Bach chorales, or that
half the Lieder come with a human analysis to check the model against. A list cannot
tell you that. A browse structure can.

The model is IMSLP's `Scores →` menu — *Composers*, *Time period*,
*Instrumentation/Genre*, *Nationality* — with search sitting above the categories
rather than replacing them.

---

## 1. Decisions already taken

| | |
|---|---|
| **Filters stack, they do not drill.** | Picking *Romantic* leaves *composer* and *genre* still pickable inside it. IMSLP drills one axis at a time because it is a wiki of category pages; we hold all 767 records in memory, so stacking is free and strictly more capable. |
| **Six facets.** | Composer · period · genre/form · key (mode + tonic) · length · has a human analysis. |
| **Period comes from a per-composer table**, not from the year. | See §2.2. |
| **The data model changes first.** | The UI is easy once the data is honest, and impossible while it is not. |

---

## 2. What blocks this today

None of it is UI work. All five are facts about `public/data/index.json`.

### 2.1 Composer names are not canonical

49 distinct strings for roughly 40 people:

| The same person, twice | Counts |
|---|---|
| `J.S. Bach` / `Bach` | 432 / 1 |
| `Beethoven, Ludwig van` / `L. van Beethoven` | 68 / 13 |
| `Mozart, Wolfgang Amadeus` / `W.A. Mozart` | 44 / 15 |
| `Franz Schubert` / `Schubert` / `Schubert, Franz` | 44 / 1 / 1 |
| `Brahms` / `Johannes Brahms` | 7 / 2 |
| `Haydn` / `Joseph Haydn` | 1 / 9 |
| `S. Coleridge-Taylor` / `Samuel Coleridge-Taylor` | 1 / 1 |
| `Johanna Kinkel  (1846 edition originally published under the name J. Mathieux)` / `Johanna Kinkel (originally published under the name J. Mathieux)` | 1 / 1 |

A by-composer page built on this lists Beethoven twice and splits his 81 works
between the two entries. `surname()` in `Home.tsx` — last word of the field — is a
band-aid over the same wound, and it already mis-sorts `Beethoven, Ludwig van`
(surname "van") against `L. van Beethoven` (surname "Beethoven").

The cause is one line in `tools/ingest_wir.py`:

```python
composer = head.get("composer") or record["composer"]
```

`record["composer"]` is derived from the When-in-Rome folder tree and is already
canonical and surname-first — `Bach, Johann Sebastian`, `Beethoven, Ludwig van`.
`head["composer"]` is whatever the analyst typed at the top of a RomanText file, and
that is where every short form above comes from. The fix is to stop preferring the
free text, and to route both ingest paths through a table (§3.1).

### 2.2 There is no period field, and the year cannot stand in for one

`build_catalogue.py` stamps all 433 Bach entries with `CHORALE_YEAR = 1730` — the
collection, not any one chorale. `ingest_wir.py` fills the entire When-in-Rome half
from `YEARS`, one representative year per composer, and flags every piece
`yearApprox: true`. Year buckets over that data would be buckets over a table of
guesses with a second guess layered on top.

Period is a property of a composer, so it should be stored on one.

### 2.3 `cat` is doing three jobs at once

504 distinct values across 767 pieces, 116 of them empty. It currently holds:

- a **genre** — `chanson`, `song`
- a **collection** — `Winterreise, D.911` (23 pieces), `The Well-Tempered Clavier I` (22), `Dichterliebe, Op.48` (14)
- a **catalogue number**, welded to a genre — `BWV 248.23 · chorale`

Nothing can be filtered on a field like that. Split into `genre`, `collection` and
`catNo` and two of the six facets fall out for free, plus the third browse level
§8 needs.

### 2.4 The index does not carry analysis provenance

`analyze.py`'s `INDEX_FIELDS` is `id, composer, title, cat, year, keyName, bars,
source, license, editor`. The `analysis` and `split` fields that `ingest_wir.py`
writes into the catalogue never reach the browser, so *has a human analysis* — the
one facet no score library can offer — has no field to read. One line.

### 2.5 Bach is 56% of the corpus

432 of 767. "Composer → Bach" is a 432-row alphabetical list of German incipits,
which is the problem we started with, one click deeper. See §8.

---

## 3. The data model

### 3.1 `tools/composers.tsv` — new, the fourth curated file

One row per person, ~40 rows, tab-separated in the manner of `works.tsv`:

```
id          sort                  display              period       born  died  aliases
bach-js     Bach, Johann Sebastian  J.S. Bach          Baroque      1685  1750  Bach|Bach, Johann Sebastian|Johann Sebastian Bach
beethoven   Beethoven, Ludwig van   Ludwig van Beethoven  Classical 1770  1827  L. van Beethoven|Beethoven, Ludwig van
```

- `sort` drives alphabetical ordering and the A–Z rail; `display` is what a page prints. Keeping them apart is what makes *van Beethoven* file under B.
- `aliases` is every string the corpus has ever produced for this person. Resolution is exact match against id or alias — **never fuzzy**. An unresolved name is a hard error that names the string, exactly as `build_catalogue.py` today reports a corpus path missing from `works.tsv` rather than guessing at it. That policy is the reason the catalogue is trustworthy; it should extend, not be relaxed.
- `period` is a judgement, and putting it in a reviewable table is the point. Late Beethoven is arguable; the argument then happens in a diff.

Both ingest paths resolve through it: `build_catalogue.py` for the music21 half,
`ingest_wir.py` for the When-in-Rome half, `header()`'s composer string demoted to
an alias lookup.

### 3.2 `works.tsv` gains two columns

`path, composer, title, cat, year, tempo` → `path, composer, title, genre,
collection, catNo, year, tempo`. 74 rows to migrate, mostly mechanical: `Winterreise,
D.911` moves from `cat` to `collection`, `Op. 3 no. 1, i` splits into `collection`
and `catNo`.

### 3.3 The When-in-Rome half derives its genre

`wir.py` already records `collection` per piece — `Quartets`, `Piano_Sonatas`,
`OpenScore-LiederCorpus`, `Keyboard_Other`, `Variations_and_Grounds`, `Orchestral`.
`ingest_wir.py` uses it for tempo defaults and titles and then throws it away. Map it
to a genre and the 299-piece half is faceted with no hand curation at all.

### 3.4 The chorales name themselves

`chorale_entries()` gets `genre="chorale"`, `collection="Chorales"`, `catNo="BWV n"`,
which is a three-line change and removes the `·`-joined string it builds today.

### 3.5 `PieceMeta` — what the browser receives

Added: `composerId`, `period`, `genre`, `collection?`, `catNo?`, `hasAnalysis`.

**Not** added, because a pure function is cheaper than a field:

- `mode` and `tonic` — `keyName` is `"Bb major"` / `"f# minor"` across all 24 values, so both parse in one line at load.
- the length bucket — a comparison against `bars`.

**Index size.** Six new fields would push `index.json` past 300 KB. But `composer`
is a string repeated up to 432 times; replacing it with a short `composerId` and
emitting a `composers` dictionary in the index header pays for the additions and
then some. Expect ~200 KB, i.e. slightly smaller than today, with the composer
table — sort names, dates, periods — arriving for free as part of it.

### 3.6 Facet vocabulary the data supports today

| Facet | Values | Notes |
|---|---|---|
| Period | Renaissance · Baroque · Classical · Romantic · Modern | 5 buckets over 1520–1917 |
| Key — mode | major (474 pieces, 12 keys) · minor (293, 12) | |
| Key — tonic | 13 spelled tonics | Keep the spelling the analysis uses — `Eb minor` and `D# minor` are not the same claim about the music |
| Length | ≤32 bars (483) · 33–64 (105) · 65–128 (81) · 129+ (98) | median is 20 bars — the corpus is chorale-shaped, so the buckets have to be bottom-heavy or the first one swallows everything |
| Analysis | has a human analysis · model only | |

---

## 4. Filter semantics

State is one object, and it is the URL (§6):

```ts
interface Filters {
  q: string;
  composer: string[];  period: string[];  genre: string[];
  mode: string[];      tonic: string[];   length: string[];
  hasAnalysis: boolean;
  sort: "alpha" | "date" | "composer";
}
```

Four rules, and the third is the one that is easy to get wrong:

1. **Within a facet, OR. Across facets, AND.** *Baroque or Classical*, **and** *minor*. This is what every faceted search does and what people expect without being told.
2. **The query applies last**, over the already-filtered set. That is "the search bar always searches under the current selection".
3. **Each facet's counts are computed against the other facets' filters, not its own.** Selecting *Romantic* must update the composer counts but must not collapse the period list to a single row — otherwise you can never widen a selection without clearing it. Concretely: `countsFor(facet)` applies `Filters` with `facet` omitted.
4. **Options that reach zero are disabled, not hidden.** A vanishing list makes the corpus look smaller than it is, and the empty row is information: it says *we have no Renaissance piano sonatas*, which is true and worth knowing.

Sort defaults to alphabetical inside a selection, with the existing date and
composer toggles kept.

---

## 5. Layout

One component, three states:

**Rest** — nothing selected. Title and totals, the search box, six facet cards each
showing its top values with counts and a "see all", and a short *start here* strip of
four or five pieces. Five buttons and a search box is a cold front door when nobody
knows what is behind it; the strip gives the page a floor.

**Facet open** — one facet's values in full, with counts. Composer gets an A–Z rail,
since ~40 entries today is 200 later.

**Filtered** — the active selections as removable chips on one line, the count, then
the piece list. The chips are the breadcrumb and the undo, and they are what make a
stacked filter comprehensible: at any moment the screen states, in words, exactly
what it is showing.

Search stays in the same place in all three, with its placeholder naming the scope —
`Search within Schumann · Romantic` — and never resets a selection.

On mobile the facets are a sheet; the chips and the list stay.

---

## 6. Routing — do it now, not later

`App.tsx` holds the open piece in `useState` with no history entry. Today that costs
one broken back button. With a browse hierarchy on top it means: back leaves the
site from three levels in, no view is linkable, and nobody can send anyone "all the
minor-key Lieder with a human analysis".

Hash routing, ~40 lines, no dependency:

```
#/                                        rest
#/browse/composer                         facet open
#/?composer=schumann-r&mode=minor         filtered
#/piece/bach-bwv253                       analysis
```

The filter object serialises to the query string, which means the URL *is* the state
— no second source of truth, and a bug report can be a link. Do this as its own
change, before the Home rewrite: it is independently shippable and independently
verifiable.

---

## 7. Component structure

`Home.tsx` is 130 lines and does search, sort, paging and rendering. Splitting it
along the seam that already exists:

| File | Responsibility |
|---|---|
| `src/lib/facets.ts` | **Pure.** `buildFacets(pieces)`, `applyFilters(pieces, f)`, `countsFor(pieces, f, facet)`, `parseKey(keyName)`, `lengthBucket(bars)`. No React. |
| `src/lib/route.ts` | Hash ↔ `{ view, id, filters }`. Also pure. |
| `src/components/Home.tsx` | State, and which of the three §5 states to show. |
| `src/components/Facets.tsx` | The cards, the open panel, the A–Z rail. |
| `src/components/Chips.tsx` | Active selections, removable. |
| `src/components/PieceList.tsx` | The existing rows and the `IntersectionObserver` pager, unchanged. |

`facets.ts` and `route.ts` being pure matters beyond tidiness: nothing in `src/` is
currently testable without a browser, and `tools/smoke.mjs` drives a real one to
check that notation painted. Filter arithmetic is exactly the kind of thing that
should be checked by an assertion instead.

---

## 8. Bach

413 chorales plus 19 other works is 56% of the corpus, and it distorts every facet:
*Baroque* is 97% chorales, *≤32 bars* is 90% chorales, and *composer → Bach* is the
old flat list with a click in front of it.

Two things fix it, and both are worth doing anyway:

- **`collection` as a third level.** Bach opens on *Chorales* (413) · *The Well-Tempered Clavier I* (22) · *Mass in B minor* (1) · … rather than on 432 incipits. Schubert opens on *Winterreise* (23) · *Schwanengesang* (14) · *Die schöne Müllerin* (4). This is the level IMSLP does not have and a corpus organised by opus badly needs.
- **The chorales get their own front-door entry.** They are the most useful single teaching set here — 413 four-part harmonisations with labels — and burying them two clicks inside *Bach* undersells the site. A card on the rest state, beside the six facets.

---

## 9. Staging

Six changes, each shippable on its own, in this order:

1. **`composers.tsv` + resolution.** Both ingest paths, hard error on an unknown name, `composerId` into the catalogues. Verification: distinct composers falls 49 → ~40 and no piece id changes (piece ids derive from corpus paths, not composer strings, so this is safe — but assert it).
2. **`cat` → `genre` / `collection` / `catNo`.** `works.tsv` migration, the WiR genre map, the chorale fields.
3. **`INDEX_FIELDS` + the index header dictionary.** Regenerate. Note this needs only a rewrite of `index.json` from the catalogues, not a full `analyze.py` pass over 767 scores.
4. **Hash routing.** No visual change; back button starts working.
5. **`lib/facets.ts` with assertions, then the new Home.**
6. **README** §1 page table and §3 file map; `validate.py` gains an assert that every piece resolves to a known composer id, so the next ingest cannot quietly reintroduce §2.1.

---

## 10. Open questions

- **Nationality.** IMSLP has it and it is cheap once `composers.tsv` exists, but the corpus is overwhelmingly German-speaking, so the facet would be one large bucket and a tail. Add the column, hold the facet.
- **The *start here* strip** — curated by hand, or the pieces the model is most confident on, or genuinely random each visit?
- **Analytical facets later.** Modulation count, chromatic density, mean label confidence. These are the facets that would make this a place to browse rather than a place to look things up, and none of them exist anywhere else. They need a per-piece summary in the index, which is §3.5 again with different numbers.


---

## 11. As built

Six things came out differently, and all six are worth writing down.

1. **The whole-corpus list is `#/?all=1`, not `#/list`.** A path segment cannot ride along on a
   piece URL, so opening a piece out of the full list and pressing Back landed on the front door
   instead of the list. As a query parameter it survives every navigation. `#/list` is still
   accepted as a shorthand nobody has to remember.

2. **`hasAnalysis` could not be answered from a catalogue.** §2.4 assumed the `analysis` field
   was the whole story; it is not. Only the 299 When in Rome pieces that ship a score beside
   their analysis carry it. Another 349 reach a human analysis through music21's corpus, and the
   catalogue row says nothing. The real count is **648 of 767**, and the source is
   `tools/bench_results.json` — the record of every piece a route was resolved for and a
   comparison actually made — read through the new `wir.scored_ids()`. Sourced from the
   catalogue alone the facet would have under-counted by more than half.

3. **The index came out smaller than predicted.** §3.5 guessed ~200 KB against 219 KB before.
   Dropping `source` and `license` as well — two long strings on all 767 records that only the
   analysis page ever reads, and it loads the piece file — took it to **184 KB from 244 KB**,
   with six new fields in it.

4. **`catNo` is empty across the whole When in Rome half.** The old code fell back to the
   RomanText `Opus:` header for it; a pass over all 335 found not one file that carries one. The
   field is there and correct, it simply has nothing to say about that half yet.

5. **`entry()` in `ingest_wir.py` was simplified rather than extended.** What a collection is
   called used to depend on whether the analyst had typed a `Title:` — the movement-stripping
   branch was inside that test — which gave two pieces in the same folder two different
   collections. It is now read off the folder tree alone, which is both correct and what made
   the migration derivable without re-walking the corpus.

6. **`tools/reindex.py` grew `--pieces` and `--only`.** The index rewrite never opens a piece
   file — everything it needs from the score is already in the old index — so the slow half is
   opt-in and chunkable. That split was not in §9 and should have been.

Nationality is in `composers.tsv` as §10 suggested, with no facet built on it. The genre
vocabulary settled at twelve values, in `composers.py`.


---

## 12. Second pass — the browse became a listing

The §11 build was IMSLP's shape faithfully: six facet cards on the front door, each
opening its own page at `#/browse/<facet>`. It read well and was tiring to use, and
the reason is in §1 of this document — *filters stack, they do not drill* was decided
for the **filtering**, and then the **navigation** was left drilling anyway. Every
filter cost a page out and a Back in, so combining two was a chore and combining three
was not worth it. The capability was there and the interface hid it behind travel.

What changed:

- **The home page is the listing.** The facet cards, the "start anywhere" strip and
  the `#/?all=1` view are gone. `#/` is the pieces.
- **All six facets live behind one `Filters` button**, in one inline panel, all
  expandable in place. `#/browse/<facet>` is deleted. Nothing about choosing a filter
  navigates any more.
- **Collection stops being a facet and becomes structure.** The listing folds its 102
  collections into folders — 767 rows to 116 — and a folder expands in place. A
  collection of one is left as a piece row; 38 of them qualify, and a folder you open
  to find one piece is a click that says nothing. Inside a folder, a title has its
  collection's name stripped off the front.
- **Which folders are open lives in the URL**, so Back closes one and returning from a
  piece does not close them all.
- **Typing unfolds the list.** Searching is hunting for a piece, not browsing a shelf.

### The bug that prompted it

Collections "didn't work", and the cause was not the facet. `route.ts` joined multiple
values with a comma and split them back on one. **83 of the 102 collection names
contain a comma** — `Winterreise, D.911`, `String Quartet, Op. 18 no. 1` — so a single
value round-tripped as two values that matched nothing and the list came back empty.
`Chorales` has no comma, which is why it worked and made the failure look random.

Multi-value params now repeat the key, `?composer=a&composer=b`, which has no reserved
character to trip over. There is a regression test with a comma in it.

A second bug went out in the same code and was caught by the browser pass: the `switch`
in `options()` had no `case "genre"`, so genre fell through to a `default` arm that
returned the **mode** list, and the Genre group rendered "major 0 / minor 0" under its
own heading. Both facets were individually correct; only the pairing was wrong, which
is exactly the kind of fault that survives a reading and dies to an assertion. There is
now a test that each facet returns its own values, and `default` belongs to genre.

### What §11's fourth point should have said

`hasAnalysis` was not the only field the catalogue could not answer alone, and the
lesson generalises: a field that is *about* the corpus rather than *in* it needs a
source that has seen the whole corpus. Collection membership is the same shape of
question, and it is why folding happens at read time in `facets.ts` from the field
every piece already carries, rather than being precomputed into the index.
