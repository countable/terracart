const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const context = {window:{}, buildingBackgroundColor:c=>c, BiomeProfiles:{mixHex(){}},
  CastleStyles:{ids:['test'],get:()=>({rampart:{topDepth:1}})}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('src/polygon_geometry.js','utf8'),context);
vm.runInContext(fs.readFileSync(path.join(root,'src/building_overlay.js'),'utf8'),context);
const {roofMesh} = context.window.BuildingOverlay;
const fixtures = require('../tools/building-roof-fixtures.js');
const area = pts => Math.abs(pts.reduce((n,a,i)=>{const b=pts[(i+1)%pts.length];return n+a.x*b.y-a.y*b.x;},0))/2;
const inside = (p,ring) => {let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;
}return hit;};
let cases=0;
for (const fixture of fixtures) for(const variant of ['ridge','inset','shallow']) for(const angle of [0,0.37,1.1]) {
  const ring=fixture.points.map(([x,y])=>({x:x*Math.cos(angle)-y*Math.sin(angle),y:x*Math.sin(angle)+y*Math.cos(angle)}));
  const mesh=roofMesh(ring,variant);
  assert(mesh.triangles.length, fixture.name+' triangulates');
  assert(Math.abs(mesh.triangles.reduce((sum,t)=>sum+area(t.points),0)-area(ring))<1e-5,'complete footprint coverage without overlaps');
  for(const t of mesh.triangles) {
    assert(t.points.every(p=>Number.isFinite(p.z)&&p.z>=0&&p.z<=32),'finite bounded heights');
    const centroid={x:t.points.reduce((s,p)=>s+p.x,0)/3,y:t.points.reduce((s,p)=>s+p.y,0)/3};
    assert(inside(centroid,mesh.ring),'no roof triangles bridge a notch or courtyard');
    const [a,b,c]=t.points.map(p=>({x:p.x,y:p.y-p.z}));
    assert((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)>-1e-7,'roof projection never folds over itself');
  }
  for(const p of mesh.ring) {
    assert(mesh.triangles.some(t=>t.points.some(v=>Math.hypot(p.x-v.x,p.y-v.y)<1e-6&&v.z<1e-6)),
      'every small perimeter feature meets its wall at zero roof height');
  }
  const reverse=roofMesh([...ring].reverse(),variant);
  assert.equal(reverse,mesh,'opposite winding reuses identical mesh');
  const shifted=roofMesh(ring.map(p=>({x:p.x+1000,y:p.y-500})),variant);
  assert.equal(shifted,mesh,'camera translation reuses cached geometry');
  cases++;
}
console.log(`${cases} detailed roof cases passed: coverage, courtyards, edge details, winding, projection and cache reuse.`);

let dense=0,clean=0;
for(const fixture of fixtures) {
  const ring=fixture.points.map(([x,y])=>({x,y}));
  const old=roofMesh(ring,'ridge','detailed'),fresh=roofMesh(ring,'ridge','clean');
  assert(fresh.triangles.length < old.triangles.length*0.65,'substantially fewer roof triangles');
  assert(Math.abs(area(fresh.controlRing)-area(fresh.ring))<=area(fresh.ring)*0.035+1e-6,'control simplification stays within its area budget');
  dense+=old.triangles.length;clean+=fresh.triangles.length;
}
const {wallRecipe}=context.window.BuildingOverlay;
const materials=new Set();
for(const role of ['plain','blacksmith','trader','seed','supply','potion','relic','book','pet','wizard','turret']) {
  for(const floors of [1,2,3])assert.equal(wallRecipe(role,floors).stories,floors);
  materials.add(wallRecipe(role).material);
}
assert.deepEqual([...materials].sort(),['plaster','sandstone','stone','timber'],'legacy wall material families');
assert.equal(wallRecipe('wizard',99).stories,3,'story height is bounded');
assert.equal(wallRecipe('wizard',-2).stories,1,'story height has a minimum');
assert.equal(wallRecipe('unknown').material,'plaster','unknown roles retain a house material');
console.log(`Roof triangles: ${dense} → ${clean} (${Math.round((1-clean/dense)*100)}% fewer). Wall recipes: ${materials.size} materials, 11 roles, 1–3 stories.`);
