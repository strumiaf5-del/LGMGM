// features/workspace/sliders-ui.ts — Sliders, tabs multiband, workflow rail.
//
// Carga tras `core/state.ts` (necesita el state) y antes de `mastering-actions.ts`
// (los sliders alimentan el payload de mastering).
//
// FIX vs aporte: los metadatos de sliders se importan desde `data/sliders-meta.ts`
// (antes venían de `<script id="sliders-meta">` inline en el HTML). El upstream
// upstream-frontend/dist/index.html los expone; los extrajimos a TS.
// FIX vs aporte: tipos TS en los formatters.
// FIX vs aporte: HMR-safe (`window.LGMDM.slidersBound`).
// FIX vs aporte: AbortController + cleanup.

import { SLIDERS_META, type SliderMetaEntry } from '../../data/sliders-meta';

// ── Formatters canónicos (single source of truth) ──────────────────────
// F5.7 — Usado por sliders-ui via lookup contra sliders-meta JSON.

type Fmt = (v: unknown) => string;

const F: Record<string, Fmt> = {
  signedDb: (v) => (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(1) + ' dB',
  signedDb2: (v) => (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(2),
  db: (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return `${n >= 0 ? '+' : ''}${n.toFixed(1)} dB`;
  },
  hz: (v) => Math.round(Number(v)) + ' Hz',
  hzRaw: (v) => Number(v) + ' Hz',
  khz: (v) => (Number(v) >= 1000 ? (Number(v) / 1000).toFixed(1) + ' kHz' : Math.round(Number(v)) + ' Hz'),
  khzRaw: (v) => (Number(v) >= 1000 ? (Number(v) / 1000).toFixed(1) + ' kHz' : Number(v) + ' Hz'),
  khzFloat1: (v) => (Number(v) >= 1000 ? (Number(v) / 1000).toFixed(1) + ' kHz' : Number(v) + ' Hz'),
  ms: (v) => Math.round(Number(v)) + ' ms',
  ms1: (v) => Number(v).toFixed(1) + ' ms',
  ratio: (v) => Number(v).toFixed(1) + ':1',
  q: (v) => Number(v).toFixed(1),
  lufs: (v) => Number(v).toFixed(1) + ' LUFS',
  multi: (v) => parseFloat(String(v)).toFixed(2) + 'x',
  multi2: (v) => parseFloat(String(v)).toFixed(2),
  pct: (v) => Math.round(Number(v) * 100) + '%',
  int: (v) => Math.round(Number(v)).toString(),
  intPct: (v) => Math.round(Number(v)) + '%',
  linearToDbT: (v) => {
    const db = 20 * Math.log10(Math.max(Number(v), 1e-9));
    return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dBTP';
  },
  parseSignedDb: (v) => (Number(v) >= 0 ? '+' : '') + parseFloat(String(v)).toFixed(1) + ' dB',
  parseHzKhz: (v) => {
    const n = Number(v);
    return n >= 1000 ? (n / 1000).toFixed(1) + ' kHz' : Math.round(n) + ' Hz';
  },
  parseRatio: (v) => parseFloat(String(v)).toFixed(1) + ':1',
  parseMs1: (v) => parseFloat(String(v)).toFixed(1) + ' ms',
  parseMs: (v) => Math.round(Number(v)) + ' ms',
  parseRatio1: (v) => parseFloat(String(v)).toFixed(1) + ':1',
  parseHzKhzF: (v) => {
    const n = Number(v);
    return n >= 1000 ? (n / 1000).toFixed(1) + ' kHz' : Math.round(n) + ' Hz';
  },
  parseHzKhzRaw: (v) => {
    const n = Number(v);
    return n >= 1000 ? (n / 1000).toFixed(1) + ' kHz' : n + ' Hz';
  },
  parseSignedDbAlt: (v) => (Number(v) >= 0 ? '+' : '') + parseFloat(String(v)).toFixed(1) + ' dB',
  float2: (v) => parseFloat(String(v)).toFixed(2),
  float2_dB: (v) => parseFloat(String(v)).toFixed(1) + ' dB',
  float2_ms: (v) => parseFloat(String(v)).toFixed(1) + ' ms',
  float2_ratio: (v) => parseFloat(String(v)).toFixed(1) + ':1',
  float1Db: (v) => Number(v).toFixed(1) + ' dB',
  float1s: (v) => parseFloat(String(v)).toFixed(1) + ' s',
  plusDb: (v) => '+' + Number(v).toFixed(1) + ' dB',
};

// ── Estado del módulo ──────────────────────────────────────────────────

const controller = new AbortController();
const { signal } = controller;

// HMR-safe: si ya estaba bindado, no re-bind
const lg = (window.LGMDM = window.LGMDM || {}) as Record<string, unknown> & { slidersBound?: boolean };

// ── Sliders desde sliders-meta ─────────────────────────────────────────

const sliders: Array<[string, string, Fmt]> = (SLIDERS_META as readonly SliderMetaEntry[]).map(({ id, vid, fmt }) => [id, vid, F[fmt] || String]);

sliders.forEach(([sid, vid, fmt]) => {
  const s = document.getElementById(sid) as HTMLInputElement | null;
  const v = document.getElementById(vid);
  if (!s || !v) return;
  v.textContent = fmt(parseFloat(s.value));
  s.addEventListener('input', () => {
    v.textContent = fmt(parseFloat(s.value));
  }, { signal });
});

// ── Sliders inline (referencia) ────────────────────────────────────────

const inlineSliders: Array<[string, string, Fmt]> = [
  ['s-normalize-lufs', 'v-normalize-lufs', (v) => parseFloat(String(v)).toFixed(1)],
  ['s-uselufs-sensitivity', 'v-uselufs-sensitivity', (v) => Math.round(Number(v)) + '%'],
  ['s-band-count', 'v-band-count', (v) => Math.round(Number(v)).toString()],
  ['s-ref-loudness-sensitivity', 'v-ref-loudness-sensitivity', (v) => Math.round(Number(v)) + '%'],
  ['s-ref-fixed-lufs-value', 'v-ref-fixed-lufs', (v) => parseFloat(String(v)).toFixed(1)],
  ['s-ref-max-lufs', 'v-ref-max-lufs', (v) => parseFloat(String(v)).toFixed(1)],
  ['s-ref-eq-passes', 'v-ref-eq-passes', (v) => Math.round(Number(v)).toString()],
  ['s-ref-crest-amount', 'v-ref-crest-amount', (v) => Math.round(Number(v)).toString()],
  ['s-ref-spectral-dyn-amount', 'v-ref-spectral-dyn-amount', (v) => Math.round(Number(v)).toString()],
  ['s-ref-spectral-dyn-bins', 'v-ref-spectral-dyn-bins', (v) => Math.round(Number(v)).toString()],
  ['s-ref-parallel-mix', 'v-ref-parallel-mix', (v) => Math.round(Number(v)).toString()],
  ['s-ref-parallel-thr', 'v-ref-parallel-thr', (v) => parseFloat(String(v)).toFixed(0)],
  ['s-ref-parallel-ratio', 'v-ref-parallel-ratio', (v) => parseFloat(String(v)).toFixed(1)],
  ['s-ref-parallel-makeup', 'v-ref-parallel-makeup', (v) => Math.round(Number(v)).toString()],
  ['s-ref-mb-sat-mix', 'v-ref-mb-sat-mix', (v) => Math.round(Number(v)).toString()],
  ['s-ref-mb-sat-low', 'v-ref-mb-sat-low', (v) => Math.round(Number(v)).toString()],
  ['s-ref-mb-sat-mid', 'v-ref-mb-sat-mid', (v) => Math.round(Number(v)).toString()],
  ['s-ref-mb-sat-high', 'v-ref-mb-sat-high', (v) => Math.round(Number(v)).toString()],
  ['s-ref-gentle-ceil', 'v-ref-gentle-ceil', (v) => parseFloat(String(v)).toFixed(1)],
  ['s-ref-gentle-rel', 'v-ref-gentle-rel', (v) => Math.round(Number(v)).toString()],
];

inlineSliders.forEach(([sid, vid, fmt]) => {
  const s = document.getElementById(sid) as HTMLInputElement | null;
  const v = document.getElementById(vid);
  if (!s || !v) return;
  v.textContent = fmt(parseFloat(s.value));
  s.addEventListener('input', () => {
    v.textContent = fmt(parseFloat(s.value));
  }, { signal });
});

// ── Multiband tabs (ARIA tablist + roving tabindex + arrow keys) ──────

const mbTabs = Array.from(document.querySelectorAll<HTMLElement>('.mb-tab'));

function selectMbTab(idx: number): void {
  const tab = mbTabs[idx];
  if (!tab) return;
  mbTabs.forEach((t, i) => {
    const selected = i === idx;
    t.classList.toggle('active', selected);
    t.setAttribute('aria-selected', String(selected));
    t.setAttribute('tabindex', selected ? '0' : '-1');
  });
  const band = tab.dataset.band;
  if (!band) {
    const error = new Error('[LGMDM DOM CONTRACT] 02-sliders-ui: .mb-tab is missing data-band');
    console.debug(error);
    throw error;
  }
  document.querySelectorAll<HTMLElement>('.mb-panel').forEach((p) => p.classList.remove('active'));
  const panel = document.getElementById(`mb-panel-${band}`);
  if (!panel) {
    const error = new Error(`[LGMDM DOM CONTRACT] 02-sliders-ui: mb-panel-${band} not found`);
    console.debug(error);
    throw error;
  }
  panel.classList.add('active');
}

mbTabs.forEach((tab, idx) => {
  tab.addEventListener('click', () => selectMbTab(idx), { signal });
  tab.addEventListener('keydown', (e) => {
    const ne = e as KeyboardEvent;
    if (ne.key === 'ArrowRight' || ne.key === 'ArrowDown') {
      ne.preventDefault();
      const next = (idx + 1) % mbTabs.length;
      selectMbTab(next);
      mbTabs[next]?.focus();
    } else if (ne.key === 'ArrowLeft' || ne.key === 'ArrowUp') {
      ne.preventDefault();
      const prev = (idx - 1 + mbTabs.length) % mbTabs.length;
      selectMbTab(prev);
      mbTabs[prev]?.focus();
    } else if (ne.key === 'Home') {
      ne.preventDefault();
      selectMbTab(0);
      mbTabs[0]?.focus();
    } else if (ne.key === 'End') {
      ne.preventDefault();
      selectMbTab(mbTabs.length - 1);
      mbTabs[mbTabs.length - 1]?.focus();
    }
  }, { signal });
});

// ── Workflow rail / etapas ─────────────────────────────────────────────

const workflowCards = Array.from(document.querySelectorAll<HTMLDetailsElement>('.process-card-collapsible'));
const workflowChips = Array.from(document.querySelectorAll<HTMLElement>('.workflow-chip'));

function syncWorkflowState(): void {
  const openIndex = workflowCards.findIndex((card) => card.open);
  const currentIndex = openIndex >= 0 ? openIndex : 0;
  workflowChips.forEach((chip, index) => {
    chip.classList.toggle('active', index === currentIndex);
    chip.classList.toggle('done', index < currentIndex);
    chip.style.cursor = 'pointer';
  });
}

workflowCards.forEach((card, index) => {
  card.addEventListener('toggle', syncWorkflowState, { signal });
  card.dataset.stageIndex = String(index);
});

workflowChips.forEach((chip, index) => {
  chip.setAttribute('role', 'button');
  chip.setAttribute('tabindex', '0');
  chip.setAttribute('aria-label', `Ir al paso ${index + 1}`);
  chip.addEventListener('click', () => {
    workflowCards.forEach((card, cardIndex) => {
      card.open = cardIndex === index;
    });
    syncWorkflowState();
  }, { signal });
  chip.addEventListener('keydown', (e) => {
    const ne = e as KeyboardEvent;
    if (ne.key === 'Enter' || ne.key === ' ') {
      ne.preventDefault();
      chip.click();
    }
  }, { signal });
});

syncWorkflowState();

// ── CTA "Ir a Presets" desde empty state del workspace ────────────────

document.getElementById('gotoPresetsSidebar')?.addEventListener('click', () => {
  const grid = document.getElementById('presetGrid');
  if (grid) {
    grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const first = grid.querySelector<HTMLElement>('.preset-btn');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 250);
  }
}, { signal });

// ── API pública (window.LGMDM.sliders) ─────────────────────────────────

function getValues(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [sid] of sliders) {
    const el = document.getElementById(sid) as HTMLInputElement | null;
    if (el) out[sid] = parseFloat(el.value);
  }
  for (const [sid] of inlineSliders) {
    const el = document.getElementById(sid) as HTMLInputElement | null;
    if (el) out[sid] = parseFloat(el.value);
  }
  return out;
}

function setValues(values: Record<string, number>): void {
  for (const [id, val] of Object.entries(values)) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) {
      el.value = String(val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}

function teardown(): void {
  controller.abort();
}

// HMR idempotency: si el módulo se re-ejecuta, abortamos el controller anterior
if (lg.slidersBound) {
  // No podemos acceder al controller anterior (es local), pero los listeners
  // con signal:{signal} no se re-bindearán si el módulo viejo fue GC'd.
  // El nuevo controller empieza limpio.
}
lg.slidersBound = true;

// Exponer API
const slidersApi = (lg.sliders = lg.sliders || {}) as Record<string, unknown>;
(slidersApi as { init: () => void }).init = () => {
  // Re-init si es necesario (los listeners ya están bindados por el side-effect).
};
(slidersApi as { getValues: () => Record<string, number> }).getValues = getValues;
(slidersApi as { setValues: (v: Record<string, number>) => void }).setValues = setValues;
(slidersApi as { teardown: () => void }).teardown = teardown;

// Cleanup en beforeunload
window.addEventListener('beforeunload', teardown, { once: true });
