const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/building_lowpoly.js','utf8'),ctx);
const api=ctx.window.BuildingLowPoly,fixtures=require('../tools/building-roof-fixtures.js');
const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-a.y*b.x;},0))/2;
const rows=[];
for(const fixture of fixtures)for(const variant of ['ridge','inset','shallow','flat']){
 const pts=fixture.points.map(([x,y])=>({x,y})),m=api.geometry(pts,variant,77);
 assert(Math.abs(m.faces.filter(f=>f.kind==='roof').reduce((n,f)=>n+area(f.points),0)-area(pts))<1e-5,'exact footprint area');
 assert(m.roofTriangles<200,'bounded roof budget');
 // Only a ridge beam (1) or chimney stack (14) may rise above the ridge.
 for(const f of m.faces)for(const p of f.points)assert(Number.isFinite(p.z)&&p.z>=0&&p.z<=105+(f.chimney?14:f.beam?1:0));
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
  assert(Math.abs(Math.abs(b.u-a.u)*1.3-Math.hypot(b.x-a.x,b.y-a.y))<1e-7,'constant wall texel density');
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
 const mesh=recipe.shape?api.specialGeometry(points,recipe):recipe.terraced?api.styleGeometry(points,recipe.style,recipe):api.geometry(points,recipe.variant||'ridge',recipe.stories*31.2+5,5);
 assert(mesh.faces.length>0&&mesh.faces.length<300,role+' bounded geometry');
 assert(mesh.faces.every(f=>f.points.every(p=>[p.x,p.y,p.z,p.u,p.v].every(Number.isFinite))),role+' finite vertices');
 if(role==='wizard'||role==='turret'){
  const large=api.specialGeometry(points.map(p=>({x:p.x*3,y:p.y*3})),recipe);
  const width=m=>Math.max(...m.ring.map(p=>p.x))-Math.min(...m.ring.map(p=>p.x));
  assert(Math.abs(width(mesh)-width(large))<1e-8,role+' ignores footprint dimensions');
 }
 if(role==='wreck'){const roofs=mesh.faces.filter(f=>f.kind==='roof'&&f.layer===2);assert(roofs.length&&roofs.reduce((n,f)=>n+area(f.points),0)<area(points)*.7,'wreck roof is partly missing');}
}
console.log('All role variants: bounded geometry, footprint-independent towers, damaged cottage passed.');
for(const fixture of fixtures)for(const variant of ['ridge','shallow','inset']){
 const pts=fixture.points.map(([x,y])=>({x,y})),mesh=api.geometry(pts,variant,36.2,5),uv=new Map();
 for(const f of mesh.faces.filter(f=>f.kind==='roof'))for(const p of f.points){
  const key=[p.x,p.y,p.z].map(n=>n.toFixed(6)).join(',');
  if(uv.has(key)){const q=uv.get(key);assert(Math.abs(q.u-p.u)<1e-5&&Math.abs(q.v-p.v)<1e-5,'roof UVs agree at shared slope/cap vertices');}else uv.set(key,p);
 }
}
console.log('Roof slope/cap texture continuity passed.');

const wreckPoints=[{x:0,y:0},{x:120,y:0},{x:120,y:100},{x:0,y:100}];
const wreck=api.specialGeometry(wreckPoints,api.recipeFor('wreck'));
assert.equal(wreck.roofHoles.length,2,'two real roof openings');
for(const h of wreck.roofHoles){
 const c={x:h.cx,y:h.cy};
 const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
 assert(!wreck.faces.filter(f=>f.kind==='roof'&&!f.debris).some(f=>f.points.every((p,i)=>cross(p,f.points[(i+1)%3],c)>=-1e-7)),'hole center contains no roof triangle');
}
const market=api.recipeFor('trader'),terrace=api.styleGeometry(wreckPoints,market.style,market);
assert(market.terraced&&market.stories===2,'market has a second storey');
const top=terrace.faces.filter(f=>f.kind==='roof'&&f.points.every(p=>p.z>40)).flatMap(f=>f.points);
assert(top.length&&top.every(p=>p.x>0&&p.x<120&&p.y>0&&p.y<100),'upper storey is inset from the footprint');
assert.equal(api.recipeFor('supply').variant,'flat');
console.log('Roof holes and terraced market passed.');
const surfaceArea=f=>{const [a,b,c]=f.points,u={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},v={x:c.x-a.x,y:c.y-a.y,z:c.z-a.z};return Math.hypot(u.y*v.z-u.z*v.y,u.z*v.x-u.x*v.z,u.x*v.y-u.y*v.x)/2;};
for(const size of [150,800,1400]){
 const mesh=api.geometry([{x:0,y:0},{x:size,y:0},{x:size,y:size},{x:0,y:size}],'ridge',98.6,5),mapped=api.atlasFaces(mesh);
 if(size===150)assert.equal(mapped.length,mesh.faces.length,'normal buildings need no UV subdivision');
 for(const kind of ['roof','wall','trim']){
  const before=mesh.faces.filter(f=>f.kind===kind).reduce((n,f)=>n+surfaceArea(f),0),after=mapped.filter(f=>f.kind===kind).reduce((n,f)=>n+surfaceArea(f),0);
  assert(Math.abs(before-after)<1e-5,'atlas wrapping preserves '+kind+' surface area');
 }
 for(const f of mapped){
  assert(f.points.every(p=>p.tu>=-1e-8&&p.tu<=1&&p.tv>=-1e-8&&p.tv<=1),'wrapped UVs stay within the sheet');
  if(f.kind==='trim')continue;
  for(let i=0;i<3;i++){const a=f.points[i],b=f.points[(i+1)%3];
   assert(Math.abs((b.tu-a.tu)*512-(b.u-a.u)/(f.kind==='roof'?1.3:1))<1e-6,'no horizontal stretch');
   assert(Math.abs((b.tv-a.tv)*512-(b.v-a.v)/1.3)<1e-6,'no vertical stretch');
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
