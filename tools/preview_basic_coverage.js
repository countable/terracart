// Actual generated stationary occupancy on reproducible public-frontage fixtures.
// No scene fauna: moving creatures are not area coverage. No runtime tuning.
module.exports = function basicCoverageMetrics(ctx, options = {}) {
  const WG = ctx.WorldGen, N = options.cellsPerEdge || 96, repeats = options.repeats || 8;
  const E = 4096, edge = N * WG.CELL_M, ty = 5615;
  const point = (x,y) => ({x:x*E/N,y:y*E/N});
  const fixtures = {
    GRASS:['landcover',{class:'grass'}],FOREST:['landcover',{class:'wood'}],
    SAND:['landcover',{class:'sand'}],FARMLAND:['landuse',{class:'farmland'}],
    RESIDENTIAL:['landuse',{class:'residential'}],PARK:['landuse',{class:'park'}],
    ROCK:['landcover',{class:'rock'}],SCHOOL:['landuse',{class:'school'}],
    COMMERCIAL:['landuse',{class:'commercial'}],INDUSTRIAL:['landuse',{class:'industrial'}],
    PLAYGROUND:['landuse',{class:'playground'}],PITCH:['landuse',{class:'pitch'}],
    WETLAND:['landcover',{class:'wetland'}],GOLF:['landcover',{class:'grass',subclass:'golf_course'}],
    ORCHARD:['landcover',{class:'farmland',subclass:'orchard'}],WASTELAND:['landuse',{class:'brownfield'}],
  };
  const group = o => o.kind === 'wildplant' ? o.crop
    : o.kind === 'tree' ? 'tree'
    : o.kind === 'fruittree' ? 'fruittree'
    : o.kind === 'mineralrock' ? (o.caveVariant != null || (o.yieldTier || 1) <= 1 ? 'plain_rock' : 'ore_rock')
    : o.kind === 'chest' && o.barrel && o.barrelStyle === 'clay_pot' ? 'clay_pot' : null;
  const roads=[], pois=[];
  for(let p=8;p<N;p+=16) {
    roads.push({type:2,tags:{class:'residential',access:'yes'},geom:[[point(0,p),point(N,p)]]},
      {type:2,tags:{class:'residential',access:'yes'},geom:[[point(p,0),point(p,N)]]});
    for(let q=8;q<N;q+=16) pois.push({type:1,tags:{class:'library'},geom:[[point(p+2,q+2)]]});
  }
  const rows=[];
  const zones=ctx.Zones; ctx.Zones=undefined;
  try {
    for(const [name,[layer,tags]] of Object.entries(fixtures)) {
      const characters=name==='PARK'?Object.keys(ctx.BiomeProfiles.PARK_CHARACTERS):[null];
      for(const character of characters) {
        const samples=[];
        for(let tx=2622;samples.length<repeats;tx++) {
          if(character&&ctx.BiomeProfiles.parkCharacterAt(tx*E+E/2,ty*E+E/2)!==character)continue;
          const layers=[{name:layer,extent:E,features:[{type:3,tags,geom:[[point(1,1),point(N-1,1),point(N-1,N-1),point(1,N-1),point(1,1)]]}]},
            {name:'transportation',extent:E,features:roads},{name:'poi',extent:E,features:pois}];
          const tile=WG.rasterizeTile(layers,N,tx,ty,edge);
          const target=new Set(),eligible=new Set();
          for(let y=1;y<N-1;y++)for(let x=1;x<N-1;x++) {
            const i=y*N+x;if(tile.grid[i]!==WG.T[name]||tile.roadMask?.[i])continue;
            target.add(i);
            if(WG.isSpawnCell(tile.grid,N,N,x,y,{spawnWhy:tile.spawnWhy,roadMask:tile.roadMask},'minor'))eligible.add(i);
          }
          const groups=new Map(),occupied=new Set();let outsideEligible=0;
          for(const o of [...(tile.objects||[]),...(tile.wildplants||[])]) {
            const key=group(o);if(!key||o._street||o.zoneVariant||o.placed)continue;
            const x=Math.floor((o.x-tx*edge)/WG.CELL_M),y=Math.floor((o.y-ty*edge)/WG.CELL_M),i=y*N+x;
            if(!target.has(i))continue;
            if(!eligible.has(i)){outsideEligible++;continue;}
            if(!groups.has(key))groups.set(key,new Set());groups.get(key).add(i);occupied.add(i);

          }
          samples.push({tx,ty,targetCells:target.size,eligibleCells:eligible.size,occupiedCells:occupied.size,
            outsideEligible,elementCells:Object.fromEntries([...groups].map(([k,v])=>[k,v.size]))});
        }
        const total=key=>samples.reduce((n,s)=>n+s[key],0),targetCells=total('targetCells'), eligibleCells=total('eligibleCells');
        const percent=n=>eligibleCells?100*n/eligibleCells:0;
        const elements={};for(const sample of samples)for(const[k,n]of Object.entries(sample.elementCells))elements[k]=(elements[k]||0)+n;
        rows.push({terrain:name,character,targetCells,eligibleCells:total('eligibleCells'),occupiedCells:total('occupiedCells'),
          coveragePct:percent(total('occupiedCells')),coverageOfAllTerrainPct:100*total('occupiedCells')/targetCells,eligiblePct:100*total('eligibleCells')/targetCells,
          coverageOfEligiblePct:percent(total('occupiedCells')),
          coverageRangePct:[Math.min(...samples.map(s=>(s.eligibleCells?100*s.occupiedCells/s.eligibleCells:0))),Math.max(...samples.map(s=>(s.eligibleCells?100*s.occupiedCells/s.eligibleCells:0)))],
          elements:Object.fromEntries(Object.entries(elements).map(([k,n])=>[k,{cells:n,coveragePct:percent(n)}])),samples});
      }
    }
  } finally {ctx.Zones=zones;}
  return {method:{cellsPerEdge:N,repeats,cellM:WG.CELL_M,fixtureSideM:edge,
    denominator:'Target terrain cells in source polygon interior passing the runtime minor spawn gate. Restricted/private cells and road bands excluded; all-terrain count retained separately.',
    numerator:'Unique cell seats occupied by generated plants, trees, fruit trees, rocks or clay pots. No visual canopy area, mobile creatures, POI chests, street dressing or nexus.',
    fixture:'One polygon; public residential roads every16 cells (112m), public library POIs near each crossing; no buildings; natural park-character seeds; Zones module disabled to isolate basic land.',
    caveat:'Synthetic comparison, not live-map area coverage. Geometry, overlapping source polygons, restrictions and source POIs change live occupancy.'},rows};
};
