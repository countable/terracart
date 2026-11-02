(() => {
  test('finite populations: ordinary AI retains former guard Home and daylight eligibility', () => {
    const previous=Difficulty.mode(), daylight=Lighting.daylight;
    const scene={save:{},startWorldM:{x:0,y:0},homeWorldPos:()=>({x:1000,y:0}),
      _pestFreeZone:()=>({has:()=>true}),cellAt:()=>({roadClass:WorldGen.ROAD_CLASS_MAJOR_BUFFER})};
    try {
      for(const mode of ['easy','hard'])for(const day of [0,1]) {
        Difficulty.setMode(mode);Lighting.daylight=()=>day;
        for(const kind of ['slime','goblin_runt','plant','spider','fire_slime','spear_goblin','archer_goblin','giant_bear'])
          for(const x of [0,200,400,800,1000,1400,5000]) {
            const original={kind,id:'control',lair:'street-feature',lairX:x,lairY:0,x,y:0};
            const migrated={kind,id:'control',_featureHome:{x,y:0,quiet:true},_surfaceSpawn:{x:x+7,y:0,tx:0,ty:0,cx:0,cy:0},x:x+7,y:0};
            assert.eq(EnemySpawns.homeEligible(scene,migrated),EnemySpawns.homeEligible(scene,original),mode+':'+kind+':home@'+x);
            assert.eq(EnemySpawns.surfaceActive(scene,migrated),EnemySpawns.surfaceActive(scene,original),mode+':'+kind+':active@'+x);
            assert.falsy(migrated.lair);assert.falsy(migrated.immobile);
          }
      }
    } finally {Difficulty.setMode(previous);Lighting.daylight=daylight;}
  });
})();
