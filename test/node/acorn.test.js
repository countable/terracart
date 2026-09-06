// The ACORN: what a better axe buys you besides speed and cheap swings.
//
// Felling a tree can leave an acorn — a sapling that plants a new TIMBER tree
// (not a fruit tree), so clearing a wood is not a one-way trade. The chance is
// the axe's: 5% bare-handed up to 25% with a Frost axe. The tree it plants
// grows on the clock, and one function (treeGrowthStage) hands that stage to
// the renderer, the axe gate and the wood yield alike.

test('acorn: the drop chance runs 5% bare-handed to 25% at Frost', () => {
  assert.eq(acornDropChance(null), ACORN_P_BASE, 'no relics at all = bare hands');
  assert.eq(acornDropChance({}), ACORN_P_BASE, 'no axe = bare hands');
  assert.eq(acornDropChance({ axe: { tier: 0 } }), 0.05, 'tier 0 is the 5% floor');
  assert.eq(Math.round(acornDropChance({ axe: { tier: 7 } }) * 1000) / 1000, 0.25,
    'a Frost axe is the 25% ceiling');
  assert.eq(ACORN_P_BASE, 0.05, 'the floor is a named number');
  assert.eq(ACORN_P_FROST, 0.25, 'and so is the ceiling');
});

test('acorn: every rung of the axe is worth something, and none overshoots', () => {
  let prev = -1;
  for (let tier = 0; tier <= 7; tier++) {
    const p = acornDropChance({ axe: { tier } });
    assert.truthy(p > prev, `T${tier} (${p}) must beat T${tier - 1} (${prev})`);
    assert.inRange(p, ACORN_P_BASE, ACORN_P_FROST, `T${tier} stays inside the ladder`);
    prev = p;
  }
  // The ladder is linear, so the middle rung sits exactly halfway.
  const mid = acornDropChance({ axe: { tier: 3.5 } });
  assert.lt(Math.abs(mid - (ACORN_P_BASE + ACORN_P_FROST) / 2), 1e-9, 'linear between the ends');
});

test('acorn: a tier past Frost cannot push the chance past the ceiling', () => {
  // Nothing issues a tier 8 today, but the speed potion mints a synthetic tier
  // for the amulet — clamp rather than let a future one run the roll over 1.
  assert.eq(acornDropChance({ axe: { tier: 99 } }), ACORN_P_FROST, 'clamped at Frost');
  assert.eq(acornDropChance({ axe: { tier: -3 } }), ACORN_P_BASE, 'and at bare hands');
});

test('acorn: it is a sapling that plants TIMBER, not fruit', () => {
  const acorn = ITEM_BY_ID.acorn;
  assert.truthy(acorn, 'the item exists');
  assert.eq(acorn.kind, 'sapling', 'it goes down the sapling plant path');
  assert.eq(acorn.plants, 'tree', 'and that path branches to a tree, not a fruittree');
  assert.falsy(acorn.grows,
    'no species: a species-less tree draws off the default sheet and takes no hardwood tier shift');
});

test('acorn: a planted tree grows sprout → young → mature over the four-day window', () => {
  const W = PLANTED_TREE_GROW_MS;
  assert.eq(W, 4 * 24 * 60 * 60 * 1000, 'the same four days a fruit sapling takes');
  const t0 = 1_000_000;
  assert.eq(plantedTreeStage(t0, t0), 1, 'just planted — a sprout');
  assert.eq(plantedTreeStage(t0, t0 + W * 0.49), 1, 'still a sprout just before halfway');
  assert.eq(plantedTreeStage(t0, t0 + W * 0.5), 2, 'young at the halfway mark');
  assert.eq(plantedTreeStage(t0, t0 + W * 0.99), 2, 'still young just before the window');
  assert.eq(plantedTreeStage(t0, t0 + W), 3, 'mature at the window');
  assert.eq(plantedTreeStage(t0, t0 + W * 50), 3, 'and never past mature');
});

test('acorn: treeGrowthStage reads the clock for a planted tree, `variant` for a wild one', () => {
  const W = PLANTED_TREE_GROW_MS;
  // A wild tree is unaffected — its stage is still the static variant.
  assert.eq(treeGrowthStage({ variant: 1 }), 1, 'wild sprout');
  assert.eq(treeGrowthStage({ variant: 3 }), 3, 'wild mature');
  assert.eq(treeGrowthStage({}), 2, 'no variant at all still defaults to young');
  // A planted one answers to planted_t, whatever variant it may also carry.
  assert.eq(treeGrowthStage({ planted_t: Date.now(), variant: 3 }), 1,
    'a tree planted just now is a sprout even if a variant came along for the ride');
  assert.eq(treeGrowthStage({ planted_t: Date.now() - W - 1 }), 3, 'and mature once the window is out');
});

test('acorn: the growth stage moves the axe gate and the wood yield with the art', () => {
  // One function feeds all three, so a sprout cannot draw tiny and fell like a
  // full canopy. A species-less planted tree takes no hardwood/softwood shift.
  const W = PLANTED_TREE_GROW_MS;
  const sprout = { kind: 'tree', planted_t: Date.now(), id: 'ptr_1' };
  const grown  = { kind: 'tree', planted_t: Date.now() - W - 1, id: 'ptr_2' };
  assert.eq(treeSizeClass(sprout), 'small', 'a sapling is a small tree');
  assert.eq(treeSizeClass(grown), 'medium', 'a mature one is a medium');
  assert.eq(treeWoodMul(sprout), 1, 'and pays a small tree\'s wood');
  assert.eq(treeWoodMul(grown), 2, 'against double for the grown one');
  assert.truthy(treeAxeReqTier(grown) >= treeAxeReqTier(sprout),
    'waiting for it to grow never makes it EASIER to fell');
});

test('acorn: the fell rolls it, says so, and retires a felled planted tree', () => {
  const src = INTERACTABLES_SRC;
  assert.truthy(/Math\.random\(\) < acornDropChance\(save\.relics\)/.test(src),
    'the drop is rolled off the axe tier, not a flat constant');
  assert.truthy(/scene\.addToInv\('acorn', 1\)/.test(src), 'and it goes in the bag');
  assert.truthy(/if \(gotAcorn\) scene\.flashLoot\(/.test(src),
    'a drop the player is never told about is a drop that did not happen');
  assert.truthy(/save\.fruittrees = save\.fruittrees\.filter\(f => f\.id !== o\.id\)/.test(src),
    'felling a PLANTED tree retires its record so spawnInTile stops rebuilding it');
});
