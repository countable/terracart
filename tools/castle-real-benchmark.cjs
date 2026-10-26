// Native Node CPU/mesh audit; no VM, browser, fixture rasterization or screenshots
// occur inside the timed region. First generate inputs with castle-real-inputs --all.
// FIXTURES=/tmp/complex-castles-all.json SOURCE_DIR=/path/to/repo OUT_FILE=/tmp/castle-benchmark.json REPEATS=3 node tools/castle-real-benchmark.cjs
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(process.env.SOURCE_DIR || path.join(__dirname, '..'));
const fixturePath = process.env.FIXTURES || '/tmp/complex-castles-all.json';
const fixtures = JSON.parse(fs.readFileSync(fixturePath));
if (!(fixtures.cellM > 0)) throw Error('Regenerate inputs with castle-real-inputs.cjs: production cellM is required');
const repeats = Number(process.env.REPEATS || 3);
if (!Number.isInteger(repeats) || repeats < 1) throw Error('REPEATS must be a positive integer');
global.window = globalThis;
const modules = ['polygon_geometry', 'castle_styles', 'wall_perspective', 'fdr_castle_layout', 'fdr_castle_geometry'];
const hashes = Object.fromEntries(modules.map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'src', name + '.js'))).digest('hex')]));
for (const name of modules) require(path.join(root, 'src', name + '.js'));
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
const rows = [];
for (const input of fixtures.castles) {
  const scale = 32 / fixtures.cellM;
  const points = Array.from({ length: input.ring.length / 2 }, (_, i) => ({
    x: (input.ring[i * 2] - input.ring[0]) * scale,
    y: (input.ring[i * 2 + 1] - input.ring[1]) * scale,
  }));
  const cold = [], warm = [], translated = [], fractional = [];
  let model, group, triangles;
  for (let i = 0; i < repeats; i++) {
    // Re-evaluate the module outside timing to clear its closure-owned cache.
    const layoutPath = path.join(root, 'src/fdr_castle_layout.js');
    delete require.cache[require.resolve(layoutPath)]; require(layoutPath);
    const scene = { _headingUp: true, depth: 0, mapRot: 0,
      buildingWallContainer: { add() {} }, add: { graphics: () => ({ clear() {}, fillStyle() {}, fillTriangle() {} }) },
      textures: { exists: () => true, get: () => ({}) } };
    group = WallPerspective.begin(scene, 'castles');
    let start = performance.now();
    model = FDRCastleGeometry.draw(scene, 'castles', points, { family: input.family, active: true });
    cold.push(performance.now() - start);
    triangles = group.blocks.reduce((sum, b) => sum + (b.materialFaces?.length || 0), 0);
    WallPerspective.begin(scene, 'castles');
    start = performance.now();
    FDRCastleGeometry.draw(scene, 'castles', points, { family: input.family, active: true });
    warm.push(performance.now() - start);
    for (const [dx, dy, samples] of [[32, -64, translated], [32.375, -64.125, fractional]]) {
      WallPerspective.begin(scene, 'castles');
      const shifted = points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      start = performance.now();
      FDRCastleGeometry.draw(scene, 'castles', shifted, { family: input.family, active: true });
      samples.push(performance.now() - start);
    }
  }
  rows.push({ key: input.key, family: input.family, vertices: points.length,
    ordinaryCastle: input.key.startsWith('b_'), accepted: !!model,
    coldMs: median(cold), cachedMs: median(warm), translatedMs: median(translated), fractionalTranslatedMs: median(fractional), coldSamplesMs: cold, cachedSamplesMs: warm, translatedSamplesMs: translated, fractionalTranslatedSamplesMs: fractional,
    walls: model?.layout.walls.length || 0, towers: model?.layout.towers.length || 0,
    merlons: model?.layout.merlons.length || 0, blocks: model?.blocksAdded || 0,
    triangles });
}
const accepted = rows.filter(r => r.accepted), sorted = accepted.map(r => r.coldMs).sort((a, b) => a - b);
const report = { node: process.version, platform: process.platform, architecture: process.arch,
  sourceDir: root, fixturePath, cellM: fixtures.cellM, gamePixelsPerMetre: 32 / fixtures.cellM, moduleSHA256: hashes, repeats,
  method: 'Native require of pure production modules, using actual overlay projection scale 32/WorldGen.CELL_M from extractor metadata. Cold includes layout plus mesh emission; cached includes retained-layout cloning plus fresh mesh emission. Translated rebuilds follow warm rebuilds at (32,-64) and (32.375,-64.125) game pixels. Module reload/cache clearing, fixture decoding and browser projection are excluded. CPU measurements are machine-dependent.',
  summary: { total: rows.length, accepted: accepted.length,
    ordinary: rows.filter(r => r.ordinaryCastle).length,
    ordinaryComplex: rows.filter(r => r.ordinaryCastle && r.vertices > 64).length,
    acceptedOrdinaryComplex: rows.filter(r => r.ordinaryCastle && r.vertices > 64 && r.accepted).length,
    coldP50Ms: sorted[Math.floor(sorted.length * .5)], coldP95Ms: sorted[Math.floor(sorted.length * .95)],
    coldMaxMs: Math.max(...sorted), totalColdMs: rows.reduce((s, r) => s + r.coldMs, 0),
    maxTriangles: Math.max(...rows.map(r => r.triangles)) }, rows };
const output = process.env.OUT_FILE || '/tmp/castle-real-benchmark.json';
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary)); console.log(output);
