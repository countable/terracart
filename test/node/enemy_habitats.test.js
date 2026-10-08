(() => {
  const entry = (N = 64) => ({ cellsPerEdge: N, tileEdgeM: 640,
    baseGrid: new Array(N * N).fill(WorldGen.T.CAVE_FLOOR), genObjects: [] });
  const signature = rows => rows.map(c => `${c.id}:${c.x},${c.y}`).join('|');
  test('enemy habitats: cave themes agree at tile seams and demons/roosts respect depth', () => {
    const a = entry();
    for (let depth = 1; depth <= 12; depth++) {
      for (let y = 0; y < 64; y += 4) {
        const left = EnemyHabitats.caveAt(a, -1, 2, 63.5, y, depth);
        const right = EnemyHabitats.caveAt(a, 0, 2, -.5, y, depth);
        assert.eq(left.id, right.id);
        assert.eq(left.theme, right.theme);
      }
      const themes = new Set();
      for (let y = 0; y < 64; y += 4) for (let x = 0; x < 64; x += 4) {
        themes.add(EnemyHabitats.caveAt(a, 0, 0, x, y, depth).theme);
      }
      if (depth <= 4) assert.falsy(themes.has('infernal'));
      if (depth < 9) assert.falsy(themes.has('roost'));
    }
  });
  test('enemy habitats: dragon roosts have one owner per region and reserve their generated seat', () => {
    const ids = new Set(); let count = 0;
    for (let ty = -1; ty <= 1; ty++) for (let tx = -1; tx <= 1; tx++) {
      const e = entry(), occupied = new Set();
      const dragons = EnemyHabitats.caveSites(e, tx, ty, 9, occupied);
      assert.eq(signature(dragons), signature(EnemyHabitats.caveSites(entry(), tx, ty, 9, new Set())));
      for (const c of dragons) {
        assert.falsy(ids.has(c.id)); ids.add(c.id); count++;
        assert.eq(c.kind, 'red_dragon'); assert.truthy(c._cave); assert.falsy(c.lair);
        assert.eq(c.homeX, c.x); assert.eq(c.homeY, c.y);
        const cx = Math.floor((c.x - tx * 640) / 10), cy = Math.floor((c.y - ty * 640) / 10);
        assert.truthy(occupied.has(cy * 64 + cx));
        assert.eq(EnemyHabitats.caveAt(e, tx, ty, cx, cy, 9).id, c._habitatRegion);
      }
    }
    assert.gt(count, 0, 'the fixture exercises actual roosts');
    assert.eq(EnemyHabitats.caveSites(entry(), 0, 0, 8, new Set()).length, 0);
  });
  test('enemy habitats: roosts need floor chambers, avoid generated stairs, and ignore player edits', () => {
    const e = entry(), base = EnemyHabitats.caveSites(e, 0, 0, 9, new Set());
    assert.gt(base.length, 0);
    const edited = { ...entry(), grid: new Array(4096).fill(WorldGen.T.CAVE_WALL),
      objects: base.map(c => ({ kind: 'staircase', x: c.x, y: c.y, _synthetic: true })),
      save: { caught: base.map(c => c.id) } };
    assert.eq(signature(EnemyHabitats.caveSites(edited, 0, 0, 9, new Set())), signature(base),
      'defeats and live edits are caller filters, never a seat reroll');
    const blocked = entry(); blocked.baseGrid.fill(WorldGen.T.CAVE_WALL);
    assert.eq(EnemyHabitats.caveSites(blocked, 0, 0, 9, new Set()).length, 0);
    const stairs = entry(); stairs.genObjects = base.map(c => ({ kind: 'staircase', x: c.x, y: c.y }));
    const after = EnemyHabitats.caveSites(stairs, 0, 0, 9, new Set());
    for (const c of after) for (const s of stairs.genObjects) assert.gte(Math.hypot(c.x - s.x, c.y - s.y), 50);
    const occupied = new Set(Array.from({ length: 4096 }, (_, i) => i));
    assert.eq(EnemyHabitats.caveSites(entry(), 0, 0, 9, occupied).length, 0);
  });
})();

test('enemy habitats: beach candidates become crabs and water-edge jellyfish, never pirates', () => {
  const body = SPAWN_IN_TILE_SRC.slice(0, SPAWN_IN_TILE_SRC.indexOf('    // (Starter-cow'));
  const generate = spawnPassFn(body + '\nreturn creatures;');
  const run = (beach, caught = []) => {
    const scene = Object.assign(new SceneCreatures(), { tileEdgeM: 640, save: { caught },
      startWorldM: { x: -5000, y: 0 }, _pestFreeZone: () => null });
    const N = 64, grid = new Array(N * N), mask = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      grid[y * N + x] = x % 4 === 0 ? WorldGen.T.WATER : WorldGen.T.SAND;
      mask[y * N + x] = grid[y * N + x] === WorldGen.T.SAND ? 1 : 0;
    }
    const entry = { cellsPerEdge: N, tileEdgeM: 640, grid, objects: [],
      scenic: beach ? { shore: { mask } } : null };
    return generate.call(scene, entry, 0, 0).filter(c => c._surfaceSpawn);
  };
  const beach = run(true);
  assert.truthy(beach.some(c => c.kind === 'giant_crab'));
  assert.truthy(beach.some(c => c.kind === 'jellyfish'));
  assert.eq(new Set(beach.map(c => `${c.x},${c.y}`)).size, beach.length, 'every destination is distinct');
  for (const c of beach) {
    assert.includes(['giant_crab', 'jellyfish'], c.kind);
    assert.eq(c._surfaceSpawn.cx % 4 === 0, c.kind === 'jellyfish', 'jellyfish live in water; crabs live on sand');
  }
  assert.falsy(run(false).some(c => /pirate|giant_crab|jellyfish/.test(c.kind)));
  const sig = cs => cs.map(c => `${c.id}:${c.kind}:${c.x},${c.y}`).join('|');
  assert.eq(sig(run(true, [beach[0].id])), sig(beach.slice(1)), 'defeat removes one seat without rerolling survivors');
  assert.truthy(Combat.isEnemyKind('crab'), 'the tameable shore crab attacks while wild');
});

test('enemy habitats: reef and shellwater Nexus jellyfish occupy shore water', () => {
  const N = 64;
  for (const variant of ['mystic_reef', 'shellwater_strand']) {
    const grid = new Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) grid[y * N + x] = x % 4 === 0 ? WorldGen.T.WATER : WorldGen.T.SAND;
    const entry = { cellsPerEdge: N, tileEdgeM: N * 7, grid,
      spawnWhy: Uint16Array.from(grid, t => t === WorldGen.T.WATER ? WorldGen.SPAWN_WHY.TERRAIN : 0),
      zone: { coverage: new Uint8Array(N * N).fill(1), anchors: [{ variant }] } };
    const creatures = EnemyHabitats.surfaceEncounters(entry, 0, 0, new Set());
    assert.truthy(creatures.some(c => c.kind === 'jellyfish'));
    for (const c of creatures) {
      assert.includes(['giant_crab', 'jellyfish'], c.kind);
      const at = c._surfaceSpawn;
      assert.eq(grid[at.cy * N + at.cx] === WorldGen.T.WATER, c.kind === 'jellyfish');
    }
  }
});

test('enemy habitats: water seats retain every shared spawn exclusion', () => {
  const N = 12, grid = new Array(N * N).fill(WorldGen.T.SAND);
  for (let y = 0; y < N; y++) grid[y * N + 6] = WorldGen.T.WATER;
  const e = { cellsPerEdge: N, grid };
  const why = Uint16Array.from(grid, t => t === WorldGen.T.WATER ? WorldGen.SPAWN_WHY.TERRAIN : 0);
  const opts = { spawnWhy: why, occupied: new Set() };
  const seat = EnemyHabitats.surfaceSeat(e, 5, 5, 'jellyfish', opts);
  assert.eq(seat.cx, 6);
  for (const block of [WorldGen.SPAWN_WHY.RESTRICTED, WorldGen.SPAWN_WHY.PRIVATE, WorldGen.SPAWN_WHY.KERB,
      WorldGen.SPAWN_WHY.FARM_INTERIOR, WorldGen.SPAWN_WHY.QUIET, WorldGen.SPAWN_WHY.SENSITIVE]) {
    why.fill(WorldGen.SPAWN_WHY.TERRAIN | block);
    // Jellyfish are slow: KERB follows their existing enemy class policy.
    if (block === WorldGen.SPAWN_WHY.KERB) continue;
    assert.eq(EnemyHabitats.surfaceSeat(e, 5, 5, 'jellyfish', opts), null, 'water preserves reason ' + block);
  }
  why.fill(WorldGen.SPAWN_WHY.TERRAIN);
  opts.occupied = new Set(Array.from({ length: N * N }, (_, i) => i));
  assert.eq(EnemyHabitats.surfaceSeat(e, 5, 5, 'jellyfish', opts), null);
  opts.occupied.clear(); opts.roadMask = new Uint8Array(N * N).fill(1);
  assert.eq(EnemyHabitats.surfaceSeat(e, 5, 5, 'jellyfish', opts), null);
});

test('enemy habitats: jellyfish swim along the water edge and refuse land and open water', () => {
  const c = { kind: 'jellyfish', x: 0, y: 0 }, row = EnemyRoster.get(c.kind);
  const scene = { cellM: 7, _cellBlocked: () => false,
    cellAt: (x, y) => ({ loaded: true, type: x < 0 ? WorldGen.T.SAND : WorldGen.T.WATER }) };
  assert.truthy(enemyCanStep(scene, c, row, 0, 0));
  assert.falsy(enemyCanStep(scene, c, row, -7, 0), 'cannot walk onto the beach');
  assert.falsy(enemyCanStep(scene, c, row, 14, 0), 'cannot swim away from the edge');
  scene.cellAt = () => ({ loaded: false, type: WorldGen.T.WATER });
  assert.falsy(enemyCanStep(scene, c, row, 0, 0));
});

test('enemy habitats: live repaint removes stranded jellyfish and preserves water seats', () => {
  const N = 4, grid = new Array(N * N).fill(WorldGen.T.WATER);
  const scene = Object.assign(new SceneCreatures(), { tileEdgeM: N * 10 });
  const creatures = [{ kind: 'jellyfish', x: 5, y: 5 }, { kind: 'jellyfish', x: 15, y: 5 }];
  const entry = { grid: grid.slice(), objects: [] };
  entry.grid[0] = WorldGen.T.SAND;
  scene._cullOffLiveGround(entry, 0, 0, N, 10, grid, [], creatures);
  assert.eq(creatures.length, 1);
  assert.eq(creatures[0].x, 15);
});

test('enemy habitats: every selected cave theme has an eligible family through deep levels', () => {
  for (let depth = 1; depth <= 20; depth++) {
    const band = EnemyHabitats.THEME_BANDS.find(b => depth <= b.max);
    for (const theme of new Set(band.themes)) {
      const context = { kinds: EnemyHabitats.FAMILIES[theme] };
      const pool = EnemySpawns.caveRows(depth, context);
      assert.gt(pool.length, 0, `${theme} has residents at depth ${depth}`);
      for (const row of pool) {
        assert.falsy(row.retired); assert.falsy(row.id === 'red_dragon', 'dragons have finite roost seats');
        if (theme === 'infernal') assert.gte(depth, 5);
      }
    }
  }
  assert.truthy(EnemySpawns.caveRows(4, { kinds: EnemyHabitats.FAMILIES.warren }).some(r => r.id === 'bomb_goblin'));
});

(() => {
  const N = 64, edge = N * 7;
  const entry = (theme = 'orchard') => ({ cellsPerEdge: N, tileEdgeM: edge,
    grid: new Array(N * N).fill(WorldGen.T.PARK), objects: [],
    zone: { coverage: new Uint8Array(N * N).fill(1), anchors: [{ variant: theme }] } });
  const signature = cs => cs.map(c => `${c.id}:${c.kind}:${c.x},${c.y}`).join('|');
  test('surface encounters: mushroom groves scatter stable solitary mushrooms across the grove', () => {
    const e = entry('mushroom_grove'), occupied = new Set();
    const cs = EnemyHabitats.surfaceEncounters(e, 0, 0, occupied);
    assert.inRange(cs.length, 45, 90, 'mushrooms populate the grove beyond a sparse mixed encounter');
    assert.eq(signature(cs), signature(EnemyHabitats.surfaceEncounters(e, 0, 0, new Set())));
    const patches = new Set(), quadrants = new Set();
    for (const c of cs) {
      const { cx, cy } = c._surfaceSpawn;
      assert.eq(c.kind, 'mushroom_monster');
      assert.falsy(c.lair, 'free roamers, not shrine guards');
      patches.add(`${Math.floor(cx / 6)},${Math.floor(cy / 6)}`);
      quadrants.add(`${cx < N / 2},${cy < N / 2}`);
    }
    assert.eq(patches.size, cs.length, 'one mushroom per patch, not clustered packs');
    assert.eq(quadrants.size, 4, 'scattered across the whole grove');
    assert.eq(occupied.size, cs.length);
    e.zone.anchors.push({ variant: 'orchard' });
    for (let y = 0; y < N; y++) for (let x = N / 2; x < N; x++) e.zone.coverage[y * N + x] = 2;
    const mixed = EnemyHabitats.surfaceEncounters(e, 0, 0, new Set());
    assert.eq(new Set(mixed.map(c => c.id)).size, mixed.length, 'profiles cannot reuse defeat IDs');
    for (const c of mixed) {
      if (c.kind === 'mushroom_monster') assert.lt(c._surfaceSpawn.cx, N / 2, 'mushrooms stay in grove coverage');
      else assert.gte(c._surfaceSpawn.cx, N / 2, 'ordinary encounters stay outside the grove');
    }
  });
  test('surface encounters: Work Yard has no ranged roaming enemies', () => {
    const creatures = EnemyHabitats.surfaceEncounters(entry('work_yard'), 0, 0, new Set());
    assert.gt(creatures.length, 0, 'the calm melee habitat remains populated');
    for (const creature of creatures) assert.eq(EnemyRoster.get(creature.kind).attackType, 'melee');
  });
  test('surface encounters: slices preserve complete records and reserved seats', () => {
    for (const theme of ['orchard', 'ordered_graves', 'mystic_reef']) {
      const fixture = () => {
        const e = entry(theme);
        if (theme === 'mystic_reef') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
          e.grid[y * N + x] = x % 4 === 0 ? WorldGen.T.WATER : WorldGen.T.SAND;
        return e;
      };
      const occupied = new Set(), directOccupied = new Set();
      const it = EnemyHabitats.surfaceEncountersSteps(fixture(), 0, 0, occupied);
      let r = it.next(), yields = 0;
      while (!r.done) { yields++; r = it.next(); }
      assert.eq(yields, Math.ceil(N / EnemyHabitats.SURFACE_ENCOUNTERS.blockCells) ** 2);
      assert.gt(r.value.length, 0, theme + ' fixture exercises actual encounters');
      const direct = EnemyHabitats.surfaceEncounters(fixture(), 0, 0, directOccupied);
      assert.eq(JSON.stringify(r.value), JSON.stringify(direct), theme + ' keeps every generated field');
      assert.eq(JSON.stringify([...occupied]), JSON.stringify([...directOccupied]), theme + ' keeps reservation order');
      assert.eq(occupied.size, r.value.length);
      if (theme === 'mystic_reef') assert.truthy(r.value.some(c => c.kind === 'jellyfish'));
    }
  });
  test('surface encounters: empty coverage still yields between unsuccessful block searches', () => {
    const e = entry();
    e.zone.coverage.fill(0);
    const occupied = new Set(), it = EnemyHabitats.surfaceEncountersSteps(e, 0, 0, occupied);
    let r = it.next(), yields = 0;
    while (!r.done) { yields++; r = it.next(); }
    assert.eq(yields, Math.ceil(N / EnemyHabitats.SURFACE_ENCOUNTERS.blockCells) ** 2);
    assert.eq(r.value.length, 0);
    assert.eq(occupied.size, 0);
  });
  test('surface encounters: themed singles and small groups are stable and occupy distinct seats', () => {
    const e = entry(), occupied = new Set();
    const cs = EnemyHabitats.surfaceEncounters(e, 0, 0, occupied);
    assert.inRange(cs.length, 15, 50, 'a fully themed tile has regular encounters');
    assert.eq(signature(cs), signature(EnemyHabitats.surfaceEncounters(entry(), 0, 0, new Set())));
    const groups = new Map();
    for (const c of cs) {
      assert.includes(EnemyHabitats.SURFACE_FAMILIES.orchard, c.kind);
      assert.falsy(c.lair, 'these are roamers, not more guards');
      const key = c.id.replace(/_\d+$/, '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    assert.eq(occupied.size, cs.length);
    assert.truthy([...groups.values()].some(g => g.length === 1));
    assert.truthy([...groups.values()].some(g => g.length > 1));
    for (const group of groups.values()) {
      assert.lte(group.length, 3);
      for (const c of group) assert.lte(Math.hypot(c.x - group[0].x, c.y - group[0].y), 3 * 7);
    }
  });
  test('surface encounters: require themed coverage and obey roads, occupied seats, and hard spawn gates', () => {
    for (const theme of ['orchard', 'mushroom_grove']) for (const block of ['road', 'occupied', 'restricted', 'coverage']) {
      const e = entry(theme), occupied = new Set();
      if (block === 'road') e.roadMask = new Uint8Array(N * N).fill(1);
      if (block === 'occupied') for (let i = 0; i < N * N; i++) occupied.add(i);
      if (block === 'restricted') e.spawnWhy = new Uint32Array(N * N).fill(WorldGen.SPAWN_WHY.RESTRICTED);
      if (block === 'coverage') e.zone.coverage.fill(0);
      assert.eq(EnemyHabitats.surfaceEncounters(e, 0, 0, occupied).length, 0, block);
    }
  });
  test('surface encounters: excluded ground relocates a Nexus budget without changing identities', () => {
    const full = entry(), before = EnemyHabitats.surfaceEncounters(full, 0, 0, new Set());
    const excluded = entry();
    excluded.spawnWhy = new Uint32Array(N * N);
    // Leave ample capacity in a quarter of the same owning Nexus.
    for (let i = 0; i < N * N; i++) if (i % N < 48)
      excluded.spawnWhy[i] = WorldGen.SPAWN_WHY.RESTRICTED;
    const after = EnemyHabitats.surfaceEncounters(excluded, 0, 0, new Set());
    assert.eq(after.map(c => c.id + ':' + c.kind).join('|'), before.map(c => c.id + ':' + c.kind).join('|'));
    for (const c of after) assert.gte(c._surfaceSpawn.cx, 48);
    assert.eq(new Set(after.map(c => `${c.x},${c.y}`)).size, after.length);
    assert.eq(signature(after), signature(EnemyHabitats.surfaceEncounters(excluded, 0, 0, new Set())));
  });
  test('surface encounters: exhausted owners cannot borrow a neighbouring Nexus seats', () => {
    const e = entry();
    e.zone.anchors.push({ variant: 'orchard' });
    e.spawnWhy = new Uint32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (x >= 36) e.zone.coverage[y * N + x] = 2;
      else e.spawnWhy[y * N + x] = WorldGen.SPAWN_WHY.RESTRICTED;
    }
    const out = EnemyHabitats.surfaceEncounters(e, 0, 0, new Set());
    assert.gt(out.length, 0);
    for (const c of out) {
      assert.gte(c._surfaceSpawn.cx, 36);
      const blockX = Number(c.id.split('_').at(-3));
      assert.gte(blockX, 36, 'a wholly blocked first-owner block produces no second-owner animal');
    }
  });
  test('surface encounters: actual spawn pass preserves defeat identities and Home protections', () => {
    const body = SPAWN_IN_TILE_SRC.slice(0, SPAWN_IN_TILE_SRC.indexOf('    // (Starter-cow'));
    const generate = spawnPassFn(body + '\nreturn creatures;');
    const run = (caught = [], near = false) => {
      const scene = Object.assign(new SceneCreatures(), { tileEdgeM: edge, save: { caught },
        startWorldM: { x: near ? 0 : -5000, y: 0 }, _pestFreeZone: () => null });
      return generate.call(scene, entry(), 0, 0).filter(c => c.id.startsWith('zone_encounter_'));
    };
    const cs = run();
    assert.gt(cs.length, 0);
    assert.eq(signature(run([cs[0].id])), signature(cs.slice(1)));
    assert.truthy(run([], true).some(c => c._surfaceInactive), 'strong foes remain hidden near Home');
  });
  test('surface encounters: rebuild admits new zone enemies without moving or healing survivors', () => {
    const creatures = EnemyHabitats.surfaceEncounters(entry(), 0, 0, new Set());
    const survivor = { ...creatures[0], x: -1, _hp: 2 };
    const rebuilt = { creatures: [survivor] };
    const begin = SPAWN_IN_TILE_SRC.indexOf('    entry.creatures = entry.creatures || creatures;');
    const end = SPAWN_IN_TILE_SRC.indexOf('    this._restoreMimics', begin);
    const reconcile = new Function('entry', 'creatures', SPAWN_IN_TILE_SRC.slice(begin, end));
    reconcile(rebuilt, creatures);
    reconcile(rebuilt, creatures);
    assert.eq(rebuilt.creatures.length, creatures.length, 'new encounters added exactly once');
    assert.eq(rebuilt.creatures[0], survivor);
    assert.eq(survivor.x, -1); assert.eq(survivor._hp, 2);
  });
})();

test('new monsters: jellyfish use shoreline candidates and graveyard zombies start buried', () => {
  assert.falsy(EnemySpawns.surfaceRows('SAND').some(r => r.id === 'jellyfish'));
  assert.truthy(EnemySpawns.surfaceRows('SAND', { beach: true }).some(r => r.id === 'jellyfish'));
  const kinds = new Set(Array.from({ length: 1000 }, (_, i) => HabitatSpawns.enemyKind(HabitatSpawns.shoreProfile('SAND'), `jellyfish_beach_${i}`, 'SAND', { beach: true })));
  assert.truthy(kinds.has('jellyfish'));
  for (const variant of ['ordered_graves', 'overgrown_graves']) {
    const N = 64;
    const entry = { cellsPerEdge: N, tileEdgeM: N * 7, grid: new Array(N * N).fill(WorldGen.T.PARK),
      objects: [], zone: { coverage: new Uint8Array(N * N).fill(1), anchors: [{ variant }] } };
    const creatures = EnemyHabitats.surfaceEncounters(entry, 0, 0, new Set());
    const zombies = creatures.filter(c => c.kind === 'zombie');
    assert.gt(zombies.length, 0, variant + ' has zombies');
    for (const c of zombies) { assert.truthy(c.emergeFromGround); assert.truthy(c._burrowed); }
    for (const c of creatures.filter(c => c.kind !== 'zombie')) assert.falsy(c.emergeFromGround);
  }
});

test('new monsters: requested tiers and attack behavior come from the roster', () => {
  assert.eq(EnemyRoster.get('minotaur').tier, 4);
  assert.truthy(EnemyRoster.get('minotaur').movement.chargeOnly);
  assert.eq(EnemyRoster.get('mimic').tier, 3);
  assert.eq(EnemyRoster.get('jellyfish').tier, 2);
  assert.eq(EnemyRoster.get('golden_slime').trail.durationSeconds, 600);
  assert.eq(EnemyRoster.get('sword_spirit').movement.pattern, 'orbit_swoop');
  assert.gt(EnemyRoster.get('sword_spirit').dmg, 0);
  assert.falsy(EnemyRoster.get('sword_spirit').steals);
  assert.truthy(EnemySpawns.caveRows(3, { kinds: EnemyHabitats.FAMILIES.natural }).some(r => r.id === 'gelatinous_cube'));
});
