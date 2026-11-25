"""Sitio de documentacion del panel, servido en /docs.

Modulo puro, sin Odoo: lo usan la ruta de Odoo (controllers/docs.py), la vista
previa local (scripts/preview_docs_site.py) y los tests (tests/test_docs_site.py),
asi lo que se prueba es exactamente lo que corre en produccion.

El sitio es un shell de Docsify que pide el markdown a <base>/content/ y lo
dibuja en el navegador. Las rutas copian la estructura del repo (README en la
raiz, el resto bajo docs/): por eso los enlaces relativos entre los .md andan
igual aca que en GitHub. El markdown se lee en cada pedido, asi que actualizar
el texto no requiere reiniciar nada.
"""

import base64
import binascii
import hmac
import json
import os
from dataclasses import dataclass

BASE_PATH = "/docs"
CONTENT_PREFIX = "/content"
HOME_FILE = "README.md"
DEFAULT_ROOT = "/mnt/docs"


@dataclass(frozen=True)
class DocsPage:
    group: str
    title: str
    # Ruta del markdown relativa a la raiz del repo.
    file: str
    # Describe como esta armado el servidor: solo se publica con el sitio
    # protegido por usuario y clave.
    restricted: bool = False


# Las paginas publicadas, en el orden del menu. Es tambien la lista blanca de
# archivos que el sitio puede leer: nada mas del repo se puede pedir.
DOCS_PAGES = (
    DocsPage("Inicio", "Panel Interno", "README.md"),
    DocsPage("Uso del panel", "Guía funcional", "docs/funcional.md"),
    DocsPage("Uso del panel", "Mensajes y motivos", "docs/mensajes.md"),
    DocsPage("Integraciones", "Rutas e integraciones", "docs/api.md"),
    DocsPage("Técnico", "Arquitectura y configuración", "docs/tecnico.md"),
    DocsPage("Técnico", "Operación", "docs/operacion.md", restricted=True),
)


@dataclass(frozen=True)
class Credentials:
    username: str
    password: str


@dataclass(frozen=True)
class DocsResponse:
    status: int
    content_type: str
    body: str
    headers: tuple = ()


class DocsSite:
    def __init__(self, root_directory, credentials=None, enabled=True):
        self.root_directory = root_directory
        self.credentials = credentials
        self.enabled = enabled

    @classmethod
    def from_environ(cls, environ=None, root_directory=None):
        """Configura el sitio desde variables de entorno.

        Con DOCS_SITE_USER y DOCS_SITE_PASSWORD (las dos, no vacias) pide
        credenciales en todas las rutas y publica todo. Sin ellas queda abierto
        y no publica la pagina de operacion. docker compose pasa las variables
        no definidas como texto vacio: vacio cuenta como no definida.
        """
        environ = os.environ if environ is None else environ
        username = (environ.get("DOCS_SITE_USER") or "").strip()
        password = environ.get("DOCS_SITE_PASSWORD") or ""
        credentials = Credentials(username, password) if username and password else None
        enabled = (environ.get("DOCS_SITE_ENABLED") or "true").strip().lower() not in (
            "0",
            "false",
            "no",
            "off",
        )
        return cls(
            root_directory=root_directory or environ.get("DOCS_SITE_ROOT") or DEFAULT_ROOT,
            credentials=credentials,
            enabled=enabled,
        )

    @property
    def is_protected(self):
        return self.credentials is not None

    def handle(self, subpath, authorization=None):
        """Resuelve un pedido GET a <BASE_PATH>/<subpath>."""
        if not self.enabled:
            return _text(404, "Not found")
        if self.is_protected and not self._authorized(authorization):
            return DocsResponse(
                401,
                "text/plain; charset=utf-8",
                "Authentication required",
                (("WWW-Authenticate", 'Basic realm="Panel Interno docs", charset="UTF-8"'),),
            )

        path = "/" + (subpath or "").strip("/")
        if path == "/":
            return DocsResponse(200, "text/html; charset=utf-8", build_shell_html(BASE_PATH))
        if path in (f"{CONTENT_PREFIX}/_sidebar.md", f"{CONTENT_PREFIX}/docs/_sidebar.md"):
            # Docsify pide el sidebar junto a la pagina que muestra antes de
            # caer al de la raiz: contestar los dos ahorra un 404 por pagina.
            return _markdown(build_sidebar_markdown(self.is_protected))
        if path.startswith(f"{CONTENT_PREFIX}/"):
            return self._page(path[len(CONTENT_PREFIX) + 1:])
        return _text(404, "Not found")

    def _page(self, file):
        page = next((candidate for candidate in DOCS_PAGES if candidate.file == file), None)
        if page is None:
            return _text(404, "Not found")
        if page.restricted and not self.is_protected:
            return _markdown(build_restricted_page_notice(page))
        try:
            with open(os.path.join(self.root_directory, page.file), encoding="utf-8") as handle:
                return _markdown(handle.read())
        except OSError:
            return _text(404, "Not found")

    def _authorized(self, header):
        received = parse_basic_authorization(header)
        if received is None:
            return False
        # compare_digest en las dos, siempre: cortar antes revelaria cual fallo.
        user_ok = hmac.compare_digest(received.username.encode(), self.credentials.username.encode())
        pass_ok = hmac.compare_digest(received.password.encode(), self.credentials.password.encode())
        return user_ok and pass_ok


def parse_basic_authorization(header):
    if not header or not header.startswith("Basic "):
        return None
    try:
        decoded = base64.b64decode(header[len("Basic "):], validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return None
    if ":" not in decoded:
        return None
    username, password = decoded.split(":", 1)
    return Credentials(username, password)


def build_sidebar_markdown(include_restricted):
    lines = []
    current_group = None
    for page in DOCS_PAGES:
        if page.restricted and not include_restricted:
            continue
        if page.group != current_group:
            current_group = page.group
            lines.append(f"- **{page.group}**")
        lines.append(f"  - [{page.title}]({_to_route(page.file)})")
    return "\n".join(lines) + "\n"


def build_restricted_page_notice(page):
    return "\n".join(
        [
            f"# {page.title}",
            "",
            "Esta página no está publicada en el sitio abierto: describe cómo está "
            "armado el servidor y cómo se rotan las credenciales.",
            "",
            f"Está disponible en el repositorio, en `{page.file}`.",
            "",
        ]
    )


def _to_route(file):
    """README.md es la portada; el resto conserva su ruta en el repo."""
    return "/" if file == HOME_FILE else f"/{file}"


def _markdown(body):
    return DocsResponse(200, "text/markdown; charset=utf-8", body)


def _text(status, body):
    return DocsResponse(status, "text/plain; charset=utf-8", body)


def build_shell_html(base_path):
    """Shell de Docsify: pide el markdown a <base>/content/ y lo dibuja."""
    content_base = json.dumps(f"{base_path.rstrip('/')}{CONTENT_PREFIX}/")
    home = json.dumps(HOME_FILE)
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Panel Interno · Documentación</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/docsify@4.13.1/lib/themes/vue.css" />
  <style>
    :root {{
      --theme-color: #2d3277;
      --content-max-width: 56rem;
    }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }}
    .app-name-link {{ color: #ff4f5a !important; font-weight: 800; letter-spacing: -.01em; }}
    .sidebar {{ border-right: 1px solid #e3e9f1; }}
    .sidebar ul li > strong, .sidebar ul li > p > strong {{
      display: block; margin-top: 1.1rem; font-size: .72rem; letter-spacing: .08em;
      text-transform: uppercase; color: #6b7a90;
    }}
    .sidebar ul li a {{ font-size: .93rem; }}
    .sidebar ul li.active > a {{ border-right: 2px solid #ff4f5a; font-weight: 600; }}
    .markdown-section {{ max-width: var(--content-max-width); }}
    .markdown-section h1 {{ font-size: 2rem; }}
    .markdown-section h2 {{ margin-top: 2.6rem; padding-bottom: .35rem; border-bottom: 1px solid #eef2f7; }}
    .markdown-section table {{ display: table; width: 100%; font-size: .9rem; }}
    .markdown-section th {{ background: #f4f6fa; text-align: left; }}
    .markdown-section td, .markdown-section th {{ padding: .5rem .75rem; }}
    .markdown-section code {{ font-size: .84em; }}
    .markdown-section pre {{ border-radius: 6px; }}
    .markdown-section blockquote {{ border-left-color: #ff4f5a; background: #fff6f6; padding: .6rem 1rem; }}
    .markdown-section .mermaid {{ text-align: center; margin: 1.5rem 0; overflow-x: auto; background: transparent; }}
    .table-wrap {{ overflow-x: auto; }}
  </style>
</head>
<body>
  <div id="app">Cargando la documentación…</div>
  <script>
    window.$docsify = {{
      name: 'Panel Interno',
      basePath: {content_base},
      homepage: {home},
      loadSidebar: true,
      relativePath: true,
      auto2top: true,
      subMaxLevel: 2,
      maxLevel: 3,
      search: {{
        placeholder: 'Buscar',
        noData: 'Sin resultados',
        depth: 3,
      }},
      markdown: {{
        renderer: {{
          code: function (code, lang) {{
            if (lang === 'mermaid') {{
              return '<pre class="mermaid">' + code.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>';
            }}
            return this.origin.code.apply(this, arguments);
          }},
        }},
      }},
      plugins: [
        function (hook) {{
          hook.doneEach(function () {{
            document.querySelectorAll('.markdown-section table').forEach(function (table) {{
              if (table.parentElement.classList.contains('table-wrap')) return;
              var wrap = document.createElement('div');
              wrap.className = 'table-wrap';
              table.parentNode.insertBefore(wrap, table);
              wrap.appendChild(table);
            }});
            if (window.mermaid) {{
              window.mermaid.run({{ querySelector: '.markdown-section pre.mermaid' }});
            }}
          }});
        }},
      ],
    }};
  </script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
  <script>
    if (window.mermaid) {{ window.mermaid.initialize({{ startOnLoad: false, theme: 'neutral' }}); }}
  </script>
  <script src="https://cdn.jsdelivr.net/npm/docsify@4.13.1/lib/docsify.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/docsify@4.13.1/lib/plugins/search.min.js"></script>
</body>
</html>
"""
