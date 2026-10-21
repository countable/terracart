const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('src/road_overlay.js','utf8');
function load(enabled){
 const canvases=[];
 const context=()=>({draws:[],fillStyle:'',globalAlpha:1,drawImage(...args){this.draws.push(args);},fillRect(){}});
 const ctx={window:{},SpriteLayout:{CELL_PX:32},WorldGen:{CELL_M:7,T:{}},RogueObjects:{enabled},
  cssOf:()=>'#888',drawSelectedMaterial:()=>true,document:{createElement(){const c={width:0,height:0,ctx:context(),getContext(){return this.ctx;}};canvases.push(c);return c;}}};
 vm.createContext(ctx);vm.runInContext(source,ctx);return {api:ctx.window.RoadOverlay,canvases,context};
}
for(const enabled of [false,true]){
 const {api,canvases,context}=load(enabled),target=context();
 for(const restored of [false,true]){
  const start=canvases.length;api.paintPavementTile(target,32,false,restored,'plain');
  const tile=canvases[start],draws=tile.ctx.draws,w=enabled?4:16,h=enabled?2:16;
  assert.equal(tile.width,32);assert.equal(tile.height,32);
  assert(draws.length>0);assert(draws.every(d=>d[3]===w&&d[4]===h));
  // Each course covers the whole repeat; staggered ends wrap without gaps.
  for(let y=0;y<32;y+=h){const row=draws.filter(d=>d[2]===y);assert(row[0][1]<=0);assert(row.at(-1)[1]+w>=32);for(let i=1;i<row.length;i++)assert.equal(row[i][1]-row[i-1][1],w);}
  const count=canvases.length;api.paintPavementTile(target,32,false,restored,'plain');assert.equal(canvases.length,count,'reuses startup material canvas');
 }
}
console.log('RA paving: finer stones cover each 7m cell, seamless courses, condition caches, baseline unchanged');
