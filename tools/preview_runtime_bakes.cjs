// Run the game's texture callbacks on Canvas2D, without starting a game/server.
// The generated PNGs retain runtime frame coordinates and alpha exactly.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright-core');

async function bakeRuntimeTextures(root, registry) {
  const read = name => fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8');
  const textureSource = read('textures');
  const from = textureSource.indexOf('function bakeCanvas(');
  const to = textureSource.indexOf('function drawGrassTex(', from);
  if (from < 0 || to < 0) throw new Error('Cannot find runtime berry texture baker');
  const sources = ['rogue_object_bounds', 'rogue_prop_profile', 'rogue_objects'].map(read);
  if (!registry) {
    // Let the active profile declare both source paths. The empty base entry
    // merely enables its normal replacement of the existing bush texture.
    const context = { ASSETS: { bushes: {} }, SpriteLayout: { ART_BOUNDS: {} } };
    vm.createContext(context);
    for (const source of sources) vm.runInContext(source, context);
    registry = { assets: context.ASSETS };
  }
  sources.push(textureSource.slice(from, to));
  const images = {};
  for (const key of ['rogue_stone', 'bushes']) {
    const asset = registry.assets[key];
    if (!asset?.path) throw new Error('Missing active-profile source: ' + key);
    images[key] = {
      url: 'data:image/png;base64,' + fs.readFileSync(path.join(root, asset.path.split('?')[0])).toString('base64'),
    };
  }
  const executable = process.env.PW_CHROMIUM || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(file => fs.existsSync(file));
  const browser = await chromium.launch({ ...(executable ? { executablePath: executable } : {}), headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: 'const ASSETS = {bushes:{}}; const SpriteLayout = {ART_BOUNDS:{}};' });
    for (const source of sources) await page.addScriptTag({ content: source });
    return await page.evaluate(async images => {
      const entries = new Map();
      function add(key, source) {
        const frames = {};
        const texture = {
          context: source.getContext?.('2d'),
          getSourceImage: () => source,
          getContext: () => texture.context,
          add: (name, sourceIndex, x, y, width, height) => { frames[name] = { x, y, width, height }; },
          refresh() {}, frames,
        };
        entries.set(key, texture);
        return texture;
      }
      const scene = { textures: {
        exists: key => entries.has(key),
        get: key => entries.get(key),
        createCanvas(key, width, height) {
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          return add(key, canvas);
        },
      } };
      for (const [key, row] of Object.entries(images)) {
        const image = new Image(); image.src = row.url; await image.decode(); add(key, image);
      }
      // Both are the owning runtime functions, not copied painting recipes.
      ASSETS.rogue_stone.onLoad(scene);
      makeBerryBushTexture(scene);
      return Object.fromEntries(['rogue_minerals', 'bushes_fruiting', 'bushes_poisonberry', 'bushes_goldenberry'].map(key => {
        const texture = entries.get(key), canvas = texture.getSourceImage(), frame = texture.frames[0];
        return [key, { kind: 'spritesheet', path: 'runtime:' + key, dataUrl: canvas.toDataURL('image/png'),
          width: canvas.width, height: canvas.height, frameWidth: frame.width, frameHeight: frame.height,
          frameRects: texture.frames, whiteKey: false }];
      }));
    }, images);
  } finally { await browser.close(); }
}

module.exports = bakeRuntimeTextures;
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const registry = JSON.parse(fs.readFileSync(0, 'utf8'));
  bakeRuntimeTextures(root, registry).then(result => process.stdout.write(JSON.stringify(result)))
    .catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
