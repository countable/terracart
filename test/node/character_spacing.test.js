(function () {
  function openScene() {
    return { cellM: 7, depth: 0, save: {}, cellAt: () => ({ loaded: true, type: WorldGen.T.GRASS }),
      _cellBlocked: () => false, _nearAny: () => false, _characterBodies: [] };
  }
  test('character spacing: overlapping pet and neighbour receive opposite pushes', () => {
    const s = openScene(), a = { id: 'pet_a', kind: 'cat', pet: true, x: 0, y: 0 }, b = { id: 'npc_b', kind: 'npc', x: 0, y: 0 };
    s._characterBodies = [a, b];
    const pa = characterSpacingPush(s, a), pb = characterSpacingPush(s, b);
    assert.truthy(Math.abs(pa.x + pb.x) < 1e-9 && Math.abs(pa.y + pb.y) < 1e-9, 'exact overlaps split instead of drifting together');
    for (let i = 0; i < 180; i++) for (const c of [a, b]) {
      const x = c.x, y = c.y;
      characterMove(s, c, c.x, c.y, i * 16, { pace: 0.03 });
      assert.lte(Math.hypot(c.x - x, c.y - y), 0.030000001);
    }
    assert.gt(Math.hypot(a.x - b.x, a.y - b.y), 0.5 * s.cellM);
  });
  test('character movement: hazards and obstacles cannot be crossed by long follower steps', () => {
    const s = openScene(), pet = { id: 'pet_step', kind: 'cat', pet: true, x: 0, y: 0 };
    s.cellAt = (x, y) => ({ loaded: true, type: x >= 2 && x <= 4 ? WorldGen.T.WATER : WorldGen.T.GRASS });
    characterMove(s, pet, 8, 0, 100, { allow: (x, y) => y === 0 });
    assert.lt(pet.x, 2, 'sweep stops before water even when endpoint is clear');
    s.cellAt = () => ({ loaded: true, type: WorldGen.T.GRASS });
    s._walkHazardExposure = (x0, y0, x1, y1) => y1 === 0 && x1 > x0 ? 1 : 0;
    s._walkHazardCell = () => 0;
    // The hazard-rate lookup uses world coordinates; provide the real frame.
    Object.assign(s, { originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, cellsPerTile: 64, mPerPx: 64 * 7 / WorldGen.TILE_PX });
    const before = { x: pet.x, y: pet.y };
    characterMove(s, pet, pet.x + 0.1, pet.y, 200);
    assert.truthy(Math.abs(pet.y - before.y) > 0, 'committed detour turns aside from damaging plants');
    assert.lte(Math.hypot(pet.x - before.x, pet.y - before.y), 0.100000001);
  });
  test('character movement: live traps are refused, disarmed traps permit steps', () => {
    const saved = [...WorldGen.tileCache]; WorldGen.tileCache.clear();
    const s = openScene();
    Object.assign(s, { originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, cellsPerTile: 64, mPerPx: 64 * 7 / WorldGen.TILE_PX });
    const trap = { id: 'trap_test', _ix: 1, _iy: 0 };
    WorldGen.tileCache.set(WorldGen.tileKey(0, 0), { traps: [trap] });
    const pet = { id: 'pet_trap', kind: 'cat', pet: true, x: 3.5, y: 3.5 };
    try {
      assert.truthy(creatureStepRefused(s, pet, 10.5, 3.5));
      s.save.disarmedTraps = [trap.id];
      assert.falsy(creatureStepRefused(s, pet, 10.5, 3.5));
    } finally { WorldGen.tileCache.clear(); for (const [k, v] of saved) WorldGen.tileCache.set(k, v); }
  });
  test('character placement: releases choose separate safe seats or wait', () => {
    const s = openScene(), first = { id: 'pet_first', kind: 'cat', pet: true, x: 0, y: 0 };
    s._characterBodies = [{ id: 'player', x: 0, y: 0 }];
    const a = characterFreePoint(s, first, 0, 0);
    assert.truthy(a); Object.assign(first, a); s._characterBodies.push(first);
    const b = characterFreePoint(s, { id: 'pet_next', kind: 'dog', pet: true }, 0, 0);
    assert.gte(Math.hypot(a.x - b.x, a.y - b.y), FOE_SPACING_CELLS * s.cellM);
    s.cellAt = () => ({ loaded: true, type: WorldGen.T.WATER });
    assert.eq(characterFreePoint(s, first, 0, 0), null, 'no unsafe player-position fallback');
  });
})();
