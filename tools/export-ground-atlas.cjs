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
if (!Number.isInteger(inset) || inset < 0) throw new Error('Inset must be a nonnegative integer');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
const colors = vm.runInNewContext('(' + app.match(/const COLORS = (\{[\s\S]*?\n\});/)[1] + ')');
(async () => {
  const bytes = fs.readFileSync(source);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ path: path.join(root, 'src/ground_atlas.js') });
    const result = await page.evaluate(async ({ uri, colors, rowBounds, columnBounds, inset }) => {
      const image = new Image(); image.src = uri; await image.decode();
      const size = 32, columns = 8, crops = [];
      const bounds = (input, extent) => {
        const values = input || Array.from({ length: 9 }, (_, n) => Math.round(n * extent / columns));
        if (values.length !== 9 || values[0] !== 0 || values[8] !== extent || values.some((v, i) => !Number.isInteger(v) || (i && v <= values[i - 1]))) throw new Error('Crop bounds must contain nine increasing pixel positions from zero to the source extent');
        return values;
      };
      const rows = bounds(rowBounds, image.height), cols = bounds(columnBounds, image.width);
      const make = n => { const c = document.createElement('canvas'); c.width = c.height = n; return c; };
      const scratch = make(size), sample = scratch.getContext('2d', { willReadFrequently: true });
      sample.imageSmoothingEnabled = false;
      const opaque = make(size * columns), detail = make(size * columns);
      const oc = opaque.getContext('2d'), dc = detail.getContext('2d');
      for (let type = 0; type < 32; type++) {
        const residuals = [];
        for (let variant = 0; variant < 2; variant++) {
          const frame = type * 2 + variant, column = frame % columns, row = Math.floor(frame / columns);
          const x = cols[column] + inset, y = rows[row] + inset;
          const width = cols[column + 1] - inset - x, height = rows[row + 1] - inset - y;
          if (width <= 0 || height <= 0) throw new Error('Inset must leave a positive source crop');
          crops.push({ frame, type, variant, x, y, width, height });
          sample.clearRect(0, 0, size, size);
          sample.drawImage(image, x, y, width, height, 0, 0, size, size);
          residuals.push(GroundAtlas.residual(sample.getImageData(0, 0, size, size).data, size));
        }
        const boundary = GroundAtlas.periodic(residuals[0], size);
        for (let variant = 0; variant < 2; variant++) {
          const frame = type * 2 + variant, x = (frame % columns) * size, y = Math.floor(frame / columns) * size;
          const pixels = sample.createImageData(size, size);
          pixels.data.set(GroundAtlas.overlay(boundary, residuals[variant], size, colors[type]));
          dc.putImageData(pixels, x, y);
          sample.putImageData(pixels, 0, 0);
          oc.fillStyle = '#' + colors[type].toString(16).padStart(6, '0');
          oc.fillRect(x, y, size, size); oc.drawImage(scratch, x, y);
        }
      }
      return { opaque: opaque.toDataURL(), detail: detail.toDataURL(), sourceWidth: image.width, sourceHeight: image.height, rowBounds: rows, columnBounds: cols, crops };
    }, { uri: 'data:image/png;base64,' + bytes.toString('base64'), colors, rowBounds, columnBounds, inset });
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
      rowBounds: result.rowBounds, columnBounds: result.columnBounds, inset,
      width: 256, height: 256, tileSize: 32, columns: 8, rows: 8, materials: 32, variants: 2,
      preparation: 'Nearest-neighbour source directly to 32px; shared residual, periodic and overlay helpers; four-pixel shared boundary band; no 24px intermediate.',
      palette: Object.fromEntries(Array.from({ length: 32 }, (_, t) => [t, '#' + colors[t].toString(16).padStart(6, '0')])),
      hashes, crops: result.crops,
    };
    fs.writeFileSync(path.join(output, 'terrain-atlas-32.json'), JSON.stringify(metadata, null, 2) + '\n');
    console.log(JSON.stringify({ output, ...hashes, sourceWidth: result.sourceWidth, sourceHeight: result.sourceHeight }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
