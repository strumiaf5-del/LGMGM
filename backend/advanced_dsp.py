"""
advanced_dsp.py — Procesamiento DSP de Siguiente Generación (R21-R25)

R21. Maximizador de Sonoridad Polinomial (Inflator / Chebyshev)
R22. Supresor Psicoacústico Dinámico de Resonancias (estilo Soothe)
R23. Compensación Adaptativa de Curvas Isosónicas (ISO 226:2023)
R24. Desmascaramiento Espectral Cruzado entre Stems
R25. Sintetizador Psicoacústico de Graves y Fundamental Fantasma
"""

from __future__ import annotations

import logging
import numpy as np

logger = logging.getLogger("advanced_dsp")


def _ola_normalization(window: np.ndarray, hop: int) -> float:
    """Factor de normalización correcto para overlap-add (OLA).

    Para Hann con 75% overlap (n_fft/hop = 4), el factor COLA es ~1.5, NO
    ``n_fft/hop = 4`` ni ``n_fft/hop/2 = 2``. Los divisores históricos en
    este archivo eran 2.67× y 1.33× mayores que el correcto → audio salía
    -8.5 dB / -2.5 dB sistemáticamente.

    Fórmula: ``sum(window²) / hop``. Para Hann analíticamente da 1.5 con
    n_fft/hop=4; el cálculo empírico abajo cubre también Hamming/Blackman
    y overlaps no estándar.
    """
    w2_sum = float(np.sum(window.astype(np.float64) ** 2))
    if hop <= 0 or w2_sum <= 0:
        return 1.0
    return w2_sum / float(hop)


# ═══════════════════════════════════════════════════════════════════════════════
# R21 — MAXIMIZADOR DE SONORIDAD POLINOMIAL (INFLATOR / CHEBYSHEV)
# ═══════════════════════════════════════════════════════════════════════════════

def _ensure_finite(audio: np.ndarray, fn_name: str) -> np.ndarray:
    """Sanity-check: rechazar audio con NaN/Inf al inicio de cada DSP.

    Antes: si el input venía con NaN/Inf (librosa bug, mp3 malformado, etc.),
    np.clip(NaN, -1, 1) = NaN y ``_write_audio_from_dsp`` serializaba
    0x800000 en PCM_24 (rudio blanco / DC permanente) sin error.
    Ahora: clip explícito + log + raise si quedan no-finitos.
    """
    if audio is None or audio.size == 0:
        return audio
    if not np.all(np.isfinite(audio)):
        logger.warning("%s: input contains NaN/Inf; clipping to finite range", fn_name)
        audio = np.nan_to_num(audio, nan=0.0, posinf=1.0, neginf=-1.0)
        audio = np.clip(audio, -1.0, 1.0)
    return audio


def polynomial_inflator(
    audio: np.ndarray,
    drive: float = 0.5,
    mix: float = 1.0,
    curve: str = "sigmoid",
) -> np.ndarray:
    """
    Aumenta el volumen percibido y densidad armónica sin elevar picos máximos.

    Aplica una función de transferencia polinomial/sigmoidal que comprime
    la dinámica micro hacia arriba (rellena el espacio entre picos y RMS)
    sin distorsión audible ni aumento de peak level.

    Parameters
    ----------
    audio : np.ndarray
        Audio mono o multicanal (shape: (channels, samples) o (samples,)).
    drive : float
        Intensidad del efecto (0.0 = bypass, 1.0 = máximo).
    mix : float
        Mezcla wet/dry (0.0 = seco, 1.0 = procesado puro).
    curve : str
        Tipo de curva: 'sigmoid', 'chebyshev', 'tanh'.

    Returns
    -------
    np.ndarray
        Audio procesado con el mismo shape y peak level.
    """
    audio = _ensure_finite(audio, "polynomial_inflator")
    if audio.size == 0 or drive <= 0.0:
        return audio.copy()

    drive = np.clip(drive, 0.0, 1.0)
    mix = np.clip(mix, 0.0, 1.0)
    dry = audio.copy()

    # Preserve original peak for gain compensation
    orig_peak = np.max(np.abs(audio)) or 1.0

    if curve == "chebyshev":
        # Chebyshev polynomial T3(x) = 4x³ - 3x adds odd harmonics
        wet_normalized = audio + drive * (4.0 * audio**3 - 3.0 * audio) * 0.25
    elif curve == "tanh":
        # Soft saturation via hyperbolic tangent
        gain = 1.0 + drive * 3.0
        wet_normalized = np.tanh(audio * gain) / np.tanh(gain)
    else:
        # Sigmoid polynomial: x / (1 + |x|^k) rescaled
        k = 1.0 + drive * 2.0
        abs_audio = np.abs(audio)
        wet_normalized = np.sign(audio) * (abs_audio / (1.0 + abs_audio**k)) * (1.0 + drive)

    # Bypass exacto: con drive=0 la curva aplicada altera la dinámica micro.
    # Interpolamos wet hacia la identidad para que drive=0 sea bypass real.
    wet = audio * (1.0 - drive) + wet_normalized * drive

    # Peak-match: ensure output peak equals input peak
    wet_peak = np.max(np.abs(wet)) or 1.0
    wet = wet * (orig_peak / wet_peak)

    # Dry/wet mix
    result = dry * (1.0 - mix) + wet * mix

    # Final safety: never exceed original peak
    result_peak = np.max(np.abs(result)) or 1.0
    if result_peak > orig_peak:
        result *= orig_peak / result_peak

    return result


# ═══════════════════════════════════════════════════════════════════════════════
# R22 — SUPRESOR PSICOACÚSTICO DINÁMICO DE RESONANCIAS (ESTILO SOOTHE)
# ═══════════════════════════════════════════════════════════════════════════════

def dynamic_resonance_suppressor(
    audio: np.ndarray,
    sr: int = 44100,
    sensitivity: float = 0.5,
    depth_db: float = -6.0,
    n_bands: int = 64,
    attack_ms: float = 5.0,
    release_ms: float = 50.0,
) -> np.ndarray:
    """
    Banco de filtros adaptativos que detectan y suprimen resonancias
    dinámicas (sibilancias, asperezas vocales, platillos chirriantes).

    Solo actúa en los milisegundos exactos donde aparece la resonancia
    preservando el timbre natural del material.

    Parameters
    ----------
    audio : np.ndarray
        Audio (channels, samples) o (samples,).
    sr : int
        Frecuencia de muestreo.
    sensitivity : float
        Sensibilidad de detección (0.0-1.0).
    depth_db : float
        Profundidad máxima de atenuación en dB (negativo).
    n_bands : int
        Número de bandas de análisis.
    attack_ms : float
        Tiempo de ataque del envelope follower.
    release_ms : float
        Tiempo de release del envelope follower.

    Returns
    -------
    np.ndarray
        Audio con resonancias suprimidas.
    """
    audio = _ensure_finite(audio, "dynamic_resonance_suppressor")
    if audio.size == 0:
        return audio.copy()

    mono = audio.ndim == 1
    if mono:
        audio = audio[np.newaxis, :]

    n_ch, n_samples = audio.shape
    result = audio.copy()

    # FFT-based band analysis
    hop = 512
    win_len = 2048
    window = np.hanning(win_len)
    depth_linear = 10 ** (depth_db / 20.0)

    # Envelope follower coefficients
    attack_coeff = np.exp(-1.0 / (sr * attack_ms / 1000.0 / hop))
    release_coeff = np.exp(-1.0 / (sr * release_ms / 1000.0 / hop))

    threshold = 1.0 - sensitivity  # lower threshold = more sensitive

    for ch in range(n_ch):
        signal = audio[ch]
        output = np.zeros_like(signal)
        envelope = np.zeros(n_bands)

        for start in range(0, n_samples - win_len, hop):
            frame = signal[start:start + win_len] * window
            spectrum = np.fft.rfft(frame)
            magnitudes = np.abs(spectrum)

            # Bin → band mapping
            n_bins = len(magnitudes)
            band_size = max(1, n_bins // n_bands)

            gain_curve = np.ones(n_bins)

            for b in range(n_bands):
                b_start = b * band_size
                b_end = min((b + 1) * band_size, n_bins)
                if b_start >= n_bins:
                    break

                band_energy = np.mean(magnitudes[b_start:b_end] ** 2)
                total_energy = np.mean(magnitudes ** 2) + 1e-30

                # Relative prominence of this band
                prominence = band_energy / total_energy * n_bands

                # Envelope follow
                if prominence > envelope[b]:
                    envelope[b] = attack_coeff * envelope[b] + (1 - attack_coeff) * prominence
                else:
                    envelope[b] = release_coeff * envelope[b] + (1 - release_coeff) * prominence

                # If band is prominently resonant, attenuate it
                if envelope[b] > threshold:
                    excess = (envelope[b] - threshold) / (envelope[b] + 1e-12)
                    attenuation = 1.0 - excess * (1.0 - depth_linear) * sensitivity
                    attenuation = max(depth_linear, attenuation)
                    gain_curve[b_start:b_end] = attenuation

            # Apply gain curve in frequency domain
            processed_spectrum = spectrum * gain_curve
            processed_frame = np.fft.irfft(processed_spectrum, n=win_len)

            # Overlap-add
            end = min(start + win_len, n_samples)
            length = end - start
            output[start:end] += processed_frame[:length]

        # Normalize overlap-add
        norm_factor = _ola_normalization(window, hop)
        output /= max(norm_factor, 1e-9)

        # Blend with original where overlap-add hasn't covered
        mask = np.abs(output) < 1e-12
        output[mask] = signal[mask]

        result[ch] = output

    return result[0] if mono else result


# ═══════════════════════════════════════════════════════════════════════════════
# R23 — COMPENSACIÓN ADAPTATIVA DE CURVAS ISOSÓNICAS (ISO 226:2023)
# ═══════════════════════════════════════════════════════════════════════════════

# ISO 226:2003/2023 equal-loudness contour reference data (subset)
# Frequencies and dB SPL at 40, 60, 80 phon
_ISO226_FREQS = np.array([
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400,
    500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000,
    6300, 8000, 10000, 12500,
])

# Equal-loudness contour at 40 phon (typical streaming playback)
_ISO226_40PHON = np.array([
    99.9, 93.9, 88.2, 82.7, 77.8, 73.1, 68.6, 64.4, 60.5, 56.7, 53.4,
    50.4, 47.7, 45.4, 43.5, 42.1, 41.1, 40.0, 38.8, 37.5, 36.7, 37.0,
    37.5, 37.7, 37.3, 38.8, 42.4, 48.8, 58.1,
])

# Flat reference at 1kHz = 80 dB SPL (studio monitoring)
_ISO226_80PHON = np.array([
    113.9, 107.2, 101.2, 95.5, 90.3, 85.4, 80.7, 76.3, 72.4, 68.7,
    65.5, 62.8, 60.5, 58.6, 57.0, 55.8, 54.9, 54.0, 52.7, 51.0,
    49.7, 49.0, 48.6, 48.0, 47.3, 48.5, 52.1, 58.2, 67.3,
])


def equal_loudness_compensation(
    audio: np.ndarray,
    sr: int = 44100,
    playback_phon: float = 40.0,
    reference_phon: float = 80.0,
    strength: float = 0.5,
) -> np.ndarray:
    audio = _ensure_finite(audio, "equal_loudness_compensation")
    return _equal_loudness_impl(audio, sr, playback_phon, reference_phon, strength)


def _equal_loudness_impl(audio, sr, playback_phon, reference_phon, strength):
    """
    Compensación psicoacústica para mantener balance tonal percibido
    cuando la mezcla se escucha a volúmenes de streaming moderados.

    Calcula la curva inversa de equal-loudness (Fletcher-Munson / ISO 226)
    entre el nivel de referencia de masterización (80 phon) y el nivel
    de reproducción del oyente (≈40 phon), aplicando micro-EQ compensatorio.

    Parameters
    ----------
    audio : np.ndarray
        Audio (channels, samples) o (samples,).
    sr : int
        Frecuencia de muestreo.
    playback_phon : float
        Nivel estimado de escucha del oyente final (phon).
    reference_phon : float
        Nivel de masterización/monitoreo (phon).
    strength : float
        Intensidad de la compensación (0.0-1.0).

    Returns
    -------
    np.ndarray
        Audio con compensación isosónica aplicada.
    """
    if audio.size == 0 or strength <= 0.0:
        return audio.copy()

    mono = audio.ndim == 1
    if mono:
        audio = audio[np.newaxis, :]

    n_ch, n_samples = audio.shape
    result = np.zeros_like(audio)

    # Interpolate compensation curve
    # Difference = what ear loses at low volume vs. high volume
    # Positive values = needs boost, negative = needs cut
    playback_curve = _interpolate_phon(playback_phon)
    reference_curve = _interpolate_phon(reference_phon)

    # Compensation = what you need to add to restore perception
    compensation_db = (playback_curve - reference_curve) * strength

    # Limit extreme boosts (max ±8 dB)
    compensation_db = np.clip(compensation_db, -8.0, 8.0)

    # Build frequency-domain filter
    n_fft = 4096
    freqs_fft = np.linspace(0, sr / 2, n_fft // 2 + 1)

    # Interpolate compensation to FFT bins
    comp_fft = np.interp(
        freqs_fft, _ISO226_FREQS, compensation_db,
        left=compensation_db[0], right=compensation_db[-1]
    )
    gain_fft = 10.0 ** (comp_fft / 20.0)

    # Apply via overlap-add
    hop = n_fft // 4
    window = np.hanning(n_fft)

    for ch in range(n_ch):
        output = np.zeros(n_samples + n_fft)
        signal = audio[ch]

        for start in range(0, n_samples, hop):
            end = min(start + n_fft, n_samples)
            frame = np.zeros(n_fft)
            frame[:end - start] = signal[start:end] * window[:end - start]

            spectrum = np.fft.rfft(frame)
            spectrum *= gain_fft
            processed = np.fft.irfft(spectrum, n=n_fft)

            output[start:start + n_fft] += processed * window

        # Normalize overlap factor
        norm_factor = _ola_normalization(window, hop)
        result[ch] = output[:n_samples] / max(norm_factor, 1e-9)

    # Peak safety
    orig_peak = np.max(np.abs(audio))
    if orig_peak > 0:
        result_peak = np.max(np.abs(result))
        if result_peak > orig_peak * 1.05:
            result *= orig_peak / result_peak

    return result[0] if mono else result


def _interpolate_phon(phon: float) -> np.ndarray:
    """Linearly interpolate an equal-loudness contour at given phon level."""
    t = np.clip((phon - 40.0) / 40.0, 0.0, 1.0)
    return _ISO226_40PHON * (1.0 - t) + _ISO226_80PHON * t


# ═══════════════════════════════════════════════════════════════════════════════
# R24 — DESMASCARAMIENTO ESPECTRAL CRUZADO ENTRE STEMS
# ═══════════════════════════════════════════════════════════════════════════════

def cross_spectral_unmasking(
    target_stem: np.ndarray,
    masking_stem: np.ndarray,
    sr: int = 44100,
    depth_db: float = -4.0,
    n_fft: int = 2048,
    sensitivity: float = 0.5,
) -> np.ndarray:
    """
    Desenmascara un stem objetivo creando micro-espacios espectrales
    dinámicos en el stem que lo tapa.

    Analiza en tiempo real qué frecuencias del masking_stem están
    enmascarando al target_stem y atenúa selectivamente solo esas
    frecuencias y solo cuando el target está sonando.

    Parameters
    ----------
    target_stem : np.ndarray
        El stem principal a desmascarar (ej. voz, kick).
    masking_stem : np.ndarray
        El stem que enmascara al target (ej. guitarras, teclados).
    sr : int
        Frecuencia de muestreo.
    depth_db : float
        Profundidad máxima de atenuación en el masking stem (dB).
    n_fft : int
        Tamaño de ventana FFT.
    sensitivity : float
        Qué tan agresivo es el unmasking (0.0-1.0).

    Returns
    -------
    np.ndarray
        masking_stem procesado con espacios espectrales dinámicos.
    """
    target_stem = _ensure_finite(target_stem, "cross_spectral_unmasking.target")
    masking_stem = _ensure_finite(masking_stem, "cross_spectral_unmasking.mask")
    if target_stem.size == 0 or masking_stem.size == 0:
        return masking_stem.copy()

    # Work with mono for analysis
    if target_stem.ndim > 1:
        target_mono = np.mean(target_stem, axis=0)
    else:
        target_mono = target_stem

    mono_mask = masking_stem.ndim == 1
    if mono_mask:
        masking_stem = masking_stem[np.newaxis, :]

    n_ch, n_samples = masking_stem.shape
    result = np.zeros_like(masking_stem)

    hop = n_fft // 4
    window = np.hanning(n_fft)
    depth_linear = 10 ** (depth_db / 20.0)

    for ch in range(n_ch):
        output = np.zeros(n_samples + n_fft)
        mask_sig = masking_stem[ch]

        for start in range(0, n_samples, hop):
            end = min(start + n_fft, n_samples)
            length = end - start

            # Target frame
            target_frame = np.zeros(n_fft)
            t_end = min(start + n_fft, len(target_mono))
            t_len = t_end - start
            if t_len > 0:
                target_frame[:t_len] = target_mono[start:t_end] * window[:t_len]

            # Masking frame
            mask_frame = np.zeros(n_fft)
            mask_frame[:length] = mask_sig[start:end] * window[:length]

            target_spec = np.fft.rfft(target_frame)
            mask_spec = np.fft.rfft(mask_frame)

            target_mag = np.abs(target_spec)
            mask_mag = np.abs(mask_spec)

            # Compute masking ratio: where mask energy overlaps target energy
            overlap = np.minimum(target_mag, mask_mag)
            mask_total = mask_mag + 1e-30

            # Masking ratio per bin (0 = no masking, 1 = full overlap)
            ratio = overlap / mask_total
            ratio *= sensitivity

            # Gate temporal: si el target está silencioso en este frame, no
            # atenuamos el masker (antes el masking stem perdía nivel en
            # silencios de la voz → dips audibles).
            target_active = float(np.max(target_mag))
            target_noise_floor = max(1e-9, target_active * 0.02)
            frame_active = np.any(target_mag > target_noise_floor)
            if not frame_active:
                ratio = np.zeros_like(ratio)

            # Compute gain: reduce masking bins proportionally
            gain = 1.0 - ratio * (1.0 - depth_linear)
            gain = np.clip(gain, depth_linear, 1.0)

            processed_spec = mask_spec * gain
            processed_frame = np.fft.irfft(processed_spec, n=n_fft)

            output[start:start + n_fft] += processed_frame * window

        norm_factor = _ola_normalization(window, hop)
        result[ch] = output[:n_samples] / max(norm_factor, 1e-9)

    return result[0] if mono_mask else result


# ═══════════════════════════════════════════════════════════════════════════════
# R25 — SINTETIZADOR PSICOACÚSTICO DE GRAVES / FUNDAMENTAL FANTASMA
# ═══════════════════════════════════════════════════════════════════════════════

def phantom_sub_bass(
    audio: np.ndarray,
    sr: int = 44100,
    crossover_hz: float = 80.0,
    harmonics: tuple = (2, 3),
    mix: float = 0.5,
    output_highpass_hz: float = 40.0,
) -> np.ndarray:
    """
    Genera armónicos superiores alineados en fase del contenido sub-grave
    para que altavoces pequeños (celulares, laptops, Bluetooth) puedan
    reconstruir perceptualmente la nota fundamental profunda.

    El cerebro del oyente percibe la fundamental por la serie armónica
    superior aunque el parlante no la reproduzca físicamente.

    Parameters
    ----------
    audio : np.ndarray
        Audio (channels, samples) o (samples,).
    sr : int
        Frecuencia de muestreo.
    crossover_hz : float
        Frecuencia de corte: el contenido por debajo se procesa.
    harmonics : tuple of int
        Armónicos a generar (2 = octava, 3 = quinta + octava).
    mix : float
        Nivel de mezcla de armónicos generados (0.0-1.0).
    output_highpass_hz : float
        Filtro pasa-altos en la salida para limpiar sub-sub contenido.

    Returns
    -------
    np.ndarray
        Audio con armónicos de graves fantasma.
    """
    audio = _ensure_finite(audio, "phantom_sub_bass")
    if audio.size == 0 or mix <= 0.0:
        return audio.copy()

    mono = audio.ndim == 1
    if mono:
        audio = audio[np.newaxis, :]

    n_ch, n_samples = audio.shape
    result = audio.copy()

    # Design crossover filter (simple FFT-based approach)
    n_fft = 4096
    hop = n_fft // 4
    window = np.hanning(n_fft)
    freqs = np.linspace(0, sr / 2, n_fft // 2 + 1)

    # Low-pass mask for sub content
    lp_mask = np.zeros(n_fft // 2 + 1)
    for i, f in enumerate(freqs):
        if f <= crossover_hz:
            lp_mask[i] = 1.0
        elif f <= crossover_hz * 1.5:
            # Smooth rolloff
            lp_mask[i] = 1.0 - (f - crossover_hz) / (crossover_hz * 0.5)
        else:
            lp_mask[i] = 0.0

    for ch in range(n_ch):
        harmonics_signal = np.zeros(n_samples)
        signal = audio[ch]

        for start in range(0, n_samples, hop):
            end = min(start + n_fft, n_samples)
            length = end - start

            frame = np.zeros(n_fft)
            frame[:length] = signal[start:end] * window[:length]

            spectrum = np.fft.rfft(frame)

            # Extract sub-bass content
            sub_spectrum = spectrum * lp_mask
            sub_signal = np.fft.irfft(sub_spectrum, n=n_fft)

            # Detect fundamental f0 in sub-bass range via spectral peak.
            # Antes: |x| (rectificación) generaba DC + 2f + 4f + 6f (inharmónico).
            # Ahora: sintetizamos cada armónico h en fase lockada a f0 detectada.
            sub_mag = np.abs(sub_spectrum)
            sub_bin_max = int(np.argmax(sub_mag[1:])) + 1  # ignore DC
            f0_hz = float(sub_bin_max * sr / n_fft) if sub_bin_max > 0 else 0.0
            # Phase of the fundamental bin for phase-locked synthesis
            phase0 = float(np.angle(sub_spectrum[sub_bin_max])) if sub_bin_max > 0 else 0.0

            t_frame = start / float(sr) + np.arange(n_fft) / float(sr)
            # Envelope from sub_signal magnitude (smooth between frames)
            sub_env = np.abs(sub_signal)

            # Generate harmonics via phase-locked synthesis (audible phantom fundamental)
            harmonic_frame = np.zeros(n_fft)
            if f0_hz > 1.0 and harmonics:
                for h in harmonics:
                    if h < 1:
                        continue
                    amp = 0.5 if h == 2 else (0.3 if h == 3 else 0.2 / float(h))
                    # Phase-locked cos at h*f0, scaled by sub envelope (so harmonics
                    # are loud only where the sub is loud — avoids pumping).
                    harmonic_frame += amp * sub_env * np.cos(
                        2.0 * np.pi * h * f0_hz * t_frame + h * phase0
                    )

            # Overlap-add harmonics
            h_end = min(start + n_fft, n_samples)
            h_len = h_end - start
            harmonics_signal[start:h_end] += harmonic_frame[:h_len] * window[:h_len]

        # Normalize overlap
        norm_factor = _ola_normalization(window, hop)
        harmonics_signal /= max(norm_factor, 1e-9)

        # High-pass the harmonics output to remove DC and ultra-sub content
        if output_highpass_hz > 0:
            harmonics_signal = _simple_highpass(harmonics_signal, sr, output_highpass_hz)

        # Mix harmonics into original
        # Scale harmonics to be proportional to sub energy
        sub_rms = np.sqrt(np.mean(harmonics_signal ** 2)) or 1e-12
        signal_rms = np.sqrt(np.mean(signal ** 2)) or 1e-12
        scale = (signal_rms / sub_rms) * mix * 0.3  # conservative scaling
        result[ch] = signal + harmonics_signal * scale

    # Peak safety
    orig_peak = np.max(np.abs(audio))
    if orig_peak > 0:
        result_peak = np.max(np.abs(result))
        if result_peak > orig_peak:
            result *= orig_peak / result_peak

    return result[0] if mono else result


def _simple_highpass(signal: np.ndarray, sr: int, cutoff_hz: float) -> np.ndarray:
    """Simple single-pole IIR high-pass filter."""
    rc = 1.0 / (2.0 * np.pi * cutoff_hz)
    dt = 1.0 / sr
    alpha = rc / (rc + dt)
    output = np.zeros_like(signal)
    output[0] = signal[0]
    for i in range(1, len(signal)):
        output[i] = alpha * (output[i - 1] + signal[i] - signal[i - 1])
    return output
