(function () {
  function fixture(size = 19) {
    const anchor = { key: 'grove-trial', kind: 'grove', gx: 2048, gy: 2048 };
    const entry = { status: 'ready', _spawned: true, cellsPerEdge: size,
      grid: new Uint8Array(size * size).fill(WorldGen.T.PARK),
      roadMask: new Uint8Array(size * size), owners: new Uint16Array(size * size),
      zone: { anchors: [anchor], coverage: new Uint16Array(size * size).fill(1) } };
    for (let i = 0; i < size; i++) {
      entry.zone.coverage[i] = entry.zone.coverage[(size - 1) * size + i] = 0;
      entry.zone.coverage[i * size] = entry.zone.coverage[i * size + size - 1] = 0;
    }
    const temple = { id: 'entry', kind: 'temple', x: size * 5, y: size * 5, templeKind: 'grove', templeZone: anchor.key, templeAnchor: anchor };
    return { entry, temple, cache: new Map([[WorldGen.tileKey(0, 0), entry]]) };
  }
  test('temple floor: church platform is above its building and exclusively hosts the reaper', () => {
    const f = fixture(); f.temple.templeKind = f.temple.templeAnchor.kind = 'stones';
    f.entry.grid.fill(WorldGen.T.BUILDING_LARGE); f.entry.owners.fill(1);
    const plan = TempleLayout.plan(f.temple, f.cache, 190);
    assert.eq(plan.kind, 'duel'); assert.eq(plan.enemyKind, 'giant_reaper');
    assert.eq(plan.size, 7);
    for (const family of Object.values(EnemyHabitats.SURFACE_FAMILIES))
      assert.falsy(family.includes('giant_reaper'));
  });
  test('temple floor: deterministic seven-cell grove nexus trial', () => {
    const f = fixture(), a = TempleLayout.plan(f.temple, f.cache, 190);
    assert.eq(a.size, 7);
    assert.eq(JSON.stringify(a), JSON.stringify(TempleLayout.plan(f.temple, f.cache, 190)));
    assert.eq(a.zoneKey, f.temple.templeZone);
    assert.eq(a.cellM, 10);
  });
  test('temple floor: every square excludes roads, buildings and foreign coverage', () => {
    for (const blocked of ['road', 'building', 'owner', 'foreign', 'path']) {
      const f = fixture();
      for (let y = 0; y < 19; y++) for (let x = 0; x < 19; x++) {
        if (x >= 7 && x <= 11 && y >= 7 && y <= 11) continue;
        const i = y * 19 + x;
        if (blocked === 'road') f.entry.roadMask[i] = 1;
        if (blocked === 'building') f.entry.grid[i] = WorldGen.T.BUILDING;
        if (blocked === 'owner') f.entry.owners[i] = 1;
        if (blocked === 'foreign') f.entry.zone.coverage[i] = 0;
        if (blocked === 'path') f.entry.grid[i] = WorldGen.T.PATH;
      }
      const plan = TempleLayout.plan(f.temple, f.cache, 190);
      assert.eq(plan.size, 5, blocked);
      assert.eq(plan.x, 70); assert.eq(plan.y, 70);
      assert.falsy(['tower', 'ballista'].includes(plan.kind), 'large trials skipped');
    }
  });
  test('temple floor: small or unavailable parks offer no invalid room', () => {
    const f = fixture();
    f.entry.roadMask.fill(1);
    assert.eq(TempleLayout.plan(f.temple, f.cache, 190), null);
    f.entry.roadMask.fill(0); f.entry.status = 'loading';
    assert.eq(TempleLayout.plan(f.temple, f.cache, 190), null);
    f.entry.status = 'ready'; f.temple.templeAnchor.kind = 'tar';
    assert.eq(TempleLayout.plan(f.temple, f.cache, 190), null);
  });
  test('temple floor: entering does not pay, winning pays only once across reload', () => {
    const f = fixture(), oldCache = WorldGen.tileCache, oldScene = globalThis.TempleScene, oldGrant = grantTreasureRoll;
    let entries = 0, grants = 0;
    globalThis.TempleScene = { enter() { entries++; } };
    WorldGen.tileCache = f.cache;
    grantTreasureRoll = () => { grants++; };
    try {
      const scene = { tileEdgeM: 190, save: { temples: { 'grove-trial': { active: true } } }, playerScreen: () => ({ x: 0, y: 0 }) };
      Temples.interact({ scene, save: scene.save }, f.temple);
      assert.eq(entries, 1); assert.eq(grants, 0);
      assert.eq(Temples.complete(scene, f.temple), true);
      assert.eq(grants, 1); assert.eq(scene.save.temples['grove-trial'].challengeComplete, true);
      scene.save = JSON.parse(JSON.stringify(scene.save));
      assert.eq(Temples.complete(scene, { ...f.temple, id: 'second-door' }), false);
      assert.eq(grants, 1);
      Temples.interact({ scene, save: scene.save }, f.temple);
      assert.eq(entries, 2, 'completed trials remain enterable');
      assert.eq(grants, 1);
    } finally { WorldGen.tileCache = oldCache; globalThis.TempleScene = oldScene; grantTreasureRoll = oldGrant; }
  });
})();

test('temple floor: church challenge requires awakening and cannot pay just for visiting', () => {
  const oldCache = WorldGen.tileCache, oldScene = globalThis.TempleScene, oldGrant = grantTreasureRoll;
  const n = 11, anchor = {kind:'stones', key:'church-trial', gx:2048, gy:2048};
  const coverage = new Uint16Array(n*n);
  for (let y=1;y<n-1;y++) for(let x=1;x<n-1;x++) coverage[y*n+x]=1;
  WorldGen.tileCache = new Map([[WorldGen.tileKey(0,0), {status:'ready', _spawned:true,
    cellsPerEdge:n, grid:new Uint8Array(n*n).fill(WorldGen.T.CHURCHYARD),
    zone:{anchors:[anchor], coverage}, creatures:[], objects:[]}]]);
  let entries=0, grants=0;
  globalThis.TempleScene={enter(_s,_o,plan) {assert.eq(plan.enemyKind,'giant_reaper'); entries++;}};
  grantTreasureRoll=()=>{grants++;};
  try {
    const temple={kind:'temple', x:55,y:55,templeKind:'stones',templeZone:anchor.key,templeAnchor:anchor};
    const scene={tileEdgeM:110,save:{},showMessageModal(){},flash(){}};
    Temples.interact({scene,save:scene.save},temple); assert.eq(entries,0); assert.eq(grants,0);
    scene.save.temples={'church-trial':{active:true}};
    Temples.interact({scene,save:scene.save},temple); assert.eq(entries,1); assert.eq(grants,0);
  } finally {WorldGen.tileCache=oldCache;globalThis.TempleScene=oldScene;grantTreasureRoll=oldGrant;}
});
