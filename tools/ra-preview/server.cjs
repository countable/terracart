// Separate-origin, opt-in live renderer preview. Production files stay untouched.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'), cache='/tmp/terracart-ra-preview';
for(const theme of ['village','jungle']){
 execFileSync('python3',[path.join(root,`tools/${theme}-study/build_assets.py`),'--out',`${cache}/${theme}`]);
 fs.copyFileSync(path.join(root,`tools/${theme}-study/assets.json`),`${cache}/${theme}/assets.json`);
}
const mime={'.html':'text/html','.js':'application/javascript','.cjs':'application/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2'};
function once(s,a,b){if(s.split(a).length!==2)throw Error('Preview source anchor changed: '+a);return s.replace(a,b);}
http.createServer((req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost'), theme=url.searchParams.get('raPreview')==='jungle'?'jungle':'village';
 let pathname=decodeURIComponent(url.pathname), filename=path.resolve(root,'.'+pathname);
 if(pathname==='/'||pathname==='/index.html')filename=path.join(root,'index.html');
 const crop=pathname.match(/^\/__(village|jungle)\/(.*)$/);if(crop)filename=path.resolve(cache,crop[1],crop[2]);
 if(!(filename.startsWith(root+'/')||filename.startsWith(cache+'/')))throw Error('Invalid path');
 if(pathname==='/sw.js'){res.writeHead(404);return res.end();}
 let body=fs.readFileSync(filename);
 if(filename.endsWith('/index.html')){
 body=once(body.toString(),'<head>',`<head><script src="/tools/ra-preview/init.js"></script>`);
 body=body.replace('const BOX_W = 352, BOX_H = 844;', 'const BOX_W = 672, BOX_H = 844;');
 body=body.replace('</body>','<script src="/tools/ra-preview/live.js"></script></body>');
 }
 if(pathname==='/src/app.js')body=body.toString().replace('const W = 352, H = 844;','const W = 672, H = 844;').replace('const VIEW_CELLS = 11;','const VIEW_CELLS = 21;').replace('const DEBUG = false;','const DEBUG = true;').replace('const DEBUG_SPEED_MUL = 10;','const DEBUG_SPEED_MUL = 1;');
 if(pathname==='/src/lighting.js')body=require(path.join(root,`tools/${theme}-study/lighting-route.cjs`))(body.toString()).replaceAll('window.__JUNGLE_STUDY','(window.__JUNGLE_STUDY && !window.__scene?.depth)');
 if(pathname==='/src/render.js')body=once(once(body.toString(),'let spec = RENDER_SPEC[o.kind];',"let spec = (window.__raOriginalSpecs && !String(o.id).startsWith('village-') && !String(o.id).startsWith('jungle-') ? window.__raOriginalSpecs[o.kind] : RENDER_SPEC[o.kind]);"),'const ns = scene.noisePool[noiseIdx++];','const ns = scene.noisePool[noiseIdx++]; ns.__raCell = {x:absCellIX,y:absCellIY};');
 if(/^\/tools\/(village|jungle)-study\/apply.js$/.test(pathname))body=body.toString().replace(/Math.round\(\(ns.x - s.viewCenterX\) \/ 32\)/g,'ns.__raCell.x - __fixture.originCell.x').replace(/Math.round\(\(ns.y - s.viewCenterY \+ 26\) \/ 32\)/g,'ns.__raCell.y - __fixture.originCell.y').replace('Math.round((ns.x-s.viewCenterX)/32)','ns.__raCell.x - __fixture.originCell.x').replace('Math.round((ns.y-s.viewCenterY+26)/32)','ns.__raCell.y - __fixture.originCell.y');
 // All loaded scripts retain the selected theme across independent requests.
 if(filename.endsWith('/index.html'))body=body.toString().replace(/(src="[^"]+\.js)(\?[^"]*)?"/g,(_,a,q)=>a+(q?q+'&':'?')+'raPreview='+theme+'"');
 res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
 }catch(e){res.writeHead(500);res.end(String(e));}
}).listen(Number(process.env.PORT||8017),'127.0.0.1',()=>console.log('RA preview: http://localhost:8017/?sandbox=true&headingUp=false&raPreview=village'));
