// Capture actual MapScene castles; fixture changes stay in an isolated browser save.
// GAME_URL=http://localhost:8765/index.html?sandbox=true&sandboxZone=castle&skipStory=true&skipTutorial=true \
// OUT_DIR=/tmp/castle-family-study node tools/castle-family-study.cjs
// SOURCE_DIR=/saved/src ASSET_DIR=/saved/assets freezes a review round during edits.
// MAP_ZOOM=0.8 fits wider fixtures; ROTATION_STEP=1 adds a numeric renderer
// sweep at each degree plus 360, independently of the screenshot ANGLES list.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const OUT = process.env.OUT_DIR || '/tmp/castle-family-study';
const URL = process.env.GAME_URL || 'http://localhost:8765/index.html?sandbox=true&sandboxZone=castle&skipStory=true&skipTutorial=true';
const shapes = {
  rectangle: [[-100,-80],[100,-80],[100,80],[-100,80]],
  // A wider, shallower site approximates the concept sheet's ground footprint.
  // This changes the fixture only, never the square-map camera or height scale.
  concept_rectangle: [[-140,-55],[140,-55],[140,55],[-140,55]],
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
const selectedShapes = selected('SHAPES', 'rectangle,narrow,concave,skewed,acute');
const clean = process.env.CLEAN === '1';
const mapZoom = Number(process.env.MAP_ZOOM || 1);
if (!(mapZoom > 0 && mapZoom <= 2)) throw Error('MAP_ZOOM must be greater than zero and at most two');
const rotationStep = process.env.ROTATION_STEP === undefined ? null : Number(process.env.ROTATION_STEP);
if (rotationStep !== null && !(rotationStep >= .1 && rotationStep <= 360)) throw Error('ROTATION_STEP must be between 0.1 and 360 degrees');
const sourceDir = process.env.SOURCE_DIR;
const assetDir = process.env.ASSET_DIR;
const sourceHashes = {};
const assetHashes = {};
const castleAssetDir = path.join(assetDir || path.join(__dirname, '../assets'), 'Objects/Castle/FDR');
for (const file of fs.readdirSync(castleAssetDir).filter(file => file.endsWith('.png')).sort()) {
  const relative = path.join('Objects/Castle/FDR', file);
  const location = assetDir && fs.existsSync(path.join(assetDir, relative)) ? path.join(assetDir, relative) : path.join(__dirname, '../assets', relative);
  assetHashes[relative] = createHash('sha256').update(fs.readFileSync(location)).digest('hex');
}
const sourceFiles = ['assets.js', 'building_overlay.js', 'castle_styles.js', 'fdr_castle_geometry.js', 'fdr_castle_layout.js', 'fdr_castle_canvas.js', 'wall_surface_renderer.js', 'wall_perspective.js', 'polygon_geometry.js'];
for (const file of sourceFiles) {
  const location = sourceDir && fs.existsSync(path.join(sourceDir, file)) ? path.join(sourceDir, file) : path.join(__dirname, '../src', file);
  sourceHashes[file] = createHash('sha256').update(fs.readFileSync(location)).digest('hex');
}

async function installFixture(page) {
  await page.evaluate(({clean,mapZoom}) => {
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
      // Review-only visibility switches leave castle geometry, terrain and camera intact.
      s._sandboxLabels?.removeAll(true); s._sandboxLabelData = [];
      for (const name of ['worldContainer', 'shadowContainer', 'player', 'playerWorldContainer', 'creaturesContainer', 'labelContainer', '_sandboxLabels', 'towerContainer', 'lightMap'])
        s[name]?.setVisible(false);
      for (const name of ['objectPool', 'towerPool', 'castleFlagPool', 'creatureShadowPool', 'enemyAuraPool', 'playerAuraPool'])
        for (const object of s[name] || []) object.setVisible?.(false);
      // Hit testing reads child visibility, not just its hidden parent. Old
      // sandbox foreground meshes must not intercept the isolated castle.
      for (const mesh of s._lowpoly?.buildings || []) mesh.obj?.setVisible(false);
      for (const slot of s._produceSignPool || []) if (slot.el) slot.el.style.display = 'none';
    };
    const oldClaim = s.isClaimedKey;
    s.isClaimedKey = function(key) {
      return ['citadel', 'bastion', 'archive'].includes(key) ? probe.active : oldClaim.call(this, key);
    };
    probe.place = function(points, family, active) {
      probe.family = family; probe.active = active;
      s.peekM = { x: 0, y: 0 }; s.mapZoom = mapZoom; s.mapRot = 0; s._huManualAngle = 0;
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
      // Rendering refreshes low-poly child visibility; restore the isolated
      // fixture state before hit checks, matching the hidden parent on screen.
      probe.clean();
    };
    probe.sweep = function(step) {
      const group=s._wallPerspective.castles,blocks=new Set(group.blocks);
      const originals=new Map(group.blocks.flatMap(b=>(b.materialFaces||[]).map(face=>
        [face,face.points.map(p=>({u:p.u,v:p.v}))])));
      const headings=Array.from({length:Math.ceil(360/step)},(_,i)=>i*step).concat(360);
      const errors=[],started=performance.now();
      for(const heading of headings) {
        // Runs the real geometry update and renderer, without a screenshot or
        // expensive hit-test/crop/UV-seam measurement at every numeric sample.
        probe.turn(heading);
        const failed=new Set();let faceCount=0;
        if(group.blocks.length!==blocks.size||group.blocks.some(b=>!blocks.has(b)))failed.add('retained-block-identity');
        for(const block of group.blocks) {
          if(!Array.from(block.projected).every(Number.isFinite))failed.add('finite-prism-projection');
          for(const face of block.materialFaces||[]) {
            faceCount++;
            const original=originals.get(face);
            if(!original||original.length!==face.points.length)failed.add('retained-face-identity');
            if(face.visible&&(!face.projected||face.projected.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))))failed.add('finite-face-projection');
            const slots=new Set();
            face.points.forEach((p,i)=>{
              if(!Number.isFinite(p.u)||!Number.isFinite(p.v))failed.add('finite-uv');
              if(p.u<0||p.u>1||p.v<0||p.v>1)failed.add('uv-atlas-bounds');
              if(original&&(p.u!==original[i]?.u||p.v!==original[i]?.v))failed.add('source-uv-invariance');
              slots.add(Math.floor(p.u*4)+4*Math.floor(p.v*4));
            });
            if(slots.size!==1)failed.add('single-atlas-slot');
          }
        }
        if(faceCount!==originals.size)failed.add('retained-face-count');
        for(const target of [group.gfx,...group.parts||[]])if(target.visible) {
          const matrix=Phaser.GameObjects.GetCalcMatrix(target,s.cameras.main).calc;
          if(![matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f].every(Number.isFinite))failed.add('finite-render-transform');
          for(const triangle of target._wallTriangles||[])if(triangle.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))failed.add('finite-submitted-triangle');
        }
        for(const check of failed)errors.push({heading,check});
      }
      return {step,headings,samples:headings.length,elapsedMs:performance.now()-started,errors,
        checks:['finite projected coordinates','finite render transforms and submitted triangles','UV atlas bounds and single-slot sampling','retained block and face identities','unchanged source UV coordinates'],
        limitation:'Numeric renderer sweep only; finite geometry and stable UVs do not prove visual seam absence or concept fidelity.'};
    };
    probe.measure = function() {
      const group = s._wallPerspective.castles, model = s._fdrCastleLayouts.get(probe.family);
      if (!model) throw Error('Castle fixture was not emitted: ' + probe.family);
      const blocks = group.blocks.filter(block => block.building?.key === probe.family);
      const faces = blocks.flatMap(block => block.materialFaces || []);
      // Inspect source UVs, not screenshots. Bounds catch atlas escapes;
      // scale ranges expose stretched masonry while allowing intentional decals.
      const uvAudit = { nonFinite: 0, outsideAtlas: 0, crossingSlots: 0, masonrySharedEdges: 0, masonryDiscontinuities: 0, materials: {} };
      const horizontalRepeat = model.style?.masonryRepeatFraction || 1;
      uvAudit.masonryRepeatFraction = horizontalRepeat;
      const masonryEdges = new Map();
      for (const face of faces) {
        const points = face.points;
        if (points.some(p => !Number.isFinite(p.u) || !Number.isFinite(p.v))) { uvAudit.nonFinite++; continue; }
        if (points.some(p => p.u < 0 || p.u > 1 || p.v < 0 || p.v > 1)) uvAudit.outsideAtlas++;
        if (new Set(points.map(p => Math.floor(p.u * 4) + 4 * Math.floor(p.v * 4))).size > 1) uvAudit.crossingSlots++;
        if (points.every(p => p.u >= 496/512 && p.v >= 496/512)) continue;
        if (face.material==='stone' && face.normal) for(let i=0;i<3;i++) {
          const keyPoint=p=>[p.x,p.y,p.z].map(v=>Math.round(v*1e5)).join(',');
          const ordered=[points[i],points[(i+1)%3]].sort((a,b)=>keyPoint(a).localeCompare(keyPoint(b)));
          const edgeKey=[face.normal.x,face.normal.y].map(v=>Math.round(v*1e5)).join(',')+'|'+ordered.map(keyPoint).join('|');
          const existing=masonryEdges.get(edgeKey);
          if(existing) {
            uvAudit.masonrySharedEdges++;
            // Whole repeats can meet seamlessly. Fractional jumps across the
            // same stone plane expose independently reset fragment UVs.
            const discontinuous=ordered.some((p,j)=>['u','v'].some(axis=>{
              const delta=(p[axis]-existing[j][axis])*512/112/(axis==='u'?horizontalRepeat:1);
              return Math.abs(delta-Math.round(delta))>1e-5;
            }));
            if(discontinuous)uvAudit.masonryDiscontinuities++;
          } else masonryEdges.set(edgeKey,ordered);
        }
        const material = uvAudit.materials[face.material] ||= { triangles: 0, horizontal: [], vertical: [] };
        material.triangles++;
        for (let i=0;i<3;i++) {
          const a=points[i],b=points[(i+1)%3],xy=Math.hypot(b.x-a.x,b.y-a.y),z=Math.abs(b.z-a.z);
          const texels=Math.hypot(b.u-a.u,b.v-a.v)*512;
          if (xy>1e-6 && z<1e-6) material.horizontal.push(texels/xy);
          if (z>1e-6 && xy<1e-6) material.vertical.push(texels/z);
        }
      }
      for (const material of Object.values(uvAudit.materials)) for (const axis of ['horizontal','vertical']) {
        const values=material[axis];material[axis]=values.length ? { min: Math.min(...values), max: Math.max(...values), samples: values.length } : null;
      }
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
        towerHits, uvAudit, projection: { heading: s.mapRot, heightScale: BuildingLowPoly.LOOK.heightScale, mapZoom: s.mapZoom },
        crop: { x: left, y: top, width: right - left, height: bottom - top },
      };
    };
  }, {clean,mapZoom});
}

function boards(report) {
  // Contact sheets only assemble native camera screenshots; no art is repainted.
  execFileSync('python3', ['-c', `
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json,sys
root=Path(sys.argv[1]); report=json.loads((root/'report.json').read_text())
# Derive each crop from its exact full frame; never advance the game for a second screenshot.
for case in report['cases']:
 crop=case['crop']; image=Image.open(root/case['fullFile'])
 image.crop((crop['x'],crop['y'],crop['x']+crop['width'],crop['y']+crop['height'])).save(root/case['cropFile'])
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
  const report = { families, renderers, clean, sourceDir, assetDir, sourceHashes, assetHashes, fixtureShapes: Object.fromEntries(selectedShapes.map(name=>[name,shapes[name]])), rotationStep, numericSweeps: [], cases: [], errors: [], failedRequests: [], externalFailures: [], limitations: ['Desktop Chromium; fixtures change browser-local shape and claim state only.', 'concept_rectangle changes footprint proportions only; the square-map camera and screen-up elevation remain the game projection.', 'UV scale ranges are diagnostics, not a proof of visual parity or artifact-free rendering.', 'Optional numeric rotation sweeps execute the renderer without per-degree screenshots; they complement visual checks rather than proving seam absence.', ...(clean ? ['Clean art review hides actors, labels, legacy flag sprites and the composited lightmap in the browser fixture only.'] : []), 'Visual matching requires inspection of the captured images.'] };
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
      if (assetDir) await page.route('**/assets/**', async route => {
        const relative = new globalThis.URL(route.request().url()).pathname.split('/assets/')[1];
        const location = path.join(assetDir, relative);
        if (fs.existsSync(location) && fs.statSync(location).isFile()) await route.fulfill({ path: location });
        else await route.continue();
      });
      if (sourceDir) await page.route('**/src/*.js*', async route => {
        const file = path.basename(new globalThis.URL(route.request().url()).pathname);
        const location = path.join(sourceDir, file);
        if (fs.existsSync(location)) await route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(location, 'utf8') });
        else await route.continue();
      });
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
        if(rotationStep!==null) {
          const sweep=await page.evaluate(step=>castleFamilyProbe.sweep(step),rotationStep);
          report.numericSweeps.push({renderer,family,shape,state,...sweep});
          assert.deepEqual(sweep.errors,[], 'numeric rotation sweep preserves valid geometry and immutable UVs');
        }
        for (const angle of angles) {
          await page.evaluate(degrees => castleFamilyProbe.turn(degrees), angle);
          const result = await page.evaluate(() => castleFamilyProbe.measure());
          assert.ok(result.blocks > 0 && result.towers > 0);
          assert.ok(result.finite && result.retained);
          assert.equal(result.uvAudit.nonFinite, 0, 'all UV coordinates are finite');
          assert.equal(result.uvAudit.outsideAtlas, 0, 'all UV coordinates remain inside the atlas');
          assert.equal(result.uvAudit.crossingSlots, 0, 'each triangle samples one atlas slot');
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
