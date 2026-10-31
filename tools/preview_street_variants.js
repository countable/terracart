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
for (const name of ['enemy_roster', 'sprite_layout', 'util', 'coords', 'polygon_geometry', 'zone_variant_data', 'terrain', 'zone_variants', 'shrines', 'streets', 'street_variants', 'street_lights', 'street_signs', 'biome_profiles', 'selected_item_art', 'items', 'macros', 'interactables', 'loot', 'gameplay_tiers', 'conditions', 'combat', 'creature_ai', 'worldgen', 'scenic', 'road_overlay']) {
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
const local = (o) => ({ ...o, ...(o.kind === 'chest' ? { previewContainerFrame: ctx.chestLook(o).frame } : {}), x: o.x - tx * tileEdgeM, y: o.y - ty * tileEdgeM });

// Export the shipping raster, cropped to the preview viewport. Road surfaces are
// drawn by the pavement painter; park is the fixture's unchanged base ground.
function groundPreview(tile) {
  const cells = [];
  for (let y = Math.max(0, middle - 12); y <= Math.min(N - 1, middle + 12); y++) {
    for (let x = Math.max(0, Math.floor(middle - halfLengthCells - 6)); x <= Math.min(N - 1, Math.ceil(middle + halfLengthCells + 6)); x++) {
      const i = y * N + x;
      let type = tile.grid[i];
      if (type === WG.T.PATH) type = tile.pathUnder[`${x}_${y}`] ?? WG.T.PARK;
      const streetGround = tile.streetGround?.[i];
      if (streetGround) type = streetGround - 1;
      if (type === WG.T.PARK || (tile.roadMask[i] && !streetGround)) continue;
      cells.push({x: x * cellM, y: y * cellM, type});
    }
  }
  return {baseTerrain: WG.T.PARK, groundCells: cells};
}

function preview(row) {
  if (row.size === 'path') return previewPath(row);
  let name = 'Preview';
  const tags = { class: 'minor' };
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
      spawnWhy: tile.spawnWhy, occupied: new Set(), pois: [] } });
  const lamps = ctx.RoadOverlay.lampSitesForTile(tx, ty,
    { ...tile, layers, tileEdgeM, cellsPerEdge: N }).map(local);
  const objects = [...dress.objects, ...dress.wildplants, ...(dress.traps || []).map(t => ({ ...t, kind: 'trap', recordType: 'surface_trap' }))].map(local);
  const lairs = dress.lairs.map((o) => ({ tier: o.tier, kind: o.tier + ' guard site', x: o.lx, y: o.ly }));
  return { ...row, ...groundPreview(tile), words: row.words ? row.words.source : null, sampleName: name,
    roadWidthM: WG.roadOverlayWidthM(tags), lengthM,
    lampSpacingM: SV.lampSpacingFor(row.id), objects, lamps, lairs,
    vents: (dress.vents || []).map(local), webs: (dress.webs || []).map(local),
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
    occupied: new Set(), pois: [] };
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
    selection: !kind ? row.selection : kind === 'shore' ? 'Walking path beside qualifying shoreline.' :
      kind === 'greenway' ? 'Walking path with a greenway name or route.' : 'Walking path in a named or large park.',
    rewards: !kind ? row.rewards : `${SC.SCENIC_MUL[kind]}× first-restoration credit. One T${SC.VISTA_CHEST_TIER[kind]} vista chest per eligible stretch of at least ${SC.VISTA_STRETCH_MIN_M} m, collected once.`,
    placement: !kind ? row.placement : 'Vista chests sit beside the path. ' + (kind === 'greenway' ? `Grass grows along both verges every ${SC.GREENWAY_GRASS_STEP_M} m where space permits.` : ''),
    line: line.map(p => ({ x: p.x * tileEdgeM / extent, y: p.y * tileEdgeM / extent })) };
}

const rows = SV.STREET_VARIANTS.filter(row => !row.retired && ['minor', 'path'].includes(row.size)).map(preview);
// Use the runtime weighting helper, with no name match, to make soft affinities
// inspectable without changing the generated art fixture or rarity roll.
const affinityContexts = Object.fromEntries(['neutral', 'cultivated', 'woodland', 'damp', 'formal', 'sacred', 'ruined', 'coastal'].map(trait =>
  [trait, Object.fromEntries(['minor'].map(size =>
    [size, SV.selectionWeights('Preview', size, trait === 'neutral' ? {} : {[trait]: 1})]))]));
const rules = {
  way_of_variety: 'Common finds cover the road and two-cell verges, with occasional T1–T2 crop plants, copper and rose quartz. No added trees. Up to three small snakes per eligible tile habitat.',
  rocky_path: 'Common rocks, flint and rubble occupy the road and first verge row, with paired clear sections for cave-ins. Hidden cave-ins crack on contact, then open after five seconds; the preview shows intact ground.',
  haunted_forest_path: 'Permanent maws alternate between the route and verge, with one opportunity every 70 m. Each drops grounded players one level. Dead trees, headstones and mushrooms surround them.',
  causeway: `Rocky ground extends up to ${SV.VARIANT_BY_ID.causeway.terrainVergeCells} cells beside both verges, with water pools. Road surfaces and crossings stay dry.`,
  slime_trail: `One slime species per section. Two guards per eligible post, spaced ${SV.VARIANT_BY_ID.slime_trail.enemyStepM} m apart; short sections use the midpoint.`,
  spider_path: `Permanent webs on ${SV.VARIANT_BY_ID.spider_path.webDensity * 100}% of eligible samples. Webs also occupy 20% of eligible off-path verge cells. Contact paralyses grounded actors. One two-spider garrison and a concealed supply cache per eligible section.`,
  golden_path: 'Either end shrine starts the same daily coin run along the path.',
  hedgerow: `Hedge rows at ${cellM} m spacing in the first verge row. White flowers fill the verges. Detected trees within 3 cells of the road edge use rounded crowns; no extra trees. One ambush where space permits.`,
  thorny: `Bramble clusters cross the road and extend up to ${SV.THORNY_VERGE_MAX_CELLS} cells beyond it. Some streets enclose a moss cairn. Brambles burn and drain energy on contact.`,
  overgrown: `One verge row with one empty cell between trees. Equal groups of seedlings, young pines, large pines, dead trees, then stumps; group size follows road length. The shrine sits after the stumps. A concealed seed cache rolls themed T1–T3 loot; enter its cell or tap it to reveal it.`,
  orchard: `Fruit trees and mature maples alternate on both sides every ${SV.ORCHARD_STEP_M} m, up to ${SV.ORCHARD_MAX} per line piece. Fruit trees are mostly apples, with occasional oranges and Worldpeaches. Flowers and stumps use the first verge row only; blocked seats are omitted.`,
  snare: `Dirt extends ${SV.VARIANT_BY_ID.snare.terrainVergeCells} cells, with scattered rocks and bones. One T${SV.SNARE_CHEST_TIER} chest surrounded by ${SV.SNARE_MIN_TRAPS}-${(2 * SV.SNARE_TRAP_RADIUS_CELLS + 1) ** 2 - 1} traps. Up to ${SV.SNARE_STRAYS} extra snares lie along the road and verges.`,
  golden: 'Visit the golden idol to start a daily coin spree along both verges.',
  pilgrim: '3-6 waystones scattered within the two-cell verge. Step on all before their light fades.',
  lantern: `Lamps spaced about ${SV.lampSpacingFor('lantern', ctx.Streets.lampLayFor({class: 'path'}).spacingM)} m apart.`,
  burned: `Hot ember paving, tar, stakes and torches. Up to ${SV.BURNED_MAX} debris pieces per line piece; one fire-slime guard site per stretch.`,
  barricade: `Barriers cross the road every ${SV.BARRICADE_STEP_M} m and extend up to ${SV.BARRICADE_VERGE_MAX_CELLS} cells beyond it. A Trap Kit removes each piece. Rocks, planks and stray stakes scatter across the three-cell verge. Goblins guard the route.`,
  toadstool: `Small and medium mushrooms grow on the road and both two-cell verges, with occasional giants; 30% of candidate caps are omitted. Groups every ${SV.TOADSTOOL_STEP_M} m; up to ${SV.TOADSTOOL_COVER_MAX} extra caps.`,
  trade: `Barrels line both verges with ${SV.TRADE_BARREL_GAP * 100}% gaps. Thief-and-two-grunt posts are sampled every ${SV.TRADE_GRUNT_STEP_M} m; ${Math.round(SV.TRADE_GRUNT_CHANCE * 100)}% are occupied.`,
  pottery: 'Clay pots sit on the road and in two verge rows where space permits. Eligible surface pots have a 20% snake chance.',
  berry_trail: 'Two bush rows on each side: 48% plain, 25% berry, 15% poison, 10% thorn and 2% golden. One large bear encounter per section.',
  goblin_gang: `Up to ${SV.VARIANT_BY_ID.goblin_gang.clusters} gangs beside stacks of ${SV.VARIANT_BY_ID.goblin_gang.barrelsPerCluster} barrels, where space permits.`,
};
for (const row of rows) {
  row.placement = rules[row.id] || row.placement;
  if (row.ventKind) row.placement = `${row.ventKind} geysers beside the path, with a matching daily shrine on eligible sections.`;
  if (row.cacheTheme && row.id !== 'overgrown') row.placement += ' A concealed themed T1–T3 cache reveals on exact-cell contact or a direct tap.';
  if (row.id === 'goblin_gang') row.placement += ' Red barrels always explode; 10% of ordinary barrels do too. Tap starts a five-second fuse before a one-cell blast and fire.';
}
process.stdout.write(JSON.stringify({ cellM, terrainVergeCells: Number(read('street_variants').match(/const TERRAIN_VERGE_CELLS = ([\d.]+)/)[1]), affinityContexts, fixture: { tx, ty, cellsPerEdge: N }, rows, baseline: SV.BANDIT_STORY,
  maxVariantLengthM: SV.MAX_VARIANT_LENGTH_M, wagonStopShare: SV.WAGON_STOP_SHARE, rockStreetShare: SV.ROCK_STREET_SHARE,
  variantSizes: ['minor', 'path'], variantShadeAlpha: ctx.RoadOverlay.VARIANT_SHADE_ALPHA,
  plainShare: { minor: 1 - SV.MINOR_VARIANT_SHARE } }, null, 2) + '\n');
