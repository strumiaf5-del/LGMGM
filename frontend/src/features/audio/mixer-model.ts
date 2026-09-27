// Mixer domain model — pure helpers (no DOM, no audio).

export type StemType = 'kick' | 'snare' | 'bass' | 'vocals' | 'guitar' | 'synth' | 'drums' | 'fx' | 'other';

export interface StemParams {
  name: string;
  stem_type: StemType;
  gain_db: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  hp_cutoff_hz: number;
  lp_cutoff_hz: number;
  eq_low_freq: number; eq_low_gain_db: number; eq_low_q: number;
  eq_lomid_freq: number; eq_lomid_gain_db: number; eq_lomid_q: number;
  eq_himid_freq: number; eq_himid_gain_db: number; eq_himid_q: number;
  eq_high_freq: number; eq_high_gain_db: number; eq_high_q: number;
  comp_enabled: boolean; comp_threshold: number; comp_ratio: number;
  comp_attack_ms: number; comp_release_ms: number; comp_makeup_db: number;
  comp_stereo_link: boolean; comp_pdr: boolean;
  transient_attack: number; transient_sustain: number;
  stereo_width_amount: number;
  sidechain_trigger_name: string | null; sidechain_threshold: number;
  sidechain_ratio: number; sidechain_attack_ms: number; sidechain_release_ms: number;
  reverb_enabled: boolean;
  reverb_preset: string;
  reverb_wet_amount: number;
  reverb_pre_delay_ms: number;
  reverb_room_size: number;
  pitch_correction_enabled: boolean;
  pitch_correction_mode: string;
  pitch_correction_scale: string | null;
  pitch_correction_glide_ms: number;
}

export function detectStemType(name: string): StemType {
  const n = name.toLowerCase();
  if (/kick|bd|bombo/.test(n)) return 'kick';
  if (/snare|caja|rim/.test(n)) return 'snare';
  if (/bass|bajo|808/.test(n)) return 'bass';
  if (/voc|voice|vocal|lead/.test(n)) return 'vocals';
  if (/guitar|guit/.test(n)) return 'guitar';
  if (/synth|pad|keys|piano/.test(n)) return 'synth';
  if (/drum|perc|hat|cymbal/.test(n)) return 'drums';
  if (/fx|effect|atm/.test(n)) return 'fx';
  return 'other';
}

export function defaultStemParams(name: string): StemParams {
  return {
    name,
    stem_type: detectStemType(name),
    gain_db: 0, pan: 0, mute: false, solo: false,
    hp_cutoff_hz: 20, lp_cutoff_hz: 20000,
    eq_low_freq: 100, eq_low_gain_db: 0, eq_low_q: 0.8,
    eq_lomid_freq: 500, eq_lomid_gain_db: 0, eq_lomid_q: 1.0,
    eq_himid_freq: 3000, eq_himid_gain_db: 0, eq_himid_q: 1.0,
    eq_high_freq: 10000, eq_high_gain_db: 0, eq_high_q: 0.8,
    comp_enabled: false, comp_threshold: 0.5, comp_ratio: 4,
    comp_attack_ms: 10, comp_release_ms: 100, comp_makeup_db: 0,
    comp_stereo_link: true, comp_pdr: true,
    transient_attack: 0, transient_sustain: 0,
    stereo_width_amount: 1.0,
    sidechain_trigger_name: null, sidechain_threshold: 0.3,
    sidechain_ratio: 6, sidechain_attack_ms: 5, sidechain_release_ms: 80,
    reverb_enabled: false,
    reverb_preset: 'small_studio',
    reverb_wet_amount: 0.3,
    reverb_pre_delay_ms: 0,
    reverb_room_size: 1.0,
    pitch_correction_enabled: false,
    pitch_correction_mode: 'MEDIUM',
    pitch_correction_scale: null,
    pitch_correction_glide_ms: 50,
  };
}

// FIX M11: la función se llamaba `stemEmoji` pero devuelve strings con
// corchetes ([KICK], [SNR]...) que no son emojis. Renombrada a `stemBadge`
// (más honesto). Se mantiene `stemEmoji` como alias para no romper callers
// existentes (mixer-ui.ts usa `stemEmoji`).
export function stemBadge(t: StemType): string {
  return ({
    kick: '[KICK]', snare: '[SNR]', bass: '[BASS]', vocals: '[VOX]',
    guitar: '[GTR]', synth: '[SYN]', drums: '[DRM]', fx: '[FX]', other: '[TRK]',
  })[t] || '[TRK]';
}
export const stemEmoji = stemBadge;

export const mixerUiModel = Object.freeze({ defaultStemParams, detectStemType, stemEmoji });
