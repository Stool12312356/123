#!/usr/bin/env python3
"""Локальный сервер для проверки сайта NEXUS//DEV — как на хостинге.

Отличия от `python3 -m http.server`:
  * на несуществующий адрес отдаётся 404.html со статусом 404 (как ErrorDocument / error_page);
  * кэш отключён (Cache-Control: no-store), правки видны сразу после обновления страницы.

Запуск из корня репозитория:
    python3 tools/serve.py            # http://localhost:8080
    python3 tools/serve.py 3000       # другой порт

Проверка 404: откройте любой несуществующий адрес, например http://localhost:8080/abc/projetcs,
или наберите в терминале сайта (клавиша ~) команду «404» / «404 wallet».
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE_404 = os.path.join(ROOT, "404.html")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map, **{
        ".svg": "image/svg+xml",
        ".js": "text/javascript",
        ".woff2": "font/woff2",
        ".json": "application/json",
    })

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_error(self, code, message=None, explain=None):
        if code == 404 and os.path.isfile(PAGE_404):
            with open(PAGE_404, "rb") as f:
                body = f.read()
            self.send_response(404, "Not Found")
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = functools.partial(Handler, directory=ROOT)
    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), handler)
    print(f"NEXUS//DEV: http://localhost:{port}  (404 → 404.html, Ctrl+C — стоп)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
