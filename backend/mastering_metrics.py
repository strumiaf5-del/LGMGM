"""
mastering_metrics.py — Aggregate-mastering-metrics helper.

Combines several independent DSP measurements (LUFS, LRA, crest, correlation,
true-peak, DC offset) into a single dict so callers avoid running the same
expensive passes multiple times. This is *only* an orchestrator: it imports
the canonical implementations from `mastering.py` and never reimplements any
DSP math.

Two entry points:

- :func:`aggregate_metrics` — always recomputes. Use when the caller mutates
  the buffer between calls or wants a guaranteed fresh result.
- :func:`aggregate_metrics_cached` — wraps the same logic with
  ``functools.lru_cache(maxsize=128)``. Use when the same audio buffer is
  re-measured repeatedly (e.g. UI re-renders, dashboard polls on an
  immutable numpy array). The cache key is
  ``(sr, audio.shape, audio.dtype, audio.tobytes())`` so identical buffers
  hit the cache deterministically.
"""

from __future__ import annotations

import functools
from typing import Any, Dict

import numpy as np


def _aggregate_metrics_inner(audio: np.ndarray, sr: int) -> Dict[str, float]:
    """Pure implementation. Assumes valid numpy arrays; caller must hold any
    needed locks. No caching; callers wrap as needed."""
    # Imports are local so that module import order does not surprise callers
    # (mastering.py is heavy and may itself import this file transitively).
    from mastering import (  # noqa: WPS433 - intentional local import
        band_crest_factors,
        measure_dc_offset,
        measure_lufs_integrated,
        short_term_loudness_and_lra,
        stereo_correlation,
        true_peak_dbfs,
    )

    def _safe(fn, default: float, *args, **kwargs) -> float:
        try:
            val = fn(*args, **kwargs)
            if isinstance(val, tuple):
                val = val[1] if len(val) > 1 else val[0]
            f = float(val)
            return f if np.isfinite(f) else default
        except Exception:
            return default

    try:
        crest_bands = band_crest_factors(audio, sr)
        if "overall" in crest_bands:
            crest_factor = float(crest_bands["overall"])
        elif crest_bands:
            # No "overall" key (the current `mastering.band_crest_factors`
            # only emits per-band keys). Use the worst-of-bands as the
            # broadband proxy — this is the band the listener will perceive as
            # "most compressed" and is the most actionable single number.
            crest_factor = float(max(crest_bands.values()))
        else:
            crest_factor = 0.0
    except Exception:
        crest_factor = 0.0

    return {
        "lufs_integrated": _safe(measure_lufs_integrated, -70.0, audio, sr),
        "lra": _safe(short_term_loudness_and_lra, 0.0, audio, sr),
        "crest_factor": crest_factor,
        "correlation": _safe(stereo_correlation, 1.0, audio),
        "true_peak_dbfs": _safe(true_peak_dbfs, -20.0, audio, sr),
        "dc_offset": _safe(measure_dc_offset, 0.0, audio),
    }


def aggregate_metrics(audio: np.ndarray, sr: int) -> Dict[str, float]:
    """Run the full mastering-metrics suite in one call (uncached).

    Returns a flat dict with the following keys (all floats, all finite):

    - ``lufs_integrated``: integrated LUFS (BS.1770) of the signal.
    - ``lra``: Loudness Range (EBU R128, LU).
    - ``crest_factor``: broadband crest factor (peak / RMS) in dB, with a
      fallback to the worst-of-three-band crest factor from
      ``band_crest_factors`` when the bands dict has no ``"overall"`` key.
    - ``correlation``: stereo L/R Pearson correlation in ``[-1, +1]`` (1.0
      for mono signals).
    - ``true_peak_dbfs``: true peak in dBTP (4x oversampled).
    - ``dc_offset``: mean DC offset of the signal.

    Args:
        audio: 1-D mono buffer or 2-D ``[channels, samples]`` buffer.
        sr: Sample rate in Hz.

    Returns:
        Flat dict of float metrics; never raises (errors in individual
        measurements degrade to neutral values).
    """
    return _aggregate_metrics_inner(audio, sr)


@functools.lru_cache(maxsize=128)
def _aggregate_metrics_cached(
    audio_bytes: bytes,
    shape: tuple,
    dtype_str: str,
    sr: int,
) -> Dict[str, float]:
    """Hashable-keyed cache wrapper. See :func:`aggregate_metrics_cached`."""
    audio = np.frombuffer(audio_bytes, dtype=np.dtype(dtype_str)).reshape(shape)
    return _aggregate_metrics_inner(audio, sr)


def aggregate_metrics_cached(audio: np.ndarray, sr: int) -> Dict[str, float]:
    """LRU-cached (maxsize=128) version of :func:`aggregate_metrics`.

    Identical buffers (byte-equal, same shape/dtype/sr) hit the cache. Buffers
    that have been mutated in place between calls will still hit the cache
    until eviction — callers that mutate the buffer should use the uncached
    :func:`aggregate_metrics` instead.

    Note on memory: the cache key carries ``audio.tobytes()``, so a cached
    entry retains a copy of the buffer. ``maxsize=128`` bounds total memory
    to roughly ``128 * audio.nbytes`` worst-case. For typical mastering
    buffers this is acceptable; for huge buffers consider the uncached
    variant.
    """
    return _aggregate_metrics_cached(
        audio.tobytes(),
        tuple(audio.shape),
        str(audio.dtype),
        int(sr),
    )


def _aggregate_metrics_cached_cache_info() -> functools._CacheInfo:
    """Expose ``lru_cache`` stats for tests and the dashboard."""
    return _aggregate_metrics_cached.cache_info()


__all__ = [
    "aggregate_metrics",
    "aggregate_metrics_cached",
    "_aggregate_metrics_cached_cache_info",
]
