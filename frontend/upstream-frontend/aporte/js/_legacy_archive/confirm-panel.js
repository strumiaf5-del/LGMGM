// js/confirm-panel.js — Modal de confirmación de parámetros antes de masterizar.
//
// Muestra la cadena final que se enviará al backend: para cada grupo
// (Entrada · Dinámica · EQ/Tono · Estéreo · Output), lista sólo las claves
// que están activas o que difieren del default. Devuelve Promise<boolean>
// (true = Masterizar, false = Cancelar). El caller hace el submit.

import { collectParams } from './params.js';
import { getChainOverrides } from './master-console.js';
import * as studio from './studio-controller.js';

const GROUPS = [
  {
    id: 'input', label: '🎚️ Entrada',
    keys: ['input_gain_db', 'hp_cutoff'],
  },
  {
    id: 'dynamic', label: '🌀 Dinámica',
    keys: [
      'comp_bypass', 'comp_threshold_db', 'comp_ratio', 'comp_attack_ms', 'comp_release_ms', 'comp_makeup_db',
      'glue_bypass', 'glue_threshold_db', 'glue_ratio', 'glue_attack_ms', 'glue_release_ms', 'glue_makeup_db',
      'mb_bypass', 'mb_low_crossover', 'mb_high_crossover',
      'mb_low_threshold_db', 'mb_low_ratio', 'mb_low_attack_ms', 'mb_low_release_ms', 'mb_low_makeup_db',
      'mb_mid_threshold_db', 'mb_mid_ratio', 'mb_mid_attack_ms', 'mb_mid_release_ms', 'mb_mid_makeup_db',
      'mb_high_threshold_db', 'mb_high_ratio', 'mb_high_attack_ms', 'mb_high_release_ms', 'mb_high_makeup_db',
      'ms_comp_bypass', 'ms_comp_mid_threshold_db', 'ms_comp_mid_ratio',
      'ms_comp_side_threshold_db', 'ms_comp_side_ratio', 'ms_comp_side_attack_ms', 'ms_comp_side_release_ms',
      'oversample_mode',
    ],
  },
  {
    id: 'tone', label: '🎨 EQ · Tono',
    keys: [
      'low_shelf_freq_hz', 'low_shelf_gain_db', 'high_shelf_freq_hz', 'high_shelf_gain_db',
      'dyneq_bypass', 'dyneq_freq', 'dyneq_q', 'dyneq_threshold_db', 'dyneq_ratio', 'dyneq_attack_ms', 'dyneq_release_ms',
      'transient_attack', 'transient_sustain',
      'saturation_drive', 'saturation_mode', 'saturation_mix',
    ],
  },
  {
    id: 'stereo', label: '📐 Estéreo',
    keys: [
      'mb_stereo_bypass',
      'stereo_width_amount', 'mid_gain_db', 'side_gain_db',
      'mb_stereo_low_width', 'mb_stereo_mid_width', 'mb_stereo_high_width',
    ],
  },
  {
    id: 'limiter', label: '🛡️ Limitador',
    keys: ['limiter_ceiling', 'limiter_release_ms'],
  },
  {
    id: 'output', label: '📦 Salida',
    keys: [
      'target_peak', 'use_lufs_normalize', 'target_lufs',
      'clipper_bypass', 'clipper_ceiling', 'clipper_drive_db',
      'preview_start_sec', 'output_format', 'output_bit_depth',
    ],
  },
];

// Etiquetas amigables para mostrar junto al valor.
const LABELS = {
  input_gain_db: 'Gain in',
  hp_cutoff:     'HP cutoff',
  oversample_mode: 'Oversample',

  comp_bypass:       'Comp bypass',
  comp_threshold_db: 'Threshold',
  comp_ratio:        'Ratio',
  comp_attack_ms:    'Attack',
  comp_release_ms:   'Release',
  comp_makeup_db:    'Makeup',

  glue_bypass:       'Glue bypass',
  glue_threshold_db: 'Threshold',
  glue_ratio:        'Ratio',
  glue_attack_ms:    'Attack',
  glue_release_ms:   'Release',
  glue_makeup_db:    'Makeup',

  mb_bypass:           'MB bypass',
  mb_low_crossover:    'Low X-over',
  mb_high_crossover:   'High X-over',
  mb_low_threshold_db: 'Low thresh',
  mb_low_ratio:        'Low ratio',
  mb_low_attack_ms:    'Low attack',
  mb_low_release_ms:   'Low release',
  mb_low_makeup_db:    'Low makeup',
  mb_mid_threshold_db: 'Mid thresh',
  mb_mid_ratio:        'Mid ratio',
  mb_mid_attack_ms:    'Mid attack',
  mb_mid_release_ms:   'Mid release',
  mb_mid_makeup_db:    'Mid makeup',
  mb_high_threshold_db:'High thresh',
  mb_high_ratio:       'High ratio',
  mb_high_attack_ms:   'High attack',
  mb_high_release_ms:  'High release',
  mb_high_makeup_db:   'High makeup',

  ms_comp_bypass:                'MS comp bypass',
  ms_comp_mid_threshold_db:      'Mid threshold',
  ms_comp_mid_ratio:             'Mid ratio',
  ms_comp_side_threshold_db:     'Side threshold',
  ms_comp_side_ratio:            'Side ratio',
  ms_comp_side_attack_ms:        'Side attack',
  ms_comp_side_release_ms:       'Side release',

  low_shelf_freq_hz:  'Low shelf freq',
  low_shelf_gain_db:  'Low shelf gain',
  high_shelf_freq_hz: 'Air freq',
  high_shelf_gain_db: 'Air gain',

  dyneq_bypass:        'DynEQ bypass',
  dyneq_freq:          'DynEQ freq',
  dyneq_q:             'DynEQ Q',
  dyneq_threshold_db:  'DynEQ thresh',
  dyneq_ratio:         'DynEQ ratio',
  dyneq_attack_ms:     'DynEQ attack',
  dyneq_release_ms:    'DynEQ release',

  transient_attack: 'Transient atk',
  transient_sustain:'Transient sus',
  saturation_drive: 'Sat drive',
  saturation_mode:  'Sat mode',
  saturation_mix:   'Sat mix',

  mb_stereo_bypass:    'MB stereo bypass',
  stereo_width_amount: 'Width',
  mid_gain_db:         'Mid gain',
  side_gain_db:        'Side gain',
  mb_stereo_low_width: 'Low width',
  mb_stereo_mid_width: 'Mid width',
  mb_stereo_high_width:'High width',

  limiter_ceiling:    'Ceiling',
  limiter_release_ms: 'Release',

  target_peak:        'Target peak',
  use_lufs_normalize: 'LUFS normalize',
  target_lufs:        'Target LUFS',
  clipper_bypass:     'Clipper bypass',
  clipper_ceiling:    'Clipper ceil',
  clipper_drive_db:   'Clipper drive',
  preview_start_sec:  'Preview start',
  output_format:      'Format',
  output_bit_depth:   'Bit depth',
};

// Sufijo de unidad por clave. Si vacío: sin sufijo. Si '_db': dB etc.
const UNITS = {
  // Threshold ratios: números desnudos +1 decimal suelen bastar.
};

function formatValue(key, raw) {
  if (raw === undefined || raw === null || raw === '') return '—';
  const isBool = typeof raw === 'boolean' ||
                 key.endsWith('_bypass') ||
                 key === 'use_lufs_normalize';
  if (isBool) return raw ? 'ON' : 'OFF';
  if (typeof raw === 'number') {
    let s;
    if (Math.abs(raw) >= 100)         s = raw.toFixed(0);
    else if (Math.abs(raw) >= 10)     s = raw.toFixed(1);
    else                              s = raw.toFixed(2).replace(/\.?0+$/, '');
    // Sujetos a unidades según convención del dominio
    if (/_db$/.test(key))                       return `${s} dB`;
    if (/_ms$/.test(key))                       return `${s} ms`;
    if (/_hz$/.test(key) || /freq/.test(key))   return `${s} Hz`;
    if (/ratio$|q$|_q$/.test(key))              return `${s}`;
    if (key === 'stereo_width_amount')          return `${Math.round(Number(raw) * 100)}%`;
    if (key === 'oversample_mode')              return `${raw}x`;
    return s;
  }
  return String(raw);
}

let _activeResolve = null;

function buildRows(groupKeys, params) {
  // Construye filas: label + value + (si _bypass, muestra ON/OFF grande).
  // Filtra entradas donde todos los valores sean defaults vacíos.
  const rows = [];
  for (const key of groupKeys) {
    const v = params[key];
    if (v === undefined) continue;
    if (!Number.isFinite(v) && typeof v !== 'boolean' && typeof v !== 'string') continue;
    rows.push({
      label: LABELS[key] || key,
      value: formatValue(key, v),
      isBypass: key.endsWith('_bypass'),
    });
  }
  return rows;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function close(result) {
  const overlay = document.getElementById('cp-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    setTimeout(() => overlay.remove(), 200);
  }
  document.removeEventListener('keydown', onKeyDown, true);
  if (_activeResolve) {
    const r = _activeResolve;
    _activeResolve = null;
    r(result);
  }
}

function onKeyDown(e) {
  if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
  if (e.key === 'Enter')  { e.preventDefault(); close(true); }
}

export function openConfirmPanel({ file, title = 'Confirmar parámetros' } = {}) {
  return new Promise((resolve) => {
    _activeResolve = resolve;

    // Merge UI values + plugin bypass overrides para mostrar lo mismo
    // que va a llegar al backend.
    let params;
    try {
      params = { ...collectParams(), ...getChainOverrides() };
    } catch (err) {
      console.error('[confirm-panel] collect failed:', err);
      resolve(false);
      return;
    }

    // Stats globales para header.
    const activeStages = [];
    try {
      if (!studio.isPluginBypassed('compressor')) activeStages.push('Comp');
      if (!studio.isPluginBypassed('multiband'))  activeStages.push('MB');
      if (!studio.isPluginBypassed('glue'))       activeStages.push('Glue');
      if (!studio.isPluginBypassed('mb_stereo'))  activeStages.push('MB-Width');
      if (!studio.isPluginBypassed('eq'))         activeStages.push('EQ');
      if (!studio.isPluginBypassed('transient'))  activeStages.push('Transient');
      if (!studio.isPluginBypassed('saturation')) activeStages.push('Sat');
      if (!studio.isPluginBypassed('stereo'))     activeStages.push('Stereo');
      if (!studio.isPluginBypassed('clipper'))    activeStages.push('Clipper');
    } catch (_) { /* tolerated */ }

    const groupsHtml = GROUPS.map(g => {
      const rows = buildRows(g.keys, params);
      if (rows.length === 0) return '';
      const body = rows.map(r => `
        <div class="cp-row ${r.isBypass ? 'cp-row--bypass' : ''}">
          <span class="cp-key">${escapeHtml(r.label)}</span>
          <span class="cp-val">${escapeHtml(r.value)}</span>
        </div>
      `).join('');
      return `
        <section class="cp-group" data-group="${g.id}">
          <h3>${escapeHtml(g.label)}</h3>
          <div class="cp-rows">${body}</div>
        </section>
      `;
    }).filter(Boolean).join('');

    const stagesLine = activeStages.length
      ? `<span class="cp-chain">Activos: ${activeStages.map(s => `<b>${escapeHtml(s)}</b>`).join(' · ')}</span>`
      : '<span class="cp-chain cp-chain--empty">⚠ Sin módulos activos — mastering será passthrough</span>';

    const fileLine = file?.name
      ? `<span class="cp-file">📄 ${escapeHtml(file.name)} · ${formatBytes(file.size)}</span>`
      : '';

    const html = `
      <div class="cp-overlay" id="cp-overlay" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="cp-window">
          <header class="cp-header">
            <h2>${escapeHtml(title)}</h2>
            <button type="button" class="cp-close" id="cp-close" aria-label="Cancelar">✕</button>
          </header>
          <div class="cp-summary">
            ${fileLine}
            ${stagesLine}
          </div>
          <div class="cp-body">
            ${groupsHtml || '<p class="cp-empty">No hay parámetros configurables.</p>'}
          </div>
          <footer class="cp-footer">
            <button type="button" class="cp-btn cp-btn--cancel" id="cp-cancel">Cancelar</button>
            <button type="button" class="cp-btn cp-btn--ok" id="cp-confirm">⚡ Masterizar</button>
          </footer>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    requestAnimationFrame(() => {
      document.getElementById('cp-overlay')?.classList.add('cp-shown');
    });

    document.getElementById('cp-close')?.addEventListener('click', () => close(false));
    document.getElementById('cp-cancel')?.addEventListener('click', () => close(false));
    document.getElementById('cp-confirm')?.addEventListener('click', () => close(true));
    document.querySelector('#cp-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'cp-overlay') close(false);
    });
    document.addEventListener('keydown', onKeyDown, true);
  });
}

function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}
