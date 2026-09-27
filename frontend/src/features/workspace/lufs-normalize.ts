// features/workspace/lufs-normalize.ts — Normalización pura por LUFS (sin pipeline).
//
// FIX vs aporte: tipos TS.
// FIX vs aporte: HMR-safe (`window.LGMDM.lufsNormalizeBound`).
// FIX vs aporte: AbortController + cleanup.

interface StateShape {
  selectedFile?: File | null;
  _previewLibraryId?: string | null;
}

interface ApiShape {
  apiBase: () => string;
  apiFetch: <T>(endpoint: string, options?: RequestInit) => Promise<T>;
  // FIX K4: client.* retorna Promise<Response> real (para res.ok/.blob/.headers).
  client: {
    get: (endpoint: string, options?: RequestInit) => Promise<Response>;
    post: (endpoint: string, options?: RequestInit) => Promise<Response>;
    put: (endpoint: string, options?: RequestInit) => Promise<Response>;
    patch: (endpoint: string, options?: RequestInit) => Promise<Response>;
    delete: (endpoint: string, options?: RequestInit) => Promise<Response>;
  };
}

interface UiShape {
  showToast?: (msg: string, kind: string, ms?: number) => void;
}

const lg = () => (window.LGMDM = window.LGMDM || {}) as Record<string, unknown> & {
  state?: StateShape;
  api?: ApiShape;
  ui?: UiShape;
};

const btn = document.getElementById('btnNormalizeLufs') as HTMLButtonElement | null;
const statusEl = document.getElementById('normalize-status');

if (btn) {
  function setStatus(text: string, kind: string): void {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = kind === 'error'
      ? 'var(--ui-danger, #f87171)'
      : kind === 'ok'
        ? 'var(--ui-good, #34d399)'
        : 'var(--ui-muted)';
  }

  const controller = new AbortController();
  const { signal } = controller;

  btn.addEventListener('click', async () => {
    const state = lg().state;
    if (!state?.selectedFile && !state?._previewLibraryId) {
      setStatus('Seleccioná un archivo primero', 'error');
      return;
    }
    const api = lg().api;
    if (!api) {
      setStatus('Error: API no inicializada', 'error');
      return;
    }

    const targetLufs = parseFloat((document.getElementById('s-normalize-lufs') as HTMLInputElement | null)?.value || '-14');

    const fd = new FormData();
    if (state._previewLibraryId) {
      fd.append('library_id', state._previewLibraryId);
    } else if (state.selectedFile) {
      fd.append('file', state.selectedFile);
    }

    btn.disabled = true;
    setStatus('Normalizando…', 'queued');

    try {
      const params = new URLSearchParams({ loudness_target: String(targetLufs) });
      const url = `${api.apiBase()}/master/normalize/sync?${params.toString()}`;
      const res = await api.client.post(url, { body: fd });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const outputLufs = res.headers.get('X-Output-LUFS');
      const blob = await res.blob();

      const cd = res.headers.get('Content-Disposition') || '';
      const match = /filename="?([^"]+)"?/.exec(cd);
      const filename = match ? match[1] : 'normalized.wav';

      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(dlUrl), 1500);

      setStatus(`✅ Listo — quedó en ${outputLufs ?? '?'} LUFS. Descarga iniciada.`, 'ok');
    } catch (e) {
      setStatus('Error: ' + (e as Error).message, 'error');
    } finally {
      btn.disabled = false;
    }
  }, { signal });

  window.addEventListener('beforeunload', () => controller.abort(), { once: true });
}

// HMR idempotency
const wLGMDM = lg();
(wLGMDM as Record<string, unknown>).lufsNormalizeBound = true;

export {};
