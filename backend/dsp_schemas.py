"""
dsp_schemas.py — Pydantic response schemas for the 10 Pro DSP features.

Pure data-shape contracts. No DSP, no FastAPI imports — these schemas are
imported by routers (or by tests) for `response_model=...` typing and for
JSON contract documentation. Pydantic v2 only; no external deps.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class LoudnessPenaltyResponse(BaseModel):
    """Codec-induced loudness penalty (LUFS delta vs original)."""
    orig_lufs: float = Field(..., description="Integrated LUFS pre-codec")
    post_lufs: float = Field(..., description="Integrated LUFS post-codec")
    penalty_db: float = Field(..., description="LUFS delta: post - orig (negative = lossy codec ate loudness)")
    codec: str = Field(..., description="Codec name (e.g. 'opus', 'aac', 'mp3')")
    bitrate: int = Field(..., description="Codec bitrate in kbps")


class PhaseRotationResponse(BaseModel):
    """All-pass phase rotation around a target frequency."""
    freq_hz: float = Field(..., description="Center frequency of the all-pass in Hz")
    angle_deg: float = Field(..., description="Phase shift at the center frequency, in degrees")
    q: float = Field(..., description="Q (quality factor) of the all-pass")
    output_path: Optional[str] = Field(default=None, description="Optional path to rendered WAV")


class SpectralTiltResponse(BaseModel):
    """Linear (per-octave) spectral tilt EQ result."""
    tilt_db: float = Field(..., description="Applied tilt in dB per octave (negative = darker)")
    pivot_hz: float = Field(..., description="Pivot frequency at which tilt == 0 dB")
    output_path: Optional[str] = Field(default=None, description="Optional path to rendered WAV")


class DRMeterResponse(BaseModel):
    """Dynamic range + LRA meter result."""
    dr_score: float = Field(..., description="DR score (P-S short-term RMS window)")
    lra: float = Field(..., description="Loudness Range (LRA, EBU R128) in LU")
    crest_factor: float = Field(..., description="Broadband crest factor (peak/RMS) in dB")
    genre_classification: str = Field(..., description="Heuristic genre bucket: 'Heavy' / 'Pop' / 'Loud'")
    bands: Dict[str, float] = Field(..., description="Per-band crest factors (low / mid / high)")


class MultibandTransientResponse(BaseModel):
    """Per-band transient designer result."""
    bands: List[str] = Field(..., description="Band labels, e.g. ['low', 'mid', 'high']")
    attack_ms: List[float] = Field(..., description="Per-band attack time in milliseconds")
    release_ms: List[float] = Field(..., description="Per-band release time in milliseconds")


class MSImagerResponse(BaseModel):
    """Mid/Side stereo imager result."""
    width: float = Field(..., description="Stereo width as a percentage (0 = mono, 100 = neutral, 200 = ultra-wide)")
    correlation: float = Field(..., description="L/R Pearson correlation in [-1, +1]")


class ReferenceMatchResponse(BaseModel):
    """Reference-match EQ band gains."""
    source_bands_db: List[float] = Field(..., description="Source band levels in dB (one per band)")
    ref_bands_db: List[float] = Field(..., description="Reference band levels in dB (one per band)")
    applied_eq_bands: List[float] = Field(..., description="Applied EQ gain per band in dB (ref - source)")


class SaturationResponse(BaseModel):
    """Harmonic saturation waveshaper result."""
    drive: float = Field(..., description="Drive amount (0..1)")
    type: str = Field(..., description="Saturation flavor: 'I' / 'II' / 'III' or 'tape' / 'tube' / 'analog'")
    harmonics_added_db: List[float] = Field(..., description="Per-harmonic level in dB (2nd, 3rd, 4th ...)")


class ReverbResponse(BaseModel):
    """Algorithmic reverb result."""
    room_size: float = Field(..., description="Room size (0..1)")
    pre_delay_ms: float = Field(..., description="Pre-delay in milliseconds")
    decay_sec: float = Field(..., description="Decay time (RT60) in seconds")
    wet: float = Field(..., description="Wet/dry mix in [0, 1]")


class LoudnessWarResponse(BaseModel):
    """Section-by-section DR timeline for loudness-war analysis."""
    dr_score: float = Field(..., description="Whole-track DR score")
    verdict: str = Field(..., description="Bucket: 'Dynamic Friendly' / 'Balanced' / 'Loudness War Victim'")
    timeline: List[float] = Field(..., description="Per-section DR scores, one float per detected section")


__all__ = [
    "LoudnessPenaltyResponse",
    "PhaseRotationResponse",
    "SpectralTiltResponse",
    "DRMeterResponse",
    "MultibandTransientResponse",
    "MSImagerResponse",
    "ReferenceMatchResponse",
    "SaturationResponse",
    "ReverbResponse",
    "LoudnessWarResponse",
]
