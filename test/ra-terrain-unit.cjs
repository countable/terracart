const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('src/ground_materials.js', 'utf8') + '\n' + fs.readFileSync('src/terrain_transitions.js', 'utf8');
function load(search = '') {
  const assets = {};
  const art = new Function('location', 'ASSETS', 'window', source + '\nreturn TerrainTransitions;')({search}, assets, {});
  return {art, assets};
}
for (const search of ['', '?terrainLayers=on', '?terrainLayers=off', '?raPreview=jungle', '?artTrial=dreamland']) {
  const {art, assets} = load(search);
  assert.equal(assets.ra_terrain_source.path, 'assets/ArtTrials/RogueTerrain/tiles.png');
  assert.equal(assets.ra_terrain_source.frameWidth, 16);
  assert(!Object.keys(assets).some(key => key.startsWith('dreamland_')));
  assert.equal(art.select({}, new Int8Array(4), 2, 0), null, 'unprepared scene does not select terrain');
  const scene = {textures: new Proxy({}, {get() { throw Error('prepare must not allocate or inspect a permutation atlas'); }})};
  art.prepare(scene); art.prepare(scene);
  assert.equal(art.status(scene).ready, true);
}
const {art} = load();
const count = art.families.length;
assert(count >= 25, 'all added selected ground and rocky variants have transition families');
// The exported rows must match runtime indices and retain exact selected centers.
const manifest = JSON.parse(fs.readFileSync('assets/ArtTrials/RogueTerrain/manifest.json','utf8'));
assert.deepEqual(manifest.families.map(family => family.id), [...art.families]);
assert.equal(manifest.rows, count);
const {decodePng} = require('../tools/sprite_audit.js');
const atlas = decodePng(fs.readFileSync('assets/ArtTrials/RogueTerrain/tiles.png'));
const selected = decodePng(fs.readFileSync('assets/selected-terrain/selected-terrain.png'));
assert.equal(atlas.w,16*16); assert.equal(atlas.h,count*16);
const pixel = (image,x,y) => image.data.subarray((y*image.w+x)*4,(y*image.w+x+1)*4);
for (const family of manifest.families) {
  for (let y=0;y<16;y++) for (let x=0;x<16;x++) {
    assert.equal(pixel(atlas,x,family.index*16+y)[3],0,'empty masks stay transparent');
    const center=pixel(atlas,15*16+x,family.index*16+y);
    assert.equal(center[3],255,'every material supplies an opaque base');
    if (family.selectedFrame != null)
      assert.deepEqual(center,pixel(selected,family.selectedFrame*16+x,y),family.id+' preserves its selected center pixels');
  }
  if (family.maskFamily === 'oliveSoil') for (let mask=0;mask<16;mask++)
    for (let y=0;y<16;y++) for (let x=0;x<16;x++)
      assert.equal(pixel(atlas,mask*16+x,family.index*16+y)[3],pixel(atlas,mask*16+x,2*16+y)[3],
        family.id+' retains the authored earth silhouette for mask '+mask);
}
assert.equal(manifest.families[11].selectedMaterial,'R01','commercial restores square concrete');
assert.equal(manifest.families[12].selectedMaterial,'R02','commercial keeps its original concrete variant');
let combinations = 0;
for (let a = 0; a < count; a++) for (let b = 0; b < count; b++)
  for (let c = 0; c < count; c++) for (let d = 0; d < count; d++) {
    const values = [a,b,c,d], before = values.slice();
    const normalized = art.transitionValues(values), unique = new Set(normalized), layers = art.layersFor(values);
    assert.deepEqual(values,before,'normalizing variants never changes geographic material inputs');
    assert.equal(layers.length, unique.size);
    assert.equal(layers[0] % 16, 15, 'the lowest local material fills every pixel');
    assert(layers.length <= 4);
    let coverage = 0;
    for (const family of unique) {
      const mask = art.maskFor(normalized, family);
      assert.equal(coverage & mask, 0, 'each vertex belongs to only one material');
      coverage |= mask;
    }
    assert.equal(coverage, 15, 'all four vertices are covered');
    for (let i = 0; i < layers.length; i++) {
      const family = Math.floor(layers[i] / 16);
      assert(unique.has(family), 'no unrelated ground can leak below a corner');
      if (i) assert.equal(layers[i] % 16, art.maskFor(normalized, family), 'overlay keeps the native mask');
    }
    if (unique.has(4)) assert.equal(Math.floor(layers.at(-1) / 16), 4, 'water banks draw last');
    combinations++;
  }
// Authored variations are one continuous terrain, not separate soil islands.
for (const [values, normalized, frames] of [
  [[11,12,12,11],[11,11,11,11],[11*16+15]],
  [[12,11,11,12],[12,12,12,12],[12*16+15]],
  [[14,13,13,14],[14,14,14,14],[14*16+15]],
  [[24,21,22,23],[24,24,24,24],[24*16+15]],
  [[12,11,21,22],[12,12,21,21],[12*16+15,21*16+12]],
  [[0,14,13,4],[0,14,14,4],[15,14*16+6,4*16+8]],
]) {
  assert.deepEqual(art.transitionValues(values),normalized,'shared variants use the first local texture');
  assert.deepEqual(art.layersFor(values),frames,'variant changes do not cut soil-shaped holes');
}
assert.equal(art.maskFor([4,0,0,4], 4), 9, 'diagonal water contacts preserve the disconnected mask');
assert.deepEqual(art.layersFor([10,11,21,4]), [10*16+15,11*16+2,21*16+4,4*16+8]);
const scene = {_terrainTransitionsReady:true, _terrainTransitionAudit:{drawnCells:0, materials:{}}};
const ring = new Int8Array([8,-1,4,4]), before = ring.slice();
assert.deepEqual(art.select(scene, ring, 2, 0),
  {key:'ra_terrain_source', frame:8*16+15, layers:[4*16+12]});
assert.deepEqual(ring, before, 'selection never writes geographic inputs');
assert.equal(art.status(scene).drawnCells, 1);
assert.equal(art.status(scene).materials.churchyard, 1);
for (const type of [0,1,2,3,4,5,6,10,15,16,17,18,19,20,21,22,23,27,28,29,31,33]) {
  const family = art.material(type);
  assert(family >= 0 && family < count, 'surface material '+type+' has transitions');
  for (const [x,y] of [[0,0],[-20,13],[31,-18]]) assert.equal(art.material(type,x,y), family);
}
for (const type of [9,11,12,24,25,26,32]) assert.equal(art.material(type), -1, 'structures and mountain overlays retain their owners');
assert.equal(art.material(23), art.material(3), 'pier retains water underneath');
assert.notEqual(art.material(5),art.material(10),'public residential retains released light slate independently of rock');
const overrides = {G01:15,G02:16,G03:17,G04:13,G06:19,G10:20,'G09-cold':10,'G06-purple':8,'G09-smooth-grey':9};
for (const [id, family] of Object.entries(overrides))
  assert.equal(art.materialForGround(28,'zone_ground_'+id,3,-8), family, 'Nexus '+id+' receives its own masked texture');
for (const [type, options] of [[16,[11,12]],[27,[13,14]],[33,[21,22,23,24]]]) {
  const seen = new Set();
  for (let y = -12; y < 12; y++) for (let x = -12; x < 12; x++) {
    const family = art.materialForGround(type,null,x,y);
    assert(options.includes(family));
    assert.equal(art.materialForGround(type,null,x,y), family, 'variant selection is world-stable');
    seen.add(family);
  }
  assert.equal(seen.size, options.length, 'all authored variants remain available for '+type);
}
console.log('Stacked terrain: '+combinations+' combinations, complete surface coverage, <=4 local layers, water priority and no permutation atlas passed');

assert.equal(art.materialForGround(32),art.material(10),'road backdrops inherited from bedrock have a flat masked interior');
