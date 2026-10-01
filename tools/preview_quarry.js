#!/usr/bin/env node
// Export a real parking-lane rasterization and zone-dressing fixture. The
// dashed source lines are an audit aid only; runtime roads stay removed.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..'), ctx = { console, performance, addEventListener() {} };
ctx.window = ctx;
vm.createContext(ctx);
for (const name of ['enemy_roster', 'sprite_layout', 'util', 'zone_variant_data', 'zone_variants', 'streets', 'street_variants', 'biome_profiles', 'items', 'interactables', 'zones', 'zone_coverage', 'quarry_layout', 'zone_dressing', 'worldgen', 'scenic', 'road_overlay']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
}
// Select a runtime row for comparison while retaining the real generator,
// occupancy checks, terrain paint, finite finds and guard placement.
const variantId = process.argv[2] || 'quarry-strip-mine';
const variant = ctx.ZoneVariants.byId(variantId);
if (!variant || variant.zone !== 'quarry' || variant.selectable === false) throw new Error(`Unknown quarry preview: ${variantId}`);
const pick = ctx.ZoneVariants.pick;
ctx.ZoneVariants.pick = anchor => anchor.kind === 'quarry' ? variant : pick(anchor);
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
if ((tile.streetIndex?.lines || []).length) throw new Error('Removed parking lanes survived as roads');
const position = o => [Math.floor((o.x-tx*tileEdgeM)/WG.CELL_M)-origin,
  Math.floor((o.y-ty*tileEdgeM)/WG.CELL_M)-origin];
const material = o => o.quarryCrate ? 'tool_crate' : o.quarryEquipment ? 'equipment'
  : o.kind === 'goblin' ? 'goblin' : o.kind === 'wildplant' ? o.crop
  : o.kind === 'lava_vent' ? 'lava' : o.deposit === 'crystal' ? 'crystal'
  : o.kind === 'mineralrock' && o.yieldTier === 6 ? 'crimson_ore'
  : o.kind === 'mineralrock' ? 'stone' : null;
const dress = tile.zoneDress || {};
const records = [...(dress.objects || []), ...(dress.wildplants || []), ...(dress.guards || [])]
  .filter(o => o.zoneVariant === variantId);
const objects = records.filter(o => o.kind !== 'lava_vent').map(o => {
  const m = material(o);
  if (!m) throw new Error(`Unmapped runtime quarry object: ${o.kind}`);
  return { ...o, cell: position(o), material: m };
});
for (const o of dress.treasures || []) if (o.zoneVariant === variantId) {
  objects.push({ ...o, cell: position(o), material: 'treasure_x' });
}
const terrain = coverage.filter(([x,y]) => tile.grid[(origin+y)*N+origin+x] === WG.T.CAVE_LAVA)
  .map(cell => ({cell,kind:'lava'}));
const diagnostics = (dress.diagnostics || []).filter(row => row.variant === variantId);
const landmarks = diagnostics.flatMap(row => row.landmarks || []).map(row => ({...row,
  bounds: row.bounds?.map((n,i) => n-origin),
  centre: row.centre?.map(n => n-origin),
  doors: row.doors?.map(p => p.map(n => n-origin)),
}));
const covered = new Set(coverage.map(c => c.join(',')));
for (const object of objects) if (!covered.has(object.cell.join(','))) throw new Error('Object outside quarry coverage');
if (new Set(objects.map(o => o.cell.join(','))).size !== objects.length) throw new Error('Overlapping quarry objects');
process.stdout.write(JSON.stringify({ side, variantId, bufferM: ctx.ZoneCoverage.QUARRY_BUFFER_M, coverage,
  sourceLines:source.map(line=>line.map(([x,y])=>[x+.5,y+.5])), objects, terrain, landmarks, diagnostics }));
