import { useMemo, useState } from "react";
import type { CorpusIndex } from "@/lib/music";
import { options, type FacetKey, type Filters, type Option } from "@/lib/facets";

/** How each group introduces itself. `also` is a second facet the group covers:
 *  key is one idea and two axes, and splitting them into separate groups would
 *  put "major" and "F#" at opposite ends of the panel. */
export const FACETS: { key: FacetKey; title: string; blurb: string; also?: FacetKey }[] = [
  { key: "composer", title: "Composer", blurb: "filed by surname" },
  { key: "period", title: "Period", blurb: "Renaissance to Modern" },
  { key: "genre", title: "Genre", blurb: "chorale, lied, quartet, sonata…" },
  { key: "tonic", title: "Key", blurb: "tonic and mode", also: "mode" },
  { key: "length", title: "Length", blurb: "a chorale or a quartet movement" },
  { key: "analysis", title: "Analysis", blurb: "with a human reading to check against" },
];

/** Facets whose collapsed preview is "the biggest five". The rest have an order
 *  of their own — chronological, ascending, tonic by tonic — and shuffling them
 *  by count would put "129 bars and over" above "65 to 128". */
const PREVIEW_BY_COUNT = new Set<FacetKey>(["composer", "genre"]);

const PREVIEW = 5;

/** Above this many values an expanded group gets a filter box of its own; below
 *  it, one would just be furniture. Composers cross it; genres never will. */
const SEARCHABLE_AT = 24;

function Row({ opt, on, onToggle }: { opt: Option; on: boolean; onToggle: () => void }) {
  // Zeroes are shown and disabled rather than hidden. A list that shrinks as you
  // filter hides the shape of the corpus; "no Renaissance piano sonatas" is a
  // true and useful thing to be able to read off the page.
  const dead = opt.count === 0 && !on;
  return (
    <li className="break-inside-avoid">
      <button
        onClick={onToggle}
        disabled={dead}
        aria-pressed={on}
        className={`flex w-full items-baseline justify-between gap-4 rounded-[3px] px-2 py-1.5 text-left transition-colors ${
          on ? "bg-[var(--ink)] text-[var(--paper)]"
             : dead ? "cursor-default text-[var(--rule-strong)]"
                    : "hover:bg-[var(--paper-2)]"
        }`}
      >
        <span className="min-w-0 text-[0.92rem]">
          {opt.label}
          {opt.note && (
            <span className={`ml-2 font-[var(--mono)] text-[0.66rem] ${on ? "opacity-70" : "text-[var(--ink-mute)]"}`}>
              {opt.note}
            </span>
          )}
        </span>
        <span className={`tnum shrink-0 font-[var(--mono)] text-[0.7rem] ${on ? "opacity-70" : "text-[var(--ink-mute)]"}`}>
          {opt.count}
        </span>
      </button>
    </li>
  );
}

/** One group inside the panel. "all 40" expands it **in place** — the whole
 *  point of the panel is that choosing a filter never navigates anywhere. */
function Group({
  index, filters, spec, onToggle,
}: {
  index: CorpusIndex;
  filters: Filters;
  spec: { key: FacetKey; title: string; blurb: string; also?: FacetKey };
  onToggle: (key: FacetKey, id: string) => void;
}) {
  const { key, title, blurb, also } = spec;
  const [expanded, setExpanded] = useState(false);
  const [q, setQ] = useState("");

  const all = useMemo(() => options(index, filters, key), [index, filters, key]);
  const extra = useMemo(() => (also ? options(index, filters, also) : []),
                        [index, filters, also]);

  const needle = q.trim().toLowerCase();
  const listed = expanded
    ? (needle ? all.filter((o) => o.label.toLowerCase().includes(needle)) : all)
    : PREVIEW_BY_COUNT.has(key)
      ? [...(also ? extra : all)].sort((a, b) => b.count - a.count).slice(0, PREVIEW)
      : (also ? extra : all).slice(0, PREVIEW);

  return (
    <section className="break-inside-avoid">
      <div className="rule-b pb-1.5">
        <h3 className="text-[1.05rem]">{title}</h3>
        <p className="font-[var(--mono)] text-[0.66rem] text-[var(--ink-mute)]">{blurb}</p>
      </div>

      {/* The mode rows stay visible when the tonic list is expanded — they are
          two halves of the same question. */}
      {also && expanded && (
        <ul className="mt-1.5 flex flex-wrap gap-x-6">
          {extra.map((o) => (
            <Row key={o.id} opt={o} on={filters[also].includes(o.id)}
                 onToggle={() => onToggle(also, o.id)} />
          ))}
        </ul>
      )}

      {expanded && all.length > SEARCHABLE_AT && (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Filter ${title.toLowerCase()}…`}
          aria-label={`Filter the ${title.toLowerCase()} list`}
          className="mt-2 w-full rounded-[3px] border border-[var(--rule)] bg-transparent px-2.5 py-1 text-[0.88rem] outline-none placeholder:text-[var(--ink-mute)] focus:border-[var(--ink-mute)]"
        />
      )}

      <ul className={`mt-1.5 ${expanded && all.length > 12 ? "max-h-[19rem] overflow-y-auto pr-1" : ""}`}>
        {listed.map((o) => {
          const k = expanded || !also ? key : also;
          return (
            <Row key={o.id} opt={o} on={filters[k].includes(o.id)}
                 onToggle={() => onToggle(k, o.id)} />
          );
        })}
      </ul>

      {(also || all.length > PREVIEW) && (
        <button
          onClick={() => { setExpanded((v) => !v); setQ(""); }}
          className="smallcaps mt-1 px-2 text-[var(--ink-mute)] underline decoration-dotted transition-colors hover:text-[var(--ink)]"
        >
          {expanded ? "fewer" : `all ${all.length}`}
        </button>
      )}
    </section>
  );
}

/** Every facet at once, in the flow of the page, above the list it is filtering.
 *  Nothing in here navigates: you pick, the list behind updates, the panel stays
 *  where it is. */
export default function FiltersPanel({
  index, filters, onToggle,
}: {
  index: CorpusIndex;
  filters: Filters;
  onToggle: (key: FacetKey, id: string) => void;
}) {
  return (
    <div className="rule-b grid gap-x-10 gap-y-7 py-6 sm:grid-cols-2 lg:grid-cols-3">
      {FACETS.map((spec) => (
        <Group key={spec.key} index={index} filters={filters} spec={spec} onToggle={onToggle} />
      ))}
    </div>
  );
}
