import atexit
import json
import logging
import os
import threading
from typing import Any, Callable, Optional

_log = logging.getLogger("lgmdm.job_store")


class PersistableJobState(dict):
    """Dict que persiste su estado cuando se modifica."""

    def __init__(self, data: Optional[dict] = None, persist_cb: Optional[Callable[[], None]] = None):
        super().__init__()
        self._persist_cb = persist_cb
        # Each job state is accessed from request/background threads.
        # The original implementation referenced `_state_lock` in __getitem__
        # and related methods but never initialized it, causing:
        # AttributeError: 'PersistableJobState' object has no attribute '_state_lock'
        self._state_lock = threading.RLock()
        if data:
            with self._state_lock:
                super().update(data)

    def _persist(self) -> None:
        if self._persist_cb is not None:
            self._persist_cb()

    def __setitem__(self, key: str, value: Any) -> None:
        super().__setitem__(key, value)
        self._persist()


    def __getitem__(self, key: str) -> Any:
        with self._state_lock:
            return super().__getitem__(key)

    def __contains__(self, key: object) -> bool:
        with self._state_lock:
            return super().__contains__(key)

    def items(self):
        with self._state_lock:
            return list(super().items())

    def update(self, *args, **kwargs) -> None:
        """Actualiza el dict de forma thread-safe y persiste cambios."""
        # En PersistableJobState no tenemos _state_lock, pero es creado
        # con un persist callback del JobStore que ya tiene sus propios locks.
        # Sin embargo, para máxima seguridad en actualizaciones complejas,
        # es preferible llamar a __setitem__ individualmente que a super().update(),
        # lo cual es mejor para detectar cambios. Pero aquí mantenemos super().update()
        # porque el JobStore que lo llama ya maneja sincronización a nivel superior.
        super().update(*args, **kwargs)
        self._persist()

    def setdefault(self, key: str, default: Any = None) -> Any:
        if key in self:
            return self[key]
        super().__setitem__(key, default)
        self._persist()
        return default

    def pop(self, key: str, default: Any = None) -> Any:
        value = super().pop(key, default)
        self._persist()
        return value

    def popitem(self):
        value = super().popitem()
        self._persist()
        return value

    def clear(self) -> None:
        super().clear()
        self._persist()


class JobStore(dict):
    """Almacén de jobs en memoria con persistencia JSON diferida (debounced).

    La escritura a disco ocurre como máximo una vez cada DEBOUNCE_SEC segundos,
    aunque haya muchos updates de progreso intermedios (antes se escribía en CADA
    update, llegando a 20 escrituras/seg durante un job en curso).
    """

    DEBOUNCE_SEC = 0.5   # segundos de inactividad antes de escribir a disco

    def __init__(self, storage_dir: Optional[str] = None, filename: str = "jobs.json"):
        super().__init__()
        self.storage_dir = storage_dir or os.getenv("JOB_STORE_DIR") or os.path.join(
            os.path.dirname(__file__), "..", "data", "jobs"
        )
        self.filename = filename
        os.makedirs(self.storage_dir, exist_ok=True)
        self._path = os.path.join(self.storage_dir, filename)

        # Debounce: un solo timer activo por instancia
        self._timer: Optional[threading.Timer] = None
        self._timer_lock = threading.RLock()
        self._state_lock = threading.RLock()

        self._load()
        # Garantizar flush final si el proceso se cierra sin que el timer haya disparado
        atexit.register(self._flush)

    def _load(self) -> None:
        if not os.path.exists(self._path):
            return
        try:
            with open(self._path, "r", encoding="utf-8") as handle:
                raw = json.load(handle)
        except (json.JSONDecodeError, OSError):
            return

        with self._state_lock:
            super().clear()
            for key, value in raw.items():
                if isinstance(value, dict):
                    super().__setitem__(key, PersistableJobState(value, self._persist))
                else:
                    super().__setitem__(key, value)

    def _to_serializable(self) -> dict:
        with self._state_lock:
            # BUGFIX: usar super().items() en lugar de self.items() para evitar
            # deadlock — self.items() ya adquiere _state_lock (línea 181)
            return {key: dict(value) if isinstance(value, PersistableJobState) else value for key, value in super().items()}

    # ── Persistencia diferida ─────────────────────────────────────────────────

    def _persist(self) -> None:
        """Programa una escritura diferida; cancela y reemplaza el timer anterior."""
        with self._timer_lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(self.DEBOUNCE_SEC, self._flush)
            self._timer.daemon = True
            self._timer.start()

    def _flush(self) -> None:
        """Escribe a disco de forma atómica (tmp + rename). Sin debounce.

        BUGFIX Sep 12: sanitizamos antes de json.dump. Antes fallaba con
        TypeError si algún job traía SourceFileLoader / module refs en su dict.
        """
        with self._timer_lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
        tmp = self._path + ".tmp"
        try:
            data = self._to_serializable()
            clean, stripped_count = self._strip_for_persistence(data)
            if stripped_count > 0:
                _log.warning(
                    "_flush(): %d non-JSON-serializable value(s) coerced; some debug info may be lossy",
                    stripped_count,
                )
            with open(tmp, "w", encoding="utf-8") as handle:
                json.dump(clean, handle, ensure_ascii=False, indent=2)
            os.replace(tmp, self._path)   # atómico en POSIX
        except OSError:
            try:
                os.remove(tmp)
            except OSError:
                pass

    @staticmethod
    def _strip_for_persistence(obj: Any, path: str = "<root>", stats: Optional[list] = None):
        """Recorre `obj`, sustituye por string cualquier valor no JSON-serializable.
        Devuelve tupla (objeto_limpio, cantidad_de_sustituciones)."""
        if stats is None:
            stats = [0]

        result, was_clean = _try_strip(obj, path, stats)
        return result, stats[0]


def _try_strip(value: Any, path: str, stats: list, _seen: Optional[set] = None):
    """Igual que _strip_non_serializable pero registra sustituciones en stats.

    `_seen` evita RecursionError cuando hay referencias circulares.
    """
    if _seen is None:
        _seen = set()
    obj_id = id(value)
    if obj_id in _seen:
        return "<circular>", False
    if value is None or isinstance(value, (bool, int, float, str)):
        return value, True
    if isinstance(value, (set, frozenset)):
        _seen.add(obj_id)
        items = [_try_strip(v, f"{path}[]", stats, _seen) for v in value]
        _seen.discard(obj_id)
        return [it[0] for it in items], False
    if isinstance(value, (list, tuple)):
        _seen.add(obj_id)
        out = []
        all_clean = True
        for i, v in enumerate(value):
            sub, clean = _try_strip(v, f"{path}[{i}]", stats, _seen)
            if not clean:
                all_clean = False
            out.append(sub)
        _seen.discard(obj_id)
        return out, all_clean
    if isinstance(value, dict):
        _seen.add(obj_id)
        out = {}
        all_clean = True
        for k, v in value.items():
            try:
                key = str(k)
            except Exception:
                key = f"<bad-key:{type(k).__name__}>"
                all_clean = False
            sub, clean = _try_strip(v, f"{path}.{key}", stats, _seen)
            if not clean:
                all_clean = False
            out[key] = sub
        _seen.discard(obj_id)
        return out, all_clean
    # numpy arrays
    if hasattr(value, 'tolist') and callable(value.tolist):
        try:
            sub, clean = _try_strip(value.tolist(), f"{path}.tolist", stats, _seen)
            return sub, clean
        except Exception:
            pass
    # bytes-like
    if isinstance(value, (bytes, bytearray, memoryview)):
        try:
            length = len(bytes(value))
        except Exception:
            length = -1
        text = f"<bytes-like type={type(value).__name__} len={length}>"
        stats[0] += 1
        return text, False
    # Tipos no-JSON (funciones, módulos, SourceFileLoader, etc.)
    try:
        repr_text = repr(value)
    except Exception:
        repr_text = f"<unreprable {type(value).__name__}>"
    short = repr_text[:200]
    stats[0] += 1
    text = f"<non-serializable type={type(value).__module__}.{type(value).__name__} at {path} repr={short}>"
    return text, False

    def __del__(self) -> None:
        try:
            self._flush()
        except Exception:
            pass

    # ── Overrides del dict ────────────────────────────────────────────────────

    def __setitem__(self, key: str, value: Any) -> None:
        with self._state_lock:
            if isinstance(value, dict) and not isinstance(value, PersistableJobState):
                value = PersistableJobState(value, self._persist)
            super().__setitem__(key, value)
        # Creación de job nuevo → flush inmediato para no perder si cae el proceso
        self._flush()


    def __getitem__(self, key: str) -> Any:
        with self._state_lock:
            return super().__getitem__(key)

    def __contains__(self, key: object) -> bool:
        with self._state_lock:
            return super().__contains__(key)

    def items(self):
        with self._state_lock:
            return list(super().items())

    def update(self, *args, **kwargs) -> None:
        for mapping in args:
            if hasattr(mapping, "items"):
                for key, value in mapping.items():
                    self[key] = value
            else:
                raise TypeError("update expected a mapping")
        for key, value in kwargs.items():
            self[key] = value

    def setdefault(self, key: str, default: Any = None) -> Any:
        with self._state_lock:
            if key in self:
                return self[key]
        self[key] = default
        with self._state_lock:
            return self[key]

    def pop(self, key: str, default: Any = None) -> Any:
        with self._state_lock:
            value = super().pop(key, default)
        self._flush()   # baja frecuencia → flush inmediato
        return value

    def popitem(self):
        with self._state_lock:
            value = super().popitem()
        self._flush()
        return value

    def clear(self) -> None:
        with self._state_lock:
            super().clear()
        self._flush()
