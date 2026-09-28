// The URL is the state. Not a copy of it, not derived from it — the same thing.
//
// App.tsx used to hold the open piece in useState, which cost one broken back
// button. So the filters, the sort and which folders are open all serialise to
// the hash and are read back out of it, and there is exactly one place the
// current view is written down.
//
//   #/                                    the listing
//   #/?composer=schumann-r&mode=minor      filtered
//   #/?open=Winterreise%2C+D.911           with that folder expanded
//   #/piece/bach-bwv253                    an analysis
//
// **Multiple values repeat the key** — `?composer=a&composer=b` — rather than
// joining on a comma. The comma version shipped and was wrong: 83 of the 102
// collection names contain one ("Winterreise, D.911", "String Quartet, Op. 18
// no. 1"), so a value round-tripped as two values that matched nothing, and the
// list came back empty. It looked intermittent because "Chorales" has no comma.
// Repeating the key has no such reserved character, and URLSearchParams encodes
// and decodes it for us.
//
// Hash rather than History: this also has to work from a file:// URL, because
// tools/inline.mjs builds a one-file version that opens off disk (README §9).

import { EMPTY, FACET_KEYS, type Filters, type Sort } from "./facets";

export interface Route {
  view: "home" | "piece";
  /** Set when view is "piece". */
  id?: string;
  filters: Filters;
  /** Collections expanded in the listing. Here rather than in component state
   *  so that opening a piece and coming back does not close them again. */
  open: string[];
}

const SORTS: Sort[] = ["alpha", "date", "composer"];

export function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const params = new URLSearchParams(query);

  const filters: Filters = { ...EMPTY, q: params.get("q") ?? "" };
  for (const key of FACET_KEYS) filters[key] = params.getAll(key);
  const sort = params.get("sort") as Sort | null;
  if (sort && SORTS.includes(sort)) filters.sort = sort;

  const open = params.getAll("open");
  const parts = path.split("/").filter(Boolean);
  return parts[0] === "piece" && parts[1]
    ? { view: "piece", id: decodeURIComponent(parts[1]), filters, open }
    : { view: "home", filters, open };
}

export function build(route: Route): string {
  const params = new URLSearchParams();
  // Insertion order is the query string's order, so the same view is always the
  // same string — which is what makes one shareable.
  if (route.filters.q.trim()) params.set("q", route.filters.q.trim());
  for (const key of FACET_KEYS) {
    for (const v of route.filters[key]) params.append(key, v);
  }
  if (route.filters.sort !== EMPTY.sort) params.set("sort", route.filters.sort);
  for (const v of route.open) params.append("open", v);

  const path = route.view === "piece" && route.id
    ? `piece/${encodeURIComponent(route.id)}`
    : "";
  const query = params.toString();
  return `#/${path}${query ? `?${query}` : ""}`;
}

/** Replace the hash without pushing a history entry — for typing in the search
 *  box, where one entry per keystroke would make Back useless. */
export function replace(hash: string) {
  history.replaceState(null, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function go(hash: string) {
  if (location.hash !== hash) location.hash = hash;
}
