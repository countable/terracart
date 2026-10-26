// Reproduce real production-tier castle inputs from the checked-in Kelowna MVTs.
// node tools/castle-real-inputs.cjs [--out /tmp/real-castles-selected.json] [--all]
// OUT_FILE also sets the output path. Then run tools/castle-real-geometry.cjs;
// its default FIXTURES path matches this tool. --all keeps every tier-12 shape.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
let output = process.env.OUT_FILE || '/tmp/real-castles-selected.json', all = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--all') all = true;
  else if (args[i] === '--out' && args[i + 1] && !args[i + 1].startsWith('--')) output = args[++i];
  else if (args[i] === '--help') {
    console.log('node tools/castle-real-inputs.cjs [--out FILE] [--all]');
    process.exit(0);
  } else throw Error('Unknown or incomplete argument: ' + args[i]);
}

// Reuse the headless runner's production module ordering and browser stubs,
// stopping before test registration. No test callbacks or fixture generators run.
const runnerPath = path.join(ROOT, 'test/node/run.js');
const runner = fs.readFileSync(runnerPath, 'utf8');
const marker = '// Keep loaded mixin methods intact';
if (!runner.includes(marker)) throw Error('Headless runner bootstrap boundary changed');
const filename = path.join(ROOT, 'test/node/_castle_real_inputs.cjs');
const bootstrap = new Module(filename, module);
bootstrap.filename = filename;
bootstrap.paths = Module._nodeModulePaths(path.dirname(filename));
const savedArgs = process.argv;
try {
  process.argv = [process.execPath, filename];
  bootstrap._compile(runner.slice(0, runner.indexOf(marker)) + '\nmodule.exports=ctx;', filename);
} finally { process.argv = savedArgs; }
const { WorldGen, MVT, CastleStyles } = bootstrap.exports;

const selected = [
  ['b_619687_1252631', 'simple skewed Citadel'],
  ['b_619605_1252343', 'very narrow articulated Citadel'],
  ['b_619571_1252239', 'concave Citadel with nearby properties'],
  ['b_619879_1252421', '186-vertex Citadel adjacent to Archive ring'],
  ['b_619765_1252163', 'thin Bastion strip'],
  ['b_619692_1252223', 'simple Bastion footprint'],
  ['b_619711_1252228', '245-vertex Bastion'],
  ['b_619672_1252423', '137-vertex low-fill Bastion'],
  ['b_619675_1252141', 'simple small Archive'],
  ['b_619560_1252126', 'thin Archive strip'],
  ['b_619688_1252448', '282-vertex Archive'],
  ['b_619874_1252421', 'narrow Archive adjacent to Citadel ring'],
];
const frameLat = 49.8801, tileEdgeM = WorldGen.tileEdgeMeters(frameLat);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const area = ring => ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length]; return sum + p.x * q.y - q.x * p.y;
}, 0) / 2;
const report = {
  provenance: 'Production MVT.decodeTile and WorldGen.rasterizeTile over repository Kelowna OpenFreeMap fixtures. Tier 12 is selected by production distribution; no forced tiers or invented rings. MVT feature IDs are not asserted individual OSM way IDs. Production rings preserve float32 tile-local metres; sourceRing preserves decoded integer tile coordinates.',
  frameLat, cellM: WorldGen.CELL_M, tiles: [], castles: [],
};
const fixtureDir = path.join(ROOT, 'test/fixtures');
for (const file of fs.readdirSync(fixtureDir).filter(f => /^275[345]_556[567]\.pbf$/.test(f)).sort()) {
  const [tx, ty] = file.replace('.pbf', '').split('_').map(Number);
  const bytes = fs.readFileSync(path.join(fixtureDir, file));
  const layers = MVT.decodeTile(new Uint8Array(bytes));
  const buildingLayer = layers.find(layer => layer.name === 'building');
  const raws = buildingLayer.features.flatMap(feature => feature.geom.map((ring, ringIndex) =>
    ({ featureId: feature.id, ringIndex, tags: feature.tags, ring })));
  const N = WorldGen.cellsPerEdgeForTile(ty);
  const result = WorldGen.rasterizeTile(layers, N, tx, ty, tileEdgeM);
  const castles = result.buildingShapes.filter(b => b.tier === 12 && !b.templeZone && b.key);
  report.tiles.push({ path: 'test/fixtures/' + file, sha256: hash(bytes), tx, ty, z: 14,
    N, tileEdgeM, castleCount: castles.length });
  for (const building of castles) {
    const ring = Array.from(building.ring), points = [];
    for (let i = 0; i < ring.length; i += 2)
      points.push({ x: ring[i] / tileEdgeM * 4096, y: ring[i + 1] / tileEdgeM * 4096 });
    const raw = raws.find(candidate => candidate.ring.length === points.length
      && candidate.ring.every((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y) < .002));
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + cy / 4096) / 2 ** 14))) * 180 / Math.PI;
    const lon = (tx + cx / 4096) / 2 ** 14 * 360 - 180;
    const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y));
    const maxX = Math.max(...points.map(p => p.x)), maxY = Math.max(...points.map(p => p.y));
    let reflex = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[(i + points.length - 1) % points.length], p = points[i], q = points[(i + 1) % points.length];
      if ((p.x - a.x) * (q.y - p.y) - (p.y - a.y) * (q.x - p.x) < 0) reflex++;
    }
    const nearbyObjects = result.objects.filter(o => Math.hypot(o.x - (tx + cx / 4096) * tileEdgeM,
      o.y - (ty + cy / 4096) * tileEdgeM) < (maxX - minX + maxY - minY) / 4096 * tileEdgeM / 2 + 30)
      .map(o => ({ id: o.id, kind: o.kind, x: o.x, y: o.y, castle: o.castle }));
    report.castles.push({ key: building.key, tx, ty, z: 14, N, tileEdgeM, tier: building.tier,
      areaM2: building.areaM2, family: CastleStyles.renderStyle(building.key, true).id,
      centroid: { lat, lon }, metrics: { vertices: points.length, reflex,
        widthM: (maxX - minX) / 4096 * tileEdgeM, depthM: (maxY - minY) / 4096 * tileEdgeM,
        bboxFill: Math.abs(area(points)) / ((maxX - minX) * (maxY - minY)) },
      tile: 'test/fixtures/' + file, mvtFeatureId: raw?.featureId, ringIndex: raw?.ringIndex,
      tags: raw?.tags, sourceRing: raw?.ring,
      sourceRingSHA256: raw ? hash(JSON.stringify(raw.ring)) : undefined,
      ring, nearbyObjects,
      mappedBoundaryMeaning: 'Source building polygon, not a castle envelope; extrusion must not claim neighbouring ground.',
    });
  }
}
if (!all) report.castles = selected.map(([key, selectionReason]) => {
  const castle = report.castles.find(c => c.key === key);
  if (!castle?.sourceRing || area(castle.sourceRing) <= 0)
    throw Error('Selected castle no longer has its expected positive-area mapped source ring: ' + key);
  return { ...castle, selectionReason };
});
if (report.tiles.length !== 9) throw Error('Expected all nine Kelowna MVT fixture tiles');
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Wrote ${report.castles.length} production-tier castle shapes to ${output}`);
