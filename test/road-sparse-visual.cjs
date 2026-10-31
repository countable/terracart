// Real Canvas compositing regressions: the ground must survive both road passes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<!doctype html><body></body>');
    await page.addScriptTag({ content: `
      const SpriteLayout={CELL_PX:32}, WorldGen={PATH_CLASSES:new Set(),T:{WATER:3}};
      const cssOf=c=>'#'+c.toString(16).padStart(6,'0');
      ${read('src/ground_materials.js')}
      const frames=GroundMaterials.selectedMaterialFrames;
      const atlas=new Image();atlas.src='data:image/png;base64,${fs.readFileSync(path.join(root,'assets/selected-terrain/selected-terrain.png')).toString('base64')}';
      const drawSelectedMaterial=(cx,size,id)=>{cx.imageSmoothingEnabled=false;cx.drawImage(atlas,frames[id]*16,0,16,16,0,0,size,size);return true;};
    ` });
    await page.evaluate(()=>atlas.decode());
    await page.addScriptTag({ content: read('src/street_variants.js') });
    // Expose the private passes in this test realm only, keeping production API small.
    await page.addScriptTag({ content: read('src/road_overlay.js').replace(
      'global.RoadOverlay = {', 'global.RoadOverlay = { commitBase, commitRestored, RAIL_COLOR,') });
    assert.deepEqual(errors, []);
    const result = await page.evaluate(() => {
      const api = RoadOverlay;
      const pass = (variant, restored=false, rail=false, erases=[]) => {
        const canvas=document.createElement('canvas');canvas.width=canvas.height=384;
        const ctx=canvas.getContext('2d');ctx.lineCap=ctx.lineJoin='round';
        const p={ctx,size:384,phaseX:0,phaseY:0,ops:[{w:80,c:rail?api.RAIL_COLOR:0x89867c,variant,pts:[0,192,384,192]}],pats:{},scratch:[],decorOps:[],erases,tex:{refresh(){}}};
        (restored?api.commitRestored:api.commitBase)(p);return canvas;
      };
      const pixels=c=>c.getContext('2d').getImageData(0,160,384,64).data;
      // Weathered joints carry the shared faint theme tint. They still expose
      // ground; measuring alpha===0 would mistake that tint for solid stone.
      const jointAlpha=Math.ceil(255*api.VARIANT_SHADE_ALPHA/api.ALPHA);
      const open=c=>{const p=pixels(c);let n=0;for(let i=3;i<p.length;i+=4)if(p[i]<=jointAlpha)n++;return n/(p.length/4);};
      const ordinary=pass('plain'), repaired=pass('plain',true), burned=pass('burned'), fire=pass('fire_path');
      const combined=document.createElement('canvas');combined.width=combined.height=384;
      const cx=combined.getContext('2d');cx.drawImage(ordinary,0,0);cx.drawImage(repaired,0,0);
      const prior=pixels(ordinary), after=pixels(repaired);let moved=0;
      for(let i=3;i<prior.length;i+=4)if(prior[i]===255&&after[i]===0)moved++;
      const erased=pass('plain',false,false,[[120,160,40,64]]);
      const warm=['orchard','lantern','golden','golden_path','promenade'].map(id=>api.selectedRoadTile(id,false));
      const formal=api.selectedRoadTile('hedgerow',true), wornFormal=api.selectedRoadTile('hedgerow',false);
      const fp=formal.getContext('2d').getImageData(0,0,formal.width,formal.height).data;
      const wp=wornFormal.getContext('2d').getImageData(0,0,wornFormal.width,wornFormal.height).data;
      let regular=true, formalGaps=0, formalAdded=0;
      for(let y=0;y<formal.height;y++)for(let x=0;x<formal.width;x++) {
        const i=(y*formal.width+x)*4+3;
        if((fp[i]>0)!==(fp[(y*formal.width+(x+8)%formal.width)*4+3]>0))regular=false;
        if(fp[i]===0)formalGaps++;
        if(fp[i]===255&&wp[i]!==255)formalAdded++;
      }
      const target=document.createElement('canvas');target.width=target.height=384;
      api.paintPavementTile(target.getContext('2d'),384,false,false,'plain');
      return {formalRegular:regular,formalGaps,formalAdded,formalSeparate:formal!==api.selectedRoadTile('overgrown',true),ordinary:open(ordinary),repaired:open(repaired),combined:open(combined),burned:open(burned),fire:open(fire),rail:open(pass('',false,true)),moved,
        erasedAlpha:erased.getContext('2d').getImageData(120,160,40,64).data.filter((_,i)=>i%4===3).reduce((a,b)=>a+b,0),
        warmDistinct:new Set(warm).size===warm.length,burnedSeparate:api.selectedRoadTile('burned',false)!==api.selectedRoadTile('fire_path',false),
        swatch:open(target),cached:api.selectedRoadTile('plain',false)===api.selectedRoadTile('plain',false)};
    });
    assert.deepEqual(errors, []);
    assert(result.ordinary > .55 && result.ordinary < .85, 'road mask must retain open ground');
    assert(result.repaired > .4 && result.repaired < result.ordinary, 'repairs add stones but retain gaps');
    assert(result.combined > .4, 'base plus restored must not fill the gaps');
    assert.equal(result.moved, 0, 'repair stones keep their positions');
    assert.equal(result.burned, 0, 'Burned Row stays solid');
    assert.equal(result.rail, 0, 'rail ballast stays solid');
    assert(result.fire > .55, 'Fire Path does not inherit the Burned Row exception');
    assert.equal(result.erasedAlpha, 0, 'keep-out erases survive compositing');
    assert(result.warmDistinct && result.burnedSeparate && result.cached);
    assert(result.swatch > .55, 'shared preview painter must preserve gaps');
    assert(result.formalRegular && result.formalSeparate, 'formal setts repeat evenly without replacing other moss-family roads');
    assert(result.formalGaps > 0 && result.formalAdded > 0, 'formal repairs fill missing stones and retain transparent joints');
    const potteryHues=await page.evaluate(()=>[false,true].map(restored=>{
      const c=RoadOverlay.selectedRoadTile('pottery',restored);
      const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,hues=new Set();
      for(let i=0;i<d.length;i+=4)if(d[i+3]===255)hues.add((d[i]-d[i+1])+','+(d[i+1]-d[i+2]));
      return [...hues].sort();
    }));
    assert.deepEqual(potteryHues,[['38,53','80,37'],['38,53','80,37']],
      'both repair states use only the two clay-pot hues, with neutral texture shading');
    const expected=JSON.parse(read('test/road-theme-pixels.json'));
    const actual=await page.evaluate(rows=>rows.map(({id,restored})=>{
      const tile=RoadOverlay.selectedRoadTile(id,restored);
      const pixels=tile.getContext('2d').getImageData(0,0,tile.width,tile.height).data;
      let hash=2166136261;for(const v of pixels)hash=Math.imul(hash^v,16777619);
      return {id,restored,hash:(hash>>>0).toString(16)};
    }),expected);
    assert.deepEqual(actual,expected,'all themes and restoration states match the approved proposal pixels');
    const reads=await page.evaluate(rows=>{
      RoadOverlay.prepareMaterials();
      const prototype=CanvasRenderingContext2D.prototype, original=prototype.getImageData;
      let count=0;prototype.getImageData=function(...args){count++;return original.apply(this,args);};
      try {
        for(const {id,restored} of rows)RoadOverlay.selectedRoadTile(id,restored);
        RoadOverlay.selectedRoadTile('unknown-theme',false);
      } finally {prototype.getImageData=original;}
      return count;
    },expected);
    assert.equal(reads,0,'prepared palettes never read pixels during cell rebuilds');
    console.log(JSON.stringify({...result,approvedPalettes:actual.length}, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
