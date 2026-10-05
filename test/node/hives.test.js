(function () {
  test('hives: deterministic forest-only seats respect occupancy, roads and nexus coverage', () => {
    const N = 100, grid = new Uint8Array(N * N).fill(WorldGen.T.FOREST);
    const make = opts => WorldGen.spawnForestHives(grid, N, N, 4, 5, 1000, opts);
    const a = make({});
    assert.gt(a.length, 10);
    assert.eq(JSON.stringify(a), JSON.stringify(make({})));
    const first = a[0], ix = Math.floor((first.x - 4000) / 10), iy = Math.floor((first.y - 5000) / 10), cell = iy * N + ix;
    const occupied = new Set([cell]);
    assert.falsy(make({ occupied }).some(o => o.id === first.id));
    const coverage = new Uint8Array(N * N).fill(1);
    assert.eq(make({ zoneCoverage: coverage }).length, 0);
    const roadMask = new Uint8Array(N * N).fill(1);
    assert.eq(make({ roadMask }).length, 0);
    grid.fill(WorldGen.T.PARK);
    assert.eq(make({}).length, 0);
    grid.fill(WorldGen.T.ORCHARD);
    assert.eq(make({}).length, 0);
  });

  const source = /function planHiveBees\(scene, hive\) \{[\s\S]*?\n\}/.exec(CREATURE_AI_SRC)[0];
  function planner(destination) {
    return new Function('WorldGen', 'Delivery', 'creatureSpawnClass', 'walkableDestination',
      `${source}; return planHiveBees;`)(WorldGen, Delivery, () => 'enemy', destination);
  }
  test('hives: plans three distinct hostile bee births, or none when obstructed', () => {
    const entry = {}, hive = { id: 'testhive', x: 10, y: 10 };
    const plan = planner((scene, x, y, dist, opts) => {
      for (const x of [20, 30, 40]) if (opts.accept(x, 10)) return { x, y: 10, entry };
      return null;
    });
    const bees = plan({}, hive);
    assert.eq(bees.length, 3);
    assert.eq(new Set(bees.map(b => b.creature.x)).size, 3);
    for (const b of bees) assert.truthy(Combat.isEnemyKind(b.creature.kind));
    assert.eq(planner(() => null)({}, hive).length, 0);
    assert.falsy(entry.creatures, 'planning makes no partial writes');
  });

  test('hives: successful daily tap gives three syrup and three bees, refusal preserves day', () => {
    const oldPlan = globalThis.planHiveBees;
    const oldNow = Date.now;
    let now = Date.UTC(2026, 9, 3, 12);
    Date.now = () => now;
    const entry = { creatures: [] }, stories = [];
    globalThis.planHiveBees = planner((scene, x, y, dist, opts) => {
      for (const x of [20, 30, 40]) if (opts.accept(x, 10)) return { x, y: 10, entry };
      return null;
    });
    try {
      const save = {}, scene = makeScene({ save, showMessageModal: m => stories.push(m) });
      const hive = { kind: 'hive', id: 'dailyhive', x: 10, y: 10 };
      const tap = () => runInteractable(makeCtx(scene, save), hive);
      tap();
      assert.eq(scene.invCount('syrup'), 3);
      assert.eq(entry.creatures.length, 3);
      assert.truthy(Macros.usedToday(save, hive.id));
      assert.falsy(poiLit(hive, spentSets(null, save)));
      assert.falsy(isSpent(hive, spentSets(null, save)), 'spent hive stays visible');
      stories[0].onDismiss(); tap();
      assert.eq(scene.invCount('syrup'), 3);
      assert.eq(entry.creatures.length, 3);
      now += 86400000;
      tap();
      assert.eq(scene.invCount('syrup'), 6);
      assert.eq(entry.creatures.length, 6);
      assert.eq(new Set(entry.creatures.map(c => c.id)).size, 6, 'new day has fresh defender identities');
      stories[1].onDismiss();
      now += 86400000;
      globalThis.planHiveBees = () => [];
      tap();
      assert.falsy(Macros.usedToday(save, hive.id));
      assert.eq(scene.invCount('syrup'), 6);
      save.inv = [{ id: 'syrup', count: Inventory.stackCap(save) - 2 }];
      tap();
      assert.falsy(Macros.usedToday(save, hive.id), 'partial bag space does not spend visit');
      assert.eq(entry.creatures.length, 6);
      globalThis.planHiveBees = oldPlan;
    } finally {
      Date.now = oldNow;
      if (oldPlan === undefined) delete globalThis.planHiveBees;
      else globalThis.planHiveBees = oldPlan;
    }
  });
})();
