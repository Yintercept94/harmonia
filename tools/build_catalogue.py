#!/usr/bin/env python3
"""
Builds tools/catalogue.json — the list of works to analyse.

Two halves, for two different reasons:

* **Bach's chorales are generated.** music21 ships 413 of them and a BWV index
  to name them by, so listing them by hand would be 413 rows of typing that a
  loop can do.
* **Everything else comes from tools/works.tsv.** music21's MusicXML carries no
  usable title, opus or date — `work-title` is the filename where it is present
  at all — so there is nothing to derive from. A corpus path that is not in the
  table is *skipped and reported*, never guessed at: a catalogue full of
  "movement2.mxl" would be worse than a smaller one.

Provenance is attached here rather than in analyze.py, because it is a fact
about where a score came from, not about the music. music21's own
`corpus/license.txt` is explicit that its encodings carry mixed terms and that
some of them restrict commercial use, so the site says so per piece.

    python3 tools/build_catalogue.py          # -> tools/catalogue.json
    python3 tools/build_catalogue.py --no-chorales
"""

import argparse
import csv
import json
import os
import re
import sys
from pathlib import Path

from music21 import corpus
from music21.corpus import chorales

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from composers import GENRES, Composers  # noqa: E402

SOURCE = {
    "source": "music21 core corpus",
    "license": "mixed; some encodings are non-commercial (music21 corpus/license.txt)",
}

# Folders with nothing for a harmonic analyser. The ABC collections are
# monophonic folk tunes — a melody has no harmony to label — and demos,
# theoryExercises and leadSheet are fixtures and chord-symbol sheets rather
# than pieces. Renaissance polyphony is not excluded wholesale: the four works
# already on the site stay, but only because works.tsv names them.
SKIP_DIRS = {
    "airdsAirs", "ciconia", "demos", "essenFolksong", "leadSheet", "luca",
    "lusitano", "miscFolk", "nottingham-dataset", "oneills1850", "palestrina",
    "ryansMammoth", "theoryExercises", "trecento", "webern",
}

# music21 ships some works twice, in Humdrum and MusicXML. Both resolve from the
# same extension-less corpus path, so the catalogue simply dedupes on that and
# lets music21 pick; the duplicate is not a second work.
# .abc is here for Josquin: music21's chansons are encoded in ABC, which carries
# polyphony perfectly well. The monophonic ABC folk collections are excluded by
# directory above, not by extension.
PARSEABLE = {".mxl", ".xml", ".musicxml", ".krn", ".abc"}

CHORALE_YEAR = 1730     # the collection, not any one chorale
CHORALE_TEMPO = 72
# The 413 of them are one browsable set, and the most useful single teaching set
# in the corpus. Naming it here is what keeps them out of a 432-row list of
# German incipits under "Bach".
CHORALE_COLLECTION = "Chorales"

BWV_FILE = re.compile(r"^bwv(\d+(?:\.\d+)?)(-.*)?$")


def core_paths() -> list[str]:
    """Every core-corpus file, as a forward-slashed path relative to corpus/."""
    out = []
    for p in corpus.getCorePaths():
        s = str(p).replace(os.sep, "/")
        i = s.rfind("/corpus/")
        out.append(s[i + len("/corpus/"):])
    return sorted(out)


def piece_id(path: str) -> str:
    return path.replace("/", "-").replace("_", "-").lower()


def chorale_entries(paths: list[str], people: Composers) -> list[dict]:
    """Every bach/bwv* file, named from music21's BWV index where it can be."""
    index = chorales.ChoraleListRKBWV().byBWV
    seen, out = set(), []
    for p in paths:
        if not p.startswith("bach/bwv"):
            continue
        stem = os.path.splitext(os.path.basename(p))[0]
        m = BWV_FILE.match(stem)
        if not m or stem in seen:
            continue
        seen.add(stem)
        bwv = m.group(1)
        title = (index.get(bwv) or {}).get("title")
        if not title:
            # The cantata chorales (bwv1.6, bwv40.8 …) are not in the
            # Riemenschneider index, and nothing in the file names them. Say
            # what is true rather than inventing an incipit.
            cantata, _, mvt = bwv.partition(".")
            title = (f"Chorale from Cantata BWV {cantata}, movement {mvt}"
                     if mvt else f"Chorale BWV {bwv}")
        out.append({
            "id": "bach-bwv" + stem[3:].replace(".", "-"),
            "path": f"bach/{stem}",
            "composer": people.by_id["bach-js"].display,
            "composerId": "bach-js",
            "title": title,
            "genre": "Chorale",
            "collection": CHORALE_COLLECTION,
            "catNo": f"BWV {bwv}",
            "year": CHORALE_YEAR,
            "tempo": CHORALE_TEMPO,
            **SOURCE,
        })
    return out


def table_entries(tsv: Path, people: Composers) -> dict[str, dict]:
    rows = {}
    with tsv.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            cells = next(csv.reader([line.rstrip("\n")], delimiter="\t"))
            if len(cells) != 8:
                raise ValueError(f"works.tsv: expected 8 columns, got {len(cells)}: {cells}")
            path, composer, title, genre, collection, cat_no, year, tempo = cells
            if genre not in GENRES:
                raise ValueError(f"works.tsv: {path}: unknown genre {genre!r}. "
                                 f"Pick one of {', '.join(GENRES)}, or widen the "
                                 f"list in composers.py on purpose.")
            # Raises, naming the string, if the table has never heard of them.
            person = people.resolve(composer)
            rows[path] = {
                "id": piece_id(path),
                "path": path,
                "composer": person.display,
                "composerId": person.id,
                "title": title,
                "genre": genre,
                "collection": collection,
                "catNo": cat_no,
                "year": int(year),
                "tempo": int(tempo),
                **SOURCE,
            }
    return rows


def main(out_path: str, want_chorales: bool) -> int:
    people = Composers.load()
    paths = core_paths()
    table = table_entries(Path(__file__).with_name("works.tsv"), people)

    cat = chorale_entries(paths, people) if want_chorales else []
    listed = {e["path"] for e in cat}

    # Everything the corpus offers that is not a chorale, matched against the
    # table by its extension-less path.
    offered, skipped = set(), set()
    for p in paths:
        if p.startswith("bach/"):
            continue
        base, ext = os.path.splitext(p)
        if ext.lower() not in PARSEABLE:
            continue
        # SKIP_DIRS is a default, not a veto: naming a path in works.tsv is a
        # deliberate act and outranks it. That is how the four Renaissance works
        # already on the site survive an exclusion aimed at the other 1,400.
        (skipped if p.split("/")[0] in SKIP_DIRS else offered).add(base)
    offered |= skipped & set(table)

    for path in sorted(offered & set(table)):
        cat.append(table[path])
        listed.add(path)

    missing = sorted(set(table) - offered)
    unlisted = sorted(offered - set(table))
    for path in missing:
        print(f"  !! works.tsv lists {path}, which the corpus does not have", file=sys.stderr)
    if unlisted:
        print(f"  -- {len(unlisted)} corpus work(s) not in works.tsv, skipped: "
              f"{', '.join(unlisted[:6])}{' …' if len(unlisted) > 6 else ''}")

    cat.sort(key=lambda e: (e["year"], e["composer"], e["title"]))
    Path(out_path).write_text(json.dumps(cat, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out_path}: {len(cat)} works "
          f"({sum(1 for e in cat if e['composerId'] == 'bach-js')} Bach, "
          f"{len({e['composerId'] for e in cat})} composers)")
    return 1 if missing else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", nargs="?", default="tools/catalogue.json")
    ap.add_argument("--no-chorales", action="store_true",
                    help="leave the 413 Bach chorales out")
    a = ap.parse_args()
    sys.exit(main(a.out, not a.no_chorales))
