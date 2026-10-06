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
//   bindIdSet(save, field) - Set-like id collection backed by one save array
//   Save.persist(save)    — persistSave for modules that may hold no save yet
//   Ledger                — the rolling-millisecond cooldown maps (until / waitMs / stamp)
//   SaveSession           — owns the live save's heartbeat and lifecycle flush
//
// Multiple saved games:
//   A small registry (SAVES_KEY) tracks named slots and which one is active.
//   Each slot owns its own data key. The menu drives switchSave / createSave /
//   deleteSave; each reloads the page so the scene + in-memory caches re-init.
//   Slot names stay unique, because two rows wearing the same name are
//   indistinguishable in the menu. createSave de-duplicates a supplied name
//   ("Ada" -> "Ada 2"), because callers pass it for convenience; renameSave
//   refuses a name another slot wears, because a rename is an explicit choice
//   the caller can re-prompt for.

// Stable storage namespace for named save slots.
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
// safe to call on every load. Without a registry, start a fresh named slot.
function initSaves() {
  let reg = _readSavesReg();
  if (!reg || !Array.isArray(reg.slots) || reg.slots.length === 0) {
    const id = _newSaveId();
    reg = {
      active: id,
      slots: [{ id, name: 'Game 1', key: SAVE_VERSION_KEY + '.' + id, createdAt: Date.now(), lastPlayedAt: Date.now() }],
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

// Placeholder name for a slot created without one. Deletions can leave holes
// (slots.length + 1 may already be taken), so walk up to the first free "Game N".
// The optional multiplayer name christens it later (renameSave).
function _defaultSaveName(reg) {
  const used = new Set(reg.slots.map(s => s.name));
  let n = reg.slots.length + 1;
  while (used.has('Game ' + n)) n++;
  return 'Game ' + n;
}
// Is a slot name still the untouched createSave/initSaves placeholder? The
// player-name-driven rename only ever overwrites these, never a name a player chose.
function isDefaultSaveName(name) {
  return /^Game \d+$/.test(String(name || ''));
}

// Free a desired slot name: while another slot wears it, walk " 2", " 3"...
// A trailing counter is stripped first, so a taken "Ada 2" renumbers to
// "Ada 3", never "Ada 2 2".
function _dedupeName(reg, desired) {
  const taken = new Set(reg.slots.map(s => s.name));
  if (!taken.has(desired)) return desired;
  const base = desired.replace(/ \d+$/, '') || desired;
  let n = 2;
  while (taken.has(base + ' ' + n)) n++;
  return base + ' ' + n;
}

// Create a fresh, empty slot and make it active. Caller reloads the page so the
// scene boots from the new (empty → fresh game) slot.
function createSave(name) {
  const reg = _readSavesReg() || initSaves();
  const id = _newSaveId();
  const clean = name && String(name).trim();
  reg.slots.push({
    id,
    name: clean ? _dedupeName(reg, clean) : _defaultSaveName(reg),
    key: SAVE_VERSION_KEY + '.' + id,
    createdAt: Date.now(),
    lastPlayedAt: Date.now(),
  });
  reg.active = id;
  _writeSavesReg(reg);
  SAVE_KEY = reg.slots[reg.slots.length - 1].key;
  return id;
}

// Rename a slot in place. Returns false (and changes nothing) for an unknown
// id, a blank name, or a name another slot already wears; renaming to the
// slot's own name is a no-op success. Pure registry write — the slot's data
// key never changes, so it's safe mid-game.
function renameSave(id, name) {
  const clean = name && String(name).trim();
  if (!clean) return false;
  const reg = _readSavesReg() || initSaves();
  const slot = reg.slots.find(s => s.id === id);
  if (!slot) return false;
  if (reg.slots.some(s => s.id !== id && s.name === clean)) return false;
  slot.name = clean;
  _writeSavesReg(reg);
  return true;
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
    // Start genuinely clean: a fresh per-slot key (like createSave), clearing any
    // stale data at it, so legacy progress cannot be resurrected.
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
let _pendingSaveKey = null;
let _savingDisabled = false;
let _saveFailed = false;
const SAVE_DEBOUNCE_MS = 500;
const SAVE_HEARTBEAT_MS = 10 * 1000;
let _sessionSave = null;
let _sessionSaveKey = null;
let _sessionHeartbeatAt = null;

function _setSaveFailed(failed) {
  if (_saveFailed === failed) return;
  _saveFailed = failed;
  // A headless caller may have no DOM. The page supplies one persistent notice
  // so repeated failed writes never stack up alerts or transient messages.
  const notice = typeof document !== 'undefined' && document.getElementById?.('save-notice');
  if (notice) notice.hidden = !failed;
}

function flushSave() {
  if (_savingDisabled) return;
  if (_pendingSave) {
    const boot = window.__boot;
    const started = boot?.tick ? performance.now() : 0;
    try {
      const serialized = JSON.stringify(_pendingSave);
      boot?.count?.('save serialized chars', serialized.length);
      localStorage.setItem(_pendingSaveKey || SAVE_KEY, serialized);
      _pendingSave = null;
      _pendingSaveKey = null;
      _setSaveFailed(false);
    } catch (e) {
      // QuotaExceededError (~5MB), private-mode disabled, etc. Keep _pendingSave
      // around so a later persistSave call can retry.
      _setSaveFailed(true);
      console.warn('flushSave failed:', e?.message || e);
    } finally {
      if (boot?.tick) boot.tick('save write', performance.now() - started);
    }
  }
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
}

function persistSave(s) {
  if (_savingDisabled) return;
  _pendingSave = s;
  _pendingSaveKey = SAVE_KEY;
  if (_saveTimer) return;
  // When the debounce lapses, land the actual stringify + localStorage write
  // in an idle slice rather than at the timer's arbitrary point mid-frame:
  // the write grows with the save (fog blobs alone add up over a session) and
  // is the single biggest main-thread hitch on a slow phone. The timeout
  // bounds staleness when the browser never reports idle time; the pagehide /
  // visibilitychange flushes below stay synchronous, so nothing is lost when
  // the tab goes away first.
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => flushSave(), { timeout: 1000 });
    else flushSave();
  }, SAVE_DEBOUNCE_MS);
}

// persistSave for a module that may be handed no save (a stub scene, a
// headless test): a missing save is a no-op, never a throw.
const Save = {
  persist(s) { if (s) persistSave(s); },
};

// ── Rolling-millisecond ledgers ─────────────────────────────────────────────
// A save map of { [key]: epoch-ms } read back as "when may I again": a stamp
// plus a cooldown (the castle's favour, an animal's produce, a fruit pick) or
// an expiry outright (a neighbour's rest, a pet's boost). until() is the ms
// stored (0 for none or junk); waitMs() the ms still to wait; stamp() writes
// a key and prunes every OTHER lapsed entry (ms + cooldown <= now), so a map
// of places visited over weeks never grows. The UTC-DAY ledger
// (Macros.markToday) is a day, not a clock.
const Ledger = {
  until(map, key) {
    const v = map && map[key];
    return (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
  },
  waitMs(map, key, now = Date.now(), cooldownMs = 0) {
    const t = Ledger.until(map, key);
    return t ? Math.max(0, t + cooldownMs - now) : 0;
  },
  stamp(save, field, key, ms, now = Date.now(), cooldownMs = 0) {
    const map = save[field] = (save[field] && typeof save[field] === 'object') ? save[field] : {};
    for (const k of Object.keys(map)) {
      if (k !== key && !Ledger.waitMs(map, k, now, cooldownMs)) delete map[k];
    }
    map[key] = ms;
    return map;
  },
};

// Bind one persisted id array to a Set-like runtime view. The binding owns
// both representations because a one-sided mutation otherwise works only
// until reload. Every real mutation parks the same save object in the normal
// debounce lane; repeated adds and missing deletes stay no-ops.
function bindIdSet(save, field) {
  if (!save || typeof save !== 'object') throw new TypeError('bindIdSet needs a save object');
  if (typeof field !== 'string' || !field) throw new TypeError('bindIdSet needs a field name');

  const ids = new Set(Array.isArray(save[field]) ? save[field] : []);
  save[field] = [...ids];
  let binding;
  const sync = () => {
    save[field] = [...ids];
    persistSave(save);
  };
  binding = {
    has(id) { return ids.has(id); },
    add(id) {
      if (!ids.has(id)) { ids.add(id); sync(); }
      return binding;
    },
    delete(id) {
      if (!ids.delete(id)) return false;
      sync();
      return true;
    },
    clear() {
      if (!ids.size) return false;
      ids.clear();
      sync();
      return true;
    },
    iterate() { return ids.values(); },
    get size() { return ids.size; },
    [Symbol.iterator]() { return ids[Symbol.iterator](); },
  };
  return binding;
}

function _detachSaveSession() {
  _sessionSave = null;
  _sessionSaveKey = null;
  _sessionHeartbeatAt = null;
}

function _touchSaveSession(now, force) {
  if (_savingDisabled || !_sessionSave) return false;
  const wallNow = Number.isFinite(now) ? now : Date.now();
  if (!force && _sessionHeartbeatAt != null && wallNow >= _sessionHeartbeatAt
      && wallNow - _sessionHeartbeatAt < SAVE_HEARTBEAT_MS) return false;
  _sessionSave.lastSeenAt = wallNow;
  _sessionHeartbeatAt = wallNow;
  return true;
}

// SaveSession owns the live save reference because a page can hide after the
// last gameplay write. A lifecycle flush forces a fresh wall-clock heartbeat
// and writes that object even when the debounce queue is empty.
const SaveSession = Object.freeze({
  heartbeatMs: SAVE_HEARTBEAT_MS,
  attach(save, now = Date.now()) {
    if (!save || typeof save !== 'object') { _detachSaveSession(); return false; }
    _sessionSave = save;
    // Capture the slot with the object so a switch followed by pagehide cannot
    // write the old scene into the newly selected slot.
    _sessionSaveKey = SAVE_KEY;
    _sessionHeartbeatAt = null;
    return _touchSaveSession(now, true);
  },
  detach: _detachSaveSession,
  touch(now = Date.now()) {
    return _touchSaveSession(now, false);
  },
  flush(now = Date.now()) {
    if (_savingDisabled) return false;
    if (_sessionSave) {
      _touchSaveSession(now, true);
      _pendingSave = _sessionSave;
      _pendingSaveKey = _sessionSaveKey;
    }
    flushSave();
    return true;
  },
});
window.SaveSession = SaveSession;

// Hard-disable all writes (the menu's "Reset save" path): once localStorage is
// wiped, the in-memory _pendingSave and any persistSave calls before
// location.reload must NOT reach disk, or the pagehide flush rewrites the old
// save over the clean slate.
function disableSave() {
  _savingDisabled = true;
  _pendingSave = null;
  _pendingSaveKey = null;
  _detachSaveSession();
  _setSaveFailed(false);
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

// The session flush writes the current heartbeat even when gameplay left no
// pending mutation. Exit-time writes remain synchronous and best-effort.
window.addEventListener('pagehide', () => SaveSession.flush());
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') SaveSession.flush();
});

// Resolve the active slot before app.js create() / the test harness reads SAVE_KEY.
// Bump the active slot's lastPlayedAt so the menu lists the game you're
// actually in first.
(function () {
  const reg = initSaves();
  const slot = reg.slots.find(s => s.id === reg.active);
  if (slot) { slot.lastPlayedAt = Date.now(); _writeSavesReg(reg); }
})();
