// Isolated authored reference map, with the normal renderer and production art hooks.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
http.createServer((req,res)=>{try{const u=new URL(req.url,'http://localhost');let file=path.resolve(root,'.'+decodeURIComponent(u.pathname));if(u.pathname==='/'||u.pathname==='/index.html')file=path.join(root,'index.html');if(!file.startsWith(root+'/'))throw Error('bad path');if(u.pathname==='/sw.js'){res.writeHead(404);return res.end()}
let body=fs.readFileSync(file);if(file.endsWith('/index.html'))body=body.toString().replace('<head>','<head><script src="/tools/ra-preview/init.js"></script>').replace('const BOX_W = 352, BOX_H = 844;','const BOX_W = 672, BOX_H = 844;').replace('</body>','<script src="/tools/dreamland-square-study/reference-fixture.js"></script></body>');
if(u.pathname==='/src/app.js')body=body.toString().replace('const W = 352, H = 844;','const W = 672, H = 844;').replace('const VIEW_CELLS = 11;','const VIEW_CELLS = 21;');
res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
}catch(e){res.writeHead(404);res.end(String(e))}}).listen(Number(process.env.PORT||8018),'127.0.0.1',()=>console.log('http://localhost:8018/?sandbox=true&artTrial=dreamland'));
