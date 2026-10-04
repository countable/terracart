// Representative surface objects, selected from the shipping rasterizer on small
// public-frontage fixtures. These are examples, never a promised spawn density.
function basicTileExamples(ctx) {
  const WG = ctx.WorldGen, N = 32, extent = 4096, edge = N * WG.CELL_M;
  const point = (x, y) => ({x: x * extent / N, y: y * extent / N});
  // Tags describe input geography; the runtime alone decides what survives.
  const fixtures = {
    GRASS: ['landcover', {class:'grass'}], FOREST: ['landcover', {class:'wood'}],
    SAND: ['landcover', {class:'sand'}], FARMLAND: ['landuse', {class:'farmland'}],
    RESIDENTIAL: ['landuse', {class:'residential'}], PARK: ['landuse', {class:'park'}],
    ROCK: ['landcover', {class:'rock'}], SCHOOL: ['landuse', {class:'school'}],
    COMMERCIAL: ['landuse', {class:'commercial'}], INDUSTRIAL: ['landuse', {class:'industrial'}],
    PLAYGROUND: ['landuse', {class:'playground'}], PITCH: ['landuse', {class:'pitch'}],
    WETLAND: ['landcover', {class:'wetland'}], GOLF: ['landcover', {class:'grass',subclass:'golf_course'}],
    ORCHARD: ['landcover', {class:'farmland',subclass:'orchard'}], WASTELAND: ['landuse', {class:'brownfield'}],
  };
  const result = {};
  // Basic terrain excludes contextual nexus overlays. Keep the real spawn gates.
  const zones = ctx.Zones;
  ctx.Zones = undefined;
  try {
  for (const [name, [layer, tags]] of Object.entries(fixtures)) {
    const seen = new Set(), examples = [];
    let creatureSeats = false;
    for (let tx = 2622; tx < 2626; tx++) {
    const layers = [
      {name:layer,extent,features:[{type:3,tags,geom:[[point(1,1),point(31,1),point(31,31),point(1,31),point(1,1)]]}]},
      ...require('./preview_basic_roads')(ctx,[{type:2,tags:{class:'minor'},geom:[[point(1,2),point(31,2)]]}],tx,5615,extent),
      // The public POI supplies frontage for plaza/industrial spawn gates.
      {name:'poi',extent,features:[{type:1,tags:{class:'library'},geom:[[point(16,3)]]}]},
    ];
    const tile = WG.rasterizeTile(layers, N, tx, 5615, edge);
    for (const o of [...tile.objects, ...tile.wildplants]) {
      if (!['wildplant','tree','fruittree','mineralrock'].includes(o.kind) && !(o.kind === 'chest' && o.barrel)) continue;
      const x = Math.floor((o.x - tx * edge) / WG.CELL_M), y = Math.floor((o.y - 5615 * edge) / WG.CELL_M);
      if (tile.grid[y * N + x] !== WG.T[name]) continue;
      const key = [o.kind,o.barrelStyle,o.crop,o.species,o.kind === 'mineralrock' ? (o.caveVariant != null || (o.yieldTier || 1) <= 1 ? 'plain' : 'ore') : ''].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      examples.push(o);
    }
    creatureSeats ||= tile.grid.some((terrain, i) => terrain === WG.T[name]
      && WG.isSpawnCell(tile.grid, N, N, i % N, Math.floor(i / N),
        {spawnWhy:tile.spawnWhy,roadMask:tile.roadMask}, 'fastFauna'));
    }
    result[name] = {objects:examples, creatureSeats};
  }
  } finally { ctx.Zones = zones; }
  return result;
}
module.exports = basicTileExamples;
