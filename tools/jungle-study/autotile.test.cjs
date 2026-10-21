const assert=require('node:assert/strict');
const A=require('../jungle-autotile.js');
let checks=0;function check(fn){fn();checks++}
check(()=>assert.equal(A.MASKS.length,47));
for(let mask=0;mask<256;mask++)check(()=>{
 const m=A.canonicalMask(mask);assert.equal(A.canonicalMask(m),m);
 for(const [diagonal,a,b] of [[2,1,4],[8,4,16],[32,16,64],[128,64,1]])
 if(m&diagonal)assert.ok((m&a)&&(m&b));
});
const grid=(rows)=>(x,y)=>rows[y]?.[x]==='#';
check(()=>assert.equal(A.maskAt(1,1,grid(['...','.#.','...'])),0));
check(()=>assert.equal(A.maskAt(1,1,grid(['###','###','###'])),255));
check(()=>assert.equal(A.maskAt(1,1,grid(['#.#','.#.','#.#'])),0));
check(()=>assert.deepEqual(A.quadrants(A.maskAt(1,1,grid(['.#.','###','.#.']))).map(q=>q.kind),['inner','inner','inner','inner']));
check(()=>assert.deepEqual(A.quadrants(A.maskAt(1,1,grid(['.#.','.#.','.#.']))).map(q=>q.kind),['vertical','vertical','vertical','vertical']));
check(()=>assert.deepEqual(A.quadrants(A.maskAt(1,1,grid(['...','###','...']))).map(q=>q.kind),['horizontal','horizontal','horizontal','horizontal']));
check(()=>assert.deepEqual(A.quadrants(A.maskAt(1,1,grid(['...','.#.','...']))).map(q=>q.kind),['outer','outer','outer','outer']));
// A missing diagonal is a real concave shoreline even with all cardinal neighbors.
check(()=>assert.deepEqual(A.quadrants(A.maskAt(1,1,grid(['.##','###','###']))).map(q=>q.kind),['inner','center','center','center']));
// Getter spans storage chunks; neither tile-cache boundary nor negative coordinates truncate neighborhoods.
check(()=>{
 const chunks=new Map();for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++){
 const tx=Math.floor(x/2),ty=Math.floor(y/2),key=tx+','+ty;
 if(!chunks.has(key))chunks.set(key,{});chunks.get(key)[x+','+y]=true;
 }
 const getter=(x,y)=>chunks.get(Math.floor(x/2)+','+Math.floor(y/2))?.[x+','+y];
 assert.equal(A.maskAt(0,0,getter),255);assert.equal(A.maskAt(-1,-1,getter),255);
});
const opts={x:80,y:528,tileSize:16,inner:{nw:[144,544],ne:[136,544],sw:[144,536],se:[136,536]}};
check(()=>assert.deepEqual(A.sourceQuarters(0,opts).map(q=>[q.sx,q.sy]),[[80,528],[120,528],[80,568],[120,568]]));
check(()=>assert.deepEqual(A.sourceQuarters(255,opts).map(q=>[q.sx,q.sy]),[[96,544],[104,544],[96,552],[104,552]]));
check(()=>assert.deepEqual(A.sourceQuarters(85,opts).map(q=>[q.sx,q.sy]),[[144,544],[136,544],[144,536],[136,536]]));
check(()=>assert.throws(()=>A.sourceQuarters(85,{tileSize:16}),/Missing authored/));
check(()=>assert.equal(A.sourceQuarters(85,{innerFallback:'center'}).filter(q=>q.fallback).length,4));
// Prebuild uses only authored quarter crops and native-size draws, never image pixel reads.
check(()=>{
 const draws=[],context={drawImage:(...args)=>draws.push(args)};
 const atlas=A.buildAtlas({}, {...opts,createCanvas:()=>({getContext:()=>context})});
 assert.equal(draws.length,47*4);assert.equal(Object.keys(atlas.frames).length,47);
 assert.deepEqual(atlas.fallbackMasks,[]);assert.equal(context.imageSmoothingEnabled,false);
 assert.equal(atlas.canvas.width,128);assert.equal(atlas.canvas.height,96);
 for(const d of draws){assert.equal(d[3],8);assert.equal(d[4],8);assert.equal(d[7],8);assert.equal(d[8],8)}
});
const dualOpts={x:80,y:528,inner:{nw:[144,544],ne:[128,544],sw:[144,528],se:[128,528]}};
for(let mask=0;mask<16;mask++)check(()=>{
 const get=(x,y)=>!!(mask & (1<<(y*2+x)));
 assert.equal(A.dualMaskAt(0,0,get),mask);
 const tiles=A.dualTiles(mask,dualOpts);
 assert.equal(tiles.length,mask===0?0:mask===6||mask===9?2:1);
 for(const t of tiles){assert.equal(t.width,16);assert.equal(t.height,16)}
});
check(()=>assert.deepEqual(A.dualTiles(1,dualOpts).map(t=>[t.sx,t.sy]),[[112,560]]));
check(()=>assert.deepEqual(A.dualTiles(8,dualOpts).map(t=>[t.sx,t.sy]),[[80,528]]));
check(()=>assert.deepEqual(A.dualTiles(3,dualOpts).map(t=>[t.sx,t.sy]),[[96,560]]));
check(()=>assert.deepEqual(A.dualTiles(12,dualOpts).map(t=>[t.sx,t.sy]),[[96,528]]));
check(()=>assert.deepEqual(A.dualTiles(14,dualOpts).map(t=>[t.sx,t.sy]),[[144,544]]));
check(()=>assert.deepEqual(A.dualTiles(9,dualOpts).map(t=>[t.sx,t.sy]),[[112,560],[80,528]]));
check(()=>assert.throws(()=>A.dualTiles(7),/Missing authored full inner/));
check(()=>{
 const draws=[],ctx={drawImage:(...args)=>draws.push(args)};
 const atlas=A.buildDualAtlas({}, {...dualOpts,createCanvas:()=>({getContext:()=>ctx})});
 assert.equal(draws.length,17);assert.equal(Object.keys(atlas.frames).length,16);
 assert.equal(atlas.canvas.width,64);assert.equal(atlas.canvas.height,64);
 for(const d of draws){assert.equal(d[3],16);assert.equal(d[4],16);assert.equal(d[7],16);assert.equal(d[8],16)}
});
console.log(JSON.stringify({checks,canonicalMasks:47,dualMasks:16,passed:true}));
