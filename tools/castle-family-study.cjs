// Capture actual MapScene castles; fixture changes stay in an isolated browser save.
// GAME_URL=http://localhost:8765/index.html?sandbox=true&sandboxZone=castle&skipStory=true&skipTutorial=true \
// OUT_DIR=/tmp/castle-family-study node tools/castle-family-study.cjs
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const OUT = process.env.OUT_DIR || '/tmp/castle-family-study';
const URL = process.env.GAME_URL || 'http://localhost:8765/index.html?sandbox=true&sandboxZone=castle&skipStory=true&skipTutorial=true';
const shapes = {
  rectangle: [[-100,-80],[100,-80],[100,80],[-100,80]],
  narrow: [[-100,-26],[100,-26],[100,26],[-100,26]],
  concave: [[-100,-80],[100,-80],[100,-20],[20,-20],[20,80],[-100,80]],
  skewed: [[-100,-64],[70,-80],[104,62],[-66,80]],
  acute: [[-100,-64],[50,-80],[104,0],[20,28],[-42,80],[-96,44]],
};
const selected = (name, defaults) => (process.env[name] || defaults).split(',');
const families = selected('FAMILIES', 'citadel,bastion,archive');
const angles = selected('ANGLES', '0,45,135,225').map(Number);
const states = selected('STATES', 'wrecked,restored');
const renderers = selected('RENDERERS', 'webgl');
const selectedShapes = selected('SHAPES', Object.keys(shapes).join(','));
const clean = process.env.CLEAN === '1';

async function installFixture(page) {
  await page.evaluate(clean => {
    const s = __scene;
    __game.loop.stop(); s.scene.pause();
    document.querySelectorAll('[id$="-modal"],#story,#howto').forEach(el => el.remove());
    s._syncModalGate(); s._attachCompass(); BuildingOverlay.setEnabled(s, true);
    const frame = overlayFrame(s, entry => !!entry.buildingShapes);
    const row = frame.tiles[0];
    if (!row) throw Error('No ready building overlay tile');
    for (const tile of frame.tiles) tile.entry.buildingShapes = [];
    const probe = window.castleFamilyProbe = { row, family: 'citadel', active: true };
    probe.clean = function() {
      if (!clean) return;
      // Review-only visibility switches leave geometry, terrain and camera intact.
      s._sandboxLabels?.removeAll(true); s._sandboxLabelData = [];
      for (const name of ['worldContainer', 'shadowContainer', 'player', 'playerWorldContainer', 'creaturesContainer', 'labelContainer', '_sandboxLabels', 'towerContainer', 'lightMap'])
        s[name]?.setVisible(false);
      for (const name of ['castleFlagPool', 'creatureShadowPool', 'enemyAuraPool', 'playerAuraPool'])
        for (const object of s[name] || []) object.setVisible?.(false);
      for (const slot of s._produceSignPool || []) if (slot.el) slot.el.style.display = 'none';
    };
    const oldClaim = s.isClaimedKey;
    s.isClaimedKey = function(key) {
      return ['citadel', 'bastion', 'archive'].includes(key) ? probe.active : oldClaim.call(this, key);
    };
    probe.place = function(points, family, active) {
      probe.family = family; probe.active = active;
      s.peekM = { x: 0, y: 0 }; s.mapZoom = 1; s.mapRot = 0; s._huManualAngle = 0;
      const anchor = viewAnchorWorldM(s), entry = row.entry;
      const cx = anchor.x - row.tx * entry.tileEdgeM, cy = anchor.y - row.ty * entry.tileEdgeM;
      entry.buildingShapes = [{ key: family, tier: 12,
        ring: points.flatMap(([x, y]) => [cx + x / CELL_PX * s.cellM, cy + y / CELL_PX * s.cellM]) }];
      s._buildingGeomKey = null; s.drawCells(); s.drawRoadGeometry(); s._overlayFrameSeq++;
      s._buildingGeomKey = null; s.drawBuildingGeometry(); s._applyMapZoom(); probe.clean(); WallPerspective.update(s);
      probe.retained = new Set(s._wallPerspective.castles.blocks);
    };
    probe.turn = function(degrees) {
      s.mapRot = degrees * Math.PI / 180; s._huManualAngle = s.mapRot;
      s._applyMapZoom(); probe.clean(); WallPerspective.update(s); __game.step(performance.now(), 16);
    };
    probe.measure = function() {
      const group = s._wallPerspective.castles, model = s._fdrCastleLayouts.get(probe.family);
      if (!model) throw Error('Castle fixture was not emitted: ' + probe.family);
      const blocks = group.blocks.filter(block => block.building?.key === probe.family);
      const faces = blocks.flatMap(block => block.materialFaces || []);
      // Include the actual camera viewport/zoom, not just container transforms.
      const matrix = Phaser.GameObjects.GetCalcMatrix(group.gfx, s.cameras.main).calc;
      const vertices = blocks.flatMap(block => Array.from({ length: block.projected.length / 2 }, (_, i) =>
        matrix.transformPoint(block.projected[i * 2], block.projected[i * 2 + 1])));
      // Roof triangles may extend above the supporting prism.
      for (const face of faces) for (const p of face.projected || []) vertices.push(matrix.transformPoint(p.x, p.y));
      const rect = __game.canvas.getBoundingClientRect(), scaleX = rect.width / __game.canvas.width, scaleY = rect.height / __game.canvas.height;
      const screen = vertices.map(p => ({ x: rect.left + p.x * scaleX, y: rect.top + p.y * scaleY }));
      const padding = 16;
      const left = Math.max(0, Math.floor(Math.min(...screen.map(p => p.x)) - padding));
      const top = Math.max(0, Math.floor(Math.min(...screen.map(p => p.y)) - padding));
      const right = Math.min(innerWidth, Math.ceil(Math.max(...screen.map(p => p.x)) + padding));
      const bottom = Math.min(innerHeight, Math.ceil(Math.max(...screen.map(p => p.y)) + padding));
      const towerHits = model.layout.towers.map(tower => {
        const block = blocks.find(b => Math.abs(b.x - tower.x) < 1e-4 && Math.abs(b.y - tower.y) < 1e-4);
        const face = block?.materialFaces.filter(f => f.visible && f.projected?.length === 3)
          .sort((a, b) => Math.max(...b.points.map(p => p.z)) - Math.max(...a.points.map(p => p.z)))[0];
        if (!face) return null;
        const center = face.projected.reduce((sum, p) => ({ x: sum.x + p.x / 3, y: sum.y + p.y / 3 }), { x: group.x, y: group.y });
        return Render.buildingHit(s, center.x, center.y);
      });
      const keep = model.layout.keep;
      const keepFaces = keep ? blocks.filter(b => Math.abs(b.x - keep.x) < 1e-4 && Math.abs(b.y - keep.y) < 1e-4)
        .flatMap(b => b.materialFaces || []) : [];
      return {
        family: model.family || model.style?.id || null,
        blocks: blocks.length, materialTriangles: faces.length,
        visibleTriangles: faces.filter(f => f.visible).length,
        materialColors: [...new Set(faces.map(f => f.color))].sort(),
        towers: model.layout.towers.length, keep: !!model.layout.keep,
        keepRoofTriangles: keepFaces.filter(f => f.material === 'roof').length,
        keepDoorTriangles: keepFaces.filter(f => f.material === 'door').length,
        keepDoorSeamTriangles: keepFaces.filter(f => f.material === 'door-seam').length,
        keepBannerTriangles: keepFaces.filter(f => /banner/.test(f.material || '')).length,
        woodTriangles: faces.filter(f => /wood|timber|rafter|gallery/.test(f.material || '')).length,
        finite: blocks.every(b => [...b.projected].every(Number.isFinite)) && faces.every(f => f.points.every(p => [p.x, p.y, p.z].every(Number.isFinite))),
        retained: group.blocks.length === probe.retained.size && group.blocks.every(b => probe.retained.has(b)),
        legacyTowers: (s.towerPool || []).filter(sprite => sprite.visible && sprite._staticObject?.castle === probe.family).length,
        towerHits, projection: { heading: s.mapRot, heightScale: BuildingLowPoly.LOOK.heightScale, mapZoom: s.mapZoom },
        crop: { x: left, y: top, width: right - left, height: bottom - top },
      };
    };
  }, clean);
}

function boards(report) {
  // Contact sheets only assemble native camera screenshots; no art is repainted.
  execFileSync('python3', ['-c', `
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json,sys
root=Path(sys.argv[1]); report=json.loads((root/'report.json').read_text())
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
for renderer in report['renderers']:
 for family in report['families']:
  cases=[c for c in report['cases'] if c['renderer']==renderer and c['requestedFamily']==family and c['angle']==0]
  if not cases:continue
  names=list(dict.fromkeys(c['shape'] for c in cases)); states=list(dict.fromkeys(c['state'] for c in cases))
  cell_w,cell_h=520,420
  board=Image.new('RGB',(cell_w*len(states),cell_h*len(names)+56),'#202923'); d=ImageDraw.Draw(board)
  d.text((20,16),family.upper()+' / '+renderer+' / actual in-game camera',font=font,fill='#eee8d6')
  for c in cases:
   col=states.index(c['state']); row=names.index(c['shape']); x=col*cell_w;y=row*cell_h+56
   im=Image.open(root/c['cropFile']).convert('RGB')
   scale=min(2,(cell_w-32)/im.width,(cell_h-58)/im.height)
   im=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.NEAREST)
   board.paste(im,(x+(cell_w-im.width)//2,y+36+(cell_h-58-im.height)//2))
   d.text((x+16,y+4),c['shape']+' / '+c['state'],font=font,fill='#eee8d6')
  board.save(root/(renderer+'-'+family+'-board.png'))
`, OUT], { stdio: 'inherit' });
  const links = report.renderers.flatMap(renderer => report.families.map(family => `${renderer}-${family}-board.png`)).filter(name => fs.existsSync(path.join(OUT, name)));
  const images = links.map(name => `<h2>${name.replace(/\.png$/, '')}</h2><a href="${name}"><img src="${name}" alt="Actual castle game captures"></a>`).join('\n');
  fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="artifact-review" content="disabled"><title>Castle renderer review</title><style>body{background:#202923;color:#eee8d6;font:16px system-ui;max-width:1300px;margin:32px auto;padding:0 24px}img{max-width:100%;image-rendering:pixelated}a{color:#d6ca9e}</style><h1>Castle renderer review</h1><p>Actual MapScene screenshots, using the live square-map camera. Contact sheets use nearest-neighbour enlargement only. Full screenshots, individual crops and per-case geometry counts are retained beside this page.</p><p><a href="report.json">Capture report</a></p>${images}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { families, renderers, clean, cases: [], errors: [], failedRequests: [], externalFailures: [], limitations: ['Desktop Chromium; fixtures change browser-local shape and claim state only.', ...(clean ? ['Clean art review hides actors, labels, legacy flag sprites and the composited lightmap in the browser fixture only.'] : []), 'Visual matching requires inspection of the captured images.'] };
  const env = { ...process.env }; delete env.DISPLAY;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/lib/chromium/chromium', env,
    args: ['--no-sandbox', '--ozone-platform=headless', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const renderer of renderers) {
      const page = await browser.newPage({ viewport: { width: 700, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
      page.on('pageerror', error => report.errors.push({ renderer, message: error.message }));
      page.on('response', response => {
        if (response.status() < 400) return;
        const target = new globalThis.URL(response.url());
        const failures = target.origin === new globalThis.URL(URL).origin ? report.failedRequests : report.externalFailures;
        failures.push({ renderer, status: response.status(), url: response.url() });
      });
      await page.addInitScript(() => { sessionStorage.setItem('terracart.safetySeen', '1'); localStorage.setItem('terracart.introSeen', '1'); localStorage.setItem('terracart.howtoSeen', '1'); });
      await page.route('**/src/app.js*', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('type: Phaser.AUTO,', `type: Phaser.${renderer === 'canvas' ? 'CANVAS' : 'WEBGL'},`) });
      });
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__scene?._bootOverlayGone && window.__scene?._fdrCastleLayouts?.size > 0, null, { timeout: 90000 });
      assert.equal(await page.evaluate(() => __game.renderer.type), renderer === 'canvas' ? 1 : 2);
      await installFixture(page);
      for (const family of families) for (const shape of selectedShapes) for (const state of states) {
        assert.ok(shapes[shape], `Unknown footprint: ${shape}`);
        await page.evaluate(({ points, family, active }) => castleFamilyProbe.place(points, family, active), { points: shapes[shape], family, active: state === 'restored' });
        for (const angle of angles) {
          await page.evaluate(degrees => castleFamilyProbe.turn(degrees), angle);
          const result = await page.evaluate(() => castleFamilyProbe.measure());
          assert.ok(result.blocks > 0 && result.towers > 0);
          assert.ok(result.finite && result.retained);
          assert.equal(result.family, family, 'fixture routes the requested family through the actual map renderer');
          assert.ok(result.towerHits.every(key => key === family), 'visible tower faces hit their castle');
          assert.equal(result.legacyTowers, 0);
          if (family === 'archive') {
            assert.equal(result.woodTriangles, 0, 'Archive uses no wood geometry');
            if (result.keep) assert.equal(result.keepRoofTriangles, state === 'restored' ? 4 : 2, 'Archive keep has its simple roof');
          }
          if (result.keep) {
            assert.equal(result.keepDoorTriangles, 2, 'keep doors are closed wall decals');
            assert.equal(result.keepDoorSeamTriangles, 2, 'closed door center seam is present');
            assert.equal(result.keepBannerTriangles, 0, 'a keep banner cannot obscure its entrance');
          }
          assert.ok(result.crop.width > 0 && result.crop.height > 0);
          const name = `${renderer}-${family}-${shape}-${state}-${angle}`;
          await page.screenshot({ path: path.join(OUT, name + '.png') });
          await page.screenshot({ path: path.join(OUT, name + '-crop.png'), clip: result.crop });
          report.cases.push({ renderer, requestedFamily: family, shape, state, angle, ...result,
            fullFile: name + '.png', cropFile: name + '-crop.png' });
        }
        console.log(renderer, family, shape, state, 'passed');
      }
      await page.close();
    }
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.failedRequests, []);
    report.passed = true;
  } catch (error) {
    report.passed = false; report.failure = error.stack; throw error;
  } finally {
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
    if (report.cases.length) boards(report);
  }
})().catch(error => { console.error(error); process.exit(1); });
