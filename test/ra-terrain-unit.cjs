const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('src/ra_terrain_trial.js', 'utf8');
function load(search) {
  const assets = {};
  const art = new Function('location','ASSETS','window', source + '\nreturn RATerrainTrial;')({search},assets,{});
  return {art,assets};
}
for (const search of ['', '?raPreview=jungle','?artTrial=trees-water']) {
  const {art,assets}=load(search);
  assert.equal(art.enabled,false);
  assert.equal(Object.keys(assets).length,0);
  assert.equal(art.select({},new Int8Array(4),2,0),null);
}
const {art,assets}=load('?artTrial=rogue');
assert.equal(assets.ra_terrain_source.path,'assets/ArtTrials/RogueTerrain/tiles.png');
const frames=new Set();
for(let a=0;a<8;a++)for(let b=0;b<8;b++)for(let c=0;c<8;c++)for(let d=0;d<8;d++) {
  const values=[a,b,c,d];
  const frame=art.frameFor(values);
  assert(frame>=0&&frame<4096);frames.add(frame);
  let coverage=0;
  for(let material=0;material<8;material++) {
    const mask=art.maskFor(values,material);
    assert.equal(coverage&mask,0);coverage|=mask;
  }
  assert.equal(coverage,15);
}
assert.equal(frames.size,4096);
assert.equal(art.maskFor([4,0,0,4],4),9,'diagonal water islands retain authored disconnected mask');
for(const type of [9,10,11,12,24,25,26,28,29,31,32]) assert.equal(art.material(type),-1,'special terrain stays with existing renderer');
assert.equal(art.material(23),art.material(3),'pier retains water underneath');
const scene={_raTerrainReady:true,_raTerrainAudit:{drawnCells:0,materials:{}}};
const ring=new Int8Array([1,-1,2,4]);const before=ring.slice();
assert.equal(art.select(scene,ring,2,0).frame,art.frameFor([1,1,2,4]));
assert.deepEqual(ring,before,'render selection never writes input geometry');
assert.equal(art.status(scene).drawnCells,1);
assert.equal(art.status(scene).materials.forestGrass,1);
// Real Canvas-like source shape: prepare builds once and performs zero reads.
let canvases=0, reads=0, draws=0;const painted=[];const textures=new Map();
textures.set('ra_terrain_source',{get(frame){return {source:{image:{}},cutX:frame%16*16,cutY:Math.floor(frame/16)*16};}});
const fakeDocument={createElement(){canvases++;return {getContext(){return {drawImage(...args){draws++;painted.push(args);},getImageData(){reads++;throw Error('pixel read');}};}};}};
const bake=new Function('location','document',source+'\nreturn RATerrainTrial;')({search:'?artTrial=rogue'},fakeDocument);
const fakeScene={textures:{exists:k=>textures.has(k),get:k=>textures.get(k),addCanvas(k,c){const t={frames:0,add(){this.frames++;}};textures.set(k,t);return t;}}};
bake.prepare(fakeScene);bake.prepare(fakeScene);
assert.equal(canvases,1);assert.equal(reads,0);assert(draws>4096);
assert.equal(textures.get('ra_terrain_composite').frames,4096);
for (const family of [1,5]) {
  const frame=art.frameFor([family,4,family,4]);
  const x=frame%64*16,y=Math.floor(frame/64)*16;
  const layers=painted.filter(args=>args[5]===x&&args[6]===y);
  assert.equal(layers[0][1],15*16,'underfill uses complete center');
  assert.equal(layers[0][2],family*16,'forest and sand banks reveal their actual local ground');
  assert(layers.every(args=>args[2]!==0),'no unrelated village grass leaks below shoreline');
}
console.log('RA terrain: 4096 combinations, opt-in isolation, native masks, immutable inputs and single startup bake passed');
const dream = load('?artTrial=dreamland');
assert.equal(dream.art.enabled,true);
assert.equal(dream.assets.dreamland_terrain_source.path,'assets/ArtTrials/DreamlandTerrain/terrain.png');
assert.equal(dream.assets.dreamland_path_source.path,'assets/ArtTrials/DreamlandTerrain/path.png');
assert.equal(dream.art.roadTile('plain',true),null,'road canvas must be prepared first');
const dreamTextures=new Map();
dreamTextures.set('dreamland_terrain_source',textures.get('ra_terrain_source'));
dreamTextures.set('dreamland_path_source',{getSourceImage:()=>({width:64,height:64})});
dreamTextures.set('dreamland_path_restored_source',{getSourceImage:()=>({width:64,height:64})});
const dreamBake=new Function('location','document',source+'\nreturn RATerrainTrial;')({search:'?artTrial=dreamland'},fakeDocument);
const dreamScene={textures:{exists:k=>dreamTextures.has(k),get:k=>dreamTextures.get(k),addCanvas(k,c){const t={frames:0,add(){this.frames++;}};dreamTextures.set(k,t);return t;}}};
const beforeBake=canvases;dreamBake.prepare(dreamScene);dreamBake.prepare(dreamScene);
assert.equal(canvases-beforeBake,3,'two condition road repeats and one terrain atlas at startup');
assert.equal(dreamBake.status(dreamScene).profile,'dreamland');
assert.equal(dreamBake.roadTile('',false).width,128);
assert.notEqual(dreamBake.roadTile('lantern',true),dreamBake.roadTile('',false));
assert.equal(dreamBake.roadTile('lantern',true),dreamBake.roadTile('',true));
for(const variant of ['suppressed','burned','slime_trail','poison_path','paralysis_path','old_stones']) assert.equal(dreamBake.roadTile(variant,true),null,'special road retains normal material');
assert.equal(art.roadTile('',true),null,'Rogue profile never overrides roads');
assert.equal(dreamTextures.get('dreamland_terrain_composite').frames,2401);
console.log('Dreamland profile: bundled assets, condition-specific startup road repeats, hazard preservation and no Rogue road override passed');

for (const type of [0,1]) {
  const found=new Set();
  for(let y=-30;y<30;y++) for(let x=-30;x<30;x++) {
    const first=art.material(type,x,y);found.add(first);
    assert.equal(first,art.material(type,x,y),'patchwork is world-stable');
  }
  assert(found.has(type===0 ? 7 : 2),'native soil patches present');
  assert(found.has(type),'base grass retained');
}

const dreamAtlas=fs.readFileSync(dream.assets.dreamland_terrain_source.path);
assert.equal(dreamAtlas.readUInt32BE(16),16*32,'native-detail export matches source frame width');
assert.equal(dreamAtlas.readUInt32BE(20),7*32,'all seven families remain in the exported atlas');
assert.equal(dream.assets.dreamland_terrain_source.frameWidth,32);
assert.equal(assets.ra_terrain_source.frameWidth,16,'Rogue native scale remains unchanged');
