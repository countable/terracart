// Reproduce the source-reference exercise through the actual game renderer.
// Run build_assets.py first. Browser routes and isolated save state keep the study opt-in.
const assert = require('node:assert/strict');
const fs = require('fs'),
  path = require('path'),
  { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.env.OUT_DIR || '/tmp/ra-building/render');
const GAME_URL = process.env.GAME_URL || 'http://127.0.0.1:8000';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const env = { ...process.env };
  delete env.DISPLAY;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    headless: true,
    env,
    args: [
      '--no-sandbox',
      '--ozone-platform=headless',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 900, height: 1150 },
      serviceWorkers: 'block',
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => {
      errors.push(String(e));
      console.log('ERROR', String(e));
    });
    await page.route('**/src/lighting.js*', (r) =>
      r.fulfill({
        contentType: 'application/javascript',
        body: require(path.join(__dirname, 'lighting-route.cjs'))(
          fs.readFileSync(path.join(ROOT, 'src/lighting.js'), 'utf8'),
        ),
      }),
    );
    await page.route('**/src/app.js*', (r) => {
      let code = fs
        .readFileSync(path.join(ROOT, 'src/app.js'), 'utf8')
        .replace('const W = 352, H = 844;', 'const W = 672, H = 844;')
        .replace('const VIEW_CELLS = 11;', 'const VIEW_CELLS = 21;');
      return r.fulfill({ contentType: 'application/javascript', body: code });
    });
    await page.route('**/__village/**', (r) => {
      const f = OUT + '/' + r.request().url().split('/__village/')[1];
      return r.fulfill({
        body: fs.readFileSync(f),
        contentType: f.endsWith('.json') ? 'application/json' : 'image/png',
      });
    });
    await page.addInitScript(() => {
      window.__JUNGLE_STUDY = true;
      window.__renderScaleCap = 1;
      window.__DAYLIGHT = 1;
      sessionStorage.setItem('terracart.safetySeen', '1');
      localStorage.setItem('terracart.introSeen', '1');
      localStorage.setItem('terracart.howtoSeen', '1');
    });
    await page.goto(GAME_URL + '/index.html?sandbox=true&headingUp=false', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => window.__scene?._bootOverlayGone, null, { timeout: 120000 });
    console.log('BOOT');
    const layout = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference-layout.json')));
    const fixture = await page.evaluate((layout) => {
      const s = __scene;
      s.scene.pause();
      s.anims.pauseAll();
      s.tweens.pauseAll();
      s._tickHomeZoom = () => {};
      s._setRestZoom(1, 1);
      s.mapZoom = 1;
      s._applyMapZoom();
      window.__renderScaleCap = 1;
      window.__onGameScaleChange?.();
      BuildingOverlay.setEnabled(s, false);
      s.ensureStarterTrailerObject = () => {};
      s.ensureStarterShopId = () => {};
      s._syncModalGate = () => {};
      const pc = s.playerToWorldCell(),
        e = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty)),
        N = e.cellsPerEdge,
        cm = e.tileEdgeM / N,
        cx = Math.floor(N / 2),
        cy = Math.floor(N / 2);
      const world = (x, y) => ({
        x: pc.tx * e.tileEdgeM + (cx + x) * cm,
        y: pc.ty * e.tileEdgeM + (cy + y + 0.8125) * cm,
      });
      for (const entry of WorldGen.tileCache.values()) {
        entry.grid.fill(1);
        entry.objects = [];
        entry.wildplants = [];
        entry.creatures = [];
        entry.layers = [];
        entry.buildingShapes = [];
        entry.owners.fill(0);
        entry.zone = null;
        entry.zoneDress = null;
        entry.scenic = null;
        entry.scenicDress = null;
        entry.streetIndex = null;
        entry.streetDress = null;
        entry.streetArea = null;
        entry.extraTreasures = [];
        entry.parkingTreasures = [];
        entry.coinDrops = [];
        entry.traps = [];
        entry.streetLairs = [];
        entry.treasure = null;
        entry.streetGround = null;
        entry.roadUnder = {};
        entry.pathUnder = {};
        entry.slowCells = null;
        entry.streetMarks = null;
        entry._objectIndex = null;
        entry._preCullLights = null;
      }
      const grid = [];
      const inPoly = (x,y,ps) => {
        let inside=false;
        for(let i=0,j=ps.length-1;i<ps.length;j=i++) {
          const [xi,yi]=ps[i],[xj,yj]=ps[j];
          if((yi>y)!=(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
        }
        return inside;
      };
      for(let y=-17;y<=17;y++) for(let x=-17;x<=17;x++) {
        const px=x*32+331,py=y*32+170;
        const type=layout.ground.patch_polygons.some(p=>inPoly(px/2,py/2,p))?4:1;
        e.grid[(cy+y)*N+cx+x]=type;
        grid.push({x,y,type,groundType:type});
      }
      for(const [i,p] of layout.objects.entries()) {
        const [px,py]=p.seat.map(v=>v*2);
        e.objects.push({
          id:'village-'+p.kind+'-'+i,kind:p.kind,...p.properties,
          ...world((px-315)/32,(py-180)/32),tx:pc.tx,ty:pc.ty,
          _ix:Math.floor(cx+(px-315)/32),_iy:Math.floor(cy+(py-180)/32),
          studyAsset:p.asset,studyOffset:[(p.top_left[0]-p.seat[0])*2,(p.top_left[1]-p.seat[1])*2],
        });
      }
      for (const o of e.objects)
        if (o.kind === 'tree') while (isShiny(o.id, SHINY_RATE.tree)) o.id += 'x';
      const p = world(0, 0);
      s.playerM = { x: p.x - s.startWorldM.x, y: p.y - s.startWorldM.y };
      s.peekM = { x: 0, y: 0 };
      s.syncMoveTarget?.();
      s.save.planted = [];
      s.save.fires = [];
      s.save.furniture = [];
      s.save.floorTiles = [];
      s.save.firepit = null;
      s.save.chopped = [];
      s.save.spent = [];
      s._streetLamps = [];
      window.__fixture = { grid, objects: e.objects.map((o) => ({ ...o })), cellM: cm, layout };
      window.__draw = () => {
        for (const entry of WorldGen.tileCache.values())
          entry.objects = entry.objects.filter((o) => String(o.id).startsWith('village-'));
        s._lastBorderIX = NaN;
        s._lastBorderIY = NaN;
        s._roadGeomKey = null;
        s._buildingGeomKey = null;
        s.drawCells();
        window.__villageGround?.();
        s.drawRoadGeometry();
        s.drawBuildingGeometry();
        s.drawObjects();
        BuildingLowPoly.clear(s);
        s.buildingGeomContainer?.setVisible(false);
        s.buildingWallContainer?.setVisible(false);
        s.towerPool?.forEach((o) => o.setVisible(false));
        for (const key of [
          'fogContainer',
          'atmosGroundGfx',
          'atmosRimGfx',
          'reachGfx',
          'auraContainer',
          'fxContainer',
          'sparkContainer',
          'labelContainer',
          'letterContainer',
          '_sandboxLabels',
          'ghostGlowContainer',
          'tierGfx',
          'enemyHealthGfx',
          '_workProgressGfx',
          'player',
          'playerShadow',
          'playerHalo',
          'gpsGhost',
          'blightAura',
          'facingGfx',
          'facingChevronGfx',
          'projGfx',
          'swordSwingGfx',
          'boltContainer',
        ]) {
          s[key]?.setVisible?.(false);
          s[key]?.image?.setVisible?.(false);
        }
        s.creaturePool?.forEach((o) => o.setVisible(false));
        document
          .querySelectorAll('.game-modal,[id$="-modal"],#story,#howto,#bootload,#safety-card')
          .forEach((e) => (e.style.display = 'none'));
      };
      __draw();
      return __fixture;
    }, layout);
    fs.writeFileSync(path.join(OUT, 'fixture.json'), JSON.stringify(fixture, null, 2));
    async function snap(name) {
      const state = await page.evaluate(() => {
        __draw();
        return [...WorldGen.tileCache.values()]
          .flatMap((e) => e.objects)
          .map((o) => ({ id: o.id, kind: o.kind, x: o.x, y: o.y }))
          .sort((a, b) => a.id.localeCompare(b.id));
      });
      fs.writeFileSync(OUT + '/' + name + '-objects.json', JSON.stringify(state));
      if (name === 'village')
        assert.deepEqual(
          state,
          JSON.parse(fs.readFileSync(path.join(OUT, 'baseline-objects.json'))),
          'paired objects and positions identical',
        );
      await page.waitForTimeout(500);
      const data = await page.evaluate(
        () =>
          new Promise((resolve) =>
            __game.renderer.snapshotArea(21, __scene.viewCenterY - 180, 630, 360, (img) =>
              resolve(img.src),
            ),
          ),
      );
      fs.writeFileSync(OUT + '/' + name + '.png', Buffer.from(data.split(',')[1], 'base64'));
      console.log('SNAP', name);
    }
    await page.addScriptTag({ path: path.join(ROOT, 'tools/jungle-study/lighting.js') });
    await page.evaluate(() => installStudyLighting());
    await snap('baseline');
    if (fs.existsSync(path.join(__dirname, 'apply.js'))) {
      await page.addScriptTag({ path: path.join(ROOT, 'tools/jungle-autotile.js') });
      await page.addScriptTag({ path: path.join(__dirname, 'apply.js') });
      await page.evaluate(() => applyVillage());
      await snap('village');
    }
    const audit=await page.evaluate(()=>({
      renderer:__game.renderer.type,webglError:__game.renderer.gl.getError(),
      objects:__fixture.objects.map(o=>({id:o.id,kind:o.kind,asset:o.studyAsset,dir:o.dir})),
      terrainTypes:[...new Set(__fixture.grid.map(c=>c.type))],
      autotile:window.__villageAtlasAudit,
      cliffs:0,chrome:false,lighting:{ambient:Lighting.profile(__scene,1,Date.now()).ambient,lights:(__scene._lights||[]).map(l=>l.kind)},
      canvas:[630,360],pairedGeometryEqual:true,
    }));
    audit.descentInteraction=await page.evaluate(()=>{
      const s=__scene,stair=[...WorldGen.tileCache.values()].flatMap(e=>e.objects).find(o=>o.kind==='staircase');
      const oldPlayer={...s.playerM},oldChange=s.changeDepth;
      let call=null;
      try {
        s.playerM={x:stair.x-s.startWorldM.x,y:stair.y-s.startWorldM.y};
        s.changeDepth=(delta,obj)=>{call={delta,sameObject:obj===stair};};
        const result=TAP_HANDLERS.find(h=>h.name==='staircase').try({scene:s,save:s.save,wm:{x:stair.x,y:stair.y},sx:0,sy:0});
        return {result,call};
      } finally {s.playerM=oldPlayer;s.changeDepth=oldChange;}
    });
    assert.deepEqual(audit.descentInteraction,{result:true,call:{delta:1,sameObject:true}});
    fs.writeFileSync(OUT+'/renderer-audit.json',JSON.stringify(audit,null,2));
    fs.writeFileSync(OUT+'/errors.json',JSON.stringify(errors));
    assert.deepEqual(errors,[]); assert.equal(audit.renderer,2); assert.equal(audit.webglError,0);
    assert(audit.objects.some(o=>o.kind==='staircase'&&o.dir==='down'));
    assert(audit.objects.some(o=>o.kind==='house'));
    assert.equal(audit.autotile.masks,16);
    console.log('AUDIT PASS',audit.objects.length,'objects, actual WebGL renderer, native dual-grid ground');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
