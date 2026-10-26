// CPU preparation and pixel/geometry parity for authored building startup.
// BASELINE_DIR may contain authored_buildings.js and authored_roof_palette.js
// from a previous revision. Timings exclude image fetches and GPU uploads.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const files = ['authored_roof_palette.js', 'authored_buildings.js'];
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, bytes) => {
      if (error) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', ({'.html':'text/html', '.js':'application/javascript', '.png':'image/png', '.json':'application/json'})[path.extname(file)] || 'application/octet-stream');
      res.end(bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/lib/chromium/chromium',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?sandbox=true&sandboxZone=restoration&skipStory=true&skipTutorial=true`);
    await page.waitForFunction(() => window.__scene?._bootOverlayGone, null, { timeout: 60000 });
    await page.evaluate(() => __scene.game.scene.getScenes(true).forEach(scene => __scene.game.scene.sleep(scene)));
    const runs = [];
    for (const revision of (process.env.BASELINE_DIR ? ['baseline', 'current'] : ['current'])) {
      const sources = files.map(file => fs.readFileSync(path.join(revision === 'baseline' ? process.env.BASELINE_DIR : path.join(root, 'src'), file), 'utf8'));
      for (let round = 0; round < 3; round++) {
        const result = await page.evaluate(async ({ sources, revision }) => {
          for (const source of sources) (0, eval)(source);
          const textures = new Map(), created = [];
          for (const key of __scene.textures.getTextureKeys()) if (key.startsWith('authored_source_') || key.startsWith('dreamland_chimney')) textures.set(key, __scene.textures.get(key));
          const scene = { textures: {
            exists: key => textures.has(key), get: key => textures.get(key),
            createCanvas(key, width, height) {
              const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
              const context = canvas.getContext('2d');
              const texture = { key, width, height, getSourceImage: () => canvas, getContext: () => context, refresh() {}, setFilter() {} };
              textures.set(key, texture); created.push(texture); return texture;
            }
          }};
          const start = performance.now();
          AuthoredBuildings.prepare(scene, { review: false });
          const ms = performance.now() - start, bytes = created.reduce((sum, texture) => sum + texture.width * texture.height * 4, 0);
          const digest = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data))).map(x => x.toString(16).padStart(2, '0')).join('');
          const variants = new Map();
          for (let id = 0; id < 200; id++) {
            const recipe = AuthoredBuildings.recipeFor('plain', String(id));
            variants.set(recipe.key + ':' + recipe.palette, recipe);
          }
          for (const role of ['plain','home','workshop','blacksmith','trader','wizard','fort',...Object.keys(AuthoredBuildings.SHOP_ROOFS)]) for (const tier of [1,2,4]) for (const second of [false,true]) {
            const recipe = AuthoredBuildings.recipeFor(role, 'sample', tier, second);
            variants.set(recipe.key + ':' + recipe.palette, recipe);
          }
          const geometry = {}, pixels = {}, emblems = {};
          for (const [id, recipe] of variants) {
            const model = AuthoredBuildings.build(scene, recipe.key, recipe.palette);
            if (!model) throw Error('Missing runtime variant ' + id);
            geometry[id] = await digest(new TextEncoder().encode(JSON.stringify(model.faces.map(f => ({ points:f.points, kind:f.kind, feature:f.feature, texture:f.texture.key, fallbackUV:f.fallbackUV })) )));
            for (const face of model.faces) if (!pixels[face.texture.key]) {
              const image = face.texture.getSourceImage();
              pixels[face.texture.key] = await digest(face.texture.getContext().getImageData(0,0,image.width,image.height).data);
            }
          }
          for (const role of ['blacksmith','trader','fort',...Object.keys(AuthoredBuildings.SHOP_ROOFS)]) {
            const recipe = AuthoredBuildings.recipeFor(role,'sample',1);
            const emblem = AuthoredRoofPalette.getEmblem(scene,role,recipe.palette);
            if (!emblem) continue;
            const texture = emblem.roof;
            emblems[role] = {
              pixels: await digest(texture.getContext().getImageData(0,0,92,32).data),
              uv: ['roofUV','signUV','roofSideUV','signSideUV','bracketUV'].map(key => emblem[key].map((v,i) => v * (i%2 ? texture.height : texture.width)))
            };
          }
          const before = created.length;
          AuthoredBuildings.prepare(scene, { review: false });
          if (created.length !== before) throw Error('Repeated runtime prepare allocated textures');
          const sample = AuthoredBuildings.build(scene,'pp_plaster','yellow');
          const original = sample.faces[0].points[0].x; sample.faces[0].points[0].x += 123;
          if (AuthoredBuildings.build(scene,'pp_plaster','yellow').faces[0].points[0].x !== original) throw Error('Model placement mutated cached geometry');
          const reviewBefore = created.length;
          AuthoredBuildings.prepare(scene);
          for (const color of ['red','brown','orange','blue','green','pink']) if (!AuthoredBuildings.build(scene,'pp_flat_'+color,'native')) throw Error('Missing review model ' + color);
          const reviewAdded = created.length - reviewBefore;
          if (revision === 'current' && reviewAdded !== 6) throw Error('Runtime must defer exactly six review-only materials');
          return { ms, bytes, created:before, reviewAdded, geometry, pixels, emblems };
        }, { sources, revision });
        runs.push({revision, ...result});
      }
    }
    assert.deepEqual(errors, []);
    const current = runs.find(run => run.revision === 'current');
    if (process.env.BASELINE_DIR) {
      const baseline = runs.find(run => run.revision === 'baseline');
      assert.deepEqual(current.geometry, baseline.geometry, 'All runtime geometry and palette assignments match');
      assert.deepEqual(current.pixels, baseline.pixels, 'All runtime material pixels match');
      assert.deepEqual(current.emblems, baseline.emblems, 'Plaque pixels and sampled source coordinates match');
    }
    console.log(JSON.stringify(runs.map(({revision,ms,bytes,created,reviewAdded})=>({revision,ms:+ms.toFixed(1),bytes,created,reviewAdded})),null,2));
    console.log(`PASS: ${Object.keys(current.geometry).length} runtime models, ${Object.keys(current.pixels).length} material atlases, ${Object.keys(current.emblems).length} plaques; review expansion and detached geometry.`);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
