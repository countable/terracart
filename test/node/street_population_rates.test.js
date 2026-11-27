// Baselines measured on main64cda139 before consolidation. Three layouts
// (short, long, diagonal), ten variants and both modes include ALL ordinary
// fauna/enemies and finite residents; a lost resident cannot be hidden by
// extra ambient creatures of another species. Counts include shared mode
// reserves; the street-variant test owns each mode's visibility share.
// Animals a road theme borrows from the land underneath (HabitatSpawns.densityRows:
// a theme with no fauna rows falls back) are new since the baseline: excluded
// from it, and required where the theme lends its ground back.
const lentByRoad = c => c._spawnSource === 'zone-density' && c._spawnOwner?.startsWith('Roads and paths:')
  && !HabitatSpawns.densityRows(c._spawnOwner).some(r => r.kind === c.kind);
const FAUNA_KINDS = new Set(Object.values(HabitatSpawns.DENSITY_ROWS).flat().filter(r => r.category === 'fauna').map(r => r.kind));
const lendsGround = variant => !HabitatSpawns.densityRows('Roads and paths:' + variant).some(r => r.category === 'fauna');
test('street population rates: ambient fauna and foes plus finite residents retain sampled baseline budgets', () => {
 const previous=Difficulty.mode();
 const expected={"easy:hedgerow":{"sites":3,"placed":224,"byKind":{"butterfly":12,"chicken":45,"cow":40,"crow":5,"horse":3,"rabbit":22,"sheep":26,"plant":41,"slime":21,"snake":3,"goblin_runt":6}},"easy:overgrown":{"sites":9,"placed":237,"byKind":{"butterfly":17,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":22,"sheep":26,"plant":44,"slime":21,"snake":3,"boar":6,"giant_bear":3}},"easy:orchard":{"sites":3,"placed":220,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":19,"sheep":26,"plant":41,"slime":21,"snake":3,"farmer_goblin":3}},"easy:toadstool":{"sites":3,"placed":219,"byKind":{"butterfly":15,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"spider":3}},"easy:trade":{"sites":21,"placed":276,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"thief":21,"goblin_runt":42}},"easy:spider_path":{"sites":3,"placed":219,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"spider":6}},"easy:burned":{"sites":3,"placed":216,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"fire_slime":3}},"easy:barricade":{"sites":3,"placed":219,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"spear_goblin":3,"archer_goblin":3}},"easy:berry":{"sites":10,"placed":232,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":24,"sheep":26,"plant":41,"slime":21,"snake":3,"goblin_runt":10}},"easy:slime_trail":{"sites":14,"placed":241,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"fire_slime":28}},"hard:hedgerow":{"sites":3,"placed":224,"byKind":{"butterfly":12,"chicken":45,"cow":40,"crow":5,"horse":3,"rabbit":22,"sheep":26,"plant":41,"slime":21,"snake":3,"goblin_runt":6}},"hard:overgrown":{"sites":9,"placed":237,"byKind":{"butterfly":17,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":22,"sheep":26,"plant":44,"slime":21,"snake":3,"boar":6,"giant_bear":3}},"hard:orchard":{"sites":3,"placed":220,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":19,"sheep":26,"plant":41,"slime":21,"snake":3,"farmer_goblin":3}},"hard:toadstool":{"sites":3,"placed":219,"byKind":{"butterfly":15,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"spider":3}},"hard:trade":{"sites":21,"placed":276,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"thief":21,"goblin_runt":42}},"hard:spider_path":{"sites":3,"placed":219,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"spider":6}},"hard:burned":{"sites":3,"placed":216,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"fire_slime":3}},"hard:barricade":{"sites":3,"placed":219,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"spear_goblin":3,"archer_goblin":3}},"hard:berry":{"sites":10,"placed":232,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":24,"sheep":26,"plant":41,"slime":21,"snake":3,"goblin_runt":10}},"hard:slime_trail":{"sites":14,"placed":241,"byKind":{"butterfly":12,"chicken":46,"cow":40,"crow":6,"horse":3,"rabbit":15,"sheep":26,"plant":41,"slime":21,"snake":3,"fire_slime":28}}};
 try {
 const N=64,cellM=7,edge=N*cellM, results={}, sharedBarricades={};
 for(const mode of ['easy','hard'])for(const variant of ['hedgerow','overgrown','orchard','toadstool','trade','spider_path','burned','barricade','berry','slime_trail']){
  Difficulty.setMode(mode);const sum={sites:0,placed:0,lent:0,byKind:{}};
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
   if(variant==='barricade') (sharedBarricades[mode] ||= []).push(...creatures
    .filter(c=>c._streetRequest==='barricade').map(c=>`${c.id}:${c.kind}:${!!c._landEnemyReserve}@${c.x},${c.y}`));
   // Hard's street gangs (StreetVariants.STREET_GANGS) are additive: the
   // baseline below must hold with them excluded, and every street has one.
   const gang=rule=>!!(StreetVariants.STREET_GANGS[rule]||StreetVariants.STREET_HORDES[rule]);
   assert.truthy(d.creatureRequests.some(q=>gang(q.rule)),variant+' holds a street gang post');
   if(lendsGround(variant)&&layout===0)assert.truthy(creatures.some(lentByRoad),variant+' lends its ground\'s animals back');
   const base=creatures.filter(c=>!gang(c._streetRequest)&&!lentByRoad(c));
   assert.truthy(creatures.filter(c=>gang(c._streetRequest)).every(c=>c._streetGang?.sid&&Number.isInteger(c._streetGang.n)),variant+' gang bodies carry their visibility tag');
   sum.sites+=d.creatureRequests.filter(q=>!gang(q.rule)).length;
   sum.lent+=creatures.filter(lentByRoad).length;
   sum.placed+=base.length;for(const c of base)sum.byKind[c.kind]=(sum.byKind[c.kind]||0)+1;
  }
  results[mode+':'+variant]=sum;
 }
 assert.eq(sharedBarricades.easy.sort().join('|'),sharedBarricades.hard.sort().join('|'),
  'every mode materializes the same barricade residents before local visibility');
 for(const key of Object.keys(expected)) {
  assert.eq(results[key].sites,expected[key].sites,key+' keeps finite requests');
  // Enemies and residents keep their exact budgets. A land animal beside the
  // road may now be spaced out by a lent verge animal (FAUNA_SPACING_CELLS),
  // never replaced by more of its own kind, and animals overall never fall.
  let animals=0,expectedAnimals=0;
  for(const kind of new Set([...Object.keys(expected[key].byKind),...Object.keys(results[key].byKind)])) {
   const got=results[key].byKind[kind]||0,want=expected[key].byKind[kind]||0;
   if(!FAUNA_KINDS.has(kind)) { assert.eq(got,want,key+' '+kind); continue; }
   assert.inRange(got,Math.floor(want*0.95),want,key+' '+kind+' loses at most a few to spacing');
   animals+=got; expectedAnimals+=want;
  }
  assert.truthy(animals+results[key].lent>=expectedAnimals,key+' animals overall never fall ('+(animals+results[key].lent)+' vs '+expectedAnimals+')');
 }
 } finally {Difficulty.setMode(previous);}
});
