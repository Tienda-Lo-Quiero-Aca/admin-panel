# Operación

Dónde corre el panel, cómo se despliega, cómo se rotan las credenciales y qué hacer ante los problemas más frecuentes.

← [Volver al inicio](../README.md)

> Esta página describe el servidor. En el sitio solo se publica cuando `/docs` está protegido con usuario y clave.

**Contenido**

1. [Dónde corre](#dónde-corre)
2. [Deploy](#deploy)
3. [Verificar que está sano](#verificar-que-está-sano)
4. [Variables y credenciales](#variables-y-credenciales)
5. [Backups](#backups)
6. [Problemas frecuentes](#problemas-frecuentes)

Los comandos de esta página se corren en el servidor, dentro de `/opt/admin-panel`, y usan este prefijo:

```bash
cd /opt/admin-panel
COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"
```

---

## Dónde corre

Un droplet de DigitalOcean, en `admin.loquieroaca.com`, con tres contenedores de Docker Compose:

| Servicio | Imagen | Qué hace |
|---|---|---|
| `db` | `postgres:16` | La base `lqa_panel_prod`, en el volumen `lqa-panel-db-data`. |
| `odoo` | `odoo:18.0` | El panel. 2 workers web, 1 hilo de cron, 512 MB de memoria blanda y 768 MB dura por worker. |
| `caddy` | `caddy:2-alpine` | HTTPS con certificado automático. Manda `/websocket` al puerto 8072 de Odoo y el resto al 8069. |

- **Código:** `/opt/admin-panel`, un clon del repo en la rama `main`. El addon se monta en Odoo como solo lectura, y también el `README.md` y `docs/` para `/docs`.
- **Configuración de Odoo:** `config/odoo.prod.conf` es la plantilla. `deploy/render-odoo-config.sh` le agrega las contraseñas de `.env.production` y genera `config/odoo.runtime.conf`, que no está en git.
- **Logs:** cada contenedor guarda hasta 3 archivos de 10 MB.

---

## Deploy

Un push a `main` dispara el workflow **Deploy al droplet** en GitHub Actions, siempre que toque el addon, la infraestructura o la documentación:

1. **validar** — compila Python, XML, SCSS y JS, chequea las firmas de los métodos y corre los tests. Ver [Validaciones y tests](tecnico.md#validaciones-y-tests). Si algo falla, no se despliega.
2. **desplegar** — entra al servidor por SSH y corre `./deploy/deploy.sh`.

Nunca corren dos deploys a la vez. El workflow también se puede lanzar a mano desde GitHub (*Run workflow*).

### Qué hace deploy.sh

Mira qué cambió desde el último deploy **que terminó bien** y hace solo lo necesario:

| Cambió | Qué hace |
|---|---|
| Nada del addon, la infra ni el README (por ejemplo, solo `docs/`) | Actualiza el código y termina. `docs/` se ve en caliente. |
| Solo estilos o JS (`static/`) | Reinicia Odoo. El paquete de estilos y scripts se regenera al arrancar. |
| `README.md` | Reinicia Odoo, para que `/docs` vea el archivo nuevo. |
| `.py`, `.xml` o `.csv` del addon | Backup, **upgrade del módulo** y reinicio. |
| `docker-compose.prod.yml`, `config/` o `deploy/` | Regenera la configuración y **recrea** el contenedor de Odoo. |

Detalles que importan:

- **Backup antes de un upgrade.** Si ya hay uno de menos de 60 minutos, lo reutiliza: el dump pesa unos 600 MB y tarda unos tres minutos. Si el backup falla, el deploy se aborta.
- **Siempre reinicia** después de un upgrade. El código Python solo se carga al arrancar Odoo; sin el reinicio, el upgrade corría pero Odoo seguía sirviendo la versión anterior.
- **Verifica la versión.** Compara la versión instalada del módulo con la del `__manifest__.py`. Por eso hay que **subir la versión del manifiesto en cada cambio del addon**: es la forma de confirmar que entró el código nuevo.
- **Recuerda lo desplegado.** El último commit que terminó bien queda en `.deploy-state`. Si un deploy se corta a mitad de camino, el siguiente vuelve a intentar desde ahí, sin dar por bueno el estado a medias.
- **Para forzarlo:** `FORCE_DEPLOY=1 ./deploy/deploy.sh` aplica todo de nuevo aunque no haya commits nuevos.

### Confirmar que quedó la versión nueva

El log del deploy termina con esta línea:

```
OK en 9a7c7a7 (modulo 18.0.1.0.125)
```

Desde una terminal con `gh`:

```bash
gh run list --limit 1
gh run view <id> --log | grep "OK en"
```

Si el panel se sigue viendo igual, recargá con **Cmd+Shift+R**: el navegador puede tener guardada la versión anterior de los estilos y scripts.

---

## Verificar que está sano

```bash
$COMPOSE ps                                   # los tres servicios "Up"; db "healthy"
curl -s -o /dev/null -w "%{http_code}\n" https://admin.loquieroaca.com/web/login   # 200
$COMPOSE logs --tail 100 odoo                 # errores recientes
```

- **Errores al usar el panel:** los fallos de los servicios internos quedan en el log de Odoo con la ruta y la respuesta completa (`GET https://… -> HTTP 502: …`). En pantalla el usuario ve una frase en castellano; el detalle está acá.
- **Si un servicio interno parece caído,** probalo desde el servidor:

  ```bash
  curl -s -o /dev/null -w "conexión %{time_connect}s · código %{http_code}\n" --connect-timeout 10 https://api.madre.loquieroaca.com/
  ```

  Si la conexión no se establece, el servicio está caído o bloqueado: el problema está en ese servidor, no en el panel.

---

## Variables y credenciales

Los valores se cargan en **Ajustes → Panel Interno** (gana sobre todo lo demás) o en `.env.production`. La lista completa, con qué variable corresponde a cada ajuste, está en [Configuración](tecnico.md#configuración).

### Cambiar una variable de entorno

1. Editar `.env.production`. Cada línea con el formato `CLAVE=valor`, **desde la columna 0**, sin comillas. Una línea con sangría o con `CLAVE: valor` se ignora **sin aviso**.
2. **Recrear** el contenedor. Reiniciarlo no alcanza, porque no vuelve a leer las variables. El panel queda caído unos 10 segundos:

   ```bash
   $COMPOSE up -d --force-recreate odoo
   ```

3. Confirmar que llegó, sin mostrar el valor en pantalla:

   ```bash
   $COMPOSE exec -T odoo sh -c 'test -n "$LQA_PRODUCTS_API_KEY" && echo cargada || echo VACIA'
   ```

Antes de cargar una variable, fijate que `docker-compose.prod.yml` se la pase a Odoo. Algunas que el código lee no están en el compose, y esas solo se configuran desde Ajustes. Ver [Configuración](tecnico.md#configuración).

### Credenciales de la documentación

`/docs` queda abierto mientras no haya usuario y clave. Para protegerlo y publicar también esta página:

1. En `.env.production`: `DOCS_SITE_USER=…` y `DOCS_SITE_PASSWORD=…`, las dos completas.
2. Recrear Odoo, como arriba.
3. Abrir `https://admin.loquieroaca.com/docs`: tiene que pedir credenciales.

Para **rotarlas**, cambiar los dos valores y recrear. Para **sacarlas**, dejarlas vacías y recrear: el sitio vuelve a quedar abierto, sin esta página.

### Clave SSH del deploy

GitHub Actions entra al servidor con una clave dedicada. Está en el environment **production** del repo, como tres secrets: `DROPLET_SSH_KEY` (la clave privada), `DROPLET_KNOWN_HOSTS` (la huella del servidor) y `DROPLET_HOST`.

Para rotarla:

1. En el servidor, generar una clave nueva y autorizarla:

   ```bash
   ssh-keygen -t ed25519 -N "" -C github-actions-deploy -f ~/.ssh/deploy_nueva
   cat ~/.ssh/deploy_nueva.pub >> ~/.ssh/authorized_keys
   ```

2. Cargar la clave privada en GitHub **sin copiarla ni pegarla en ningún lado**: que vaya directo del archivo a `gh`.

   ```bash
   gh secret set DROPLET_SSH_KEY --env production -R <org>/admin-panel < ~/.ssh/deploy_nueva
   ```

3. Lanzar el workflow a mano y confirmar que termina en `OK en …`.
4. Recién entonces sacar la clave vieja de `~/.ssh/authorized_keys` y borrar los archivos de la nueva del servidor.

### Contraseña de un usuario del panel

Odoo no guarda las contraseñas, solo un hash: no se pueden recuperar, solo reemplazar. Si el link "¿Olvidaste tu contraseña?" del login no envía el mail, se cambia desde el servidor:

```bash
$COMPOSE exec odoo odoo shell --config=/etc/odoo/odoo.conf -d lqa_panel_prod --no-http
```

En la consola de Odoo, primero ubicar al usuario y después pedir la contraseña nueva sin que se vea; reemplazá `ID` por el número que muestra la primera línea. En la consola, un `for` necesita una línea vacía (Enter) para terminar:

```python
for u in env['res.users'].with_context(active_test=False).search([('share', '=', False)]): print(u.id, u.login, u.name)

import getpass; u = env['res.users'].browse(ID); print(u.login); u.password = getpass.getpass('Nueva contraseña: '); env.cr.commit()
```

---

## Backups

```bash
./deploy/backup.sh
```

Guarda en `backups/` un dump de la base (`database-<fecha>.dump`, formato custom de `pg_dump`) y el filestore de Odoo (`filestore-<fecha>.tar.gz`). Borra los de más de 14 días y conserva como máximo los 10 más nuevos de cada tipo.

El deploy lo corre solo antes de cada upgrade. Para restaurar, `pg_restore` sobre una base vacía y el filestore descomprimido en `/var/lib/odoo`, con Odoo detenido.

Una base nueva desde cero, con el addon instalado y el usuario `admin`:

```bash
./deploy/bootstrap-database.sh
```

---

## Problemas frecuentes

### Subí un cambio y se sigue viendo igual

1. **¿Corrió el deploy?** `gh run list --limit 1`. El workflow solo se dispara si el push toca `addons/`, `config/`, `deploy/`, `docker-compose.prod.yml`, `README.md`, `docs/` o `tests/`.
2. **¿Terminó en `OK en <sha>`** con el commit que subiste?
3. **¿Subiste la versión del manifiesto?** Sin eso no hay forma de confirmar que entró el código nuevo.
4. **Recargá con Cmd+Shift+R.**

### "No se pudo conectar con… parece estar caído"

El servicio no acepta conexiones. Confirmalo desde el servidor con el `curl` de [Verificar que está sano](#verificar-que-está-sano). Si tampoco conecta desde ahí, el problema está en ese servicio: hay que levantarlo en su propio servidor. El panel corta esas llamadas a los 5 segundos, así que el resto sigue funcionando.

### El panel anda lento para todos

Odoo tiene 2 workers. Si dos operaciones lentas los ocupan a la vez, el resto espera. Buscá en el log las llamadas largas, y fijate si algún servicio interno está respondiendo lento:

```bash
$COMPOSE logs --since 15m odoo | grep -E "HTTP 5|Timeout|ConnectTimeout"
docker stats --no-stream
```

### Una variable de entorno no tiene efecto

Revisá, en orden:

1. **El formato:** `CLAVE=valor` desde la columna 0.
2. **Que `docker-compose.prod.yml` se la pase a Odoo.**
3. **Que hayas recreado el contenedor**, no solo reiniciado.
4. **Que no esté cargada en Ajustes:** ahí gana el valor de Ajustes.

### "Configurá la API key de Products API para poder publicar"

Cargala en Ajustes (*API key Products API*) o como `LQA_PRODUCTS_API_KEY`, y recreá. Si después aparece "Products API rechazó la credencial del panel", la clave está mal copiada o no es la de producción.

### "Sin permiso" al abrir Ajustes

Ajustes requiere ser administrador de Odoo, no alcanza con administrador del panel. Entrá con un usuario administrador, o cargá el valor por variable de entorno.

### El disco se llena

Revisá qué ocupa:

```bash
df -h /
du -sh backups /var/lib/docker
```

Los backups tienen límite (14 días, 10 de cada tipo) y los logs de los contenedores también (3 × 10 MB). Si crece otra cosa, suele ser el volumen de la base o el filestore.

### El deploy falló

Leé el log del workflow. Los cortes más comunes son:

| Mensaje | Qué pasó |
|---|---|
| `fallo el backup; se aborta el deploy` | No se pudo hacer el dump: base caída o disco lleno. |
| `el panel no respondio tras el deploy` | Odoo no arrancó. Mirar `$COMPOSE logs --tail 200 odoo`; suele ser un error de Python o de XML del addon. |
| `el modulo quedo en X y el repo trae Y` | El upgrade no se aplicó. Mirar el log del upgrade y relanzar. |

Corregido el problema, relanzá el workflow. El deploy retoma desde el último commit que terminó bien.
