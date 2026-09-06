// THE ACORN GROWS A TREE, NOT A FRUIT TREE.
//
// An Acorn is a sapling by kind — it plants through the same tilled-soil
// path as the apple and peach saplings and grows on the same 4 × 1-day clock
// (save.fruittrees → a `fruittree` object with planted_t) — but what it grows
// is a MAPLE: a fruittree by plumbing only. It draws off the maple `trees`
// sheet through the frames the wild maple is drawn from (1 sprout → 2 young →
// 3 mature), bears nothing, and once grown is FELLED, not picked: the tap
// runs the wild `tree` entry's own axe gate / energy / wheel / wood roll over
// the size-less maple it stands for (util.js plantedMapleView), and the felled
// tree comes out of save.fruittrees and the tile so the cell is free again.
//
// Its source is felling: a wild tree at its mature canopy shakes one loose on
// ACORN_DROP_P, with its own "+1 Acorn" toast. T2 in the sapling class also
// puts it in the rarity picker's hands.
//
// These pin every side of that against the shipping code: the registry and
// the two-table icon rule, the REAL render spec (evaluated out of render.js,
// not transcribed), the drop, the chop, the wait, and that a maple is never
// "repaired" into an apple by the fruit path's species guard.

(function () {
const DAY = PLANTED_TREE_STAGE_MS;
const MATURE_MS = PLANTED_TREE_STAGES * PLANTED_TREE_STAGE_MS;

// A save with a top-tier axe, or none at all.
const axeSave = (tier, extra = {}) => ({ relics: tier ? { axe: { tier } } : {}, ...extra });
// An id the shiny roll leaves alone, so a test never trips the 10× bonus.
function plainId(prefix) {
  for (let i = 0; i < 10000; i++) {
    const id = `${prefix}_${i}`;
    if (!isShiny(id, SHINY_RATE.tree)) return id;
  }
  throw new Error('no non-shiny id found');
}
// Run `fn` with the clock frozen at `t`.
function atTime(t, fn) {
  const realNow = Date.now;
  Date.now = () => t;
  try { return fn(); } finally { Date.now = realNow; }
}
// Run `fn` with Math.random pinned at `v`.
function withRandom(v, fn) {
  const real = Math.random;
  Math.random = () => v;
  try { return fn(); } finally { Math.random = real; }
}

// ── Registry ────────────────────────────────────────────────────────────────
test('acorn: is a T2 sapling that grows a maple, with a price, an effect line and a tip', () => {
  const it = ITEM_BY_ID.acorn;
  assert.truthy(it, 'acorn is registered');
  assert.eq(it.name, 'Acorn', 'name');
  assert.truthy(/^[A-Za-z ]+$/.test(it.name), 'the name is plain text — items never carry emoji');
  assert.eq(it.kind, 'sapling', 'kind — the plant gate and the single-stack rarity class key off it');
  assert.eq(it.grows, 'maple', 'grows a maple, not a fruit species');
  assert.eq(it.baseTier, 2, 'baseTier — the cheap common sapling');
  assert.eq(BASE_TIER.acorn, 2, 'BASE_TIER row');
  assert.eq(PRICES.acorn, 6, 'a sell price');
  assert.truthy(PRICES.acorn < PRICES.apple, 'cheaper than the apple it is shaken loose beside');
  assert.truthy(/maple/i.test(ITEM_EFFECTS.acorn || '') && /wood/i.test(ITEM_EFFECTS.acorn || ''),
    'ITEM_EFFECTS says what it grows and what that is for');
  // The acorn → maple → wood loop is on the item line; no Book tip restates it.
  assert.falsy(PLAY_TIPS.some(t => /\bAcorn\b/.test(t)), 'no Book tip restates the acorn');
});

test('acorn: the sapling registry knows maple, and only registered species survive the re-inject', () => {
  // items.js plantedTreeSpecies is what spawnInTile stamps a save.fruittrees
  // entry with — a sapling's `grows` registers its species by existing.
  assert.eq(plantedTreeSpecies('maple'), 'maple', 'the acorn\'s maple is a planted species');
  assert.eq(plantedTreeSpecies('apple'), 'apple');
  assert.eq(plantedTreeSpecies('peach'), 'peach');
  assert.eq(plantedTreeSpecies('pine'), 'apple', 'an unregistered species reverts to apple');
  assert.eq(plantedTreeSpecies(undefined), 'apple', 'a missing species reverts to apple');
  assert.truthy(/species: plantedTreeSpecies\(ft\.species\)/.test(SPAWN_IN_TILE_SRC),
    'spawnInTile stamps the species through plantedTreeSpecies');
  // The plant path itself is the sapling path, unchanged: the species stored
  // is the item's `grows`.
  assert.truthy(/save\.fruittrees\.push\(\{ x: cwmx, y: cwmy, species: item\.grows, planted_t, id \}\)/.test(INTERACT_SRC),
    'planting stores item.grows as the species');
});

test('acorn: two-table icon rule — MINERAL_ICON_SHEET → ICON_SHEETS → the props PNG, frame in range', () => {
  const src = MINERAL_ICON_SHEET.acorn;
  assert.truthy(src, 'MINERAL_ICON_SHEET.acorn');
  assert.eq(src.sheet, 'props', 'off the wilderness props sheet');
  const row = APP_JS_SRC.match(new RegExp(`\\n  ${src.sheet}:\\s*\\{ url: '([^']+)',\\s*cols: (\\d+),\\s*srcW: (\\d+),\\s*srcH: (\\d+) \\}`));
  assert.truthy(row, `ICON_SHEETS has a '${src.sheet}' row (else the icon falls through to Crops.png)`);
  const dims = pngDims(row[1]);
  assert.truthy(dims, `${row[1]} exists and is a PNG`);
  assert.eq(dims.w, Number(row[3]), 'srcW matches the file');
  assert.eq(dims.h, Number(row[4]), 'srcH matches the file');
  const cols = Number(row[2]), rows = dims.h / 16;
  assert.eq(dims.w / 16, cols, 'cols matches the file width in 16px cells');
  assert.inRange(src.frame, 0, cols * rows - 1, 'frame is on the sheet');
  // Row 6 col 14 is the capped acorn; its neighbours are pebble clusters and
  // a chestnut blob, so the index is pinned exactly (see the items.js note).
  assert.eq(src.frame, 6 * cols + 14, 'frame 146 — the acorn with a cap');
});

test('acorn: the rarity picker can hand one out of a nature chest', () => {
  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let seen = 0;
  for (let s = 1; s <= 3000; s++) {
    const r = pickReward('chest:park', { relics: {}, armor: {} }, seeded(s), { tier: 2 });
    if (r && r.kind === 'item' && r.id === 'acorn') seen++;
  }
  assert.truthy(seen > 0, 'acorn rolled at least once in 3000 T2 park chests');
});

// ── The render spec: a maple fruittree is drawn as the wild maple ───────────
// Evaluate the REAL fruittree RENDER_SPEC entry out of render.js, with the
// helpers it closes over (FRUIT_FRAMES, _ftSpec, _ftMaple, _mapleView,
// _ftStage) lifted from the same file, so the frames pinned here are the
// frames the game draws.
function liftFruittreeSpec() {
  const from = RENDER_SRC.indexOf('  const FRUIT_FRAMES = {');
  const to = RENDER_SRC.indexOf('  const _ftPicked');
  assert.truthy(from >= 0 && to > from, 'the fruit-tree helper block is where this test expects it');
  const helpers = RENDER_SRC.slice(from, to);
  const sFrom = RENDER_SRC.indexOf('    fruittree: { key: (o) =>');
  const sTo = RENDER_SRC.indexOf('    mineralrock: {');
  assert.truthy(sFrom >= 0 && sTo > sFrom, 'the fruittree RENDER_SPEC entry is where this test expects it');
  const body = `${helpers}\n  return ({\n${RENDER_SRC.slice(sFrom, sTo)}\n  }).fruittree;`;
  return new Function('scene', 'fruitList', 'inventoryIconSource', '_ftBearing', body)(
    { save: {} }, [], () => null, () => false);
}
const plantedMaple = (stage, over = {}) => ({
  kind: 'fruittree', id: 'pft_render', x: 0, y: 0, species: 'maple',
  planted: true, planted_t: Date.now() - stage * DAY - 1000, ...over,
});

test('acorn: the render spec resolves species maple to the trees sheet, frames 1/2/3 by stage', () => {
  const spec = liftFruittreeSpec();
  assert.eq(MAPLE_GROW_FRAMES.join(','), '1,1,2,2,3', 'stage 0..4 → maple frame');
  for (let stage = 0; stage <= PLANTED_TREE_STAGES; stage++) {
    const o = plantedMaple(stage);
    assert.eq(plantedTreeStage(o), stage, `stage ${stage} reads back from planted_t`);
    assert.eq(spec.key(o), 'trees', `stage ${stage}: the maple sheet, not a fruit sheet`);
    const frame = spec.frame(o);
    assert.eq(frame, MAPLE_GROW_FRAMES[stage], `stage ${stage}: frame from the one table`);
    assert.inRange(frame, 1, 3, `stage ${stage}: a live tree frame, never a stump (0/4)`);
    // The frame IS the one the wild `tree` spec would draw for the size-less
    // maple this stage stands for — one growth-stage read on both sides.
    assert.eq(frame, treeGrowthStage(plantedMapleView(o, stage)),
      `stage ${stage}: same frame as the wild maple it stands for`);
    // …and the scale is the wild maple's, not the fruit tree's 0.7→1.0 ramp.
    assert.eq(spec.scale(o), treeScale(plantedMapleView(o, stage)),
      `stage ${stage}: drawn at the wild maple's scale`);
    assert.eq(spec.scaleYMul(o), 1, `stage ${stage}: a tree keeps its proportions (no 1.10 stretch)`);
  }
  assert.eq(spec.frame(plantedMaple(0)), 1, 'sprout');
  assert.eq(spec.frame(plantedMaple(2)), 2, 'young');
  assert.eq(spec.frame(plantedMaple(4)), 3, 'mature');
  assert.eq(spec.seat, true, 'obeys the one-cell rule through the seat pass');
  // The fruit trees are untouched by the maple row.
  const apple = plantedMaple(4, { species: 'apple', id: 'pft_apple' });
  assert.eq(spec.key(apple), 'apple_tree');
  assert.eq(spec.frame(apple), 4, 'apple mature frame');
  assert.eq(spec.scaleYMul(apple), 1.10, 'fruit trees keep their stretch');
  const peach = plantedMaple(4, { species: 'peach', id: 'pft_peach' });
  assert.eq(spec.key(peach), 'peach_tree');
  assert.eq(spec.frame(peach), 3, 'peach mature frame');
});

test('acorn: a grown maple wears the tree tool-gate fade; a sprout hangs no fruit and no fade', () => {
  const spec = liftFruittreeSpec();
  const sprite = () => { const s = { alpha: null, setAlpha(a) { s.alpha = a; return s; } }; return s; };
  // Grown, no axe → the shared tool-gate alpha, exactly as the wild tree.
  let s = sprite();
  spec.after(s, plantedMaple(4), { save: axeSave(0) });
  assert.eq(s.alpha, TOOL_GATED_ALPHA, 'a grown maple fades when the axe is missing');
  assert.eq(s.alpha, toolGatedAlpha(plantedMapleView(plantedMaple(4), 4), axeSave(0)),
    'it is the tree\'s own gate over the maple it stands for');
  s = sprite();
  spec.after(s, plantedMaple(4), { save: axeSave(7) });
  assert.eq(s.alpha, 1, 'a grown maple with the axe in hand is not faded');
  // Growing: nothing to chop yet, so no fade — and never any fruit.
  s = sprite();
  spec.after(s, plantedMaple(1), { save: axeSave(0) });
  assert.eq(s.alpha, null, 'a sprout is not faded for a missing axe');
  assert.truthy(/!\(o\.kind === 'fruittree' && o\.chopped\)/.test(RENDER_SRC),
    'the object filter drops a felled maple the frame it is felled');
});

// ── Source: felling a wild tree ─────────────────────────────────────────────
function fellWildTree(o, save, random) {
  const msgs = [];
  const scene = makeScene({ flashLoot: (m) => msgs.push(m) });
  const res = withRandom(random, () => runInteractable(makeCtx(scene, save), o));
  assert.eq(res, true, 'tap consumed');
  return { scene, msgs };
}
const wildTree = (over = {}) => ({ kind: 'tree', id: plainId('acorn_src'), x: 0, y: 0, species: 'maple', size: 'large', ...over });

test('acorn: ACORN_DROP_P is a named constant the wild-tree chop rolls against', () => {
  assert.eq(ACORN_DROP_P, 0.25, 'one in four');
  assert.truthy(/const ACORN_DROP_P = 0\.25;/.test(INTERACTABLES_SRC), 'declared once, by name');
  assert.truthy(/treeDropsAcorn\(o\) && Math\.random\(\) < ACORN_DROP_P/.test(INTERACTABLES_SRC),
    'the tree entry rolls the named constant, not a literal');
});

test('acorn: felling a full-size wild tree drops one acorn under ACORN_DROP_P, none over it', () => {
  const under = fellWildTree(wildTree(), axeSave(7), ACORN_DROP_P - 0.01);
  assert.eq(under.scene.invCount('acorn'), 1, 'one acorn under the roll');
  assert.truthy(under.scene.invCount('wood') > 0, 'the wood still comes');
  assert.truthy(under.msgs.some(m => m === '+1 Acorn'), `its own +1 Acorn toast, got ${JSON.stringify(under.msgs)}`);
  assert.truthy(under.msgs.some(m => /^\+\d+ Wood$/.test(m)), 'the wood toast is separate');
  const over = fellWildTree(wildTree(), axeSave(7), ACORN_DROP_P + 0.01);
  assert.eq(over.scene.invCount('acorn'), 0, 'no acorn over the roll');
  assert.truthy(over.scene.invCount('wood') > 0, 'the wood still comes');
  assert.falsy(over.msgs.some(m => /Acorn/.test(m)), 'no acorn toast');
});

test('acorn: only a tree at its mature canopy has one to drop — never a bush, sprout or small tree', () => {
  // Size classes (treeSizeClass): large→full, medium→medium drop; small and
  // bush do not; a size-less forest maple drops only once its frame is the
  // mature canopy (variant 3), not as a sprout (1) or a young tree (2).
  const drops = (over) => fellWildTree(wildTree(over), axeSave(7), 0).scene.invCount('acorn');
  assert.eq(drops({ size: 'large' }), 1, 'full');
  assert.eq(drops({ size: 'medium' }), 1, 'medium');
  assert.eq(drops({ size: 'small' }), 0, 'small');
  assert.eq(drops({ size: 'bush' }), 0, 'bush');
  assert.eq(drops({ size: undefined, variant: 3 }), 1, 'size-less mature maple (frame 3)');
  assert.eq(drops({ size: undefined, variant: 1 }), 0, 'size-less sprout (frame 1)');
  assert.eq(drops({ size: undefined, variant: 2 }), 0, 'size-less young maple (frame 2)');
  assert.eq(drops({ species: 'pine', size: 'large' }), 1, 'any species — the acorn is the sapling, not the pine cone');
});

// ── The planted maple: a tap on the fruittree ──────────────────────────────
const NOW = 1.7e12;
// A grown maple standing on a live tile, with its save.fruittrees entry.
function grownMaple(save, over = {}) {
  const id = plainId('pft_maple');
  const o = { kind: 'fruittree', id, x: 12, y: 12, species: 'maple', planted: true,
              planted_t: NOW - MATURE_MS - 1000, ...over };
  save.fruittrees = [{ id, x: o.x, y: o.y, species: 'maple', planted_t: o.planted_t },
                     { id: 'pft_other', x: 99, y: 99, species: 'apple', planted_t: 0 }];
  return o;
}
function tapMaple(o, save, sceneOver = {}) {
  const calls = { flash: [], loot: [], work: [], spent: [] };
  const scene = makeScene({
    flash: (m) => calls.flash.push(m),
    flashLoot: (m) => calls.loot.push(m),
    spendEnergy: (n) => { calls.spent.push(n); return true; },
    startWorkProgress: (x, y, cb, durMs, cost, tool) => { calls.work.push({ x, y, durMs, cost, tool }); if (cb) cb(); },
    ...sceneOver,
  });
  const ctx = makeCtx(scene, save);
  const res = atTime(NOW, () => runInteractable(ctx, o));
  return { res, scene, ctx, calls };
}

test('acorn: a mature maple is chopped for wood through the tree entry, and its entry leaves save.fruittrees', () => {
  const save = axeSave(7);
  const o = grownMaple(save);
  // Stand it in a live tile so the object removal can be watched too.
  const key = WorldGen.tileKey(0, 0);
  const entry = { objects: [{ kind: 'tree', id: 'bystander' }, o] };
  WorldGen.tileCache.set(key, entry);
  try {
    const { res, scene, ctx, calls } = tapMaple(o, save);
    assert.eq(res, true, 'tap consumed');
    // The wild `tree` entry's own numbers, over the size-less maple the sapling
    // stands for at maturity — none of them re-stated.
    const view = plantedMapleView(o, PLANTED_TREE_STAGES);
    const wild = { kind: 'tree', species: 'maple', variant: 3 };   // the forest maple drawn from frame 3
    assert.eq(treeSizeClass(view), treeSizeClass(wild), 'classes as the wild maple it draws like');
    assert.eq(calls.work.length, 1, 'one work wheel');
    assert.eq(calls.work[0].tool, 'axe', 'an axe job');
    assert.eq(calls.work[0].durMs, toolDurationMs(save.relics, 'axe'), 'the tree\'s wheel duration');
    assert.eq(calls.work[0].cost, effectiveChopCost(save.relics, wild), 'the tree\'s chop energy');
    assert.eq(calls.spent[0], effectiveChopCost(save.relics, wild), 'spent up front like any chop');
    const wood = scene.invCount('wood');
    const mul = treeWoodMul(wild);
    assert.truthy(wood === 2 * mul || wood === 3 * mul, `wood ${wood} is randInt(2,3) × the wild maple's ${mul}×`);
    assert.eq(scene.invCount('apple'), 0, 'no fruit — it was never a fruit tree');
    assert.eq(scene.invCount('maple'), 0, 'no "maple" item either');
    assert.truthy(calls.loot.some(m => m === `+${wood} Wood`), `the toast prints the real count, got ${JSON.stringify(calls.loot)}`);
    // treeSpeciesName calls a maple a 'hardwood', as the wild tree's flash does.
    assert.truthy(calls.flash.some(m => /Felled/.test(m) && m.includes(treeSpeciesName(wild))),
      `says it was felled, got ${JSON.stringify(calls.flash)}`);
    // Gone: from the save (so no rebuild or spawnInTile re-injects it), from
    // the tile, and flagged for the frame between.
    assert.eq(o.chopped, true, 'flagged felled');
    assert.eq(o.species, 'maple', 'never repaired into an apple');
    assert.eq(save.fruittrees.length, 1, 'its save.fruittrees entry is gone');
    assert.eq(save.fruittrees[0].id, 'pft_other', 'the other planted tree is untouched');
    assert.falsy(entry.objects.some(x => x.id === o.id), 'the object is out of the tile');
    assert.truthy(entry.objects.some(x => x.id === 'bystander'), 'nothing else left the tile');
    assert.falsy((save.chopped || []).includes(o.id), 'no stump marker — the cell is free to plant again');
    assert.eq(ctx.dirty, true, 'the save is marked dirty');
    // A second tap on the not-yet-swept object is a no-op, like a stump.
    assert.eq(tapMaple(o, save).res, 'skip', 'a felled maple is skipped');
  } finally { WorldGen.tileCache.delete(key); }
});

test('acorn: a mature maple demands the wild maple\'s axe tier', () => {
  const wild = { kind: 'tree', species: 'maple', variant: 3 };
  const need = treeAxeReqTier(wild);
  assert.truthy(need >= 2, `a hardwood maple wants a real axe (tier ${need})`);
  const save = axeSave(0);
  const o = grownMaple(save);
  const { res, scene, calls } = tapMaple(o, save);
  assert.eq(res, true, 'tap consumed');
  assert.eq(calls.work.length, 0, 'no wheel');
  assert.eq(scene.invCount('wood'), 0, 'no wood');
  assert.truthy(calls.flash.some(m => /axe/i.test(m) && m.includes(treeSpeciesName(wild))),
    `refused for the axe, got ${JSON.stringify(calls.flash)}`);
  assert.truthy(calls.flash.some(m => m.includes(TIER_BY_NUM[need].name)), 'names the axe tier it wants');
  assert.eq(save.fruittrees.length, 2, 'still planted');
  assert.eq(o.chopped, undefined, 'still standing');
});

test('acorn: an immature maple refuses with a shortDuration wait', () => {
  const cases = [
    [60 * 60 * 1000,           '4d'],   // an hour in: 95h left → 4d
    [MATURE_MS - 12 * 3600e3,  '12h'],  // half a day left
    [MATURE_MS - 1000,         '1s'],   // the last second still refuses
  ];
  for (const [elapsed, want] of cases) {
    const save = axeSave(7);
    const o = grownMaple(save, { planted_t: NOW - elapsed });
    assert.truthy(plantedTreeStage(o, NOW) < PLANTED_TREE_STAGES, 'not yet mature');
    const { res, scene, calls } = tapMaple(o, save);
    assert.eq(res, true, 'tap consumed');
    assert.eq(calls.flash[0], `Still growing — ${want}`, `elapsed ${elapsed}: the wait in shortDuration notation`);
    assert.eq(calls.flash[0], `Still growing — ${shortDuration(MATURE_MS - elapsed)}`, 'formatted by the one helper');
    assert.truthy(/^Still growing — \d+[smhd]$/.test(calls.flash[0]), 'largest unit, integer, one letter');
    assert.eq(calls.work.length, 0, 'no wheel');
    assert.eq(scene.invCount('wood'), 0, 'no wood');
    assert.eq(save.fruittrees.length, 2, 'still planted');
    assert.eq(o.species, 'maple', 'still a maple');
  }
  // Exactly at maturity the wait is over and the chop runs.
  const save = axeSave(7);
  const o = grownMaple(save, { planted_t: NOW - MATURE_MS });
  const { calls } = tapMaple(o, save);
  assert.eq(calls.work.length, 1, 'at maturity the wheel starts');
  assert.truthy(/function plantedMapleTap[\s\S]*?shortDuration\(/.test(INTERACTABLES_SRC),
    'the maple tap formats its wait with shortDuration');
});

test('acorn: the growth clock is the fruit saplings\' — one table, no literal day', () => {
  assert.eq(PLANTED_TREE_STAGE_MS, 24 * 60 * 60 * 1000, 'a day per stage');
  assert.eq(PLANTED_TREE_STAGES, 4, 'four stages to maturity');
  // The apple's own wait reads the same two numbers.
  assert.truthy(/const matureMs = PLANTED_TREE_STAGES \* PLANTED_TREE_STAGE_MS;/.test(INTERACTABLES_SRC),
    'the fruit path gates on the shared clock');
  assert.falsy(/FRUIT_STAGE_MS/.test(INTERACTABLES_SRC), 'no private stage constant in the handler');
  assert.falsy(/FRUIT_STAGE_MS/.test(RENDER_SRC), 'no private stage constant in the renderer');
  assert.truthy(/const _ftStage = \(o\) => plantedTreeStage\(o\);/.test(RENDER_SRC),
    'the renderer reads the stage from the same function the handler gates on');
});

test('acorn: the species repair never fires for a maple — it is the tap\'s first branch', () => {
  // A maple that was never planted (no planted_t, as a stale wild stamp
  // would be) is still a maple: it is felled, and never turned into an apple.
  const save = axeSave(7);
  const o = { kind: 'fruittree', id: plainId('ft_wild_maple'), x: 84, y: 0, species: 'maple', wild: true };
  const { res, scene } = tapMaple(o, save);
  assert.eq(res, true, 'tap consumed');
  assert.eq(o.species, 'maple', 'stays a maple');
  assert.eq(scene.invCount('apple'), 0, 'hands out no apple');
  assert.truthy(scene.invCount('wood') > 0, 'hands out wood');
  // And in the source, the maple branch precedes the repair line.
  const ft = INTERACTABLES_SRC.slice(INTERACTABLES_SRC.indexOf('  fruittree: {'));
  const branch = ft.indexOf("if (o.species === 'maple') return plantedMapleTap(ctx, o);");
  const repair = ft.indexOf("o.species = 'apple';");
  assert.truthy(branch >= 0, 'the maple branch exists');
  assert.truthy(repair > branch, 'the repair comes after it');
});
})();
