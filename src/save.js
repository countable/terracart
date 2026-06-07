// Save schema + debounced localStorage persistence.
// Extracted from app.js so the save shape and write strategy live in one place.
//
// Depends on:
//   nothing external. Pure browser-globals (localStorage, window events).
//
// Exports as globals:
//   SAVE_KEY              — localStorage data key of the ACTIVE save slot
//   loadSave()            — synchronous read; returns {} on parse error / missing key
//   persistSave(save)     — debounced write (coalesced ≤ SAVE_DEBOUNCE_MS)
//   flushSave()           — synchronous write of any pending save; safe to call multiple times
//
// Multiple saved games:
//   A small registry (SAVES_KEY) tracks named slots and which one is active.
//   Each slot owns its own data key; the legacy single-save key is adopted as
//   the default slot so existing players keep their progress untouched. The
//   menu drives switchSave / createSave / deleteSave; each reloads the page so
//   the whole scene + in-memory caches re-init cleanly for the new slot.

// Legacy single-save key — also the data key of the migrated default slot, so
// existing saves need no data move.
const SAVE_VERSION_KEY = 'terracart.save.v4';
// Slot registry: { active: <id>, slots: [{ id, name, key, createdAt, lastPlayedAt }] }.
const SAVES_KEY = 'terracart.saves';

// Data key of the active slot. A live `let` (not const) so switchSave and the
// test harness can both read the current slot's key through this one name.
let SAVE_KEY = SAVE_VERSION_KEY;

function _readSavesReg() {
  try { return JSON.parse(localStorage.getItem(SAVES_KEY)) || null; }
  catch { return null; }
}
function _writeSavesReg(reg) {
  try { localStorage.setItem(SAVES_KEY, JSON.stringify(reg)); }
  catch (e) { console.warn('saves registry write failed:', e?.message || e); }
}
function _newSaveId() {
  return 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

// Ensure the registry exists and SAVE_KEY points at the active slot. Idempotent:
// safe to call on every load. On first run (or for a pre-multislot player) it
// adopts any existing legacy save as "Game 1" keyed to SAVE_VERSION_KEY.
function initSaves() {
  let reg = _readSavesReg();
  if (!reg || !Array.isArray(reg.slots) || reg.slots.length === 0) {
    const id = _newSaveId();
    reg = {
      active: id,
      slots: [{ id, name: 'Game 1', key: SAVE_VERSION_KEY, createdAt: Date.now(), lastPlayedAt: Date.now() }],
    };
    _writeSavesReg(reg);
  }
  let slot = reg.slots.find(s => s.id === reg.active);
  if (!slot) { slot = reg.slots[0]; reg.active = slot.id; _writeSavesReg(reg); }
  SAVE_KEY = slot.key;
  return reg;
}

// Menu-facing accessors. listSaves returns slots newest-played first with an
// `active` flag for rendering.
function listSaves() {
  const reg = _readSavesReg() || initSaves();
  return reg.slots
    .map(s => ({ ...s, active: s.id === reg.active }))
    .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
}
function getActiveSaveId() {
  return (_readSavesReg() || initSaves()).active;
}

// Create a fresh, empty slot and make it active. Caller reloads the page so the
// scene boots from the new (empty → fresh game) slot.
function createSave(name) {
  const reg = _readSavesReg() || initSaves();
  const id = _newSaveId();
  reg.slots.push({
    id,
    name: (name && String(name).trim()) || ('Game ' + (reg.slots.length + 1)),
    key: SAVE_VERSION_KEY + '.' + id,
    createdAt: Date.now(),
    lastPlayedAt: Date.now(),
  });
  reg.active = id;
  _writeSavesReg(reg);
  SAVE_KEY = reg.slots[reg.slots.length - 1].key;
  return id;
}

// Make an existing slot active. Caller reloads. No-op (returns false) if id is
// unknown.
function switchSave(id) {
  const reg = _readSavesReg() || initSaves();
  const slot = reg.slots.find(s => s.id === id);
  if (!slot) return false;
  reg.active = id;
  slot.lastPlayedAt = Date.now();
  _writeSavesReg(reg);
  SAVE_KEY = slot.key;
  return true;
}

// Delete a slot and its data. The registry never drops to zero slots — deleting
// the last one recreates a fresh default. If the active slot was deleted, the
// active pointer falls back to the most-recently-played survivor.
function deleteSave(id) {
  const reg = _readSavesReg() || initSaves();
  const idx = reg.slots.findIndex(s => s.id === id);
  if (idx < 0) return false;
  const [removed] = reg.slots.splice(idx, 1);
  try { localStorage.removeItem(removed.key); } catch {}
  if (reg.slots.length === 0) {
    const nid = _newSaveId();
    // Start genuinely clean: use a fresh per-slot key (like createSave) and
    // clear any stale data at it, rather than reusing the bare legacy
    // SAVE_VERSION_KEY — which could silently resurrect leftover/legacy
    // progress sitting at that key.
    const nkey = SAVE_VERSION_KEY + '.' + nid;
    try { localStorage.removeItem(nkey); } catch {}
    reg.slots.push({ id: nid, name: 'Game 1', key: nkey, createdAt: Date.now(), lastPlayedAt: Date.now() });
    reg.active = nid;
  } else if (reg.active === id) {
    const next = reg.slots.slice().sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0))[0];
    reg.active = next.id;
  }
  _writeSavesReg(reg);
  SAVE_KEY = (reg.slots.find(s => s.id === reg.active) || reg.slots[0]).key;
  return true;
}

// Reset ONLY the active slot's saved game. Wipes its data key and hard-disables
// further writes (so the pagehide flush can't rewrite the old save over the
// clean slate before location.reload). Tile caches + global state are cleared
// by the menu's reset handler alongside this. The slot itself (name, id) and
// every OTHER saved game survive.
function resetCurrentSave() {
  disableSave();
  try { localStorage.removeItem(SAVE_KEY); } catch {}
}

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

// Resolve the active slot (and migrate a legacy single save into a default
// slot) at load, before app.js create() / the test harness read SAVE_KEY.
// Bump the active slot's lastPlayedAt so the menu lists the game you're
// actually in first.
(function () {
  const reg = initSaves();
  const slot = reg.slots.find(s => s.id === reg.active);
  if (slot) { slot.lastPlayedAt = Date.now(); _writeSavesReg(reg); }
})();
