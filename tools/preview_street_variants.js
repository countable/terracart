#!/usr/bin/env node
// JSON geometry for preview_zone_variants.py. Runs shipping road rasterization,
// street dressing and lamp placement on one reproducible, open straight road.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8');
const ctx = { console, performance, addEventListener() {} };
ctx.window = ctx;
vm.createContext(ctx);
for (const name of ['enemy_roster', 'sprite_layout', 'util', 'coords', 'polygon_geometry', 'zone_variant_data', 'terrain', 'zone_variants', 'shrines', 'streets', 'street_variants', 'biome_profiles', 'selected_item_art', 'items', 'macros', 'interactables', 'loot', 'worldgen', 'scenic', 'road_overlay']) {
  vm.runInContext(read(name), ctx, { filename: name + '.js' });
}
// Use the same shared geometry pass as the scene street-lamp renderer.

const WG = ctx.WorldGen, SV = ctx.StreetVariants;
const extent = 4096, tx = 2622, ty = 5615;
const N = WG.cellsPerEdgeForTile(ty);
const cellM = WG.CELL_M, tileEdgeM = N * cellM;
const point = (x, y) => ({ x: (x + 0.5) * extent / N, y: (y + 0.5) * extent / N });
const middle = Math.floor(N / 2);
// Keep the preview 30% shorter than the former 44-cell road, at the same game scale.
const halfLengthCells = 22 * .7;
const line = [point(middle - halfLengthCells, middle), point(middle + halfLengthCells, middle)];
const lengthM = ctx.Streets.lineLengthM(line, tileEdgeM / extent);
const local = (o) => ({ ...o, x: o.x - tx * tileEdgeM, y: o.y - ty * tileEdgeM });

// Export the shipping raster, cropped to the preview viewport. Road surfaces are
// drawn by the pavement painter; park is the fixture's unchanged base ground.
function groundPreview(tile) {
  const cells = [];
  for (let y = Math.max(0, middle - 12); y <= Math.min(N - 1, middle + 12); y++) {
    for (let x = Math.max(0, Math.floor(middle - halfLengthCells - 6)); x <= Math.min(N - 1, Math.ceil(middle + halfLengthCells + 6)); x++) {
      const i = y * N + x;
      let type = tile.grid[i];
      if (type === WG.T.PATH) type = tile.pathUnder[`${x}_${y}`] ?? WG.T.PARK;
      if (type === WG.T.PARK || tile.roadMask[i]) continue;
      cells.push({x: x * cellM, y: y * cellM, type});
    }
  }
  return {baseTerrain: WG.T.PARK, groundCells: cells};
}

function preview(row) {
  if (row.size === 'path') return previewPath(row);
  let name = 'Preview';
  const tags = { class: row.size === 'major' ? 'secondary' : 'minor' };
  const layers = [
    { name: 'landuse', features: [{ type: 3, tags: { class: 'park' },
      geom: [[point(0, 0), point(N - 1, 0), point(N - 1, N - 1), point(0, N - 1)]] }] },
    { name: 'transportation', extent, features: [{ type: 2, tags, geom: [line] }] },
    { name: 'transportation_name', extent, features: [{ type: 2, tags: { name }, geom: [line] }] },
  ];
  // Read the fixture's final geographic context before selecting its name:
  // public park frontage now favours Lantern Row in the runtime affinity pass.
  const contextTile = WG.rasterizeTile(layers, N, tx, ty, tileEdgeM);
  const context = contextTile.streetIndex.lines[0].affinityContext;
  name = null;
  for (let i = 0; i < 10000; i++) {
    const candidate = `Preview ${i}`;
    if (SV.variantFor(SV.streetKey(candidate, tx, ty), candidate, row.size, context) === row.id
        && (row.id !== 'thorny' || SV.streetShrineChosen(SV.streetKey(candidate, tx, ty)))) {
      name = candidate;
      break;
    }
  }
  if (!name) throw new Error(`No preview street for ${row.id}`);
  layers.find(l => l.name === 'transportation_name').features[0].tags.name = name;
  const tile = WG.rasterizeTile(layers, N, tx, ty, tileEdgeM);
  const rec = tile.streetIndex.lines[0];
  if (rec.variant !== row.id) throw new Error(`Preview rolled ${rec.variant}, wanted ${row.id}`);
  // Isolate street dressing from ambient park objects, keeping the actual
  // rasterized terrain, road band and all spawn reasons / kerb buffers.
  const dress = SV.dress({ index: tile.streetIndex, tx, ty, N, tileEdgeM, grid: tile.grid,
    spawnOpts: { roadMask: tile.roadMask, roadClass: tile.roadClass,
      spawnWhy: tile.spawnWhy, occupied: ctx.RoadOverlay.lampReservedCells(tx, ty,
        { ...tile, layers, tileEdgeM, cellsPerEdge: N }), pois: [] } });
  const lamps = ctx.RoadOverlay.lampSitesForTile(tx, ty,
    { ...tile, layers, tileEdgeM, cellsPerEdge: N }).map(local);
  const objects = [...dress.objects, ...dress.wildplants, ...(dress.traps || []).map(t => ({ ...t, kind: 'trap', recordType: 'surface_trap' }))].map(local);
  const lairs = dress.lairs.map((o) => ({ tier: o.tier, kind: o.tier + ' guard site', x: o.lx, y: o.ly }));
  return { ...row, ...groundPreview(tile), words: row.words ? row.words.source : null, sampleName: name,
    roadWidthM: WG.roadOverlayWidthM(tags), lengthM,
    lampSpacingM: SV.lampSpacingFor(row.id), objects, lamps, lairs,
    line: line.map((p) => ({ x: p.x * tileEdgeM / extent, y: p.y * tileEdgeM / extent })),
    slowKinds: [...new Set(objects.filter((o) => SV.isSlowKind(o.kind)).map((o) => o.kind))] };
}

function previewPath(row) {
  // Shorter samples let the gallery show path encounters at twice the scale.
  const line = [point(middle - halfLengthCells / 2, middle), point(middle + halfLengthCells / 2, middle)];
  const lengthM = ctx.Streets.lineLengthM(line, tileEdgeM / extent);
  const SC = ctx.Scenic;
  const kind = Object.keys(SC.KIND_ROW).find(k => SC.KIND_ROW[k] === row.id);
  const name = row.id === 'greenway' ? 'Preview Greenway' : 'Preview Footpath';
  const tags = { class: 'path', subclass: 'footway' };
  const ground = [[point(0, 0), point(N - 1, 0), point(N - 1, N - 1), point(0, N - 1)]];
  const layers = [
    { name: 'landuse', extent, features: [{ type: 3, tags: { class: 'park' }, geom: ground }] },
    { name: 'transportation', extent, features: [{ type: 2, tags, geom: [line] }] },
    { name: 'transportation_name', extent, features: [{ type: 2, tags: { name }, geom: [line] }] },
  ];
  const geography = [];
  if (kind === 'park') layers.push({ name: 'park', extent,
    features: [{ type: 3, tags: { name: 'Preview Park' }, geom: ground }] });
  if (kind === 'shore') {
    const shore = [point(0, middle - 2), point(N - 1, middle - 2), point(N - 1, 0), point(0, 0)];
    layers.push({ name: 'water', extent, features: [{ type: 3, tags: { class: 'lake' }, geom: [shore] }] });
    geography.push({ kind: 'water', points: shore.map(p => ({ x: p.x * tileEdgeM / extent, y: p.y * tileEdgeM / extent })) });
  }
  // Path themes belong to assigned sections, not the named-street hash.
  // Force only the preview's theme draw; keep shipping section construction,
  // scenic overrides, terrain, dressing and lamp placement intact.
  const variantFor = SV.variantFor;
  let tile;
  try {
    if (!kind) SV.variantFor = (key, label, size, context) => size === 'path'
      ? row.id : variantFor(key, label, size, context);
    tile = WG.rasterizeTile(layers, N, tx, ty, tileEdgeM);
  } finally { SV.variantFor = variantFor; }
  const scenic = tile.scenic;
  const entry = { ...tile, layers, tileEdgeM, cellsPerEdge: N };
  const styles = SV.lineStyles(entry, layers[1].features[0], 0, 0, tileEdgeM / extent);
  if (!styles.length || styles.some(style => style.variant !== row.id))
    throw new Error(`Wrong assigned path theme for ${row.id}`);
  if (kind && (!scenic || scenic.census[kind] < lengthM - SC.SAMPLE_M)) throw new Error(`Wrong scenic classification for ${row.id}`);
  const spawnOpts = { roadMask: tile.roadMask, roadClass: tile.roadClass, spawnWhy: tile.spawnWhy,
    occupied: ctx.RoadOverlay.lampReservedCells(tx, ty, entry), pois: [] };
  const scenicDress = SC.dress({ scenic, tx, ty, N, tileEdgeM, grid: tile.grid, chests: [], spawnOpts });
  const streetDress = SV.dress({ index: tile.streetIndex, tx, ty, N, tileEdgeM, grid: tile.grid, spawnOpts });
  const objects = [scenicDress, streetDress].flatMap(dress => [...dress.objects, ...dress.wildplants,
    ...(dress.coins || []), ...(dress.traps || []).map(t => ({ ...t, kind: 'trap', recordType: 'surface_trap' }))]).map(local);
  const lamps = ctx.RoadOverlay.lampSitesForTile(tx, ty,
    { ...tile, layers, tileEdgeM, cellsPerEdge: N }).map(local);
  if (!lamps.length || lamps.some(lamp => lamp.glow !== row.lampGlow)) throw new Error(`Wrong path lamps for ${row.id}`);
  return { ...row, ...groundPreview(tile), sampleName: name, roadWidthM: WG.roadOverlayWidthM(tags), lengthM,
    lampSpacingM: SV.lampSpacingFor(row.id, ctx.Streets.lampLayFor(tags).spacingM), objects,
    lamps, vents: (streetDress.vents || []).map(local), webs: (streetDress.webs || []).map(local), lairs: streetDress.lairs.map(o => ({ tier: o.tier, kind: o.tier + ' guard site', x: o.lx, y: o.ly })),
    slowKinds: [...new Set(objects.filter(o => SV.isSlowKind(o.kind)).map(o => o.kind))], geography, scenicKind: kind,
    selection: !kind ? row.selection : kind === 'shore' ? 'Off-road walking path beside qualifying shore water.' :
      kind === 'greenway' ? 'Off-road walking path with a greenway name or route.' : 'Off-road walking path inside a named or sufficiently large park.',
    rewards: !kind ? row.rewards : `${SC.SCENIC_MUL[kind]}× first-restoration metre credit; one T${SC.VISTA_CHEST_TIER[kind]} one-time vista chest per eligible stretch of at least ${SC.VISTA_STRETCH_MIN_M} m. Daily path-lamp credit is unchanged.`,
    placement: !kind ? row.placement : 'Geography selects the scenic row; real scenic stretch dressing seats vista chests off the path. ' + (kind === 'greenway' ? `Grass along both verges every ${SC.GREENWAY_GRASS_STEP_M} m where ground permits.` : 'No additional themed verge plants.'),
    line: line.map(p => ({ x: p.x * tileEdgeM / extent, y: p.y * tileEdgeM / extent })) };
}

const rows = SV.STREET_VARIANTS.map(preview);
// Use the runtime weighting helper, with no name match, to make soft affinities
// inspectable without changing the generated art fixture or rarity roll.
const affinityContexts = Object.fromEntries(['neutral', 'cultivated', 'woodland', 'damp', 'formal', 'sacred', 'ruined', 'coastal'].map(trait =>
  [trait, Object.fromEntries(['minor', 'major'].map(size =>
    [size, SV.selectionWeights('Preview', size, trait === 'neutral' ? {} : {[trait]: 1})]))]));
const rules = {
  slime_trail: `Glossy slime paving. One seeded species per section, chosen from green, purple, fire or splitting slimes. Two guards at each eligible post every ${SV.VARIANT_BY_ID.slime_trail.enemyStepM} m; short sections use a midpoint post. No daily reset.`,
  spider_path: `Permanent seeded webs on ${SV.VARIANT_BY_ID.spider_path.webDensity * 100}% of eligible cell-spaced samples, with scattered lateral offsets. Webs cause six seconds of paralysis on entry; flying actors are immune. One two-spider garrison per section, where safe ground permits.`,
  golden_path: 'An activation shrine at each safe end shares one daily activation. Coins appear directly on the path centerline, so either direction works without backtracking or a second payout.',

  hedgerow: `Two straight rows of cut hedges, one per ${cellM} m cell, with aligned gate gaps every ${SV.HEDGE_GATE_EVERY_CELLS} cells. Blocked slots stay empty. One encounter anchor holds two ordinary slimes where safe ground permits.`,
  thorny: `Irregular bramble clusters at ${SV.THORNY_CLUSTER_DENSITY * 100}% density cross the road and reach up to ${SV.THORNY_VERGE_MAX_CELLS} cells beyond either edge, stopping at the first obstruction. Selected streets enclose a moss cairn in brambles when the whole ring fits. Brambles burn and cost 1 energy per second while crossed.`,
  overgrown: `One attempt every ${SV.OVERGROWN_STEP_M} m; a sapling-to-mature tree progression, at most ${SV.OVERGROWN_MAX} trees per line piece.`,
  orchard: `One attempt every ${SV.ORCHARD_STEP_M} m, both verges; at most ${SV.ORCHARD_MAX} trees per line piece, alternating half fruit trees (rare Worldpeach among apples) and half mature deciduous maples.`,
  snare: `One T${SV.SNARE_CHEST_TIER} cave-loot chest at the street midpoint, surrounded by up to ${(2 * SV.SNARE_TRAP_RADIUS_CELLS + 1) ** 2 - 1} traps on eligible verge ground. At least ${SV.SNARE_MIN_TRAPS} traps must fit.`,
  golden: `A golden idol holds eligible coin seats along both verges, sampled every ${SV.GOLDEN_STEP_M} m. Visiting it starts the daily coin spree; coins are not permanent street dressing. Road, lamp and occupied cells stay clear.`,
  pilgrim: 'One compact set of 3–6 rounded waystones per street per tile; step on all before their light fades.',
  lantern: `Lamps at ${SV.lampSpacingFor('lantern', ctx.Streets.lampLayFor({class: 'path'}).spacingM)} m target spacing (${SV.LANTERN_SPACING_DIV}× the usual path density); no extra verge props.`,
  burned: `Glowing ember paving damages the player like lava. One attempt every ${SV.BURNED_STEP_M} m; at most ${SV.BURNED_MAX} tar/stakes per line piece. Placed torches punctuate the verges; red lamps have ${SV.lampSpacingFor('burned')} m target spacing. One fire-slime guard site per stretch, seated back from the kerb.`,
  barricade: `Perpendicular lines of stakes and barricades cross the road every ${SV.BARRICADE_STEP_M} m and extend up to ${SV.BARRICADE_VERGE_MAX_CELLS} cells beyond either edge, stopping at obstacles; a target of ${SV.BARRICADE_MAX} pieces per line piece, finishing the last cross-road line. A Trap Kit removes each piece. One encounter anchor and its goblin guard site per street per tile.`,
  toadstool: `One attempt every ${SV.TOADSTOOL_STEP_M} m; at most ${SV.TOADSTOOL_MAX} mushrooms per line piece. Mushrooms only, in three-on/one-gap groups with varying verge setbacks.`,
  trade: `Wooden barrels along both verges, one sample a cell with ${SV.TRADE_BARREL_GAP * 100}% left empty, a cell back from the kerb on the reward gate; a two-grunt post every ${SV.TRADE_GRUNT_STEP_M} m, ${Math.round(SV.TRADE_GRUNT_CHANCE * 100)}% of them held, seated behind the barrels.`,
  pottery: `Clay pots along both verges, one sample a cell with ${SV.POTTERY_GAP * 100}% left empty, each a cell back from the kerb on the reward gate. No guards.`,
  goblin_gang: `${SV.VARIANT_BY_ID.goblin_gang.clusters} candidate gangs beside barrel stacks, with up to ${SV.VARIANT_BY_ID.goblin_gang.barrelsPerCluster} barrels per cluster where eligible verge cells remain.`,
};
for (const row of rows) {
  row.placement = rules[row.id] || row.placement;
  if (row.ventKind) row.placement = `Seeded ${row.ventKind} geysers alongside the path, where hazard placement is safe. A matching daily shrine stands on each eligible section.`;
}
process.stdout.write(JSON.stringify({ cellM, terrainVergeCells: Number(read('street_variants').match(/const TERRAIN_VERGE_CELLS = ([\d.]+)/)[1]), affinityContexts, fixture: { tx, ty, cellsPerEdge: N }, rows, baseline: SV.BANDIT_STORY,
  maxVariantLengthM: SV.MAX_VARIANT_LENGTH_M, wagonStopShare: SV.WAGON_STOP_SHARE, rockStreetShare: SV.ROCK_STREET_SHARE,
  plainShare: Object.fromEntries(['minor', 'major'].map((size) =>
    [size, 1 - (size === 'minor' ? SV.MINOR_VARIANT_SHARE : rows.filter((r) => r.size === size).reduce((sum, r) => sum + r.share, 0))])) }, null, 2) + '\n');
