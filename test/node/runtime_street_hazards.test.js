// Cross-section extensions must retain the same hazard class as pavement seats.
test('street hazard replay: cross-sections never spill into Passing verges', () => {
  const W=WorldGen,N=48,edge=N*7,extent=4096,scale=extent/N;
  const pt=(x,y)=>({x:(x+.5)*scale,y:(y+.5)*scale});
  const line=[pt(24,0),pt(24,47)];
  const layers=[{name:'landcover',features:[{type:3,tags:{class:'meadow'},geom:[[pt(0,0),pt(47,0),pt(47,47),pt(0,47),pt(0,0)]]}]},
    {name:'transportation',extent,features:[{type:2,tags:{class:'minor'},geom:[line]}]},
    {name:'transportation_name',extent,features:[{type:2,tags:{name:'Tier hazard test'},geom:[line]}]}];
  const original=StreetVariants.variantFor;
  try {
    for(const variant of ['barricade','thorny','snare']) {
      StreetVariants.variantFor=()=>variant;
      const r=W.rasterizeTile(layers,N,0,0,edge);
      r.gameplayTiers.fill(3);
      for(let y=0;y<N;y++) r.gameplayTiers[y*N+24]=2;
      const out=StreetVariants.dress({index:r.streetIndex,tx:0,ty:0,N,tileEdgeM:edge,grid:r.grid,
        spawnOpts:{gameplayTiers:r.gameplayTiers,occupied:new Set(),pois:[]}});
      const hazards=[...out.traps,...out.objects.filter(o=>o._spawnClass==='streetObstacle'),
        ...out.wildplants.filter(o=>o._spawnClass==='streetObstacle')];
      if(variant==='barricade') assert.gt(hazards.length,0,'fixture retains a calm pavement crossing');
      for(const o of hazards) {
        const i=Math.floor(o.y/7)*N+Math.floor(o.x/7);
        assert.eq(r.gameplayTiers[i],2,variant+' cannot emit hazard into Passing');
      }
    }
  } finally { StreetVariants.variantFor=original; }
});
