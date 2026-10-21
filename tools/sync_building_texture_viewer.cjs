// Refresh the existing local authored-building viewer with reviewed textures.
// Its experimental City models remain available alongside the shipping models.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(os.homedir(), '.artifacts/ra-village-house'));
const htmlPath = path.join(out, 'index.html');
if (!fs.existsSync(htmlPath)) throw Error('Expected the existing ra-village-house viewer at ' + out);
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const copy = (from, name = path.basename(from)) => fs.copyFileSync(path.join(root, from), path.join(out, name));
const manifest = JSON.parse(read('assets/Objects/PPBuildings/manifest.json'));
// Keep the original source filenames: the viewer and its UV tables use them.
for (const name of ['com_houses_05', 'wizard', 'steam-home', 'steam-wizard',
  'city-storefront', 'city-gearhouse', 'city-factory', 'city-clock', 'city-chimney']) {
  copy('assets/Objects/PPBuildings/' + name + '.png');
}
const scope = { globalThis: {} };
vm.runInNewContext(read('src/authored-buildings/flat-buildings.js'), scope);
const flats = Object.entries(scope.globalThis.FlatBuildings.specs).filter(([, spec]) => spec.ppFlat);
if (!flats.length) throw Error('No native Pixel Plains flat-roof specs found');
copy('src/authored-buildings/flat-buildings.js');
for (const [, spec] of flats) copy('assets/Objects/AuthoredBuildings/' + spec.image);
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(/<option value="pp_flat_[^"]*"[^>]*>[^<]*<\/option>/g, '');
html = html.replace('<option value="flat_adobe">', flats.map(([key, spec]) =>
  `<option value="${key}">${spec.label}</option>`).join('') + '<option value="flat_adobe">');
// A new revision in asset URLs prevents the browser retaining the previous PNGs.
const revision = require('node:crypto').createHash('sha256')
  .update(JSON.stringify(manifest)).update(read('src/authored-buildings/flat-buildings.js')).digest('hex').slice(0, 12);
let trials = fs.readFileSync(path.join(out, 'trials.js'), 'utf8');
trials = trials.replace(/a\.image(?:\+'\?review=[a-f0-9]+')?/g, `a.image+'?review=${revision}'`);
html = html.replace(/src="([^"?]+\.js)(?:\?review=[a-f0-9]+)?"/g, `src="$1?review=${revision}"`);
fs.writeFileSync(path.join(out, 'trials.js'), trials);
fs.writeFileSync(htmlPath, html);
console.log(`Updated 9 textures and ${flats.length} native PP flat-roof choices in ${out}`);
