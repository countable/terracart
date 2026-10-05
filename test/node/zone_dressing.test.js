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
  const all = out => [...out.objects, ...out.wildplants, ...out.traps, ...out.guards, ...out.treasures];
  const finds = out => all(out).filter(o => o.zoneLayer === 'find');
  test('Sacred Grove: ordinary harmless bushes and trees without authored enemies', () => {
    const out = ZoneDressing.dress(context('sacred_grove'));
    const bushes = out.wildplants.filter(o => o.crop === 'shrub');
    assert.gt(bushes.length, 100);
    assert.truthy(bushes.every(o => wildplantSprite(o) === CROP_SPRITE.shrub));
    assert.truthy(bushes.every(o => walkHazardDamageRate(o) === 0));
    assert.gt(out.objects.filter(o => o.kind === 'tree').length, 0);
    assert.eq(out.guards.length, 0);
    assert.eq(out.traps.length, 0);
    assert.falsy(all(out).some(o => o.kind === 'plant' || o._plantArt === 'bramble'));
    assert.eq(finds(out).length, 1);
    assert.eq(Shrines.kindForZoneVariant('sacred_grove'), 'moss_cairn');
    assert.gt(ZoneDressing.dress(context('ancient_grove')).guards.length, 0, 'the dangerous variant remains available');
  });
  test('selected zone objects: replacements keep their own role and sparse props respect occupancy', () => {
    const garden = ZoneDressing.dress(context('stone_garden'));
    const pillars = garden.objects.filter(o => o._zoneObjectFrame === 1);
    assert.gt(pillars.length, 0);
    assert.truthy(pillars.every(o => o.kind === 'headstone' && o.yieldTier == null));
    assert.gt(garden.objects.filter(o => o.kind === 'mineralrock' && o.yieldTier === 3).length, 0, 'iron deposits remain mineable');
    const quietGraves = ZoneDressing.dress(context('silent_circle')).objects.filter(o => o.kind === 'headstone');
    assert.gt(quietGraves.length, 0);
    assert.truthy(quietGraves.every(o => o._zoneObjectFrame === 1), 'Silent Circle uses only single pillars');
    for (const id of ['ordered_graves', 'overgrown_graves']) {
      const graves = ZoneDressing.dress(context(id)).objects.filter(o => o.kind === 'headstone');
      assert.truthy(graves.every(o => [4, 5].includes(o._zoneObjectFrame)));
    }
    for (const id of ['quarry-stronghold', 'formal_garden', 'overgrown_graves', 'quarry-abandoned', 'work_yard', 'broken_depot', 'mystic_reef']) {
      const c = context(id), out = ZoneDressing.dress(c), props = out.objects.filter(o => o.kind === 'zone_prop');
      assert.gt(props.length, 0, id);
      assert.lte(props.length, 2, 'finite site accents');
      assert.eq(new Set(all(out).map(o => `${o._ix},${o._iy}`)).size, all(out).length, 'no collisions');
      const observed = context(id); observed.field.anchors[0].owned = false;
      assert.eq(ZoneDressing.dress(observed).objects.filter(o => o.kind === 'zone_prop').length, 0, 'one owner');
      const blocked = context(id); blocked.spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
      assert.eq(ZoneDressing.dress(blocked).objects.filter(o => o.kind === 'zone_prop').length, 0, 'ordinary gate');
    }
  });
  test('Broken Masonry: mostly smashable clay pots, sparse rubble and one guarded ore find', () => {
    const row=ZoneVariants.byId('broken_masonry'),out=ZoneDressing.dress(context(row.id));
    const background=all(out).filter(o=>o.zoneLayer==='background');
    for(let y=0;y<12;y++)for(let x=0;x<12;x++)
      assert.eq(ZoneVariants.sample(row,x,y,'checkerboard') != null,(x+y)%2===0,'alternating occupied and empty cells');
    const pots=background.filter(o=>o.kind==='chest' && o.barrelStyle==='clay_pot');
    assert.inRange(pots.length/background.length,.85,.95,'pots dominate the actual layout');
    assert.truthy(background.every(o=>o.barrelStyle==='clay_pot' || o.crop==='rubble'));
    assert.falsy(out.objects.some(o=>o.kind==='zone_prop'),'no decorative columns remain');
    assert.eq(out.objects.filter(o=>o.zoneLayer==='poi' && o.barrelStyle==='clay_pot').length,4);
    assert.eq(out.guards.length,1);assert.eq(out.guards[0].kind,'club_goblin');
    assert.eq(finds(out).length,1);assert.eq(finds(out)[0].yieldTier,5);
    for(const o of pots)assert.eq(barrelProfile(o).texKey,'clay_pot','pots retain normal smash rewards');
  });
  test('zone guard additions: finite enemies respect ownership, sensitive ground and distinct seats', () => {
    for(const [id,kind,count] of [['broken_depot','bat',5],['seep','split_slime',1],['work_yard','split_slime',2]]) {
      const out=ZoneDressing.dress(context(id));
      assert.eq(out.guards.length,count);assert.truthy(out.guards.every(o=>o.kind===kind));
      assert.eq(new Set(all(out).map(o=>`${o._ix},${o._iy}`)).size,all(out).length);
      const ctx=context(id),dress=ZoneDressing.dress(ctx);
      const entry={grid:ctx.grid,baseGrid:ctx.grid.slice(),cellsPerEdge:ctx.N,genObjects:[],objects:[],wildplants:[],zoneDress:dress};
      const scene=Object.assign(new SceneCreatures(),{tileEdgeM:ctx.tileEdgeM,cellM:WorldGen.CELL_M,save:{caught:[]},
        _pestFreeZone:()=>null,_starterTrailAnchor:()=>null,_provisionStarterHome(){},_carveStarterPond(){}});
      const testMode=window.__TEST_MODE;window.__TEST_MODE=false;
      try {scene.spawnInTile(entry,0,0);} finally {window.__TEST_MODE=testMode;}
      assert.eq(entry.creatures.filter(o=>o.zoneVariant===id && o.kind===kind).length,count,'the live surface roster accepts every authored guard');
      const observer=context(id);observer.field.anchors[0].owned=false;
      assert.eq(ZoneDressing.dress(observer).guards.length,0,'only source owner creates the group');
      const blocked=context(id);blocked.spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.SENSITIVE);
      assert.eq(ZoneDressing.dress(blocked).guards.length,0,'enemy gate remains authoritative');
    }
    assert.eq(EnemyRoster.get('split_slime').ability.type,'split');
  });
  test('Ordered Graves: matching dense graves, more grass, regular pots and no rocks or bird attraction', () => {
    const row = ZoneVariants.byId('ordered_graves'), out = ZoneDressing.dress(context(row.id));
    const graves = out.objects.filter(o => o.kind === 'headstone');
    assert.gt(graves.length, 400, 'four graves per 36-cell motif doubles the former density');
    assert.truthy(graves.every(o => o._zoneObjectFrame === 4), 'one grave silhouette');
    assert.gt(out.wildplants.filter(o => o.crop === 'longgrass').length, 400, 'four grass seats per motif');
    assert.eq(out.objects.filter(o => o.kind === 'mineralrock').length, 0, 'no rocks in any layer');
    const pots = out.objects.filter(o => o.kind === 'chest' && o.barrelStyle === 'clay_pot');
    assert.eq(pots.length, 2, 'two regular pots flank the POI');
    assert.truthy(pots.every(o => o._zoneObjectFrame == null), 'regular pot art');
    assert.eq(Object.keys(row.attracts).length, 0, 'no crow or raven attraction');
    assert.eq(row.background.materialDensity.grave, 4 / 36);
    assert.eq(row.background.materialDensity.grass, 4 / 36);
  });
  test('zone dressing: all variants keep finite counts, tool tiers, uniqueness and rebuild identities', () => {
    for (const row of ZoneVariants.rows) {
      const a = ZoneDressing.dress(context(row.id)), b = ZoneDressing.dress(context(row.id));
      assert.eq(finds(a).length, row.finds.count, row.id);
      assert.eq(a.guards.filter(g => g.zoneLayer !== 'background' && g.zoneLayer !== 'decoration').length, row.guards.count || 0, row.id);
      for (const mark of a.treasures.filter(o => o.coverRockId)) {
        const cover = a.objects.find(o => o.id === mark.coverRockId);
        assert.truthy(cover && cover.kind === 'mineralrock', 'buried mark has its specific covering rock');
        assert.eq(mark.x, cover.x); assert.eq(mark.y, cover.y);
      }
      const visible = all(a).filter(o => !o.coverRockId);
      assert.eq(new Set(visible.map(o => `${o.x},${o.y}`)).size, visible.length, `${row.id}: unique visible cells`);
      assert.eq(JSON.stringify(all(a)), JSON.stringify(all(b)), `${row.id}: stable rebuild`);
      const m = ZoneVariants.materials[row.finds.material];
      for (const find of finds(a)) if (m.kind === 'mineralrock') {
        assert.eq(find.requiredTier, m.requiredTier); assert.eq(find.yieldTier, m.yieldTier);
      }
    }
  });
  test('berry bushes: Meadow and Orchard each add three harvestable berries without replacing their original finds', () => {
    for (const [id, original] of [['meadow','marigold'], ['orchard','gemfruit']]) {
      const row = ZoneVariants.byId(id), out = ZoneDressing.dress(context(id));
      const berries = finds(out).filter(o => o.crop === 'berry');
      assert.eq(berries.length, 3, id + ': three bushes per anchor');
      assert.eq(finds(out).filter(o => o.crop === original).length, 3, id + ': existing finds retained');
      assert.eq(row.finds.count, 6);
      for (const berry of berries) {
        assert.eq(berry.kind, 'wildplant');
        assert.eq(wildplantOutput(berry.crop), 'berry');
        assert.eq(wildplantSprite(berry).sheet, 'zone_berry_bush');
      }
    }
  });
  function stoneGardenSite() {
    const c = context('stone_garden');
    c.field.coverage.fill(0);
    for (let y = 12; y <= 52; y++) for (let x = 12; x <= 52; x++) {
      if ((x - 32) ** 2 + (y - 32) ** 2 <= 20 ** 2) c.field.coverage[y * c.N + x] = 1;
    }
    return c;
  }
  test('zone dressing: Stone Garden fits a complete compact ring beside a large building', () => {
    const make = () => {
      const c = stoneGardenSite();
      c.grid.fill(WorldGen.T.BUILDING);
      // An outdoor frontage, offset from the original indoor POI. Large
      // rings cannot fit this pocket, but the smallest complete ring can.
      for (let y = 25; y <= 39; y++) for (let x = 38; x <= 48; x++) c.grid[y * c.N + x] = WorldGen.T.PARK;
      c.spawnOpts.spawnWhy[25 * c.N + 38] = WorldGen.SPAWN_WHY.RESTRICTED;
      c.spawnOpts.occupied.add(39 * c.N + 48);
      return c;
    };
    const c = make(), originalOccupied = new Set(c.spawnOpts.occupied), out = ZoneDressing.dress(c);
    const layout = out.diagnostics[0].layout, variant = ZoneVariants.byId('stone_garden');
    assert.truthy(layout, 'fitting is visible in diagnostics');
    assert.eq(layout.mode, 'adapted'); assert.eq(layout.radiusCells, 3);
    assert.truthy(layout.center[0] !== 32 || layout.center[1] !== 32, 'composition moves out of the building');
    const stones = out.objects.filter(o => o.zoneLayer === 'background' && ['mineralrock', 'headstone'].includes(o.kind));
    assert.eq(stones.length, variant.background.stoneRings[0].count, 'smallest stone ring remains whole');
    for (const o of all(out)) {
      assert.falsy(WorldGen.isBuildingTerrain(c.grid[o._iy * c.N + o._ix]), 'building footprint remains clear');
      assert.falsy(originalOccupied.has(o._iy * c.N + o._ix), 'existing interactable retained');
      assert.falsy(c.spawnOpts.spawnWhy[o._iy * c.N + o._ix] & WorldGen.SPAWN_WHY.RESTRICTED);
    }
    assert.eq(finds(out).length, variant.finds.count, 'one finite reward budget');
    assert.eq(out.guards.filter(o => o.zoneLayer !== 'background').length, variant.guards.count || 0);
    assert.eq(new Set(all(out).map(o => `${o._ix},${o._iy}`)).size, all(out).length, 'no stacked placements');
    assert.eq(JSON.stringify(all(out)), JSON.stringify(all(ZoneDressing.dress(make()))), 'stable replay and IDs');
  });
  test('zone dressing: unobstructed Stone Garden retains its authored rings and identities', () => {
    const c = stoneGardenSite(), out = ZoneDressing.dress(c), variant = ZoneVariants.byId('stone_garden');
    assert.falsy(out.diagnostics[0].layout?.mode === 'adapted', 'no movement on open ground');
    const origin = ZoneVariants.poiOrigin(variant);
    const background = all(out).filter(o => o.zoneLayer === 'background');
    assert.gt(background.length, 80, 'retains the full garden');
    for (const o of background) {
      const sampled = ZoneVariants.sample(variant, o._ix - 32 + origin[0], o._iy - 32 + origin[1], 112);
      const material = ZoneVariants.materials[variant.materialReplacements?.[sampled] || sampled];
      assert.truthy(material, 'same canonical authored cell');
      assert.eq(o.kind, material.kind);
      if (material.crop) assert.eq(o.crop, material.crop);
      if (o.kind === 'mineralrock') assert.eq(o.id, WorldGen.cellId('mrz', 0, 0, o._ix, o._iy));
    }
  });
  test('zone dressing: Stone Garden reports no fitting ring instead of leaving fragments', () => {
    const c = stoneGardenSite(); c.grid.fill(WorldGen.T.BUILDING);
    for (let y = 30; y <= 33; y++) for (let x = 40; x <= 43; x++) c.grid[y * c.N + x] = WorldGen.T.PARK;
    const out = ZoneDressing.dress(c), variant = ZoneVariants.byId('stone_garden');
    assert.eq(out.diagnostics[0].layout.mode, 'no_fit');
    assert.includes(out.diagnostics[0].shortfalls, 'layout:no-complete-composition');
    assert.eq(all(out).filter(o => o.zoneLayer === 'background').length, 0, 'tiny patch cannot hold a complete ring or stone bed');
    assert.eq(finds(out).length, variant.finds.count, 'finite finds still use their ordinary fallback');
  });
  test('zone dressing: narrow Stone Garden frontage receives one complete bounded stone bed', () => {
    for (const horizontal of [false, true]) {
      const make = () => {
        const c = stoneGardenSite(); c.grid.fill(WorldGen.T.BUILDING);
        for (let long = 17; long <= 47; long++) for (let thin = 40; thin <= 41; thin++) {
          const x = horizontal ? long : thin, y = horizontal ? thin : long;
          c.grid[y * c.N + x] = WorldGen.T.PARK;
        }
        return c;
      };
      const c = make(), out = ZoneDressing.dress(c), layout = out.diagnostics[0].layout;
      const bed = all(out).filter(o => o.zoneLayer === 'background');
      assert.eq(layout.mode, 'border');
      assert.eq(layout.axis, horizontal ? 'x' : 'y');
      assert.inRange(bed.length, 3, 8, 'one small complete bed');
      assert.eq(layout.stones, bed.length);
      const fixed = horizontal ? '_iy' : '_ix', along = horizontal ? '_ix' : '_iy';
      bed.sort((a, b) => a[along] - b[along]);
      for (let n = 0; n < bed.length; n++) {
        assert.includes(['mineralrock', 'headstone'], bed[n].kind);
        assert.eq(bed[n][fixed], bed[0][fixed], 'one straight row');
        if (n) assert.eq(bed[n][along] - bed[n - 1][along], 2, 'evenly spaced whole bed');
        assert.eq(c.grid[bed[n]._iy * c.N + bed[n]._ix], WorldGen.T.PARK);
      }
      assert.eq(finds(out).length, ZoneVariants.byId('stone_garden').finds.count, 'finite finds remain independent');
      assert.eq(new Set(all(out).map(o => `${o._ix},${o._iy}`)).size, all(out).length, 'no interactable collisions');
      assert.eq(JSON.stringify(all(out)), JSON.stringify(all(ZoneDressing.dress(make()))), 'stable placements and IDs');
    }
  });
  test('zone dressing: seam-spanning Stone Garden keeps its shared canonical frame', () => {
    for (const owned of [true, false]) {
      const c = stoneGardenSite(), a = c.field.anchors[0];
      a.gx = a.lx = 2.5 * 4096 / c.N; a.owned = owned;
      c.field.coverage.fill(0);
      for (let y = 12; y <= 52; y++) for (let x = 0; x <= 22; x++) c.field.coverage[y * c.N + x] = 1;
      for (let y = 29; y <= 35; y++) for (let x = 0; x <= 5; x++) c.grid[y * c.N + x] = WorldGen.T.BUILDING;
      const out = ZoneDressing.dress(c), variant = ZoneVariants.byId('stone_garden');
      assert.falsy(out.diagnostics[0].layout, 'tile-local obstacles never rephase a shared composition');
      const origin = ZoneVariants.poiOrigin(variant), background = all(out).filter(o => o.zoneLayer === 'background');
      assert.gt(background.length, 0);
      for (const o of background) {
        const sampled = ZoneVariants.sample(variant, o._ix - 2 + origin[0], o._iy - 32 + origin[1], 112);
        const material = ZoneVariants.materials[variant.materialReplacements?.[sampled] || sampled];
        assert.truthy(material, 'canonical ring continues across the seam');
        assert.eq(o.kind, material.kind);
      }
      if (!owned) assert.eq(finds(out).length, 0, 'neighbor cannot duplicate finite finds');
    }
  });
  test('churchyard containers: finite regular clay pots stand beside their POI', () => {
    for (const row of ZoneVariants.forKind('stones')) {
      const out = ZoneDressing.dress(context(row.id));
      const pots = out.objects.filter(o => o.zoneLayer === 'poi' && o.barrel && o.barrelStyle === 'clay_pot');
      assert.eq(pots.length, row.id === 'ordered_graves' ? 2 : row.id === 'broken_masonry' ? 4 : 1, row.id + ': finite POI pots');
      assert.eq(pots[0].zoneLayer, 'poi');
      assert.eq(barrelProfile(pots[0]).texKey, 'clay_pot');
      assert.eq(finds(out).length, row.finds.count, 'the site retains its finite finds');
    }
  });
  test('overgrown graves: three actual markers per motif retain vegetation and open aisles', () => {
    const row = ZoneVariants.byId('overgrown_graves'), b = row.background;
    assert.eq(b.slots.filter(s => s.material === 'grave').length, 3, 'formerly one grave per 6x6 patch');
    assert.eq(b.slots.filter(s => s.material === 'grass').length, 3);
    assert.eq(b.slots.filter(s => s.material === 'shrub').length, 2);
    for (let n = 0; n < 6; n++) assert.eq(ZoneVariants.sample(row, 2, n, 'grave-density'), null, 'open crossing aisle');
    const out = ZoneDressing.dress(context(row.id));
    assert.gt(out.objects.filter(o => o.kind === 'headstone').length, 150, 'real headstones populate the covered ground');
    assert.eq(out.guards.filter(o => o.zoneLayer !== 'background').length, row.guards.count);
  });
  test('abandoned quarry: copper ore rocks replace equipment pickups using ordinary mining', () => {
    const c = context('quarry-abandoned');
    const out = ZoneDressing.dress(c);
    const copper = out.objects.filter(o => o.kind === 'mineralrock' && o.yieldTier === 2);
    assert.gt(copper.length, 0, 'the quarry actually generates copper rocks');
    for (const rock of copper) {
      assert.eq(rock.requiredTier, 1);
      assert.eq(rock.zoneLayer, 'background');
      assert.falsy(rock.fixedLoot, 'copper follows the normal mining reward path');
    }
    assert.falsy(all(out).some(o => o.quarryEquipment));
    assert.falsy(out.objects.some(o => o.fixedLoot?.id === 'iron_bar'));
    const barrels = out.objects.filter(o => o.barrel);
    assert.gt(barrels.length, 0);
    assert.truthy(barrels.every(o => o.barrelStyle === 'barrel' && barrelProfile(o).texKey === 'barrel'), 'abandoned quarries contain barrels, never pots');
    assert.falsy(out.objects.some(o => o.fixedLoot?.slot === 'pickaxe'), 'no quarry pickaxe rewards');
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
    for (const o of all(out).filter(o => o.zoneLayer !== 'wreck')) assert.falsy(reserved.has(o._iy * ctx.N + o._ix), 'scenery and guards cannot overlap hull or approach');
    const chests = out.objects.filter(o => o.zoneLayer === 'wreck');
    assert.eq(chests.length, 1); assert.eq(chests[0].kind, 'chest');
    assert.eq(chestTier(chests[0]), 3);
    assert.truthy(reserved.has(chests[0]._iy * ctx.N + chests[0]._ix));
    assert.falsy(chests[0].zoneNexus, 'no extra nexus tier');
    assert.eq(out.wildplants.filter(o => o.zoneLayer === 'poi').length, 0, 'wreck replaces small shrine composition');
    assert.eq(finds(out).length, ZoneVariants.byId('pirate_cove').finds.count);
  });
  test('zone dressing: early wreck reservations block competitors and survive the later dressing pass', () => {
    const ctx = pirateShrine(), run = ZoneDressing.reserveWrecksSteps(ctx);
    let step; do { step = run.next(); } while (!step.done);
    ctx.wreckReservations = step.value;
    assert.eq(ctx.wreckReservations.size, 1);
    const reservation = [...step.value.values()][0];
    for (const i of reservation.reserved) {
      assert.falsy(WorldGen.isSpawnCell(ctx.grid, ctx.N, ctx.N, i % ctx.N, Math.floor(i / ctx.N), ctx.spawnOpts, 'minor'), 'later scenery cannot spend reserved sand');
    }
    const out = ZoneDressing.dress(ctx);
    assert.eq(ctx.chests[0]._ix, 32); assert.eq(ctx.chests[0]._iy, 32);
    assert.eq(out.objects.filter(o => o.zoneLayer === 'wreck').length, 1);
    assert.eq(out.diagnostics[0].shortfalls.length, 0);
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
  test('Pirate Cove companion owns a wreck without borrowing the park shrine', () => {
    const make = () => {
      const ctx = pirateShrine();
      ctx.field.anchors[0].parkShore = true;
      return ctx;
    };
    const ctx = make(), parkChest = { ...ctx.chests[0] }, out = ZoneDressing.dress(ctx);
    const shrine = out.objects.find(o => o._shrineArt === 'shipwreck');
    assert.truthy(shrine); assert.eq(shrine.kind, 'grove_shrine');
    assert.eq(JSON.stringify(ctx.chests[0]), JSON.stringify(parkChest), 'park daily gift stays separate');
    assert.eq(out.objects.filter(o => o.zoneLayer === 'wreck').length, 1);
    assert.eq(JSON.stringify(out.objects), JSON.stringify(ZoneDressing.dress(make()).objects));
    const blocked = make(); blocked.spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
    assert.falsy(ZoneDressing.dress(blocked).objects.some(o => o._shrineArt === 'shipwreck'));
  });
  test('Pirate Cove T2 chests stay in water beside eligible shore', () => {
    const make = () => {
      const ctx = pirateShrine();
      for (let y = 0; y < ctx.N; y++) for (let x = 45; x < ctx.N; x++) {
        const i = y * ctx.N + x;
        ctx.grid[i] = WorldGen.T.WATER; ctx.field.coverage[i] = 0;
        ctx.spawnOpts.spawnWhy[i] = WorldGen.SPAWN_WHY.TERRAIN;
      }
      return ctx;
    };
    const ctx = make(), out = ZoneDressing.dress(ctx);
    const chests = out.objects.filter(o => o.zoneLayer === 'shore_find');
    assert.eq(chests.length, 2);
    assert.truthy(chests.every(o => o._ix === 45 && chestTier(o) === 2));
    assert.eq(JSON.stringify(chests), JSON.stringify(ZoneDressing.dress(make()).objects.filter(o => o.zoneLayer === 'shore_find')));
    const blocked = make();
    for (let y = 0; y < ctx.N; y++) blocked.spawnOpts.spawnWhy[y * ctx.N + 44] |= WorldGen.SPAWN_WHY.RESTRICTED;
    assert.eq(ZoneDressing.dress(blocked).objects.filter(o => o.zoneLayer === 'shore_find').length, 0);
    const ownedWater = make();
    for (let y = 0; y < ctx.N; y++) ownedWater.field.coverage[y * ctx.N + 45] = 2;
    assert.eq(ZoneDressing.dress(ownedWater).objects.filter(o => o.zoneLayer === 'shore_find').length, 0, 'another nexus owns the water');
    const privateWater = make();
    for (let y = 0; y < ctx.N; y++) privateWater.spawnOpts.spawnWhy[y * ctx.N + 45] |= WorldGen.SPAWN_WHY.RESTRICTED;
    assert.eq(ZoneDressing.dress(privateWater).objects.filter(o => o.zoneLayer === 'shore_find').length, 0);
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
      assert.eq(out.objects.filter(o => o.zoneLayer === 'wreck').length, 0, 'no floating chest without a hull');
      assert.truthy(out.diagnostics[0].shortfalls.includes('shrine:shipwreck'));
    }
  });
  test('zone dressing: orchard mixes rare Worldpeach trees with apples and medium deciduous timber', () => {
    const out = ZoneDressing.dress(context('orchard'));
    const fruit = out.objects.filter(o => o.kind === 'fruittree');
    const timber = out.objects.filter(o => o.kind === 'tree');
    assert.gt(fruit.length, 200, 'denser than the former four-percent fruit grid');
    assert.gt(timber.length, 200);
    assert.gt(fruit.filter(o => o.species === 'worldpeach').length, 0, 'one orchard can contain Worldpeach trees');
    assert.truthy(fruit.every(o => o.species === WorldGen.fruitTreeSpecies(WorldGen.cellHash(0, 0, o._ix, o._iy))), 'each fruit tree rolls by its cell');
    assert.truthy(timber.every(o => o.species === 'maple' && o.size === 'medium' && treeSizeClass(o) === 'medium'));
    assert.eq(out.wildplants.length, 6, 'three gemfruit and three berry finds');
    assert.truthy(out.wildplants.every(o => ['gemfruit', 'berry'].includes(o.crop) && o.zoneLayer === 'find'));
  });
  test('zone dressing: Mushroom Grove giant mushrooms have distinct rewards and preserve placement identities', () => {
    const grove = ZoneDressing.dress(context('mushroom_grove'));
    const giants = grove.wildplants.filter(o => o.crop === 'giant_mushroom');
    assert.gt(giants.length, 0);
    for (const o of giants) {
      assert.eq(o._plantArt, undefined, 'distinct crop needs no shrub art override');
      assert.eq(o.kind, 'wildplant');
      assert.eq(o.id, WorldGen.cellId('wpf', 0, 0, o._ix, o._iy), 'existing shrub identity survives the art change');
      assert.eq(JSON.stringify(wildplantRewards(o.crop)),JSON.stringify([{id:'wood',qty:1},{id:'mushroom',qty:1}]));
      assert.eq(wildplantSprite(o).sheet, 'zone_objects');
      assert.eq(wildplantFrame(o), 40);
    }
    // Ordinary mushrooms retain their small red cap beside the giant caps.
    const forage = grove.wildplants.filter(o => o.crop === 'mushroom');
    assert.gt(forage.length, 0);
    assert.truthy(forage.every(o => o._zoneObjectFrame == null && wildplantSprite(o) === CROP_SPRITE.mushroom));
    assert.lt(CROP_SPRITE.mushroom.scale, wildplantSprite(giants[0]).scale, 'small caps stay visibly smaller');
    assert.eq(wildplantSprite({crop:'mushroom'}), CROP_SPRITE.mushroom, 'global mushrooms stay unchanged');
    assert.eq(typeof WILDPLANT_CONTEXT_ART, 'object', 'the context-art table is in scope');
    assert.eq(typeof WILDPLANT_CONTEXT_ART.cap_cluster, 'undefined', 'the surface cluster look is gone');
    assert.eq(wildplantSprite({crop:'mushroom',_plantArt:'cap_cluster'}), CROP_SPRITE.mushroom, 'saved cluster tags fall back to ordinary mushroom art');
    const ordinary = ZoneDressing.dress(context('meadow')).wildplants.filter(o => o.crop === 'shrub');
    assert.gt(ordinary.length, 0);
    assert.truthy(ordinary.every(o => o._plantArt === 'ordinary' && wildplantSprite(o) === CROP_SPRITE.shrub && walkHazardDamageRate(o) === 0), 'meadow shrubs are ordinary harmless bushes');
  });
  test('Meadow: ordinary bushes retain their look over residential and commercial terrain', () => {
    const bushes = ZoneDressing.dress(context('meadow')).wildplants.filter(o => o.crop === 'shrub');
    assert.gt(bushes.filter(o => o.zoneLayer === 'background').length, 0);
    assert.gt(bushes.filter(o => o.zoneLayer === 'poi').length, 0, 'shrine rim keeps its bushes');
    for (const bush of bushes) for (const biome of [WorldGen.T.PARK, WorldGen.T.RESIDENTIAL, WorldGen.T.COMMERCIAL]) {
      const stamped = { ...bush, _biome: biome };
      assert.eq(wildplantSprite(stamped), CROP_SPRITE.shrub, 'ordinary art wins over later terrain stamping');
      assert.eq(walkHazardDamageRate(stamped), 0, 'bushes never deal bramble damage');
    }
    assert.eq(wildplantSprite({ crop: 'shrub', _biome: WorldGen.T.RESIDENTIAL }).sheet, 'approved_clipped_hedge', 'ordinary residential fill retains its inferred hedge');
    assert.eq(wildplantSprite({ crop: 'shrub', _plantArt: 'bramble', _biome: WorldGen.T.RESIDENTIAL }).sheet, 'bramble', 'authored brambles retain their look');
  });
  test('zone hedges: joins follow surviving shrubs, never blocked cells or unrelated plants', () => {
    const c = context('hedge_garden');
    const before = ZoneDressing.dress(context('hedge_garden')).wildplants.filter(o => o.crop === 'shrub');
    assert.gt(before.length, 10);
    const removed = before.filter((_, n) => n % 5 === 0);
    for (const p of removed) c.spawnOpts.occupied.add(p._iy * c.N + p._ix);
    const hedges = ZoneDressing.dress(c).wildplants.filter(o => o.crop === 'shrub');
    const cells = new Set(hedges.map(p => p._iy * c.N + p._ix));
    for (const p of removed) assert.falsy(cells.has(p._iy * c.N + p._ix));
    for (const p of hedges) {
      const frame = QuarryLayout.wallFrameAt(cells, p._iy * c.N + p._ix, c.N);
      assert.eq(wildplantSprite(p).sheet, frame == null ? 'zone_hedge_single' : 'zone_hedge');
      assert.eq(wildplantFrame(p), frame ?? 0);
      assert.eq(wildplantSprite(p).seat, false, 'joins keep the full frame centered');
      assert.eq(WILDPLANT_RULES[p.crop].output, 'wood', 'hedges retain shrub harvest');
    }
  });
  test('zone hedges: all cardinal junctions use the atlas orientation and edges never wrap', () => {
    const N = 9, center = 4 * N + 4;
    const cases = [
      [[-1, 1], 0], [[-N, N], 1], [[1, N], 2], [[-1, N], 3],
      [[-N, 1], 4], [[-N, -1], 5], [[-N, 1, -1], 6],
      [[-N, 1, N], 7], [[1, N, -1], 8], [[-N, N, -1], 9],
      [[-N, 1, N, -1], 10], [[N], 11], [[-1], 12], [[-N], 13], [[1], 14], [[], null],
    ];
    const plant = i => ({ crop: 'shrub', zoneVariant: 'formal_garden', _ix: i % N, _iy: Math.floor(i / N) });
    for (const [offsets, frame] of cases) {
      const plants = [plant(center), ...offsets.map(d => plant(center + d))];
      // A different crop and an unrelated zone must not create an extra arm.
      plants.push({ ...plant(center + N), crop: 'berry' }, { ...plant(center - 1), zoneVariant: 'ancient_grove' });
      ZoneDressing.stampHedges(plants, N);
      assert.eq(plants[0]._hedgeFrame ?? null, frame);
      assert.eq(plants[0]._plantArt, frame == null ? 'zone_hedge_single' : 'zone_hedge');
      assert.eq(plants[plants.length - 1]._plantArt, undefined);
    }
    const edge = [plant(N - 1), plant(N), plant(N - 2)];
    ZoneDressing.stampHedges(edge, N);
    assert.eq(edge[0]._hedgeFrame, 12, 'the west connection ends at an east cap without wrapping rows');
    assert.eq(edge[1]._plantArt, 'zone_hedge_single', 'the next row remains an isolated shrub');
  });
  test('zone art: contextual stones and formal hedges keep their harvest identity', () => {
    const masonry = ZoneDressing.dress(context('broken_masonry')).wildplants.filter(o => o.crop === 'rubble');
    assert.gt(masonry.length, 0);
    const zones = ['stone_garden', 'broken_masonry', 'flint_field', 'broken_depot', 'seep', 'work_yard', 'black_ring', 'pirate_cove'];
    for (const [index, zone] of zones.entries()) {
      const rocks = ZoneDressing.dress(context(zone)).wildplants.filter(o => o.crop === 'rubble');
      assert.gt(rocks.length, 0, `${zone}: actual rubble placements`);
      for (const rock of rocks) {
        assert.eq(rock._plantArt, `zone_rock_${zone}`);
        assert.eq(wildplantSprite(rock).sheet, 'zone_objects');
        assert.eq(wildplantFrame(rock), 64 + index);
        assert.eq(rock.id, WorldGen.cellId(rock.zoneLayer === 'background' ? 'wpf' : 'wz', 0, 0, rock._ix, rock._iy), 'art preserves the saved harvest identity');
      }
    }
    assert.eq(wildplantSprite({crop:'rubble',stage:MAX_GROWTH_STAGE}), CROP_SPRITE.rubble, 'planted rocks keep their ordinary crop art');
    assert.eq(wildplantSprite({crop:'shrub',_plantArt:'zone_rock_stone_garden'}).sheet, 'bushes', 'rock context cannot replace another crop');
    assert.eq(wildplantSprite({crop:'rubble',_plantArt:'masonry'})?.sheet, undefined, 'legacy masonry tags use ordinary loose stones');
    assert.eq(wildplantSprite({crop:'rubble'})?.sheet, undefined, 'ordinary stone keeps the crop sheet despite its placement-specific looks');
    assert.eq(inventoryIconSource('rubble').sheet, 'crops', 'harvest remains the same inventory item');
    for (const o of masonry) assert.eq(o.id, WorldGen.cellId(o.zoneLayer === 'background' ? 'wpf' : 'wz', 0, 0, o._ix, o._iy));
    const hedges = ZoneDressing.dress(context('formal_garden')).wildplants.filter(o => o.crop === 'shrub');
    assert.gt(hedges.length, 0);
    assert.truthy(hedges.every(o => ['zone_hedge', 'zone_hedge_single'].includes(wildplantSprite(o).sheet)));
    assert.eq(wildplantSprite({crop:'shrub',_biome:5}).sheet, 'approved_clipped_hedge');
    assert.eq(wildplantSprite({crop:'shrub',_biome:16}).sheet, 'approved_clipped_hedge');
    assert.eq(wildplantSprite({crop:'shrub',_biome:6}).sheet, 'bushes');
    const stones = ZoneDressing.dress(context('stone_garden')).objects.filter(o => o.kind === 'mineralrock');
    assert.gt(stones.length, 0);
    assert.truthy(stones.every(o => !o._objectArt), 'stone gardens keep standard stone art');
    assert.truthy(stones.filter(o => o.yieldTier > 1).every(o => !o._objectArt), 'iron ore keeps its tier art');
    const looks = Render.objectAppearance({textures:{exists:()=>true},save:{}},new Map(),false).RENDER_SPEC;
    assert.eq(looks.mineralrock.key({}), 'mineralrock');
    assert.eq(looks.stakes.key, 'approved_charred_stakes', 'every spike placement uses the replacement art');
    assert.eq(looks.stakes.scale, 4 / 3, 'replacement art keeps its authored scale');
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
    assert.eq(fallback.objects.filter(o => o.kind === 'mineralrock').length, 0, 'Ordered Graves never substitutes rocks');
    assert.gt(fallback.wildplants.filter(o => o.crop === 'longgrass').length, 0, 'safe grass replaces refused graves');
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
  test('zone dressing: work-yard copper lines have spikes at grid corners and POI slots touch the chest', () => {
    const ctx = context('work_yard'), out = ZoneDressing.dress(ctx), origin = 32;
    const background = new Map(all(out).filter(o => o.zoneLayer === 'background').map(o => [`${o._ix},${o._iy}`, o]));
    // First boundary of the fixed 21 x 21 figure sits 10 cells from its origin.
    for (let x = origin - 10; x <= origin + 10; x++) {
      const o = background.get(`${x},${origin - 10}`);
      assert.truthy(o, `unbroken boundary ${x}`);
      if ((x - origin + 10) % 4 === 0) assert.eq(o.kind, 'stakes');
      else assert.eq(o.yieldTier, 2);
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
    assert.eq(poi.filter(o => o.crop === 'rubble').length, 16);
    for (const o of out.wildplants) {
      const d2 = (o._ix - 32) ** 2 + (o._iy - 32) ** 2;
      if (o.crop === 'flint') assert.lte(d2, 4, 'flint stays in the circle');
      if (o.zoneLayer === 'background') assert.eq(o.crop, 'rubble');
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
  test('zone dressing: repeating grove monsters use enemy gates and stable seats', () => {
    for (const id of ['ancient_grove', 'hedge_garden']) {
      const ctx = context(id), out = ZoneDressing.dress(ctx);
      const plants = out.guards.filter(g => g.zoneLayer === 'background');
      assert.gt(plants.length, 1, id);
      for (const p of plants) {
        assert.eq(p.kind, id === 'ancient_grove' ? 'treant' : 'plant');
        assert.eq(p.stationary, id === 'hedge_garden');
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
    assert.eq(kinds('pirate_cove'), 'pirate_grunt,pirate_gunner,crab,crab,crab');
    assert.eq(kinds('orchard'), 'farmer_goblin');
    assert.eq(kinds('ancient_grove'), 'treant,spider');
    assert.eq(kinds('ordered_graves'), 'skeleton_soldier');
    assert.eq(kinds('overgrown_graves'), 'spider');
    assert.eq(kinds('broken_masonry'), 'club_goblin');
    assert.eq(kinds('broken_depot'), 'bat,bat,bat,bat,bat');
    assert.eq(kinds('seep'), 'split_slime');
    assert.eq(kinds('work_yard'), 'split_slime,split_slime');
    assert.eq(kinds('mystic_reef'), ['giant_crab', ...Array(8).fill('crab')].join());
    assert.eq(kinds('shellwater_strand'), Array(8).fill('crab').join());
    assert.truthy(['slime', 'spider'].includes(kinds('mushroom_grove')));
    const plant = ZoneDressing.dress(context('hedge_garden')).guards[0];
    assert.truthy(plant.stationary);
    const ghost = ZoneDressing.dress(context('silent_circle')).guards;
    assert.eq(ghost.length, 1); assert.eq(ghost[0].kind, 'ghost'); assert.eq(ghost[0].proximityCells, 4);
    for (const id of ['meadow', 'formal_garden', 'stone_garden', 'black_ring']) assert.eq(kinds(id), '');
    for (const id of ['ordered_graves', 'overgrown_graves']) {
      assert.gt(ZoneDressing.dress(context(id)).objects.filter(o => o.kind === 'headstone').length, 0);
    }
  });
  test('zone dressing: the seep and the quarries stand barrels — generated, smashable, on the bin lane (Oct 2026)', () => {
    const m = ZoneVariants.materials.barrel;
    assert.truthy(m && m.kind === 'chest' && m.barrel === true && m.spawnClass === 'minor', 'a barrel material');
    for (const id of ['seep', 'quarry-abandoned']) {
      const barrels = ZoneDressing.dress(context(id)).objects.filter(o => o.barrel === true);
      assert.gt(barrels.length, 0, `${id} stands barrels`);
      for (const b of barrels) {
        assert.eq(b.kind, 'chest');
        assert.truthy(isBarrel(b), `${id}: a dressed barrel is a barrel`);
        assert.falsy(b.fixedLoot, 'never a fixed find');
      }
    }
    assert.eq(ZoneDressing.dress(context('meadow')).objects.filter(o => o.barrel).length, 0, 'a meadow stands none');
  });
  test('zone dressing: a churchyard or tar yard keeps its chest and stands its shrine kind beside it', () => {
    for (const id of ['ordered_graves', 'black_ring', 'stone_garden']) {
      const ctx = context(id), a = ctx.field.anchors[0], cell = WorldGen.CELL_M;
      ctx.chests.push({ kind: 'chest', id: 'poi_' + id, _poiAt: `${a.lx},${a.ly}`, x: 32.5 * cell, y: 32.5 * cell });
      ctx.spawnOpts.occupied.add(32 * ctx.N + 32);
      const out = ZoneDressing.dress(ctx), shrines = out.objects.filter(o => o.kind === 'grove_shrine');
      assert.eq(ctx.chests[0].kind, 'chest', `${id}: the chest stays`);
      const kind = Shrines.kindForZoneVariant(id);
      if (!kind) { assert.eq(shrines.length, 0, `${id}: no kind, no shrine`); continue; }
      assert.eq(shrines.length, 1, id);
      assert.eq(shrines[0].shrineKind, kind);
      assert.lte(Math.max(Math.abs(shrines[0]._ix - 32), Math.abs(shrines[0]._iy - 32)), Zones.SHRINE_SEAT_R, 'beside the chest');
      assert.eq(new Set(all(out).map(o => `${o.x},${o.y}`)).size, all(out).length, `${id}: its cell is its own`);
      assert.eq(JSON.stringify(shrines), JSON.stringify((() => { const c = context(id); c.chests.push({ ...ctx.chests[0] }); c.spawnOpts.occupied.add(32 * c.N + 32); return ZoneDressing.dress(c); })().objects.filter(o => o.kind === 'grove_shrine')), 'stable');
    }
    const grove = context('orchard'), g = grove.field.anchors[0], cell = WorldGen.CELL_M;
    grove.chests.push({ kind: 'chest', id: 'park', _poiAt: `${g.lx},${g.ly}`, x: 32.5 * cell, y: 32.5 * cell });
    ZoneDressing.dress(grove);
    assert.eq(grove.chests[0].kind, 'grove_shrine');
    assert.eq(grove.chests[0].shrineKind, 'harvest_idol', 'the park POI itself becomes the kind');
  });
})();

 test('bramble groves keep shrub harvests and leave ordinary bushes alone', () => {
   for (const id of ['meadow', 'ancient_grove']) {
     const row = ZoneVariantData.variants.find(v => v.id === id);
     assert.eq(row.materialLooks?.shrub, id === 'ancient_grove' ? 'bramble' : 'ordinary');
     assert.eq(wildplantSprite({crop:'shrub', _plantArt:row.materialLooks?.shrub}).sheet, id === 'ancient_grove' ? 'bramble' : 'bushes');
   }
   assert.eq(wildplantSprite({crop:'shrub'}).sheet, 'bushes');
   assert.eq(wildplantSprite({crop:'shrub', _plantArt:'clipped'}).sheet, 'approved_clipped_hedge');
   assert.eq(JSON.stringify(wildplantRewards('shrub')), JSON.stringify([{id:'wood',qty:1}]));
 });
