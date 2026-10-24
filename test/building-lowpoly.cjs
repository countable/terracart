const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/polygon_geometry.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('src/building_lowpoly.js','utf8'),ctx);
const api=ctx.window.BuildingLowPoly,fixtures=require('../tools/building-roof-fixtures.js');
const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-a.y*b.x;},0))/2;
const rows=[];
for(const fixture of fixtures)for(const variant of ['ridge','inset','shallow','flat']){
 const pts=fixture.points.map(([x,y])=>({x,y})),m=api.geometry(pts,variant,77);
 assert(Math.abs(m.faces.filter(f=>f.kind==='roof').reduce((n,f)=>n+area(f.points),0)-area(pts))<1e-5,'exact footprint area');
 assert(m.roofTriangles<200,'bounded roof budget');
 // Only a ridge beam (1) or chimney stack (LOOK.chimney.above + rise) may rise above the ridge.
 for(const f of m.faces)for(const p of f.points)assert(Number.isFinite(p.z)&&p.z>=0&&p.z<=105+(f.chimney?api.LOOK.chimney.above+1+api.LOOK.chimney.rise+.05:f.beam?1:0));
 for(let angle=0;angle<Math.PI*2;angle+=.13)for(const f of m.faces.filter(f=>f.kind==='roof')){
  const p=f.points.map(v=>({x:v.x-Math.sin(angle)*v.z,y:v.y-Math.cos(angle)*v.z}));assert((p[1].x-p[0].x)*(p[2].y-p[0].y)-(p[1].y-p[0].y)*(p[2].x-p[0].x)>1e-10,'no folded or degenerate rotated roof');
 }
 const reversed=api.geometry([...pts].reverse(),variant,77);assert.equal(reversed.roofTriangles,m.roofTriangles);
 if(variant==='ridge')rows.push({fixture:fixture.name,roof:m.roofTriangles,walls:m.wallTriangles});
}
console.table(rows);console.log('24 low-poly cases: exact area, bounded counts/heights, winding, full compass sweep passed.');
vm.runInContext(fs.readFileSync('src/building_styles.js','utf8'),ctx);
ctx.BuildingStyles=ctx.window.BuildingStyles;
const styles=[];
for(const style of Object.keys(ctx.BuildingStyles.STYLES)){
 let maximum=0;
 for(const fixture of fixtures){
  const points=fixture.points.map(([x,y])=>({x,y})),palette=ctx.BuildingStyles.STYLES[style];
  const recipe={style,material:'plaster',body:palette.wall,roof:palette.roof,trim:palette.trim,stories:style==='multistorey'?2:1};
  const mesh=api.styleGeometry(points,style,recipe);
  assert(mesh.faces.length>0,style+' renders');assert(mesh.faces.length<800,style+' bounded silhouette budget');
  assert(mesh.faces.every(f=>f.points.every(p=>[p.x,p.y,p.z,p.u,p.v].every(Number.isFinite))),style+' finite mesh');
  assert.equal(api.styleGeometry(points,style,recipe),mesh,'style geometry reuses cache');
  maximum=Math.max(maximum,mesh.faces.length);
 }
 styles.push({style,maxTriangles:maximum});
}
console.table(styles);
const overhangRows=[];
for(const fixture of fixtures){
 const pts=fixture.points.map(([x,y])=>({x,y})),before=api.geometry(pts,'ridge',29),mesh=api.geometry(pts,'ridge',36.2,5);
 assert(mesh.actualOverhang>0&&mesh.actualOverhang<=5,'bounded safe overhang');
 assert(area(mesh.roofRing)>area(pts),'roof extends beyond walls');
 assert(Math.abs(mesh.faces.filter(f=>f.kind==='roof').reduce((n,f)=>n+area(f.points),0)-area(mesh.roofRing))<1e-5,'offset roof has no gaps/overlaps');
 assert(mesh.wallTriangles<=before.wallTriangles+12,'only active slopes split walls');
 const timber=mesh.faces.filter(f=>f.beam||f.chimney).length;
 assert(mesh.trimTriangles-timber<=mesh.wallTriangles*2,'bounded fascia budget');
 assert(timber<=160,'bounded ridge beam and chimney budget');
 for(const f of mesh.faces.filter(f=>f.kind==='wall')){
  const [a,b]=f.points;
  assert(Math.abs(Math.abs(b.u-a.u)*.65-Math.hypot(b.x-a.x,b.y-a.y))<1e-7,'constant wall texel density');
 }
 assert(mesh.roofTriangles<=before.roofTriangles+12,'small overhang triangle budget');
 for(let angle=0;angle<Math.PI*2;angle+=.13)for(const f of mesh.faces.filter(f=>f.kind==='roof')){
  const p=f.points.map(v=>({x:v.x-Math.sin(angle)*v.z,y:v.y-Math.cos(angle)*v.z}));
  assert((p[1].x-p[0].x)*(p[2].y-p[0].y)-(p[1].y-p[0].y)*(p[2].x-p[0].x)>1e-10,'overhang stays unfolded during compass sweep');
 }
 const doorFaces=mesh.faces.filter(f=>f.kind==='wall'&&f.points.some(p=>p.u<253.5)&&f.points.some(p=>p.u>253.5));
 assert(doorFaces.length>0,'entrance bay is sampled');
 overhangRows.push({fixture:fixture.name,before:before.roofTriangles,after:mesh.roofTriangles,overhang:mesh.actualOverhang,walls:mesh.wallTriangles,fascia:mesh.trimTriangles});
}
console.table(overhangRows);
for(const role of Object.keys(api.ROLES)){
 const recipe=api.recipeFor(role),points=fixtures[0].points.map(([x,y])=>({x,y}));
 const mesh=recipe.shape?api.specialGeometry(points,recipe):recipe.terraced?api.styleGeometry(points,recipe.style,recipe):api.geometry(points,recipe.variant||'ridge',recipe.stories*15.6+2.5,5);
 // Keep structural geometry bounded separately from clipped floor shadows.
 assert(mesh.faces.filter(f=>f.castShadow).length<1000,role+' bounded shadows');
 assert(mesh.faces.length>0&&mesh.faces.filter(f=>!f.castShadow).length<(role==='wreck'?700:300),role+' bounded geometry');
 assert(mesh.faces.every(f=>f.points.every(p=>[p.x,p.y,p.z,p.u,p.v].every(Number.isFinite))),role+' finite vertices');
 if(role==='wizard'||role==='turret'){
  const large=api.specialGeometry(points.map(p=>({x:p.x*3,y:p.y*3})),recipe);
  const width=m=>Math.max(...m.ring.map(p=>p.x))-Math.min(...m.ring.map(p=>p.x));
  assert(Math.abs(width(mesh)-width(large))<1e-8,role+' ignores footprint dimensions');
 }
 if(role==='wreck'){assert(!mesh.faces.some(f=>f.standingRoof||f.fallenRoof||f.rafter||f.beam||f.steel),'broken plinth has no roof or framing');assert(mesh.faces.every(f=>f.points.every(p=>p.z>=0&&p.z<=2)),'all wreck geometry stays low');}
}
console.log('All role variants: bounded geometry, footprint-independent towers, broken plinth passed.');
// Every slope is tiled from its own eave (v grows downhill, courses level),
// and a ridge's flat cap continues its near slope without a seam.
for(const fixture of fixtures)for(const variant of ['ridge','shallow','inset']){
 const pts=fixture.points.map(([x,y])=>({x,y})),mesh=api.geometry(pts,variant,36.2,5),uv=new Map();
 const roofs=mesh.faces.filter(f=>f.kind==='roof'),slopes=roofs.filter(f=>f.points.some(p=>Math.abs(p.z-f.points[0].z)>1e-6));
 for(const f of slopes)for(let i=0;i<3;i++){const a=f.points[i],b=f.points[(i+1)%3];
  if(Math.abs(b.z-a.z)>1e-6)assert((b.v-a.v)*(b.z-a.z)<0,variant+': courses point downhill on every slope');}
 if(variant==='inset')continue;
 // The cap continues one slope seamlessly; the other slope's seam (under the
 // ridge beam) is where the course direction turns round.
 const planeOf=f=>{const [a,b,c]=f.points,ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z,nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,sgn=nz<0?-1:1;return (nx*sgn).toFixed(3)+','+(ny*sgn).toFixed(3);};
 for(const f of slopes)for(const p of f.points){const key=[p.x,p.y,p.z].map(n=>n.toFixed(6)).join(',');(uv.get(key)||uv.set(key,[]).get(key)).push({p,plane:planeOf(f)});}
 const matched=new Set(),unmatched=[];
 for(const f of roofs.filter(f=>!slopes.includes(f)))for(const p of f.points){const key=[p.x,p.y,p.z].map(n=>n.toFixed(6)).join(','),shared=uv.get(key);
  if(!shared)continue;const hit=shared.filter(q=>Math.abs(q.p.u-p.u)<1e-5&&Math.abs(q.p.v-p.v)<1e-5);
  if(hit.length)hit.forEach(q=>matched.add(q.plane));else unmatched.push(new Set(shared.map(q=>q.plane)));}
 if(uv.size&&roofs.length>slopes.length){assert(matched.size>=1,variant+': the cap continues a slope');
  for(const planes of unmatched)for(const pl of planes)assert(!matched.has(pl),variant+': a continued slope never has a seam with the cap');}
}
console.log('Roof slope/cap texture continuity passed.');
// Awning skirts: on every sloped face v grows as z falls (courses level, their
// bottoms toward each eave) and the flat cap is a solid, untextured deck.
for(const fixture of fixtures){
 const mesh=api.geometry(fixture.points.map(([x,y])=>({x,y})),'inset',36.2,5);
 const cap=mesh.faces.filter(f=>f.kind==='roof'&&f.solid);assert(cap.length>0,'inset roof has a solid cap');
 for(const f of mesh.faces.filter(f=>f.kind==='roof'&&!f.solid))for(let i=0;i<3;i++){const a=f.points[i],b=f.points[(i+1)%3];
  if(Math.abs(b.z-a.z)>1e-6)assert((b.v-a.v)*(b.z-a.z)<0,'skirt courses point downhill');
  assert(a.u>=-1e-6&&a.v>=-1e-6,'skirt UVs start inside the sheet');}
}
console.log('Awning skirt orientation passed.');

const wreckPoints=[{x:0,y:0},{x:120,y:0},{x:120,y:100},{x:0,y:100}];
const wreck=api.specialGeometry(wreckPoints,api.recipeFor('wreck'));
assert(!wreck.faces.some(f=>f.standingRoof||f.fallenRoof||f.rafter||f.beam||f.steel),'no roof remnants or framing survive');
assert(wreck.faces.every(f=>f.points.every(p=>p.z>=0&&p.z<=2)),'wall crowns and rubble stay at most two pixels high');
assert(wreck.faces.some(f=>f.wallTop),'walls have thickness: broken tops exist');
const crowns=wreck.faces.filter(f=>f.wallTop&&!f.rubble);
assert(crowns.every(f=>f.rawUV),'top faces carry explicit masonry texture coordinates');
assert(new Set(crowns.map(f=>f.points[0].z)).size>1,'broken wall crowns have varied heights');
for(const f of crowns)for(const p of f.points){
 const aligned=wreck.faces.filter(f=>f.wreckMasonry||f.interior).flatMap(f=>f.points).some(q=>Math.abs(p.x-q.x)<1e-6&&Math.abs(p.y-q.y)<1e-6&&Math.abs(p.z-q.z)<1e-6);
 assert(aligned,'wall lids meet their masonry side faces without cracks');
}
// One section of the longest side has fallen entirely: no wall face touches its span.
assert(wreck.gap,'the collapsed end has a breach');
const ga=wreck.gap.o0,gb=wreck.gap.o1,gdx=gb.x-ga.x,gdy=gb.y-ga.y,glen=Math.hypot(gdx,gdy);
const inGap=p=>{const t=((p.x-ga.x)*gdx+(p.y-ga.y)*gdy)/(glen*glen);return t>=-1e-6&&t<=1+1e-6&&Math.abs(gdx*(p.y-ga.y)-gdy*(p.x-ga.x))/glen<4.5;};
assert(!wreck.faces.some(f=>f.kind==='wall'&&f.points.every(inGap)),'the fallen section has no wall');
assert(wreck.faces.some(f=>f.kind==='wall'&&f.points.some(p=>!inGap(p))),'walls outside the breach still stand');
assert(wreck.faces.some(f=>f.interior&&f.rawUV&&new Set(f.points.map(p=>p.u)).size>1),'inner walls have masonry UVs');
// The low masonry must remain attached to angled footprints when the local
// coordinate origin changes, with identical height and damage choices.
const rotated=wreckPoints.map(p=>({x:p.x*.8-p.y*.6,y:p.x*.6+p.y*.8}));
const shifted=rotated.map(p=>({x:p.x+500,y:p.y+300}));
const walls=pts=>api.specialGeometry(pts,api.recipeFor('wreck'),[],'angled').faces.filter(f=>f.wallTop).flatMap(f=>f.points);
const rb=walls(rotated),sb=walls(shifted);
assert(rb.length>0&&rb.length===sb.length,'angled wreck retains the same low walls after translation');
for(let i=0;i<rb.length;i++)assert(Math.abs(sb[i].x-rb[i].x-500)<1e-6&&Math.abs(sb[i].y-rb[i].y-300)<1e-6&&Math.abs(sb[i].z-rb[i].z)<1e-6,'wall prisms remain attached to the footprint');
// Broken plinths retain the complete concave footprint without bridging a
// courtyard or replacing a stepped plan with its bounding rectangle.
const contains=(ring,p)=>{
 for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dy=b.y-a.y;
  if(Math.abs(dx*(p.y-a.y)-dy*(p.x-a.x))<1e-6
    &&(p.x-a.x)*(p.x-b.x)+(p.y-a.y)*(p.y-b.y)<=1e-6)return true;
 }
 let hit=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];
  if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;
 }
 return hit;
};
for(const fixture of fixtures){
 const points=fixture.points.map(([x,y])=>({x,y}));
 const mesh=api.specialGeometry(points,api.recipeFor('wreck'),[],'plinth:'+fixture.name);
 const floor=mesh.faces.filter(f=>f.debris&&!f.castShadow&&f.points.every(p=>p.z===0));
 assert(floor.length>0,fixture.name+': rubble floor exists');
 assert(Math.abs(floor.reduce((sum,f)=>sum+area(f.points),0)-area(points))<1e-5,
  fixture.name+': floor covers the polygon exactly once');
 for(const f of floor){
  // Interior samples catch triangles spanning a concave notch even when all
  // their corner vertices lie on the footprint boundary.
  for(const weights of [[1/3,1/3,1/3],[.5,.5,0],[0,.5,.5],[.5,0,.5]]){
   const p={x:0,y:0};f.points.forEach((q,i)=>{p.x+=q.x*weights[i];p.y+=q.y*weights[i];});
   assert(contains(points,p),fixture.name+': floor triangle does not bridge a courtyard');
  }
 }
 assert(mesh.faces.every(f=>f.points.every(p=>Number.isFinite(p.z)&&p.z>=0&&p.z<=2)),
  fixture.name+': narrow returns never fall back to full-height walls');
 assert(!mesh.faces.some(f=>f.standingRoof||f.fallenRoof||f.rafter||f.beam||f.steel),
  fixture.name+': only masonry and ground rubble remain');
}
// Deterministic breaches survive cache eviction and do not depend on camera
// coordinates. Different houses retain their own broken wall profiles.
const damage=id=>{
 const mesh=api.specialGeometry(wreckPoints,api.recipeFor('wreck'),[],id);
 return JSON.stringify({gap:mesh.gap,walls:mesh.faces.filter(f=>f.wallTop).map(f=>f.points)});
};
const damageBefore=damage('plinth-stable');
for(let i=0;i<100;i++)api.specialGeometry(wreckPoints,api.recipeFor('wreck'),[],'plinth-cache:'+i);
assert.equal(damage('plinth-stable'),damageBefore,'rebuilding after cache eviction preserves gaps and heights');
assert(new Set(Array.from({length:8},(_,i)=>damage('plinth-house:'+i))).size>=4,
 'same-sized houses have distinct deterministic damage');
const thicknesses=[];
for(const f of crowns){
 const [a,b,c]=f.points;
 if(Math.hypot(a.x-b.x,a.y-b.y)<1e-6)continue;
 // The first top triangle follows an outer edge, then crosses the wall.
 if(!wreckPoints.some((p,i)=>{
  const q=wreckPoints[(i+1)%wreckPoints.length];
  const cross=r=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  return Math.abs(cross(a))<1e-6&&Math.abs(cross(b))<1e-6;
 }))continue;
 if(wreckPoints.some(p=>Math.hypot(p.x-b.x,p.y-b.y)<1e-6))continue;
 thicknesses.push(Math.hypot(c.x-b.x,c.y-b.y));
}
assert(thicknesses.length>0&&thicknesses.every(w=>w>=2.5&&w<=3.5),'ordinary wall prisms are about three pixels thick');
// Reusing the same identity with a street on a different side must move
// the opening without changing its broad, unobstructed entrance.
for(const street of [
 [{x:-20,y:-20},{x:140,y:-20}], [{x:140,y:-20},{x:140,y:120}],
 [{x:-20,y:120},{x:140,y:120}], [{x:-20,y:-20},{x:-20,y:120}],
]){
 const streets=[street],expected=api.streetDoor(wreckPoints,streets);
 const mesh=api.specialGeometry(wreckPoints,api.recipeFor('wreck'),streets,'street-wreck');
 const door=mesh.doorway;
 assert(door,'wreck has a street-facing opening');
 assert.equal(door.edge,expected.edge,'opening faces the nearest street');
 const width=Math.hypot(door.o1.x-door.o0.x,door.o1.y-door.o0.y);
 assert(width>=api.DOOR.width,'opening is at least a doorway wide');
 const along=p=>(p.x-door.o0.x)*door.along.x+(p.y-door.o0.y)*door.along.y;
 const across=p=>(p.x-door.o0.x)*door.normal.x+(p.y-door.o0.y)*door.normal.y;
 assert(!mesh.faces.some(f=>f.kind==='wall'&&f.points.every(p=>Math.abs(across(p))<4.5)
  &&Math.min(...f.points.map(along))<width-1e-6&&Math.max(...f.points.map(along))>1e-6),
 'wall masonry does not bridge the street-facing opening');
}
// A narrow return can reject the usual wall-thickness inset. It must not
// restore an intact shell or seal the doorway as a fallback.
for(const coordinates of [
 [[0,0],[100,0],[100,30],[55,30],[55,3],[45,3],[45,30],[0,30]],
 [[0,0],[100,0],[100,3],[0,3]],
]){
 const points=coordinates.map(([x,y])=>({x,y}));
 const mesh=api.specialGeometry(points,api.recipeFor('wreck'),[[{x:0,y:-10},{x:100,y:-10}]],'narrow-street-wreck');
 assert(mesh.doorway,'narrow wreck preserves its street-facing doorway');
 assert(mesh.faces.some(f=>f.wallTop),'narrow wreck retains broken wall tops');
 assert(mesh.faces.every(f=>f.points.every(p=>[p.x,p.y,p.z].every(Number.isFinite))),
  'thin-wall fallback has finite geometry');
 const door=mesh.doorway,width=Math.hypot(door.o1.x-door.o0.x,door.o1.y-door.o0.y);
 const along=p=>(p.x-door.o0.x)*door.along.x+(p.y-door.o0.y)*door.along.y;
 const across=p=>(p.x-door.o0.x)*door.normal.x+(p.y-door.o0.y)*door.normal.y;
 assert(!mesh.faces.some(f=>f.wreckMasonry&&f.points.every(p=>Math.abs(across(p))<1e-6)
  &&Math.min(...f.points.map(along))<width-1e-6&&Math.max(...f.points.map(along))>1e-6),
  'narrow wreck has no facade masonry spanning the doorway');
}
const market=api.recipeFor('trader'),terrace=api.styleGeometry(wreckPoints,market.style,market);
assert(market.terraced&&market.stories===2,'market has a second storey');
const top=terrace.faces.filter(f=>f.kind==='roof'&&f.points.every(p=>p.z>1.5*15.6)).flatMap(f=>f.points);
assert(top.length&&top.every(p=>p.x>0&&p.x<120&&p.y>0&&p.y<100),'upper storey is inset from the footprint');
assert.equal(api.recipeFor('supply').variant,'flat');
console.log('Roof holes and terraced market passed.');
// Openings never sit on a corner: along any wall, a window bay (even bays of
// 39 texels from x=2) is sampled whole or not at all; a cut bay becomes plain.
for(const role of Object.keys(api.ROLES)){
 if(api.ROLES[role].shape)continue;
 for(const pts of [[[0,0],[62,0],[62,41],[0,41]],[[0,0],[150,0],[150,40],[70,40],[70,95],[0,95]],[[0,0],[333,0],[333,210],[0,210]]].map(r=>r.map(([x,y])=>({x,y})))){
  const recipe=api.recipeFor(role),mesh=recipe.terraced?api.styleGeometry(pts,recipe.style,recipe):api.geometry(pts,'ridge',recipe.stories*15.6+2.5,5),mapped=api.atlasFaces(mesh);
  const walls=new Map();
  for(const f of mapped)if(f.kind==='wall'&&f.wallSpan&&!f.rawUV){
   const a=f.points[0],b=f.points.find(p=>Math.hypot(p.x-a.x,p.y-a.y)>1e-6),len=Math.hypot(b.x-a.x,b.y-a.y),n={x:-(b.y-a.y)/len,y:(b.x-a.x)/len};
   if(n.x<-1e-9||(Math.abs(n.x)<1e-9&&n.y<0)){n.x=-n.x;n.y=-n.y;}
   const key=[n.x.toFixed(3),n.y.toFixed(3),(n.x*a.x+n.y*a.y).toFixed(2)].join(',')+'|'+f.wallSpan.join(',');
   (walls.get(key)||walls.set(key,[]).get(key)).push([Math.min(...f.points.map(p=>p.tu))*512,Math.max(...f.points.map(p=>p.tu))*512]);}
  assert(walls.size>=4,role+' walls carry a span');
  for(const spans of walls.values()){
   spans.sort((a,b)=>a[0]-b[0]);const merged=[];for(const s of spans){const last=merged.at(-1);if(last&&s[0]<=last[1]+1e-6)last[1]=Math.max(last[1],s[1]);else merged.push([...s]);}
   for(let k=0;k<=12;k+=2){const bx=2+39*k;
    const touches=merged.some(([a,b])=>a<bx+37&&b>bx+2),whole=merged.some(([a,b])=>a<=bx+1+1e-6&&b>=bx+38-1e-6);
    assert(!touches||whole,role+': window bay '+k+' is cut by a corner');}
  }
 }
}
console.log('Window bays are never cut at corners.');
const surfaceArea=f=>{const [a,b,c]=f.points,u={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},v={x:c.x-a.x,y:c.y-a.y,z:c.z-a.z};return Math.hypot(u.y*v.z-u.z*v.y,u.z*v.x-u.x*v.z,u.x*v.y-u.y*v.x)/2;};
for(const size of [150,800,1400]){
 const mesh=api.geometry([{x:0,y:0},{x:size,y:0},{x:size,y:size},{x:0,y:size}],'ridge',98.6,5),mapped=api.atlasFaces(mesh);
 // Walls split once at the eave band; nothing else subdivides on a normal building.
 if(size===150){assert.equal(mapped.filter(f=>f.kind!=='wall').length,mesh.faces.filter(f=>f.kind!=='wall').length,'normal buildings need no UV subdivision');assert(mapped.filter(f=>f.kind==='wall').length<=mesh.faces.filter(f=>f.kind==='wall').length*8,'eave band and corner bays add at most seven pieces per wall triangle');}
 for(const kind of ['roof','wall','trim']){
  const before=mesh.faces.filter(f=>f.kind===kind).reduce((n,f)=>n+surfaceArea(f),0),after=mapped.filter(f=>f.kind===kind).reduce((n,f)=>n+surfaceArea(f),0);
  assert(Math.abs(before-after)<1e-5,'atlas wrapping preserves '+kind+' surface area');
 }
 for(const f of mapped){
  assert(f.points.every(p=>p.tu>=-1e-8&&p.tu<=1&&p.tv>=-1e-8&&p.tv<=1),'wrapped UVs stay within the sheet');
  if(f.kind==='trim'||f.rawUV||f.solid)continue; // solid texel and chimney plinth UVs are not facade mappings
  for(let i=0;i<3;i++){const a=f.points[i],b=f.points[(i+1)%3];
   assert(Math.abs((b.tu-a.tu)*512-(b.u-a.u)/(f.kind==='roof'?.65:1))<1e-6,'no horizontal stretch');
   assert(Math.abs((b.tv-a.tv)*512-(b.v-a.v)/.65)<1e-6,'no vertical stretch');
  }
 }
 console.log('Atlas wrap',size+'px:',mesh.faces.length,'->',mapped.length,'triangles');
}
const marketFaceKeys=new Set();
for(const f of terrace.faces){
 const key=f.kind+':'+f.points.map(p=>[p.x,p.y,p.z].map(n=>n.toFixed(6)).join(',')).sort().join(';');
 assert(!marketFaceKeys.has(key),'market has no duplicate coplanar triangles');marketFaceKeys.add(key);
}
let deckWallPairs=0;
for(const wall of terrace.faces.filter(f=>f.kind==='wall')){
 const bottom=Math.min(...wall.points.map(p=>p.z));
 for(const deck of terrace.faces.filter(f=>f.kind==='roof'&&f.points.every(p=>Math.abs(p.z-bottom)<1e-7))){
  assert(wall.layer>deck.layer,'upper-storey walls render after the supporting terrace');deckWallPairs++;
 }
}
assert(deckWallPairs>0,'market draw-order regression exercises terrace/wall junctions');
// Smithy stacks widen toward the roof without changing ordinary chimney caps.
{
 const pts=[{x:0,y:0},{x:120,y:0},{x:120,y:60},{x:0,y:60}];
 const smith=api.ROLES.blacksmith,options={count:smith.chimneys||1,scale:smith.chimneyScale||1,flare:smith.chimneyFlare};
 const mesh=api.geometry(pts,'ridge',18.1,5,options);
 const ordinary=api.geometry(pts,'ridge',18.1,5,{count:1,scale:1});
 assert.notEqual(mesh,ordinary,'chimney shape participates in mesh cache');
 const sides=mesh.faces.filter(f=>f.chimney&&f.kind==='wall');
 assert.equal(sides.length,8,'one complete smithy chimney shaft');
 for(let i=0;i<sides.length;i+=2){
  const [a,b,c]=sides[i].points,d=sides[i+1].points[2];
  assert(Math.hypot(a.x-b.x,a.y-b.y)>Math.hypot(c.x-d.x,c.y-d.y),'shaft widens downward');
 }
}

assert(!wreck.faces.some(f=>f.castShadow&&['roof','strut'].includes(f.shadowSource)),'removed roof and struts cast no ghost shadows');

// Broken ends face away from their taller adjoining wall, into the breach.
let exposedEnds=0;
for(const end of wreck.faces.filter(f=>f.wallEnd)){
 const [a,b,c]=end.points,nx=(b.y-a.y)*(c.z-a.z)-(b.z-a.z)*(c.y-a.y),ny=(b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z);
 const top=Math.max(...end.points.map(p=>p.z));
 const adjoining=wreck.faces.filter(f=>f.wreckMasonry&&f.points.some(p=>Math.abs(p.z-top)<1e-6&&end.points.some(q=>Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)<1e-6)));
 if(!adjoining.length)continue;
 exposedEnds++;
 for(const f of adjoining){const x=f.points.reduce((s,p)=>s+p.x,0)/3,y=f.points.reduce((s,p)=>s+p.y,0)/3;
  assert(nx*(x-a.x)+ny*(y-a.y)<1e-6,'broken wall end faces the exposed side');}
}
assert(exposedEnds>0,'checks exposed wall-end winding');
