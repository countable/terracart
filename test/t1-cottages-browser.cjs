// Serve the repository and set GAME_URL; verifies the retained T1 shop geometry.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const env = {...process.env}; delete env.DISPLAY;
  const browser = await chromium.launch({ executablePath: '/usr/lib/chromium/chromium', env, headless: true,
    args: ['--no-sandbox', '--ozone-platform=headless', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1120, height: 900 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto((process.env.GAME_URL || 'http://127.0.0.1:8014') + '/?sandbox=true&sandboxZone=restoration&skipStory=true&skipTutorial=true');
    await page.waitForFunction(() => window.__scene?._bootOverlayGone, {}, { timeout: 60000 });
    await page.evaluate(() => {
      const game = __scene.game;
      game.scene.getScenes(true).forEach(scene => game.scene.sleep(scene));
      document.querySelectorAll('body > :not(canvas):not(script)').forEach(el => { if (!el.querySelector('canvas')) el.style.display = 'none'; });
      game.scale.resize(1120, 900);
      let parent=game.canvas.parentElement; while(parent){parent.style.cssText='transform:none!important;width:1120px!important;height:900px!important;max-width:none!important;max-height:none!important;position:static!important;overflow:visible!important;margin:0!important;padding:0!important';parent=parent.parentElement;}
      game.canvas.style.cssText = 'width:1120px!important;height:900px!important;position:fixed;left:0;top:0;margin:0;max-width:none!important;max-height:none!important';
      game.scene.add('CottageReview', {
        create() {
          window.cottageReview = this;
          this._headingUp = true; this.mapRot = 0;
          this.buildingWallContainer = this.add.container();
          this.cameras.main.setBackgroundColor('#425c50');
          AuthoredBuildings.prepare(this);
          BuildingLowPoly.begin(this);
          const roles = ['blacksmith', 'trader', 'shop', 'seed', 'supply', 'potion', 'relic', 'pet', 'book'];
          const before = this.textures.getTextureKeys();
          roles.forEach((role, i) => {
            const x = 130 + (i % 3) * 350, y = 150 + Math.floor(i / 3) * 265;
            const points = [[0,0],[60,0],[60,45],[0,45]].map(([dx,dy]) => ({x:x+dx,y:y+dy}));
            const authored = AuthoredBuildings.recipeFor(role, role, 1);
            BuildingLowPoly.add(this, points, {...BuildingLowPoly.recipeFor(role),authored}, null, role, [], 2);

          });
          this.addedTextures = this.textures.getTextureKeys().filter(key => !before.includes(key));
          roles.forEach((role,i) => this.add.text(185+(i%3)*350,265+Math.floor(i/3)*265,role,{fontSize:'18px',color:'#ffffff'}).setOrigin(.5,0));
          BuildingLowPoly.update(this);
        }
      }, true);
    });
    await page.waitForFunction(() => window.cottageReview?._lowpoly?.buildings.length === 9);
    const output = process.env.OUTPUT_DIR || '/tmp/t1-cottages-qa'; fs.mkdirSync(output, { recursive: true });
    const initial = await page.evaluate(() => ({ textures:cottageReview.addedTextures,
      models:cottageReview._lowpoly.buildings.map(m => ({key:m.authoredKey,role:m.role,mountedSign:m.mountedSign,
        finite:m.faces.every(f=>f.points.every(p=>['x','y','z','tu','tv'].every(k=>Number.isFinite(p[k]))))})) }));
    assert.deepEqual(initial.textures, [], 'shop placement reuses prewarmed textures');
    assert(initial.models.every(m => m.finite && m.mountedSign), JSON.stringify(initial.models));
    for (const angle of [0, .7, Math.PI/2, Math.PI, Math.PI*1.5]) {
      const result = await page.evaluate(angle => {
        const s=cottageReview, before=s.textures.getTextureKeys().length, faces=s._lowpoly.faces.slice();
        s.mapRot=angle; BuildingLowPoly.update(s);
        return {textures:s.textures.getTextureKeys().length-before,retained:faces.every((f,i)=>s._lowpoly.faces[i]===f),
          finite:faces.every(f=>f.projected.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))};
      }, angle);
      assert.deepEqual(result, {textures:0,retained:true,finite:true});
      await page.waitForTimeout(250);
      await page.screenshot({path:output+'/shops-'+angle.toFixed(2)+'.png'});
      assert.equal(await page.evaluate(() => cottageReview.game.renderer.gl.getError()), 0);
    }
    await page.evaluate(() => { const s=cottageReview; s.mapRot=0; BuildingLowPoly.update(s); s.cameras.main.setZoom(5).centerOn(160,165); });
    await page.waitForTimeout(250);
    await page.screenshot({path:output+'/shop-detail.png'});
    assert.deepEqual(errors, []);
    console.log('Nine T1 cottage shops: prepared materials, mounted signs, finite retained geometry and five headings passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
