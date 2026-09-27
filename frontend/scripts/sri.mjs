#!/usr/bin/env node
// SRI hash injector — post-build step that adds `integrity="sha384-..."` to
// every `<script crossorigin>` and `<link rel="stylesheet">` in dist/**/*.html.
// Run after `vite build`: `node scripts/sri.mjs`.
// Port of the contract promised by login.html's comment
// "SRI hashes added at build time by scripts/sri.mjs".

import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');

const SCRIPT_RE = /<script\s+([^>]*crossorigin[^>]*)>/g;
const LINK_RE = /<link\s+([^>]*rel="stylesheet"[^>]*)>/g;
// FIX B9: agregar modulepreload al SRI. Antes solo se cubría script y
// stylesheet. El modulepreload también carga JS (sin integrity → sin SRI).
const MODULEPRELOAD_RE = /<link\s+([^>]*rel="modulepreload"[^>]*)>/g;
const SRC_RE = /src="([^"]+)"/;
const HREF_RE = /href="([^"]+)"/;

function sha384(buf) {
  return 'sha384-' + createHash('sha384').update(buf).digest('base64');
}

async function* walk(dir) {
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) yield* walk(full);
    else if (entry.endsWith('.html')) yield full;
  }
}

async function processHtml(htmlPath) {
  let html = await readFile(htmlPath, 'utf8');
  let changed = false;

  const inject = async (match, attrs, refRe, baseDir) => {
    const refMatch = attrs.match(refRe);
    if (!refMatch) return match;
    const relPath = refMatch[1];
    if (/^https?:\/\//i.test(relPath) || relPath.startsWith('data:')) return match;
    const absPath = resolve(baseDir, relPath);
    try {
      const buf = await readFile(absPath);
      const integrity = sha384(buf);
      if (attrs.includes('integrity=')) return match; // already has it
      changed = true;
      return match.replace(/>$/, ` integrity="${integrity}">`);
    } catch {
      return match; // asset not found — skip
    }
  };

  const baseDir = dirname(htmlPath);
  // FIX K1: String.replace(regex, asyncReplacer) coerces the Promise to
  // "[object Promise]" — which is exactly what was destroying the <script>
  // tags in dist/. Use the same manual-loop pattern we already use for the
  // <link> tags below: matchAll + await in a for-loop.
  const scriptMatches = [...html.matchAll(SCRIPT_RE)];
  for (const m of scriptMatches) {
    const attrs = m[1];
    const newTag = await inject(m[0], attrs, SRC_RE, baseDir);
    if (newTag !== m[0]) {
      html = html.replace(m[0], newTag);
      changed = true;
    }
  }
  const linkMatches = [...html.matchAll(LINK_RE)];
  for (const m of linkMatches) {
    const attrs = m[1];
    const hrefMatch = attrs.match(HREF_RE);
    if (!hrefMatch) continue;
    const relPath = hrefMatch[1];
    if (/^https?:\/\//i.test(relPath) || relPath.startsWith('data:')) continue;
    const absPath = resolve(baseDir, relPath);
    try {
      const buf = await readFile(absPath);
      const integrity = sha384(buf);
      if (attrs.includes('integrity=')) continue;
      const newTag = m[0].replace(/>$/, ` integrity="${integrity}">`);
      html = html.replace(m[0], newTag);
      changed = true;
    } catch { /* skip */ }
  }
  // FIX B9: loop para modulepreload (mismo patrón que link stylesheet).
  const modulepreloadMatches = [...html.matchAll(MODULEPRELOAD_RE)];
  for (const m of modulepreloadMatches) {
    const attrs = m[1];
    const hrefMatch = attrs.match(HREF_RE);
    if (!hrefMatch) continue;
    const relPath = hrefMatch[1];
    if (/^https?:\/\//i.test(relPath) || relPath.startsWith('data:')) continue;
    const absPath = resolve(baseDir, relPath);
    try {
      const buf = await readFile(absPath);
      const integrity = sha384(buf);
      if (attrs.includes('integrity=')) continue;
      const newTag = m[0].replace(/>$/, ` integrity="${integrity}">`);
      html = html.replace(m[0], newTag);
      changed = true;
    } catch { /* skip */ }
  }

  if (changed) {
    await writeFile(htmlPath, html, 'utf8');
    console.log(`  SRI injected: ${htmlPath.replace(DIST, '.')}`);
  }
}

async function main() {
  console.log('SRI: scanning dist/**/*.html…');
  let count = 0;
  for await (const f of walk(DIST)) {
    await processHtml(f);
    count++;
  }
  if (count === 0) console.log('  no HTML files found in dist/');
  console.log(`SRI: done (${count} files scanned).`);
}

main().catch((err) => { console.error('SRI error:', err); process.exit(1); });
