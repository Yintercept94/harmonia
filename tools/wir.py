"""Index a When-in-Rome checkout, and record what the model has already seen.

When in Rome (`github.com/MarkGotham/When-in-Rome`, CC BY-SA 4.0) is 1,294 human
harmonic analyses in RomanText. It is a *meta*-corpus: about half the folders hold
only an `analysis.txt` and a `remote.json` saying where the score lives. So each
analysis has a **route** to its score, and the routes cost very different things:

    local     score.mxl sits next to the analysis            — free
    music21   remote.json names a path in music21's corpus   — free, we have it
    mxl       remote.json gives a URL to a MusicXML file     — one download
    mscx      remote.json gives a URL to MuseScore source    — needs the MuseScore CLI
    kern      the score is on kern.humdrum.org               — needs a kern converter
    none      no reachable score                             — unusable

The other half of this module is the part that decides whether a benchmark number
means anything.

**AugmentedNet was trained on When in Rome.** 300 of these 1,294 analyses appear in
its training data (`AugmentedNet/data/*.py`), 208 of them in the *training* split
proper. Scoring the model against those measures how well it memorised, not how well
it analyses, and the answer would be flatteringly wrong. `split_of()` labels every
analysis `training`, `validation`, `test` or `unseen`, and `bench.py` reports the
held-out rows separately. The 994 unseen analyses are the real benchmark, and they
are the reason this corpus is worth the clone.

The path table in AugmentedNet was written against an older layout of the repo, so
`_canonical()` undoes four renames that have happened since (see the table in it).
Without that, 104 of the 300 look unseen and quietly inflate the score.
"""
import json
import os
import re
from pathlib import Path

ROUTES = ("local", "music21", "mxl", "mscx", "kern", "none")


# --- what the model saw -----------------------------------------------------

def _canonical(rel: str) -> str:
    """One spelling for a corpus path, old layout or new.

    AugmentedNet's path table was written against the repo as it stood in 2021, and
    the corpus has been tidied since. Three kinds of change, all reversible:

        Chorales/7  →  Chorales/007     zero-padding, applied at different widths
        Op18_No1    →  Op018_No1        in different folders at different times
        Madrigals_Book_3/1 → .../01
        Corpus/Etudes_and_Preludes/  →  Corpus/Keyboard_Other/   folder merged
        analysis_A.txt →  analysis.txt  the A reading became the default

    Padding is undone rather than re-applied — strip leading zeros from every run of
    digits, so `007`, `07` and `7` all land on `7` without this function needing to
    know which width each folder chose. Digit runs are normalised in place, so
    `Op18_No1` and `Op180_No1` stay distinct.

    Alternative readings (`analysis_B.txt`, a second analyst on the same piece) fold
    onto the default. That is deliberate: if the model trained on *any* reading of a
    piece it has seen that piece, and for contamination the cautious answer is right.
    """
    rel = rel.replace("Corpus/Etudes_and_Preludes/", "Corpus/Keyboard_Other/")
    rel = re.sub(r"/analysis_[A-Z]\.txt$", "/analysis.txt", rel)
    return re.sub(r"\d+", lambda m: str(int(m[0])), rel)


def training_splits(augmentednet_root) -> dict:
    """analysis path (canonical, repo-relative) -> 'training' | 'validation' | 'test'.

    Read out of AugmentedNet's own dataset modules, so it stays true if the model is
    retrained. Every collection is scanned, not just `wir`: the Beethoven quartets
    reach the same When in Rome analyses through `abc`, and the Haydn through
    `haydnsun`. Missing the aliases would mean calling trained-on pieces unseen.
    """
    import importlib.util

    data = Path(augmentednet_root) / "AugmentedNet" / "data"
    out = {}
    for path in sorted(data.glob("*.py")):
        if path.name == "__init__.py":
            continue
        spec = importlib.util.spec_from_file_location(path.stem, path)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
            duples, splits = mod.annotation_score_duples, mod.splits
        except Exception:
            continue  # a collection we cannot read is one we cannot vouch for
        where = {k: s for s in splits for k in splits[s]}
        for key, (annotation, _score) in duples.items():
            if "When-in-Rome/" not in annotation or key not in where:
                continue
            out[_canonical(annotation.split("When-in-Rome/")[1])] = where[key]
    return out


# --- what is actually there -------------------------------------------------

def _route(folder: Path):
    """(route, reference) for the score belonging to an analysis in `folder`."""
    if (folder / "score.mxl").exists():
        return "local", str(folder / "score.mxl")
    remote = folder / "remote.json"
    if not remote.exists():
        return "none", None
    try:
        j = json.loads(remote.read_text(encoding="utf-8"))
    except Exception:
        return "none", None
    if j.get("remote_score_music21"):
        return "music21", os.path.splitext(j["remote_score_music21"])[0]
    for field, route in (("remote_score_mxl", "mxl"),
                         ("remote_score_krn", "kern"),
                         ("remote_score_mscx", "mscx")):
        if j.get(field):
            return route, j[field]
    # A key can be present and null — the folder was set up, the pointer never
    # filled in. `.get()` truthiness, not `in`, is what tells those apart.
    url = j.get("score_source") or ""
    return ("kern", url) if "kern" in url else ("none", None)


def index(wir_root, augmentednet_root=None) -> list:
    """Every human analysis in the checkout, with its score route and its split.

    Returns dicts of: rel, path, folder, collection, composer, work, route, ref, split.
    `rel` is repo-relative and canonical — it is the join key everywhere else.
    """
    root = Path(wir_root)
    splits = training_splits(augmentednet_root) if augmentednet_root else {}
    out = []
    for analysis in sorted((root / "Corpus").rglob("analysis.txt")):
        folder = analysis.parent
        rel = _canonical(str(analysis.relative_to(root)).replace(os.sep, "/"))
        parts = folder.relative_to(root / "Corpus").parts
        route, ref = _route(folder)
        out.append({
            "rel": rel,
            "path": str(analysis),
            "folder": str(folder),
            "collection": parts[0] if parts else "",
            "composer": parts[1].replace("_", " ") if len(parts) > 1 else "",
            "work": "/".join(parts[2:]),
            "route": route,
            "ref": ref,
            "split": splits.get(rel, "unseen"),
        })
    return out


def piece_id(record: dict) -> str:
    """A stable site id for an analysis, derived from its place in the corpus.

    `wir-` prefixed so the provenance is legible in a URL and so these can never
    collide with the music21-sourced ids already in `catalogue.json`. Derived, not
    curated: at 335 pieces a hand-kept id column is a liability.
    """
    parts = [record["collection"], record["composer"], record["work"]]
    slug = "-".join(p for p in parts if p)
    slug = re.sub(r"[^a-z0-9]+", "-", slug.lower()).strip("-")
    return f"wir-{slug}"


def summarise(records: list) -> str:
    """The two tables worth printing before anyone runs a benchmark."""
    lines = []
    for field, title in (("route", "score route"), ("split", "AugmentedNet split")):
        counts = {}
        for r in records:
            counts[r[field]] = counts.get(r[field], 0) + 1
        lines.append(f"{title}:")
        for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
            lines.append(f"  {k:<10} {v:>5}")
    return "\n".join(lines)


if __name__ == "__main__":
    import sys

    recs = index(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    print(f"{len(recs)} human analyses\n")
    print(summarise(recs))


BENCH = Path(__file__).with_name("bench_results.json")


def scored_ids(bench: Path = BENCH) -> set:
    """Site ids that a human analysis was actually matched to.

    The catalogue only records an `analysis` for the When in Rome pieces that
    ship their own score beside it (`route == "local"`). The other few hundred
    reach music21's corpus or a kern file instead: the human analysis exists,
    and `bench.py` scores against it, but nothing in the catalogue row says so.

    So the home page's "has a human analysis" filter cannot be answered from a
    catalogue. It can be answered from `bench_results.json`, which is the record
    of every piece a route was resolved for and a comparison actually made — the
    same question, already asked. Absent the file, callers fall back to the
    catalogue and under-count rather than guess.
    """
    if not bench.exists():
        return set()
    data = json.loads(bench.read_text(encoding="utf-8"))
    return {e["id"] for e in data.get("pieces", []) if "id" in e}
