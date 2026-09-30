// Declarative dressing tests exercise the real shared spawn gate and records.
(function () {
  function context(id, changes) {
    const v = ZoneVariants.byId(id), N = 64, c = 32;
    const a = { kind: v.zone, gx: (c + 0.5) * 4096 / N, gy: (c + 0.5) * 4096 / N,
      lx: (c + 0.5) * 4096 / N, ly: (c + 0.5) * 4096 / N, upm: N * WorldGen.CELL_M / 4096,
      R: 140, owned: true, key: 112, variant: id, rotation: 0 };
    const coverage = new Uint16Array(N * N).fill(1), grid = new Uint8Array(N * N).fill(WorldGen.T.PARK);
    const ctx = { N, tx: 0, ty: 0, tileEdgeM: N * WorldGen.CELL_M, grid,
      field: { anchors: [a], coverage, idx: new Uint8Array(N * N), under: new Uint8Array(N * N) },
      chests: [], spawnOpts: { occupied: new Set(), spawnWhy: new Uint16Array(N * N), roadMask: new Uint8Array(N * N), roadClass: new Uint8Array(N * N) } };
    return Object.assign(ctx, changes);
  }
  const all = out => [...out.objects, ...out.wildplants, ...out.traps, ...out.guards];
  const finds = out => all(out).filter(o => o.zoneLayer === 'find');
  test('zone dressing: all variants keep finite counts, tool tiers, uniqueness and rebuild identities', () => {
    for (const row of ZoneVariants.rows) {
      const a = ZoneDressing.dress(context(row.id)), b = ZoneDressing.dress(context(row.id));
      assert.eq(finds(a).length, row.finds.count, row.id);
      assert.eq(a.guards.filter(g => g.zoneLayer !== 'background').length, row.guards.count || 0, row.id);
      assert.eq(new Set(all(a).map(o => `${o.x},${o.y}`)).size, all(a).length, `${row.id}: unique cells`);
      assert.eq(JSON.stringify(all(a)), JSON.stringify(all(b)), `${row.id}: stable rebuild`);
      const m = ZoneVariants.materials[row.finds.material];
      for (const find of finds(a)) if (m.kind === 'mineralrock') {
        assert.eq(find.requiredTier, m.requiredTier); assert.eq(find.yieldTier, m.yieldTier);
      }
    }
  });
  function pirateShrine() {
    const ctx = context('pirate_cove'), a = ctx.field.anchors[0], cell = WorldGen.CELL_M;
    ctx.grid.fill(WorldGen.T.SAND);
    ctx.chests.push({ kind: 'chest', id: 'beach_daily', name: 'Pirate Cove',
      _poiAt: `${a.lx},${a.ly}`, x: 32.5 * cell, y: 32.5 * cell });
    ctx.spawnOpts.occupied.add(32 * ctx.N + 32);
    return ctx;
  }
  test('zone dressing: Pirate Cove reserves one wreck and approach before finds and guards', () => {
    const ctx = pirateShrine(), out = ZoneDressing.dress(ctx), shrine = ctx.chests[0];
    assert.eq(shrine.kind, 'grove_shrine'); assert.eq(shrine.id, 'beach_daily');
    assert.eq(shrine._shrineArt, 'shipwreck'); assert.eq(shrine._shrineExtentCells, 3);
    assert.eq(out.objects.filter(o => o.kind === 'grove_shrine').length, 0, 'no second reward');
    assert.eq(out.diagnostics[0].shortfalls.length, 0);
    const reserved = new Set();
    for (let y = 31; y <= 33; y++) for (let x = 31; x <= 33; x++) reserved.add(y * ctx.N + x);
    reserved.add(30 * ctx.N + 32);
    for (const i of reserved) assert.truthy(ctx.spawnOpts.occupied.has(i), 'whole footprint reserved');
    for (const o of all(out)) assert.falsy(reserved.has(o._iy * ctx.N + o._ix), 'scenery and guards cannot overlap hull or approach');
    assert.eq(out.wildplants.filter(o => o.zoneLayer === 'poi').length, 0, 'wreck replaces small shrine composition');
    assert.eq(finds(out).length, ZoneVariants.byId('pirate_cove').finds.count);
  });
  test('zone dressing: blocked Pirate Cove wreck relocates deterministically without moving obstacles', () => {
    const make = () => {
      const ctx = pirateShrine();
      ctx.spawnOpts.occupied.add(31 * ctx.N + 31);
      ctx.spawnOpts.roadMask[33 * ctx.N + 33] = 1;
      ctx.grid[32 * ctx.N + 34] = WorldGen.T.WATER;
      return ctx;
    };
    const a = make(), b = make(), out = ZoneDressing.dress(a);
    ZoneDressing.dress(b);
    assert.eq(JSON.stringify(a.chests), JSON.stringify(b.chests));
    const shrine = a.chests[0];
    assert.eq(shrine._shrineArt, 'shipwreck');
    assert.truthy(shrine._ix !== 32 || shrine._iy !== 32, 'whole hull moves away from obstruction');
    for (let y = shrine._iy - 1; y <= shrine._iy + 1; y++) for (let x = shrine._ix - 1; x <= shrine._ix + 1; x++) {
      assert.eq(a.grid[y * a.N + x], WorldGen.T.SAND);
      assert.falsy(a.spawnOpts.roadMask[y * a.N + x]);
      assert.falsy(x === 31 && y === 31, 'higher-priority obstacle preserved');
    }
    assert.eq(out.diagnostics[0].shortfalls.length, 0);
  });
  test('zone dressing: narrow or gated sand retains the existing accessible daily shrine', () => {
    for (const mode of ['narrow', 'gated']) {
      const ctx = pirateShrine(), before = { ...ctx.chests[0] };
      if (mode === 'narrow') {
        ctx.grid.fill(WorldGen.T.PARK);
        for (let y = 0; y < ctx.N; y++) ctx.grid[y * ctx.N + 32] = WorldGen.T.SAND;
      } else {
        ctx.spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
        ctx.spawnOpts.spawnWhy[32 * ctx.N + 32] = 0;
      }
      const out = ZoneDressing.dress(ctx), shrine = ctx.chests[0];
      assert.eq(shrine.kind, 'grove_shrine'); assert.eq(shrine.id, before.id);
      assert.eq(shrine.x, before.x); assert.eq(shrine.y, before.y);
      assert.eq(shrine._shrineArt, undefined);
      assert.truthy(out.diagnostics[0].shortfalls.includes('shrine:shipwreck'));
    }
  });
  test('zone dressing: orchard is apple-only with medium deciduous timber and no ambient flower mix', () => {
    const out = ZoneDressing.dress(context('orchard'));
    const fruit = out.objects.filter(o => o.kind === 'fruittree');
    const timber = out.objects.filter(o => o.kind === 'tree');
    assert.gt(fruit.length, 200, 'denser than the former four-percent fruit grid');
    assert.gt(timber.length, 200);
    assert.truthy(fruit.every(o => o.species === 'apple'), 'all fruit records harvest apples');
    assert.truthy(timber.every(o => o.species === 'maple' && o.size === 'medium' && treeSizeClass(o) === 'medium'));
    assert.eq(out.wildplants.length, 3, 'only the finite gemfruit finds remain');
    assert.truthy(out.wildplants.every(o => o.crop === 'gemfruit' && o.zoneLayer === 'find'));
  });
  test('zone dressing: giant mushroom art replaces only Mushroom Grove shrubs, retaining harvesting and identities', () => {
    const grove = ZoneDressing.dress(context('mushroom_grove'));
    const giants = grove.wildplants.filter(o => o.crop === 'shrub');
    assert.gt(giants.length, 0);
    for (const o of giants) {
      assert.eq(o._plantArt, 'giant_mushroom');
      assert.eq(o.kind, 'wildplant');
      assert.eq(o.id, WorldGen.cellId('wpf', 0, 0, o._ix, o._iy), 'existing shrub identity survives the art change');
      assert.eq(wildplantRule(o.crop).output, 'wood');
      assert.eq(wildplantSprite(o).sheet, 'giant_mushroom');
      assert.eq(wildplantFrame(o), 2);
    }
    assert.truthy(grove.wildplants.filter(o => o.crop === 'mushroom').every(o => o._plantArt === 'cap_cluster' && wildplantSprite(o).sheet === 'approved_mushroom_cluster'), 'forage gets its approved cluster look while keeping the mushroom crop');
    const ordinary = ZoneDressing.dress(context('meadow')).wildplants.filter(o => o.crop === 'shrub');
    assert.gt(ordinary.length, 0);
    assert.truthy(ordinary.every(o => !o._plantArt && wildplantSprite(o).sheet === 'bushes'), 'other groves keep bushes');
  });
  test('zone art: masonry, formal hedges and moss retain their original harvest identities', () => {
    const masonry = ZoneDressing.dress(context('broken_masonry')).wildplants.filter(o => o.crop === 'rockfruit');
    assert.gt(masonry.length, 0);
    assert.truthy(masonry.every(o => o._plantArt === 'masonry' && wildplantSprite(o).sheet === 'approved_masonry_rubble'));
    assert.eq(wildplantSprite({crop:'rockfruit'})?.sheet, undefined, 'ordinary stone keeps the crop sheet despite its placement-specific looks');
    assert.eq(inventoryIconSource('rockfruit').sheet, 'crops', 'harvest remains the same inventory item');
    for (const o of masonry) assert.eq(o.id, WorldGen.cellId(o.zoneLayer === 'background' ? 'wpf' : 'wz', 0, 0, o._ix, o._iy));
    const hedges = ZoneDressing.dress(context('formal_garden')).wildplants.filter(o => o.crop === 'shrub');
    assert.gt(hedges.length, 0);
    assert.truthy(hedges.every(o => wildplantSprite(o).sheet === 'approved_clipped_hedge'));
    assert.eq(wildplantSprite({crop:'shrub',_biome:5}).sheet, 'approved_clipped_hedge');
    assert.eq(wildplantSprite({crop:'shrub',_biome:16}).sheet, 'approved_clipped_hedge');
    assert.eq(wildplantSprite({crop:'shrub',_biome:6}).sheet, 'bushes');
    const stones = ZoneDressing.dress(context('stone_garden')).objects.filter(o => o.kind === 'mineralrock');
    assert.truthy(stones.some(o => o._objectArt === 'moss'));
    assert.truthy(stones.filter(o => o.yieldTier > 1).every(o => !o._objectArt), 'iron ore keeps its tier art');
    const looks = Render.objectAppearance({textures:{exists:()=>true},save:{}},new Map(),false).RENDER_SPEC;
    assert.eq(looks.mineralrock.key(stones.find(o=>o._objectArt==='moss')), 'approved_moss_rocks');
    assert.eq(looks.stakes.key({_street:'burned'}), 'approved_charred_stakes');
    assert.eq(looks.stakes.key({}), 'stakes');
  });
  test('zone dressing: Ancient Grove centers and shrine trees use the largest mature canopy', () => {
    const grove = ZoneDressing.dress(context('ancient_grove'));
    const trees = grove.objects.filter(o => o.kind === 'tree');
    assert.gt(trees.filter(o => o.zoneLayer === 'background').length, 0, 'cluster centers are trees');
    assert.gt(trees.filter(o => o.zoneLayer === 'poi').length, 0, 'shrine ring has trees');
    for (const o of trees) {
      assert.eq(o.species, 'maple');
      assert.eq(o.size, 'large');
      assert.eq(treeSizeClass(o), 'full');
      assert.falsy(treeUsesGrowthSheet(o), 'mature canopy overrides the default sapling variant');
      assert.eq(treeWoodMul(o), 4, 'largest tree appearance and harvesting size agree');
    }
    const orchard = ZoneDressing.dress(context('orchard')).objects.filter(o => o.kind === 'tree');
    assert.truthy(orchard.every(o => o.size === 'medium'), 'orchard trees retain their medium canopy');
  });
  test('zone dressing: blocked guards choose the nearest eligible seat and retain their identity', () => {
    const pristine = ZoneDressing.dress(context('mushroom_grove')).guards[0];
    function blockedContext() {
      const ctx = context('mushroom_grove'), { _ix: x, _iy: y } = pristine, N = ctx.N;
      ctx.spawnOpts.occupied.add(y * N + x);
      ctx.spawnOpts.roadMask[(y - 1) * N + x] = 1;
      ctx.field.coverage[y * N + x - 1] = 0;
      ctx.spawnOpts.spawnWhy[y * N + x + 1] = WorldGen.SPAWN_WHY.SENSITIVE;
      return ctx;
    }
    const out = ZoneDressing.dress(blockedContext()), repeat = ZoneDressing.dress(blockedContext());
    assert.eq(out.guards.length, 1);
    const guard = out.guards[0];
    assert.eq(guard._ix, pristine._ix); assert.eq(guard._iy, pristine._iy + 1);
    assert.eq(guard.id, pristine.id); assert.eq(guard.homeX, pristine.homeX); assert.eq(guard.homeY, pristine.homeY);
    assert.eq(JSON.stringify(out.guards), JSON.stringify(repeat.guards));
    assert.eq(out.diagnostics[0].guardsPlaced, 1); assert.eq(out.diagnostics[0].shortfalls.length, 0);
  });
  test('zone dressing: guards report a shortfall when the nearby spawn gate has no eligible seat', () => {
    const ctx = context('mushroom_grove'), pristine = ZoneDressing.dress(context('mushroom_grove'));
    const guard = pristine.guards[0], find = finds(pristine)[0];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > 4) continue;
      const x = guard._ix + dx, y = guard._iy + dy;
      if (x === find._ix && y === find._iy) continue; // The find itself occupies this cell.
      ctx.spawnOpts.spawnWhy[y * ctx.N + x] = WorldGen.SPAWN_WHY.SENSITIVE;
    }
    const out = ZoneDressing.dress(ctx);
    assert.eq(finds(out).length, 1); assert.eq(out.guards.length, 0);
    assert.eq(out.diagnostics[0].guardsPlaced, 0); assert.includes(out.diagnostics[0].shortfalls, 'guard:0');
  });
  test('zone dressing: buffered anchors cannot mint another finite reward or guard', () => {
    for (const id of ['black_ring', 'ancient_grove', 'seep']) {
      const ctx = context(id); ctx.field.anchors[0].owned = false;
      const out = ZoneDressing.dress(ctx);
      assert.eq(finds(out).length, 0); assert.eq(out.guards.filter(g => g.zoneLayer !== 'background').length, 0);
      assert.gt(all(out).length, 0, 'neighbour still draws background');
    }
  });
  test('zone dressing: union fallback finds eligible ground and reports exhausted budgets', () => {
    const ctx = context('black_ring'), N = ctx.N;
    ctx.field.coverage.fill(0);
    ctx.field.coverage[10 * N + 10] = 1;
    ctx.field.coverage[10 * N + 11] = 1;
    const out = ZoneDressing.dress(ctx);
    assert.eq(finds(out).length, 2, 'fringe-only coverage supports both finds');
    const blocked = context('black_ring'); blocked.grid.fill(WorldGen.T.BUILDING);
    const empty = ZoneDressing.dress(blocked);
    assert.eq(all(empty).length, 0);
    assert.eq(empty.diagnostics[0].shortfalls.length, 2);
  });
  test('zone dressing: roads, existing occupancy and sensitive ghost ground stay excluded', () => {
    const ctx = context('ordered_graves'), N = ctx.N;
    for (let x = 0; x < N; x++) ctx.spawnOpts.roadMask[20 * N + x] = 1;
    for (let y = 0; y < N; y++) ctx.spawnOpts.occupied.add(y * N + 22);
    const out = ZoneDressing.dress(ctx);
    for (const o of all(out)) { assert.falsy(o._iy === 20); assert.falsy(o._ix === 22); }
    const sensitive = context('ordered_graves');
    sensitive.spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.SENSITIVE);
    const fallback = ZoneDressing.dress(sensitive);
    assert.eq(fallback.objects.filter(o => o.kind === 'headstone').length, 0);
    assert.gt(fallback.objects.filter(o => o.kind === 'mineralrock').length, 0, 'safe stone replaces refused graves');
  });
  test('zone dressing: background diagnostics distinguish legacy occupancy, gates and composition', () => {
    const pristine = ZoneDressing.dress(context('ordered_graves'));
    const cells = all(pristine).filter(o => o.zoneLayer === 'background' && o._iy < 10);
    assert.gte(cells.length, 2);
    const ctx = context('ordered_graves'), occupied = cells[0]._iy * ctx.N + cells[0]._ix;
    const blocked = cells[1]._iy * ctx.N + cells[1]._ix;
    ctx.spawnOpts.occupied.add(occupied);
    ctx.spawnOpts.spawnWhy[blocked] = WorldGen.SPAWN_WHY.RESTRICTED;
    const out = ZoneDressing.dress(ctx), counts = out.diagnostics[0].background;
    const row = ZoneVariants.byId('ordered_graves'), origin = ZoneVariants.poiOrigin(row);
    let nominal = 0;
    for (let y = 0; y < ctx.N; y++) for (let x = 0; x < ctx.N; x++) {
      if (ZoneVariants.sample(row, x - 32 + origin[0], y - 32 + origin[1], ctx.field.anchors[0].key)) nominal++;
    }
    assert.eq(counts.planned, nominal, 'includes motif samples replaced by POI and connections');
    assert.eq(counts.occupied, 1, 'only occupancy present before dressing');
    assert.eq(counts.blocked, 1, 'hard gate refusals');
    assert.eq(counts.reserved, pristine.diagnostics[0].background.reserved);
    assert.gt(counts.reserved, 0, 'own composition has a distinct budget');
    assert.eq(counts.placed, all(out).filter(o => o.zoneLayer === 'background').length);
    assert.eq(counts.planned, counts.placed + counts.occupied + counts.blocked + counts.reserved);
  });
  test('zone dressing: successful headstone fallback is placed, not blocked', () => {
    const ctx = context('ordered_graves');
    ctx.spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.SENSITIVE);
    const out = ZoneDressing.dress(ctx), counts = out.diagnostics[0].background;
    assert.eq(counts.blocked, 0);
    assert.eq(counts.placed, all(out).filter(o => o.zoneLayer === 'background').length);
    assert.gt(counts.placed, 0);
    assert.eq(counts.planned, counts.placed + counts.occupied + counts.blocked + counts.reserved);
  });
  test('zone dressing: surface traps obey the existing trap-ground predicate', () => {
    const ctx = context('broken_depot'), N = ctx.N;
    for (let x = 0; x < N; x++) ctx.grid[30 * N + x] = WorldGen.T.PATH;
    const out = ZoneDressing.dress(ctx);
    assert.gt(out.traps.length, 0);
    for (const trap of out.traps) assert.truthy(Traps.isTrapGround(ctx.grid, ctx.spawnOpts.roadClass, N, N, trap._ix, trap._iy, ctx.field.under, ctx.spawnOpts.roadMask));
    const noGround = context('broken_depot'); noGround.grid.fill(WorldGen.T.GRASS);
    assert.eq(ZoneDressing.dress(noGround).traps.length, 0);
  });
  test('zone dressing: work-yard copper lines remain continuous and POI slots touch the chest', () => {
    const ctx = context('work_yard'), out = ZoneDressing.dress(ctx), origin = 32;
    const background = new Map(all(out).filter(o => o.zoneLayer === 'background').map(o => [`${o._ix},${o._iy}`, o]));
    // First boundary of the fixed 21 x 21 figure sits 10 cells from its origin.
    for (let x = origin - 10; x <= origin + 10; x++) {
      const o = background.get(`${x},${origin - 10}`);
      assert.truthy(o, `unbroken copper line ${x}`); assert.eq(o.yieldTier, 2);
    }
    for (const o of all(out).filter(o => o.zoneLayer === 'poi')) assert.eq(Math.max(Math.abs(o._ix - origin), Math.abs(o._iy - origin)), 1);
    const chestCtx = context('meadow'), a = chestCtx.field.anchors[0], cell = WorldGen.CELL_M;
    chestCtx.chests.push({ kind: 'chest', id: 'church', _poiAt: `${a.lx},${a.ly}`, x: 35.5 * cell, y: 33.5 * cell });
    chestCtx.spawnOpts.occupied.add(33 * chestCtx.N + 35);
    const chestOut = ZoneDressing.dress(chestCtx);
    assert.eq(chestCtx.chests[0].kind, 'grove_shrine');
    assert.eq(chestCtx.chests[0].id, 'church', 'replacement keeps the POI identity');
    assert.eq(chestCtx.chests[0].zoneNexus, undefined, 'daily shrine has no chest tier bonus');
    assert.eq(chestOut.objects.filter(o => o.kind === 'grove_shrine').length, 0, 'no extra adjacent shrine');
    assert.eq(chestOut.nexus[0].chestId, null);
    assert.eq(chestOut.nexus[0].poiId, 'church');
    const composition = all(chestOut).filter(o => o.zoneLayer === 'poi');
    assert.eq(composition.filter(o => o.crop === 'longgrass').length, 28, 'full radius-three grass disk around settled POI');
    assert.eq(composition.filter(o => o.crop === 'shrub').length, 20, 'continuous bush rim');
    for (const o of chestOut.wildplants) {
      const d2 = (o._ix - 35) ** 2 + (o._iy - 33) ** 2;
      if (o.zoneLayer === 'poi') assert.eq(o.crop, d2 <= 9 ? 'longgrass' : 'shrub');
      if (o.crop === 'longgrass') assert.lte(d2, 9, 'no grass outside the clearing');
      if (o.zoneLayer === 'background') assert.eq(o.crop, 'shrub', 'outer background is bushes only');
    }
  });
  test('zone dressing: Flint Field has a central flint disk, rubble rim and rubble-only scatter', () => {
    const out = ZoneDressing.dress(context('flint_field'));
    const poi = out.wildplants.filter(o => o.zoneLayer === 'poi');
    assert.eq(poi.filter(o => o.crop === 'flint').length, 12);
    assert.eq(poi.filter(o => o.crop === 'rockfruit').length, 16);
    for (const o of out.wildplants) {
      const d2 = (o._ix - 32) ** 2 + (o._iy - 32) ** 2;
      if (o.crop === 'flint') assert.lte(d2, 4, 'flint stays in the circle');
      if (o.zoneLayer === 'background') assert.eq(o.crop, 'rockfruit');
    }
  });
  test('zone dressing: different tile-row grids sample the same anchor phase across their seam', () => {
    const owner = context('ancient_grove'), a = owner.field.anchors[0];
    a.gy = a.ly = 4090; a.rotation = 1;
    const neighbour = context('ancient_grove');
    neighbour.N = 63; neighbour.ty = 1; neighbour.tileEdgeM = 63 * WorldGen.CELL_M;
    neighbour.field.anchors = [{ ...a, owned: false, ly: a.ly - 4096 }];
    neighbour.field.coverage = new Uint16Array(63 * 63).fill(1);
    neighbour.grid = new Uint8Array(63 * 63).fill(WorldGen.T.PARK);
    neighbour.spawnOpts = { occupied: new Set(), spawnWhy: new Uint16Array(63 * 63) };
    const unit = 4096 / 64, originX = (Math.floor(a.gx / unit) + 0.5) * unit;
    const originY = (Math.floor(a.gy / unit) + 0.5) * unit, v = ZoneVariants.byId(a.variant), p = ZoneVariants.poiOrigin(v);
    for (const ctx of [owner, neighbour]) {
      const out = ZoneDressing.dress(ctx);
      const background = all(out).filter(o => o.zoneLayer === 'background');
      assert.gt(background.length, 0);
      for (const o of background) {
        const dx = Math.round(((o._ix + 0.5) * 4096 / ctx.N - originX) / unit);
        const dy = Math.round((ctx.ty * 4096 + (o._iy + 0.5) * 4096 / ctx.N - originY) / unit);
        const [u, w] = ZoneVariants.inverseRotate(dx, dy, a.rotation);
        const material = ZoneVariants.materials[ZoneVariants.sample(v, u + p[0], w + p[1], a.key)];
        assert.truthy(material); assert.eq(o.kind, material.kind); if (material.crop) assert.eq(o.crop, material.crop);
      }
    }
  });
  test('zone dressing: sliced passes yield coverage, patterns and blocked-find searches', () => {
    const ctx = context('seep'); ctx.grid.fill(WorldGen.T.BUILDING);
    const labels = [], it = ZoneDressing.dressSteps(ctx); let r;
    do { r = it.next(); if (!r.done) labels.push(r.value); } while (!r.done);
    assert.includes(labels, 'zone variant coverage'); assert.includes(labels, 'zone variant pattern rows'); assert.includes(labels, 'zone find fallback');
  });
  test('zone dressing: repeating carnivorous plants use enemy gates and stable stationary seats', () => {
    for (const id of ['ancient_grove', 'hedge_garden']) {
      const ctx = context(id), out = ZoneDressing.dress(ctx);
      const plants = out.guards.filter(g => g.zoneLayer === 'background');
      assert.gt(plants.length, 1, id);
      for (const p of plants) {
        assert.eq(p.kind, 'plant'); assert.truthy(p.stationary);
        assert.eq(p.homeX, p.x); assert.eq(p.homeY, p.y);
        assert.eq(p.id, WorldGen.cellId('zp', 0, 0, p._ix, p._iy));
      }
      const blocked = context(id);
      for (const p of plants) blocked.spawnOpts.spawnWhy[p._iy * blocked.N + p._ix] = WorldGen.SPAWN_WHY.SENSITIVE;
      assert.eq(ZoneDressing.dress(blocked).guards.filter(g => g.zoneLayer === 'background').length, 0);
      const neighbour = context(id); neighbour.field.anchors[0].owned = false;
      assert.gt(ZoneDressing.dress(neighbour).guards.filter(g => g.zoneLayer === 'background').length, 1,
        'pattern seats continue into buffered coverage without duplicating finite guards');
    }
  });
  test('zone encounters: species, stationary plants and a finite proximity ghost follow the theme', () => {
    const kinds = id => ZoneDressing.dress(context(id)).guards.filter(g => g.zoneLayer !== 'background').map(g => g.kind).join();
    assert.eq(kinds('pirate_cove'), 'pirate_grunt,pirate_gunner');
    assert.eq(kinds('orchard'), 'farmer_goblin');
    assert.eq(kinds('ancient_grove'), 'plant,spider');
    assert.eq(kinds('ordered_graves'), 'skeleton_soldier');
    assert.eq(kinds('overgrown_graves'), 'spider');
    assert.eq(kinds('broken_masonry'), 'club_goblin');
    assert.eq(kinds('mystic_reef'), 'giant_crab');
    assert.truthy(['slime', 'spider'].includes(kinds('mushroom_grove')));
    const plant = ZoneDressing.dress(context('hedge_garden')).guards[0];
    assert.truthy(plant.stationary);
    const ghost = ZoneDressing.dress(context('silent_circle')).guards;
    assert.eq(ghost.length, 1); assert.eq(ghost[0].kind, 'ghost'); assert.eq(ghost[0].proximityCells, 4);
    for (const id of ['meadow', 'formal_garden', 'stone_garden', 'shellwater_strand', 'seep', 'black_ring']) assert.eq(kinds(id), '');
    for (const id of ['ordered_graves', 'overgrown_graves']) {
      assert.gt(ZoneDressing.dress(context(id)).objects.filter(o => o.kind === 'headstone').length, 0);
    }
  });
})();
