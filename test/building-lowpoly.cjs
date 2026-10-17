const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/building_lowpoly.js','utf8'),ctx);
const api=ctx.window.BuildingLowPoly,fixtures=require('../tools/building-roof-fixtures.js');
const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-a.y*b.x;},0))/2;
const rows=[];
for(const fixture of fixtures)for(const variant of ['ridge','inset','shallow','flat']){
 const pts=fixture.points.map(([x,y])=>({x,y})),m=api.geometry(pts,variant,77);
 assert(Math.abs(m.faces.filter(f=>f.kind==='roof').reduce((n,f)=>n+area(f.points),0)-area(pts))<1e-5,'exact footprint area');
 assert(m.roofTriangles<200,'bounded roof budget');
 for(const f of m.faces)for(const p of f.points)assert(Number.isFinite(p.z)&&p.z>=0&&p.z<=105);
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
