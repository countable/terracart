const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('src/dreamland_objects.js','utf8');
function load(search){const assets={};const art=new Function('location','ASSETS','treeArtFrame','treeScale','chestLook','CELL_PX',source+';return DreamlandObjects;')({search},assets,o=>o.variant,()=>1,o=>({texKey:o.crate?'box':'chest'}),32);return {art,assets};}
for(const search of ['', '?artTrial=rogue']){const {art,assets}=load(search),spec={key:'tree'};assert(!art.enabled);assert.deepEqual(assets,{});assert.equal(art.spec({kind:'tree'}, {},spec),spec);assert.equal(art.houseKey({tier:9},{},'plain'),null);}
const {art,assets}=load('?artTrial=dreamland'),scene={depth:0,cellM:7};
assert.equal(art.houseKey({tier:9},scene,'plain'),'dreamland_house');assert.equal(art.houseKey({tier:11},scene,'fort'),'dreamland_house_wide');
for(const role of ['wreck','wizard','turret'])assert.equal(art.houseKey({tier:9},scene,role),null);
assert.equal(art.houseKey({tier:9},{homeInside:()=>true},'trailer'),null);
assert.equal(art.spec({kind:'tree',variant:3},scene,{}).key,'dreamland_tree');assert.equal(art.spec({kind:'tree',variant:1},scene,{}).key,'dreamland_tree_young');
assert.equal(art.spec({kind:'_streetlamp',lit:true},scene,{}).key,'dreamland_lamp');assert.equal(art.spec({kind:'_streetlamp',lit:false},scene,{}).key,'dreamland_lamp_unlit');
assert.equal(art.spec({kind:'well'},scene,{}).key,'dreamland_fountain');assert.equal(art.spec({kind:'chest',crate:true},scene,{}).key,'dreamland_crate');
const untouched={key:'native'};assert.equal(art.spec({kind:'tree',_objectArt:'dead_tree'},scene,untouched),untouched);assert.equal(art.spec({kind:'tree'},{depth:1},untouched),untouched);
for(const asset of Object.values(assets))assert(fs.existsSync(asset.path),asset.path);
const terrainSource=fs.readFileSync('src/ra_terrain_trial.js','utf8');const terrain=new Function('location',terrainSource+';return RATerrainTrial;')({search:'?artTrial=dreamland'});const seen=new Set();
for(let y=-100;y<100;y++)for(let x=-100;x<100;x++){const m=terrain.material(0,x,y);seen.add(m);assert.equal(m,terrain.material(0,x,y));assert.equal(terrain.material(3,x,y),4);}
assert.deepEqual([...seen].sort(),[0,1]);console.log('Dreamland: profile isolation, source assets, growth, restoration, special roles, interiors and stable native patches passed');
assert.deepEqual(art.lampLightOffset(scene),{dxPx:22,dyPx:-18});
assert.equal(art.lampLightOffset({depth:1}),null);
const lamp=art.spec({kind:'_streetlamp',lit:true},scene,{});
assert.equal(lamp.seat,false);assert.deepEqual(lamp.origin,[3/21,25/30]);
