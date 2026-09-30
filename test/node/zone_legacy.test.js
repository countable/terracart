(() => {
  const drain = it => { let r; do { r = it.next(); } while (!r.done); return r.value; };
  const isLegacy = o => /^(?:wp|hr|hm|ptree|tree|ft|mr|rb)_-?\d+_/.test(o.id || '');

  test('zone legacy: road coin seeds are removed across the full zone coverage', () => {
    const N = 8, coverage = new Uint16Array(N * N);
    coverage[18] = 1;
    const coin = (id, x) => ({ kind: 'coindrop', seeded: true, _street: 'golden', id, x, y: 2.5 });
    const streetDress = { coins: [coin('covered', 2.5), coin('outside', 6.5)] };
    const occupied = new Set([18, 22]);
    const removed = drain(WorldGen.clearZoneAmbientSteps({ field: { coverage }, objects: [], wildplants: [],
      occupied, streetDress, tx: 0, ty: 0, N, tileEdgeM: N }));
    assert.eq(removed, 1);
    assert.eq(streetDress.coins.length, 1);
    assert.eq(streetDress.coins[0].id, 'outside');
    assert.falsy(occupied.has(18), 'cleared coin seat is available to the authored zone');
    assert.truthy(occupied.has(22), 'uncovered coin retains its seat');
  });

  test('zone legacy: coverage overrides biome and street decoration while authored, placed and uncovered items survive', () => {
    const N = 8, coverage = new Uint16Array(N * N);
    for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) coverage[y * N + x] = 1;
    const at = (id, x, y, extra = {}) => ({ id, x: x + .5, y: y + .5, ...extra });
    const objects = [at('ptree_0_0_1_1', 1, 1, { kind: 'tree' }),
      at('tree_osm_123', 2, 1, { kind: 'tree' }), at('c_0_0_3_1', 3, 1, { kind: 'chest' }),
      at('tree_0_0_4_1', 4, 1, { kind: 'tree' }), at('ft_0_0_5_1', 5, 1, { kind: 'fruittree' }),
      at('ptree_0_0_6_1', 6, 1, { kind: 'tree' })];
    const wildplants = [at('wp_0_0_1_2', 1, 2), at('hr_0_0_2_2', 2, 2),
      at('wp_0_0_3_2_pp', 3, 2), at('wp_0_0_4_2_pl', 4, 2),
      at('hm_0_0_5_2', 5, 2), at('wp_0_0_1_3_ry', 1, 3),
      at('wp_0_0_6_2', 6, 2), at('wp_player', 2, 3, { placed: true }),
      at('wp_street', 3, 3, { _street: 'orchard' }), at('wp_variant', 4, 3, { zoneVariant: 'meadow' })];
    // A preserved item sharing a removed cell must still block the new pattern.
    objects.push(at('authored_shared', 2, 2, { kind: 'infoboard' }));
    const streetDress = { objects: [at('street_shared', 3, 2, { kind: 'waystone' })],
      treasures: [at('treasure_shared', 4, 2)], wildplants: [at('street_outside', 6, 6)],
      lairs: [{ lx: 5.5, ly: 5.5 }, { lx: 6.5, ly: 6.5 }],
      marks: new Uint8Array(N * N).fill(4), slowCells: new Map([[18, 'tar'], [63, 'tar']]) };
    const occupied = new Set([63]);
    for (const o of [...objects, ...wildplants]) occupied.add(Math.floor(o.y) * N + Math.floor(o.x));
    const field = { coverage, anchors: [{ kind: 'grove', gx: 99, gy: 100 }] };
    const removed = drain(WorldGen.clearZoneAmbientSteps({ field, objects, wildplants,
      occupied, streetDress, tx: 0, ty: 0, N, tileEdgeM: N }));
    assert.eq(removed, 12);
    assert.eq(field.legacyRemovedByAnchor['grove:99,100'].ambient, 9);
    assert.eq(field.legacyRemovedByAnchor['grove:99,100'].street, 3);
    assert.eq(objects.length, 4);
    assert.eq(wildplants.length, 4);
    assert.falsy(occupied.has(1 * N + 1), 'cleared tree cell opens');
    assert.falsy(occupied.has(2 * N + 1), 'cleared random-flora cell opens');
    for (const idx of [2 * N + 2, 63]) {
      assert.truthy(occupied.has(idx), `preserved reservation ${idx}`);
    }
    assert.truthy(objects.some(o => o.id === 'tree_osm_123'));
    assert.truthy(objects.some(o => o.id === 'ptree_0_0_6_1'), 'uncovered park tree survives');
    assert.eq(streetDress.objects.length + streetDress.treasures.length, 0);
    assert.eq(streetDress.lairs.length, 1);
    assert.eq(streetDress.lairs[0].lx, 6.5);
    assert.eq(streetDress.wildplants[0].id, 'street_outside');
    assert.eq(streetDress.marks[18], 0);
    assert.eq(streetDress.marks[63], 4);
    assert.falsy(streetDress.slowCells.has(18));
    assert.truthy(streetDress.slowCells.has(63));
    assert.falsy(occupied.has(19), 'old street scenery cell opens');
    assert.falsy(occupied.has(20), 'old street treasure cell opens');
    for (const id of ['wp_player', 'wp_street', 'wp_variant', 'wp_0_0_6_2']) {
      assert.truthy(wildplants.some(o => o.id === id), id);
    }
  });

  test('zone legacy: Windermere Park coverage contains its variant without older park flora', () => {
    const tx = 2754, ty = 5566, N = WorldGen.cellsPerEdgeForTile(ty);
    const edge = WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(ty));
    const r = WorldGen.rasterizeTile(MVT.decodeTile(FIXTURE_TILES[`${tx}_${ty}`]), N, tx, ty, edge);
    const poi = r.objects.find(o => /windermere park/i.test(o.name || ''));
    assert.truthy(poi, 'real Windermere Park fixture');
    assert.eq(poi.kind, 'grove_shrine', 'park POI is the shrine');
    assert.falsy(r.objects.some(o => o.kind === 'chest' && o._poiAt === poi._poiAt));
    assert.falsy(r.zoneDress.objects.some(o => o.kind === 'grove_shrine'), 'no second shrine beside the POI');
    const anchor = r.zone.anchors.find(a => `${a.lx},${a.ly}` === poi._poiAt);
    assert.truthy(anchor, 'park anchor');
    const slot = r.zone.anchors.indexOf(anchor) + 1;
    const cell = o => Math.floor((o.y - ty * edge) / (edge / N)) * N + Math.floor((o.x - tx * edge) / (edge / N));
    const inside = o => r.zone.coverage[cell(o)] === slot;
    assert.eq([...r.objects, ...r.wildplants].filter(o => inside(o) && isLegacy(o)).length, 0,
      'old random flora and rows no longer compete with the declarative pattern');
    assert.gt(r.zone.legacyRemoved, 0, 'the fixture exercises replacement');
    const placed = [...r.zoneDress.objects, ...r.zoneDress.wildplants].filter(inside);
    assert.gt(placed.length, 10, 'the selected variant has visible coverage');
    const occupied = new Set([...r.objects, ...r.wildplants,
      ...(r.streetDress?.objects || []), ...(r.streetDress?.wildplants || []),
      ...(r.streetDress?.treasures || [])].map(cell));
    for (const o of placed) assert.falsy(occupied.has(cell(o)), `${o.id} avoids preserved objects and street claims`);
    assert.truthy(r.objects.includes(poi), 'the actual place remains');
  });
})();
