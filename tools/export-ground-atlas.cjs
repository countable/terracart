// Deterministic offline native-32 export. No HTTP server needed.
// node tools/export-ground-atlas.cjs --source <master PNG> [--output <directory>] [--row-bounds 0,...,height] [--column-bounds 0,...,width] [--inset sourcePixels]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const sourceArg = option('--source') || (args[0] && !args[0].startsWith('--') ? args[0] : null);
if (!sourceArg) throw new Error('Supply --source <master PNG>; the enlarged generation master is archived outside the repository.');
const source = path.resolve(sourceArg);
const output = path.resolve(option('--output') || (args[1] && !args[0].startsWith('--') ? args[1] : null) || path.join(root, 'assets/ground'));
const parseBounds = name => option(name) ? option(name).split(',').map(Number) : null;
const rowBounds = parseBounds('--row-bounds'), columnBounds = parseBounds('--column-bounds');
const inset = Number(option('--inset') || 0);
const celShaded = args.includes('--cel-shaded');
const fullBleedMaterials = (option('--full-bleed-materials') || '').split(',').filter(Boolean).map(Number);
if (fullBleedMaterials.some(type => !Number.isInteger(type) || type < 0 || type > 31)) throw new Error('Full-bleed material IDs must be 0..31');
const sourceMaterials = Object.fromEntries((option('--source-materials') || '').split(',').filter(Boolean).map(pair => pair.split(':').map(Number)));
if (Object.entries(sourceMaterials).some(([type, source]) => !Number.isInteger(Number(type)) || !Number.isInteger(source) || Number(type) < 0 || Number(type) > 31 || source < 0 || source > 31)) throw new Error('Source material remaps must use IDs 0..31');
if (!Number.isInteger(inset) || inset < 0) throw new Error('Inset must be a nonnegative integer');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
const colors = vm.runInNewContext('(' + app.match(/const COLORS = (\{[\s\S]*?\n\});/)[1] + ')');
(async () => {
  const bytes = fs.readFileSync(source);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ path: path.join(root, 'src/ground_atlas.js') });
    const result = await page.evaluate(async ({ uri, colors, rowBounds, columnBounds, inset, celShaded, sourceMaterials, fullBleedMaterials }) => {
      const image = new Image(); image.src = uri; await image.decode();
      const size = 32, columns = 12, rowsCount = 8, variants = 3, crops = [];
      const bounds = (input, extent, count) => {
        const values = input || Array.from({ length: count + 1 }, (_, n) => Math.round(n * extent / count));
        if (values.length !== count + 1 || values[0] !== 0 || values[count] !== extent || values.some((v, i) => !Number.isInteger(v) || (i && v <= values[i - 1]))) throw new Error('Crop bounds must contain count + 1 increasing pixel positions from zero to the source extent');
        return values;
      };
      const rows = bounds(rowBounds, image.height, rowsCount), cols = bounds(columnBounds, image.width, columns);
      const make = (width, height = width) => { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; };
      const scratch = make(size), sample = scratch.getContext('2d', { willReadFrequently: true });
      sample.imageSmoothingEnabled = false;
      const opaque = make(size * columns, size * rowsCount), detail = make(size * columns, size * rowsCount);
      const oc = opaque.getContext('2d'), dc = detail.getContext('2d');
      for (let type = 0; type < 32; type++) {
        const residuals = [];
        for (let variant = 0; variant < variants; variant++) {
          const frame = type * variants + variant, sourceFrame = (sourceMaterials[type] ?? type) * variants + variant, column = sourceFrame % columns, row = Math.floor(sourceFrame / columns);
          const cropInset = fullBleedMaterials.includes(type) ? 0 : inset;
          const x = cols[column] + cropInset, y = rows[row] + cropInset;
          const width = cols[column + 1] - cropInset - x, height = rows[row + 1] - cropInset - y;
          if (width <= 0 || height <= 0) throw new Error('Inset must leave a positive source crop');
          crops.push({ frame, type, variant, sourceFrame, x, y, width, height });
          sample.clearRect(0, 0, size, size);
          sample.drawImage(image, x, y, width, height, 0, 0, size, size);
          residuals.push(GroundAtlas.residual(sample.getImageData(0, 0, size, size).data, size));
        }
        const boundary = GroundAtlas.periodic(residuals[0], size);
        for (let variant = 0; variant < variants; variant++) {
          const frame = type * variants + variant, x = (frame % columns) * size, y = Math.floor(frame / columns) * size;
          const pixels = sample.createImageData(size, size);
          pixels.data.set(GroundAtlas.overlay(boundary, residuals[variant], size, colors[type]));
          if (celShaded) {
            // Snap the prepared detail to four shared tones AFTER edge matching.
            // Fixed RGBA entries retain transparent biome blending without gradients.
            const rgb = [(colors[type] >> 16) & 255, (colors[type] >> 8) & 255, colors[type] & 255];
            // Keep the broad commercial slab face in one tone; reserve highlights for its bevel.
            const levels = type === 26 ? [-25, 0, 35, 90] : type === 16 ? [-12, 0, 16, 28] : [-12, 0, 8, 16];
            const outputLevels = [-10, 0, 6, 10];
            let tones = outputLevels.map(level => {
              const residual = new Float32Array(size * size * 3).fill(level);
              return GroundAtlas.overlay(residual, residual, size, colors[type]).slice(0, 4);
            });
            if (type === 26) {
              // Molten lava needs warm chromatic highlights, not grey relief.
              tones = [[155,44,18],[207,61,16],[255,117,22],[255,207,72]].map(target => {
                const alpha = Math.ceil(Math.max(...target.map((value,c) => Math.abs(value-rgb[c]) / Math.max(1,value < rgb[c] ? rgb[c] : 255-rgb[c]))) * 255) / 255;
                return new Uint8ClampedArray([...target.map((value,c) => rgb[c] + (value-rgb[c])/alpha),alpha*255]);
              });
            }
            for (let i = 0; i < pixels.data.length; i += 4) {
              const alpha = pixels.data[i + 3] / 255;
              let delta = (.2126 * (pixels.data[i] - rgb[0]) + .7152 * (pixels.data[i + 1] - rgb[1]) + .0722 * (pixels.data[i + 2] - rgb[2])) * alpha;
              if (type === 26) {
                // Preserve the source's full hot/cool range before residual clamping:
                // gold belongs to the hottest cores, not every orange channel.
                const index = i / 4, px = index % size, py = Math.floor(index / size);
                const weight = Math.min(1, Math.min(px, py, size-1-px, size-1-py) / 4);
                delta = [.2126,.7152,.0722].reduce((sum,luma,c) => sum + luma * (boundary[index*3+c]*(1-weight) + residuals[variant][index*3+c]*weight),0);
              }
              let nearest = 0;
              for (let tone = 1; tone < levels.length; tone++) if (Math.abs(delta - levels[tone]) < Math.abs(delta - levels[nearest])) nearest = tone;
              pixels.data.set(tones[nearest], i);
            }
          }
          // Keep terrain IDs stable while retiring unused road/path artwork.
          if ([7, 8, 13, 14].includes(type)) pixels.data.fill(0);
          dc.putImageData(pixels, x, y);
          sample.putImageData(pixels, 0, 0);
          oc.fillStyle = '#' + colors[type].toString(16).padStart(6, '0');
          oc.fillRect(x, y, size, size); oc.drawImage(scratch, x, y);
        }
      }
      return { opaque: opaque.toDataURL(), detail: detail.toDataURL(), sourceWidth: image.width, sourceHeight: image.height, rowBounds: rows, columnBounds: cols, crops };
    }, { uri: 'data:image/png;base64,' + bytes.toString('base64'), colors, rowBounds, columnBounds, inset, celShaded, sourceMaterials, fullBleedMaterials });
    fs.mkdirSync(output, { recursive: true });
    const hashes = {};
    for (const [key, name] of [['opaque', 'terrain-atlas-32.png'], ['detail', 'terrain-detail-32.png']]) {
      const png = Buffer.from(result[key].split(',')[1], 'base64');
      fs.writeFileSync(path.join(output, name), png);
      hashes[name] = crypto.createHash('sha256').update(png).digest('hex');
    }
    const metadata = {
      source: path.basename(source), sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      sourceWidth: result.sourceWidth, sourceHeight: result.sourceHeight,
      rowBounds: result.rowBounds, columnBounds: result.columnBounds, inset, sourceMaterials, fullBleedMaterials,
      width: 384, height: 256, tileSize: 32, columns: 12, rows: 8, materials: 32, variants: 3,
      preparation: 'Nearest-neighbour source directly to 32px; shared residual, periodic and overlay helpers; four-pixel shared boundary band; no 24px intermediate.',
      palette: Object.fromEntries(Array.from({ length: 32 }, (_, t) => [t, '#' + colors[t].toString(16).padStart(6, '0')])),
      style: celShaded ? 'Four-tone cel-shaded pixel art; palette snapping after edge matching' : 'Continuous residual shading',
      maxColorsPerMaterial: celShaded ? 4 : null,
      omittedMaterials: [7, 8, 13, 14],
      lavaPalette: ['#9b2c12', '#cf3d10', '#ff7516', '#ffcf48'],
      shadeOffsets: celShaded ? [-10, 0, 6, 10] : null,
      hashes, crops: result.crops,
    };
    fs.writeFileSync(path.join(output, 'terrain-atlas-32.json'), JSON.stringify(metadata, null, 2) + '\n');
    console.log(JSON.stringify({ output, ...hashes, sourceWidth: result.sourceWidth, sourceHeight: result.sourceHeight }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
