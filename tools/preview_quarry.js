#!/usr/bin/env node
// Export a real parking-lane rasterization and zone-dressing fixture. The
// dashed source lines are an audit aid only; runtime roads stay removed.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..'), ctx = { console, performance, addEventListener() {} };
ctx.window = ctx;
vm.createContext(ctx);
for (const name of ['sprite_layout', 'util', 'zone_variant_data', 'zone_variants', 'streets', 'street_variants', 'biome_profiles', 'interactables', 'zones', 'zone_coverage', 'zone_dressing', 'worldgen', 'scenic', 'road_overlay']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
}
// Candidate compositions belong only to this export tool, never shipping data.
const draftId = process.argv[2];
const draftIds = ['quarry-crater', 'quarry-abandoned', 'quarry-strip-mine', 'quarry-stronghold'];
if (draftId && !draftIds.includes(draftId)) throw new Error(`Unknown quarry preview: ${draftId}`);
const WG = ctx.WorldGen, tx = 2622, ty = 5615, extent = 4096;
const N = WG.cellsPerEdgeForTile(ty), tileEdgeM = N * WG.CELL_M;
const side = 37, origin = Math.floor((N - side) / 2);
const cell = (x, y) => ({ x: (origin + x + .5) * extent / N, y: (origin + y + .5) * extent / N });
const source = [[[7,8],[28,8]],[[7,15],[28,15]],[[7,22],[28,22]],[[7,29],[28,29]],[[7,8],[7,29]]];
const layers = [
  { name: 'landuse', extent, features: [{ type: 3, tags: { class: 'residential' },
    geom: [[cell(-1,-1),cell(side,-1),cell(side,side),cell(-1,side),cell(-1,-1)]] }] },
  { name: 'transportation', extent, features: [{ type: 2,
    tags: { class: 'service', service: 'parking_aisle' }, geom: source.map(line => line.map(([x,y]) => cell(x,y))) }] },
];
const tile = WG.rasterizeTile(layers, N, tx, ty, tileEdgeM);
const anchors = tile.zone?.anchors || [], coverage = [];
for (let y=0;y<side;y++) for(let x=0;x<side;x++) {
  const i=(origin+y)*N+origin+x;
  if (anchors[(tile.zone?.coverage?.[i] || 0)-1]?.kind === 'quarry') coverage.push([x,y]);
}
if (!coverage.length) throw new Error('Parking lanes produced no Quarry coverage');
let objects = (tile.zoneDress?.objects || []).filter(o=>o.zoneVariant==='quarry').map(o=>({
  cell:[Math.floor((o.x-tx*tileEdgeM)/WG.CELL_M)-origin,Math.floor((o.y-ty*tileEdgeM)/WG.CELL_M)-origin],
  material:o.deposit==='crystal'?'crystal':'stone',
}));
if (!objects.length) throw new Error('Quarry fixture produced no background rocks');
if ((tile.streetIndex?.lines || []).length) throw new Error('Removed parking lanes survived as roads');
const terrain = [], landmarks = [];
if (draftId) {
  objects = [];
  const covered = new Set(coverage.map(c => c.join(','))), occupied = new Set();
  // Cell-local hash keeps the same fixture stable across exports and additions.
  const noise = (x, y, salt = 0) => {
    let h = Math.imul(x + 173, 374761393) ^ Math.imul(y + 719, 668265263) ^ salt;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const place = (x, y, material) => {
    const key = `${x},${y}`;
    if (!covered.has(key) || occupied.has(key)) return false;
    occupied.add(key);
    objects.push({ cell: [x, y], material });
    return true;
  };
  const requirePlaced = (x, y, material) => {
    if (!place(x, y, material)) throw new Error(`Blocked ${material} candidate at ${x},${y}`);
  };
  if (draftId === 'quarry-crater') {
    // The rim is fractured by the actual parking-footprint gaps. Its centre
    // stays open; small hot vents, rather than a solid lava lake, tell the story.
    for (const [x, y] of coverage) {
      const distance = Math.hypot(x - 17, y - 18);
      if (distance >= 9.1 && distance <= 11.6 && noise(x, y) < .69) place(x, y, 'stone');
      if ([[13, 14], [21, 15], [14, 24], [22, 23]].some(([vx, vy]) =>
        Math.hypot(x - vx, y - vy) <= 1.45 && noise(x, y, 23) < .82)) {
        terrain.push({ cell: [x, y], kind: 'lava' });
      }
    }
    requirePlaced(13, 14, 'crimson_ore');
    requirePlaced(22, 23, 'crimson_ore');
  } else if (draftId === 'quarry-abandoned') {
    for (const [x, y, material] of [
      [10, 10, 'equipment'], [25, 15, 'equipment'], [11, 28, 'equipment'],
      [12, 11, 'tool_crate'], [24, 26, 'tool_crate'],
      [9, 14, 'driftwood'], [22, 9, 'driftwood'], [27, 23, 'driftwood'],
      [13, 26, 'driftwood'], [7, 23, 'driftwood'], [19, 30, 'driftwood'],
    ]) requirePlaced(x, y, material);
    for (const [x, y] of coverage) {
      // An open haul track winds between heaps, abandoned gear and timber.
      const trackX = 17 + Math.round(2 * Math.sin(y / 5));
      if (Math.abs(x - trackX) > 2 && noise(x, y, 71) < .17) place(x, y, 'stone');
    }
  } else if (draftId === 'quarry-strip-mine') {
    // Parallel benches echo the source parking lanes. Empty extraction cuts
    // interrupt each bench; surviving blue seams expose what was taken.
    for (const [x, y] of coverage) {
      if (![8, 9, 15, 16, 22, 23, 29, 30].includes(y) || x < 8 || x > 28) continue;
      if (x === 17 || x === 18 || ((x + 2 * y) % 19 === 0)) continue;
      place(x, y, ((x + y) % 7 === 0 || (y % 7 === 2 && x > 23)) ? 'crystal' : 'stone');
    }
  } else if (draftId === 'quarry-stronghold') {
    for (const [left, top, doorSide] of [[8, 7, 'south'], [21, 7, 'south'], [8, 23, 'north'], [21, 23, 'north']]) {
      const right = left + 7, bottom = top + 7;
      const doorY = doorSide === 'south' ? bottom : top;
      const doors = [[left + 3, doorY], [left + 4, doorY]];
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        if (x !== left && x !== right && y !== top && y !== bottom) continue;
        if (!doors.some(([dx, dy]) => dx === x && dy === y)) requirePlaced(x, y, 'stone');
      }
      landmarks.push({ kind: 'foundation', bounds: [left, top, right, bottom], doors });
    }
    for (const [x, y] of [[10, 10], [26, 10], [11, 27]]) requirePlaced(x, y, 'goblin');
    for (const [x, y] of [[13, 11], [24, 27], [18, 21]]) requirePlaced(x, y, 'treasure_x');
    for (const foundation of landmarks) for (const door of foundation.doors) {
      if (!covered.has(door.join(',')) || occupied.has(door.join(','))) throw new Error('Blocked foundation doorway');
    }
  }
  for (const object of objects) if (!covered.has(object.cell.join(','))) throw new Error('Object outside quarry coverage');
  if (new Set(objects.map(o => o.cell.join(','))).size !== objects.length) throw new Error('Overlapping quarry objects');
  const count = material => objects.filter(o => o.material === material).length;
  if (draftId === 'quarry-crater' && count('crimson_ore') !== 2) throw new Error('Crater requires two crimson ore deposits');
  if (draftId === 'quarry-abandoned' && count('tool_crate') !== 2) throw new Error('Abandoned quarry requires two one-off tool crates');
  if (draftId === 'quarry-stronghold' && (count('goblin') !== 3 || count('treasure_x') !== 3)) throw new Error('Stronghold requires three goblins and three X marks');
}
process.stdout.write(JSON.stringify({ side, bufferM: ctx.ZoneCoverage.QUARRY_BUFFER_M, coverage,
  sourceLines:source.map(line=>line.map(([x,y])=>[x+.5,y+.5])), objects,
  ...(draftId ? { draftId, terrain, landmarks } : {}) }));
