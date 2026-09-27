"""JWT redaction logging filter para LGMDM backend.

Aplica a TODOS los loggers (uvicorn, uvicorn.access, app) y reemplaza cualquier
token JWT (eyJ.... base64url.....) por <REDACTED_JWT>.

Por qué existe: el supervisor bash cachea el script en memoria, así que el
pipe `uvicorn | sed >> backend.log` sólo aplica en el primer arranque. Si
editamos el script después, bash NO lo relee y el sed queda desactivado.
Este filtro se carga dinámicamente desde app.py en cada import, así que
SIEMPRE está activo.

Uso desde app.py:
    from backend.logging_filters import install_jwt_redaction
    install_jwt_redaction()
"""

from __future__ import annotations

import logging
import re
from typing import Final

_JWT_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"eyJ[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+"
)
_REDACTED: Final[str] = "<REDACTED_JWT>"


class _JwtRedactionFilter(logging.Filter):
    """Filter that replaces JWT tokens in log records with a placeholder.

    Estrategia: mantener `record.msg` intacto (es el string de formato con
    placeholders %s) y modificar SOLO los strings dentro de `record.args`.
    Esto preserva la firma esperada por formatters como el de uvicorn
    (AccessFormatter) que desempaqueta args por posición.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            args = record.args
            if args:
                if isinstance(args, dict):
                    new_args = {
                        k: _JWT_PATTERN.sub(_REDACTED, v) if isinstance(v, str) and "eyJ" in v else v
                        for k, v in args.items()
                    }
                    if new_args != args:
                        record.args = new_args
                else:
                    new_args = tuple(
                        _JWT_PATTERN.sub(_REDACTED, a) if isinstance(a, str) and "eyJ" in a else a
                        for a in args
                    )
                    if new_args != args:
                        record.args = new_args
        except Exception:
            pass
        return True


def install_jwt_redaction() -> None:
    """Attach the JWT redaction filter to the root logger.

    Safe to call multiple times (idempotent): if the filter is already
    installed on a handler, we don't add a second copy.
    """
    flt = _JwtRedactionFilter()
    root = logging.getLogger()
    root.addFilter(flt)
    for handler in root.handlers:
        if not any(isinstance(f, _JwtRedactionFilter) for f in handler.filters):
            handler.addFilter(flt)
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        lg = logging.getLogger(name)
        lg.addFilter(flt)
        for handler in lg.handlers:
            if not any(isinstance(f, _JwtRedactionFilter) for f in handler.filters):
                handler.addFilter(flt)
