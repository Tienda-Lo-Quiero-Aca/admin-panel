# Mensajes y motivos

Los avisos que muestra el panel, qué significan y qué hacer con cada uno.

← [Volver al inicio](../README.md)

Un aviso rojo **no siempre es un error del panel**. Hay tres casos distintos:

| Tipo | Ejemplo | De quién es |
|---|---|---|
| **Falta algo de tu lado** | "Seleccioná al menos un producto." | Completar y repetir. |
| **Un servicio interno falló** | "Madre no respondió a tiempo (60 s)." | Del servicio, no del panel. |
| **Una operación no se pudo hacer** | Un SKU que no se publicó, una venta que no se facturó. | Tiene un motivo concreto: está en este catálogo. |

**Contenido**

- [Los más frecuentes](#los-más-frecuentes)
- [Servicios internos](#servicios-internos)
- [Falta configuración](#falta-configuración)
- [Permisos](#permisos)
- [Por sección](#por-sección)
- [Motivos de publicación](#motivos-de-publicación)
- [Facturación en Xubio](#facturación-en-xubio)
- [Notas de crédito](#notas-de-crédito)

---

## Los más frecuentes

| Mensaje | En una línea | Qué hacer |
|---|---|---|
| No se pudo conectar con *servicio*: parece estar caído. | El servicio no acepta conexiones. | Esperar y reintentar; si sigue, avisar a quien lo mantiene. |
| *Servicio* no respondió a tiempo. | Está vivo pero lento. | Reintentar en unos minutos. |
| *Servicio* rechazó la credencial del panel. | La clave cargada en Ajustes es incorrecta o venció. | Revisar la clave en Ajustes. |
| Configurá la API key de Products API para poder publicar. | Falta la clave de products-api. | Cargarla en Ajustes o en el servidor. Ver [Falta configuración](#falta-configuración). |
| Ya tenés una exportación en curso. | Solo se permite una exportación por usuario a la vez. | Esperar a que termine o cancelarla. |
| La factura ya tenía nota de crédito. | Esa venta ya está anulada. | Nada. |

---

## Servicios internos

Cuando un servicio falla, el panel arma el mensaje con el nombre del servicio y lo que conviene hacer. El detalle técnico (la respuesta completa, el error de conexión) queda en el log del servidor, no en pantalla.

| Mensaje | Qué pasó | Qué hacer |
|---|---|---|
| No se pudo conectar con *X*: parece estar caído. | No hubo conexión en 5 segundos. | Reintentar más tarde. Si sigue, el servicio está caído: avisar. |
| *X* no respondió a tiempo (*N* s). | Conectó, pero no contestó dentro del tiempo configurado. | Reintentar. Si pasa siempre en la misma acción, puede hacer falta subir el timeout en Ajustes. |
| *X* rechazó los datos enviados: *detalle*. | El servicio no aceptó lo que se le mandó. El detalle es la explicación del propio servicio. | Leer el detalle; suele ser un dato mal cargado. |
| *X* rechazó la credencial del panel. Revisá la API key en Ajustes. | La clave es incorrecta o no está. | Corregir la clave. |
| El panel no tiene permiso para esta operación en *X*. | La clave es válida, pero no alcanza para esa operación. | Pedir una clave con el permiso. |
| *X* no encontró lo que se pidió. | El registro no existe en el servicio (por ejemplo, un run o una carpeta). | Verificar el número o el nombre. |
| *X* tuvo un error interno (HTTP 5xx). | Falló el servicio. | Reintentar en unos minutos; si sigue, avisar con el código. |
| *X* está recibiendo demasiadas solicitudes. | El servicio está limitando el ritmo. | Esperar un minuto. |
| *X* respondió algo que el panel no pudo leer. | Respondió, pero no en el formato esperado. | Avisar: suele ser un proxy o un error del servicio. |

Los nombres que aparecen en lugar de *X*: **Madre**, **Products API**, **Catalog Sync API**, **el servicio de facturación** (Invoice API), **la Central de Promociones**, **Fravega** y **Microsoft Teams**.

---

## Falta configuración

Estos avisos aparecen cuando falta una dirección o una clave. Se cargan en **Ajustes → Panel Interno** (requiere ser administrador de Odoo) o como variable de entorno en el servidor. La lista completa está en [Arquitectura y configuración](tecnico.md#configuración).

| Mensaje | Qué falta |
|---|---|
| Configurá la API key de Products API para poder publicar. | *API key Products API* (`LQA_PRODUCTS_API_KEY`). |
| Configurá el token de Madre para usar el Publicador. | *Token Madre Retailers* (`LQA_RETAILERS_MADRE_API_TOKEN`), o el *Token interno* general. |
| Configurá el token interno de Madre para Retailers. | Lo mismo, para Órdenes de Retailers. |
| Configurá la clave interna de Invoice ARCA. | *Clave interna Invoice ARCA* (`LQA_ACCOUNTING_INVOICE_API_KEY`). |
| Configurá la clave interna de Madre para contabilidad. | *Clave interna Madre Contable* (`LQA_ACCOUNTING_MADRE_API_KEY`). |
| Configurá la URL y la API key de Pricing. | *URL* y *API key Pricing MercadoLibre*. |
| Configurá el endpoint de la Central de Promociones. | Las URLs de la Central de Promociones. |
| Configurá la URL del catálogo MercadoLibre / Automeli. | La URL del catálogo correspondiente. |
| Configurá primero el webhook de Microsoft Teams. | *Webhook Microsoft Teams*, para los avisos de órdenes. |

---

## Permisos

| Mensaje | Qué significa |
|---|---|
| No tenés permisos para *…* | Tu usuario no tiene el permiso de *Usuario comercial*. Lo asigna un administrador en **Usuarios y permisos**. |
| Solo administradores del panel pueden ejecutar acciones. | Las acciones de la Central de Promociones requieren *Administrador del panel*. |
| Solo administradores del panel pueden emitir notas de crédito. | Lo mismo, para las notas de crédito. |
| Solo podés eliminar carpetas creadas por tu usuario. | En Selecciones, cada uno elimina las suyas; un administrador, todas. |
| No podés quitarte tu propio acceso administrador. | Para que el panel nunca quede sin administrador por error. |
| Sin permiso (al abrir Ajustes) | Ajustes requiere ser administrador de Odoo; no alcanza con administrador del panel. |

---

## Por sección

### Catálogo y Selecciones

| Mensaje | Qué hacer |
|---|---|
| El filtro devuelve *N* productos. Refiná el filtro… | El filtro supera lo que entra en una carpeta (500.000 en MercadoLibre, 10.000 en Automeli). Acotarlo. |
| Esta carpeta ya tiene un guardado masivo en curso. | Esperar a que termine, o cancelarlo. |
| El archivo puede pesar como máximo 20 MB. | Dividir el archivo. |
| No encontré MLAs válidos en la primera columna. | La primera hoja tiene que tener una columna **MLA** con valores como `MLA1234567890`. |
| Solo se pueden reintentar procesos fallidos o cancelados. | Un proceso en curso o terminado no se reintenta. |

### Eliminador

| Mensaje | Qué hacer |
|---|---|
| Ingresá al menos una publicación MLA válida. | El texto o el CSV no tiene ningún valor con formato `MLA` + números. |

### Pricing

| Mensaje | Qué hacer |
|---|---|
| Hay filas con campos obligatorios faltantes: *filas* | A esas filas les falta MLA, categoría, tipo de publicación, SKU o precio. |
| Podés procesar hasta 5000 filas por job. | Dividir la carga, o usar una selección completa. |
| El contenido debe ser CSV con encabezados o un JSON array. | Revisar el formato de la carga manual. |
| El procesamiento debe terminar antes de generar el Excel. | Esperar a que terminen todos los lotes. |

### Publicador

| Mensaje | Qué hacer |
|---|---|
| El archivo debe incluir las columnas productId (o MLA) y sellerSku (o SKU). | Usar la plantilla de Carpetas. |
| Fila *N* incompleta: productId y sellerSku son obligatorios. | Completar esa fila. |
| No se pueden agregar más de 10000 productos por importación. | Dividir el archivo. |
| Confirmá el borrado de la carpeta: es permanente. | Llega solo si se pidió borrar sin confirmar. Desde la pantalla, la confirmación es el modal. |
| No hay fallidos para reintentar: ya están todos publicados en Fravega. | Nada: los fallidos de ese run ya quedaron publicados por otro. |

### Órdenes

| Mensaje | Qué hacer |
|---|---|
| Indicá fecha desde y hasta para consultar órdenes. | Completar las dos fechas. |

### Administración

| Mensaje | Qué hacer |
|---|---|
| Hay códigos TLQV inválidos: *códigos* | Los códigos tienen que tener la forma `TLQV-22281`. |
| Podés procesar hasta 2000 códigos TLQV por lote. | Dividir la carga de Clientes. |
| Podés anular como máximo 200 comprobantes por lote. | Dividir la carga de Notas de crédito. |
| La fecha del comprobante debe tener formato YYYY-MM-DD. | Elegir la fecha desde el calendario. |
| Invoice API rechazó la nota de crédito: *detalle* | El detalle viene de Invoice API. Ver [Notas de crédito](#notas-de-crédito). |

---

## Motivos de publicación

Cada SKU de un run termina **publicado**, **omitido** o **fallido**. Los omitidos no son errores: el producto no se publicó por una razón esperable. El motivo lo informa products-api, y Seguimiento lo muestra traducido, con el código y el paso donde se cortó.

| Código | Estado | Qué significa | Qué hacer |
|---|---|---|---|
| `PRODUCT_ALREADY_EXISTS` | Omitido | Ya está publicado en Fravega. | Nada. |
| `ALREADY_EXISTS_IN_FRAVEGA` | Omitido | Fravega dice que ya existe. | Nada. |
| `OUT_OF_STOCK` | Omitido | Sin stock en Mercado Libre. | Reponer stock y volver a publicar. |
| `MELI_STATUS_PAUSED` y otros `MELI_STATUS_*` | Omitido | La publicación de Mercado Libre no está activa (pausada, cerrada, en revisión). | Reactivarla si corresponde. |
| `MISSING_BRAND` · `MISSING_TITLE` · `MISSING_IMAGES` | Omitido | Falta marca, título o imágenes en Mercado Libre. | Completar en Mercado Libre. |
| `CATEGORY_NOT_FOUND` | Omitido | No hay una categoría equivalente en Fravega. | No se resuelve desde el panel. |
| `PRODUCT_NOT_FOUND` | Fallido | El SKU no está en el catálogo de Mercado Libre que usa products-api. | Revisar el SKU; si es nuevo, esperar a que se sincronice. |
| `NO_CLASSIC_LISTING` | Fallido | No tiene publicación clásica en Mercado Libre. | — |
| `INVALID_PRICE` · `PRICE_MAPPING_FAILED` | Fallido | El precio no es válido o no se pudo calcular. | Revisar el precio en Mercado Libre. |
| `MISSING_REQUIRED_ATTRIBUTES` | Fallido | Faltan atributos obligatorios de la categoría de Fravega. | Completar los atributos en Mercado Libre. |
| `IMAGE_PROCESSING_FAILED` | Fallido | Ninguna imagen se pudo procesar. | Revisar las imágenes. |
| `FRAVEGA_API_ERROR` u otro texto | Fallido | Fravega rechazó la publicación; se muestra su respuesta. | Leer el motivo. |

Los fallidos de un run terminado se pueden reintentar con **Reintentar fallidas**. Si el motivo sigue igual, van a volver a fallar.

---

## Facturación en Xubio

Las ventas que no se pudieron facturar aparecen en **Comprobantes fallidos**, con un código. Ese código lo decide **Invoice API**, no el panel. El catálogo completo, con el detalle de cada caso, está en la [documentación de Invoice API](https://invoice.loquieroaca.com/docs).

Los que más aparecen:

| Código | Qué significa | Qué hacer |
|---|---|---|
| `ALREADY_BILLED` | La venta ya tiene una factura vigente. | Nada. Para refacturar: nota de crédito, CAE y recién después la factura nueva. |
| `ORDER_STATUS_NOT_INVOICEABLE` | El pedido todavía no está en un estado facturable. | Esperar a que avance. |
| `MISSING_BUYER_CUIT` | El pedido no tiene el CUIT del comprador. | Cargarlo y reintentar. |
| `FISCAL_INFO_UNAVAILABLE` | No se pudo consultar AFIP/ARCA. No significa que el CUIT esté mal. | Reintentar más tarde. |
| `INVALID_FISCAL_DOCUMENT` | AFIP/ARCA no reconoce el CUIT, y es de empresa. | Revisar el CUIT. |
| `TLQV_SHEET_ITEM_NOT_FOUND` · `MADRE_SHEET_ITEM_NOT_FOUND` | La venta no tiene fila en la planilla. | Cargarla. |
| `INVALID_INVOICE_ISSUE_DATE` | Fecha inválida: futura o de más de 10 días atrás. | Usar una fecha de los últimos 10 días. |
| `XUBIO_INVOICE_DATE_SEQUENCE_ERROR` | Ya hay un comprobante con fecha posterior en la misma numeración. | Emitir con la fecha de hoy. |
| `XUBIO_INVOICE_CREATION_FAILED` | Xubio rechazó la factura. | Leer el motivo que devolvió. |

> El filtro **Motivo** de Comprobantes fallidos no incluye todos los códigos que hoy emite Invoice API. Ver [Limitaciones conocidas](tecnico.md#limitaciones-conocidas).

---

## Notas de crédito

Cuando una nota de crédito no se puede emitir, aparece en **Bloqueadas** con uno de estos motivos:

| Código | Qué significa | Qué hacer |
|---|---|---|
| `NO_LIVE_INVOICE` | El TLQV no tiene ninguna factura. | Nada que anular. |
| `ALREADY_CANCELLED` | La factura ya tenía nota de crédito. | Nada. |
| `INVOICE_HAS_NO_ITEMS` | La factura no tiene conceptos en Madre; suele faltar actualizar los comprobantes. | Correr **Actualizar comprobantes** del período y reintentar. |
| `INVOICE_DATA_INCOMPLETE` | Falta cliente, punto de venta o precio de algún concepto. | Revisar la factura en Xubio. |
| `COMPROBANTES_LOOKUP_FAILED` | No se pudo leer Madre. | Reintentar. |
| `NOTA_CREDITO_CREATION_FAILED` | Xubio rechazó la emisión. | Leer el motivo. |

`INVOICE_HAS_NO_ITEMS` y `COMPROBANTES_LOOKUP_FAILED` son los únicos que el panel marca como reintentables: los demás no se resuelven repitiendo.
