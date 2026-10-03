(function () {
  test('basic rock density: thinning preserves ore and surviving stone identities', () => {
    const W=WorldGen,N=64,edge=N*W.CELL_M;
    const layers=[{name:'landcover',features:[{type:3,tags:{class:'rock'},geom:[[
      {x:0,y:0},{x:4096,y:0},{x:4096,y:4096},{x:0,y:4096},{x:0,y:0},
    ]]}]}];
    const rocks=()=>W.rasterizeTile(layers,N,12,5615,edge).objects.filter(o=>o.kind==='mineralrock'&&!o._street);
    const tuning=BiomeProfiles.staticObjects(W.T.ROCK),keep=tuning.rockPlainKeep;
    const reduced=rocks();let full;
    try { tuning.rockPlainKeep=1; full=rocks(); } finally { tuning.rockPlainKeep=keep; }
    const ore=o=>o.caveVariant==null&&(o.yieldTier||1)>1;
    assert.gt(full.length,500,'a broad outcrop exercises many overlapping clusters');
    assert.inRange(reduced.filter(o=>!ore(o)).length/full.filter(o=>!ore(o)).length,.70,.80,
      'natural stone cover falls by about one quarter');
    assert.eq(JSON.stringify(reduced.filter(ore)),JSON.stringify(full.filter(ore)),
      'ore positions, tiers and identities are unchanged');
    const original=new Map(full.map(o=>[o.id,o]));
    for(const rock of reduced) assert.eq(JSON.stringify(rock),JSON.stringify(original.get(rock.id)),
      'retained rocks never move or reroll their resource');
    assert.eq(new Set(reduced.map(o=>`${o.x},${o.y}`)).size,reduced.length,'thinning cannot create overlapping replacements');
  });
})();
