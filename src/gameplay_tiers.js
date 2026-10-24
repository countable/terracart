// Shared geographic spawn policy. Generation and map review consume the same
// per-cell tiers; source reasons remain available for inspection.
(function (root) {
  const TIERS = [
    { id: 1, label: 'Tier 1 · core', color: '#21c8aa', description: 'Daily value, fast/ranged enemies and elites, butterflies, easily extracted resources.' },
    { id: 2, label: 'Tier 2 · calm', color: '#f4bf54', description: 'Resources, slow creatures, NPCs and hazards; fast movers cannot spawn.' },
    { id: 3, label: 'Tier 3 · passing', color: '#e77d76', description: 'Ordinary finds, slow creatures and passive walking; hazards and fast movers cannot spawn.' },
    { id: 4, label: 'Excluded', color: '#69647c', description: 'Buildings, water, restricted/private ground, other existing access exclusions, or no qualifying mapped evidence.' },
  ];
  const REASONS = [
    ['No qualifying mapped geometry', 4], ['Park / garden / beach', 1],
    ['Recreation ground', 1], ['Pedestrian / footway area', 1], ['Mapped path / one-cell buffer', 1],
    ['Mapped grassland / woodland', 2], ['Public-facing commercial ground', 2],
    ['Church grounds / point vicinity', 2], ['Small road; through or connectivity unconfirmed', 2],
    ['Road with a mapped parallel path / sidewalk', 2], ['Path / core ground within road buffer', 2],
    ['Parking polygon / retained parking lane', 3], ['Residential dead end', 3],
    ['Major / medium road', 3], ['Other vehicle road', 3],
    ['Building / water footprint', 4], ['Explicit access restriction', 4],
    ['Existing land/access exclusion', 4], ['Path use or vehicle access unconfirmed', 4],
    ['Old Stones nexus / absorbed adjoining parking', 2],
    ['Major / medium street surface', 4],
    ['Intersection passing buffer', 3],
    ['Grove / beach nexus coverage', 1], ['Tar yard nexus coverage', 2], ['Quarry nexus coverage', 3],
  ].map(([label, tier], id) => ({ id, label, tier }));
  const R = { UNKNOWN:0, PARK:1, REC:2, PLAZA:3, PATH:4, NATURAL:5, COMMERCIAL:6,
    CHURCH:7, SMALL:8, SIDEPATH:9, BUFFER:10, PARKING:11, DEADEND:12,
    MAJOR:13, OTHER:14, SURFACE:15, ACCESS:16, GATE:17, UNCERTAIN_PATH:18, STONES:19, MAJOR_SURFACE:20, JUNCTION:21, NEXUS_CORE:22, NEXUS_TAR:23, NEXUS_QUARRY:24 };
  const NEXUS_REASON={grove:R.NEXUS_CORE,beach:R.NEXUS_CORE,stones:R.STONES,tar:R.NEXUS_TAR,quarry:R.NEXUS_QUARRY};
  const CORE_TIER=1, CALM=2, PASSING=3, EXCLUDED=4;
  const ROAD_BUFFER_CELLS=3, PATH_BUFFER_CELLS=1, JUNCTION_BUFFER_CELLS=5;
  const CLASS_TIERS=Object.freeze({
    minor:[1,2,3], headstone:[1,2,3], cave:[1,2,3], fauna:[1,2,3],
    fastFauna:[1], npc:[1,2,3], attractor:[1,2,3], enemy:[1,2,3],
    hazard:[1,2], fastEnemy:[1], reward:[1,2,3], streetObstacle:[1,2],
  });
  const allowed=(tier,cls)=>!!CLASS_TIERS[cls]?.includes(tier);
  const RECORD_CLASSES=Object.freeze({pressure_plate:'hazard',stakes:'streetObstacle',tar:'streetObstacle'});
  const classForRecord=(record,fallback='minor')=>record?._spawnClass || RECORD_CLASSES[record?.kind] || fallback;
  const CORE = new Set(['park', 'garden', 'beach', 'dog_park']);
  const REC = new Set(['recreation_ground', 'sports_centre', 'sports', 'pitch', 'playground', 'stadium', 'school', 'college', 'university', 'education']);
  const NATURAL = new Set(['wood', 'woodland', 'forest', 'grass', 'grassland', 'meadow', 'heath']);
  const NONROAD = new Set(['rail', 'railway', 'transit', 'ferry', 'aerialway']);
  const smallRoad=(tags,WG)=>WG.classifyLine('transportation',tags)===WG.T.ROAD;
  const denied = t => ['private','no','permit','permits','destination','delivery','agricultural','forestry','customers_only'].includes(t.access) ||
    ['private','no','permit','permits','destination','customers'].includes(t.foot);
  const box = points => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of points) { b[0] = Math.min(b[0], p.x); b[1] = Math.min(b[1], p.y); b[2] = Math.max(b[2], p.x); b[3] = Math.max(b[3], p.y); }
    return b;
  };
  const overlaps = (a,b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  function distance2(p,a,b) {
    const dx=b.x-a.x, dy=b.y-a.y, d=dx*dx+dy*dy;
    const t=d ? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)) : 0;
    return (p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;
  }
  // Per-feature odd-even scanlines preserve polygon holes and multipart rings.
  function polygonCells(rings, N, ox, oy, cell, visit) {
    const bounds=box(rings.flat()), y0=Math.max(0,Math.ceil((bounds[1]-oy)/cell-.5)), y1=Math.min(N-1,Math.floor((bounds[3]-oy)/cell-.5));
    for(let y=y0;y<=y1;y++) {
      const yy=oy+(y+.5)*cell, crossings=[];
      for(const ring of rings) for(let j=0,k=ring.length-1;j<ring.length;k=j++) {
        const a=ring[k],b=ring[j];
        if((a.y>yy)!==(b.y>yy)) crossings.push(a.x+(yy-a.y)*(b.x-a.x)/(b.y-a.y));
      }
      crossings.sort((a,b)=>a-b);
      for(let j=0;j+1<crossings.length;j+=2) {
        const x0=Math.max(0,Math.ceil((crossings[j]-ox)/cell-.5)), x1=Math.min(N-1,Math.ceil((crossings[j+1]-ox)/cell-.5)-1);
        for(let x=x0;x<=x1;x++) visit(y*N+x);
      }
    }
  }
  function stampSegment(a,b,r,N,ox,oy,cell,visit) {
    const x0=Math.max(0,Math.ceil((Math.min(a.x,b.x)-r-ox)/cell-.5)),x1=Math.min(N-1,Math.floor((Math.max(a.x,b.x)+r-ox)/cell-.5));
    const y0=Math.max(0,Math.ceil((Math.min(a.y,b.y)-r-oy)/cell-.5)),y1=Math.min(N-1,Math.floor((Math.max(a.y,b.y)+r-oy)/cell-.5));
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) {
      const p={x:ox+(x+.5)*cell,y:oy+(y+.5)*cell};
      const d=distance2(p,a,b); if(d<=r*r) visit(y*N+x,p,d);
    }
  }
  function segmentIndex(segments, size) {
    const bins=new Map();
    for(const s of segments) {
      const b=box([s.a,s.b]);
      for(let y=Math.floor(b[1]/size);y<=Math.floor(b[3]/size);y++) for(let x=Math.floor(b[0]/size);x<=Math.floor(b[2]/size);x++) {
        const k=`${x},${y}`;if(!bins.has(k)) bins.set(k,[]);bins.get(k).push(s);
      }
    }
    return (p,r,predicate) => {
      for(let y=Math.floor((p.y-r)/size);y<=Math.floor((p.y+r)/size);y++) for(let x=Math.floor((p.x-r)/size);x<=Math.floor((p.x+r)/size);x++) {
        for(const s of bins.get(`${x},${y}`)||[]) if(distance2(p,s.a,s.b)<=r*r && predicate(s)) return true;
      }
      return false;
    };
  }
  function pathReason(tags,WG) {
    if(denied(tags) || tags.class==='pier' && !WG.isPublicPier(tags)) return R.ACCESS;
    return R.PATH;
  }
  function polygonReason(layer,tags,WG) {
    const c=tags.class,sub=tags.subclass, values=[c,sub,tags.leisure,tags.natural,tags.landuse];
    if(layer==='water'||layer==='building') return R.SURFACE;
    if(denied(tags)) return R.ACCESS;
    if(['parking','motorcycle_parking'].includes(c)||sub==='parking'||tags.amenity==='parking') return R.PARKING;
    if(layer==='transportation' && (['pedestrian','footway'].includes(c) || c==='path' && ['pedestrian','footway'].includes(sub))) return R.PLAZA;
    // Mirrors WorldGen's unexported PARK_FAMILY_LAYER_CLASS; generic
    // protected_area can cover whole districts and must not become a park.
    if(layer==='park' && ['park','nature_reserve','national_park'].includes(c)) return R.PARK;
    if(values.some(v=>CORE.has(v))) return R.PARK;
    if(values.some(v=>REC.has(v))) return R.REC;
    if(['golf_course','allotments','wetland','cemetery','farmland','farmyard'].some(v=>values.includes(v))) return R.UNKNOWN;
    if(values.some(v=>NATURAL.has(v))) return R.NATURAL;
    if(['church','place_of_worship'].includes(c)||tags.amenity==='place_of_worship') return R.CHURCH;
    if(['commercial','retail'].includes(c)) return R.COMMERCIAL;
    return R.UNKNOWN;
  }
  function collect(world,raw,WG) {
    const entries=world.tiles||[], edge=(entries[0]?.cellsPerEdge||1)*WG.CELL_M, polygons=[], roads=[], paths=[], points=[], seen=new Set();
    const source=new Map((raw||[]).map(r=>[`${r.tx},${r.ty}`,r]));
    for(const e of entries) {
      const layers=e.layers||source.get(`${e.tx},${e.ty}`)?.layers||[];
      for(const layer of layers) {
        const extent=layer.extent||4096, convert=p=>({x:(e.tx+p.x/extent)*edge,y:(e.ty+p.y/extent)*edge});
        const addLine=(geom,tags,parking=false) => {
          if(NONROAD.has(tags.class)) return;
          const isPath=WG.PATH_CLASSES.has(tags.class)||WG.classifyLine('transportation',tags)===WG.T.PIER, reason=pathReason(tags,WG);
          for(const line of geom||[]) {
            if(line.length<2) continue;
            const pts=line.map(convert), forward=pts.map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';'),reverse=[...pts].reverse().map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';');
            const geometryKey=forward<reverse?forward:reverse;
            const tagKey=JSON.stringify(Object.keys(tags).sort().map(key=>[key,tags[key]]));
            const key=`${parking?'parking':'road'}|${tagKey}|${geometryKey}`;
            if(seen.has(key)) continue;seen.add(key);
            const item={pts,tags,parking,isPath,reason,geometryKey,bounds:box(pts),segments:[]};
            for(let i=1;i<pts.length;i++) item.segments.push({a:pts[i-1],b:pts[i],item});
            (isPath&&!parking?paths:roads).push(item);
          }
        };
        for(const f of layer.features||[]) {
          const tags=f.tags||{};
          if(f.type===3) {
            const reason=polygonReason(layer.name,tags,WG);if(!reason) continue;
            const rings=(f.geom||[]).map(r=>r.map(convert));
            polygons.push({rings,reason,tags,layer:layer.name,bounds:box(rings.flat()),entry:e});
          } else if(f.type===2 && layer.name==='transportation') addLine(f.geom,tags);
          else if(f.type===1 && layer.name==='poi' && ['church','place_of_worship','fuel'].includes(tags.class)) {
            for(const g of f.geom||[]) for(const p of g) points.push({p:convert(p),tags,reason:tags.class==='fuel'?R.COMMERCIAL:R.CHURCH});
          }
        }
        if(layer.name==='transportation') for(const lane of layer.parkingLanes||[]) addLine(lane.lines,lane.f?.tags||{class:'service'},true);
      }
    }
    const segments=roads.flatMap(r=>r.segments), nearRoad=segmentIndex(segments,35), nearPath=segmentIndex(paths.filter(p=>p.reason===R.PATH).flatMap(p=>p.segments),35);
    const loaded=new Set(entries.map(e=>`${e.tx},${e.ty}`));
    const interior=p=>[[0,0],[2,0],[-2,0],[0,2],[0,-2]].every(([dx,dy])=>loaded.has(`${Math.floor((p.x+dx)/edge)},${Math.floor((p.y+dy)/edge)}`));
    for(const road of roads) {
      // A clipped endpoint is unknown, never evidence of a cul-de-sac. Only
      // a true dangling end connected to another way, or explicit noexit,
      // makes a residential line a dead-end candidate.
      const first=road.pts[0],last=road.pts[road.pts.length-1];
      const connected=p=>nearRoad(p,1,s=>s.item.geometryKey!==road.geometryKey);
      road.dead=smallRoad(road.tags,WG) && !road.parking && (road.tags.noexit==='yes'||road.tags.noexit===true ||
        (interior(first)&&!connected(first)&&connected(last)) || (interior(last)&&!connected(last)&&connected(first)));
    }
    return {edge,polygons,roads,paths,points,nearPath,junctions:findJunctions(roads,WG)};
  }
  // Source lines include the MVT tile buffer, so intersection disks cross seams.
  // Grade-separated crossings and pieces of one source way are not junctions.
  function findJunctions(roads,WG) {
    const segments=[],bins=new Map(),junctions=[],seen=new Set(),binSize=64;
    for(const road of roads) {
      const t=road.tags,type=WG.classifyLine('transportation',t);
      if(road.parking || t.service==='parking_aisle' || ![WG.T.ROAD,WG.T.ROAD_MD,WG.T.ROAD_LG].includes(type) ||
        ['bridge','tunnel','causeway'].includes(t.brunnel) || t.bridge==='yes' || t.tunnel==='yes') continue;
      for(const s of road.segments) segments.push({...s,width:WG.roadOverlayWidthM(t)});
    }
    for(let i=0;i<segments.length;i++) {
      const s=segments[i],b=box([s.a,s.b]),peers=new Set();
      const snap=WG.CELL_M/2;
      b[0]-=snap;b[1]-=snap;b[2]+=snap;b[3]+=snap;
      for(let y=Math.floor(b[1]/binSize);y<=Math.floor(b[3]/binSize);y++) for(let x=Math.floor(b[0]/binSize);x<=Math.floor(b[2]/binSize);x++) {
        const key=`${x},${y}`;
        for(const j of bins.get(key)||[]) peers.add(j);
        if(!bins.has(key)) bins.set(key,[]);bins.get(key).push(i);
      }
      for(const j of peers) {
        const t=segments[j];if(s.item===t.item || s.item.geometryKey===t.item.geometryKey) continue;
        const scaled=segment=>({ax:segment.a.x/WG.CELL_M,ay:segment.a.y/WG.CELL_M,
          bx:segment.b.x/WG.CELL_M,by:segment.b.y/WG.CELL_M});
        const meeting=WG.roadJunctionPoint(scaled(s),scaled(t));
        if(!meeting) continue;
        const p={x:meeting.x*WG.CELL_M,y:meeting.y*WG.CELL_M},key=`${p.x.toFixed(3)},${p.y.toFixed(3)}`;
        const radius=Math.max(s.width,t.width)/2+JUNCTION_BUFFER_CELLS*WG.CELL_M;
        if(seen.has(key)) { const prior=junctions.find(k=>k.key===key);prior.radius=Math.max(prior.radius,radius); }
        else {seen.add(key);junctions.push({p,radius,key});}
      }
    }
    return junctions;
  }
  const freshStats=()=>({cells:[0,0,0,0,0],ha:[0,0,0,0,0],byReason:REASONS.map(()=>0)});
  function* buildSteps(world,raw=[]) {
    const WG=root.WorldGen, data=collect(world,raw,WG), tiles=[],stats=freshStats();
    yield 'gameplay source geometry';
    for(const entry of world.tiles||[]) {
      const N=entry.cellsPerEdge,edge=data.edge,cell=edge/N,ox=entry.tx*edge,oy=entry.ty*edge;
      const bounds=[ox,oy,ox+edge,oy+edge],tiers=new Uint8Array(N*N),reasons=new Uint8Array(N*N), exclusions=new Uint8Array(N*N),buildingCells=new Uint8Array(N*N),publicPierCells=new Uint8Array(N*N);
      // Ground first; road corridors override land destinations, then core
      // path bands take precedence before source/access exclusions.
      const priority={0:0,5:1,6:2,7:3,1:4,2:4,3:5,11:6};
      let operations=0;
      for(const p of data.polygons) if(overlaps(p.bounds,bounds)) {
        polygonCells(p.rings,N,ox,oy,cell,i=>{
          if(p.layer==='building') buildingCells[i]=1;
          if(REASONS[p.reason].tier===4) exclusions[i]=Math.max(exclusions[i],p.reason);
          else if((priority[p.reason]||0)>(priority[reasons[i]]||0)) reasons[i]=p.reason;
        });
        if(++operations%20===0) yield 'gameplay polygons';
      }
      for(const p of data.points) if(p.p.x>=ox-2*cell&&p.p.x<=ox+edge+2*cell&&p.p.y>=oy-2*cell&&p.p.y<=oy+edge+2*cell) {
        // Point POIs establish only a small vicinity, not an invented site
        // boundary; existing frontage/private gates still apply below.
        stampSegment(p.p,p.p,cell*2,N,ox,oy,cell,i=>{if(!reasons[i]) reasons[i]=denied(p.tags)?R.ACCESS:p.reason;});
      }
      const pathCells=new Uint8Array(N*N);
      for(const path of data.paths) {
        const radius=path.reason===R.PATH ? WG.roadWidthM(path.tags)/2+PATH_BUFFER_CELLS*cell : Math.max(cell*.71,WG.roadWidthM(path.tags)/2);
        if(!overlaps(path.bounds,[ox-radius,oy-radius,ox+edge+radius,oy+edge+radius])) continue;
        if(path.tags.class==='pier' && path.reason===R.PATH) for(const s of path.segments)
          stampSegment(s.a,s.b,WG.roadWidthM(path.tags)/2,N,ox,oy,cell,i=>{publicPierCells[i]=1;});
        for(const s of path.segments) stampSegment(s.a,s.b,radius,N,ox,oy,cell,i=>{
          if(path.reason===R.ACCESS) exclusions[i]=R.ACCESS;
          else {pathCells[i]=1;reasons[i]=path.reason;}
        });
        if(++operations%20===0) yield 'gameplay paths';
      }
      const roadReason=new Uint8Array(N*N),roadPriority=new Uint8Array(N*N),streetSurface=new Uint8Array(N*N);
      for(const road of data.roads) {
        const surfaceRadius=WG.roadOverlayWidthM(road.tags)/2, radius=surfaceRadius+ROAD_BUFFER_CELLS*cell;
        if(!overlaps(road.bounds,[ox-radius,oy-radius,ox+edge+radius,oy+edge+radius])) continue;
        const type=WG.classifyLine('transportation',road.tags),major=type===WG.T.ROAD_MD||type===WG.T.ROAD_LG;
        const parking=road.parking||road.tags.service==='parking_aisle';
        const small=smallRoad(road.tags,WG);
        for(const s of road.segments) {
          if(!parking && (major || small)) stampSegment(s.a,s.b,surfaceRadius,N,ox,oy,cell,i=>{
            const reason=major?R.MAJOR_SURFACE:road.dead?R.DEADEND:R.SMALL;
            // A crossing belongs to the strongest street-surface restriction.
            if(reason===R.MAJOR_SURFACE || streetSurface[i]!==R.MAJOR_SURFACE &&
              (reason===R.DEADEND || !streetSurface[i])) streetSurface[i]=reason;
          });
          const dx=s.b.x-s.a.x,dy=s.b.y-s.a.y,len=Math.hypot(dx,dy),steps=Math.max(1,Math.ceil(len/(2*cell)));
          for(let step=0;step<steps;step++) {
            const a={x:s.a.x+dx*step/steps,y:s.a.y+dy*step/steps},b={x:s.a.x+dx*(step+1)/steps,y:s.a.y+dy*(step+1)/steps},mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
            const sidewalk=['both','left','right','yes','separate'].includes(road.tags.sidewalk);
            const parallel=sidewalk||data.nearPath(mid,radius,p=>{
              const px=p.b.x-p.a.x,py=p.b.y-p.a.y,pl=Math.hypot(px,py);
              return len>0&&pl>0&&Math.abs((dx*px+dy*py)/(len*pl))>.8;
            });
            const reason=parking?R.PARKING:major?R.MAJOR:road.dead?R.DEADEND:small?(parallel?R.SIDEPATH:R.SMALL):R.OTHER;
            const rank=parking?6:reason===R.MAJOR?5:reason===R.DEADEND?4:reason===R.OTHER?3:2;
            stampSegment(a,b,radius,N,ox,oy,cell,(i)=>{
              if(rank>roadPriority[i]) {roadPriority[i]=rank;roadReason[i]=reason;}
              if(denied(road.tags)) exclusions[i]=R.ACCESS;
            });
          }
        }
        if(++operations%20===0) yield 'gameplay road buffers';
      }
      const junctionCells=new Uint8Array(N*N);
      for(const junction of data.junctions) stampSegment(junction.p,junction.p,junction.radius,N,ox,oy,cell,i=>{junctionCells[i]=1;});
      const coverage=entry.zone?.coverage || entry.zone?.idx;
      const tileStats=freshStats(),realEdge=WG.tileEdgeMeters(WG.latOfRowCentre(entry.ty)),ha=(realEdge/N)**2/10000;
      const gateMask=(WG.SPAWN_WHY_LAND ?? WG.SPAWN_WHY_HARD)&~(WG.SPAWN_WHY.ROAD|WG.SPAWN_WHY.TERRAIN|WG.SPAWN_WHY.JUNCTION|WG.SPAWN_WHY.PRIVATE|WG.SPAWN_WHY.BEHIND_HOUSE);
      for(let i=0;i<reasons.length;i++) {
        const nexus=entry.zone?.anchors?.[coverage?.[i]-1]?.kind;
        const nexusReason=NEXUS_REASON[nexus];
        if(nexusReason && (reasons[i]!==R.PARKING || nexus==='stones' || nexus==='quarry')) reasons[i]=nexusReason;
        if(roadReason[i] && reasons[i]!==R.PARKING && !(nexus==='stones' && roadReason[i]===R.PARKING)) reasons[i]=roadReason[i];
        // Source-derived lots include point-only lots and inferred aisles.
        // An adjoining lot absorbed into Old Stones belongs to its calm nexus.
        if(entry.roadClass?.[i]&WG.ROAD_CLASS_LOT_BUFFER && nexus!=='stones') reasons[i]=R.PARKING;
        if(junctionCells[i]) reasons[i]=R.JUNCTION;
        if(pathCells[i]) reasons[i]=R.PATH;
        if(streetSurface[i]) reasons[i]=streetSurface[i];
        const gate=entry.spawnWhy?.[i]||0;
        // Explicit access/source exclusions retain authority. Old road and
        // private-frontage heuristics no longer veto positively classified
        // ground; absent qualifying geography already means Excluded.
        // A verified public pier is a mapped walkable deck above source water;
        // its narrow footprint can host spawns, but buildings/access still win.
        if(publicPierCells[i] && !buildingCells[i] && exclusions[i]===R.SURFACE) exclusions[i]=0;
        if(gate&gateMask) exclusions[i]=exclusions[i]||R.GATE;
        if(exclusions[i]) reasons[i]=exclusions[i];
        const reason=reasons[i],tier=REASONS[reason].tier;tiers[i]=tier;
        tileStats.cells[tier]++;tileStats.ha[tier]+=ha;tileStats.byReason[reason]+=ha;
      }
      for(let i=0;i<5;i++){stats.cells[i]+=tileStats.cells[i];stats.ha[i]+=tileStats.ha[i];}
      for(let i=0;i<REASONS.length;i++) stats.byReason[i]+=tileStats.byReason[i];
      tiles.push({entry,tiers,reasons,stats:tileStats});
      yield 'gameplay tier tile';
    }
    return {tiles,stats};
  }
  function build(world,raw) {const it=buildSteps(world,raw);let step;do{step=it.next();}while(!step.done);return step.value;}
  function* buildTileSteps(entry) {return (yield* buildSteps({tiles:[entry]})).tiles[0];}
  function buildTile(entry) {return build({tiles:[entry]}).tiles[0];}
  // Review consumes generated arrays, so loading more neighbours cannot change
  // a tile's spawn policy or its dead-end classification.
  function fromEntries(world) {
    const tiles=[],stats=freshStats(),WG=root.WorldGen;
    for(const entry of world.tiles||[]) {
      if(!entry.gameplayTiers || !entry.gameplayReasons) return null;
      const tileStats=freshStats(),ha=(WG.tileEdgeMeters(WG.latOfRowCentre(entry.ty))/entry.cellsPerEdge)**2/10000;
      for(let i=0;i<entry.gameplayTiers.length;i++) {
        const tier=entry.gameplayTiers[i],reason=entry.gameplayReasons[i];
        tileStats.cells[tier]++;tileStats.ha[tier]+=ha;tileStats.byReason[reason]+=ha;
      }
      for(let i=0;i<5;i++){stats.cells[i]+=tileStats.cells[i];stats.ha[i]+=tileStats.ha[i];}
      for(let i=0;i<REASONS.length;i++) stats.byReason[i]+=tileStats.byReason[i];
      tiles.push({entry,tiers:entry.gameplayTiers,reasons:entry.gameplayReasons,stats:tileStats});
    }
    return {tiles,stats};
  }
  root.GameplayTiers={TIERS,REASONS,R,CORE:CORE_TIER,CALM,PASSING,EXCLUDED,CLASS_TIERS,RECORD_CLASSES,allowed,classForRecord,
    ROAD_BUFFER_CELLS,PATH_BUFFER_CELLS,JUNCTION_BUFFER_CELLS,build,buildSteps,buildTile,buildTileSteps,fromEntries};
})(typeof window==='undefined'?globalThis:window);
