// Geometry and deterministic sampling of the approved declarative zone table.
(function () {
const V = ZoneVariants;
const count = (row, x0, y0, w, h, seed) => {
  const result = {};
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const material = V.sample(row, x, y, seed);
    if (material) result[material] = (result[material] || 0) + 1;
  }
  return result;
};
test('zone variants: 24 rows select deterministically without a legacy quarry', () => {
  assert.eq(V.rows.length, 24);
  assert.eq(V.rows.filter(row => row.selectable !== false).length, 24);
  assert.eq(V.byId('quarry'), null);
  assert.eq(V.forKind('quarry').length, 4);
  assert.eq(V.forKind('grove').length, 7);
  assert.eq(V.forKind('stones').length, 5);
  assert.eq(V.forKind('tar').length, 5);
  for (const kind of ['grove', 'stones', 'tar', 'beach', 'quarry']) {
    const selected = new Set();
    for (let i = 0; i < 500; i++) {
      const anchor = { kind, gx: i * 317, gy: i * -71 };
      const row = V.pick(anchor);
      assert.eq(row.zone, kind);
      assert.eq(V.pick({ ...anchor, lx: 23, owned: false }), row, 'observer does not alter selection');
      selected.add(row.id);
    }
    assert.eq(selected.size, V.forKind(kind).length, 'every declared option is selectable');
  }
  assert.eq(V.pick({ kind: 'tar', variant: 'seep' }).id, 'seep');
  assert.eq(V.pick({ kind: 'unknown' }), null);
});
test('zone affinities: bounded averaged context and neutral fallback preserve rare combinations', () => {
  assert.lt(Math.abs(V.affinityMultiplier(['cultivated'], {cultivated: .6, woodland: .3, neutral: .1}) - 1.69), 1e-12);
  assert.eq(V.affinityMultiplier(['formal'], {ruined: 1}), .6);
  assert.eq(V.affinityMultiplier(['formal', 'cultivated'], {formal: 1}), 2);
  assert.eq(V.affinityMultiplier(['formal'], {}), 1);
  assert.eq(V.affinityMultiplier([], {woodland: 1}), 1);
  for (const row of V.rows) {
    assert.gt(V.traitsFor(row).length, 0, row.id);
    for (const trait of ['woodland', 'cultivated', 'formal', 'damp', 'sacred', 'ruined', 'coastal'])
      assert.inRange(V.affinityMultiplier(row, {[trait]: 1}), .6, 2);
  }
});
test('zone affinities: source traits and park character favour matching zones without excluding alternatives', () => {
  const anchor = {kind: 'grove', gx: 417, gy: 991, character: 'wooded'};
  const weights = Object.fromEntries(V.selectionWeights(anchor).map(c => [c.row.id, c.weight]));
  assert.gt(weights.mushroom_grove, weights.formal_garden);
  assert.gt(weights.ancient_grove, weights.meadow);
  const source = {...anchor, geographicTraits: V.geographyTraits({class: 'park', landuse: 'orchard'})};
  assert.eq(V.contextFor(source).cultivated, 1, 'source geography takes precedence over generated character');
  assert.eq(V.pick({...source, variant: 'formal_garden'}).id, 'formal_garden', 'explicit choice still wins');
  const selected = new Set();
  for (let i = 0; i < 800; i++) {
    const a = {...source, gx: i * 317, gy: -i * 71};
    selected.add(V.pick(a).id);
    assert.eq(V.pick(a), V.pick({...a, owned: false, lx: -400, ly: 921}));
  }
  assert.eq(selected.size, V.forKind('grove').length);
});
test('zone affinities: cached weights follow edits to contexts, overrides and candidate tables', () => {
  const anchor = {kind: 'grove', gx: 143, gy: 851, character: 'wooded'};
  const weight = () => V.selectionWeights(anchor).find(c => c.row.id === 'formal_garden').weight;
  const wooded = weight();
  anchor.character = 'formal';
  assert.gt(weight(), wooded);
  anchor.geographicTraits = {ruined: 1};
  assert.lt(weight(), wooded);
  anchor.geographicTraits.ruined = 0;
  anchor.geographicTraits.formal = 1;
  const formal = weight(), row = V.byId('formal_garden'), original = row.weight;
  try {
    row.weight *= 3;
    assert.eq(weight(), formal * 3);
  } finally { row.weight = original; }
  assert.eq(weight(), formal);
  anchor.variant = 'orchard';
  assert.eq(V.pick(anchor).id, 'orchard');
  anchor.variant = 'formal_garden';
  assert.eq(V.pick(anchor).id, 'formal_garden');
  const diagnostic = V.selectionWeights(anchor);
  diagnostic[0].weight = 1e9;
  assert.lt(V.selectionWeights(anchor)[0].weight, 1e9, 'diagnostics cannot corrupt cached choices');
});
test('zone affinities: buffered anchor source tags and global park character agree across observers', () => {
  const feature = (x) => ({features: [{type: 1, geom: [[{x, y: 1200}]], tags: {class: 'park', subclass: 'park', natural: 'wood'}}]});
  const a = Zones.collectAnchors(feature(4000), 23, 26)[0];
  const b = Zones.collectAnchors(feature(-96), 24, 26)[0];
  assert.eq(V.contextFor(a).woodland, 1);
  assert.eq(JSON.stringify(a.geographicTraits), JSON.stringify(b.geographicTraits));
  assert.eq(V.pick(a), V.pick(b));
  const raw = {kind: 'grove', gx: a.gx, gy: a.gy};
  assert.eq(V.pick(raw), V.pick({...raw, character: BiomeProfiles.parkCharacterAt(raw.gx, raw.gy)}));
});
test('zone variants: explicit lamp tint follows coverage winner and otherwise leaves street color intact', () => {
  const tinted = V.byId('mushroom_grove'), plain = V.byId('meadow');
  const original = tinted.lampGlow;
  const entry = { cellsPerEdge: 2, zone: {
    anchors: [{ kind: 'grove', variant: tinted.id }, { kind: 'grove', variant: plain.id }],
    coverage: new Uint16Array([1, 2, 0, 1]), idx: new Uint16Array([0, 1, 0, 1])
  } };
  const streetColor = '#ffd16a';
  try {
    tinted.lampGlow = '#abcdef';
    assert.eq(V.lampGlowAt(entry, 0, 0) || streetColor, '#abcdef', 'zone overrides street outside the core too');
    assert.eq(V.lampGlowAt(entry, 1, 0) || streetColor, streetColor, 'untinted coverage winner overrides an underlying tinted core');
    assert.eq(V.lampGlowAt(entry, 0, 1) || streetColor, streetColor, 'no zone keeps street theme');
    for (const [x, y] of [[-1, 0], [2, 0], [0, 2], [.5, 0]]) assert.eq(V.lampGlowAt(entry, x, y), null);
    assert.eq(V.lampGlowAt(null, 0, 0), null);
    delete entry.zone.coverage;
    assert.eq(V.lampGlowAt(entry, 1, 0), '#abcdef', 'core field works before coverage is available');
    tinted.lampGlow = 'invalid';
    assert.eq(V.lampGlowAt(entry, 1, 0), null);
  } finally {
    if (original === undefined) delete tinted.lampGlow;
    else tinted.lampGlow = original;
  }
});
test('zone variants: migrated grave and ruin motifs fit small zones and retain open aisles', () => {
  for (const id of ['ordered_graves', 'overgrown_graves', 'broken_masonry', 'broken_depot']) {
    const row = V.byId(id), [w, h] = row.background.repeatCells;
    assert.lte(w, 6, id); assert.lte(h, 6, id);
    const origin = V.poiOrigin(row);
    assert.inRange(origin[0], 0, w - 1); assert.inRange(origin[1], 0, h - 1);
    const occupied = new Set();
    for (const slot of row.background.slots) {
      const [x, y] = slot.at;
      assert.inRange(x, 0, w - 1); assert.inRange(y, 0, h - 1);
      assert.falsy(occupied.has(`${x},${y}`), `${id} duplicate slot`);
      occupied.add(`${x},${y}`);
      assert.eq(V.sample(row, x - w, y - h, 'anchor'), slot.material);
      assert.eq(V.sample(row, x + w, y + h, 'anchor'), slot.material);
    }
    // Every motif leaves a continuous lane through successive repeat blocks.
    assert.truthy(Array.from({length: w}, (_, x) => x).some(x =>
      Array.from({length: h}, (_, y) => y).every(y => !V.sample(row, x, y, 'anchor'))), id);
  }
});
test('zone variants: repeated geometry preserves densities and phase across negative cells', () => {
  for (const row of V.rows.filter(v => v.background.type === 'repeat_motif')) {
    const b = row.background, [w, h] = b.repeatCells;
    // Four block phases include the full flower-bed color cycle.
    const fixed = { ...row, background: { ...b, gapScatter: null } };
    const counts = count(fixed, -2 * w, -h, 4 * w, h, 'anchor');
    const area = 4 * w * h;
    const empty = area - Object.values(counts).reduce((n, value) => n + value, 0);
    const expected = Object.assign({}, b.materialDensity, b.hazardDensity);
    for (const [material, density] of Object.entries(expected)) {
      const scatter = b.gapScatter && material === b.gapScatter.material ? empty / area * b.gapScatter.chance : 0;
      assert.lt(Math.abs(counts[material] / area + scatter - density), 1e-12, `${row.id}/${material}`);
    }
  }
  const formal = V.byId('formal_garden'), [w, h] = formal.background.repeatCells;
  for (let bx = -4; bx <= 4; bx++) {
    let flowerBeds = 0, orangeBeds = 0;
    for (const [x0, y0] of [[1, 1], [4, 4]]) {
      const material = V.sample(formal, bx * w + x0, y0 - h, 'a');
      if (material === 'flowers') flowerBeds++;
      if (material === 'orange') orangeBeds++;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        assert.eq(V.sample(formal, bx * w + x0 + dx, y0 - h + dy, 'b'), material, 'one species per bed');
      }
    }
    assert.gte(flowerBeds, 1, 'at least one pale flower bed per repeat');
    assert.lte(orangeBeds, 1, 'at most one accent bed per repeat');
    for (let y = 0; y < h; y++) assert.eq(V.sample(formal, bx * w + 3, y - h, 'a'), null, 'central aisle remains open');
  }
});
test('zone variants: seeded scatter has declared mix without dependence on traversal order', () => {
  for (const id of ['meadow', 'flint_field']) {
    const row = V.byId(id), counts = count(row, -150, -150, 300, 300, 'one');
    for (const [material, density] of Object.entries(row.background.materialDensity)) {
      assert.lt(Math.abs((counts[material] || 0) / 90000 - density), 0.004, `${id}/${material}`);
    }
    let differences = 0;
    for (let y = 30; y >= -30; y--) for (let x = 30; x >= -30; x--) {
      const a = V.sample(row, x, y, 'one');
      assert.eq(V.sample(row, x, y, 'one'), a);
      if (V.sample(row, x, y, 'two') !== a) differences++;
    }
    assert.gt(differences, 100, 'different anchors produce different scatter');
  }
});
test('zone variants: Mushroom Grove avoids wide empty strips at every repeated phase', () => {
  const row = V.byId('mushroom_grove');
  assert.eq(row.background.repeatCells.join(','), '6,6');
  for (let x = -6; x < 6; x++) {
    assert.gt(Object.values(count(row, x, -6, 1, 6, 'a')).reduce((sum, n) => sum + n, 0), 0);
  }
  for (let y = -6; y < 6; y++) {
    assert.gt(Object.values(count(row, -6, y, 6, 2, 'a')).reduce((sum, n) => sum + n, 0), 0);
  }
  assert.eq(V.sample(row, 0, 0, 'a'), 'mushroom');
  assert.eq(V.sample(row, 1, 0, 'a'), 'mushroom');
  assert.eq(V.sample(row, 3, 3, 'a'), 'mushroom');
  assert.eq(V.sample(row, 4, 3, 'a'), 'mushroom');
  assert.eq(count(row, -6, -6, 12, 12, 'a').grass || 0, 0, 'grove background has no grass');
});
test('zone variants: Ancient Grove keeps rounded clusters and scatters grass only between them', () => {
  const row = V.byId('ancient_grove'), b = row.background;
  assert.eq(b.repeatCells.join(','), '6,6');
  const fixed = { ...row, background: { ...b, gapScatter: null } };
  let empty = 0, grass = 0, changed = 0;
  for (let y = -90; y < 90; y++) for (let x = -90; x < 90; x++) {
    const material = V.sample(row, x, y, 'one'), slot = V.sample(fixed, x, y, 'one');
    assert.eq(V.sample(row, x, y, 'one'), material, 'stable across revisits');
    if (slot) assert.eq(material, slot, 'the rounded cluster is never replaced');
    else {
      empty++;
      assert.truthy(material === null || material === 'grass');
      if (material === 'grass') grass++;
      if (material !== V.sample(row, x, y, 'two')) changed++;
    }
  }
  assert.lt(Math.abs(grass / empty - b.gapScatter.chance), 0.005);
  assert.gt(changed, 100, 'gap grass varies by anchor');
  assert.eq(V.sample(row, 3, 3, 'one'), 'tree');
  assert.eq(V.sample(row, 9, 3, 'one'), 'tree', 'tree centers are six cells apart');
});
test('zone variants: compact formal beds and touching Silent Circle rims repeat without seams', () => {
  assert.eq(V.byId('formal_garden').background.repeatCells.join(','), '6,6');
  const row = V.byId('silent_circle');
  assert.eq(row.background.repeatCells.join(','), '8,8');
  assert.eq(row.connection.shape, 'none', 'connection routes must not cut the touching rims');
  for (let by = -2; by <= 2; by++) for (let bx = -2; bx <= 2; bx++) {
    const cx = 4 + bx * 8, cy = 4 + by * 8;
    for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
      assert.eq(V.sample(row, cx + dx, cy + dy, 'a'), 'grave', 'neighbouring circles share cardinal pillar cells');
    }
    assert.eq(V.sample(row, cx + 2, cy + 3, 'a'), 'grass', 'entry does not sever the shared rim');
    assert.eq(V.sample(row, cx, cy, 'a'), null, 'circle centers remain clear');
  }
});
test('zone variants: continuous grids have centered POIs and their declared extent', () => {
  for (const [id, plots] of [['hedge_garden', 4], ['work_yard', 5]]) {
    const row = V.byId(id), b = row.background, edge = b.spacingCells * plots;
    assert.eq((b.plots || b.previewPlots)[0], plots);
    assert.eq(b.spacingCells, 4);
    const [ox, oy] = V.poiOrigin(row);
    assert.eq(ox % b.spacingCells, b.spacingCells / 2);
    assert.eq(oy % b.spacingCells, b.spacingCells / 2);
    assert.eq(V.sample(row, ox, oy), null, 'clear POI plot center');
    for (let i = 0; i <= edge; i++) for (let line = 0; line <= edge; line += b.spacingCells) {
      assert.truthy(V.sample(row, line, i), 'unbroken column');
      assert.truthy(V.sample(row, i, line), 'unbroken row');
    }
    for (const [x, y] of [[-1, 0], [0, -1], [edge + 1, 0], [0, edge + 1]]) {
      if (id === 'work_yard') assert.eq(V.sample(row, x, y), null, 'finite work-yard footprint');
      else assert.truthy(V.sample(row, x, y), 'hedge lines continue across the whole union');
    }
    const side = id === 'hedge_garden' ? 16 : edge + 1, start = id === 'hedge_garden' ? 32 : 0;
    const counts = count(row, start, start, side, side);
    for (const [material, density] of Object.entries(b.materialDensity)) {
      assert.lt(Math.abs((counts[material] || 0) / (side ** 2) - density), 1e-10);
    }
  }
});
test('zone variants: Stone Garden is centered rings with every fifth stone iron', () => {
  const row = V.byId('stone_garden'), [x, y] = V.poiOrigin(row);
  assert.eq(x, row.background.centerCell[0]);
  assert.eq(y, row.background.centerCell[1]);
  const counts = count(row, 0, 0, 21, 21);
  assert.eq(counts.iron_ore, 20);
  assert.eq(counts.stone, 80);
  assert.eq(counts.grass, 30);
  let start = 0;
  for (const ring of row.background.stoneRings) {
    const slots = row.background.slots.slice(start, start + ring.count);
    for (let i = 0; i < slots.length; i++) {
      const a = slots[i], b = slots[(i + 1) % slots.length];
      assert.lte(Math.max(Math.abs(a.at[0] - b.at[0]), Math.abs(a.at[1] - b.at[1])), 1, 'ring has no empty cell between neighbouring stones');
      assert.eq(a.material, ring.sequence[(i + ring.sequenceOffset) % ring.sequence.length], 'iron rhythm follows the circle');
    }
    start += ring.count;
  }
  assert.eq(V.sample(row, 10, 10), null);
  assert.eq(V.sample(row, 31, 7), null, 'rings do not repeat');
});
test('zone variants: anchor transforms preserve POI phase and invert for every rotation', () => {
  for (const row of V.rows) for (let q = 0; q < 4; q++) {
    const origin = V.poiOrigin(row);
    for (const xy of [[-5, 3], [0, 0], [17, -8]]) {
      const world = V.rotate(xy[0], xy[1], q);
      const restored = V.inverseRotate(world[0], world[1], q);
      assert.eq(restored[0], xy[0]);
      assert.eq(restored[1], xy[1]);
      assert.eq(V.sample(row, restored[0] + origin[0], restored[1] + origin[1], 'seed'),
        V.sample(row, xy[0] + origin[0], xy[1] + origin[1], 'seed'));
    }
  }
});
test('zone variants: finite finds keep exact budgets and pick requirements', () => {
  for (const row of V.rows) {
    const finds = V.findOffsets(row, 12);
    if (row.quarryLayout) {
      assert.eq(finds.length, 0, 'quarry seats require the actual footprint');
      assert.eq(row.finds.targets.length, row.finds.count);
      continue; // Actual seats, budgets and gates are covered by quarry_runtime.
    }
    assert.eq(finds.length, row.finds.count);
    assert.eq(new Set(finds.map(f => `${f.dx},${f.dy}`)).size, finds.length);
    for (const find of finds) {
      assert.truthy(Number.isInteger(find.dx) && Number.isInteger(find.dy));
      assert.truthy(V.materials[find.material]);
    }
  }
  assert.eq(V.findOffsets(V.byId('black_ring'), 12).length, 2);
  assert.eq(V.byId('seep').finds.material, 'star');
  assert.eq(V.byId('seep').finds.count, 1);
  assert.eq(V.materials.crimson_ore.requiredTier, 5);
  assert.eq(V.materials.platinum_ore.requiredTier, 4);
  assert.eq(V.materials.gold_ore.requiredTier, 3);
  const workFind = V.findOffsets(V.byId('work_yard'), 12)[0];
  assert.eq(workFind.dx, 0);
  assert.eq(workFind.dy, 8);
});
test('zone variants: fauna affinities and material classes match their runtime lanes', () => {
  assert.eq(V.rows.filter(row => Object.keys(row.attracts).length).length, 8);
  assert.eq(Object.keys(V.byId('silent_circle').attracts).length, 0, 'quiet grave pillars do not pull extra crows');
  assert.eq(V.materials.grave.spawnClass, 'headstone');
  assert.eq(ZoneVariantData.materials.grave.spawnClass, 'enemy', 'runtime adapts without mutating reviewed source');
  assert.eq(V.materials.trap.collection, 'traps');
  for (const row of V.rows) {
    for (const slot of [...row.poi.slots, ...(row.poi.whenInsideBuilding?.slots || [])]) assert.truthy(V.materials[slot.material]);
    for (const value of Object.values(row.attracts)) assert.truthy(value > 0 && value <= 1);
    for (const material of Object.keys(count(row, -30, -30, 60, 60, 'materials'))) assert.truthy(V.materials[material]);
  }
});
})();

test('bramble groves target half of background cells before placement exclusions', () => {
 for (const id of ['meadow','ancient_grove']) {
   const row=ZoneVariants.byId(id); let shrubs=0;
   for(let y=0;y<120;y++) for(let x=0;x<120;x++) if(ZoneVariants.sample(row,x,y,'coverage')==='shrub')shrubs++;
   assert.eq(row.background.materialDensity.shrub,0.5);
   assert.inRange(shrubs/14400,0.48,0.52,id);
 }
});
