const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={console,treeArtFrame:o=>o.stage,SpriteLayout:{ART_BOUNDS:{},CROWN_BOUNDS:{}},WorldLayers:{GROUND_DECAL:'ground'}};
vm.createContext(context);
for(const file of ['rogue_object_bounds','street_decoration_art','rogue_objects'])vm.runInContext(fs.readFileSync('src/'+file+'.js','utf8'),context);
const profile=vm.runInContext('RogueObjects',context), rows=vm.runInContext('STREET_DECORATION_ART',context), assets={};profile.install(assets);
for(const [key,row] of Object.entries(rows)){
 const asset=assets['street_decor_'+key],png=fs.readFileSync(asset.path);
 assert.equal(png.readUInt32BE(16),row.bounds.fw);assert.equal(png.readUInt32BE(20),row.bounds.fh);
 assert.ok(row.bounds.maxX<=row.bounds.fw&&row.bounds.maxY<=row.bounds.fh);
}
for(const family of ['mossy_tree','conifer_tree','dead_tree','lavender_tree']){
 const specs=[1,2,3].map(stage=>profile.spec({kind:'tree',_objectArt:family,stage},{},{}));
 assert.ok(specs[0].scale<specs[1].scale&&specs[1].scale<specs[2].scale);
 assert.equal(new Set(specs.map(s=>s.key)).size,1,'growth stages share family');
}
assert.equal(profile.spec({kind:'mineralrock',_streetArt:'fire_rock'},{},{}).key,'street_decor_fire_rock');
assert.equal(profile.spec({kind:'chest',_streetArt:'pottery_stack',_smashed:true},{},{key:'shards'}).key,'shards');
assert.equal(profile.spec({kind:'wildplant',_streetArt:'green_slick'},{},{}).layer,'ground');
console.log('PASS: '+Object.keys(rows).length+' source crops, native bounds, shared tree growth, rock override, broken-pot fallback, flat slick');
