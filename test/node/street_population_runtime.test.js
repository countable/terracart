(() => {
  const body=SPAWN_IN_TILE_SRC.slice(0,SPAWN_IN_TILE_SRC.indexOf('    // (Starter-cow'));
  const spawn=spawnPassFn(body+'\nreturn creatures;');
  function run(testMode,caught=[]) {
    const N=32,edge=N*7;
    const entry={cellsPerEdge:N,tileEdgeM:edge,grid:new Uint8Array(N*N).fill(WorldGen.T.GRASS),objects:[],
      streetArea:new Uint8Array(N*N).fill(1),streetAreaVariants:new Uint8Array(N*N).fill(StreetVariants.VARIANT_BY_ID.trade.code),
      streetDress:{objects:[],wildplants:[],traps:[],treasures:[],lairs:[],
        creatureRequests:[{rule:'street_trade',sid:'runtime-trade',_street:'trade',lx:73.5,ly:73.5}]}};
    const scene=Object.assign(new SceneCreatures(),{tileEdgeM:edge,save:{caught},startWorldM:{x:-5000,y:0},_pestFreeZone:()=>null});
    const previous=window.__TEST_MODE;
    try {window.__TEST_MODE=testMode;return {entry,creatures:spawn.call(scene,entry,0,0)};}
    finally {window.__TEST_MODE=previous;}
  }
  test('street populations: scene runs finite residents once and preserves captures and test-mode suppression',()=>{
    const before=run(false),residents=before.creatures.filter(c=>c._streetRequest);
    assert.eq(residents.length,3);
    assert.truthy(residents.every(c=>!c.lair&&!c.immobile&&!c._surfaceInactive));
    assert.eq(new Set(residents.map(c=>c.id)).size,3);
    const killed=residents[0],after=run(false,[killed.id]);
    const remaining=after.creatures.filter(c=>c._streetRequest);
    assert.eq(remaining.length,2);
    assert.eq(JSON.stringify(remaining),JSON.stringify(residents.slice(1)));
    assert.truthy(after.entry._spawnOpts.creatureCells.has(killed._surfaceSpawn.cell),'defeat does not free the generated seat');
    assert.eq(run(true).creatures.filter(c=>c._streetRequest).length,0);
  });
})();
