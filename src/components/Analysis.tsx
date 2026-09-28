import { useEffect, useMemo, useRef, useState } from "react";
import type { Piece } from "@/lib/music";
import { FN_LABEL } from "@/lib/music";
import { DEFAULT_GAIN, Player } from "@/lib/playback";
import Score from "@/components/Score";

/**
 * The colour key. Four ribbon colours for harmonic function — the numerals
 * themselves stay in ink, so under the staves colour never carries meaning alone.
 *
 * The fifth entry is a different kind of claim and gets a different kind of mark:
 * a notehead rather than a bar, because a notehead is what it colours and it sits
 * on the staff rather than beneath it. It is also the one place colour *is* the
 * only channel — a notehead cannot change shape without re-engraving the corpus —
 * so treat it as a way of finding these notes at a glance. The hover card is
 * still where the claim is actually made.
 */
function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-7 gap-y-2">
      {(["T", "PD", "D", "X"] as const).map((f) => (
        <li key={f} className="flex items-center gap-2 text-[0.84rem] text-[var(--ink-soft)]">
          <span className="h-[4px] w-6 shrink-0 rounded-full" style={{ background: `var(--fn-${f.toLowerCase()})` }} />
          {FN_LABEL[f]}
        </li>
      ))}
      <li className="flex items-center gap-2 text-[0.84rem] text-[var(--ink-soft)]">
        <span
          className="h-[8px] w-[10px] shrink-0 rounded-[50%]"
          style={{ background: "var(--nct)", transform: "rotate(-20deg)" }}
        />
        Non-chord tone
      </li>
      {/* A bar again, because a cadence is a span like the functions are — but
          thinner, and it lives in its own lane below the numerals. */}
      <li className="flex items-center gap-2 text-[0.84rem] text-[var(--ink-soft)]">
        <span className="h-[3px] w-6 shrink-0 rounded-full" style={{ background: "var(--cad)" }} />
        Cadence
      </li>
    </ul>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  onReset?: () => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="smallcaps text-[var(--ink-mute)]">{label}</span>
        <span className="tnum font-[var(--mono)] text-[0.72rem] text-[var(--ink-soft)]">
          {format(value)}
          {onReset && (
            <button
              onClick={onReset}
              className="ml-2 text-[var(--ink-mute)] underline decoration-dotted transition-colors hover:text-[var(--ink)]"
            >
              reset
            </button>
          )}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 h-[3px] w-full cursor-pointer appearance-none rounded-full bg-[var(--track)] accent-[var(--ink)]"
      />
    </label>
  );
}

export default function Analysis({ piece, composer, backLabel, onBack }: {
  piece: Piece;
  /** The canonical display name, from the index's composer table — the piece
   *  file's own string is whatever the ingest wrote and may be a short form. */
  composer: string;
  backLabel: string;
  onBack: () => void;
}) {
  const [beat, setBeat] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState(false);
  const [tempo, setTempo] = useState(piece.tempo || 84);
  // Percent of the level the piano pack is tuned to, so 100% is the default and
  // the number means something. DEFAULT_GAIN is what Player starts at.
  const [volume, setVolume] = useState(100);
  const [follow, setFollow] = useState(true);

  const player = useMemo(() => new Player(piece), [piece]);

  // The bar readout only needs to be readable, not smooth: at the scheduler's
  // 50 ms tick it would re-render the page 20 times a second for a number that
  // changes once a bar. The playhead itself is driven outside React (Score.tsx).
  const last = useRef(0);
  useEffect(() => {
    player.onTick = (b) => {
      if (Math.abs(b - last.current) > 0.25) {
        last.current = b;
        setBeat(b);
      }
    };
    player.onEnd = () => setPlaying(false);
    return () => player.dispose();
  }, [player]);

  useEffect(() => {
    setTempo(piece.tempo || 84);
    setVolume(100);
    setBeat(0);
    last.current = 0;
  }, [piece]);

  const toggle = () => {
    if (player.playing || player.starting) {
      player.pause();
      setPlaying(false);
    } else {
      // The button flips at once; audio follows when the sample pack has decoded.
      setPlaying(true);
      void player.play();
    }
  };

  // Space bar is the expected transport control here.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target as HTMLElement).matches("input,textarea")) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const bars = piece.measures.length;
  const pos = Math.min(beat / (player.endBeat || 1), 1);

  return (
    <div className="mx-auto max-w-[1180px] px-6 pb-24 sm:px-10">
      {/* The visible label follows where you came from; the accessible name does
          not, so tools/smoke.mjs has something stable to click. */}
      <button
        onClick={onBack}
        aria-label="Back to the list"
        className="smallcaps mt-8 text-[var(--ink-mute)] transition-colors hover:text-[var(--ink)]"
      >
        ← {backLabel}
      </button>

      <header className="rule-b py-7">
        <p className="smallcaps text-[var(--ink-mute)]">{composer}</p>
        <h1 className="mt-1.5 text-[1.9rem] italic leading-tight sm:text-[2.4rem]" style={{ letterSpacing: "-0.015em" }}>
          {piece.title}
        </h1>
        <p className="mt-1.5 font-[var(--mono)] text-[0.72rem] text-[var(--ink-mute)]">
          {[piece.collection, piece.catNo, piece.genre, piece.year, piece.keyName,
            `${bars} bars`].filter(Boolean).join("  ·  ")}
        </p>
      </header>

      {/* transport + legend */}
      <div className="sticky top-[3.1rem] z-10 -mx-6 mb-3 bg-[var(--paper)]/95 px-6 py-3 backdrop-blur sm:-mx-10 sm:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--ink)] text-[var(--ink)] transition-colors hover:bg-[var(--ink)] hover:text-[var(--paper)]"
            >
              {playing ? (
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <rect x="1.5" y="1" width="3" height="10" fill="currentColor" />
                  <rect x="7.5" y="1" width="3" height="10" fill="currentColor" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2 1 L11 6 L2 11 Z" fill="currentColor" />
                </svg>
              )}
            </button>
            <span className="tnum font-[var(--mono)] text-[0.72rem] text-[var(--ink-mute)]">
              bar {barAt(piece, beat)} / {bars}
            </span>
            <span className="h-[3px] w-28 overflow-hidden rounded-full bg-[var(--track)]" aria-hidden="true">
              <span className="block h-[3px] rounded-full bg-[var(--ink-soft)]" style={{ width: `${pos * 100}%` }} />
            </span>
            <button
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className={`smallcaps rounded-[3px] px-2 py-1 transition-colors ${
                open ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--ink-soft)] hover:bg-[var(--paper-2)]"
              }`}
            >
              Playback
            </button>
          </div>
          <Legend />
        </div>

        {open && (
          <div className="rule-t mt-3 grid gap-x-10 gap-y-4 pt-4 sm:grid-cols-3">
            <Slider
              label="Tempo"
              value={tempo}
              min={20}
              max={240}
              step={1}
              format={(v) => `${v} bpm`}
              onChange={(v) => {
                setTempo(v);
                player.setTempo(v);
              }}
              onReset={
                tempo !== player.baseTempo
                  ? () => {
                      setTempo(player.baseTempo);
                      player.setTempo(player.baseTempo);
                    }
                  : undefined
              }
            />
            <Slider
              label="Volume"
              value={volume}
              min={0}
              max={200}
              step={1}
              format={(v) => `${v}%`}
              onChange={(v) => {
                setVolume(v);
                player.setVolume((v / 100) * DEFAULT_GAIN);
              }}
              onReset={volume !== 100 ? () => { setVolume(100); player.setVolume(DEFAULT_GAIN); } : undefined}
            />
            <label className="flex items-center gap-2 self-end pb-1 text-[0.84rem] text-[var(--ink-soft)]">
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => setFollow(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--ink)]"
              />
              Scroll to follow the playhead
            </label>
          </div>
        )}
      </div>

      <div className="rounded-[3px] border border-[var(--rule)] px-4 py-6 sm:px-7">
        <Score piece={piece} player={player} follow={follow} onSeek={(b) => player.seek(b)} />
      </div>

      {piece.source && (
        <p className="mt-3 font-[var(--mono)] text-[0.68rem] text-[var(--ink-mute)]">
          Score: {piece.source}
          {piece.editor && ` · edited by ${piece.editor}`}
          {piece.license && ` · ${piece.license}`}
        </p>
      )}

      <p className="mt-3 text-[0.74rem] text-[var(--ink-mute)]">
        Click or drag anywhere on a system to move the playhead. Rest on a numeral, a note or a key mark
        for a second to see what it is, and Esc to dismiss. The italic mark above the ribbon is the key
        the numerals are read in, printed wherever it changes. Noteheads in violet are not in the chord
        the ribbon names beneath them — passing notes, suspensions and the like, and equally the places
        where the analysis has the harmony wrong. Labels come from a trained network and agree with
        expert annotators on about two thirds of the numerals in tonal music, less in chromatic or modal
        writing.
      </p>
    </div>
  );
}

function barAt(piece: Piece, beat: number): number {
  let n = piece.measures[0]?.n ?? 1;
  for (const m of piece.measures) {
    if (beat >= m.start - 1e-6) n = m.n;
    else break;
  }
  return n;
}
