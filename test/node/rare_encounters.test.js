(() => {
  function fixture(fn) {
    const cache = WorldGen.tileCacheFor(0), saved = new Map(cache);
    cache.clear();
    const N = 64, entry = { cellsPerEdge: N, tileEdgeM: 640, grid: new Uint8Array(N*N).fill(WorldGen.T.GRASS), creatures: [], objects: [], wildplants: [] };
    entry.zone = { coverage: new Uint16Array(N*N).fill(1), anchors: [{ kind: 'grove', variant: 'meadow', key: 'rare_test' }] };
    cache.set(WorldGen.tileKey(0, 0), entry);
    const scene = { depth: 0, tileEdgeM: 640, cellM: 10, startWorldM: { x: -5000, y: 0 }, playerM: { x: 5325, y: 325 }, save: { caught: [] } };
    try { fn(scene, entry, cache); } finally { cache.clear(); for (const [k,v] of saved) cache.set(k,v); }
  }
  test('rare encounters: all requested kinds have exclusive habitat rows and exact cave floors', () => {
    assert.eq(RareEncounters.ROWS.length, 38);
    for (const row of RareEncounters.ROWS) {
      assert.truthy(EnemyRoster.get(row.kind)?.rareEncounter, row.kind);
      assert.truthy(row.chance > 0 && row.chance < 1);
      // Doubled from .15/.35/.6 (owner, Nov 2026); the old .6 rows stop short of certain at .9.
      assert.includes([.3, .7, .9], row.chance, `${row.kind} rolls a doubled rate`);
      for (let depth = 1; depth <= 8; depth++) assert.eq(RareEncounters.matches(row, {depth}), !!row.floors?.includes(depth), row.kind);
      assert.falsy(RareEncounters.matches(row, { depth: 0, owner: {key: 'Terrain:BUILDING', type: 'terrain'} }));
    }
  });
  test('rare encounters: actual player visits persist rolls and identities across tile rebuild and reload', () => fixture((scene, entry, cache) => {
    // Search stable owner identities, not a mocked chance, to exercise both outcomes.
    let hit = false, miss = false;
    for (let n = 0; n < 100 && !(hit && miss); n++) {
      entry.zone.anchors[0].key = 'rare_test_' + n;
      scene.save = { caught: [] }; delete scene._rareTickAt; entry.creatures = [];
      RareEncounters.tick(scene, 1000);
      const area = scene.save.rareEncounters.areas[scene.save.rareEncounters.active];
      if (!Object.values(area.rolls)[0]) { miss = true; continue; }
      assert.eq(entry.creatures.length, 1);
      const c = entry.creatures[0]; hit = true;
      assert.eq(c.kind, 'wolfling'); assert.truthy(RareEncounters.isEncounter(c));
      assert.truthy(EnemySpawns.surfaceActive(scene, c));
      assert.falsy(EnemySpawns.isSharedId({...c, _sharedId: true}, scene.save));
      const activeKey = scene.save.rareEncounters.active;
      scene.save.rareEncounters.active = 'elsewhere';
      assert.falsy(EnemySpawns.surfaceActive(scene, c));
      assert.truthy(c._surfaceInactive);
      scene.save.rareEncounters.active = activeKey;
      assert.truthy(EnemySpawns.surfaceActive(scene, c));
      assert.falsy(c._surfaceInactive);
      const id = c.id; const serialized = JSON.stringify(scene.save);
      entry.creatures = []; scene.save = JSON.parse(serialized); delete scene._rareTickAt;
      RareEncounters.tick(scene, 2000);
      assert.eq(entry.creatures[0].id, id);
      cache.delete(WorldGen.tileKey(0,0)); RareEncounters.tick(scene, 3000);
      cache.set(WorldGen.tileKey(0,0), entry); RareEncounters.tick(scene, 4000);
      assert.eq(scene.save.rareEncounters.areas[scene.save.rareEncounters.active].visit, 1);
      scene.save.caught.push(id); entry.creatures = []; RareEncounters.tick(scene, 5000);
      assert.eq(entry.creatures.length, 0);
    }
    assert.truthy(hit); assert.truthy(miss);
  }));
  test('rare encounters: meaningful departure creates next visit but quick edge crossing does not', () => fixture((scene, entry) => {
    RareEncounters.tick(scene, 1000); const key = scene.save.rareEncounters.active;
    entry.zone.anchors[0].key = 'another_meadow'; scene.playerM.x += 100;
    RareEncounters.tick(scene, 2000);
    entry.zone.anchors[0].key = 'rare_test'; scene.playerM.x -= 100;
    RareEncounters.tick(scene, 3000); assert.eq(scene.save.rareEncounters.areas[key].visit, 1);
    entry.zone.anchors[0].key = 'another_meadow';
    RareEncounters.tick(scene, 4000); scene.playerM.x += 100;
    for (let t=5000;t<=35000;t+=1000) RareEncounters.tick(scene,t);
    entry.zone.anchors[0].key = 'rare_test'; scene.playerM.x -= 100;
    RareEncounters.tick(scene, 36000); assert.eq(scene.save.rareEncounters.areas[key].visit, 2);
  }));
  test('rare encounters: placement respects terrain and Home safety without rerolling blocked seats', () => fixture((scene, entry) => {
    entry.grid.fill(WorldGen.T.BUILDING);
    for (let n=0;n<30;n++) {
      entry.zone.anchors[0].key='blocked_'+n; RareEncounters.tick(scene, n*1000);
      assert.eq(entry.creatures.length, 0);
    }
    entry.grid.fill(WorldGen.T.GRASS); scene.startWorldM.x = 0; scene.playerM.x=325;
    for (let n=30;n<60;n++) {
      entry.zone.anchors[0].key='home_'+n; RareEncounters.tick(scene, n*1000);
      assert.eq(entry.creatures.length, 0);
    }
  }));
  // The near ring alone often held no eligible cell on real maps, silently
  // ending the visit; the seat search falls back to the rest of the area.
  test('rare encounters: a blocked near ring falls back to a farther seat in the same area', () => fixture((scene, entry) => {
    const N = entry.cellsPerEdge, px = 32, py = 32;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
      if (Math.max(Math.abs(x - px), Math.abs(y - py)) <= 8) entry.grid[y * N + x] = WorldGen.T.BUILDING;
    let seated = 0;
    for (let n = 0; n < 40; n++) {
      entry.zone.anchors[0].key = 'far_' + n; scene.save = { caught: [] }; delete scene._rareTickAt; entry.creatures = [];
      RareEncounters.tick(scene, 1000);
      const area = scene.save.rareEncounters.areas[scene.save.rareEncounters.active];
      if (!Object.values(area.rolls)[0]) continue;
      assert.eq(entry.creatures.length, 1, 'a rolled visit still seats its monster');
      const c = entry.creatures[0], ring = Math.max(Math.abs(Math.floor(c.x / 10) - px), Math.abs(Math.floor(c.y / 10) - py));
      assert.truthy(ring > 8 && ring <= 16, `seat ring ${ring} lies beyond the blocked near ring`);
      seated++;
    }
    assert.truthy(seated > 0);
  }));
  test('rare encounters: water encounters occupy shore water and never use dry fallback seats', () => fixture((scene, entry) => {
    entry.zone.anchors[0].variant = 'mystic_reef';
    entry.gameplayTiers = new Uint8Array(4096).fill(1);
    for (let y=0;y<64;y++) for (let x=31;x<=33;x++) entry.grid[y*64+x]=WorldGen.T.WATER;
    let found = false;
    for (let n=0;n<80 && !found;n++) {
      entry.zone.anchors[0].key='reef_'+n; entry.creatures=[];
      RareEncounters.tick(scene,n*1000);
      for (const c of entry.creatures) {
        assert.eq(c.kind,'tidal_force'); found=true;
        assert.eq(entry.grid[Math.floor(c.y/10)*64+Math.floor(c.x/10)], WorldGen.T.WATER);
      }
    }
    assert.truthy(found);
    entry.grid.fill(WorldGen.T.GRASS); entry.creatures=[];
    for (let n=80;n<110;n++) {
      entry.zone.anchors[0].key='dryreef_'+n; RareEncounters.tick(scene,n*1000);
      assert.eq(entry.creatures.length,0);
    }
  }));
  test('rare encounters: saved expiry hides cave encounters while captured pets stay available', () => fixture((scene, entry) => {
    const key='2:habitat_2_0_0', visit=1;
    const c={kind:'darkling',id:`rare:${EnemySpawns.hash(key).toString(36)}:1:darkling`,_rareEncounter:{key,visit}};
    scene.depth=2; scene.save.rareEncounters={active:key,areas:{[key]:{visit,seats:{[c.id]:{id:c.id,behaviour:{}}}}}};
    assert.truthy(EnemySpawns.surfaceActive(scene,c));
    RareEncounters.stateFor(scene,c).behaviour.ageMs=120000;
    RareEncounters.retire(scene,c);
    scene.save=JSON.parse(JSON.stringify(scene.save));
    assert.truthy(RareEncounters.stateFor(scene,c).finished);
    assert.falsy(EnemySpawns.surfaceActive(scene,c));
    c.pet=true;
    assert.truthy(EnemySpawns.surfaceActive(scene,c));
    assert.eq(RareEncounters.stateFor(scene,c).behaviour.ageMs,120000);
  }));
  test('rare encounters: goldenberry transforms plain Berry Lane bushes once and preserves fruit bushes', () => fixture((scene, entry) => {
    delete entry.zone;
    entry.streetArea = new Uint8Array(4096).fill(1);
    entry.streetAreaVariants = new Uint8Array(4096).fill(StreetVariants.VARIANT_BY_ID.berry.code);
    scene.playerM={x:5405,y:405};
    const points=[[425,405],[405,425],[385,405],[405,385]];
    entry.wildplants=points.map(([x,y],n)=>({id:'plain_'+n,crop:'shrub',x,y}));
    entry.wildplants.push({id:'fruit',crop:'berry',x:415,y:415});
    entry._spawnOpts={occupied:new Set(points.map(([x,y])=>Math.floor(y/10)*64+Math.floor(x/10)))};
    let ids=[];
    for(let n=0;n<100 && !ids.length;n++) ids=RareEncounters.berryPicked(scene,{id:'golden_'+n,crop:'goldenberry',x:405,y:405});
    assert.eq(ids.length,4);
    assert.eq(entry.creatures.length,4);
    assert.falsy(scene.save.chopped.includes('fruit'));
    assert.eq(scene.save.chopped.length,4);
    for(const c of entry.creatures) {assert.eq(c.kind,'thorn_ball');assert.truthy(c._rareSurround);}
    const groups=new Set(entry.creatures.map(c=>c._rareSurround.group)); assert.eq(groups.size,1);
    const savedIds=entry.creatures.map(c=>c.id).sort().join();
    entry.creatures=[]; delete scene._rareTickAt;
    RareEncounters.tick(scene,10000);
    assert.eq(entry.creatures.map(c=>c.id).sort().join(),savedIds,'transformed seats restore through original generated shrub occupancy');
    // Nothing can convert the same bush again, even for another gold fruit.
    RareEncounters.berryPicked(scene,{id:'another',crop:'goldenberry',x:405,y:405});
    assert.eq(entry.creatures.length,4);
  }));
  test('rare encounters: real cave seats carry exact depth for discovery and never leak floor species', () => fixture((scene) => {
    const seen=new Set();
    for(let depth=1;depth<=7;depth++) {
      const cache=WorldGen.tileCacheFor(depth), prior=new Map(cache); cache.clear();
      const entry={depth,cellsPerEdge:64,tileEdgeM:640,grid:new Uint8Array(4096).fill(WorldGen.T.CAVE_FLOOR),creatures:[]};
      cache.set(WorldGen.tileKey(0,0),entry); scene.depth=depth;
      try {
        // Advance persisted visit numbers, exercising actual chance and shared
        // placement checks without replacing either with an always-true stub.
        for(let visit=1;visit<=40;visit++) {
          const at=RareEncounters.locate(scene,325,325);
          scene.save={caught:[],rareEncounters:{active:at.key,elapsedMs:0,areas:{[at.key]:{visit,seats:{},rolls:{},originX:325,originY:325}}}};
          entry.creatures=[]; delete scene._rareTickAt; delete scene._rareBodies;
          RareEncounters.tick(scene,visit*1000);
          for(const c of entry.creatures) {
            seen.add(c.kind); assert.eq(c.depth,depth);
            assert.truthy(RareEncounters.ROWS.find(r=>r.kind===c.kind).floors.includes(depth));
            assert.truthy(EnemySpawns.surfaceActive(scene,c));
          }
        }
      } finally { cache.clear(); for(const [k,v] of prior) cache.set(k,v); }
    }
    for(const row of RareEncounters.ROWS.filter(r=>r.floors&&!r.water)) assert.truthy(seen.has(row.kind),row.kind+' can materialize on its real floor');
  }));
  test('rare encounters: harvest synchronizes a new Berry Lane during the tick throttle', () => fixture((scene,entry) => {
    RareEncounters.tick(scene,performance.now());
    const meadowKey=scene.save.rareEncounters.active;
    delete entry.zone;
    entry.streetArea=new Uint8Array(4096).fill(1);
    entry.streetAreaVariants=new Uint8Array(4096).fill(StreetVariants.VARIANT_BY_ID.berry.code);
    const before=scene.save.rareEncounters.elapsedMs;
    RareEncounters.berryPicked(scene,{id:'immediate_golden',crop:'goldenberry',x:325,y:325});
    const state=scene.save.rareEncounters;
    assert.falsy(state.active===meadowKey);
    assert.truthy(state.areas[state.active]);
    assert.eq(state.areas[state.active].visit,1);
    assert.eq(Object.keys(state.areas[state.active].rolls).length,1);
    assert.gte(state.elapsedMs,before);
    assert.lt(state.elapsedMs-before,250,'forced sync accounts only actual elapsed time');
  }));
  test('rare encounters: stale prior visits and spent bodies do not displace the next stable seat', () => fixture((scene, entry) => {
    let baseline;
    for(let n=0;n<100&&!baseline;n++) {
      entry.zone.anchors[0].key='occupancy_'+n;
      RareEncounters.tick(scene,n*1000);
      baseline=entry.creatures.find(c=>RareEncounters.eligible(scene,c));
    }
    assert.truthy(baseline);
    const key=scene.save.rareEncounters.active, area=scene.save.rareEncounters.areas[key];
    const oldVisit=area.visit+100;
    const stale={kind:'wolfling',id:`rare:${EnemySpawns.hash(key).toString(36)}:${oldVisit}:wolfling`,x:baseline.x,y:baseline.y,_rareEncounter:{key,visit:oldVisit}};
    let now=100000;
    for(const blocker of [stale,{kind:'slime',id:'dead',x:baseline.x,y:baseline.y,_hp:0},{kind:'slime',id:'caught',x:baseline.x,y:baseline.y}]) {
      area.seats={}; entry.creatures=[blocker]; scene.save.caught=['caught'];
      RareEncounters.tick(scene,now+=1000);
      const body=entry.creatures.find(c=>c.id===baseline.id);
      assert.truthy(body); assert.eq(body.x,baseline.x); assert.eq(body.y,baseline.y);
    }
    area.seats={}; entry.creatures=[{...stale,pet:true}];
    RareEncounters.tick(scene,now+=1000);
    const shifted=entry.creatures.find(c=>c.id===baseline.id);
    assert.truthy(shifted);
    assert.truthy(shifted.x!==baseline.x||shifted.y!==baseline.y,'a living captured pet still occupies its seat');
  }));
  test('rare encounters: passable prop occupancy does not consume a successful visit', () => fixture((scene, entry) => {
    let expected;
    for(let n=0;n<100&&!expected;n++){
      entry.zone.anchors[0].key='prop_overlap_'+n; scene.save={caught:[]};entry.creatures=[];delete scene._rareTickAt;
      RareEncounters.tick(scene,1000);expected=entry.creatures[0];
    }
    assert.truthy(expected);
    scene.save={caught:[]};entry.creatures=[];delete scene._rareTickAt;
    entry.objects=[{id:'passable-chest',kind:'chest',x:expected.x,y:expected.y}];
    entry._spawnOpts={occupied:new Set(Array.from({length:4096},(_,i)=>i))};
    RareEncounters.tick(scene,2000);
    assert.eq(entry.creatures.length,1);assert.eq(entry.creatures[0].id,expected.id);
    assert.eq(entry.creatures[0].x,expected.x);assert.eq(entry.creatures[0].y,expected.y);
  }));
})();
