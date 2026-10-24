// Compare the review's PNG pixels with fully loaded game textures, including
// active art-profile replacements and their onLoad-generated/cropped frames.
// Usage: node test/variant-art-parity.cjs [http://localhost:8765]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const base = (process.argv[2] || 'http://localhost:8765').replace(/\/$/, '');
const executablePath = process.env.PW_CHROMIUM || process.env.CHROMIUM
  || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(file => fs.existsSync(file));

// Ignore transparent margins, which the review may trim. Pixel order,
// dimensions, alpha and all visible colours still have to match exactly.
function pixelHelpers() {
  window.canonicalTextureHash = async canvas => {
    const ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (!pixels[(y * canvas.width + x) * 4 + 3]) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right < 0) return null;
    const width = right - left + 1, height = bottom - top + 1;
    const image = ctx.getImageData(left, top, width, height).data;
    for (let i = 0; i < image.length; i += 4) if (!image[i + 3]) image[i] = image[i + 1] = image[i + 2] = 0;
    const bytes = new Uint8Array(image.length + 8), dimensions = new DataView(bytes.buffer);
    dimensions.setUint32(0, width); dimensions.setUint32(4, height); bytes.set(image, 8);
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
  };
}

(async () => {
  const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    // A fresh browser context and isolated sandbox map never touch a player's
    // ordinary save or the browser profile used for their real game.
    const context = await browser.newContext();
    const game = await context.newPage(), errors = [];
    game.on('pageerror', error => errors.push('game: ' + error.message));
    await game.goto(base + '/tools/floor-viewer.html?sandboxType=nexus&sandboxVariant=orchard&play=true');
    await game.waitForURL('**/index.html?sandbox=true**', { timeout: 180000 });
    await game.waitForFunction(() => window.__scene?._sandboxMode && window.__scene.textures.exists('rogue_minerals'), null, { timeout: 180000 });
    await game.addScriptTag({ content: '(' + pixelHelpers.toString() + ')();' });
    const runtime = await game.evaluate(async () => {
      const scene = window.__scene, appearance = Render.objectAppearance(scene, new Map());
      const groups = {};
      async function textureFrame(key, frame) {
        const texture = scene.textures.get(key), crop = texture.get(frame ?? 0);
        if (!crop) throw new Error('Missing runtime frame: ' + key + ':' + frame);
        const canvas = document.createElement('canvas');
        canvas.width = crop.cutWidth; canvas.height = crop.cutHeight;
        canvas.getContext('2d').drawImage(crop.source.image, crop.cutX, crop.cutY, crop.cutWidth, crop.cutHeight,
          0, 0, crop.cutWidth, crop.cutHeight);
        const hash = await canonicalTextureHash(canvas);
        if (!hash) throw new Error('Empty runtime texture: ' + key + ':' + frame);
        return hash;
      }
      async function object(group, record) {
        const art = appearance.resolveAppearance({ ...record });
        if (!art?.visible) throw new Error('Runtime object is not visible: ' + group);
        (groups[group] ||= []).push(await textureFrame(art.texKey, art.frameVal));
      }
      // Cover all deterministic canopy choices without requiring every seeded
      // frame to appear in the review's representative layout.
      for (let id = 0; id < 24; id++) await object('living trees', {
        kind: 'tree', species: 'maple', size: 'large', variant: 3, id: 'art-parity-tree-' + id,
      });
      await object('dead trees', { kind: 'tree', species: 'maple', size: 'large', variant: 3, _objectArt: 'dead_tree' });
      for (let id = 0; id < 4; id++) await object('plain stones', { kind: 'mineralrock', yieldTier: 1, id: 'art-parity-stone-' + id });
      await object('copper', { kind: 'mineralrock', yieldTier: 2 });
      await object('sapphire', { kind: 'mineralrock', deposit: 'crystal', yieldTier: 4 });
      await object('grave markers', { kind: 'headstone' });
      await object('waystones', { kind: 'waystone' });
      await object('shrine fixtures', { kind: 'grove_shrine' });
      await object('barrels', { kind: 'chest', barrel: true });
      await object('chests', { kind: 'chest', tierSeed: 2 });
      for (const lit of [false, true]) await object('lamps', { kind: '_streetlamp', lit });
      for (const [group, crop] of [['olive canopy', 'shrub'], ['fruiting berries', 'berry'], ['long grass', 'longgrass']]) {
        const record = { kind: 'wildplant', crop, stage: MAX_GROWTH_STAGE }, art = wildplantSprite(record);
        const key = art.custom ? (art.texture || art.sheet) : art.sheet === 'springcrops' ? 'springcrops' : 'crops';
        const frames = art.custom ? (art.frames || [wildplantFrame(record)])
          : [art.sheet === 'springcrops' ? art.row * SPRING_CROPS_COLS + MAX_GROWTH_STAGE : CROP_ROW[crop] * CROPS_SHEET_COLS + MAX_GROWTH_STAGE];
        groups[group] = await Promise.all(frames.map(frame => textureFrame(key, frame)));
      }
      const groundSource = scene.textures.get(GroundMaterials.atlas.key).getSourceImage();
      const cellSize = GroundMaterials.atlas.frameSize, columns = groundSource.width / cellSize;
      const grounds = [
        ['Formal Garden ground', WorldGen.T.GROVE, 'formal_garden'],
        ['Mushroom Grove ground', WorldGen.T.GROVE, 'mushroom_grove'],
        ['Mystic Reef ground', WorldGen.T.SAND, 'mystic_reef'],
        ['Marine Meadow ground', WorldGen.T.GRASS, 'marine_meadow'],
        ['water', WorldGen.T.WATER, null], ['quarry ground', WorldGen.T.ROCK, 'quarry-strip-mine'],
      ];
      for (const [group, type, id] of grounds) {
        const row = id && ZoneVariants.byId(id);
        const entry = row && { zone: { coverage: new Uint16Array([1]), anchors: [{ kind: row.zone, variant: id }] } };
        const zoneTexture = entry && zoneGroundTexture(entry, 0, type);
        const mapped = GroundMaterials.backdropTypes[type] ?? type;
        const family = TerrainTransitions.materialForGround(mapped, zoneTexture || null);
        const layers = TerrainTransitions.layersFor([family, family, family, family]);
        if (layers.length !== 1) throw new Error('Uniform ground has unexpected composition: ' + group);
        const frame = layers[0], canvas = document.createElement('canvas');
        canvas.width = canvas.height = cellSize;
        canvas.getContext('2d').drawImage(groundSource, frame % columns * cellSize, Math.floor(frame / columns) * cellSize,
          cellSize, cellSize, 0, 0, cellSize, cellSize);
        groups[group] = [await canonicalTextureHash(canvas)];
      }
      return { enabled: WorldArtProfile.enabled, groups,
        isolated: scene._sandboxMode && !!new URL(location.href).searchParams.get('sandboxMap') };
    });
    assert.equal(runtime.enabled, true, 'The comparison must use the active game art profile');
    assert.equal(runtime.isolated, true, 'The comparison must remain inside the isolated sandbox');

    const review = await context.newPage();
    review.on('pageerror', error => errors.push('review: ' + error.message));
    await review.goto(base + '/design/zone-variants/#zones');
    await review.waitForFunction(() => document.documentElement.dataset.artReady === 'true', null, { timeout: 180000 });
    await review.addScriptTag({ content: '(' + pixelHelpers.toString() + ')();' });
    const hashes = await review.evaluate(async () => {
      const urls = [...new Set([...document.querySelectorAll('#zones image, #streets image')]
        .map(image => image.getAttribute('href')).filter(Boolean))];
      return Promise.all(urls.map(async url => {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        canvas.getContext('2d').drawImage(image, 0, 0);
        return canonicalTextureHash(canvas);
      }));
    });
    assert.deepEqual(errors, [], 'Game/review JavaScript errors prevent art parity');
    const present = new Set(hashes.filter(Boolean)), missing = Object.entries(runtime.groups)
      .filter(([, candidates]) => !candidates.some(hash => present.has(hash))).map(([group]) => group);
    const count = Object.keys(runtime.groups).length;
    console.log(`Variant art parity: ${count - missing.length}/${count} runtime groups match (${hashes.length} review images)`);
    assert.deepEqual(missing, [], 'Review is missing active runtime art: ' + missing.join(', '));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
