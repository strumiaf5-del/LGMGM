"""
dsp_chain.py — Apply a sequence of DSP features in one pass.

Lets the caller describe a chain like::

    chain = [
        {"feature": "spectral_tilt",  "params": {"tilt_db": -1.5, "pivot_hz": 1000.0}},
        {"feature": "saturation",     "params": {"drive": 0.2, "mode": "tape"}},
        {"feature": "phase_rotation", "params": {"freq_hz": 250.0, "angle_deg": 90.0, "q": 0.7}},
    ]

and get the cumulative result back as a single ``np.ndarray``. Implemented
features (Sprint 4):

- ``spectral_tilt`` — local first-order linear-tilt EQ.
- ``phase_rotation`` — delegated to ``mastering.phase_rotation`` (TODO if absent).
- ``saturation`` — delegated to ``mastering.harmonic_saturation``.

Other features are intentionally TODOs and raise ``NotImplementedError``
with a descriptive message so the chain caller can react gracefully.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Tuple

import numpy as np


SUPPORTED_FEATURES = ("spectral_tilt", "phase_rotation", "saturation")


def _apply_spectral_tilt(audio: np.ndarray, sr: int,
                         tilt_db: float = 0.0, pivot_hz: float = 1000.0) -> np.ndarray:
    """First-order linear-tilt EQ around ``pivot_hz``.

    Implemented inline because ``mastering.spectral_tilt`` is not present in
    this branch. The model is the standard "shelving slope of 6 dB/oct per
    |tilt_db|/octave-decade" approximation: a one-pole high-shelf for
    negative tilts (darker) and a one-pole low-shelf for positive tilts
    (brighter). Mono and ``[channels, samples]`` stereo both supported.
    """
    if audio is None or audio.size == 0 or abs(float(tilt_db)) < 1e-6:
        return audio.astype(np.float32, copy=True) if audio is not None else audio

    pivot = float(max(20.0, min(pivot_hz, sr / 2.0 - 10.0)))
    tilt = float(tilt_db)
    # A 6 dB/oct shelf gives 6 * |tilt_db| / 6 dB per octave away from pivot
    # when tilt_db == 6.0. We use a one-pole shelf: simpler, sufficient for
    # a chainable tilt pass.
    if tilt < 0:
        # Darker: low-pass, cutoff below pivot
        cutoff = pivot * (2.0 ** (tilt / 6.0))
    else:
        # Brighter: high-pass, cutoff above pivot
        cutoff = pivot * (2.0 ** (-tilt / 6.0))
    cutoff = float(max(20.0, min(cutoff, sr / 2.0 - 10.0)))

    rc = 1.0 / (2.0 * np.pi * cutoff)
    dt = 1.0 / float(sr)
    alpha = dt / (rc + dt)
    work = np.asarray(audio, dtype=np.float32)
    if work.ndim == 1:
        out = np.empty_like(work)
        y = 0.0
        if tilt < 0:
            for i, x in enumerate(work):
                y = y + alpha * (float(x) - y)
                out[i] = y
        else:
            x_prev = 0.0
            for i, x in enumerate(work):
                xv = float(x)
                out[i] = alpha * (y + xv - x_prev)
                y = out[i]
                x_prev = xv
        return out

    out = np.empty_like(work)
    if tilt < 0:
        for ch in range(work.shape[0]):
            y = 0.0
            for i in range(work.shape[1]):
                xv = float(work[ch, i])
                y = y + alpha * (xv - y)
                out[ch, i] = y
    else:
        for ch in range(work.shape[0]):
            y = 0.0
            x_prev = 0.0
            for i in range(work.shape[1]):
                xv = float(work[ch, i])
                out[ch, i] = alpha * (y + xv - x_prev)
                y = out[ch, i]
                x_prev = xv
    return out


def _apply_phase_rotation(audio: np.ndarray, sr: int,
                          freq_hz: float = 250.0,
                          angle_deg: float = 90.0,
                          q: float = 0.7) -> np.ndarray:
    """Delegate to ``mastering.phase_rotation`` if available."""
    import mastering  # local import keeps this module light on cold start
    fn = getattr(mastering, "phase_rotation", None)
    if fn is None:
        raise NotImplementedError(
            "phase_rotation is a TODO in apply_feature_chain: "
            "mastering.phase_rotation is not implemented yet"
        )
    return fn(audio, sr, freq_hz=freq_hz, angle_deg=angle_deg, q=q)


def _apply_saturation(audio: np.ndarray, sr: int,
                      drive: float = 0.2,
                      mode: str = "tape",
                      mix: float = 1.0) -> np.ndarray:
    """Delegate to ``mastering.harmonic_saturation``.

    Note: ``mastering.harmonic_saturation`` does not consume ``sr``; the
    parameter is accepted here only to keep the chain dispatch signature
    uniform (``fn(result, sr, **params)``).
    """
    import mastering
    return mastering.harmonic_saturation(audio, drive=drive, mode=mode, mix=mix)


_DISPATCH: Dict[str, Callable[..., np.ndarray]] = {
    "spectral_tilt": _apply_spectral_tilt,
    "phase_rotation": _apply_phase_rotation,
    "saturation": _apply_saturation,
}


def apply_feature_chain(audio: np.ndarray, sr: int,
                        chain: List[Dict[str, Any]]) -> np.ndarray:
    """Apply ``chain`` of DSP features to ``audio`` and return the result.

    Each step must be a dict with keys ``"feature"`` (str) and ``"params"``
    (dict, optional). Unknown features raise ``NotImplementedError`` so the
    caller can fall back to per-feature routing.

    The input buffer is copied on entry; subsequent steps operate on the
    previous step's output. The output dtype matches the input dtype when
    possible, otherwise ``float32``.
    """
    if audio is None:
        raise ValueError("audio must not be None")
    if not chain:
        return audio.astype(np.float32, copy=True) if audio.dtype != np.float32 else audio.copy()

    result = np.array(audio, copy=True)
    for idx, step in enumerate(chain):
        if not isinstance(step, dict):
            raise TypeError(f"chain[{idx}] must be a dict, got {type(step).__name__}")
        feature = step.get("feature")
        params = step.get("params", {}) or {}
        if feature not in _DISPATCH:
            raise NotImplementedError(
                f"chain[{idx}] feature {feature!r} is a TODO in apply_feature_chain; "
                f"supported features: {SUPPORTED_FEATURES}"
            )
        fn = _DISPATCH[feature]
        try:
            result = fn(result, sr, **params)
        except NotImplementedError:
            raise
        except Exception as exc:  # noqa: BLE001 - bubble up with context
            raise RuntimeError(
                f"chain[{idx}] feature {feature!r} failed: {exc}"
            ) from exc
    return result


__all__ = [
    "apply_feature_chain",
    "SUPPORTED_FEATURES",
]
