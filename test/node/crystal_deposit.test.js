(() => {
  const crystal = id => ({kind:'mineralrock',deposit:'crystal',id,x:0,y:0});
  test('crystal deposit: one sapphire only, independent of random rolls and pick tier', () => {
    const random = Math.random;
    try {
      for (const tier of [3,7]) {
        const scene=makeScene(), save={relics:{pickaxe:{tier}}}, o=crystal(`crystal_${tier}`);
        // The known gem deposit does not use the ordinary rock's bonus table.
        Math.random=()=>{throw new Error('crystal rewards must not roll');};
        INTERACTABLES.mineralrock.complete(makeCtx(scene,save),o);
        assert.eq(JSON.stringify(scene._inv),JSON.stringify({[CRYSTAL_DEPOSIT.item]:CRYSTAL_DEPOSIT.quantity}));
        assert.truthy(scene.brokenRockSet.has(o.id),'uses the ordinary mined-rock ledger');
        assert.truthy(INTERACTABLES.mineralrock.spent(o,makeCtx(scene,save)),'the mined crystal is spent');
      }
    } finally { Math.random=random; }
  });
  test('crystal deposit: mining requires T3 pick and shares T4 mining energy', () => {
    const o=crystal('crystal_gate'), ore={kind:'mineralrock',yieldTier:CRYSTAL_DEPOSIT.yieldTier,requiredTier:CRYSTAL_DEPOSIT.requiredTier};
    assert.eq(CRYSTAL_DEPOSIT.item,'sapphire');assert.eq(CRYSTAL_DEPOSIT.quantity,1);
    assert.eq(CRYSTAL_DEPOSIT.yieldTier,4);assert.eq(CRYSTAL_DEPOSIT.requiredTier,3);
    const random=Math.random;
    try {
    Math.random=()=>.5;
    for(let tier=0;tier<=7;tier++) {
      const save={relics:{pickaxe:{tier}}};
      assert.eq(!!INTERACTABLES.mineralrock.gate(o,save),tier<3,'shared deposit tier gates even objects without explicit tier fields');
      assert.eq(INTERACTABLES.mineralrock.tierShort(o,save),3-tier);
      assert.eq(INTERACTABLES.mineralrock.energy(save,o),INTERACTABLES.mineralrock.energy(save,ore),'ordinary mining energy formula');
    }
    } finally {Math.random=random;}
  });
  test('crystal deposit: a completed work interaction cannot reward the same deposit twice', () => {
    const scene=makeScene(),save={relics:{pickaxe:{tier:3}}},o=crystal('crystal_spent'),ctx=makeCtx(scene,save);
    assert.eq(runInteractable(ctx,o),true);
    assert.eq(scene.invCount('sapphire'),1);
    assert.eq(runInteractable(ctx,o),true,'spent tap is consumed');
    assert.eq(scene.invCount('sapphire'),1,'no second reward');
  });
  test('crystal deposit: zone material agrees with the shared mining definition', () => {
    const m=ZoneVariants.materials.crystal;
    assert.truthy(m,'crystal is a distinct zone material');
    assert.eq(m.kind,'mineralrock');assert.eq(m.deposit,'crystal');
    assert.eq(m.yieldTier,CRYSTAL_DEPOSIT.yieldTier);assert.eq(m.requiredTier,CRYSTAL_DEPOSIT.requiredTier);
    const N=64, a={kind:'quarry',variant:'quarry-strip-mine',generated:'parking_lanes',gx:2048,gy:2048,lx:2048,ly:2048,key:1,R:21,upm:N*7/4096,owned:true};
    const out=ZoneDressing.dress({N,tx:0,ty:0,tileEdgeM:N*7,grid:new Uint8Array(N*N).fill(WorldGen.T.ROCK),
      field:{anchors:[a],coverage:new Uint16Array(N*N).fill(1)},chests:[],spawnOpts:{occupied:new Set(),spawnWhy:new Uint16Array(N*N)}});
    const deposits=out.objects.filter(o=>o.deposit==='crystal');
    assert.gt(deposits.length,0,'zone placements keep the crystal subtype');
    assert.truthy(deposits.every(o=>o.yieldTier===CRYSTAL_DEPOSIT.yieldTier&&o.requiredTier===CRYSTAL_DEPOSIT.requiredTier));
  });
})();
