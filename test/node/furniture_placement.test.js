// Saved furniture owns one cell, while its containing Home owns the building.
(() => {
  const handler = name => TAP_HANDLERS.find(h => h.name === name);
  const buildings = new Set([WorldGen.T.BUILDING, WorldGen.T.BUILDING_MED, WorldGen.T.BUILDING_LARGE]);
  function fixture(depth = 0) {
    const scene = Object.assign(makeScene(), {
      save: { energy: 100 }, depth, cellM: 5, cellsPerTile: 32, tileEdgeM: 160,
      mPerPx: 5 / (WorldGen.TILE_PX / 32), originPx: { x: 0, y: 0 },
      startWorldM: { x: 0, y: 0 }, playerM: { x: 2.5, y: 2.5 },
      tilledSet: new Set(), placedRockSet: new Set(), buildInventoryDOM() {},
      homeInside: liftSceneMethod('homeInside', { BUILDING_TYPES: buildings }),
    });
    SaveState.defaults(scene.save);
    scene.save.planted = [];
    scene.save.inv = [{ id: 'bed_quilted', count: 2 }]; scene.save.selSlot = 0;
    const entry = { grid: new Uint8Array(1024).fill(depth ? WorldGen.T.CAVE_FLOOR : WorldGen.T.GRASS),
      cellsPerEdge: 32, objects: [], wildplants: [], traps: [] };
    const ctx = { scene, save: scene.save, sx: 0, sy: 0, cwmx: 2.5, cwmy: 2.5,
      wm: { x: 2.5, y: 2.5 }, cell: { tx: 0, ty: 0, ix: 0, iy: 0, type: entry.grid[0] }, cellKey: '0_0' };
    return { scene, entry, ctx };
  }
  function world(f, fn) {
    const old = [...WorldGen.tileCache], oldTypes = globalThis.BUILDING_TYPES;
    WorldGen.tileCache.clear(); WorldGen.tileCache.set(WorldGen.tileKey(0, 0), f.entry);
    globalThis.BUILDING_TYPES = buildings;
    try { fn(); } finally {
      WorldGen.tileCache.clear(); for (const [k,v] of old) WorldGen.tileCache.set(k,v);
      if (oldTypes === undefined) delete globalThis.BUILDING_TYPES; else globalThis.BUILDING_TYPES = oldTypes;
    }
  }
  function home(f) {
    f.scene.save.starterShopId = 'home';
    f.entry.grid[0] = f.ctx.cell.type = WorldGen.T.BUILDING;
    f.entry.owners = new Uint8Array(1024); f.entry.ownerKeys = ['home'];
    f.entry.objects.push({ id: 'home', kind: 'house', x: 2.5, y: 2.5 });
  }
  test('furniture: placement consumes one, saves orientation and restores only its floor', () => {
    for (const depth of [0, 2]) {
      const f = fixture(depth); f.scene._furnitureFlip = true;
      world(f, () => {
        assert.truthy(handler('place-furniture').try(f.ctx));
        assert.eq(f.scene.save.inv[0].count, 1); assert.truthy(f.ctx.dirty);
        const record = f.scene.save.furniture[0];
        assert.eq(record.depth, depth); assert.eq(record.itemId, 'bed_quilted');
        assert.eq(record.flip, true); assert.eq(record.houseKey, null);
        assert.eq(f.entry.objects[0].id, record.id);
        f.scene.save = JSON.parse(JSON.stringify(f.scene.save));
        const reload = { cellsPerEdge: 32, objects: [], wildplants: [] };
        PlacedFloor.restoreFurniture(f.scene, reload, 0, 0, depth + 1);
        assert.eq(reload.objects.length, 0);
        PlacedFloor.restoreFurniture(f.scene, reload, 0, 0, depth);
        PlacedFloor.restoreFurniture(f.scene, reload, 0, 0, depth);
        assert.eq(reload.objects.length, 1); assert.eq(reload.objects[0].flip, true);
        assert.eq(reload.objects[0].spawnCells[0], 0);
      });
    }
  });
  test('furniture: Home anchor and doorway are permitted without deleting the host', () => {
    const f = fixture(); home(f);
    // Home terrain keeps its normal terrain exclusion; the target ownership is the exception.
    f.entry.spawnWhy = new Uint16Array(1024); f.entry.spawnWhy[0] = WorldGen.SPAWN_WHY.TERRAIN;
    world(f, () => {
      assert.truthy(f.scene.homeInside(2.5, 2.5));
      handler('place-furniture').try(f.ctx);
      assert.eq(f.scene.save.furniture.length, 1);
      assert.eq(f.scene.save.furniture[0].houseKey, 'home');
      assert.eq(f.entry.objects.filter(o => o.id === 'home').length, 1);
    });
  });
  test('furniture: blocked terrain, safety masks and every occupied lane preserve the stack', () => {
    const blockers = [
      f => { f.entry.grid[0] = WorldGen.T.WATER; },
      f => { f.entry.grid[0] = WorldGen.T.ROAD; },
      f => { f.entry.grid[0] = WorldGen.T.BUILDING; },
      f => { f.entry.roadMask = new Uint8Array(1024); f.entry.roadMask[0] = 1; },
      f => { f.entry.spawnWhy = new Uint16Array(1024); f.entry.spawnWhy[0] = WorldGen.SPAWN_WHY.RESTRICTED; },
      f => { home(f); f.entry.ownerKeys = ['neighbour']; },
      f => { home(f); f.ctx.cell.underRoad = true; },
      f => { f.entry.objects.push({kind:'tree', id:'tree', x:2.5,y:2.5}); },
      f => { home(f); f.entry.objects.push({kind:'tree', id:'tree', x:2.5,y:2.5}); },
      f => { f.entry.wildplants.push(WorldGen.makeWildplant('barricade',2.5,2.5,'wild')); },
      f => { f.entry.objects.push({kind:'shipwreck',id:'wide',x:7.5,y:2.5,_footprintCells:{width:3,height:1}}); },
      ...['planted','fires','scarecrows','magicTraps','furniture'].map(k => f => f.scene.save[k].push({x:2.5,y:2.5})),
      f => { f.scene.save.homeFirepit = {x:2.5,y:2.5}; },
      f => { f.scene.tilledSet.add('0_0'); },
      f => { f.scene.placedRockSet.add('0_0'); },
      f => { f.entry.traps.push({_ix:0,_iy:0}); },
      f => { f.entry.treasure = {id:'treasure',x:2.5,y:2.5}; },
    ];
    blockers.forEach((block,i) => {
      const f = fixture(); block(f); const before = f.scene.save.furniture.length;
      world(f, () => handler('place-furniture').try(f.ctx));
      assert.eq(f.scene.save.inv[0].count, 2, `blocker ${i}`);
      assert.eq(f.scene.save.furniture.length, before, `blocker ${i}`);
      assert.falsy(f.ctx.dirty, `blocker ${i}`);
    });
  });
  test('furniture: other placements refuse even a saved piece not yet restored', () => {
    for (const [name,id] of [['light-fire','flint_shard'], ['place-magic-trap','magic_trap'],
      ['place-barricade','barricade'], ['place-scarecrow','scarecrow'], ['place-rock','rubble'], ['plant','seed_carrot']]) {
      const f = fixture(); f.scene.save.inv[0].id = id;
      f.scene.save.furniture.push({id:'saved',itemId:'bed_quilted',x:2.5,y:2.5,depth:0});
      if (name === 'plant') f.scene.tilledSet.add('0_0');
      world(f, () => handler(name).try(f.ctx));
      assert.eq(f.scene.save.inv[0].count, 2, name); assert.falsy(f.ctx.dirty, name);
    }
  });
  test('furniture: live gate blocks trap/reward seats and releases only the overlay claim', () => {
    const f = fixture(); f.entry._spawnOpts = {occupied:new Set([1])};
    world(f, () => {
      handler('place-furniture').try(f.ctx);
      assert.falsy(Traps.canLay(f.entry,0,0));
      assert.falsy(WorldGen.isSpawnCell(f.entry.grid,32,32,0,0,WorldGen.spawnOptsOf(f.entry),'reward'));
      assert.falsy(f.entry._spawnOpts.occupied.has(0), 'generated occupancy unchanged');
      f.entry.objects = [];
      assert.truthy(Traps.canLay(f.entry,0,0));
      assert.truthy(WorldGen.spawnOptsOf(f.entry).occupied.has(1));
    });
  });
  test('furniture: only open Home interior defers building taps for a held piece', () => {
    const f = fixture(); home(f); f.ctx.building = f.entry.objects[0];
    let shops = 0; f.scene.shopInteract = () => shops++;
    world(f, () => {
      assert.eq(handler('building-art').try(f.ctx), false);
      assert.eq(handler('building-zone').try(f.ctx), false);
      f.scene.playerM = {x:7.5,y:2.5};
      assert.eq(handler('building-art').try(f.ctx), true); assert.eq(shops,1);
      f.scene.playerM = {x:2.5,y:2.5}; f.ctx.wm = {x:7.5,y:2.5};
      assert.eq(handler('building-art').try(f.ctx), true); assert.eq(shops,2);
    });
  });
  test('furniture: tapping a placed item beats its host anchor with empty hands', () => {
    const f = fixture(); home(f); let opened = null;
    f.scene.presentFurniture = o => { opened = o; return true; };
    world(f, () => {
      handler('place-furniture').try(f.ctx); f.scene.save.selSlot = -1;
      f.ctx.building = f.entry.objects.find(o => o.id === 'home');
      assert.eq(handler('building-art').try(f.ctx), false);
      assert.eq(handler('object').try(f.ctx), true);
      assert.eq(opened?.itemId, 'bed_quilted');
    });
  });
})();
