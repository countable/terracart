// Reproduce the source-reference exercise through the actual game renderer.
// Run build_assets.py first. Browser routes and isolated save state keep the study opt-in.
const assert = require('node:assert/strict');
const fs = require('fs'),
  path = require('path'),
  { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.env.OUT_DIR || '/tmp/ra-jungle');
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
    await page.route('**/__jungle/**', (r) => {
      const f = OUT + '/' + r.request().url().split('/__jungle/')[1];
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
      const trees = [];
      const inPoly = (x, y, ps) => {
        let inside = false;
        for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
          const [xi, yi] = ps[i],
            [xj, yj] = ps[j];
          if (yi > y != yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
      };
      const pond = layout.pond.outline.map((p) => {
        let [x, y] = p.map((v) => v * 2);
        if (y >= 170 && y <= 285 && x > 540) x -= 24;
        if (y > 285 && x > 480) x -= 24;
        return [x, y];
      });
      const paths = layout.ground.patch_polygons.map((poly) =>
        poly.map((p) => p.map((v) => v * 2)),
      );
      // The two lower worn strips follow the reference's long, tapering bends.
      // A shortened two-by-two vertex footprint reads as a diamond garden bed.
      paths[paths.length - 2] = [
        [324, 352], [364, 362], [348, 390], [322, 416], [301, 468],
        [263, 474], [260, 451], [287, 403], [305, 373],
      ];
      paths[paths.length - 1] = [
        [182, 388], [221, 405], [219, 475], [181, 466], [188, 430],
      ];
      // Explicit authored vertices refine the polygon seed without changing props.
      const vertexOverrides = new Map((layout.vertex_overrides || []).map(v =>
        [v.x + ',' + v.y, v.groundType]));
      for (let y = -17; y <= 17; y++)
        for (let x = -17; x <= 17; x++) {
          const px = x * 32 + 336,
            py = y * 32 + 240;
          let type = 1;
          if (paths.some((p) => inPoly(px, py, p))) type = 4;
          if (inPoly(px, py, pond)) type = 3;
          if (vertexOverrides.has(x + ',' + y)) type = vertexOverrides.get(x + ',' + y);
          // A deck is an overlay, not a wider water polygon. Keep its original ground.
          const groundType = type;
          if (px >= 416 && px < 512 && py >= 288 && py < 352) type = 23;
          e.grid[(cy + y) * N + cx + x] = type;
          grid.push({ x, y, type, groundType });
        }
      for (const tree of layout.trees) {
        const [px, py] = tree.seat.map((v) => v * 2),
          x = (px - 320) / 32,
          y = (py - 250) / 32;
        e.objects.push({
          id: 'jungle-tree-' + trees.length,
          kind: 'tree',
          variant: 3,
          size: 'large',
          species: 'maple',
          ...world(x, y),
          tx: pc.tx,
          ty: pc.ty,
          _ix: Math.floor(cx + x),
          _iy: Math.floor(cy + y),
          jungleIndex: tree.crop[0] / 64,
          jungleOffset: [
            (tree.top_left[0] - tree.seat[0]) * 2,
            (tree.top_left[1] - tree.seat[1]) * 2,
          ],
        });
        trees.push({ x, y });
      }
      for (const l of layout.lamps) {
        const [px, py] = l.base.map((v) => v * 2);
        e.objects.push({
          id: 'jungle-lamp-' + px,
          kind: 'torch',
          ...world((px - 320) / 32, (py - 250) / 32),
          tx: pc.tx,
          ty: pc.ty,
        });
      }
      for (let i = 0; i < layout.small_rocks.length; i++) {
        const [px, py] = layout.small_rocks[i].map((v) => v * 2);
        e.objects.push({
          id: 'jungle-rock-' + i,
          kind: 'mineralrock',
          variant: 0,
          ...world((px - 320) / 32, (py - 250) / 32),
          tx: pc.tx,
          ty: pc.ty,
          jungleRock: i === 4 ? 'big' : i === 3 ? 'mid' : 'tiny',
        });
      }
      for (let i = 0; i < layout.ground_marks.length; i++) {
        const [px, py] = layout.ground_marks[i].center;
        e.objects.push({
          id: 'jungle-leaf-' + i, kind: 'jungle_leaf', jungleLeaf: i,
          ...world((px * 2 - 320) / 32, (py * 2 - 250) / 32),
          tx: pc.tx, ty: pc.ty,
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
          entry.objects = entry.objects.filter((o) => String(o.id).startsWith('jungle-'));
        s._lastBorderIX = NaN;
        s._lastBorderIY = NaN;
        s._roadGeomKey = null;
        s._buildingGeomKey = null;
        s.drawCells();
        window.__jungleGround?.();
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
    const bridgeCells = fixture.grid.filter(c => c.type === 23);
    assert.equal(bridgeCells.length, 6, 'the authored deck keeps its six renderer cells');
    assert(fixture.grid.every(c => [1, 3, 4].includes(c.groundType)), 'source ground never includes deck overlays');
    assert(bridgeCells.some(c => c.groundType === 3), 'deck crosses the pond');
    assert(bridgeCells.some(c => c.groundType !== 3), 'deck overhangs the banks');
    async function snap(name) {
      const state = await page.evaluate(() => {
        __draw();
        return [...WorldGen.tileCache.values()]
          .flatMap((e) => e.objects)
          .map((o) => ({ id: o.id, kind: o.kind, x: o.x, y: o.y }))
          .sort((a, b) => a.id.localeCompare(b.id));
      });
      fs.writeFileSync(OUT + '/' + name + '-objects.json', JSON.stringify(state));
      if (name === 'jungle')
        assert.deepEqual(
          state,
          JSON.parse(fs.readFileSync(path.join(OUT, 'baseline-objects.json'))),
          'paired objects and positions identical',
        );
      await page.waitForTimeout(500);
      const data = await page.evaluate(
        () =>
          new Promise((resolve) =>
            __game.renderer.snapshotArea(16, __scene.viewCenterY - 250, 640, 500, (img) =>
              resolve(img.src),
            ),
          ),
      );
      fs.writeFileSync(OUT + '/' + name + '.png', Buffer.from(data.split(',')[1], 'base64'));
      console.log('SNAP', name);
    }
    await page.evaluate(async () => {
      const im = new Image();
      im.src = '/' + __fixture.layout.ground_marks[0].source;
      await im.decode();
      const marks = __fixture.layout.ground_marks;
      const canvas = document.createElement('canvas');
      canvas.width = marks.length * 16; canvas.height = 16;
      const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
      marks.forEach((mark, i) => ctx.drawImage(im, ...mark.crop, i * 16, 0, 16, 16));
      const tex = __scene.textures.addCanvas('jungle_leaves', canvas);
      marks.forEach((mark, i) => tex.add(i, 0, i * 16, 0, 16, 16));
      Render.objectAppearance(__scene, {}).RENDER_SPEC.jungle_leaf = {
        key: 'jungle_leaves', frame: o => o.jungleLeaf,
        scale: 2,
        origin: [0.5, 0.5],
        seat: false,
        groundAtOrigin: true,
        layer: WorldLayers.GROUND_DECAL,
        shadow: false,
      };
    });
    await page.addScriptTag({ path: path.join(__dirname, 'lighting.js') });
    await page.evaluate(() => installStudyLighting());
    await snap('baseline');
    if (fs.existsSync(path.join(__dirname, 'apply.js'))) {
      await page.addScriptTag({ path: path.join(ROOT, 'tools/jungle-autotile.js') });
      await page.addScriptTag({ path: path.join(__dirname, 'apply.js') });
      await page.evaluate(() => applyJungle());
      await snap('jungle');
    }
    fs.writeFileSync(
      path.join(OUT, 'renderer-audit.json'),
      JSON.stringify(
        await page.evaluate(() => ({
          renderer: __game.renderer.type,
          webglError: __game.renderer.gl.getError(),
          objects: __fixture.objects.length,
          trees: __fixture.objects.filter((o) => o.kind === 'tree').length,
          lamps: 2,
          rocks: __fixture.objects.filter((o) => o.kind === 'mineralrock').length,
          leaves: __fixture.objects.filter(o => o.kind === 'jungle_leaf').length,
          pairedGeometryEqual: true,
          lighting: {
            lightMapVisible: __scene.lightMap.visible,
            lightTexKey: __scene.lightTex?.__lightKey,
            lights: (__scene._lights || []).map((l) => ({ kind: l.kind, id: l.id })),
            ambient: Lighting.profile(__scene, 1, Date.now()).ambient,
            customOverlay: __scene.textures.exists('jungle_study_light'),
          },
          terrainTypes: [...new Set(__fixture.grid.map((c) => c.type))].sort((a, b) => a - b),
          bridgeGround: __fixture.grid.filter(c => c.type === 23).map(c => c.groundType),
          geometry: 'identical authored flat forest fixture',
          cliffs: 0,
          cobbles: __scene.cobblePool
            .filter((o) => o.visible)
            .map((o) => ({
              x: o.x,
              y: o.y,
              key: o.texture.key,
              parent: o.parentContainer?.name,
              depth: o.depth,
              alpha: o.alpha,
            })),
          autotile: window.__jungleAtlasAudit || null,
          cellSize: CELL_PX,
          viewCells: VIEW_CELLS,
          canvas: [__game.canvas.width, __game.canvas.height],
          zoom: __scene.mapZoom,
          anchor: viewAnchorWorldM(__scene),
          projected: __fixture.objects.map((o) => ({
            id: o.id,
            p: __scene.worldMetersToScreen(o.x, o.y),
          })),
        })),
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(OUT, 'errors.json'), JSON.stringify(errors));
    const audit = JSON.parse(fs.readFileSync(path.join(OUT, 'renderer-audit.json')));
    assert.deepEqual(errors, []);
    assert.equal(audit.renderer, 2);
    assert.equal(audit.webglError, 0);
    assert.equal(audit.objects, 53);assert.equal(audit.leaves, 19);
    assert.equal(audit.autotile.combinedGroundFrames, 256);
    assert.equal(audit.autotile.groundMaskField, 'groundType');
    assert.equal(audit.lighting.customOverlay, false);
    assert.deepEqual(audit.terrainTypes, [1, 3, 4, 23]);
    assert.equal(audit.trees, 25);
    assert.equal(audit.rocks, 7);
    assert.equal(audit.cobbles.length, 6);
    assert(audit.lighting.lightMapVisible);
    assert.equal(audit.lighting.ambient, 0x808080);
    assert.equal(audit.lighting.lights.filter((l) => l.kind === 'study_jungle_lamp').length, 2);
    assert.equal(audit.lighting.lights.length, 2);
    console.log(
      'AUDIT PASS',
      audit.objects,
      'objects, WebGL, actual Lighting.draw, source-native dual autotiles',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
