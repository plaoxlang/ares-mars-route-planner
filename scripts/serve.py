"""Servidor local de ARES sin caché.

`python -m http.server` no dice nada de caché y el navegador reutiliza durante un tiempo los .js y .css
que ya tiene: tras cambiar el código se puede seguir viendo la versión anterior. Este servidor pide al
navegador que compruebe cada archivo (Cache-Control: no-cache); si no ha cambiado, la respuesta es un
304 sin contenido, así que sigue siendo rápido.

Uso: python scripts/serve.py [puerto]   (por defecto 8010)
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".glb": "model/gltf-binary",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8010
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"ARES en http://localhost:{port} (sin caché)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
