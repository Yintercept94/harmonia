"""Engraves the corpus with Verovio, one SVG per system, at build time.

The browser gets finished notation instead of a 7 MB WebAssembly engraver, and
the page stays a single file. Output: public/data/engraved/<id>.bin — per piece,
a gzipped payload of systems, each with its own SVG and a quarter-note -> x map so
the Roman-numeral ribbon and the playhead can be placed on top.

    python3 tools/engrave.py            # after tools/analyze.py

One file per piece rather than one big one: a corpus change then rewrites only
what changed, and no single artefact gets unwieldy.

Coordinates: Verovio nests an inner <svg class="definition-scale"> in internal
units inside an outer viewBox in px. UNIT is the ratio between them.
"""
import gzip, json, re, sys
from pathlib import Path

import verovio
from music21 import bar, converter, corpus, duration, repeat, spanner

PAGE_W = 2400          # internal width; * SCALE/100 = px
SCALE = 35
UNIT = 1000 / SCALE    # internal units per px
BOTTOM = 100           # extra room under the staves for the ribbon and numerals

OPTS = {
    "scale": SCALE,
    "pageWidth": PAGE_W,
    # Small enough that no page can hold two systems — Verovio always emits at
    # least one, so erring low is free. 600 was not low enough: a single-staff
    # score (Josquin's Mille regretz) fit three systems on a page, and the beat
    # -> x anchors for all three were then merged into one list, so the ribbon
    # for two thirds of the piece was drawn at another row's x. It builds, it
    # renders, and it is silently wrong; tools/validate.py checks for it now by
    # asserting the anchors are monotonic.
    "pageHeight": 150,
    "adjustPageHeight": True,
    "breaks": "auto",
    "header": "none",
    "footer": "none",
    "svgViewBox": True,
    "svgRemoveXlink": True,
    "svgFormatRaw": True,   # no pretty-printing: 40% smaller before compression
    "pageMarginTop": 10,
    "pageMarginBottom": BOTTOM,
    "pageMarginLeft": 10,
    "pageMarginRight": 10,
    "spacingStaff": 8,
    "spacingSystem": 0,
}

PLACEHOLDER = re.compile(r"^\s*(music\s*xml.*|part\s*\d*|p\d+|none)?\s*$", re.I)

ID_X = re.compile(r'<g id="([^"]+)" class="(?:note|rest)"[^>]*>(.{0,600}?)(?:translate\((-?\d+))', re.S)
VIEWBOX = re.compile(r'<svg viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"')
MARGIN = re.compile(r'<g class="page-margin" transform="translate\((-?\d+),\s*(-?\d+)\)"')
# Element ids are only needed here, to read positions off the timemap. Two kinds
# must survive: glyph defs, since <use href="#E0A4-..."> resolves against them,
# and the root <svg> id, because Verovio's stylesheet is scoped by it —
#   #<root-id> ellipse, path, polygon, polyline, rect {stroke:currentColor}
# Strip that one and every staff line, barline, stem and slur silently loses its
# stroke while the noteheads, being filled glyphs, carry on as if nothing is wrong.
# Note ids survive too, rewritten to say what they are (see name_notes).
DROP_ID = re.compile(r' id="(?!E[0-9A-F]{3}-|nt-)[^"]*"')
NOTE_G = re.compile(r'<g id="([^"]+)" class="note"')

# Glyphs the browser needs to draw a staff of its own in the hover card. Verovio
# ships Bravura as one file per code point, so they can be lifted straight out
# rather than scraped from rendered output.
GLYPHS = {
    "clefG": "E050", "clefF": "E062", "notehead": "E0A2",
    "sharp": "E262", "flat": "E260", "natural": "E261",
    "sharpsharp": "E263", "flatflat": "E264",
}
GLYPH_D = re.compile(r'\sd="([^"]+)"')


def name_notes(svg: str, tk, beat_of) -> str:
    """Rewrite each notehead's id to say which note it is: nt-F#4-12.5.

    Hovering a notehead should be able to name the note and find the chord it
    belongs to, and the alternative — shipping a lookup table of Verovio's random
    ids — costs the same bytes and one more thing to keep in step. The pitch comes
    from Verovio itself (`pname`/`oct` plus the sounding MIDI value, which is how
    the accidental is recovered) so it cannot disagree with the notation.
    """
    naturals = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}

    def rename(m):
        eid = m.group(1)
        a = tk.getElementAttr(eid)
        midi = tk.getMIDIValuesForElement(eid).get("pitch")
        step, octv = a.get("pname"), a.get("oct")
        if midi is None or not step or octv is None:
            return m.group(0)
        alter = midi - ((int(octv) + 1) * 12 + naturals[step])
        name = step.upper() + ("#" * alter if alter > 0 else "b" * -alter)
        beat = beat_of(eid)
        if beat is None:
            return m.group(0)
        return f'<g id="nt-{name}{octv}-{round(beat, 4)}" class="note"'

    return NOTE_G.sub(rename, svg)


def glyphs() -> dict:
    """The Bravura outlines the hover card draws, straight from Verovio's data."""
    root = Path(verovio.__file__).parent / "data" / "Bravura"
    out = {}
    for name, code in GLYPHS.items():
        m = GLYPH_D.search((root / f"{code}.xml").read_text())
        if m:
            out[name] = m.group(1)
    return out


def drop_ids(svg: str) -> str:
    """Strip element ids, leaving the root <svg> tag alone."""
    head = svg.index(">", svg.index("<svg")) + 1
    return svg[:head] + DROP_ID.sub("", svg[head:])


def strip_repeats(sc) -> None:
    """Remove repeat signs and voltas.

    Verovio's timemap plays repeats out; music21's offsets, analyze.py and the
    player are all written-order. Left in, the two clocks diverge after the first
    repeat sign and the ribbon slides off the notation — measured at up to 584 px
    on a 690 px system. Losing the repeat dots is the cheaper mistake.
    """
    for m in sc.recurse().getElementsByClass("Measure"):
        for side in ("leftBarline", "rightBarline"):
            if isinstance(getattr(m, side, None), bar.Repeat):
                setattr(m, side, None)
    for el in list(sc.recurse().getElementsByClass(repeat.RepeatMark)):
        if el.activeSite is not None:
            el.activeSite.remove(el)
    for sp in list(sc.recurse().getElementsByClass(spanner.Spanner)):
        if isinstance(sp, spanner.RepeatBracket) and sp.activeSite is not None:
            sp.activeSite.remove(sp)


def merge_partial_bars(sc) -> None:
    """Rejoin the two halves of a bar that a repeat sign split in two.

    A repeated section usually ends mid-bar: BWV 277 closes its repeat after
    three beats of bar 4 and opens the next with a one-beat upbeat. music21
    stores those as two short Measures. MusicXML has no such thing — the writer
    pads each one out to a full bar, and the score comes back four quarter notes
    longer than it went in, so the engraving, the analysis and the player stop
    agreeing about where bar 5 is. Anything after the repeat drifts.

    Two adjacent measures whose lengths add up to exactly one bar are one bar,
    so put them back together. Run it after strip_repeats().
    """
    for part in sc.parts:
        ms = list(part.getElementsByClass("Measure"))
        for a, b in zip(ms, ms[1:]):
            span = float(a.barDuration.quarterLength)
            la, lb = float(a.duration.quarterLength), float(b.duration.quarterLength)
            if a.paddingLeft or la >= span or abs(la + lb - span) > 1e-6:
                continue
            # Read the offset before removing: an element detached from its
            # measure reports its offset in whatever site it lands in next.
            for off, el in [(float(e.offset), e) for e in b]:
                b.remove(el)
                if isinstance(el, bar.Barline):   # a's own barline is set below
                    continue
                a.insert(la + off, el)
            a.rightBarline = b.rightBarline
            a.paddingRight = 0.0
            part.remove(b)
        # A piece that opens with an upbeat usually closes with a bar short by
        # the same amount. Declaring that shortfall stops the writer padding it
        # out and lengthening the piece.
        ms = list(part.getElementsByClass("Measure"))
        if ms and ms[0].paddingLeft:
            last = ms[-1]
            short = float(last.barDuration.quarterLength) - float(last.duration.quarterLength)
            if 0 < short < float(last.barDuration.quarterLength):
                last.paddingRight = short


def bar_grid(sc) -> list[tuple[float, float]]:
    """[(start, length)] per bar, in the analysis clock."""
    parts = list(sc.parts) or [sc]
    top = max(parts, key=lambda x: float(x.highestTime))
    return [(float(m.offset), float(m.duration.quarterLength))
            for m in top.getElementsByClass("Measure")]


def strip_harmony_xml(path: Path) -> Path:
    """A copy of a MusicXML file with its <harmony> elements removed.

    Scores that arrive with an analysis already inside them — the DCML-derived
    Beethoven quartets in When in Rome are the case here — carry the analyst's
    labels as MusicXML `<harmony>`. Two reasons that has to go before music21
    sees it:

    1. **It does not parse.** DCML writes its own syntax into `<function>`
       ("Eb.I"), and music21 10's `xmlToChordSymbol` raises `HarmonyException` on
       anything that is not a pitch name. Not a warning — the parse dies, and all
       70 quartets fail with it.
    2. **It is the answer.** Leaving it in would print a human analysis under a
       staff the site labels as machine-predicted, and feed the ground truth to a
       pipeline being measured against it.

    Rewritten through ElementTree rather than by regex, so a `<harmony>` inside a
    comment or an attribute value cannot be hit by accident. `.mxl` is a zip: the
    score is the part file that is not in META-INF, and music21 gets the
    uncompressed copy.
    """
    import tempfile
    import xml.etree.ElementTree as ET
    import zipfile

    src = Path(path)
    if src.suffix.lower() == ".mxl":
        with zipfile.ZipFile(src) as z:
            name = next((n for n in z.namelist()
                         if n.endswith(".xml") and not n.startswith("META-INF")), None)
            if name is None:
                return src
            data = z.read(name)
    else:
        data = src.read_bytes()

    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return src                      # let music21 report it in its own words
    removed = 0
    for parent in root.iter():
        for child in [c for c in parent if c.tag == "harmony"]:
            parent.remove(child)
            removed += 1
    if not removed and src.suffix.lower() != ".mxl":
        return src

    tmp = Path(tempfile.mkdtemp(prefix="harmonia-")) / (src.stem + ".musicxml")
    tmp.write_bytes(ET.tostring(root, encoding="utf-8", xml_declaration=True))
    return tmp


def to_musicxml(path: str, out: Path) -> tuple[Path, float, list[tuple[float, float]]]:
    """A corpus entry or a score file -> MusicXML, labels and repeats stripped."""
    # A music21 corpus path ("bach/bwv269") names no file on disk; anything that
    # does is read from disk. Testing for the file rather than for a leading "/"
    # is also what makes this work on Windows, where a path starts "D:\".
    sc = converter.parse(str(strip_harmony_xml(Path(path)))) if Path(path).exists() \
        else corpus.parse(path)
    if hasattr(sc, "scores") and not hasattr(sc, "parts"):
        sc = sc.scores[0]
    strip_repeats(sc)
    merge_partial_bars(sc)
    end = float(sc.highestTime)
    # Staff labels earn their place only when the parts differ: "Vln / Vln / Vla /
    # Vc" tells you who is playing what, but a piano exported as two parts prints
    # "Piano" twice down the side of one grand staff, and music21's placeholder
    # prints "MusicXML Part". Distinct names are kept, uniform ones dropped.
    names = {str(p.partName or "").strip().lower() for p in sc.parts}
    if len(names) <= 1 or any(PLACEHOLDER.match(str(p.partName or "")) for p in sc.parts):
        for p in sc.parts:
            p.partName = None
            p.partAbbreviation = None
            for ins in p.getInstruments():
                for attr in ("partName", "partAbbreviation", "instrumentName", "instrumentAbbreviation"):
                    setattr(ins, attr, None)
    # Zero-length notes and 0.11-quarter fragments survive in a couple of the
    # corpus files and MusicXML cannot express either.
    for n in list(sc.recurse().notesAndRests):
        if n.duration.quarterLength == 0 and n.activeSite is not None:
            n.activeSite.remove(n)
    try:
        sc.write("musicxml", str(out))
        return out, end, bar_grid(sc)
    except Exception:
        pass
    # Fallback for the handful of files with durations MusicXML cannot express.
    # C.P.E. Bach's ornaments arrive as 171/1024 of a quarter; Op. 59 no. 2 has
    # a few similar fragments. Snapping to sixteenths, triplets and sextuplets
    # catches almost all of them, quantising can leave new zero-length notes
    # behind, and whatever still has no notatable value is forced onto a
    # twelfth-note grid.
    sc = sc.quantize(quarterLengthDivisors=(16, 12, 8, 6, 4, 3), processOffsets=True,
                     processDurations=True, inPlace=False)
    for n in list(sc.recurse().notesAndRests):
        if n.duration.quarterLength == 0 and n.activeSite is not None:
            n.activeSite.remove(n)
    for n in sc.recurse().notesAndRests:
        if n.duration.type == "inexpressible":
            ql = float(n.duration.quarterLength)
            n.duration = duration.Duration(quarterLength=max(1 / 12, round(ql * 12) / 12))
    sc.write("musicxml", str(out))
    return out, end, bar_grid(sc)


def positions(svg: str) -> dict:
    """Element id -> x, in the outer viewBox's px."""
    m = MARGIN.search(svg)
    dx = int(m.group(1)) if m else 0
    return {mm.group(1): round((int(mm.group(3)) + dx) / UNIT, 2) for mm in ID_X.finditer(svg)}


def bar_clock(tm: list, bars: list[tuple[float, float]]):
    """Verovio's quarter-note clock -> the analysis clock.

    The two agree on most scores, but not all: a few corpus files hold durations
    MusicXML cannot spell, and repairing them (see to_musicxml) nudges the
    lengths Verovio then adds up. On Op. 59 no. 2 that put the engraving 58
    quarter notes ahead of the analysis by the last system, which would slide the
    ribbon off the notation. Bar lines are the fixed points both sides agree on,
    so anchor to those and interpolate inside each bar.
    """
    stamps = [float(e["qstamp"]) for e in tm if "measureOn" in e]
    if len(stamps) != len(bars) or not bars:
        return lambda q: q     # nothing to anchor to; trust Verovio
    edges = stamps + [stamps[-1] + bars[-1][1]]

    def to_analysis(q: float) -> float:
        lo, hi = 0, len(bars) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if edges[mid] <= q:
                lo = mid
            else:
                hi = mid - 1
        span = edges[lo + 1] - edges[lo]
        start, length = bars[lo]
        return start + (0 if span <= 0 else (q - edges[lo]) / span * length)

    return to_analysis


def engrave(mxl: Path, end: float, bars: list[tuple[float, float]]) -> dict:
    tk = verovio.toolkit()
    tk.setOptions(OPTS)
    tk.loadFile(str(mxl))
    tk.renderToMIDI()
    tm = tk.renderToTimemap({"includeMeasures": True, "includeRests": True})
    if isinstance(tm, str):
        tm = json.loads(tm)
    clock = bar_clock(tm, bars)

    # id -> beat, so a notehead can be labelled with where it falls as well as
    # what it is. Built from the timemap, which is the only place Verovio says so.
    at = {}
    for e in tm:
        q = clock(float(e.get("qstamp", 0)))
        for eid in list(e.get("on", [])) + list(e.get("restsOn", [])):
            at.setdefault(eid, q)

    pages = []
    for i in range(tk.getPageCount()):
        svg = tk.renderToSVG(i + 1)
        # One system per page is not a preference, it is what makes the anchor
        # list meaningful: two systems share a page and their x axes overlap.
        rows = svg.count('class="system"')
        if rows > 1:
            raise ValueError(
                f"page {i + 1} holds {rows} systems; lower OPTS['pageHeight']")
        vb = VIEWBOX.search(svg)
        pos = positions(svg)
        svg = drop_ids(name_notes(svg, tk, at.get))
        pages.append({"svg": svg, "h": float(vb.group(2)) if vb else 0.0, "pos": pos,
                      "xe": max(pos.values()) + 14 if pos else 0.0})

    # Attach every timemap entry to the page holding its notes.
    for p in pages:
        p["ax"] = []
    for e in tm:
        ids = list(e.get("on", [])) + list(e.get("restsOn", []))
        q = clock(float(e.get("qstamp", 0)))
        for p in pages:
            xs = [p["pos"][i] for i in ids if i in p["pos"]]
            if xs:
                p["ax"].append([round(q, 4), min(xs)])
                break

    # A page no timemap entry landed on carries nothing the analysis can point
    # at — in practice a movement break or a page of rests in a multi-movement
    # file. Left in, it takes `from`/`to` of 0.0, and since each system's `to` is
    # the next one's `from`, that zero propagates backwards and silently voids
    # the neighbour's range. Dropping it loses no addressable music.
    blank = [i for i, p in enumerate(pages) if not p["ax"]]
    if blank:
        print(f"     dropped {len(blank)} page(s) with no notes: {blank[:8]}", file=sys.stderr)
        pages = [p for p in pages if p["ax"]]

    width = PAGE_W * SCALE / 100
    systems = []
    for p in pages:
        ax = sorted({q: x for q, x in p["ax"]}.items())
        systems.append({
            "svg": p["svg"],
            "h": p["h"],
            "from": ax[0][0] if ax else 0.0,
            "to": ax[-1][0] if ax else 0.0,
            "ax": [[q, x] for q, x in ax],
            "_xe": min(p["xe"], width - 4),
        })
    # A system runs up to the next one's start; the last runs to the piece's end.
    for a, b in zip(systems, systems[1:]):
        a["to"] = b["from"]
    if systems:
        systems[-1]["to"] = max(end, systems[-1]["to"])
    # A closing anchor at the system's right edge, so a label held to the end of
    # a system reaches it instead of stopping at the final notehead.
    for s in systems:
        if s["ax"] and s["to"] > s["ax"][-1][0] + 1e-6 and s["_xe"] > s["ax"][-1][1]:
            s["ax"].append([round(s["to"], 4), round(s["_xe"], 2)])
        del s["_xe"]
    return {"w": width, "systems": systems}


def main(catalogue: str, out_dir: str, only: set[str] | None = None,
         merge: bool = False):
    # Comma-separated, so a second corpus can be engraved alongside the first
    # without either being the special case.
    cat = []
    for c in catalogue.split(","):
        cat += json.loads(Path(c.strip()).read_text(encoding="utf-8"))
    gpath = Path("src/data/glyphs.json")
    gpath.write_text(json.dumps(glyphs(), separators=(",", ":")))
    print(f"  wrote {gpath} ({gpath.stat().st_size // 1024} KB)")
    tmp = Path("tools/_mxl"); tmp.mkdir(parents=True, exist_ok=True)
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    # A full run owns the whole directory, so anything left from a previous
    # corpus goes: a `.bin` with no catalogue entry is a piece the site can no
    # longer reach, and it would sit there forever. `--only` and `--merge` are
    # both partial runs by definition and must not touch what they did not build.
    if not only and not merge:
        for stale in out.glob("*.bin"):
            stale.unlink()
    raw_total, done, total = 0, 0, 0
    for meta in cat:
        pid = meta["id"]
        if only and pid not in only:
            continue
        try:
            mxl, end, bars = to_musicxml(meta["path"], tmp / f"{pid}.musicxml")
            data = engrave(mxl, end, bars)
        except Exception as e:
            print(f"  !! {pid}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        payload = json.dumps(data, separators=(",", ":")).encode()
        # Raw gzip, not base64-in-JSON: base64 costs a third of the payload for
        # nothing, and the browser inflates this with DecompressionStream either
        # way. `.bin` rather than `.gz` so no static host adds Content-Encoding
        # and unzips it out from under us (src/lib/engraved.ts says more).
        blob = gzip.compress(payload, 9)
        (out / f"{pid}.bin").write_bytes(blob)
        raw_total += len(payload)
        total += len(blob)
        done += 1
        print(f"  ok {pid:<34} {len(data['systems']):>3} systems  "
              f"{len(payload) / 1024:>7.0f} KB -> {len(blob) / 1024:>6.0f} KB gz")
    print(f"\nwrote {out}/: {done} pieces, "
          f"{raw_total / 1048576:.1f} MB raw -> {total / 1048576:.1f} MB")


if __name__ == "__main__":
    ap = __import__("argparse").ArgumentParser(description="score -> engraved SVG")
    ap.add_argument("catalogue", nargs="?", default="tools/catalogue.json",
                    help="one path, or several comma-separated")
    ap.add_argument("out", nargs="?", default="public/data/engraved")
    ap.add_argument("--only", help="comma-separated ids; re-engrave just these")
    ap.add_argument("--merge", action="store_true",
                    help="add to the existing engravings instead of replacing them")
    a = ap.parse_args()
    main(a.catalogue, a.out, set(a.only.split(",")) if a.only else None, a.merge)
