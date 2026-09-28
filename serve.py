"""Serve dist/ over http for run-harmonia.bat, without letting it be cached stale.

`python -m http.server` sends `Last-Modified` and nothing else. With no
`Cache-Control` and no `ETag` a browser falls back to *heuristic freshness*: it
guesses how long a file stays good from how old it was when first fetched,
usually a tenth of that age. index.html is the one file whose name never changes
and whose contents name every other file, so a heuristically-cached copy of it
goes on pointing at the previous build's JavaScript — which is still sitting in
dist/assets under its own content-hashed name, and loads perfectly. The page then
shows an old build from files that are all, individually, exactly right.

That failure has now cost two rounds of "why is it not updating", so:

  index.html   no-store   — never kept; it is 350 bytes
  everything   no-cache   — kept, but revalidated; unchanged files answer 304
                            and cost one small request, not a re-download

`no-cache` rather than `no-store` for the rest matters: the corpus is 28 MB of
piece files and engravings, and re-fetching those on every navigation would make
the site slower than the caching problem it fixes.
"""

import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        html = self.path.endswith("/") or self.path.endswith(".html")
        self.send_header("Cache-Control", "no-store, must-revalidate" if html else "no-cache")
        super().end_headers()

    def log_message(self, *args):
        # The console window is the user's only instruction ("leave this open").
        # A request log per engraved system buries it.
        pass


# Without this a restart inside the TIME_WAIT window fails to bind, and the old
# server keeps answering on the port — which looks exactly like a stale build.
socketserver.TCPServer.allow_reuse_address = True

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print()
    print(f"  Harmonia is at http://localhost:{PORT}")
    print("  Leave this window open while you use it; close it to stop.")
    print()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
