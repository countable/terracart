const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('src/dreamland_objects.js','utf8');
function load(search){const assets={};const art=new Function('location','ASSETS','treeArtFrame','treeScale','chestLook','CELL_PX','Houses','WorldLayers',source+';return DreamlandObjects;')({search},assets,o=>o.variant,()=>1,o=>({texKey:o.crate?'box':'chest'}),32,{displayRole:(save,o)=>save?.restoredHouses?.[o.id]?'plain':'wreck'},{STANDING_PROP:4});return {art,assets};}
for(const search of ['', '?artTrial=rogue']){const {art,assets}=load(search),spec={key:'tree'};assert(!art.enabled);assert.deepEqual(assets,{});assert.equal(art.spec({kind:'tree'}, {},spec),spec);assert.equal(art.houseKey({tier:9},{},'plain'),null);}
const {art,assets}=load('?artTrial=dreamland'),scene={depth:0,cellM:7};
assert.equal(art.houseKey({tier:9},scene,'plain'),'dreamland_house');assert.equal(art.houseKey({tier:11},scene,'fort'),'dreamland_house_wide');
for(const role of ['wizard','turret'])assert.equal(art.houseKey({tier:9},scene,role),null);
assert.equal(art.houseKey({tier:9},{homeInside:()=>true},'trailer'),null);
assert.equal(art.spec({kind:'tree',variant:3},scene,{}).key,'dreamland_tree');assert.equal(art.spec({kind:'tree',variant:1},scene,{}).key,'dreamland_tree_young');
assert.equal(art.spec({kind:'_streetlamp',lit:true},scene,{}).key,'dreamland_lamp');assert.equal(art.spec({kind:'_streetlamp',lit:false},scene,{}).key,'dreamland_lamp_unlit');
assert.equal(art.spec({kind:'well'},scene,{}).key,'dreamland_fountain_water');assert.equal(art.spec({kind:'chest',crate:true},scene,{}).key,'dreamland_crate');
const untouched={key:'native'};assert.equal(art.spec({kind:'tree',_objectArt:'dead_tree'},scene,untouched),untouched);assert.equal(art.spec({kind:'tree'},{depth:1},untouched),untouched);
for(const asset of Object.values(assets))assert(fs.existsSync(asset.path),asset.path);
const terrainSource=fs.readFileSync('src/ground_materials.js','utf8')+'\n'+fs.readFileSync('src/terrain_transitions.js','utf8');const terrain=new Function('location',terrainSource+';return TerrainTransitions;')({search:'?artTrial=dreamland'});const seen=new Set();
for(let y=-100;y<100;y++)for(let x=-100;x<100;x++){const m=terrain.material(0,x,y);seen.add(m);assert.equal(m,terrain.material(0,x,y));assert.equal(terrain.material(3,x,y),4);}
assert.deepEqual([...seen].sort(),[1]);console.log('Dreamland: profile isolation, source assets, growth, restoration, special roles, interiors and stable native patches passed');
assert.deepEqual(art.lampLightOffset(scene),{dxPx:22,dyPx:-18});
assert.equal(art.lampLightOffset({depth:1}),null);
const lamp=art.spec({kind:'_streetlamp',lit:true},scene,{});
assert.equal(lamp.seat,false);assert.deepEqual(lamp.origin,[3/21,25/30]);

const wreck={id:'kept-id',kind:'house',tier:9,area:100,footDx:.2,footDy:.3};
const initial=JSON.stringify(wreck),base={scale:2,dxPx:7,dyPx:9,origin:[.5,1],scaleYMul:.4,layer:1};
assert.equal(art.houseKey(wreck,scene,'wreck'),'dreamland_house_collapsed');
assert.equal(art.houseKey({...wreck,tier:11},scene,'wreck'),null);
assert.equal(art.houseKey({...wreck,castle:'castle'},scene,'wreck'),null);
const collapse=art.spec(wreck,{...scene,save:{}},base);
assert.equal(collapse.scaleYMul,1);assert.equal(collapse.layer,4);
assert.equal(collapse.scale,base.scale);assert.equal(collapse.dxPx,7);assert.equal(collapse.dyPx,9);
assert.equal(art.spec(wreck,{...scene,save:{restoredHouses:{'kept-id':'plain'}}},base),base);
assert.equal(art.houseKey(wreck,scene,'plain'),'dreamland_house');
assert.equal(JSON.stringify(wreck),initial);
console.log('Dreamland wreck: preserved identity/footprint, native height, standing remnants, restore and special-role isolation passed');

const webgl={...scene,game:{renderer:{type:2}}};
for(const role of ['plain','trailer','fort','wreck'])assert.equal(art.houseKey(wreck,webgl,role),null,'WebGL must draw geometry, never a facade billboard');
for(const role of ['plain','home','shop','blacksmith','trader'])assert.deepEqual(art.buildingRecipe(wreck,webgl,role),{key:'dreamland_house',palette:'native'});
for(const role of ['wreck','wizard','turret'])assert.equal(art.buildingRecipe(wreck,webgl,role),null);
assert.equal(art.buildingRecipe({...wreck,castle:'keep'},webgl,'plain'),null);
assert.equal(art.buildingRecipe(wreck,{...webgl,depth:1},'plain'),null);
assert.equal(load('?artTrial=rogue').art.buildingRecipe(wreck,webgl,'plain'),null);
console.log('Dreamland 3D: native material recipe, no WebGL house billboards, Canvas fallback and special-role isolation passed');

// Pool reuse must not animate an object that has acquired another texture.
const wellSpec=art.spec({kind:'well'},scene,{});let listener;
const moving={texture:{key:'dreamland_fountain_water'},visible:true,scaleX:2,scaleY:2,setFrame(f){this.frame=f;}};
const animatedScene={depth:0,objectPool:[moving],events:{on(event,fn){assert.equal(event,'postupdate');listener=fn;}}};
wellSpec.after(moving,{kind:'well',id:'well-a'},animatedScene);listener(440);
assert.equal(moving.frame,2);moving.texture.key='other';listener(660);assert.equal(moving.frame,2);
assert.equal(wellSpec.frame,0);assert.equal(assets.dreamland_fountain_water.frameWidth,48);
console.log('Dreamland animation: water frames and pooled-object identity isolation passed');

const referenceScene={...webgl,dreamlandReferenceShell:true};
assert.deepEqual(art.buildingRecipe(wreck,referenceScene,'plain'),{key:'dreamland_house',palette:'native',sourceShell:true});
assert.deepEqual(art.buildingRecipe({...wreck,tier:11},referenceScene,'fort'),{key:'dreamland_wide',palette:'native',sourceShell:true});
assert.equal(art.buildingRecipe(wreck,webgl,'plain').sourceShell,undefined,'source composition fitting is explicit, not a geographic size change');

assert.equal(art.buildingRecipe({...wreck,tier:11,referenceModel:'dreamland_corner'},referenceScene,'fort').key,'dreamland_corner');
assert.equal(art.buildingRecipe({...wreck,tier:11,referenceModel:'dreamland_corner'},webgl,'fort').key,'dreamland_house');
assert.equal(art.buildingRecipe({...wreck,referenceChimney:'right'},referenceScene,'plain').key,'dreamland_house_chimney');
assert.equal(art.buildingRecipe({...wreck,tier:11,referenceModel:'dreamland_corner',referenceChimney:'left'},referenceScene,'fort').key,'dreamland_corner_chimney');
assert.equal(art.buildingRecipe({...wreck,referenceChimney:'right'},webgl,'plain').key,'dreamland_house');
