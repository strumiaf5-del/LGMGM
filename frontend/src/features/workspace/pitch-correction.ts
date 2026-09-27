// features/workspace/pitch-correction.ts — Pitch Correction UI modal.
//
// FIX vs aporte: tipos TS.
// FIX vs aporte: HMR-safe (`window.LGMDM.pitchCorrectionBound`).
// FIX vs aporte: AbortController para cleanup de listeners.
// FIX vs aporte: modal overlay se crea una sola vez (singleton).

interface StateShape {
  selectedFile?: File | null;
  _previewLibraryId?: string | null;
}

interface ApiShape {
  apiBase: () => string;
  apiFetch: <T>(endpoint: string, options?: RequestInit) => Promise<T>;
  // FIX K4: client.* retorna Promise<Response> real (para res.ok/.json/.blob).
  client: {
    get: (endpoint: string, options?: RequestInit) => Promise<Response>;
    post: (endpoint: string, options?: RequestInit) => Promise<Response>;
    put: (endpoint: string, options?: RequestInit) => Promise<Response>;
    patch: (endpoint: string, options?: RequestInit) => Promise<Response>;
    delete: (endpoint: string, options?: RequestInit) => Promise<Response>;
  };
  authToken?: () => string;
}

interface UiShape {
  openModal?: (opts: Record<string, unknown>) => void;
  closeModal?: (el: HTMLElement) => void;
  escapeHtml?: (s: unknown) => string;
  showToast?: (msg: string, kind: string, ms?: number) => void;
}

const OVERLAY_ID = 'pitchCorrectionOverlay';
const PC_PANEL_ID = 'pitchCorrectionPanel';
const PC_MODES = ['OFF', 'LIGHT', 'MEDIUM', 'STRONG'] as const;
type PcMode = typeof PC_MODES[number];

const lg = () => (window.LGMDM = window.LGMDM || {}) as Record<string, unknown> & {
  state?: StateShape;
  api?: ApiShape;
  ui?: UiShape;
};

function createOverlayHtml(): string {
  return `
    <div id="${OVERLAY_ID}" class="lgmdm-modal-overlay" style="display:none; position:fixed; inset:0; z-index:var(--z-modal, 12000); background:rgba(8,11,20,0.85); backdrop-filter:blur(10px); align-items:center; justify-content:center; padding:1rem; box-sizing:border-box;">
      <div id="${PC_PANEL_ID}" class="admin-box" style="width:min(520px, 94vw); max-height:88vh; overflow-y:auto; background:linear-gradient(145deg, #111625, #191c32); border:1px solid rgba(125,232,255,0.25); border-radius:18px; padding:1.5rem; box-shadow:0 24px 60px rgba(0,0,0,0.6); box-sizing:border-box; color:var(--ui-text, #f1f5f9);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.2rem; padding-bottom:0.75rem; border-bottom:1px solid rgba(255,255,255,0.08);">
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <span style="font-size:1.2rem;">🎵</span>
            <h3 style="margin:0; font-size:1.1rem; font-weight:700; color:var(--ui-text, #f1f5f9);">Pitch Correction</h3>
          </div>
          <button id="pitchCorrectionClose" type="button" aria-label="Cerrar modal" style="width:30px; height:30px; border-radius:8px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.05); color:var(--ui-muted, #94a3b8); cursor:pointer; font-size:1rem; display:flex; align-items:center; justify-content:center;">✕</button>
        </div>

        <div style="margin-bottom:1rem;">
          <label style="display:block; font-size:0.78rem; font-weight:700; color:var(--ui-muted, #94a3b8); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:0.35rem;">Audio Input</label>
          <div id="pitchCorrectionCurrentFileNotice" style="font-size:0.8rem; color:var(--ui-accent, #52f2bd); margin-bottom:0.4rem;">Pista actual en consola</div>
          <input type="file" id="pitchCorrectionFile" accept="audio/*" style="display:block; width:100%; box-sizing:border-box; font-size:0.8rem; padding:0.4rem; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--ui-text, #f1f5f9);">
          <div style="font-size:0.72rem; color:var(--ui-muted, #94a3b8); margin:0.4rem 0 0.25rem;">O seleccionar de biblioteca de stems:</div>
          <select id="pitchCorrectionLibrary" style="width:100%; box-sizing:border-box; padding:0.5rem; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--ui-text, #f1f5f9); font-size:0.82rem;">
            <option value="">— No seleccionada —</option>
          </select>
        </div>

        <div style="margin-bottom:1rem;">
          <label style="display:block; font-size:0.78rem; font-weight:700; color:var(--ui-muted, #94a3b8); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:0.35rem;">Intensidad de Corrección (Mode)</label>
          <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:0.4rem;" id="pitchModeGroup">
            ${PC_MODES.map((m) => `
              <button type="button" class="pc-mode-btn" data-mode="${m}" ${m === 'MEDIUM' ? 'data-selected="true"' : ''} style="padding:0.5rem; background:${m === 'MEDIUM' ? 'rgba(92,232,255,0.15)' : 'rgba(255,255,255,0.04)'}; border:2px solid ${m === 'MEDIUM' ? 'var(--ui-accent, #42e8ff)' : 'rgba(255,255,255,0.1)'}; border-radius:8px; color:${m === 'MEDIUM' ? '#fff' : 'var(--ui-muted, #94a3b8)'}; cursor:pointer; font-weight:700; font-size:0.78rem;">
                ${m}
              </button>
            `).join('')}
          </div>
          <div style="font-size:0.7rem; color:var(--ui-muted, #94a3b8); margin-top:0.35rem;">
            OFF=desactivado · LIGHT=±20¢ · MEDIUM=±50¢ · STRONG=±100¢
          </div>
        </div>

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

        <div style="margin-bottom:1.2rem;">
          <label style="display:block; font-size:0.78rem; font-weight:700; color:var(--ui-muted, #94a3b8); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:0.35rem;">Formato de Salida</label>
          <select id="pitchCorrectionFormat" style="width:100%; box-sizing:border-box; padding:0.5rem; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:var(--ui-text, #f1f5f9); font-size:0.82rem;">
            <option value="wav">WAV (24-bit PCM HQ)</option>
            <option value="flac">FLAC</option>
            <option value="mp3">MP3 (320kbps)</option>
          </select>
        </div>

        <button id="pitchCorrectionApply" type="button" style="width:100%; padding:0.75rem 1rem; border-radius:var(--radius); border:1px solid var(--ui-border-strong); background:var(--ui-accent); color:var(--ui-text-on-accent, #071018); font-weight:800; font-size:0.95rem; cursor:pointer;">
          ✓ Aplicar Pitch Correction
        </button>

        <div id="pitchCorrectionStatus" role="status" aria-live="polite" style="margin-top:0.8rem; font-size:0.82rem; text-align:center; min-height:1.2rem;"></div>

        <div id="pitchCorrectionProgress" style="display:none; margin-top:0.6rem;">
          <div style="height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
            <div id="pitchCorrectionProgressBar" style="width:100%; height:100%; background:linear-gradient(90deg, #42d9ff, #52f2bd); animation:pcPulse 1.2s infinite ease-in-out;"></div>
          </div>
          <div style="font-size:0.72rem; color:var(--ui-muted, #94a3b8); text-align:center; margin:0.3rem;">Procesando en servidor…</div>
        </div>
      </div>
    </div>
  `;
}

interface OverlayWithController extends HTMLElement {
  _pcAbortController?: AbortController;
}

function ensureModalMounted(): OverlayWithController {
  let overlay = document.getElementById(OVERLAY_ID) as OverlayWithController | null;
  if (!overlay) {
    const container = document.createElement('div');
    container.innerHTML = createOverlayHtml().trim();
    overlay = container.firstElementChild as OverlayWithController;
    document.body.appendChild(overlay);
    wireModalEvents(overlay);
  }
  return overlay;
}

function wireModalEvents(overlay: OverlayWithController): void {
  const ac = new AbortController();
  overlay._pcAbortController = ac;

  const closeBtn = document.getElementById('pitchCorrectionClose');
  closeBtn?.addEventListener('click', hidePitchCorrectionPanel, { signal: ac.signal });

  const modeBtns = overlay.querySelectorAll<HTMLButtonElement>('.pc-mode-btn');
  modeBtns.forEach((btnEl) => {
    btnEl.addEventListener('click', (e: Event) => {
      modeBtns.forEach((b) => {
        b.style.borderColor = 'rgba(255,255,255,0.1)';
        b.style.background = 'rgba(255,255,255,0.04)';
        b.style.color = 'var(--ui-muted, #94a3b8)';
        delete b.dataset.selected;
      });
      const target = e.currentTarget as HTMLButtonElement;
      target.style.borderColor = 'var(--ui-accent, #42e8ff)';
      target.style.background = 'rgba(92,232,255,0.15)';
      target.style.color = '#fff';
      target.dataset.selected = 'true';
    }, { signal: ac.signal });
  });

  const glideInput = document.getElementById('pitchCorrectionGlide');
  glideInput?.addEventListener('input', ((e: Event) => {
    const valEl = document.getElementById('pitchCorrectionGlideVal');
    if (valEl) valEl.textContent = `${(e.target as HTMLInputElement).value}ms`;
  }) as EventListener, { signal: ac.signal });

  const applyBtn = document.getElementById('pitchCorrectionApply');
  applyBtn?.addEventListener('click', () => { void applyPitchCorrection(); }, { signal: ac.signal });
}

function showPitchCorrectionPanel(): void {
  const overlay = ensureModalMounted();
  overlay.style.display = 'flex';

  if (!overlay.hasAttribute('role')) overlay.setAttribute('role', 'dialog');
  if (!overlay.hasAttribute('aria-modal')) overlay.setAttribute('aria-modal', 'true');

  lg().ui?.openModal?.({
    modalEl: overlay,
    openerEl: document.getElementById('btnPitchCorrection') || document.activeElement,
    closeOnBackdrop: true,
    trapFocus: true,
    closeOnEscape: true,
    onClose: () => { overlay.style.display = 'none'; },
  });

  const curFile = lg().state?.selectedFile;
  const noticeEl = document.getElementById('pitchCorrectionCurrentFileNotice');
  if (noticeEl) {
    noticeEl.textContent = curFile
      ? `Pista activa: ${curFile.name}`
      : 'Ningún archivo activo (seleccioná uno debajo o de la biblioteca)';
  }

  void loadPitchCorrectionLibrary();
}

function hidePitchCorrectionPanel(): void {
  const overlay = document.getElementById(OVERLAY_ID) as OverlayWithController | null;
  if (!overlay) return;
  if (overlay._pcAbortController) {
    overlay._pcAbortController.abort();
    overlay._pcAbortController = undefined;
  }
  lg().ui?.closeModal?.(overlay);
  overlay.style.display = 'none';
}

async function loadPitchCorrectionLibrary(): Promise<void> {
  const select = document.getElementById('pitchCorrectionLibrary') as HTMLSelectElement | null;
  if (!select) return;
  const api = lg().api;
  if (!api) return;
  try {
    const r = await api.client.get(`${api.apiBase()}/library`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json() as { files?: Array<{ id: string; original_filename?: string; filename?: string }> };
    if (Array.isArray(data.files)) {
      const esc = lg().ui?.escapeHtml || ((s: unknown) => String(s));
      select.innerHTML = '<option value="">— No seleccionada —</option>' +
        data.files.slice(0, 30).map((item) => {
          const id = esc(item.id);
          const name = esc(item.original_filename || item.filename || '');
          return `<option value="${id}">${name}</option>`;
        }).join('');
    }
  } catch (e) {
    console.warn('Librería de stems no disponible:', e);
  }
}

async function applyPitchCorrection(): Promise<void> {
  const statusEl = document.getElementById('pitchCorrectionStatus');
  const progEl = document.getElementById('pitchCorrectionProgress');
  const applyBtn = document.getElementById('pitchCorrectionApply') as HTMLButtonElement | null;

  if (statusEl) {
    statusEl.textContent = '⏳ Iniciando corrección de pitch…';
    statusEl.style.color = 'var(--ui-accent, #42e8ff)';
  }

  const pickedFile = (document.getElementById('pitchCorrectionFile') as HTMLInputElement | null)?.files?.[0];
  const file: File | null = pickedFile || (lg().state?.selectedFile ?? null);
  const libraryId = (document.getElementById('pitchCorrectionLibrary') as HTMLSelectElement | null)?.value;
  const mode = ((document.querySelector<HTMLButtonElement>('.pc-mode-btn[data-selected="true"]')?.dataset.mode) || 'MEDIUM') as PcMode;
  const scale = (document.getElementById('pitchCorrectionScale') as HTMLSelectElement | null)?.value || null;
  // FIX K10: glide_time_ms y output_format ya no se mandan (no están declarados
  // en el backend /pitch-correct → se descartaban). Los controls UI siguen
  // existiendo pero son no-ops hasta que el backend los soporte.

  if (!file && !libraryId) {
    if (statusEl) {
      statusEl.textContent = '❌ Seleccioná un archivo de audio o stem de la biblioteca';
      statusEl.style.color = 'var(--ui-danger, #ff6b81)';
    }
    return;
  }

  // FIX K10: el backend declara `mode` y `scale` como Query (mastering.py:386-387),
  // no Form. Antes se mandaban como FormData → descartados (siempre mode="auto").
  // Además `glide_time_ms` y `output_format` no están declarados → también
  // descartados. Los movemos a query / los sacamos.
  const token = lg().api?.authToken?.() || '';
  const apiBase = lg().api?.apiBase() || (window.safeApiBase?.() ?? '');
  const qp = new URLSearchParams();
  if (mode) qp.set('mode', mode);
  if (scale) qp.set('scale', scale);
  const query = qp.toString();
  const pitchUrl = `${apiBase}/pitch-correct${query ? '?' + query : ''}`;

  const formData = new FormData();
  if (file) formData.append('file', file);
  if (libraryId) formData.append('library_id', libraryId);

  try {
    if (applyBtn) applyBtn.disabled = true;
    if (progEl) progEl.style.display = 'block';

    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // CSRF header for non-safe methods
    const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content
      || (window as unknown as { _csrfToken?: string })._csrfToken;
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

    const response = await fetch(pitchUrl, {
      method: 'POST',
      headers,
      body: formData,
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

    // FIX K10 (Opción B): el backend ahora retorna
    // {"status":"processing","job_id":"...","mode":...,"scale":...}.
    // Hacemos polling a GET /pitch-correct/{job_id} hasta que esté "done",
    // entonces descargamos el .wav resultante. Antes el FE hacía
    // response.blob() sobre el POST y bajaba un JSON corrupto como .wav.
    const data = await response.json() as { status?: string; job_id?: string; mode?: string; scale?: string | null };
    const jobId = data.job_id;
    if (data.status === 'processing' && jobId) {
      if (statusEl) {
        statusEl.textContent = `⏳ Pitch correction encolada (mode=${data.mode || mode}, scale=${data.scale || scale || 'auto'}). Procesando en background...`;
        statusEl.style.color = '#4ade80';
      }
      lg().ui?.showToast?.('Pitch correction encolada, esperando resultado...', 'success', 3500);

      // Polling al endpoint de descarga. 409 = still processing (seguir),
      // 200 = done (descargar), 404/500 = error/expire (parar).
      const downloadUrl = `${apiBase}/pitch-correct/${encodeURIComponent(jobId)}`;
      let attempts = 0;
      const maxAttempts = 120;  // 120 × 2s = 4 min máximo
      const pollIntervalMs = 2000;
      let done = false;
      while (!done && attempts < maxAttempts) {
        attempts++;
        try {
          await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
          const pollRes = await fetch(downloadUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (pollRes.status === 200) {
            // Listo: descargar el .wav
            const blob = await pollRes.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `pitch_corrected_${jobId.slice(0, 8)}.wav`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            if (statusEl) {
              statusEl.textContent = `✓ Pitch correction completada. Descarga iniciada.`;
              statusEl.style.color = '#4ade80';
            }
            lg().ui?.showToast?.('Pitch correction completada ✓', 'success', 3500);
            done = true;
          } else if (pollRes.status === 409) {
            // Still processing, seguir polleando
            if (statusEl && attempts % 5 === 0) {
              statusEl.textContent = `⏳ Procesando... (${attempts * pollIntervalMs / 1000}s)`;
            }
          } else {
            // 404 (expired/not found) o 500 (error) — parar
            let errText = '';
            try {
              const errData = await pollRes.json();
              errText = errData.detail || errData.message || `HTTP ${pollRes.status}`;
            } catch (_) {
              errText = `HTTP ${pollRes.status}`;
            }
            throw new Error(errText);
          }
        } catch (pollErr) {
          throw pollErr;
        }
      }
      if (!done) {
        throw new Error('Timeout: el job no terminó en 4 minutos. El resultado puede estar listo más tarde en el servidor.');
      }
    } else if (data.status === 'processing' && !jobId) {
      // Backend viejo sin job_id (no debería pasar tras K10 Opción B, pero
      // dejamos el mensaje honesto por compatibilidad).
      if (statusEl) {
        statusEl.textContent = `⏳ Pitch correction encolada (mode=${data.mode || mode}). El backend no retornó job_id; no se puede recuperar el resultado.`;
        statusEl.style.color = '#4ade80';
      }
      lg().ui?.showToast?.('Pitch correction encolada (sin descarga disponible)', 'success', 3500);
    } else {
      if (statusEl) {
        statusEl.textContent = `✓ Respuesta: ${data.status || 'ok'}`;
        statusEl.style.color = '#4ade80';
      }
    }

  } catch (err) {
    if (statusEl) {
      statusEl.textContent = `❌ Error: ${(err as Error).message || err}`;
      statusEl.style.color = '#ff6b81';
    }
    console.debug('Pitch correction error:', err);
  } finally {
    if (applyBtn) applyBtn.disabled = false;
    if (progEl) progEl.style.display = 'none';
  }
}

// Wire botón en sidebar
function init(): void {
  const trigger = document.getElementById('btnPitchCorrection');
  if (trigger) {
    trigger.addEventListener('click', (e: Event) => {
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

// HMR idempotency
const wLGMDM = lg();
(wLGMDM as Record<string, unknown>).pitchCorrectionBound = true;

export {};
