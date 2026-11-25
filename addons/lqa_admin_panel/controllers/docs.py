import os

from odoo import http
from odoo.http import Response, request

from .. import docs_site


class LqaDocsSiteController(http.Controller):
    """Documentacion del repo en /docs (ver docs_site.py).

    auth="none": no depende de la sesion de Odoo. Si hay DOCS_SITE_USER y
    DOCS_SITE_PASSWORD pide esas credenciales; si no, queda abierto sin la
    pagina de operacion. save_session=False: un visitante de la documentacion
    no tiene por que generar una sesion de Odoo.
    """

    @http.route(
        # "/docs/" aparte: <path:subpath> no matchea vacio.
        ["/docs", "/docs/", "/docs/<path:subpath>"],
        type="http",
        auth="none",
        methods=["GET"],
        csrf=False,
        save_session=False,
    )
    def docs_site(self, subpath="", **kwargs):
        site = docs_site.DocsSite.from_environ(os.environ)
        result = site.handle(
            subpath, request.httprequest.headers.get("Authorization")
        )
        headers = [
            ("Content-Type", result.content_type),
            # El markdown se lee en cada pedido: sin cache, un cambio de texto
            # se ve en la proxima carga.
            ("Cache-Control", "no-cache"),
            *result.headers,
        ]
        return Response(result.body, status=result.status, headers=headers)
