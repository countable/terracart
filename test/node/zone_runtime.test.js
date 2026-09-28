// Exercise the shipping spawn pipeline through its trap merge, using generated
// records rather than a second implementation of the zone-dressing interpreter.
(() => {
  const body = SPAWN_IN_TILE_SRC.slice(0, SPAWN_IN_TILE_SRC.indexOf('    // Treasure marks. Three streams:'));
  const spawn = new Function('entry', 'tx', 'ty', body);
  function fixture(caught = [], carried) {
    const scene = Object.assign(new SceneCreatures(), {
      tileEdgeM: 640, save: { caught }, startWorldM: { x: -5000, y: 0 },
      _pestFreeZone: () => null,
    });
    const guard = { kind: 'slime', id: 'zone_guard_anchor_find_1', x: 105, y: 105,
      homeX: 115, homeY: 115, zoneVariant: 'ancient_grove' };
    const trap = { id: 'zone_trap_anchor_1', x: 125, y: 105, _ix: 12, _iy: 10,
      zoneVariant: 'broken_depot' };
    const entry = { cellsPerEdge: 64, grid: new Array(4096).fill(WorldGen.T.GRASS),
      objects: [], roadClass: new Uint8Array(4096),
      zoneDress: { objects: [], wildplants: [], lairs: [], guards: [guard], traps: [trap] },
    };
    if (carried) entry.creatures = carried;
    const testMode = window.__TEST_MODE;
    window.__TEST_MODE = false;
    try { spawn.call(scene, entry, 0, 0); }
    finally { window.__TEST_MODE = testMode; }
    return { entry, scene, guard, trap };
  }

  test('zone runtime: guards survive the surface roster and use the existing guard leash', () => {
    const { entry, guard } = fixture();
    const live = entry.creatures.find(c => c.id === guard.id);
    assert.truthy(live);
    assert.eq(live.kind, 'slime');
    assert.eq(live.x, guard.x);
    assert.eq(live.seatX, guard.x);
    assert.eq(live.lairX, guard.homeX);
    assert.eq(Lairs.guardState(live, { x: 5000, y: 5000 }, 10, true), 'hold');
    assert.eq(Lairs.guardState(live, { x: guard.homeX, y: guard.homeY }, 10, true), 'hunt');
    assert.eq(entry.creatures.filter(c => c.x === guard.x && c.y === guard.y).length, 1,
      'guard seat is reserved before fauna and NPC draws');
  });

  test('zone runtime: rebuild preserves guard wounds and position without duplicating or reviving kills', () => {
    const first = fixture();
    const live = first.entry.creatures.find(c => c.id === first.guard.id);
    live.x += 4; live._hp = 1;
    const rebuilt = fixture([], first.entry.creatures);
    const same = rebuilt.entry.creatures.filter(c => c.id === live.id);
    assert.eq(same.length, 1);
    assert.eq(same[0], live);
    assert.eq(same[0].x, first.guard.x + 4);
    assert.eq(same[0]._hp, 1);
    const killed = fixture([live.id], []);
    assert.falsy(killed.entry.creatures.some(c => c.id === live.id));
    assert.truthy(killed.entry._spawnOpts.occupied.has(10 * 64 + 10),
      'a saved kill does not free its generated cell for another spawn');
    const added = fixture([], []);
    assert.eq(added.entry.creatures.filter(c => c.id === live.id).length, 1,
      'newly discovered guards join an existing creature array');
  });

  test('zone runtime: authored traps survive ordinary scatter and use sprung/disarmed ledgers', () => {
    const { entry, scene, trap } = fixture();
    assert.eq(entry.traps.filter(t => t.id === trap.id).length, 1);
    assert.truthy(entry._spawnOpts.occupied.has(10 * 64 + 12));
    assert.truthy(Traps.spring(scene.save, trap.id));
    assert.falsy(Traps.spring(scene.save, trap.id));
    assert.truthy(Traps.disarm(scene.save, trap.id));
    const rebuilt = fixture();
    const same = rebuilt.entry.traps.find(t => t.id === trap.id);
    assert.truthy(Traps.isSprung(scene.save, same.id));
    assert.truthy(Traps.isDisarmed(scene.save, same.id));
  });

  test('zone runtime: difficulty changes retain unsprung authored traps', () => {
    const { entry, scene, trap } = fixture();
    const at = APP_JS_SRC.indexOf('  _relayTrapsForMode() {');
    const end = APP_JS_SRC.indexOf('\n  }', at);
    const relay = new Function(`return {${APP_JS_SRC.slice(at, end + 4)}};`)();
    const priorMode = window.__TEST_MODE;
    const prior = WorldGen.tileCache.get('surface/0/0');
    WorldGen.tileCache.set('surface/0/0', entry);
    window.__TEST_MODE = false;
    try { relay._relayTrapsForMode.call(scene); }
    finally {
      window.__TEST_MODE = priorMode;
      if (prior) WorldGen.tileCache.set('surface/0/0', prior);
      else WorldGen.tileCache.delete('surface/0/0');
    }
    assert.eq(entry.traps.filter(t => t.id === trap.id).length, 1);
  });

  test('zone runtime: distant zone guards persist while ordinary lair guards sleep', () => {
    const { entry, guard } = fixture();
    const live = entry.creatures.find(c => c.id === guard.id);
    entry.creatures.push({ ...live, id: 'ordinary_lair_guard', lair: 'ordinary', zoneVariant: undefined });
    const report = Lairs.stepResidency([{ entry, tx: 0, ty: 0 }], {
      cellM: 10, tileEdgeM: 640, playerM: { x: 50000, y: 50000 }, caughtSet: new Set(),
    });
    assert.truthy(entry.creatures.includes(live));
    assert.falsy(entry.creatures.some(c => c.id === 'ordinary_lair_guard'));
    assert.eq(report.slept, 1);
  });

  test('zone runtime: exactly eight variants attract existing fauna across union coverage', () => {
    assert.eq(ZoneVariants.rows.filter(r => Object.keys(r.attracts).length).length, 8);
    const N = 32, grid = new Array(N * N).fill(WorldGen.T.GRASS);
    const scene = Object.assign(new SceneCreatures(), { tileEdgeM: N * 10 });
    for (const row of ZoneVariants.rows) {
      const species = new Set(['deer', 'crow', 'butterfly', ...Object.keys(row.attracts)]);
      const creatures = [];
      for (const sp of species) for (let n = 0; n < 40; n++) creatures.push({ id: `${sp}_${n}`, kind: sp, x: -100, y: -100 });
      const coverage = new Uint16Array(N * N).fill(1);
      const entry = { zone: { idx: null, coverage,
        anchors: [{ kind: row.zone, variant: row.id }] } };
      const count = creatures.length;
      const moved = scene._seatFaunaOnFavouriteGround(entry, 0, 0, N, 10, grid,
        { occupied: new Set() }, creatures, null, [], new Set());
      assert.eq(creatures.length, count, `${row.id} cannot add animals`);
      for (const sp of species) {
        if (row.attracts[sp]) assert.gt(moved[sp] || 0, 0, `${row.id}: ${sp} reaches fringe-only coverage`);
        else assert.eq(moved[sp] || 0, 0, `${row.id}: no inherited zone-kind affinity for ${sp}`);
      }
    }
  });
})();
