// core/compat.ts — Browser compatibility check.
// Port simplificado de /root/aporte/js/00-compat.js.
// Soportados: Chrome 108+, Firefox 108+, Opera 94+.
// Wall para Safari, IE11, Edge Legacy, etc. — se muestra un mensaje al usuario
// y se evita cargar el bundle si falta una capability crítica.

interface BrowserInfo {
  name: 'opera' | 'edge' | 'chrome' | 'firefox' | 'safari' | 'unknown';
  version: number;
}

// FIX M2: parseBrowser nunca retorna null (siempre retorna un objeto, línea
// 23 con name:'unknown'). El tipo `BrowserInfo | null` era mentiroso y el
// `if (!browser)` en checkBrowserCompat:50 era dead code. Cambiamos el tipo
// a `BrowserInfo` y eliminamos la rama inalcanzable.
function parseBrowser(userAgent: string): BrowserInfo {
  const operaMatch = userAgent.match(/OPR\/(\d+)/);
  if (operaMatch) return { name: 'opera', version: parseInt(operaMatch[1], 10) };
  const edgMatch = userAgent.match(/Edg(?:e|iOS)?\/(\d+)/);
  if (edgMatch) return { name: 'edge', version: parseInt(edgMatch[1], 10) };
  const chromeMatch = userAgent.match(/(?:Chrome|CriOS)\/(\d+)/);
  if (chromeMatch) return { name: 'chrome', version: parseInt(chromeMatch[1], 10) };
  const firefoxMatch = userAgent.match(/Firefox\/(\d+)/);
  if (firefoxMatch) return { name: 'firefox', version: parseInt(firefoxMatch[1], 10) };
  const safariMatch = userAgent.match(/Version\/(\d+)(?:\.\d+)*.*Safari/);
  if (safariMatch) return { name: 'safari', version: parseInt(safariMatch[1], 10) };
  return { name: 'unknown', version: 0 };
}

function hasRequiredCapabilities(): boolean {
  return (
    typeof Promise !== 'undefined' &&
    typeof fetch !== 'undefined' &&
    typeof WebSocket !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof structuredClone !== 'undefined' &&
    typeof AbortController !== 'undefined' &&
    typeof ResizeObserver !== 'undefined'
  );
}

const MIN_VERSION: Record<BrowserInfo['name'], number> = {
  opera: 94,
  edge: 0, // Edge Legacy (Chromium-based < 108) — we treat as unsupported
  chrome: 108,
  firefox: 108,
  safari: 0, // Safari no soportado (verificado por capabilities)
  unknown: 0,
};

export function checkBrowserCompat(): { supported: boolean; browser: BrowserInfo; reason?: string } {
  const browser = parseBrowser(navigator.userAgent);
  // FIX M2: la rama `if (!browser)` era dead code (parseBrowser nunca retorna null).
  if (!hasRequiredCapabilities()) {
    return { supported: false, browser, reason: 'Faltan capacidades críticas (WebSocket/AudioContext/ResizeObserver/etc.)' };
  }
  const min = MIN_VERSION[browser.name];
  if (min > 0 && browser.version < min) {
    return { supported: false, browser, reason: `${browser.name} ${browser.version} < ${min} (no soportado)` };
  }
  return { supported: true, browser };
}

function showCompatWall(reason: string): void {
  const existing = document.getElementById('lgmdm-compat-wall');
  if (existing) return;
  const wall = document.createElement('div');
  wall.id = 'lgmdm-compat-wall';
  wall.setAttribute('role', 'alert');
  wall.style.cssText = [
    'position:fixed',
    'inset:0',
    // FIX M1: había dos `z-index` (2147483647 y 9999) en el mismo cssText.
    // En CSS inline la última declaración gana → el wall quedaba con 9999,
    // que es MENOR que el z-index de los modales (2147483647) → el wall
    // podía quedar detrás de un modal. Dejamos solo el max-int.
    'z-index:2147483647',
    'background:rgba(8,11,20,0.95)',
    'color:#f1f5f9',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:2rem',
    'font-family:system-ui,sans-serif',
  ].join(';');
  wall.innerHTML = `
    <div style="max-width:480px; background:#191c32; border:1px solid rgba(125,232,255,0.25); border-radius:18px; padding:2rem; box-shadow:0 24px 60px rgba(0,0,0,0.6);">
      <h2 style="margin:0 0 0.75rem; font-size:1.25rem; color:#52f2bd;">Navegador no soportado</h2>
      <p style="margin:0 0 1rem; color:#cbd5e1;">LGMDM Studio requiere un navegador moderno.</p>
      <p style="margin:0 0 1rem; color:#94a3b8; font-size:0.85rem;">Motivo: ${reason}</p>
      <p style="margin:0 0 0.5rem; color:#cbd5e1; font-size:0.9rem;">Probá con:</p>
      <ul style="margin:0; padding-left:1.5rem; color:#cbd5e1; font-size:0.9rem;">
        <li>Chrome 108+</li>
        <li>Firefox 108+</li>
        <li>Opera 94+</li>
      </ul>
    </div>`;
  document.body.appendChild(wall);
}

// Ejecutar check al cargar el módulo
const result = checkBrowserCompat();
if (!result.supported) {
  // Diferir hasta que DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => showCompatWall(result.reason || 'unknown'), { once: true });
  } else {
    showCompatWall(result.reason || 'unknown');
  }
}
