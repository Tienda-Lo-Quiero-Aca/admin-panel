"""Tests del sitio de documentacion (addons/lqa_admin_panel/docs_site.py).

No necesitan Odoo:  python3 -m unittest discover -s tests
"""

import base64
import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location(
    "docs_site", ROOT / "addons" / "lqa_admin_panel" / "docs_site.py"
)
docs_site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(docs_site)


def basic(username, password):
    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    return f"Basic {token}"


class DocsSiteTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        (self.root / "docs").mkdir()
        (self.root / "README.md").write_text("# Inicio del repo\n", encoding="utf-8")
        for page in docs_site.DOCS_PAGES:
            if page.file != "README.md":
                (self.root / page.file).write_text(f"# {page.title}\n", encoding="utf-8")
        # Cosas que estan en el repo y no se tienen que poder pedir.
        (self.root / ".env.production").write_text("LQA_API_TOKEN=secreto\n", encoding="utf-8")
        (self.root / "docs" / "borrador.md").write_text("# Borrador\n", encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def site(self, **environ):
        return docs_site.DocsSite.from_environ(environ, root_directory=str(self.root))


class OpenSiteTests(DocsSiteTestCase):
    """Abierto, sin credenciales."""

    def test_serves_the_page_shell_pointing_at_its_own_content_path(self):
        for subpath in ("", "/"):
            result = self.site().handle(subpath)
            self.assertEqual(result.status, 200)
            self.assertIn("text/html", result.content_type)
            self.assertIn('basePath: "/docs/content/"', result.body)
            self.assertIn('homepage: "README.md"', result.body)

    def test_serves_the_readme_as_home_and_the_docs_under_their_repository_path(self):
        home = self.site().handle("content/README.md")
        self.assertEqual(home.status, 200)
        self.assertIn("text/markdown", home.content_type)
        self.assertEqual(home.body, "# Inicio del repo\n")

        guide = self.site().handle("content/docs/funcional.md")
        self.assertEqual(guide.status, 200)
        self.assertIn("Guía funcional", guide.body)

    def test_does_not_publish_the_page_about_the_server_in_the_sidebar_or_by_url(self):
        sidebar = self.site().handle("content/_sidebar.md").body
        self.assertNotIn("operacion.md", sidebar)

        page = self.site().handle("content/docs/operacion.md")
        self.assertEqual(page.status, 200)
        self.assertIn("no está publicada en el sitio abierto", page.body)
        self.assertNotIn("# Operación\n", page.body.split("\n\n", 1)[1])

    def test_only_serves_the_files_it_lists_whatever_else_sits_in_the_repository(self):
        for subpath in (
            "content/.env.production",
            "content/docs/borrador.md",
            "content/docs/../.env.production",
            "content/addons/lqa_admin_panel/__manifest__.py",
            "otra-cosa",
        ):
            with self.subTest(subpath=subpath):
                self.assertEqual(self.site().handle(subpath).status, 404)

    def test_answers_the_sidebar_next_to_a_page_too(self):
        root = self.site().handle("content/_sidebar.md")
        nested = self.site().handle("content/docs/_sidebar.md")
        self.assertEqual(root.status, 200)
        self.assertEqual(nested.body, root.body)

    def test_a_listed_page_missing_from_disk_is_a_404_not_a_crash(self):
        (self.root / "docs" / "api.md").unlink()
        self.assertEqual(self.site().handle("content/docs/api.md").status, 404)

    def test_empty_credentials_leave_the_site_open(self):
        # docker compose pasa las variables sin definir como texto vacio.
        site = self.site(DOCS_SITE_USER="", DOCS_SITE_PASSWORD="")
        self.assertFalse(site.is_protected)
        self.assertEqual(site.handle("").status, 200)

    def test_can_be_disabled(self):
        self.assertEqual(self.site(DOCS_SITE_ENABLED="false").handle("").status, 404)


class ProtectedSiteTests(DocsSiteTestCase):
    """Detras de credenciales."""

    def protected(self):
        return self.site(DOCS_SITE_USER="equipo", DOCS_SITE_PASSWORD="clave-larga")

    def test_asks_for_them_on_every_route(self):
        for subpath in ("", "content/_sidebar.md", "content/README.md", "content/docs/operacion.md"):
            with self.subTest(subpath=subpath):
                result = self.protected().handle(subpath)
                self.assertEqual(result.status, 401)
                self.assertIn(
                    ("WWW-Authenticate", 'Basic realm="Panel Interno docs", charset="UTF-8"'),
                    result.headers,
                )

    def test_rejects_a_wrong_password_and_malformed_headers(self):
        for header in (
            basic("equipo", "otra"),
            basic("otro", "clave-larga"),
            "Basic no-es-base64!!",
            "Bearer clave-larga",
            basic("equipo", "clave-larga")[:-4],
        ):
            with self.subTest(header=header):
                self.assertEqual(self.protected().handle("", header).status, 401)

    def test_publishes_every_page_the_one_about_the_server_included(self):
        auth = basic("equipo", "clave-larga")
        sidebar = self.protected().handle("content/_sidebar.md", auth).body
        self.assertIn("[Operación](/docs/operacion.md)", sidebar)

        page = self.protected().handle("content/docs/operacion.md", auth)
        self.assertEqual(page.status, 200)
        self.assertEqual(page.body, "# Operación\n")

    def test_a_password_with_colons_still_works(self):
        site = self.site(DOCS_SITE_USER="equipo", DOCS_SITE_PASSWORD="a:b:c")
        self.assertEqual(site.handle("", basic("equipo", "a:b:c")).status, 200)


class SidebarTests(unittest.TestCase):
    def test_groups_the_sidebar_by_section_in_order(self):
        self.assertEqual(
            docs_site.build_sidebar_markdown(include_restricted=True),
            "\n".join(
                [
                    "- **Inicio**",
                    "  - [Panel Interno](/)",
                    "- **Uso del panel**",
                    "  - [Guía funcional](/docs/funcional.md)",
                    "  - [Mensajes y motivos](/docs/mensajes.md)",
                    "- **Integraciones**",
                    "  - [Rutas e integraciones](/docs/api.md)",
                    "- **Técnico**",
                    "  - [Arquitectura y configuración](/docs/tecnico.md)",
                    "  - [Operación](/docs/operacion.md)",
                ]
            )
            + "\n",
        )


if __name__ == "__main__":
    unittest.main()
