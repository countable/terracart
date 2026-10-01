(function () {
function scene(overrides = {}) {
  return Object.assign(new SceneFire(), {
    save: { energy: 100, inv: [{ id: 'explosive_flask', count: 2 }], selSlot: 0 },
    startWorldM: { x: 0, y: 0 }, playerM: { x: 4, y: 4 },
    originPx: { x: 0, y: 0 }, mPerPx: 1, cellsPerTile: 32, cellM: 8,
    depth: 0, facing: { x: 0, y: 1 }, _shots: [], inventoryBuilds: 0, burns: 0,
    buildInventoryDOM() { this.inventoryBuilds++; },
    _ignitePlayer() { this.burns++; },
    _groundFireFuel() { return []; },
  }, overrides);
}

test('scene fire: throwing consumes one selected flask and aims at the vision boundary', () => {
  const s = scene();
  assert.truthy(s.useExplosiveFlask());
  assert.eq(s.save.inv[0].count, 1);
  assert.eq(s.inventoryBuilds, 1);
  assert.eq(s._shots.length, 1);
  const shot = s._shots[0];
  assert.eq(shot.x, 4); assert.eq(shot.y, 4);
  assert.eq(shot.vx, 0); assert.eq(shot.vy, 1);
  assert.eq(shot.rangeM, Fog.REVEAL_CELLS * s.cellM);
  assert.truthy(s.useExplosiveFlask());
  assert.eq(s.save.inv.length, 0);
  assert.eq(s.save.selSlot, -1);
  assert.falsy(s.useExplosiveFlask());
  assert.eq(s._shots.length, 2);
});

test('scene fire: downed players and invalid headings keep their flask', () => {
  for (const overrides of [{ facing: { x: 0, y: 0 } },
    { save: { energy: 0, inv: [{ id: 'explosive_flask', count: 1 }], selSlot: 0 } }]) {
    const s = scene(overrides), count = s.save.inv[0].count;
    assert.falsy(s.useExplosiveFlask());
    assert.eq(s.save.inv[0].count, count);
    assert.eq(s._shots.length, 0);
    assert.eq(s.inventoryBuilds, 0);
  }
});

test('scene fire: flask explosion lights exactly the centered 3 by 3 square across a tile seam', () => {
  const s = scene({ depth: 2 });
  s._explodeFlask({ x: 252, y: 252 });
  assert.eq(Object.keys(s.save.groundFire).length, 9);
  for (let y = 30; y <= 32; y++) for (let x = 30; x <= 32; x++) {
    assert.truthy(s.save.groundFire[GroundFire.key(2, x, y)]);
  }
  s._explodeFlask({ x: 252, y: 252 });
  assert.eq(Object.keys(s.save.groundFire).length, 9, 'burn history prevents a second ignition');
});

test('scene fire: standing in fire refreshes burning and leaving or changing depth stops exposure', () => {
  const s = scene();
  s._igniteGroundAtWorld(4, 4);
  s._tickGroundFire();
  s._tickGroundFire();
  assert.eq(s.burns, 2, 'stationary player is exposed each tick');
  s.playerM.x = 12;
  s._tickGroundFire();
  assert.eq(s.burns, 2);
  s.playerM.x = 4; s.depth = 1;
  s._tickGroundFire();
  assert.eq(s.burns, 2, 'fire on another floor cannot burn the player');
  s.depth = 0;
  s._tickGroundFire();
  assert.eq(s.burns, 3, 'returning to a live burning cell applies burning');
});

test('scene fire: expired fuel destruction survives reload on another floor and preserves trees', () => {
  const original = scene({ _groundFireFuel() {
    return [{ id: 'grass', kind: 'wildplant', crop: 'longgrass' },
      { id: 'tar', kind: 'tar' }, { id: 'tree', kind: 'tree' },
      { id: 'fruit', kind: 'fruittree' }];
  } });
  original._igniteGroundCell({ cellIX: 0, cellIY: 0 }, Date.now() - 40000);
  const saved = JSON.parse(JSON.stringify(original.save));
  const s = scene({ save: saved, depth: 3 });
  s.save.burnedObjects = ['already-burned'];
  s._tickGroundFire();
  const fire = s.save.groundFire[GroundFire.key(0, 0, 0)];
  assert.truthy(fire.extinguished);
  assert.eq(s._groundFireIndex().size, 0);
  assert.truthy(s.save.burnedObjects.includes('grass'));
  assert.truthy(s.save.burnedObjects.includes('tar'));
  assert.truthy(s.save.burnedObjects.includes('already-burned'));
  assert.falsy(s.save.burnedObjects.includes('tree'));
  assert.falsy(s.save.burnedObjects.includes('fruit'));
  assert.eq(s.burns, 0);
  s.depth = 0;
  assert.falsy(s._igniteGroundAtWorld(4, 4));
  s._tickGroundFire();
  assert.eq(s.save.burnedObjects.length, 3, 'expiry is idempotent');
});

test('scene fire: a diagonal trail includes a briefly crossed corner cell', () => {
  const s = scene();
  s._igniteGroundSegment(7.8, 7, 8.2, 10);
  for (const [x, y] of [[0, 0], [0, 1], [1, 1]]) {
    assert.truthy(s.save.groundFire[GroundFire.key(0, x, y)], `crossed cell ${x},${y}`);
  }
  assert.eq(Object.keys(s.save.groundFire).length, 3);
});
})();
