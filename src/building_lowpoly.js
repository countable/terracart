// Retained, textured architecture. Only camera projection changes on rotation.
// Roofs use authored planes clipped to the exact footprint, not a sampled grid.
(function (global) {
  const FLOOR_HEIGHT=31.2, DETAIL_SCALE=1.3, ROOF_OVERHANG=5;
  // The billboard look (docs/art/lowpoly-building-styles.md): every number
  // the ink pass, projection and dressing share, so sprites and meshes keep
  // agreeing. tools/building-billboard-preview.html edits this table live.
  const LOOK={heightScale:.6,inkPx:1,ink:0x2a2229,eaveBand:9,eaveShade:.5,flatRim:3.5,flatShade:9,sheet:768,
    chimney:{radius:4.4,cap:5.8,mouth:3.4,rise:7,capHeight:2.2,sides:0xd9c9b8,capColor:0x9c8f84,mouthColor:0x2a2229},
    wreck:{tint:0xb3a89e,debris:0xb0a59a,beam:0x3b2a1f}};
  const mix=(a,b,t)=>{const c=i=>Math.round(((a>>i)&255)*(1-t)+((b>>i)&255)*t);return (c(16)<<16)|(c(8)<<8)|c(0);};
  const hash=(x,y)=>{let h=(x*374761393+y*668265263)|0;h=(h^(h>>>13))*1274126177;return ((h^(h>>>16))>>>0)/4294967296;};
  // Cell order of assets/Objects/BuildingMaterials/reference-materials-v3.png.
  const MATERIAL_TILE=96,MATERIAL_CELLS=['clay','slate','thatch','shingle','glazed','plaster','boards','rubble','brick','clapboard','flagstone','moss'];
  const ROLES={
    plain:{material:'plaster',finish:'cottage',roofMaterial:'slate',stories:2,style:'multistorey'},
    trailer:{material:'timber',finish:'siding',roofMaterial:'shingle',stories:1,style:'adobe',variant:'shallow',sprite:true},
    blacksmith:{material:'brick',finish:'workshop',roofMaterial:'slate',stories:1,style:'brick',chimneys:2,chimneyScale:1.5},
    trader:{material:'plaster',finish:'plaster',roofMaterial:'flat',stories:2,style:'multistorey',terraced:true},
    shop:{material:'plaster',finish:'plaster',roofMaterial:'flat',stories:2,style:'multistorey',terraced:true},
    seed:{material:'plaster',finish:'plaster',roofMaterial:'thatch',stories:1,style:'adobe'},
    supply:{material:'clapboard',finish:'siding',roofMaterial:'flat',stories:2,style:'whitewash',variant:'flat'},
    potion:{material:'darkstone',finish:'plaster',roofMaterial:'redtile',stories:2,style:'pyramid',variant:'inset'},
    relic:{material:'cobble',finish:'masonry',roofMaterial:'redtile',stories:1,style:'pyramid',variant:'inset'},
    pet:{material:'timber',finish:'siding',roofMaterial:'thatch',stories:1,style:'japanese'},
    book:{material:'brick',finish:'masonry',roofMaterial:'clay',stories:2,style:'japanese'},
    wizard:{material:'stone',finish:'tower',roofMaterial:'slate',stories:3,style:'pyramid',shape:'wizard'},
    turret:{material:'stone',finish:'tower',roofMaterial:'slate',stories:1,style:'fort',shape:'turret'},
    wreck:{material:'timber',finish:'cottage',roofMaterial:'slate',stories:1,style:'ruin',shape:'wreck'},
  };
  function recipeFor(role,palette={},stories){
    const spec=ROLES[role]||ROLES.plain,base=BuildingStyles.STYLES[spec.style];
    const recipe={...spec,role,body:palette.wall??base.wall,roof:palette.roof??base.roof,
      trim:palette.trim??0x614534,stories:stories||spec.stories};
    if(role==='wreck'){const char=c=>((Math.round((c>>16)*.65)<<16)|(Math.round(((c>>8)&255)*.65)<<8)|Math.round((c&255)*.65));recipe.body=char(recipe.body);recipe.roof=char(recipe.roof);}
    return recipe;
  }
  const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  function triangulate(input) {
    const ring=input.map(p=>({...p}));
    if(ring.reduce((s,p,i)=>s+p.x*ring[(i+1)%ring.length].y-p.y*ring[(i+1)%ring.length].x,0)<0)ring.reverse();
    let changed=true;
    while(changed&&ring.length>3){changed=false;for(let i=0;i<ring.length;i++){
      if(Math.abs(cross(ring[(i+ring.length-1)%ring.length],ring[i],ring[(i+1)%ring.length]))<1e-8){ring.splice(i,1);changed=true;break;}
    }}
    const pending=ring.slice(),triangles=[];
    while(pending.length>3){let found=false;for(let i=0;i<pending.length;i++){
      const a=pending[(i+pending.length-1)%pending.length],b=pending[i],c=pending[(i+1)%pending.length];
      if(cross(a,b,c)<=1e-8)continue;
      if(pending.some(p=>p!==a&&p!==b&&p!==c&&cross(a,b,p)>=-1e-8&&cross(b,c,p)>=-1e-8&&cross(c,a,p)>=-1e-8))continue;
      triangles.push([a,b,c]);pending.splice(i,1);found=true;break;
    }if(!found)return {ring,triangles:[]};}
    if(pending.length===3)triangles.push(pending);
    return {ring,triangles};
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
  function buildGeometry(input,variant='ridge',height=29,overhang=0,chimneys=null){
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
    planes.push({x:0,y:0,c:variant==='flat'?0:variant==='inset'?8:variant==='shallow'?5:28});
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
      for(let j=1;j<poly.length-1;j++)add([poly[0],poly[j],poly[j+1]].map(p=>({...p,z:roofZ(p),u:p.x*ux+p.y*uy-bounds[0][0],v:roofV(p)})),'roof',light);
    }
    const roofTriangles=faces.length;
    let entranceEdge=edge;
    ring.forEach((p,i)=>{const q=ring[(i+1)%ring.length],a=ring[entranceEdge],b=ring[(entranceEdge+1)%ring.length];
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
      const span=length/DETAIL_SCALE,start=i===entranceEdge?253.5-span/2:length<22?110:0;
      const outline=[{x:0,y:0},{x:length,y:0},...cuts.slice().reverse().map(t=>({x:t*length,y:roofZ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t})}))];
      for(const tri of triangulate(outline).triangles){add(tri.map(p=>({
        x:a.x+(b.x-a.x)*p.x/length,y:a.y+(b.y-a.y)*p.x/length,z:p.y,
        u:start+p.x/DETAIL_SCALE,v:height+28-p.y
      })),'wall');faces.at(-1).wallDirection={x:b.x-a.x,y:b.y-a.y};}
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
    let chimneyAt=null,chimneyLength=0,chimneyLine=null;
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
        const top=c.z+13+C.rise*scale,capZ=top-C.capHeight*scale,body=corners(C.radius*scale),lo=Math.min(...body.map(roofZ))-1;
        const box=(ring,z0,z1,kind,color,layer,textured)=>ring.forEach((a,k)=>{const b=ring[(k+1)%4];
          const uv=p=>textured?{u:4+column*40+k*10+Math.hypot(p.x-a.x,p.y-a.y)/DETAIL_SCALE,v:105+(z1-p.z)/DETAIL_SCALE}:{u:0,v:0};
          for(const tri of [[{...a,z:z0},{...b,z:z0},{...b,z:z1}],[{...a,z:z0},{...b,z:z1},{...a,z:z1}]]){
            add(tri.map(p=>({...p,...uv(p)})),kind,1);Object.assign(faces.at(-1),{color,wallDirection:{x:b.x-a.x,y:b.y-a.y},layer,chimney:true,inkGroup:2,rawUV:textured||undefined});}});
        box(body,lo,capZ,'wall',C.sides,2.6,true);
        const cap=corners(C.cap*scale);box(cap,capZ,top,'trim',C.capColor,2.62,false);
        for(const tri of [[0,1,2],[0,2,3]]){add(tri.map(k=>({...cap[k],z:top,u:0,v:0})),'trim',1);Object.assign(faces.at(-1),{color:C.capColor,layer:2.7,chimney:true,inkGroup:2});}
        const mouth=corners(C.mouth*scale);
        for(const tri of [[0,1,2],[0,2,3]]){add(tri.map(k=>({...mouth[k],z:top+.01,u:0,v:0})),'trim',1);Object.assign(faces.at(-1),{color:C.mouthColor,layer:2.71,chimney:true,inkGroup:2});}
      };
      (count>1?[.26,.74]:[.28]).forEach((t,i)=>stack(chimneyLine.at(chimneyLine.t0+(chimneyLine.t1-chimneyLine.t0)*t,0),i));
    }
    return {ring,roofRing,actualOverhang,faces,roofTriangles,wallTriangles,trimTriangles:faces.length-roofTriangles-wallTriangles,height,roofZ,ridge:{x:ux,y:uy}};
  }
  const meshCache=new Map();
  function geometry(input,variant='ridge',height=29,overhang=0,chimneys=null){
    const key=variant+':'+height+':'+overhang+':'+(chimneys?chimneys.count+'x'+chimneys.scale:'')+':'+input.map(p=>p.x.toFixed(4)+','+p.y.toFixed(4)).join(';');
    if(meshCache.has(key))return meshCache.get(key);
    const mesh=buildGeometry(input,variant,height,overhang,chimneys);
    if(meshCache.size>=96)meshCache.delete(meshCache.keys().next().value);
    meshCache.set(key,mesh);return mesh;
  }
  // Use the imported style silhouettes, but omit their geometric surface marks.
  // Adjacent parapet segments share interior walls; cancel those before submission.
  function styleGeometry(points,styleId,recipe){
    // A tiny notch must not collapse every roof band into a broad trim cap.
    if((styleId==='pyramid'||styleId==='japanese')&&!BuildingStyles.inset(points,3))
      return geometry(points,styleId==='pyramid'?'inset':'ridge',recipe.stories*FLOOR_HEIGHT+5);
    const base=BuildingStyles.STYLES[styleId]||BuildingStyles.STYLES.adobe;
    const scale=styleId==='ruin'?1.5:(recipe.stories*FLOOR_HEIGHT+5)/(base.height*(styleId==='multistorey'?2:1));
    const cacheKey='style:'+styleId+':'+scale+':'+JSON.stringify(recipe)+':'+points.map(p=>p.x.toFixed(4)+','+p.y.toFixed(4)).join(';');
    if(meshCache.has(cacheKey))return meshCache.get(cacheKey);
    const model=BuildingStyles.build(points,styleId,{geometryOnly:true,scale,upperSetback:recipe.terraced?24:undefined,palette:{wall:recipe.body,roof:recipe.roof,trim:recipe.trim}});
    const faces=[],quads=new Map();
    const add=(p,kind,color,layer)=>{
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
      faces.push({points:p,kind,light,color,layer:layer+(kind==='wall'?0.001:0)});
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
        const p=[{...a,z:prism.bottom,u:0},{...b,z:prism.bottom,u:length/DETAIL_SCALE},{...c,z:prism.top,u:length/DETAIL_SCALE},{...d,z:prism.top,u:0}];
        p.forEach(v=>{v.v=105-v.z;if(slope){v.u=v.x;v.v=v.y;}});
        const key=p.map(v=>[v.x,v.y,v.z].map(n=>n.toFixed(5)).join(',')).sort().join(';');
        if(quads.has(key))quads.set(key,null);else quads.set(key,{p,kind,color:trim?recipe.trim:null,layer:prism.bottom});
      }
      if(prism.capped){for(const tri of triangulate(upper).triangles){
        const kind=trim&&!recipe.terraced?'trim':'roof';
        // A terrace cap sorts below walls rising from the same height.
        add(tri.map(p=>({...p,z:prism.top,u:p.x,v:p.y})),kind,kind==='trim'?recipe.trim:null,prism.top-.01);
        if(kind==='roof'&&recipe.roofMaterial==='flat')Object.assign(faces.at(-1),{solid:true,light:1,inkGroup:1});
      }
      }
    }
    for(const quad of quads.values())if(quad){const {p,kind,color,layer}=quad;add([p[0],p[1],p[2]],kind,color,layer);add([p[0],p[2],p[3]],kind,color,layer);}
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
  function specialGeometry(points,recipe){
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
    const key='special:'+recipe.shape+':'+cx+':'+cy+(recipe.shape==='wreck'?':'+points.map(p=>p.x+','+p.y).join(';'):'');
    if(meshCache.has(key))return meshCache.get(key);
    if(recipe.shape==='wreck'){
      const base=geometry(points,'ridge',18,0),mid=(Math.min(...xs)+Math.max(...xs))/2;
      const faces=base.faces.filter(f=>f.kind!=='roof'&&!f.beam&&!f.chimney),breaks=[];
      // Clip the surviving roof as a connected half, rather than dropping whole
      // triangles (which leaves long unsupported spikes along the break).
      for(const f of base.faces.filter(f=>f.kind==='roof')){
        const poly=[];
        f.points.forEach((a,i)=>{const b=f.points[(i+1)%3],da=mid-a.x,db=mid-b.x;
          if(da>=0)poly.push(a);
          if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db),p={};for(const k of ['x','y','z','u','v'])p[k]=a[k]+(b[k]-a[k])*t;poly.push(p);}
        });
        for(let i=1;i<poly.length-1;i++)faces.push({...f,points:[poly[0],poly[i],poly[i+1]]});
        poly.forEach((a,i)=>{const b=poly[(i+1)%poly.length];if(Math.abs(a.x-mid)<1e-6&&Math.abs(b.x-mid)<1e-6)breaks.push([a,b]);});
      }
      // Two-sided timber: a broken eave and bare rafters are seen from both sides.
      const timber=(quad,light)=>{const p=quad.map(q=>({...q,u:0,v:0}));
        for(const tri of [[p[0],p[1],p[2]],[p[0],p[2],p[3]],[p[2],p[1],p[0]],[p[3],p[2],p[0]]])faces.push({points:tri,kind:'trim',color:0x3b2a1f,light,layer:2.5});
      };
      // Roof triangles split the break line; rejoin pieces along one slope.
      const joined=[];
      for(const [a,b] of breaks.map(([a,b])=>a.y<b.y?[a,b]:[b,a]).sort((m,n)=>m[0].y-n[0].y)){
        const last=joined.at(-1),slope=(q,r)=>(r.z-q.z)/(r.y-q.y||1e-9);
        if(last&&Math.abs(last[1].y-a.y)<1e-6&&Math.abs(last[1].z-a.z)<1e-6&&Math.abs(slope(...last)-slope(a,b))<1e-6)last[1]=b;else joined.push([a,b]);
      }
      for(const [a,b] of joined)timber([a,b,{...b,z:b.z-2.4},{...a,z:a.z-2.4}],.6);
      // Rafters follow the lost slope, perpendicular to the ridge.
      const along=base.ridge,across={x:-along.y,y:along.x},inside=p=>{let hit=false;
        points.forEach((a,i)=>{const b=points[(i+1)%points.length];if((a.y>p.y)!==(b.y>p.y)&&p.x<a.x+(b.x-a.x)*(p.y-a.y)/(b.y-a.y))hit=!hit;});return hit;};
      const span=v=>points.map(p=>p.x*v.x+p.y*v.y),[alo,ahi]=[Math.min(...span(along)),Math.max(...span(along))],[clo,chi]=[Math.min(...span(across)),Math.max(...span(across))];
      for(let k=1;k<8;k++){const o=alo+(ahi-alo)*k/8;let run=[];
        const flush=()=>{for(let i=1;i<run.length;i++){const a=run[i-1],b=run[i],w=1.1;
          // One upward strip per run; wound like the roof so it faces the camera.
          let q=[{x:a.x-along.x*w,y:a.y-along.y*w,z:a.z},{x:b.x-along.x*w,y:b.y-along.y*w,z:b.z},{x:b.x+along.x*w,y:b.y+along.y*w,z:b.z},{x:a.x+along.x*w,y:a.y+along.y*w,z:a.z}].map(p=>({...p,u:0,v:0}));
          if(cross(q[0],q[1],q[2])<0)q=q.reverse();
          for(const tri of [[q[0],q[1],q[2]],[q[0],q[2],q[3]]])faces.push({points:tri,kind:'trim',color:0x3b2a1f,light:1,layer:2.5});}run=[];};
        for(let c=clo+.5;c<=chi-.5;c+=1){const p={x:along.x*o+across.x*c,y:along.y*o+across.y*c};
          if(p.x>mid+3&&inside(p)){p.z=base.roofZ(p);
            // Keep only vertices where the slope changes.
            if(run.length>1){const q=run.at(-1),r=run.at(-2);if(Math.abs((q.z-r.z)-(p.z-q.z)*Math.hypot(q.x-r.x,q.y-r.y)/Math.hypot(p.x-q.x,p.y-q.y))<1e-6)run.pop();}
            run.push(p);}else flush();}
        flush();
      }
      // Punch real openings through the surviving roof. Subtract convex boxes
      // from triangles; texture UVs interpolate at the cut, with no sampled grid.
      const cut=(poly,axis,bound,side)=>{
        const out=[];poly.forEach((a,i)=>{const b=poly[(i+1)%poly.length],da=(a[axis]-bound)*side,db=(b[axis]-bound)*side;
          if(da>=-1e-8)out.push(a);
          if((da<0&&db>0)||(da>0&&db<0)){const t=da/(da-db),p={};for(const k of ['x','y','z','u','v'])p[k]=a[k]+(b[k]-a[k])*t;out.push(p);}
        });return out;
      };
      const roofHoles=[],candidates=faces.filter(f=>f.kind==='roof').sort((a,b)=>Math.abs(cross(...b.points))-Math.abs(cross(...a.points)));
      for(const f of candidates){
        const c={x:f.points.reduce((n,p)=>n+p.x,0)/3,y:f.points.reduce((n,p)=>n+p.y,0)/3};
        const clearance=Math.min(...f.points.map((a,i)=>{const b=f.points[(i+1)%3];return Math.abs(cross(a,b,c))/Math.hypot(b.x-a.x,b.y-a.y);}));
        const r=Math.min(12,clearance*.65);
        if(r<2.5||roofHoles.some(h=>Math.hypot(c.x-h.cx,c.y-h.cy)<r+h.r+10))continue;
        roofHoles.push({cx:c.x,cy:c.y,r,x0:c.x-r,y0:c.y-r*.8,x1:c.x+r,y1:c.y+r*.8});
        if(roofHoles.length===2)break;
      }
      let damaged=faces;
      for(const hole of roofHoles){const next=[];
        for(const f of damaged){if(f.kind!=='roof'||Math.max(...f.points.map(p=>p.x))<=hole.x0||Math.min(...f.points.map(p=>p.x))>=hole.x1||Math.max(...f.points.map(p=>p.y))<=hole.y0||Math.min(...f.points.map(p=>p.y))>=hole.y1){next.push(f);continue;}
          let inside=f.points;
          for(const [axis,bound,side] of [['x',hole.x0,1],['x',hole.x1,-1],['y',hole.y0,1],['y',hole.y1,-1]]){
            const outside=cut(inside,axis,bound,-side);
            for(let i=1;i<outside.length-1;i++)if(Math.abs(cross(outside[0],outside[i],outside[i+1]))>1e-8)next.push({...f,points:[outside[0],outside[i],outside[i+1]]});
            inside=cut(inside,axis,bound,side);if(!inside.length)break;
          }
        }damaged=next;
      }
      // Bites along the straight break so the surviving roof reads torn.
      const ys=points.map(p=>p.y),ylo=Math.min(...ys),yhi=Math.max(...ys),bites=[];
      for(let k=0;k<5;k++){const n=hash(k,7),y=ylo+(yhi-ylo)*(.1+.8*k/4)+(n-.5)*6,r=5+n*6;bites.push({x0:mid-r*1.4,x1:mid+r*1.4,y0:y-r,y1:y+r});}
      for(const hole of bites){const next=[];
        for(const f of damaged){if(f.kind!=='roof'||Math.max(...f.points.map(p=>p.x))<=hole.x0||Math.min(...f.points.map(p=>p.x))>=hole.x1||Math.max(...f.points.map(p=>p.y))<=hole.y0||Math.min(...f.points.map(p=>p.y))>=hole.y1){next.push(f);continue;}
          let inside=f.points;
          for(const [axis,bound,side] of [['x',hole.x0,1],['x',hole.x1,-1],['y',hole.y0,1],['y',hole.y1,-1]]){
            const outside=cut(inside,axis,bound,-side);
            for(let i=1;i<outside.length-1;i++)if(Math.abs(cross(outside[0],outside[i],outside[i+1]))>1e-8)next.push({...f,points:[outside[0],outside[i],outside[i+1]]});
            inside=cut(inside,axis,bound,side);if(!inside.length)break;
          }
        }damaged=next;
      }
      // The open half shows soot-dark but still textured interior walls.
      for(const f of base.faces.filter(f=>f.kind==='wall'))damaged.push({...f,interior:true,light:.55,points:[...f.points].reverse()});
      // Fallen tiles litter the floor: the roof sheet, lightened, reads as rubble.
      for(const tri of triangulate(points).triangles)damaged.push({kind:'roof',debris:true,layer:-1,color:LOOK.wreck.debris,light:.9,points:tri.map(p=>({...p,z:0,u:p.x*1.7,v:p.y*1.7}))});
      // Fallen beams lie across the open half.
      for(let k=0;k<3;k++){const n=hash(k,3),x=mid+8+n*18,y=ylo+8+(yhi-ylo-16)*hash(k,5),a=n*Math.PI,L=14+n*10,w=1.4,dx=Math.cos(a),dy=Math.sin(a);
        let q=[{x:x-dy*w,y:y+dx*w},{x:x+dx*L-dy*w,y:y+dy*L+dx*w},{x:x+dx*L+dy*w,y:y+dy*L-dx*w},{x:x+dy*w,y:y-dx*w}];if(cross(q[0],q[1],q[2])<0)q=q.reverse();
        for(const tri of [[q[0],q[1],q[2]],[q[0],q[2],q[3]]])damaged.push({kind:'trim',layer:-.5,color:LOOK.wreck.beam,light:1,points:tri.map(p=>({...p,z:1.2,u:0,v:0}))});}
      const mesh={...base,faces:damaged,roofHoles,roofTriangles:damaged.filter(f=>f.kind==='roof').length,trimTriangles:damaged.filter(f=>f.kind==='trim').length,damaged:true};
      if(meshCache.size>=96)meshCache.delete(meshCache.keys().next().value);meshCache.set(key,mesh);return mesh;
    }
    const faces=[],wizard=recipe.shape==='wizard',radius=wizard?23:26,h=wizard?78:34;
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
        push([{...a,z:h,u:0,v:42},{...b,z:h,u:width,v:42},{x:cx,y:cy,z:h+43,u:width/2,v:0}],'roof',h+1,.8-(a.x-cx)/radius*.2);
      });
    }else{
      // Eight crenels, including the four corners, on a compact castle shell.
      const lo=cx-radius/Math.sqrt(2),top=cy-radius/Math.sqrt(2),side=radius*Math.sqrt(2),w=8;
      for(const [u,v] of [[0,0],[.5,0],[1,0],[1,.5],[1,1],[.5,1],[0,1],[0,.5]]){
        const x=lo+u*(side-w),y=top+v*(side-w);
        prism([{x,y},{x:x+w,y},{x:x+w,y:y+w},{x,y:y+w}],h,h+8,'trim');
      }
    }
    const mesh={ring,faces,height:h+(wizard?43:8),eaveHeight:h,uvBaseline:true,
      roofTriangles:faces.filter(f=>f.kind==='roof').length,wallTriangles:faces.filter(f=>f.kind==='wall').length,trimTriangles:faces.filter(f=>f.kind==='trim').length};
    if(meshCache.size>=96)meshCache.delete(meshCache.keys().next().value);meshCache.set(key,mesh);return mesh;
  }
  // Material sheets cut from the pixel tileset (pixel-tileset-v3.png), the
  // painterly sheet (painterly-tileset-v1.png) and the generated seamless
  // atlas (reference-materials-v3.png), in the exact layout atlasFaces
  // expects: 512-basis ground line 105, 24-texel floors, 39-texel bays, the
  // door bay centred at 255.5, roof region from 128 with a 360 period. The
  // sheet is LOOK.sheet pixels square; UVs are normalised, so that number is
  // texel density alone (768 puts one texel near one art pixel).
  const SHEET_SRC={bands:{top:[167,247],mid:[247,322],bot:[322,399]},
    walls:{plaster:{src:'px',window:['top',212,317],plain:['mid',170,300],door:['bot',215,320]},
      timber:{src:'px',window:['mid',0,130],plain:['mid',0,130],door:['bot',55,160]},
      brick:{src:'px',window:['bot',400,500],plain:['mid',410,540],door:['bot',465,575],zoom:1.35},
      stone:{src:'px',window:['top',625,715],plain:['mid',605,715],door:['bot',625,705]},
      darkstone:{src:'paint',window:[100,70,335,230],plain:[100,0,335,110],doorInset:[340,20,398,205]},
      cobble:{src:'paint',window:[0,235,130,390],plain:[0,235,130,390],doorInset:[405,20,462,205]},
      clapboard:{src:'atlas',cell:[1,2]}},
    // rect [x0,y0,x1,y1] and the 512-basis tile size; both sizes divide 360.
    roofs:{thatch:{src:'px',rect:[215,418,388,446],tile:[120,19.5]},shingle:{src:'px',rect:[215,462,388,513],tile:[120,36]},slate:{src:'px',rect:[100,527,396,596],tile:[180,40]},
      redtile:{src:'paint',rect:[195,240,380,385],tile:[60,45]},glazed:{src:'atlas',cell:[0,1],tile:[60,60]}}};
  SHEET_SRC.roofs.clay=SHEET_SRC.roofs.shingle;
  const SHEET_IMAGES={px:'pixel_tileset_v3',paint:'painterly_tileset_v1',atlas:'reference_materials_v3'};
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
    const wreck=recipe.shape==='wreck',S=LOOK.sheet,key='lowpoly:tileset-v1:'+wallId+':'+roofId+':'+S+(wreck?':wreck':'')+(recipe.blank?':blank':'');
    if(scene.textures.exists(key))return scene.textures.get(key);
    const img={};for(const [k,name] of Object.entries(SHEET_IMAGES))img[k]=scene.textures.get(name).getSourceImage();
    const K=S/512,tex=scene.textures.createCanvas(key,S,S),ctx=tex.getContext();
    const T=(x,y,w,h)=>[Math.round(x*K),Math.round(y*K),Math.round(w*K),Math.round(h*K)];
    const bay=(spec,kind,bx,by)=>{
      const [dx,dy,dw,dh]=T(bx,by,39,24);
      ctx.imageSmoothingEnabled=spec.src==='paint';
      if(spec.src==='px'){
        const [band,x0,x1]=spec[kind],[y0,y1]=SHEET_SRC.bands[band],z=spec.zoom||1,cw=(x1-x0)/z,ch=(y1-y0)/z;
        ctx.drawImage(img.px,(x0+x1)/2-cw/2,(y0+y1)/2-ch/2,cw,ch,dx,dy,dw,dh);
      }else if(spec.src==='paint'){
        const r=spec[kind==='door'?'plain':kind]||spec.plain;ctx.drawImage(img.paint,r[0],r[1],r[2]-r[0],r[3]-r[1],dx,dy,dw,dh);
        if(kind==='window'){ctx.fillStyle='#ffffff';ctx.fillRect(...T(bx+14,by+6,10,11));} // glass via paintOpenings
        if(kind==='door'&&spec.doorInset){const w=spec.doorInset,[ix,iy,iw,ih]=T(bx+12.5,by+4,14,20);ctx.drawImage(img.paint,w[0],w[1],w[2]-w[0],w[3]-w[1],ix,iy,iw,ih);}
      }else{ // seamless atlas cell, then white openings for paintOpenings to dress
        const [c,r]=spec.cell;ctx.drawImage(img.atlas,c*MATERIAL_TILE,r*MATERIAL_TILE,MATERIAL_TILE,59,dx,dy,dw,dh);ctx.fillStyle='#ffffff';
        if(kind==='window')ctx.fillRect(...T(bx+14,by+6,10,12));if(kind==='door')ctx.fillRect(...T(bx+12,by+5,15,19));
      }
    };
    const wall=SHEET_SRC.walls[wallId];
    ctx.save();ctx.beginPath();ctx.rect(0,0,S,128*K);ctx.clip();
    for(let k=-1;k<=12;k++)bay(SHEET_SRC.walls.stone,'plain',2+39*k,105); // plinth; chimney sides sample it
    for(let floor=0;floor<3;floor++)for(let k=-1;k<=12;k++)bay(wall,recipe.blank?'plain':floor===0&&k===6?'door':'window',2+39*k,105-24*(floor+1));
    ctx.restore();
    paintOpenings(ctx,S,Math.round(128*K),wreck);
    const roof=SHEET_SRC.roofs[roofId],[tw,th]=roof.tile;
    ctx.save();ctx.beginPath();ctx.rect(0,128*K,S,S-128*K);ctx.clip();ctx.imageSmoothingEnabled=roof.src==='paint';
    for(let y=128;y<512;y+=th)for(let x=0;x<512;x+=tw){
      const dx=Math.round(x*K),dy=Math.round(y*K),dw=Math.ceil(tw*K),dh=Math.ceil(th*K);
      if(roof.src==='atlas')ctx.drawImage(img.atlas,roof.cell[0]*MATERIAL_TILE,roof.cell[1]*MATERIAL_TILE,MATERIAL_TILE,MATERIAL_TILE,dx,dy,dw,dh);
      else ctx.drawImage(img[roof.src],roof.rect[0],roof.rect[1],roof.rect[2]-roof.rect[0],roof.rect[3]-roof.rect[1],dx,dy,dw,dh);
    }
    ctx.restore();
    if(wreck){ // soot under every floor beam, moss at the footing, missing tiles
      for(let floor=0;floor<3;floor++){const y=105-24*(floor+1);
        for(let x=-37;x<512;x+=7){const n=hash(x,floor);if(n<.35)continue;ctx.fillStyle=`rgba(20,16,14,${.35+n*.3})`;ctx.fillRect(...T(x,y,7,3+n*4));}}
      for(let x=-37;x<512;x+=5){const n=hash(x,9);if(n<.4)continue;ctx.fillStyle='rgba(74,96,52,.75)';ctx.fillRect(...T(x,103-n*2,5,2+n*2));}
      for(let y=130;y<512;y+=31)for(let x=3;x<512;x+=47){const n=hash(x,y);if(n<.55)continue;ctx.fillStyle='#262120';ctx.fillRect(...T(x+n*20,y+n*9,6+n*4,4+n*3));}
    }
    ctx.fillStyle='#ffffff';ctx.fillRect(Math.floor(508*K),Math.floor(124*K),Math.ceil(4*K),Math.ceil(4*K)); // shared solid texel
    tex.refresh();tex.setFilter(Phaser.Textures.FilterMode.NEAREST);return tex;
  }
  const tilesetReady=scene=>Object.values(SHEET_IMAGES).every(name=>scene.textures.exists(name));
  // Stories and footprint are UV choices, not new texture allocations. All
  // buildings with a material/palette share this three-storey facade sheet.
  // With the tilesets loaded the sheet is cut from them; the generated
  // marks below remain the fallback (forts, headless review, missing art).
  function material(scene,recipe){
    if(recipe.role!=='fort'&&tilesetReady(scene))return tilesetSheet(scene,recipe);
    const source=recipe.role!=='fort'&&scene.textures.exists('building_material_reference')?scene.textures.get('building_material_reference').getSourceImage():null;
    const key=(source?'generated:':'fallback:')+'lowpoly:materials-v13:'+JSON.stringify([recipe.material,recipe.body,recipe.trim,recipe.roof,recipe.finish,recipe.roofMaterial,recipe.role==='fort',recipe.shape,recipe.terraced]);
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
        ctx.globalAlpha=.14;rect(x+1,y+7,9,13,'#292b2b');ctx.globalAlpha=1;
        // Four-pane casement: lit glass, one bright pane, timber cross.
        rect(x-2,y+5,10,13,frame);rect(x-1,y+6,8,10,'#55719f');rect(x-1,y+6,3,4,'#93b0d6');
        rect(x+2,y+6,1.2,10,css(recipe.trim));rect(x-1,y+10,8,1.2,css(recipe.trim));
        rect(x-2,y+17,10,1.2,sill);ctx.globalAlpha=.2;rect(x-1,y+18,9,1,'#282c2c');ctx.globalAlpha=1;
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
  function active(scene){return !!scene._headingUp&&scene.game?.renderer?.type===2;}
  function begin(scene){
    if(!scene._lowpoly){
      const obj=scene.add.graphics();scene.buildingWallContainer.add(obj);
      const state=scene._lowpoly={obj,buildings:[],faces:[],builds:0,angle:NaN};
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
          const tint=Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha(LOOK.ink,camera.alpha*src.alpha);
          for(const [ox,oy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]])for(const f of group){
            if(pipeline.shouldFlush(3))pipeline.flush();
            const unit=pipeline.setTexture2D(f.texture.source[0].glTexture);
            for(let i=0;i<3;i++){const p=f.projected[i];pipeline.batchVert(matrix.getX(p.x,p.y)+ox*px,matrix.getY(p.x,p.y)+oy*px,tu,tv,unit,0,tint);}
          }
        };
        const paint=(group)=>{for(const f of group){
          if(pipeline.shouldFlush(3))pipeline.flush();
          const unit=pipeline.setTexture2D(f.texture.source[0].glTexture);
          // Flat, three-step cel lighting keeps gradients off the pixel palette.
          let shade=f.light<.65?140:f.light<.88?199:255;
          if(f.eaveShadow)shade=Math.round(shade*LOOK.eaveShade);
          const color=f.color??0xffffff;
          const litColor=(((color>>16)*shade/255)<<16)|((Math.round(((color>>8)&255)*shade/255))<<8)|Math.round((color&255)*shade/255);
          const tint=Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha(litColor,camera.alpha*src.alpha);
          for(let i=0;i<3;i++){
            const p=f.projected[i];
            const contact=f.kind==='wall'&&!f.preserveWalls?1-.22*Math.min(1,f.points[i].z/Math.max(1,f.eaveHeight)):1;
            const wallTint=contact===1?tint:Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha(
              (Math.round(shade*contact)<<16)|(Math.round(shade*contact)<<8)|Math.round(shade*contact),camera.alpha*src.alpha);
            pipeline.batchVert(matrix.getX(p.x,p.y),matrix.getY(p.x,p.y),p.u,p.v,unit,0,wallTint);
          }
        }};
        let group=[],support=null,groupId=0;
        const flush=()=>{if(!group.length)return;if(LOOK.inkPx>0)ink(group);paint(group);group=[];};
        for(const f of state.faces){
          if(!f.visible)continue;
          const g=f.inkGroup||0;
          if(f.support!==support||g!==groupId){flush();support=f.support;groupId=g;}
          group.push(f);
        }
        flush();
        renderer.pipelines.postBatch(src);
      };
      scene.events?.once('shutdown',()=>{for(const key of state.textures||[])scene.textures.remove(key);scene._lowpoly=null;});
    }
    const state=scene._lowpoly;state.buildings=[];state.faces=[];state.keys=new Set();state.angle=NaN;state.builds++;
    state.obj.visible=true;return state;
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
      if(f.kind!=='wall'||f.interior||f.chimney)return [f];
      const zs=f.points.map(p=>p.z),top=Math.max(...zs),bottom=Math.min(...zs),L=levels.find(l=>Math.abs(l-top)<.6);
      if(L==null||bottom>L-LOOK.eaveBand)return [f];
      const upper=cutZ(f.points,L-LOOK.eaveBand,1),lower=cutZ(f.points,L-LOOK.eaveBand,-1),out=[];
      for(const [poly,shadow] of [[lower,false],[upper,true]])for(let i=1;i<poly.length-1;i++)out.push({...f,points:[poly[0],poly[i],poly[i+1]],eaveShadow:shadow||undefined});
      return out;
    });
  }
  function atlasFaces(mesh){
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
      const roof=face.kind==='roof',trim=face.kind==='trim'||!!face.solid,raw=!!face.rawUV;
      const points=face.points.map(p=>({...p,
        tu:trim?510:raw?p.u:roof?p.u/DETAIL_SCALE:p.u,
        tv:trim?126:raw?p.v:roof?p.v/DETAIL_SCALE:105-(105-p.v-vOffset)/DETAIL_SCALE}));
      let polys=[points];
      if(!trim&&!raw){
        // Roof period is three complete 96px material tiles; facade period is
        // twelve complete 39px bays. Never stretch to fit an atlas rectangle.
        polys=wrap(polys,'tu',roof?511:507,roof?288:468);
        polys=wrap(polys,'tv',roof?383:123,roof?288:72);
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
  function add(scene,pts,recipe,variant,key){
    const state=scene._lowpoly,left=Math.min(...pts.map(p=>p.x)),top=Math.min(...pts.map(p=>p.y));
    const local=pts.map(p=>({x:p.x-left,y:p.y-top}));
    const cached=recipe.shape?specialGeometry(local,recipe):recipe.terraced?styleGeometry(local,recipe.style,recipe):recipe.style&&typeof BuildingStyles!=='undefined'&&!variant
      ?styleGeometry(local,recipe.style,recipe):geometry(local,variant||'ridge',recipe.stories*FLOOR_HEIGHT+5,ROOF_OVERHANG,recipe.chimneys?{count:recipe.chimneys,scale:recipe.chimneyScale||1}:null);
    const mesh={...cached,faces:atlasFaces(cached)};
    mesh.roofTriangles=mesh.faces.filter(f=>f.kind==='roof').length;mesh.wallTriangles=mesh.faces.filter(f=>f.kind==='wall').length;mesh.trimTriangles=mesh.faces.filter(f=>f.kind==='trim').length;
    const texture=material(scene,recipe);(state.textures||=new Set()).add(texture.key);
    mesh.role=recipe.role;mesh.x=left;mesh.y=top;state.buildings.push(mesh);if(key&&mesh.faces.length)state.keys.add(key);
    const support={x:left+local.reduce((s,p)=>s+p.x,0)/local.length,y:top+local.reduce((s,p)=>s+p.y,0)/local.length,order:state.buildings.length};
    for(const face of mesh.faces){
      if(face.rim)face.color=mix(recipe.roof,0xf3e6c8,.5);else if(face.rimShade)face.color=mix(recipe.roof,0x2a2229,.22);else if(face.solid)face.color=recipe.roof;
      else if(face.kind==='trim'&&face.color==null)face.color=recipe.trim;
      else if(recipe.shape==='wreck'&&(face.kind==='wall'||face.kind==='roof')&&!face.debris&&!face.chimney)face.color=LOOK.wreck.tint;
      face.preserveWalls=recipe.role==='fort'||!!face.chimney;face.eaveHeight=mesh.eaveHeight??mesh.height;face.support=support;face.cottage=recipe.finish==='cottage';face.texture=texture;face.vOffset=mesh.uvBaseline?0:77-mesh.height;face.x=left;face.y=top;face.projected=face.points.map(()=>({}));state.faces.push(face);}
    return mesh;
  }
  function update(scene){const state=scene._lowpoly;if(!state)return;state.obj.visible=active(scene)&&(scene.depth??0)===0;
    const angle=scene.mapRot||0;if(state.angle===angle)return;state.angle=angle;
    const c=Math.cos(angle),s=Math.sin(angle);
    for(const face of state.faces){let depth=0;
      // Height projects screen-up, foreshortened like the billboard sprites.
      face.points.forEach((p,i)=>{const v=face.projected[i];v.x=face.x+p.x-s*p.z*LOOK.heightScale;v.y=face.y+p.y-c*p.z*LOOK.heightScale;v.u=p.tu;v.v=p.tv;depth+=s*(face.x+p.x)+c*(face.y+p.y);});
      if(face.kind==='trim'||face.solid)for(const p of face.projected){p.u=510/512;p.v=126/512;}
      face.support.depth=s*face.support.x+c*face.support.y;
      face.depth=depth/3;
      if((face.kind==='wall'&&!face.interior)||(face.kind==='trim'&&face.wallDirection)){const a=face.points[0],b=face.points[1],dx=face.wallDirection?.x??b.x-a.x,dy=face.wallDirection?.y??b.y-a.y,len=Math.hypot(dx,dy)||1;face.light=.76+.23*(c*dx-s*dy)/-len;}
      const p=face.projected;face.visible=cross(p[0],p[1],p[2])>1e-8;
    }
    state.faces.sort((a,b)=>a.support.depth-b.support.depth||a.support.order-b.support.order||(a.layer??0)-(b.layer??0)||a.depth-b.depth);
  }
  function clear(scene){if(scene._lowpoly){scene._lowpoly.faces=[];scene._lowpoly.keys.clear();scene._lowpoly.obj.visible=false;}}
  const covers=(scene,o)=>active(scene)&&scene._lowpoly?.obj.visible&&!!scene._lowpoly?.keys.has(o.id);
  global.BuildingLowPoly={LOOK,atlasFaces,ROLES,recipeFor,specialGeometry,styleGeometry,geometry,triangulate,active,begin,add,update,clear,covers};
})(window);
