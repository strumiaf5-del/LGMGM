// ============================================================
// 13-mixer-ui.js — Mixer UI/orquestación
// El motor Web Audio y preview viven en 13-mixer-engine.js.
// ============================================================
(function () {
  'use strict';

  const LG = window.LGMDM = window.LGMDM || {};
  const bindOnce = LG.ui.bindOnce;
  const runtime = window.LGMDM?.mixerEngine;
  if (!runtime) throw new Error('LGMDM mixer engine no inicializado');
  const { cachedEl, invalidateCachedEl, mixerState, previewEngine, serverPreview, getGenUUID,
    formatDbValue, formatLinearThresholdToDb, dbToLin, decodeStemForPreview, applyStemParamsToChain,
    updateAllMuteSolo, startStemSource, playPreview, stopPreview, togglePreview, seekPreview,
    fmtTime, updateTransportUI, removeStemFromPreview, resetPreviewEngine, setServerPreviewStatus,
    scheduleServerPreview, runServerPreview } = runtime;

  // ── Params & helpers ──────────────────────────────────────────────────────
  const model = window.LGMDM?.mixerUiModel;
  if (!model) throw new Error('LGMDM mixer UI model no inicializado');
  const { defaultStemParams, detectStemType, stemEmoji } = model;

  // ── CSS fader ───────────────────────────────────────────────────────────────
  const FADER_MIN = -60, FADER_MAX = 12;

  function dbToPct(db) {
    return Math.max(0, Math.min(1, (db - FADER_MIN) / (FADER_MAX - FADER_MIN)));
  }
  function faderKnobStyle(db) {
    const pct = dbToPct(db);
    return {
      topPct: ((1 - pct) * 100).toFixed(2),
      fillPct: (pct * 100).toFixed(2),
    };
  }

  function faderHTML(id, db) {
    const { topPct, fillPct } = faderKnobStyle(db);
    const zeroTopPct = ((1 - dbToPct(0)) * 100).toFixed(2);

    return `
      <div class="mxr-fader-css" data-fader-id="${id}" data-db="${db}"
           style="--knob-top:${topPct}%;--fill-h:${fillPct}%;--zero-top:${zeroTopPct}%"
           role="slider" aria-valuenow="${db}" aria-valuemin="${FADER_MIN}" aria-valuemax="${FADER_MAX}"
           tabindex="0">
        <div class="mxr-fader-track">
          <div class="mxr-fader-fill"></div>
          <div class="mxr-fader-zero"></div>
          <div class="mxr-fader-knob"></div>
        </div>
      </div>`;
  }

  function setFaderDb(faderId, db) {
    const el = document.querySelector(`.mxr-fader-css[data-fader-id="${faderId}"]`);
    if (!el) return;
    const { topPct, fillPct } = faderKnobStyle(db);
    el.style.setProperty('--knob-top', topPct + '%');
    el.style.setProperty('--fill-h',  fillPct + '%');
    el.dataset.db = db;
    el.setAttribute('aria-valuenow', db);
  }

  // ── Drag logic ──────────────────────────────────────────────────────────────
  function initFaderDrags(container) {
    container.querySelectorAll('.mxr-fader-css').forEach(el => {
      if (el._faderInited) return;
      el._faderInited = true;

      let dragging = false, startY = 0, startDb = 0;

      function getDb() { return parseFloat(el.dataset.db) || 0; }

      function applyDb(db) {
        db = Math.max(FADER_MIN, Math.min(FADER_MAX, db));
        setFaderDb(el.dataset.faderId, db);

        const id = el.dataset.faderId;
        if (id === 'master') {
          const inp = cachedEl('mix-master-gain');
          if (inp) inp.value = db;
          const lbl = cachedEl('mix-master-gain-val');
          if (lbl) lbl.textContent = formatDbValue(db);
          const lblCh = cachedEl('mix-master-gain-val-ch');
          if (lblCh) lblCh.textContent = formatDbValue(db);
          if (previewEngine.ctx) previewEngine.masterGain.gain.setTargetAtTime(dbToLin(db), previewEngine.ctx.currentTime, 0.015);
          scheduleServerPreview();
        } else {
          const stemName = id.replace(/^gain:/, '');
          const p = mixerState.stems[stemName]?.params;
          if (p) p.gain_db = db;
          const lbl = cachedEl('ch-gain-val-' + stemName);
          if (lbl) lbl.textContent = formatDbValue(db);
          if (previewEngine.nodes[stemName]) applyStemParamsToChain(stemName);
          scheduleServerPreview();
        }
      }

      function pxToDb(dy, trackH) {
        return startDb + (dy / trackH) * (FADER_MAX - FADER_MIN);
      }

      function getTrackH() {
        return el.querySelector('.mxr-fader-track')?.getBoundingClientRect().height || 200;
      }

      function onDown(e) {
        dragging = true;
        startY  = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
        startDb = getDb();
        document.body.style.userSelect = 'none';
        e.preventDefault();
        _activeFader = {
          applyDb, pxToDb, getTrackH,
          get dragging() { return dragging; },
          set dragging(v) { dragging = v; },
          get startY() { return startY; }
        };
      }
      function onMove(e) {
        const f = _activeFader;
        if (!f || !f.dragging) return;
        const cy = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
        const dy = f.startY - cy;
        f.applyDb(f.pxToDb(dy, f.getTrackH()));
      }
      function onUp() {
        const f = _activeFader;
        if (!f) return;
        f.dragging = false;
        document.body.style.userSelect = '';
        _activeFader = null;
      }

      el.addEventListener('mousedown',  onDown);
      el.addEventListener('touchstart', onDown, { passive: false });
      if (!document._mxrFaderDocBound) {
        document._mxrFaderDocBound = true;
        document.addEventListener('mousemove',  onMove);
        document.addEventListener('touchmove',  onMove, { passive: false });
        document.addEventListener('mouseup',    onUp);
        document.addEventListener('touchend',   onUp);
      }

      el.addEventListener('dblclick', () => applyDb(0));

      el.addEventListener('keydown', e => {
        const step = e.shiftKey ? 1 : 0.5;
        if (e.key === 'ArrowUp')   { applyDb(getDb() + step); e.preventDefault(); }
        if (e.key === 'ArrowDown') { applyDb(getDb() - step); e.preventDefault(); }
      });
    });
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function getMixerContentArea() { return cachedEl('mixerContentArea'); }
  function getMixerSidePanel()   { return cachedEl('mixerSidePanel'); }

  function updateToolbarHeader() {
    const stemCount = Object.keys(mixerState.stems).length;
    const tag = document.querySelector('.mxr-title-tag');
    if (tag) {
      tag.textContent = `${stemCount} stem${stemCount !== 1 ? 's' : ''}`;
    }
    const transport = cachedEl('mxrTransport');
    if (transport) {
      transport.style.display = stemCount > 0 ? 'flex' : 'none';
    }
  }

  // ── Stem library ──────────────────────────────────────────────────────────
  function buildStemLibraryIdMap(names) {
    const out = {};
    names.forEach(n => {
      const id = mixerState.stems[n]?.libraryId;
      if (id) out[n] = id;
    });
    return out;
  }

  runtime.buildStemLibraryIdMap = buildStemLibraryIdMap;
  window.buildStemLibraryIdMap = buildStemLibraryIdMap;
  const mixerLibrary = window.LGMDM.createMixerLibraryService({
    mixerState,
    apiFetch: LG.api.apiFetch,
    cachedEl,
    defaultStemParams,
    addChannelToDOM: (...args) => addChannelToDOM(...args),
    renderMixerSidePanel: (...args) => renderMixerSidePanel(...args),
    decodeStemForPreview,
    scheduleServerPreview,
    handleClientError: window.LGMDM?.errors?.handleClientError
  });
  const { refreshStemLibrary, addStemFromLibrary, deleteStemFromLibrary } = mixerLibrary;

  let _channelTemplate = null;
  let _eqBandTemplate = null;

  function initTemplates() {
    if (!_channelTemplate) {
      _channelTemplate = document.getElementById('tmpl-channel');
      if (!_channelTemplate) {
        _channelTemplate = document.createElement('template');
        _channelTemplate.id = 'tmpl-channel';
      _channelTemplate.innerHTML = `
        <div class="mxr-channel" data-stem="">
          <div class="mxr-ch-header">
            <span class="mxr-ch-emoji"></span>
            <span class="mxr-ch-name"></span>
            <button class="mxr-ch-close" data-stem="">&times;</button>
          </div>
          <div class="mxr-ch-uploading" role="status" aria-live="polite">
            <div class="skeleton-line skeleton-line--sm"></div>
            <div class="skeleton-line skeleton-line--md"></div>
          </div>
          <div class="mxr-fader-area">
            <div class="mxr-db-scale">
              <span>+12</span><span>+6</span><span>0</span>
              <span>-6</span><span>-12</span><span>-∞</span>
            </div>
            <div class="mxr-fader-placeholder"></div>
            <div class="mxr-fader-val"></div>
          </div>
          <div class="mxr-vu-wrap">
            <div class="mxr-vu-bar"><div class="mxr-vu-fill"></div></div>
            <div class="mxr-vu-bar"><div class="mxr-vu-fill"></div></div>
          </div>
          <div class="mxr-pan-row">
            <span class="mxr-pan-label">L</span>
            <input type="range" class="mxr-pan-slider" data-param="pan" min="-1" max="1" step="0.05" value="0">
            <span class="mxr-pan-label">R</span>
            <span class="mxr-pan-val"></span>
          </div>
          <div class="mxr-ms-row">
            <button class="mxr-btn-ms" data-action="mute">M</button>
            <button class="mxr-btn-ms" data-action="solo">S</button>
            <button class="mxr-btn-ms mxr-reset-btn" data-action="reset" title="Resetear canal">↺</button>
          </div>
          <details class="mxr-ch-details" open>
            <summary>Controles del canal</summary>
            <div class="mxr-adv-section">Filtros</div>
            <div class="param"><label>HP</label><span class="val"></span><input type="range" data-param="hp_cutoff_hz" min="20" max="500" step="5"></div>
            <div class="param"><label>LP</label><span class="val"></span><input type="range" data-param="lp_cutoff_hz" min="2000" max="20000" step="100"></div>
            <div class="mxr-adv-section">EQ 4 bandas</div>
            <div class="eq-bands-container"></div>
            <div class="lgjs-s-27946a45">
              Compresor <input type="checkbox" data-param="comp_enabled">
            </div>
            <div class="param"><label>Threshold</label><span class="val"></span><input type="range" data-param="comp_threshold" min="0.01" max="1" step="0.01"></div>
            <div class="param"><label>Ratio</label><span class="val"></span><input type="range" data-param="comp_ratio" min="1" max="20" step="0.5"></div>
            <div class="param"><label>Attack</label><span class="val"></span><input type="range" data-param="comp_attack_ms" min="0.1" max="100" step="0.1"></div>
            <div class="param"><label>Release</label><span class="val"></span><input type="range" data-param="comp_release_ms" min="10" max="500" step="5"></div>
            <div class="param"><label>Makeup</label><span class="val"></span><input type="range" data-param="comp_makeup_db" min="-6" max="24" step="0.5"></div>
            <div class="param"><label>Stereo Link</label><span class="val"></span><input type="checkbox" data-param="comp_stereo_link" class="lgjs-s-99317219"></div>
            <div class="param"><label>PDR (auto-release)</label><span class="val"></span><input type="checkbox" data-param="comp_pdr" class="lgjs-s-99317219"></div>
            <div class="mxr-adv-section">Transient</div>
            <div class="param"><label>Attack</label><span class="val"></span><input type="range" data-param="transient_attack" min="-1" max="1" step="0.05"></div>
            <div class="param"><label>Sustain</label><span class="val"></span><input type="range" data-param="transient_sustain" min="-1" max="1" step="0.05"></div>
            <div class="param"><label>Stereo</label><span class="val"></span><input type="range" data-param="stereo_width_amount" min="0" max="2" step="0.05"></div>
            <div class="mxr-adv-section">Sidechain</div>
            <div class="lgjs-s-23cf395d">
              <label class="lgjs-s-96c23d05">Trigger</label>
              <select data-param="sidechain_trigger_name" class="lgjs-s-af9b0637">
                <option value="">— Desactivado —</option>
              </select>
            </div>
            <div class="param"><label>SC Threshold</label><span class="val"></span><input type="range" data-param="sidechain_threshold" min="0.01" max="1" step="0.01"></div>
            <div class="param"><label>SC Ratio</label><span class="val"></span><input type="range" data-param="sidechain_ratio" min="1" max="20" step="0.5"></div>
            <div class="param"><label>SC Attack</label><span class="val"></span><input type="range" data-param="sidechain_attack_ms" min="0.5" max="100" step="0.5"></div>
            <div class="param"><label>SC Release</label><span class="val"></span><input type="range" data-param="sidechain_release_ms" min="10" max="500" step="5"></div>
            <div class="lgjs-s-27946a45">
              Reverb <input type="checkbox" data-param="reverb_enabled">
            </div>
            <div class="lgjs-s-23cf395d">
              <label class="lgjs-s-96c23d05">Preset</label>
              <select data-param="reverb_preset" class="lgjs-s-af9b0637">
                <option value="small_studio">Small Studio</option>
                <option value="large_hall">Large Hall</option>
                <option value="cathedral">Cathedral</option>
                <option value="live_venue">Live Venue</option>
                <option value="plate">Plate</option>
                <option value="spring">Spring</option>
              </select>
            </div>
            <div class="param"><label>Wet Amount</label><span class="val"></span><input type="range" data-param="reverb_wet_amount" min="0" max="1" step="0.05"></div>
            <div class="param"><label>Pre-Delay (ms)</label><span class="val"></span><input type="range" data-param="reverb_pre_delay_ms" min="0" max="200" step="5"></div>
            <div class="param"><label>Room Size</label><span class="val"></span><input type="range" data-param="reverb_room_size" min="0.3" max="2" step="0.1"></div>
            <div class="lgjs-s-27946a45">
              Pitch Correction <input type="checkbox" data-param="pitch_correction_enabled">
            </div>
            <div class="lgjs-s-23cf395d">
              <label class="lgjs-s-96c23d05">Mode</label>
              <select data-param="pitch_correction_mode" class="lgjs-s-af9b0637">
                <option value="OFF">Off</option>
                <option value="LIGHT">Light</option>
                <option value="MEDIUM">Medium</option>
                <option value="STRONG">Strong</option>
              </select>
            </div>
            <div class="lgjs-s-23cf395d">
              <label class="lgjs-s-96c23d05">Scale</label>
              <select data-param="pitch_correction_scale" class="lgjs-s-af9b0637">
                <option value="">Automática (detecta la tonalidad)</option>
                <option value="C_major">C Major</option>
                <option value="G_major">G Major</option>
                <option value="D_major">D Major</option>
                <option value="A_major">A Major</option>
                <option value="E_major">E Major</option>
                <option value="B_major">B Major</option>
                <option value="F#_major">F# Major</option>
                <option value="Db_major">Db Major</option>
                <option value="Ab_major">Ab Major</option>
                <option value="Eb_major">Eb Major</option>
                <option value="Bb_major">Bb Major</option>
                <option value="F_major">F Major</option>
                <option value="A_minor">A Minor</option>
                <option value="E_minor">E Minor</option>
                <option value="B_minor">B Minor</option>
                <option value="F#_minor">F# Minor</option>
                <option value="C#_minor">C# Minor</option>
                <option value="G#_minor">G# Minor</option>
                <option value="D#_minor">D# Minor</option>
                <option value="A#_minor">A# Minor</option>
                <option value="F_minor">F Minor</option>
                <option value="C_minor">C Minor</option>
                <option value="G_minor">G Minor</option>
                <option value="D_minor">D Minor</option>
              </select>
            </div>
            <div class="param"><label>Glide (ms)</label><span class="val"></span><input type="range" data-param="pitch_correction_glide_ms" min="0" max="200" step="5"></div>
          </details>
        </div>
      `;
        document.body.appendChild(_channelTemplate);
      }
    }

    if (!_eqBandTemplate) {
      _eqBandTemplate = document.getElementById('tmpl-eqband');
      if (!_eqBandTemplate) {
        _eqBandTemplate = document.createElement('template');
        _eqBandTemplate.id = 'tmpl-eqband';
        _eqBandTemplate.innerHTML = `
        <div class="mxr-eqband">
          <div class="mxr-eqband-label"></div>
          <div class="mxr-eqband-row">
            <span class="mxr-eqband-tag">Frec.</span>
            <input type="range" data-param="eq_freq" min="40" max="18000" step="10">
            <span class="mxr-eqband-val"></span>
          </div>
          <div class="mxr-eqband-row">
            <span class="mxr-eqband-tag">Gan.</span>
            <input type="range" data-param="eq_gain_db" min="-12" max="12" step="0.5">
            <span class="mxr-eqband-val"></span>
          </div>
          <div class="mxr-eqband-row">
            <span class="mxr-eqband-tag">Q</span>
            <input type="range" data-param="eq_q" min="0.3" max="4" step="0.1">
            <span class="mxr-eqband-val"></span>
          </div>
        </div>
      `;
        document.body.appendChild(_eqBandTemplate);
      }
    }
  }

  function renderMixer() {
    const area = getMixerContentArea();
    if (!area) return;
    // Asegurar que el toolbar y el stage existen
    let toolbar = area.querySelector('.mxr-toolbar');
    let stage = area.querySelector('.mxr-stage');
    if (!toolbar || !stage) {
      area.innerHTML = `
        <div class="mxr-toolbar"></div>
        <div class="mxr-stage"></div>
      `;
      toolbar = area.querySelector('.mxr-toolbar');
      stage = area.querySelector('.mxr-stage');
    }

    const stemCount = Object.keys(mixerState.stems).length;
    toolbar.innerHTML = `
      <button class="btn btn-sm" id="mixerAddStemBtn" type="button" aria-label="Añadir stem">＋ Stem</button>
      <button class="btn btn-sm" id="mixerAddMultiBtn" type="button" aria-label="Añadir múltiples archivos">Multi</button>
      <button class="btn btn-sm" id="mixerLibraryBtn" type="button" aria-label="Abrir librería">Librería</button>
      <input type="file" id="mixerFileInput" accept=".wav,.mp3,.flac,.ogg,.aiff,.aif" class="lgjs-s-6b99de8b" aria-label="Archivo de audio">
      <input type="file" id="mixerMultiInput" accept=".wav,.mp3,.flac,.ogg,.aiff,.aif" multiple class="lgjs-s-6b99de8b" aria-label="Múltiples archivos de audio">
      <span class="mxr-title-tag" aria-hidden="true">${stemCount} stem${stemCount!==1?'s':''}</span>
      <div class="mxr-transport" id="mxrTransport" style="${stemCount ? 'display:flex' : 'display:none'}">
        <button class="btn btn-sm" id="mxrPlayBtn" type="button" title="Preview en vivo (client-side)" aria-label="Reproducir preview en vivo">▶</button>
        <input type="range" id="mxrSeek" class="mxr-seek" min="0" max="0" step="0.01" value="0" aria-label="Posición del preview">
        <span class="mxr-time" id="mxrTimeLabel" aria-live="off">0:00 / 0:00</span>
      </div>
      <button class="btn btn-sm mxr-clear-btn" id="mixerClearBtn" type="button" aria-label="Limpiar todos los stems" title="Limpiar todos los stems"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;"><path d="M2.5 4h11M5.5 4V2.5h5V4M4 4l1 10h6l1-10"/></svg></button>
    `;

    if (stemCount === 0) {
      stage.innerHTML = `
        <div class="mxr-empty">
          <div class="mxr-empty-icon"><svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.75;"><line x1="4" y1="3" x2="4" y2="21"/><circle cx="4" cy="9" r="2.5" fill="currentColor"/><line x1="12" y1="3" x2="12" y2="21"/><circle cx="12" cy="15" r="2.5" fill="currentColor"/><line x1="20" y1="3" x2="20" y2="21"/><circle cx="20" cy="7" r="2.5" fill="currentColor"/></svg></div>
          <div class="mxr-empty-title">Arrastrá stems acá o usá los botones</div>
          <div class="mxr-empty-sub">WAV · MP3 · FLAC · OGG · AIFF — hasta 200MB</div>
          <div class="lgjs-s-2ded3c16">
            <button class="btn btn-primary" id="mxrDropBtn" type="button">＋ Elegir archivos</button>
            <button class="btn btn-ref" id="mxrEmptyLibraryBtn" type="button">Usar librería</button>
          </div>
        </div>
      `;
    } else {
      let channels = stage.querySelector('#mixerChannels');
      if (!channels) {
        channels = document.createElement('div');
        channels.className = 'mxr-channels';
        channels.id = 'mixerChannels';
        stage.appendChild(channels);
        const masterEl = document.createElement('div');
        masterEl.className = 'mxr-channel mxr-master-ch';
        masterEl.id = 'mxrMasterCh';
        masterEl.innerHTML = renderMasterChannel();
        channels.appendChild(masterEl);
      }
      const existingNames = Array.from(channels.querySelectorAll('.mxr-channel:not(.mxr-master-ch)'))
        .map(el => el.dataset.stem).filter(Boolean);
      const allNames = Object.keys(mixerState.stems);
      for (const name of allNames) {
        if (!existingNames.includes(name)) {
          addChannelToDOM(name);
        }
      }
      for (const name of existingNames) {
        if (!mixerState.stems[name]) {
          const el = document.getElementById(`ch-${CSS.escape(name)}`);
          if (el) el.remove();
        }
      }
      const master = channels.querySelector('#mxrMasterCh');
      for (const name of allNames) {
        const el = document.getElementById(`ch-${CSS.escape(name)}`);
        if (el) channels.insertBefore(el, master);
      }
    }

    updateToolbarHeader();
    bindMixerEvents();
    initFaderDrags(area);
    renderMixerSidePanel();
  }

  function renderChannel(name) {
    const s = mixerState.stems[name];
    const p = s.params;
    const otherNames = Object.keys(mixerState.stems).filter(n => n !== name);
    const panLabel = Math.abs(p.pan) < 0.02 ? 'C' : (p.pan > 0 ? 'R' : 'L') + Math.abs(p.pan*100|0);

    const tmpl = document.getElementById('tmpl-channel');
    if (!tmpl) {
      // string (interpola valores directo en el HTML, sin el problema de
      // propiedades-vs-atributos), pero renderChannel ahora devuelve un nodo
      // DOM vivo — hay que envolver el string en un nodo real acá para que
      // el tipo de retorno sea consistente en los dos caminos.
      const w = document.createElement('div');
      w.innerHTML = renderChannelFallback(name);
      return w.firstElementChild;
    }
    const frag = tmpl.content.cloneNode(true);
    const ch = frag.querySelector('.mxr-channel');
    ch.dataset.stem = name;
    ch.id = `ch-${CSS.escape(name)}`;
    if (p.mute) ch.classList.add('mxr-ch--muted');
    if (p.solo) ch.classList.add('mxr-ch--solo');

    
function requireChannelChild(parent, selector, owner) {
  const node = LGMDM.dom.query(selector, parent);
  if (!node) {
    throw new Error(`[LGMDM DOM CONTRACT] ${owner}: template missing ${selector}`);
  }
  return node;
}

// Header
    requireChannelChild(ch, '.mxr-ch-emoji', '13-mixer-ui').textContent = stemEmoji(p.stem_type);
    requireChannelChild(ch, '.mxr-ch-name', '13-mixer-ui').textContent = name;
    const closeBtn = ch.querySelector('.mxr-ch-close');
    closeBtn.dataset.stem = name;

    // Uploading indicator
    const uploadEl = ch.querySelector('.mxr-ch-uploading');
    if (!s.uploaded) {
      uploadEl.style.display = 'block';
      uploadEl.textContent = '⏳ Subiendo…';
    } else {
      uploadEl.style.display = 'none';
    }

    // Fader
    const faderPlaceholder = ch.querySelector('.mxr-fader-placeholder');
    faderPlaceholder.outerHTML = faderHTML('gain:'+name, p.gain_db);
    const faderVal = ch.querySelector('.mxr-fader-val');
    faderVal.id = 'ch-gain-val-' + name;
    faderVal.textContent = formatDbValue(p.gain_db);

    // VU meters
    const fills = ch.querySelectorAll('.mxr-vu-fill');
    fills[0].id = `mxr-vu-fill-l-${name}`;
    fills[1].id = `mxr-vu-fill-r-${name}`;

    // Pan
    const panSlider = ch.querySelector('.mxr-pan-slider');
    panSlider.dataset.stem = name;
    panSlider.value = p.pan;
    const panVal = ch.querySelector('.mxr-pan-val');
    panVal.id = 'ch-pan-val-' + name;
    panVal.textContent = panLabel;

    // Mute/Solo/Reset
    const muteBtn = ch.querySelector('[data-action="mute"]');
    muteBtn.dataset.stem = name;
    if (p.mute) muteBtn.classList.add('active-mute');
    const soloBtn = ch.querySelector('[data-action="solo"]');
    soloBtn.dataset.stem = name;
    if (p.solo) soloBtn.classList.add('active-solo');
    const resetBtn = ch.querySelector('[data-action="reset"]');
    resetBtn.dataset.stem = name;

    // Advanced details
    const details = ch.querySelector('.mxr-ch-details');
    // Filtros
    const hpInput = details.querySelector('[data-param="hp_cutoff_hz"]');
    hpInput.dataset.stem = name;
    hpInput.value = p.hp_cutoff_hz;
    const hpVal = hpInput.parentElement.querySelector('.val');
    hpVal.id = 'ch-hp-val-' + name;
    hpVal.textContent = p.hp_cutoff_hz + ' Hz';

    const lpInput = details.querySelector('[data-param="lp_cutoff_hz"]');
    lpInput.dataset.stem = name;
    lpInput.value = p.lp_cutoff_hz;
    const lpVal = lpInput.parentElement.querySelector('.val');
    lpVal.id = 'ch-lp-val-' + name;
    lpVal.textContent = p.lp_cutoff_hz >= 20000 ? '20k' : p.lp_cutoff_hz + ' Hz';

    // EQ bands
    const eqContainer = details.querySelector('.eq-bands-container');
    const bands = [
      { key: 'low', label: 'Graves', freq: p.eq_low_freq, gain: p.eq_low_gain_db, q: p.eq_low_q,
        fmin: 40, fmax: 400, fstep: 10 },
      { key: 'lomid', label: 'L-Mid', freq: p.eq_lomid_freq, gain: p.eq_lomid_gain_db, q: p.eq_lomid_q,
        fmin: 200, fmax: 1500, fstep: 10 },
      { key: 'himid', label: 'H-Mid', freq: p.eq_himid_freq, gain: p.eq_himid_gain_db, q: p.eq_himid_q,
        fmin: 800, fmax: 8000, fstep: 10 },
      { key: 'high', label: 'Agudos', freq: p.eq_high_freq, gain: p.eq_high_gain_db, q: p.eq_high_q,
        fmin: 4000, fmax: 18000, fstep: 10 },
    ];
    for (const b of bands) {
      let tmplEl = document.getElementById('tmpl-eqband');
      if (!tmplEl || !tmplEl.content) {
        initTemplates();
        tmplEl = document.getElementById('tmpl-eqband');
      }
      const eqFrag = tmplEl?.content?.cloneNode(true);
      if (!eqFrag) continue;
      const eqDiv = eqFrag.querySelector('.mxr-eqband');
      const label = eqDiv.querySelector('.mxr-eqband-label');
      label.textContent = b.label;

      const freqInput = eqDiv.querySelector('[data-param="eq_freq"]');
      freqInput.dataset.stem = name;
      freqInput.min = b.fmin;
      freqInput.max = b.fmax;
      freqInput.step = b.fstep;
      freqInput.value = b.freq;
      const freqVal = freqInput.parentElement.querySelector('.mxr-eqband-val');
      freqVal.id = `ch-eq-${b.key}-freq-val-${name}`;
      freqVal.textContent = b.freq >= 1000 ? (b.freq/1000).toFixed(1)+'k' : b.freq + 'Hz';

      const gainInput = eqDiv.querySelector('[data-param="eq_gain_db"]');
      gainInput.dataset.stem = name;
      gainInput.value = b.gain;
      const gainVal = gainInput.parentElement.querySelector('.mxr-eqband-val');
      gainVal.id = `ch-eq-${b.key}-gain-val-${name}`;
      gainVal.textContent = formatDbValue(b.gain);

      const qInput = eqDiv.querySelector('[data-param="eq_q"]');
      qInput.dataset.stem = name;
      qInput.value = b.q;
      const qVal = qInput.parentElement.querySelector('.mxr-eqband-val');
      qVal.id = `ch-eq-${b.key}-q-val-${name}`;
      qVal.textContent = b.q.toFixed(1);

      eqContainer.appendChild(eqDiv);
    }

    // Compressor
    const compChk = details.querySelector('[data-param="comp_enabled"]');
    compChk.dataset.stem = name;
    compChk.checked = p.comp_enabled;
    const compParams = [
      { param: 'comp_threshold', label: 'Threshold', fmt: (v) => formatLinearThresholdToDb(v), min: 0.01, max: 1, step: 0.01, id: 'ch-comp-thr-val-' },
      { param: 'comp_ratio', label: 'Ratio', fmt: (v) => v + ':1', min: 1, max: 20, step: 0.5, id: 'ch-comp-ratio-val-' },
      { param: 'comp_attack_ms', label: 'Attack', fmt: (v) => v + ' ms', min: 0.1, max: 100, step: 0.1, id: 'ch-comp-atk-val-' },
      { param: 'comp_release_ms', label: 'Release', fmt: (v) => v + ' ms', min: 10, max: 500, step: 5, id: 'ch-comp-rel-val-' },
      { param: 'comp_makeup_db', label: 'Makeup', fmt: (v) => formatDbValue(v), min: -6, max: 24, step: 0.5, id: 'ch-comp-mkp-val-' },
    ];
    for (const cp of compParams) {
      const el = details.querySelector(`[data-param="${cp.param}"]`);
      if (el) {
        el.dataset.stem = name;
        el.value = p[cp.param];
        const valEl = el.parentElement.querySelector('.val');
        if (valEl) {
          valEl.id = cp.id + name;
          valEl.textContent = cp.fmt(p[cp.param]);
        }
      }
    }
    // Stereo link / PDR — checkboxes, no rango
    const compStereoLink = details.querySelector('[data-param="comp_stereo_link"]');
    if (compStereoLink) { compStereoLink.dataset.stem = name; compStereoLink.checked = p.comp_stereo_link; }
    const compPdr = details.querySelector('[data-param="comp_pdr"]');
    if (compPdr) { compPdr.dataset.stem = name; compPdr.checked = p.comp_pdr; }

    // Transient
    const transParams = [
      { param: 'transient_attack', id: 'ch-tr-atk-val-', fmt: (v) => (v>0?'+':'') + v.toFixed(2) },
      { param: 'transient_sustain', id: 'ch-tr-sus-val-', fmt: (v) => (v>0?'+':'') + v.toFixed(2) },
    ];
    for (const tp of transParams) {
      const el = details.querySelector(`[data-param="${tp.param}"]`);
      if (el) {
        el.dataset.stem = name;
        el.value = p[tp.param];
        const valEl = el.parentElement.querySelector('.val');
        if (valEl) {
          valEl.id = tp.id + name;
          valEl.textContent = tp.fmt(p[tp.param]);
        }
      }
    }
    // Stereo width
    const swEl = details.querySelector('[data-param="stereo_width_amount"]');
    if (swEl) {
      swEl.dataset.stem = name;
      swEl.value = p.stereo_width_amount;
      const valEl = swEl.parentElement.querySelector('.val');
      if (valEl) {
        valEl.id = 'ch-sw-val-' + name;
        valEl.textContent = p.stereo_width_amount.toFixed(2);
      }
    }

    // Sidechain select
    const scSelect = details.querySelector('[data-param="sidechain_trigger_name"]');
    if (scSelect) {
      scSelect.dataset.stem = name;
      const optHtml = otherNames.map((n) => {
        const safe = LG.ui.escapeHtml(String(n));
        const selected = p.sidechain_trigger_name === n ? ' selected' : '';
        return `<option value="${safe}"${selected}>${safe}</option>`;
      }).join('');
      scSelect.innerHTML = `<option value="">— Desactivado —</option>${optHtml}`;
    }
    const scParams = [
      { param: 'sidechain_threshold', id: 'ch-sc-thr-val-', fmt: (v) => formatLinearThresholdToDb(v), min: 0.01, max: 1, step: 0.01 },
      { param: 'sidechain_ratio', id: 'ch-sc-ratio-val-', fmt: (v) => v + ':1', min: 1, max: 20, step: 0.5 },
      { param: 'sidechain_attack_ms', id: 'ch-sc-atk-val-', fmt: (v) => v + ' ms', min: 0.5, max: 100, step: 0.5 },
      { param: 'sidechain_release_ms', id: 'ch-sc-rel-val-', fmt: (v) => v + ' ms', min: 10, max: 500, step: 5 },
    ];
    for (const sp of scParams) {
      const el = details.querySelector(`[data-param="${sp.param}"]`);
      if (el) {
        el.dataset.stem = name;
        el.value = p[sp.param];
        const valEl = el.parentElement.querySelector('.val');
        if (valEl) {
          valEl.id = sp.id + name;
          valEl.textContent = sp.fmt(p[sp.param]);
        }
      }
    }

    // Reverb
    const reverbChk = details.querySelector('[data-param="reverb_enabled"]');
    if (reverbChk) {
      reverbChk.dataset.stem = name;
      reverbChk.checked = p.reverb_enabled;
    }
    const reverbPreset = details.querySelector('[data-param="reverb_preset"]');
    if (reverbPreset) {
      reverbPreset.dataset.stem = name;
      reverbPreset.value = p.reverb_preset;
    }
    const reverbParams = [
      { param: 'reverb_wet_amount', id: 'ch-reverb-wet-val-', fmt: (v) => (v*100).toFixed(0)+'%' },
      { param: 'reverb_pre_delay_ms', id: 'ch-reverb-predelay-val-', fmt: (v) => v.toFixed(0)+' ms' },
      { param: 'reverb_room_size', id: 'ch-reverb-roomsize-val-', fmt: (v) => v.toFixed(2) },
    ];
    for (const rp of reverbParams) {
      const el = details.querySelector(`[data-param="${rp.param}"]`);
      if (el) {
        el.dataset.stem = name;
        el.value = p[rp.param];
        const valEl = el.parentElement.querySelector('.val');
        if (valEl) {
          valEl.id = rp.id + name;
          valEl.textContent = rp.fmt(p[rp.param]);
        }
      }
    }

    // Pitch correction
    const pitchChk = details.querySelector('[data-param="pitch_correction_enabled"]');
    if (pitchChk) {
      pitchChk.dataset.stem = name;
      pitchChk.checked = p.pitch_correction_enabled;
    }
    const pitchMode = details.querySelector('[data-param="pitch_correction_mode"]');
    if (pitchMode) {
      pitchMode.dataset.stem = name;
      pitchMode.value = p.pitch_correction_mode;
    }
    const pitchScale = details.querySelector('[data-param="pitch_correction_scale"]');
    if (pitchScale) {
      pitchScale.dataset.stem = name;
      pitchScale.value = p.pitch_correction_scale || '';
    }
    const pitchGlide = details.querySelector('[data-param="pitch_correction_glide_ms"]');
    if (pitchGlide) {
      pitchGlide.dataset.stem = name;
      pitchGlide.value = p.pitch_correction_glide_ms;
      const valEl = pitchGlide.parentElement.querySelector('.val');
      if (valEl) {
        valEl.id = 'ch-pitch-glide-val-' + name;
        valEl.textContent = p.pitch_correction_glide_ms.toFixed(0) + ' ms';
      }
    }

    // las propiedades JS que recién seteamos (.checked de los checkboxes,
    // .value de los <input type="range">) porque el checkbox/value como
    // PROPIEDAD no se refleja como atributo HTML al serializar — solo se
    // preserva si viene puesto como atributo en el markup original. Efecto:
    // rango en vez del valor real (ej. comp_attack_ms mostraba 50 en vez de
    // 10), y los checkboxes siempre arrancaban destildados, sin importar el
    // valor real en mixerState — se "arreglaba" solo, en apariencia, en
    // cuanto tocabas el slider a mano (porque ahí sí operás sobre el DOM
    // vivo). Ahora se devuelve el nodo DOM vivo directo, sin pasar por texto.
    return ch;
  }

  function renderChannelFallback(name) {
    const safeName = LG.ui.escapeHtml(String(name ?? ''));
    // Se incluye solo como respaldo.
    const s = mixerState.stems[name];
    const p = s.params;
    const otherNames = Object.keys(mixerState.stems).filter(n => n !== name);
    const panLabel = Math.abs(p.pan) < 0.02 ? 'C' : (p.pan > 0 ? 'R' : 'L') + Math.abs(p.pan*100|0);
    return `
      <div class="mxr-channel ${p.mute?'mxr-ch--muted':''} ${p.solo?'mxr-ch--solo':''}"
           data-stem="${safeName}" id="ch-${CSS.escape(String(name))}">
        <div class="mxr-ch-header">
          <span class="mxr-ch-emoji">${stemEmoji(p.stem_type)}</span>
          <span class="mxr-ch-name" title="${safeName}">${safeName}</span>
          <button class="mxr-ch-close" data-stem="${safeName}">&times;</button>
        </div>
        ${!s.uploaded ? `<div class="mxr-ch-uploading" role="status" aria-live="polite">
            <div class="skeleton-line skeleton-line--sm"></div>
            <div class="skeleton-line skeleton-line--md"></div>
          </div>` : ''}
        <div class="mxr-fader-area">
          <div class="mxr-db-scale">
            <span>+12</span><span>+6</span><span>0</span>
            <span>-6</span><span>-12</span><span>-∞</span>
          </div>
          ${faderHTML('gain:'+name, p.gain_db)}
          <div class="mxr-fader-val" id="ch-gain-val-${name}">${formatDbValue(p.gain_db)}</div>
        </div>
        <div class="mxr-vu-wrap">
          <div class="mxr-vu-bar"><div class="mxr-vu-fill" id="mxr-vu-fill-l-${name}"></div></div>
          <div class="mxr-vu-bar"><div class="mxr-vu-fill" id="mxr-vu-fill-r-${name}"></div></div>
        </div>
        <div class="mxr-pan-row">
          <span class="mxr-pan-label">L</span>
          <input type="range" class="mxr-pan-slider" data-stem="${safeName}" data-param="pan"
            min="-1" max="1" step="0.05" value="${p.pan}">
          <span class="mxr-pan-label">R</span>
          <span class="mxr-pan-val" id="ch-pan-val-${name}">${panLabel}</span>
        </div>
        <div class="mxr-ms-row">
          <button class="mxr-btn-ms ${p.mute?'active-mute':''}" type="button" data-stem="${safeName}" data-action="mute" aria-pressed="${!!p.mute}" aria-label="Silenciar ${safeName}">M</button>
          <button class="mxr-btn-ms ${p.solo?'active-solo':''}" type="button" data-stem="${safeName}" data-action="solo" aria-pressed="${!!p.solo}" aria-label="Solo ${safeName}">S</button>
          <button class="mxr-btn-ms mxr-reset-btn" type="button" data-stem="${safeName}" data-action="reset" aria-label="Resetear ${safeName}">↺</button>
        </div>
        <details class="mxr-ch-details" open>
          <summary>Controles del canal</summary>
          <div class="mxr-adv-section">Filtros</div>
          <div class="param"><label>HP</label>
            <span class="val" id="ch-hp-val-${name}">${p.hp_cutoff_hz} Hz</span>
            <input type="range" data-stem="${safeName}" data-param="hp_cutoff_hz" min="20" max="500" step="5" value="${p.hp_cutoff_hz}">
          </div>
          <div class="param"><label>LP</label>
            <span class="val" id="ch-lp-val-${name}">${p.lp_cutoff_hz>=20000?'20k':p.lp_cutoff_hz+' Hz'}</span>
            <input type="range" data-stem="${safeName}" data-param="lp_cutoff_hz" min="2000" max="20000" step="100" value="${p.lp_cutoff_hz}">
          </div>
          <div class="mxr-adv-section">EQ 4 bandas</div>
          ${renderEQBand(name,'low',  'Graves', p.eq_low_freq,   p.eq_low_gain_db,   p.eq_low_q)}
          ${renderEQBand(name,'lomid','L-Mid',  p.eq_lomid_freq, p.eq_lomid_gain_db, p.eq_lomid_q)}
          ${renderEQBand(name,'himid','H-Mid',  p.eq_himid_freq, p.eq_himid_gain_db, p.eq_himid_q)}
          ${renderEQBand(name,'high', 'Agudos', p.eq_high_freq,  p.eq_high_gain_db,  p.eq_high_q)}
          <div class="lgjs-s-27946a45">
            Compresor <input type="checkbox" data-stem="${safeName}" data-param="comp_enabled" ${p.comp_enabled?'checked':''}>
          </div>
          <div class="param"><label>Threshold</label>
            <span class="val" id="ch-comp-thr-val-${name}">${formatLinearThresholdToDb(p.comp_threshold)}</span>
            <input type="range" data-stem="${safeName}" data-param="comp_threshold" min="0.01" max="1" step="0.01" value="${p.comp_threshold}">
          </div>
          <div class="param"><label>Ratio</label>
            <span class="val" id="ch-comp-ratio-val-${name}">${p.comp_ratio}:1</span>
            <input type="range" data-stem="${safeName}" data-param="comp_ratio" min="1" max="20" step="0.5" value="${p.comp_ratio}">
          </div>
          <div class="param"><label>Attack</label>
            <span class="val" id="ch-comp-atk-val-${name}">${p.comp_attack_ms} ms</span>
            <input type="range" data-stem="${safeName}" data-param="comp_attack_ms" min="0.1" max="100" step="0.1" value="${p.comp_attack_ms}">
          </div>
          <div class="param"><label>Release</label>
            <span class="val" id="ch-comp-rel-val-${name}">${p.comp_release_ms} ms</span>
            <input type="range" data-stem="${safeName}" data-param="comp_release_ms" min="10" max="500" step="5" value="${p.comp_release_ms}">
          </div>
          <div class="param"><label>Makeup</label>
            <span class="val" id="ch-comp-mkp-val-${name}">${formatDbValue(p.comp_makeup_db)}</span>
            <input type="range" data-stem="${safeName}" data-param="comp_makeup_db" min="-6" max="24" step="0.5" value="${p.comp_makeup_db}">
          </div>
          <div class="mxr-adv-section">Transient</div>
          <div class="param"><label>Attack</label>
            <span class="val" id="ch-tr-atk-val-${name}">${p.transient_attack>0?'+':''}${p.transient_attack.toFixed(2)}</span>
            <input type="range" data-stem="${safeName}" data-param="transient_attack" min="-1" max="1" step="0.05" value="${p.transient_attack}">
          </div>
          <div class="param"><label>Sustain</label>
            <span class="val" id="ch-tr-sus-val-${name}">${p.transient_sustain>0?'+':''}${p.transient_sustain.toFixed(2)}</span>
            <input type="range" data-stem="${safeName}" data-param="transient_sustain" min="-1" max="1" step="0.05" value="${p.transient_sustain}">
          </div>
          <div class="param"><label>Stereo</label>
            <span class="val" id="ch-sw-val-${name}">${p.stereo_width_amount.toFixed(2)}</span>
            <input type="range" data-stem="${safeName}" data-param="stereo_width_amount" min="0" max="2" step="0.05" value="${p.stereo_width_amount}">
          </div>
          <div class="mxr-adv-section">Sidechain</div>
          <div class="lgjs-s-23cf395d">
            <label class="lgjs-s-96c23d05">Trigger</label>
            <select data-stem="${safeName}" data-param="sidechain_trigger_name"
              class="lgjs-s-af9b0637">
              <option value="">— Desactivado —</option>
              ${otherNames.map(n=>`<option value="${n}" ${p.sidechain_trigger_name===n?'selected':''}>${n}</option>`).join('')}
            </select>
          </div>
          <div class="param"><label>SC Threshold</label>
            <span class="val" id="ch-sc-thr-val-${name}">${formatLinearThresholdToDb(p.sidechain_threshold)}</span>
            <input type="range" data-stem="${safeName}" data-param="sidechain_threshold" min="0.01" max="1" step="0.01" value="${p.sidechain_threshold}">
          </div>
          <div class="param"><label>SC Ratio</label>
            <span class="val" id="ch-sc-ratio-val-${name}">${p.sidechain_ratio}:1</span>
            <input type="range" data-stem="${safeName}" data-param="sidechain_ratio" min="1" max="20" step="0.5" value="${p.sidechain_ratio}">
          </div>
          <div class="lgjs-s-27946a45">
            Reverb <input type="checkbox" data-stem="${safeName}" data-param="reverb_enabled" ${p.reverb_enabled?'checked':''}>
          </div>
          <div class="param"><label>Preset</label>
            <select data-stem="${safeName}" data-param="reverb_preset"
              class="lgjs-s-af9b0637">
              <option value="small_studio" ${p.reverb_preset==='small_studio'?'selected':''}>Small Studio</option>
              <option value="large_hall" ${p.reverb_preset==='large_hall'?'selected':''}>Large Hall</option>
              <option value="cathedral" ${p.reverb_preset==='cathedral'?'selected':''}>Cathedral</option>
              <option value="live_venue" ${p.reverb_preset==='live_venue'?'selected':''}>Live Venue</option>
              <option value="plate" ${p.reverb_preset==='plate'?'selected':''}>Plate</option>
              <option value="spring" ${p.reverb_preset==='spring'?'selected':''}>Spring</option>
            </select>
          </div>
          <div class="param"><label>Wet Amount</label>
            <span class="val" id="ch-reverb-wet-val-${name}">${(p.reverb_wet_amount*100).toFixed(0)}%</span>
            <input type="range" data-stem="${safeName}" data-param="reverb_wet_amount" min="0" max="1" step="0.05" value="${p.reverb_wet_amount}">
          </div>
          <div class="param"><label>Pre-Delay (ms)</label>
            <span class="val" id="ch-reverb-predelay-val-${name}">${p.reverb_pre_delay_ms.toFixed(0)} ms</span>
            <input type="range" data-stem="${safeName}" data-param="reverb_pre_delay_ms" min="0" max="200" step="5" value="${p.reverb_pre_delay_ms}">
          </div>
          <div class="param"><label>Room Size</label>
            <span class="val" id="ch-reverb-roomsize-val-${name}">${p.reverb_room_size.toFixed(2)}</span>
            <input type="range" data-stem="${safeName}" data-param="reverb_room_size" min="0.3" max="2" step="0.1" value="${p.reverb_room_size}">
          </div>
          <div class="lgjs-s-27946a45">
            Pitch Correction <input type="checkbox" data-stem="${safeName}" data-param="pitch_correction_enabled" ${p.pitch_correction_enabled?'checked':''}>
          </div>
          <div class="param"><label>Mode</label>
            <select data-stem="${safeName}" data-param="pitch_correction_mode"
              class="lgjs-s-af9b0637">
              <option value="OFF" ${p.pitch_correction_mode==='OFF'?'selected':''}>OFF</option>
              <option value="LIGHT" ${p.pitch_correction_mode==='LIGHT'?'selected':''}>LIGHT</option>
              <option value="MEDIUM" ${p.pitch_correction_mode==='MEDIUM'?'selected':''}>MEDIUM</option>
              <option value="STRONG" ${p.pitch_correction_mode==='STRONG'?'selected':''}>STRONG</option>
            </select>
          </div>
          <div class="param"><label>Scale</label>
            <select data-stem="${safeName}" data-param="pitch_correction_scale"
              class="lgjs-s-af9b0637">
              <option value="" ${p.pitch_correction_scale==null || p.pitch_correction_scale===''?'selected':''}>Auto-detect</option>
              <option value="C_major" ${p.pitch_correction_scale==='C_major'?'selected':''}>C Major</option>
              <option value="G_major" ${p.pitch_correction_scale==='G_major'?'selected':''}>G Major</option>
              <option value="D_major" ${p.pitch_correction_scale==='D_major'?'selected':''}>D Major</option>
              <option value="A_major" ${p.pitch_correction_scale==='A_major'?'selected':''}>A Major</option>
              <option value="E_major" ${p.pitch_correction_scale==='E_major'?'selected':''}>E Major</option>
              <option value="A_minor" ${p.pitch_correction_scale==='A_minor'?'selected':''}>A Minor</option>
              <option value="E_minor" ${p.pitch_correction_scale==='E_minor'?'selected':''}>E Minor</option>
              <option value="D_minor" ${p.pitch_correction_scale==='D_minor'?'selected':''}>D Minor</option>
            </select>
          </div>
          <div class="param"><label>Glide</label>
            <span class="val" id="ch-pitch-glide-val-${name}">${p.pitch_correction_glide_ms.toFixed(0)} ms</span>
            <input type="range" data-stem="${safeName}" data-param="pitch_correction_glide_ms" min="0" max="200" step="5" value="${p.pitch_correction_glide_ms}">
          </div>
        </details>
      </div>
    `;
  }

  function renderEQBand(stemName, band, label, freq, gain, q) {
    return `
      <div class="mxr-eqband">
        <div class="mxr-eqband-label">${label}</div>
        <div class="mxr-eqband-row">
          <span class="mxr-eqband-tag">Frec.</span>
          <input type="range" data-stem="${stemName}" data-param="eq_${band}_freq"
            min="${band==='low'?40:band==='lomid'?200:band==='himid'?800:4000}"
            max="${band==='low'?400:band==='lomid'?1500:band==='himid'?8000:18000}"
            step="10" value="${freq}">
          <span class="mxr-eqband-val" id="ch-eq-${band}-freq-val-${stemName}">${freq>=1000?(freq/1000).toFixed(1)+'k':freq}Hz</span>
        </div>
        <div class="mxr-eqband-row">
          <span class="mxr-eqband-tag">Gan.</span>
          <input type="range" data-stem="${stemName}" data-param="eq_${band}_gain_db" min="-12" max="12" step="0.5" value="${gain}">
          <span class="mxr-eqband-val" id="ch-eq-${band}-gain-val-${stemName}">${formatDbValue(gain)}</span>
        </div>
        <div class="mxr-eqband-row">
          <span class="mxr-eqband-tag">Q</span>
          <input type="range" data-stem="${stemName}" data-param="eq_${band}_q" min="0.3" max="4" step="0.1" value="${q}">
          <span class="mxr-eqband-val" id="ch-eq-${band}-q-val-${stemName}">${q.toFixed(1)}</span>
        </div>
      </div>`;
  }

  function renderMasterChannel() {
    return `
      <div class="mxr-ch-header">
        <span class="mxr-ch-emoji">[MST]</span>
        <span class="lgjs-s-08935a7e">MASTER</span>
      </div>
      <div class="mxr-fader-area">
        <div class="mxr-db-scale">
          <span>+12</span><span>+6</span><span>0</span>
          <span>-6</span><span>-12</span><span>-∞</span>
        </div>
        ${faderHTML('master', 0)}
        <div class="mxr-fader-val" id="mix-master-gain-val-ch">+0.0 dB</div>
      </div>
      <div class="mxr-vu-wrap">
        <div class="mxr-vu-bar"><div class="mxr-vu-fill" id="mxr-vu-fill-l-master"></div></div>
        <div class="mxr-vu-bar"><div class="mxr-vu-fill" id="mxr-vu-fill-r-master"></div></div>
      </div>
    `;
  }

  function addChannelToDOM(name) {
    const area = getMixerContentArea();
    if (!area) return;
    if (area.style.display === 'none') activateMixerMode();

    let stage = area.querySelector('.mxr-stage');
    let channels = stage ? stage.querySelector('#mixerChannels') : null;

    if (!stage) {
      renderMixer();
      stage = area.querySelector('.mxr-stage');
      channels = stage ? stage.querySelector('#mixerChannels') : null;
    }
    if (!channels) {
      renderMixer();
      stage = area.querySelector('.mxr-stage');
      channels = stage ? stage.querySelector('#mixerChannels') : null;
    }
    if (!channels) return;

    const existing = document.getElementById(`ch-${CSS.escape(name)}`);
    if (existing) existing.remove();

    // string) — así no se pierden .checked/.value seteados como propiedad.
    const chNode = renderChannel(name);
    const master = document.getElementById('mxrMasterCh');
    if (master) channels.insertBefore(chNode, master);
    else channels.appendChild(chNode);

    // Inicializar eventos del nuevo canal
    const area2 = getMixerContentArea();
    if (area2) initFaderDrags(area2);
    updateToolbarHeader();
    renderMixerSidePanel();
  }

  function removeChannelFromDOM(name) {
    const el = document.getElementById(`ch-${CSS.escape(name)}`);
    if (el) el.remove();

    if (Object.keys(mixerState.stems).length === 0) {
      renderMixer();
    }
    updateToolbarHeader();
    renderMixerSidePanel();
  }

  function renderMixerSidePanel() {
    const panel = getMixerSidePanel();
    if (!panel) return;
    // Limpiar cache de elementos dinámicos que se recrean en cada render
    invalidateCachedEl(
      'mixerSubmitBtn', 'mixerStatus', 'mix-master-gain', 'mix-master-gain-val',
      'mix-lufs', 'mix-lufs-val', 'mix-normalize', 'mxrServerPreviewToggle',
      'mxrServerPreviewAudio', 'mxrServerPreviewStatus', 'mxrRefreshLibraryBtn',
      'mxrAiSuggestBtn', 'mix-master-ceiling', 'mix-master-ceiling-val'
    );
    const stemNames = Object.keys(mixerState.stems);
    panel.innerHTML = `
      <div class="mxr-side-section">
        <div class="mxr-side-label">Master Bus</div>
        <div class="param">
          <label>Ganancia</label>
          <span class="val" id="mix-master-gain-val">+0.0 dB</span>
          <input type="range" id="mix-master-gain" min="${FADER_MIN}" max="12" step="0.5" value="0">
        </div>
        <div class="param">
          <label>Target LUFS</label>
          <span class="val" id="mix-lufs-val">-14.0</span>
          <input type="range" id="mix-lufs" min="-24" max="-6" step="0.5" value="-14">
        </div>
        <div class="param">
          <label>Limiter Ceiling</label>
          <span class="val" id="mix-master-ceiling-val">0.95</span>
          <input type="range" id="mix-master-ceiling" min="0.5" max="1" step="0.01" value="0.95">
        </div>
        <label class="mxr-check-label">
          <input type="checkbox" id="mix-normalize" checked> Normalizar antes de masterizar
        </label>
      </div>
      <div class="mxr-side-section">
        <div class="mxr-side-label">Preview servidor (chain completo)</div>
        <label class="mxr-check-label">
          <input type="checkbox" id="mxrServerPreviewToggle" ${serverPreview.enabled?'checked':''}> Render real (con latencia)
        </label>
        <audio id="mxrServerPreviewAudio" controls style="width:100%;${serverPreview.enabled?'':'display:none'}"></audio>
        <div class="mxr-status" id="mxrServerPreviewStatus"></div>
      </div>
      <div class="mxr-side-section">
        <button id="mxrAiSuggestBtn" ${stemNames.length===0?'disabled':''} class="lgjs-s-0466783d">
          Sugerir con IA
        </button>
        <button id="mixerSubmitBtn" ${stemNames.length===0?'disabled':''} class="lgjs-s-0466783d">
          Mezclar y Masterizar
        </button>
        <div id="mixerStatus" class="mxr-status"></div>
      </div>
      <div class="mxr-side-section mxr-stem-library">
        <div class="mxr-side-label">Librería de stems</div>
        <div class="mxr-library-actions">
          <button class="btn btn-sm" id="mxrRefreshLibraryBtn">↻ Actualizar</button>
          <span class="mxr-status">Se guardan stems nuevos automáticamente</span>
        </div>
        ${mixerState.stemLibrary.length===0
          ? '<div class="lgjs-s-a3e977a6">Sin stems guardados</div>'
          : mixerState.stemLibrary.slice(0, 8).map(item => {
              const libraryId = LG.ui.escapeHtml(String(item?.id ?? ''));
              const filename = LG.ui.escapeHtml(String(item?.original_filename ?? ''));
              return `
            <div class="mxr-library-row">
              <button class="btn btn-xs mxr-library-add" type="button" data-library-id="${libraryId}" aria-label="Añadir ${filename} al mixer">＋</button>
              <span class="mxr-stems-name" title="${filename}">${filename}</span>
              <button class="mxr-library-del" type="button" data-library-id="${libraryId}" title="Borrar de librería" aria-label="Borrar ${filename} de librería">&times;</button>
            </div>`;
            }).join('')}
      </div>
      <div class="mxr-side-section mxr-stems-list">
        <div class="mxr-side-label">Stems (${stemNames.length})</div>
        ${stemNames.length===0
          ? '<div class="lgjs-s-a3e977a6">Sin stems</div>'
          : stemNames.map(n => {
              const s = mixerState.stems[n];
              const safeStemName = LG.ui.escapeHtml(String(n));
              const safeStemType = LG.ui.escapeHtml(String(s?.params?.stem_type ?? ''));
              return `<div class="mxr-stems-row">
                <span>${stemEmoji(s.params.stem_type)}</span>
                <span class="mxr-stems-name" title="${safeStemName}">${safeStemName}</span>
                <span class="mxr-stem-upload-state ${s.uploaded ? 'is-uploaded' : 'is-pending'}">${s.uploaded?'✓':'...'}</span>
              </div>`;
            }).join('')}
      </div>
    `;

    // Bind eventos del side panel de forma idempotente.
    // Bind eventos del side panel (usando cachedEl cuando sea posible)
    bindOnce(cachedEl('mix-master-gain'), 'input', e => {
      const db = parseFloat(e.target.value);
      const valEl = cachedEl('mix-master-gain-val');
      if (valEl) valEl.textContent = formatDbValue(db);
      const lblCh = cachedEl('mix-master-gain-val-ch');
      if (lblCh) lblCh.textContent = formatDbValue(db);
      setFaderDb('master', db);
      if (previewEngine.ctx) previewEngine.masterGain.gain.setTargetAtTime(dbToLin(db), previewEngine.ctx.currentTime, 0.015);
      scheduleServerPreview();
    });

    bindOnce(cachedEl('mix-lufs'), 'input', e => {
      const valEl = cachedEl('mix-lufs-val');
      if (valEl) valEl.textContent = parseFloat(e.target.value).toFixed(1);
      scheduleServerPreview();
    });
    bindOnce(cachedEl('mix-master-ceiling'), 'input', e => {
      const valEl = cachedEl('mix-master-ceiling-val');
      if (valEl) valEl.textContent = parseFloat(e.target.value).toFixed(2);
      scheduleServerPreview();
    });

    bindOnce(cachedEl('mix-normalize'), 'change', scheduleServerPreview, 'mixer-normalize');
    bindOnce(cachedEl('mixerSubmitBtn'), 'click', submitMix, 'mixer-submit');
    bindOnce(cachedEl('mxrAiSuggestBtn'), 'click', requestAiSuggestions, 'mixer-ai-suggest');
    bindOnce(cachedEl('mxrRefreshLibraryBtn'), 'click', () => refreshStemLibrary(true), 'mixer-refresh-library');
    const sidePanel = cachedEl('mixerSidePanel');
    bindOnce(sidePanel, 'click', (event) => {
      const addBtn = event.target.closest('.mxr-library-add');
      if (addBtn) {
        const item = mixerState.stemLibrary.find(x => x.id === addBtn.dataset.libraryId);
        if (item) addStemFromLibrary(item);
        return;
      }
      const delBtn = event.target.closest('.mxr-library-del');
      if (delBtn) {
        const item = mixerState.stemLibrary.find(x => x.id === delBtn.dataset.libraryId);
        if (item) deleteStemFromLibrary(item);
      }
    }, 'mixer-library-actions');
    bindOnce(cachedEl('mxrServerPreviewToggle'), 'change', e => {
      serverPreview.enabled = e.target.checked;
      const audioEl = cachedEl('mxrServerPreviewAudio');
      if (audioEl) audioEl.style.display = serverPreview.enabled ? 'block' : 'none';
      if (serverPreview.enabled) runServerPreview();
      else { setServerPreviewStatus(''); if (serverPreview.ws) { try { serverPreview.ws.close(); } catch (e2) {} } }
    }, 'mixer-server-preview-toggle');
  }

  // ── Confirmation modal (FIX C) ─────────────────────────────────────────────
  let _mixerClearModal = null;
  function confirmClearStems() {
    if (_mixerClearModal && document.body.contains(_mixerClearModal)) {
      LG.ui.openModal({
        modalEl: _mixerClearModal,
        openerEl: document.getElementById('mixerClearBtn') || document.activeElement,
        closeOnBackdrop: true,
        trapFocus: true,
        closeOnEscape: true,
      });
      return;
    }
    const overlay = document.createElement('div');
    overlay.id = 'mixerClearConfirm';
    overlay.className = 'lgmdm-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Confirmar limpieza de stems');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:var(--z-modal,12000);background:rgba(8,11,20,0.78);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:1rem;box-sizing:border-box;';
    overlay.innerHTML = `
      <div class="lgmdm-modal-panel" style="background:var(--ui-surface-2,#13192a);border:1px solid var(--ui-border,#2a3147);border-radius:var(--radius,10px);padding:1.2rem 1.4rem;max-width:380px;width:100%;color:var(--ui-text,#f4f7ff);font-family:var(--sans);box-shadow:0 12px 40px rgba(0,0,0,0.55);">
        <h2 style="margin:0 0 0.6rem;font-size:1rem;color:var(--ui-warn,#ffbd4a);">Limpiar todos los stems</h2>
        <p style="margin:0 0 1rem;font-size:0.85rem;line-height:1.45;color:var(--ui-muted,#9ba6c4);">¿Seguro que querés eliminar todos los stems cargados del mixer? Esta acción no se puede deshacer.</p>
        <div style="display:flex;gap:.5rem;justify-content:flex-end;">
          <button type="button" data-role="cancel" style="padding:.55rem 1rem;border-radius:var(--radius,8px);border:1px solid var(--ui-border,#2a3147);background:transparent;color:var(--ui-text,#f4f7ff);font-weight:600;cursor:pointer;">Cancelar</button>
          <button type="button" data-role="confirm" autofocus style="padding:.55rem 1rem;border-radius:var(--radius,8px);border:1px solid var(--ui-danger,#ff4264);background:var(--ui-danger,#ff4264);color:#fff;font-weight:700;cursor:pointer;">Sí, limpiar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    _mixerClearModal = overlay;
    overlay.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-role="cancel"]')) {
        LG.ui.closeModal(overlay);
        return;
      }
      if (ev.target.closest('[data-role="confirm"]')) {
        resetPreviewEngine();
        mixerState.stems = {}; mixerState.sessionId = getGenUUID(); renderMixer();
        LG.ui.closeModal(overlay);
      }
    });
    LG.ui.openModal({
      modalEl: overlay,
      openerEl: document.getElementById('mixerClearBtn') || document.activeElement,
      closeOnBackdrop: true,
      trapFocus: true,
      closeOnEscape: true,
    });
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function bindMixerEvents() {
    const area = getMixerContentArea();
    if (!area || area._mixerBound) return;
    area._mixerBound = true;

    area.addEventListener('click', e => {
      if (e.target.closest('#mixerAddStemBtn') || e.target.closest('#mxrDropBtn')) {
        cachedEl('mixerFileInput')?.click(); return;
      }
      if (e.target.closest('#mixerAddMultiBtn')) {
        cachedEl('mixerMultiInput')?.click(); return;
      }
      if (e.target.closest('#mixerLibraryBtn') || e.target.closest('#mxrEmptyLibraryBtn')) {
        refreshStemLibrary(true); return;
      }
      if (e.target.closest('#mixerClearBtn')) {
        if (!Object.keys(mixerState.stems).length) {
          resetPreviewEngine();
          mixerState.stems = {}; mixerState.sessionId = getGenUUID(); renderMixer();
        } else {
          confirmClearStems();
        }
        return;
      }
      if (e.target.closest('#mxrPlayBtn')) { togglePreview(); return; }

      // Botón reset dentro del canal
      const resetBtn = e.target.closest('[data-action="reset"]');
      if (resetBtn) {
        const name = resetBtn.dataset.stem;
        if (name && mixerState.stems[name]) {
          resetStemParams(name);
        }
        return;
      }
    });

    bindOnce(document, 'change', e => {
      if (e.target.id === 'mixerFileInput') {
        if (e.target.files[0]) handleStemFile(e.target.files[0]);
        e.target.value = '';
      }
      if (e.target.id === 'mixerMultiInput') {
        Array.from(e.target.files).forEach(f => handleStemFile(f));
        e.target.value = '';
      }
    });

    bindOnce(area, 'dragover', e => {
      e.preventDefault();
      const stage = document.getElementById('mxrStage') || area;
      if (stage) stage.classList.add('mxr-drag');
    });
    bindOnce(area, 'dragleave', e => {
      if (!area.contains(e.relatedTarget)) {
        const stage = document.getElementById('mxrStage') || area;
        if (stage) stage.classList.remove('mxr-drag');
      }
    });
    bindOnce(area, 'drop', e => {
      e.preventDefault();
      const stage = document.getElementById('mxrStage') || area;
      if (stage) stage.classList.remove('mxr-drag');
      Array.from(e.dataTransfer.files).forEach(f => handleStemFile(f));
    });

    bindOnce(area, 'input', onChannelInput, 'mixer-channel-input');
    bindOnce(area, 'change', onChannelChange, 'mixer-channel-change');
    bindOnce(area, 'click', onChannelClick, 'mixer-channel-click');
  }

  // ── Reset de parámetros de un canal ──────────────────────────────────────
  function resetStemParams(name) {
    if (!mixerState.stems[name]) return;
    const defaultParams = defaultStemParams(name);
    const current = mixerState.stems[name];
    current.params = defaultParams;

    // Actualizar la UI del canal
    const chEl = document.getElementById(`ch-${CSS.escape(name)}`);
    if (chEl) {
      // Reemplazar el contenido del canal con el nuevo renderizado
      const newCh = renderChannel(name);
      chEl.replaceWith(newCh);
      // Reinicializar faders y eventos en el área
      const area = getMixerContentArea();
      if (area) initFaderDrags(area);
      // Actualizar el side panel y el preview
      renderMixerSidePanel();
      if (previewEngine.nodes[name]) applyStemParamsToChain(name);
      scheduleServerPreview();
    }
  }

  // Pide a /mix/ai-suggest parámetros sugeridos para los stems ya subidos
  // (uploaded:true) y los aplica al estado + UI de cada canal, reusando el
  async function requestAiSuggestions() {
    const btn = cachedEl('mxrAiSuggestBtn');
    const names = Object.keys(mixerState.stems).filter(n => mixerState.stems[n].uploaded);
    if (!names.length) {
      setServerPreviewStatus('Subí al menos un stem antes de pedir sugerencias.');
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Analizando…'; }
    try {
      const fd = new FormData();
      fd.append('session_id', mixerState.sessionId);
      fd.append('stem_names', JSON.stringify(names));
      const res = await LGMDM.api.apiFetch('/mix/ai-suggest', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Error ${res.status}`);
      }
      const data = await res.json();
      const suggestions = data.suggestions || {};
      const area = getMixerContentArea();
      Object.keys(suggestions).forEach(name => {
        const stem = mixerState.stems[name];
        if (!stem) return;
        const { reasoning, ...values } = suggestions[name];
        stem.params = { ...stem.params, ...values };
        const chEl = document.getElementById(`ch-${CSS.escape(name)}`);
        if (chEl) {
          chEl.replaceWith(renderChannel(name));
        }
        if (previewEngine.nodes[name]) applyStemParamsToChain(name);
      });
      if (area) initFaderDrags(area);
      renderMixerSidePanel();
      scheduleServerPreview();
      setServerPreviewStatus(`Sugerencias de IA aplicadas a ${Object.keys(suggestions).length} stem(s).`);
    } catch (e) {
      setServerPreviewStatus(`Error pidiendo sugerencias: ${e.message}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Sugerir con IA'; }
    }
  }

  function onChannelInput(e) {
    const el = e.target;
    if (el.id === 'mxrSeek') { seekPreview(parseFloat(el.value) || 0); return; }
    const stemName = el.dataset.stem, param = el.dataset.param;
    if (!stemName || !param) return;
    const p = mixerState.stems[stemName]?.params;
    if (!p) return;
    const val = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
    p[param] = val;
    const valEl = document.getElementById(`ch-${paramToValId(param)}-val-${stemName}`);
    if (valEl) valEl.textContent = formatParamValue(param, val);
    if (previewEngine.nodes[stemName]) applyStemParamsToChain(stemName);
    scheduleServerPreview();
  }

  function onChannelChange(e) {
    const el = e.target;
    const stemName = el.dataset.stem, param = el.dataset.param;
    if (!stemName || !param || el.tagName !== 'SELECT') return;
    const p = mixerState.stems[stemName]?.params;
    if (p) p[param] = el.value || null;
    scheduleServerPreview();
  }

  function onChannelClick(e) {
    const close = e.target.closest('.mxr-ch-close');
    if (close) {
      const n = close.dataset.stem;
      removeStemFromPreview(n);
      delete mixerState.stems[n];
      removeChannelFromDOM(n);
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (btn && btn.dataset.action !== 'reset') { // reset se maneja aparte
      const name = btn.dataset.stem, action = btn.dataset.action;
      const p = mixerState.stems[name]?.params;
      if (!p) return;
      if (action === 'mute') {
        p.mute = !p.mute;
        btn.classList.toggle('active-mute', p.mute);
        document.getElementById(`ch-${CSS.escape(name)}`)?.classList.toggle('mxr-ch--muted', p.mute);
      }
      if (action === 'solo') {
        p.solo = !p.solo;
        btn.classList.toggle('active-solo', p.solo);
        document.getElementById(`ch-${CSS.escape(name)}`)?.classList.toggle('mxr-ch--solo', p.solo);
      }
      updateAllMuteSolo();
    }
  }

  function paramToValId(param) {
    const eqMatch = param.match(/^eq_(low|lomid|himid|high)_(freq|q|gain_db)$/);
    if (eqMatch) {
      const band = eqMatch[1], metric = eqMatch[2];
      return metric === 'gain_db' ? `eq-${band}-gain` : `eq-${band}-${metric}`;
    }
    const map = {
      gain_db:'gain',pan:'pan',hp_cutoff_hz:'hp',lp_cutoff_hz:'lp',
      comp_threshold:'comp-thr',comp_ratio:'comp-ratio',
      comp_attack_ms:'comp-atk',comp_release_ms:'comp-rel',comp_makeup_db:'comp-mkp',
      transient_attack:'tr-atk',transient_sustain:'tr-sus',
      stereo_width_amount:'sw',sidechain_threshold:'sc-thr',sidechain_ratio:'sc-ratio',
      sidechain_attack_ms:'sc-atk',sidechain_release_ms:'sc-rel',
      reverb_wet_amount:'reverb-wet',reverb_pre_delay_ms:'reverb-predelay',reverb_room_size:'reverb-roomsize',
      pitch_correction_glide_ms:'pitch-glide',
      master_limiter_ceiling:'master-ceiling',
    };
    return map[param] || param.replace(/_/g,'-');
  }

  function formatParamValue(param, val) {
    if (param==='pan') { if (Math.abs(val)<0.02) return 'C'; return (val>0?'R':'L')+Math.abs(val*100|0); }
    if (param.includes('gain_db')||param.includes('makeup_db')) return formatDbValue(val);
    if (param.includes('threshold')) return formatLinearThresholdToDb(val);
    if (param.includes('ratio')) return val+':1';
    if (param.includes('_ms')) return val+' ms';
    if (param.includes('reverb_wet_amount')) return `${(val*100).toFixed(0)}%`;
    if (param.includes('_hz')||param.includes('_freq')) return val>=1000?(val/1000).toFixed(1)+' kHz':val+' Hz';
    return parseFloat(val).toFixed(2);
  }

  // ── Upload ────────────────────────────────────────────────────────────────
  async function handleStemFile(file) {
    if (!/\.(wav|mp3|flac|ogg|aiff|aif)$/i.test(file.name)) { alert(`Formato no soportado: ${file.name}`); return; }
    const maxMb = window.LGMDM?.config?.maxFileMb ?? 200;
    if (file.size > maxMb * 1024 * 1024) { alert(`${file.name} supera ${maxMb}MB.`); return; }
    const stemName = file.name.replace(/\.[^.]+$/,'');
    if (mixerState.stems[stemName] && !confirm(`Ya existe "${stemName}". ¿Reemplazar?`)) return;
    mixerState.stems[stemName] = { file, params: defaultStemParams(stemName), uploaded: false, duration: null };
    addChannelToDOM(stemName);
    decodeStemForPreview(stemName, file);
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('session_id', mixerState.sessionId); fd.append('stem_name', stemName); fd.append('save_to_library', 'true');
      const res = await LGMDM.api.apiFetch('/mix/upload-stem', { method:'POST', body:fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      mixerState.stems[stemName].uploaded = true;
      mixerState.stems[stemName].duration = data.duration_sec;
      if (data.library_item) {
        mixerState.stems[stemName].libraryId = data.library_item.id;
        mixerState.stemLibraryLoaded = false;
        refreshStemLibrary(true);
      }
      const uploadEl = document.querySelector(`#ch-${CSS.escape(stemName)} .mxr-ch-uploading`);
      if (uploadEl) uploadEl.style.display = 'none';
      renderMixerSidePanel();
      const submitBtn = cachedEl('mixerSubmitBtn');
      if (submitBtn) submitBtn.removeAttribute('disabled');
      scheduleServerPreview();
    } catch(err) {
      const el = document.querySelector(`#ch-${CSS.escape(stemName)} .mxr-ch-uploading`);
      if (el) el.textContent = 'Error al subir';
    }
  }

  // ── Submit & poll ──────────────────────────────────────────────────────────
  async function submitMix() {
    const stemNames = Object.keys(mixerState.stems);
    if (!stemNames.length) return;
    const notUp = stemNames.filter(n => !mixerState.stems[n].uploaded);
    if (notUp.length) { alert(`Esperá que terminen: ${notUp.join(', ')}`); return; }

    const statusEl = cachedEl('mixerStatus');
    const btn = cachedEl('mixerSubmitBtn');
    btn.disabled = true;
    statusEl.textContent = '⏳ Iniciando mezcla…';

    const stemParams = {};
    for (const n of stemNames) stemParams[n] = mixerState.stems[n].params;

    const mixParams = {
      master_gain_db: parseFloat(cachedEl('mix-master-gain')?.value || 0),
      target_lufs:    parseFloat(cachedEl('mix-lufs')?.value || -14),
      normalize_before_master: cachedEl('mix-normalize')?.checked ?? true,
      master_limiter_ceiling: parseFloat(cachedEl('mix-master-ceiling')?.value || 0.95),
      chain_params: {},
    };

    try {
      const fd = new FormData();
      fd.append('session_id', mixerState.sessionId);
      fd.append('stem_names',  JSON.stringify(stemNames));
      fd.append('stem_params', JSON.stringify(stemParams));
      fd.append('mix_params',  JSON.stringify(mixParams));
      fd.append('stem_library_ids', JSON.stringify(buildStemLibraryIdMap(stemNames)));

      const res = await LGMDM.api.apiFetch('/mix/submit', { method: 'POST', body: fd });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || `Error del servidor (${res.status})`);
      }

      const data = await res.json();
      const jobId = data.job_id || data.jobId;

      if (!jobId) throw new Error('El servidor no devolvió un ID de trabajo válido.');

      mixerState.jobId = jobId;
      statusEl.textContent = 'Job iniciado…';
      pollMixJob(jobId, btn, statusEl);

    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      btn.disabled = false;
    }
  }

  async function pollMixJob(jobId, btn, statusEl) {
    if (mixerState.polling) {
      clearTimeout(mixerState.polling);
      mixerState.polling = null;
    }
    let mixPollFailures = 0;

    const pollOnce = async () => {
      try {
        const res = await LGMDM.api.apiFetch(`/job/${jobId}`);
        mixPollFailures = 0;
        if (!res.ok) throw new Error(`Error en el servidor al consultar trabajo (${res.status})`);
        const data = await res.json();
        const stageText = data.stage || data.status || 'Procesando';
        const progressText = data.progress != null ? `${data.progress}%` : '';
        statusEl.textContent = `${stageText} ${progressText}`.trim();

        if (data.status === 'done' || data.status === 'completed') {
          mixerState.polling = null;
          btn.disabled = false;
          onMixDone(jobId, data);
          return;
        }
        if (data.status === 'error' || data.status === 'failed') {
          mixerState.polling = null;
          btn.disabled = false;
          statusEl.textContent = `Error: ${data.error || 'Proceso fallido'}`;
          return;
        }
      } catch (err) {
        console.warn('Error durante polling del job:', err);
        mixPollFailures = (mixPollFailures || 0) + 1;
        if (mixPollFailures >= 5) {
          mixerState.polling = null;
          btn.disabled = false;
          console.debug("Polling de mix abortado tras 5 fallos");
          return;
        }
      }
      mixerState.polling = setTimeout(pollOnce, 1500);
    };

    await pollOnce();
  }

  function onMixDone(jobId, data) {
    const statusEl = cachedEl('mixerStatus');
    if (!statusEl) return;
    const result = data?.result || {};
    const lufs = LG.ui.escapeHtml(String(result.lufs ?? '--'));
    const peak = LG.ui.escapeHtml(String(result.peak_db ?? '--'));
    statusEl.innerHTML = `Mix listo — LUFS: <b>${lufs}</b> | Peak: <b>${peak} dBFS</b><br>
      <button type="button" id="mixerDownloadBtn" class="lgjs-s-88d001b8">Descargar mix</button>`;
    bindOnce(cachedEl('mixerDownloadBtn'), 'click', async (ev) => {
      const btn = ev.currentTarget;
      try { btn.disabled = true; await LGMDM.api.downloadAuthenticated(`${LGMDM.api.apiBase()}/download/${encodeURIComponent(jobId)}`, { filename: 'mix.wav' }); }
      catch (e) { handleClientError?.(e, 'No se pudo descargar el mix.', { context: 'mix-download' }); }
      finally { btn.disabled = false; }
    });
    if (result.stem_meters) {
      for (const [name, m] of Object.entries(result.stem_meters)) {
        ['l','r'].forEach(ch => {
          const fill = document.getElementById(`mxr-vu-fill-${ch}-${name}`);
          if (fill && m.peak_db != null) {
            const pct = Math.max(0, Math.min(100, (m.peak_db + 60) / 60 * 100));
            fill.style.height = pct + '%';
            fill.style.background = m.peak_db > -3 ? 'var(--ui-danger)' : m.peak_db > -12 ? 'var(--ui-warn)' : 'var(--ui-good)';
          }
        });
      }
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  let initialized = false;
  function init() {
    if (initialized) return;
    initialized = true;
    initTemplates();

    const tabs = document.getElementById('sidebarTabs');
    if (tabs && !document.querySelector('[data-pane="pane-mixer"]')) {
      const tab = document.createElement('button');
      tab.className = 'sidebar-tab';
      tab.dataset.pane = 'pane-mixer';
      tab.textContent = 'Mixer';
      tabs.appendChild(tab);
    }

    const container = document.getElementById('sidebarPaneContainer');
    if (container && !document.getElementById('pasoMixer')) {
      const pane = document.createElement('div');
      pane.className = 'sidebar-pane-mixer';
      pane.id = 'pasoMixer';
      const div = document.createElement('div');
      div.id = 'mixerSidePanel';
      div.className = 'mxr-side-panel';
      pane.appendChild(div);
      container.querySelector('.control-stack')?.appendChild(pane);
    }

    const contentShell = document.querySelector('.content-shell');
    if (contentShell && !document.getElementById('mixerContentArea')) {
      const area = document.createElement('div');
      area.id = 'mixerContentArea';
      area.className = 'mxr-content-area';
      area.style.display = 'none';
      contentShell.appendChild(area);
    }

    document.querySelectorAll('#sidebarTabs .sidebar-tab').forEach(tab => {
      if (tab.dataset.pane === 'pane-mixer') {
        bindOnce(tab, 'click', activateMixerMode, 'mixer-tab-activate');
      } else {
        bindOnce(tab, 'click', deactivateMixerMode, 'mixer-tab-deactivate');
      }
    });

  }

  function activateMixerMode() {
    const mixArea = getMixerContentArea();
    const cont   = document.getElementById('sidebarPaneContainer');
    if (cont) {
      cont.className = cont.className.replace(/sidebar-showing-\w+/g,'').trim();
      cont.classList.add('sidebar-showing-mixer');
    }
    if (mixArea) {
      if (!mixArea.firstChild) renderMixer();
      bindMixerEvents();
      refreshStemLibrary(false);
    }
    document.querySelector('.content')?.classList.add('content--mixer');
    document.body.classList.add('mode-mixer');
  }

  function deactivateMixerMode() {
    document.querySelector('.content')?.classList.remove('content--mixer');
    document.body.classList.remove('mode-mixer');
    if (previewEngine.playing) stopPreview(false);
  }

  LG.mixerUI = LG.mixerUI || {};
  LG.mixerUI.activate = activateMixerMode;
  LG.mixerUI.deactivate = deactivateMixerMode;

  if (document.readyState === 'loading') {
    (LG.ui.bindOnce)(document, 'DOMContentLoaded', init, 'mixer-ui-dom-ready', { once: true });
  } else {
    init();
  }

})();
