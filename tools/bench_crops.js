#!/usr/bin/env node
// Reproduce the crop scan cost without Phaser or a browser:
//   node tools/bench_crops.js
// Each simulated frame makes the ground and sprite queries render.js makes.
// Modules and benchmark run in one VM realm; timings are observations, not a
// test gate. Cold frames rebuild the derived index after a crop-list mutation.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');

const ROOT = path.resolve(__dirname, '..');
const source = ['placed_floor.js', 'crops.js']
  .map(file => fs.readFileSync(path.join(ROOT, 'src', file), 'utf8')).join('\n');

function benchmark() {
  const groundHalfM = (11 / 2 + 2) * 5;
  const spriteHalfM = (11 / 2 + 1) * 5;
  const local = [
    { x: -10, y: -10 }, { x: 0, y: 0 },
    { x: 10, y: 5 }, { x: 20, y: 20 },
  ];
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const time = (fn, frames, rounds = 9) => {
    const samples = [];
    for (let round = 0; round < rounds; round++) {
      const start = performance.now();
      for (let frame = 0; frame < frames; frame++) fn();
      samples.push((performance.now() - start) / frames);
    }
    return median(samples);
  };

  const rows = [];
  for (const distant of [null, 0, 10000]) {
    const save = { planted: distant === null ? [] : local.map(p => ({ ...p, crop: 'potato' })) };
    for (let i = 0; i < (distant || 0); i++) {
      save.planted.push({ x: 1000 + i, y: 1000, crop: 'potato' });
    }
    function original() {
      // drawCells' old near-list filter, then drawObjects' depth + halfM cull.
      const ground = [], sprite = [];
      for (const p of save.planted) {
        if (Math.abs(p.x) <= groundHalfM && Math.abs(p.y) <= groundHalfM) {
          ground.push(p);
        }
      }
      for (const p of save.planted) {
        if (!PlacedFloor.onDepth(p, 0)) continue;
        if (Math.abs(p.x) > spriteHalfM || Math.abs(p.y) > spriteHalfM) continue;
        sprite.push(p);
      }
      return { ground, sprite, visits: save.planted.length * 2 };
    }
    function indexed() {
      const groundMatches = [], spriteMatches = [];
      const ground = Crops.forEachInBox(save, 0, -groundHalfM, -groundHalfM,
        groundHalfM, groundHalfM, p => groundMatches.push(p));
      const sprite = Crops.forEachInBox(save, 0, -spriteHalfM, -spriteHalfM,
        spriteHalfM, spriteHalfM, p => spriteMatches.push(p));
      return { visits: ground.candidates + sprite.candidates,
        rebuildEntries: ground.rebuiltEntries + sprite.rebuiltEntries,
        ground: groundMatches, sprite: spriteMatches };
    }
    const truth = original();
    const first = indexed();
    const warmWork = indexed();
    for (const pass of ['ground', 'sprite']) {
      if (truth[pass].length !== warmWork[pass].length ||
          truth[pass].some((p, i) => p !== warmWork[pass][i])) {
        throw new Error(`${pass} query differs for ${save.planted.length} crops`);
      }
    }
    const warmFrames = distant === 10000 ? 200 : 2000;
    const originalMs = time(() => original(), warmFrames);
    const indexedMs = time(() => indexed(), warmFrames);
    const coldMs = time(() => {
      Crops.invalidateSpatialIndex(save);
      indexed();
    }, distant === 10000 ? 20 : 200);
    const savedPerFrame = originalMs - indexedMs;
    const extraColdMs = Math.max(0, coldMs - indexedMs);
    rows.push({ farm: distant === null ? 'empty' : distant ? '4 local + 10k distant' : '4 local',
      crops: save.planted.length, originalVisits: truth.visits, indexedVisits: warmWork.visits,
      kept: truth.ground.length + truth.sprite.length, coldRebuildEntries: first.rebuildEntries,
      originalMs, indexedMs, coldMs, extraColdMs,
      amortizeFrames: savedPerFrame > 0 ? Math.ceil(extraColdMs / savedPerFrame) : null });
  }
  return rows;
}

// runInThisContext keeps the loaded modules and the measured loops in Node's
// own realm, avoiding the contextified-global overhead of runInNewContext.
const rows = vm.runInThisContext(source + '\n(' + benchmark.toString() + ')()');
console.log('Per simulated frame: ground query + sprite query; median milliseconds, 9 batches.');
console.log('Farm                    crops  old visits  index visits  kept  old warm  index warm  cold frame  build extra  rebuild entries  payback frames');
for (const r of rows) {
  console.log(`${r.farm.padEnd(23)} ${String(r.crops).padStart(5)}  ${String(r.originalVisits).padStart(10)}  ${String(r.indexedVisits).padStart(12)}  ${String(r.kept).padStart(4)}  ${r.originalMs.toFixed(4).padStart(8)}  ${r.indexedMs.toFixed(4).padStart(10)}  ${r.coldMs.toFixed(4).padStart(10)}  ${r.extraColdMs.toFixed(4).padStart(11)}  ${String(r.coldRebuildEntries).padStart(15)}  ${String(r.amortizeFrames ?? 'never').padStart(14)}`);
}
