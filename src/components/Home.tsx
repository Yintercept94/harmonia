import { useMemo, useState } from "react";
import type { CorpusIndex } from "@/lib/music";
import {
  active, applyFilters, clear, foldRows, sortPieces, toggle,
  type FacetKey, type Filters, type Sort,
} from "@/lib/facets";
import FiltersPanel from "@/components/Facets";
import Chips from "@/components/Chips";
import PieceList from "@/components/PieceList";

const SORTS: { id: Sort; label: string }[] = [
  { id: "alpha", label: "A–Z" },
  { id: "date", label: "date" },
  { id: "composer", label: "composer" },
];

/**
 * The listing, and above it a search box, a sort, and one button.
 *
 * It used to be a browse: six facet cards on the front door, each opening its
 * own page. Every filter therefore cost a navigation out and a Back in, which
 * made picking two of them a chore and picking three unthinkable. The facets are
 * the same; they now live behind `Filters`, all six at once, in the flow of the
 * page, with the list still visible underneath reacting to what you choose.
 */
export default function Home({
  index, filters, open, onFilters, onOpenFolder, onOpen,
}: {
  index: CorpusIndex;
  filters: Filters;
  open: string[];
  onFilters: (f: Filters, replace?: boolean) => void;
  onOpenFolder: (collection: string) => void;
  onOpen: (id: string) => void;
}) {
  const [showFilters, setShowFilters] = useState(false);

  const matched = useMemo(() => applyFilters(index, filters), [index, filters]);
  const rows = useMemo(
    () => foldRows(sortPieces(matched, index, filters.sort), index, filters),
    [matched, index, filters],
  );
  const chips = active(filters);

  // What the search box says it will search. "Everything" is a lie once a
  // composer is picked, and a placeholder that lies is worse than none.
  const scope = useMemo(() => {
    const names = filters.composer.map((id) => index.composers[id]?.name).filter(Boolean);
    const all = [...names, ...filters.period, ...filters.genre];
    return all.length
      ? `Search within ${all.slice(0, 2).join(" · ")}…`
      : "Search composer, title, key…";
  }, [filters, index]);

  const set = (f: Filters) => onFilters(f);

  return (
    <div className="mx-auto max-w-[1000px] px-6 pb-24 sm:px-10">
      <header className="pt-14 pb-7">
        <h1 className="text-[2.4rem] leading-[1.05] sm:text-[3.1rem]" style={{ letterSpacing: "-0.02em" }}>
          Harmonic analysis of <em className="italic">{index.pieces.length}</em> scores.
        </h1>
        <p className="mt-3 font-[var(--mono)] text-[0.72rem] text-[var(--ink-mute)]">
          {new Set(index.pieces.map((p) => p.composerId)).size} composers ·{" "}
          {index.pieces.filter((p) => p.hasAnalysis).length} with a human analysis
        </p>
      </header>

      <div className="rule-b flex flex-wrap items-center justify-between gap-3 pb-3">
        <div className="flex flex-1 items-center gap-2">
          <input
            value={filters.q}
            // Replaced rather than pushed: one history entry per keystroke makes
            // the back button useless.
            onChange={(e) => onFilters({ ...filters, q: e.target.value }, true)}
            placeholder={scope}
            aria-label="Search pieces"
            className="w-full max-w-[22rem] rounded-[3px] border border-[var(--rule)] bg-transparent px-3 py-1.5 text-[0.92rem] outline-none placeholder:text-[var(--ink-mute)] focus:border-[var(--ink-mute)]"
          />
          <button
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className={`smallcaps shrink-0 rounded-[3px] border px-3 py-1.5 transition-colors ${
              showFilters || chips.length
                ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                : "border-[var(--rule)] text-[var(--ink-soft)] hover:border-[var(--ink-mute)]"
            }`}
          >
            Filters{chips.length ? ` · ${chips.length}` : ""}
          </button>
        </div>
        <div className="flex items-center gap-1">
          <span className="smallcaps mr-1 text-[var(--ink-mute)]">Sort</span>
          {SORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => set({ ...filters, sort: s.id })}
              className={`smallcaps rounded-[3px] px-2 py-1 transition-colors ${
                filters.sort === s.id
                  ? "bg-[var(--ink)] text-[var(--paper)]"
                  : "text-[var(--ink-soft)] hover:bg-[var(--paper-2)]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {showFilters && (
        <FiltersPanel index={index} filters={filters}
                      onToggle={(k, id) => set(toggle(filters, k, id))} />
      )}

      {/* With the panel shut the chips are the only account of what is filtering,
          and the only way to drop one without opening it again. */}
      <Chips
        index={index}
        filters={filters}
        onRemove={(k: FacetKey, id: string) => set(toggle(filters, k, id))}
        onClear={() => set(clear(filters))}
      />

      <p className="py-3 font-[var(--mono)] text-[0.7rem] text-[var(--ink-mute)]">
        {matched.length} {matched.length === 1 ? "piece" : "pieces"}
        {rows.length !== matched.length && ` · ${rows.length} rows`}
      </p>

      <PieceList
        rows={rows}
        index={index}
        sort={filters.sort}
        open={open}
        onToggle={onOpenFolder}
        onOpen={onOpen}
        showComposer={filters.composer.length !== 1}
      />

      {rows.length === 0 && (
        <p className="py-10 text-[0.92rem] text-[var(--ink-mute)]">
          Nothing matches.{" "}
          <button className="underline decoration-dotted" onClick={() => set(clear(filters))}>
            Clear the filters
          </button>{" "}
          and start again.
        </p>
      )}
    </div>
  );
}
