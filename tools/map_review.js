#!/usr/bin/env node
// MAP REVIEW: what the world generator places, on a real map, zoomable.
//
// Runs the game's REAL tile generator headlessly (the same module bundle
// test/node/run.js loads) over a block of tiles and writes one self-contained
// Leaflet page: every object, wild plant and roadside trap as a marker over a
// street or satellite basemap, with a toggle per kind, a popup per marker, and
// two overlays painted from the rasterized grid — the ROAD MASK (where nothing
// may spawn) and the TERRAIN codes. The world is a pure function of where it
// is (CLAUDE.md "The world is GENERATED"), so this IS what a player standing
// there would find — minus the save's own changes.
//
//   node tools/map_review.js                         # the nine recorded fixture tiles
//   node tools/map_review.js --lat 49.28 --lon -123.12 [--radius 1]
//                                                    # fetched from OpenFreeMap
//   node tools/map_review.js --out data/my_review.html
//
// Covered: what rasterizeTile lays (trees, rocks, buildings, chests / POIs,
// wild plants) and the surface traps (Traps.spawnSurface). NOT covered yet:
// the rest of app-side spawnInTile — buried X marks, the treasure scatter,
// fauna, fruit trees and the starting area — which needs a scene to run.

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const OUT = path.resolve(ROOT, arg('out', 'data/map_review.html'));

// ── The game, headless ──────────────────────────────────────────────────────
// Module list and load order are read out of test/node/run.js, so this tool
// loads exactly the bundle the test suite does and can't drift from it.
function loadGame() {
  const ctx = {};
  ctx.window = ctx; ctx.self = ctx; ctx.console = console;
  for (const k of ['Math', 'Date', 'JSON', 'Object', 'Array', 'Number', 'String', 'Boolean',
    'RegExp', 'Set', 'Map', 'WeakMap', 'Symbol', 'Error', 'Infinity', 'NaN', 'isNaN', 'parseInt',
    'parseFloat', 'TextDecoder', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array',
    'Int32Array', 'Float32Array', 'Float64Array', 'Promise']) ctx[k] = globalThis[k];
  ctx.setTimeout = () => 0; ctx.clearTimeout = () => {};
  ctx.performance = { now: () => Date.now() };
  ctx.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  ctx.document = { visibilityState: 'visible', addEventListener() {} };
  ctx.addEventListener = () => {};
  ctx.btoa = (s) => Buffer.from(s, 'latin1').toString('base64');
  ctx.atob = (s) => Buffer.from(s, 'base64').toString('latin1');
  vm.createContext(ctx);
  const runSrc = fs.readFileSync(path.join(ROOT, 'test/node/run.js'), 'utf8');
  const m = runSrc.match(/const FILES = (\[[\s\S]*?\]);/);
  if (!m) throw new Error('could not read the module list out of test/node/run.js');
  const FILES = vm.runInNewContext(m[1]);
  vm.runInContext(FILES.map((f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n;\n'),
    ctx, { filename: 'src-bundle.js' });
  return ctx;
}

// ── Tiles ───────────────────────────────────────────────────────────────────
async function tileBytes(W, tx, ty) {
  if (!arg('lat')) {
    const f = path.join(ROOT, 'test/fixtures', `${tx}_${ty}.pbf`);
    return fs.existsSync(f) ? new Uint8Array(fs.readFileSync(f)) : null;
  }
  if (!tileBytes.template) {
    const tj = await (await fetch(W.TILEJSON_URL)).json();
    tileBytes.template = tj.tiles[0];
  }
  const url = tileBytes.template.replace('{z}', W.Z).replace('{x}', tx).replace('{y}', ty);
  const res = await fetch(url);
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}

function tileList(W) {
  if (!arg('lat')) {
    return fs.readdirSync(path.join(ROOT, 'test/fixtures')).filter((f) => /^\d+_\d+\.pbf$/.test(f))
      .map((f) => f.replace('.pbf', '').split('_').map(Number));
  }
  const lat = +arg('lat'), lon = +arg('lon'), r = +arg('radius', 1);
  const n = 1 << W.Z;
  const cx = Math.floor((lon + 180) / 360 * n);
  const cy = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const out = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.push([cx + dx, cy + dy]);
  return out;
}

// World metres (tile × tileEdgeM + offset, what the generator hands back) →
// lat/lon, through the tile's own edge.
function toLatLon(W, x, y, edge) {
  const n = 1 << W.Z;
  const u = x / edge / n, v = y / edge / n;
  const lon = u * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180 / Math.PI;
  return [+lat.toFixed(7), +lon.toFixed(7)];
}

// A tiny RGBA PNG writer (zlib is built in), for the per-tile overlays.
function pngDataUri(w, h, rgba) {
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}

// A stable colour per terrain code (the review needs them told apart, not the
// game's palette): golden-angle hues.
function codeColour(code) {
  const h = (code * 137.508) % 360, s = 0.55, l = 0.5;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  const ctx = loadGame();
  const W = ctx.WorldGen;
  const Tnames = Object.fromEntries(Object.entries(W.T).map(([k, v]) => [v, k]));
  const points = [];   // [lat, lon, group, label, id]
  const overlays = [];
  const usedCodes = new Set();
  for (const [tx, ty] of tileList(W)) {
    const bytes = await tileBytes(W, tx, ty);
    if (!bytes) { console.log(`skip ${tx}/${ty} (no tile)`); continue; }
    const layers = ctx.MVT.decodeTile(bytes);
    const cpe = W.cellsPerEdgeForTile(ty);
    const edge = W.tileEdgeMeters(W.latOfRowCentre(ty));
    const r = W.rasterizeTile(layers, cpe, tx, ty, edge);
    const traps = ctx.Traps.spawnSurface(r.grid, r.roadMask, cpe, cpe, tx, ty, edge, { roadMask: r.roadMask }, 1);
    for (const o of r.objects) {
      const sub = o.species || o.poiClass || (o.tier != null ? 'T' + o.tier : '') || '';
      const label = [o.kind, sub, o.name].filter(Boolean).join(' · ');
      points.push([...toLatLon(W, o.x, o.y, edge), o.kind, label, o.id || '']);
    }
    for (const w of r.wildplants) {
      points.push([...toLatLon(W, w.x, w.y, edge), 'plant:' + (w.crop || w.kind), w.crop || w.kind, w.id || '']);
    }
    for (const t of traps) points.push([...toLatLon(W, t.x, t.y, edge), 'trap', 'roadside trap', t.id]);
    // Overlays: the road mask, and the terrain codes, one pixel per cell.
    const mask = new Uint8Array(cpe * cpe * 4), terr = new Uint8Array(cpe * cpe * 4);
    for (let i = 0; i < cpe * cpe; i++) {
      if (r.roadMask && r.roadMask[i]) { mask[i * 4] = 255; mask[i * 4 + 1] = 40; mask[i * 4 + 2] = 200; mask[i * 4 + 3] = 150; }
      const code = r.grid[i]; usedCodes.add(code);
      const [cr, cg, cb] = codeColour(code);
      terr[i * 4] = cr; terr[i * 4 + 1] = cg; terr[i * 4 + 2] = cb; terr[i * 4 + 3] = 170;
    }
    const n = 1 << W.Z;
    const lonW = tx / n * 360 - 180, lonE = (tx + 1) / n * 360 - 180;
    const latOf = (yt) => Math.atan(Math.sinh(Math.PI * (1 - 2 * yt / n))) * 180 / Math.PI;
    overlays.push({ bounds: [[latOf(ty + 1), lonW], [latOf(ty), lonE]],
      mask: pngDataUri(cpe, cpe, mask), terrain: pngDataUri(cpe, cpe, terr), key: `${tx}/${ty}` });
    console.log(`tile ${tx}/${ty}: ${r.objects.length} objects, ${r.wildplants.length} plants, ${traps.length} traps`);
  }
  const legend = [...usedCodes].sort((a, b) => a - b)
    .map((c) => [Tnames[c] || String(c), 'rgb(' + codeColour(c).join(',') + ')']);
  const centre = points.length ? points[Math.floor(points.length / 2)] : [0, 0];
  const title = arg('lat') ? `map review — ${arg('lat')}, ${arg('lon')}` : 'map review — fixture tiles';
  const html = PAGE
    .split('__TITLE__').join(title)
    .replace('__DATA__', () => JSON.stringify({ points, overlays, legend, centre: [centre[0], centre[1]] }));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  console.log(`${path.relative(ROOT, OUT)}: ${points.length} markers, ${overlays.length} tiles, ${Math.round(html.length / 1024)} KB`);
})().catch((e) => { console.error(e); process.exit(1); });

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>__TITLE__</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html,body{margin:0;height:100%;font:13px system-ui,sans-serif}
  #map{position:absolute;inset:0 280px 0 0}
  #side{position:absolute;top:0;right:0;bottom:0;width:280px;overflow:auto;padding:10px;box-sizing:border-box;background:#1b1b1b;color:#ddd}
  #side h3{margin:12px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#aaa}
  #side label{display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer}
  .sw{display:inline-block;width:11px;height:11px;border-radius:50%;flex:none}
  .sq{border-radius:2px}
  .n{margin-left:auto;color:#888;font-variant-numeric:tabular-nums}
  .leaflet-image-layer{image-rendering:pixelated}
  button{margin:2px 4px 2px 0;background:#333;color:#ddd;border:1px solid #555;border-radius:4px;padding:3px 8px;cursor:pointer}
</style></head><body>
<div id="map"></div>
<div id="side">
  <div><b>__TITLE__</b></div>
  <h3>Base map</h3><div id="bases"></div>
  <h3>Overlays</h3><div id="ovl"></div>
  <h3>Placed things</h3>
  <div><button id="all">all</button><button id="none">none</button></div>
  <div id="kinds"></div>
  <h3>Terrain legend</h3><div id="legend"></div>
</div>
<script>
const D = __DATA__;
const map = L.map('map', { preferCanvas: true, maxZoom: 21 }).setView(D.centre, 16);
const bases = {
  'Streets (OSM)': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 21, attribution: '© OpenStreetMap' }),
  'Satellite (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 21, attribution: 'Esri' }),
};
bases['Streets (OSM)'].addTo(map);
const mkRadio = (host, name, label, checked, on) => {
  const l = document.createElement('label');
  l.innerHTML = '<input type="radio" name="' + name + '"' + (checked ? ' checked' : '') + '> ' + label;
  l.querySelector('input').onchange = on; host.appendChild(l);
};
Object.keys(bases).forEach((k, i) => mkRadio(document.getElementById('bases'), 'base', k, i === 0, () => {
  Object.values(bases).forEach((b) => map.removeLayer(b)); bases[k].addTo(map).bringToBack();
}));
const mkCheck = (host, html, checked, on) => {
  const l = document.createElement('label');
  l.innerHTML = '<input type="checkbox"' + (checked ? ' checked' : '') + '> ' + html;
  const cb = l.querySelector('input'); cb.onchange = () => on(cb.checked); host.appendChild(l); return cb;
};
const ovlGroups = { 'Road mask (no spawns)': L.layerGroup(), 'Terrain codes': L.layerGroup() };
for (const o of D.overlays) {
  L.imageOverlay(o.mask, o.bounds, { opacity: 0.8 }).addTo(ovlGroups['Road mask (no spawns)']);
  L.imageOverlay(o.terrain, o.bounds, { opacity: 0.6 }).addTo(ovlGroups['Terrain codes']);
  L.rectangle(o.bounds, { color: '#fff', weight: 1, fill: false, dashArray: '4 4' }).bindTooltip('tile ' + o.key).addTo(map);
}
for (const [k, g] of Object.entries(ovlGroups)) mkCheck(document.getElementById('ovl'), k, false, (on) => on ? g.addTo(map) : map.removeLayer(g));
// Kinds: one colour each, golden-angle hues so neighbours differ.
const groups = {};
D.points.forEach((p) => { (groups[p[2]] = groups[p[2]] || []).push(p); });
const kinds = Object.keys(groups).sort();
// The main kinds get fixed, far-apart colours; wild plants and anything new
// fall back to golden-angle hues.
const FIXED = { tree: '#1f9d3a', fruittree: '#9be15d', house: '#8a6a4a', tower: '#6f7fa8',
  chest: '#ff3b3b', mineralrock: '#c9c9c9', trap: '#ff2bd6' };
const colourOf = (i) => FIXED[kinds[i]] || 'hsl(' + Math.round(i * 137.508 % 360) + ',80%,55%)';
const layers = {}, boxes = {};
kinds.forEach((k, i) => {
  const c = colourOf(i), lg = L.layerGroup();
  for (const [lat, lon, , label, id] of groups[k]) {
    L.circleMarker([lat, lon], { radius: k.startsWith('plant:') ? 3 : 5, color: '#000', weight: 1, fillColor: c, fillOpacity: 0.9 })
      .bindPopup('<b>' + label + '</b><br><code>' + id + '</code><br>' + lat.toFixed(6) + ', ' + lon.toFixed(6))
      .addTo(lg);
  }
  layers[k] = lg;
  const on = !k.startsWith('plant:');
  if (on) lg.addTo(map);
  boxes[k] = mkCheck(document.getElementById('kinds'), '<span class="sw" style="background:' + c + '"></span>' + k + '<span class="n">' + groups[k].length + '</span>', on,
    (v) => v ? lg.addTo(map) : map.removeLayer(lg));
});
const setAll = (v) => kinds.forEach((k) => { boxes[k].checked = v; v ? layers[k].addTo(map) : map.removeLayer(layers[k]); });
document.getElementById('all').onclick = () => setAll(true);
document.getElementById('none').onclick = () => setAll(false);
for (const [name, c] of D.legend) {
  const d = document.createElement('div');
  d.innerHTML = '<span class="sw sq" style="background:' + c + '"></span> ' + name;
  document.getElementById('legend').appendChild(d);
}
</script></body></html>`;
