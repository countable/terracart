const fs=require('node:fs'),assert=require('node:assert/strict');
const code=fs.readFileSync('src/rogue_object_bounds.js','utf8')+'\n'+fs.readFileSync('src/rogue_objects.js','utf8');
function load(search) {
 const assets={},layout={ART_BOUNDS:{}};
 const art=new Function('location','ASSETS','SpriteLayout','DreamlandObjects','treeArtFrame','mineralRockMaterial','CELL_PX','Houses','WorldLayers',code+'\nreturn RogueObjects;')({search},assets,layout,{},o=>o.stage||3,o=>o.material||'plain',32,{displayRole:()=> 'wreck'},{STANDING_PROP:'standing'});
 return {art,assets,layout};
}
const off=load('');assert.equal(Object.keys(off.assets).length,0);
const {art,assets,layout}=load('?artTrial=rogue');assert.equal(Object.keys(assets).length,15);
for(const [key,asset] of Object.entries(assets)) {
 assert(fs.existsSync(asset.path));assert(layout.ART_BOUNDS[key+':__BASE']);
}
const original={key:'trees',frame:3,after:()=>{}};
const tree=Object.freeze({id:'stable-id',kind:'tree',stage:3,crown_color:0xff00ff});
const first=art.spec(tree,{},original);
assert.equal(first.key,art.spec(tree,{},original).key);
assert(first.key.startsWith('rogue_tree_'));assert.equal(first.after,undefined,'native colors survive DeepForest crown tint');
assert.equal(original.key,'trees');assert.equal(art.spec(tree,{depth:1},original),original);
assert(art.spec({...tree,stage:1},{},original).scale<first.scale);
assert.equal(art.spec({kind:'mineralrock',material:'gold'},{},original),original,'named ores retain meaningful art');
assert(['rogue_rock_mid','rogue_stone'].includes(art.spec({kind:'mineralrock',material:'plain'},{},original).key));
assert.equal(art.spec({kind:'staircase',dir:'down'},{},original).key,'rogue_ladder_down');
assert.equal(art.spec({kind:'staircase',dir:'up'},{},original),original);
assert.equal(art.houseKey({tier:9},{},'plain'),'rogue_house_small');
assert.equal(art.houseKey({tier:9},{},'wreck'),null,'retain authentic ruined art until restored');
assert.equal(art.houseKey({tier:11},{},'temple'),null);
assert.equal(art.houseKey({tier:9},{homeInside:()=>true},'trailer'),null);
assert.equal(art.spec({kind:'_streetlamp',lit:true},{},original).key,'rogue_lamp');
assert.equal(art.spec({kind:'_streetlamp',lit:false},{},original).key,'rogue_lamp_unlit');
console.log('RA reference objects: opt-in isolation, assets/bounds, growth, source palette, semantic exclusions and restoration conditions passed');

