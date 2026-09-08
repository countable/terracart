// A WILD PLANT SAYS WHAT IT IS, AND ONE TABLE SAYS WHAT IT DOES.
//
// Two shapes were tangled together here until Sep 2026.
//
// 1. `entry.wildplants` records carried `{x, y, crop, _ix, _iy, id}` and NO
//    `kind`, so the only way to recognise one was the ABSENCE of a kind:
//    `Lighting.sourceKind` tested `o.kind === undefined && o.crop`. That is a
//    field's absence standing in for a fact, and it could only be fixed at
//    every mint site at once — there were seven, across worldgen.js, app.js
//    and sandbox.js, and nothing would have reminded the eighth. So each of a
//    tile's three streams (`objects`, `wildplants`, `creatures`) has ONE
//    factory now — `WorldGen.makeWildplant` / `makeCreature` / `makeObject` —
//    and a field every record of a stream must carry lands there, once.
//    (The ID is still the caller's: the save's delta lists key off ids that
//    must be a pure function of position, so a re-rasterized or rebuilt tile
//    reproduces them exactly. A factory takes an id; it never mints one.)
//
// 2. What a wild plant DOES was five one-row literals in four files —
//    `HARVEST_OUTPUT = { shrub: 'wood' }`, `WORK_RELIC = { rockfruit: 'pick',
//    shrub: 'axe' }` and a `wp.crop === 'shrub'` cost ternary in interact.js,
//    `WILD_TREASURE` in loot.js, and `crop === 'mushroom'` in BOTH
//    lighting.js' sourceKind and render.js' light-offer gate. One table now:
//    items.js' `WILDPLANT_RULES`, beside `CROP_SPRITE` (which is already keyed
//    on crop and says what the same plant LOOKS like), read through small
//    accessors. A second glowing plant is one row, not five edits.
//
// These tests drive the real rasterizer, the real accessors and the real
// `sourceKind`, and pin the three readers as source text.

(function () {
const T = WorldGen.T;

// ── One real tile, rasterized ─────────────────────────────────────────────
// A whole-tile wood polygon: T.FOREST's flora profile scatters shrub, nut,
// mushroom, wildrose and starflower, so one build exercises the glowing crop,
// the chopped one and several with no row in the table at all.
const CPE = 64;
const TILE_EDGE_M = CPE * 7;
const EXTENT = 4096;
const CELL_MVT = EXTENT / CPE;
const TX = 2799, TY = 6544;
const cellToMvt = (c) => c * CELL_MVT + CELL_MVT / 2;
const ring = (cells) => cells.map(([cx, cy]) => ({ x: cellToMvt(cx), y: cellToMvt(cy) }));
const wholeTile = () => ring([[0, 0], [CPE - 1, 0], [CPE - 1, CPE - 1], [0, CPE - 1]]);
const woodLayers = () => [
  { name: 'landcover', features: [
    { type: 3, tags: { class: 'wood' }, geom: [wholeTile()] },
  ] },
];
const wood = WorldGen.rasterizeTile(woodLayers(), CPE, TX, TY, TILE_EDGE_M);

// --- 1. Every wild plant carries the stream's kind -------------------------

test('wildplant: a real rasterize stamps kind on every record', () => {
  const plants = wood.wildplants || [];
  assert.gt(plants.length, 0, 'a wood tile scatters wild plants');
  const crops = new Set(plants.map((w) => w.crop));
  assert.gt(crops.size, 1, 'and more than one crop of them');
  for (const w of plants) {
    assert.eq(w.kind, 'wildplant', `${w.id} says which stream it is from`);
    assert.truthy(w.crop, `${w.id} still carries its crop`);
    assert.truthy(w.id, 'and its positional id');
  }
});

test('wildplant: the factory is the shape, and the id stays the caller\'s', () => {
  const wp = WorldGen.makeWildplant('mushroom', 12, 34, 'wp_1_2_3_4', { _ix: 3, _iy: 4 });
  assert.eq(wp.kind, 'wildplant', 'the kind comes from the factory');
  assert.eq(wp.crop, 'mushroom', 'the crop from the caller');
  assert.eq(wp.x, 12, 'x'); assert.eq(wp.y, 34, 'y');
  assert.eq(wp.id, 'wp_1_2_3_4', 'the id is passed IN — a factory never mints one');
  assert.eq(wp._ix, 3, 'extras ride along'); assert.eq(wp._iy, 4, 'both of them');
  // The other two streams, same deal.
  const c = WorldGen.makeCreature('slime', 1, 2, 'slime_0_0_1', { shiny: true });
  assert.eq(c.kind, 'slime', 'a creature is its own kind'); assert.eq(c.id, 'slime_0_0_1', 'id');
  assert.eq(c.shiny, true, 'extras ride along');
  const o = WorldGen.makeObject('tree', 5, 6, 'tree_5_6', { species: 'pine' });
  assert.eq(o.kind, 'tree', 'an object is its own kind'); assert.eq(o.species, 'pine', 'extras');
});

test('wildplant: nothing mints one by hand any more', () => {
  // The point of the factory is that a new field cannot miss a site. A bare
  // object literal pushed into a wildplant stream is that miss coming back.
  for (const [name, src] of [['worldgen.js', WORLDGEN_SRC], ['app.js', APP_JS_SRC],
                             ['interact.js', INTERACT_SRC]]) {
    assert.falsy(/wildplants\.push\(\{/.test(src), `${name} mints a wildplant by hand`);
    assert.falsy(/creatures\.push\(\{/.test(src), `${name} mints a creature by hand`);
  }
  assert.truthy(/makeWildplant\(/.test(WORLDGEN_SRC), 'worldgen mints through the factory');
  assert.truthy(/WorldGen\.makeCreature\(/.test(APP_JS_SRC), 'app.js mints creatures through it');
  // The rasterized ids are unchanged by the refactor — the delta lists
  // (save.picked) key off them, so a rebuilt tile must reproduce them exactly.
  const again = WorldGen.rasterizeTile(woodLayers(), CPE, TX, TY, TILE_EDGE_M);
  assert.eq(JSON.stringify(again.wildplants.map((w) => w.id)),
    JSON.stringify(wood.wildplants.map((w) => w.id)),
    'same tile, same ids, in the same order');
});

// --- 2. The table reproduces the literals it replaced ----------------------

test('wildplant table: the old one-row maps, re-read from the table', () => {
  // HARVEST_OUTPUT = { shrub: 'wood' }
  assert.eq(wildplantOutput('shrub'), 'wood', 'a bush drops the wood mineral');
  // WORK_RELIC = { rockfruit: 'pick', shrub: 'axe' }
  assert.eq(wildplantWorkRelic('shrub'), 'axe', 'a bush is felling work');
  assert.eq(wildplantWorkRelic('rockfruit'), 'pick', 'debris is rock work');
  // The `crop === 'mushroom'` light literals (lighting.js + render.js).
  assert.eq(wildplantLight('mushroom'), 'mushroom', 'a mushroom is a light');
  assert.eq(wildplantLight('shrub'), null, 'a bush is not');
  // WILD_TREASURE = { rockfruit: { chance: 0.1, bonus: 'gemfruit' } }
  const t = wildplantTreasure('rockfruit');
  assert.eq(t && t.bonus, 'gemfruit', 'debris still hides a gemfruit');
  assert.eq(t && t.chance, 0.1, 'at the same rate');
  assert.eq(wildplantTreasure('shrub'), null, 'and nothing else hides anything');
});

test('wildplant table: an unlisted crop is the ordinary wild plant', () => {
  // The default is the whole point: the vast majority of crops have no row,
  // and every one of them must behave exactly as it did before the table.
  for (const crop of ['longgrass', 'nut', 'shell', 'wildrose', 'marigold', 'rainberry']) {
    assert.eq(wildplantRule(crop), null, `${crop} has no row`);
    assert.eq(wildplantOutput(crop), crop, `${crop} drops itself`);
    assert.eq(wildplantWorkRelic(crop), null, `${crop} is picked instantly`);
    assert.eq(wildplantWorkCost(crop, { axe: { tier: 0 } }), 0, `${crop} is free`);
    assert.eq(wildplantTreasure(crop), null, `${crop} hides nothing`);
    assert.eq(wildplantLight(crop), null, `${crop} does not glow`);
  }
});

test('wildplant table: the work cost is the shared 9/3/1 tool curve', () => {
  // Not a second ladder — the same toolEnergyExpected every other gated job
  // spends on, read off the crop's OWN relic. rng is injected so probEnergy's
  // fractional tiers pin exactly.
  const lo = () => 0, hi = () => 0.999;
  assert.eq(wildplantWorkCost('shrub', {}, lo), 9, 'bare-handed chop is 9');
  assert.eq(wildplantWorkCost('shrub', { axe: { tier: 1 } }, lo), 3, 'a Wood axe is 3');
  assert.eq(wildplantWorkCost('shrub', { axe: { tier: 7 } }, lo), 1, 'a Frost axe is 1');
  assert.eq(wildplantWorkCost('shrub', { pick: { tier: 7 } }, lo), 9,
    'and it reads the AXE tier, not whatever else is worn');
  // A relic-gated crop that is not CHARGED stays free: gathering loose rubble
  // off the ground costs nothing, it is only slow.
  assert.eq(wildplantWorkCost('rockfruit', { pick: { tier: 0 } }, hi), 0, 'debris is free to gather');
});

// --- 3. The light asks the table, on both sides ----------------------------

test('wildplant: sourceKind reads the kind and the table, not a literal', () => {
  const scene = { save: {}, isClaimedKey: () => false };
  assert.eq(Lighting.sourceKind(scene,
    WorldGen.makeWildplant('mushroom', 0, 0, 'wp_0_0_1_1')), 'mushroom',
    'a mushroom wild plant lights');
  assert.eq(Lighting.sourceKind(scene,
    WorldGen.makeWildplant('shrub', 0, 0, 'wp_0_0_2_2')), null,
    'a shrub does not');
  // A REAL one, off the rasterized tile above — the record the renderer offers.
  const shroom = (wood.wildplants || []).find((w) => w.crop === 'mushroom');
  assert.truthy(shroom, 'the wood tile grew a mushroom');
  assert.eq(Lighting.sourceKind(scene, shroom), 'mushroom', 'and it glows as it stands');
});

test('wildplant: the three readers hold no per-crop literal of their own', () => {
  // The literals this refactor removed, by the shape they had. `p.crop ===
  // 'potato'` in interact.js is deliberately NOT covered: that is the PLANTED
  // crop's stage name (POTATO_STAGE_NAMES), a growing-crop fact, not a wild
  // plant's rule.
  for (const [name, src] of [['interact.js', INTERACT_SRC], ['lighting.js', LIGHTING_SRC],
                             ['render.js', RENDER_SRC]]) {
    assert.falsy(/wp\.crop === '/.test(src), `${name} still branches on a wildplant crop`);
    assert.falsy(/\.crop === 'mushroom'/.test(src), `${name} still knows which crop glows`);
    assert.falsy(/\.crop === 'shrub'/.test(src), `${name} still knows which crop is chopped`);
  }
  assert.falsy(/const (HARVEST_OUTPUT|WORK_RELIC|WILD_TREASURE)\b/.test(INTERACT_SRC),
    'interact.js keeps no per-crop map of its own');
  assert.falsy(/const WILD_TREASURE/.test(LOOT_SRC), 'loot.js keeps no second one');
  assert.truthy(/wildplantOutput\(|wildplantWorkRelic\(|wildplantWorkCost\(/.test(INTERACT_SRC),
    'the tap handler reads the table');
  assert.truthy(/wildplantLight\(/.test(LIGHTING_SRC), 'sourceKind reads the table');
  assert.truthy(/wildplantLight\(/.test(RENDER_SRC), 'and so does the light-offer gate');
});
})();
