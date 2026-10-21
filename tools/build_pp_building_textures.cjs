// Register approved PP reference artwork to the original texture coordinates.
// Run: node tools/build_pp_building_textures.cjs
// Requires playwright-core and local Chromium (CHROMIUM_PATH can override).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'assets/Objects/PPBuildings');
const referenceDir = 'docs/art/pp-building-references';
// Each knot is [original texture coordinate, reference coordinate]. Intermediate
// coordinates interpolate linearly. Roof ridges, eaves, floor bands and sheet
// cell boundaries are registered independently instead of cropping away padding.
const registrations = [
  { name: 'com_houses_05',
    x: [[0, 0], [32, 81], [48, 123], [80, 201], [128, 325], [160, 406], [176, 443], [192, 485], [224, 568], [256, 649], [272, 691], [304, 769], [352, 893], [384, 974], [400, 1011], [416, 1053], [448, 1138]],
    y: [[0, 0], [8, 12], [96, 249], [128, 329], [136, 350], [240, 613], [272, 696], [280, 704], [368, 942], [400, 1023], [408, 1045], [512, 1305], [544, 1382]],
    landmarks: 'Four colored sheet quadrants, ridge tops, upper eaves, accessory rows, lower eaves and garage steps.' },
  { name: 'wizard',
    x: [[0, 0], [40, 193], [80, 395], [120, 589], [160, 790], [200, 985], [240, 1186], [280, 1383], [320, 1555]],
    y: [[0, 0], [3, 5], [62, 318], [136, 668], [144, 690], [172, 831], [176, 850], [204, 988], [208, 1011]],
    landmarks: 'Four tower centers, roof eave, tower base and both detached door/window rows.' },
  { name: 'steam-home',
    x: [[0, 0], [25, 188], [72, 542], [119, 896], [144, 1086]],
    y: [[0, 0], [97, 729], [141, 1063], [153, 1153], [192, 1440]],
    landmarks: 'Main ridge and eave, upper-floor band, porch eave, door and foundation.' },
  { name: 'steam-wizard',
    x: [[0, 0], [19, 205], [35, 382], [52, 560], [72, 768]],
    y: [[0, 0], [2, 10], [25, 310], [62, 670], [100, 1055], [146, 1550], [192, 2048]],
    landmarks: 'Finial, dome spring, dome eave, both floor cornices and base. Original alpha removes generated background glow.' },
  { name: 'city-storefront',
    x: [[0, 12], [8, 43], [76, 495], [96, 625], [116, 755], [184, 1210], [192, 1243]],
    y: [[0, 0], [26, 163], [59, 373], [101, 666], [134, 873], [192, 1225]],
    landmarks: 'Smoke top, parapet top, roof edge, facade band and double-door center.' },
  { name: 'city-gearhouse',
    x: [[0, 0], [8, 60], [40, 378], [55, 509], [88, 827], [96, 887]],
    y: [[0, 0], [9, 70], [72, 643], [110, 1020], [148, 1364], [164, 1518], [192, 1754]],
    landmarks: 'Ridge, gable spring, eave, floor beam, door canopy and foundation.' },
  { name: 'city-factory', viewerOnly: true,
    x: [[0, 0], [42, 267], [88, 568], [134, 870], [192, 1254]],
    y: [[0, 0], [29, 184], [80, 501], [123, 806], [192, 1242]],
    landmarks: 'Three chimney centers, chimney tops, roof back edge, roof front edge and doors.' },
  { name: 'city-clock', viewerOnly: true,
    x: [[0, 0], [21, 191], [48, 443], [74, 693], [96, 887]],
    y: [[0, 0], [66, 582], [98, 906], [135, 1254], [159, 1470], [192, 1774]],
    landmarks: 'Padded roof top, roof eave, balcony, door head and foundation.' },
  { name: 'city-chimney', viewerOnly: true,
    x: [[0, 0], [21, 191], [48, 443], [74, 693], [96, 887]],
    y: [[0, 0], [20, 175], [44, 380], [106, 958], [135, 1254], [159, 1470], [192, 1774]],
    landmarks: 'Smoke top, chimney mouth, roof back edge, roof front edge and door head.' },
];
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const records = [];
  try {
    const page = await browser.newPage();
    for (const registration of registrations) {
      const originalPath = `assets/Objects/AuthoredBuildings/${registration.name}.png`;
      const referencePath = `${referenceDir}/${registration.name}.png`;
      const originalBytes = fs.readFileSync(path.join(root, originalPath));
      const referenceBytes = fs.readFileSync(path.join(root, referencePath));
      const result = await page.evaluate(async ({ originalURI, referenceURI, registration }) => {
        const load = async src => { const image = new Image(); image.src = src; await image.decode(); return image; };
        const [original, reference] = await Promise.all([load(originalURI), load(referenceURI)]);
        const make = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
        const originalCanvas = make(original.width, original.height);
        const originalContext = originalCanvas.getContext('2d'); originalContext.drawImage(original, 0, 0);
        const originalPixels = originalContext.getImageData(0, 0, original.width, original.height);
        const canvas = make(original.width, original.height), ctx = canvas.getContext('2d');
        // Nearest-neighbor reduction keeps hard pixel edges without new gradients.
        ctx.imageSmoothingEnabled = false;
        for (let yi = 1; yi < registration.y.length; yi++) {
          for (let xi = 1; xi < registration.x.length; xi++) {
            const [dx, sx] = registration.x[xi - 1], [dx1, sx1] = registration.x[xi];
            const [dy, sy] = registration.y[yi - 1], [dy1, sy1] = registration.y[yi];
            ctx.drawImage(reference, sx, sy, sx1 - sx, sy1 - sy, dx, dy, dx1 - dx, dy1 - dy);
          }
        }
        const registered = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const output = ctx.createImageData(canvas.width, canvas.height);
        let filledPixels = 0, changedOpaquePixels = 0, maxFillDistance = 0;
        // Small generated silhouette deviations must not create holes in fixed UV
        // faces. Extend the nearest registered reference color, never old artwork.
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4, alpha = originalPixels.data[i + 3];
          if (!alpha) continue;
          let sample = i;
          if (registered.data[i + 3] < 160) {
            let best = Infinity, found = -1;
            for (let radius = 1; radius <= 24 && found < 0; radius++) {
              for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
                if (Math.abs(ox) !== radius && Math.abs(oy) !== radius) continue;
                const nx = x + ox, ny = y + oy;
                if (nx < 0 || nx >= canvas.width || ny < 0 || ny >= canvas.height) continue;
                const ni = (ny * canvas.width + nx) * 4, d = ox * ox + oy * oy;
                if (registered.data[ni + 3] >= 160 && d < best) { best = d; found = ni; }
              }
            }
            if (found < 0) throw new Error(`No registered reference color at ${x},${y}`);
            sample = found; filledPixels++; maxFillDistance = Math.max(maxFillDistance, Math.sqrt(best));
          }
          for (let c = 0; c < 3; c++) output.data[i + c] = registered.data[sample + c];
          output.data[i + 3] = alpha;
          if ([0, 1, 2].some(c => output.data[i + c] !== originalPixels.data[i + c])) changedOpaquePixels++;
        }
        ctx.putImageData(output, 0, 0);
        const png = canvas.toDataURL('image/png');
        // Verify the encoded PNG, not just the intermediate array.
        const decoded = await load(png), check = make(canvas.width, canvas.height);
        check.getContext('2d').drawImage(decoded, 0, 0);
        const checkPixels = check.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let alphaMismatches = 0;
        for (let i = 3; i < checkPixels.length; i += 4) if (checkPixels[i] !== originalPixels.data[i]) alphaMismatches++;
        if (alphaMismatches) throw new Error(`Alpha changed in ${alphaMismatches} pixels`);
        return { png, dimensions: [canvas.width, canvas.height], referenceDimensions: [reference.width, reference.height], filledPixels, maxFillDistance, changedOpaquePixels, alphaMismatches };
      }, { registration, originalURI: 'data:image/png;base64,' + originalBytes.toString('base64'), referenceURI: 'data:image/png;base64,' + referenceBytes.toString('base64') });
      const bytes = Buffer.from(result.png.split(',')[1], 'base64');
      fs.writeFileSync(path.join(outputDir, `${registration.name}.png`), bytes);
      delete result.png;
      records.push({ ...registration, original: originalPath, reference: referencePath, output: `assets/Objects/PPBuildings/${registration.name}.png`, sourceCrop: [registration.x[0][1], registration.y[0][1], registration.x.at(-1)[1] - registration.x[0][1], registration.y.at(-1)[1] - registration.y[0][1]], originalSHA256: hash(originalBytes), referenceSHA256: hash(referenceBytes), outputSHA256: hash(bytes), ...result });
      console.log(`${registration.name}: ${result.dimensions.join('x')}, alpha mismatches ${result.alphaMismatches}, filled edge pixels ${result.filledPixels}, max distance ${result.maxFillDistance.toFixed(1)}`);
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify({
    generator: 'tools/build_pp_building_textures.cjs',
    provenance: 'Existing image_gen PP style-transfer artwork, docs/art/pp-building-references/manifest.json',
    styleReference: 'assets/Objects/AuthoredBuildings/pp-brick-red.png',
    method: 'Piecewise image registration at original resolution; nearest-neighbor Canvas reduction; nearest reference color edge extension; exact original alpha restored and encoded PNG verified.',
    preserved: 'Original dimensions, transparent padding, silhouette, holes, sprite-sheet UV coordinates. No original files are overwritten.',
    exclusions: ['FDR_Blacksmith', 'steam-blacksmith', 'flat-adobe', 'flat-rooftop', 'house_market', 'house_trader', 'dreamland_*', 'pp_*'],
    assets: records,
  }, null, 2) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
