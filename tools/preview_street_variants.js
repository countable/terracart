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
for (const name of ['sprite_layout', 'util', 'streets', 'street_variants', 'biome_profiles', 'interactables', 'worldgen', 'road_overlay']) {
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

const rows = SV.STREET_VARIANTS.map(preview);
const rules = {
  hedgerow: `Both verges, one hedge per ${cellM} m cell; a gate gap every ${SV.HEDGE_GAP_MIN}–${SV.HEDGE_GAP_MIN + SV.HEDGE_GAP_SPAN - 1} cells.`,
  overgrown: `One attempt every ${SV.OVERGROWN_STEP_M} m; at most ${SV.OVERGROWN_MAX} plants per line piece.`,
  orchard: `One attempt every ${SV.ORCHARD_STEP_M} m, alternating sides; at most ${SV.ORCHARD_MAX} fruit trees per line piece.`,
  pilgrim: 'One waystone per street per tile, at an eligible owned line end.',
  lantern: `Lamps at ${SV.lampSpacingFor('lantern')} m target spacing (${SV.LANTERN_SPACING_DIV}× the usual density); no extra verge props.`,
  burned: `One attempt every ${SV.BURNED_STEP_M} m; at most ${SV.BURNED_MAX} tar/stakes per line piece. One fire-slime guard site per stretch, seated back from the kerb.`,
  barricade: 'One barricade per street per tile, at an eligible owned line end; its goblin guard site is seated back from the kerb.',
  toadstool: `One attempt every ${SV.TOADSTOOL_STEP_M} m; at most ${SV.TOADSTOOL_MAX} plants per line piece. ${SV.TOADSTOOL_MUSHROOM_SHARE * 100}% mushroom picks, otherwise long grass.`,
};
for (const row of rows) row.placement = rules[row.id] || 'See the generated sample and runtime table.';
process.stdout.write(JSON.stringify({ cellM, fixture: { tx, ty, cellsPerEdge: N }, rows, baseline: SV.BANDIT_STORY,
  wagonStopShare: SV.WAGON_STOP_SHARE, rockStreetShare: SV.ROCK_STREET_SHARE,
  plainShare: Object.fromEntries(['minor', 'major'].map((size) =>
    [size, 1 - rows.filter((r) => r.size === size).reduce((sum, r) => sum + r.share, 0)])) }, null, 2) + '\n');
