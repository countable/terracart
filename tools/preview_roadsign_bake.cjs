// Compose a north-up fingerpost with the shipping texture and board-pose helpers.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright-core');

module.exports = async function bakeRoadSign(root, object) {
  const read = name => fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8');
  const between = (source, start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    if (a < 0 || b < 0) throw new Error('Missing road-sign renderer helper: ' + start);
    return source.slice(a, b);
  };
  const textures = read('textures'), render = read('render');
  const sources = ['enemy_roster', 'sprite_layout', 'street_signs'].map(read);
  sources.push('const Render = {};\n' + between(render, 'const GROUND_MARK = {', '// The GPS ring'));
  sources.push(between(render, 'const ROAD_SIGN_BOARDS =', 'Render.petTexture ='));
  sources.push(between(textures, 'function bakeCanvas(', '// Bake all 24px canopy'));
  sources.push(between(textures, 'function makeRoadSignTextures(', '// Procedural "pot of gold"'));
  const browser = await chromium.launch({executablePath:process.env.PW_CHROMIUM || '/usr/bin/chromium',
    headless:true, args:['--no-sandbox', '--disable-dev-shm-usage']});
  try {
    const page = await browser.newPage();
    for (const content of sources) await page.addScriptTag({content});
    const dataUrl = await page.evaluate(object => {
      const textures = new Map();
      const scene = {textures:{exists:key => textures.has(key), createCanvas(key,w,h) {
        const canvas = document.createElement('canvas'); canvas.width=w; canvas.height=h;
        textures.set(key,canvas);
        return {getContext:()=>canvas.getContext('2d'),refresh(){}};
      }}};
      makeRoadSignTextures(scene);
      const canvas=document.createElement('canvas'); canvas.width=canvas.height=128;
      const ctx=canvas.getContext('2d'); ctx.imageSmoothingEnabled=false;
      const scale=StreetSigns.ART.scale, seat=Render.roadSignPostSeat();
      const post=textures.get('roadsign_post');
      ctx.drawImage(post,64+seat.dxPx-post.width*scale/2,64+seat.dyPx-post.height*scale/2,post.width*scale,post.height*scale);
      const board=textures.get('roadsign_board');
      for(const {o} of Render.roadSignBoards({o:object,dx:0,dy:0})) {
        const sprite={scaleX:scale,scaleY:scale,rotation:0,
          setRotation(angle){this.rotation=angle;return this;},
          setScale(x,y){this.scaleX=x;this.scaleY=y;return this;}};
        Render.poseRoadSignBoard(sprite,o,scene);
        ctx.save();ctx.translate(64+seat.dxPx,64+Render.roadSignBoardDy(o));
        ctx.rotate(sprite.rotation);ctx.scale(sprite.scaleX,sprite.scaleY);
        ctx.drawImage(board,0,-board.height/2);ctx.restore();
      }
      return canvas.toDataURL('image/png');
    },object);
    const sheet='preview_roadsign_'+crypto.createHash('sha256').update(JSON.stringify(object.directions || [])).digest('hex').slice(0,12);
    return {sheet,frames:[0],preserveFrame:true,width:128,height:128,origin:[.5,.5],dxPx:0,dyPx:0,
      asset:{kind:'image',path:'runtime:roadsign',dataUrl,frameWidth:128,frameHeight:128}};
  } finally {await browser.close();}
};
