// entrypoint for index.html — main mastering console.
import './../../css/base/reset.css';
import './../../css/base/tokens.css';
import './../../css/base/themes.css';
import './../../css/base/themes-professional.css';
import './../../css/layout/layout-shell.css';
import './../../css/layout/responsive.css';
import './../../css/components/base.css';
import './../../css/components/utilities.css';
import './../../css/components/buttons.css';
import './../../css/components/forms.css';
import './../../css/components/header.css';
import './../../css/components/sidebar.css';
import './../../css/components/lgmdm.css';
import './../../css/components/lgmdm-studio.css';
import './../../css/components/studio-pro.css';
import './../../css/components/meters.css';
import './../../css/components/panels.css';
import './../../css/components/preview.css';
import './../../css/components/content-area.css';
import './../../css/components/workflow.css';
import './../../css/components/ai-panel.css';
import './../../css/components/toast.css';
import './../../css/components/auth.css';
import './../../css/skin/themes-professional-skin.css';
import './../../css/widgets/chain-family-tabs.css';
import './../../css/widgets/pro-insert-rack.css';
import './../../css/widgets/pro-widgets-v2.css';

import { validateSession, getSession } from '../features/auth/session';
import { TOKEN_KEY, USER_KEY } from '../core/api';
import '../core/compat'; // browser compat check (wall si Chrome<108/Firefox<108/Opera<94) — must load FIRST
import '../core/state'; // mounts window.LGMDM.state (single source of truth) — must load BEFORE file-handling
import '../features/workspace/file-handling'; // fileInput → state.selectedFile + library + reference handling
import '../features/workspace/sliders-ui'; // slider live-update + multiband tabs + workflow rail (before mastering-actions)
import '../features/canvas/eq-waveform'; // EQ curve canvas (HP/LP/6 bands/shelves) + waveform + loudness meter
import '../features/workspace/mastering-actions'; // btnAnalyze/btnMaster*/btnPitch handlers (after sliders-ui + eq-waveform)
import '../features/audio/preview-controller'; // server preview (POST /preview/source, /preview, /preview/meters polling)
import '../features/workspace/meters-dashboard'; // dashboard polling + meters subscribe (lives in timeline-meters)
import '../features/audio/timeline-meters'; // real-time meters via server-side timeline pre-computed (RAF)
import '../features/workspace/lufs-normalize'; // btnNormalizeLufs → /master/normalize/sync (download)
import '../features/workspace/pitch-correction'; // btnPitchCorrection modal → /pitch-correct
import '../features/ai/assistant'; // AI panel: /ai/status, /ai/chat, /analysis request
import '../features/audio/mixer-ui'; // Mixer UI: channels, faders, EQ, library, drag&drop (requires mixer-engine)
import '../features/theme/switcher';
import '../features/ui/toast';
import '../features/presets/save'; // exposes window.saveCurrentPreset

// Workspace navigation + layout.
import '../features/workspace/tabs-handler'; // sidebar tab navigation (Ctrl+arrows)
import '../features/workspace/workspace-tabs'; // console/analysis/presets workspaces
import '../features/workspace/flex-layout'; // sidebar resize + collapse
import '../features/pro/upgrades'; // mini-metrics bar + undo manager patches
import '../features/editor/undo-redo'; // Ctrl+Z / Ctrl+H history panel

// Canvas / audio pipeline.
import '../features/audio/mixer-engine'; // exposes window.LGMDM.mixerEngine (audioTap reads masterGain)
// WS9 TODO: /ws/master-stream (routers/streaming.py:195) es backend-only — sin
// consumer frontend (verificado: grep "master-stream" frontend/src → 0 matches;
// solo aparece en API.md:169). El preview en vivo usa /preview + /preview/meters
// polling (preview-controller.ts) en lugar de este WS. No implementar consumer
// acá sin antes decidir si el endpoint se mantiene o se remueve del backend.
import '../features/canvas/visualizer-helpers'; // exposes window.LGMDM.ab (audioTap reads getGainNode) + visualizers
import '../features/canvas/master-console'; // exposes window.LGMDM.console (getChainOverrides, isPlaying)
import '../features/canvas/params-builder'; // exposes window.LGMDM.params (collect/build/renderPreview)
import '../features/canvas/chain-family-tabs'; // chain family tabstrip (INPUT/EQ/DINÁMICA/STEREO/OUTPUT)
import '../features/canvas/master-visual-suite';
import '../features/mastering/reference-mastering'; // master con referencia (POST /master/reference, WS /ws/ref-stream, AB panel, multi-ref) // visual suite + audioTap

// Analysis workspace — renders backend /analysis results. Depends on the
// renderers exposed by visualizer-helpers (renderAnalysisSingle/renderFFT).
import '../features/analysis/view'; // exposes window.LGMDM.analysis (request/render/clear/redraw/teardown) + window.requestAnalysis

// Reference library picker (R shortcut focuses #refFileInput).
import '../features/library/reference-picker'; // exposes window.LGMDM.reference.libraryPicker

// Pro suite tab wrappers (compliance/abx/codec/waterfall) — delegated to
// 34-premium-suite.js which will be ported in Fase E.
import '../features/tabs';

// Premium suite — 22 pro modules (compliance + 21 pro tabs). Exposes the 4
// tab renderers (_lgmdmRenderComplianceTab etc.) that features/tabs/ delegates to.
import '../features/pro/premium-suite';

// Pro Insert Rack — floating rack with drag-reorder for the premium DSP
// inserts. Must load BEFORE the pro widget modules (features/pro/widgets/*)
// so `window.LGMDM.proInsertRack` exists when they call `rack.create(...)`.
// Exposes `window.LGMDM.proInsertRack`
// (`create` / `remove` / `CATALOG` / `registry` / `teardown`).
import '../features/pro/insert-rack';

// Pro widgets — register on `window.LGMDM.proFeatures` (consumed by
// premium-suite.setupProFeatures) and on the proInsertRack. Must load
// AFTER `features/pro/insert-rack` so the rack CATALOG exists.
import '../features/pro/widgets/phantom-sub';
import '../features/pro/widgets/iso-compensation';
import '../features/pro/widgets/resonance-tamer';
import '../features/pro/widgets/ms-imager';
import '../features/pro/widgets/cross-demask';
import '../features/pro/widgets/loudness-penalty';
import '../features/pro/widgets/loudness-war';
import '../features/pro/widgets/multiband-transient';
import '../features/pro/widgets/phase-rotation';
import '../features/pro/widgets/saturation';
import '../features/pro/widgets/reference-match';
import '../features/pro/widgets/reverb';
import '../features/pro/widgets/dr-meter';
import '../features/pro/widgets/spectral-tilt';

// Keyboard shortcuts (only loaded on the main console).
import '../core/keyboard-shortcuts';

// WT1: ?mockauth=1 short-circuits auth for frontend-only smoke testing
// (no backend). Injects a fake session into sessionStorage before boot() so
// getSession() returns a mock user and validateSession() is skipped.
// Uso: abrí la consola con `index.html?mockauth=1` cuando el backend no está.
const _mockAuth = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mockauth') === '1') {
      sessionStorage.setItem(TOKEN_KEY, 'mock-token');
      sessionStorage.setItem(USER_KEY, JSON.stringify({ id: 'mock', email: 'mock@local', name: 'Mock', role: 'admin', status: 'approved' }));
      return true;
    }
  } catch { /* ignore */ }
  return false;
})();

async function boot(): Promise<void> {
  // WT1: skip validation in mockauth mode (session injected above).
  if (_mockAuth) return;
  const ok = await validateSession();
  if (!ok) {
    // Not authenticated — send to login. validateSession already cleared the
    // session on 401/403. On network failure, getSession() may still return a
    // cached session, so we redirect to let the login page retry validation.
    if (!getSession()) {
      window.location.replace('login.html');
      return;
    }
  }
}

void boot();
