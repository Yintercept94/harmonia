"""Turn the When-in-Rome analyses that ship their own score into a catalogue.

    python3 tools/ingest_wir.py --wir ../When-in-Rome --out tools/catalogue_wir.json

335 of the 1,294 analyses have a `score.mxl` in the folder beside them. Those are
the ones that can join the site without a MuseScore or Humdrum toolchain, and they
are the ones worth having: Lieder, quartets, sonatas — the chromatic repertoire the
existing corpus is thinnest on and the model is weakest on.

A catalogue carries absolute paths, so one built on another machine will not resolve
here. Re-point it rather than rebuilding it — rebuilding can change ids, which are
derived from the corpus layout, and the generated `tools/rn/` and
`public/data/pieces/` files are keyed by them:

    python3 tools/ingest_wir.py --wir ../When-in-Rome --repath tools/catalogue_wir.json

The output is an ordinary catalogue, so everything downstream is unchanged:

    predict_rn.py --catalogue tools/catalogue_wir.json --out tools/rn
    analyze.py tools/catalogue_wir.json public/data
    engrave.py tools/catalogue_wir.json
    validate.py --drop

Metadata policy, which is the whole difficulty here. Composer, title and catalogue
string are **derived** — from the RomanText header the analyst wrote and from the
folder path — because 335 hand-kept rows is how `works.tsv` stops being maintainable.
Two fields cannot be derived and are handled explicitly rather than guessed at
silently:

* **Composer.** Taken from the folder tree, which is canonical and surname-first
  ("Bach,_Johann_Sebastian"), and resolved through `tools/composers.tsv`. It is
  emphatically *not* taken from the RomanText `Composer:` header any more: that is
  free text an analyst typed, and it is where "J.S. Bach" beside "Bach", three
  spellings of Schubert and two of Johanna Kinkel came from. A folder naming
  somebody the table has never heard of is an error, not a new composer.
* **Year.** When in Rome records no date, anywhere — not in the analyses, not in the
  contents tables. The home page sorts by year, so a number is needed. `YEARS` below
  gives one representative year per composer and every piece built from it carries
  `yearApprox: true`, so the UI can mark it and nobody later mistakes a placement
  hint for a fact. A per-work date, when someone has one, belongs in `works.tsv` as
  an override — that path already exists and takes precedence.
* **Tempo.** Taken from the RomanText `Tempo:` header when the analyst wrote one,
  otherwise a default per genre. Playback speed is not a claim about the music, so a
  default here is cheap; a wrong year on the home page is not.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wir  # noqa: E402
from composers import Composers  # noqa: E402

# One representative year per composer — enough to place a piece on a timeline and
# in an era, not enough to cite. Everything built from this is flagged approximate.
YEARS = {
    "purcell": 1690, "bach-js": 1730, "haydn": 1785, "mozart": 1785,
    "paradis": 1790, "beethoven": 1805, "zumsteeg": 1815, "reichardt": 1819,
    "schubert": 1823, "kinkel": 1838, "hensel": 1840, "lang": 1840,
    "schumann-r": 1840, "schumann-c": 1843, "chopin": 1843, "franz": 1845,
    "viardot": 1850, "mayer": 1855, "brahms": 1868, "holmes": 1880,
    "jaell": 1880, "chaminade": 1888, "wolf": 1889, "chausson": 1890,
    "mahler": 1892, "white": 1892, "kralik": 1895, "bonis": 1899,
    "coleridge-taylor": 1900, "burleigh": 1917,
}
DEFAULT_YEAR = 1850  # a Romantic song, which is what the unlisted composers write

TEMPI = {"Quartets": 92, "Piano_Sonatas": 100, "OpenScore-LiederCorpus": 76,
         "Keyboard_Other": 84, "Variations_and_Grounds": 88, "Orchestral": 88}

# The top folder already says what kind of piece it is, which is 299 genre labels
# nobody has to type. Keyboard_Other is the one that is not a genre — it holds
# the Well-Tempered Clavier next to Chopin etudes — so it is split below.
GENRE_OF = {"Quartets": "String quartet", "Piano_Sonatas": "Piano sonata",
            "OpenScore-LiederCorpus": "Song", "Variations_and_Grounds": "Variations",
            "Orchestral": "Orchestral", "Keyboard_Other": "Piano piece"}

# Collections whose folder leaf is a movement number, so the set is what remains
# above it and wants naming as the kind of work it is: "Op. 132" alone is not a
# thing you can pick off a list, "String Quartet, Op. 132" is.
SET_PREFIX = {"Quartets": "String Quartet", "Piano_Sonatas": "Piano Sonata"}

LICENSE = ("analysis CC BY-SA 4.0 (When in Rome); "
           "score CC0 (OpenScore) or as marked in the source folder")


def header(analysis: Path) -> dict:
    """The `Key: value` block a RomanText file opens with."""
    out = {}
    for line in analysis.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        if re.match(r"^m\d", line):     # the analysis proper has started
            break
        if ":" in line:
            k, v = line.split(":", 1)
            out[k.strip().lower()] = v.strip()
    return out


# A title the analyst never wrote: the DCML conversions carry their source filename
# in the Title header ("n12op127_01", "K457-1"), which is not a name for a piece.
FILENAME_TITLE = re.compile(r"^[A-Za-z]*\d+[A-Za-z]*([-_ ]?\d+)*$")
GENRE = {"Quartets": "String Quartet", "Piano_Sonatas": "Piano Sonata",
         "Variations_and_Grounds": "Variations"}
ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII"]


def entry(record: dict, people: Composers) -> dict:
    """One catalogue row: what to analyse, and what to call it."""
    head = header(Path(record["path"]))
    work = record["work"]
    parts = [p.replace("_", " ") for p in work.split("/") if p and p != "_"]

    # Folder names zero-pad so they sort ("Op018_No1", "K279"); titles should not.
    parts = [re.sub(r"\bOp0*(\d+)", r"Op. \1", p) for p in parts]
    parts = [re.sub(r"\bNo(\d)", r"No. \1", p) for p in parts]
    parts = [re.sub(r"^K(\d+)", r"K. \1", p) for p in parts]

    # A leaf that is just a number is a movement of the folder above it, not a
    # piece with a name. This is read off the tree alone and never off the header:
    # what the set is called is a fact about the corpus layout, and making it
    # depend on whether an analyst happened to type a Title would give two pieces
    # in the same folder two different collections.
    leaf = parts[-1] if parts else work
    movement = int(leaf) if leaf.isdigit() and len(parts) > 1 else 0

    title = (head.get("title") or "").strip()
    if not title or FILENAME_TITLE.match(title):
        # Nothing usable in the header: build a name from the folders.
        noun = GENRE.get(record["collection"], "")
        if movement:
            title = f"{noun or parts[-2]}, {parts[-2]}".strip(", ")
            title += (f" — {ROMAN[movement]}" if movement < len(ROMAN)
                      else f" — mvt {movement}")
        else:
            title = f"{noun} {leaf}".strip()

    # Either way the set is what sits above the leaf. Where the leaf was a
    # movement number what remains is the work itself — "Op. 132", "K. 279" —
    # which wants naming as the kind of work it is; elsewhere it is already a
    # name: a song's cycle, a prelude's book.
    collection = " · ".join(parts[:-1])
    if movement and collection and (prefix := SET_PREFIX.get(record["collection"])):
        collection = f"{prefix}, {collection}"
    cat_no = head.get("opus", "")

    genre = GENRE_OF.get(record["collection"], "Piano piece")
    if "Well-Tempered" in work:
        genre = "Prelude & fugue"

    # The folder, not the header. See the module docstring.
    person = people.resolve(record["composer"])
    year = YEARS.get(person.id, DEFAULT_YEAR)

    tempo = TEMPI.get(record["collection"], 84)
    if (m := re.search(r"(\d+)", head.get("tempo", ""))):
        tempo = int(m[1])

    return {
        "id": wir.piece_id(record),
        "path": record["ref"],                     # the score.mxl beside the analysis
        "composer": person.display,
        "composerId": person.id,
        "title": title or person.display,
        "genre": genre,
        "collection": collection,
        "catNo": cat_no,
        "year": year,
        "yearApprox": True,
        "tempo": tempo,
        "source": "When in Rome (MarkGotham/When-in-Rome)",
        "license": LICENSE,
        # Carried through so bench.py and the UI can tell ground truth from guesswork,
        # and so a piece the model trained on is never quoted as evidence.
        "analysis": record["path"],
        "split": record["split"],
    }


def repath(catalogue: Path, wir_root: Path) -> int:
    """Point an existing catalogue at this machine's checkout. Returns files missing.

    `path` and `analysis` are absolute, because that is what music21 and the
    RomanText reader want. Absolute paths do not survive being moved between
    machines, and this catalogue is a generated artefact that gets committed and
    shared — so it needs a way to be re-pointed without being rebuilt.

    Rebuilding is not the same thing. Ids are derived from the corpus layout, so a
    checkout at a different commit can rename a folder and hand a piece a new id,
    which then no longer matches the `tools/rn/` and `public/data/pieces/` files
    built against the old one. Rewriting only the two path fields keeps every id,
    title, year and split exactly as they were, and moves nothing else.
    """
    rows = json.loads(catalogue.read_text(encoding="utf-8"))
    missing = 0
    for e in rows:
        for field in ("path", "analysis"):
            tail = e.get(field, "").replace("\\", "/")
            if "Corpus/" not in tail:
                continue
            e[field] = str(wir_root / ("Corpus/" + tail.split("Corpus/", 1)[1]))
        if not Path(e["path"]).exists():
            missing += 1
            if missing <= 5:
                print(f"  missing: {e['path']}")
    catalogue.write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"repointed {len(rows)} entries at {wir_root}")
    print(f"  {len(rows) - missing} scores found, {missing} missing")
    return missing


def main():
    ap = argparse.ArgumentParser(description="When in Rome -> a harmonia catalogue")
    ap.add_argument("--wir", required=True, help="a When-in-Rome checkout")
    ap.add_argument("--augmentednet", help="an AugmentedNet checkout, for the splits")
    ap.add_argument("--out", default="tools/catalogue_wir.json")
    ap.add_argument("--held-out-only", action="store_true",
                    help="drop pieces AugmentedNet trained on")
    ap.add_argument("--repath", metavar="CATALOGUE",
                    help="rewrite an existing catalogue's paths for this machine "
                         "instead of building a new one; keeps every id")
    args = ap.parse_args()

    if args.repath:
        raise SystemExit(1 if repath(Path(args.repath), Path(args.wir).resolve()) else 0)

    records = [r for r in wir.index(args.wir, args.augmentednet) if r["route"] == "local"]
    if args.held_out_only:
        records = [r for r in records if r["split"] == "unseen"]

    people = Composers.load()
    seen, rows = set(), []
    for r in records:
        e = entry(r, people)
        if e["id"] in seen:          # two readings of one work share a folder name
            e["id"] += "-b"
        seen.add(e["id"])
        rows.append(e)

    rows.sort(key=lambda e: (e["year"], e["composer"], e["title"]))
    Path(args.out).write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")

    splits = {}
    for e in rows:
        splits[e["split"]] = splits.get(e["split"], 0) + 1
    print(f"wrote {args.out}: {len(rows)} works")
    print("  splits: " + ", ".join(f"{k} {v}" for k, v in sorted(splits.items())))


if __name__ == "__main__":
    main()
