// Extract authentic adjacent fort/wreck/house pairs from checked-in Kelowna MVTs.
// node tools/building-real-inputs.cjs
// OUT_FILE, CAPTURE_FILE and ALL_FILE override the three /tmp output paths.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'test/node/_building_real_inputs.cjs');
const bootstrap = new Module(filename, module);
bootstrap.filename = filename;
bootstrap.paths = Module._nodeModulePaths(path.dirname(filename));
const runner = fs.readFileSync(path.join(root, 'test/node/run.js'), 'utf8');
const marker = '// Keep loaded mixin methods intact';
if (!runner.includes(marker)) throw Error('Headless bootstrap boundary changed');
bootstrap._compile(runner.slice(0, runner.indexOf(marker)) + '\nmodule.exports=ctx;', filename);
const { WorldGen: W, MVT, PolygonGeometry: G, FDRCastleLayout: F, Houses } = bootstrap.exports;
const frameLat = 49.8801, tileEdgeM = W.tileEdgeMeters(frameLat);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const bounds = p => ({
  left: Math.min(...p.map(p => p.x)), top: Math.min(...p.map(p => p.y)),
  right: Math.max(...p.map(p => p.x)), bottom: Math.max(...p.map(p => p.y)),
});
const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
function distance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, den = dx * dx + dy * dy;
  const t = den ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / den)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const edges = p => p.map((a, i) => [a, p[(i + 1) % p.length]]);
function separation(p, q) {
  let gap = Infinity, shared = 0, intersections = 0;
  for (const [a, b] of edges(p)) for (const [d, e] of edges(q)) {
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    if (ab < 1e-8) continue;
    const ca = cross(a, b, d), cb = cross(a, b, e), cc = cross(d, e, a), cd = cross(d, e, b);
    if (ca * cb < 0 && cc * cd < 0) { gap = 0; intersections++; }
    gap = Math.min(gap, distance(a, d, e), distance(b, d, e), distance(d, a, b), distance(e, a, b));
    if (Math.abs(ca) / ab < 1e-4 && Math.abs(cb) / ab < 1e-4) {
      const ux = (b.x - a.x) / ab, uy = (b.y - a.y) / ab;
      const t0 = (d.x - a.x) * ux + (d.y - a.y) * uy, t1 = (e.x - a.x) * ux + (e.y - a.y) * uy;
      shared += Math.max(0, Math.min(ab, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)));
    }
  }
  return { gapM: gap, sharedBoundaryM: shared, properCrossings: intersections };
}
const candidates = [], tiles = [];
let sequence = 0;
const fixtureDir = path.join(root, 'test/fixtures');
for (const file of fs.readdirSync(fixtureDir).filter(f => /^275[345]_556[567]\.pbf$/.test(f)).sort()) {
  const [tx, ty] = file.replace('.pbf', '').split('_').map(Number);
  const bytes = fs.readFileSync(path.join(fixtureDir, file));
  const layers = MVT.decodeTile(new Uint8Array(bytes)), N = W.cellsPerEdgeForTile(ty), raws = new Map();
  for (const feature of layers.find(l => l.name === 'building').features) {
    feature.geom.forEach((ring, i) => raws.set(JSON.stringify(ring), {
      mvtFeatureId: feature.id, ringIndex: i, sourceRing: ring, tags: feature.tags,
    }));
  }
  const result = W.rasterizeTile(layers, N, tx, ty, tileEdgeM);
  const objects = new Map(result.objects.filter(o => o.kind === 'house').map(o => [o.id, o]));
  const buildings = result.buildingShapes.filter(b => b.key && !b.templeZone && [9, 11, 12].includes(b.tier)).map(b => {
    const ring = Array.from(b.ring), pts = [];
    for (let i = 0; i < ring.length; i += 2) pts.push({ x: ring[i], y: ring[i + 1] });
    if (pts.length > 1 && Math.hypot(pts[0].x - pts.at(-1).x, pts[0].y - pts.at(-1).y) < 1e-5) pts.pop();
    const source = Array.from({ length: ring.length / 2 }, (_, i) => ({
      x: Math.round(ring[2 * i] / tileEdgeM * 4096), y: Math.round(ring[2 * i + 1] / tileEdgeM * 4096),
    }));
    return { ...b, ring, pts, box: bounds(pts), object: objects.get(b.key), ...raws.get(JSON.stringify(source)) };
  });
  // A spatial grid limits exact polygon comparisons to nearby mapped buildings.
  const cells = new Map(), seen = new Set();
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i], box = b.box;
    for (let x = Math.floor((box.left - 3) / 32); x <= Math.floor((box.right + 3) / 32); x++) {
      for (let y = Math.floor((box.top - 3) / 32); y <= Math.floor((box.bottom + 3) / 32); y++) {
        const cellKey = x + ',' + y;
        for (const j of cells.get(cellKey) || []) {
          const a = buildings[j], pairKey = j + ',' + i;
          if (seen.has(pairKey) || a.key === b.key) continue;
          seen.add(pairKey);
          if (!([9, 11].includes(a.tier) && a.object || [9, 11].includes(b.tier) && b.object)) continue;
          const bb = a.box;
          if (bb.right + 3 < box.left || box.right + 3 < bb.left || bb.bottom + 3 < box.top || box.bottom + 3 < bb.top) continue;
          const gap = separation(a.pts, b.pts);
          if (gap.gapM > 3) continue;
          candidates.push({ id: 'pair-' + (++sequence), tx, ty, z: 14, N, tileEdgeM,
            tile: 'test/fixtures/' + file, separation: gap, buildings: [{ ...a }, { ...b }] });
        }
        if (!cells.has(cellKey)) cells.set(cellKey, []);
        cells.get(cellKey).push(i);
      }
    }
  }
  tiles.push({ path: 'test/fixtures/' + file, sha256: hash(bytes), tx, ty, z: 14, N, tileEdgeM, buildingCount: buildings.length });
}
for (const pair of candidates) {
  const [a, b] = pair.buildings;
  let overlap = 0;
  if (pair.separation.properCrossings || a.pts.some(p => G.pointInPolygon(b.pts, p, -1e-6)) || b.pts.some(p => G.pointInPolygon(a.pts, p, -1e-6))) {
    const ta = G.triangulate(a.pts), tb = G.triangulate(b.pts);
    if (!ta.length || !tb.length) throw Error('Cannot triangulate source pair ' + pair.id);
    for (const x of ta) for (const y of tb) overlap += Math.abs(F.area(F.intersect(x, y)));
  }
  pair.separation.sourceOverlapAreaM2 = overlap;
  pair.separation.gapGamePx = pair.separation.gapM * (32 / (tileEdgeM / pair.N));
  // Areas at or below 0.01 m² are retained numerically but treated as touching.
  pair.category = overlap > .01 ? 'source-overlap' : pair.separation.sharedBoundaryM > .01 ? 'shared-boundary'
    : pair.separation.gapM < 1e-4 ? 'touching' : 'separated';
  for (const building of pair.buildings) {
    const p = building.pts, cx = p.reduce((s, q) => s + q.x, 0) / p.length, cy = p.reduce((s, q) => s + q.y, 0) / p.length;
    building.centroid = {
      lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * (pair.ty + cy / tileEdgeM) / 2 ** 14))) * 180 / Math.PI,
      lon: (pair.tx + cx / tileEdgeM) / 2 ** 14 * 360 - 180,
    };
    building.roles = {
      unclaimed: building.object ? Houses.displayRole({}, building.object) : null,
      restored: building.object ? Houses.displayRole({ restoredHouses: { [building.key]: { role: 'plain' } } }, building.object) : null,
    };
    building.metrics = { vertices: p.length, widthM: building.box.right - building.box.left, depthM: building.box.bottom - building.box.top };
    delete building.pts;
    delete building.box;
  }
}
const selected = [], used = new Set();
for (const [role, category, count] of [
  ['fort', 'shared-boundary', 3], ['fort', 'separated', 3], ['wreck', 'shared-boundary', 3],
  ['wreck', 'separated', 3], ['fort', 'source-overlap', 2], ['wreck', 'source-overlap', 2],
]) {
  let left = count;
  const matching = candidates.filter(p => p.category === category && p.buildings.some(b => b.roles.unclaimed === role));
  matching.sort((a, b) => a.separation.gapM - b.separation.gapM || b.separation.sharedBoundaryM - a.separation.sharedBoundaryM);
  for (const pair of matching) {
    if (used.has(pair.id)) continue;
    used.add(pair.id); selected.push(pair);
    if (!--left) break;
  }
}
const report = {
  provenance: 'Production WorldGen rings from nine Kelowna MVT fixtures; no forced tiers or invented geometry. Tier9=house/wreck, tier11=fort, tier10=rock (excluded). MVT feature IDs are not individual OSM way IDs. Ground-ring separation/overlap excludes screen-projected heights. Overlapping mapped buildings may represent multilevel structures; no source repair is implied.',
  frameLat, tiles, totalCandidatePairs: candidates.length,
  categoryCounts: Object.fromEntries(['source-overlap', 'shared-boundary', 'touching', 'separated'].map(k => [k, candidates.filter(c => c.category === k).length])),
  pairs: selected,
};
// These six genuine adjacent pairs cover shared walls and narrow positive gaps.
const captureIds = ['pair-1815', 'pair-1821', 'pair-1810', 'pair-1802', 'pair-191', 'pair-217'];
const captureSeen = new Set(), castles = [];
for (const pair of selected.filter(p => captureIds.includes(p.id))) for (const b of pair.buildings) {
  if (captureSeen.has(b.key) || !b.object) continue;
  captureSeen.add(b.key);
  castles.push({ ...b, tx: pair.tx, ty: pair.ty, N: pair.N, z: pair.z, tileEdgeM, tile: pair.tile,
    family: b.roles.unclaimed, selectionReason: pair.id + ' ' + pair.category,
    sourceRingSHA256: hash(JSON.stringify(b.sourceRing)),
    nearbyObjects: pair.buildings.filter(a => a.key !== b.key).map(a => a.object).filter(Boolean),
    mappedBoundaryMeaning: 'Exact mapped ground ring; pair ' + pair.id });
}
for (const [file, data] of [
  [process.env.OUT_FILE || '/tmp/real-adjacent-buildings.json', report],
  [process.env.ALL_FILE || '/tmp/real-adjacent-buildings-all.json', { ...report, pairs: candidates }],
  [process.env.CAPTURE_FILE || '/tmp/real-adjacent-capture-inputs.json', { ...report, castles }],
]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(file);
}
console.log(JSON.stringify(report.categoryCounts));
