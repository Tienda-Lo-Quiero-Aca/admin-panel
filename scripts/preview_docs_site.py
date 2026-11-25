"""Vista previa del sitio de documentacion, sin levantar Odoo.

Uso:  python3 scripts/preview_docs_site.py   ->   http://localhost:4310/docs

Usa el mismo modulo que la ruta /docs del panel (addons/lqa_admin_panel/
docs_site.py), leyendo los .md directo del repo: lo que se ve aca es lo que
se publica. Con DOCS_SITE_USER y DOCS_SITE_PASSWORD en el entorno, pide
credenciales y muestra tambien la pagina de operacion.
"""

import importlib.util
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = int(os.environ.get("DOCS_PREVIEW_PORT", "4310"))

# Se carga por ruta y no como paquete: importar el addon arrastraria a Odoo.
_spec = importlib.util.spec_from_file_location(
    "docs_site", ROOT / "addons" / "lqa_admin_panel" / "docs_site.py"
)
docs_site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(docs_site)

SITE = docs_site.DocsSite.from_environ(os.environ, root_directory=str(ROOT))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - nombre impuesto por http.server
        path = self.path.split("?", 1)[0]
        if path in ("", "/"):
            self.send_response(302)
            self.send_header("Location", docs_site.BASE_PATH)
            self.end_headers()
            return
        if path != docs_site.BASE_PATH and not path.startswith(docs_site.BASE_PATH + "/"):
            self.send_error(404)
            return
        result = SITE.handle(
            path[len(docs_site.BASE_PATH):], self.headers.get("Authorization")
        )
        body = result.body.encode("utf-8")
        self.send_response(result.status)
        self.send_header("Content-Type", result.content_type)
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        for name, value in result.headers:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    modo = "con credenciales" if SITE.is_protected else "abierto, sin la pagina de operacion"
    print(f"Documentacion en http://localhost:{PORT}{docs_site.BASE_PATH} ({modo})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
