/* LGMDM — Studio Controller
 * Modular mastering studio UI. One visible control surface, real backend-bound parameters.
 * No simulated DSP: controls proxy the existing mastering inputs and chain bypass state.
 */
(function (global) {
  'use strict';

  const LG = global.LGMDM = global.LGMDM || {};
  const STORAGE_KEY = 'lgmdm.studio.state.v1';

  const PLUGINS = {
    input: {
      family: 'INPUT', label: 'Gain / Trim', short: 'INPUT',
      pinned: true, controls: [
        { key:'input_gain_db', label:'Gain', type:'range', min:-12, max:12, step:0.1, input:'s-ingain', suffix:' dB' }
      ]
    },
    eq: {
      family:'EQ', label:'Parametric EQ', short:'EQ', virtualBypass:{inputs:['s-eq1gain','s-eq2gain','s-eq3gain','s-eq4gain','s-eq5gain','s-eq6gain','s-air','s-lowshelf'], inactiveValue:0}, controls:[
        { key:'eq1_freq', label:'Band 1 Freq', type:'range', min:20, max:20000, step:1, input:'s-eq1freq', suffix:' Hz' },
        { key:'eq1_gain', label:'Band 1 Gain', type:'range', min:-18, max:18, step:0.1, input:'s-eq1gain', suffix:' dB' },
        { key:'eq1_q', label:'Band 1 Q', type:'range', min:0.1, max:10, step:0.01, input:'s-eq1q', suffix:'' },
        { key:'eq2_freq', label:'Band 2 Freq', type:'range', min:20, max:20000, step:1, input:'s-eq2freq', suffix:' Hz' },
        { key:'eq2_gain', label:'Band 2 Gain', type:'range', min:-18, max:18, step:0.1, input:'s-eq2gain', suffix:' dB' },
        { key:'eq2_q', label:'Band 2 Q', type:'range', min:0.1, max:10, step:0.01, input:'s-eq2q', suffix:'' }
      ]
    },
    dynamic_eq: {
      family:'EQ', label:'Dynamic EQ', short:'DYN EQ', controls:[
        { key:'dyneq_freq', label:'Frequency', type:'range', min:20, max:20000, step:1, input:'s-dyneq-freq', suffix:' Hz' },
        { key:'dyneq_q', label:'Q', type:'range', min:0.2, max:10, step:0.05, input:'s-dyneq-q', suffix:'' },
        { key:'dyneq_threshold_db', label:'Threshold', type:'range', min:-60, max:0, step:0.5, input:'s-dyneq-thresh', suffix:' dB' },
        { key:'dyneq_ratio', label:'Ratio', type:'range', min:1, max:20, step:0.1, input:'s-dyneq-ratio', suffix:':1' },
        { key:'dyneq_attack_ms', label:'Attack', type:'range', min:0.1, max:200, step:0.1, input:'s-dyneq-attack', suffix:' ms' },
        { key:'dyneq_release_ms', label:'Release', type:'range', min:10, max:1000, step:5, input:'s-dyneq-release', suffix:' ms' }
      ]
    },
    compressor: {
      family:'DYNAMICS', label:'Compressor', short:'COMP', controls:[
        { key:'comp_threshold_db', label:'Threshold', type:'range', min:-60, max:0, step:0.5, input:'s-thresh', suffix:' dB' },
        { key:'comp_ratio', label:'Ratio', type:'range', min:1, max:20, step:0.1, input:'s-ratio', suffix:':1' },
        { key:'comp_attack_ms', label:'Attack', type:'range', min:0.1, max:200, step:0.1, input:'s-cattack', suffix:' ms' },
        { key:'comp_release_ms', label:'Release', type:'range', min:10, max:1000, step:5, input:'s-crelease', suffix:' ms' },
        { key:'comp_makeup_db', label:'Make-up', type:'range', min:-12, max:24, step:0.5, input:'s-cmakeup', suffix:' dB' }
      ], stageBypass:'comp'
    },
    multiband: {
      family:'DYNAMICS', label:'Comp-Multiband', short:'MB COMP', controls:[
        { key:'mb_low_x', label:'Low → Mid', type:'range', min:20, max:2000, step:10, input:'s-mb-lowx', suffix:' Hz', global:true },
        { key:'mb_high_x', label:'Mid → High', type:'range', min:500, max:12000, step:10, input:'s-mb-highx', suffix:' Hz', global:true }
      ], bands:{
        low:[
          { key:'mb_low_threshold_db', label:'Threshold', input:'s-mb-low-th', suffix:' dB', min:-60,max:0,step:0.5 },
          { key:'mb_low_ratio', label:'Ratio', input:'s-mb-low-ratio', suffix:':1', min:1,max:20,step:0.1 },
          { key:'mb_low_attack_ms', label:'Attack', input:'s-mb-low-att', suffix:' ms', min:0.1,max:200,step:0.1 },
          { key:'mb_low_release_ms', label:'Release', input:'s-mb-low-rel', suffix:' ms', min:10,max:1000,step:5 },
          { key:'mb_low_makeup_db', label:'Make-up', input:'s-mb-low-mu', suffix:' dB', min:-12,max:24,step:0.5 }
        ],
        mid:[
          { key:'mb_mid_threshold_db', label:'Threshold', input:'s-mb-mid-th', suffix:' dB', min:-60,max:0,step:0.5 },
          { key:'mb_mid_ratio', label:'Ratio', input:'s-mb-mid-ratio', suffix:':1', min:1,max:20,step:0.1 },
          { key:'mb_mid_attack_ms', label:'Attack', input:'s-mb-mid-att', suffix:' ms', min:0.1,max:200,step:0.1 },
          { key:'mb_mid_release_ms', label:'Release', input:'s-mb-mid-rel', suffix:' ms', min:10,max:1000,step:5 },
          { key:'mb_mid_makeup_db', label:'Make-up', input:'s-mb-mid-mu', suffix:' dB', min:-12,max:24,step:0.5 }
        ],
        high:[
          { key:'mb_high_threshold_db', label:'Threshold', input:'s-mb-high-th', suffix:' dB', min:-60,max:0,step:0.5 },
          { key:'mb_high_ratio', label:'Ratio', input:'s-mb-high-ratio', suffix:':1', min:1,max:20,step:0.1 },
          { key:'mb_high_attack_ms', label:'Attack', input:'s-mb-high-att', suffix:' ms', min:0.1,max:200,step:0.1 },
          { key:'mb_high_release_ms', label:'Release', input:'s-mb-high-rel', suffix:' ms', min:10,max:1000,step:5 },
          { key:'mb_high_makeup_db', label:'Make-up', input:'s-mb-high-mu', suffix:' dB', min:-12,max:24,step:0.5 }
        ]
      }, bypassInput:'mb-bypass'
    },
    transient: {
      family:'DYNAMICS', label:'Transient Shaper', short:'TRANSIENT', virtualBypass:{inputs:['s-tatt','s-tsus'], inactiveValue:0}, controls:[
        { key:'transient_attack', label:'Attack', input:'s-tatt', suffix:' %', min:-100,max:100,step:1 },
        { key:'transient_sustain', label:'Sustain', input:'s-tsus', suffix:' %', min:-100,max:100,step:1 }
      ]
    },
    glue: {
      family:'DYNAMICS', label:'Glue Compressor', short:'GLUE', controls:[
        { key:'glue_threshold_db', label:'Threshold', input:'s-glue-thresh', suffix:' dB', min:-24,max:0,step:0.5 },
        { key:'glue_ratio', label:'Ratio', input:'s-glue-ratio', suffix:':1', min:1,max:10,step:0.5 },
        { key:'glue_attack_ms', label:'Attack', input:'s-glue-attack', suffix:' ms', min:0.1,max:200,step:0.1 },
        { key:'glue_release_ms', label:'Release', input:'s-glue-release', suffix:' ms', min:10,max:1000,step:5 },
        { key:'glue_makeup_db', label:'Make-up', input:'s-glue-makeup', suffix:' dB', min:-12,max:12,step:0.5 }
      ], bypassInput:'s-glue-bypass'
    },
    ms_comp: {
      family:'STEREO', label:'M/S Compressor', short:'M/S COMP', controls:[
        { key:'ms_comp_mid_threshold_db', label:'Mid Threshold', input:'s-mscomp-mid-thresh', suffix:' dB', min:-60,max:0,step:0.5 },
        { key:'ms_comp_mid_ratio', label:'Mid Ratio', input:'s-mscomp-mid-ratio', suffix:':1', min:1,max:20,step:0.5 },
        { key:'ms_comp_side_threshold_db', label:'Side Threshold', input:'s-mscomp-side-thresh', suffix:' dB', min:-60,max:0,step:0.5 },
        { key:'ms_comp_side_ratio', label:'Side Ratio', input:'s-mscomp-side-ratio', suffix:':1', min:1,max:20,step:0.5 },
        { key:'ms_comp_side_attack_ms', label:'Side Attack', input:'s-mscomp-side-attack', suffix:' ms', min:0.1,max:200,step:0.1 },
        { key:'ms_comp_side_release_ms', label:'Side Release', input:'s-mscomp-side-release', suffix:' ms', min:5,max:2000,step:5 }
      ], bypassInput:'s-mscomp-bypass'
    },
    saturation: {
      family:'COLOR', label:'Saturation', short:'SAT', controls:[
        { key:'saturation_drive', label:'Drive', input:'s-satdrive', suffix:' dB', min:0,max:24,step:0.1 },
        { key:'saturation_mix', label:'Mix', input:'s-satmix', suffix:' %', min:0,max:1,step:0.01, displayScale:100 }
      ],
      virtualBypass:{input:'s-satdrive', inactiveValue:0}
    },
    stereo: {
      family:'STEREO', label:'Stereo Width', short:'STEREO', controls:[
        { key:'stereo_width_amount', label:'Width', input:'s-width', suffix:'×', min:0.5,max:1.5,step:0.01 }
      ], stageBypass:'stereo'
    },
    mb_stereo: {
      family:'STEREO', label:'Multiband Stereo', short:'MB STEREO', controls:[
        { key:'mb_stereo_low_width', label:'Low width', input:'s-mb-sw-low', suffix:'×', min:0,max:2,step:0.01 },
        { key:'mb_stereo_mid_width', label:'Mid width', input:'s-mb-sw-mid', suffix:'×', min:0,max:2,step:0.01 },
        { key:'mb_stereo_high_width', label:'High width', input:'s-mb-sw-high', suffix:'×', min:0,max:2,step:0.01 }
      ], bypassInput:'mb-stereo-bypass'
    },
    clipper: {
      family:'OUTPUT', label:'Clipper', short:'CLIP', controls:[
        { key:'clipper_ceiling', label:'Ceiling', input:'s-clip-ceiling', suffix:' dB', min:-6,max:0,step:0.1 },
        { key:'clipper_drive_db', label:'Drive', input:'s-clip-drive', suffix:' dB', min:0,max:12,step:0.1 }
      ], bypassInput:'s-clip-bypass'
    },
    limiter: {
      family:'OUTPUT', label:'True Peak Limiter', short:'LIMITER', controls:[
        { key:'limiter_ceiling', label:'Ceiling', input:'s-ceiling', suffix:' dB', min:-3,max:-0.1,step:0.1 },
        { key:'limiter_release_ms', label:'Release', input:'s-lrelease', suffix:' ms', min:10,max:1000,step:5 }
      ], stageBypass:'limiter'
    }
  };

  const FAMILY_ORDER = ['INPUT','EQ','DYNAMICS','COLOR','STEREO','OUTPUT'];
  const BAND_ORDER = ['low','mid','high'];
  const state = {
    active: new Set(['input','compressor','limiter']),
    expanded: 'multiband',
    multibandBand: 'mid',
    savedValues: {},
    mounted: false
  };

  const id = (value) => document.getElementById(value);
  const getInput = (inputId) => {
    const el = id(inputId);
    if (!el) throw new Error(`[Studio] Falta control técnico requerido: #${inputId}`);
    return el;
  };
  function read(inputId) { const el = getInput(inputId); return el.value; }
  function set(inputId, value) {
    const el = getInput(inputId);
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles:true }));
    el.dispatchEvent(new Event('change', { bubbles:true }));
  }
  function formatValue(value, def) {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    const scaled = def.displayScale ? n * def.displayScale : n;
    const digits = Math.abs(scaled - Math.round(scaled)) < 1e-7 ? 0 : 2;
    return `${scaled.toFixed(digits)}${def.suffix || ''}`;
  }

  function saveStorage() {
    try {
      LG.storage.setJSON(STORAGE_KEY, {
        active:[...state.active], expanded:state.expanded, band:state.multibandBand, savedValues:state.savedValues
      });
    } catch (_) {}
  }
  function loadStorage() {
    try {
      const data = LG.storage.getJSON(STORAGE_KEY, null);
      if (!data) return;
      if (Array.isArray(data.active)) data.active.forEach(k => { if (PLUGINS[k]) state.active.add(k); });
      if (Array.isArray(data.removed)) data.removed.forEach(k => state.active.delete(k));
      if (PLUGINS[data.expanded]) state.expanded = data.expanded;
      if (BAND_ORDER.includes(data.band)) state.multibandBand = data.band;
      if (data.savedValues && typeof data.savedValues === 'object') state.savedValues = data.savedValues;
    } catch (_) {}
  }

  function isActive(key) {
    const plugin = PLUGINS[key];
    if (!plugin) throw new Error(`[Studio] Plugin desconocido: ${key}`);
    return state.active.has(key);
  }

  function syncPluginBypass(key, enabled) {
    const plugin = PLUGINS[key];
    if (!plugin) throw new Error(`[Studio] Plugin desconocido: ${key}`);
    if (plugin.stageBypass) {
      const api = LG.console;
      if (!api || typeof api.setStageBypass !== 'function') throw new Error(`[Studio] API de stage bypass no disponible para ${key}`);
      api.setStageBypass(plugin.stageBypass, !enabled);
      return;
    }
    if (plugin.bypassInput) {
      set(plugin.bypassInput, !enabled);
      return;
    }
    if (plugin.virtualBypass) {
      const inputs = Array.isArray(plugin.virtualBypass.inputs)
        ? plugin.virtualBypass.inputs
        : [plugin.virtualBypass.input];
      if (!enabled) {
        state.savedValues[key] = state.savedValues[key] || {};
        inputs.forEach((inputId) => {
          state.savedValues[key][inputId] = read(inputId);
          set(inputId, plugin.virtualBypass.inactiveValue);
        });
      } else {
        inputs.forEach((inputId) => {
          const restored = state.savedValues?.[key]?.[inputId];
          if (restored != null) set(inputId, restored);
        });
      }
    }
  }

  function activate(key, enabled) {
    const plugin = PLUGINS[key];
    if (!plugin) throw new Error(`[Studio] Plugin desconocido: ${key}`);
    if (plugin.pinned && !enabled) return;
    if (enabled) state.active.add(key); else state.active.delete(key);
    syncPluginBypass(key, enabled);
    state.expanded = enabled ? key : (state.expanded === key ? null : state.expanded);
    render();
    saveStorage();
    window.dispatchEvent(new CustomEvent('lgmdm:studio-chain-changed', { detail:{ active:[...state.active], plugin:key, enabled } }));
  }

  function renderFamilies() {
    const mount = id('studioFamilyMount');
    if (!mount) return;
    mount.innerHTML = '';
    FAMILY_ORDER.forEach(family => {
      const block = document.createElement('section');
      block.className = 'studio-family';
      const title = document.createElement('div');
      title.className = 'studio-family-title';
      title.innerHTML = `<span>${family}</span><small>${[...Object.keys(PLUGINS)].filter(k=>PLUGINS[k].family===family).length} módulos</small>`;
      block.appendChild(title);
      Object.entries(PLUGINS).filter(([,p])=>p.family===family).forEach(([key,p]) => {
        const row = document.createElement('label');
        row.className = `studio-plugin-toggle ${state.active.has(key) ? 'active' : ''}`;
        row.innerHTML = `<input type="checkbox" ${state.active.has(key) ? 'checked' : ''} ${p.pinned ? 'disabled' : ''} data-studio-toggle="${key}"><span class="studio-plugin-led"></span><span class="studio-plugin-name">${p.label}</span>${p.pinned ? '<em>CORE</em>' : ''}`;
        row.querySelector('input').addEventListener('change', e => activate(key, e.target.checked));
        block.appendChild(row);
      });
      mount.appendChild(block);
    });
  }

  function cardHeader(key) {
    const p = PLUGINS[key];
    const open = state.expanded === key;
    return `<button class="studio-plugin-header" type="button" data-studio-expand="${key}" aria-expanded="${open}"><span class="studio-plugin-status"></span><span class="studio-plugin-header-title">${p.label}</span><span class="studio-plugin-header-meta">${p.short}</span><span class="studio-chevron">${open ? '▼' : '▶'}</span></button>`;
  }

  function renderControls(key) {
    const p = PLUGINS[key];
    const defs = [];
    if (p.controls) defs.push(...p.controls);
    if (key === 'multiband') {
      defs.push(...p.bands[state.multibandBand]);
    }
    const wrap = document.createElement('div');
    wrap.className = 'studio-plugin-body';
    if (key === 'multiband') {
      const bandNav = document.createElement('div');
      bandNav.className = 'studio-band-tabs';
      BAND_ORDER.forEach(band => {
        const btn = document.createElement('button');
        btn.type='button'; btn.className=`studio-band-tab ${band===state.multibandBand?'active':''}`; btn.textContent=band.toUpperCase();
        btn.addEventListener('click',()=>{ state.multibandBand=band; saveStorage(); render(); });
        bandNav.appendChild(btn);
      });
      wrap.appendChild(bandNav);
    }
    defs.forEach(def => {
      const source = getInput(def.input);
      const row = document.createElement('label');
      row.className='studio-control-row';
      row.innerHTML = `<span class="studio-control-label">${def.label}</span><input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${source.value}" class="studio-range" data-studio-input="${def.input}"><output>${formatValue(source.value, def)}</output>`;
      const range=row.querySelector('input'); const output=row.querySelector('output');
      range.addEventListener('input',()=>{ set(def.input, range.value); output.textContent=formatValue(range.value, def); });
      wrap.appendChild(row);
    });
    if (key === 'multiband') {
      const hint = document.createElement('div');
      hint.className='studio-band-state-hint';
      hint.textContent = `Estado guardado: ${state.multibandBand.toUpperCase()} · Attack ${read(p.bands[state.multibandBand].find(d=>d.label==='Attack').input)} ms`;
      wrap.appendChild(hint);
    }
    const actions=document.createElement('div'); actions.className='studio-plugin-actions';
    const bypass=document.createElement('button'); bypass.type='button'; bypass.className='studio-action-btn'; bypass.textContent='BYPASS';
    bypass.addEventListener('click',()=>{
      if (p.bypassInput) set(p.bypassInput, 'true');
      else if (p.virtualBypass) activate(key,false);
      state.active.delete(key); render(); saveStorage();
    });
    const remove=document.createElement('button'); remove.type='button'; remove.className='studio-action-btn danger'; remove.textContent='REMOVE';
    remove.addEventListener('click',()=>activate(key,false));
    actions.appendChild(bypass); actions.appendChild(remove); wrap.appendChild(actions);
    return wrap;
  }

  function renderRack() {
    const mount=id('studioRackMount'); if(!mount) return;
    mount.innerHTML='';
    const active=[...state.active];
    active.forEach(key=>{
      const card=document.createElement('article'); card.className=`studio-plugin-card ${state.expanded===key?'expanded':''}`;
      card.innerHTML=cardHeader(key);
      card.querySelector('[data-studio-expand]').addEventListener('click',()=>{ state.expanded=state.expanded===key?null:key; saveStorage(); renderRack(); });
      if (state.expanded===key) card.appendChild(renderControls(key));
      mount.appendChild(card);
    });
    const add=document.createElement('button'); add.type='button'; add.className='studio-add-plugin'; add.textContent='+ ADD PLUGIN';
    add.addEventListener('click',()=>{
      const candidate=Object.keys(PLUGINS).find(k=>!state.active.has(k));
      if (candidate) activate(candidate,true);
    });
    mount.appendChild(add);
  }

  function renderCenter() {
    const chain=id('studioCenterChain'); if(!chain) return;
    const active=[...state.active];
    chain.innerHTML='';
    active.forEach((key,i)=>{
      const p=PLUGINS[key];
      const node=document.createElement('div'); node.className='studio-chain-node';
      node.innerHTML=`<span class="studio-chain-index">${String(i+1).padStart(2,'0')}</span><span class="studio-chain-name">${p.short}</span>${i<active.length-1?'<span class="studio-chain-arrow">›</span>':''}`;
      chain.appendChild(node);
    });
  }

  function render() {
    renderFamilies(); renderRack(); renderCenter();
    document.body.classList.toggle('lg-studio-active', true);
  }

  let previewTelemetry = null;
  let previewAudio = null;
  let telemetryWired = false;

  function setGRValues(values) {
    ['low','mid','high'].forEach(band=>{
      const value=Number(values?.[band] ?? 0);
      const out=id(`studioGr_${band}`); const bar=id(`studioGrBar_${band}`);
      if(out) out.textContent=Number.isFinite(value) ? `${value.toFixed(1)} dB` : '-- dB';
      if(bar) bar.style.width=Number.isFinite(value) ? `${Math.min(100, Math.max(0, Math.abs(value)*8))}%` : '0%';
    });
  }

  function telemetryAt(timeSec) {
    const curves=previewTelemetry?.multiband?.bands;
    const duration=Number(previewTelemetry?.duration_sec);
    if(!Array.isArray(curves) || curves.length!==3 || !Number.isFinite(duration) || duration<=0) return null;
    const values={};
    for(const band of ['low','mid','high']) {
      const arr=Array.isArray(curves.find(x=>x.band===band)?.gain_reduction_db) ? curves.find(x=>x.band===band).gain_reduction_db : null;
      if(!arr || !arr.length) return null;
      const pos=Math.min(arr.length-1, Math.max(0, Math.round((timeSec/duration)*(arr.length-1))));
      values[band]=Number(arr[pos]);
    }
    return values;
  }

  function updateCentralGR(metrics) {
    const panel=id('studioGrPanel'); if(!panel) return;
    const mb=metrics?.chain_meters?.mb || metrics?.mb || null;
    if (!state.active.has('multiband')) { panel.hidden=true; return; }
    panel.hidden=false;
    if (!mb || (mb.low_gr_db == null && mb.mid_gr_db == null && mb.high_gr_db == null)) {
      panel.querySelector('.studio-gr-note').textContent = 'Esperando telemetría real del Preview del servidor.';
      ['low','mid','high'].forEach(b=>{ const out=id(`studioGr_${b}`); if(out) out.textContent='-- dB'; const bar=id(`studioGrBar_${b}`); if(bar) bar.style.width='0%'; });
      return;
    }
    panel.querySelector('.studio-gr-note').textContent = 'Reducción de ganancia real reportada por el motor.';
    const values = {
      low: Number(mb.low_gr_db ?? 0), mid:Number(mb.mid_gr_db ?? 0), high:Number(mb.high_gr_db ?? 0)
    };
    BAND_ORDER.forEach(band=>{
      const out=id(`studioGr_${band}`); const bar=id(`studioGrBar_${band}`);
      if(out) out.textContent=`${values[band].toFixed(1)} dB`;
      if(bar) bar.style.width=`${Math.min(100, Math.max(0, Math.abs(values[band])*8))}%`;
    });
  }

  function install() {
    if (state.mounted) return;
    const consoleEl=id('lgMasterConsole'); if(!consoleEl) throw new Error('[Studio] #lgMasterConsole no existe');
    loadStorage();
    render();
    LG.metrics?.subscribe?.(({metrics})=>updateCentralGR(metrics));
    window.addEventListener('lgmdm:metrics', e=>updateCentralGR(e.detail?.metrics));
    window.addEventListener('lgmdm:preview-telemetry', e=>{
      previewTelemetry=e.detail?.telemetry || null;
      previewAudio=e.detail?.audio || document.querySelector('#previewAudioWrap audio');
      if(previewAudio && !telemetryWired) {
        telemetryWired=true;
        const tick=()=>{
          if(!previewAudio || previewAudio.paused) return;
          const values=telemetryAt(previewAudio.currentTime);
          if(values) setGRValues(values);
        };
        previewAudio.addEventListener('timeupdate', tick);
        previewAudio.addEventListener('ended',()=>setGRValues(null));
      }
    });
    state.mounted=true;
  }

  LG.studio = Object.assign(LG.studio || {}, {
    plugins: PLUGINS,
    getState:()=>({active:[...state.active], expanded:state.expanded, band:state.multibandBand}),
    getActiveChain:()=>[...state.active],
    activate,
    install
  });

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', install, {once:true}); else install();
})(window);
