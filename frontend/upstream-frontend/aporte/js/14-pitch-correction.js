// ============================================================
// 14-pitch-correction.js — Pitch Correction UI
// Interfaz modal centrada para corrección automática de pitch
// ============================================================

(function () {
  'use strict';

  const OVERLAY_ID = 'pitchCorrectionOverlay';
  const PC_PANEL_ID = 'pitchCorrectionPanel';
  const PC_MODES = ['OFF', 'LIGHT', 'MEDIUM', 'STRONG'];
  let _escListenerWired = false;

  function createPitchCorrectionOverlay() {
    return `
      <div id="${OVERLAY_ID}" class="lgmdm-modal-overlay" style="display:none; position:fixed; inset:0; z-index:var(--z-modal, 12000); background:rgba(8,11,20,0.85); backdrop-filter:blur(10px); align-items:center; justify-content:center; padding:1rem; box-sizing:border-box;">
        <div id="${PC_PANEL_ID}" class="admin-box" style="width:min(520px, 94vw); max-height:88vh; overflow-y:auto; background:linear-gradient(145deg, #111625, #191c32); border:1px solid rgba(125,232,255,0.25); border-radius:18px; padding:1.5rem; box-shadow:0 24px 60px rgba(0,0,0,0.6); box-sizing:border-box; color:var(--ui-text, #f1f5f9);">
          
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.2rem; padding-bottom:0.75rem; border-bottom:1px solid rgba(255,255,255,0.08);">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span style="font-size:1.2rem;">🎵</span>
              <h3 style="margin:0; font-size:1.1rem; font-weight:700; color:var(--ui-text, #f1f5f9);">Pitch Correction</h3>
            </div>
            <button id="pitchCorrectionClose" type="button" aria-label="Cerrar modal" style="width:30px; height:30px; border-radius:8px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.05); color:var(--ui-muted, #94a3b8); cursor:pointer; font-size:1rem; display:flex; align-items:center; justify-content:center; transition:all 0.18s;">✕</button>
          </div>

          <!-- Input File / Library -->
          <div style="margin-bottom:1rem;">
            <label style="display:block; font-size:0.78rem; font-weight:700; color:var(--ui-muted, #94a3b8); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:0.35rem;">Audio Input</label>
            <div id="pitchCorrectionCurrentFileNotice" style="font-size:0.8rem; color:var(--ui-accent, #52f2bd); margin-bottom:0.4rem;">Pista actual en consola</div>
            <input type="file" id="pitchCorrectionFile" accept="audio/*" style="display:block; width:100%; box-sizing:border-box; font-size:0.8rem; padding:0.4rem; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--ui-text, #f1f5f9);">
            <div style="font-size:0.72rem; color:var(--ui-muted, #94a3b8); margin:0.4rem 0 0.25rem;">O seleccionar de biblioteca de stems:</div>
            <select id="pitchCorrectionLibrary" style="width:100%; box-sizing:border-box; padding:0.5rem; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--ui-text, #f1f5f9); font-size:0.82rem;">
              <option value="">— No seleccionada —</option>
            </select>
          </div>

          <!-- Mode buttons -->
          <div style="margin-bottom:1rem;">
            <label style="display:block; font-size:0.78rem; font-weight:700; color:var(--ui-muted, #94a3b8); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:0.35rem;">Intensidad de Corrección (Mode)</label>
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:0.4rem;" id="pitchModeGroup">
              ${PC_MODES.map(m => `
                <button type="button" class="pc-mode-btn" data-mode="${m}" ${m === 'MEDIUM' ? 'data-selected="true"' : ''} style="padding:0.5rem; background:${m === 'MEDIUM' ? 'rgba(92,232,255,0.15)' : 'rgba(255,255,255,0.04)'}; border:2px solid ${m === 'MEDIUM' ? 'var(--ui-accent, #42e8ff)' : 'rgba(255,255,255,0.1)'}; border-radius:8px; color:${m === 'MEDIUM' ? '#fff' : 'var(--ui-muted, #94a3b8)'}; cursor:pointer; font-weight:700; font-size:0.78rem; transition:all 0.18s;">
                  ${m}
                </button>
              `).join('')}
            </div>
            <div style="font-size:0.7rem; color:var(--ui-muted, #94a3b8); margin-top:0.35rem;">
              OFF=desactivado · LIGHT=±20¢ · MEDIUM=±50¢ · STRONG=±100¢
            </div>
          </div>

          <!-- Scale selector -->
          <div style="margin-bottom:1rem;">
            <label style="display:block; font-size:0.78rem; font-weight:700; color:var(--ui-muted, #94a3b8); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:0.35rem;">Escala / Tonalidad</label>
            <select id="pitchCorrectionScale" style="width:100%; box-sizing:border-box; padding:0.5rem; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--ui-text, #f1f5f9); font-size:0.82rem;">
              <option value="">— Auto-detect —</option>
              <option value="C_major">C Major</option>
              <option value="G_major">G Major</option>
              <option value="D_major">D Major</option>
              <option value="A_major">A Major</option>
              <option value="E_major">E Major</option>
              <option value="F_major">F Major</option>
              <option value="A_minor">A Minor</option>
              <option value="E_minor">E Minor</option>
              <option value="D_minor">D Minor</option>
            </select>
          </div>

          <!-- Glide range -->
          <div style="margin-bottom:1rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
              <label style="font-size:0.78rem; font-weight:700; color:var(--ui-muted, #94a3b8); text-transform:uppercase; letter-spacing:0.06em;">Glide Time</label>
              <span id="pitchCorrectionGlideVal" style="font-size:0.8rem; font-weight:700; color:var(--ui-accent, #42e8ff);">50ms</span>
            </div>
            <input type="range" id="pitchCorrectionGlide" min="0" max="200" value="50" style="width:100%;">
            <div style="display:flex; justify-content:space-between; font-size:0.68rem; color:var(--ui-muted, #94a3b8); margin-top:0.2rem;">
              <span>0ms (rápido)</span>
              <span>200ms (suave)</span>
            </div>
          </div>

          <!-- Format -->
          <div style="margin-bottom:1.2rem;">
            <label style="display:block; font-size:0.78rem; font-weight:700; color:var(--ui-muted, #94a3b8); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:0.35rem;">Formato de Salida</label>
            <select id="pitchCorrectionFormat" style="width:100%; box-sizing:border-box; padding:0.5rem; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--ui-text, #f1f5f9); font-size:0.82rem;">
              <option value="wav">WAV (24-bit PCM HQ)</option>
              <option value="flac">FLAC</option>
              <option value="mp3">MP3 (320kbps)</option>
            </select>
          </div>

          <!-- Action Button -->
          <button id="pitchCorrectionApply" type="button" style="width:100%; padding:0.75rem 1rem; border-radius:var(--radius); border:1px solid var(--ui-border-strong); background:var(--ui-accent); color:var(--ui-text-on-accent, #071018); font-weight:800; font-size:0.95rem; cursor:pointer; box-shadow:var(--shadow-sm); transition:transform 0.18s ease, box-shadow 0.18s ease;">
            ✓ Aplicar Pitch Correction
          </button>

          <!-- Status & Progress -->
          <div id="pitchCorrectionStatus" role="status" aria-live="polite" style="margin-top:0.8rem; font-size:0.82rem; text-align:center; min-height:1.2rem;"></div>

          <div id="pitchCorrectionProgress" style="display:none; margin-top:0.6rem;">
            <div style="height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
              <div id="pitchCorrectionProgressBar" style="width:100%; height:100%; background:linear-gradient(90deg, #42d9ff, #52f2bd); animation:pcPulse 1.2s infinite ease-in-out;"></div>
            </div>
            <div style="font-size:0.72rem; color:var(--ui-muted, #94a3b8); text-align:center; margin-top:0.3rem;">Procesando en servidor…</div>
          </div>
        </div>
      </div>
    `;
  }

  function ensureModalMounted() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      const container = document.createElement('div');
      container.innerHTML = createPitchCorrectionOverlay();
      overlay = container.firstElementChild;
      document.body.appendChild(overlay);
      wireModalEvents(overlay);
    }
    return overlay;
  }

  function wireModalEvents(overlay) {
    const ac = overlay._pcAbortController = new AbortController();
    const closeBtn = document.getElementById('pitchCorrectionClose');
    closeBtn?.addEventListener('click', hidePitchCorrectionPanel, { signal: ac.signal });

    const modeBtns = overlay.querySelectorAll('.pc-mode-btn');
    modeBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        modeBtns.forEach(b => {
          b.style.borderColor = 'rgba(255,255,255,0.1)';
          b.style.background = 'rgba(255,255,255,0.04)';
          b.style.color = 'var(--ui-muted, #94a3b8)';
          delete b.dataset.selected;
        });
        const target = e.currentTarget;
        target.style.borderColor = 'var(--ui-accent, #42e8ff)';
        target.style.background = 'rgba(92,232,255,0.15)';
        target.style.color = '#fff';
        target.dataset.selected = 'true';
      }, { signal: ac.signal });
    });

    const glideInput = document.getElementById('pitchCorrectionGlide');
    glideInput?.addEventListener('input', (e) => {
      const valEl = document.getElementById('pitchCorrectionGlideVal');
      if (valEl) valEl.textContent = `${e.target.value}ms`;
    }, { signal: ac.signal });

    const applyBtn = document.getElementById('pitchCorrectionApply');
    applyBtn?.addEventListener('click', applyPitchCorrection, { signal: ac.signal });
  }

  function showPitchCorrectionPanel() {
    const overlay = ensureModalMounted();
    overlay.style.display = 'flex';

    if (!overlay.hasAttribute('role')) overlay.setAttribute('role', 'dialog');
    if (!overlay.hasAttribute('aria-modal')) overlay.setAttribute('aria-modal', 'true');

    window.LGMDM.ui.openModal({
      modalEl: overlay,
      openerEl: document.getElementById('btnPitchCorrection') || document.activeElement,
      closeOnBackdrop: true,
      trapFocus: true,
      closeOnEscape: true,
      onClose: () => { overlay.style.display = 'none'; },
    });

    // Actualizar pista activa detectada
    const curFile = window.LGMDM?.state?.selectedFile;
    const noticeEl = document.getElementById('pitchCorrectionCurrentFileNotice');
    if (noticeEl) {
      noticeEl.textContent = curFile
        ? `Pista activa: ${curFile.name}`
        : 'Ningún archivo activo (seleccioná uno debajo o de la biblioteca)';
    }

    loadPitchCorrectionLibrary();
  }

  function hidePitchCorrectionPanel() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    if (overlay._pcAbortController) {
      overlay._pcAbortController.abort();
      overlay._pcAbortController = null;
    }
    window.LGMDM.ui.closeModal(overlay);
    overlay.style.display = 'none';
  }

  function loadPitchCorrectionLibrary() {
    const select = document.getElementById('pitchCorrectionLibrary');
    if (!select) return;

    const apiBase = window.safeApiBase();

    LGMDM.api.apiFetch(`${apiBase}/library`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (Array.isArray(data.files)) {
          select.innerHTML = '<option value="">— No seleccionada —</option>' +
            data.files.slice(0, 30).map(item => {
              const id = window.LGMDM.ui.escapeHtml(item.id);
              const name = window.LGMDM.ui.escapeHtml(item.original_filename || item.filename || '');
              return `<option value="${id}">${name}</option>`;
            }).join('');
        }
      })
      .catch(e => console.warn('Librería de stems no disponible:', e));
  }

  async function applyPitchCorrection() {
    const statusEl = document.getElementById('pitchCorrectionStatus');
    const progEl = document.getElementById('pitchCorrectionProgress');
    const applyBtn = document.getElementById('pitchCorrectionApply');

    if (statusEl) {
      statusEl.textContent = '⏳ Iniciando corrección de pitch…';
      statusEl.style.color = 'var(--ui-accent, #42e8ff)';
    }

    const pickedFile = document.getElementById('pitchCorrectionFile')?.files[0];
    const file = pickedFile || (window.LGMDM?.state?.selectedFile ?? null);
    const libraryId = document.getElementById('pitchCorrectionLibrary')?.value;
    const mode = document.querySelector('.pc-mode-btn[data-selected="true"]')?.dataset.mode || 'MEDIUM';
    const scale = document.getElementById('pitchCorrectionScale')?.value || null;
    const glideTime = parseFloat(document.getElementById('pitchCorrectionGlide')?.value || 50);
    const format = document.getElementById('pitchCorrectionFormat')?.value || 'wav';

    if (!file && !libraryId) {
      if (statusEl) {
        statusEl.textContent = '❌ Seleccioná un archivo de audio o stem de la biblioteca';
        statusEl.style.color = 'var(--ui-danger, #ff6b81)';
      }
      return;
    }

    const formData = new FormData();
    if (file) formData.append('file', file);
    if (libraryId) formData.append('library_id', libraryId);
    formData.append('mode', mode);
    if (scale) formData.append('scale', scale);
    formData.append('glide_time_ms', String(glideTime));
    formData.append('output_format', format);

    const token = (typeof LGMDM !== 'undefined' && LGMDM.api && typeof LGMDM.api.authToken === 'function')
      ? LGMDM.api.authToken()
      : (sessionStorage.getItem('master_auth_token') || '');
    const apiBase = window.safeApiBase();

    try {
      if (applyBtn) applyBtn.disabled = true;
      if (progEl) progEl.style.display = 'block';

      const response = await fetch(`${apiBase}/pitch-correct`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData
      });

      if (!response.ok) {
        let errText = '';
        try {
          const errData = await response.json();
          errText = errData.detail || errData.message;
        } catch (_) {
          errText = await response.text();
        }
        throw new Error(errText || `HTTP ${response.status}`);
      }

      const detectedKey = response.headers.get('X-Detected-Key') || 'Auto';
      const confidence = parseFloat(response.headers.get('X-Confidence') || '0');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pitch_corrected_${file ? (file.name || 'audio').replace(/\.[^.]+$/, '') : 'track'}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);

      if (statusEl) {
        statusEl.textContent = `✓ Completado: Tonalidad ${detectedKey} (confianza ${(confidence * 100).toFixed(0)}%)`;
        statusEl.style.color = '#4ade80';
      }
      LGMDM.ui?.showToast?.(`Pitch Correction completado (${detectedKey})`, 'success', 3500);

    } catch (err) {
      if (statusEl) {
        statusEl.textContent = `❌ Error: ${err.message || err}`;
        statusEl.style.color = '#ff6b81';
      }
      console.debug('Pitch correction error:', err);
    } finally {
      if (applyBtn) applyBtn.disabled = false;
      if (progEl) progEl.style.display = 'none';
    }
  }

  // Wire botón en sidebar
  function init() {
    const trigger = document.getElementById('btnPitchCorrection');
    if (trigger) {
      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        showPitchCorrectionPanel();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
