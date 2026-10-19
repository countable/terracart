// The camera owns timing; transactions remain exactly once even with stale events.
test('sleep presentation: commits once at black, then fades back without teleport effects', () => {
  let black, commits = 0;
  const events = [];
  const scene = Object.create(SceneFurniture.prototype);
  scene.cameras = { main: {
    once(event, callback) { assert.eq(event, 'camerafadeoutcomplete'); black = callback; },
    fadeOut() { events.push('out'); }, fadeIn() { events.push('in'); },
  } };
  assert.truthy(scene._presentSleep({ commit() { events.push('commit'); commits++; } }));
  assert.eq(commits, 0);
  assert.falsy(scene._presentSleep({ commit() { commits++; } }), 'no concurrent sleep');
  black(); black();
  assert.eq(commits, 1);
  assert.eq(events.join(','), 'out,commit,in');
  assert.falsy(scene._sleeping);
  assert.eq(scene._teleporting, undefined);
});

test('sleep presentation: headless fallback commits immediately exactly once', () => {
  const scene = Object.create(SceneFurniture.prototype);
  let commits = 0;
  assert.truthy(scene._presentSleep({ commit() { commits++; } }));
  assert.eq(commits, 1); assert.falsy(scene._sleeping);
});

test('bed: pending sleep rechecks Home ownership and picked-up furniture at commit', () => {
  for (const change of ['outdoors', 'pickup', 'locked', 'full']) {
    const record = { id: 'bed', itemId: 'bed_quilted', x: 2.5, y: 2.5, depth: 0 };
    const entry = { cellsPerEdge: 32, grid: new Uint8Array(1024).fill(WorldGen.T.BUILDING),
      owners: new Uint8Array(1024), ownerKeys: ['home'], objects: [] };
    const scene = Object.assign(Object.create(SceneFurniture.prototype), {
      save: { starterShopId: 'home', furniture: [record], energy: 30 },
      depth: 0, cellsPerTile: 32, tileEdgeM: 160,
      mPerPx: 5 / (WorldGen.TILE_PX / 32), originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
      getMaxEnergy: () => 100, _zeroEnergyLocked() { return this.locked; },
      flashAtPlayer() {}, _restoreEnergy() { throw new Error('stale sleep restored energy'); },
      _presentSleep({ commit }) { this.commit = commit; return true; },
    });
    const key = WorldGen.tileKey(0, 0), previous = WorldGen.tileCache.get(key);
    WorldGen.tileCache.set(key, entry);
    try {
      assert.truthy(scene.useFurniture(record));
      if (change === 'outdoors') entry.ownerKeys[0] = 'someone-else';
      if (change === 'pickup') scene.save.furniture = [];
      if (change === 'locked') scene.locked = true;
      if (change === 'full') scene.save.energy = 100;
      scene.commit();
    } finally {
      if (previous) WorldGen.tileCache.set(key, previous); else WorldGen.tileCache.delete(key);
    }
  }
});
