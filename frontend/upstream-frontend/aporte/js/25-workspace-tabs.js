
(function(){
  'use strict';
  const root = document.getElementById('lgmdmWorkspaceShell');
  if(!root) return;
  const tabs = [...root.querySelectorAll('.lg-workspace-workspace-tab')];
  const panes = [...root.querySelectorAll('.lg-workspace-workspace')];
  const storageKey = 'lgmdm.workspace';
  let _analysisRedrawRaf = null;
  function readWorkspacePreference(){
    try {
      const current = LGMDM.storage.get(storageKey);
      if (current) return current;
    } catch (_) {}
    return null;
  }

  function setWorkspace(name, persist=true){
    tabs.forEach(t=>{
      const active=t.dataset.workspace===name;
      t.classList.toggle('active',active);
      t.setAttribute('aria-selected',String(active));
      t.tabIndex=active?0:-1;
    });
    panes.forEach(p=>p.classList.toggle('active',p.dataset.workspace===name));
    if(persist){ try{ LGMDM.storage.set(storageKey,name); }catch(_){} }
    document.body.dataset.workspace=name;
    document.querySelectorAll('.lg-workspace-workspace').forEach(p=>{ p.hidden = p.dataset.workspace !== name; });
    if(_analysisRedrawRaf){ cancelAnimationFrame(_analysisRedrawRaf); _analysisRedrawRaf=null; }
    if(name==='analysis') _analysisRedrawRaf=requestAnimationFrame(()=>{ _analysisRedrawRaf=null; window.LGMDM?.analysis?.redraw?.(); });
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('workspace', name);
      window.history.replaceState(null, '', u.pathname + u.search);
    } catch (_) {}
  }

  tabs.forEach((tab,i)=>{
    const bind = window.LGMDM.ui.bindOnce;
    bind(tab,'click',()=>setWorkspace(tab.dataset.workspace),'workspace-click');
    bind(tab,'keydown',e=>{
      if(e.key==='ArrowRight'||e.key==='ArrowDown'){e.preventDefault();tabs[(i+1)%tabs.length].focus();}
      if(e.key==='ArrowLeft'||e.key==='ArrowUp'){e.preventDefault();tabs[(i-1+tabs.length)%tabs.length].focus();}
      if(e.key==='Enter'||e.key===' '){e.preventDefault();setWorkspace(tab.dataset.workspace);}
    });
  });

  // Existing chain buttons and sidebar pane links jump back to Console while opening the requested drawer/pane.
  document.querySelectorAll('.lg-chain-node[data-pane], .lg-chain-control-strip [data-stage]').forEach(el=>{
    const bind = window.LGMDM.ui.bindOnce;
    bind(el,'click',()=>setWorkspace('console'),'workspace-jump');
  });

  // Workspaces now own their DOM statically; no runtime panel moving/cloning.

  const ensurePlaceholder = (slotId, text) => {
    const slot = document.getElementById(slotId);
    if(!slot || slot.children.length) return;
    const el = document.createElement('div');
    el.className = 'lg-workspace-empty-state';
    el.textContent = text;
    slot.appendChild(el);
  };
    ensurePlaceholder('presetGrid','Los presets aparecerán aquí cuando estén disponibles.');

  // Build preset workspace from the already wired preset buttons, avoiding duplicate state logic.
  const presetSource=[...document.querySelectorAll('#presetGrid [data-preset]')];
  const presetGrid=document.getElementById('workspacePresetGrid');
  if(presetGrid){
    presetSource.forEach(src=>{
      const card=document.createElement('div');
      card.className='lg-workspace-preset-card';
      const title=document.createElement('strong');
      title.textContent=src.textContent.trim();
      const note=document.createElement('small');
      note.textContent='Aplicar preset al motor y volver a consola.';
      const btn=document.createElement('button');
      btn.type='button'; btn.textContent='APLICAR PRESET';
      const bind = window.LGMDM.ui.bindOnce;
      bind(btn,'click',()=>{src.click();setWorkspace('console');},'workspace-preset-apply');
      card.append(title,note,btn); presetGrid.appendChild(card);
    });
  }

  // Default to console; restore only known workspace values.
  let initial='console';
  try{
    const urlWs = new URL(window.location.href).searchParams.get('workspace');
    if(['console','analysis','presets'].includes(urlWs)) initial=urlWs;
    else {
      const saved=readWorkspacePreference();
      if(['console','analysis','presets'].includes(saved)) initial=saved;
    }
  }catch(_){}
  setWorkspace(initial,false);

  // BUGFIX: setWorkspace() nunca se exponía — otros módulos (Analizar,
  // Consejos, etc.) no tenían forma de llevar al usuario a la pestaña
  // correspondiente después de generar resultados. El contenido se
  // insertaba bien adentro de #analysisDynamicContent pero, si el usuario
  // seguía parado en otra pestaña, no lo veía ("no aparece").
  window.LGMDM = window.LGMDM || {};
  window.LGMDM.workspace = { setWorkspace, current: () => document.body.dataset.workspace };
})();
