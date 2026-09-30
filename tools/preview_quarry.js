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
const objects = (tile.zoneDress?.objects || []).filter(o=>o.zoneVariant==='quarry').map(o=>({
  cell:[Math.floor((o.x-tx*tileEdgeM)/WG.CELL_M)-origin,Math.floor((o.y-ty*tileEdgeM)/WG.CELL_M)-origin],
  material:o.yieldTier===7?'frost_ore':o.yieldTier===6?'crimson_ore':'stone',
}));
if (!objects.length) throw new Error('Quarry fixture produced no background rocks');
if ((tile.streetIndex?.lines || []).length) throw new Error('Removed parking lanes survived as roads');
process.stdout.write(JSON.stringify({ side, bufferM: ctx.ZoneCoverage.QUARRY_BUFFER_M, coverage,
  sourceLines:source.map(line=>line.map(([x,y])=>[x+.5,y+.5])), objects }));
