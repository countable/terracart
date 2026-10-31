// Compare the disguise and revealed enemy using the shipping scale and recolorer.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..'), ctx = {};
ctx.window = ctx; vm.createContext(ctx);
for (const name of ['enemy_roster', 'sprite_layout', 'art_atlas', 'selected_world_atlas', 'selected_item_art', 'assets']) vm.runInContext(fs.readFileSync(path.join(root,'src',name+'.js'),'utf8'),ctx);
const row = ctx.EnemyRoster.get('mimic'), art = ctx.SpriteLayout.creatureArt('mimic');
const data = {palette:row.palette, scale:art.scale, chestScale:ctx.SpriteLayout.CHEST_SCALE, frames:row.art.directions.down.idle, frameMs:row.art.frameMs, source:row.art.path, chest:ctx.ASSETS.chest.path};
const out=path.join(root,'design/mimic-reference');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mimic alignment</title><style>
body{background:#17231c;color:#eee6ce;font:17px/1.5 system-ui;margin:32px}main{max-width:1000px;margin:auto}.row{display:flex;gap:20px;flex-wrap:wrap}figure{margin:0;padding:16px;background:#26372b;border:1px solid #536349;border-radius:8px}canvas{width:240px;height:220px;image-rendering:pixelated}figcaption{font-weight:bold}p,small{color:#c6d1c1}p{max-width:800px}</style><main><h1>Mimic alignment</h1><p>Actual game art at six times its displayed size. The new mimic shares the T2 chest’s scale and orange-and-dark-metal palette.</p><div class="row"><figure><canvas id="chest" width="240" height="220"></canvas><figcaption>T2 chest</figcaption><small>Disguise · ${(16*data.chestScale).toFixed(1)} px</small></figure><figure><canvas id="before" width="240" height="220"></canvas><figcaption>Previous mimic</figcaption><small>32 px · original palette</small></figure><figure><canvas id="after" width="240" height="220"></canvas><figcaption>Aligned mimic</figcaption><small>${(16*data.scale).toFixed(1)} px · chest palette</small></figure></div><p>The disguise stays identical to the real chest. The revealed mimic retains its teeth and animation.</p></main><script>
const data=${JSON.stringify(data)};
const recolor=${ctx.recolorEnemyPixels.toString()};
async function load(src){const im=new Image();im.src='/'+src.split('?')[0];await im.decode();return im;}
(async()=>{const [sheet,chest]=await Promise.all([load(data.source),load(data.chest)]);const tinted=document.createElement('canvas');tinted.width=sheet.width;tinted.height=sheet.height;const tc=tinted.getContext('2d');tc.drawImage(sheet,0,0);const pixels=tc.getImageData(0,0,tinted.width,tinted.height);recolor(pixels.data,data.palette);tc.putImageData(pixels,0,0);
function draw(id,image,frame,scale){const c=document.getElementById(id).getContext('2d');c.clearRect(0,0,240,220);c.strokeStyle='#647458';c.beginPath();c.moveTo(16,184.5);c.lineTo(224,184.5);c.stroke();c.imageSmoothingEnabled=false;const columns=image.width/16,size=16*scale*6;c.drawImage(image,(frame%columns)*16,Math.floor(frame/columns)*16,16,16,120-size/2,184-size,size,size);}
function tick(now){draw('chest',chest,1,data.chestScale);const frame=data.frames[Math.floor(now/data.frameMs)%data.frames.length];draw('before',sheet,frame,2);draw('after',tinted,frame,data.scale);requestAnimationFrame(tick);}requestAnimationFrame(tick);document.documentElement.dataset.ready='true';})();
</script></html>`);
console.log(out);
