// Filter arithmetic, checked by assertion rather than by looking at a page.
//
// Nothing else in src/ is testable without a browser — tools/smoke.mjs drives a
// real one because the faults it guards against only appear in one. Facet counts
// are the opposite kind of bug: entirely decidable, and invisible on screen until
// somebody counts a list by hand.
import { describe, expect, it } from "vitest";
import type { CorpusIndex, PieceMeta } from "./music";
import {
  applyFilters, clear, EMPTY, foldRows, isFiltered, lengthOf, options, parseKey,
  shortTitle, sortPieces, toggle,
} from "./facets";
import { build, parse } from "./route";

const piece = (p: Partial<PieceMeta> & { id: string }): PieceMeta => ({
  composerId: "bach-js", title: "Untitled", genre: "Chorale", collection: "",
  catNo: "", year: 1730, keyName: "C major", bars: 12, hasAnalysis: false, ...p,
});

const index: CorpusIndex = {
  generator: "test",
  composers: {
    "bach-js": { name: "Johann Sebastian Bach", sort: "Bach, Johann Sebastian",
                 period: "Baroque", born: 1685, died: 1750, nationality: "German" },
    beethoven: { name: "Ludwig van Beethoven", sort: "Beethoven, Ludwig van",
                 period: "Classical", born: 1770, died: 1827, nationality: "German" },
    schubert: { name: "Franz Schubert", sort: "Schubert, Franz",
                period: "Romantic", born: 1797, died: 1828, nationality: "Austrian" },
  },
  pieces: [
    piece({ id: "b1", title: "Ach Gott", collection: "Chorales", keyName: "a minor" }),
    piece({ id: "b2", title: "Nun freut euch", collection: "Chorales" }),
    piece({ id: "v1", composerId: "beethoven", title: "Quartet, i", genre: "String quartet",
            collection: "String Quartet, Op. 18 no. 1", year: 1799, bars: 300,
            keyName: "f minor", hasAnalysis: true }),
    piece({ id: "s1", composerId: "schubert", title: "Der Lindenbaum", genre: "Song",
            collection: "Winterreise", year: 1827, bars: 82, keyName: "E major",
            hasAnalysis: true }),
  ],
};

const ids = (rows: PieceMeta[]) => rows.map((p) => p.id);

describe("key and length", () => {
  it("splits a key name into mode and a capitalised tonic", () => {
    expect(parseKey("Bb major")).toEqual({ mode: "major", tonic: "Bb" });
    expect(parseKey("f# minor")).toEqual({ mode: "minor", tonic: "F#" });
  });

  it("buckets length on the boundaries, not near them", () => {
    expect(lengthOf(32)).toBe("xs");
    expect(lengthOf(33)).toBe("s");
    expect(lengthOf(128)).toBe("m");
    expect(lengthOf(129)).toBe("l");
  });
});

describe("applyFilters", () => {
  it("ORs within a facet and ANDs across them", () => {
    expect(ids(applyFilters(index, { ...EMPTY, composer: ["beethoven", "schubert"] })))
      .toEqual(["v1", "s1"]);
    expect(ids(applyFilters(index, { ...EMPTY, composer: ["beethoven", "schubert"],
                                     mode: ["minor"] }))).toEqual(["v1"]);
  });

  it("reads period off the composer, not the year", () => {
    expect(ids(applyFilters(index, { ...EMPTY, period: ["Baroque"] }))).toEqual(["b1", "b2"]);
  });

  it("applies the query last, under the current selection", () => {
    // "der" matches the Schubert; the composer filter still excludes it.
    expect(ids(applyFilters(index, { ...EMPTY, q: "der" }))).toEqual(["s1"]);
    expect(ids(applyFilters(index, { ...EMPTY, q: "der", composer: ["bach-js"] }))).toEqual([]);
  });

  it("searches the composer's name even though the piece only stores an id", () => {
    expect(ids(applyFilters(index, { ...EMPTY, q: "beethoven" }))).toEqual(["v1"]);
  });
});

describe("options", () => {
  it("counts a facet against the other facets but not against itself", () => {
    const f = { ...EMPTY, period: ["Baroque"] };
    // Its own list keeps every period, or a selection could never be widened.
    expect(options(index, f, "period").map((o) => [o.id, o.count]))
      .toEqual([["Baroque", 2], ["Classical", 1], ["Romantic", 1]]);
    // Everyone else is narrowed by it.
    expect(options(index, f, "composer").map((o) => [o.id, o.count]))
      .toEqual([["bach-js", 2], ["beethoven", 0], ["schubert", 0]]);
  });

  it("keeps zero-count options rather than hiding them", () => {
    const f = { ...EMPTY, genre: ["Song"] };
    expect(options(index, f, "composer").some((o) => o.count === 0)).toBe(true);
  });

  it("gives each facet its own values, not another facet's", () => {
    // A switch whose `default` returned the mode list once served genre too,
    // which put "major 0 / minor 0" where the genres belonged.
    expect(options(index, EMPTY, "genre").map((o) => o.id))
      .toEqual(["Chorale", "Song", "String quartet"]);
    expect(options(index, EMPTY, "mode").map((o) => o.id)).toEqual(["major", "minor"]);
    expect(options(index, EMPTY, "length").map((o) => o.id)).toEqual(["xs", "s", "m", "l"]);
  });

  it("files composers by sort name, so van Beethoven is under B", () => {
    expect(options(index, EMPTY, "composer").map((o) => o.id))
      .toEqual(["bach-js", "beethoven", "schubert"]);
  });
});

describe("filter manipulation", () => {
  it("toggles a value on and off", () => {
    const on = toggle(EMPTY, "genre", "Song");
    expect(on.genre).toEqual(["Song"]);
    expect(toggle(on, "genre", "Song").genre).toEqual([]);
  });

  it("clears everything but the sort order", () => {
    const f = { ...EMPTY, sort: "date" as const, genre: ["Song"], q: "x" };
    expect(clear(f)).toEqual({ ...EMPTY, sort: "date" });
    expect(isFiltered(clear(f))).toBe(false);
  });
});

describe("sortPieces", () => {
  it("sorts A–Z by title, by year for dates, and by surname for composer", () => {
    expect(ids(sortPieces(index.pieces, index, "alpha")))
      .toEqual(["b1", "s1", "b2", "v1"]);
    expect(ids(sortPieces(index.pieces, index, "date")))
      .toEqual(["b1", "b2", "v1", "s1"]);
    expect(ids(sortPieces(index.pieces, index, "composer")))
      .toEqual(["b1", "b2", "v1", "s1"]);
  });
});

describe("foldRows", () => {
  const fold = (f = EMPTY) => foldRows(applyFilters(index, f), index, f);

  it("folds a collection of two or more into a folder", () => {
    const chorales = fold().find((r) => r.kind === "folder" && r.label === "Chorales");
    expect(chorales).toBeDefined();
    expect(chorales!.kind === "folder" && chorales!.pieces.map((p) => p.id))
      .toEqual(["b1", "b2"]);
  });

  it("leaves a one-piece collection as a piece row, not a folder of one", () => {
    // "Winterreise" holds only s1 here, and a folder for one piece is a click
    // that tells you nothing.
    const rows = fold();
    expect(rows.filter((r) => r.kind === "folder")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "piece").map((r) => r.key).sort())
      .toEqual(["s1", "v1"]);
  });

  it("names the folder's composer, and counts them when they differ", () => {
    const f = fold().find((r) => r.kind === "folder")!;
    expect(f.kind === "folder" && f.composer).toBe("Johann Sebastian Bach");
  });

  it("flattens completely once there is a query", () => {
    // "gott" and not "ach": the composer's own name is in the haystack, so
    // searching "ach" legitimately returns every Bach.
    const rows = fold({ ...EMPTY, q: "gott" });
    expect(rows.every((r) => r.kind === "piece")).toBe(true);
    expect(rows.map((r) => r.key)).toEqual(["b1"]);
  });

  it("sorts a folder by its earliest piece when sorting by date", () => {
    expect(fold({ ...EMPTY, sort: "date" }).map((r) => r.key))
      .toEqual(["Chorales", "v1", "s1"]);
  });

  it("takes the collection's name off a title nested under it", () => {
    expect(shortTitle("Winterreise, D.911 - 5: Der Lindenbaum", "Winterreise, D.911"))
      .toBe("5: Der Lindenbaum");
    expect(shortTitle("Prelude No.1", "The Well-Tempered Clavier I")).toBe("Prelude No.1");
    // Never strips down to nothing, and never strips a mere resemblance.
    expect(shortTitle("Chorales", "Chorales")).toBe("Chorales");
    expect(shortTitle("Winterreisen", "Winterreise")).toBe("Winterreisen");
  });

  it("orders numbers as numbers, so no. 10 follows no. 9", () => {
    const numbered = {
      ...index,
      pieces: [
        piece({ id: "n9", title: "Lied no. 9", collection: "" }),
        piece({ id: "n10", title: "Lied no. 10", collection: "" }),
      ],
    };
    expect(foldRows(numbered.pieces, numbered, EMPTY).map((r) => r.key))
      .toEqual(["n9", "n10"]);
  });
});

describe("route", () => {
  it("round-trips a filtered view", () => {
    const filters = { ...EMPTY, composer: ["schubert"], mode: ["minor"],
                      q: "wald", sort: "date" as const };
    const hash = build({ view: "home", filters, open: [] });
    expect(hash).toBe("#/?q=wald&composer=schubert&mode=minor&sort=date");
    expect(parse(hash)).toEqual({ view: "home", filters, open: [] });
  });

  it("repeats a key for multiple values instead of joining on a comma", () => {
    const filters = { ...EMPTY, composer: ["bach-js", "schubert"] };
    expect(build({ view: "home", filters, open: [] }))
      .toBe("#/?composer=bach-js&composer=schubert");
    expect(parse("#/?composer=bach-js&composer=schubert").filters.composer)
      .toEqual(["bach-js", "schubert"]);
  });

  it("survives a value containing a comma", () => {
    // The bug this replaces: values were joined and split on ",", and 83 of the
    // 102 collection names contain one, so "Winterreise, D.911" came back as two
    // values that matched nothing and the list went empty.
    const open = ["Winterreise, D.911", "String Quartet, Op. 18 no. 1"];
    const hash = build({ view: "home", filters: EMPTY, open });
    expect(parse(hash).open).toEqual(open);
  });

  it("round-trips a piece, carrying the filters and folders it was opened from", () => {
    const filters = { ...EMPTY, period: ["Romantic"] };
    const open = ["Winterreise, D.911"];
    const hash = build({ view: "piece", id: "bach-bwv253", filters, open });
    expect(parse(hash)).toEqual({ view: "piece", id: "bach-bwv253", filters, open });
  });

  it("treats an empty hash as the front door", () => {
    expect(parse("")).toEqual({ view: "home", filters: EMPTY, open: [] });
    expect(build({ view: "home", filters: EMPTY, open: [] })).toBe("#/");
  });
});
