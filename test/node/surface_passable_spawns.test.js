// Prop occupancy must not erase a habitat's otherwise legal population.
(() => {
  const fixture = (road = false) => {
    const entry = { cellsPerEdge: 64, tileEdgeM: 640,
      grid: new Uint8Array(4096).fill(WorldGen.T.GRASS), objects: [] };
    if (road) {
      entry.streetArea = new Uint8Array(4096).fill(1);
      entry.streetAreaVariants = new Uint8Array(4096).fill(StreetVariants.VARIANT_BY_ID.way_of_variety.code);
    }
    return entry;
  };
  const run = (entry, occupied = new Set(), extra = {}) => WorldGen.runSteps(HabitatSpawns.populationSteps(
    { tileEdgeM: 640, cellM: 10 }, entry, 0, 0,
    { spawnOpts: { occupied }, skipLegacy: true, ...extra }));
  const signature = creatures => creatures.map(c => `${c.id}:${c.kind}@${c.x},${c.y}`).sort().join('|');
  const indexOf = c => Math.floor(c.y / 10) * 64 + Math.floor(c.x / 10);

  test('surface passable seats: animals and enemies retain their seats under passable props', () => {
    const baseline = run(fixture());
    assert.truthy(baseline.some(c => c._surfaceSpawn), 'fixture includes enemies');
    assert.truthy(baseline.some(c => !c._surfaceSpawn), 'fixture includes animals');
    const decorated = fixture();
    decorated.objects = baseline.map(c => ({ kind: 'bush', x: c.x, y: c.y }));
    const occupied = new Set(baseline.map(indexOf));
    assert.eq(signature(run(decorated, occupied)), signature(baseline));
    assert.truthy(baseline.every(c => occupied.has(indexOf(c))), 'later prop passes retain creature occupancy');
    assert.eq(new Set(baseline.map(indexOf)).size, baseline.length, 'creatures still reserve separate seats');
  });

  test('surface passable seats: pushable blockers and authored creatures exclude their cells', () => {
    const baseline = run(fixture()), animal = baseline.find(c => !c._surfaceSpawn);
    const enemy = baseline.find(c => c._surfaceSpawn);
    assert.truthy(animal); assert.truthy(enemy);
    const entry = fixture();
    entry.objects = [animal, enemy].map(c => ({ kind: 'rock', pushable: true, x: c.x, y: c.y }));
    const blocked = new Set([indexOf(animal), indexOf(enemy)]);
    const creatures = run(entry, new Set(blocked));
    assert.truthy(creatures.every(c => !blocked.has(indexOf(c))));
    const authored = run(fixture(), new Set(), { authoredCreatures: [animal, enemy] });
    assert.truthy(authored.every(c => !blocked.has(indexOf(c))), 'passable prop policy does not allow creature stacking');
  });

  test('surface passable seats: finite road encounters survive full prop coverage', () => {
    const baseline = run(fixture(true));
    const encounters = baseline.filter(c => c._spawnSource === 'feature-encounter');
    assert.eq(encounters.length, 3);
    const entry = fixture(true), occupied = new Set();
    for (let i = 0; i < 4096; i++) {
      occupied.add(i);
      entry.objects.push({ kind: 'bush', x: (i % 64 + .5) * 10, y: (Math.floor(i / 64) + .5) * 10 });
    }
    assert.eq(signature(run(entry, occupied)), signature(baseline));
    const guards = new Set(encounters.map(indexOf));
    const guarded = run(fixture(true), new Set(), { guardCells: guards });
    assert.eq(guarded.filter(c => c._spawnSource === 'feature-encounter').length, 3);
    assert.truthy(guarded.every(c => !guards.has(indexOf(c))));
  });

  test('surface passable seats: party extras ignore the prop occupancy ledger', () => {
    const entry = fixture(), occupied = new Set(Array.from({length:4096},(_,i)=>i));
    entry.zone={coverage:new Uint16Array(4096).fill(1),anchors:[{kind:'grove',variant:'meadow',key:'party-meadow'}]};
    const base = run(entry, occupied);
    entry.creatures = base;
    assert.truthy(base.some(c => c._spawnSource === 'zone-density'), 'fixture creates party-scaled zone enemies');
    const scaled = EnemyHabitats.scaleEncounters(entry,4,new Set());
    assert.gt(scaled.added.length,0, 'party policy still finds seats under passable props');
    assert.truthy(scaled.added.every(c => occupied.has(indexOf(c))), 'every extra shares a prop-ledger cell');
  });
})();
