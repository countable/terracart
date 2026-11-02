// Baselines measured on main64cda139 before consolidation. Three layouts
// (short, long, diagonal), ten variants and both modes include ALL ordinary
// fauna/enemies and finite residents; a lost resident cannot be hidden by
// extra ambient creatures of another species. Counts include mode reserves.
test('street population rates: ambient fauna and foes plus finite residents retain sampled baseline budgets', () => {
 const previous=Difficulty.mode();
 const expected={"easy:hedgerow":{"sites":3,"placed":224,"byKind":{"butterfly":12,"chicken":45,"cow":40,"crow":5,"horse":3,"rabbit":22,"sheep":26,"plant":41,"slime":21,"snake":3,"goblin_runt":6}},"easy:overgrown":{"sites":9,"placed":237,"byKind":{"butterfly":17,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":22,"sheep":26,"plant":44,"slime":21,"snake":3,"boar":6,"giant_bear":3}},"easy:orchard":{"sites":3,"placed":220,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":19,"sheep":26,"plant":41,"slime":21,"snake":3,"farmer_goblin":3}},"easy:toadstool":{"sites":3,"placed":219,"byKind":{"butterfly":15,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"spider":3}},"easy:trade":{"sites":21,"placed":276,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"thief":21,"goblin_runt":42}},"easy:spider_path":{"sites":3,"placed":219,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"spider":6}},"easy:burned":{"sites":3,"placed":216,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"fire_slime":3}},"easy:barricade":{"sites":3,"placed":216,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"spear_goblin":3}},"easy:berry":{"sites":10,"placed":231,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":23,"sheep":26,"plant":41,"slime":21,"snake":3,"goblin_runt":10}},"easy:slime_trail":{"sites":14,"placed":241,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"fire_slime":28}},"hard:hedgerow":{"sites":3,"placed":224,"byKind":{"butterfly":12,"chicken":45,"cow":40,"crow":5,"horse":3,"rabbit":22,"sheep":26,"plant":41,"slime":21,"snake":3,"goblin_runt":6}},"hard:overgrown":{"sites":9,"placed":237,"byKind":{"butterfly":17,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":22,"sheep":26,"plant":44,"slime":21,"snake":3,"boar":6,"giant_bear":3}},"hard:orchard":{"sites":3,"placed":220,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":19,"sheep":26,"plant":41,"slime":21,"snake":3,"farmer_goblin":3}},"hard:toadstool":{"sites":3,"placed":219,"byKind":{"butterfly":15,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"spider":3}},"hard:trade":{"sites":21,"placed":276,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"thief":21,"goblin_runt":42}},"hard:spider_path":{"sites":3,"placed":219,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"spider":6}},"hard:burned":{"sites":3,"placed":216,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"fire_slime":3}},"hard:barricade":{"sites":3,"placed":219,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"spear_goblin":3,"archer_goblin":3}},"hard:berry":{"sites":10,"placed":231,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":23,"sheep":26,"plant":41,"slime":21,"snake":3,"goblin_runt":10}},"hard:slime_trail":{"sites":14,"placed":241,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"fire_slime":28}}};
 try {
 const N=64,cellM=7,edge=N*cellM, results={};
 for(const mode of ['easy','hard'])for(const variant of ['hedgerow','overgrown','orchard','toadstool','trade','spider_path','burned','barricade','berry','slime_trail']){
  Difficulty.setMode(mode);const sum={sites:0,placed:0,byKind:{}};
  for(let seed=0;seed<3;seed++){
   const layout=seed%3, row=StreetVariants.VARIANT_BY_ID[variant], line={variant,key:`measure-${variant}-${seed}`,lineKey:`measure-${variant}-${seed}`,size:row.size,
    line:[{x:4.5,y:32.5},{x:layout===0?24.5:59.5,y:layout===2?48.5:32.5}],halfW:3.5};
   const index={extent:N,lines:[line],dressingLines:[line],vehicleLines:[],hoardPois:[],roadClass:new Uint8Array(N*N)};
   const grid=new Uint8Array(N*N).fill(WorldGen.T.GRASS),opts={occupied:new Set(),roadClass:index.roadClass,roadMask:new Uint8Array(N*N)};
   for(let x=4;x<=59;x++){grid[32*N+x]=row.size==='path'?WorldGen.T.PATH:WorldGen.T.ROAD;opts.roadMask[32*N+x]=row.size==='path'?0:1;}
   const d=StreetVariants.dress({index,N,tx:0,ty:0,tileEdgeM:edge,grid,spawnOpts:opts});
   const entry={cellsPerEdge:N,tileEdgeM:edge,grid,baseGrid:grid,objects:d.objects,genObjects:d.objects,wildplants:d.wildplants,
    streetIndex:index,streetArea:StreetVariants.area(index,N),streetMarks:d.marks,streetDress:d,streetLairs:d.lairs,buildingShapes:[],_spawnOpts:opts};
   let creatures;
   entry.streetCreatureRequests=d.creatureRequests;
   creatures=WorldGen.runSteps(HabitatSpawns.populationSteps({tileEdgeM:edge,save:{}},entry,0,0,
    {skipLegacy:true,spawnOpts:opts}));
   sum.sites+=d.creatureRequests.length;
   sum.placed+=creatures.length;for(const c of creatures)sum.byKind[c.kind]=(sum.byKind[c.kind]||0)+1;
  }
  results[mode+':'+variant]=sum;
 }
 for(const key of Object.keys(expected)) {
  assert.eq(results[key].sites,expected[key].sites,key+' keeps finite requests');
  assert.eq(results[key].placed,expected[key].placed,key+' keeps total population');
  for(const kind of new Set([...Object.keys(expected[key].byKind),...Object.keys(results[key].byKind)]))
   assert.eq(results[key].byKind[kind]||0,expected[key].byKind[kind]||0,key+' '+kind);
 }
 } finally {Difficulty.setMode(previous);}
});
