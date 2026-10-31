// A Grassy Lane's hidden pet (StreetVariants hiddenPets): one per street and
// owning tile, hidden in the grass until the feet reach a neighbouring cell.
(() => {
  const SV = StreetVariants, T = WorldGen.T, C = WorldGen.CELL_M;
  const KINDS = SV.VARIANT_BY_ID.grassy_lane.hiddenPets;
  function fixture(variant = 'grassy_lane', key = 'road') {
    const N = 16;
    const grid = new Uint8Array(N * N).fill(T.GRASS);
    const roadMask = new Uint8Array(N * N), spawnWhy = new Uint16Array(N * N);
    for (let x = 1; x < N - 1; x++) grid[8 * N + x] = T.ROAD, roadMask[8 * N + x] = 1;
    return { N, grid, roadMask, spawnWhy, index: { extent: N, dressingLines: [{
      key, variant, halfW: 3.5, line: [{ x: 1.5, y: 8.5 }, { x: N - 1.5, y: 8.5 }] }] } };
  }
  const dress = (f, tx = 0, ty = 0) => SV.dress({ ...f, tx, ty, tileEdgeM: f.N * C,
    spawnOpts: { roadMask: f.roadMask, spawnWhy: f.spawnWhy, occupied: new Set() } });
  const cell = p => [Math.floor(p.x / C), Math.floor(p.y / C)];

  test('hidden pet: the row lists slow catchable animals only (the verge is Passing ground)', () => {
    assert.truthy(KINDS.length >= 2);
    for (const kind of KINDS) {
      assert.truthy(Pets.catchable({ kind }), `${kind} can be caught`);
      assert.eq(creatureSpawnClass(kind), 'fauna', `${kind} may seat on Passing ground`);
    }
    for (const row of SV.STREET_VARIANTS) if (row.id !== 'grassy_lane') assert.falsy(row.hiddenPets, row.id);
  });

  test('hidden pet: one per grassy lane, in a grass verge cell the grass leaves bare, hidden and deterministic', () => {
    const f = fixture(), d = dress(f);
    assert.eq(d.guards.length, 1, 'one pet');
    const pet = d.guards[0], [ix, iy] = cell(pet);
    assert.truthy(KINDS.includes(pet.kind), pet.kind);
    assert.eq(pet.hidden, true);
    assert.eq(pet._street, 'grassy_lane');
    assert.eq(pet.id, WorldGen.cellId('street_pet', 0, 0, ix, iy));
    assert.eq(pet.homeX, pet.x); assert.eq(pet.homeY, pet.y);
    assert.eq(Math.abs(iy - 8), 2, `in the outer grass cell, not the road or the cell beside it (row ${iy})`);
    assert.eq(f.grid[iy * f.N + ix], T.GRASS);
    const grass = d.wildplants.filter(p => p.crop === 'longgrass');
    assert.falsy(grass.some(p => cell(p)[0] === ix && cell(p)[1] === iy), 'the grass leaves the pet its cell');
    const bare = [];
    for (let x = 1; x < f.N - 1; x++) for (let y = 6; y <= 10; y++) {
      if (!grass.some(p => cell(p)[0] === x && cell(p)[1] === y)
        && !d.objects.some(o => cell(o)[0] === x && cell(o)[1] === y)) bare.push(x + ',' + y);
    }
    assert.eq(bare.join(' '), ix + ',' + iy, 'its cell is the only bare one in the grass');
    assert.eq(JSON.stringify(dress(fixture()).guards), JSON.stringify(d.guards), 'the same pet every time');
    assert.eq(dress(fixture('rocky_path')).guards.length, 0, 'other lanes hide no pet');
  });

  test('hidden pet: the species and seat follow the street key and tile; fragments share one; blocked ground has none', () => {
    const seen = new Set(), seats = new Set();
    for (let i = 0; i < 40; i++) {
      const d = dress(fixture('grassy_lane', `lane ${i}`));
      if (d.guards.length) { seen.add(d.guards[0].kind); seats.add(d.guards[0].id); }
    }
    assert.eq(seen.size, KINDS.length, 'every species turns up across streets');
    assert.truthy(seats.size > 1, 'the seat moves along the lane with the street');
    const f = fixture();
    f.index.dressingLines.push({ ...f.index.dressingLines[0] });
    assert.eq(dress(f).guards.length, 1, 'two fragments of one street share the pet');
    const other = fixture();
    assert.truthy(dress(other, 3, 4).guards[0].id !== dress(fixture(), 0, 0).guards[0].id, 'the id carries the tile');
    const blocked = fixture();
    blocked.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
    assert.eq(dress(blocked).guards.length, 0, 'no seat, no pet');
  });

  test('hidden pet: spawnInTile seats it hidden and still, remembers the discovery, and a caught one stays gone', () => {
    const was = window.__TEST_MODE; window.__TEST_MODE = false;
    try {
      const build = save => {
        const f = fixture(), d = dress(f);
        const entry = { grid: f.grid, baseGrid: f.grid.slice(), cellsPerEdge: f.N, roadMask: f.roadMask,
          spawnWhy: f.spawnWhy, genObjects: [], objects: [], wildplants: [], streetDress: d, depth: 0 };
        const scene = Object.assign(new SceneCreatures(), { tileEdgeM: f.N * C, cellM: C, save,
          _pestFreeZone: () => null, _starterTrailAnchor: () => null,
          _provisionStarterHome() {}, _carveStarterPond() {} });
        scene.spawnInTile(entry, 0, 0);
        return { pet: d.guards[0], live: entry.creatures.find(c => c.id === d.guards[0].id) };
      };
      const fresh = build({ caught: [] });
      assert.truthy(fresh.live, 'the pet is a live creature of the tile');
      assert.eq(fresh.live.kind, fresh.pet.kind);
      assert.eq(fresh.live.hidden, true);
      assert.eq(fresh.live._discovered, false, 'hidden until found');
      assert.truthy(Combat.isConcealed(fresh.live));
      assert.falsy(fresh.live.lair, 'a pet, not a guard');
      assert.falsy(fresh.live.immobile);
      const found = build({ caught: [], hiddenDiscoveries: { [fresh.pet.id]: true } });
      assert.eq(found.live._discovered, true, 'a found pet stays found across rebuilds');
      const caught = build({ caught: [fresh.pet.id] });
      assert.falsy(caught.live, 'caught: its seat stays empty');
    } finally { window.__TEST_MODE = was; }
  });
})();
