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
const shards=profile.spec({kind:'chest',barrelStyle:'street_decor_pottery_stack',_streetArt:'pottery_stack',_smashed:true},{},{});
assert.equal(shards.key,'street_decor_pottery_stack_broken');
assert.equal(shards.frame,0);
assert.ok(rows.young_fern.scale*(rows.young_fern.bounds.maxX-rows.young_fern.bounds.minX)<15);

// Palette changes must not alter soft shadows, alpha, or already-RA bark.
for(const family of ['mossy_tree','conifer_tree','lavender_tree','dead_tree','hedge_strip']){
 assert.equal(typeof assets['street_decor_'+family].onLoad,'function');
 const source=Number(Object.keys(profile.streetPalette(family))[0]);
 const rgb=[source>>>16,(source>>>8)&255,source&255];
 const pixels=new Uint8ClampedArray([...rgb,255,...rgb,135,...rgb,0,51,47,35,255]);
 const before=Array.from(pixels);
 profile.recolorStreetPixels(pixels,family);
 assert.notDeepEqual(Array.from(pixels.slice(0,3)),before.slice(0,3));
 assert.deepEqual(Array.from(pixels.slice(3)),before.slice(3),'preserve alpha, shadows and RA bark');
}
const plum=profile.streetPalette('lavender_tree')[0x7a7fcc];
assert.ok((plum&255)>((plum>>>8)&255),'lavender stays plum');
const green=profile.streetPalette('conifer_tree')[0x53a641];
assert.ok(((green>>>8)&255)>(green>>>16),'conifer stays green');
assert.notEqual(green,profile.streetPalette('mossy_tree')[0x719828]);

console.log('PASS: '+Object.keys(rows).length+' source crops, native bounds, shared tree growth, rock override, broken-pot fallback, flat slick');
