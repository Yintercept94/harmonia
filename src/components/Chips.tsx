import type { CorpusIndex } from "@/lib/music";
import { active, ANALYSIS, LENGTHS, type FacetKey, type Filters } from "@/lib/facets";

/** What a selected value is called once it is off its own list and standing in a
 *  row of chips. Ids are short for the URL's sake; a chip has to read as English. */
function label(index: CorpusIndex, key: FacetKey, id: string): string {
  if (key === "composer") return index.composers[id]?.name ?? id;
  if (key === "length") return LENGTHS.find((b) => b.id === id)?.label ?? id;
  if (key === "analysis") return ANALYSIS.find((a) => a.id === id)?.label ?? id;
  if (key === "tonic" || key === "mode") return `${id} key`;
  return id;
}

/**
 * The active selections, as removable chips. This is the breadcrumb and the undo
 * in one, and it is what makes a stacked filter comprehensible: at any moment
 * the screen states, in words, exactly what it is showing.
 */
export default function Chips({
  index, filters, onRemove, onClear,
}: {
  index: CorpusIndex;
  filters: Filters;
  onRemove: (key: FacetKey, id: string) => void;
  onClear: () => void;
}) {
  const chips = active(filters);
  if (!chips.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 py-3">
      {chips.map(({ key, id }) => (
        <button
          key={`${key}:${id}`}
          onClick={() => onRemove(key, id)}
          className="group flex items-center gap-1.5 rounded-[3px] border border-[var(--rule-strong)] px-2 py-1 text-[0.78rem] transition-colors hover:border-[var(--ink)]"
        >
          <span className="smallcaps text-[var(--ink-mute)]">{key}</span>
          <span>{label(index, key, id)}</span>
          <span aria-hidden="true" className="text-[var(--ink-mute)] group-hover:text-[var(--ink)]">×</span>
          <span className="sr-only">remove filter</span>
        </button>
      ))}
      {chips.length > 1 && (
        <button
          onClick={onClear}
          className="smallcaps text-[var(--ink-mute)] underline decoration-dotted transition-colors hover:text-[var(--ink)]"
        >
          clear all
        </button>
      )}
    </div>
  );
}
