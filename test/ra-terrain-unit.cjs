const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('src/ra_terrain_trial.js', 'utf8');
function load(search) {
  const assets = {};
  const art = new Function('location','ASSETS','window', source + '\nreturn RATerrainTrial;')({search},assets,{});
  return {art,assets};
}
for (const search of ['', '?raPreview=jungle', '?artTrial=trees-water', '?artTrial=dreamland']) {
  const {art,assets}=load(search);
  assert.equal(art.enabled,true, 'Rogue is active without an opt-in and for retired profile URLs');
  assert.equal(art.status({}).profile,'rogue');
  assert.equal(assets.ra_terrain_source.path,'assets/ArtTrials/RogueTerrain/tiles.png');
  assert(!Object.keys(assets).some(key=>key.startsWith('dreamland_')));
  assert.equal(art.select({},new Int8Array(4),2,0),null, 'unprepared scene must not select an atlas');
}
const {art,assets}=load('?artTrial=rogue');
assert.equal(assets.ra_terrain_source.path,'assets/ArtTrials/RogueTerrain/tiles.png');
const frames=new Set();
for(let a=0;a<10;a++)for(let b=0;b<10;b++)for(let c=0;c<10;c++)for(let d=0;d<10;d++) {
  const values=[a,b,c,d];
  const frame=art.frameFor(values);
  assert(frame>=0&&frame<10000);frames.add(frame);
  let coverage=0;
  for(let material=0;material<10;material++) {
    const mask=art.maskFor(values,material);
    assert.equal(coverage&mask,0);coverage|=mask;
  }
  assert.equal(coverage,15);
}
assert.equal(frames.size,10000);
assert.equal(art.maskFor([4,0,0,4],4),9,'diagonal water islands retain authored disconnected mask');
for(const type of [5,9,10,11,12,16,24,25,26,28,32]) assert.equal(art.material(type),-1,'special terrain stays with existing renderer');
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
assert.equal(canvases,1);assert.equal(reads,0);assert(draws>10000);
assert.equal(textures.get('ra_terrain_composite').frames,10000);
for (const family of [1,5]) {
  const frame=art.frameFor([family,4,family,4]);
  const x=frame%100*16,y=Math.floor(frame/100)*16;
  const layers=painted.filter(args=>args[5]===x&&args[6]===y);
  assert.equal(layers[0][1],15*16,'underfill uses complete center');
  assert.equal(layers[0][2],family*16,'forest and sand banks reveal their actual local ground');
  assert(layers.every(args=>args[2]!==0),'no unrelated village grass leaks below shoreline');
}
console.log('RA terrain: 10000 combinations, unconditional Rogue profile, native masks, immutable inputs and single startup bake passed');
assert.equal(art.roadTile('',true),null,'Rogue profile never overrides roads');

for (const type of [0,1,29,31]) {
  const expected=art.material(type,0,0);
  for(let y=-30;y<30;y++)for(let x=-30;x<30;x++)assert.equal(art.material(type,x,y),expected);
}
assert.equal(art.material(29),8);assert.equal(art.material(31),9);
assert.equal(assets.ra_terrain_source.frameWidth,16,'Rogue native scale remains unchanged');
assert.equal(reads,0,'world-stable selection performs no pixel readback');
// The opt-in layered path never allocates a permutation canvas.
const {art:layered}=load('?terrainLayers=on');
const layeredScene={textures:{exists(){throw Error('Layered prepare must not inspect a baked atlas');}}};
layered.prepare(layeredScene);
assert.equal(layered.status(layeredScene).atlasFrames,0);
assert.equal(layered.status(layeredScene).layered,true);
for(let a=0;a<10;a++)for(let b=0;b<10;b++)for(let c=0;c<10;c++)for(let d=0;d<10;d++) {
  const values=[a,b,c,d],layers=layered.layersFor(values);
  assert.equal(layers.length,new Set(values).size);
  assert.equal(layers[0]%16,15,'first layer is opaque');
  assert(layers.length<=4);
  for(const frame of layers)assert(values.includes(Math.floor(frame/16)),'only local materials');
  if(values.includes(4))assert.equal(Math.floor(layers.at(-1)/16),4,'water banks draw last');
}
assert.deepEqual(layered.select(layeredScene,new Int8Array([8,-1,4,4]),2,0),
  {key:'ra_terrain_source',frame:8*16+15,layers:[4*16+12]});
console.log('Layered prototype: 10,000 combinations, <=4 layers, local underfill, water priority, no permutation atlas passed');
