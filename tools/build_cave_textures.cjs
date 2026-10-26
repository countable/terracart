#!/usr/bin/env node
// Export the shipping cave painters; --check verifies committed decoded pixels.
// CHROMIUM_PATH selects the browser. No game server, network or save is needed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets/Objects/Cave/Baked');
const CHECK = process.argv.includes('--check');
const SCRIPTS = ['util.js', 'ground_materials.js', 'textures.js', 'floor_wall_materials.js'];
const SOURCE = 'assets/Objects/Cave/floor-wall-sources.png';
const KEYS = ['cave_wall_edges', 'cave_chasm', ...Array.from({length: 7}, (_, i) => `floor-wall-l${i + 1}`)];
const imageURL = file => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    for (const name of SCRIPTS) await page.addScriptTag({path: path.join(ROOT, 'src', name)});
    const result = await page.evaluate(async ({source, keys, committed}) => {
      const load = url => new Promise((resolve, reject) => {
        const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = url;
      });
      const wrap = (key, image) => ({
        key, getSourceImage: () => image, getContext: () => image.getContext('2d'),
        frames: [], add(...frame) { this.frames.push(frame); }, refresh() {}, setFilter() {},
      });
      const sourceImage = await load(source);
      let created = 0;
      const textures = new Map([['floor_wall_sources', wrap('floor_wall_sources', sourceImage)]]);
      const scene = {textures: {
        exists: key => textures.has(key), get: key => textures.get(key),
        createCanvas(key, width, height) {
          created++;
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          const texture = wrap(key, canvas); textures.set(key, texture); return texture;
        },
      }};
      const phases = [];
      const timed = (name, fn) => { const start = performance.now(); fn(); phases.push({name, ms: performance.now() - start}); };
      timed('base walls', () => makeCaveWallEdges(scene, 32));
      timed('chasm', () => makeCaveChasmTexture(scene, 32));
      timed('seven themed walls', () => { for (let depth = 1; depth <= 7; depth++) FloorWallMaterials.prepare(scene, depth); });
      const rows = keys.map(key => {
        const texture = textures.get(key), canvas = texture.getSourceImage();
        return {key, width: canvas.width, height: canvas.height, frames: texture.frames,
          png: canvas.toDataURL('image/png').split(',')[1]};
      });
      const pixels = image => {
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      // Compare decoded PNGs rather than compressed bytes or transparent RGB.
      // The encoder is allowed to vary while the pixels remain identical.
      for (const row of rows) {
        const fresh = await load('data:image/png;base64,' + row.png);
        if (committed) {
          const saved = await load(committed[row.key]);
          if (saved.width !== row.width || saved.height !== row.height) throw Error(row.key + ': dimensions changed');
          const a = pixels(fresh), b = pixels(saved);
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw Error(row.key + ': pixel mismatch at byte ' + i);
        }
        textures.set(row.key, wrap(row.key, fresh));
      }
      const before = created;
      timed('preloaded reuse', () => {
        makeCaveWallEdges(scene, 32); makeCaveChasmTexture(scene, 32);
        for (let depth = 1; depth <= 7; depth++) FloorWallMaterials.prepare(scene, depth);
      });
      if (created !== before) throw Error('Preloaded atlases unexpectedly created canvases');
      // A standalone tool may load only the base PNG, then request one theme.
      textures.delete('floor-wall-l1');
      const mixed = FloorWallMaterials.prepare(scene, 1).getSourceImage();
      const expected = await load('data:image/png;base64,' + rows.find(row => row.key === 'floor-wall-l1').png);
      const a = pixels(mixed), b = pixels(expected);
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw Error('Mixed image/canvas fallback mismatch at byte ' + i);
      return {rows, phases, created};
    }, {source: imageURL(path.join(ROOT, SOURCE)), keys: KEYS,
      committed: CHECK ? Object.fromEntries(KEYS.map(key => [key, imageURL(path.join(OUT, key + '.png'))])) : null});
    assert.equal(result.rows[0].frames.length, 256);
    assert.equal(result.rows[1].frames.length, 16);
    if (!CHECK) {
      fs.mkdirSync(OUT, {recursive: true});
      for (const row of result.rows) fs.writeFileSync(path.join(OUT, row.key + '.png'), Buffer.from(row.png, 'base64'));
      const sourceFiles = [...SCRIPTS.map(name => 'src/' + name), SOURCE];
      const manifest = {
        generator: 'node tools/build_cave_textures.cjs',
        method: 'Original runtime Canvas2D painters, 32px cells; decoded PNG parity checked with --check.',
        sources: Object.fromEntries(sourceFiles.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex')])),
        textures: result.rows.map(({key, width, height, frames}) => ({key, width, height, frames: frames.length})),
      };
      fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    }
    console.log(JSON.stringify({mode: CHECK ? 'check' : 'export', textures: result.rows.length,
      phases: result.phases.map(({name, ms}) => ({name, ms: +ms.toFixed(2)})),
      pixelParity: CHECK ? 'all committed atlases match' : 'run --check to compare committed atlases',
      mixedFallback: 'matches', preloadedCanvasCreations: 0}, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
