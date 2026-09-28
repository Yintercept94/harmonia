#!/usr/bin/env python3
"""
Harmonia — corpus analyser.

Reads real scores from the music21 core corpus and writes the corpus the web
front end renders: the measure grid, the notes for playback, and the harmonic
analysis.

Output is split, and the split is what lets the corpus grow (README §2):
  public/data/index.json        one small record per piece, for the list page
  public/data/pieces/<id>.json  the piece in full, fetched when it opens
A single pieces.json would be ~45 MB at 1,300 works, and the front end used to
`import` it — i.e. compile all of it into the bundle every visitor downloads.

The analysis itself is not done here. Roman numerals come from **AugmentedNet**,
a trained network (Nápoles López et al., ISMIR 2021); `tools/predict_rn.py` runs
it and leaves one file per piece in `tools/rn/`. This script parses the score,
reads those labels, and assembles the two into pieces.json.

The hand-written analyser that used to live here — beat segmentation, pitch-class
profiles, a Krumhansl-Schmuckler key tracker — agreed with expert annotators on
19% of numerals. The network manages 57% on the same four pieces, so it replaced
it wholesale. §4 of the README has the comparison.

Run:  python3 tools/predict_rn.py   ->  tools/rn/*.json   (needs the model)
      python3 tools/analyze.py      ->  public/data/{index,pieces/*}.json
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import copy

from music21 import converter, corpus, key as m21key, roman, stream

sys.path.insert(0, str(Path(__file__).resolve().parent))   # so `engrave` and
                                                           # `composers` import
                                                           # when run from the root
import wir  # noqa: E402
from composers import Composers  # noqa: E402

# --- label formatting -------------------------------------------------------

FIG_SPLIT = re.compile(r"^([b#\-]*)([IiVv]+)(.*)$")
# Only these figures are shown. Anything else music21 emits (5, 53, 8, 854 …)
# is figured-bass detail that says nothing about inversion, so it is dropped.
SUBSUP = {
    "": (None, None),
    "6": ("6", None), "64": ("6", "4"),
    "7": ("7", None), "65": ("6", "5"), "43": ("4", "3"), "42": ("4", "2"),
    "2": ("4", "2"), "9": ("9", None),
}


def split_figure(fig: str):
    """Split a music21 RN figure like 'V65/V' into base numeral + stacked digits."""
    applied = None
    if "/" in fig:
        fig, applied = fig.split("/", 1)
    m = FIG_SPLIT.match(fig)
    if not m:
        return fig, None, None, applied
    pre, num, rest = m.groups()
    quality = ""
    while rest and rest[0] in "oø+°":
        quality += rest[0]
        rest = rest[1:]
    digits = "".join(ch for ch in rest if ch.isdigit())
    sup, sub = SUBSUP.get(digits, (None, None))
    base = pre + num + quality
    if applied:
        sub = (sub or "") + "/" + applied
    return base, sup, sub, applied


TONIC_DEG = {1, 3, 6}
PRE_DEG = {2, 4}
DOM_DEG = {5, 7}


def function_of(rn_obj, applied) -> str:
    """Tonic / predominant / dominant / unclassified, from the scale degree."""
    if applied:
        return "D"
    try:
        deg = rn_obj.scaleDegree
    except Exception:
        return "X"
    if rn_obj.secondaryRomanNumeral is not None:
        return "D"
    if deg in DOM_DEG:
        return "D"
    if deg in PRE_DEG:
        return "PD"
    if deg in TONIC_DEG:
        return "T"
    return "X"


# --- what the chord and the key are actually made of --------------------------
# The browser draws a small staff when you hover a label, and it should not have
# to know what a Roman numeral is to do it. music21 already knows, so the spelled
# notes are worked out here and shipped alongside the label.

CENTRE = 71  # B4, the middle line of a treble staff


def spell(p) -> str:
    """music21 pitch -> the app's spelling ('E-4' -> 'Eb4')."""
    return p.nameWithOctave.replace("-", "b")


def centred(pitches: list) -> list:
    """Shift by whole octaves until the notes sit around the middle of the staff.

    Roman numerals carry no register — music21 spells V65 in G as F#5-A5-C6-D6 —
    and a chord drawn four ledger lines up is harder to read than it is to
    transpose.
    """
    if not pitches:
        return []
    mean = sum(p.midi for p in pitches) / len(pitches)
    shift = round((CENTRE - mean) / 12) * 12
    out = []
    for p in pitches:
        q = copy.deepcopy(p)
        q.octave = (q.octave or 4) + shift // 12
        out.append(q)
    return out


def chord_tones(rn_obj):
    """[(spelled pitch, chord degree)] in sounding order, bass first.

    The degree is 1/3/5/7/9 — which chord member the note is — so hovering a
    notehead can say "the third of V65" without the front end doing any theory.
    """
    try:
        root = rn_obj.root()
        pitches = centred(list(rn_obj.pitches))
    except Exception:
        return [], []
    letters = "CDEFGAB"
    base = letters.index(root.step)
    names, degrees = [], []
    for p in pitches:
        names.append(spell(p))
        # Which chord member this is, by letter distance from the root. Octaves
        # and inversions are irrelevant: the third of the chord is the third
        # whether it is in the bass or two octaves up.
        degrees.append((letters.index(p.step) - base) % 7 + 1)
    return names, degrees


def scale_of(k) -> list:
    """The key's own scale, one octave, spelled — natural minor for minor keys,
    since that is the scale the key signature and the numerals are read against."""
    try:
        tonic = k.tonic.nameWithOctave if k.tonic.octave else k.tonic.name + "4"
        pitches = k.getScale().getPitches(tonic, k.tonic.name + "5")
    except Exception:
        return []
    return [spell(p) for p in centred(list(pitches))]


RN_DIR = Path("tools/rn")


def read_labels(piece_id: str, end: float):
    """tools/rn/<id>.json -> (the `chords` array pieces.json ships, its scales).

    The model emits one row per chord segment with an onset in quarter notes, a
    Roman numeral relative to the local key, that key, and its own softmax
    confidence. A segment runs until the next one starts.
    """
    src = RN_DIR / f"{piece_id}.json"
    if not src.exists():
        return [], {}
    keys = {}
    rows = json.loads(src.read_text())
    out = []
    for r, nxt in zip(rows, rows[1:] + [None]):
        stop = float(nxt["on"]) if nxt else end
        if stop - float(r["on"]) < 1e-6:
            continue
        try:
            k = m21key.Key(r["key"])
            rn_obj = roman.RomanNumeral(r["rn"], k)
        except Exception:
            continue
        base, sup, sub, applied = split_figure(rn_obj.figure)
        tones, degrees = chord_tones(rn_obj)
        keys[k.tonicPitchNameWithCase] = k
        out.append({
            "on": round(float(r["on"]), 4),
            "end": round(stop, 4),
            "rn": base, "sup": sup, "sub": sub,
            "fn": function_of(rn_obj, applied),
            "conf": round(float(r.get("conf", 0.0)), 3),
            "key": k.tonicPitchNameWithCase.replace("-", "b") + (
                " major" if k.mode == "major" else " minor"),
            # For the hover card: the chord spelled out, and which member each
            # note is (1 = root, 3 = third, …).
            "pcs": tones, "dg": degrees,
        })
    # Adjacent identical labels are one harmony, not two.
    merged = []
    for c in out:
        p = merged[-1] if merged else None
        if p and (p["rn"], p["sup"], p["sub"], p["key"]) == (c["rn"], c["sup"], c["sub"], c["key"]):
            p["end"] = c["end"]
            p["conf"] = round(max(p["conf"], c["conf"]), 3)
        else:
            merged.append(dict(c))
    scales = {
        k.tonicPitchNameWithCase.replace("-", "b") + (
            " major" if k.mode == "major" else " minor"): scale_of(k)
        for k in keys.values()
    }
    return merged, scales


# --- main per-piece routine --------------------------------------------------

def analyse(path: str, meta: dict):
    # The score reaches this script and the engraver by two separate routes, so
    # both have to load it the same way or their clocks part company. `engrave`
    # owns that: a music21 corpus path ("bach/bwv269") names no file on disk and
    # is parsed from the corpus; a file is read from disk with any embedded
    # <harmony> stripped first — see `strip_harmony_xml` for why that is not
    # optional. Testing for the file, rather than for a leading "/", is also what
    # makes this work on Windows.
    from engrave import strip_harmony_xml
    if Path(path).exists():
        raw = converter.parse(str(strip_harmony_xml(Path(path))))
    else:
        raw = corpus.parse(path)
    if hasattr(raw, "scores") and not hasattr(raw, "parts"):  # .abc opus -> first score
        raw = raw.scores[0]
    sc = raw.stripTies()                 # analysis view: tied notes sustain
    parts = list(raw.parts) if raw.parts else [raw]   # render view: as notated

    # --- measure grid (handles metre changes) ---
    # The grid comes from the longest part, not the first: a part that runs past
    # the top one would otherwise leave its last notes outside the grid entirely.
    top = max(parts, key=lambda p: float(p.highestTime))
    if not top.getElementsByClass(stream.Measure):
        top = top.makeMeasures()
        parts = [p.makeMeasures() if not p.getElementsByClass(stream.Measure) else p
                 for p in parts]
    # `len` is the distance to the next measure, never barDuration: pickups,
    # volta remnants and split bars are shorter than the metre says, and taking
    # the nominal length leaves gaps that put every later beat->bar lookup out.
    raws = list(top.getElementsByClass(stream.Measure))
    if not raws:
        return None
    measures = []
    prev_n = None
    for i, m in enumerate(raws):
        start = float(m.offset)
        if i + 1 < len(raws):
            length = float(raws[i + 1].offset) - start
        else:
            length = float(m.duration.quarterLength) or float(m.barDuration.quarterLength)
        if length <= 0:
            continue
        # music21 numbers the remnant of a split bar 0, or repeats a number across
        # first/second endings. Neither may go backwards, or bar numbers jump about.
        n = m.number
        if prev_n is not None and n <= prev_n:
            n = prev_n
        prev_n = n
        measures.append({"n": n, "start": start, "len": length})
    if not measures:
        return None
    nominal = float(raws[0].barDuration.quarterLength)
    pickup = measures[0]["len"] if measures[0]["len"] < nominal - 1e-6 else 0.0

    # Any part may still ring past the grid; stretch the final bar to cover it.
    end = max((float(pp.highestTime) for pp in parts), default=0.0)
    last = measures[-1]
    if end > last["start"] + last["len"] + 1e-6:
        last["len"] = end - last["start"]

    ts = top.recurse().getElementsByClass("TimeSignature")
    meter = [ts[0].numerator, ts[0].denominator] if ts else [4, 4]

    # --- staff assignment: split parts by mean pitch into two staves ---
    means = []
    for p in parts:
        ns = [n for n in p.recurse().notes]
        ps = [x.pitch.ps for n in ns for x in (n.notes if n.isChord else [n])]
        means.append(sum(ps) / len(ps) if ps else 60)
    order = sorted(range(len(parts)), key=lambda i: -means[i])
    half = max(1, len(parts) // 2)
    staff_of = {pi: (0 if rank < half else 1) for rank, pi in enumerate(order)}
    if len(parts) == 1:
        staff_of = {0: 0}

    # --- flatten to notes ---
    notes_out = []
    for pi, p in enumerate(parts):
        st = staff_of.get(pi, 0)
        for n in p.recurse().notes:
            on = float(n.getOffsetInHierarchy(raw))
            dur = float(n.duration.quarterLength)
            if dur <= 0:
                continue
            tied = 1 if (n.tie is not None and n.tie.type in ("start", "continue")) else 0
            for x in (n.notes if n.isChord else [n]):
                pit = x.pitch
                nm = pit.name.replace("-", "b") + str(pit.octave)
                # One part: split at middle C. Otherwise honour the part's staff.
                staff = (0 if pit.ps >= 60 else 1) if len(parts) == 1 else st
                notes_out.append([nm, round(on, 4), round(dur, 4), staff, tied,
                                  round(float(pit.ps), 2)])

    events = []  # (pc, on, off, ps) for the analyser, from the tied-through score
    for p in (sc.parts if sc.parts else [sc]):
        for n in p.recurse().notes:
            on = float(n.getOffsetInHierarchy(sc))
            dur = float(n.duration.quarterLength)
            if dur <= 0:
                continue
            for x in (n.notes if n.isChord else [n]):
                events.append((x.pitch.pitchClass, on, on + dur, float(x.pitch.ps)))

    if len(notes_out) < 24 or not events:
        return None

    end = max(e[2] for e in events)

    # The piece's overall key, for the header and the piece list. The per-label
    # local keys come from the model and can differ from it, which is the point.
    global_key = sc.analyze("key")

    # --- labels from AugmentedNet (tools/predict_rn.py) ---
    chords_out, scales = read_labels(meta["id"], end)
    if not chords_out:
        print(f"  -- {meta['id']}: no predictions in {RN_DIR}/", file=sys.stderr)

    ksig = 0
    kss = top.recurse().getElementsByClass("KeySignature")
    if kss:
        ksig = kss[0].sharps

    med = sorted(n[5] for n in notes_out)
    clefs = ["treble", "bass"]
    if all(n[3] == 0 for n in notes_out):
        clefs = ["treble", "treble"]
    if med and med[len(med) // 2] < 55:
        clefs = ["bass", "bass"]

    out = {
        "id": meta["id"],
        "composer": meta["composer"],
        "composerId": meta["composerId"],
        "title": meta["title"],
        "genre": meta.get("genre", ""),
        "collection": meta.get("collection", ""),
        "catNo": meta.get("catNo", ""),
        "year": meta["year"],
        # Whether a human wrote an analysis of this piece — the browse filter
        # that no score library can offer, and the only field here that is about
        # the labels rather than the music. Either the analysis sits beside the
        # score in the catalogue, or bench.py reached it another way; see
        # wir.scored_ids for why the catalogue alone is not enough.
        "hasAnalysis": bool(meta.get("analysis")) or meta["id"] in SCORED,
        "bars": len(measures),   # the list page shows this and must not load `measures`
        "keyName": global_key.tonicPitchNameWithCase.replace("-", "b") + (
            " major" if global_key.mode == "major" else " minor"),
        "meter": meter,
        "keySig": ksig,
        "clefs": clefs,
        "pickup": round(pickup, 4),
        "tempo": meta.get("tempo", 84),
        "measures": [{"n": m["n"], "start": round(m["start"], 4),
                      "len": round(m["len"], 4)} for m in measures],
        "notes": [[n[0], n[1], n[2], n[3], n[4]] for n in notes_out],
        "chords": chords_out,
        "scales": scales,          # local key name -> its scale, for the hover card
    }
    # Provenance travels with the piece so the page can credit the encoding.
    # CC BY material requires it, and the corpus now mixes licences (README §11).
    for k in ("source", "license", "editor"):
        if meta.get(k):
            out[k] = meta[k]
    return out


# What the list page needs. Everything else stays in the per-piece file.
#
# Two things are deliberately absent. `composer` — the display name is repeated
# 409 times for Bach alone, so the index carries `composerId` and one `composers`
# block at the head instead, which also hands the browse its sort names, periods
# and dates for nothing. And provenance: `source` and `license` are two long
# strings repeated 767 times, 50 KB of an index nobody reads them from. They live
# in the piece file, which is where the page that credits them loads from.
INDEX_FIELDS = ("id", "composerId", "title", "genre", "collection", "catNo",
                "year", "keyName", "bars", "hasAnalysis")


SCORED = wir.scored_ids()


def main(catalogue_path: str, out_dir: str, only: set[str] | None = None,
         merge: bool = False):
    # Comma-separated, so a second corpus can be analysed alongside the first
    # without either being the special case.
    cat = []
    for c in catalogue_path.split(","):
        cat += json.loads(Path(c.strip()).read_text(encoding="utf-8"))
    out = Path(out_dir)
    (out / "pieces").mkdir(parents=True, exist_ok=True)

    index, total = [], 0
    for meta in cat:
        if only and meta["id"] not in only:
            continue
        try:
            p = analyse(meta["path"], meta)
        except Exception as e:  # keep going; report at the end
            print(f"  !! {meta['id']}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        if p is None:
            print(f"  -- {meta['id']}: skipped (too short / unparsed)", file=sys.stderr)
            continue
        blob = json.dumps(p, separators=(",", ":"))
        (out / "pieces" / f"{p['id']}.json").write_text(blob)
        index.append({k: p[k] for k in INDEX_FIELDS if k in p})
        total += len(blob)
        print(f"  ok {p['id']:<28} {len(p['notes']):>5} notes  "
              f"{len(p['chords']):>4} labels  {len(blob) / 1024:>6.0f} KB  {p['keyName']}")

    # `--only` rebuilds part of a corpus and `--merge` adds one alongside another;
    # either way the index still has to describe the whole site, so entries this
    # run did not touch are read back rather than dropped.
    idx_path = out / "index.json"
    if (only or merge) and idx_path.exists():
        fresh = {e["id"] for e in index}
        kept = [e for e in json.loads(idx_path.read_text())["pieces"] if e["id"] not in fresh]
        index = kept + index
    people = Composers.load()
    index.sort(key=lambda e: (e["year"], people.by_id[e["composerId"]].sort, e["title"]))

    idx_path.write_text(json.dumps(
        {"version": 3,
         "generator": "music21 %s + AugmentedNet 1.9.0" % __import__("music21").__version__,
         "composers": people.index_dict(),
         "pieces": index}, separators=(",", ":")))
    print(f"\nwrote {idx_path}: {len(index)} pieces "
          f"({idx_path.stat().st_size / 1024:.0f} KB index, {total / 1024 ** 2:.1f} MB of pieces)")


if __name__ == "__main__":
    ap = __import__("argparse").ArgumentParser(description="score -> public/data")
    ap.add_argument("catalogue", nargs="?", default="tools/catalogue.json",
                    help="one path, or several comma-separated")
    ap.add_argument("out", nargs="?", default="public/data")
    ap.add_argument("--only", help="comma-separated ids; rebuild just these")
    ap.add_argument("--merge", action="store_true",
                    help="add to the existing index instead of replacing it")
    a = ap.parse_args()
    main(a.catalogue, a.out, set(a.only.split(",")) if a.only else None, a.merge)
