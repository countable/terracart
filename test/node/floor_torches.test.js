// Torches you can pick up: the Torch consumable lying on the first cave
// level's floor (worldgen.js caveFloorTorches) — one at the foot of every
// up-ladder, where a descent lands, and a few dozen strewn over the rest —
// plus the roadside box's themed supply group (rarity.js 'chest:lowtier').
// The floor ones are `torch` WILDPLANTS, so they ride the lane every floor
// pickup already walks: generated, drawn by CROP_SPRITE, picked by the
// wildplant tap, remembered only as an id in save.picked.

(function () {

const CAVE_FLOOR = WorldGen.T.CAVE_FLOOR, CAVE_WALL = WorldGen.T.CAVE_WALL;
const TILE_M = 400, TX = 3, TY = 5, N = 64;
const centre = (lix, liy) => {
  const m = TILE_M / N;
  return { x: TX * TILE_M + (lix + 0.5) * m, y: TY * TILE_M + (liy + 0.5) * m };
};
const cellOf = (o) => {
  const m = TILE_M / N;
  return { lix: Math.floor((o.x - TX * TILE_M) / m), liy: Math.floor((o.y - TY * TILE_M) / m) };
};
const floorGrid = () => new Uint8Array(N * N).fill(CAVE_FLOOR);
const upStair = (lix, liy) => ({ kind: 'staircase', dir: 'up', ...centre(lix, liy), id: `stair_up_1_${lix}_${liy}` });
const downStair = (lix, liy) => ({ kind: 'staircase', dir: 'down', ...centre(lix, liy), id: `stair_down_1_${lix}_${liy}` });

function lay(depth, objects, grid = floorGrid(), occupied) {
  const occ = occupied || new Set(objects.map((o) => { const c = cellOf(o); return c.liy * N + c.lix; }));
  const wps = [];
  WorldGen.caveFloorTorches(objects, grid, N, TX, TY, TILE_M, depth, wps, occ);
  return { wps, occ };
}

test('floor torches: every up-ladder on level 1 has a torch lying beside it', () => {
  const stairs = [upStair(10, 10), upStair(40, 50), downStair(20, 20)];
  const { wps } = lay(1, stairs);
  for (const s of stairs.filter((o) => o.dir === 'up')) {
    const t = wps.find((w) => w.id === `ctorch_${s.id}`);
    assert.truthy(t, `a torch keyed on ${s.id}`);
    const a = cellOf(s), b = cellOf(t);
    assert.eq(Math.max(Math.abs(a.lix - b.lix), Math.abs(a.liy - b.liy)), 1,
      'on the next cell, within reach of where the descent lands — never on the ladder itself');
  }
  assert.falsy(wps.some((w) => w.id === 'ctorch_stair_down_1_20_20'), 'the way DOWN gets none of its own');
});

test('floor torches: a few dozen strewn per tile, on free floor, as the Torch item', () => {
  const grid = floorGrid();
  for (let i = 0; i < N * N; i += 4) grid[i] = CAVE_WALL;
  const taken = new Set([5 * N + 5, 6 * N + 6]);
  const before = new Set(taken);
  const { wps, occ } = lay(1, [], grid, taken);
  const strewn = wps.filter((w) => !w.id.startsWith('ctorch_stair_'));
  assert.inRange(strewn.length, WorldGen.FLOOR_TORCH_MIN - 2, WorldGen.FLOOR_TORCH_MIN + WorldGen.FLOOR_TORCH_SPAN,
    `a few dozen: ${strewn.length}`);
  assert.gt(WorldGen.FLOOR_TORCH_MIN, 20, 'a few DOZEN, not a handful');
  const ids = new Set();
  for (const w of wps) {
    assert.eq(w.kind, 'wildplant', 'a floor pickup, not a wall-torch object');
    assert.eq(w.crop, 'torch', 'crop');
    assert.eq(wildplantOutput(w.crop), 'torch', 'picking one hands over the Torch consumable');
    assert.eq(ITEM_BY_ID.torch.kind, 'supply', 'which is the usable item');
    const { lix, liy } = cellOf(w);
    assert.eq(grid[liy * N + lix], CAVE_FLOOR, 'on floor');
    assert.falsy(before.has(liy * N + lix), 'never on a cell something already holds');
    assert.falsy(ids.has(w.id), 'ids unique'); ids.add(w.id);
  }
  assert.eq(occ.size, before.size + wps.length, 'each claims its cell');
});

test('floor torches: level 1 only', () => {
  for (const d of [2, 3, 5]) {
    assert.eq(lay(d, [upStair(10, 10)]).wps.length, 0, `none on level ${d}`);
  }
});

test('floor torches: the same tile lays the same torches, with positional ids', () => {
  const a = lay(1, [upStair(12, 30)]).wps.map((w) => w.id).join(',');
  const b = lay(1, [upStair(12, 30)]).wps.map((w) => w.id).join(',');
  assert.eq(a, b, 'a rebuilt or re-rasterized level is identical, so save.picked keeps applying');
  for (const w of lay(1, []).wps) {
    const { lix, liy } = cellOf(w);
    assert.eq(w.id, `ctorch_1_${TX}_${TY}_${lix}_${liy}`, 'depth + tile + cell, never a counter');
  }
});

test('floor torches: rolled LAST, so no level already walked rearranges', () => {
  const src = WORLDGEN_SRC;
  const start = src.indexOf('async function loadCaveTile(');
  const body = src.slice(start, src.indexOf('\n  }\n', start));
  assert.truthy(/for \(const row of CAVE_PASSES\) runCavePass\(row, level\);/.test(body), 'loadCaveTile lays the table (CAVE_PASSES) in order');
  assert.truthy(/const level = cavePassLevel\(grid, N, x, y, tileEdgeM, depth, ambientOccupied, \{ objects, wildplants \}\);/.test(body),
    'into the level\'s wildplants');
  const order = WorldGen.CAVE_PASSES.map(r => r.id);
  const at = order.indexOf('floorTorches');
  assert.gt(at, 0, 'a row of the table');
  for (const pass of ['rocks', 'mushrooms', 'rings', 'wallTorches', 'coins', 'treasureMarks']) {
    assert.gt(at, order.indexOf(pass), `after ${pass}`);
  }
});

test('floor torches: drawn with the Torch\'s own icon, off a sheet the renderer loads', () => {
  const ov = CROP_SPRITE.torch;
  assert.truthy(ov && ov.custom, 'a custom-sheet crop');
  assert.eq(ov.sheet, MINERAL_ICON_SHEET.torch.sheet, 'the same art the inventory shows');
  assert.eq(wildplantFrame({ crop: 'torch', id: 'ctorch_1_0_0_1_1' }), MINERAL_ICON_SHEET.torch.frame, 'its frame');
});

// ── The lowtier roadside box ───────────────────────────────────────────────

function xorRng(seed) {
  let x = (seed >>> 0) || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

test('roadside chest: every tier stays with supplies, minerals and cash', () => {
  assert.eq(ChestThemes.weights('roadside', 1).supplies, 45);
  const supplyIds = new Set(['torch', 'rope', 'trap_disarm_kit', 'throwing_spear', 'taming_potion', 'blank_scroll']);
  for (const tier of [1, 2, 3, 5]) {
    const rng = xorRng(0x70C4 + tier);
    let supplies = 0, torches = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const r = pickReward('chest:lowtier', { relics: {}, armor: {} }, rng, { tier });
      assert.truthy(r, 'every roadside roll resolves');
      if (r.group === 'supplies') {
        supplies++;
        if (r.kind === 'relic') {
          assert.eq(tier, 2, 'only T2 supplies introduce alternate weapons');
          assert.eq(r.tier, 1, 'supply weapons are always Rusty');
          assert.includes(['dagger', 'lance', 'musket'], r.slot);
          continue;
        }
        assert.eq(r.kind, 'item');
        assert.truthy(supplyIds.has(r.id), `roadside supply ${r.id}`);
        assert.eq(ITEM_BY_ID[r.id].kind, 'supply');
        assert.inRange(r.qty, 1, 5, 'supplies keep their stack cap');
        if (r.rolledTier === 1) assert.eq(ITEM_BY_ID[r.id].baseTier, 1, 'T1 supplies respect catalog rarity');
        if (r.id === 'torch') torches++;
      } else if (r.group === 'materials') {
        assert.includes(['wood', 'rubble', 'flint_shard', ...Object.values(MINERAL_TIERS).map(row => row.barId)], r.id);
      } else if (r.group === 'plainBook') {
        // A T2 chest lends a fifth of its row to the Book (ChestThemes.BOOK_T2_SHARE).
        assert.eq(tier, 2, 'the Book joins the roadside row at tier 2 only');
        assert.eq(r.id, 'book', 'the Book itself, whatever the roll climbed to');
      } else {
        assert.eq(r.group, 'cash');
        assert.eq(r.kind, 'gold');
      }
    }
    const bookMul = tier === 2 ? (100 - ChestThemes.BOOK_T2_SHARE) / 100 : 1;
    assert.inRange(supplies / n, 0.42 * bookMul, 0.48 * bookMul, `T${tier}: supply share`);
    if (tier === 1) assert.gt(torches / n, 0.30, 'roadside T1 is a dependable Torch source');
  }
});

})();
