// Favourite ground draws a small quota of nearby animals already on the tile.
// These fixtures isolate a single lane so population, tile size and unrelated
// attraction grounds cannot disguise an unbounded or array-ordered pull.
(() => {
  const fixture = (N = 24, count = 40, tx = 0) => {
    const cellM = 7, marks = new Uint8Array(N * N), cells = new Set();
    for (let y = 8; y < 14; y++) for (let x = 8; x < 14; x++) {
      cells.add(y * N + x); marks[y * N + x] = StreetVariants.VARIANT_BY_ID.toadstool.code;
    }
    const scene = Object.assign(new SceneCreatures(), { tileEdgeM: N * cellM });
    const creatures = Array.from({ length: count }, (_, i) => ({ id: `butterfly_${i}`, kind: 'butterfly',
      x: tx * scene.tileEdgeM + 10.5 * cellM, y: (6.5 - i * 3) * cellM }));
    return { N, cellM, tx, scene, creatures, cells, entry: { streetMarks: marks },
      grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS), opts: {}, blocked: new Set(), unseated: [] };
  };
  const run = f => f.scene._seatFaunaOnFavouriteGround(f.entry, f.tx, 0, f.N, f.cellM,
    f.grid, f.opts, f.creatures, f.pest || null, f.unseated, f.blocked);
  const seats = f => JSON.stringify(f.creatures.slice().sort((a, b) => a.id.localeCompare(b.id)));
  const landed = f => f.creatures.filter(c => Number.isFinite(c.x) && Number.isFinite(c.y)
    && f.cells.has(Math.floor(c.y / f.cellM) * f.N + Math.floor((c.x - f.tx * f.scene.tileEdgeM) / f.cellM)));
  test('fauna attraction: a mushroom lane draws only the nearest two to five existing butterflies', () => {
    const f = fixture(), result = run(f), arrivals = landed(f);
    assert.truthy(arrivals.length >= 2 && arrivals.length <= 5, 'small bounded quota');
    assert.eq(result.butterfly, arrivals.length, 'reports actual relocations');
    assert.eq(f.creatures[0].x, 10.5 * f.cellM, 'nearest animal lands in its closest eligible column');
    assert.eq(f.creatures[0].y, 8.5 * f.cellM, 'nearest animal lands in its closest eligible row');
    assert.eq(arrivals.map(c => c.id).sort().join(','),
      Array.from({ length: arrivals.length }, (_, i) => `butterfly_${i}`).sort().join(','), 'nearest identities move');
    assert.eq(f.creatures.length, 40, 'population remains unchanged');
    for (let i = arrivals.length; i < f.creatures.length; i++)
      assert.eq(f.creatures[i].y, (6.5 - i * 3) * f.cellM, 'distant butterflies keep their seats');
  });
  test('fauna attraction: existing residents count toward the quota and keep their positions', () => {
    const baseline = fixture(), quota = run(baseline).butterfly;
    const f = fixture();
    f.creatures.push({ id: 'resident', kind: 'butterfly', x: 12.5 * f.cellM, y: 12.5 * f.cellM });
    const result = run(f), resident = f.creatures.find(c => c.id === 'resident');
    assert.eq(result.butterfly, quota - 1, 'resident consumes one seat in the same seeded quota');
    assert.eq(resident.x, 12.5 * f.cellM); assert.eq(resident.y, 12.5 * f.cellM);
    assert.eq(landed(f).length, quota);
    const full = fixture();
    for (let i = 0; i < 6; i++) full.creatures.push({ id: `resident_${i}`, kind: 'butterfly',
      x: (8.5 + i) * full.cellM, y: 12.5 * full.cellM });
    const before = seats(full); run(full);
    assert.eq(seats(full), before, 'a site already above quota draws nobody');
  });
  test('fauna attraction: seeded quotas vary by site but never grow with tile or population size', () => {
    const counts = new Set();
    for (let tx = 0; tx < 20; tx++) {
      const small = fixture(24, 20, tx), large = fixture(60, 400, tx);
      const a = run(small).butterfly, b = run(large).butterfly;
      assert.truthy(a >= 2 && a <= 5 && b >= 2 && b <= 5, 'every site respects the count range');
      counts.add(a);
    }
    assert.gt(counts.size, 1, 'seeded quotas are not a fixed constant');
  });
  test('fauna attraction: creature array order and equal-distance ties do not change seats', () => {
    const a = fixture(), b = fixture();
    for (const f of [a, b]) for (let i = 0; i < f.creatures.length; i++) f.creatures[i].y = -7;
    b.creatures.reverse();
    run(a); run(b);
    assert.eq(seats(a), seats(b), 'stable creature IDs decide ties');
  });
  test('fauna attraction: blocked destinations preserve seats and unseated animals remain absent', () => {
    for (const available of [0, 1]) {
      const f = fixture(), before = seats(f);
      f.unseated.push({ id: 'lost', kind: 'butterfly', x: NaN, y: NaN });
      f.creatures.push({ id: 'nonfinite', kind: 'butterfly', x: NaN, y: NaN });
      f.blocked = new Set(f.cells);
      if (available) f.blocked.delete(8 * f.N + 10);
      run(f);
      assert.eq(landed(f).length, available, 'uses only genuinely free destinations');
      assert.eq(f.creatures.length, 41, 'never recovers an unseated spawn');
      assert.falsy(f.creatures.some(c => c.id === 'lost'));
      assert.truthy(Number.isNaN(f.creatures.find(c => c.id === 'nonfinite').x));
      if (!available) assert.eq(seats({ ...f, creatures: f.creatures.slice(0, 40) }), before);
    }
  });
  test('fauna attraction: each nexus owner receives its own quota even with the same variant', () => {
    const f = fixture(40, 0), coverage = new Uint16Array(f.N * f.N);
    f.entry.streetMarks.fill(0); f.cells.clear();
    for (const [owner, x0] of [[1, 5], [2, 27]]) {
      for (let y = 8; y < 14; y++) for (let x = x0; x < x0 + 6; x++) {
        coverage[y * f.N + x] = owner; f.cells.add(y * f.N + x);
      }
      for (let i = 0; i < 15; i++) f.creatures.push({ id: `owner${owner}_${i}`, kind: 'butterfly',
        x: (x0 + 2.5) * f.cellM, y: (-1 - i) * f.cellM });
    }
    f.entry.zone = { coverage, anchors: [{ id: 'grove_a', kind: 'grove' }, { id: 'grove_b', kind: 'grove' }] };
    run(f);
    for (const owner of [1, 2]) {
      const n = landed(f).filter(c => coverage[Math.floor(c.y / f.cellM) * f.N + Math.floor(c.x / f.cellM)] === owner).length;
      assert.truthy(n >= 2 && n <= 5, `owner ${owner} gets an independent small quota`);
    }
  });
  test('fauna attraction: occupied animal cells remain unavailable to arriving butterflies', () => {
    const f = fixture();
    f.creatures.push({ id: 'rabbit_resident', kind: 'rabbit', x: 10.5 * f.cellM, y: 8.5 * f.cellM });
    run(f);
    const occupied = f.creatures.filter(c => c.x === 10.5 * f.cellM && c.y === 8.5 * f.cellM);
    assert.eq(occupied.length, 1, 'arrivals never overlap an existing animal of another species');
    assert.eq(occupied[0].id, 'rabbit_resident');
  });
  test('fauna attraction: one animal cannot be pulled again by a second nexus', () => {
    const f = fixture(24, 1), coverage = new Uint16Array(f.N * f.N);
    f.entry.streetMarks.fill(0); f.cells.clear();
    for (const [owner, x0] of [[1, 3], [2, 15]]) {
      for (let y = 8; y < 12; y++) for (let x = x0; x < x0 + 4; x++) {
        coverage[y * f.N + x] = owner; f.cells.add(y * f.N + x);
      }
    }
    f.entry.zone = { coverage, anchors: [{ id: 'a', kind: 'grove' }, { id: 'b', kind: 'grove' }] };
    const result = run(f);
    assert.eq(result.butterfly, 1, 'only one move is reported despite two interested owners');
    assert.eq(landed(f).length, 1, 'the same positioned animal remains on a valid ground');
  });
  test('fauna attraction: nexus permits only its authored species over global terrain and street pulls', () => {
    const f = fixture(); f.entry.streetMarks.fill(StreetVariants.VARIANT_BY_ID.toadstool.code);
    f.entry.zone = { coverage: new Uint16Array(f.N * f.N).fill(1),
      anchors: [{ kind: 'beach', variant: 'pirate_cove' }] };
    const before = seats(f); run(f);
    assert.eq(seats(f), before, 'empty pirate affinity refuses underlying street attraction');
    f.grid.fill(WorldGen.T.WASTELAND);
    f.creatures = f.creatures.map(c => ({ ...c, kind: 'slime' }));
    const slimeBefore = seats(f); run(f);
    assert.eq(seats(f), slimeBefore, 'empty affinity also refuses underlying terrain attraction');
  });
  test('fauna attraction: authored groves and walking-path lamps respect habitat restrictions', () => {
    const N = 12, cellM = 7, scene = Object.assign(new SceneCreatures(), { tileEdgeM: N * cellM,
      _pathLampCells: () => new Set(Array.from({ length: N * N }, (_, i) => i)) });
    for (const [kind, terrain, allowed] of [['deer', WorldGen.T.PARK, false], ['deer', WorldGen.T.FOREST, true],
      ['cat', WorldGen.T.WASTELAND, false], ['cat', WorldGen.T.GRASS, true]]) {
      const grid = new Uint8Array(N * N).fill(terrain);
      const entry = kind === 'deer' ? { zone: { coverage: new Uint16Array(N * N).fill(1), anchors: [{ kind: 'grove' }] } } : {};
      const animals = Array.from({ length: 80 }, (_, i) => ({ kind, id: `${kind}${i}`, x: -7, y: -7 }));
      scene._seatFaunaOnFavouriteGround(entry, 0, 0, N, cellM, grid, {}, animals, null, [], new Set());
      const count = animals.filter(c => c.x >= 0).length;
      assert.eq(count > 0, allowed, `${kind} attracted onto terrain ${terrain}`);
      assert.truthy(count <= 5, 'habitat permission does not bypass quota');
    }
  });
  test('fauna attraction: spawn reasons and pest-free Home ground remain excluded', () => {
    const f = fixture(), before = seats(f);
    f.opts.spawnWhy = new Uint16Array(f.N * f.N).fill(WorldGen.SPAWN_WHY.RESTRICTED);
    run(f); assert.eq(seats(f), before, 'hard spawn reason excludes relocation');
    const N = 16, grid = new Uint8Array(N * N).fill(WorldGen.T.PARK);
    const scene = Object.assign(new SceneCreatures(), { tileEdgeM: N * 7 });
    const entry = { streetMarks: new Uint8Array(N * N).fill(StreetVariants.VARIANT_BY_ID.pilgrim.code) };
    const crows = Array.from({ length: 20 }, (_, i) => ({ id: `crow${i}`, kind: 'crow', x: -7, y: -7 }));
    scene._seatFaunaOnFavouriteGround(entry, 0, 0, N, 7, grid, {}, crows, { has: () => true }, [], new Set());
    assert.truthy(crows.every(c => c.x === -7 && c.y === -7), 'pest amnesty excludes all arrivals');
  });
  test('fauna attraction: attracted park crows leave space around birds and interactables', () => {
    const N = 16, cellM = 7, grid = new Uint8Array(N * N).fill(WorldGen.T.PARK);
    const mask = new Uint8Array(N * N).fill(1), occupied = new Set();
    for (let y = 0; y < N; y++) occupied.add(y * N + 7);
    const entry = { scenic: { shore: { mask } },
      streetMarks: new Uint8Array(N * N).fill(StreetVariants.VARIANT_BY_ID.pilgrim.code) };
    const scene = Object.assign(new SceneCreatures(), { tileEdgeM: N * cellM });
    const creatures = Array.from({ length: 300 }, (_, n) => ({ id: `crow_${n}`, kind: 'crow', x: -100, y: -100 }));
    creatures.push({ id: 'resident', kind: 'crow', x: 3.5 * cellM, y: 3.5 * cellM });
    scene._seatFaunaOnFavouriteGround(entry, 0, 0, N, cellM, grid, { occupied }, creatures, null, [], new Set());
    const arrivals = creatures.filter(c => c.id !== 'resident' && c.x >= 0);
    assert.truthy(arrivals.length >= 1 && arrivals.length <= 4, 'resident counts toward the crow quota');
    assert.eq(creatures.length, 301, 'failed attraction retains every animal');
    const seat = c => [Math.floor(c.x / cellM), Math.floor(c.y / cellM)];
    for (let i = 0; i < arrivals.length; i++) {
      const [x, y] = seat(arrivals[i]);
      assert.falsy(occupied.has(y * N + x), 'no landing on a beach interactable');
      assert.gt(Math.max(Math.abs(x - 3), Math.abs(y - 3)), 1, 'existing shore bird keeps breathing room');
      for (let j = 0; j < i; j++) {
        const [px, py] = seat(arrivals[j]);
        assert.gt(Math.max(Math.abs(x - px), Math.abs(y - py)), 1, 'new landings are not adjacent');
      }
    }
  });
})();
