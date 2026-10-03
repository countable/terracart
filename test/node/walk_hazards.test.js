(function () {
const lift = name => new Function('dt', 'x0', 'y0', 'x1', 'y1',
  SCENE_SRC.match(new RegExp('\\n  ' + name + '\\(dt, x0, y0, x1, y1\\) \\{([\\s\\S]*?)\\n  \\}\\n'))[1]);
const tick = lift('_tickWalkHazards');
const exposure = new Function('x0', 'y0', 'x1', 'y1', 'visit',
  SCENE_SRC.match(/\n  _walkHazardExposure\(x0, y0, x1, y1, visit\) \{([\s\S]*?)\n  \}\n/)[1]);
const occupied = new Function('tx', 'ty', 'cx', 'cy',
  SCENE_SRC.match(/\n  _walkHazardCell\(tx, ty, cx, cy\) \{([\s\S]*?)\n  \}\n/)[1]);
function scene(overrides = {}) {
  return Object.assign({ startWorldM: {x: 0, y: 0}, originPx: {x: 0, y: 0},
    mPerPx: 1, cellsPerTile: 32, cellM: 8, tileEdgeM: 256,
    save: {energy: 100}, _walkHazardExposure: exposure, _walkHazardCell: () => 1,
    _losePlayerEnergy(n) { const lost = Math.min(n, this.save.energy); this.save.energy -= lost; return lost; },
    _popEnergy() {}, _bankDrain() {},
  }, overrides);
}

test('walk hazards: entry hit plus one energy per contact second at different frame rates', () => {
  for (const frames of [1, 10, 30, 60, 144]) {
    const s = scene();
    for (let i = 0; i < frames * 3; i++) tick.call(s, 1 / frames, i / frames, 4, (i + 1) / frames, 4);
    assert.eq(s.save.energy, 92, frames + ' fps');
    tick.call(s, 2, 3, 4, 3, 4);
    assert.eq(s.save.energy, 90, 'standing contact continues draining');
  }
});

test('walk hazards: charred spikes drain two per second at every frame rate', () => {
  assert.eq(walkHazardDamageRate({kind: 'stakes', _street: 'burned'}), 2);
  assert.eq(walkHazardDamageRate({kind: 'stakes', _street: 'barricade'}), 0);
  assert.eq(walkHazardDamageRate({kind: 'stakes'}), 0);
  assert.eq(walkHazardDamageRate({kind: 'wildplant', crop: 'barricade'}), 2);
  assert.eq(walkHazardDamageRate({kind: 'wildplant', crop: 'shrub', _streetArt: 'bramble'}), 1);
  for (const frames of [1, 30, 60, 144]) {
    const s = scene({_walkHazardCell: () => 2});
    for (let i = 0; i < frames * 3; i++) tick.call(s, 1 / frames, i / frames, 4, (i + 1) / frames, 4);
    assert.eq(s.save.energy, 89, frames + ' fps');
    tick.call(s, 1, 3, 4, 3, 4);
    assert.eq(s.save.energy, 87, 'stationary spikes keep draining');
  }
});

test('walk hazards: mixed cells charge their own rates along one step', () => {
  for (const frames of [1, 3, 60]) {
    const s = scene({_walkHazardCell: (tx, ty, x, y) => x === 0 ? 1 : x === 1 ? 2 : 0});
    for (let i = 0; i < frames; i++) tick.call(s, 3 / frames, 24 * i / frames, 4, 24 * (i + 1) / frames, 4);
    assert.eq(s.save.energy, 87, 'each obstacle entry plus one second in each rate');
  }
});

test('walk hazards: crossing a complete obstacle cell charges only time inside it', () => {
  for (const frames of [1, 3, 24, 120]) {
    const s = scene({_walkHazardCell: (tx, ty, x, y) => tx === 0 && ty === 0 && x === 1 && y === 0});
    for (let i = 0; i < frames; i++) tick.call(s, 3 / frames, 24 * i / frames, 4, 24 * (i + 1) / frames, 4);
    assert.eq(s.save.energy, 94, 'one entry plus one of three seconds in cell at ' + frames + ' steps');
  }
});

test('walk hazards: a pause keeps fractional cost and continues contact damage', () => {
  const s = scene();
  tick.call(s, .5, 0, 4, 1, 4);
  tick.call(s, .25, 1, 4, 1, 4);
  assert.eq(s.save.energy, 95);
  tick.call(s, .5, 1, 4, 2, 4);
  assert.eq(s.save.energy, 94);
  s.save.energy = 0;
  tick.call(s, 1, 2, 4, 3, 4);
  assert.eq(s.save.energy, 0);
});

test('walk hazards: arrival charges only the moving portion of a frame', () => {
  const followBody = SCENE_SRC.match(/\n  _followStep\(dt, capMS\) \{([\s\S]*?)\n  \}\n/)[1];
  const follow = new Function('dt', 'capMS', 'WALK_M_S', 'DEBUG_SPEED_MUL', 'FOLLOW_RAMP_M', followBody);
  const s = scene({playerM: {x: 0, y: 4}, _targetM: {x: 2, y: 4},
    _busyWheel: () => false, _stickPushed: () => false, _cellBlocked: () => false,
    _playDirected() {}, feetOffsetM: 0, compassDeg: 0});
  const moving = follow.call(s, 10, 1, 2, 5, 20);
  assert.eq(moving, 2, 'arrives in two seconds despite a ten-second frame');
  tick.call(s, moving, 0, 4, s.playerM.x, s.playerM.y);
  assert.eq(s.save.energy, 93);
});

test('walk hazards: tile seams and differently sized Mercator rows use their own grids', () => {
  const seen = [];
  const s = scene({cellsForRow: ty => ty === 0 ? 32 : 16,
    _walkHazardCell(tx, ty, x, y) { seen.push([tx, ty, x, y].join(',')); return true; }});
  tick.call(s, 1, 252, 252, 264, 264);
  assert.eq(s.save.energy, 89);
  assert.includes(seen, '0,0,31,31');
  assert.includes(seen, '1,1,0,0');
});

test('walk hazards: live occupancy excludes harvested, chopped, burned and ordinary props', () => {
  const key = WorldGen.tileKey(0, 0), previous = WorldGen.tileCache.get(key);
  const s = scene({_walkHazardCell: occupied});
  const bramble = {id: 'bramble', kind: 'wildplant', crop: 'shrub', _plantArt: 'bramble', x: 4, y: 4};
  const spikes = {id: 'spikes', kind: 'stakes', _street: 'burned', x: 4, y: 4};
  const entry = {_spawned: true, cellsPerEdge: 32, tileEdgeM: 256, objects: [spikes], wildplants: [bramble]};
  WorldGen.tileCache.set(key, entry);
  try {
    assert.truthy(occupied.call(s, 0, 0, 0, 0));
    tick.call(s, 1, 2, 4, 6, 4);
    assert.eq(s.save.energy, 93, 'overlap charges one entry and the maximum continuous rate');
    assert.eq(occupied.call(s, 0, 0, 0, 0), 2);
    s.save.burnedObjects = ['spikes'];
    assert.eq(occupied.call(s, 0, 0, 0, 0), 1, 'bramble alone costs one');
    s.save.picked = ['bramble']; s.save.burnedObjects = ['spikes'];
    assert.falsy(occupied.call(s, 0, 0, 0, 0));
    s.save.picked = []; s.save.chopped = ['bramble'];
    assert.falsy(occupied.call(s, 0, 0, 0, 0));
    s.save.chopped = []; bramble.chopped = true;
    assert.falsy(occupied.call(s, 0, 0, 0, 0));
    bramble.chopped = false; delete bramble._plantArt; delete spikes._street; s.save.burnedObjects = [];
    assert.eq(occupied.call(s, 0, 0, 0, 0), 0, 'ordinary stakes are not charred spike hazards');
    const before = s.save.energy;
    tick.call(s, 1, 12, 4, 4, 4);
    tick.call(s, 1, 4, 4, 4, 4);
    assert.eq(s.save.energy, before, 'ordinary stakes cause neither entry nor standing damage');
    s.save.picked = ['spikes'];
    assert.falsy(occupied.call(s, 0, 0, 0, 0), 'cleared spikes and ordinary shrubs are harmless');
    bramble.crop = 'barricade';
    assert.truthy(occupied.call(s, 0, 0, 0, 0));
    assert.falsy(occupied.call(s, 0, 0, 1, 0), 'nearby spatial bucket does not extend its occupied cell');
  } finally {
    if (previous) WorldGen.tileCache.set(key, previous); else WorldGen.tileCache.delete(key);
  }
});
test('walk hazards: barricades slow like spikes and clearing releases the same feet cell', () => {
  const slow = new Function(SCENE_SRC.match(/\n  _walkHazardSlow\(\) \{([\s\S]*?)\n  \}\n/)[1]);
  const key = WorldGen.tileKey(0,0), previous = WorldGen.tileCache.get(key);
  const barricade = {id:'slow_barricade',kind:'wildplant',crop:'barricade',x:4,y:4};
  const s = scene({_walkHazardCell:occupied, playerToWorldCell: () => ({tx:0,ty:0,cx:.5,cy:.5})});
  WorldGen.tileCache.set(key,{_spawned:true,cellsPerEdge:32,tileEdgeM:256,objects:[],wildplants:[barricade]});
  try {
    assert.truthy(slow.call(s));
    tick.call(s,1,4,4,4,4);
    assert.eq(s.save.energy,93);
    s.save.picked = [barricade.id];
    assert.falsy(slow.call(s), 'no movement or street-cell change needed');
    tick.call(s,1,4,4,4,4);
    assert.eq(s.save.energy,93, 'harvest ends damage at once');
    s.save.picked = [];
    s.save.burnedObjects = [barricade.id];
    assert.falsy(slow.call(s), 'burned barricades also release slowdown');
    const entry = WorldGen.tileCache.get(key);
    entry.objects.push({id:'ordinary_stake',kind:'stakes',x:4,y:4});
    entry.slowCells = new Map([[0, 'stakes']]);
    assert.truthy(slow.call(s), 'ordinary stakes retain their existing slowdown');
    const energy = s.save.energy;
    tick.call(s, 1, 4, 4, 4, 4);
    assert.eq(s.save.energy, energy, 'ordinary stakes do not gain spike damage');
    s.save.picked = ['ordinary_stake'];
    assert.falsy(slow.call(s), 'clearing ordinary stakes also releases slowdown');
  } finally { if(previous) WorldGen.tileCache.set(key,previous); else WorldGen.tileCache.delete(key); }
});

test('walk hazards: exiting and reentering charges another entry, standing never repeats it', () => {
  const s = scene({_walkHazardCell: (tx,ty,x) => x === 1 ? 2 : 0});
  tick.call(s, 1, 4, 4, 12, 4);
  assert.eq(s.save.energy,94, 'entry plus half a second at two per second');
  tick.call(s, 1, 12, 4, 12, 4);
  assert.eq(s.save.energy,92);
  tick.call(s, 1, 12, 4, 20, 4);
  assert.eq(s.save.energy,91);
  tick.call(s, 1, 20, 4, 12, 4);
  assert.eq(s.save.energy,85, 'reentry bites again');
});
test('walk hazards: armour shield difficulty and immortality share incoming damage rules', () => {
  for (const mode of ['easy','hard']) {
    const s = scene({save:{energy:100,mode,armor:{boots:{tier:4}},shieldPotionUntil:Date.now()+100000}});
    const expected = Math.floor(Combat.incomingDamage(s.save, 5) + Combat.incomingDamage(s.save, 1) * 2);
    tick.call(s, 2, 4, 4, 4, 4);
    assert.eq(s.save.energy,100-expected);
  }
  const s = scene({save:{energy:100,immortalPotionUntil:Date.now()+100000}});
  tick.call(s, 1, 4, 4, 4, 4);
  assert.eq(s.save.energy,100);
  s.save.immortalPotionUntil = 0;
  tick.call(s, 1, 4, 4, 4, 4);
  assert.eq(s.save.energy,99, 'immunity ending while inside does not invent a new entry');
});
})();
