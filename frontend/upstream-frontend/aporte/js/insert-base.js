// ============================================================
// insert-base.js — Abstracción Insert unificada para los 10 inserts
// premium DSP. Provee API consistente para: render, update, fetch,
// serialize, bypass, params, y mapping helpers para backend Pydantic.
// ============================================================
(function (global) {
  'use strict';

  const LG = global.LGMDM = global.LGMDM || {};
  LG.proInsertRack = LG.proInsertRack || {};
  const NS = LG.proInsertRack;

  /**
   * Insert — abstracción unificada de un módulo del chain premium.
   *
   * Subclases definen:
   *   - type: 'resonance-tamer' | 'inflator' | etc
   *   - defaults: { ... }
   *   - toBackendParams(state): { ... } para enviar a /dsp/*
   *   - getEndpoint(): string
   *
   * Métodos públicos:
   *   - constructor(spec)
   *   - render(root, options): monta DOM del widget
   *   - update(data): recibe telemetría del backend
   *   - fetch(file, token): POST al endpoint, retorna blob/JSON
   *   - serialize(): snapshot del state para el rack
   *   - destroy(): cleanup de listeners
   */
  class Insert {
    constructor(spec = {}) {
      this.id = spec.id;
      this.title = spec.title || spec.id;
      this.type = spec.type || spec.id;
      this.endpoint = spec.endpoint || `/dsp/${spec.id}`;
      this.widget = spec.widget || null;       // referencia a widget específico si existe
      this.params = Object.assign({}, spec.defaults || {});
      this.bypass = false;
      this._root = null;
      this._listeners = [];
      this._options = {};
    }

    /** Override en subclase — convierte state interno a Form params del backend */
    toBackendParams() {
      const out = {};
      Object.entries(this.params).forEach(([k, v]) => {
        const snake = k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
        out[snake] = String(v);
      });
      return out;
    }

    getEndpoint() { return this.endpoint; }

    /** POST al endpoint con file + params. Devuelve blob si es audio, JSON si es metric */
    async fetch(file, token) {
      if (this.bypass) return null;
      const fd = new FormData();
      fd.append('file', file);
      Object.entries(this.toBackendParams()).forEach(([k, v]) => fd.append(k, v));
      const res = await LGMDM.api.apiFetch(this.getEndpoint(), {
        method: 'POST',
        body: fd
      });
      if (!res.ok) throw new Error(`${this.id}: HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      return ct.includes('application/json') ? res.json() : res.blob();
    }

    /** Snapshot del state actual para persistencia en el rack */
    serialize() {
      return {
        id: this.id,
        bypass: this.bypass,
        params: { ...this.params }
      };
    }

    /** Restaura state desde snapshot */
    restore(snapshot) {
      if (!snapshot) return;
      if (typeof snapshot.bypass === 'boolean') this.bypass = snapshot.bypass;
      if (snapshot.params) Object.assign(this.params, snapshot.params);
    }

    /** Override en subclase para construir el DOM del widget */
    render(root, options = {}) {
      this._root = root;
      this._options = options;
    }

    /** Override para recibir datos del backend (telemetría, response, etc) */
    update(data) {}

    /** Cleanup de listeners y timers */
    destroy() {
      this._listeners.forEach(({ el, type, fn }) => el?.removeEventListener(type, fn));
      this._listeners = [];
      this._root = null;
    }
  }

  // ── Catálogo de los 10 inserts con sus defaults y mapping helpers ──
  const CATALOG = {
    'resonance-tamer': {
      defaults: { sensitivity: 0.5, depth_db: -6, n_bands: 64 },
      toBackendParams() {
        return {
          sensitivity: String(this.params.sensitivity),
          depth_db: String(this.params.depth_db),
          n_bands: String(this.params.n_bands)
        };
      }
    },
    'inflator': {
      defaults: { drive: 0.5, mix: 1.0, curve: 'sigmoid' },
      toBackendParams() {
        const curveMap = { I: 'sigmoid', II: 'tanh', III: 'chebyshev' };
        const backendCurves = ['sigmoid', 'chebyshev', 'tanh'];
        const curve = backendCurves.includes(this.params.curve)
          ? this.params.curve
          : (curveMap[this.params.curve] || 'sigmoid');
        return {
          drive: String(this.params.drive),
          mix: String(this.params.mix),
          curve
        };
      }
    },
    'phantom-sub': {
      defaults: { crossover_hz: 80, mix: 0.5, harmonic_mode: 'octave' },
      toBackendParams() {
        return {
          crossover_hz: String(this.params.crossover_hz),
          mix: String(this.params.mix),
          harmonic_mode: this.params.harmonic_mode
        };
      }
    },
    'iso-compensation': {
      defaults: { playback_phon: 80, reference_phon: 80, strength: 0.5 },
      toBackendParams() {
        return {
          playback_phon: String(this.params.playback_phon),
          reference_phon: String(this.params.reference_phon),
          strength: String(this.params.strength)
        };
      }
    },
    'match-eq': {
      defaults: { match_amount: 0.7, smoothing: 0.3 },
      toBackendParams() {
        return {
          match_amount: String(this.params.match_amount),
          smoothing: String(this.params.smoothing)
        };
      }
    },
    'cross-demask': {
      defaults: { depth_db: -4, sensitivity: 0.5 },
      toBackendParams() {
        return {
          depth_db: String(this.params.depth_db),
          sensitivity: String(this.params.sensitivity)
        };
      }
    },
    'loudness-penalty': {
      defaults: {},
      toBackendParams() { return {}; }
    },
    'phase-rotation': {
      defaults: { freq_hz: 1000, angle_deg: 0, q: 1.0 },
      toBackendParams() {
        return {
          freq_hz: String(this.params.freq_hz),
          angle_deg: String(this.params.angle_deg),
          q: String(this.params.q)
        };
      }
    },
    'spectral-tilt': {
      defaults: { tilt_db: 0, pivot_hz: 1000 },
      toBackendParams() {
        return {
          tilt_db: String(this.params.tilt_db),
          pivot_hz: String(this.params.pivot_hz)
        };
      }
    },
    'dr-meter': {
      defaults: {},
      toBackendParams() { return {}; }
    },
    // ── MX-01 entries — frontend-only widgets (sin /dsp/* endpoint) ──
    // Estos inserts sólo usan serialize/restore + estado local (CustomEvents,
    // animation RAF). Igual entran en CATALOG para que pro-insert-rack
    // pueda snapshotear su state vía Insert class.
    'loudness-war': {
      defaults: {},
      toBackendParams() { return {}; }
    },
    'ms-imager': {
      defaults: { width: 1.0, correlation: 0.5 },
      toBackendParams() {
        return {
          width: String(this.params.width),
          correlation: String(this.params.correlation)
        };
      }
    },
    'multiband-transient': {
      defaults: { amount: 0.5, attack_ms: [10, 10, 10], release_ms: [100, 100, 100] },
      toBackendParams() {
        return {
          amount: String(this.params.amount),
          attack_ms: (this.params.attack_ms || []).map(String).join(','),
          release_ms: (this.params.release_ms || []).map(String).join(',')
        };
      }
    },
    'reverb': {
      defaults: { room_size: 0.7, pre_delay_ms: 30, decay_sec: 2.5, wet: 0.3, reverb_type: 'Hall' },
      toBackendParams() {
        return {
          room_size: String(this.params.room_size),
          pre_delay_ms: String(this.params.pre_delay_ms),
          decay_sec: String(this.params.decay_sec),
          wet: String(this.params.wet),
          reverb_type: String(this.params.reverb_type || 'Hall')
        };
      }
    }
  };

  /** Factory: crea un Insert del catálogo */
  function create(spec) {
    const cat = CATALOG[spec.id];
    if (!cat) throw new Error(`unknown insert: ${spec.id}`);
    const inst = new Insert({
      id: spec.id,
      title: spec.title,
      endpoint: spec.endpoint,
      defaults: cat.defaults,
      widget: spec.widget || null
    });
    // Patch con toBackendParams específico
    inst.toBackendParams = function () { return cat.toBackendParams.call(this); };
    return inst;
  }

  // ── API pública ──
  NS.Insert = Insert;
  NS.CATALOG = CATALOG;
  NS.create = create;

  // Auto-mount helper: si el rack existe, agrega insert registry
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (NS.INSERTS) {
        NS.INSERTS.forEach(spec => {
          try { NS.registry = NS.registry || {}; NS.registry[spec.id] = create(spec); } catch (_) {}
        });
      }
    }, { once: true });
  } else if (NS.INSERTS) {
    NS.registry = NS.registry || {};
    NS.INSERTS.forEach(spec => {
      try { NS.registry[spec.id] = create(spec); } catch (_) {}
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
