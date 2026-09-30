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
for (const name of ['sprite_layout', 'util', 'streets', 'street_variants', 'biome_profiles', 'interactables', 'worldgen', 'scenic', 'road_overlay']) {
  vm.runInContext(read(name), ctx, { filename: name + '.js' });
}
// The pure lamp method and its footprint constants are lifted exactly as in
// test/node/run.js. Fail loudly if its boundaries change; never substitute a
// second implementation or an independent spacing/offset number.
const app = read('app');
for (const name of ['STREET_LAMP_DARK_CELLS', 'STREET_LAMP_R_CELLS']) {
  const match = app.match(new RegExp(`\nconst ${name} = [\\s\\S]*?;\n`));
  if (!match) throw new Error(`Cannot load ${name} from app.js`);
  vm.runInContext(match[0], ctx);
}
const start = app.indexOf('  _streetLampsForTile(tx, ty, entry) {');
const end = app.indexOf('  // The lamps near the frame', start);
if (start < 0 || end < start) throw new Error('Cannot load street lamp placement from app.js');
vm.runInContext('globalThis.previewLampPass = {\n' + app.slice(start, end) + '\n};', ctx);

const WG = ctx.WorldGen, SV = ctx.StreetVariants;
const extent = 4096, tx = 2622, ty = 5615;
const N = WG.cellsPerEdgeForTile(ty);
const cellM = WG.CELL_M, tileEdgeM = N * cellM;
const point = (x, y) => ({ x: (x + 0.5) * extent / N, y: (y + 0.5) * extent / N });
const middle = Math.floor(N / 2);
const line = [point(middle - 22, middle), point(middle + 22, middle)];
const lengthM = ctx.Streets.lineLengthM(line, tileEdgeM / extent);
const local = (o) => ({ ...o, x: o.x - tx * tileEdgeM, y: o.y - ty * tileEdgeM });

function preview(row) {
  if (row.size === 'path') return previewPath(row);
  // Select a real key that rolls the row. No runtime tables or rolls are patched.
  let name;
  for (let i = 0; i < 10000; i++) {
    const candidate = `Preview ${i}`;
    if (SV.variantFor(SV.streetKey(candidate, tx, ty), candidate, row.size) === row.id) {
      name = candidate;
      break;
    }
  }
  if (!name) throw new Error(`No preview street for ${row.id}`);
  const tags = { class: row.size === 'major' ? 'secondary' : 'minor' };
  const layers = [
    { name: 'landuse', features: [{ type: 3, tags: { class: 'park' },
      geom: [[point(0, 0), point(N - 1, 0), point(N - 1, N - 1), point(0, N - 1)]] }] },
    { name: 'transportation', extent, features: [{ type: 2, tags, geom: [line] }] },
    { name: 'transportation_name', extent, features: [{ type: 2, tags: { name }, geom: [line] }] },
  ];
  const tile = WG.rasterizeTile(layers, N, tx, ty, tileEdgeM);
  const rec = tile.streetIndex.lines[0];
  if (rec.variant !== row.id) throw new Error(`Preview rolled ${rec.variant}, wanted ${row.id}`);
  // Isolate street dressing from ambient park objects, keeping the actual
  // rasterized terrain, road band and all spawn reasons / kerb buffers.
  const dress = SV.dress({ index: tile.streetIndex, tx, ty, N, tileEdgeM, grid: tile.grid,
    spawnOpts: { roadMask: tile.roadMask, roadClass: tile.roadClass,
      spawnWhy: tile.spawnWhy, occupied: new Set(), pois: [] } });
  const lamps = ctx.previewLampPass._streetLampsForTile(tx, ty,
    { ...tile, layers, tileEdgeM, cellsPerEdge: N }).map(local);
  const objects = [...dress.objects, ...dress.wildplants].map(local);
  const lairs = dress.lairs.map((o) => ({ kind: o.tier + ' guard site', x: o.lx, y: o.ly }));
  return { ...row, words: row.words.source, sampleName: name,
    roadWidthM: WG.roadOverlayWidthM(tags), lengthM,
    lampSpacingM: SV.lampSpacingFor(row.id), objects, lamps, lairs,
    line: line.map((p) => ({ x: p.x * tileEdgeM / extent, y: p.y * tileEdgeM / extent })),
    slowKinds: [...new Set(objects.filter((o) => SV.isSlowKind(o.kind)).map((o) => o.kind))] };
}

function previewPath(row) {
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
  const tile = WG.rasterizeTile(layers, N, tx, ty, tileEdgeM);
  const scenic = tile.scenic;
  if (!scenic || scenic.census[kind] < lengthM - SC.SAMPLE_M) throw new Error(`Wrong scenic classification for ${row.id}`);
  const dress = SC.dress({ scenic, tx, ty, N, tileEdgeM, grid: tile.grid, chests: [],
    spawnOpts: { roadMask: tile.roadMask, roadClass: tile.roadClass, spawnWhy: tile.spawnWhy, occupied: new Set() } });
  const lamps = ctx.previewLampPass._streetLampsForTile(tx, ty,
    { ...tile, layers, tileEdgeM, cellsPerEdge: N }).map(local);
  if (!lamps.length || lamps.some(lamp => lamp.glow !== row.lampGlow)) throw new Error(`Wrong scenic lamps for ${row.id}`);
  return { ...row, sampleName: name, roadWidthM: WG.roadOverlayWidthM(tags), lengthM,
    lampSpacingM: ctx.Streets.lampLayFor(tags).spacingM, objects: [...dress.objects, ...dress.wildplants].map(local),
    lamps, lairs: [], slowKinds: [], geography, scenicKind: kind,
    selection: kind === 'shore' ? 'Off-road walking path beside qualifying shore water.' :
      kind === 'greenway' ? 'Off-road walking path with a greenway name or route.' : 'Off-road walking path inside a named or sufficiently large park.',
    rewards: `${SC.SCENIC_MUL[kind]}× first-restoration metre credit; one T${SC.VISTA_CHEST_TIER[kind]} one-time vista chest per eligible stretch of at least ${SC.VISTA_STRETCH_MIN_M} m. Daily path-lamp credit is unchanged.`,
    placement: 'Geography selects the scenic row; real scenic stretch dressing seats vista chests off the path. No additional themed verge plants.',
    line: line.map(p => ({ x: p.x * tileEdgeM / extent, y: p.y * tileEdgeM / extent })) };
}

const rows = SV.STREET_VARIANTS.map(preview);
const rules = {
  hedgerow: `Both verges, one trimmed hedge per ${cellM} m cell; a gate gap every ${SV.HEDGE_GAP_MIN}–${SV.HEDGE_GAP_MIN + SV.HEDGE_GAP_SPAN - 1} cells.`,
  overgrown: `One attempt every ${SV.OVERGROWN_STEP_M} m; a sapling-to-mature tree progression, at most ${SV.OVERGROWN_MAX} trees per line piece.`,
  orchard: `One attempt every ${SV.ORCHARD_STEP_M} m, both verges; at most ${SV.ORCHARD_MAX} apple trees per line piece.`,
  pilgrim: 'One waystone per street per tile, at an eligible owned line end.',
  lantern: `Lamps at ${SV.lampSpacingFor('lantern')} m target spacing (${SV.LANTERN_SPACING_DIV}× the usual density); no extra verge props.`,
  burned: `One attempt every ${SV.BURNED_STEP_M} m; at most ${SV.BURNED_MAX} tar/stakes per line piece. One fire-slime guard site per stretch, seated back from the kerb.`,
  barricade: `Repeated stakes and barricades every ${SV.BARRICADE_STEP_M} m, up to ${SV.BARRICADE_MAX} pieces; one encounter anchor and its goblin guard site per street per tile.`,
  toadstool: `One attempt every ${SV.TOADSTOOL_STEP_M} m; at most ${SV.TOADSTOOL_MAX} mushrooms per line piece. Mushrooms only, in three-on/one-gap groups with varying verge setbacks.`,
};
for (const row of rows) row.placement = rules[row.id] || row.placement;
process.stdout.write(JSON.stringify({ cellM, fixture: { tx, ty, cellsPerEdge: N }, rows, baseline: SV.BANDIT_STORY,
  maxVariantLengthM: SV.MAX_VARIANT_LENGTH_M, wagonStopShare: SV.WAGON_STOP_SHARE, rockStreetShare: SV.ROCK_STREET_SHARE,
  plainShare: Object.fromEntries(['minor', 'major'].map((size) =>
    [size, 1 - rows.filter((r) => r.size === size).reduce((sum, r) => sum + r.share, 0)])) }, null, 2) + '\n');
