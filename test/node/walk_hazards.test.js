(function () {
const lift = name => new Function('dt', 'x0', 'y0', 'x1', 'y1',
  SCENE_SRC.match(new RegExp('\\n  ' + name + '\\(dt, x0, y0, x1, y1\\) \\{([\\s\\S]*?)\\n  \\}\\n'))[1]);
const tick = lift('_tickWalkHazards');
const exposure = new Function('x0', 'y0', 'x1', 'y1',
  SCENE_SRC.match(/\n  _walkHazardExposure\(x0, y0, x1, y1\) \{([\s\S]*?)\n  \}\n/)[1]);
const occupied = new Function('tx', 'ty', 'cx', 'cy',
  SCENE_SRC.match(/\n  _walkHazardCell\(tx, ty, cx, cy\) \{([\s\S]*?)\n  \}\n/)[1]);
function scene(overrides = {}) {
  return Object.assign({ startWorldM: {x: 0, y: 0}, originPx: {x: 0, y: 0},
    mPerPx: 1, cellsPerTile: 32, cellM: 8, tileEdgeM: 256,
    save: {energy: 100}, _walkHazardExposure: exposure, _walkHazardCell: () => 1,
    _losePlayerEnergy(n) { const lost = Math.min(n, this.save.energy); this.save.energy -= lost; return lost; },
    _popEnergy() {},
  }, overrides);
}

test('walk hazards: exactly one energy per moving second at different frame rates', () => {
  for (const frames of [1, 10, 30, 60, 144]) {
    const s = scene();
    for (let i = 0; i < frames * 3; i++) tick.call(s, 1 / frames, i / frames, 4, (i + 1) / frames, 4);
    assert.eq(s.save.energy, 97, frames + ' fps');
    tick.call(s, 300, 3, 4, 3, 4);
    assert.eq(s.save.energy, 97, 'standing still does not drain');
  }
});

test('walk hazards: charred spikes drain two per second at every frame rate', () => {
  assert.eq(walkHazardDamageRate({kind: 'stakes', _street: 'burned'}), 2);
  assert.eq(walkHazardDamageRate({kind: 'stakes', _street: 'barricade'}), 0);
  assert.eq(walkHazardDamageRate({kind: 'wildplant', crop: 'barricade'}), 1);
  assert.eq(walkHazardDamageRate({kind: 'wildplant', crop: 'shrub', _streetArt: 'bramble'}), 1);
  for (const frames of [1, 30, 60, 144]) {
    const s = scene({_walkHazardCell: () => 2});
    for (let i = 0; i < frames * 3; i++) tick.call(s, 1 / frames, i / frames, 4, (i + 1) / frames, 4);
    assert.eq(s.save.energy, 94, frames + ' fps');
    tick.call(s, 100, 3, 4, 3, 4);
    assert.eq(s.save.energy, 94, 'stationary on spikes is harmless');
  }
});

test('walk hazards: mixed cells charge their own rates along one step', () => {
  for (const frames of [1, 3, 60]) {
    const s = scene({_walkHazardCell: (tx, ty, x, y) => x === 0 ? 1 : x === 1 ? 2 : 0});
    for (let i = 0; i < frames; i++) tick.call(s, 3 / frames, 24 * i / frames, 4, 24 * (i + 1) / frames, 4);
    assert.eq(s.save.energy, 97, 'one second bramble, one second spikes, one second bare ground');
  }
});

test('walk hazards: crossing a complete obstacle cell charges only time inside it', () => {
  for (const frames of [1, 3, 24, 120]) {
    const s = scene({_walkHazardCell: (tx, ty, x, y) => tx === 0 && ty === 0 && x === 1 && y === 0});
    for (let i = 0; i < frames; i++) tick.call(s, 3 / frames, 24 * i / frames, 4, 24 * (i + 1) / frames, 4);
    assert.eq(s.save.energy, 99, 'one of three seconds spent in crossed cell at ' + frames + ' steps');
  }
});

test('walk hazards: a pause keeps fractional walking cost without adding idle cost', () => {
  const s = scene();
  tick.call(s, .5, 0, 4, 1, 4);
  tick.call(s, 100, 1, 4, 1, 4);
  assert.eq(s.save.energy, 100);
  tick.call(s, .5, 1, 4, 2, 4);
  assert.eq(s.save.energy, 99);
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
  assert.eq(s.save.energy, 98);
});

test('walk hazards: tile seams and differently sized Mercator rows use their own grids', () => {
  const seen = [];
  const s = scene({cellsForRow: ty => ty === 0 ? 32 : 16,
    _walkHazardCell(tx, ty, x, y) { seen.push([tx, ty, x, y].join(',')); return true; }});
  tick.call(s, 1, 252, 252, 264, 264);
  assert.eq(s.save.energy, 99);
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
    assert.eq(s.save.energy, 98, 'overlapping bramble and spikes cost the larger two-energy rate once');
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
    assert.falsy(occupied.call(s, 0, 0, 0, 0), 'ordinary shrub and uncharred stakes are harmless');
    bramble.crop = 'barricade';
    assert.truthy(occupied.call(s, 0, 0, 0, 0));
    assert.falsy(occupied.call(s, 0, 0, 1, 0), 'nearby spatial bucket does not extend its occupied cell');
  } finally {
    if (previous) WorldGen.tileCache.set(key, previous); else WorldGen.tileCache.delete(key);
  }
});
})();
