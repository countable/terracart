// Save schema + debounced localStorage persistence.
// Extracted from app.js so the save shape and write strategy live in one place.
//
// Depends on:
//   nothing external. Pure browser-globals (localStorage, window events).
//
// Exports as globals:
//   SAVE_KEY              — localStorage key for the current save schema version
//   loadSave()            — synchronous read; returns {} on parse error / missing key
//   persistSave(save)     — debounced write (coalesced ≤ SAVE_DEBOUNCE_MS)
//   flushSave()           — synchronous write of any pending save; safe to call multiple times

const SAVE_KEY = 'terracart.save.v4';

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; }
  catch { return {}; }
}

// Save is called from many hot code paths (every till/water/harvest/pickup/
// movement-quantize). On mobile, synchronous localStorage writes are slow and
// burn battery. Coalesce calls within a short window into a single write,
// flushing immediately when the page is hidden/closing so nothing is lost.
let _saveTimer = null;
let _pendingSave = null;
let _savingDisabled = false;
const SAVE_DEBOUNCE_MS = 500;

function flushSave() {
  if (_savingDisabled) return;
  if (_pendingSave) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(_pendingSave));
      _pendingSave = null;
    } catch (e) {
      // QuotaExceededError (~5MB), private-mode disabled, etc. Keep _pendingSave
      // around so a later persistSave call can retry; surface to console so the
      // failure isn't completely silent.
      console.warn('flushSave failed:', e?.message || e);
    }
  }
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
}

function persistSave(s) {
  if (_savingDisabled) return;
  _pendingSave = s;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => { _saveTimer = null; flushSave(); }, SAVE_DEBOUNCE_MS);
}

// Hard-disable all writes. Used by the menu's "Reset save" path: once
// localStorage is wiped, the in-memory _pendingSave (and any in-flight
// persistSave calls between here and location.reload) must NOT make it back
// to disk — otherwise the pagehide flush rewrites the old save on top of
// the clean slate and the reset appears to do nothing.
function disableSave() {
  _savingDisabled = true;
  _pendingSave = null;
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
}

// Tiny helpers that read/write save shape — same null-coalescing repeated
// across many sites collapses to a single call.
function addMoney(save, delta) {
  save.money = (save.money ?? 0) + delta;
}
function getSelectedSlot(save) {
  return save.inv?.[save.selSlot] || null;
}

// Don't lose pending writes when the tab is backgrounded or closed.
window.addEventListener('pagehide', flushSave);
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});
