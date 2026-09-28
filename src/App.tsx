import { useEffect, useState } from "react";
import Home from "@/components/Home";
import Analysis from "@/components/Analysis";
import type { CorpusIndex, Piece } from "@/lib/music";
import { loadIndex, loadPiece } from "@/lib/corpus";
import type { Filters } from "@/lib/facets";
import { isFiltered } from "@/lib/facets";
import { build, go, parse, replace, type Route } from "@/lib/route";

/** Both loads are async, and both can fail; this is the shell that says so. */
function Notice({ children }: { children: React.ReactNode }) {
  return <p className="mx-auto max-w-[1180px] px-6 py-16 text-[0.92rem] text-[var(--ink-mute)] sm:px-10">{children}</p>;
}

export default function App() {
  const [index, setIndex] = useState<CorpusIndex | null>(null);
  const [piece, setPiece] = useState<Piece | null>(null);
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  const [err, setErr] = useState<string | null>(null);

  // The hash is the state (src/lib/route.ts). Everything that navigates writes
  // one, and this is the only place one is read.
  useEffect(() => {
    const sync = () => setRoute(parse(location.hash));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    let live = true;
    loadIndex().then(
      (c) => live && setIndex(c),
      (e) => live && setErr(String(e)),
    );
    return () => {
      live = false;
    };
  }, []);

  const id = route.view === "piece" ? route.id : null;

  // The open piece is fetched on demand. `piece` is cleared first so the old one
  // never shows under the new one's header while the fetch is in flight.
  useEffect(() => {
    if (!id) {
      setPiece(null);
      return;
    }
    let live = true;
    setPiece(null);
    setErr(null);
    loadPiece(id).then(
      (p) => live && setPiece(p),
      (e) => live && setErr(String(e)),
    );
    return () => {
      live = false;
    };
  }, [id]);

  // The braces matter: an arrow returning scrollTo's value hands React that value
  // as the effect's cleanup, and React calls it on the next navigation. It is
  // undefined in most browsers, so this only bites where something wraps
  // scrollTo — and then it takes the whole page down.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [id]);

  // Leaving a piece returns to the list it was opened from — filters, sort and
  // open folders and all — because every one of those travelled in the URL
  // rather than in a component.
  const home = () => build({ view: "home", filters: route.filters, open: route.open });

  const setFilters = (f: Filters, inPlace = false) => {
    const next = build({ view: "home", filters: f, open: route.open });
    if (inPlace) replace(next);
    else go(next);
  };

  // Expanding a folder is a navigation, so Back closes it again — which is the
  // only Back a folder needs, since opening one never took you anywhere.
  const toggleFolder = (collection: string) =>
    go(build({
      view: "home",
      filters: route.filters,
      open: route.open.includes(collection)
        ? route.open.filter((c) => c !== collection)
        : [...route.open, collection],
    }));

  return (
    <div className="min-h-full">
      <div className="rule-b sticky top-0 z-20 bg-[var(--paper)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-6 py-3 sm:px-10">
          <a href="#/" className="text-[1rem]" style={{ letterSpacing: "0.16em" }}>
            HARMONIA
          </a>
          <span className="smallcaps text-[var(--ink-mute)]">automatic harmonic analysis</span>
        </div>
      </div>

      {err && <Notice>Could not load the corpus — {err}</Notice>}
      {!err && id && !piece && <Notice>Loading…</Notice>}
      {!err && id && piece && index && (
        <Analysis
          piece={piece}
          composer={index.composers[piece.composerId]?.name ?? piece.composer}
          backLabel={isFiltered(route.filters) ? "Back to the list" : "All pieces"}
          onBack={() => go(home())}
        />
      )}
      {!err && !id && (index
        ? <Home
            index={index}
            filters={route.filters}
            open={route.open}
            onFilters={setFilters}
            onOpenFolder={toggleFolder}
            onOpen={(pid) => go(build({ view: "piece", id: pid,
                                        filters: route.filters, open: route.open }))}
          />
        : <Notice>Loading…</Notice>)}
    </div>
  );
}
