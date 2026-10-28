// Bake roadside grass/hedges through the production wall material renderer.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core');
module.exports=async function(root){
 const server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end()}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end()}const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.png':'image/png','.json':'application/json'})[ext]||'application/octet-stream');res.end(data)})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
 browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||'/usr/lib/chromium/chromium',args:['--no-sandbox','--ozone-platform=headless']});
 const page=await browser.newPage();
 await page.route('**/tools/wall-material-preview.html*',async route=>{const source=fs.readFileSync(path.join(root,'tools/wall-material-preview.html'),'utf8').replace("backgroundColor:'#17211e'","transparent:true");await route.fulfill({contentType:'text/html',body:source})});
 await page.goto('http://127.0.0.1:'+server.address().port+'/tools/wall-material-preview.html?canvas',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.ready);
 return await page.evaluate(async()=>{
  const real=window.wallReviewScene,game=window.wallReviewGame;
  for(const child of [...real.children.list])child.destroy();real.panels=[];game.scale.resize(64,64);
  real.cameras.main.setBackgroundColor('rgba(0,0,0,0)');
  const results={};
  for(const kind of ['hedge','grass_clump','creeping_vine']){
   for(const child of [...real.children.list])child.destroy();
   const root=real.add.container(32,32);
   const scene={_headingUp:true,depth:0,mapRot:0,events:real.events,add:real.add,textures:real.textures,buildingWallContainer:root};
   const group=WallPerspective.begin(scene,'review');
   if(kind==='hedge'||kind==='creeping_vine'){
    const profile=kind==='hedge'?'hedge':'vine',mask=kind==='hedge'?10:0;
    const thickness=Render.CONNECTED_WALL_ART[profile].thickness;
    const shape=Render.connectedWallOutline(mask,thickness),height=ObstacleStep.PROFILES[profile].heightPx;
    WallPerspective.material(scene,'review',profile,shape.points.map(p=>({x:p.x-16,y:p.y-16})),height,{openEdges:shape.openEdges,capRegions:Render.connectedWallFootprints(mask,thickness).map(([a,b,c,d],i)=>({x0:a-16,y0:b-16,x1:c-16,y1:d-16,horizontal:c-a>d-b,joints:i!==0}))});
   }else{
    WallMaterials.prepareGrass(scene);group.atlas=real.textures.get(WallMaterials.GRASS.texture);
    const square=[{x:-16,y:-16},{x:16,y:-16},{x:16,y:16},{x:-16,y:16}],faces=WallMaterials.geometry('grass',square,0,{sparseClump:true});
    for(let i=0;i<faces.length;i+=2){const {x,y}=faces[i].billboard,half=WallMaterials.GRASS.width*WallMaterials.GRASS.sparseScale/2;WallPerspective.prism(scene,'review',[{x:x-half,y:y-half},{x:x+half,y:y-half},{x:x+half,y:y+half},{x:x-half,y:y+half}],0,WallMaterials.GRASS.height*WallMaterials.GRASS.sparseScale,{face:0xffffff,top:0xffffff,dark:0xffffff},null,false,{materialFaces:faces.slice(i,i+2)})}
   }
   WallPerspective.finish(scene,'review');WallPerspective.update(scene);
   await new Promise(resolve=>{game.events.once('postrender',()=>requestAnimationFrame(resolve))});
   results['preview_3d_'+kind]={kind:'image',path:'runtime:street-decor-'+kind,dataUrl:game.canvas.toDataURL('image/png'),frameWidth:64,frameHeight:64};
  }
  return results;
 });
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
};
