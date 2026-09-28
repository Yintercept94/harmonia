#!/usr/bin/env python3
"""
Harmonia — corpus validator.

Every alignment bug in this project has been one of three clocks drifting from
the others: the analysis (`chords[]`), the notes (`notes[]`), and the engraving
(Verovio's qstamp). None of them announces itself. The ribbon simply sits under
the wrong chord, and the page looks entirely plausible while being wrong.

At thirty pieces you find that by reading the score. At a thousand you do not,
so it has to be a machine check. This script asserts the invariants that the
four known faults broke — repeats played twice, bars split by a repeat sign,
durations MusicXML cannot spell, voices that do not line up — plus the cheap
sanity checks that catch a silent inference failure.

    python3 tools/validate.py                 # check everything, print a report
    python3 tools/validate.py --drop          # ...and remove failures from the index
    python3 tools/validate.py --only <id>,... # check some

Exit status is 1 if anything failed, so it can gate a build.

A failure here is not a disaster and not rare: expect a few per cent on any new
source. The point is that a bad piece leaves the site rather than sitting in it.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from composers import GENRES, Composers  # noqa: E402

# How far the engraving's clock may sit from the analysis's before it counts as
# drift. Under one quarter note is rounding; a whole bar is the repeat bug.
CLOCK_EPS = 1.0

# A piece with no harmony at all, or one label per note, means the analysis did
# not really run. Bach chorales sit near 2 labels/bar, long movements near 1.
MIN_LABELS_PER_BAR = 0.15
MAX_LABELS_PER_BAR = 12.0

# AugmentedNet's softmax over RomanNumeral31. Atonal music sits at 0.50 by
# design (Schoenberg is in the corpus as a control), so this is only a floor
# against inference that fell over entirely.
MIN_MEAN_CONF = 0.25


class Report:
    def __init__(self, pid: str):
        self.pid = pid
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, msg: str):
        self.errors.append(msg)

    def warn(self, msg: str):
        self.warnings.append(msg)

    def check(self, cond: bool, msg: str):
        if not cond:
            self.error(msg)

    @property
    def ok(self) -> bool:
        return not self.errors


def load_engraved(path: Path) -> dict:
    return json.loads(gzip.decompress(path.read_bytes()))


def validate(piece: dict, eng: dict | None, r: Report) -> None:
    measures = piece.get("measures") or []
    notes = piece.get("notes") or []
    chords = piece.get("chords") or []

    # --- the piece is a piece at all ---------------------------------------
    r.check(bool(measures), "no measures")
    r.check(bool(notes), "no notes")
    if not measures or not notes:
        return

    end = measures[-1]["start"] + measures[-1]["len"]
    r.check(end > 0, "score has zero length")

    # --- the measure grid ---------------------------------------------------
    for i, m in enumerate(measures):
        if m["len"] <= 0:
            r.error(f"measure {m['n']} has length {m['len']}")
        if i and m["start"] < measures[i - 1]["start"]:
            r.error(f"measures out of order at {m['n']}")
    # Bars of unequal length are normal — a metre change is music, and a bar
    # split by a repeat sign arrives as two short Measures sharing a number
    # (README §4). So this only looks for lengths no notation explains: a bar
    # under an eighth of the usual one, or over twice it.
    body = measures[1:-1]
    if body:
        common = max({round(m["len"], 4) for m in body}, key=lambda L: sum(
            1 for m in body if abs(m["len"] - L) < 1e-6))
        # Fold repeat-split pairs back together before judging them.
        merged, i = [], 0
        while i < len(body):
            run = body[i]["len"]
            while i + 1 < len(body) and body[i + 1]["n"] == body[i]["n"]:
                i += 1
                run += body[i]["len"]
            merged.append((body[i]["n"], run))
            i += 1
        odd = [n for n, L in merged if L < common / 8 or L > common * 2]
        if odd:
            r.warn(f"{len(odd)} bar(s) far from the usual {common} beats: {odd[:6]}")

    # --- the notes ----------------------------------------------------------
    bad = [n for n in notes if n[1] < -1e-6 or n[2] <= 0 or n[3] not in (0, 1)]
    r.check(not bad, f"{len(bad)} note(s) with a bad onset, duration or staff")
    last_note = max(n[1] + n[2] for n in notes)
    r.check(last_note <= end + CLOCK_EPS,
            f"notes run {last_note - end:.2f} beats past the last bar")

    # --- the analysis -------------------------------------------------------
    r.check(bool(chords), "no chord labels")
    if chords:
        for i, c in enumerate(chords):
            if c["end"] <= c["on"]:
                r.error(f"label {i} ({c['rn']}) ends before it starts")
            if i and c["on"] < chords[i - 1]["on"] - 1e-6:
                r.error(f"labels out of order at {i}")
            if i and c["on"] < chords[i - 1]["end"] - 1e-6:
                r.error(f"labels {i - 1} and {i} overlap")
        r.check(chords[-1]["end"] <= end + CLOCK_EPS,
                f"analysis runs {chords[-1]['end'] - end:.2f} beats past the last bar")

        per_bar = len(chords) / len(measures)
        r.check(MIN_LABELS_PER_BAR <= per_bar <= MAX_LABELS_PER_BAR,
                f"{per_bar:.2f} labels per bar is implausible ({len(chords)} labels, "
                f"{len(measures)} bars)")

        mean_conf = sum(c["conf"] for c in chords) / len(chords)
        r.check(mean_conf >= MIN_MEAN_CONF, f"mean confidence {mean_conf:.2f} — did inference run?")

        # Every label must be drawable: the hover card needs its spelling, and a
        # label whose key has no scale renders an empty staff.
        missing = {c["key"] for c in chords} - set(piece.get("scales") or {})
        r.check(not missing, f"no scale for local key(s): {sorted(missing)[:4]}")

    # --- the engraving ------------------------------------------------------
    if eng is None:
        r.error("no engraving")
        return
    systems = eng.get("systems") or []
    r.check(bool(systems), "engraving has no systems")
    if not systems:
        return

    for i, s in enumerate(systems):
        if s["h"] <= 0:
            r.error(f"system {i} has height {s['h']}")
        if len(s["ax"]) < 2:
            r.error(f"system {i} has {len(s['ax'])} beat->x anchor(s)")
        for j in range(1, len(s["ax"])):
            if s["ax"][j][0] < s["ax"][j - 1][0] - 1e-6 or s["ax"][j][1] < s["ax"][j - 1][1] - 1e-6:
                r.error(f"system {i} anchors are not monotonic at {j}")
                break
        if s["to"] <= s["from"]:
            r.error(f"system {i} spans nothing ({s['from']} -> {s['to']})")
        if i and abs(s["from"] - systems[i - 1]["to"]) > 1e-6:
            r.error(f"gap between systems {i - 1} and {i}: "
                    f"{systems[i - 1]['to']} -> {s['from']}")

    # THE check. Repeats played twice, a bar split by a repeat sign, a duration
    # MusicXML cannot spell — all three land here, as an engraving whose clock
    # has drifted from the analysis's. Everything downstream trusts these two
    # axes to be the same one.
    eng_end = systems[-1]["to"]
    drift = eng_end - end
    r.check(abs(drift) <= CLOCK_EPS,
            f"engraving is {drift:+.2f} beats out against the analysis "
            f"({eng_end:.2f} vs {end:.2f})")


def main(data_dir: str, only: set[str] | None, drop: bool) -> int:
    data = Path(data_dir)
    idx_path = data / "index.json"
    index = json.loads(idx_path.read_text())

    people = Composers.load()
    # The index's own composer block, checked against the table it was built from.
    # §2.1 of docs/DESIGN-home-browse.md is what happens without this: two ingest
    # paths, two spellings of Beethoven, and a by-composer page that lists him
    # twice. A regression here is silent everywhere else.
    for cid in sorted(index.get("composers", {})):
        if cid not in people.by_id:
            print(f"  !! index names composer {cid!r}, which composers.tsv does not",
                  file=sys.stderr)
            return 1

    reports: list[Report] = []
    for meta in index["pieces"]:
        pid = meta["id"]
        if only and pid not in only:
            continue
        r = Report(pid)
        ppath = data / "pieces" / f"{pid}.json"
        if not ppath.exists():
            r.error("index entry has no piece file")
            reports.append(r)
            continue
        piece = json.loads(ppath.read_text())

        # Every piece resolves to a real person and a known genre, or the browse
        # has a row it cannot file.
        if meta.get("composerId") not in people.by_id:
            r.error(f"composerId {meta.get('composerId')!r} is not in composers.tsv")
        if meta.get("genre") and meta["genre"] not in GENRES:
            r.error(f"genre {meta['genre']!r} is not in the vocabulary")

        # The index is a copy of fields in the piece; a stale one shows the wrong
        # bar count on the list page and is invisible until someone counts.
        for k, v in meta.items():
            if k in piece and piece[k] != v:
                r.error(f"index disagrees with piece on {k}: {v!r} vs {piece[k]!r}")
        if piece.get("bars") != len(piece.get("measures") or []):
            r.error(f"bars={piece.get('bars')} but {len(piece.get('measures') or [])} measures")

        epath = data / "engraved" / f"{pid}.bin"
        eng = None
        if epath.exists():
            try:
                eng = load_engraved(epath)
            except Exception as e:
                r.error(f"engraving will not inflate: {type(e).__name__}: {e}")
        validate(piece, eng, r)
        reports.append(r)

    # Files nobody references are how a rebuilt corpus quietly keeps its dead.
    listed = {m["id"] for m in index["pieces"]}
    orphans = sorted(
        {p.stem for p in (data / "pieces").glob("*.json")}
        | {p.stem for p in (data / "engraved").glob("*.bin")}
    ) if not only else []
    orphans = [o for o in orphans if o not in listed]

    failed = [r for r in reports if not r.ok]
    warned = [r for r in reports if r.warnings and r.ok]

    for r in reports:
        for w in r.warnings:
            print(f"  ~~ {r.pid}: {w}")
    for r in failed:
        for e in r.errors:
            print(f"  !! {r.pid}: {e}", file=sys.stderr)
    for o in orphans:
        print(f"  ~~ orphan file with no index entry: {o}")

    print(f"\n{len(reports)} checked · {len(reports) - len(failed)} ok · "
          f"{len(failed)} failed · {len(warned)} with warnings")

    rejects = data / "rejects.json"
    rejects.write_text(json.dumps(
        [{"id": r.pid, "errors": r.errors, "warnings": r.warnings} for r in failed],
        indent=1))
    if failed:
        print(f"wrote {rejects}")

    if drop and failed:
        bad = {r.pid for r in failed}
        index["pieces"] = [m for m in index["pieces"] if m["id"] not in bad]
        idx_path.write_text(json.dumps(index, separators=(",", ":")))
        print(f"dropped {len(bad)} piece(s) from {idx_path}; {len(index['pieces'])} remain")
        return 0

    return 1 if failed else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("data", nargs="?", default="public/data")
    ap.add_argument("--only", help="comma-separated ids")
    ap.add_argument("--drop", action="store_true",
                    help="remove failing pieces from index.json instead of failing the build")
    a = ap.parse_args()
    sys.exit(main(a.data, set(a.only.split(",")) if a.only else None, a.drop))
