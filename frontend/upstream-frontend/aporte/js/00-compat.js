/**
 * 00-compat.js — Browser compatibility check (LGMDM)
 * Supported: Chrome 108+, Firefox 108+, Opera 94+
 * Wall for all other browsers (Safari, IE11, Edge Legacy, etc.)
 */
(function() {
  'use strict';

  function parseBrowser(userAgent) {
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
    return null;
  }

  function hasRequiredCapabilities() {
    return (
      typeof Promise !== 'undefined' &&
      typeof fetch !== 'undefined' &&
      typeof WebSocket !== 'undefined' &&
      typeof AudioContext !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' &&
      typeof structuredClone !== 'undefined'
    );
  }

  function isSupported() {
    const browser = parseBrowser(navigator.userAgent);
    if (!browser) return hasRequiredCapabilities();
    if (browser.name === 'chrome' && browser.version >= 108) return true;
    if (browser.name === 'firefox' && browser.version >= 108) return true;
    if (browser.name === 'opera' && browser.version >= 94) return true;
    if (browser.name === 'edge' && browser.version >= 108) return true;
    if (browser.name === 'safari' && browser.version >= 16) return true;
    return hasRequiredCapabilities();
  }

  function showCompatWall() {
    const browser = parseBrowser(navigator.userAgent);
    const browserName = browser ? browser.name : 'tu navegador';
    const version = browser ? browser.version : 'desconocida';
    const wall = document.createElement('div');
    wall.className = 'compat-wall';
    wall.setAttribute('role', 'alert');
    wall.innerHTML = `
      <div class="compat-wall__content">
        <h1>Navegador no compatible</h1>
        <p>Detectamos <strong>${browserName} ${version}</strong>.</p>
        <p>LGMDM requiere versiones modernas para audio y visualización.</p>
        <p><strong>Versiones mínimas:</strong></p>
        <ul>
          <li><span>Chrome 108+</span><a href="https://google.com/chrome" target="_blank" rel="noopener">Descargar</a></li>
          <li><span>Firefox 108+</span><a href="https://firefox.com" target="_blank" rel="noopener">Descargar</a></li>
          <li><span>Opera 94+</span><a href="https://opera.com" target="_blank" rel="noopener">Descargar</a></li>
        </ul>
        <p class="compat-wall__small">Tu navegador no soporta Web Audio API, Canvas avanzado o ES2022+.</p>
      </div>
    `;
    if (document.body) {
      document.body.appendChild(wall);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(wall);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!isSupported() || !hasRequiredCapabilities()) {
      showCompatWall();
    }
  });
})();
