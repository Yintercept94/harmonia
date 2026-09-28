import { useEffect, useRef, useState } from "react";
import type { CorpusIndex, PieceMeta } from "@/lib/music";
import type { Row } from "@/lib/facets";
import { foldedPieces, shortTitle, type Sort } from "@/lib/facets";

/**
 * Rows rendered before the pager kicks in. The list is a plain `<ul>`, and a few
 * thousand rows of it is a slow first paint and a janky search — but a
 * virtualiser would cost a dependency and give up native find-in-page. A pager
 * keeps both: the DOM stays small, and anything you can scroll to is real.
 */
const PAGE = 120;

function Piece({
  p, index, onOpen, inFolder = "", showComposer = true,
}: {
  p: PieceMeta;
  index: CorpusIndex;
  onOpen: (id: string) => void;
  /** The collection this row is nested under, or "" when it stands alone. */
  inFolder?: string;
  showComposer?: boolean;
}) {
  return (
    <button
      onClick={() => onOpen(p.id)}
      className={`rule-b flex w-full items-baseline justify-between gap-6 py-4 text-left transition-colors hover:bg-[var(--wash)] ${
        inFolder ? "pl-6 sm:pl-10" : ""
      }`}
    >
      <span className="min-w-0">
        <span className="block text-[1.14rem] leading-snug">
          {showComposer && !inFolder && (
            <>
              <span className="text-[var(--ink-soft)]">
                {index.composers[p.composerId]?.name ?? p.composerId}
              </span>
              <span className="mx-2 text-[var(--rule-strong)]">·</span>
            </>
          )}
          <span className="italic">{shortTitle(p.title, inFolder)}</span>
        </span>
        <span className="mt-0.5 block font-[var(--mono)] text-[0.68rem] text-[var(--ink-mute)]">
          {[!inFolder && p.collection, p.catNo, p.keyName, `${p.bars} bars`]
            .filter(Boolean).join("  ·  ")}
          {p.hasAnalysis && (
            <span className="ml-2 text-[var(--fn-t)]" title="a human analysis exists">
              ✓ analysed
            </span>
          )}
        </span>
      </span>
      <span className="tnum shrink-0 font-[var(--mono)] text-[0.74rem] text-[var(--ink-mute)]">
        {p.year}
      </span>
    </button>
  );
}

/** A collection, closed. The count and the chevron are the indicator that this
 *  opens rather than navigates — and it opens in place, so nothing is left to
 *  come back from. */
function Folder({
  label, composer, note, count, open, onToggle,
}: {
  label: string;
  composer: string;
  note: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className="rule-b flex w-full items-baseline justify-between gap-6 py-4 text-left transition-colors hover:bg-[var(--wash)]"
    >
      <span className="min-w-0">
        <span className="block text-[1.14rem] leading-snug">
          <span className="text-[var(--ink-soft)]">{composer}</span>
          <span className="mx-2 text-[var(--rule-strong)]">·</span>
          {label}
        </span>
        <span className="mt-0.5 block font-[var(--mono)] text-[0.68rem] text-[var(--ink-mute)]">
          {note}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 font-[var(--mono)] text-[0.74rem] text-[var(--ink-mute)]">
        <span className="tnum">{count} pieces</span>
        <span
          aria-hidden="true"
          className="inline-block transition-transform duration-150"
          style={{ transform: `rotate(${open ? 90 : 0}deg)` }}
        >
          ›
        </span>
      </span>
    </button>
  );
}

export default function PieceList({
  rows, index, sort, open, onToggle, onOpen, showComposer = true,
}: {
  rows: Row[];
  index: CorpusIndex;
  sort: Sort;
  /** Which collections are expanded. Lives in the URL — see lib/route.ts. */
  open: string[];
  onToggle: (collection: string) => void;
  onOpen: (id: string) => void;
  /** False when one composer is selected: repeating their name down 400 rows
   *  says nothing the chip above the list has not already said. */
  showComposer?: boolean;
}) {
  const [shown, setShown] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement | null>(null);

  // A new list is a new list; showing page 7 of it would be nonsense.
  useEffect(() => setShown(PAGE), [rows]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) setShown((n) => n + PAGE);
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [rows.length]);

  const visible = rows.slice(0, shown);

  return (
    <>
      <ul>
        {visible.map((r) =>
          r.kind === "piece" ? (
            <li key={r.key}>
              <Piece p={r.piece} index={index} onOpen={onOpen} showComposer={showComposer} />
            </li>
          ) : (
            <li key={r.key}>
              <Folder
                label={r.label}
                composer={r.composer}
                note={r.note}
                count={r.pieces.length}
                open={open.includes(r.key)}
                onToggle={() => onToggle(r.key)}
              />
              {open.includes(r.key) && (
                <ul className="border-l border-[var(--rule)]">
                  {foldedPieces(r, index, sort).map((p) => (
                    <li key={p.id}>
                      <Piece p={p} index={index} onOpen={onOpen} inFolder={r.label} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ),
        )}
      </ul>

      <div ref={sentinel} aria-hidden="true" />

      {shown < rows.length && (
        <p className="py-6 text-center font-[var(--mono)] text-[0.7rem] text-[var(--ink-mute)]">
          {visible.length} of {rows.length}
        </p>
      )}
    </>
  );
}
