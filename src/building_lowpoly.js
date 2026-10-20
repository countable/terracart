// Retained, textured architecture. Only camera projection changes on rotation.
// Roofs use authored planes clipped to the exact footprint, not a sampled grid.
(function (global) {
  // One storey is 24 facade texels; FLOOR_HEIGHT/DETAIL_SCALE must stay 24 so
  // the sheet's beams, sills and door land on the geometry's floors. Both were
  // halved together (31.2/1.3 -> 15.6/.65) when buildings read twice too tall:
  // doors and windows shrink with the storey, so the facade keeps its scale.
  const FLOOR_HEIGHT=15.6, DETAIL_SCALE=.65, EAVE_RISE=2.5, ROOF_OVERHANG=5;
  // Legacy facade bays are 39 texels wide: alternate windows, door in bay 6.
  // Corner cuts sample a plain neighbour. Restored kits retain those splits
  // but fit complete opening bays to side walls in add(), keeping vertices
  // and roof UVs identical while replacing the blank corner samples.
  const BAY=39,DOOR_CENTRE=253.5,PLAIN_CENTRE=60.5;
  const wallStart=(span,entrance)=>entrance?DOOR_CENTRE-span/2:PLAIN_CENTRE+2*BAY*Math.ceil((span/2-PLAIN_CENTRE)/(2*BAY))-span/2;
  const bayAt=t=>Math.floor((t-2)/BAY),windowBay=k=>((k%2)+2)%2===0;
  function cornerBays(polys,[lo,hi],cut){
    const k0=bayAt(lo+1e-6),k1=bayAt(hi-1e-6),shift=(poly,d)=>poly.map(p=>({...p,tu:p.tu+d}));
    const cutLeft=lo>2+BAY*k0+1,cutRight=hi<2+BAY*k1+BAY-1;
    if(k0===k1)return windowBay(k0)&&(cutLeft||cutRight)?polys.map(p=>shift(p,BAY)):polys;
    const split=(polys,bound,side)=>polys.flatMap(poly=>{const l=cut(poly,'tu',bound,-1),r=cut(poly,'tu',bound,1);
      return [l.length>=3?(side<0?shift(l,BAY):l):null,r.length>=3?(side>0?shift(r,-BAY):r):null].filter(Boolean);});
    if(windowBay(k0)&&cutLeft)polys=split(polys,2+BAY*(k0+1),-1);
    if(windowBay(k1)&&cutRight)polys=split(polys,2+BAY*k1,1);
    return polys;
  }
  // The billboard look (docs/art/lowpoly-building-styles.md): every number
  // the ink pass, projection and dressing share, so sprites and meshes keep
  // agreeing. tools/building-billboard-preview.html edits this table live.
  // restoredRoles lists the RESTORED_ROLES whose look is live; null makes all of them live.
  const LOOK={heightScale:1,inkPx:1,wallThickness:2.8,ink:0x2a2229,textured:true,facade:'cel',facadeVariant:'A',restoredRoles:['relic'],eaveBand:4.5,eaveShade:.5,flatRim:1.75,flatShade:4.5,sheet:768,
    chimney:{radius:4.4,cap:5.8,mouth:3.4,above:6.5,rise:3.5,capHeight:1.1,sides:0xd9c9b8,capColor:0x9c8f84,mouthColor:0x2a2229},
    wreck:{tint:0xb3a89e,roofTint:0xffffff,debris:0x8f857a,beam:0x7d8b95,top:0xaa9b88,highlight:0xc2b29a,shadow:0x8c7d6b,mortar:0xaa9b88,ink:0x625b55}};
  // The light of a wreck's inner wall faces and rubble floor: the middle cel step.
  const WRECK_INSIDE_LIGHT=.7;
  const mix=(a,b,t)=>{const c=i=>Math.round(((a>>i)&255)*(1-t)+((b>>i)&255)*t);return (c(16)<<16)|(c(8)<<8)|c(0);};
  const hash=(x,y)=>{let h=(x*374761393+y*668265263)|0;h=(h^(h>>>13))*1274126177;return ((h^(h>>>16))>>>0)/4294967296;};
  // Cell order of assets/Objects/BuildingMaterials/reference-materials-v3.png.
  const MATERIAL_TILE=96,MATERIAL_CELLS=['clay','slate','thatch','shingle','glazed','plaster','boards','rubble','brick','clapboard','flagstone','moss'];
  const ROLES={
    plain:{window:'casement',material:'plaster',finish:'cottage',roofMaterial:'clay',stories:1,style:'multistorey'},
    // Home — the player's house (building_overlay.js drawHome): one storey of
    // plaster under a clay ridge, and the one role with an `interior` recipe.
    home:{window:'casement',material:'plaster',finish:'cottage',roofMaterial:'clay',stories:1,style:'multistorey',variant:'ridge'},
    blacksmith:{window:'woodShutters',material:'stone',finish:'workshop',roofMaterial:'slate',stories:1,style:'brick',smoke:true,chimneyFlare:1.12},
    trader:{window:'slateShutters',material:'plaster',finish:'plaster',roofMaterial:'flat',stories:2,style:'multistorey',terraced:true},
    shop:{window:'shop',material:'plaster',finish:'plaster',roofMaterial:'flat',stories:2,style:'multistorey',terraced:true},
    seed:{window:'shop',material:'plaster',finish:'plaster',roofMaterial:'thatch',stories:1,style:'adobe'},
    supply:{window:'shop',material:'timber',finish:'siding',roofMaterial:'flat',stories:2,style:'whitewash',variant:'flat'},
    potion:{window:'shop',material:'plaster',finish:'plaster',roofMaterial:'clay',stories:2,style:'pyramid',variant:'inset'},
    relic:{window:'shop',material:'timber',finish:'masonry',roofMaterial:'redtile',stories:1,style:'pyramid',variant:'inset'},
    pet:{window:'shop',material:'timber',finish:'siding',roofMaterial:'thatch',stories:1,style:'japanese'},
    book:{window:'shop',material:'brick',finish:'masonry',roofMaterial:'clay',stories:2,style:'japanese'},
    wizard:{window:'arched',material:'stone',finish:'tower',roofMaterial:'copper',stories:4,style:'pyramid',shape:'wizard'},
    turret:{window:'casement',material:'stone',finish:'tower',roofMaterial:'slate',stories:1,style:'fort',shape:'turret'},
    wreck:{window:'casement',material:'timber',finish:'cottage',roofMaterial:'slate',stories:1,style:'ruin',shape:'wreck'},
  };
  // Player restoration is an opt-in from the overlay's existing claim predicate.
  // Keep ROLES intact for unowned buildings, special silhouettes and old viewers.
  // Shared commerce joinery repeats the roof colour in the wall canopy. The
  // smithy takes the generated grey stone: the pack's straight masonry is lilac.
  const RESTORED_HOUSE={material:'plaster',wallCell:'whitePlaster',finish:'cottage',
    facadeKit:'house',braces:true,chimneyFinish:'wall',
    window:'porthole',framing:'darkTimber',facadeTrim:'brass',body:0xeeeee4,
    roof:0xb97542,trim:0xb98546,roofMaterial:'copper',variant:'ridge',terraced:false};
  const RESTORED_SHOP={...RESTORED_HOUSE,wallCell:'orangeBrick',upperWallCell:'whitePlaster',shopWalls:'brickWhite',body:0xd8c5a0,
    facadeKit:'shop',braces:false,window:'brassShop',shopfront:true,awning:true};
  const RESTORED_ROLES={
    plain:{...RESTORED_HOUSE},home:{...RESTORED_HOUSE},
    blacksmith:{...RESTORED_HOUSE,material:'stone',wallCell:'smithStone',finish:'workshop',
      facadeKit:'smith',facadeVariant:'B',braces:false,emblem:'cog',chimneyFinish:'wall',
      body:0x85888a,roof:0x526b7b,roofMaterial:'blueSlate'},
    shop:{...RESTORED_SHOP,emblem:'shop',roof:0x526b7b,roofMaterial:'blueSlate'},
    trader:{...RESTORED_SHOP,emblem:'trader',roof:0x668f80,roofMaterial:'verdigris'},
    supply:{...RESTORED_SHOP,emblem:'supply',roof:0x668f80,roofMaterial:'verdigris'},
    seed:{...RESTORED_SHOP,emblem:'seed',roof:0x93966b,roofMaterial:'strawGreen'},
    pet:{...RESTORED_SHOP,emblem:'pet',roof:0x93966b,roofMaterial:'strawGreen'},
    potion:{...RESTORED_SHOP,emblem:'potion',roof:0x806288,roofMaterial:'violet'},
    relic:{...RESTORED_SHOP,emblem:'relic',roof:0xa04f3f,roofMaterial:'red'},
    book:{...RESTORED_SHOP,emblem:'book',roof:0x754958,roofMaterial:'plum'},
  };
  function recipeFor(role,palette={},stories,restored=false){
    const spec=ROLES[role]||ROLES.plain,base=BuildingStyles.STYLES[spec.style];
    const recipe={...spec,role,body:palette.wall??base.wall,roof:palette.roof??base.roof,
      trim:palette.trim??0x614534,stories:stories||spec.stories};
    if(role==='wreck'){const char=(c,k)=>((Math.round((c>>16)*k)<<16)|(Math.round(((c>>8)&255)*k)<<8)|Math.round((c&255)*k));recipe.body=char(recipe.body,.65);recipe.roof=char(recipe.roof,.82);}
    if(restored&&RESTORED_ROLES[role]&&(!LOOK.restoredRoles||LOOK.restoredRoles.includes(role)))Object.assign(recipe,RESTORED_ROLES[role]);
    return recipe;
  }
  const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  function triangulate(input) {
    const ring=input.map(p=>({...p}));
    if(ring.reduce((s,p,i)=>s+p.x*ring[(i+1)%ring.length].y-p.y*ring[(i+1)%ring.length].x,0)<0)ring.reverse();
    PolygonGeometry.removeCollinear(ring);
    return {ring,triangles:PolygonGeometry.triangulate(ring)};
  }

  const value=(plane,p)=>plane.x*p.x+plane.y*p.y+plane.c;
  function clip(poly,plane){const out=[];for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=value(plane,a),db=value(plane,b);
    if(da>=-1e-8)out.push(a);
    if((da< -1e-8&&db>1e-8)||(da>1e-8&&db< -1e-8)){
      const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
    }
  }return out;}
  // Rim and shade bands of a flat deck, as trim faces flagged for add() to
  // colour from the recipe. Both inset rings must keep the deck's vertex count.
  // Boundary loops of coplanar triangles (edges used exactly once), wound for inset().
  function boundaryLoops(tris){
    const key=p=>p.x.toFixed(3)+','+p.y.toFixed(3),edges=new Map();
    for(const t of tris)for(let i=0;i<3;i++){const a=t[i],b=t[(i+1)%3],k=key(a)+'|'+key(b),rk=key(b)+'|'+key(a);
      if(edges.has(rk))edges.delete(rk);else edges.set(k,[a,b]);}
    const next=new Map();for(const [a,b] of edges.values())next.set(key(a),{a,b});
    const loops=[],used=new Set();
    for(const start of next.keys()){if(used.has(start))continue;const loop=[];let k=start;
      while(k&&!used.has(k)){used.add(k);const e=next.get(k);if(!e)break;loop.push({x:e.a.x,y:e.a.y});k=key(e.b);}
      if(loop.length>=3)loops.push(loop);}
    return loops;
  }
  function flatBands(ring,z,add,faces){
    if(typeof BuildingStyles==='undefined')return;
    // Terrace rings may run either way; inset() needs the triangulate() winding.
    if(ring.reduce((n,p,i)=>n+p.x*ring[(i+1)%ring.length].y-p.y*ring[(i+1)%ring.length].x,0)<0)ring=[...ring].reverse();
    const band=(outer,inner,flag,layer)=>outer.forEach((a,i)=>{const b=outer[(i+1)%outer.length],c=inner[(i+1)%inner.length],d=inner[i];
      for(const tri of [[a,b,c],[a,c,d]]){add(tri.map(p=>({x:p.x,y:p.y,z:z+.01,u:0,v:0})),'trim',1);Object.assign(faces.at(-1),{[flag]:true,layer,inkGroup:1});}});
    const rim=BuildingStyles.inset(ring,LOOK.flatRim),shade=rim&&BuildingStyles.inset(ring,LOOK.flatShade);
    if(rim&&rim.length===ring.length)band(ring,rim,'rim',z-.004);
    if(shade&&shade.length===ring.length)band(rim,shade,'rimShade',z-.005);
  }
  // `entrance`: the ring edge (triangulate's ring, the one streetDoor
  // indexes) whose facade centres the door bay — the street door's wall
  // (owner, Oct 2026: doors face the nearest street). Without one, the
  // longest wall lowest on screen takes the door, as before.
  function buildGeometry(input,variant='ridge',height=29,overhang=0,chimneys=null,entrance=null){
    const {ring,triangles}=triangulate(input);
    if(!triangles.length)return {ring,faces:[],roofTriangles:0,wallTriangles:0};
    // The longest facade defines a stable roof direction; camera heading never does.
    let edge=0,length=0;ring.forEach((p,i)=>{const q=ring[(i+1)%ring.length],d=Math.hypot(q.x-p.x,q.y-p.y);if(d>length){length=d;edge=i;}});
    const a=ring[edge],b=ring[(edge+1)%ring.length],ux=(b.x-a.x)/length,uy=(b.y-a.y)/length;
    // Reduce the offset around tiny returns rather than bridging a notch.
    let roofRing=ring,actualOverhang=0;
    if(overhang&&variant!=='flat'&&typeof BuildingStyles!=='undefined'){
      for(let d=overhang;d>=.25;d/=2){const expanded=BuildingStyles.inset(ring,-d);
        if(expanded){roofRing=expanded;actualOverhang=d;break;}
      }
    }
    const roofTris=triangulate(roofRing).triangles;
    const axes=[{x:ux,y:uy},{x:-uy,y:ux}],bounds=axes.map(v=>{
      const values=roofRing.map(p=>p.x*v.x+p.y*v.y);return [Math.min(...values),Math.max(...values)];
    });
    const planes=[],pitch=variant==='shallow'?.18:.42;
    const addAxis=i=>{const v=axes[i],[lo,hi]=bounds[i];planes.push({x:v.x*pitch,y:v.y*pitch,c:-lo*pitch},{x:-v.x*pitch,y:-v.y*pitch,c:hi*pitch});};
    if(variant!=='flat'){addAxis(1);if(variant==='inset')addAxis(0);}
    planes.push({x:0,y:0,c:variant==='flat'?0:variant==='inset'?4:variant==='shallow'?2.5:14});
    const roofZ=p=>height+Math.max(0,Math.min(...planes.map(v=>value(v,p))));
    // Continuous distance across ridge slopes and their flat cap: per-plane
    // scaling used to jump the tile rows at the slope/cap seam.
    const roofV=p=>{
      const t=-p.x*uy+p.y*ux-bounds[1][0];
      if(variant!=='ridge'&&variant!=='shallow')return t;
      const width=bounds[1][1]-bounds[1][0],run=Math.min(width/2,planes.at(-1).c/pitch),flat=width-2*run;
      return Math.min(t,run)*Math.hypot(1,pitch)+Math.max(0,Math.min(t-run,flat))+Math.max(0,t-run-flat)*Math.hypot(1,pitch);
    };
    const faces=[];
    const add=(points,kind,light=1)=>{if(Math.abs(cross(...points))<1e-8&&kind==='roof')return;faces.push({points,kind,light,layer:kind==='roof'?2:kind==='trim'?1:0});};
    const planePolys=[];
    for(const tri of roofTris)for(let i=0;i<planes.length;i++){
      let poly=tri;for(let j=0;j<planes.length&&poly.length;j++)if(i!==j){const p=planes[i],q=planes[j];poly=clip(poly,{x:q.x-p.x,y:q.y-p.y,c:q.c-p.c});}
      if(poly.length<3)continue;
      planePolys.push({i,poly});
      const light=Math.max(.48,Math.min(1,.80-planes[i].x*.65-planes[i].y*.80));
      // An inset roof's flat top is a plain cap over its tiled skirt (the shop
      // awning look): solid colour, its own ink group, rim bands below.
      const flatCap=variant==='inset'&&i===planes.length-1;
      // Every slope is tiled from its own eave: u runs along the eave and v
      // grows downhill, so the sheet's course bottoms face the ground on all
      // faces at every heading (ridge and hip beams cover the seams). A
      // ridge's flat cap continues its first slope's mapping without a seam.
      let uv=p=>({u:p.x*ux+p.y*uy-bounds[0][0],v:roofV(p)});
      const slope=i<planes.length-1?i:flatCap?-1:0;
      if(slope>=0){const n={x:planes[slope].x/pitch,y:planes[slope].y/pitch},t={x:-n.y,y:n.x},rise=Math.hypot(1,pitch);
        const hi=Math.max(...roofRing.map(p=>p.x*n.x+p.y*n.y)),ulo=Math.min(...roofRing.map(p=>p.x*t.x+p.y*t.y));
        uv=p=>({u:p.x*t.x+p.y*t.y-ulo,v:(hi-p.x*n.x-p.y*n.y)*rise});}
      for(let j=1;j<poly.length-1;j++){add([poly[0],poly[j],poly[j+1]].map(p=>({...p,z:roofZ(p),...uv(p)})),'roof',flatCap?1:light);
        if(flatCap)Object.assign(faces.at(-1),{solid:true,tileCap:true,inkGroup:1,layer:2.2});}
    }
    if(variant==='inset'){const cap=faces.filter(f=>f.solid);
      for(const loop of boundaryLoops(cap.map(f=>f.points)))flatBands(loop,height+planes.at(-1).c,add,faces);}
    const roofTriangles=faces.length;
    let entranceEdge=entrance!=null&&entrance>=0&&entrance<ring.length?entrance:edge;
    if(entrance==null)ring.forEach((p,i)=>{const q=ring[(i+1)%ring.length],a=ring[entranceEdge],b=ring[(entranceEdge+1)%ring.length];
      if(Math.hypot(q.x-p.x,q.y-p.y)>=length-.001&&p.y+q.y>a.y+b.y)entranceEdge=i;
    });
    // Keep only cuts where the active roof slope actually changes. Pairwise
    // plane intersections hidden above the roof need no wall/fascia vertices.
    function roofCuts(a,b){
      const cuts=[0,1];
      for(let j=0;j<planes.length;j++)for(let k=j+1;k<planes.length;k++){
        const da=value(planes[j],a)-value(planes[k],a),db=value(planes[j],b)-value(planes[k],b),t=da/(da-db);
        if(t>1e-7&&t<1-1e-7)cuts.push(t);
      }
      cuts.sort((a,b)=>a-b);
      const unique=cuts.filter((t,i)=>!i||t-cuts[i-1]>1e-7);
      const z=t=>roofZ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
      return unique.filter((t,i)=>!i||i===unique.length-1||
        Math.abs((z(t)-z(unique[i-1]))/(t-unique[i-1])-(z(unique[i+1])-z(t))/(unique[i+1]-t))>1e-5);
    }
    ring.forEach((a,i)=>{const b=ring[(i+1)%ring.length],cuts=roofCuts(a,b),length=Math.hypot(b.x-a.x,b.y-a.y);
      // Fixed density, centered entrance. Triangulate the entire wall silhouette
      // so a gable needs three triangles rather than two separate quads.
      const span=length/DETAIL_SCALE,start=wallStart(span,i===entranceEdge);
      const outline=[{x:0,y:0},{x:length,y:0},...cuts.slice().reverse().map(t=>({x:t*length,y:roofZ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t})}))];
      for(const tri of triangulate(outline).triangles){add(tri.map(p=>({
        x:a.x+(b.x-a.x)*p.x/length,y:a.y+(b.y-a.y)*p.x/length,z:p.y,
        u:start+p.x/DETAIL_SCALE,v:height+28-p.y
      })),'wall');Object.assign(faces.at(-1),{wallDirection:{x:b.x-a.x,y:b.y-a.y},wallSpan:[start,start+span]});}
    });
    // A flat roof is one colour with a lighter rim and a darker band inside
    // it (the parapet's shadow); the ink outline marks the wall top. No lip.
    if(variant==='flat'){
      for(const f of faces)if(f.kind==='roof'){f.solid=true;f.light=1;f.inkGroup=1;}
      flatBands(ring,height,add,faces);
    }
    const wallTriangles=faces.length-roofTriangles;
    // A shallow vertical fascia gives the overhang a readable dark silhouette.
    // Only real slope changes split it, and it samples the existing solid texel.
    if(actualOverhang)roofRing.forEach((a,i)=>{
      const b=roofRing[(i+1)%roofRing.length],cuts=roofCuts(a,b);
      for(let j=1;j<cuts.length;j++){
        const p=t=>{const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;return {x,y,z:roofZ({x,y}),u:0,v:0};};
        const up=p(cuts[j-1]),uq=p(cuts[j]),lo={...up,z:up.z-2.8},hi={...uq,z:uq.z-2.8};
        add([lo,hi,uq],'trim',.6);add([lo,uq,up],'trim',.6);
      }
    });
    // Timber caps where two roof planes meet: ridges, hips and valleys.
    // Pieces from separate roof triangles merge into one beam per line.
    const lines=new Map();
    for(const {i,poly} of planePolys)poly.forEach((a,k)=>{const b=poly[(k+1)%poly.length];
      if(Math.hypot(b.x-a.x,b.y-a.y)<1)return;
      for(let j=0;j<planes.length;j++)if(j!==i&&[a,b].every(p=>Math.abs(value(planes[i],p)-value(planes[j],p))<1e-6)
        &&roofZ({x:(a.x+b.x)/2,y:(a.y+b.y)/2})-height>.5){
        const key=Math.min(i,j)+':'+Math.max(i,j);if(!lines.has(key))lines.set(key,{o:a,d:{x:b.x-a.x,y:b.y-a.y},spans:[]});
        const line=lines.get(key),len=Math.hypot(line.d.x,line.d.y),t=p=>((p.x-line.o.x)*line.d.x+(p.y-line.o.y)*line.d.y)/len;
        line.spans.push([Math.min(t(a),t(b)),Math.max(t(a),t(b))]);
      }
    });
    const beam=(quad,light)=>{for(const tri of [[quad[0],quad[1],quad[2]],[quad[0],quad[2],quad[3]],[quad[2],quad[1],quad[0]],[quad[3],quad[2],quad[0]]]){
      add(tri.map(p=>({...p,u:0,v:0})),'trim',light);Object.assign(faces.at(-1),{layer:2.5,beam:true});}};
    let chimneyAt=null,chimneyLength=0,chimneyLine=null;const chimneyMouths=[];
    for(const line of lines.values()){
      const len=Math.hypot(line.d.x,line.d.y),dx=line.d.x/len,dy=line.d.y/len,merged=[];
      for(const span of line.spans.sort((a,b)=>a[0]-b[0]))if(merged.length&&span[0]<=merged.at(-1)[1]+1e-6)merged.at(-1)[1]=Math.max(merged.at(-1)[1],span[1]);else merged.push([...span]);
      for(const [t0,t1] of merged){
        const at=(t,side)=>{const x=line.o.x+dx*t-dy*side*1.6,y=line.o.y+dy*t+dx*side*1.6;return {x,y,z:roofZ({x,y})+(side?0:1)};};
        beam([at(t0,-1),at(t1,-1),at(t1,0),at(t0,0)],1);beam([at(t0,0),at(t1,0),at(t1,1),at(t0,1)],.6);
        // The chimney rises through the longest level ridge.
        const level=Math.abs(at(t0,0).z-at(t1,0).z)<1e-3;
        if(level&&t1-t0>chimneyLength&&(variant==='ridge'||variant==='shallow')){chimneyLength=t1-t0;chimneyAt=at(t0+(t1-t0)*.28,0);chimneyLine={at,t0,t1};}
      }
    }
    if(chimneyAt&&chimneyLength>24){
      // A cobbled stack with a wider cap and a dark mouth. Sides are walls
      // with raw UVs into the sheet's stone plinth rows (tv 105..128); the
      // stack is its own ink group so the outline runs where it meets tiles.
      const count=chimneys?.count||1,scale=chimneys?.scale||1,C=LOOK.chimney;
      const stack=(c,column)=>{
        const corners=rr=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sy])=>({x:c.x+(ux*sx-uy*sy)*rr,y:c.y+(uy*sx+ux*sy)*rr}));
        const top=c.z+C.above+C.rise*scale,capZ=top-C.capHeight*scale,body=corners((chimneys?.flare?C.cap*chimneys.flare:C.radius)*scale),lo=Math.min(...body.map(roofZ))-1;
        const box=(ring,z0,z1,kind,color,layer,textured,upper=ring)=>ring.forEach((a,k)=>{const b=ring[(k+1)%4];
          const uv=p=>textured?{u:4+column*40+k*10+Math.hypot(p.x-a.x,p.y-a.y)/DETAIL_SCALE,v:105+(z1-p.z)/DETAIL_SCALE}:{u:0,v:0};
          for(const tri of [[{...a,z:z0},{...b,z:z0},{...upper[(k+1)%4],z:z1}],[{...a,z:z0},{...upper[(k+1)%4],z:z1},{...upper[k],z:z1}]]){
            add(tri.map(p=>({...p,...uv(p)})),kind,1);Object.assign(faces.at(-1),{color,wallDirection:{x:b.x-a.x,y:b.y-a.y},layer,chimney:true,inkGroup:2,rawUV:textured||undefined});}});
        box(body,lo,capZ,'wall',C.sides,2.6,true,chimneys?.flare?corners(C.cap*scale):body);
        const cap=corners(C.cap*scale);box(cap,capZ,top,'trim',C.capColor,2.62,false);
        for(const tri of [[0,1,2],[0,2,3]]){add(tri.map(k=>({...cap[k],z:top,u:0,v:0})),'trim',1);Object.assign(faces.at(-1),{color:C.capColor,layer:2.7,chimney:true,inkGroup:2});}
        const mouth=corners(C.mouth*scale);
        for(const tri of [[0,1,2],[0,2,3]]){add(tri.map(k=>({...mouth[k],z:top+.01,u:0,v:0})),'trim',1);Object.assign(faces.at(-1),{color:C.mouthColor,layer:2.71,chimney:true,inkGroup:2});}
        chimneyMouths.push({x:c.x,y:c.y,z:top});
      };
      (count>1?[.26,.74]:[.28]).forEach((t,i)=>stack(chimneyLine.at(chimneyLine.t0+(chimneyLine.t1-chimneyLine.t0)*t,0),i));
    }
    return {ring,roofRing,actualOverhang,faces,roofTriangles,wallTriangles,trimTriangles:faces.length-roofTriangles-wallTriangles,height,roofZ,ridge:{x:ux,y:uy},chimneyMouths,entranceEdge};
  }
  const meshCache=new Map();
  function geometry(input,variant='ridge',height=29,overhang=0,chimneys=null,entrance=null){
    const key=variant+':'+height+':'+overhang+':'+(chimneys?chimneys.count+'x'+chimneys.scale+'x'+(chimneys.flare||0):'')+':'+(entrance??'')+':'+input.map(p=>p.x.toFixed(4)+','+p.y.toFixed(4)).join(';');
    if(meshCache.has(key))return meshCache.get(key);
    const mesh=buildGeometry(input,variant,height,overhang,chimneys,entrance);
    if(meshCache.size>=96)meshCache.delete(meshCache.keys().next().value);
    meshCache.set(key,mesh);return mesh;
  }
  // THE ROOM. A building's geometry with its roof off, for the player's house
  // while they stand inside it (recipe.interior): every wall cut level at the
  // eaves (z ≤ height) — a gable end stops where its neighbours do — the inner
  // face of every wall, wound to face into the room so the far walls show
  // where the outer faces are culled, and a band across the wall tops between
  // the two, which is the walls' thickness seen from above. No trim, no
  // chimney, no beams: nothing stands above the eaves. The inner faces wear
  // a shared interior sheet with the exterior opening UVs.
  function interiorGeometry(base,thickness){
    const key='interior:'+thickness+':'+JSON.stringify(base.faces);
    if(meshCache.has(key))return meshCache.get(key);
    const H=base.height,ring=base.ring,faces=[];
    // THE WALL EACH FACE STANDS ON (`edge`: the ring edge's index). Inside
    // Home the player walks among the walls, so `add` raises each wall as a
    // render object of its own and the shared world sort (render.js
    // sortWorldDepth, via worldPieces) seats the player between the wall
    // behind and the wall in front. One mesh per house would put the whole
    // room before or behind the player at once.
    // Use the whole triangle: its only ground vertex may be a corner shared
    // by two walls, which can assign half of a styled wall to its neighbour.
    const edgeOf=(pts)=>{
      const m={x:pts.reduce((t,p)=>t+p.x,0)/pts.length,y:pts.reduce((t,p)=>t+p.y,0)/pts.length};
      let best=0,bestD=Infinity;ring.forEach((a,i)=>{const b=ring[(i+1)%ring.length],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy||1;
        const t=Math.max(0,Math.min(1,((m.x-a.x)*dx+(m.y-a.y)*dy)/l2)),d=Math.hypot(m.x-(a.x+dx*t),m.y-(a.y+dy*t));
        if(d<bestD){bestD=d;best=i;}});return best;};
    const cutZ=(poly,bound)=>{const out=[];poly.forEach((a,i)=>{const b=poly[(i+1)%poly.length],da=bound-a.z,db=bound-b.z;
      if(da>=-1e-8)out.push(a);
      if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db),p={};for(const k of ['x','y','z','u','v'])p[k]=a[k]+(b[k]-a[k])*t;out.push(p);}});return out;};
    // Put the entire thickness outside the playable footprint. Preserve the
    // original edge parameter and UVs on both sides, including entrance bays.
    const outer=typeof BuildingStyles!=='undefined'?BuildingStyles.inset(ring,-thickness):null;
    const shell=outer||ring;
    for(const f of base.faces){
      if(f.kind!=='wall'||f.chimney)continue;
      const poly=cutZ(f.points,H),edge=edgeOf(f.points),a=ring[edge],b=ring[(edge+1)%ring.length];
      const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy||1;
      const move=p=>{const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/len2;
        return {...p,x:shell[edge].x+(shell[(edge+1)%ring.length].x-shell[edge].x)*t,
          y:shell[edge].y+(shell[(edge+1)%ring.length].y-shell[edge].y)*t};};
      for(let i=1;i<poly.length-1;i++){
        const tri=[poly[0],poly[i],poly[i+1]];
        const along=p=>((p.x-a.x)*dx+(p.y-a.y)*dy)/Math.sqrt(len2);
        if(Math.abs((along(tri[1])-along(tri[0]))*(tri[2].z-tri[0].z)-(along(tri[2])-along(tri[0]))*(tri[1].z-tri[0].z))<1e-8)continue;
        faces.push({...f,points:tri.map(move),edge});
        faces.push({...f,points:[...tri].reverse(),interior:true,edge,wallDirection:{x:-dx,y:-dy}});
      }
    }
    if(outer)ring.forEach((d,i)=>{const c=ring[(i+1)%ring.length],a=outer[i],b=outer[(i+1)%ring.length];
      const length=Math.hypot(c.x-d.x,c.y-d.y);
      // A timber strip in the shared interior atlas wraps over the cut edge.
      const top=[{...a,u:0,v:112},{...b,u:Math.min(507,length/DETAIL_SCALE),v:112},
        {...c,u:Math.min(507,length/DETAIL_SCALE),v:116},{...d,u:0,v:116}];
      for(const tri of [[top[0],top[1],top[2]],[top[0],top[2],top[3]]])
        faces.push({points:tri.map(p=>({...p,z:H})),kind:'trim',rawUV:true,light:1,layer:1,wallTop:true,edge:i});
    });
    const mesh={...base,faces,roofTriangles:0,wallTriangles:faces.filter(f=>f.kind==='wall').length,trimTriangles:faces.filter(f=>f.kind==='trim').length,interior:true,
      edges:ring.map((a,i)=>({a,b:ring[(i+1)%ring.length],index:i}))};
    if(meshCache.size>=96)meshCache.delete(meshCache.keys().next().value);
    meshCache.set(key,mesh);return mesh;
  }
  // Use the imported style silhouettes, but omit their geometric surface marks.
  // Adjacent parapet segments share interior walls; cancel those before submission.
  function styleGeometry(points,styleId,recipe){
    // A tiny notch must not collapse every roof band into a broad trim cap.
    if((styleId==='pyramid'||styleId==='japanese')&&!BuildingStyles.inset(points,3))
      return geometry(points,styleId==='pyramid'?'inset':'ridge',recipe.stories*FLOOR_HEIGHT+EAVE_RISE);
    const base=BuildingStyles.STYLES[styleId]||BuildingStyles.STYLES.adobe;
    const scale=styleId==='ruin'?.75:(recipe.stories*FLOOR_HEIGHT+EAVE_RISE)/(base.height*recipe.stories);
    const cacheKey='style:'+styleId+':'+scale+':'+JSON.stringify(recipe)+':'+points.map(p=>p.x.toFixed(4)+','+p.y.toFixed(4)).join(';');
    if(meshCache.has(cacheKey))return meshCache.get(cacheKey);
    const model=BuildingStyles.build(points,styleId,{geometryOnly:true,scale,stories:recipe.stories,upperSetback:recipe.terraced?24:undefined,palette:{wall:recipe.body,roof:recipe.roof,trim:recipe.trim}});
    const faces=[],quads=new Map();
    const add=(p,kind,color,layer,extra)=>{
      const [a,b,c]=p,ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,len=Math.hypot(nx,ny,nz);
      if(len<1e-8)return;
      const light=kind==='wall'?1:Math.max(.63,Math.min(1,.90+(nx*.25+ny*.35)/len));
      if(kind==='roof'){
        // Project onto the actual slope, not its foreshortened ground footprint.
        const horizontal=Math.hypot(nx,ny);
        p=p.map(v=>({...v,u:horizontal>1e-8?(-ny*v.x+nx*v.y)/horizontal:v.x,
          v:horizontal>1e-8?(nx*nz*v.x+ny*nz*v.y-horizontal*horizontal*v.z)/(horizontal*len):v.y}));
      }
      faces.push({points:p,kind,light,color,layer:layer+(kind==='wall'?0.001:0),...extra});
    };
    // A flat deck keeps no parapet: its wall prisms go, and so does the cap that
    // sat on the parapet when a real deck lies just below it. The lower storey's
    // deck IS its parapet top (the storey walls are not capped), so caps stay
    // unless another cap level lies within 3.5 units beneath them.
    const flat=recipe.roofMaterial==='flat',capLevels=[...new Set(model.prisms.filter(p=>p.capped).map(p=>+p.top.toFixed(3)))].sort((a,b)=>a-b);
    const dropCaps=new Set(capLevels.filter((l,i)=>i&&l-capLevels[i-1]<3.5));
    for(const prism of model.prisms){
      const ring=prism.points,upper=prism.topPoints||ring;
      const trim=prism.colors.top===recipe.trim;
      if(flat&&trim&&prism.top-prism.bottom>1e-6)continue;
      if(flat&&prism.capped&&dropCaps.has(+prism.top.toFixed(3)))continue;
      for(let i=0;i<ring.length;i++){
        const j=(i+1)%ring.length,a=ring[i],b=ring[j],c=upper[j],d=upper[i],length=Math.hypot(b.x-a.x,b.y-a.y);
        const slope=!!prism.topPoints,kind=trim?'trim':slope?'roof':'wall';
        const span=length/DETAIL_SCALE,start=wallStart(span,false);
        const p=[{...a,z:prism.bottom,u:start},{...b,z:prism.bottom,u:start+span},{...c,z:prism.top,u:start+span},{...d,z:prism.top,u:start}];
        p.forEach(v=>{v.v=105-v.z;if(slope){v.u=v.x;v.v=v.y;}});
        const key=p.map(v=>[v.x,v.y,v.z].map(n=>n.toFixed(5)).join(',')).sort().join(';');
        if(quads.has(key))quads.set(key,null);else quads.set(key,{p,kind,color:trim?recipe.trim:null,layer:prism.bottom,extra:kind==='wall'?{wallSpan:[start,start+span]}:undefined});
      }
      if(prism.capped){for(const tri of triangulate(upper).triangles){
        const kind=trim&&!recipe.terraced?'trim':'roof';
        // A terrace cap sorts below walls rising from the same height.
        add(tri.map(p=>({...p,z:prism.top,u:p.x,v:p.y})),kind,kind==='trim'?recipe.trim:null,prism.top-.01);
        if(kind==='roof'&&recipe.roofMaterial==='flat')Object.assign(faces.at(-1),{solid:true,light:1,inkGroup:1});
      }
      }
    }
    for(const quad of quads.values())if(quad){const {p,kind,color,layer,extra}=quad;add([p[0],p[1],p[2]],kind,color,layer,extra);add([p[0],p[2],p[3]],kind,color,layer,extra);}
    // Slabs and material caps can emit the same top triangle twice. Keep one
    // surface; upper walls sit just after their supporting deck in painter order.
    const seenFaces=new Set();
    for(let i=faces.length-1;i>=0;i--){
      const f=faces[i],key=f.kind+':'+f.points.map(p=>[p.x,p.y,p.z].map(n=>n.toFixed(6)).join(',')).sort().join(';');
      if(seenFaces.has(key))faces.splice(i,1);else seenFaces.add(key);
    }
    // Flat decks dress like flat roofs. Prisms are convex pieces, so the rim
    // follows each deck's boundary loop; bands sort after the cap and before
    // the upper storey's walls, which start at prism.top+.001.
    if(recipe.roofMaterial==='flat'){
      const decks=new Map();
      for(const f of faces)if(f.kind==='roof'&&f.solid){const z=f.points[0].z.toFixed(3);(decks.get(z)||decks.set(z,[]).get(z)).push(f);}
      for(const deck of decks.values())for(const loop of boundaryLoops(deck.map(f=>f.points)))
        flatBands(loop,deck[0].points[0].z,(pts,kind)=>faces.push({points:pts,kind,light:1,layer:0}),faces);
    }
    const roofPoints=faces.filter(f=>f.kind==='roof').flatMap(f=>f.points);
    const minU=Math.min(...roofPoints.map(p=>p.u)),minV=Math.min(...roofPoints.map(p=>p.v));
    for(const p of roofPoints){p.u-=minU;p.v-=minV;}
    const mesh={faces,ring:points,height:model.height,uvBaseline:true,roofTriangles:faces.filter(f=>f.kind!=='wall').length,wallTriangles:faces.filter(f=>f.kind==='wall').length};
    if(meshCache.size>=96)meshCache.delete(meshCache.keys().next().value);meshCache.set(cacheKey,mesh);return mesh;
  }
  // Compact special silhouettes are independent of the source footprint outline.
  // Player-restored wizard: fixed octagon, footprint plinth, street-facing door.
  function wizardGeometry(points,recipe,streets=[]){
    const {ring:foot,triangles}=triangulate(points);
    let area=0,cx=0,cy=0;
    foot.forEach((a,i)=>{const b=foot[(i+1)%foot.length],v=a.x*b.y-b.x*a.y;area+=v;cx+=(a.x+b.x)*v;cy+=(a.y+b.y)*v;});
    if(Math.abs(area)<1e-8)return {ring:foot,faces:[],height:0};
    cx/=3*area;cy/=3*area;
    const radius=21,base=3,stories=recipe.stories||4,h=base+stories*FLOOR_HEIGHT;
    const ring=Array.from({length:8},(_,i)=>({x:cx+radius*Math.cos(i*Math.PI/4+Math.PI/8),y:cy+radius*Math.sin(i*Math.PI/4+Math.PI/8)}));
    const door=streetDoor(ring,streets),entrance=door?door.edge:1;
    const key='wizard-v2:'+stories+':'+entrance+':'+foot.map(p=>p.x+','+p.y).join(';');
    if(meshCache.has(key))return meshCache.get(key);
    const faces=[],v=(p,z,u=0,v=0)=>({...p,z,u,v});
    const tri=(points,kind,layer,extra={})=>faces.push({points,kind,layer,light:1,...extra});
    const quad=(q,kind,layer,extra)=>{tri([q[0],q[1],q[2]],kind,layer,extra);tri([q[0],q[2],q[3]],kind,layer,extra);};
    // The low stone plinth keeps the source outline, including concave returns.
    for(const t of triangles)tri(t.map(p=>v(p,base)),'trim',-2,{color:0x887d69});
    foot.forEach((a,i)=>{const b=foot[(i+1)%foot.length];quad([v(a,0),v(b,0),v(b,base),v(a,base)],'trim',-3,{color:0x665e55,wallDirection:{x:b.x-a.x,y:b.y-a.y}});});
    ring.forEach((a,i)=>{const b=ring[(i+1)%8],dir={x:b.x-a.x,y:b.y-a.y};
      for(let f=0;f<stories;f++){
        const bay=f===0&&i===entrance?2:f===stories-1&&i===entrance?3:i%2===1?1:0,x=bay*32;
        const lo=base+f*FLOOR_HEIGHT,hi=lo+FLOOR_HEIGHT;
        quad([v(a,lo,x,24),v(b,lo,x+31,24),v(b,hi,x+31,0),v(a,hi,x,0)],'wall',f,{rawUV:true,wallDirection:dir});
      }
      // Broad copper collars, no miniature gears or geometry for masonry.
      for(let f=0;f<=stories;f++){
        const z=base+f*FLOOR_HEIGHT,aa={x:cx+(a.x-cx)*1.025,y:cy+(a.y-cy)*1.025},bb={x:cx+(b.x-cx)*1.025,y:cy+(b.y-cy)*1.025};
        quad([v(aa,z),v(bb,z),v(bb,z+2),v(aa,z+2)],'trim',stories+1,{color:0x9c5a35,wallDirection:dir});
      }
    });
    const outer=ring.map(p=>({x:cx+(p.x-cx)*1.06,y:cy+(p.y-cy)*1.06})),apex=h+26;
    outer.forEach((a,i)=>{const b=outer[(i+1)%8];tri([v(a,h+2,0,175),v(b,h+2,31,175),v({x:cx,y:cy},apex,15.5,128)],'roof',h+2,{rawUV:true,light:.82-.16*Math.cos((i+.5)*Math.PI/4)});});
    const tip=ring.map(p=>({x:cx+(p.x-cx)*.05,y:cy+(p.y-cy)*.05}));
    tip.forEach((a,i)=>{const b=tip[(i+1)%8],dir={x:b.x-a.x,y:b.y-a.y};quad([v(a,apex-1),v(b,apex-1),v(b,apex+2),v(a,apex+2)],'trim',apex,{color:0xc7a76c,wallDirection:dir});tri([v(a,apex+2),v(b,apex+2),v({x:cx,y:cy},apex+4)],'trim',apex+1,{color:0xc7a76c});});
    const mesh={ring,faces,height:apex+4,eaveHeight:h,uvBaseline:true,entrance,center:{x:cx,y:cy},
      roofTriangles:faces.filter(f=>f.kind==='roof').length,wallTriangles:faces.filter(f=>f.kind==='wall').length,trimTriangles:faces.filter(f=>f.kind==='trim').length};
    if(meshCache.size>=96)meshCache.delete(meshCache.keys().next().value);meshCache.set(key,mesh);return mesh;
  }
  // One shared pixel atlas: 32x24 face bays and a triangular standing-seam panel.
  function wizardSheet(scene,recipe){
    const key='lowpoly:wizard-v2:'+recipe.roof;
    if(scene.textures.exists(key))return scene.textures.get(key);
    const tex=scene.textures.createCanvas(key,512,512),c=tex.getContext();
    const px=(x,y,w,h,color)=>{c.fillStyle='#'+color.toString(16).padStart(6,'0');c.fillRect(x,y,w,h);};
    px(0,0,512,512,0xd2c09a);
    for(let bay=0;bay<4;bay++){
      const x=bay*32;px(x,0,32,24,0xd2c09a);
      for(let y=5;y<24;y+=6){px(x,y,32,1,0xb3a185);for(let j=(y%12===5?8:0);j<32;j+=16)px(x+j,y-5,1,5,0xb3a185);}
      px(x,0,32,2,0x9c5a35);px(x,2,32,1,0x6b3d2a);px(x,22,32,2,0x9c5a35);
      if(bay===1||bay===2){const bottom=bay===2?23:20;px(x+7,8,18,bottom-8,0x6b3d2a);px(x+10,4,12,4,0x6b3d2a);px(x+8,8,16,bottom-9,0xc7a76c);px(x+11,5,10,3,0xc7a76c);px(x+10,9,12,bottom-10,bay===2?0x594535:0x5f8a88);px(x+12,6,8,3,bay===2?0x594535:0x5f8a88);if(bay===1){px(x+15,6,2,bottom-6,0xc7a76c);px(x+10,13,12,1,0xc7a76c);px(x+11,7,2,5,0xb9d4c6);}else{px(x+16,9,1,bottom-9,0x392f32);px(x+19,16,2,2,0xe1c184);}}
      if(bay===3){px(x+12,7,8,12,0x79604a);px(x+10,9,12,8,0x79604a);px(x+12,8,8,10,0xc7a76c);px(x+11,10,10,6,0xc7a76c);px(x+13,10,6,6,0x526f70);px(x+13,10,2,3,0xc9c18f);}
    }
    px(0,128,32,48,recipe.roof);
    for(let y=128;y<176;y++){const d=(y-128)*15.5/47;px(Math.round(15.5-d),y,1,1,0x9b9769);px(Math.round(15.5+d),y,1,1,0x344e4b);}
    px(510,126,1,1,0xffffff);tex.refresh();tex.setFilter(Phaser.Textures.FilterMode.NEAREST);return tex;
  }
  function specialGeometry(points,recipe,streets=[]){
    if(recipe.shape==='wizard')return wizardGeometry(points,recipe,streets);
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
    const key='special:'+recipe.shape+':'+cx+':'+cy+(recipe.shape==='wreck'?':'+points.map(p=>p.x+','+p.y).join(';'):'');
    if(meshCache.has(key))return meshCache.get(key);
    if(recipe.shape==='wreck'){
      // Broken wall stubs surround an opaque bed of collapsed masonry. A torn
      // roof remnant survives at one end; its short rafter tails and nearby
      // chipped crowns remain at the original height. The broad breach sits
      // on a long exposed edge, with loose masonry spilling through it.
      // A few walls and roof remnants retain the original one-storey height.
      // Most of the shell is missing or collapsed into the footprint.
      const H=FLOOR_HEIGHT+EAVE_RISE,SECTION=16,base=geometry(points,'ridge',H,0),faces=[],W=LOOK.wreck;
      const xs2=points.map(p=>p.x),ys=points.map(p=>p.y),[xlo,xhi,ylo,yhi]=[Math.min(...xs2),Math.max(...xs2),Math.min(...ys),Math.max(...ys)];
      const ring=base.ring,inner=(typeof BuildingStyles!=='undefined'&&(BuildingStyles.inset(ring,4)||BuildingStyles.inset(ring,2)))||null;
      const tri=(pts,kind,extra)=>{faces.push({points:pts,kind,light:1,layer:0,...extra});return faces.at(-1);};
      const quad=(a,b,c,d,kind,extra)=>{tri([a,b,c],kind,extra);tri([a,c,d],kind,extra);};
      const wallUV=(p,offset,z)=>({...p,z,u:8+offset,v:8+(H-z)*1.5});
      // The surviving roof occupies one end, with continuous load-bearing walls.
      const roofAxis=Math.abs(base.ridge.x)>=Math.abs(base.ridge.y)?'x':'y';
      const sideAxis=roofAxis==='x'?'y':'x',lo=roofAxis==='x'?xlo:ylo,hi=roofAxis==='x'?xhi:yhi;
      const sideLo=sideAxis==='x'?xlo:ylo,sideHi=sideAxis==='x'?xhi:yhi;
      const roofEnd=lo+(hi-lo)*.65;
      // Remove one sloping side entirely. The opposite slope extends beyond
      // the short surviving cap, leaving just two attached roof planes.
      const roofPoint=([u,v])=>({[roofAxis]:lo+(hi-lo)*u,[sideAxis]:sideLo+(sideHi-sideLo)*v});
      const roofOutline=[[0,.34],[.30,.34],[.33,.62],[.65,.68],[.60,.92],[.45,1],[0,1]].map(roofPoint);
      const roofCuts=[[[0,.34],[.30,.34],[.33,.62],[.45,1],[0,1]],
        [[.33,.62],[.65,.68],[.60,.92],[.45,1]]].map(poly=>poly.map(roofPoint));
      const roofPatches=[{x0:xlo,x1:roofAxis==='x'?roofEnd:xhi,y0:ylo,y1:roofAxis==='y'?roofEnd:yhi}];
      const supports=p=>Math.min(p.o0[roofAxis],p.o1[roofAxis])<=lo+(hi-lo)*.34
        ||Math.min(p.o0[roofAxis],p.o1[roofAxis])<=roofEnd&&Math.max(p.o0[sideAxis],p.o1[sideAxis])>=sideHi-4;
      let gap=null;
      if(inner&&inner.length===ring.length){
        // Wall sections around the ring, each with its own broken height.
        const parts=[];
        ring.forEach((a,i)=>{const b=ring[(i+1)%ring.length],ai=inner[i],bi=inner[(i+1)%ring.length],len=Math.hypot(b.x-a.x,b.y-a.y);
          const count=Math.max(1,Math.round(len/SECTION)),dir={x:b.x-a.x,y:b.y-a.y};
          // Interior breaks cross the wall at right angles. Only the corners
          // retain the inset ring's mitres.
          const innerAt=t=>{
            if(t===0)return ai;if(t===1)return bi;
            const o={x:a.x+dir.x*t,y:a.y+dir.y*t},dx=bi.x-ai.x,dy=bi.y-ai.y;
            const u=((o.x-ai.x)*dx+(o.y-ai.y)*dy)/(dx*dx+dy*dy);
            return {x:ai.x+dx*u,y:ai.y+dy*u};
          };
          for(let k=0;k<count;k++){const t0=k/count,t1=(k+1)/count,r=hash(i*7+k,11);
            // Broad missing sections alternate with low stubs and tall remnants.
            parts.push({edge:i,len,dir,t0,t1,h:r<.38?0:H*(.25+.65*(r-.38)/.62),o0:{x:a.x+dir.x*t0,y:a.y+dir.y*t0},o1:{x:a.x+dir.x*t1,y:a.y+dir.y*t1},i0:innerAt(t0),i1:innerAt(t1)});}});
        const exposed=parts.filter(p=>!supports(p)),longest=(exposed.length?exposed:parts).reduce((a,b)=>b.len>a.len?b:a).edge,candidates=parts.filter(p=>p.edge===longest&&!supports(p)),span=candidates.length?candidates:parts.filter(p=>p.edge===longest);
        const start=Math.min(span.length-1,Math.floor(hash(longest,23)*Math.max(1,span.length-1))),gone=span[start],last=span[Math.min(start+1,span.length-1)];
        gone.h=0;last.h=0;gap={o0:gone.o0,o1:last.o1,i0:gone.i0,i1:last.i1};
        // Keep bearing piers under the remnant, with chunks lost from the
        // neighbouring crowns instead of an unbroken pristine eave line.
        for(const [k,p] of parts.entries())if(supports(p))p.h=H-(k%3===1?3+hash(k,61)*4:0);
        if(supports(gone))gap=null;
        const standing=parts.filter(p=>p.h>0);
        if(standing.length)standing.reduce((a,b)=>a.h>b.h?a:b).h=H;
        for(const p of parts)p.gone=p.h<.5;
        parts.forEach((p,k)=>{const {dir,len,t0,t1,h,o0,o1,i0,i1}=p;
          const next=parts[(k+1)%parts.length];
          // A fallen section leaves only its standing neighbour's end face.
          if(p.gone){if(next.h>.5){const e=[{...o1,z:0},{...i1,z:0},{...i1,z:next.h},{...o1,z:next.h}].map(v=>({...v,u:0,v:0}));
            quad(e[0],e[1],e[2],e[3],'trim',{color:W.top,layer:2.3,wallDirection:{x:i1.x-o1.x,y:i1.y-o1.y}});}return;}
          // Outer face (textured, lit by direction), inner face seen from inside, broken top.
          const u0=(len*t0*2)%384,u1=u0+len*(t1-t0)*2;
          quad(wallUV(o0,u0,0),wallUV(o1,u1,0),wallUV(o1,u1,h),wallUV(o0,u0,h),'wall',{wallDirection:dir,rawUV:true,wreckMasonry:true});
          // Dedicated masonry UVs keep the back faces textured without windows.
          const back=(p,t,z)=>({...p,z,u:8+u0+(u1-u0)*t,v:8+(H-z)*1.5});
          quad(back(i1,1,0),back(i0,0,0),back(i0,0,h),back(i1,1,h),'wall',{wallDirection:{x:-dir.x,y:-dir.y},interior:true,rawUV:true,light:WRECK_INSIDE_LIGHT});
          const top=[o0,o1,i1,i0].map(q=>({...q,z:h,u:0,v:0}));
          quad(top[0],top[1],top[2],top[3],'trim',{color:W.mortar,layer:2.4,wallTop:true});
          // Mortar bed with chipped brick crowns. Joints cross the full wall
          // thickness; small height and colour changes keep the broken edge rough.
          const bricks=Math.max(1,Math.round(len*(t1-t0)/7));
          const at=(t,d,z)=>{const outer={x:o0.x+(o1.x-o0.x)*t,y:o0.y+(o1.y-o0.y)*t},inner={x:i0.x+(i1.x-i0.x)*t,y:i0.y+(i1.y-i0.y)*t};
            return {x:outer.x+(inner.x-outer.x)*d,y:outer.y+(inner.y-outer.y)*d,z,u:0,v:0};};
          for(let j=0;j<bricks;j++){
            const n=hash(k*19+j,53),lo=(j+.15)/bricks,hi=(j+.82)/bricks,z=h+.16+n*.45;
            const crown=[at(lo,.03,z),at(hi,.03,z),at(hi-.09/bricks,.96,z),at(lo,.97,z)];
            const color=W.top;
            for(let t=1;t<crown.length-1;t++)tri([crown[0],crown[t],crown[t+1]],'trim',{color,layer:2.42,brokenBrick:true});
          }
          // The step up to a taller neighbour shows its end above this top.
          if(next.h-h>.5){const e=[{...o1,z:h},{...i1,z:h},{...i1,z:next.h},{...o1,z:next.h}].map(v=>({...v,u:0,v:0}));
            quad(e[0],e[1],e[2],e[3],'trim',{color:W.top,layer:2.3,wallDirection:{x:i1.x-o1.x,y:i1.y-o1.y}});}
          else if(h-next.h>.5){const e=[{...next.i0,z:next.h},{...next.o0,z:next.h},{...next.o0,z:h},{...next.i0,z:h}].map(v=>({...v,u:0,v:0}));
            quad(e[0],e[1],e[2],e[3],'trim',{color:W.top,layer:2.3,wallDirection:{x:next.o0.x-next.i0.x,y:next.o0.y-next.i0.y}});}
        });
      }else for(const f of base.faces.filter(f=>f.kind==='wall')){faces.push(f);faces.push({...f,interior:true,light:WRECK_INSIDE_LIGHT,points:[...f.points].reverse()});}
      // Clip the original roof planes and their UVs to the irregular remnant.
      const cut=(poly,axis,bound,side)=>{
        const out=[];poly.forEach((a,i)=>{const b=poly[(i+1)%poly.length],da=(a[axis]-bound)*side,db=(b[axis]-bound)*side;
          if(da>=-1e-8)out.push(a);
          if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db),p={};for(const k of ['x','y','z','u','v'])p[k]=a[k]+(b[k]-a[k])*t;out.push(p);}
        });return out;
      };
      const clipTriangle=(poly,a,b)=>{
        const out=[];poly.forEach((p,i)=>{const q=poly[(i+1)%poly.length],dp=cross(a,b,p),dq=cross(a,b,q);
          if(dp>=-1e-8)out.push(p);
          if((dp<0&&dq>0)||(dp>0&&dq<0)){const t=dp/(dp-dq),v={};for(const k of ['x','y','z','u','v'])v[k]=p[k]+(q[k]-p[k])*t;out.push(v);}});
        return out;
      };
      for(const f of base.faces.filter(f=>f.kind==='roof'))for(const outline of roofCuts){
        const clip=cross(...outline)>0?outline:[...outline].reverse();let poly=f.points;
        for(let i=0;i<clip.length&&poly.length;i++)poly=clipTriangle(poly,clip[i],clip[(i+1)%clip.length]);
        for(let i=1;i<poly.length-1;i++)if(Math.abs(cross(poly[0],poly[i],poly[i+1]))>1e-8)faces.push({...f,points:[poly[0],poly[i],poly[i+1]]});
      }
      // Ridge timber stops just past the short roof cap, never spanning the ruin.
      for(const f of base.faces.filter(f=>f.beam)){
        const poly=cut(f.points,roofAxis,lo+(hi-lo)*.34,-1);
        for(let i=1;i<poly.length-1;i++)faces.push({...f,color:W.beam,points:[poly[0],poly[i],poly[i+1]]});
      }
      // Rafters follow the roof underside, with short exposed tails at the eaves.
      const along=base.ridge,across={x:-along.y,y:along.x},inside=p=>{let hit=false;
        points.forEach((a,i)=>{const b=points[(i+1)%points.length];if((a.y>p.y)!==(b.y>p.y)&&p.x<a.x+(b.x-a.x)*(p.y-a.y)/(b.y-a.y))hit=!hit;});return hit;};
      const span=v=>points.map(p=>p.x*v.x+p.y*v.y),[clo,chi]=[Math.min(...span(across)),Math.max(...span(across))];
      // Three sloping rafters span the standing end and bear on its full-height walls.
      for(let k=1;k<=3;k++){const position=lo+(hi-lo)*(.075+k*.09),o=(position-across[roofAxis]*(clo+chi)/2)/along[roofAxis];let run=[];
        const flush=()=>{for(let i=1;i<run.length;i++){const a=run[i-1],b=run[i],w=1.1;
          let q=[{x:a.x-along.x*w,y:a.y-along.y*w,z:a.z},{x:b.x-along.x*w,y:b.y-along.y*w,z:b.z},{x:b.x+along.x*w,y:b.y+along.y*w,z:b.z},{x:a.x+along.x*w,y:a.y+along.y*w,z:a.z}].map(p=>({...p,u:0,v:0}));
          if(cross(q[0],q[1],q[2])<0)q=q.reverse();
          q=q.map((p,i)=>({...p,u:i===1||i===2?504:448,v:i<2?104:120}));
          for(const t of [[q[0],q[1],q[2]],[q[0],q[2],q[3]]])faces.push({points:t,kind:'trim',color:0xffffff,light:1,layer:1.9,rafter:true,steel:true,rawUV:true});}run=[];};
        for(let c=clo-3;c<=chi+3;c+=1){const p={x:along.x*o+across.x*c,y:along.y*o+across.y*c};
          const seat={x:along.x*o+across.x*Math.max(clo+.5,Math.min(chi-.5,c)),y:along.y*o+across.y*Math.max(clo+.5,Math.min(chi-.5,c))};
          if(inside(seat)&&p[roofAxis]<=roofEnd+4){p.z=base.roofZ(p)-.3;
            if(run.length>1){const q=run.at(-1),r=run.at(-2);if(Math.abs((q.z-r.z)-(p.z-q.z)*Math.hypot(q.x-r.x,q.y-r.y)/Math.hypot(p.x-q.x,p.y-q.y))<1e-6)run.pop();}
            run.push(p);}else flush();}
        flush();
      }
      // Generated board-and-stone scatter fills the footprint beneath fallen slabs.
      for(const t of triangulate(points).triangles)faces.push({kind:'roof',debris:true,layer:-1,color:0xffffff,light:1,rawUV:true,points:(cross(...t)<0?[...t].reverse():t).map(p=>({...p,z:0,u:1+(p.x-xlo)/Math.max(1,xhi-xlo)*382,v:129+(p.y-ylo)/Math.max(1,yhi-ylo)*382}))});
      const fallen=(k,kind,color,L,w,lift)=>{const n=hash(k,3),m=hash(k,5),x=xlo+8+(xhi-xlo-16)*n,y=ylo+8+(yhi-ylo-16)*m,a=n*Math.PI,dx=Math.cos(a),dy=Math.sin(a);
        let q=[{x:x-dy*w,y:y+dx*w,z:1},{x:x+dx*L-dy*w,y:y+dy*L+dx*w,z:1},{x:x+dx*L+dy*w,y:y+dy*L-dx*w,z:1+lift},{x:x+dy*w,y:y-dx*w,z:1+lift}];if(cross(q[0],q[1],q[2])<0)q=q.reverse();
        q=q.map((p,i)=>({...p,u:kind==='trim'?(i<2?448:504):(i<2?0:L),v:kind==='trim'?(i===1||i===2?120:104):(i===1||i===2?w*2:0)}));
        for(const t of [[q[0],q[1],q[2]],[q[0],q[2],q[3]]])faces.push({points:t,kind,color:kind==='trim'?0xffffff:color,light:1,layer:-.5,steel:kind==='trim',rawUV:kind==='trim'});};
      for(let k=0;k<7;k++)fallen(k,'roof',undefined,18+hash(k,3)*14,7,3+hash(k,7)*5);
      for(let k=3;k<6;k++)fallen(k,'trim',W.beam,14+hash(k,3)*10,1.4,0);
      // Chunks of fallen wall: low turned blocks with wall-top lids and end-face
      // sides. Several spill out through the gap; the rest lie inside along the
      // walls. Seeded by the footprint's centre so neighbouring wrecks differ.
      const seed=Math.round(cx)*31+Math.round(cy);
      const chunk=(k,x,y)=>{const n=hash(seed+k,29),m=hash(seed+k,31),a=n*Math.PI,dx=Math.cos(a),dy=Math.sin(a);
        const L=(3+3.5*m)/2,w=(2.2+2*n)/2,h=1.6+2.2*hash(seed+k,37);
        const base=[{x:x-dx*L+dy*w,y:y-dy*L-dx*w},{x:x+dx*L+dy*w,y:y+dy*L-dx*w},{x:x+dx*L-dy*w,y:y+dy*L+dx*w},{x:x-dx*L-dy*w,y:y-dy*L+dx*w}];
        const ccw=cross(base[0],base[1],base[2])>0,ring=ccw?base:[...base].reverse();
        ring.forEach((p,i)=>{const q=ring[(i+1)%4],e=[{...p,z:0},{...q,z:0},{...q,z:h},{...p,z:h}].map(v=>({...v,u:0,v:0}));
          // The outward normal of this side, whichever way the ring winds.
          const nx=ccw?q.y-p.y:p.y-q.y,ny=ccw?p.x-q.x:q.x-p.x;
          quad(e[0],e[1],e[2],e[3],'trim',{color:W.top,layer:-.4,rubble:true,wallDirection:{x:nx,y:ny}});});
        const lid=ring.map(p=>({...p,z:h,u:0,v:0}));quad(lid[0],lid[1],lid[2],lid[3],'trim',{layer:-.3,rubble:true,rubbleTop:true});
        const edge=(a,b,c,d,color)=>{const inset=(p,q)=>({...p,x:p.x+(q.x-p.x)*.14,y:p.y+(q.y-p.y)*.14,z:h+.01});
          quad(a,b,inset(b,c),inset(a,d),'trim',{color,layer:-.29,rubble:true});};
        edge(lid[0],lid[1],lid[2],lid[3],W.highlight);
        edge(lid[2],lid[3],lid[0],lid[1],W.shadow);};
      let chunks=0;
      if(gap){const mx=(gap.o0.x+gap.o1.x)/2,my=(gap.o0.y+gap.o1.y)/2,ox=mx-(gap.i0.x+gap.i1.x)/2,oy=my-(gap.i0.y+gap.i1.y)/2,ol=Math.hypot(ox,oy)||1;
        const tx=gap.o1.x-gap.o0.x,ty=gap.o1.y-gap.o0.y,tl=Math.hypot(tx,ty)||1;
        for(const [along,out] of [[-.36,5],[-.15,10],[.08,6],[.29,12],[.4,4]]){chunk(chunks++,mx+tx*along+ox/ol*out,my+ty*along+oy/ol*out);}}
      for(let k=0;k<20&&chunks<9;k++){const n=hash(seed+k,41),m=hash(seed+k,43);
        const x=xlo+6+(xhi-xlo-12)*n,y=ylo+6+(yhi-ylo-12)*m;
        if(inside({x,y})&&inside({x:x+4,y})&&inside({x:x-4,y})&&inside({x,y:y+4})&&inside({x,y:y-4}))chunk(chunks++,x,y);}
      const mesh={...base,faces,roofPatches,roofOutline,gap,roofTriangles:faces.filter(f=>f.kind==='roof').length,wallTriangles:faces.filter(f=>f.kind==='wall').length,trimTriangles:faces.filter(f=>f.kind==='trim').length,damaged:true};
      if(meshCache.size>=96)meshCache.delete(meshCache.keys().next().value);meshCache.set(key,mesh);return mesh;
    }
    const faces=[],wizard=recipe.shape==='wizard',radius=wizard?23:26,h=wizard?39:17;
    const push=(p,kind,layer=0,light=.8)=>faces.push({points:p,kind,layer,light});
    const ring=Array.from({length:wizard?8:4},(_,i)=>{const a=i*Math.PI*2/(wizard?8:4)+(wizard?Math.PI/8:Math.PI/4);return {x:cx+Math.cos(a)*radius,y:cy+Math.sin(a)*radius};});
    function prism(ring,lo,hi,kind='wall',capped=true){
      ring.forEach((a,i)=>{const b=ring[(i+1)%ring.length],len=Math.hypot(b.x-a.x,b.y-a.y)/DETAIL_SCALE;
        const p=[{...a,z:lo,u:14-len/2,v:105-lo},{...b,z:lo,u:14+len/2,v:105-lo},{...b,z:hi,u:14+len/2,v:105-hi},{...a,z:hi,u:14-len/2,v:105-hi}];
        push([p[0],p[1],p[2]],kind,lo);push([p[0],p[2],p[3]],kind,lo);
      });
      if(capped)for(const tri of triangulate(ring).triangles)push(tri.map(p=>({...p,z:hi,u:p.x-cx+radius,v:p.y-cy+radius})),'roof',hi);
    }
    prism(ring,0,h,'wall',!wizard);
    if(wizard){
      const outer=ring.map(p=>({x:cx+(p.x-cx)*1.23,y:cy+(p.y-cy)*1.23}));
      outer.forEach((a,i)=>{const b=outer[(i+1)%outer.length],width=Math.hypot(b.x-a.x,b.y-a.y);
        push([{...a,z:h,u:0,v:42},{...b,z:h,u:width,v:42},{x:cx,y:cy,z:h+21.5,u:width/2,v:0}],'roof',h+1,.8-(a.x-cx)/radius*.2);
      });
    }else{
      // Eight crenels, including the four corners, on a compact castle shell.
      const lo=cx-radius/Math.sqrt(2),top=cy-radius/Math.sqrt(2),side=radius*Math.sqrt(2),w=8;
      for(const [u,v] of [[0,0],[.5,0],[1,0],[1,.5],[1,1],[.5,1],[0,1],[0,.5]]){
        const x=lo+u*(side-w),y=top+v*(side-w);
        prism([{x,y},{x:x+w,y},{x:x+w,y:y+w},{x,y:y+w}],h,h+4,'trim');
      }
    }
    const mesh={ring,faces,height:h+(wizard?21.5:4),eaveHeight:h,uvBaseline:true,
      roofTriangles:faces.filter(f=>f.kind==='roof').length,wallTriangles:faces.filter(f=>f.kind==='wall').length,trimTriangles:faces.filter(f=>f.kind==='trim').length};
    if(meshCache.size>=96)meshCache.delete(meshCache.keys().next().value);meshCache.set(key,mesh);return mesh;
  }
  // Material sheets cut from the approved sheet, assets/Objects/BuildingMaterials/
  // approved-materials-v1.png (tools/build_approved_materials.py packs it from
  // the pixel tileset, the painterly sheet and the generated atlas), in the
  // exact layout atlasFaces expects: 512-basis ground line 105, 24-texel
  // floors, 39-texel bays, the door bay centred at 255.5, roof region from 128
  // with a 360 period. The sheet is LOOK.sheet pixels square; UVs are
  // normalised, so that number is texel density alone (768 puts one texel near
  // one art pixel). Rectangles are [x0,y0,x1,y1] in the approved sheet, as the
  // packer prints them; approved_materials.test.js keeps them inside it.
  const SHEET_SRC={
    walls:{plaster:{window:[2,2,107,82],plain:[109,2,239,77],door:[241,2,346,79]},
      timber:{window:[2,84,132,159],plain:[2,84,132,159],door:[134,84,239,161]},
      brick:{window:[2,163,102,240],plain:[104,163,234,238],door:[236,163,346,240],zoom:1.7},
      stone:{window:[2,242,92,322],plain:[94,242,204,317],door:[206,242,286,319]}},
    // Roofs: the approved set. Clay and thatch (atlas cells) take the role
    // colour by luminance like the generated sheets; slate is the pixel
    // tileset's, red tile the painterly sheet's; all nearest-sampled. Tile
    // sizes are 512-basis texels and divide 360.
    roofs:{clay:{rect:[2,324,98,420],tile:[120,120],tint:.7},thatch:{rect:[100,324,196,420],tile:[90,90],tint:.7},
      slate:{rect:[198,324,494,393],tile:[180,40]},redtile:{rect:[496,324,681,469],tile:[90,72]},
      copper:{rect:[2,471,98,567],tile:[90,90]},verdigris:{rect:[100,471,196,567],tile:[90,90]},
      blueSlate:{rect:[198,471,294,567],tile:[90,90]},violet:{rect:[296,471,392,567],tile:[90,90]},
      red:{rect:[394,471,490,567],tile:[90,90]},plum:{rect:[492,471,588,567],tile:[90,90]},
      strawGreen:{rect:[2,569,98,665],tile:[90,90]}},
    // Cel surface cells tile 1:1; the roof uses 96px cells and a 288px wrap.
    surfaces:{cream:[100,569,196,665],boards:[198,569,294,665],smithStone:[296,569,392,665],whitePlaster:[2,667,98,763],
      AwhitePlaster:[2, 801, 98, 897],
      AorangeBrick:[100, 801, 196, 897],
      Aboards:[198, 801, 294, 897],
      AsmithStone:[296, 801, 392, 897],
      BwhitePlaster:[2, 925, 98, 1021],
      BorangeBrick:[100, 925, 196, 1021],
      Bboards:[198, 925, 294, 1021],
      BsmithStone:[296, 925, 392, 1021]},
    parts:{houseDoor:[2,765,21,789],porthole:[23,765,37,779],shopDoor:[39,765,59,789],
      shopWindow:[61,765,135,780],smithDoor:[137,765,160,789],cog:[162,765,180,783],
      shop:[182,765,202,783],trader:[204,765,224,783],supply:[226,765,246,783],
      seed:[248,765,268,783],pet:[270,765,290,783],potion:[292,765,312,783],
      relic:[314,765,334,783],book:[336,765,356,783],timberWindow:[358,765,372,779],
      brassWindow:[374,765,390,781],awningblueSlate:[2,791,78,799],awningverdigris:[80,791,156,799],
      awningstrawGreen:[158,791,234,799],awningviolet:[236,791,312,799],
      awningred:[314,791,390,799],awningplum:[392,791,468,799],
      AhouseDoor:[2, 899, 21, 923],
      AshopDoor:[23, 899, 43, 923],
      AsmithDoor:[45, 899, 68, 923],
      AtimberWindow:[70, 899, 84, 913],
      AbrassWindow:[86, 899, 102, 915],
      AshopWindow:[104, 899, 178, 914],
      BhouseDoor:[2, 1023, 21, 1047],
      BshopDoor:[23, 1023, 43, 1047],
      BsmithDoor:[45, 1023, 68, 1047],
      BtimberWindow:[70, 1023, 84, 1037],
      BbrassWindow:[86, 1023, 102, 1039],
      BshopWindow:[104, 1023, 178, 1038]}};
  const SHEET_IMAGE='approved_materials_v1';
  // The pixel tileset leaves openings white (meant for transparency). Flood-fill
  // each white region: the ground-floor entrance bay becomes a plank door, the
  // rest lit glass with a lighter top-left pane; a wreck boards them over.
  function paintOpenings(ctx,w,h,wreck){
    const img=ctx.getImageData(0,0,w,h),d=img.data,seen=new Uint8Array(w*h);
    const white=i=>d[i*4]>225&&d[i*4+1]>225&&d[i*4+2]>225;
    const fill=(i,rgb)=>{d[i*4]=rgb>>16;d[i*4+1]=(rgb>>8)&255;d[i*4+2]=rgb&255;};
    for(let start=0;start<w*h;start++){
      if(seen[start]||!white(start))continue;
      const stack=[start],cells=[];seen[start]=1;
      while(stack.length){const i=stack.pop();cells.push(i);const x=i%w,y=(i-x)/w;
        for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){if(nx<0||ny<0||nx>=w||ny>=h)continue;const j=ny*w+nx;if(!seen[j]&&white(j)){seen[j]=1;stack.push(j);}}}
      let x0=w,x1=0,y0=h,y1=0;for(const i of cells){const x=i%w,y=(i-x)/w;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
      const bw=x1-x0+1,bh=y1-y0+1,K=w/512,cxm=(x0+x1)/2/K,cym=(y0+y1)/2/K,door=cxm>236&&cxm<275&&cym>81&&cym<105;
      for(const i of cells){const x=i%w,y=(i-x)/w,ry=(y-y0)/bh;
        if(door)fill(i,(x-x0)%Math.max(2,Math.round(bw/3))===0?0x4a3222:0x7a5236);
        else if(wreck){const plank=(ry>=.2&&ry<.42)||(ry>=.55&&ry<.77),edge=plank&&(ry<.24||ry>=.38&&ry<.42||ry<.59||ry>=.73);fill(i,plank?(edge?0x3b2a1f:0x6b4a33):0x1e1c1c);}
        else fill(i,x-x0<bw*.45&&y-y0<bh*.45?0xb5cde8:0x6f93c4);}
    }
    ctx.putImageData(img,0,0);
  }
  function tilesetSheet(scene,recipe){
    const wallId=SHEET_SRC.walls[recipe.material]?recipe.material:'plaster',roofId=SHEET_SRC.roofs[recipe.roofMaterial]?recipe.roofMaterial:'slate';
    // `blank` recipes (ramparts) take plain bays: no windows, no door.
    const roof=SHEET_SRC.roofs[roofId],wreck=recipe.shape==='wreck',S=LOOK.sheet,key='lowpoly:tileset-v2:'+wallId+':'+roofId+(roof.tint?':'+recipe.roof.toString(16):'')+':'+S+(wreck?':wreck':'')+(recipe.blank?':blank':'');
    if(scene.textures.exists(key))return scene.textures.get(key);
    const img=scene.textures.get(SHEET_IMAGE).getSourceImage();
    const K=S/512,tex=scene.textures.createCanvas(key,S,S),ctx=tex.getContext();
    tex.roofPeriod=360;
    const T=(x,y,w,h)=>[Math.round(x*K),Math.round(y*K),Math.round(w*K),Math.round(h*K)];
    // One bay: the crop's centre, zoomed in by `zoom` so its courses repeat larger.
    const bay=(spec,kind,bx,by)=>{
      const [dx,dy,dw,dh]=T(bx,by,39,24),r=spec[kind],z=spec.zoom||1,cw=(r[2]-r[0])/z,ch=(r[3]-r[1])/z;
      ctx.drawImage(img,(r[0]+r[2])/2-cw/2,(r[1]+r[3])/2-ch/2,cw,ch,dx,dy,dw,dh);
    };
    const wall=SHEET_SRC.walls[wallId];
    ctx.save();ctx.beginPath();ctx.rect(0,0,S,128*K);ctx.clip();ctx.imageSmoothingEnabled=false;
    for(let k=-1;k<=12;k++)bay(SHEET_SRC.walls.stone,'plain',2+39*k,105); // plinth; chimney sides sample it
    // Windows take every other bay, so the door (bay 6) sits between two plain
    // bays and facades keep some bare wall between openings.
    for(let floor=0;floor<3;floor++)for(let k=-1;k<=12;k++)bay(wall,recipe.blank||k%2?'plain':floor===0&&k===6?'door':'window',2+39*k,105-24*(floor+1));
    ctx.restore();
    paintOpenings(ctx,S,Math.round(128*K),wreck);
    const [tw,th]=roof.tile,[rx,ry,rw,rh]=[roof.rect[0],roof.rect[1],roof.rect[2]-roof.rect[0],roof.rect[3]-roof.rect[1]];
    ctx.save();ctx.beginPath();ctx.rect(0,128*K,S,S-128*K);ctx.clip();ctx.imageSmoothingEnabled=false;
    for(let y=128;y<512;y+=th)for(let x=0;x<512;x+=tw)ctx.drawImage(img,rx,ry,rw,rh,Math.round(x*K),Math.round(y*K),Math.ceil(tw*K),Math.ceil(th*K));
    ctx.restore();
    if(roof.tint){ // the role colour by luminance ratio, keeping the cell's own ramps
      const y0=Math.round(128*K),img=ctx.getImageData(0,y0,S,S-y0),d=img.data,base=recipe.roof,t=roof.tint;
      let average=0;for(let i=0;i<d.length;i+=4)average+=d[i]*.299+d[i+1]*.587+d[i+2]*.114;average/=d.length/4;
      for(let i=0;i<d.length;i+=4){const f=Math.max(.25,Math.min(1.8,(d[i]*.299+d[i+1]*.587+d[i+2]*.114)/Math.max(1,average)));
        for(let c=0;c<3;c++){const b=(base>>(16-c*8))&255,tinted=f<=1?b*f:b+(255-b)*(f-1)*.7;d[i+c]=Math.min(255,Math.round(d[i+c]*(1-t)+tinted*t));}}
      ctx.putImageData(img,0,y0);
    }
    if(wreck){ // soot under every floor beam, moss at the footing, missing tiles
      for(let floor=0;floor<3;floor++){const y=105-24*(floor+1);
        for(let x=-37;x<512;x+=7){const n=hash(x,floor);if(n<.35)continue;ctx.fillStyle=`rgba(20,16,14,${.35+n*.3})`;ctx.fillRect(...T(x,y,7,3+n*4));}}
      for(let x=-37;x<512;x+=5){const n=hash(x,9);if(n<.4)continue;ctx.fillStyle='rgba(74,96,52,.75)';ctx.fillRect(...T(x,103-n*2,5,2+n*2));}
      for(let y=130;y<512;y+=31)for(let x=3;x<512;x+=47){const n=hash(x,y);if(n<.55)continue;ctx.fillStyle='#262120';ctx.fillRect(...T(x+n*20,y+n*9,6+n*4,4+n*3));}
    }
    ctx.fillStyle='#ffffff';ctx.fillRect(Math.floor(508*K),Math.floor(124*K),Math.ceil(4*K),Math.ceil(4*K)); // shared solid texel
    // The roof's mean tone: an untextured cap over a tiled skirt takes it.
    {const d=ctx.getImageData(0,Math.round(200*K),S,Math.round(100*K)).data;let r=0,g=0,b=0,n=0;
      for(let i=0;i<d.length;i+=16){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}tex.roofTone=(Math.round(r/n)<<16)|(Math.round(g/n)<<8)|Math.round(b/n);}
    tex.refresh();tex.setFilter(Phaser.Textures.FilterMode.NEAREST);return tex;
  }
  // The cel sheet: pixel joinery over procedural or packed restoration cells.
  // LOOK.facade='cel' selects it. Legacy materials use a three-tone ramp
  // (shade, base, light) around the role colour plus one shared ink colour,
  // the restraint of the supply crate (assets/Objects/Approved/box.png) in
  // the colours of the approved house sprites (assets/Objects/Approved/
  // house*.png): plum-brown ink and shadows, red-brown door and frame wood,
  // cream highlights, teal glass. One-texel outlines, a single highlight
  // pixel per feature; openings keep the tileset's scale and bay placement,
  // with only a lintel, sill, step and lantern as decoration.
  // Layout is the shared 512-basis facade
  // (ground line 105, 24-texel floors, 39-texel bays, door bay centred at
  // 253.5, roof rows from 128 with a 288 fallback period). Restored side-wall
  // UVs fit whole opening bays; the entrance and roof retain their alignment.
  const CEL={ink:0x32131e,shadow:0x4a2123,plum:0x4a2123,mauve:0x7a4d54,cream:0xf8dfcb,
    wood:{dark:0x4a2123,mid:0x7e210d,base:0x954a39,light:0xb45c3a,bright:0xc87139},
    glass:{dark:0x185969,base:0x1fc6af,light:0x9ff0e0},flame:0xf2c76a};
  // Only restored kits choose PP variants. The recipe override also lets proof
  // fixtures compare A/B without changing global state or duplicating geometry.
  function facadeMaterials(recipe){
    const variant=recipe.facadeKit?((recipe.facadeVariant??LOOK.facadeVariant)==='B'?'B':'A'):'';
    const plank=recipe.facadeKit==='shop'&&recipe.shopWalls==='plank';
    return {variant,wall:plank?'boards':recipe.wallCell,upper:plank?'boards':recipe.upperWallCell};
  }
  function celSheet(scene,recipe){
    const facade=facadeMaterials(recipe);
    const wreck=recipe.shape==='wreck',packed=!!recipe.wallCell&&tilesetReady(scene),key='lowpoly:cel-v8:'+JSON.stringify([recipe.material,recipe.body,recipe.trim,recipe.roof,recipe.roofMaterial,recipe.finish,recipe.window,recipe.role==='blacksmith',wreck,!!recipe.blank,recipe.facadeTrim,recipe.framing,!!recipe.shopfront,recipe.wallCell,packed,recipe.facadeKit,!!recipe.braces,recipe.emblem,recipe.chimneyFinish,!!recipe.awning,facade.variant,facade.wall,facade.upper]);
    if(scene.textures.exists(key))return scene.textures.get(key);
    const tex=scene.textures.createCanvas(key,512,512),ctx=tex.getContext();
    const css=c=>'#'+c.toString(16).padStart(6,'0');
    const px=(x,y,w,h,c)=>{ctx.fillStyle=css(c);ctx.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));};
    // Three-tone cel ramp: shade leans to the crate's blue-violet, light to warm cream.
    const ramp=c=>({shade:mix(c,CEL.shadow,.26),base:c,light:mix(c,CEL.cream,.16)});
    const wall=ramp(recipe.body),roof=ramp(recipe.roof),ink=CEL.ink;
    const brass=recipe.facadeTrim==='brass';
    const trim=brass?ramp(recipe.trim):{shade:CEL.wood.dark,base:CEL.wood.base,light:CEL.wood.light}; // the sprites' frame wood
    // Raised timbers cover the plank seams: a broad wood face with a light
    // upper/left edge and a dark lower/right edge, all in the wall's palette.
    const beam=recipe.framing==='darkTimber'?{base:0x493529,light:0x735039,shade:0x302731}:
      {base:mix(wall.base,CEL.shadow,.12),light:mix(wall.base,CEL.cream,.32),shade:mix(wall.base,CEL.shadow,.45)};
    // Source cells are painted offline; upload once per shared recipe, never read back.
    const tileCell=(rect,y0,y1,size=96)=>{
      if(!packed||!rect)return;
      const img=scene.textures.get(SHEET_IMAGE).getSourceImage();
      ctx.save();ctx.beginPath();ctx.rect(0,y0,512,y1-y0);ctx.clip();ctx.imageSmoothingEnabled=false;
      for(let y=y0;y<y1;y+=size)for(let x=0;x<512;x+=size)
        ctx.drawImage(img,rect[0],rect[1],rect[2]-rect[0],rect[3]-rect[1],x,y,size,size);
      ctx.restore();
    };
    const BOT=105,FLOORS=4,bays=[];for(let k=-1;k<=12;k++)bays.push(2+39*k);
    // --- wall surface -------------------------------------------------------
    px(0,0,512,128,wall.base);
    if(recipe.material==='timber'){ // crate planks: 8 wide, dark seam, bright edge
      for(let x=-3;x<512;x+=8){px(x,0,1,128,wall.shade);px(x+1,0,1,128,wall.light);}
      for(let y=0;y<128;y+=24)for(let x=1;x<512;x+=8){if(hash(x,y)>.7)px(x+4,y+6+hash(y,x)*12,1,1,wall.shade);}
    }else if(recipe.material==='brick'){ // broad running bond, one highlight pixel per brick
      const bw=16,bh=6;for(let y=0,row=0;y<128;y+=bh,row++)for(let x=-(row%2)*bw/2;x<512;x+=bw){
        px(x,y+bh-1,bw,1,wall.shade);px(x+bw-1,y,1,bh,wall.shade);px(x+1,y,bw-3,1,wall.light);}
    }else if(recipe.material==='stone'){ // big ashlar blocks
      const bw=24,bh=12;for(let y=0,row=0;y<128;y+=bh,row++)for(let x=-(row%2)*bw/2;x<512;x+=bw){
        px(x,y+bh-1,bw,1,wall.shade);px(x+bw-1,y,1,bh,wall.shade);px(x+1,y,bw-3,1,wall.light);
        if(hash(x,y)>.8)px(x+3+hash(y,x)*12,y+3+hash(x,y)*5,2,1,wall.shade);}
    }else{ // plaster: the sprite house's cream siding, faint seams every six texels
      for(let y=5;y<128;y+=6)px(0,y,512,1,mix(wall.base,wall.shade,.5));
      for(let y=3;y<128;y+=11)for(let x=5;x<512;x+=17){if(hash(x,y)>.9)px(x,y,2,1,wall.light);}
    }
    const wallRect=SHEET_SRC.surfaces?.[facade.variant+facade.wall];
    tileCell(wallRect,0,128);
    if(facade.upper)tileCell(SHEET_SRC.surfaces?.[facade.variant+facade.upper],0,BOT-24);
    // Full-panel cottage braces return on white restored residences. Shops
    // retain posts only, leaving room for the shared display and role sign.
    if(recipe.finish==='cottage'){
      for(let f=0;f<FLOORS;f++){const y=BOT-24*(f+1);for(const bx of bays){
        // Full panel diagonals join opposite corners beneath the openings.
        if(recipe.framing!=='darkTimber'||recipe.braces)for(let i=0;i<39;i++)for(const x of [bx+i,bx+38-i]){
          const by=y-2+Math.round(i*24/39);
          px(x,by,1,6,beam.base);px(x,by,1,1,beam.light);px(x,by+5,1,1,beam.shade);
        }
        const half=recipe.framing==='darkTimber'?1:2;
        px(bx-half,y,half*2+1,24,beam.base);px(bx-half,y,1,24,beam.light);px(bx+half,y,1,24,beam.shade);
      }}
    }
    // Horizontal timbers cap the joints after the posts and braces.
    for(let f=0;f<FLOORS;f++){const y=BOT-24*(f+1);
      const half=recipe.framing==='darkTimber'?1:2;
      px(0,y-half,512,half*2+1,beam.base);px(0,y-half,512,1,beam.light);px(0,y+half,512,1,beam.shade);
    }
    // Plinth: stone courses below the ground line, as the tileset keeps them;
    // walls never sample it (chimney sides and the door step do).
    const matchWall=recipe.role==='blacksmith',plinth=matchWall?wall:ramp(mix(recipe.body,CEL.mauve,.6));
    const bw=matchWall?24:18,bh=matchWall?12:6;
    px(0,BOT,512,23,plinth.base);
    for(let y=BOT+1,row=0;y<128;y+=bh,row++)for(let x=-(row%2)*bw/2;x<512;x+=bw){px(x,y+bh-1,bw,1,plinth.shade);px(x+bw-1,y,1,bh,plinth.shade);px(x+1,y,bw-3,1,plinth.light);}
    // Existing stack UVs sample the building's ground-wall material, without
    // framing or openings. Soot sits immediately under the retained cap.
    if(recipe.chimneyFinish){
      if(packed)tileCell(wallRect,BOT,128);
      else px(0,BOT,508,23,wall.base);
      px(0,BOT,508,2,ink);
      for(let x=3;x<508;x+=10)px(x,BOT+2,3,2,ink);
    }
    // --- openings -------------------------------------------------------------
    // Window shapes follow the approved house, smithy, trader and market
    // sprites. Specialty shops share the market sprite's broad four panes.
    const casement=(x,y)=>{
      const style=recipe.window||'casement',shop=style==='shop'||style==='brassShop',twin=style==='slateShutters',w=style==='brassShop'?19:shop?17:11,h=10;
      if(style==='porthole'){
        // Stepped circular brass frame: no antialiased arcs or extra triangles.
        px(x+2,y-1,7,1,ink);px(x,y+1,11,7,ink);px(x+2,y+9,7,1,ink);
        px(x+2,y,7,9,trim.base);px(x+1,y+2,9,5,trim.base);
        px(x+3,y+2,5,5,0x4c7378);px(x+2,y+3,7,3,0x4c7378);
        px(x+3,y+2,4,2,0xb5c8b2);px(x+5,y+2,1,5,trim.shade);
        px(x+2,y,6,1,trim.light);px(x+1,y+3,1,1,trim.light);
        px(x+3,y+8,5,1,trim.shade);return;
      }
      x-=Math.floor((w-11)/2);
      px(x-1,y-1,w+2,h+2,ink);px(x,y,w,h,trim.base);
      if(wreck){px(x+1,y+1,w-2,h-2,CEL.plum);px(x,y+2,w,2,CEL.wood.mid);px(x,y+6,w,2,CEL.wood.dark);px(x+1,y+2,1,1,ink);px(x+w-2,y+7,1,1,ink);return;}
      px(x+1,y+1,w-2,h-2,brass?0x648b8b:CEL.glass.base);
      px(x+1,y+1,Math.floor(w/2)-1,twin?h-2:3,brass?0xc7d4ba:CEL.glass.light);
      px(x+Math.ceil(w/2),y+(twin?1:5),Math.floor(w/2)-1,twin?h-2:4,brass?0x375b67:CEL.glass.dark);
      px(x+Math.floor(w/2),y+1,1,h-2,trim.shade);
      if(!twin)px(x+1,y+4,w-2,1,trim.shade);
      if(style==='brassShop'){
        px(x-1,y-3,w+2,2,trim.base);px(x,y-3,w,1,trim.light);
        px(x-1,y+h,w+2,3,beam.base);px(x,y+h,w,1,trim.light);
        px(x-1,y-1,1,1,trim.light);px(x+w,y-1,1,1,trim.light);
      }
      if(style==='arched'){
        px(x,y,w,1,trim.shade);px(x,y+1,2,2,trim.base);px(x+w-2,y+1,2,2,trim.base);
        px(x+2,y+1,w-4,1,trim.light);
      }
      if(style==='woodShutters'||twin){
        const shutter=twin?{base:0x626c80,light:0x8792a3,shade:0x3d4256}:trim;
        for(const sx of [x-5,x+w+1]){
          px(sx-1,y-1,6,h+2,ink);px(sx,y,4,h,shutter.base);px(sx,y,1,h,shutter.light);
          for(let j=2;j<h;j+=3)px(sx+1,y+j,3,1,shutter.shade);
        }
      }
      px(x-2,y+h,w+4,2,trim.light);px(x-2,y+h+2,w+4,1,ink);
      px(x-2,y-3,w+4,2,trim.shade);px(x-2,y-3,w+4,1,trim.light);
    };
    const door=(x,y)=>{ // 15x21 plank door, arched ink outline, crate-style brace, step and lantern
      px(x-1,y-1,17,23,ink);px(x,y+2,15,20,CEL.wood.base);px(x+1,y,13,2,CEL.wood.base);px(x+2,y-1,11,1,ink);
      for(let i=3;i<15;i+=4)px(x+i,y+1,1,21,CEL.wood.dark);
      px(x+1,y+1,13,1,CEL.wood.bright);px(x,y+8,15,2,CEL.wood.mid);px(x,y+10,15,1,CEL.wood.dark);
      px(x+11,y+12,2,2,CEL.flame);px(x+12,y+13,1,1,ink);
      if(brass){
        px(x-1,y+1,2,20,trim.base);px(x+14,y+1,2,20,trim.base);px(x,y,15,2,trim.light);
        px(x+4,y+3,7,7,trim.shade);px(x+5,y+4,5,5,recipe.shopfront?0xc7d4ba:0xf2c76a);
        px(x+7,y+4,1,5,trim.base);
        if(recipe.shopfront){px(x-2,y-2,19,2,trim.base);px(x-2,y-2,19,1,trim.light);}
        // Small real footprints can lose both neighbouring window bays to
        // corner suppression. Keep two narrow lights inside the entrance bay
        // so restoration still reads without squeezing openings at corners.
        for(const sx of [x-10,x+18]){
          if(recipe.shopfront){
            px(sx,y+4,8,10,trim.base);px(sx,y+4,8,1,trim.light);
            px(sx+1,y+5,6,7,0x648b8b);px(sx+1,y+5,5,2,0xc7d4ba);
            px(sx+4,y+5,1,7,trim.shade);
          }else{
            px(sx+2,y+4,4,10,trim.base);px(sx,y+6,8,6,trim.base);
            px(sx+2,y+6,4,6,0x648b8b);px(sx+1,y+7,6,4,0x648b8b);
            px(sx+2,y+6,4,2,0xc7d4ba);px(sx+2,y+4,4,1,trim.light);
          }
          px(sx,y+14,8,1,trim.light);
        }
      }
      if(wreck){px(x-2,y+6,19,3,CEL.plum);px(x-2,y+6,19,1,CEL.mauve);px(x-1,y+14,18,3,CEL.plum);px(x-1,y+14,18,1,CEL.mauve);}
      px(x-3,y+22,21,3,plinth.light);px(x-3,y+24,21,1,ink); // step
      px(x-7,y+3,1,8,trim.shade);px(x-9,y+1,5,6,ink);px(x-8,y+2,3,4,CEL.flame);px(x-7,y+3,1,1,0xfff1c2); // lantern
    };
    // Processed Pixel Plains parts and matching procedural hardware are sampled directly, once per recipe. Keep
    // doors aligned to the entrance; displays span two bays and the sign sits
    // above the doorway. Restored UV fitting preserves these through corners.
    const part=(name,x,y,w,h)=>{
      const rect=SHEET_SRC.parts?.[facade.variant+name]||SHEET_SRC.parts?.[name];if(!packed||!rect)return false;
      ctx.imageSmoothingEnabled=false;
      ctx.drawImage(scene.textures.get(SHEET_IMAGE).getSourceImage(),...rect.slice(0,2),
        rect[2]-rect[0],rect[3]-rect[1],Math.round(x),Math.round(y),w??rect[2]-rect[0],h??rect[3]-rect[1]);
      return true;
    };
    const display=(x,w)=>{
      part('shopWindow',x,BOT-16,w,15);
      if(recipe.awning)part('awning'+recipe.roofMaterial,x-1,BOT-24,w+2,8);
    };
    const kitDoor=()=>{
      const smith=recipe.facadeKit==='smith',house=recipe.facadeKit==='house',w=smith?23:house?19:20;
      const x=Math.round(DOOR_CENTRE-w/2),y=BOT-24;
      if(!part(smith?'smithDoor':house?'houseDoor':'shopDoor',x,y))return false;
      if(smith)part('cog',x+w+2,y+3,18,18);
      else if(house){
        part('timberWindow',x-13,y+6,12,12);part('timberWindow',x+w+1,y+6,12,12);
      }else{
        // Two adjacent glass bays form a display under one continuous canopy.
        display(2+4*BAY+2,74);
        // The sign occupies the upper entrance bay, above the full-height door.
        part(recipe.emblem,DOOR_CENTRE-10,y-20,20,18);
      }
      px(x-1,BOT,w+2,2,plinth.light);px(x-1,BOT+2,w+2,1,ink);
      return true;
    };
    if(!recipe.blank)for(let f=0;f<FLOORS;f++)for(let k=-1;k<=12;k++){
      const bx=2+39*k,y=BOT-24*(f+1)+5;
      if(recipe.facadeKit&&packed){
        if(f===0&&k===6)continue;
        const shop=recipe.facadeKit==='shop';
        if(shop&&f===1&&k===6)continue; // entrance sign replaces this window
        if(shop&&f===0)display(bx+2,35);
        else {
          const name=shop?'brassWindow':'timberWindow',w=shop?16:14;
          part(name,bx+(BAY-w)/2,y-1,w,w);
        }
      }else if(f===0&&k===6)door(bx+12,BOT-22);
      else if(k%2===0)casement(bx+14,y,f);
    }
    if(!recipe.blank&&recipe.facadeKit&&packed)kitDoor();
    // --- roof ---------------------------------------------------------------
    px(0,128,512,384,roof.base);
    const kind=recipe.roofMaterial;
    if(kind==='flat'){ // walkable flagstones, 24-texel, bright top-left corner
      for(let y=128,row=0;y<512;y+=24,row++)for(let x=-(row%2)*12;x<512;x+=24){px(x,y+23,24,1,roof.shade);px(x+23,y,1,24,roof.shade);px(x+1,y,21,1,roof.light);px(x+1,y+1,1,2,roof.light);}
    }else if(kind==='thatch'){ // tidy bands with sparse bright straws
      for(let y=128,row=0;y<512;y+=12,row++){px(0,y+11,512,1,roof.shade);px(0,y+10,512,1,roof.shade);px(0,y,512,1,roof.light);
        for(let x=(row%2)*8;x<512;x+=16){if(hash(x,y)>.45)px(x+3,y+2,1,6,roof.light);if(hash(y,x)>.75)px(x+9,y+4,1,5,roof.shade);}}
    }else if(kind==='slate'){ // broad rectangular slates 18x9
      for(let y=128,row=0;y<512;y+=9,row++)for(let x=-(row%2)*9;x<512;x+=18){px(x,y+8,18,1,roof.shade);px(x+17,y,1,9,roof.shade);px(x+1,y,15,1,roof.light);}
    }else{ // clay / red tile / shingle: scalloped 12x8 courses, one highlight per tile
      const tw=12,th=8;for(let y=128,row=0;y<512;y+=th,row++)for(let x=-(row%2)*tw/2;x<512;x+=tw){
        px(x,y+th-1,tw,1,roof.shade);px(x+tw-1,y,1,th-1,roof.shade);px(x+2,y+1,tw-5,1,roof.light);
        px(x,y+th-2,2,1,roof.shade);px(x+tw-3,y+th-2,2,1,roof.shade);} // stepped scallop corners
    }
    tileCell(SHEET_SRC.roofs[kind]?.rect,128,512);
    if(wreck){for(let y=136;y<512;y+=31)for(let x=5;x<512;x+=47){const n=hash(x,y);if(n<.55)continue;px(x+n*20,y+n*9,8+n*5,5+n*3,CEL.plum);px(x+n*20,y+n*9,8+n*5,1,ink);}}
    px(508,124,4,4,0xffffff); // shared solid texel for the ink pass
    tex.roofTone=mix(recipe.roof,CEL.shadow,.1);
    tex.refresh();tex.setFilter(Phaser.Textures.FilterMode.NEAREST);return tex;
  }
  const tilesetReady=scene=>scene.textures.exists(SHEET_IMAGE);
  // Stories and footprint are UV choices, not new texture allocations. All
  // buildings with a material/palette share this three-storey facade sheet.
  // With the tilesets loaded the sheet is cut from them; the generated
  // marks below remain the fallback (forts, headless review, missing art).
  function material(scene,recipe){
    const tex=baseMaterial(scene,recipe);
    if(recipe.shape==='wreck'&&!tex._wreckSoftened){
      // Reduce painted detail contrast; geometry supplies the depth shading.
      const ctx=tex.getContext(),size=tex.getSourceImage().width;
      ctx.fillStyle='rgba(151,142,130,0.38)';ctx.fillRect(0,0,size,size);
      // Keep the atlas solid texel white for tint-only faces and the silhouette.
      ctx.fillStyle='#ffffff';ctx.fillRect(508/512*size,124/512*size,4/512*size,4/512*size);
      tex.refresh();tex._wreckSoftened=true;
    }
    return tex;
  }
  function wreckInteriorSheet(scene){
    const loaded=scene.textures.exists('wreck_floor_cel'),key='lowpoly:wreck-interior-v5:'+loaded;
    if(scene.textures.exists(key))return scene.textures.get(key);
    const tex=scene.textures.createCanvas(key,512,512),ctx=tex.getContext();
    ctx.imageSmoothingEnabled=false;
    const rect=(x,y,w,h,c)=>{ctx.fillStyle=c;ctx.fillRect(x,y,w,h);};
    rect(0,0,512,512,'#8b8175');
    // Touching staggered bricks, like the smith-stone atlas: a full light
    // top/left bevel and dark bottom/right bevel, with smooth flat faces.
    const W=LOOK.wreck,css=c=>'#'+c.toString(16).padStart(6,'0');
    rect(0,0,512,128,css(W.top));
    for(let row=0;row<16;row++)for(let col=-1;col<33;col++){
      const x=col*16+(row%2)*8,y=row*8;
      rect(x,y,16,1,css(W.highlight));
      rect(x,y+1,1,6,css(W.highlight));
      rect(x,y+7,16,1,css(W.shadow));
      rect(x+15,y,1,7,css(W.shadow));
    }
    // Reserved strip beyond all wall UVs: steel flange, highlight and rivets.
    rect(448,104,56,16,'#7d8b95');
    rect(448,104,56,2,'#b9c6cb');rect(448,106,56,2,'#97a6ae');
    rect(448,118,56,2,'#56636d');
    for(let x=452;x<504;x+=14){rect(x,110,2,2,'#c2cbd0');rect(x,112,2,1,'#56636d');}
    if(loaded){
      ctx.drawImage(scene.textures.get('wreck_floor_cel').getSourceImage(),0,128,128,128);
      ctx.drawImage(tex.getSourceImage(),0,128,128,128,0,128,384,384);
    }
    rect(508,124,4,4,'#ffffff');tex.refresh();tex.setFilter(Phaser.Textures.FilterMode.NEAREST);return tex;
  }
  function baseMaterial(scene,recipe){
    if(recipe.shape==='wizard')return wizardSheet(scene,recipe);
    if(recipe.role!=='fort'&&LOOK.facade==='cel')return celSheet(scene,recipe);
    if(recipe.role!=='fort'&&tilesetReady(scene))return tilesetSheet(scene,recipe);
    const source=recipe.role!=='fort'&&scene.textures.exists('building_material_reference')?scene.textures.get('building_material_reference').getSourceImage():null;
    const key=(source?'generated:':'fallback:')+'lowpoly:materials-v14:'+JSON.stringify([recipe.material,recipe.body,recipe.trim,recipe.roof,recipe.finish,recipe.roofMaterial,recipe.role==='fort',recipe.shape,recipe.terraced]);
    if(scene.textures.exists(key))return scene.textures.get(key);
    const tex=scene.textures.createCanvas(key,512,512),ctx=tex.getContext();
    const css=c=>'#'+c.toString(16).padStart(6,'0');
    const blend=(a,b,t)=>{let c=0;for(const shift of [16,8,0])c|=Math.round(((a>>shift)&255)*(1-t)+((b>>shift)&255)*t)<<shift;return css(c);};
    const noise=(x,y)=>{let n=Math.imul(x+17,374761393)^Math.imul(y+31,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;};
    const rect=(x,y,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));};
    rect(0,0,512,128,css(recipe.body));rect(0,128,512,384,css(recipe.roof));
    // Atlas tiles are seamless and drawn 1:1; texel density is decided by
    // tools/build_building_materials.py. The role colour is blended in by
    // `tint`, keeping each material's own outlines, highlights and hue spread.
    function paintCell(name,y,height,base,tint){
      if(!source)return;
      const cell=Math.max(0,MATERIAL_CELLS.indexOf({redtile:'clay',darkstone:'rubble',cobble:'rubble'}[name]||name)),T=MATERIAL_TILE;
      const tile=document.createElement('canvas');tile.width=tile.height=T;
      const tc=tile.getContext('2d');tc.imageSmoothingEnabled=false;
      tc.drawImage(source,(cell%4)*T,Math.floor(cell/4)*T,T,T,0,0,T,T);
      const pixels=tc.getImageData(0,0,T,T),d=pixels.data;
      let average=0;for(let i=0;i<d.length;i+=4)average+=(d[i]*.299+d[i+1]*.587+d[i+2]*.114);average/=T*T;
      for(let i=0;i<d.length;i+=4){const f=Math.max(.25,Math.min(1.8,(d[i]*.299+d[i+1]*.587+d[i+2]*.114)/Math.max(1,average)));
        for(let c=0;c<3;c++){const b=(base>>(16-c*8))&255,tinted=f<=1?b*f:b+(255-b)*(f-1)*.7;
          d[i+c]=Math.min(255,Math.round(d[i+c]*(1-tint)+tinted*tint));}
      }tc.putImageData(pixels,0,0);
      ctx.save();ctx.beginPath();ctx.rect(0,y,512,height);ctx.clip();ctx.imageSmoothingEnabled=false;
      for(let py=y;py<y+height;py+=T)for(let x=0;x<512;x+=T)ctx.drawImage(tile,x,py);
      ctx.restore();
    }
    // Sparse pixel clusters, not smooth pigment clouds or single-pixel noise.
    if(!source)for(let y=4;y<512;y+=13)for(let x=3;x<512;x+=17){
      if(noise(x,y)<.83)continue;
      const base=y<128?recipe.body:recipe.roof;
      rect(x,y,3,2,blend(base,0xf3dfb8,.18));
    }
    const mortar=blend(recipe.body,0xe0d2b8,.22),dark=blend(recipe.body,0x403b34,.22);
    if(source){}
    else if(recipe.material==='timber'){
      for(let x=0;x<512;x+=10){ctx.globalAlpha=1;rect(x,0,1,128,dark);ctx.globalAlpha=.3;rect(x+1,0,1,128,mortar);}
    } else if(recipe.material!=='plaster'){
      const bw=recipe.material==='brick'?13:recipe.material==='sandstone'?25:20,bh=recipe.material==='brick'?6:10;
      for(let y=0,row=0;y<128;y+=bh,row++)for(let x=-(row%2)*bw/2;x<512;x+=bw){
        const n=noise(x,y);ctx.globalAlpha=1;
        rect(x,y,bw-1,1,mortar);rect(x,y,1,bh-1,mortar);
        ctx.globalAlpha=.04+n*.035;rect(x+1,y+1,bw-2,bh-2,n>.5?'#fff1d3':'#342a25');
      }
    }else{
      // Small islands of exposed substrate, leaving most plaster quiet.
      for(let y=8;y<105;y+=19)for(let x=4;x<512;x+=23){if(noise(x,y)<.86)continue;
        ctx.globalAlpha=.22;rect(x,y,5,2,dark);rect(x+2,y+3,6,2,dark);
        ctx.globalAlpha=.25;rect(x,y,5,.7,mortar);
      }
    }ctx.globalAlpha=1;
    const wallCell={plaster:'plaster',timber:'boards',clapboard:'clapboard',brick:'brick'}[recipe.material]||'rubble';
    paintCell(wallCell,0,128,recipe.body,wallCell==='plaster'||wallCell==='clapboard'?.55:.4);
    const bottom=105,frame=blend(recipe.body,recipe.trim,.42),sill=blend(recipe.body,0xf3dfb8,.30);
    const stone=blend(recipe.body,0x7d7a74,.7),stoneDark=blend(parseInt(stone.slice(1),16),0x292c29,.35);
    // A knee-high rubble plinth grounds plaster and timber walls.
    if(['plaster','timber','clapboard'].includes(recipe.material)){
      paintCell(recipe.shape==='wreck'?'moss':'rubble',bottom-12,12,parseInt(stone.slice(1),16),.3);rect(0,bottom-13,512,1.5,stoneDark);
    }
    for(let floor=0;floor<3;floor++){
      const y=bottom-24*(floor+1);
      // Crisp recessed bands under the eaves and each projecting floor beam.
      rect(0,y-4,512,4,dark);rect(0,y+2,512,3,dark);
      rect(0,y,512,1,sill);
      for(let x=14;x<512;x+=39){
        if(floor===0&&x===248)continue; // Entrance owns this entire bay.
        ctx.globalAlpha=.14;rect(x+1,y+7,9,10,'#292b2b');ctx.globalAlpha=1;
        // Four-pane casement: lit glass, one bright pane, timber cross.
        rect(x-2,y+5,10,10,frame);rect(x-1,y+6,8,7,'#55719f');rect(x-1,y+6,3,4,'#93b0d6');
        rect(x+2,y+6,1.2,7,css(recipe.trim));rect(x-1,y+10,8,1.2,css(recipe.trim));
        rect(x-2,y+14,10,1.2,sill);ctx.globalAlpha=.2;rect(x-1,y+15,9,1,'#282c2c');ctx.globalAlpha=1;
      }
    }
    if(recipe.finish==='cottage'){
      const beam=blend(recipe.trim,0x211f1c,.32),edge=blend(recipe.trim,recipe.body,.20);
      // Timbers are baked into the common facade, including diagonal braces.
      for(let floor=0;floor<3;floor++){
        const y=bottom-24*(floor+1);
        rect(0,y,512,2.3,beam);rect(0,y,512,.7,edge);
        for(let x=0;x<512;x+=39){
          rect(x,y,2.3,24,beam);rect(x,y,.7,24,edge);
          ctx.strokeStyle=beam;ctx.lineWidth=1.4;
          if(!source){ctx.beginPath();ctx.moveTo(x+3,y+3);ctx.lineTo(x+11,y+10);ctx.moveTo(x+36,y+3);ctx.lineTo(x+29,y+10);ctx.stroke();}
        }
      }
    }
    if(!source){
      const thatch=recipe.roofMaterial==='thatch',course=recipe.role==='fort'?8:thatch?16:13,bw=recipe.role==='fort'?12:thatch?9:19;
      ctx.save();ctx.beginPath();ctx.rect(0,128,512,384);ctx.clip();
      for(let y=128,row=0;y<512;y+=course,row++)for(let x=-bw;x<512;x+=bw){
        const px=x+(row%2)*Math.floor(bw/2),n=noise(x,y);
        if(recipe.role==='fort'){
          ctx.globalAlpha=.38+n*.16;rect(px,y+course-1,bw-1,1,blend(recipe.roof,0x24282c,.6));
          ctx.globalAlpha=.18+n*.12;rect(px,y,1,course-1,blend(recipe.roof,0x24282c,.6));
          ctx.globalAlpha=.19;rect(px+1,y+1,bw-3,1,'#f5dfb5');ctx.globalAlpha=1;continue;
        }
        // Broken highlight clusters suggest tiles without a dark grid.
        if(n>.25)rect(px+3,y+2,thatch?2:bw-6,1,blend(recipe.roof,0xf3dfb8,.24));
        if(n>.65)rect(px+bw-3,y+course-3,2,2,blend(recipe.roof,0x24282c,.18));
        if(thatch&&n>.45)rect(px+4,y+5,1,5,blend(recipe.roof,0xf3dfb8,.18));
      }ctx.restore();ctx.globalAlpha=1;
    }
    // Flat roofs are walkable flagstones.
    paintCell(recipe.roofMaterial==='flat'?'flagstone':recipe.roofMaterial,128,384,recipe.roof,.7);
    // One entrance, painted after the frame so braces cannot cut through it.
    // The sheet is shared; facade UV placement selects this bay only once.
    const doorX=247;
    rect(doorX-2,bottom-22,17,22,frame);
    rect(doorX,bottom-20,13,20,'#292c29');
    rect(doorX+1,bottom-19,10,18,blend(recipe.trim,recipe.body,.16));
    for(let j=3;j<11;j+=3)rect(doorX+j,bottom-18,.7,16,blend(recipe.trim,0x161c1b,.45));
    rect(doorX+9,bottom-10,1.5,1.5,'#c8ad73');
    rect(doorX-2,bottom-2,17,2,sill);
    // Sparse authored accents in separate bays, never a repeating prop row.
    rect(294,90,12,3,css(recipe.trim));rect(295,89,10,1,sill);
    for(const [x,y] of [[296,87],[300,86],[304,88]]){rect(x,y,2,3,'#65734b');rect(x,y,1,1,'#b7a46d');}
    rect(216,85,3,2,css(recipe.trim));rect(218,86,1,5,css(recipe.trim));
    rect(216,90,5,6,'#343832');rect(217,91,3,3,'#c7ad72');
    rect(0,bottom-3,508,3,dark);
    if(recipe.shape==='wreck'){
      const grime='#292c29',board=blend(recipe.body,0xc8ad73,.42),boardEdge=blend(recipe.trim,0x211f1c,.32);
      // Long damp streaks and irregular mossy footing, all in the shared sheet.
      for(let x=4;x<508;x+=17){const n=noise(x,11);if(n<.35)continue;
        rect(x,78,2,8+n*14,grime);rect(x+2,80,1,5+n*8,grime);
        rect(x-3,101-n*4,8,4+n*4,'#65734b');
      }
      for(let floor=0;floor<3;floor++)for(let x=14;x<508;x+=39){
        const y=105-24*(floor+1)+7;
        rect(x-1,y,9,9,grime);
        // Two crooked boards leave a dark slit, with visible nail heads.
        for(let k=0;k<2;k++){
          const by=y+1+k*5;rect(x-3,by,13,3,boardEdge);rect(x-3,by,12,2,board);
          rect(x-2,by,1,1,grime);rect(x+7,by+1,1,1,grime);
        }
      }
      rect(245,87,18,3,boardEdge);rect(245,87,17,2,board);
      // Missing tile clusters expose dark timber underneath the intact roof.
      for(let y=138;y<505;y+=29)for(let x=7;x<505;x+=41){if(noise(x,y)<.72)continue;
        rect(x,y,8,6,blend(recipe.roof,0x24282c,.65));rect(x+3,y-3,5,4,blend(recipe.roof,0x24282c,.65));
      }
    }
    // Quantize once at material creation. All marks, including antialiased
    // braces, resolve to this twelve-color palette shared by the buildings.
    const palette=[css(recipe.body),blend(recipe.body,0x403b34,.22),blend(recipe.body,0xf3dfb8,.30),
      css(recipe.roof),blend(recipe.roof,0x24282c,source?.24:.35),blend(recipe.roof,0xf3dfb8,source?.18:.24),
      css(recipe.trim),blend(recipe.trim,0x211f1c,.32),'#292c29','#c8ad73','#65734b','#ffffff','#55719f','#93b0d6',stone,stoneDark]
      .map(c=>[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)]);
    // Generated tiles are already posterised; only the fallback is quantised.
    const pixels=source?null:ctx.getImageData(0,0,512,512),data=pixels?.data||[];
    const wallPalette=palette.filter((_,i)=>i<3||i>5),roofPalette=palette.slice(3,6);
    for(let i=0;i<data.length;i+=4){
      let best=palette[0],distance=Infinity;
      for(const color of (source?(i<512*128*4?wallPalette:roofPalette):palette)){const d=(data[i]-color[0])**2+(data[i+1]-color[1])**2+(data[i+2]-color[2])**2;
        if(d<distance){distance=d;best=color;}}
      for(let c=0;c<3;c++){
        const base=(recipe.body>>(16-c*8))&255;
        // Glass stays clear of the muted wall wash so windows read as lit.
        data[i+c]=i<512*128*4&&recipe.role!=='fort'?best===palette[12]||best===palette[13]?Math.round(best[c]*.9):Math.round((best[c]*.66+base*.34)*.76):best[c];
      }data[i+3]=255;
    }
    if(pixels)ctx.putImageData(pixels,0,0);
    rect(508,124,4,4,'#ffffff'); // Shared solid texel for silhouette trim.
    tex.refresh();tex.setFilter(Phaser.Textures.FilterMode.NEAREST);return tex;
  }
  // One interior atlas per exterior material, shared by every room. Copying
  // opening rectangles keeps shutters, panes and entrance dressing identical.
  function interiorSheet(scene,exterior,recipe){
    if(!scene.textures.createCanvas)return exterior;
    const key='interior-v2:'+exterior.key;
    if(scene.textures.exists(key))return scene.textures.get(key);
    const tex=scene.textures.createCanvas(key,512,512),ctx=tex.getContext();
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(exterior.getSourceImage(),0,0,512,512);
    if(scene.textures.exists('interior_walls')){
      const wall=scene.textures.get('interior_walls').getSourceImage();
      for(let y=9;y<105;y+=24)for(let x=0;x<512;x+=30)
        ctx.drawImage(wall,113,576,30,32,x,y,30,24);
      for(let x=0;x<512;x+=30)for(let y=9;y<105;y+=24)
        ctx.drawImage(wall,113,560,30,16,x,y,30,3);
      // Copy the same dressed opening, including its sill and lintel. The
      // exterior atlas owns their placement; both faces retain the same UVs.
      const source=exterior.getSourceImage(),scale=source.width/512;
      const copy=(x,y,w,h)=>ctx.drawImage(source,x*scale,y*scale,w*scale,h*scale,x,y,w,h);
      if(!recipe.blank)for(let f=0;f<4;f++){
        const y=105-24*(f+1);
        if(exterior.key.startsWith('lowpoly:cel')){
          for(let k=0;k<=12;k+=2){const bx=2+39*k;
            if(f===0&&k===6)copy(bx+2,y,32,24);
            else {const shutters=['woodShutters','slateShutters'].includes(recipe.window),shop=recipe.window==='shop';
              copy(bx+(shutters?8:shop?9:12),y+2,shutters?24:shop?21:15,17);}
          }
        }else if(exterior.key.startsWith('lowpoly:tileset')){
          for(let k=0;k<=12;k+=2)copy(2+39*k,y,39,24);
        }else{
          for(let x=14;x<508;x+=39)copy(x-2,y+5,12,12);
          if(f===0)copy(245,83,17,22);
        }
      }
      // The same wood continues from the upper wall rail over the cut top.
      for(let x=0;x<512;x+=30){
        ctx.drawImage(wall,113,560,30,16,x,110,30,8);
      }
    }else{
      ctx.fillStyle='#954a39';ctx.fillRect(0,110,508,10);
      ctx.fillStyle='#b45c3a';ctx.fillRect(0,112,508,1);
      ctx.fillStyle='#4a2123';ctx.fillRect(0,116,508,2);
      for(let x=3;x<508;x+=13){ctx.fillStyle='#7e210d';ctx.fillRect(x,114,8,1);}
    }
    tex.refresh();tex.setFilter(Phaser.Textures.FilterMode.NEAREST);return tex;
  }
  function active(scene){return !!scene._headingUp&&scene.game?.renderer?.type===2;}
  function renderObject(scene){
      const obj=scene.add.graphics();
      (scene.worldContainer||scene.buildingWallContainer).add(obj);
      obj._worldGeometry=true;
      obj._huAnchor={x:0,y:0};
      obj.renderWebGL=function(renderer,src,camera,parentMatrix){
        camera.addToRenderList(src);
        const matrix=Phaser.GameObjects.GetCalcMatrix(src,camera,parentMatrix).calc;
        const pipeline=renderer.pipelines.set(renderer.pipelines.get('MultiPipeline'),src);
        renderer.pipelines.preBatch(src);
        const tu=510/512,tv=126/512,px=camera.zoom*LOOK.inkPx; // solid texel; one art pixel
        // The ink outline: the group's visible triangles re-emitted in the solid
        // texel at eight screen offsets, before the group's faces. One building
        // is a contiguous sorted run; its ink groups (body, flat deck, chimney)
        // draw in layer order so each gets a line where it meets the surface below.
        const ink=(group)=>{
          const tint=Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha(src._wreck?LOOK.wreck.ink:LOOK.ink,camera.alpha*src.alpha);
          for(const [ox,oy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]])for(const f of group){
            if(pipeline.shouldFlush(3))pipeline.flush();
            const unit=pipeline.setTexture2D(f.texture.source[0].glTexture);
            for(let i=0;i<3;i++){const p=f.projected[i];pipeline.batchVert(matrix.getX(p.x,p.y)+ox*px,matrix.getY(p.x,p.y)+oy*px,tu,tv,unit,0,tint);}
          }
        };
        const paint=(group)=>{for(const f of group){
          if(pipeline.shouldFlush(3))pipeline.flush();
          const unit=pipeline.setTexture2D(f.texture.source[0].glTexture);
          // Restrained three-step lighting keeps the wreck in the same cel palette.
          let shade=src._wreck?(f.light<.65?196:f.light<.88?225:255):f.light<.65?140:f.light<.88?199:255;
          if(f.eaveShadow)shade=Math.round(shade*LOOK.eaveShade);
          const textured=LOOK.textured||f.solid||f.kind==='trim';
          const color=LOOK.textured?(f.color??0xffffff):f.flat??f.color??0xffffff;
          const lit=k=>(Math.round((color>>16)*k)<<16)|(Math.round(((color>>8)&255)*k)<<8)|Math.round((color&255)*k);
          const tint=Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha(lit(shade/255),camera.alpha*src.alpha);
          for(let i=0;i<3;i++){
            const p=f.projected[i];
            // Keep cel brick bevels crisp beneath broad ground-to-top shading.
            const baseShade=src._wreck?.76:.72;
            const contact=f.kind==='wall'&&!f.preserveWalls?baseShade+(1-baseShade)*Math.min(1,f.points[i].z/Math.max(1,f.eaveHeight)):1;
            const wallTint=contact===1?tint:Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha(lit(shade*contact/255),camera.alpha*src.alpha);
            pipeline.batchVert(matrix.getX(p.x,p.y),matrix.getY(p.x,p.y),textured?p.u:tu,textured?p.v:tv,unit,0,wallTint);
          }
        }};
        let group=[],support=null,groupId=0;
        // The outline repeats filled triangles eight times. During a fade those
        // layers would accumulate to opaque black and hide the player again.
        const flush=()=>{if(!group.length)return;if(LOOK.inkPx>0&&src.alpha===1&&!src._noInk)ink(group);paint(group);group=[];};
        for(const f of src._lowpolyFaces){
          if(!f.visible)continue;
          const g=src._wreck?0:f.inkGroup||0;
          if(f.support!==support||g!==groupId){flush();support=f.support;groupId=g;}
          group.push(f);
        }
        flush();
        renderer.pipelines.postBatch(src);
      };
      return obj;
  }
  function begin(scene){
    if(!scene._lowpoly){
      const state=scene._lowpoly={pool:[],buildings:[],faces:[],builds:0,angle:NaN,offsetX:0,offsetY:0};
      scene.events?.once('shutdown',()=>{for(const key of state.textures||[])scene.textures.remove(key);scene._lowpoly=null;});
    }
    const state=scene._lowpoly;
    for(const obj of state.pool){obj.visible=false;obj._lowpolyFaces=[];}
    state.buildings=[];state.faces=[];state.keys=new Set();state.angle=NaN;state.builds++;
    state.enabled=true;return state;
  }
  // Atlas boundaries cannot use GL_REPEAT: that would repeat windows into
  // roofs. Split only overflowing faces at repeat boundaries, once on rebuild.
  // Normal-sized buildings keep exactly their original triangle counts.
  // Every wall triangle whose top meets a roof level is split LOOK.eaveBand
  // below it; the strip above is flagged and draws darker (the eave shadow).
  function eaveSplit(mesh){
    const levels=[...new Set(mesh.faces.filter(f=>f.kind==='roof'&&!f.debris).flatMap(f=>f.points.map(p=>+p.z.toFixed(2))))];
    const cutZ=(poly,bound,side)=>{const out=[];poly.forEach((a,i)=>{const b=poly[(i+1)%poly.length],da=(a.z-bound)*side,db=(b.z-bound)*side;
      if(da>=-1e-8)out.push(a);
      if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db),p={};for(const k of ['x','y','z','u','v'])p[k]=a[k]+(b[k]-a[k])*t;out.push(p);}});return out;};
    return mesh.faces.flatMap(f=>{
      if(f.kind!=='wall'||f.interior||f.chimney||f.wreckMasonry)return [f];
      const zs=f.points.map(p=>p.z),top=Math.max(...zs),bottom=Math.min(...zs),L=levels.find(l=>Math.abs(l-top)<.6);
      if(L==null||bottom>L-LOOK.eaveBand)return [f];
      const upper=cutZ(f.points,L-LOOK.eaveBand,1),lower=cutZ(f.points,L-LOOK.eaveBand,-1),out=[];
      for(const [poly,shadow] of [[lower,false],[upper,true]])for(let i=1;i<poly.length-1;i++)out.push({...f,points:[poly[0],poly[i],poly[i+1]],eaveShadow:shadow||undefined});
      return out;
    });
  }
  function atlasFaces(mesh,roofPeriod=288){
    const result=[],vOffset=mesh.uvBaseline?0:77-mesh.height;
    const cut=(poly,axis,bound,side)=>{
      const out=[];
      poly.forEach((a,i)=>{const b=poly[(i+1)%poly.length],da=(a[axis]-bound)*side,db=(b[axis]-bound)*side;
        if(da>=-1e-8)out.push(a);
        if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db),p={};for(const k of ['x','y','z','u','v','tu','tv'])p[k]=a[k]+(b[k]-a[k])*t;out.push(p);}
      });return out;
    };
    const wrap=(polys,axis,limit,period)=>polys.flatMap(poly=>{
      const lo=Math.min(...poly.map(p=>p[axis])),hi=Math.max(...poly.map(p=>p[axis]));
      if(lo>=0&&hi<=limit)return [poly];
      const pieces=[];
      for(let tile=Math.floor(lo/period);tile<=Math.floor((hi-1e-8)/period);tile++){
        const clipped=cut(cut(poly,axis,tile*period,1),axis,(tile+1)*period,-1);
        if(clipped.length>=3)pieces.push(clipped.map(p=>({...p,[axis]:p[axis]-tile*period})));
      }return pieces;
    });
    for(const face of eaveSplit(mesh)){
      const roof=face.kind==='roof',trim=(face.kind==='trim'&&!face.rawUV)||!!face.solid,raw=!!face.rawUV;
      const points=face.points.map(p=>({...p,
        tu:trim?510:raw?p.u:roof?p.u/DETAIL_SCALE:p.u,
        tv:trim?126:raw?p.v:roof?p.v/DETAIL_SCALE:105-(105-p.v-vOffset)/DETAIL_SCALE}));
      let polys=[points];
      if(face.kind==='wall'&&face.wallSpan&&!raw&&!trim)polys=cornerBays(polys,face.wallSpan,cut);
      if(!trim&&!raw){
        // The selected sheet owns its roof repeat (approved crops: 360;
        // generated tiles: 288). Facades repeat twelve complete 39px bays.
        polys=wrap(polys,'tu',roof?511:507,roof?roofPeriod:468);
        polys=wrap(polys,'tv',roof?383:123,roof?roofPeriod:72);
      }
      const direction=face.kind==='wall'?(face.wallDirection||{x:face.points[1].x-face.points[0].x,y:face.points[1].y-face.points[0].y}):face.wallDirection;
      for(const poly of polys)for(let i=1;i<poly.length-1;i++){
        const tri=[poly[0],poly[i],poly[i+1]];
        if(!trim&&Math.abs((tri[1].tu-tri[0].tu)*(tri[2].tv-tri[0].tv)-(tri[1].tv-tri[0].tv)*(tri[2].tu-tri[0].tu))<1e-9)continue;
        result.push({...face,wallDirection:direction,points:tri.map(p=>({...p,tu:p.tu/512,tv:(p.tv+(roof&&!trim&&!raw?128:0))/512}))});
      }
    }
    return result;
  }
  const DOOR={width:10,height:13,margin:4,reach:192};
  // Points and streets share the unrotated map projection. Winding determines
  // the outward wall normal; a street behind the wall cannot select it.
  function streetDoor(points,streets){
    const ring=triangulate(points).ring;
    let best=null;
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],length=Math.hypot(b.x-a.x,b.y-a.y);
      if(length<DOOR.width+2*DOOR.margin)continue;
      const along={x:(b.x-a.x)/length,y:(b.y-a.y)/length},normal={x:along.y,y:-along.x};
      const center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      for(const [c,d] of streets){
        const dx=d.x-c.x,dy=d.y-c.y,len2=dx*dx+dy*dy;
        if(!len2)continue;
        const t=Math.max(0,Math.min(1,((center.x-c.x)*dx+(center.y-c.y)*dy)/len2));
        const vx=c.x+dx*t-center.x,vy=c.y+dy*t-center.y,distance=Math.hypot(vx,vy);
        if(distance>DOOR.reach||vx*normal.x+vy*normal.y<distance*.5)continue;
        if(!best||distance<best.distance)best={center,along,normal,distance,edge:i};
      }
    }
    return best;
  }
  // A door on a NAMED wall (`edge` of triangulate's ring, the index streetDoor
  // answers): Home's, whose doorway wall is the save's (save.starterTrailer
  // .door → the shape's door point → ringEdgeNearest) so the painted bay, the
  // plank panel, the prism doorway and homeInside all agree on one wall.
  function edgeDoor(points,edge){
    const ring=triangulate(points).ring;
    if(edge==null||edge<0||edge>=ring.length)return null;
    const a=ring[edge],b=ring[(edge+1)%ring.length],length=Math.hypot(b.x-a.x,b.y-a.y);
    if(length<DOOR.width+2*DOOR.margin)return null;
    const along={x:(b.x-a.x)/length,y:(b.y-a.y)/length},normal={x:along.y,y:-along.x};
    return {center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},along,normal,distance:0,edge};
  }
  // The ring edge (triangulate's ring) nearest a point — a doorway's.
  function ringEdgeNearest(points,at){
    const ring=triangulate(points).ring;
    let best=-1,bestD=Infinity;
    ring.forEach((a,i)=>{const b=ring[(i+1)%ring.length],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy||1;
      const t=Math.max(0,Math.min(1,((at.x-a.x)*dx+(at.y-a.y)*dy)/l2)),d=Math.hypot(at.x-(a.x+dx*t),at.y-(a.y+dy*t));
      if(d<bestD){bestD=d;best=i;}});
    return best;
  }
  function doorFaces(door){
    if(!door)return [];
    const faces=[],{center,along,normal}=door;
    const panel=(x0,x1,z0,z1,color,layer)=>{
      const point=(x,z)=>({x:center.x+along.x*x+normal.x*.1,y:center.y+along.y*x+normal.y*.1,z,u:0,v:0});
      const a=point(x0,z0),b=point(x1,z0),c=point(x1,z1),d=point(x0,z1);
      for(const points of [[a,b,c],[a,c,d]])faces.push({points,kind:'trim',color,layer,light:1,door:true,wallDirection:along});
    };
    panel(-5,5,0,13,0x30262a,.10);
    panel(-3.8,3.8,.7,11.8,0x79503b,.11);
    for(const x of [-1.3,1.3])panel(x-.2,x+.2,.7,11.8,0x4d342c,.12);
    panel(-3.8,3.8,2,2.7,0xa37b53,.13);
    panel(2.3,3.1,5.3,6.2,0xd4b775,.14);
    return faces;
  }
  function add(scene,pts,recipe,variant,key,streets=[],entrance=null){
    const state=scene._lowpoly,left=Math.min(...pts.map(p=>p.x)),top=Math.min(...pts.map(p=>p.y));
    const local=pts.map(p=>({x:p.x-left,y:p.y-top}));
    // THE DOOR FACES THE NEAREST STREET (streetDoor), or stands on the wall
    // the caller names (`entrance`: Home's saved doorway wall, edgeDoor): its
    // wall is the facade's entrance (the painted door bay, geometry's
    // `entrance`) AND carries the plank door panel (doorFaces). Inside, the
    // bay stays on that wall and the panel is left off with the rest of the
    // outside.
    const door=recipe.shape?null:entrance!=null?edgeDoor(local,entrance):streets.length?streetDoor(local,streets.map(line=>line.map(p=>({x:p.x-left,y:p.y-top})))):null;
    let cached=recipe.shape?specialGeometry(local,recipe,streets.map(line=>line.map(p=>({x:p.x-left,y:p.y-top})))):recipe.terraced?styleGeometry(local,recipe.style,recipe):recipe.style&&typeof BuildingStyles!=='undefined'&&!variant
      ?styleGeometry(local,recipe.style,recipe):geometry(local,variant||'ridge',recipe.stories*FLOOR_HEIGHT+EAVE_RISE,ROOF_OVERHANG,(recipe.chimneys||recipe.chimneyFlare)?{count:recipe.chimneys||1,scale:recipe.chimneyScale||1,flare:recipe.chimneyFlare||0}:null,door?door.edge:null);
    if(recipe.interior)cached=interiorGeometry(cached,LOOK.wallThickness);
    if(door&&!recipe.interior)cached={...cached,faces:[...cached.faces,...doorFaces(door)]};
    const texture=material(scene,recipe),insideTexture=recipe.shape==='wreck'?wreckInteriorSheet(scene):recipe.interior?interiorSheet(scene,texture,recipe):texture;
    (state.textures||=new Set()).add(texture.key);state.textures.add(insideTexture.key);
    // A standing building is ONE render object sorted at its footprint
    // centroid (the player never stands among its walls). An INTERIOR (Home
    // while the player is inside) is one object PER WALL (interiorGeometry's
    // `edge`), each sorted at its own wall — see place().
    const parts=cached.edges?cached.edges.map((edge)=>({...cached,faces:cached.faces.filter(f=>f.edge===edge.index),edge,noInk:true})).filter(p=>p.faces.length):[cached];
    let first=null;
    for(const part of parts){const mesh=place(part);first=first||mesh;}
    // NO INK INSIDE (owner, Oct 2026): the walls, drawn as parts of their
    // own, each inked their own outline over the neighbour's fill (black
    // seams between the walls); inside, no part inks at all (`noInk`) — the
    // dark mask outside the room (lighting.js paintIndoorMask) is the room's
    // edge.
    return first;
    function place(cached){
    const mesh={...cached,faces:atlasFaces(cached,texture.roofPeriod)};
    mesh.roofTriangles=mesh.faces.filter(f=>f.kind==='roof').length;mesh.wallTriangles=mesh.faces.filter(f=>f.kind==='wall').length;mesh.trimTriangles=mesh.faces.filter(f=>f.kind==='trim').length;
    mesh.key=key;mesh.footprint=pts;mesh.role=recipe.role;mesh.x=left;mesh.y=top;mesh.smoke=recipe.smoke?cached.chimneyMouths||[]:[];state.buildings.push(mesh);if(key&&mesh.faces.length)state.keys.add(key);
    // A wall's sort point is its baseline's point in the player's screen
    // column (`wallSupport` → WallPerspective.wallSortPoint; re-asked every
    // frame in update as the player and the heading move), so a wall orders
    // against the player exactly where the two overlap on screen: the wall
    // behind the player stays behind along its whole length, the wall in
    // front in front, at every heading. Placed here at its low end; update
    // moves it at once.
    if(mesh.edge)mesh.edge={a:{x:left+mesh.edge.a.x,y:top+mesh.edge.a.y},b:{x:left+mesh.edge.b.x,y:top+mesh.edge.b.y}};
    const support=mesh.edge?{...wallSupport(mesh.edge,0),order:state.buildings.length}
      :{x:left+(cached.center?.x??local.reduce((s,p)=>s+p.x,0)/local.length),y:top+(cached.center?.y??local.reduce((s,p)=>s+p.y,0)/local.length),order:state.buildings.length};
    const index=state.buildings.length-1;
    const obj=state.pool[index]||(state.pool[index]=renderObject(scene));
    mesh.obj=obj;mesh.support=support;obj._lowpolyFaces=mesh.faces;
    obj._noInk=!!cached.noInk;obj._wreck=recipe.shape==='wreck';
    for(const face of mesh.faces){
      const roofTone=face.tileCap&&texture.roofTone!=null?mix(texture.roofTone,0x2a2229,.12):recipe.roof;
      if(face.debris||(face.interior||face.wreckMasonry)&&recipe.shape==='wreck')face.color=0xffffff;else if(face.rim)face.color=mix(roofTone,0xf3e6c8,.5);else if(face.rimShade)face.color=mix(roofTone,0x2a2229,.22);else if(face.solid)face.color=roofTone;
      else if(face.wallTop)face.color=recipe.shape==='wreck'?LOOK.wreck.mortar:0xffffff;
      else if(face.rubbleTop)face.color=recipe.shape==='wreck'?LOOK.wreck.top:mix(recipe.body,0xf3e6c8,.35);
      else if(face.kind==='trim'&&face.color==null)face.color=recipe.trim;
      else if(recipe.shape==='wreck'&&(face.kind==='wall'||face.kind==='roof')&&!face.debris&&!face.chimney)face.color=face.kind==='roof'?LOOK.wreck.roofTint:LOOK.wreck.tint;
      // Fit complete opening bays onto each restored side wall, using the
      // existing split vertices. p.u retains the original pre-corner UV, so
      // this removes blank corner substitutions without changing any geometry.
      // Entrance walls keep their authored door alignment and broad display.
      if(recipe.facadeKit&&face.kind==='wall'&&face.wallSpan&&!face.rawUV&&!face.solid){
        const [lo,hi]=face.wallSpan,span=hi-lo,entrance=Math.abs((lo+hi)/2-DOOR_CENTRE)<1e-6;
        if(!entrance){
          const bays=Math.max(1,Math.min(5,Math.round(span/BAY)));
          for(const p of face.points)p.tu=(2+(p.u-lo)/span*bays*BAY)/512;
        }else{
          // Undo only the corner-bay shift (±39), retaining any atlas wrap
          // (468). Otherwise a cut end bay can repeat the entrance emblem.
          for(const p of face.points){
            const delta=p.u-p.tu*512;
            p.tu+=(delta-Math.round(delta/468)*468)/512;
          }
        }
      }
      // The retained street-door panels used to hide the baked doorway.
      // Reuse their vertices and layers, sampling the matching facade position.
      if(face.door&&recipe.facadeKit){
        face.facadeDoor=true;face.color=0xffffff;
        for(const p of face.points){
          p.tu=(DOOR_CENTRE+((p.x-door.center.x)*door.along.x+(p.y-door.center.y)*door.along.y)/DETAIL_SCALE)/512;
          p.tv=(105-p.z/DETAIL_SCALE)/512;
        }
      }
      if(face.chimney&&recipe.chimneyFinish){
        face.color=face.kind==='wall'?0xffffff:face.color===LOOK.chimney.mouthColor?CEL.ink:
          face.layer===2.7?recipe.trim:mix(recipe.trim,CEL.shadow,.26);
      }
      else if(face.chimney && recipe.role==='blacksmith' && face.color!==LOOK.chimney.mouthColor)
        face.color=face.kind==='wall'?0xffffff:recipe.body;
      // The untextured look (LOOK.textured=false) draws each face in its base colour.
      face.flat=face.tileCap?mix(recipe.roof,0x2a2229,.12):face.kind==='roof'&&!face.solid?recipe.roof:face.kind==='wall'?(face.chimney&&recipe.role!=='blacksmith'?LOOK.chimney.sides:recipe.body):face.color??recipe.trim;
      face.preserveWalls=recipe.role==='fort'||!!face.chimney;face.eaveHeight=mesh.eaveHeight??mesh.height;face.support=support;face.texture=face.interior||face.wreckMasonry||face.wallTop||face.debris||face.steel?insideTexture:texture;face.x=left;face.y=top;face.projected=face.points.map(()=>({}));state.faces.push(face);}
    return mesh;
    }
  }
  // A wall's sort point against the player: WallPerspective.wallSortPoint
  // (the ONE rule both building paths share) — the baseline's point in the
  // player's screen column at the heading `angle`, else its end lowest on
  // screen. `at` is the player's feet in the overlay's px space.
  function wallSupport(edge,angle,at){
    const WP=typeof WallPerspective!=='undefined'?WallPerspective:global.WallPerspective;
    if(WP&&WP.wallSortPoint)return WP.wallSortPoint(edge.a,edge.b,angle,at);
    const s=Math.sin(angle),c=Math.cos(angle),a=edge.a,b=edge.b;
    const p=s*a.x+c*a.y>=s*b.x+c*b.y?a:b;return {x:p.x,y:p.y};
  }
  function offset(scene,x,y){
    const state=scene._lowpoly;if(!state)return;
    state.offsetX=x;state.offsetY=y;update(scene);
  }
  function update(scene){const state=scene._lowpoly;if(!state)return;
    const visible=state.enabled&&active(scene)&&(scene.depth??0)===0;
    const angle=scene.mapRot||0;
    // The player's feet in the overlay's px space: what every interior wall
    // sorts against (wallSupport).
    const feet=scene.playerScreen?scene.playerScreen():null;
    const at=feet?{x:feet.x-state.offsetX,y:feet.y-state.offsetY}:null;
    // The retained geometry's pan changes even when its projected faces do not.
    for(const mesh of state.buildings){
      const obj=mesh.obj;obj.visible=visible;
      if(mesh.edge){const w=wallSupport(mesh.edge,angle,at);mesh.support.x=w.x;mesh.support.y=w.y;}
      obj.setPosition(state.offsetX,state.offsetY);
      obj._huAnchor.x=mesh.support.x+state.offsetX;
      obj._huAnchor.y=mesh.support.y+state.offsetY;
    }
    const changed=state.angle!==angle;state.angle=angle;
    if(changed){
    const c=Math.cos(angle),s=Math.sin(angle);
    for(const face of state.faces){let depth=0;
      // Height projects screen-up, foreshortened like the billboard sprites.
      face.points.forEach((p,i)=>{const v=face.projected[i];v.x=face.x+p.x-s*p.z*LOOK.heightScale;v.y=face.y+p.y-c*p.z*LOOK.heightScale;v.u=p.tu;v.v=p.tv;depth+=s*(face.x+p.x)+c*(face.y+p.y);});
      if((face.kind==='trim'&&!face.facadeDoor&&!face.rawUV)||face.solid)for(const p of face.projected){p.u=510/512;p.v=126/512;}
      face.support.depth=s*face.support.x+c*face.support.y;
      face.depth=depth/3;
      if((face.kind==='wall'&&(!face.interior||face.edge!=null))||(face.kind==='trim'&&face.wallDirection)){const a=face.points[0],b=face.points[1],dx=face.wallDirection?.x??b.x-a.x,dy=face.wallDirection?.y??b.y-a.y,len=Math.hypot(dx,dy)||1;face.light=.76+.23*(c*dx-s*dy)/-len;}
      const p=face.projected;face.visible=cross(p[0],p[1],p[2])>1e-8;
    }
    for(const mesh of state.buildings){
      mesh.faces.sort((a,b)=>(a.layer??0)-(b.layer??0)||a.depth-b.depth);
      mesh.visibleTriangles=mesh.faces.filter(f=>f.visible).map(f=>f.projected);
      // Standalone art viewers have no shared world sorter.
      if(!scene.worldContainer)mesh.obj.setDepth(mesh.support.depth);
    }
    if(!scene.worldContainer)scene.buildingWallContainer.sort('depth');
    }
    for(const mesh of state.buildings) mesh.obj.alpha=mesh.role==='wreck'||typeof Render==='undefined'||!Render.buildingFadeAlpha?1:Render.buildingFadeAlpha(scene,mesh.key,mesh.footprint,
      mesh.visibleTriangles||[],mesh.support,{x:state.offsetX,y:state.offsetY});
  }
  // Screen points of every smoking chimney mouth (ROLES[role].smoke), in the
  // wall container's space, projected like the faces. render.js puffs there.
  function smokeMouths(scene){
    const state=scene._lowpoly;if(!state||!state.enabled||!active(scene)||(scene.depth??0)!==0)return [];
    const angle=scene.mapRot||0,c=Math.cos(angle),s=Math.sin(angle),k=LOOK.heightScale,out=[];
    for(const mesh of state.buildings)for(const m of mesh.smoke)out.push({x:mesh.x+m.x-s*m.z*k+(state.offsetX||0),y:mesh.y+m.y-c*m.z*k+(state.offsetY||0),alpha:mesh.obj?.alpha??1});
    return out;
  }
  function worldPieces(scene){
    const state=scene._lowpoly;if(!state||!state.enabled||!active(scene)||(scene.depth??0)!==0)return [];
    update(scene);
    const anchor=viewAnchorWorldM(scene);
    return state.buildings.map(mesh=>({sprite:mesh.obj,rank:1,layer:typeof WorldLayers==='undefined'?undefined:mesh.role==='wreck'?WorldLayers.GROUND_DECAL:WorldLayers.STANDING_PROP,
      groundY:anchor.y+(mesh.obj._huAnchor.y-scene.viewCenterY)*scene.cellM/CELL_PX}));
  }
  function clear(scene){
    const state=scene._lowpoly;if(!state)return;
    state.enabled=false;state.faces=[];state.buildings=[];state.keys.clear();
    for(const obj of state.pool){obj.visible=false;obj._lowpolyFaces=[];}
  }
  const covers=(scene,o)=>active(scene)&&(scene.depth??0)===0&&scene._lowpoly?.enabled&&!!scene._lowpoly?.keys.has(o.id);
  global.BuildingLowPoly={LOOK,DOOR,streetDoor,edgeDoor,ringEdgeNearest,doorFaces,atlasFaces,ROLES,RESTORED_ROLES,recipeFor,specialGeometry,styleGeometry,interiorGeometry,geometry,triangulate,active,begin,add,update,offset,worldPieces,smokeMouths,clear,covers};
})(window);
