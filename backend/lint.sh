#!/bin/bash
# Linting del backend: ruff (estilo) + mypy (tipos)
# CORRE SIN TOCAR EL CÓDIGO (solo reporta). Para auto-fix, correr ruff --fix
# manualmente y revisar los cambios antes de commitear.
set -e
cd "$(dirname "$0")"

echo "=== ruff check (estilo + pyflakes) ==="
python3 -m ruff check . || echo "ruff: errores encontrados (ver arriba)"

echo ""
echo "=== mypy (tipos) ==="
python3 -m mypy app.py auth.py --ignore-missing-imports 2>&1 | tail -5 || echo "mypy: errores encontrados"
