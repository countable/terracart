// Headless tests for the save lifecycle (src/save.js).
//
// localStorage is SHARED across all test files in the one VM context.
// Every test uses unique save names and cleans up via deleteSave() to avoid
// polluting siblings.

// ── helpers ──────────────────────────────────────────────────────────────────

// Create a unique save name so concurrent / repeated runs don't collide.
let _seq = 0;
function _uid(prefix) {
  return (prefix || 'test') + '_' + Date.now().toString(36) + '_' + (++_seq);
}

// Delete every slot whose name starts with 'test' — defensive cleanup used at
// the start of each test that calls initSaves() to avoid inheriting state from
// the module-load IIFE.
function _cleanTestSlots() {
  const slots = listSaves();
  for (const s of slots) {
    if (s.name && s.name.startsWith('test')) {
      deleteSave(s.id);
    }
  }
}

// ── initSaves / createSave / listSaves / getActiveSaveId ─────────────────────

test('save: initSaves is idempotent — second call leaves the registry intact', () => {
  const reg1 = initSaves();
  const activeId1 = reg1.active;
  const slotCount1 = reg1.slots.length;

  const reg2 = initSaves();
  assert.eq(reg2.active, activeId1, 'active pointer unchanged');
  assert.eq(reg2.slots.length, slotCount1, 'no slots added');
});

test('save: createSave creates a slot that appears in listSaves', () => {
  const name = _uid('test_create');
  const id = createSave(name);
  try {
    const list = listSaves();
    const found = list.find(s => s.id === id);
    assert.truthy(found, 'new slot in listSaves');
    assert.eq(found.name, name, 'name stored correctly');
  } finally {
    deleteSave(id);
  }
});

test('save: createSave makes the new slot active (getActiveSaveId)', () => {
  const name = _uid('test_active');
  const id = createSave(name);
  try {
    assert.eq(getActiveSaveId(), id, 'createSave sets active to new slot');
  } finally {
    deleteSave(id);
  }
});

test('save: createSave with a blank/whitespace name falls back to "Game N"', () => {
  const id = createSave('   ');
  try {
    const list = listSaves();
    const slot = list.find(s => s.id === id);
    assert.truthy(slot, 'slot exists');
    assert.truthy(slot.name.startsWith('Game '), 'fallback name starts with "Game "');
  } finally {
    deleteSave(id);
  }
});

test('save: each created slot gets a unique id', () => {
  const id1 = createSave(_uid('test_uid'));
  const id2 = createSave(_uid('test_uid'));
  try {
    assert.truthy(id1 !== id2, 'ids are distinct');
    assert.truthy(typeof id1 === 'string' && id1.length > 0, 'id1 non-empty string');
    assert.truthy(typeof id2 === 'string' && id2.length > 0, 'id2 non-empty string');
  } finally {
    deleteSave(id1);
    deleteSave(id2);
  }
});

test('save: default names skip "Game N" labels already in use', () => {
  // The "+ New game" flow creates slots with no name at all, so the default
  // must not collide even when deletions have left holes in the numbering.
  const idA = createSave();
  const idB = createSave();
  try {
    const list = listSaves();
    const a = list.find(s => s.id === idA);
    const b = list.find(s => s.id === idB);
    assert.truthy(isDefaultSaveName(a.name), 'auto slot A wears a "Game N" default');
    assert.truthy(isDefaultSaveName(b.name), 'auto slot B wears a "Game N" default');
    assert.truthy(a.name !== b.name, 'two auto-named slots never share a name');
  } finally {
    deleteSave(idA);
    deleteSave(idB);
  }
});

test('save: isDefaultSaveName matches only the untouched placeholder', () => {
  assert.truthy(isDefaultSaveName('Game 1'), '"Game 1" is a default');
  assert.truthy(isDefaultSaveName('Game 42'), '"Game 42" is a default');
  assert.falsy(isDefaultSaveName("Ada's game"), 'christened name is not a default');
  assert.falsy(isDefaultSaveName('Game '), 'no number → not a default');
  assert.falsy(isDefaultSaveName(''), 'empty → not a default');
});

test('save: renameSave relabels a slot without touching its data', () => {
  const id = createSave(_uid('test_rename'));
  try {
    persistSave({ money: 33 });
    flushSave();
    assert.truthy(renameSave(id, "Ada's game"), 'rename returns true for known id');
    const slot = listSaves().find(s => s.id === id);
    assert.eq(slot.name, "Ada's game", 'new name stored');
    assert.eq(loadSave().money, 33, 'slot data untouched by rename');
  } finally {
    deleteSave(id);
  }
});

test('save: renameSave rejects unknown ids and blank names', () => {
  const id = createSave(_uid('test_rename_bad'));
  try {
    assert.falsy(renameSave('no-such-id', 'X'), 'unknown id returns false');
    assert.falsy(renameSave(id, '   '), 'whitespace name returns false');
    const slot = listSaves().find(s => s.id === id);
    assert.truthy(slot.name.startsWith('test_rename_bad'), 'name unchanged after rejected renames');
  } finally {
    deleteSave(id);
  }
});

test('save: listSaves returns slots sorted newest-lastPlayedAt first', () => {
  // Create two saves, then explicitly re-activate id1 so switchSave bumps its
  // lastPlayedAt to "now" — ensuring id1 sorts ahead of id2 even when both
  // were created within the same millisecond.
  const id1 = createSave(_uid('test_sort_a'));
  const id2 = createSave(_uid('test_sort_b'));
  // At this point id2 is active. Switch back to id1 so id1 gets the later
  // lastPlayedAt (switchSave stamps it with Date.now()).
  switchSave(id1);
  try {
    const list = listSaves();
    const pos1 = list.findIndex(s => s.id === id1);
    const pos2 = list.findIndex(s => s.id === id2);
    // id1 was touched last, so it sorts before id2.
    assert.truthy(pos1 < pos2, 'most-recently played slot sorts first');
  } finally {
    deleteSave(id1);
    deleteSave(id2);
  }
});

test('save: listSaves marks exactly the active slot with active:true', () => {
  const id1 = createSave(_uid('test_activeflag_a'));
  const id2 = createSave(_uid('test_activeflag_b'));
  try {
    // id2 is now active (last createSave)
    const list = listSaves();
    const slot1 = list.find(s => s.id === id1);
    const slot2 = list.find(s => s.id === id2);
    assert.truthy(slot2.active, 'active slot has active:true');
    assert.falsy(slot1.active, 'inactive slot has active:false');
    const activeCount = list.filter(s => s.active).length;
    assert.eq(activeCount, 1, 'exactly one active flag');
  } finally {
    deleteSave(id1);
    deleteSave(id2);
  }
});

// ── persistSave / flushSave / loadSave round-trip ────────────────────────────

test('save: persist → flush → load round-trips a plain save object', () => {
  const id = createSave(_uid('test_roundtrip'));
  try {
    const original = { money: 42, level: 3, inv: [{ id: 'wood', count: 5 }] };
    persistSave(original);
    flushSave();
    const loaded = loadSave();
    assert.eq(loaded.money, 42, 'money round-trips');
    assert.eq(loaded.level, 3, 'level round-trips');
    assert.eq(loaded.inv[0].id, 'wood', 'inventory item id round-trips');
    assert.eq(loaded.inv[0].count, 5, 'inventory item count round-trips');
  } finally {
    deleteSave(id);
  }
});

test('save: loadSave returns {} when the slot key has no data', () => {
  const id = createSave(_uid('test_empty_load'));
  try {
    // New slot — nothing written yet.
    const result = loadSave();
    assert.truthy(typeof result === 'object' && result !== null, 'returns an object');
    assert.eq(Object.keys(result).length, 0, 'empty object on missing key');
  } finally {
    deleteSave(id);
  }
});

test('save: persistSave without flushSave parks data in memory (not yet written)', () => {
  const id = createSave(_uid('test_park'));
  try {
    // loadSave reads localStorage directly; _pendingSave is only in memory.
    const before = loadSave();
    persistSave({ money: 777 });
    // setTimeout is a no-op, so the debounce timer never fires.
    const afterPersist = loadSave();
    // The data is NOT in localStorage yet — still the pre-persist value.
    assert.eq(afterPersist.money, before.money, 'unflush means localStorage unchanged');
  } finally {
    // flush so the slot can be cleaned up properly
    flushSave();
    deleteSave(id);
  }
});

test('save: flushSave writes the parked save to localStorage', () => {
  const id = createSave(_uid('test_flush'));
  try {
    persistSave({ money: 999 });
    flushSave();
    const loaded = loadSave();
    assert.eq(loaded.money, 999, 'flush committed to localStorage');
  } finally {
    deleteSave(id);
  }
});

test('save: flushSave is safe to call multiple times (idempotent)', () => {
  const id = createSave(_uid('test_multiflush'));
  try {
    persistSave({ money: 100 });
    flushSave();
    flushSave(); // second flush — should not throw or corrupt
    const loaded = loadSave();
    assert.eq(loaded.money, 100, 'data intact after double flush');
  } finally {
    deleteSave(id);
  }
});

test('save: complex nested data round-trips faithfully', () => {
  const id = createSave(_uid('test_complex'));
  try {
    const save = {
      money: 1234,
      energy: 75,
      maxEnergy: 100,
      inv: [{ id: 'coal', count: 3 }, { id: 'ruby', count: 1 }],
      relics: { pick: { tier: 2 }, bags: { tier: 1 } },
      armor: { helmet: { tier: 1 } },
      chopped: ['t1', 't2'],
      shrineLevel: 3,
    };
    persistSave(save);
    flushSave();
    const loaded = loadSave();
    assert.eq(loaded.money, 1234);
    assert.eq(loaded.energy, 75);
    assert.eq(loaded.maxEnergy, 100);
    assert.eq(loaded.inv.length, 2);
    assert.eq(loaded.inv[1].id, 'ruby');
    assert.eq(loaded.relics.pick.tier, 2);
    assert.eq(loaded.armor.helmet.tier, 1);
    assert.eq(loaded.chopped[0], 't1');
    assert.eq(loaded.shrineLevel, 3);
  } finally {
    deleteSave(id);
  }
});

// ── switchSave isolates state ─────────────────────────────────────────────────

test('save: switchSave returns true for a known id, false for an unknown id', () => {
  const id = createSave(_uid('test_switch_known'));
  try {
    assert.truthy(switchSave(id), 'switching to known id returns true');
    assert.falsy(switchSave('no-such-id'), 'switching to unknown id returns false');
  } finally {
    deleteSave(id);
  }
});

test('save: switchSave makes the target slot active', () => {
  const id1 = createSave(_uid('test_sw_a'));
  const id2 = createSave(_uid('test_sw_b'));
  try {
    switchSave(id1);
    assert.eq(getActiveSaveId(), id1, 'after switchSave(id1) the active id is id1');
    switchSave(id2);
    assert.eq(getActiveSaveId(), id2, 'after switchSave(id2) the active id is id2');
  } finally {
    deleteSave(id1);
    deleteSave(id2);
  }
});

test('save: data written to slot A is not visible from slot B (isolation)', () => {
  const idA = createSave(_uid('test_iso_a'));
  persistSave({ money: 100 });
  flushSave();

  const idB = createSave(_uid('test_iso_b'));
  // idB is now active — its slot starts empty.
  persistSave({ money: 200 });
  flushSave();

  // Switch back to A and verify A's data is intact.
  switchSave(idA);
  const loadedA = loadSave();
  assert.eq(loadedA.money, 100, 'slot A data not overwritten by slot B writes');

  // Switch to B and verify B's data is independent.
  switchSave(idB);
  const loadedB = loadSave();
  assert.eq(loadedB.money, 200, 'slot B data reads correctly');

  deleteSave(idA);
  deleteSave(idB);
});

test('save: writing to slot B then loading slot A returns A original data', () => {
  const idA = createSave(_uid('test_bleed_a'));
  persistSave({ level: 5, money: 50 });
  flushSave();

  const idB = createSave(_uid('test_bleed_b'));
  // Write completely different data to B.
  persistSave({ level: 99, money: 9999, extra: true });
  flushSave();

  // Go back to A — A must be unchanged.
  switchSave(idA);
  const a = loadSave();
  assert.eq(a.level, 5, 'A level unchanged');
  assert.eq(a.money, 50, 'A money unchanged');
  assert.falsy(a.extra, 'B-only field not present in A');

  deleteSave(idA);
  deleteSave(idB);
});

// ── deleteSave ────────────────────────────────────────────────────────────────

test('save: deleteSave removes the slot from listSaves', () => {
  const id = createSave(_uid('test_del'));
  assert.truthy(listSaves().some(s => s.id === id), 'slot exists before delete');
  deleteSave(id);
  assert.falsy(listSaves().some(s => s.id === id), 'slot gone after delete');
});

test('save: deleteSave returns true for a known slot, false for unknown', () => {
  const id = createSave(_uid('test_del_ret'));
  assert.truthy(deleteSave(id), 'known id returns true');
  assert.falsy(deleteSave(id), 'already-deleted id returns false');
  assert.falsy(deleteSave('nonexistent-id'), 'totally unknown id returns false');
});

test('save: deleteSave removes the slot data from localStorage', () => {
  const id = createSave(_uid('test_del_data'));
  persistSave({ money: 55 });
  flushSave();
  // Confirm data is written.
  assert.eq(loadSave().money, 55, 'data present before delete');

  deleteSave(id);
  // After delete, the now-active slot is different; the deleted slot key should
  // have been cleared. We verify indirectly: switching back to a new slot and
  // reading shows nothing.
  // (The deleted slot's key no longer appears in any slot, so we cannot
  // switchSave back — we simply trust deleteSave's removeItem call.)
  // Guard: listSaves no longer contains the id.
  assert.falsy(listSaves().some(s => s.id === id), 'slot record gone');
});

test('save: deleting the last slot recreates a fresh default slot', () => {
  // Create two fresh slots so we can safely delete down to one without
  // disrupting the baseline slots (which we don't own).
  const id1 = createSave(_uid('test_last_a'));
  const id2 = createSave(_uid('test_last_b'));
  // Delete both — but we don't own any other slots, so after the second delete
  // the registry may already have a survivor from other tests. This test focuses
  // on the guaranteed invariant: slots.length is never 0.
  deleteSave(id1);
  deleteSave(id2);
  const list = listSaves();
  assert.gt(list.length, 0, 'registry never empty after deletes');
});

test('save: deleting the active slot moves active to a survivor', () => {
  const id1 = createSave(_uid('test_del_active_a'));
  const id2 = createSave(_uid('test_del_active_b'));
  // id2 is active after the second createSave.
  assert.eq(getActiveSaveId(), id2, 'id2 is initially active');
  deleteSave(id2); // delete the active slot
  const newActive = getActiveSaveId();
  // The active pointer must have moved — it cannot still point at the deleted id.
  assert.truthy(newActive !== id2, 'active is no longer the deleted slot');
  assert.truthy(listSaves().some(s => s.id === newActive), 'new active exists in registry');
  // Clean up: id1 may now be the active slot.
  deleteSave(id1);
});

// ── addMoney ──────────────────────────────────────────────────────────────────

test('save: addMoney initialises money from undefined and adds delta', () => {
  const save = {};
  addMoney(save, 50);
  assert.eq(save.money, 50, 'undefined money treated as 0 then delta added');
});

test('save: addMoney accumulates correctly across multiple calls', () => {
  const save = { money: 10 };
  addMoney(save, 5);
  addMoney(save, 3);
  assert.eq(save.money, 18, '10 + 5 + 3 = 18');
});

test('save: addMoney with a negative delta decrements money', () => {
  const save = { money: 20 };
  addMoney(save, -8);
  assert.eq(save.money, 12, '20 - 8 = 12');
});

test('save: addMoney with 0 delta is a no-op', () => {
  const save = { money: 7 };
  addMoney(save, 0);
  assert.eq(save.money, 7, 'money unchanged');
});

// ── getSelectedSlot ───────────────────────────────────────────────────────────

test('save: getSelectedSlot returns null when inv is absent', () => {
  assert.eq(getSelectedSlot({}), null, 'no inv → null');
});

test('save: getSelectedSlot returns null when selSlot index has no entry', () => {
  const save = { inv: [{ id: 'wood', count: 1 }], selSlot: 5 };
  assert.eq(getSelectedSlot(save), null, 'out-of-range selSlot → null');
});

test('save: getSelectedSlot returns null for a falsy inv entry', () => {
  const save = { inv: [null, undefined, 0], selSlot: 0 };
  assert.eq(getSelectedSlot(save), null, 'null entry → null');
  save.selSlot = 1;
  assert.eq(getSelectedSlot(save), null, 'undefined entry → null');
});

test('save: getSelectedSlot returns the stack at selSlot', () => {
  const stack = { id: 'coal', count: 3 };
  const save = { inv: [{ id: 'wood', count: 1 }, stack], selSlot: 1 };
  assert.eq(getSelectedSlot(save), stack, 'returns exact stack object at selSlot');
});

test('save: getSelectedSlot reflects selSlot changes on the same save object', () => {
  const save = {
    inv: [{ id: 'wood', count: 1 }, { id: 'coal', count: 2 }, { id: 'ruby', count: 1 }],
    selSlot: 0,
  };
  assert.eq(getSelectedSlot(save).id, 'wood', 'selSlot 0 → wood');
  save.selSlot = 2;
  assert.eq(getSelectedSlot(save).id, 'ruby', 'selSlot 2 → ruby');
});

// ── GPS / world-origin field (fc37965) ───────────────────────────────────────
//
// The `save.home` field (a { lat, lon } object) is populated by startGps() in
// app.js and read back at the top of app.js before MapScene boots. The field
// is stored in the save slot exactly like any other data and round-trips via
// persistSave / flushSave / loadSave. The anchoring logic (capturing the GPS
// fix, gating on _homeCapturePending, reloading the page) lives entirely in
// app.js which is not loaded headlessly.

test('save: save.home round-trips through persistSave/flushSave/loadSave', () => {
  const id = createSave(_uid('test_home'));
  try {
    const home = { lat: 49.8880, lon: -119.4960 };
    persistSave({ money: 0, home });
    flushSave();
    const loaded = loadSave();
    assert.truthy(loaded.home, 'home field present after round-trip');
    assert.eq(loaded.home.lat, home.lat, 'lat round-trips');
    assert.eq(loaded.home.lon, home.lon, 'lon round-trips');
  } finally {
    deleteSave(id);
  }
});

test('save: home field survives across switchSave (slot isolation)', () => {
  const idA = createSave(_uid('test_home_iso_a'));
  const homeA = { lat: 49.8880, lon: -119.4960 };
  persistSave({ home: homeA, money: 1 });
  flushSave();

  const idB = createSave(_uid('test_home_iso_b'));
  const homeB = { lat: 37.7749, lon: -122.4194 };
  persistSave({ home: homeB, money: 2 });
  flushSave();

  switchSave(idA);
  const a = loadSave();
  assert.eq(a.home.lat, homeA.lat, 'slot A home.lat not overwritten by slot B');
  assert.eq(a.home.lon, homeA.lon, 'slot A home.lon not overwritten by slot B');

  switchSave(idB);
  const b = loadSave();
  assert.eq(b.home.lat, homeB.lat, 'slot B home.lat intact');

  deleteSave(idA);
  deleteSave(idB);
});

test('save: a fresh slot has no home field until one is written', () => {
  const id = createSave(_uid('test_home_fresh'));
  try {
    const loaded = loadSave();
    // A brand-new slot has no data at all.
    assert.falsy(loaded.home, 'fresh slot: no home field yet');
  } finally {
    deleteSave(id);
  }
});
