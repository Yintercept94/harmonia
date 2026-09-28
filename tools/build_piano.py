"""Rebuilds the sampled piano in src/assets/piano/.

One recording per minor third, A0-C8, from the Splendid Grand in
MuseScore_General (MIT; the piano itself is public domain). Rendering them here
rather than shipping a soundfont keeps the payload at ~1 MB instead of 40 MB.

    npm pack @librescore/sf3            # the soundfont
    python3 tools/build_piano.py

Needs fluidsynth and ffmpeg on PATH.
"""
import subprocess, sys, tarfile, tempfile, shutil
from pathlib import Path

OUT = Path("src/assets/piano")
LOW, HIGH, STEP = 21, 108, 3      # A0..C8, minor thirds
SPACING, HOLD, TAKE = 5.0, 3.0, 4.6   # seconds between notes, held, captured
GAIN_DB = 18.8                    # the soundfont renders ~20 dB below full scale
BITRATE = "56k"


def fetch_soundfont(work: Path) -> Path:
    subprocess.run(["npm", "pack", "@librescore/sf3"], cwd=work, check=True,
                   stdout=subprocess.DEVNULL)
    tgz = next(work.glob("*.tgz"))
    with tarfile.open(tgz) as t:
        t.extractall(work)
    # The .wasm suffix is cosmetic; the file is a plain sf3.
    sf = work / "package" / "MuseScore_General_Lite.sf3.wasm"
    shutil.copy(work / "package" / "MuseScore_General_Lite.copyright", OUT / "LICENSE.txt")
    return sf


def render(sf: Path, work: Path) -> Path:
    from music21 import stream, note, midi, instrument, tempo
    s = stream.Stream()
    s.append(instrument.Piano())
    s.append(tempo.MetronomeMark(number=60))
    for i, m in enumerate(range(LOW, HIGH + 1)):
        n = note.Note(midi=m)
        n.quarterLength = HOLD
        n.volume.velocity = 100
        s.insert(i * SPACING, n)
    mid = work / "all.mid"
    mf = midi.translate.streamToMidiFile(s)
    mf.open(str(mid), "wb"); mf.write(); mf.close()

    wav = work / "all.wav"
    subprocess.run(["fluidsynth", "-a", "file", "-F", str(wav), "-r", "44100",
                    "-g", "0.7", "-ni", str(sf), str(mid)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return wav


def cut(wav: Path):
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*.webm"):
        f.unlink()
    for m in range(LOW, HIGH + 1, STEP):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error",
                        "-ss", str((m - LOW) * SPACING), "-t", str(TAKE), "-i", str(wav),
                        "-af", f"volume={GAIN_DB}dB", "-c:a", "libopus",
                        "-b:a", BITRATE, "-ac", "1", "-ar", "48000",
                        str(OUT / f"{m}.webm")], check=True)
    total = sum(f.stat().st_size for f in OUT.glob("*.webm"))
    print(f"{len(list(OUT.glob('*.webm')))} notes, {total / 1024:.0f} KB in {OUT}")


if __name__ == "__main__":
    for exe in ("fluidsynth", "ffmpeg", "npm"):
        if not shutil.which(exe):
            sys.exit(f"{exe} not found on PATH")
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        cut(render(fetch_soundfont(work), work))
