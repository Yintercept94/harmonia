"""Scores the corpus against human analyses.

    python3 tools/bench.py                      # whatever ground truth is available
    python3 tools/bench.py --wir ../When-in-Rome --augmentednet ../AugmentedNet-main

Two columns, and the gap between them is the diagnosis:

  exact       the same Roman numeral the annotator wrote
  chord       the same pitch classes, whatever the numeral says

A high chord score with a low exact score means the harmony is being heard and
mislabelled — which is what a wrong local key does.

This used to compare four pieces, because four of the 68 RomanText analyses music21
bundles cover pieces in this corpus. Four is an anecdote. With a When in Rome
checkout it compares several hundred, which is a measurement.

**The split column is not decoration.** AugmentedNet was trained on When in Rome, so
275 of these analyses are pieces the model has already been shown — 191 of them in
the training split. Scoring against those measures recall, not analysis. Every table
below is broken out by split and the headline number is `unseen` only. A benchmark
that pooled them would read high and mean nothing.

Alignment is by bar and beat, not by raw offset. A RomanText file carries its own
time signatures, and when they disagree with the score's the two timelines drift
apart: a RomanText bar can end up somewhere quite different from the score's bar of
the same number. Comparing offsets there scored a correct analysis at 15%. The piece
data already ships the bar grid, so the annotator's "m41 b3" is placed on the score's
own clock instead.
"""
import argparse
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import music21
from music21 import converter, key as m21key, roman

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wir  # noqa: E402

M21_CORPUS = Path(os.path.dirname(music21.__file__)) / "corpus"
STEP = 0.5  # sample every eighth note

# The four analyses music21 ships that cover pieces here. Kept so the benchmark
# still runs, and still means the same thing, with no corpus checked out.
M21_PAIRS = [
    ("bach-bwv269", "bach/choraleAnalyses/riemenschneider001.rntxt"),
    ("bach-bwv347", "bach/choraleAnalyses/riemenschneider002.rntxt"),
    ("bach-bwv277", "bach/choraleAnalyses/riemenschneider015.rntxt"),
    ("monteverdi-madrigal.5.8", "monteverdi/madrigal.5.8.rntxt"),
]

ERAS = [(0, 1600, "Renaissance"), (1600, 1750, "Baroque"), (1750, 1820, "Classical"),
        (1820, 1900, "Romantic"), (1900, 9999, "Modern")]


def era_of(year):
    return next((n for lo, hi, n in ERAS if year and lo <= year < hi), "unknown")


# --- scoring ----------------------------------------------------------------

def figure(c: dict) -> str:
    """The chord as the app shows it, back in one string music21 can read."""
    f = c["rn"] + (c["sup"] or "") + (c["sub"] or "")
    if c.get("of"):
        f += "/" + c["of"]
    return f


def normalise(f: str) -> str:
    # music21 writes a third-inversion seventh as "2"; the app stacks it 4 over 2.
    return f.replace("42", "2")


def pitches(f: str, keyname: str):
    k = keyname.split()[0] if " " in keyname else keyname
    try:
        return frozenset(roman.RomanNumeral(f, m21key.Key(k)).pitchClasses)
    except Exception:
        return None


def clock(piece: dict):
    """bar number, beat -> quarter-note offset, using the score's own bar grid.

    A pickup holds the *last* beats of its bar, so its beat numbers are offset by
    however much of the bar is missing.
    """
    bar = 4.0 * piece["meter"][0] / piece["meter"][1]   # a full bar, in quarters
    beat_ql = 4.0 / piece["meter"][1]
    grid = {}
    for m in piece["measures"]:
        grid.setdefault(m["n"], m)   # a bar split by a repeat sign appears twice

    lead = bar - piece["measures"][0]["len"] if piece["measures"] else 0.0

    def at(measure: int, beat: float):
        m = grid.get(measure)
        if m is None:
            return None
        # Only the upbeat's own beats are displaced; every later bar starts on
        # its beat 1 wherever the grid says it does.
        off = lead if m is piece["measures"][0] else 0.0
        return m["start"] + (beat - 1) * beat_ql - off

    return at


def score(piece: dict, rntxt):
    """(sampled beats, exact matches, same-chord matches) for one piece."""
    sc = converter.parse(str(rntxt), format="romanText")
    at = clock(piece)
    human = []
    for rn in sc.recurse().getElementsByClass("RomanNumeral"):
        t = at(rn.measureNumber, float(rn.beat))
        if t is not None:
            human.append((t, rn))
    human.sort(key=lambda h: h[0])
    if not human or not piece["chords"]:
        return None
    end = max(c["end"] for c in piece["chords"])

    n = exact = chord = 0
    t = 0.0
    while t < end:
        h = None
        for a_t, rn in human:
            if a_t <= t + 1e-6:
                h = rn
            else:
                break
        a = next((c for c in piece["chords"] if c["on"] - 1e-6 <= t < c["end"] - 1e-6), None)
        if h is not None and a is not None:
            n += 1
            f = figure(a)
            if normalise(h.figure) == normalise(f):
                exact += 1
            ap = pitches(f, a["key"])
            if ap is not None and frozenset(h.pitchClasses) == ap:
                chord += 1
        t += STEP
    return n, exact, chord


# --- where the pieces live --------------------------------------------------

def load_piece(data: Path, pid: str):
    """One piece, from the per-piece files or from the old single blob."""
    per_piece = data / "pieces" / f"{pid}.json"
    if per_piece.exists():
        return json.loads(per_piece.read_text(encoding="utf-8"))
    legacy = data.parent.parent / "src" / "data" / "pieces.json"
    if legacy.exists():
        for p in json.loads(legacy.read_text(encoding="utf-8"))["pieces"]:
            if p["id"] == pid:
                return p
    return None


def pairs_from_wir(wir_root, augmentednet_root, catalogue, live=None):
    """(piece id, rntxt path, metadata) for every analysis we can actually score.

    Two routes reach a piece that exists on the site: the analysis points at a
    music21 corpus path already ingested, or it ships its own score and was ingested
    under a `wir-` id. Everything else — MuseScore sources, kern, dead pointers — is
    a different project, and is skipped rather than counted as a failure.

    `live` is the set of ids in `index.json`, and pairs outside it are dropped. The
    catalogue is what was *offered* to the pipeline; the index is what survived
    `validate.py --drop`. Scoring the difference would credit the site for a piece it
    refuses to serve — which is the one direction a benchmark must never be wrong in.
    """
    by_path = {e["path"].lower(): e for e in catalogue}
    out = []
    for r in wir.index(wir_root, augmentednet_root):
        if r["route"] == "music21":
            entry = by_path.get((r["ref"] or "").lower())
            pid = entry["id"] if entry else None
            year = entry.get("year") if entry else None
        elif r["route"] == "local":
            pid, year = wir.piece_id(r), None
        else:
            continue
        if pid and (live is None or pid in live):
            out.append((pid, r["path"], {"split": r["split"], "route": r["route"],
                                         "collection": r["collection"],
                                         "composer": r["composer"], "year": year}))
    return out


def _run(job):
    pid, rntxt, meta, data = job
    piece = load_piece(Path(data), pid)
    if piece is None:
        return pid, meta, None
    try:
        return pid, meta, score(piece, rntxt)
    except Exception as e:          # a broken analysis is a datum, not a crash
        return pid, meta, ("error", f"{type(e).__name__}: {e}"[:140])


# --- reporting --------------------------------------------------------------

def table(title, rows):
    """rows: {label: [beats, exact, chord, pieces]} — widest sample first."""
    rows = {k: v for k, v in rows.items() if v[0]}
    if not rows:
        return []
    out = [f"\n{title}", f"{'':<26}{'pieces':>8}{'beats':>10}{'exact':>8}{'chord':>8}"]
    for label, (n, e, c, k) in sorted(rows.items(), key=lambda kv: -kv[1][0]):
        out.append(f"{label:<26}{k:>8}{n:>10,}{e / n * 100:>7.0f}%{c / n * 100:>7.0f}%")
    return out


def main():
    ap = argparse.ArgumentParser(description="score the corpus against human analyses")
    ap.add_argument("--data", default="public/data", help="where index.json and pieces/ live")
    ap.add_argument("--wir", help="a When-in-Rome checkout")
    ap.add_argument("--augmentednet", help="an AugmentedNet checkout, for the training splits")
    ap.add_argument("--catalogue", default="tools/catalogue.json",
                    help="comma-separated; pass catalogue_wir.json too when "
                         "When in Rome pieces have been ingested")
    ap.add_argument("--out", default="tools/bench_results.json")
    ap.add_argument("--jobs", type=int, default=os.cpu_count())
    ap.add_argument("--limit", type=int, help="score only the first N pairs (a smoke test)")
    args = ap.parse_args()

    catalogue = []
    for c in args.catalogue.split(","):
        catalogue += json.loads(Path(c.strip()).read_text(encoding="utf-8"))
    years = {e["id"]: e.get("year") for e in catalogue}

    live = None
    index = Path(args.data) / "index.json"
    if index.exists():
        live = {e["id"] for e in json.loads(index.read_text(encoding="utf-8"))["pieces"]}
    pairs = pairs_from_wir(args.wir, args.augmentednet, catalogue, live) if args.wir else []
    if not pairs:
        pairs = [(pid, M21_CORPUS / rel,
                  {"split": "unseen", "route": "music21", "collection": "music21",
                   "composer": "", "year": None}) for pid, rel in M21_PAIRS]
        print("no --wir checkout: falling back to the four analyses music21 ships")
    if args.limit:
        pairs = pairs[:args.limit]

    print(f"scoring {len(pairs)} pairs on {args.jobs} cores…")
    jobs = [(pid, str(rn), meta, args.data) for pid, rn, meta in pairs]
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(_run, jobs, chunksize=4))

    by_split, by_era, by_collection, by_composer = {}, {}, {}, {}
    missing = errors = 0
    detail = []

    def add(d, k, n, e, c):
        a = d.setdefault(k, [0, 0, 0, 0])
        a[0] += n; a[1] += e; a[2] += c; a[3] += 1

    for pid, meta, r in results:
        if r is None:
            missing += 1
            continue
        if r[0] == "error":
            errors += 1
            detail.append({"id": pid, "error": r[1], **meta})
            continue
        n, e, c = r
        if not n:
            continue
        year = meta.get("year") or years.get(pid)
        add(by_split, meta["split"], n, e, c)
        add(by_collection, meta["collection"], n, e, c)
        add(by_composer, meta["composer"] or "—", n, e, c)
        if meta["split"] == "unseen":
            add(by_era, era_of(year), n, e, c)
        detail.append({"id": pid, "beats": n, "exact": e, "chord": c, **meta})

    lines = []
    lines += table("by split — 'unseen' is the only honest headline", by_split)
    lines += table("held out only, by era", by_era)
    lines += table("by collection (all splits)", by_collection)
    lines += table("by composer (all splits, top 20)",
                   dict(sorted(by_composer.items(), key=lambda kv: -kv[1][0])[:20]))
    print("\n".join(lines))

    u = by_split.get("unseen")
    if u and u[0]:
        print(f"\nHELD OUT: {u[3]} pieces, {u[0]:,} beats, "
              f"{u[1] / u[0] * 100:.0f}% exact, {u[2] / u[0] * 100:.0f}% chord")
    if missing:
        print(f"{missing} pairs had no piece on the site (not ingested yet)")
    if errors:
        print(f"{errors} analyses could not be read — see {args.out}")

    Path(args.out).write_text(json.dumps(
        {"pairs": len(pairs), "by_split": by_split, "by_era": by_era,
         "by_collection": by_collection, "by_composer": by_composer,
         "missing": missing, "errors": errors, "pieces": detail},
        indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
