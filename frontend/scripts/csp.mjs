#!/usr/bin/env node
// CSP production hardener — post-build step that tightens the Content-Security-Policy
// in dist/**/*.html for production. Run after `vite build`: `node scripts/csp.mjs`.
//
// What it does:
//  - Removes `http://127.0.0.1:8000 http://localhost:8000 ws://127.0.0.1:8000
//    ws://localhost:8000` from `connect-src` (dev-only origins — in production a
//    reverse proxy handles routing, so the user's browser should never connect
//    to their own localhost).
//  - Removes the duplicate `wss://masteringstudio-api.duckdns.org` entry.
//
// What it does NOT do:
//  - Does NOT remove `'unsafe-inline'` from `style-src`. The HTML uses inline
//    CSS custom properties (e.g. `style="--step-deg: -90deg"`) for the rotary
//    knob ticks, which require `'unsafe-inline'`. Removing it would break the
//    UI. This is an accepted, documented risk: CSS injection via style
//    attributes is lower-impact than script injection, and the CSP already
//    blocks inline scripts (the high-impact vector).

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');

const CSP_META_RE = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/g;

// Origins to strip from connect-src in production (dev-only).
const DEV_ORIGINS = [
  'http://127.0.0.1:8000',
  'http://127.0.0.1:8001',
  'http://localhost:8000',
  'http://localhost:8001',
  'ws://127.0.0.1:8000',
  'ws://127.0.0.1:8001',
  'ws://localhost:8000',
  'ws://localhost:8001',
];

async function* walk(dir) {
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) yield* walk(full);
    else if (entry.endsWith('.html')) yield full;
  }
}

function hardenCsp(csp) {
  let out = csp;
  // Remove dev-only origins from connect-src.
  for (const origin of DEV_ORIGINS) {
    out = out.split(origin).join('').replace(/\s{2,}/g, ' ');
  }
  // Collapse duplicate wss://masteringstudio-api.duckdns.org entries.
  const dup = 'wss://masteringstudio-api.duckdns.org';
  const firstIdx = out.indexOf(dup);
  if (firstIdx !== -1) {
    const rest = out.slice(firstIdx + dup.length);
    const cleaned = rest.split(dup).join('').replace(/\s{2,}/g, ' ');
    out = out.slice(0, firstIdx + dup.length) + cleaned;
  }
  // Clean up any doubled spaces left by removals.
  out = out.replace(/\s{2,}/g, ' ').replace(/;\s*;/g, ';').trim();
  return out;
}

async function processHtml(htmlPath) {
  let html = await readFile(htmlPath, 'utf8');
  let changed = false;
  html = html.replace(CSP_META_RE, (match, csp) => {
    const hardened = hardenCsp(csp);
    if (hardened !== csp) {
      changed = true;
      return match.replace(csp, hardened);
    }
    return match;
  });
  if (changed) {
    await writeFile(htmlPath, html, 'utf8');
    console.log(`  CSP hardened: ${htmlPath.replace(DIST, '.')}`);
  }
}

async function main() {
  console.log('CSP: hardening dist/**/*.html for production…');
  let count = 0;
  for await (const f of walk(DIST)) {
    await processHtml(f);
    count++;
  }
  if (count === 0) console.log('  no HTML files found in dist/');
  console.log(`CSP: done (${count} files scanned).`);
}

main().catch((err) => { console.error('CSP error:', err); process.exit(1); });
