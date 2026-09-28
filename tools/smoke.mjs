// Browser smoke test. `npm run build` first; this drives dist/ in a real browser.
//
//   node tools/smoke.mjs            the fetching build, over http
//   node tools/smoke.mjs --single   dist/harmonia.html, over file://
//
// It exists because the two faults that have taken this page down — a single
// over-tall SVG, and an effect whose cleanup was scrollTo's return value —
// both build cleanly, both leave a blank page, and neither reproduces in a
// stock headless browser without being asked for. So this asks: it wraps
// scrollTo so it returns a value, then checks that a score actually rendered.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const single = process.argv.includes("--single");
const missing = [];
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".bin": "application/octet-stream",
  ".woff2": "font/woff2", ".webm": "audio/webm",
};

/** Static server over dist/, deliberately without Content-Encoding on .bin. */
function serve(root) {
  const server = createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]);
    // The browser asks for this unprompted; a 404 for it is not the app's fault.
    if (rel === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    const file = join(root, rel === "/" ? "index.html" : rel);
    if (!existsSync(file) || statSync(file).isDirectory()) {
      missing.push(rel);
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, () => ok([server, server.address().port])));
}

const fail = [];
const check = (cond, what) => {
  console.log(`  ${cond ? "ok" : "FAIL"}  ${what}`);
  if (!cond) fail.push(what);
};

const [server, port] = single ? [null, 0] : await serve(resolve("dist"));
// CHROMIUM_PATH lets this run against a browser Playwright did not install.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
page.on("requestfailed", (r) => errors.push(`request failed: ${r.url()}`));
page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));

// Fault 2 only bites where something wraps scrollTo and returns a value. Nothing
// in a stock browser does, so this build is the one that has to.
await page.addInitScript(() => {
  const real = window.scrollTo.bind(window);
  window.scrollTo = (...a) => {
    real(...a);
    return "a value React must not call";
  };
});

// The home page is a listing whose collections are folded into folders, so
// "a row" is not necessarily a piece. Folder buttons carry aria-expanded and
// piece buttons do not, which is the only reliable way to tell them apart from
// out here. Sorted by date so the last piece row is a late, long one — the
// engravings big enough to catch a payload or layer-limit problem.
const root = single ? `file://${resolve("dist/harmonia.html")}` : `http://localhost:${port}/`;
await page.goto(`${root}#/?sort=date`);

await page.waitForSelector("ul li button", { timeout: 15000 });
const pieceRows = page.locator("ul li button:not([aria-expanded])");
const rows = await pieceRows.count();
check(rows > 0, `home page lists pieces (${rows} piece rows)`);

// Folders expand in place rather than navigating, so the check is that the list
// grows and the URL says so — not that any exist, since a small corpus (the
// one-file build carries thirty pieces) legitimately has no multi-piece set.
const folders = page.locator("ul li button[aria-expanded]");
const folderCount = await folders.count();
if (folderCount) {
  await folders.first().click();
  await page.waitForFunction((n) => n < document
    .querySelectorAll("ul li button:not([aria-expanded])").length, rows);
  check(page.url().includes("open="),
        `a collection folder expands in place (${folderCount} folders)`);
  await folders.first().click();     // put the list back as it was
} else {
  console.log("  --  no multi-piece collection in this build; folder check skipped");
}

const title = await page.locator("h1").first().innerText();
check(/\d/.test(title), `heading carries a count — "${title.replace(/\s+/g, " ")}"`);

await pieceRows.last().click();
await page.waitForSelector(".engraved svg, svg", { timeout: 30000 });

const svgs = await page.locator("svg").count();
check(svgs > 1, `score renders systems (${svgs} svg elements)`);

// Scoped to .engraved on purpose: Verovio scopes its stylesheet by the root
// svg's id, and stripping that id silently unstrokes every staff line, stem and
// slur while the filled noteheads carry on looking fine (README §5).
const painted = await page.evaluate(() => {
  const el = document.querySelector(".engraved svg path, .engraved svg polygon");
  return el ? getComputedStyle(el).stroke : null;
});
check(painted !== null && painted !== "none", `notation is stroked (${painted})`);

const box = await page.locator(".engraved svg").first().boundingBox();
check(box && box.height > 20, `a system has height (${box ? Math.round(box.height) : 0}px)`);

// Back, then into another piece: this is the navigation that used to unmount
// the tree via the scrollTo cleanup.
await page.getByLabel("Back to the list").click();
await page.waitForSelector("ul li button");
await page.locator("ul li button:not([aria-expanded])").first().click();
await page.waitForSelector("svg", { timeout: 30000 });
check((await page.locator("svg").count()) > 1, "second piece renders after navigating back");

check(missing.length === 0, `nothing 404s${missing.length ? ` — ${[...new Set(missing)].join(", ")}` : ""}`);
check(errors.length === 0, `no console errors or failed requests${errors.length ? `\n        ${errors.join("\n        ")}` : ""}`);

await browser.close();
server?.close();

console.log(fail.length ? `\n${fail.length} check(s) failed` : "\nall checks passed");
process.exit(fail.length ? 1 : 0);
