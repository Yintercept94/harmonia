#!/usr/bin/env python3
"""
Rebuild public/data/index.json — and the metadata half of every piece file —
from the catalogues, without re-parsing a single score.

analyze.py owns both files, but most of what it does is music21 work: parse the
score, build the measure grid, read the labels back. None of that changes when a
title is corrected, a genre assigned or a composer's name normalised. Running
767 scores through music21 for a metadata edit costs half an hour and risks
churning ids for no reason, so metadata-only changes come through here.

    python3 tools/reindex.py                       # rewrite index.json
    python3 tools/reindex.py --pieces              # ...and the piece files with it
    python3 tools/reindex.py --pieces --only a,b   # ...some of them
    python3 tools/reindex.py --dry-run             # say what would change

The index is rewritten from the old index plus the catalogues and never opens a
piece file, because the fields it needs from the score — keyName, bars — are
already in it. `--pieces` is the second, slower half: the same metadata written
into public/data/pieces/*.json, which matters because validate.py checks the two
agree. `--only` exists so that pass can be run in chunks over a slow disk.

What is taken from where, and why:

* **The catalogues** own id, composer, title, genre, collection, catNo, year and
  provenance. They are the curation.
* **The existing piece files** own keyName, bars, meter, notes, chords — anything
  read off the score. This script never touches those.
* **composers.tsv** owns the display name, sort name and period, and is what
  `composerId` points into.

An index entry with no catalogue row is reported and kept as it was: it is
usually a piece dropped from a catalogue but not yet from the site, and losing
its row silently would be worse than saying so.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wir  # noqa: E402
from composers import Composers  # noqa: E402

# Set by the catalogue, cleared when the catalogue does not say. The rest of a
# piece file is score-derived and is left exactly alone.
FROM_CATALOGUE = ("composer", "composerId", "title", "genre", "collection",
                  "catNo", "year", "tempo", "source", "license", "editor")

INDEX_FIELDS = ("id", "composerId", "title", "genre", "collection", "catNo",
                "year", "keyName", "bars", "hasAnalysis")


def catalogue(paths: list[str], people: Composers) -> dict[str, dict]:
    """Every catalogue row by id, with its composer and its analysis resolved."""
    scored = wir.scored_ids()
    rows = {}
    for p in paths:
        for e in json.loads(Path(p).read_text(encoding="utf-8")):
            # Older catalogues predate composerId; resolve the name instead.
            e["composerId"] = e.get("composerId") or people.resolve(e["composer"]).id
            e["composer"] = people.by_id[e["composerId"]].display
            # Either the analysis ships beside the score, or bench.py found one
            # by another route. See wir.scored_ids.
            e["hasAnalysis"] = bool(e.get("analysis")) or e["id"] in scored
            rows[e["id"]] = e
    return rows


def apply_row(rec: dict, row: dict) -> dict:
    """The catalogue's half of a record, over whatever the score contributed."""
    out = dict(rec)
    for k in FROM_CATALOGUE:
        if row.get(k) not in (None, ""):
            out[k] = row[k]
        else:
            out.pop(k, None)
    out["hasAnalysis"] = row["hasAnalysis"]
    out.pop("cat", None)            # split into genre / collection / catNo
    return out


def main(data_dir: str, catalogues: list[str], dry: bool, pieces: bool,
         only: set[str] | None) -> int:
    people = Composers.load()
    data = Path(data_dir)
    idx_path = data / "index.json"
    index = json.loads(idx_path.read_text(encoding="utf-8"))
    cat = catalogue(catalogues, people)

    fresh, missing, touched = [], [], 0
    for meta in index["pieces"]:
        pid = meta["id"]
        row = cat.get(pid)
        if row is None:
            missing.append(pid)
            fresh.append(meta)
            continue
        entry = apply_row(meta, row)
        fresh.append({k: entry[k] for k in INDEX_FIELDS if k in entry})

        ppath = data / "pieces" / f"{pid}.json"
        if not pieces or (only and pid not in only) or not ppath.exists():
            continue
        piece = json.loads(ppath.read_text(encoding="utf-8"))
        before = json.dumps(piece, sort_keys=True)
        piece = apply_row(piece, row)
        if json.dumps(piece, sort_keys=True) != before:
            touched += 1
            if not dry:
                ppath.write_text(json.dumps(piece, separators=(",", ":")),
                                 encoding="utf-8")

    fresh.sort(key=lambda e: (e["year"],
                              people.by_id[e["composerId"]].sort if e.get("composerId") else "",
                              e["title"]))
    out = {"version": 3,
           "generator": index.get("generator", "reindex.py"),
           "composers": people.index_dict(),
           "pieces": fresh}
    if not dry:
        idx_path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")

    print(f"{'would rewrite' if dry else 'wrote'} {idx_path}: {len(fresh)} pieces, "
          f"{len({e['composerId'] for e in fresh if e.get('composerId')})} composers, "
          f"{touched} piece files updated")
    if missing:
        print(f"  !! {len(missing)} index entries have no catalogue row, left as they "
              f"were: {', '.join(missing[:6])}{' …' if len(missing) > 6 else ''}",
              file=sys.stderr)
    return 1 if missing else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default="public/data")
    ap.add_argument("--catalogue", action="append", default=None,
                    help="repeatable; defaults to both catalogues")
    ap.add_argument("--pieces", action="store_true",
                    help="also write the metadata into public/data/pieces/*.json")
    ap.add_argument("--only", help="with --pieces: comma-separated ids, for chunking")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    sys.exit(main(a.data, a.catalogue or ["tools/catalogue.json",
                                          "tools/catalogue_wir.json"], a.dry_run,
                  a.pieces, set(a.only.split(",")) if a.only else None))
