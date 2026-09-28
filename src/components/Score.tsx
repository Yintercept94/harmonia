import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Piece, RawChord } from "@/lib/music";
import type { Engraved, EngravedSystem } from "@/lib/engraved";
import { beatAt, loadEngraved, locate, xAt } from "@/lib/engraved";
import { NOTE_ID, markNonChordTones } from "@/lib/harmony";
import type { Cadence } from "@/lib/cadence";
import { findCadences } from "@/lib/cadence";
import type { Player } from "@/lib/playback";
import Inspector, { type Target } from "@/components/Inspector";

// Room reserved under the staves by tools/engrave.py's bottom page margin, and
// how it is divided. Measured rather than chosen: the notation ends 39 units
// above the foot of a system, the key marks already overlap the last of it, and
// what is left below the numerals is 3.6 units on every system of every piece —
// the numeral baseline is fixed and its largest figure is a known size. The
// cadence lane is 2.5 of those 3.6. There is no more room down here without
// raising BOTTOM in tools/engrave.py and re-engraving the corpus (§5.3).
const RIBBON_Y = 26; // px above the foot of a system
const LABEL_Y = 8;
const RIBBON_H = 4;
const KEY_Y = 4; // key mark sits this far above the ribbon
const CAD_Y = 3.3; // cadence bar, this far above the foot
const CAD_H = 2.5;
const CAD_HIT = 6; // its pointer target reaches up into the numerals' descenders
// Everything that either opens the card or should keep it open.
const HOVERABLE = "g.note, [data-hover], [role=dialog]";
// Cadence bars are drawn last and so sit on top of the chord targets they
// overlap; `closest()` walks up from the deepest hit, which is the cadence.
const DWELL = 1000; // ms the pointer must rest on something before the card opens

/** "G major" -> "G:", "c# minor" -> "c#:" — the usual analytical shorthand,
 *  capital for major and lower case for minor. Only the letter carries the case:
 *  upper-casing the whole tonic turns A flat into "AB". */
function keyMark(name: string): string {
  const [tonic, mode] = name.split(" ");
  const letter = mode === "minor" ? tonic[0].toLowerCase() : tonic[0].toUpperCase();
  return letter + tonic.slice(1) + ":";
}

interface Props {
  piece: Piece;
  player: Player;
  follow: boolean;
  onSeek: (beat: number) => void;
}

/**
 * The analysis, drawn over one engraved system.
 *
 * A Roman numeral only means something relative to a key, and the model changes
 * its mind about the key as the music modulates — eleven times in the Beethoven.
 * So the key is printed above the ribbon wherever it changes, and again at the
 * start of every system, since a reader who scrolls into the middle of a piece
 * has not seen the last change.
 *
 * Memoised, and that matters: this is a few hundred elements per system, and
 * without it every playhead frame reconciled all of them on every mounted
 * system. On Maple Leaf Rag that starved the audio scheduler badly enough to
 * stretch its 40 ms tick to 159 ms, and notes scheduled inside a stall arrive
 * late and bunched. Nothing here handles the pointer: each target is marked with
 * a data attribute and one listener on the score reads it, which keeps this
 * component a pure function of the piece and the system.
 */
const Labels = memo(function Labels({
  piece,
  sys,
  cadences,
}: {
  piece: Piece;
  sys: EngravedSystem;
  cadences: Cadence[];
}) {
  const ribbonY = sys.h - RIBBON_Y;
  const labelY = sys.h - LABEL_Y;
  const keys: { x: number; key: string }[] = [];
  let shown = ""; // the key printed so far on this system

  const labels = piece.chords.map((c: RawChord, i: number) => {
    const on = Math.max(c.on, sys.from);
    const end = Math.min(c.end, sys.to);
    if (end - on < 1e-6) return null;
    const a = xAt(sys, on);
    const b = xAt(sys, end);
    if (a === null || b === null || b - a < 1) return null;
    if (c.key !== shown) keys.push({ x: a + 1, key: c.key });
    shown = c.key;
    const w = Math.max(b - a - 2, 2);
    const mid = a + (b - a) / 2;
    // Shrink the numeral to fit its span; below ~7.5px it would be unreadable,
    // so the ribbon carries the information alone.
    const glyphs = c.rn.length + (c.sup || c.sub ? 0.7 : 0);
    const fs = Math.min(14, (w - 3) / (glyphs * 0.56));
    const figX = mid + fs * 0.28 * c.rn.length + 1.6;
    return (
      <g key={i} data-hover="chord" data-chord={i}>
        {/* The ribbon is four pixels tall and the numeral under it is smaller
            still; the band between them is the target you actually aim at. */}
        <rect x={a} y={ribbonY - 1} width={b - a} height={RIBBON_Y + 1} fill="transparent" />
        <rect x={a + 1} y={ribbonY} width={w} height={RIBBON_H} rx={2} fill={`var(--fn-${c.fn.toLowerCase()})`} />
        {fs >= 7.5 && (
          <>
            <text
              x={c.sup || c.sub ? mid - 2.4 : mid}
              y={labelY}
              textAnchor="middle"
              fontSize={fs}
              className="fill-[var(--ink)] font-[var(--serif)]"
            >
              {c.rn}
            </text>
            {c.sup && (
              <text x={figX} y={labelY - 0.42 * fs} fontSize={fs * 0.58} className="fill-[var(--ink)] font-[var(--serif)]">
                {c.sup}
              </text>
            )}
            {c.sub && (
              <text x={figX} y={labelY + 0.2 * fs} fontSize={fs * 0.58} className="fill-[var(--ink)] font-[var(--serif)]">
                {c.sub}
              </text>
            )}
          </>
        )}
      </g>
    );
  });

  // One bar per cadence, spanning both its chords, in its own lane under the
  // numerals. Clipped to the system like the ribbon is, so a cadence that falls
  // across a line break draws its half on each — the alternative is a bar that
  // runs off the edge of one system and never appears on the next.
  const cadY = sys.h - CAD_Y - CAD_H;
  const cads = cadences.map((cad, i) => {
    const on = Math.max(cad.on, sys.from);
    const end = Math.min(cad.end, sys.to);
    if (end - on < 1e-6) return null;
    const a = xAt(sys, on);
    const b = xAt(sys, end);
    if (a === null || b === null || b - a < 1) return null;
    return (
      <g key={`cad${i}`} data-hover="cadence" data-cadence={i}>
        <rect x={a} y={sys.h - CAD_HIT} width={b - a} height={CAD_HIT} fill="transparent" />
        <rect x={a + 1} y={cadY} width={Math.max(b - a - 2, 2)} height={CAD_H} rx={CAD_H / 2} fill="var(--cad)" />
      </g>
    );
  });

  // Key marks and cadence bars are siblings of the labels, not children: moving
  // between a numeral and the key above it should swap the card, not close it.
  return (
    <>
      {labels}
      {keys.map((k, i) => (
        <g key={`k${i}`} data-hover="key" data-key={k.key}>
          <rect x={k.x - 2} y={ribbonY - KEY_Y - 10} width={30} height={12} fill="transparent" />
          <text
            x={k.x}
            y={ribbonY - KEY_Y}
            fontSize={10}
            fontStyle="italic"
            className="fill-[var(--ink-soft)] font-[var(--serif)]"
          >
            {keyMark(k.key)}
          </text>
        </g>
      ))}
      {/* Last, so the cadence lane wins the pointer where it overlaps the
          numerals' descenders — the chord's own target covers the whole band
          down to the foot of the system. */}
      {cads}
    </>
  );
});

export default function Score({ piece, player, follow, onSeek }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [eng, setEng] = useState<Engraved | null>(null);
  const [seen, setSeen] = useState<Set<number>>(() => new Set());
  // Only the *index* is React state; the playhead's x never is.
  const [headSys, setHeadSys] = useState(0);
  const [target, setTarget] = useState<Target | null>(null);

  // Derived from the chords, so it costs one pass when a piece opens and nothing
  // afterwards — and `Labels` is memoised on it, so a stable array matters.
  const cadences = useMemo(() => findCadences(piece), [piece]);

  // The card waits for you to mean it. Opening on contact put a box over the
  // notation the moment the pointer crossed a numeral, and then you could not
  // reach what was underneath — moving towards it only kept the box alive. A
  // second of stillness is longer than any movement across the score and shorter
  // than a deliberate look.
  const dwell = useRef<number | null>(null);
  const dwelling = useRef<string | null>(null); // which target we are waiting on
  const shownId = useRef<string | null>(null); // which one is on screen
  const timer = useRef<number | null>(null);

  const hold = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const wait = useCallback(() => {
    if (dwell.current !== null) window.clearTimeout(dwell.current);
    dwell.current = null;
    dwelling.current = null;
  }, []);
  // Closing still waits a moment, so the pointer can cross the gap into the card
  // without it vanishing on the way.
  const close = useCallback(() => {
    if (timer.current !== null || shownId.current === null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      shownId.current = null;
      setTarget(null);
    }, 160);
  }, []);
  const show = useCallback(
    (t: Target) => {
      wait();
      hold();
      shownId.current = t.id;
      setTarget(t);
    },
    [hold, wait],
  );
  const point = useCallback(
    (t: Target, now = false) => {
      if (shownId.current === t.id) return hold(); // already looking at it
      if (now) return show(t);
      if (dwelling.current === t.id) return; // already counting
      wait();
      close(); // let go of whatever is on screen while we count
      dwelling.current = t.id;
      dwell.current = window.setTimeout(() => show(t), DWELL);
    },
    [close, hold, show, wait],
  );

  useEffect(() => {
    let live = true;
    setEng(null);
    setSeen(new Set());
    setHeadSys(0);
    setTarget(null);
    shownId.current = null;

    // The non-chord tones are marked into the markup here, once, rather than by
    // walking the mounted DOM afterwards — see markNonChordTones for why that
    // distinction is load-bearing rather than stylistic.
    loadEngraved(piece.id).then((e) => {
      if (!live) return;
      setEng({ ...e, systems: e.systems.map((s) => ({ ...s, svg: markNonChordTones(s.svg, piece) })) });
    });
    return () => {
      live = false;
    };
    // `piece`, not `piece.id`: the marking reads its chords, so a stale closure
    // here would colour one piece's notation with another's harmony. App.tsx
    // fetches a piece once per id, so this is not an extra load.
  }, [piece]);

  useEffect(() => () => { hold(); wait(); }, [hold, wait]);

  // One listener drives the whole thing: on every move, work out what is under
  // the pointer and let `point` decide. Nothing uses pointerenter or
  // pointerleave, and not for want of trying — leaving a notehead fires neither
  // in some browsers, and the card then sticks to the screen until you reload.
  // Asking "what is under the pointer" cannot be dodged that way, and it costs
  // one closest() call per move.
  useEffect(() => {
    if (!eng) return;

    const targetAt = (n: EventTarget | null): Target | null => {
      const el = (n as Element | null)?.closest?.(HOVERABLE) as (HTMLElement & SVGElement) | null;
      if (!el || el.getAttribute("role") === "dialog") return null;
      const rect = () => el.getBoundingClientRect();
      if (el.matches("g.note")) {
        const m = NOTE_ID.exec(el.id);
        if (!m) return null;
        // Beside the notehead, not beside the group: a note carries its stem, its
        // accidental and any lyric under it, and a box round all of that would put
        // the card somewhere the eye is not.
        const box = (el.querySelector(".notehead") ?? el).getBoundingClientRect();
        return { id: el.id, kind: "note", pitch: m[1], beat: Number(m[2]), rect: box };
      }
      if (el.dataset.hover === "chord") {
        const i = Number(el.dataset.chord);
        const c = piece.chords[i];
        return c ? { id: `c${i}`, kind: "chord", chord: c, rect: rect() } : null;
      }
      if (el.dataset.hover === "cadence") {
        const i = Number(el.dataset.cadence);
        const cad = cadences[i];
        // A cadence broken across a line break draws a bar on each system, so the
        // id carries where it is as well as which one it is — otherwise crossing
        // from one half to the other would not reopen the card beside the half
        // the pointer is actually on.
        const r = rect();
        return cad
          ? { id: `cad${i}@${Math.round(r.left)}`, kind: "cadence", cadence: cad, rect: r }
          : null;
      }
      const k = el.dataset.key;
      const r = rect();
      return k ? { id: `k${k}@${Math.round(r.left)},${Math.round(r.top)}`, kind: "key", key: k, rect: r } : null;
    };

    const move = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.(HOVERABLE);
      if (el?.getAttribute("role") === "dialog") return hold(); // the pointer is in the card
      const t = targetAt(e.target);
      if (!t) {
        wait();
        return close();
      }
      point(t);
    };
    // A touch screen has no hover to time, so a tap is the whole gesture.
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return move(e);
      const t = targetAt(e.target);
      if (t) point(t, true);
      else {
        wait();
        close();
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      wait();
      hold();
      shownId.current = null;
      setTarget(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", esc);
    };
  }, [eng, piece, cadences, point, close, hold, wait]);

  // One SVG per system, mounted as it nears the viewport. A single SVG for a
  // whole movement can exceed 16,000 px, which browsers cannot rasterise as one
  // layer — the score then paints as a blank page.
  useEffect(() => {
    const root = wrap.current;
    if (!eng || !root) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(new Set(eng.systems.map((_, i) => i)));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting);
        if (!hit.length) return;
        for (const e of hit) io.unobserve(e.target);
        setSeen((prev) => {
          const next = new Set(prev);
          for (const e of hit) next.add(Number((e.target as HTMLElement).dataset.sys));
          return next;
        });
      },
      { rootMargin: "700px 0px" },
    );
    root.querySelectorAll<HTMLElement>("[data-sys]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [eng]);

  // The playhead moves by writing one CSS transform per frame, outside React.
  // A percentage transform on a full-width element is resolution-independent, and
  // because the element is promoted to its own layer the move is compositor-only:
  // no repaint of the notation underneath. That is what the dense pieces needed —
  // repainting Joplin's 1,100 glyphs per frame was starving the audio scheduler.
  // A React render only happens when the playhead crosses into another system.
  useEffect(() => {
    if (!eng) return;
    let raf = 0;
    let at = -1;
    let top = 0;
    let lastX = -1;
    let lastFrame = 0;
    const frame = (now: number) => {
      // ~30 fps is indistinguishable for a line moving this slowly, and halves
      // the compositing work on dense scores.
      if (now - lastFrame < 30) {
        raf = requestAnimationFrame(frame);
        return;
      }
      lastFrame = now;
      const el = head.current;
      const h = locate(eng, player.beat);
      if (!el) {
        raf = requestAnimationFrame(frame);
        return;
      }
      if (!h) {
        el.style.visibility = "hidden";
        raf = requestAnimationFrame(frame);
        return;
      }
      if (h.index !== at) {
        at = h.index;
        setHeadSys(h.index);
        // Height and vertical offset only change when the system does.
        const slot = wrap.current?.querySelector<HTMLElement>(`[data-sys="${h.index}"]`);
        if (slot) {
          const scale = slot.clientWidth / eng.w;
          top = slot.offsetTop + 4 * scale;
          el.style.height = `${(h.sys.h - RIBBON_Y + RIBBON_H - 4) * scale}px`;
        }
        el.style.visibility = "visible";
      }
      // Writing an unchanged transform still costs a composite; skip it.
      const x = (h.x / eng.w) * 100;
      if (Math.abs(x - lastX) > 0.02) {
        lastX = x;
        el.style.transform = `translate3d(${x}%, ${top}px, 0)`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [eng, player]);

  // Keep the playhead on screen, but only when it changes system — scrolling
  // every frame would fight the user and thrash layout.
  useEffect(() => {
    if (!follow || !eng) return;
    const el = wrap.current?.querySelector<HTMLElement>(`[data-sys="${headSys}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 80 || r.bottom > window.innerHeight - 20) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [headSys, follow, eng]);

  if (!eng) return <div className="py-16 text-center text-[0.84rem] text-[var(--ink-mute)]">Engraving…</div>;
  if (!eng.systems.length)
    return <div className="py-16 text-center text-[0.84rem] text-[var(--ink-mute)]">No engraving for this piece.</div>;

  const seek = (e: React.PointerEvent<HTMLDivElement>, sys: EngravedSystem) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(beatAt(sys, ((e.clientX - r.left) / r.width) * eng.w));
  };

  return (
    <div
      ref={wrap}
      className="relative select-none"
      role="img"
      aria-label={`${piece.composer}, ${piece.title} — score with harmonic analysis`}
    >
      {/* The playhead is a full-width element shifted right by a percentage, so at
          the end of a system its right edge sits at 200% — which the page counts
          as content and lets you scroll to, half of it blank. Clipping it to the
          score box costs nothing and keeps the transform resolution-independent. */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        <div
          ref={head}
          className="absolute left-0 top-0 w-full"
          style={{ visibility: "hidden", willChange: "transform" }}
        >
          <div className="absolute left-0 top-0 h-full w-[1.5px] bg-[var(--playhead)]" />
          <div
            className="absolute left-[-3.5px] top-0 h-[7px] w-[8.5px] bg-[var(--playhead)]"
            style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
          />
        </div>
      </div>

      {eng.systems.map((sys, i) => (
        // Percentage padding reserves the system's height whether or not it is
        // mounted, and gives the absolutely-placed children a definite height.
        // Seeking lives here rather than on either child, so dragging works over
        // the notation and the ribbon alike.
        <div
          key={i}
          data-sys={i}
          className="cursor-col-resize touch-none"
          style={{ position: "relative", paddingTop: `${(sys.h / eng.w) * 100}%` }}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            seek(e, sys);
          }}
          onPointerMove={(e) => dragging.current && seek(e, sys)}
          onPointerUp={(e) => {
            dragging.current = false;
            e.currentTarget.releasePointerCapture?.(e.pointerId);
          }}
          onPointerCancel={() => (dragging.current = false)}
        >
          {(seen.has(i) || i === 0 || i === headSys) && (
            <>
              <svg
                viewBox={`0 0 ${eng.w} ${sys.h}`}
                className="absolute inset-0 h-full w-full"
                aria-hidden="true"
              >
                <Labels piece={piece} sys={sys} cadences={cadences} />
              </svg>
              {/* The notation sits on top of the ribbon layer so its noteheads can
                  be hovered; everything else in it is transparent to the pointer,
                  so clicks fall through to the seek handler above. */}
              <div className="engraved absolute inset-0" dangerouslySetInnerHTML={{ __html: sys.svg }} />
            </>
          )}
        </div>
      ))}

      {target && (
        <Inspector
          piece={piece}
          target={target}
          onPlay={(midis, gap) => void player.preview(midis, gap)}
          onPlayChords={(chords) => void player.previewChords(chords)}
          onEnter={hold}
          onLeave={close}
        />
      )}
    </div>
  );
}
