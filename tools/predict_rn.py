"""Roman-numeral prediction with AugmentedNet.

Replaces the hand-written analyser that used to live in analyze.py. AugmentedNet
is a convolutional-recurrent network (Nápoles López et al., ISMIR 2021) with nine
output heads — local key, tonicised key, Roman numeral, pitch-class set, the four
voices, and harmonic rhythm — trained on the annotated corpora. On the four
pieces in this corpus that have expert analyses it agrees with the annotator on
57% of numerals against the old analyser's 19% (see §4.1 of the README).

    python3 tools/predict_rn.py --repo ../AugmentedNet-main

Writes tools/rn/<id>.json, one entry per chord segment:
    {"on": 4.0, "rn": "V65", "key": "G", "conf": 0.93}
`analyze.py` reads those and assembles pieces.json; the model does not need to be
present to rebuild the app, only to re-predict.

The vendored package is copied into tools/_anet/ and patched there rather than
in place: it pins music21 6.7.1, and music21 removed `.flat` in v9.
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

import numpy as np

PATCH = re.compile(r"\.flat\b(?!\w)")


def stage(repo: Path, work: Path) -> Path:
    """Copy AugmentedNet next door and make it run on a current music21."""
    pkg = work / "AugmentedNet"
    if pkg.exists():
        shutil.rmtree(pkg)
    work.mkdir(parents=True, exist_ok=True)
    shutil.copytree(repo / "AugmentedNet", pkg)
    weights = work / "AugmentedNet.hdf5"
    if not weights.exists():
        shutil.copy(repo / "AugmentedNet.hdf5", weights)
    n = 0
    for f in pkg.rglob("*.py"):
        src = f.read_text(encoding="utf-8")
        out = PATCH.sub(".flatten()", src)
        if out != src:
            f.write_text(out, encoding="utf-8")
            n += 1
    print(f"  staged AugmentedNet into {work} ({n} files patched for music21 9+)")
    return weights


def predict_one(inference, model, mxl: Path):
    """One score -> [{on, rn, key, conf}].

    This drives AugmentedNet's own `predict()` and watches it, rather than
    reimplementing it. A reimplementation drifted: it segmented Monteverdi into
    134 chords where the real pipeline found 163, and scored 15% against the
    annotator instead of 54%. Two spies are enough — one on the model to keep the
    raw softmax for a confidence, one on the segmenter to keep the chord frame
    with its true quarter-note offsets (`predict` only writes those out as
    RomanText, whose measure/beat round-trip loses the pickup).
    """
    seen = {}

    real_predict = model.predict
    def spy_model(x, **kw):
        out = real_predict(x, **kw)
        seen["pred"] = out
        return out

    real_segment = inference.solveChordSegmentation
    def spy_segment(df):
        out = real_segment(df)
        seen["seg"] = out
        seen["heads"] = [layer.name.split("/")[0] for layer in model.outputs]
        return out

    model.predict = spy_model
    inference.solveChordSegmentation = spy_segment
    try:
        inference.predict(model, str(mxl))
    except Exception:
        # `predict` finishes by writing an annotated MusicXML we do not use, and
        # on two of the scores that export fails on ornament durations MusicXML
        # cannot spell. Both spies have already fired by then, so the analysis
        # itself is complete; only the side effect was lost.
        if "seg" not in seen:
            raise
    finally:
        model.predict = real_predict
        inference.solveChordSegmentation = real_segment

    seg = seen.get("seg")
    if seg is None or not len(seg.index):
        return []

    conf = None
    for head, pred in zip(seen.get("heads", []), seen.get("pred", [])):
        if head != "RomanNumeral31":
            continue
        pr = pred.reshape(-1, pred.shape[-1])
        # The head may already be normalised; only softmax if it is not.
        if abs(float(pr[0].sum()) - 1.0) > 1e-3:
            e = np.exp(pr - pr.max(axis=1, keepdims=True))
            pr = e / e.sum(axis=1, keepdims=True)
        conf = pr.max(axis=1)

    rows = []
    for s in seg.itertuples():
        rn, _chordLabel = inference.resolveRomanNumeralCosine(
            s.Bass35, s.Tenor35, s.Alto35, s.Soprano35,
            s.PitchClassSet121, s.LocalKey38, s.RomanNumeral31, s.TonicizedKey38,
        )
        i = int(s.Index)
        rows.append({
            "on": round(float(s.offset), 4),
            "rn": rn,
            "key": s.LocalKey38,
            "conf": round(float(conf[i]) if conf is not None and i < len(conf) else 0.0, 3),
        })
    return rows


def main(repo: str, catalogue: str, out_dir: str):
    root = Path(__file__).resolve().parent.parent
    work = root / "tools" / "_anet"
    weights = stage(Path(repo).resolve(), work)

    sys.path.insert(0, str(work))
    import tf_keras

    from AugmentedNet import inference

    model = tf_keras.models.load_model(str(weights))

    sys.path.insert(0, str(root / "tools"))
    from engrave import to_musicxml  # same export the engraver uses, so the

    mxdir = work / "mxl"                                    # timelines cannot drift
    mxdir.mkdir(exist_ok=True)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    for meta in json.loads(Path(catalogue).read_text()):
        pid = meta["id"]
        try:
            mxl, *_ = to_musicxml(meta["path"], mxdir / f"{pid}.musicxml")
            rows = predict_one(inference, model, mxl)
        except Exception as e:  # keep going; report at the end
            print(f"  !! {pid}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        (out / f"{pid}.json").write_text(json.dumps(rows, separators=(",", ":")))
        mean = sum(r["conf"] for r in rows) / max(len(rows), 1)
        keys = len({r["key"] for r in rows})
        print(f"  ok {pid:<34}{len(rows):>5} labels  {keys:>2} keys  mean conf {mean:.2f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", default="../AugmentedNet-main",
                    help="the unzipped AugmentedNet checkout (holds AugmentedNet.hdf5)")
    ap.add_argument("--catalogue", default="tools/catalogue.json")
    ap.add_argument("--out", default="tools/rn")
    a = ap.parse_args()
    main(a.repo, a.catalogue, a.out)
