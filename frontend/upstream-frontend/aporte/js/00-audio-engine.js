// ============================================================
// 00-audio-engine.js — único contexto Web Audio compartido
// Mixer, referencia, A/B y preview PCM usan este contexto.
// Ningún módulo hijo debe cerrar el contexto.
// ============================================================
(function (global) {
  "use strict";
  const LG = global.LGMDM = global.LGMDM || {};
  LG.state = LG.state || {};
  LG.state.audio = LG.state.audio || { context: null };

  let context = LG.state.audio.context || null;
  function getContext() {
    if (!context || context.state === 'closed') {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) throw new Error('Web Audio API no disponible en este navegador');
      context = new AC({ latencyHint: 'interactive' });
      LG.state.audio.context = context;
    }
    return context;
  }
  async function resume() {
    const ctx = getContext();
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx;
  }
  async function decode(arrayBuffer) {
    const ctx = await resume();
    return ctx.decodeAudioData(arrayBuffer.slice(0));
  }
  function createBufferSource(buffer) {
    const ctx = getContext();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    return source;
  }
  async function shutdown() {
    if (!context || context.state === 'closed') return;
    try { await context.close(); } catch (_) {}
    context = null;
    LG.state.audio.context = null;
  }

  LG.audio = Object.assign(LG.audio || {}, { getContext, resume, decode, createBufferSource, shutdown });
  global.addEventListener('beforeunload', () => { shutdown(); }, { once: true });
})(window);
