(() => {
  const N = 48, C = WorldGen.CELL_M;
  function fixture() {
    const gx = 24.5 * 4096 / N;
    const anchor = { kind:'quarry', variant:'quarry-strip-mine', generated:'parking_lanes', owned:true,
      gx, gy:gx, lx:gx, ly:gx, key:18, upm:N*C/4096, R:21 };
    const coverage = new Uint16Array(N*N);
    for (let y=3;y<N-3;y++) for (let x=3;x<N-3;x++) coverage[y*N+x]=1;
    const ctx = {N,tx:0,ty:0,tileEdgeM:N*C,grid:new Uint8Array(N*N).fill(WorldGen.T.ROCK),
      field:{anchors:[anchor],coverage},chests:[],spawnOpts:{occupied:new Set(),spawnWhy:new Uint16Array(N*N),roadMask:new Uint8Array(N*N)}};
    return {ctx, dress:ZoneDressing.dress(ctx)};
  }
  test('covered treasure: strip mine finds roll beneath one fifth of ordinary cracked rocks', () => {
    const {dress} = fixture();
    const rocks=dress.objects.filter(o=>o.kind==='mineralrock' && !o.deposit);
    assert.inRange(dress.treasures.length / rocks.length,.15,.25);
    assert.eq(dress.diagnostics[0].findsRequested,dress.treasures.length);
    assert.eq(dress.diagnostics[0].findsPlaced,dress.treasures.length);
    for (const mark of dress.treasures) {
      const cover = dress.objects.find(o=>o.id===mark.coverRockId);
      assert.truthy(cover); assert.eq(cover.kind,'mineralrock');
      assert.truthy(isPlainRock(cover)); assert.eq(cover._zoneObjectFrame,65);
      assert.eq(cover.x,mark.x); assert.eq(cover.y,mark.y);
      assert.falsy(treasureExposed(mark,{save:{brokenRocks:[]}}));
    }
    assert.eq(new Set(dress.objects.map(o=>`${o._ix},${o._iy}`)).size,dress.objects.length);
  });
  test('covered treasure: clipped strip mines use stable cell rolls without adding rocks', () => {
    const {ctx}=fixture(),anchor=ctx.field.anchors[0];
    anchor.clipped=true;anchor.owned=false;ctx.spawnOpts.occupied.clear();
    const first=ZoneDressing.dress(ctx),byId=new Map(first.objects.map(o=>[o.id,o]));
    assert.gt(first.treasures.length,20,'clipped rocks also conceal finds');
    for(const mark of first.treasures) {
      const rock=byId.get(mark.coverRockId);
      assert.truthy(rock && !rock.deposit,'sapphire deposits never cover treasure');
      assert.eq(mark.id,rock.id+'_treasure','find identity derives from its rock cell');
    }
    ctx.spawnOpts.occupied.clear();Object.assign(anchor,{gx:17,gy:33,key:999});
    const moved=ZoneDressing.dress(ctx);
    assert.eq(moved.treasures.map(o=>o.id).join(','),first.treasures.map(o=>o.id).join(','),'source anchor changes do not reroll cells');
    const variant=ZoneVariants.byId('quarry-strip-mine'),chance=variant.buriedTreasureChance;
    try {
      variant.buriedTreasureChance=0;ctx.spawnOpts.occupied.clear();
      const bare=ZoneDressing.dress(ctx);
      assert.eq(bare.treasures.length,0);
      assert.eq(JSON.stringify(bare.objects),JSON.stringify(moved.objects),'treasure adds no rocks or alters existing rock identities');
    } finally {variant.buriedTreasureChance=chance;}
  });
  test('covered treasure: a covering rock cannot bypass the treasure spawn gate', () => {
    const {ctx}=fixture();ctx.spawnOpts.occupied.clear();
    ctx.spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.SENSITIVE);
    const dress=ZoneDressing.dress(ctx);
    assert.eq(dress.treasures.length,0);
    assert.falsy(dress.objects.some(o=>o.zoneLayer==='cover'));
    assert.gt(dress.objects.filter(o=>o.kind==='mineralrock').length,0,'ordinary stones still fit sensitive ground');
  });
  test('covered treasure: mining exposes the same saved mark and permits only one dig', () => {
    const {dress}=fixture(),mark=dress.treasures[0],cover=dress.objects.find(o=>o.id===mark.coverRockId);
    const save={brokenRocks:[],foundTreasures:[]};
    const scene=makeScene({save,cellM:C,cellsPerTile:N,tileEdgeM:N*C,startWorldM:{x:0,y:0},originPx:{x:0,y:0},mPerPx:N*C/WorldGen.TILE_PX,brokenRockSet:bindIdSet(save,'brokenRocks')});
    const ctx={...makeCtx(scene,save),wm:{x:mark.x,y:mark.y}};
    const handler=TAP_HANDLERS.find(h=>h.name==='treasure');
    const cache=new Map(WorldGen.tileCache), grant=grantTreasureRoll, far=tooFar;
    let rolls=0;
    try {
      WorldGen.tileCache.clear();WorldGen.tileCache.set('covered-test',{extraTreasures:[mark]});
      grantTreasureRoll=()=>{rolls++};tooFar=()=>false;
      assert.eq(handler.try(ctx),false,'covered treasure cannot intercept the mining tap');
      assert.eq(rolls,0);assert.eq(save.foundTreasures.length,0);
      INTERACTABLES.mineralrock.complete(ctx,cover);
      assert.truthy(save.brokenRocks.includes(cover.id));
      assert.truthy(treasureExposed(mark,scene));
      const reloaded=JSON.parse(JSON.stringify(save));
      assert.truthy(treasureExposed(mark,{save:reloaded}),'reload preserves exposure');
      assert.truthy(treasureExposed({id:'ordinary'},scene),'ordinary X remains exposed');
      assert.eq(handler.try(ctx),true);assert.eq(rolls,1);
      assert.eq(handler.try(ctx),false);assert.eq(rolls,1);
      assert.truthy(RENDER_SRC.includes('if (!treasureExposed(tr, scene) || found.has(tr.id)) return;'),'render uses the same exposure gate');
    } finally {
      grantTreasureRoll=grant;tooFar=far;WorldGen.tileCache.clear();
      for(const [key,value] of cache)WorldGen.tileCache.set(key,value);
    }
  });
  test('covered treasure: live installation keeps latent marks only with their accepted cover', () => {
    const was=window.__TEST_MODE;window.__TEST_MODE=false;
    try {
      for(const blocked of [false,true]) {
        const {ctx,dress}=fixture(),mark=dress.treasures[0];
        const entry={grid:ctx.grid,baseGrid:ctx.grid.slice(),cellsPerEdge:N,genObjects:[],
          objects:blocked?[{kind:'chest',id:'player_chest',x:mark.x,y:mark.y}]:[],wildplants:[],zoneDress:dress,depth:0};
        const scene=Object.assign(new SceneCreatures(),{tileEdgeM:N*C,cellM:C,save:{caught:[]},
          _pestFreeZone:()=>null,_starterTrailAnchor:()=>null,_provisionStarterHome(){},_carveStarterPond(){}});
        scene.spawnInTile(entry,0,0);
        const marks=entry.extraTreasures.filter(o=>o.zoneVariant==='quarry-strip-mine');
        assert.eq(marks.length,dress.treasures.length-(blocked?1:0));
        for(const tr of marks)assert.truthy(entry.objects.some(o=>o.id===tr.coverRockId));
        assert.eq(marks.some(o=>o.id===mark.id),!blocked,'blocked cover cannot leave an invisible orphan find');
      }
    } finally {window.__TEST_MODE=was;}
  });
})();
