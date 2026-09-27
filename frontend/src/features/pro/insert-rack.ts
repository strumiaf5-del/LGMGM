// insert-rack.ts — pro insert rack orchestrator

import { byId } from '../../core/dom';
import { apiUrl } from '../../core/api';
import { getPrefersReducedMotion } from '../../core/utils';
import {
  CATALOG,
  buildAuthHeaders,
  createInsert,
  ProInsertBase,
  type Catalog,
  type InsertSpec,
  type WidgetClass,
  type WidgetInstance,
} from './insert-base';

// ── Types ─────────────────────────────────────────────────────

/** Definición de un insert del rack (id, título, endpoint). */
export interface InsertDef {
  id: string;
  title: string;
  endpoint: string;
}

/** Resultado de un insert al correr la cadena. */
export interface ChainResult {
  id: string;
  ok: boolean;
  error?: string;
}

/** Output de `processAll` / `runChain`. */
export interface ChainOutput {
  results: ChainResult[];
  blob: Blob | null;
}

/** Estado persistido del rack en localStorage. */
interface RackPersistedState {
  order?: string[];
  bypass?: Record<string, boolean>;
  minimized?: boolean;
  hidden?: boolean;
  mode?: 'floating' | 'docked';
  position?: { left: number; top: number } | null;
}

/** Payload de un insert (blob de audio o JSON de métricas). */
type InsertPayload = Blob | Record<string, unknown> | null;

/** Slice de `window.LGMDM` que este módulo consume. */
interface LgmdmStateSlice {
  selectedFile?: File | null;
  reference?: { file?: File | null } | null;
}

interface LgmdmUiSlice {
  showToast?: (
    message: unknown,
    type?: 'error' | 'success' | 'warning' | 'info',
    duration?: number,
  ) => HTMLDivElement;
}

interface LgmdmGlobal {
  state?: LgmdmStateSlice;
  ui?: LgmdmUiSlice;
  proInsertRack?: ProInsertRackApi;
}

/** API pública expuesta en `window.LGMDM.proInsertRack`. */
export interface ProInsertRackApi {
  create: (spec: InsertSpec) => ProInsertBase | null;
  remove: (id: string) => boolean;
  CATALOG: Catalog;
  registry: Record<string, ProInsertBase>;
  teardown: () => void;
  mount: (rootEl?: HTMLElement | null) => HTMLElement | null;
  processOne: (insertId: string, file: Blob) => Promise<InsertPayload>;
  processAll: (file: Blob) => Promise<ChainOutput>;
  runChain: () => Promise<ChainOutput | null>;
  reset: () => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
  INSERTS: readonly InsertDef[];
}

// ── Helpers ───────────────────────────────────────────────────

function lgmdm(): LgmdmGlobal {
  return (window as Window & { LGMDM?: LgmdmGlobal }).LGMDM || {};
}

interface WindowWithAbPlayer {
  setupABPlayer?: (blob: Blob) => Promise<void>;
}

/** POST a un endpoint /dsp/* con FormData; devuelve blob (audio) o JSON. */
async function postDsp(
  endpoint: string,
  fd: FormData,
  signal: AbortSignal,
): Promise<Blob | Record<string, unknown>> {
  const res = await fetch(apiUrl(endpoint), {
    method: 'POST',
    body: fd,
    headers: buildAuthHeaders('POST'),
    credentials: 'include',
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json')
    ? ((await res.json()) as Record<string, unknown>)
    : await res.blob();
}

// ── Catálogo de los 10 inserts premium ────────────────────────
const INSERTS: readonly InsertDef[] = Object.freeze([
  // FIX K3: el backend monta advanced_dsp con prefix="/dsp" (advanced_dsp.py:195),
  // así que los endpoints reales son /dsp/<name>. Antes los callers pasaban
  // /<name> sin /dsp/ → 404 silenciado por el catch "DSP endpoint no disponible".
  { id: 'resonance-tamer', title: 'Reso Tamer', endpoint: '/dsp/resonance-tamer' },
  { id: 'inflator', title: 'Inflator', endpoint: '/dsp/inflator' },
  { id: 'phantom-sub', title: 'Phantom Sub', endpoint: '/dsp/phantom-sub' },
  { id: 'iso-compensation', title: 'ISO 226 Comp', endpoint: '/dsp/iso-compensation' },
  { id: 'match-eq', title: 'Match EQ', endpoint: '/dsp/match-eq' },
  { id: 'cross-demask', title: 'Cross Demask', endpoint: '/dsp/cross-demask' },
  { id: 'loudness-penalty', title: 'Loudness Penalty', endpoint: '/dsp/loudness-penalty' },
  { id: 'phase-rotation', title: 'Phase Rotation', endpoint: '/dsp/phase-rotation' },
  { id: 'spectral-tilt', title: 'Spectral Tilt', endpoint: '/dsp/spectral-tilt' },
  { id: 'dr-meter', title: 'DR Meter', endpoint: '/dsp/dr-meter' },
]);

const STATE_KEY = 'lgmdm.insert_rack.state.v1';

function loadState(): RackPersistedState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as RackPersistedState) : null;
  } catch {
    return null;
  }
}

function saveState(s: RackPersistedState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

// ── Estado del módulo ─────────────────────────────────────────
const rackController = new AbortController();
let chainObserver: MutationObserver | null = null;
let detailModalOpen = false;

/** Registry de instancias activas (mutable: widgets legacy lo asignan). */
const registry: Record<string, ProInsertBase> = {};

function findInsertDef(id: string): InsertDef | undefined {
  return INSERTS.find((i) => i.id === id);
}

// ── Card builder ──────────────────────────────────────────────
function buildCard(spec: InsertDef, isBypassed: boolean): HTMLElement {
  const card = document.createElement('article');
  card.className = 'pir-card';
  card.draggable = true;
  card.dataset.insertId = spec.id;
  card.dataset.endpoint = spec.endpoint;
  card.dataset.state = isBypassed ? 'bypassed' : 'active';
  card.tabIndex = 0;
  card.setAttribute(
    'aria-label',
    `${spec.title}. Espacio para pick-up, flechas para reordenar.`,
  );
  card.setAttribute('aria-grabbed', 'false');
  card.innerHTML = `
    <header class="pir-card-head">
      <span class="pir-drag" aria-label="Drag para reordenar">⠿</span>
      <strong class="pir-card-title">${spec.title}</strong>
      <span class="pir-led ${isBypassed ? '' : 'pir-led--active'}" data-role="led"></span>
      <button class="pir-bypass" data-role="bypass" aria-pressed="${isBypassed}" aria-label="Bypass ${spec.title}" title="Bypass" type="button">B</button>
    </header>
    <div class="pir-card-body">
      <div class="pir-card-endpoint" data-role="endpoint">${spec.endpoint}</div>
    </div>
    <footer class="pir-card-foot">
      <span class="pir-status" data-role="status">Ready</span>
      <button class="pir-btn pir-btn--mini" data-role="openDetail" aria-label="Abrir detalle de ${spec.title}" title="Abrir detalle" type="button">⤢</button>
    </footer>
  `;
  return card;
}

// ── Drag & drop reorder ───────────────────────────────────────
function wireDragAndDrop(grid: HTMLElement): void {
  let dragSrc: HTMLElement | null = null;

  grid.addEventListener(
    'dragstart',
    (e: DragEvent) => {
      try {
        const target = e.target as HTMLElement | null;
        const card = target?.closest?.('.pir-card') as HTMLElement | null;
        if (!card) return;
        dragSrc = card;
        card.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', card.dataset.insertId || '');
        }
      } catch (err) {
        console.debug('[pir] dragstart failed', err);
      }
    },
    { signal: rackController.signal },
  );

  grid.addEventListener(
    'dragend',
    () => {
      try {
        if (dragSrc) dragSrc.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
        grid.querySelectorAll('.drag-over').forEach((c) => c.classList.remove('drag-over'));
        persistFromDom();
      } catch (err) {
        console.debug('[pir] dragend failed', err);
      }
    },
    { signal: rackController.signal },
  );

  grid.addEventListener(
    'dragover',
    (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const target = e.target as HTMLElement | null;
      const over = target?.closest?.('.pir-card') as HTMLElement | null;
      if (!over || over === dragSrc) return;
      grid.querySelectorAll('.drag-over').forEach((c) => c.classList.remove('drag-over'));
      over.classList.add('drag-over');
    },
    { signal: rackController.signal },
  );

  grid.addEventListener(
    'drop',
    (e: DragEvent) => {
      e.preventDefault();
      const target = e.target as HTMLElement | null;
      const over = target?.closest?.('.pir-card') as HTMLElement | null;
      if (!over || !dragSrc || over === dragSrc) return;
      const rect = over.getBoundingClientRect();
      const after = e.clientY - rect.top > rect.height / 2;
      over.parentNode?.insertBefore(dragSrc, after ? over.nextSibling : over);
      dragSrc = null;
    },
    { signal: rackController.signal },
  );
}

// ── Keyboard reorder (Space pick-up, flechas mover, Esc soltar) ──
function wireKeyboardReorder(grid: HTMLElement): void {
  grid.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      try {
        const target = e.target as HTMLElement | null;
        const card = target?.closest?.('.pir-card') as HTMLElement | null;
        if (!card) return;
        const cards = Array.from(grid.querySelectorAll<HTMLElement>('.pir-card'));
        const idx = cards.indexOf(card);
        if (idx < 0) return;
        if (e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          if (card.dataset.kbPickedUp === '1') {
            delete card.dataset.kbPickedUp;
            card.classList.remove('dragging');
            card.setAttribute('aria-grabbed', 'false');
            persistFromDom();
          } else {
            card.dataset.kbPickedUp = '1';
            card.classList.add('dragging');
            card.setAttribute('aria-grabbed', 'true');
          }
        } else if (card.dataset.kbPickedUp === '1') {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            const next = cards[idx + 1];
            if (next) {
              grid.insertBefore(card, next.nextSibling);
              card.focus();
            }
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = cards[idx - 1];
            if (prev) {
              grid.insertBefore(card, prev);
              card.focus();
            }
          } else if (e.key === 'Escape') {
            e.preventDefault();
            delete card.dataset.kbPickedUp;
            card.classList.remove('dragging');
          }
        }
      } catch (err) {
        console.debug('[pir] keyboard reorder failed', err);
      }
    },
    { signal: rackController.signal },
  );
}

// ── Persistencia ──────────────────────────────────────────────
function persistFromDom(): void {
  const grid = byId<HTMLElement>('pirGrid');
  if (!grid) return;
  // FIX: si el rack todavía no se creó (mount() no corrió), no tiene sentido
  // persistir → el byId('proInsertRack') lanzaría el warning "[dom] #proInsertRack
  // not found" en la consola. Early-return silencioso.
  const rack = byId<HTMLElement>('proInsertRack');
  if (!rack) return;
  const cards = Array.from(grid.querySelectorAll<HTMLElement>('.pir-card'));
  const order = cards.map((c) => c.dataset.insertId || '');
  const bypass: Record<string, boolean> = {};
  cards.forEach((c) => {
    bypass[c.dataset.insertId || ''] = c.dataset.state === 'bypassed';
  });
  const minimized = rack.dataset.minimized === 'true';
  const hidden = rack.dataset.hidden === 'true';
  const mode: 'floating' | 'docked' = rack.dataset.mode === 'floating' ? 'floating' : 'docked';
  const payload: RackPersistedState = { order, bypass, minimized, hidden, mode };
  if (mode === 'floating' && rack) {
    const pos = readPosition(rack);
    if (pos) payload.position = pos;
  }
  saveState(payload);
  updateActiveCount();
}

function readPosition(rack: HTMLElement): { left: number; top: number } | null {
  const left = parseFloat(rack.style.left);
  const top = parseFloat(rack.style.top);
  if (Number.isFinite(left) && Number.isFinite(top)) return { left, top };
  return null;
}

function toggleMode(root: HTMLElement): void {
  const isFloating = root.classList.contains('pro-insert-rack--floating');
  const next: 'floating' | 'docked' = isFloating ? 'docked' : 'floating';
  root.dataset.mode = next;
  if (next === 'floating') {
    root.classList.remove('pro-insert-rack--docked');
    root.classList.add('pro-insert-rack--floating');
    if (!root.style.left || root.style.left === 'auto') {
      const rect = root.getBoundingClientRect();
      root.style.left = `${Math.max(0, rect.left)}px`;
      root.style.top = `${Math.max(0, rect.top)}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    }
    root.dataset.minimized = 'false';
    const minBtn = root.querySelector<HTMLElement>('#pirMinimize');
    if (minBtn) {
      minBtn.textContent = '─';
      minBtn.title = 'Minimizar';
    }
    const modeBtn = root.querySelector<HTMLElement>('#pirModeToggle');
    if (modeBtn) {
      modeBtn.textContent = '⤵';
      modeBtn.title = 'Cambiar a Dock';
    }
  } else {
    root.classList.remove('pro-insert-rack--floating');
    root.classList.add('pro-insert-rack--docked');
    root.style.left = '';
    root.style.top = '';
    root.style.right = '';
    root.style.bottom = '';
    const modeBtn = root.querySelector<HTMLElement>('#pirModeToggle');
    if (modeBtn) {
      modeBtn.textContent = '⤴';
      modeBtn.title = 'Cambiar a Floating';
    }
  }
  persistFromDom();
}

function updateActiveCount(): void {
  const grid = byId<HTMLElement>('pirGrid');
  const out = byId<HTMLElement>('pirActiveCount');
  if (!grid || !out) return;
  const active = grid.querySelectorAll('.pir-card[data-state="active"]').length;
  out.textContent = `${active}/10 active`;
}

// ── Shell builder ─────────────────────────────────────────────
function buildShell(): HTMLElement {
  const shell = document.createElement('aside');
  shell.id = 'proInsertRack';
  shell.className = 'pro-insert-rack pro-insert-rack--docked';
  shell.dataset.state = 'docked';
  shell.dataset.minimized = 'true';
  shell.dataset.hidden = 'true';
  shell.dataset.mode = 'docked';
  shell.setAttribute('role', 'region');
  shell.setAttribute('aria-label', 'Pro Insert Rack');
  shell.innerHTML = `
    <header class="pir-titlebar" id="pirTitlebar">
      <div class="pir-titlebar-left">
        <span class="pir-drag" aria-hidden="true">⋮⋮</span>
        <strong class="pir-title"><svg class="pir-title-svg" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:-2px;"><rect x="2" y="2.5" width="12" height="3.5" rx="1"/><rect x="2" y="6.5" width="12" height="3.5" rx="1"/><rect x="2" y="10.5" width="12" height="3.5" rx="1"/><circle cx="5" cy="4.2" r="0.8" fill="currentColor"/><circle cx="11" cy="8.2" r="0.8" fill="currentColor"/><circle cx="5" cy="12.2" r="0.8" fill="currentColor"/></svg>Pro Insert Rack</strong>
        <span class="pir-count" id="pirActiveCount">0/10 active</span>
      </div>
      <div class="pir-titlebar-right">
        <button class="pir-btn pir-btn--accent" id="pirRunChain" aria-label="Procesar cadena de inserts activos" title="Procesar cadena (inserts activos en este orden)" type="button">▶ Run chain</button>
        <button class="pir-btn pir-btn--icon" id="pirResetAll" aria-label="Activar todos los inserts" title="Activar todos" type="button">↻</button>
        <button class="pir-btn pir-btn--icon" id="pirModeToggle" aria-label="Cambiar modo Dock/Floating" title="Cambiar a Floating" type="button">⤴</button>
        <button class="pir-btn pir-btn--icon" id="pirMinimize" aria-label="Expandir/contraer Pro Insert Rack" title="Expandir" type="button">▢</button>
        <button class="pir-btn pir-btn--icon" id="pirClose" aria-label="Cerrar Pro Insert Rack" title="Cerrar" type="button">✕</button>
      </div>
    </header>
    <div class="pir-grid" id="pirGrid"></div>
  `;
  return shell;
}

// ── Mount ─────────────────────────────────────────────────────
function mount(rootEl: HTMLElement | null = null): HTMLElement | null {
  let root = rootEl || byId<HTMLElement>('proInsertRack');
  if (!root) {
    root = buildShell();
    document.body.appendChild(root);
  }
  // `root` is narrowed to `HTMLElement` here; capture it as a `const` so
  // the event-handler closures below see a stable non-null reference
  // (avoids non-null assertions inside the handlers).
  const shell: HTMLElement = root;
  const grid = shell.querySelector<HTMLElement>('#pirGrid');
  if (!grid) return shell;

  // Re-render idempotente: limpiar el grid antes de volver a poblar
  // (HMR o un mount() doble no debe duplicar cards).
  grid.replaceChildren();

  const persisted = loadState();
  const order: string[] =
    persisted && Array.isArray(persisted.order) && persisted.order.length === 10
      ? persisted.order
      : INSERTS.map((i) => i.id);
  const bypass = (persisted && persisted.bypass) || {};
  const isHidden =
    persisted && typeof persisted.hidden === 'boolean' ? persisted.hidden : true;
  shell.dataset.hidden = isHidden ? 'true' : 'false';
  const initialMode: 'floating' | 'docked' =
    persisted && (persisted.mode === 'floating' || persisted.mode === 'docked')
      ? persisted.mode
      : 'docked';
  shell.dataset.mode = initialMode;
  if (initialMode === 'floating') {
    shell.classList.remove('pro-insert-rack--docked');
    shell.classList.add('pro-insert-rack--floating');
    const pos = persisted && persisted.position;
    if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
      shell.style.left = `${pos.left}px`;
      shell.style.top = `${pos.top}px`;
      shell.style.right = 'auto';
      shell.style.bottom = 'auto';
    }
    const modeBtn = shell.querySelector<HTMLElement>('#pirModeToggle');
    if (modeBtn) {
      modeBtn.textContent = '⤵';
      modeBtn.title = 'Cambiar a Dock';
    }
  }
  if (persisted && typeof persisted.minimized === 'boolean') {
    shell.dataset.minimized = persisted.minimized ? 'true' : 'false';
    const minBtn = shell.querySelector<HTMLElement>('#pirMinimize');
    if (minBtn) {
      minBtn.textContent = persisted.minimized ? '▢' : '─';
      minBtn.title = persisted.minimized ? 'Expandir' : 'Minimizar';
    }
  }

  order.forEach((id) => {
    const spec = findInsertDef(id);
    if (spec) grid.appendChild(buildCard(spec, bypass[id] === true));
  });

  wireDragAndDrop(grid);
  wireKeyboardReorder(grid);

  grid.addEventListener(
    'click',
    (e: MouseEvent) => {
      try {
        const target = e.target as HTMLElement | null;
        const bypassBtn = target?.closest?.('[data-role="bypass"]') as HTMLElement | null;
        if (bypassBtn) {
          const card = bypassBtn.closest('.pir-card') as HTMLElement | null;
          if (!card) return;
          const wasActive = card.dataset.state === 'active';
          card.dataset.state = wasActive ? 'bypassed' : 'active';
          bypassBtn.setAttribute('aria-pressed', String(!wasActive));
          const led = card.querySelector<HTMLElement>('[data-role="led"]');
          if (led) led.classList.toggle('pir-led--active', !wasActive);
          persistFromDom();
          return;
        }
        const detailBtn = target?.closest?.('[data-role="openDetail"]') as HTMLElement | null;
        if (detailBtn) {
          const card = detailBtn.closest('.pir-card') as HTMLElement | null;
          if (card) openDetail(card.dataset.insertId || '');
        }
      } catch (err) {
        console.debug('[pir] grid click failed', err);
      }
    },
    { signal: rackController.signal },
  );

  const closeBtn = shell.querySelector<HTMLElement>('#pirClose');
  closeBtn?.addEventListener(
    'click',
    () => {
      try {
        proInsertRack.close();
      } catch (err) {
        console.debug('[pir] close failed', err);
      }
    },
    { signal: rackController.signal },
  );

  const resetBtn = shell.querySelector<HTMLElement>('#pirResetAll');
  resetBtn?.addEventListener(
    'click',
    () => {
      try {
        resetAll(shell);
      } catch (err) {
        console.debug('[pir] reset failed', err);
      }
    },
    { signal: rackController.signal },
  );

  const runBtn = shell.querySelector<HTMLButtonElement>('#pirRunChain');
  runBtn?.addEventListener(
    'click',
    () => {
      if (runBtn) runBtn.disabled = true;
      proInsertRack
        .runChain()
        .finally(() => {
          if (runBtn) runBtn.disabled = false;
        })
        .catch((err) => console.debug('[pir] runChain failed', err));
    },
    { signal: rackController.signal },
  );

  const minBtn = shell.querySelector<HTMLElement>('#pirMinimize');
  minBtn?.addEventListener(
    'click',
    () => {
      try {
        const isDocked = shell.classList.contains('pro-insert-rack--docked');
        if (isDocked) {
          shell.dataset.minimized = shell.dataset.minimized === 'true' ? 'false' : 'true';
          const btn = shell.querySelector<HTMLElement>('#pirMinimize');
          if (btn) {
            btn.textContent = shell.dataset.minimized === 'true' ? '▢' : '─';
            btn.title = shell.dataset.minimized === 'true' ? 'Expandir' : 'Minimizar';
          }
          persistFromDom();
        }
      } catch (err) {
        console.debug('[pir] minimize failed', err);
      }
    },
    { signal: rackController.signal },
  );

  const modeBtn = shell.querySelector<HTMLElement>('#pirModeToggle');
  modeBtn?.addEventListener(
    'click',
    (e: MouseEvent) => {
      e.stopPropagation();
      try {
        toggleMode(shell);
      } catch (err) {
        console.debug('[pir] mode toggle failed', err);
      }
    },
    { signal: rackController.signal },
  );

  updateActiveCount();
  wireTitlebarDrag(shell);

  // Wire el botón del header que abre/cierra el rack (signal-based →
  // teardown lo limpia, HMR no registra 2×).
  const headerBtn = byId<HTMLElement>('btnToggleInsertRack');
  headerBtn?.addEventListener(
    'click',
    () => {
      try {
        proInsertRack.toggle();
      } catch (err) {
        console.debug('[pir] header toggle failed', err);
      }
    },
    { signal: rackController.signal },
  );

  return shell;
}

// ── Drag-to-move del panel flotante ───────────────────────────
function wireTitlebarDrag(shell: HTMLElement): void {
  const titlebar = shell.querySelector<HTMLElement>('#pirTitlebar');
  if (!titlebar) return;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  function toAbsolute(): void {
    const rect = shell.getBoundingClientRect();
    shell.style.right = 'auto';
    shell.style.bottom = 'auto';
    shell.style.left = `${rect.left}px`;
    shell.style.top = `${rect.top}px`;
  }

  function dragStart(clientX: number, clientY: number): void {
    dragging = true;
    const hasAbsLeft =
      shell.style.left && shell.style.left !== 'auto' && shell.style.left !== '';
    if (!hasAbsLeft) toAbsolute();
    startX = clientX;
    startY = clientY;
    startLeft = parseInt(shell.style.left, 10) || 0;
    startTop = parseInt(shell.style.top, 10) || 0;
    // El body class `lgmdm-layout-dragging` desactiva transiciones CSS
    // durante el drag; si el usuario pide movimiento reducido, no lo
    // tocamos (las transiciones ya están quietas vía media query).
    if (!getPrefersReducedMotion()) {
      document.body.classList.add('lgmdm-layout-dragging');
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
    }
  }

  function dragMove(clientX: number, clientY: number): void {
    if (!dragging) return;
    const dx = clientX - startX;
    const dy = clientY - startY;
    const maxL = Math.max(0, window.innerWidth - 240);
    const maxT = Math.max(0, window.innerHeight - 40);
    shell.style.left = `${Math.max(0, Math.min(maxL, startLeft + dx))}px`;
    shell.style.top = `${Math.max(0, Math.min(maxT, startTop + dy))}px`;
  }

  function dragEnd(): void {
    if (!dragging) return;
    dragging = false;
    if (!getPrefersReducedMotion()) {
      document.body.classList.remove('lgmdm-layout-dragging');
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
    }
    persistFromDom();
  }

  titlebar.addEventListener(
    'mousedown',
    (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('button')) return;
      dragStart(e.clientX, e.clientY);
      e.preventDefault();
    },
    { signal: rackController.signal },
  );
  document.addEventListener(
    'mousemove',
    (e: MouseEvent) => dragMove(e.clientX, e.clientY),
    { signal: rackController.signal },
  );
  document.addEventListener('mouseup', dragEnd, { signal: rackController.signal });

  titlebar.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('button')) return;
      const t = e.touches[0];
      if (t) dragStart(t.clientX, t.clientY);
    },
    { passive: true, signal: rackController.signal },
  );
  document.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (!dragging) return;
      const t = e.touches[0];
      if (t) dragMove(t.clientX, t.clientY);
    },
    { passive: true, signal: rackController.signal },
  );
  document.addEventListener('touchend', dragEnd, { signal: rackController.signal });
}

function resetAll(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.pir-card').forEach((c) => {
    c.dataset.state = 'active';
    const bp = c.querySelector<HTMLElement>('[data-role="bypass"]');
    if (bp) bp.setAttribute('aria-pressed', 'false');
    const led = c.querySelector<HTMLElement>('[data-role="led"]');
    if (led) led.className = 'pir-led pir-led--active';
  });
  persistFromDom();
}

// ── Detail modal ──────────────────────────────────────────────
function openDetail(insertId: string): void {
  const spec = findInsertDef(insertId);
  if (!spec) return;
  const existing = document.getElementById('pirDetailModal');
  if (existing) existing.remove();
  const inst = registry[insertId];
  const WidgetClass: WidgetClass | null = inst?.widget ?? null;

  const overlay = document.createElement('div');
  overlay.id = 'pirDetailModal';
  overlay.className = 'pir-detail-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${spec.title} — detalle`);
  overlay.innerHTML = `
    <div class="pir-detail-dialog">
      <header class="pir-detail-head">
        <strong>${spec.title}</strong>
        <code class="pir-detail-endpoint">${spec.endpoint}</code>
        <button class="pir-detail-close" type="button" aria-label="Cerrar">✕</button>
      </header>
      <div class="pir-detail-body" id="pirDetailBody">
        ${WidgetClass ? '<div class="pir-detail-canvas-wrap"><canvas id="pirDetailCanvas"></canvas></div>' : ''}
        <div class="pir-detail-info" id="pirDetailInfo"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  detailModalOpen = true;

  let widget: WidgetInstance | null = null;

  const closeAll = (): void => {
    if (widget && typeof widget.destroy === 'function') {
      try {
        widget.destroy();
      } catch {
        /* ignore */
      }
    }
    widget = null;
    overlay.remove();
    detailModalOpen = false;
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') closeAll();
  };
  overlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === overlay) closeAll();
  });
  overlay.querySelector<HTMLElement>('.pir-detail-close')?.addEventListener('click', closeAll);
  document.addEventListener('keydown', onKey);

  if (WidgetClass) {
    try {
      const opts: Record<string, unknown> = inst?.params ? { ...inst.params } : {};
      widget = new WidgetClass();
      if (typeof widget.init === 'function') {
        widget.init(overlay.querySelector<HTMLCanvasElement>('#pirDetailCanvas'), opts);
      }
      const info = overlay.querySelector<HTMLElement>('#pirDetailInfo');
      if (info) {
        const params = inst?.params || {};
        const entries = Object.entries(params);
        info.innerHTML =
          entries.length === 0
            ? '<em>Sin parámetros editables (vista solamente)</em>'
            : '<ul>' +
              entries
                .map(
                  ([k, v]) =>
                    `<li><code>${k}</code>: ${
                      typeof v === 'number' ? v.toFixed(2) : String(v)
                    }</li>`,
                )
                .join('') +
              '</ul>';
      }
    } catch (err) {
      console.debug(`[pir] openDetail init failed: ${insertId}`, err);
    }
  } else {
    const info = overlay.querySelector<HTMLElement>('#pirDetailInfo');
    if (info) {
      info.innerHTML =
        '<em>Widget visual no disponible todavía para este DSP. Usá la pestaña "SUITE PRO" del header para controles completos.</em>';
    }
  }
}

// ── Procesar un insert ────────────────────────────────────────
async function processInsert(insertId: string, file: Blob): Promise<InsertPayload> {
  const spec = findInsertDef(insertId);
  if (!spec) throw new Error('unknown insert ' + insertId);
  const card = document.querySelector<HTMLElement>(
    `.pir-card[data-insert-id="${insertId}"]`,
  );
  if (!card) throw new Error('card not mounted');
  if (card.dataset.state === 'bypassed') return null;
  const led = card.querySelector<HTMLElement>('[data-role="led"]');
  const status = card.querySelector<HTMLElement>('[data-role="status"]');
  if (led) led.className = 'pir-led pir-led--processing';
  card.dataset.state = 'processing';
  if (status) status.textContent = 'Processing…';
  try {
    let payload: InsertPayload;
    if (insertId === 'match-eq') {
      const refFile = lgmdm().state?.reference?.file;
      if (!refFile) throw new Error('Match EQ requiere archivo de referencia');
      const fd = new FormData();
      fd.append('target_file', file);
      fd.append('reference_file', refFile);
      const cat = CATALOG['match-eq'];
      if (cat) {
        const params = cat.toBackendParams.call({ params: cat.defaults || {} });
        Object.entries(params).forEach(([k, v]) => fd.append(k, String(v)));
      }
      payload = await postDsp(spec.endpoint, fd, rackController.signal);
    } else {
      const insert = registry[insertId];
      if (insert && typeof insert.fetch === 'function') {
        payload = await insert.fetch(file);
      } else {
        const fd = new FormData();
        fd.append('file', file);
        const cat = CATALOG[insertId];
        if (cat) {
          const params = cat.toBackendParams.call({ params: cat.defaults || {} });
          Object.entries(params).forEach(([k, v]) => fd.append(k, String(v)));
        }
        payload = await postDsp(spec.endpoint, fd, rackController.signal);
      }
    }
    if (led) led.className = 'pir-led pir-led--active';
    card.dataset.state = 'active';
    if (status) status.textContent = 'Ready';
    return payload;
  } catch (err) {
    if (led) led.className = 'pir-led pir-led--error';
    card.dataset.state = 'error';
    if (status) {
      const msg = err instanceof Error ? err.message : String(err);
      status.textContent = msg.slice(0, 24);
    }
    throw err;
  }
}

async function processAll(file: Blob): Promise<ChainOutput> {
  const root = byId<HTMLElement>('proInsertRack');
  if (!root) return { results: [], blob: null };
  if (!(file instanceof Blob)) return { results: [], blob: null };
  const cards = Array.from(root.querySelectorAll<HTMLElement>('.pir-card[data-state="active"]'));
  if (cards.length === 0) return { results: [], blob: file };
  let blob: Blob = file;
  const results: ChainResult[] = [];
  for (let i = 0; i < cards.length; i += 1) {
    const insertId = cards[i].dataset.insertId || '';
    if (insertId === 'cross-demask') {
      results.push({ id: insertId, ok: false, error: 'Requiere 2 stems — usar standalone' });
      continue;
    }
    try {
      const payload = await processInsert(insertId, blob);
      if (payload instanceof Blob) {
        // F2 — forzar extensión .wav en el blob intermedio del chain.
        const safeName = payload instanceof File ? payload.name : `processed_${i + 1}.wav`;
        blob = new File([payload], safeName, { type: payload.type || 'audio/wav' });
      }
      results.push({ id: insertId, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ id: insertId, ok: false, error: msg });
    }
  }
  return { results, blob };
}

// ── Render del output de la cadena ────────────────────────────
function renderChainOutput(blob: Blob, originalName: string, results: ChainResult[]): void {
  const wrap = document.getElementById('previewAudioWrap');
  if (!wrap || !(blob instanceof Blob) || blob.size === 0) return;

  wrap.querySelectorAll('[data-chain-output]').forEach((n) => n.remove());
  const prevAudio = wrap.querySelector<HTMLAudioElement>('audio[data-preview-ready="true"]');
  if (prevAudio?.src) {
    try {
      URL.revokeObjectURL(prevAudio.src);
    } catch {
      /* ignore */
    }
  }

  const chainUrl = URL.createObjectURL(blob);
  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;

  const container = document.createElement('div');
  container.dataset.chainOutput = 'true';
  container.className = 'chain-output-wrap';
  container.innerHTML = `
    <div class="chain-output-head">
      <strong>Chain Output</strong>
      <span class="chain-output-meta">${ok} inserts OK${fail ? ` · ${fail} con error` : ''} · ${(blob.size / 1024 / 1024).toFixed(1)} MB</span>
    </div>
    <audio controls preload="metadata" src="${chainUrl}" data-chain-audio></audio>
    <div class="chain-output-actions">
      <a class="btn btn-primary" href="${chainUrl}" download="chain_${(originalName || 'master').replace(/\.[^/.]+$/, '')}.wav">Descargar Master</a>
      <button class="btn btn-secondary" type="button" id="chainABBtn">Comparar con original</button>
    </div>
  `;
  wrap.appendChild(container);

  const playBtn = document.getElementById('consolePlayBtn') as HTMLButtonElement | null;
  if (playBtn) {
    playBtn.disabled = false;
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-pressed', 'false');
  }

  const abBtn = container.querySelector<HTMLButtonElement>('#chainABBtn');
  const abPlayer = (window as Window & WindowWithAbPlayer).setupABPlayer;
  if (abBtn && typeof abPlayer === 'function') {
    abBtn.addEventListener('click', () => {
      abBtn.disabled = true;
      abBtn.textContent = 'Cargando A/B…';
      abPlayer(blob)
        .then(() => {
          abBtn.disabled = false;
          abBtn.textContent = 'A/B listo';
        })
        .catch(() => {
          abBtn.disabled = false;
          abBtn.textContent = 'Comparar con original';
        });
    });
  }

  // Limpiar URL al cerrar o reemplazar; el observer se desconecta en
  // teardown para no colgar MutationObservers tras unload.
  const observer = new MutationObserver(() => {
    if (!document.body.contains(container)) {
      URL.revokeObjectURL(chainUrl);
      observer.disconnect();
      if (chainObserver === observer) chainObserver = null;
    }
  });
  chainObserver = observer;
  observer.observe(document.body, { childList: true, subtree: true });
}

// ── Run chain ─────────────────────────────────────────────────
async function runChain(): Promise<ChainOutput | null> {
  const f = lgmdm().state?.selectedFile;
  if (!f) {
    lgmdm().ui?.showToast?.('Cargá un archivo antes de correr la cadena', 'warning', 4000);
    return null;
  }
  lgmdm().ui?.showToast?.('Procesando cadena de inserts…', 'info', 2000);
  try {
    const result = await processAll(f);
    const ok = result.results.filter((r) => r.ok).length;
    const fail = result.results.filter((r) => !r.ok).length;
    lgmdm().ui?.showToast?.(
      fail === 0
        ? `Cadena completada · ${ok} inserts OK`
        : `Cadena terminada · ${ok} OK · ${fail} con error`,
      fail === 0 ? 'success' : 'warning',
      5000,
    );
    if (result.blob instanceof Blob && result.blob.size > 0 && ok > 0) {
      renderChainOutput(result.blob, f.name, result.results);
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lgmdm().ui?.showToast?.('Insert Rack falló: ' + msg, 'error');
    throw err;
  }
}

// ── Teardown ──────────────────────────────────────────────────
let teardownDone = false;
function teardown(): void {
  if (teardownDone) return;
  teardownDone = true;
  try {
    rackController.abort();
  } catch {
    /* ignore */
  }
  // Destruir todas las instancias del registry.
  Object.values(registry).forEach((inst) => {
    try {
      inst.teardown();
    } catch {
      /* ignore */
    }
  });
  // Cerrar el modal de detalle si estaba abierto.
  if (detailModalOpen) {
    const modal = document.getElementById('pirDetailModal');
    if (modal) {
      try {
        modal.querySelector<HTMLElement>('.pir-detail-close')?.click();
      } catch {
        modal.remove();
      }
    }
    detailModalOpen = false;
  }
  // Desconectar el MutationObserver del chain output.
  if (chainObserver) {
    try {
      chainObserver.disconnect();
    } catch {
      /* ignore */
    }
    chainObserver = null;
  }
}

// ── API pública ───────────────────────────────────────────────
/**
 * Crea y registra un insert del catálogo. Defensive: si el id no está en
 * CATALOG, loguea y devuelve `null` (no lanza — los widgets legacy lo
 * esperan así).
 */
function create(spec: InsertSpec): ProInsertBase | null {
  try {
    if (!spec || !spec.id || !(spec.id in CATALOG)) {
      console.debug(`[pir] create: unknown insert "${spec?.id}"`);
      return null;
    }
    const inst = createInsert(spec);
    registry[spec.id] = inst;
    return inst;
  } catch (err) {
    console.debug('[pir] create failed', err);
    return null;
  }
}

/** Quita un insert del registry y destruye su instancia. */
function remove(id: string): boolean {
  const inst = registry[id];
  if (!inst) return false;
  try {
    inst.teardown();
  } catch (err) {
    console.debug(`[pir] remove: teardown failed for ${id}`, err);
  }
  delete registry[id];
  return true;
}

export const proInsertRack: ProInsertRackApi = {
  create,
  remove,
  CATALOG,
  registry,
  teardown,
  mount,
  processOne: processInsert,
  processAll,
  runChain,
  reset: () => {
    const root = byId<HTMLElement>('proInsertRack');
    if (root) resetAll(root);
  },
  open: () => {
    const root = byId<HTMLElement>('proInsertRack');
    if (root) {
      root.dataset.hidden = 'false';
      const headerBtn = byId<HTMLElement>('btnToggleInsertRack');
      if (headerBtn) headerBtn.setAttribute('aria-expanded', 'true');
      persistFromDom();
    }
  },
  close: () => {
    const root = byId<HTMLElement>('proInsertRack');
    if (root) {
      root.dataset.hidden = 'true';
      const headerBtn = byId<HTMLElement>('btnToggleInsertRack');
      if (headerBtn) headerBtn.setAttribute('aria-expanded', 'false');
      persistFromDom();
    }
  },
  toggle: () => {
    const root = byId<HTMLElement>('proInsertRack');
    if (root) {
      const isHidden = root.dataset.hidden === 'true';
      root.dataset.hidden = isHidden ? 'false' : 'true';
      const headerBtn = byId<HTMLElement>('btnToggleInsertRack');
      if (headerBtn) headerBtn.setAttribute('aria-expanded', String(isHidden));
      persistFromDom();
    }
  },
  INSERTS,
};

// ── Bridge to window.LGMDM.proInsertRack (legacy compat) ───────
// HMR-safe: si ya existía un rack (re-import), primero le hacemos
// teardown para no registrar 2× listeners ni duplicar el shell.
const g = lgmdm();
if (g.proInsertRack && typeof g.proInsertRack.teardown === 'function') {
  try {
    g.proInsertRack.teardown();
  } catch {
    /* ignore */
  }
}
g.proInsertRack = proInsertRack;
// FIX M-NEW-3: antes había `g.proInsertRackBound = true` con header "HMR-safe",
// pero el flag no se consultaba (regla 7 AGENTS.md: comentario que miente).
// El guard real de re-entry es el teardown de arriba (si ya existía un rack,
// se desmonta antes de re-registrar). El flag era cosmético → eliminado
// (mismo criterio que FIX M-NEW-1/M-NEW-2).

// ── Auto-mount (idempotente) ──────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      try {
        mount();
      } catch (err) {
        console.debug('[pir] auto-mount failed', err);
      }
    },
    { once: true, signal: rackController.signal },
  );
} else {
  try {
    mount();
  } catch (err) {
    console.debug('[pir] auto-mount failed', err);
  }
}

// ── Cleanup al descargar la página ────────────────────────────
window.addEventListener('beforeunload', () => proInsertRack.teardown(), {
  once: true,
});
