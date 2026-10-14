#!/usr/bin/env python3
"""Dev static server for the SemText viewer check (local only).

Why not `python3 -m http.server`: the render jail iframe is sandboxed with
allow-scripts ONLY (opaque origin). ES modules fetched by an opaque-origin
document are cross-origin by definition and REQUIRE a CORS pass; plain
http.server sends no Access-Control-Allow-Origin, so viewer/*.mjs silently
fail to load inside the jail (classic scripts are unaffected). This server
adds ACAO:* and a correct text/javascript MIME for .mjs so the module graph
loads in the jail. Production note (design 4.3): a deployment must serve the
viewer modules with ACAO as well, or ship the jail code as classic bundles.

Usage: python3 viewer/dev-server.py [port]   (default 4190, serves repo root)
"""
import http.server
import mimetypes
import os
import sys

mimetypes.add_type("text/javascript", ".mjs")

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4190
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"serving {ROOT} on http://127.0.0.1:{PORT}")
    server.serve_forever()
