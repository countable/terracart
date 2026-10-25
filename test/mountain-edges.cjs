// Pure runtime selector contract; run with node test/mountain-edges.cjs.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const context = { ASSETS: {}, window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'src/mountain_edges.js'), 'utf8'), context);
const { select } = context.window.MountainEdges;
const offsets = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
for (let mask = 0; mask < 256; mask++) {
  const ring = new Uint8Array(25); ring[12] = 32;
  offsets.forEach(([dx,dy], bit) => { ring[12 + dy * 5 + dx] = mask & (1 << bit) ? 32 : 5; });
  for (const [x,y] of [[0,0],[-1,-1],[-56123,1356],[56123,-1356]]) {
    const got = select(ring,5,12,x,y);
    assert.equal(got.key,'mountain_edges');
    assert.equal(got.frame % 256,mask,'all eight neighbor bits survive in the selected frame');
    assert(got.frame >= 0 && got.frame < 1024,'valid atlas frame at negative world coordinates');
    assert.equal(got.frame,select(ring,5,12,x,y).frame,'deterministic variation');
    // Relocating the same cell into another ring must retain its world-seeded art.
    const larger = new Uint8Array(49); larger[24] = 32;
    offsets.forEach(([dx,dy], bit) => { larger[24 + dy * 7 + dx] = mask & (1 << bit) ? 32 : 5; });
    assert.equal(select(larger,7,24,x,y).frame,got.frame,'ring size and local index never reroll a world cell');
  }
}
for (let type=0;type<64;type++) if(type!==32){
  const ring=new Uint8Array(9).fill(32);ring[4]=type;
  assert.equal(select(ring,3,4,-4,8),null,'other terrain never receives mountain art');
}
// A cell at a loaded tile edge sees its eastern neighbor through the ring halo.
const seam=new Uint8Array(25);seam[13]=32;seam[14]=32;
assert.equal(select(seam,5,13,100,100).frame%256,2,'neighbor in the ring halo closes the east edge');
seam[14]=5;
assert.equal(select(seam,5,13,100,100).frame%256,0,'open halo leaves the east edge exposed');
const asset=context.ASSETS.mountain_edges;
assert.equal(asset.kind,'spritesheet');assert.equal(asset.frameWidth,32);assert.equal(asset.frameHeight,32);
const png=fs.readFileSync(path.join(root,asset.path));
assert.equal(png.toString('ascii',1,4),'PNG');
assert.equal(png.readUInt32BE(16)/32 * (png.readUInt32BE(20)/32),1024,'atlas has every mask and variation');

const { groundType } = context.window.MountainEdges;
for (const type of [0, 2, 4, 5, 20, 29, 31]) {
  const ring = new Int8Array(25).fill(32); ring[13] = type;
  assert.equal(groundType(ring, 5, 12), type, 'rock inherits exposed non-rock ground');
}
const groundRing = new Int8Array(25).fill(32);
groundRing[11] = 9; groundRing[13] = 2;
assert.equal(groundType(groundRing, 5, 12), 2, 'building floors are not substrate');
groundRing[13] = -1;
assert.equal(groundType(groundRing, 5, 12), 10, 'missing neighbours do not invent grass');
// The renderer paints live terrain beneath this overlay. A baked soil apron
// hides it most visibly on one-cell islands, strips and diagonal contacts.
const {decodePng}=require('../tools/sprite_audit.js');
const atlas=decodePng(png);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/terrain/mountain-edges.json'),'utf8'));
const palette=new Set(manifest.palette.map(rgb=>rgb.join(',')));
const pixel=(frame,x,y)=>{
  const at=((Math.floor(frame/32)*32+y)*atlas.w+frame%32*32+x)*4;
  return atlas.data.subarray(at,at+4);
};
for(let frame=0;frame<1024;frame++)for(let y=0;y<32;y++)for(let x=0;x<32;x++){
  const p=pixel(frame,x,y);
  assert(p[3]===0||p[3]===255,'source silhouettes keep binary alpha');
  if(p[3])assert(palette.has([...p.subarray(0,3)].join(',')),'opaque pixels contain rock art, never a baked ground material');
}
for(let variant=0;variant<4;variant++){
  for(const mask of [0,3,12,9]){
    const frame=variant*256+mask;
    for(const [x,y] of [[0,0],[31,0],[0,31],[31,31]])
      assert.equal(pixel(frame,x,y)[3],0,'narrow and isolated rock reveals its live substrate at exposed corners');
    assert.equal(pixel(frame,16,16)[3],255,'rock body stays present between the exposed corners');
  }
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)
    assert.equal(pixel(variant*256+255,x,y)[3],255,'fully enclosed rock has no terrain-shaped holes');
}
console.log('Mountain edges: masks, ring seams, terrain gating, transparent narrow exteriors and opaque native rock bodies passed.');
