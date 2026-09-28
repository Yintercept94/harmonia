import { useMemo } from "react";
import {
  ACCIDENTAL,
  UNITS_PER_SPACE,
  accidentalLanes,
  glyph,
  ledgers,
  parsePitch,
  seconds,
  staffFor,
  type Pitch,
} from "@/lib/notation";

const SPACE = 10; // px between staff lines
const K = SPACE / UNITS_PER_SPACE; // px per Bravura unit
const HEAD_W = 422 * K; // notehead advance
const ACC_W = 0.95 * SPACE;
const PAD_T = 3.6 * SPACE; // room above the top line for two ledger lines
const PAD_B = 3.6 * SPACE; // and the same below the bottom one
const STAFF_H = 4 * SPACE; // five lines span four spaces
const CLEF_X = 3;
const CLEF_W = 2.7 * SPACE; // a G clef is about this wide, and an F clef narrower
const COL_GAP = 1.95 * SPACE; // room for the next note's accidental as well

interface Props {
  /** Spelled pitches, e.g. ["F#4", "A4", "D5"]. */
  pitches: string[];
  /** Stack them as a chord, or lay them out left to right as a scale. */
  mode?: "chord" | "sequence";
  /** Index of the note to pick out in colour. */
  highlight?: number;
  /** Scale to the width available instead of drawing at a fixed size. */
  fit?: boolean;
  onPlay?: (midi: number, index: number) => void;
}

/**
 * A chord or a scale on five lines, drawn with Verovio's own Bravura outlines.
 *
 * Whole noteheads and no stems: the card is saying *which notes*, not how long
 * they last, and a stem would only invite the wrong question.
 */
export default function MiniStaff({ pitches, mode = "chord", highlight, fit, onPlay }: Props) {
  const notes = useMemo(
    () => pitches.map(parsePitch).filter((p): p is Pitch => p !== null),
    [pitches],
  );
  const staff = useMemo(() => staffFor(notes), [notes]);

  if (!notes.length) return null;

  const top = staff.lines[4];
  const y = (step: number) => PAD_T + (top - step) * (SPACE / 2);

  // Chord: one column, seconds pushed aside. Scale: one note per column.
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].step - notes[b].step);
  const shift: number[] = notes.map(() => 0);
  if (mode === "chord") {
    const bumped = seconds(order.map((i) => notes[i].step));
    order.forEach((i, k) => (shift[i] = bumped[k]));
  }

  const accLane: number[] = notes.map(() => 0);
  if (mode === "chord") {
    const lanes = accidentalLanes(
      order.map((i) => notes[i].step),
      order.map((i) => notes[i].alter !== 0),
    );
    order.forEach((i, k) => (accLane[i] = lanes[k]));
  }

  // Accidentals are printed to the left of their notehead, so the first column
  // has to start far enough right to leave room for however many stack up.
  const maxAcc = Math.max(0, ...accLane) + 1;
  const accRoom = notes.some((n) => n.alter !== 0) ? maxAcc * ACC_W + 2 : 0;
  const firstX = CLEF_X + CLEF_W + 0.9 * SPACE + accRoom;
  const colX = (i: number) => (mode === "chord" ? firstX : firstX + i * (HEAD_W + COL_GAP));
  const lastX = colX(mode === "chord" ? 0 : notes.length - 1);
  const width = lastX + HEAD_W * 2 + 6;
  // The staff itself has to be in here as well as the margins either side of it,
  // or the bottom lines fall outside the viewBox and are simply not drawn.
  const height = PAD_T + STAFF_H + PAD_B;
  const lineX2 = width - 3;

  // Ledger lines are shared by every note that needs them, so draw the set once.
  const drawn = new Set<string>();

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={fit ? undefined : width}
      height={fit ? undefined : height}
      style={fit ? { width: "100%", height: "auto" } : undefined}
      className="block max-w-full"
      role="img"
      aria-label={pitches.join(" ")}
    >
      {staff.lines.map((s) => (
        <line
          key={s}
          x1={2}
          x2={lineX2}
          y1={y(s)}
          y2={y(s)}
          stroke="currentColor"
          strokeWidth={0.9}
          opacity={0.75}
        />
      ))}

      <path
        d={glyph(staff.clef)}
        transform={`translate(${CLEF_X}, ${y(staff.clefStep)}) scale(${K}, ${-K})`}
        fill="currentColor"
      />

      {notes.map((n, i) => {
        const cx = colX(i) + shift[i] * HEAD_W;
        const cy = y(n.step);
        const acc = ACCIDENTAL[n.alter];
        const hot = highlight === i;
        const key = `${mode === "chord" ? 0 : i}`;
        return (
          <g
            key={i}
            onClick={onPlay ? () => onPlay(n.midi, i) : undefined}
            className={onPlay ? "cursor-pointer" : undefined}
            style={{ color: hot ? "var(--playhead)" : undefined }}
          >
            {ledgers(staff, n.step).map((s) => {
              const id = `${key}:${s}`;
              if (drawn.has(id)) return null;
              drawn.add(id);
              return (
                <line
                  key={s}
                  x1={cx - 0.3 * SPACE}
                  x2={cx + HEAD_W + 0.3 * SPACE}
                  y1={y(s)}
                  y2={y(s)}
                  stroke="currentColor"
                  strokeWidth={0.9}
                  opacity={0.75}
                />
              );
            })}
            {acc && (
              <path
                d={glyph(acc)}
                transform={`translate(${cx - (accLane[i] + 1) * ACC_W - 2}, ${cy}) scale(${K}, ${-K})`}
                fill="currentColor"
              />
            )}
            <path
              d={glyph("notehead")}
              transform={`translate(${cx}, ${cy}) scale(${K}, ${-K})`}
              fill="currentColor"
            />
            {/* A notehead is a small target; the click area is a whole staff space. */}
            {onPlay && (
              <rect
                x={cx - (acc ? maxAcc * ACC_W : 2)}
                y={cy - SPACE * 0.75}
                width={HEAD_W + (acc ? maxAcc * ACC_W : 2) + 3}
                height={SPACE * 1.5}
                fill="transparent"
              >
                <title>{n.name}</title>
              </rect>
            )}
          </g>
        );
      })}
    </svg>
  );
}
