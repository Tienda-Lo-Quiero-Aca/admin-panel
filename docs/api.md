# Rutas e integraciones

Las rutas HTTP propias del panel y los servicios internos que consume cada sección.

← [Volver al inicio](../README.md)

El panel casi no expone una API: es una interfaz sobre otros servicios. Las pantallas le piden datos al servidor del panel (Odoo), y él llama a cada servicio con su credencial. **El navegador nunca habla directo con los servicios internos ni ve sus claves.**

**Contenido**

| Grupo | Qué hay |
|---|---|
| [Rutas propias](#rutas-propias) | Documentación, salud, descargas y manifiesto. |
| [Servicios que consume](#servicios-que-consume) | Resumen: qué servicio, para qué sección, con qué credencial. |
| [Madre](#madre) | Carpetas y runs del Publicador, órdenes, Retailers, Automeli, comprobantes. |
| [Products API](#products-api) | Lanzar y reintentar publicaciones. |
| [Invoice API](#invoice-api) | Facturas, notas de crédito, clientes y PDF. |
| [Otros servicios](#otros-servicios) | Catalog Sync, Pricing, Eliminador, Central de Promociones, Orders, Marketplace, Teams y Datadog. |
| [Comportamiento común](#comportamiento-común) | Timeouts, errores y llamadas en segundo plano. |

---

## Rutas propias

| Ruta | Método | Acceso | Qué devuelve |
|---|---|---|---|
| `/docs` | GET | Abierta, o usuario y clave (ver abajo) | Esta documentación. |
| `/lqa_admin_panel/health` | JSON-RPC | Sesión del panel | `{"ok": true, "module": "lqa_admin_panel", "environment": "…"}`. |
| `/lqa_admin_panel/manifest.webmanifest` | GET | Pública | El manifiesto para instalar el panel como app en el celular o el escritorio. |
| `/lqa_admin_panel/accounting/comprobantes/<TLQV>/pdf` | GET | Sesión | Le pide a Invoice API el PDF del comprobante, lo guarda en el CDN y redirige ahí (303). También responde en `…/cdn`. |
| `/lqa_admin_panel/mercadolibre/selections/<id>/csv` | GET | Sesión | El CSV de una carpeta de Selecciones, en streaming. `?columns=` elige columnas, separadas por coma. |
| `/lqa_admin_panel/mercadolibre/catalog/exports/<id>/zip` | GET | Sesión, solo el dueño o un administrador | El ZIP de una exportación del catálogo terminada. 404 si no terminó o venció. |
| `/lqa_admin_panel/mercadolibre/pricing/imports/<id>/xlsx` | GET | Sesión, solo el dueño o un administrador | El Excel consolidado de un Pricing por selección. 404 si no está generado. |

Además, las pantallas llaman a los métodos de los servicios del panel por el canal JSON-RPC de Odoo (`/web/dataset/call_kw`). Cada método verifica el permiso del usuario antes de hacer nada; la lista de servicios está en [Arquitectura y configuración](tecnico.md#dónde-está-cada-cosa).

### Acceso a la documentación

| Configuración | Comportamiento |
|---|---|
| Sin `DOCS_SITE_USER` / `DOCS_SITE_PASSWORD` | Abierta, sin la página de Operación (en su lugar aparece un aviso). |
| Con las dos | Pide usuario y clave (HTTP Basic) en todas las rutas y publica todo. |
| `DOCS_SITE_ENABLED=false` | `/docs` responde 404. |

El sitio solo sirve los archivos de su lista: `README.md` y cinco páginas de `docs/`. Cualquier otra ruta, aunque el archivo exista en el repo, responde 404.

---

## Servicios que consume

| Servicio | Base por defecto | Credencial | Lo usan |
|---|---|---|---|
| [Madre](#madre) | `https://api.madre.loquieroaca.com` | Varía por sección | Publicador, Órdenes, Retailers, Automeli, Promociones, Administración |
| [Products API](#products-api) | `https://api.products.loquieroaca.com` | `x-api-key` | Publicar, Reintentar fallidas |
| [Invoice API](#invoice-api) | `https://invoice.loquieroaca.com` | `x-internal-api-key` | Administración |
| [Catalog Sync API](#catalog-sync-api) | `https://catalog-meli.loquieroaca.com` | Ninguna | Catálogo y Selecciones de MercadoLibre |
| [Pricing API](#pricing-api) | `https://api.price.loquieroaca.com` | `x-api-key` | Pricing |
| [Eliminador](#eliminador) | `https://api.meli.loquieroaca.com` | `x-internal-api-key` | Eliminador |
| [Central de Promociones](#central-de-promociones) | `http://cpe.loquieroaca.com` | `x-api-key` | Central de Promociones |
| [Orders](#orders-y-marketplace) | `https://order.api.loquieroaca.com/orders` | `Bearer` (opcional) | Avisos de Teams |
| [Marketplace API](#orders-y-marketplace) | `https://api.marketplace.loquieroaca.com` | Ninguna | Avisos de Teams |
| [Microsoft Teams](#microsoft-teams) | El webhook configurado | La URL del webhook | Avisos de Teams |

Todas las direcciones y claves se cambian en Ajustes o por variable de entorno: ver [Configuración](tecnico.md#configuración).

---

## Madre

Madre es el servicio central de datos. El panel le pide cosas distintas según la sección, y **con credenciales distintas**:

| Sección | Rutas | Credencial |
|---|---|---|
| Publicador: carpetas | `GET/POST /api/analytics/marketplace-favorites/marketplaces` · `DELETE …/marketplaces/{id}` · `GET/DELETE /api/analytics/marketplace-favorites/{id}/favorites` · `POST /api/analytics/marketplace-favorites/bulk` | `Authorization: Bearer` (token Madre Retailers) |
| Publicador: seguimiento | `GET /api/publication-runs/{runId}` · `GET /api/publication-jobs/{runId}/jobs?limit&offset&status` · `GET /api/publication-jobs/pending` | `Authorization: Bearer` |
| Órdenes | `GET /api/orders` · `GET /api/orders/{key}` | `x-internal-api-key` (token Madre Retailers) |
| Retailers: catálogo y Fravega | `GET /api/internal/marketplace/products/items/marketplaces` · `…/items/{sku}/marketplaces` · `…/items/all` · `GET /api/internal/marketplace/products/{marketplace}/status` · `GET /api/internal/product-sync/runs` | Ninguna |
| Automeli | `GET /api/automeli/product-snapshots/all` · `GET /api/automeli/product-snapshots/last-updated` | Ninguna |
| Central de Promociones | `GET /api/mercadolibre/orders/aporte-ml` · `GET /api/mercadolibre/orders/analytics/aporte-ml/timeseries` | `x-api-key` (la de la Central) |
| Administración | `GET /api/internal/xubio/comprobantes` · `GET /api/internal/invoice/client-issues/clients` · `GET /api/internal/invoice/client-issues/by-tlqv-code/{tlqv}` | `x-internal-api-key` (clave Madre Contable) |

**Cosas de Madre que el panel compensa:**

- El listado de carpetas no trae cuántos productos tiene cada una. El panel lo pide aparte, una consulta por carpeta, hasta 6 en paralelo y con 20 segundos de tope en total. La lista se dibuja primero y los conteos llegan después.
- Al crear una carpeta, Madre no devuelve su ID. El panel lo deduce buscando la de ID más alto con ese nombre.
- Los productos de una carpeta se identifican por su MLA, y por ese mismo valor se borran.
- Madre solo devuelve los productos de una carpeta que existen en su copia del catálogo de Mercado Libre. Un MLA mal tipeado, o uno todavía no sincronizado, queda guardado pero no se ve.
- Eliminar una carpeta es **definitivo**: borra la carpeta y todos sus productos.

---

## Products API

| Acción | Ruta | Desde |
|---|---|---|
| Lanzar una publicación | `POST /publications/execute/run` con `{"marketplaces": ["fravega"], "folderId": N}` | Publicar |
| Reintentar los fallidos de un run | `POST /publications/runs/{runId}/retry-failed` (sin body) | Seguimiento |

- Credencial: `x-api-key`, desde *API key Products API* o `LQA_PRODUCTS_API_KEY`. Sin ella, el panel ni siquiera intenta la llamada.
- Hoy acepta un solo canal, `fravega`.
- Responde cuando los jobs quedaron encolados, no cuando se publicaron. El avance se lee de Madre (ver [Seguimiento](#madre)).
- El timeout de estas llamadas es de al menos 180 segundos: con carpetas de miles de SKU, crear el run tarda.
- **No se reintenta sola ante un error.** Un error a mitad de camino puede dejar un run creado a medias, y reintentar duplicaría los jobs.
- Cada lanzamiento, salga bien o mal, queda en el historial del panel (`lqa.retailers.publication.run`), con usuario, carpeta y respuesta.

---

## Invoice API

Toda la facturación pasa por Invoice API, que es la que habla con Xubio. Credencial: `x-internal-api-key`, desde *Clave interna Invoice ARCA* o `LQA_ACCOUNTING_INVOICE_API_KEY`. Su documentación está en [invoice.loquieroaca.com/docs](https://invoice.loquieroaca.com/docs).

| Acción | Ruta |
|---|---|
| Crear cliente desde TLQV | `POST /internal/tlqv-invoice/clientes/create-from-tlqv` |
| Consumidor final desde un issue | `POST /internal/tlqv-invoice/clientes/create-consumidor-final-from-issue` |
| Emitir una factura | `POST /internal/tlqv-invoice/facturas/create-from-tlqv` |
| Encolar facturas en lote | `POST /internal/tlqv-invoice/facturas/bulk/create-from-tlqv` |
| Estado de un lote | `GET /internal/tlqv-invoice/facturas/bulk/{batchId}` |
| Emitir o previsualizar una nota de crédito | `POST /internal/tlqv-invoice/facturas/nota-credito` |
| Notas de crédito en lote | `POST /internal/tlqv-invoice/facturas/bulk/nota-credito` · `GET …/bulk/nota-credito/{batchId}` |
| Issues (ventas que no se facturaron) | `GET /internal/tlqv-invoice/issues` · `GET …/issues/{tlqv}` |
| PDF de un comprobante | `POST /internal/tlqv-invoice/documents/{tlqv}/cdn` |
| Actualizar comprobantes desde Xubio | `POST /internal/xubio/comprobantes/backfill/run-now` |

- La **previsualización** de una nota de crédito siempre va con `dryRun: true`, aunque se pida otra cosa.
- **Emitir** una nota de crédito requiere ser administrador del panel y una confirmación explícita (`confirm: true`); sin ella, el panel corta antes de llamar.
- Timeout por defecto: 120 segundos (*Timeout Contable*).

---

## Otros servicios

### Catalog Sync API

`GET https://catalog-meli.loquieroaca.com/analytics/products/performance`, sin credencial. Es el catálogo de Mercado Libre con su rendimiento.

- Consulta del catálogo: 180 segundos de timeout, 2 intentos, y el resultado queda en caché 5 minutos.
- **Guardar todo el filtro** en una carpeta pide páginas de 1.000, 4 en paralelo, en ciclos de 55 segundos que continúan cada minuto.
- **Exportar a Excel** pide páginas de 1.000, en ciclos de 45 segundos.
- **Importar MLAs** consulta los MLAs de a 5 por lote, 4 en paralelo, con un tope de 90 segundos por lote.

### Pricing API

`POST https://api.price.loquieroaca.com/internal/getProfit/details/bulk`, con `x-api-key`. Se envían 50 filas por llamada; el timeout es de 300 segundos.

### Eliminador

`POST https://api.meli.loquieroaca.com/meli/products/bulk/delete` con `{"ids": […], "appKey": "…"}` y `x-internal-api-key`. Tandas de 1.000 MLAs. El tamaño solo se cambia con el parámetro de sistema `lqa_admin_panel.mercadolibre_delete_chunk_size`: Ajustes no tiene un campo para eso, y la variable `LQA_MERCADOLIBRE_DELETE_CHUNK_SIZE` no llega al contenedor de producción.

### Central de Promociones

En `http://cpe.loquieroaca.com`, con `x-api-key`:

| Uso | Ruta | Timeout |
|---|---|---|
| Estadísticas, listado y catálogo | `GET /promotions/stats` · `GET /promotions` · `GET /promotions/catalogs` | 120 s |
| Acciones | `POST /promotions/sync` · `/activate` · `/deactivate` · `/deactivate-failed` · `/sync-one` | 300 s |

Las acciones se ejecutan en un hilo aparte del servidor y su resultado queda en `lqa.mercadolibre.promotion.action.log`.

### Orders y Marketplace

Los usan los **avisos de Teams**:

- Orders: `GET …/orders/overview/last-24-hours` o `…/overview/recent/{24|48|72}`, con `Authorization: Bearer` si hay token configurado.
- Marketplace API: `GET /fravega/vtex/orders` y su detalle, para completar los datos de cada orden.

### Microsoft Teams

`POST` al webhook configurado, con una tarjeta que lista las órdenes nuevas. El panel no guarda la URL del webhook en los logs, porque contiene el secreto.

### Datadog

No es una integración: el panel arma links a Datadog (Logs del Publicador, Live Tail de la Central de Promociones), que se abren con la sesión de cada usuario. No se guarda ninguna clave de Datadog.

---

## Comportamiento común

- **Conexión en 5 segundos.** Toda llamada separa el tiempo para conectar (5 segundos) del tiempo para responder (el configurado). Un servicio caído falla en 5 segundos, no en el timeout completo. Esto importa porque Odoo corre con 2 procesos: una llamada colgada ocupa uno y frena el panel para todos.
- **Errores en castellano.** La respuesta de error de un servicio se traduce a una frase con el nombre del servicio y qué hacer; el detalle técnico va al log del servidor. Ver [Mensajes y motivos](mensajes.md#servicios-internos).
- **Segundo plano.** Las tareas largas (guardar un filtro entero, exportar el catálogo, importar MLAs, procesar Pricing por selección) no corren en la pantalla: se registran como trabajos y las continúan procesos programados que se ejecutan cada minuto. Ver [Arquitectura y configuración](tecnico.md#procesos-en-segundo-plano).
