(function(global){
  'use strict';
  const LG = global.LGMDM = global.LGMDM || {};
  const storage = LG.storage = LG.storage || {};
  const area = global.localStorage;

  function get(key, fallback = null){
    try { const value = area.getItem(String(key)); return value == null ? fallback : value; }
    catch (_) { return fallback; }
  }
  function set(key, value){
    try { area.setItem(String(key), String(value)); return true; } catch (_) { return false; }
  }
  function remove(key){
    try { area.removeItem(String(key)); return true; } catch (_) { return false; }
  }
  function getJSON(key, fallback = null){
    const raw = get(key, null);
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }
  function setJSON(key, value){
    try { return set(key, JSON.stringify(value)); } catch (_) { return false; }
  }

  Object.assign(storage, { get, set, remove, getJSON, setJSON });
})(window);
