// Independent geometry and browser checks for the isolated irregular FDR trial.
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs');
const EPS=1e-5;
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const area=p=>Math.abs(p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a.x*b.y-b.x*a.y},0))/2;
function inside(p,ring){
 let hit=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[j],b=ring[i];
  if(Math.abs(cross(a,b,p))<=EPS&&p.x>=Math.min(a.x,b.x)-EPS&&p.x<=Math.max(a.x,b.x)+EPS&&p.y>=Math.min(a.y,b.y)-EPS&&p.y<=Math.max(a.y,b.y)+EPS)return true;
  if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;
 }
 return hit;
}
// Split each tested edge at every boundary crossing; test all resulting intervals.
// This catches concave excursions even when both vertices and the midpoint fit.
function contains(poly,ring){
 if(!poly.every(p=>inside(p,ring)))return false;
 for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],dx=b.x-a.x,dy=b.y-a.y,ts=[0,1];
  for(let j=0;j<ring.length;j++){
   const c=ring[j],d=ring[(j+1)%ring.length],ex=d.x-c.x,ey=d.y-c.y,den=dx*ey-dy*ex;
   if(Math.abs(den)<EPS)continue;
   const t=((c.x-a.x)*ey-(c.y-a.y)*ex)/den,u=((c.x-a.x)*dy-(c.y-a.y)*dx)/den;
   if(t>0&&t<1&&u>=0&&u<=1)ts.push(t);
  }
  ts.sort((a,b)=>a-b);
  for(let j=1;j<ts.length;j++){const t=(ts[j-1]+ts[j])/2;if(!inside({x:a.x+dx*t,y:a.y+dy*t},ring))return false;}
 }
 return true;
}
// SAT detects positive-area overlap of convex pieces, allowing shared edges.
function overlap(a,b){
 for(const poly of [a,b])for(let i=0;i<poly.length;i++){
  const p=poly[i],q=poly[(i+1)%poly.length],len=Math.hypot(q.x-p.x,q.y-p.y);if(len<EPS)continue;
  const nx=(p.y-q.y)/len,ny=(q.x-p.x)/len,pa=a.map(v=>v.x*nx+v.y*ny),pb=b.map(v=>v.x*nx+v.y*ny);
  if(Math.min(Math.max(...pa),Math.max(...pb))-Math.max(Math.min(...pa),Math.min(...pb))<=EPS)return false;
 }
 return true;
}
function validate(layout,shape){
 assert.ok(layout,`${shape}: missing layout`);
 const {points:ring,towers,walls,merlons,keep}=layout;
 assert.ok(ring.length>=3);assert.ok(walls.length>0);assert.ok(merlons.length>0);
 const validPolygon=(poly,label,contained=true)=>{
  assert.ok(poly.length>=3,label);assert.ok(poly.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)),label);
  assert.ok(area(poly)>EPS,`${label}: nonzero area`);
  const turns=poly.map((a,i)=>cross(a,poly[(i+1)%poly.length],poly[(i+2)%poly.length])).filter(v=>Math.abs(v)>EPS);
  assert.ok(turns.every(v=>v>0)||turns.every(v=>v<0),`${label}: convex piece required for SAT`);
  if(contained)assert.ok(contains(poly,ring),`${label}: outside footprint`);
 };
 for(const [kind,pieces] of Object.entries({towers,walls,merlons}))pieces.forEach((p,i)=>validPolygon(p.points,`${shape}/${kind}/${i}`,kind!=='towers'));
 for(const [kind,pieces] of Object.entries({towers,walls,merlons}))for(let i=0;i<pieces.length;i++)for(let j=i+1;j<pieces.length;j++)assert.equal(overlap(pieces[i].points,pieces[j].points),false,`${shape}/${kind}: overlap ${i}/${j}`);
 for(const tower of towers){
  assert.equal(contains(tower.points,ring),false,'tower projects beyond outer footprint');
  for(const i of [tower.corner,(tower.corner+ring.length-1)%ring.length]){
   const edge=layout.edges[i];assert.ok(overlap(tower.points,edge.strip),'tower receives both adjacent curtains');
   assert.ok(tower.points.some(p=>cross(edge.a,edge.b,p)<-EPS),'tower projects outside each adjacent wall');
  }
 }
 for(const wall of walls)for(const tower of towers)assert.equal(overlap(wall.points,tower.points),false,`${shape}: wall penetrates tower`);
 for(const m of merlons){
  assert.equal(m.base,m.rimTop,'merlon seated on coping');assert.ok(m.top>m.base);assert.ok(contains(m.points,m.rim),'merlon within rim');
  for(const t of towers)assert.equal(overlap(m.points,t.points),false,'curtain merlon penetrates tower');
  // Sample both the perimeter and interior against actual clipped wall pieces.
  const center=m.points.reduce((s,p)=>({x:s.x+p.x/m.points.length,y:s.y+p.y/m.points.length}),{x:0,y:0});
  for(let i=0;i<m.points.length;i++)for(let j=0;j<=8;j++)for(const f of [0,.5,1]){
   const a=m.points[i],b=m.points[(i+1)%m.points.length],edge={x:a.x+(b.x-a.x)*j/8,y:a.y+(b.y-a.y)*j/8},p={x:center.x+(edge.x-center.x)*f,y:center.y+(edge.y-center.y)*f};
   assert.ok(walls.some(w=>inside(p,w.points)),`${shape}: unsupported merlon sample`);
  }
 }
 if(keep){validPolygon(keep.points,'keep');validPolygon(keep.clearance,'keep clearance');assert.ok(contains(keep.points,keep.clearance));for(const p of [...walls,...towers])assert.equal(overlap(keep.clearance,p.points),false,`${shape}: keep clearance blocked`);}
 if(shape==='narrow')assert.equal(keep,null,'narrow lot omits keep');
 let perimeterSamples=0;
 for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length],n=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)*2);
  for(let j=0;j<=n;j++){const p={x:a.x+(b.x-a.x)*j/n,y:a.y+(b.y-a.y)*j/n};assert.ok([...walls,...towers].some(v=>inside(p,v.points)),`${shape}: uncovered perimeter ${i}:${j}/${n}`);perimeterSamples++;}
 }
 return {towers:towers.length,walls:walls.length,merlons:merlons.length,keep:!!keep,perimeterSamples,independentContainment:true,convexSATDisjoint:true,keepClear:true,merlonSupportSampled:true};
}
async function rotationCheck(page){return page.evaluate(()=>{
 const scene=fdrGeometryScene,panels=scene.panels,blocks=panels.map(p=>p.group.blocks.slice());
 let allocations=0,reads=0,refreshes=0;const create=scene.textures.createCanvas,read=CanvasRenderingContext2D.prototype.getImageData;
 scene.textures.createCanvas=function(...args){allocations++;return create.apply(this,args)};
 CanvasRenderingContext2D.prototype.getImageData=function(...args){reads++;return read.apply(this,args)};
 const textures=scene.textures.getTextureKeys().map(k=>scene.textures.get(k)).filter(t=>t.refresh),originals=textures.map(t=>t.refresh);
 textures.forEach(t=>{const original=t.refresh;t.refresh=function(...args){refreshes++;return original.apply(this,args)}});
 const keys=scene.textures.getTextureKeys().sort().join(',');let finite=true;const emitted=[];
 try{for(let deg=0;deg<=360;deg++){
  document.getElementById('angle').value=deg;scene.update(0,0);emitted.push(panels[1].group.gfx._wallTriangles.length);
  for(const p of panels)for(const b of p.group.blocks){finite&&=[...b.projected].every(Number.isFinite);for(const f of b.materialFaces||[])finite&&=f.points.every(v=>[v.x,v.y,v.z,v.u,v.v].every(Number.isFinite));}
  for(const t of panels[1].group.gfx._wallTriangles){finite&&=t.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));if(t.uv)finite&&=t.uv.every(p=>Number.isFinite(p.u)&&Number.isFinite(p.v));}
 }}finally{scene.textures.createCanvas=create;CanvasRenderingContext2D.prototype.getImageData=read;textures.forEach((t,i)=>t.refresh=originals[i]);}
 return {headings:361,allocations,reads,refreshes,finite,textureKeysStable:keys===scene.textures.getTextureKeys().sort().join(','),blocksRetained:panels.every((p,i)=>p.group.blocks.length===blocks[i].length&&blocks[i].every(b=>p.group.blocks.includes(b))),prisms:blocks[1].length,submittedMin:Math.min(...emitted),submittedMax:Math.max(...emitted)};
});}
(async()=>{
 const out=process.env.OUT_DIR||'/tmp/fdr-irregular-checks';fs.mkdirSync(out,{recursive:true});
 const env={...process.env};delete env.DISPLAY;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/lib/chromium/chromium',env,args:['--no-sandbox','--ozone-platform=headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const results=[];let failure;
 try{for(const renderer of ['webgl','canvas']){
  const page=await browser.newPage({viewport:{width:1320,height:1040},deviceScaleFactor:1}),errors=[],failed=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push([r.status(),r.url()])});
  const url=new URL(process.env.STUDY_URL||'http://localhost:8765/fdr-castle-trial/');if(renderer==='canvas')url.searchParams.set('canvas','');
  await page.goto(url.href);await page.waitForFunction(()=>window.ready===true,null,{timeout:30000});
  for(const shape of ['concave','narrow','skewed','acute'])for(const palette of ['warm','cool']){
   const audit=await page.evaluate(({shape,palette})=>{document.getElementById('shape').value=shape;document.getElementById('palette').value=palette;fdrGeometryScene.rebuild();return fdrGeometryAudit},{shape,palette});
   assert.equal(audit.shape,shape);assert.equal(audit.panels[1].billboards,0);const geometry=validate(audit.panels[1].layout||audit.layout,shape),rotation=await rotationCheck(page);
   for(const key of ['allocations','reads','refreshes'])assert.equal(rotation[key],0,key);
   for(const key of ['finite','textureKeysStable','blocksRetained'])assert.equal(rotation[key],true,key);
   assert.ok(rotation.submittedMin>0);
   await page.selectOption('#zoom','1.6');
   const captures=[];
   for(const angle of palette==='warm'?[0,45,90,135,180,225,270,315]:[45]){
    await page.locator('#angle').fill(String(angle));await page.waitForTimeout(80);
    const name=`${renderer}-${shape}-${palette}-${angle}.png`;await page.locator('#game').screenshot({path:`${out}/${name}`});captures.push(name);
   }
   results.push({renderer,shape,palette,geometry,rotation,captures});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);await page.close();
 }}catch(error){failure=error;}finally{await browser.close();fs.writeFileSync(`${out}/checks.json`,JSON.stringify({passed:!failure,results,error:failure?.stack},null,2)+'\n');}
 if(failure)throw failure;console.log(JSON.stringify({passed:true,combinations:results.length,out}));
})().catch(error=>{console.error(error);process.exitCode=1;});
