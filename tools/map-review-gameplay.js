// Review proposal only: source geometry and access evidence, never game paint
// or measured traffic. Does not alter generation, rewards, enemies or masks.
(function (root) {
  const TIERS = [
    { id: 0, label: 'Unclassified', color: '#86909c', description: 'No qualifying source geometry; access and traffic unknown.' },
    { id: 1, label: 'Tier 1 · core', color: '#21c8aa', description: 'Daily value, fast/ranged enemies and elites, butterflies, easily extracted resources.' },
    { id: 2, label: 'Tier 2 · calm', color: '#f4bf54', description: 'Slow, non-ranged enemies, pets and animals except butterflies, basic resources.' },
    { id: 3, label: 'Tier 3 · passing', color: '#e77d76', description: 'Occasional edge pickups, simple taps or passive walking; passive/static threats only.' },
    { id: 4, label: 'Excluded', color: '#69647c', description: 'Buildings, water, restricted/private or other existing access exclusions.' },
  ];
  const REASONS = [
    ['No qualifying mapped geometry', 0], ['Park / garden / beach', 1],
    ['Recreation ground', 1], ['Pedestrian / footway area', 1], ['Designated walking path', 1],
    ['Mapped grassland / woodland', 2], ['Public-facing commercial ground', 2],
    ['Church grounds / point vicinity', 2], ['Small road; through or connectivity unconfirmed', 2],
    ['Road with a mapped parallel path / sidewalk', 2], ['Path / core ground within road buffer', 2],
    ['Parking polygon / retained parking lane', 3], ['Residential dead end', 3],
    ['Major / medium road without mapped path', 3], ['Other vehicle road', 3],
    ['Building / water footprint', 4], ['Explicit access restriction', 4],
    ['Existing land/access exclusion', 4], ['Path use or vehicle access unconfirmed', 0],
  ].map(([label, tier], id) => ({ id, label, tier }));
  const R = { UNKNOWN:0, PARK:1, REC:2, PLAZA:3, PATH:4, NATURAL:5, COMMERCIAL:6,
    CHURCH:7, SMALL:8, SIDEPATH:9, BUFFER:10, PARKING:11, DEADEND:12,
    MAJOR:13, OTHER:14, SURFACE:15, ACCESS:16, GATE:17, UNCERTAIN_PATH:18 };
  const CORE = new Set(['park', 'garden', 'beach', 'dog_park']);
  const REC = new Set(['recreation_ground', 'sports_centre', 'sports', 'pitch', 'playground', 'stadium']);
  const NATURAL = new Set(['wood', 'woodland', 'forest', 'grass', 'grassland', 'meadow', 'heath']);
  const NONROAD = new Set(['rail', 'railway', 'transit', 'ferry', 'aerialway']);
  const SMALL = new Set(['minor', 'street', 'residential', 'living_street']);
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
  function pathReason(tags) {
    const c=tags.class==='path' && tags.subclass ? tags.subclass : tags.class,sub=tags.subclass;
    if(denied(tags)) return R.ACCESS;
    // The game's PATH set also includes cycling and vehicle-capable tracks.
    // Those are not automatically evidence of a designated walking location.
    if(c==='platform') return R.UNCERTAIN_PATH;
    if(c==='cycleway' && !['yes','designated'].includes(tags.foot)) return R.UNCERTAIN_PATH;
    if(c==='track' && !['yes','designated'].includes(tags.foot)) return R.UNCERTAIN_PATH;
    if(['yes','designated'].includes(tags.motor_vehicle) || tags.motorcar==='yes') return R.UNCERTAIN_PATH;
    return sub==='crossing' || tags.footway==='crossing' ? R.BUFFER : R.PATH;
  }
  function polygonReason(layer,tags,WG) {
    const c=tags.class,sub=tags.subclass, values=[c,sub,tags.leisure,tags.natural,tags.landuse];
    if(layer==='water'||layer==='building') return R.SURFACE;
    if(denied(tags)) return R.ACCESS;
    if(c==='parking'||sub==='parking'||tags.amenity==='parking') return R.PARKING;
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
    const entries=world.tiles||[], edge=entries[0]?.tileEdgeM||1, polygons=[], roads=[], paths=[], points=[], seen=new Set();
    const source=new Map((raw||[]).map(r=>[`${r.tx},${r.ty}`,r]));
    for(const e of entries) {
      const layers=e.layers||source.get(`${e.tx},${e.ty}`)?.layers||[];
      for(const layer of layers) {
        const extent=layer.extent||4096, convert=p=>({x:(e.tx+p.x/extent)*edge,y:(e.ty+p.y/extent)*edge});
        const addLine=(geom,tags,parking=false) => {
          if(NONROAD.has(tags.class)) return;
          const isPath=WG.PATH_CLASSES.has(tags.class), reason=pathReason(tags);
          for(const line of geom||[]) {
            if(line.length<2) continue;
            const pts=line.map(convert), forward=pts.map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';'),reverse=[...pts].reverse().map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';');
            const key=`${parking?'parking':tags.class}|${forward<reverse?forward:reverse}`;
            if(seen.has(key)) continue;seen.add(key);
            const item={pts,tags,parking,isPath,reason,bounds:box(pts),segments:[]};
            for(let i=1;i<pts.length;i++) item.segments.push({a:pts[i-1],b:pts[i],item});
            (isPath&&!parking?paths:roads).push(item);
          }
        };
        for(const f of layer.features||[]) {
          const tags=f.tags||{};
          if(f.type===3) {
            const reason=polygonReason(layer.name,tags,WG);if(!reason) continue;
            const rings=(f.geom||[]).map(r=>r.map(convert));
            polygons.push({rings,reason,tags,bounds:box(rings.flat()),entry:e});
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
      const connected=p=>nearRoad(p,1,s=>s.item!==road);
      road.dead=SMALL.has(road.tags.class) && (road.tags.noexit==='yes'||road.tags.noexit===true ||
        (interior(first)&&!connected(first)&&connected(last)) || (interior(last)&&!connected(last)&&connected(first)));
    }
    return {edge,polygons,roads,paths,points,nearPath};
  }
  const freshStats=()=>({cells:[0,0,0,0,0],ha:[0,0,0,0,0],byReason:REASONS.map(()=>0)});
  function* buildSteps(world,raw=[]) {
    const WG=root.WorldGen, data=collect(world,raw,WG), tiles=[],stats=freshStats();
    yield 'gameplay source geometry';
    for(const entry of world.tiles||[]) {
      const N=entry.cellsPerEdge,edge=data.edge,cell=edge/N,ox=entry.tx*edge,oy=entry.ty*edge;
      const bounds=[ox,oy,ox+edge,oy+edge],tiers=new Uint8Array(N*N),reasons=new Uint8Array(N*N), exclusions=new Uint8Array(N*N);
      // Ground first, core above natural ground; roads deliberately override
      // land destinations where their three-cell corridors overlap.
      const priority={0:0,5:1,6:2,7:3,1:4,2:4,3:5,11:6};
      let operations=0;
      for(const p of data.polygons) if(overlaps(p.bounds,bounds)) {
        polygonCells(p.rings,N,ox,oy,cell,i=>{
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
      for(const path of data.paths) if(overlaps(path.bounds,[ox-cell,oy-cell,ox+edge+cell,oy+edge+cell])) {
        const radius=Math.max(cell*.71,WG.roadWidthM(path.tags)/2);
        for(const s of path.segments) stampSegment(s.a,s.b,radius,N,ox,oy,cell,i=>{
          if(path.reason===R.ACCESS) exclusions[i]=R.ACCESS;
          else if(reasons[i]!==R.PARKING) {pathCells[i]=1;reasons[i]=path.reason;}
        });
        if(++operations%20===0) yield 'gameplay paths';
      }
      const roadReason=new Uint8Array(N*N),roadPriority=new Uint8Array(N*N);
      for(const road of data.roads) {
        const radius=WG.roadOverlayWidthM(road.tags)/2+3*cell;
        if(!overlaps(road.bounds,[ox-radius,oy-radius,ox+edge+radius,oy+edge+radius])) continue;
        const type=WG.classifyLine('transportation',road.tags),major=type===WG.T.ROAD_MD||type===WG.T.ROAD_LG;
        const parking=road.parking||road.tags.service==='parking_aisle';
        const small=SMALL.has(road.tags.class);
        for(const s of road.segments) {
          const dx=s.b.x-s.a.x,dy=s.b.y-s.a.y,len=Math.hypot(dx,dy),steps=Math.max(1,Math.ceil(len/(2*cell)));
          for(let step=0;step<steps;step++) {
            const a={x:s.a.x+dx*step/steps,y:s.a.y+dy*step/steps},b={x:s.a.x+dx*(step+1)/steps,y:s.a.y+dy*(step+1)/steps},mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
            const sidewalk=['both','left','right','yes','separate'].includes(road.tags.sidewalk);
            const parallel=sidewalk||data.nearPath(mid,radius,p=>{
              const px=p.b.x-p.a.x,py=p.b.y-p.a.y,pl=Math.hypot(px,py);
              return len>0&&pl>0&&Math.abs((dx*px+dy*py)/(len*pl))>.8;
            });
            const reason=parking?R.PARKING:parallel?R.SIDEPATH:road.dead?R.DEADEND:major?R.MAJOR:small?R.SMALL:R.OTHER;
            const rank=parking?6:reason===R.MAJOR?5:reason===R.DEADEND?4:reason===R.OTHER?3:2;
            stampSegment(a,b,radius,N,ox,oy,cell,(i)=>{
              if(rank>roadPriority[i]) {roadPriority[i]=rank;roadReason[i]=reason;}
              if(denied(road.tags)) exclusions[i]=R.ACCESS;
            });
          }
        }
        if(++operations%20===0) yield 'gameplay road buffers';
      }
      const tileStats=freshStats(),realEdge=WG.tileEdgeMeters(WG.latOfRowCentre(entry.ty)),ha=(realEdge/N)**2/10000;
      const gateMask=WG.SPAWN_WHY_LAND ?? (WG.SPAWN_WHY_HARD&~(WG.SPAWN_WHY.ROAD|WG.SPAWN_WHY.TERRAIN));
      for(let i=0;i<reasons.length;i++) {
        if(roadReason[i] && reasons[i]!==R.PARKING) reasons[i]=pathCells[i] && roadReason[i]!==R.PARKING?R.BUFFER:roadReason[i];
        const gate=entry.spawnWhy?.[i]||0;
        // ROAD/KERB are evidence we are displaying, not exclusion reasons.
        // Terrain paint may be fictional lava/water, so only source footprints
        // exclude water/buildings here; access reasons retain their authority.
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
  root.GameplayTiers={TIERS,REASONS,build,buildSteps};
})(typeof window==='undefined'?globalThis:window);
