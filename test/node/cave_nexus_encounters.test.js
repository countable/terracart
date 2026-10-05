(() => {
  const spawn = new Function('entry', 'tx', 'ty', 'depth', SPAWN_CAVE_SRC.replace(/\n\s*\}\s*$/, ''));
  function fixture() {
    const N = 30, cellM = 10;
    const seat = { id: 'cave-area:grove:1:skeleton:4:2', kind: 'skeleton', x: 145, y: 145,
      depth: 1, caveArea: 'grove:1', hidden: true, dormant: true, revealDistanceCells: 1 };
    return { seat, entry: { cellsPerEdge: N, tileEdgeM: N * cellM,
      grid: new Uint8Array(N * N).fill(24), objects: [],
      caveAreas: { encounters: [seat], reserved: new Set([14 * N + 14]) },
      undergroundReserved: new Set([14 * N + 14]) },
    scene: { tileEdgeM: N * cellM, save: { caught: [] } } };
  }
  test('cave nexus encounters: authored low-depth skeleton uses shared factory and finite caught ledger', () => {
    const f = fixture();
    spawn.call(f.scene, f.entry, 0, 0, 1);
    const c = f.entry.creatures.find(c => c.id === f.seat.id);
    assert.truthy(c);
    assert.truthy(Combat.isConcealed(c));
    assert.falsy(Combat.isEnemy(c));
    assert.eq(c.depth, 1);
    assert.eq(c.revealDistanceCells, 1);
    assert.eq(f.entry.creatures.filter(o => o.x === c.x && o.y === c.y).length, 1,
      'ordinary spawns cannot double an authored seat');
    const before = f.entry.creatures.length;
    spawn.call(f.scene, f.entry, 0, 0, 1);
    assert.eq(f.entry.creatures.length, before);
    f.scene.save.caught.push(c.id);
    delete f.entry.creatures;
    spawn.call(f.scene, f.entry, 0, 0, 1);
    assert.falsy(f.entry.creatures.some(c => c.id === f.seat.id));
    assert.truthy(f.entry._spawnOpts.occupied.has(434));
  });
  test('cave nexus encounters: actual objects, exclusions and player stairs reject seats', () => {
    for (const blocked of ['object', 'exclusion', 'player']) {
      const f = fixture();
      if (blocked === 'object') f.entry.objects.push({ kind: 'mineralrock', x: 145, y: 145 });
      if (blocked === 'player') { f.entry.genObjects = []; f.entry.objects.push({ kind: 'staircase', x: 145, y: 145, _synthetic: true }); }
      if (blocked === 'exclusion') { f.entry.spawnWhy = new Uint16Array(900); f.entry.spawnWhy[434] = WorldGen.SPAWN_WHY_ALL_FLOORS; }
      spawn.call(f.scene, f.entry, 0, 0, 1);
      assert.falsy(f.entry.creatures.some(c => c.id === f.seat.id), blocked);
    }
  });
  test('cave nexus encounters: a depth-one defeat does not consume the depth-two seat', () => {
    const f = fixture();
    f.scene.save.caught.push(f.seat.id);
    f.seat.id = 'cave-area:grove:2:skeleton:4:2';
    f.seat.depth = 2;
    spawn.call(f.scene, f.entry, 0, 0, 2);
    assert.truthy(f.entry.creatures.some(c => c.id === f.seat.id));
  });
  test('cave nexus encounters: exact proximity bypasses perception, suppresses targeting and latches across reload', () => {
    const scene = { save: {}, depth: 1, cellM: 10, startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 } };
    const c = WorldGen.makeCreature('skeleton', 10, 10, 'strict-hidden',
      { depth: 1, hidden: true, dormant: true, revealDistanceCells: 1 });
    const hasPerception = Gear.hasPerception;
    Gear.hasPerception = () => true;
    try {
      assert.truthy(enemyConcealmentTick(scene, c), 'diagonal distance is greater than one cell');
      assert.truthy(c.dormant);
      assert.falsy(Combat.isEnemy(c));
      scene.playerM.y = 10;
      assert.falsy(enemyConcealmentTick(scene, c));
      assert.falsy(c.dormant);
      assert.truthy(c._hunting);
      assert.truthy(Combat.isEnemy(c));
      scene.playerM.x = -100;
      const restored = { ...c, dormant: true, _discovered: false, _hunting: false };
      scene.save = JSON.parse(JSON.stringify(scene.save));
      assert.falsy(enemyConcealmentTick(scene, restored));
      assert.falsy(restored.dormant);
      assert.truthy(restored._hunting);
    } finally { Gear.hasPerception = hasPerception; }
  });
})();
