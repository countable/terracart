#!/usr/bin/env node
// Planning adapters around the shipping motif sampler and terrain layout engine.
const fs = require('fs'), path = require('path'), vm = require('vm');
const context = {addEventListener() {}}; context.window = context; vm.createContext(context);
for (const name of ['util', 'zone_variant_data', 'terrain', 'zone_variants'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', name + '.js'), 'utf8'), context);
const {cells, seed} = JSON.parse(fs.readFileSync(0, 'utf8'));
const height = cells.length, width = cells[0].length;
const variant = {id: `ambient-${seed}`, background: {type: 'repeat_motif', repeatCells: [width, height],
  slots: cells.flatMap((row, y) => row.map((material, x) => ({at: [x, y], material})))}};
const tile = cells.map((row, y) => row.map((_, x) => context.ZoneVariants.sample(variant, x, y, variant.id)));
const settings = {layout: 'hilbert', width, height, seed, order: 2, side: 1, bias: 1,
  skip: [25, 20, 0], selection: 'density', affinity: 35, variation: 0};
const points = context.TerrainLayouts.generate(settings);
const assigned = context.TerrainLayouts.assign(points, settings, [{material: 'prop', share: 1}]);
process.stdout.write(JSON.stringify({tile, generated: assigned, settings}));
