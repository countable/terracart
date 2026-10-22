const fs=require('node:fs'),assert=require('node:assert/strict');
const profile=new Function(fs.readFileSync('src/rogue_prop_profile.js','utf8')+';return ROGUE_PROP_PROFILE;')();
const code=fs.readFileSync('src/rogue_prop_profile.js','utf8')+'\n'+fs.readFileSync('src/rogue_object_bounds.js','utf8')+'\n'+fs.readFileSync('src/rogue_objects.js','utf8');
function load(search) {
 const assets={selected_shrub:{kind:'spritesheet',path:'assets/Objects/SelectedFlora/selected_shrub.png',frameWidth:16,frameHeight:16},bushes:{kind:'spritesheet',path:'assets/Objects/CelProps/bushes.png',frameWidth:24,frameHeight:24}},layout={ART_BOUNDS:{},groveShrineArt:()=>({key:'grove_votive'}),SHRINE_KIND_ART:{scale:1.5}};
 for(const key of Object.keys(profile.assets)) assets[key]={kind:'atlas-alias',path:'old.png',atlasKey:'legacy',frameRects:{0:{x:48,y:32,width:16,height:16}},onLoad:()=>{throw Error('stale callback');}};
 const bushes={sheet:'bushes',custom:true,frames:[0,1,2,3,4,5,6,7],scale:1};
 const crops={shrub:{sheet:'selected_shrub',looks:{bramble:{sheet:'bramble'},clipped:{sheet:'approved_clipped_hedge'}}}};
 const art=new Function('location','ASSETS','SpriteLayout','DreamlandObjects','treeArtFrame','mineralRockMaterial','CELL_PX','Houses','WorldLayers','CROP_SPRITE','BUSH_SPRITE','Elevators',code+'\nreturn RogueObjects;')({search},assets,layout,{},o=>o.stage||3,o=>o.material||'plain',32,{displayRole:()=> 'wreck'},{STANDING_PROP:'standing'},crops,bushes,{isRepaired:save=>!!save?.repaired});
 return {art,assets,layout,crops};
}
const off=load('?artTrial=baseline');assert.equal(off.assets.selected_longgrass.kind,'atlas-alias');assert.equal(off.assets.bushes.path,'assets/Objects/CelProps/bushes.png');
const {art,assets,layout,crops}=load('?artTrial=rogue');assert.equal(Object.keys(assets).length,14+Object.keys(profile.assets).filter(key=>!['rogue_ladder_down','rogue_lamp_unlit'].includes(key)).length);
assert.equal(assets.bushes.path,'assets/ArtTrials/RogueObjects/bushes-olive.png');
assert.equal(off.assets.selected_shrub.path,'assets/Objects/SelectedFlora/selected_shrub.png');
assert.equal(assets.selected_shrub.path,'assets/ArtTrials/RogueObjects/shrub-olive.png');
assert.equal(assets.selected_shrub.frameWidth,16);assert.equal(assets.selected_shrub.frameHeight,16);
assert.equal(assets.bushes.frameWidth,24);assert.equal(assets.bushes.frameHeight,24);
for(const [key,asset] of Object.entries(assets)) {
 assert(fs.existsSync(asset.path));if(!['bushes','selected_shrub'].includes(key)&&!profile.assets[key])assert(layout.ART_BOUNDS[key+':__BASE']);
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
assert.equal(art.spec({kind:'staircase',dir:'up'},{},original).key,'rogue_ladder_up');
for (const tier of [9,11,12]) for (const role of ['plain','trailer','shop','trader','blacksmith','fort','wreck']) {
 assert.equal(art.houseKey({tier},{game:{renderer:{type:2}}},role),null,'RA keeps the shared 3D house scheme');
}
assert(!Object.keys(assets).some(key=>key.startsWith('rogue_house_')),'unused facade images are not loaded');
assert.equal(art.houseKey({tier:9},{},'wreck'),null,'retain authentic ruined art until restored');
assert.equal(art.houseKey({tier:11},{},'temple'),null);
assert.equal(art.houseKey({tier:9},{homeInside:()=>true},'trailer'),null);
assert.equal(art.spec({kind:'_streetlamp',lit:true},{},original).key,'rogue_lamp');
assert.equal(art.spec({kind:'_streetlamp',lit:false},{},original).key,'rogue_lamp_unlit');
console.log('RA reference objects: opt-in isolation, assets/bounds, growth, source palette, semantic exclusions and restoration conditions passed');


assert.equal(off.crops.shrub.sheet,'selected_shrub');
assert.equal(crops.shrub.sheet,'bushes','RA ordinary shrubs use rounded olive bush');
assert.deepEqual(crops.shrub.frames,[0,1,2,3,4,5,6,7]);
assert.equal(crops.shrub.scale,1,'24px frame preserves original shrub footprint');
assert.equal(crops.shrub.looks.clipped.sheet,'bushes','urban biome shrub fallback uses same olive bush');
assert.equal(crops.shrub.looks.bramble.sheet,'bramble','thorny grove identity survives');

// Replacing an atlas alias must discard old frame rectangles and load callbacks.
for(const [key,entry] of Object.entries(profile.assets)) {
 const {onLoad,...installed}=assets[key];
 assert.deepEqual(installed,entry,key);
 assert.equal(typeof onLoad,profile.frameCrops[key] ? 'function' : 'undefined');
 for(const stale of ['atlasKey','frameRects','desaturated']) assert.equal(assets[key][stale],undefined,key+': '+stale);
}
for(const [key,bounds] of Object.entries(profile.bounds)) assert.deepEqual(layout.ART_BOUNDS[key],bounds,key);
const iconSheets=Object.fromEntries(Object.keys(profile.icons).map(key=>[key,{url:'old-atlas.png',frames:{0:{x:48,y:32}}}]));
const untouched=structuredClone(iconSheets);off.art.installIcons(iconSheets);assert.deepEqual(iconSheets,untouched);
art.installIcons(iconSheets);
for(const [key,sheet] of Object.entries(profile.icons)) {
 assert.deepEqual(iconSheets[key],sheet,key);
 assert.equal(sheet.url,assets[key].path,'Map and UI must load the same approved art');
 assert.equal(iconSheets[key].frames,undefined,'No stale atlas offsets');
 const png=fs.readFileSync(sheet.url);assert.equal(png.readUInt32BE(16),sheet.srcW);assert.equal(png.readUInt32BE(20),sheet.srcH);
 assert.equal(sheet.cols,sheet.srcW/assets[key].frameWidth);
}
for(const depth of [0,1,3]) for(const dir of ['up','down']) {
 assert.equal(off.art.spec({kind:'staircase',dir},{depth},original),original);
 const steps=art.spec({kind:'staircase',dir},{depth},original);
 assert.equal(steps.key,'rogue_ladder_'+dir);assert.equal(steps.groundAtOrigin,dir==='down');assert.equal(steps.seat,dir==='up');
 for(const repaired of [false,true]) {
  const elevator=art.spec({kind:'staircase',dir,elevator:true},{depth,save:{repaired}},original);
  assert.equal(elevator.key,'rogue_elevators');assert.equal(elevator.frame,repaired?1:0);assert.equal(elevator.seat,true);
 }
}
assert.equal(profile.assets.box,undefined,'3D crate variants remain untouched');
assert.equal(profile.assets.clay_pot_smashed,undefined,'Broken pots remain untouched');
console.log('Approved RA prop profile: aliases, UI paths/geometry, bounds and underground access passed');
// Atlas loading can finish before standalone art. It must not seize keys the
// selected profile replaced, even while those PNG requests are still in flight.
const atlasRegistry={selected_longgrass:assets.selected_longgrass,wood:assets.wood,
 barrel:{kind:'atlas-alias',atlasKey:'shared'},moved:{kind:'atlas-alias',atlasKey:'other'}};
const atlas=new Function('ASSETS',fs.readFileSync('src/art_atlas.js','utf8')+';return ArtAtlas;')(atlasRegistry);
const created=[];const manager={get:()=>({source:[{}]}),exists:()=>false,create(key){created.push(key);return {source:[],remove(){},add(){},destroy(){}};}};
const rect={x:0,y:0,width:16,height:16};
atlas.register({textures:manager},{key:'shared',entries:Object.fromEntries(Object.keys(atlasRegistry).map(key=>[key,{sheetRect:rect,frameRects:{0:rect}}]))});
assert.deepEqual(created,['barrel'],'Only active aliases may register before profile images finish');
console.log('Atlas load-order regression: replaced aliases never reclaim standalone profile keys passed');

// Ground-contact crops preserve each source column and replace only the height.
for (const [key,frames] of Object.entries(profile.frameCrops)) {
 const added=[];
 const texture={get:frame=>({sourceIndex:0,cutX:Number(frame)*16,cutY:0,cutWidth:16}),remove:()=>{},add:(...args)=>added.push(args)};
 assets[key].onLoad({textures:{get:name=>{assert.equal(name,key);return texture;}}});
 assert.deepEqual(added,Object.entries(frames).map(([frame,height])=>[frame,0,Number(frame)*16,0,16,height]));
 for(const [frame,height] of Object.entries(frames)) {
  assert.equal(layout.ART_BOUNDS[key+':'+frame].fh,height);
  assert(layout.ART_BOUNDS[key+':'+frame].maxY<=height);
 }
}

for(const search of ['', '?deepforest=on']) {
 const defaults=load(search);assert(defaults.art.enabled);assert.equal(defaults.assets.selected_longgrass.path,profile.assets.selected_longgrass.path);
}
assert.equal(load('?artTrial=dreamland').art.enabled,false);
