// save.ts — preset persistence. Port of aporte/js/03-presets.js.

const PRESETS_KEY = 'lgmdm-presets';
const DEFAULT_PRESET_NAME = 'current';

export interface Preset {
  name: string;
  createdAt: number;
  params: Record<string, number | boolean | string>;
}

// Minimal slider-ID → param-key map (the full map lives in 03-presets.js).
// We keep it small here; missing sliders are simply skipped at save time.
const SLIDER_ID_TO_PARAM: Record<string, string> = {
  's-ingain': 'input_gain_db',
  's-thresh': 'comp_threshold_db',
  's-ratio': 'comp_ratio',
  's-attack': 'comp_attack_ms',
  's-release': 'comp_release_ms',
  's-make': 'comp_makeup_db',
  's-width': 'stereo_width',
  's-ceiling': 'limiter_ceiling_db',
  's-satdrive': 'saturation_drive',
  's-clip-drive': 'clip_drive',
  's-hp': 'hp_freq',
  's-lowshelf': 'lowshelf_gain_db',
  's-lowshelf-freq': 'lowshelf_freq',
  's-eq1gain': 'eq1_gain_db',
  's-eq1freq': 'eq1_freq',
  's-eq1q': 'eq1_q',
  's-eq3gain': 'eq3_gain_db',
  's-eq3freq': 'eq3_freq',
  's-eq3q': 'eq3_q',
  's-eq6gain': 'eq6_gain_db',
  's-eq6freq': 'eq6_freq',
  's-eq6q': 'eq6_q',
  's-air': 'air_gain_db',
  's-haas': 'haas_delay_ms',
  's-normalize-lufs': 'normalize_lufs_target',
};

function readPresets(): Record<string, Preset> {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Preset>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function writePresets(presets: Record<string, Preset>): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch (err) {
    console.error('[presets] could not save:', err);
  }
}

function collectParams(): Preset['params'] {
  const params: Preset['params'] = {};
  for (const [sliderId, paramKey] of Object.entries(SLIDER_ID_TO_PARAM)) {
    const el = document.getElementById(sliderId) as HTMLInputElement | null;
    if (!el) continue;
    if (el.type === 'checkbox') {
      params[paramKey] = el.checked;
    } else if (el.type === 'range' || el.type === 'number') {
      const n = parseFloat(el.value);
      if (Number.isFinite(n)) params[paramKey] = n;
    } else if (el.value) {
      params[paramKey] = el.value;
    }
  }
  return params;
}

export function saveCurrentPreset(name: string = DEFAULT_PRESET_NAME): Preset | null {
  const params = collectParams();
  if (Object.keys(params).length === 0) {
    console.warn('[presets] no sliders found — nothing to save');
    return null;
  }
  const preset: Preset = { name, createdAt: Date.now(), params };
  const presets = readPresets();
  presets[name] = preset;
  writePresets(presets);
  return preset;
}

export function loadPreset(name: string): Preset | null {
  return readPresets()[name] ?? null;
}

export function listPresets(): Preset[] {
  return Object.values(readPresets()).sort((a, b) => b.createdAt - a.createdAt);
}

export function deletePreset(name: string): boolean {
  const presets = readPresets();
  if (!(name in presets)) return false;
  delete presets[name];
  writePresets(presets);
  return true;
}

// Bind to the global scope so keyboard shortcuts can call `window.saveCurrentPreset()`.
type SavePresetWindow = Window & typeof globalThis & { saveCurrentPreset?: (name?: string) => void };
(window as SavePresetWindow).saveCurrentPreset = (name?: string) => saveCurrentPreset(name);
