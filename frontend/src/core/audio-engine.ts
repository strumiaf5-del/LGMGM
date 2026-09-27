// Single shared Web Audio context for the whole app.
// Mixer, reference, A/B and PCM preview all share this context.
// No child module should ever close the context — use `shutdown()` only on
// page unload.

interface AudioEngineState {
  context: AudioContext | null;
}

const state: AudioEngineState = { context: null };

function getContext(): AudioContext {
  if (!state.context || state.context.state === 'closed') {
    const AC: typeof AudioContext | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) throw new Error('Web Audio API no está disponible en este navegador.');
    state.context = new AC({ latencyHint: 'interactive' });
  }
  return state.context;
}

async function resume(): Promise<AudioContext> {
  const ctx = getContext();
  if (ctx.state === 'suspended') await ctx.resume();
  return ctx;
}

async function decode(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = await resume();
  // slice(0) prevents decodeAudioData from detaching the caller's buffer.
  return ctx.decodeAudioData(arrayBuffer.slice(0));
}

function createBufferSource(buffer: AudioBuffer): AudioBufferSourceNode {
  const ctx = getContext();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  return source;
}

async function shutdown(): Promise<void> {
  if (!state.context || state.context.state === 'closed') return;
  try { await state.context.close(); } catch { /* ignore double-close */ }
  state.context = null;
}

window.addEventListener('beforeunload', () => { void shutdown(); }, { once: true });

export const audioEngine = Object.freeze({
  getContext,
  resume,
  decode,
  createBufferSource,
  shutdown,
  get context() { return state.context; },
});
