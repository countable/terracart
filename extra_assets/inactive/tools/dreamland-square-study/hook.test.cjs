const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/terrain-hook.js','utf8');
function api(query){const c={URLSearchParams,location:{search:query}};vm.runInNewContext(source+';globalThis.api=RATerrainTrial',c);return c.api;}
const off=api('?artTrial=rogue'),on=api('?artTrial=dreamland');
assert.equal(off.enabled,false);assert.equal(on.enabled,true);
const assets={};off.install(assets);assert.equal(Object.keys(assets).length,0);on.install(assets);assert.equal(Object.keys(assets).length,3);
for(const id of [7,8,9,10,11,12,13,14,24,32])assert.equal(on.material(id),-1,'structural and unsafe surfaces preserved');
assert.equal(on.material(3),4);assert.equal(on.material(23),4);assert.equal(on.material(6),0);
const ring=new Int8Array([0,4,0,0,4,0,0,0,0]),before=Buffer.from(ring);
const scene={_raTerrainReady:true,_raTerrainAudit:{drawnCells:0,materials:{}}};
const choice=on.select(scene,ring,3,0);assert.equal(choice.frame,on.frameFor([0,4,0,4]));assert.equal(scene._raTerrainAudit.drawnCells,1);
assert.deepEqual(Buffer.from(ring),before,'appearance hook never rewrites generated material ring');
assert.equal(off.select(scene,ring,3,0),null);assert.equal(on.select({},ring,3,0),null);
assert.equal(on.roadTile('burned'),null);assert.equal(on.roadTile('slime_trail'),null);assert.equal(on.roadTile('suppressed'),null);
const isolated=new Int8Array([2,-1,-1,-1]);assert.equal(on.select(scene,isolated,2,0).frame,on.frameFor([2,2,2,2]));
console.log('Dreamland hook checks passed: opt-in, safe roles, source registration, seam inheritance, ring immutability, hazardous road fallback.');
