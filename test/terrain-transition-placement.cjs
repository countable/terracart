// Execute the shipping terrain sprite block against actual exported masks.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {decodePng}=require('../tools/sprite_audit.js');
const read=p=>fs.readFileSync(p,'utf8');
const art=new Function(read('src/ground_materials.js')+'\n'+read('src/terrain_transitions.js')+';return TerrainTransitions;')();
const atlas=decodePng(fs.readFileSync('assets/ArtTrials/RogueTerrain/tiles.png'));
const source=read('src/render.js');
const start=source.indexOf('        const ns = Render.terrainSpriteAt(scene, noiseIdx++);');
const end=source.indexOf('\n      // Road-name label',start);
assert(start>=0&&end>start);
const block=source.slice(start,end).replace(/\n\s*}\s*$/,'');
const wateredTint=source.match(/const WATERED_TINT = (0x[0-9a-f]+);/)[1];
const paint=new Function('scene','transitionMaterials','RING','_si','sx','sy','isTilled','type','TerrainTransitions',
  'let noiseIdx=0;const absCellIX=0,absCellIY=0,col=0,row=0,transitionsActive=true,skyLevel=false,isWatered=!!scene.testWatered,polyGround=-1,riftGround=false,CELL_PX=16,TILLED_VARIANTS=1,WATERED_TINT='+wateredTint+';'+
  'const T=()=>type,MountainEdges=undefined,BIOME_TEX={12:{variants:1}},polygonBuilding=()=>true,avalanche32=x=>x>>>0;'+
  'const Render={terrainSpriteAt:()=>scene.sprite()},setTextureIfDifferent=(s,key,frame)=>{s.key=key;s.frame=frame;return true;};'+
  block);
function draw(ring,stride,index,x,y,options={}){
  const sprites=[],offered=[];
  const scene={_terrainTransitionsReady:true,depth:0,testWatered:!!options.watered,
    terrainCache:{offer(s){offered.push({x:s.x,y:s.y});}},
    sprite(){const s={setDisplaySize(){return this;},setPosition(x,y){this.x=x;this.y=y;return this;},
      setVisible(v){this.visible=v;return this;},setTint(tint){this.tint=tint;return this;}};sprites.push(s);return s;}};
  paint(scene,ring,stride,index,x,y,!!options.tilled,options.type??5,art);
  for(const s of sprites.filter(s=>s.visible))assert(offered.some(p=>p.x===s.x&&p.y===s.y),'cache sees the drawn coordinates');
  return sprites.filter(s=>s.visible);
}
function coverage(vertices,family){
  const stride=7,ring=new Int8Array(stride*stride).fill(15);
  for(const [x,y]of vertices)ring[y*stride+x]=family;
  const points=[];
  for(let y=0;y<stride-1;y++)for(let x=0;x<stride-1;x++){
    // Each lookup sees a reconstructed world halo, including cells across a tile seam.
    const index=y*stride+x;
    const sprites=draw(ring,stride,index,x*16,y*16);
    const halo=new Int8Array([ring[index],ring[index+1],ring[index+stride],ring[index+stride+1]]);
    const acrossSeam=draw(halo,2,0,x*16,y*16);
    assert.deepEqual(acrossSeam.map(s=>[s.key,s.frame,s.x,s.y]),sprites.map(s=>[s.key,s.frame,s.x,s.y]),
      'reconstructed tile/row halos preserve frame choice and placement');
    for(const s of sprites){
      if(Math.floor(s.frame/16)!==family)continue;
      for(let py=0;py<16;py++)for(let px=0;px<16;px++){
        const alpha=atlas.data[((Math.floor(s.frame/16)*16+py)*atlas.w+s.frame%16*16+px)*4+3];
        if(alpha)points.push([s.x+px+.5,s.y+py+.5]);
      }
    }
  }
  return points;
}
for(const [name,vertices,cx,cy]of[
  ['isolated',[[1,1]],24,24],
  ['vertical strip',[[2,1],[2,2],[2,3]],40,40],
  ['horizontal strip',[[1,2],[2,2],[3,2]],40,40],
  ['diagonal contacts',[[1,1],[2,2],[3,3]],40,40],
]){
  const pts=coverage(vertices,10);
  assert(pts.length>0);
  assert.equal(pts.reduce((n,p)=>n+p[0],0)/pts.length,cx,name+' stays centred horizontally');
  assert.equal(pts.reduce((n,p)=>n+p[1],0)/pts.length,cy,name+' stays centred vertically');
}
const ring=new Int8Array([15,10,10,10]);
const native=draw(ring,2,0,100,200);
assert(native.length>1,'mixed materials draw base and masks');
for(const s of native)assert.deepEqual([s.x,s.y],[108,208],'every native layer shares the centre-based position');
const bed=draw(ring,2,0,100,200,{tilled:true});
assert.equal(bed.at(-1).key,'tilled_0');
assert.deepEqual([bed.at(-1).x,bed.at(-1).y],[100,200],'bed stays on its owning cell');
assert(bed.slice(0,-1).every(s=>s.x===108&&s.y===208),'bed retains complete transitioning ground below');
assert.equal(bed.at(-1).tint,0xffffff,'dry bed uses its original colour');
const wetBed=draw(ring,2,0,100,200,{tilled:true,watered:true});
assert.equal(wetBed.at(-1).tint,Number(wateredTint),'water darkens the bed');
assert(wetBed.slice(0,-1).every(s=>s.tint===0xffffff),'watering leaves surrounding native ground untinted');
const edge=draw(new Int8Array([10,-1,-1,-1]),2,0,100,200);
assert.equal(edge.length,1,'unloaded neighbours retain a complete local base');
assert.deepEqual([edge[0].x,edge[0].y],[108,208]);
for(const options of[{tilled:true},{type:12}]){
  const exact=draw(new Int8Array([-1,-1,-1,-1]),2,0,100,200,options);
  assert.equal(exact.length,1);
  assert.deepEqual([exact[0].x,exact[0].y],[100,200],'tilled beds and structural floors stay exact-cell');
}
console.log('Terrain placement: actual atlas islands/strips/diagonals centred; shared layers, unloaded halo and exact floors passed.');
