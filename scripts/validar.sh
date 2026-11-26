#!/usr/bin/env bash
#
# Las mismas validaciones que corre el CI antes de desplegar.
# Uso:  bash scripts/validar.sh
#
# Necesita Python 3 con libsass (pip install libsass) y Node 20 o superior.
# Con PYTHON=/ruta/a/python se usa otro interprete (por ejemplo, un venv).
set -euo pipefail

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"
PY=${PYTHON:-python3}
FALLAS=0

paso() { printf '\n== %s\n' "$*"; }
falla() { printf '   FALLA: %s\n' "$*"; FALLAS=$((FALLAS + 1)); }

paso "Python compila"
"$PY" -m compileall -q addons/lqa_admin_panel || falla "hay errores de sintaxis"

paso "XML bien formado"
"$PY" - <<'PY' || falla "hay XML roto"
import glob, sys
from xml.etree import ElementTree as ET
bad = 0
for f in glob.glob('addons/**/*.xml', recursive=True):
    try:
        ET.parse(f)
    except ET.ParseError as e:
        print(f"   {f}: {e}"); bad += 1
sys.exit(1 if bad else 0)
PY

paso "SCSS compila con libsass (el compilador de Odoo)"
# Un min()/max() de CSS con unidades mezcladas rompe los estilos de TODO el panel.
if "$PY" -c "import sass" 2>/dev/null; then
    "$PY" - <<'PY' || falla "algun SCSS no compila"
import glob, sys, sass
bad = 0
for f in sorted(glob.glob('addons/**/static/src/scss/*.scss', recursive=True)):
    try:
        sass.compile(filename=f)
    except sass.CompileError as e:
        print(f"   {f}: {e}"); bad += 1
sys.exit(1 if bad else 0)
PY
else
    falla "falta libsass: pip install libsass (o PYTHON=/ruta/al/venv/bin/python)"
fi

paso "JS parsea como modulo"
# node --check sobre un .js lo lee como CommonJS y deja pasar errores: va como .mjs.
if command -v node >/dev/null 2>&1; then
    TMP=$(mktemp -d)
    for f in addons/*/static/src/js/*.js; do
        cp "$f" "$TMP/$(basename "${f%.js}").mjs"
    done
    for m in "$TMP"/*.mjs; do
        node --check "$m" || falla "$(basename "$m" .mjs).js no parsea"
    done
    rm -rf "$TMP"
else
    falla "falta node"
fi

paso "Firmas de los metodos del addon"
"$PY" deploy/check_signatures.py || falla "hay llamadas con argumentos que no coinciden"

paso "Tests del sitio de documentacion"
"$PY" -m unittest discover -s tests || falla "fallan los tests"

echo
if [ "$FALLAS" -gt 0 ]; then
    echo "$FALLAS validacion(es) fallaron: corregir antes de subir."
    exit 1
fi
echo "Todo OK."
