// Visible gem deposits pay the stone they show, even with legacy rock fields.
(() => {
  const cases = [
    ['quartz', 'Rose Quartz', 1, 1, 29, 6, 5],
    ['topaz', 'Topaz', 2, 1, 28, 4, 10],
    ['amethyst', 'Amethyst', 3, 2, 27, 2, 20],
    ['ruby', 'Ruby', 5, 4, 24, 1, 80],
    ['emerald', 'Emerald', 6, 5, 25, 5, 200],
    ['diamond', 'Diamond', 7, 6, 26, 0, 600],
  ];
  const rock = (deposit, extra = {}) => ({kind:'mineralrock',deposit,id:`gem-${deposit}`,x:1,y:1,
    yieldTier:7,requiredTier:7,caveVariant:0,...extra});

  test('gem deposits: catalog, inventory art and mining definition agree', () => {
    for (const [id,name,tier,requiredTier,frame,icon,price] of cases) {
      const item = ITEM_BY_ID[id], deposit = mineralDeposit(rock(id));
      assert.truthy(item, `${id} exists`);
      assert.eq(item.name,name);assert.eq(item.kind,'mineral');assert.eq(item.baseTier,tier);
      assert.eq(BASE_TIER[id],tier);assert.eq(PRICES[id],price);
      assert.truthy(ITEM_EFFECTS[id],`${id} has a description`);
      const source=inventoryIconSource(id);
      assert.eq(source.sheet,'gems');assert.eq(source.frame,icon);
      assert.eq(deposit,GEM_DEPOSITS[id]);assert.eq(deposit.item,id);assert.eq(deposit.quantity,1);
      assert.eq(deposit.yieldTier,tier);assert.eq(deposit.requiredTier,requiredTier);
      assert.eq(deposit.art.sheet,'cave_props');assert.eq(deposit.art.frame,frame);
    }
    assert.eq(mineralDeposit(rock('crystal')),CRYSTAL_DEPOSIT,'old sapphire identity is retained');
    for (const deposit of ['missing','toString','constructor','__proto__'])
      assert.eq(mineralDeposit(rock(deposit)),null,'unknown and inherited keys are not deposits');
    assert.eq(mineralDeposit(null),null);
  });

  test('gem deposits: pick gate and energy override stale ordinary-rock fields', () => {
    const random=Math.random;
    try {
      Math.random=()=>.5;
      for (const [id,,tier,requiredTier] of cases) for(let pick=0;pick<=7;pick++) {
        const save={relics:{pickaxe:{tier:pick}}},o=rock(id);
        assert.eq(isPlainRock(o),false,`${id} is never ordinary cave rubble`);
        assert.eq(!!INTERACTABLES.mineralrock.gate(o,save),pick<requiredTier,`${id}, pick ${pick}`);
        assert.eq(INTERACTABLES.mineralrock.tierShort(o,save),requiredTier-pick);
        assert.eq(INTERACTABLES.mineralrock.energy(save,o),Math.max(effectivePickCost(save.relics),9*(tier-pick)));
      }
    } finally {Math.random=random;}
  });

  test('gem deposits: successful mining pays exactly one named gem and cannot pay twice', () => {
    const random=Math.random;
    try {
      Math.random=()=>{throw new Error('gem-only deposits must not roll ordinary rock loot');};
      for (const [id] of cases) {
        const scene=makeScene(),save={relics:{pickaxe:{tier:7}}},ctx=makeCtx(scene,save),o=rock(id);
        assert.eq(runInteractable(ctx,o),true);
        assert.eq(JSON.stringify(scene._inv),JSON.stringify({[id]:1}));
        assert.truthy(scene.brokenRockSet.has(o.id));
        assert.eq(runInteractable(ctx,o),true);
        assert.eq(JSON.stringify(scene._inv),JSON.stringify({[id]:1}),'spent deposit does not pay twice');
      }
    } finally {Math.random=random;}
  });

  test('gem deposits: quarry anchors do not add a sapphire to a different visible gem', () => {
    const key=WorldGen.tileKey(0,0),old=WorldGen.tileCache.get(key),random=Math.random;
    try {
      WorldGen.tileCache.set(key,{cellsPerEdge:2,zone:{anchors:[{kind:'quarry',gx:100,gy:200}],
        idx:new Uint8Array([1,1,0,0]),s:new Uint8Array([255,255,0,0])}});
      Math.random=()=>0;
      for(const [id] of cases) {
        const save={relics:{pickaxe:{tier:7}},caught:[],opened:[]};
        const scene=makeScene({save,cellAt:()=>({tx:0,ty:0,ix:0,iy:0})});
        INTERACTABLES.mineralrock.complete(makeCtx(scene,save),rock(id,{zoneKind:'quarry'}));
        assert.eq(JSON.stringify(scene._inv),JSON.stringify({[id]:1}),`${id} stays gem-only in a quarry`);
      }
    } finally {
      Math.random=random;
      if(old)WorldGen.tileCache.set(key,old);else WorldGen.tileCache.delete(key);
    }
  });

  test('gem deposits: map art shows the matching gem and stays centered at ordinary rock size', () => {
    const spec=Render.objectAppearance({textures:{exists:()=>true},save:{}},new Map(),false).RENDER_SPEC.mineralrock;
    for(const [id,,,,frame] of cases) {
      const o=rock(id),scale=spec.scale(o),b=SpriteLayout.ART_BOUNDS[`cave_props:${frame}`];
      assert.eq(spec.key(o),'cave_props');assert.eq(spec.frame(o),frame);assert.truthy(spec.seat);
      assert.truthy(b,`${id} has seating bounds`);
      assert.inRange(b.fw*scale,16*1.28-1e-9,16*1.28+1e-9,'24px art preserves the ordinary rock footprint');
      const offset=SpriteLayout.seatInCell(b,.5,.5,scale,scale);
      assert.inRange(offset.dxPx+((b.minX+b.maxX)/2-b.fw/2)*scale,-1e-9,1e-9);
      assert.inRange(offset.dyPx+((b.minY+b.maxY)/2-b.fh/2)*scale,-1e-9,1e-9);
    }
  });
})();
