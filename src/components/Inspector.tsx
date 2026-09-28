import { useLayoutEffect, useRef, useState } from "react";
import type { Piece, RawChord } from "@/lib/music";
import { FN_LABEL } from "@/lib/music";
import { chordAt, memberOf } from "@/lib/harmony";
import type { Cadence } from "@/lib/cadence";
import { CADENCE_GLOSS, CADENCE_NAME } from "@/lib/cadence";
import { degreeName, midiOfPitch, prettyPitch } from "@/lib/notation";
import MiniStaff from "@/components/MiniStaff";

/**
 * What the pointer is resting on. `rect` is the target, in viewport coordinates;
 * `id` identifies it between one pointer event and the next, so resting on the
 * same thing does not restart the clock and returning to it does not reopen.
 */
export type Target = { id: string; rect: DOMRect } & (
  | { kind: "chord"; chord: RawChord }
  | { kind: "note"; beat: number; pitch: string }
  | { kind: "key"; key: string }
  | { kind: "cadence"; cadence: Cadence }
);

// Fixed, so the flip-to-the-other-side decision is exact. A scale is eight notes
// wide and needs more room than a chord's single column, and a cadence is two
// chords side by side.
const WIDTH = { chord: 232, note: 232, key: 288, cadence: 288 };
const GAP = 12;

/** A Roman numeral with its figures stacked, the way the ribbon prints them. */
function Figure({ c, className = "" }: { c: RawChord; className?: string }) {
  return (
    <span className={`whitespace-nowrap ${className}`}>
      {c.rn}
      {(c.sup || c.sub) && (
        <span className="ml-[0.06em] inline-flex flex-col text-[0.58em] leading-[1.05]">
          <span>{c.sup ?? " "}</span>
          <span>{c.sub ?? " "}</span>
        </span>
      )}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="mt-1 flex items-baseline justify-between gap-3 text-[0.74rem] text-[var(--ink-soft)]">
      <span className="smallcaps text-[var(--ink-mute)]">{label}</span>
      <span className="text-right">{children}</span>
    </p>
  );
}

function PlayButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-[3px] border border-[var(--rule-strong)] py-1.5 text-[0.72rem] text-[var(--ink-soft)] transition-colors hover:bg-[var(--ink)] hover:text-[var(--paper)]"
    >
      <svg width="8" height="9" viewBox="0 0 8 9" aria-hidden="true">
        <path d="M0 0 L8 4.5 L0 9 Z" fill="currentColor" />
      </svg>
      {label}
    </button>
  );
}

interface Props {
  piece: Piece;
  target: Target;
  onPlay: (midis: number[], gap?: number) => void;
  /** Chords in succession — a cadence, where the motion is the whole point. */
  onPlayChords: (chords: number[][]) => void;
  onEnter: () => void;
  onLeave: () => void;
}

/**
 * The card that appears beside whatever the pointer is resting on.
 *
 * It is the one place in the app where the analysis is spelled out rather than
 * abbreviated: a Roman numeral is a claim about which notes are sounding and in
 * what key, and the ribbon has room for neither. Everything it shows is already
 * in pieces.json — the chord tones and the scales are worked out by music21 at
 * build time, so nothing here has to know what a numeral means.
 */
export default function Inspector({ piece, target, onPlay, onPlayChords, onEnter, onLeave }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(180);
  useLayoutEffect(() => {
    if (box.current) setH(box.current.offsetHeight);
  }, [target]);

  const r = target.rect;
  const W = WIDTH[target.kind];
  // Beside it, and on whichever side has room.
  const right = r.right + GAP + W < window.innerWidth;
  const left = right ? r.right + GAP : Math.max(8, r.left - GAP - W);
  const top = Math.max(8, Math.min(r.top + r.height / 2 - h / 2, window.innerHeight - h - 8));

  let body: React.ReactNode = null;

  if (target.kind === "chord" || target.kind === "note") {
    const c = target.kind === "chord" ? target.chord : chordAt(piece, target.beat);
    if (!c) return null;
    const midis = c.pcs.map(midiOfPitch);

    // Which chord tone the hovered note is. lib/harmony.ts decides, not this
    // file: the same answer colours the notehead in the score, and a card that
    // disagreed with the colour under the pointer would be the worst of both.
    let hi: number | undefined;
    if (target.kind === "note") {
      const i = memberOf(c, target.pitch);
      if (i >= 0) hi = i;
    }

    body = (
      <>
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-[1.15rem] leading-none">
            {target.kind === "note" ? prettyPitch(target.pitch) : <Figure c={c} />}
          </span>
          {/* On a note card the numeral is context, so it goes quietly on the right. */}
          {target.kind === "note" && (
            <span className="text-[0.9rem] leading-none text-[var(--ink-mute)]">
              <Figure c={c} />
            </span>
          )}
        </p>

        {target.kind === "note" && (
          <Row label="in the chord">
            {hi === undefined ? (
              // Named for what is actually known. It used to read "passing or
              // neighbour tone", which is a guess at *which kind* — and the two
              // named are the two this cannot yet tell apart, since that needs
              // voices and notes[] has none. Said in the colour the notehead is
              // wearing, so the card and the score are visibly one claim.
              <span className="italic" style={{ color: "var(--nct)" }}>
                non-chord tone
              </span>
            ) : (
              degreeName(c.dg[hi])
            )}
          </Row>
        )}
        <Row label="key">{c.key}</Row>
        <Row label="function">
          <span style={{ color: `var(--fn-${c.fn.toLowerCase()})` }}>{FN_LABEL[c.fn]}</span>
        </Row>
        {target.kind === "chord" && (
          <Row label="confidence">
            <span className="tnum font-[var(--mono)]">{Math.round(c.conf * 100)}%</span>
          </Row>
        )}

        <div className="mt-2.5 flex justify-center text-[var(--ink)]">
          <MiniStaff pitches={c.pcs} highlight={hi} onPlay={(m) => onPlay([m])} />
        </div>
        <PlayButton label="Play chord" onClick={() => onPlay(midis)} />
      </>
    );
  } else if (target.kind === "cadence") {
    const cad = target.cadence;
    const a = piece.chords[cad.from];
    const b = piece.chords[cad.to];
    if (!a || !b) return null;
    const pair = [a, b];

    body = (
      <>
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-[1.05rem] leading-tight" style={{ color: "var(--cad)" }}>
            {CADENCE_NAME[cad.type]} cadence
          </span>
          <span className="smallcaps shrink-0 text-[var(--ink-mute)]">bar {cad.bar}</span>
        </p>

        <Row label="chords">
          <span className="whitespace-nowrap">
            <Figure c={a} />
            <span className="mx-1.5 text-[var(--ink-mute)]">→</span>
            <Figure c={b} />
          </span>
        </Row>
        <Row label="key">{cad.key}</Row>

        {/* Both chords at their natural size, each playable a note at a time —
            the same gesture as the other cards, so a notehead means the same
            thing everywhere. Not `fit`: that stretches each staff to its half of
            the card and prints a cadence at twice the size of the chord card's
            staff, which reads as a different kind of object rather than the same
            one twice. */}
        <div className="mt-2 flex items-center justify-center gap-1 text-[var(--ink)]">
          <MiniStaff pitches={a.pcs} onPlay={(m) => onPlay([m])} />
          <span className="shrink-0 text-[0.8rem] text-[var(--ink-mute)]">→</span>
          <MiniStaff pitches={b.pcs} onPlay={(m) => onPlay([m])} />
        </div>
        <PlayButton
          label="Play cadence"
          onClick={() => onPlayChords(pair.map((c) => c.pcs.map(midiOfPitch)))}
        />
        <p className="mt-2 text-[0.68rem] leading-snug text-[var(--ink-soft)]">
          {CADENCE_GLOSS[cad.type]}
        </p>
      </>
    );
  } else {
    const scale = piece.scales?.[target.key] ?? [];
    const minor = target.key.endsWith("minor");
    body = (
      <>
        <p className="text-[1.15rem] leading-none">{prettyPitch(target.key)}</p>
        <Row label="scale">{minor ? "natural minor" : "major"}</Row>
        <Row label="notes">
          <span className="font-[var(--mono)] text-[0.68rem]">
            {scale.slice(0, 7).map((p) => prettyPitch(p).replace(/\d/g, "")).join(" ")}
          </span>
        </Row>
        <div className="mt-2.5 text-[var(--ink)]">
          <MiniStaff pitches={scale} mode="sequence" fit onPlay={(m) => onPlay([m])} />
        </div>
        <PlayButton label="Play scale" onClick={() => onPlay(scale.map(midiOfPitch), 0.26)} />
      </>
    );
  }

  return (
    <div
      ref={box}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      style={{ left, top, width: W }}
      className="fixed z-50 rounded-[4px] border border-[var(--rule-strong)] bg-[var(--paper)] px-3.5 py-3 shadow-[0_6px_24px_var(--wash)]"
      role="dialog"
    >
      {body}
      <p className="mt-2 text-[0.62rem] leading-snug text-[var(--ink-mute)]">
        Click a notehead to hear it.
      </p>
    </div>
  );
}
