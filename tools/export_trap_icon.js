// Rebuild the inventory jaw icon from the existing world trap renderer.
// Run at repository root with Chromium and playwright-core installed.
const fs = require('fs');
const { chromium } = require('playwright-core');
(async () => {
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
 const page=await browser.newPage();
 await page.addScriptTag({content:fs.readFileSync('src/util.js','utf8')+'\n'+fs.readFileSync('src/textures.js','utf8')});
 const tint = Number(/magic_trap:\s*\{[^}]*colour:\s*(0x[\da-f]+)/i.exec(fs.readFileSync('src/lighting.js','utf8'))[1]);
 const png=await page.evaluate(tint=>{
  let canvas;
  makeSprungTrapTexture({textures:{exists:()=>false,createCanvas:(key,w,h)=>{
   canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
   return {getContext:()=>canvas.getContext('2d'),refresh:()=>{}};
  }}});
  const out=document.createElement('canvas');out.width=out.height=16;
  const ctx=out.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(canvas,0,0,16,16);
  const data=ctx.getImageData(0,0,16,16);
  // Blend the magic hue into the metal while retaining its highlights.
  // Multiplying the tint made the small jaws look like an empty dark hole.
  const colour = [tint >>> 16 & 255, tint >>> 8 & 255, tint & 255];
  for (let i = 0; i < data.data.length; i += 4) {
    const metal = Math.max(data.data[i], data.data[i + 1], data.data[i + 2]);
    if (metal < 40) continue; // keep the recess dark so the teeth separate
    for (let c = 0; c < 3; c++) {
      data.data[i + c] = 1.65 * (0.5 * data.data[i + c] + 0.5 * metal * colour[c] / 255);
    }
  }
  ctx.putImageData(data,0,0);return out.toDataURL();
 },tint);
 fs.writeFileSync('assets/Icons/Items/MagicTrap.png',Buffer.from(png.split(',')[1],'base64'));
 } finally {await browser.close();}
})();
