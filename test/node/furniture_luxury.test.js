// The cache is derived from saved records and validated ownership, not sprites.
(() => {
  function fixture() {
    const scene = {depth:0,cellM:5,cellsPerTile:32,tileEdgeM:160,
      mPerPx:160/WorldGen.TILE_PX,originPx:{x:0,y:0},startWorldM:{x:0,y:0},
      save:{starterShopId:'home',starterTrailer:{id:'home',x:2.5,y:2.5}},
      _bankDiscovery(key) { (this.save.discovered ||= {})[key] = 1; }};
    SaveState.defaults(scene.save);
    const entry = {grid:new Uint8Array(1024),owners:new Uint8Array(1024),ownerKeys:['home'],objects:[]};
    for (const i of [0,1,32,33]) entry.grid[i] = WorldGen.T.BUILDING;
    const record = (id,itemId,x,y,depth=0) => ({id,itemId,x,y,depth});
    scene.save.furniture = [record('cot','bed_quilted',2.5,2.5),record('rug','rug_burgundy',7.5,2.5),
      record('lamp','lamp_floor',2.5,7.5),record('outside','lamp_floor',22.5,2.5),
      record('cave','lamp_floor',7.5,7.5,1)];
    return {scene,entry};
  }
  function world(fn) {
    const old = WorldGen.tileCache;
    WorldGen.tileCache = new Map();
    const f = fixture(); WorldGen.tileCache.set(WorldGen.tileKey(0,0),f.entry);
    try { fn(f); } finally { WorldGen.tileCache = old; }
  }
  test('luxury: defaults, tier squared, overrides, outdoor exclusion and one record per footprint', () => world(({scene}) => {
    assert.eq(Object.keys(scene.save.houseLuxury).length,0);
    assert.eq(Furniture.recompute(scene),14);
    assert.eq(Furniture.luxuryOf(scene.save,'home'),14);
    assert.eq(Furniture.luxuryOf(scene.save,'other'),0);
    scene.save.furniture[2]._footprintCells = {width:2,height:2};
    scene.save.furniture.push({...scene.save.furniture[2]});
    assert.eq(Furniture.recompute(scene),14,'multi-cell hooks and duplicate live claims do not double count');
    const spec = furnitureSpec('lamp_floor'), previous = spec.luxury;
    try { spec.luxury = 25; assert.eq(Furniture.recompute(scene),30); }
    finally { spec.luxury = previous; }
  }));
  test('luxury: load repairs scores from saved placements even with no rendered furniture', () => world(({scene,entry}) => {
    scene.save.houseLuxury.home = {score:999,footprintKey:'old'};
    assert.eq(entry.objects.length,0);
    PlacedFloor.restoreFurniture(scene,entry,0,0);
    assert.eq(Furniture.luxuryOf(scene.save),14);
    scene.save = JSON.parse(JSON.stringify(scene.save));
    scene.save.furniture = scene.save.furniture.filter(r=>r.id!=='rug');
    PlacedFloor.restoreFurniture(scene,entry,0,0);
    assert.eq(Furniture.luxuryOf(scene.save),10,'load derives from changed records');
  }));
  test('luxury: tile eviction preserves validated score; reuse of synthetic id cannot carry it to new Home', () => world(({scene,entry}) => {
    Furniture.recompute(scene); const oldKey = scene.save.houseLuxury.home.footprintKey;
    WorldGen.tileCache.clear();
    assert.eq(Furniture.recompute(scene),14,'missing ownership is unknown, not outdoors');
    assert.falsy(PlacedFloor.furnitureIndoors(scene,scene.save.furniture[0]),'an unloaded tile still cannot authorize abilities');
    assert.eq(Furniture.recompute(scene),14,'failed ability cannot destroy the cache association');
    scene.save.starterTrailer.x += 160;
    assert.eq(Furniture.recompute(scene),0,'Home moved under the same id');
    assert.falsy(scene.save.houseLuxury.home.footprintKey === oldKey);
    scene.save.starterShopId='adopted'; scene.save.starterTrailer=null;
    entry.ownerKeys[0]='adopted'; WorldGen.tileCache.set(WorldGen.tileKey(0,0),entry);
    assert.eq(Furniture.recompute(scene),14,'adoption uses current ownership');
    assert.eq(Furniture.luxuryOf(scene.save,'home'),0);
    entry.grid[0]=WorldGen.T.GRASS;
    assert.eq(Furniture.recompute(scene),13,'loaded footprint changes invalidate former indoor cells');
  }));
  test('luxury: underground load reads surface ownership, never cave cells', () => world(({scene,entry}) => {
    const surface = WorldGen.tileCacheFor(0), key = WorldGen.tileKey(0,0), old = surface.get(key);
    surface.set(key,entry);
    scene.depth=2;
    WorldGen.tileCache=new Map([[key,{...entry,grid:new Uint8Array(1024).fill(WorldGen.T.CAVE_FLOOR)}]]);
    try {
      assert.eq(Furniture.recompute(scene),14,'surface property survives an underground session');
      surface.delete(key);
      assert.eq(Furniture.recompute(scene),14,'a persisted validated association survives cold cave loading');
    } finally { if (old) surface.set(key,old); else surface.delete(key); }
  }));
  test('luxury: successful pickup immediately drops the score and leaves milestone ledger intact', () => world(({scene,entry}) => {
    Furniture.recompute(scene);
    Object.assign(scene,{addToInv:()=>1,_finishInventoryChange(){},drawObjects(){},flashAtPlayer() {},
      _placedFurniture:SceneFurniture.prototype._placedFurniture});
    const before = Object.keys(scene.save.discovered).join(',');
    assert.truthy(SceneFurniture.prototype.pickupFurniture.call(scene,scene.save.furniture[2]));
    assert.eq(Furniture.luxuryOf(scene.save),5);
    assert.eq(Object.keys(scene.save.discovered).join(','),before);
  }));
})();
