// Archived historical mixed-profile tests; Rogue is now the sole runtime profile.
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
assert.equal(dream.assets.dreamland_terrain_source.path,'extra_assets/inactive/assets/ArtTrials/DreamlandTerrain/terrain.png');
assert.equal(dream.assets.dreamland_path_source.path,'extra_assets/inactive/assets/ArtTrials/DreamlandTerrain/path.png');
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
assert.equal(dreamBake.roadTile('',false).width,96,'four native slabs repeat at 24px without changing road masks');
assert.notEqual(dreamBake.roadTile('lantern',true),dreamBake.roadTile('',false));
assert.equal(dreamBake.roadTile('lantern',true),dreamBake.roadTile('',true));
for(const variant of ['suppressed','burned','slime_trail','poison_path','paralysis_path','old_stones']) assert.equal(dreamBake.roadTile(variant,true),null,'special road retains normal material');
assert.equal(art.roadTile('',true),null,'Rogue profile never overrides roads');
assert.equal(dreamTextures.get('dreamland_terrain_composite').frames,2976);
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

// Detail repeats follow world coordinates, including across negative origins;
// mixed-material boundaries keep exactly the original native transition frame.
const uniform = new Int8Array([2,2,2,2]);
const phases = new Set();
const beforeSelectCanvases = canvases;
for (let y = -3; y < 3; y++) for (let x = -3; x < 3; x++) {
  const selected = dreamBake.select(dreamScene, uniform, 2, 0, x, y).frame;
  phases.add(selected);
  assert.equal(selected, dreamBake.select(dreamScene, uniform, 2, 0, x + 3, y + 3).frame);
  assert(selected >= 2419 && selected < 2428);
}
assert.equal(phases.size,9,'24px repeats need nine phase combinations across 32px cells');
assert.equal(dreamBake.select(dreamScene, new Int8Array([0,2,0,0]), 2, 0, 2, 2).frame,
  dreamBake.frameFor([0,2,0,0]), 'native transition shape and frame are unchanged');
assert.equal(canvases,beforeSelectCanvases,'world selection creates no canvases');
assert.equal(reads,0,'phase baking and selection need no pixel readback');
console.log('Dreamland smaller interiors: 63 bounded phase frames, world stability and original transitions passed');

// Grass art now has its own half-cell sampling lattice; adjacent gameplay
// cells must encode the exact same three vertices along their shared edge.
function grassFrame(x, y) {
  const ring = new Int8Array([dreamBake.material(0,x,y), dreamBake.material(0,x+1,y),
    dreamBake.material(0,x,y+1), dreamBake.material(0,x+1,y+1)]);
  const frame = dreamBake.select(dreamScene,ring,2,0,x,y).frame;
  assert(frame >= 2464 && frame < 2976);
  return frame - 2464;
}
const right = code => ((code >> 2) & 1) | (((code >> 5) & 1) << 1) | (((code >> 8) & 1) << 2);
const left = code => (code & 1) | (((code >> 3) & 1) << 1) | (((code >> 6) & 1) << 2);
const bottom = code => (code >> 6) & 7;
const top = code => code & 7;
let fineEdges = 0;
for (let y = -12; y < 12; y++) for (let x = -12; x < 12; x++) {
  const code = grassFrame(x,y);
  assert.equal(right(code),left(grassFrame(x+1,y)), 'horizontal half-cell vertices join across negative and positive origins');
  assert.equal(bottom(code),top(grassFrame(x,y+1)), 'vertical half-cell vertices join');
  if (code !== 0 && code !== 511) fineEdges++;
}
assert(fineEdges > 100, 'smaller islands include many native-size edge cells');
const authored = {...dreamScene, _dreamlandGroundFamilyAt:()=>0};
assert.equal(dreamBake.select(authored,new Int8Array([0,1,0,0]),2,0,2,2).frame,
  dreamBake.frameFor([0,1,0,0]), 'authored reference grass outlines retain their original scale');
const forcedCorners = dreamBake.select(dreamScene,new Int8Array([1,0,0,1]),2,0,0,0).frame - 2464;
assert.equal(forcedCorners & 325,257,'fine grass preserves the world ring corner values');
// Validate the baked geometry for all 512 states: exactly four 16px underfills,
// and only 16px overlays, with no drawing outside each 32px composite cell.
const dreamColumns = Math.ceil(Math.sqrt(2976));
for (let code = 0; code < 512; code++) {
  const frame = 2464 + code;
  const ox = frame % dreamColumns * 32, oy = Math.floor(frame / dreamColumns) * 32;
  const subtiles = painted.filter(args => args[7] === 16 && args[8] === 16
    && args[5] >= ox && args[5] < ox+32 && args[6] >= oy && args[6] < oy+32);
  assert(subtiles.length >= 4);
  assert(subtiles.every(args => args[3] === 32 && args[4] === 32), 'native grass pixels shrink exactly 2:1');
}
assert.equal(canvases,beforeSelectCanvases);
assert.equal(reads,0);
console.log('Dreamland grass: 512 native-scale composites, smaller world-stable islands, shared edge vertices and authored preservation passed');
