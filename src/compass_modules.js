// Durable power circuits for the living-silver compass. HUD rendering reads
// these flags; ownership and walked movement are the only automatic unlocks.
(function (root) {
  'use strict';
  const MODULES = Object.freeze({ inventory: 'Inventory', joystick: 'Spirit walking',
    distance: 'Distance', memories: 'Memories', books: 'Books' });
  const DISTANCE_M = 200;
  const HINTS = Object.freeze({
    inventory: 'You have no items. Find an item to power up the inventory.',
    memories: 'Discover a memory to power up this mechanism.',
    books: 'Find a book to power up this mechanism.',
    distance: `Cover ${DISTANCE_M} metres on foot to power up.`,
    joystick: 'Enable spirit walking to move with the compass controls.',
  });
  // HUD checks run every frame. Normalize each loaded state once, and stop
  // inspecting collection histories after their circuit has awakened.
  const normalized = new WeakSet();
  const has = (value) => value && typeof value === 'object' && !Array.isArray(value);
  function evidence(save) {
    const active = save.compassModules?.active || {};
    const inv = Array.isArray(save.inv) ? save.inv : [];
    return {
      inventory: active.inventory === true || inv.some(row => row?.count > 0)
        || Object.values(save.relics || {}).some(Boolean) || Object.values(save.armor || {}).some(Boolean),
      memories: active.memories === true || save.memories > 0 || Object.keys(save.discovered || {}).length > 0,
      // A read book is historical ownership evidence, but a newly held book
      // wakes this circuit immediately, before the player reads it.
      books: active.books === true || inv.some(row => row?.id === 'book' && row.count > 0) || save.booksRead > 0 || save.tipsRead > 0,
      distance: (save.compassModules?.walkedM || 0) >= DISTANCE_M,
    };
  }
  function initialize(save) {
    const fresh = !has(save.compassModules);
    const state = fresh ? (save.compassModules = {}) : save.compassModules;
    if (normalized.has(state)) return state;
    if (!has(state.active)) state.active = {};
    if (!Array.isArray(state.pending)) state.pending = [];
    state.pending = [...new Set(state.pending.filter(id => Object.hasOwn(MODULES, id) && state.active[id] === true))];
    if (!Number.isFinite(state.walkedM) || state.walkedM < 0) state.walkedM = 0;
    state.walkedM = Math.min(DISTANCE_M, state.walkedM);
    if (fresh) {
      // Current ownership seeds existing saves quietly. Subsequent acquisitions
      // use sync and get their own ceremony; spent currencies never relock.
      for (const [id, found] of Object.entries(evidence(save))) if (found) state.active[id] = true;
    }
    normalized.add(state);
    return state;
  }
  function persist(scene) { if (typeof persistSave === 'function') persistSave(scene.save); }
  function isActive(save, id) { return Object.hasOwn(MODULES, id) && initialize(save).active[id] === true; }
  function activate(scene, id) {
    if (!Object.hasOwn(MODULES, id)) return false;
    const state = initialize(scene.save);
    if (state.active[id] === true) return false;
    state.active[id] = true;
    state.pending.push(id);
    persist(scene);
    return true;
  }
  function sync(scene) {
    initialize(scene.save);
    let changed = false;
    for (const [id, found] of Object.entries(evidence(scene.save))) {
      if (found) changed = activate(scene, id) || changed;
    }
    return changed;
  }
  // Call ONLY with distance from accepted walked movement, never a GPS fix,
  // teleport, snap-to-home or relocation delta. Stop saving once awakened.
  function recordWalk(scene, metres) {
    if (!Number.isFinite(metres) || metres <= 0 || isActive(scene.save, 'distance')) return false;
    const state = initialize(scene.save);
    state.walkedM = Math.min(DISTANCE_M, state.walkedM + metres);
    if (state.walkedM >= DISTANCE_M) return activate(scene, 'distance');
    persist(scene);
    return false;
  }
  function busy(scene, automatic) {
    if (scene._compassSpiritOpen) return true;
    if (typeof MemoryStory !== 'undefined') return automatic ? MemoryStory.storyHeld(scene) : MemoryStory.dialogOpen(scene);
    return !!scene._dialogOpen?.();
  }
  function tap(scene, id) {
    if (!Object.hasOwn(MODULES, id)) return false;
    if (isActive(scene.save, id)) return true;
    if (busy(scene, false)) return false;
    const panel = { kind: 'spirit',
      body: `${MODULES[id]} not activated. Power low.\n\n${HINTS[id]}` };
    scene._compassSpiritOpen = true;
    const close = () => { scene._compassSpiritOpen = false; };
    try {
      if (id === 'joystick') scene.showConfirmModal({ ...panel,
        id: 'spirit-walking-modal', acceptLabel: 'Enable spirit walking', cancelLabel: 'Not now',
        onCancel: close, onAccept: () => {
          close();
          activate(scene, id);
          // This notice answers the player's explicit choice; let the story
          // lane present it without waiting out the ordinary interaction hold.
          scene._storyRun = true;
          scene.updateHUD?.();
        } });
      else scene.showMessageModal({ ...panel, onDismiss: close });
    } catch (error) { close(); throw error; }
    return false;
  }
  function drain(scene) {
    const state = initialize(scene.save);
    if (!state.pending.length || busy(scene, true)) return false;
    const id = state.pending[0];
    // A panel waking is a micro toast over the player, not a dialog: it
    // never stops play or needs a tap.
    scene.flashAtPlayer?.(`${MODULES[id]} activated`);
    // Claim upon presentation so reload cannot repeat it. A failed toast
    // (thrown above) leaves it queued and retryable.
    state.pending.shift();
    persist(scene);
    return true;
  }
  root.CompassModules = { MODULES, DISTANCE_M, initialize, isActive, activate, sync, recordWalk, tap, drain };
})(window);
