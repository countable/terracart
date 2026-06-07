// Headless tests for the entity-driven interactable registry (src/interactables.js).
// These drive runInteractable() against a stub scene and assert the declared
// gate / tool-timer / loot behaviour, plus the gather-luck flag.

// --- Tree -------------------------------------------------------------------
test('tree: chop yields randInt(2,3) × woodMul and marks the stump', () => {
  const scene = makeScene();
  const save = { relics: { axe: { tier: 7 } }, chopped: [] };
  const o = { kind: 'tree', id: 'tree-1', x: 0, y: 0 };
  const mul = treeWoodMul(o);
  const res = runInteractable(makeCtx(scene, save), o);
  assert.eq(res, true, 'tap consumed');
  assert.truthy(o.chopped, 'tree marked chopped');
  assert.includes(save.chopped, 'tree-1', 'stump persisted to save.chopped');
  assert.inRange(scene.invCount('wood'), 2 * mul, 3 * mul, 'wood yield in [2,3]×mul');
});

test('tree: an already-chopped stump returns "skip" (falls through)', () => {
  const scene = makeScene();
  const save = { relics: { axe: { tier: 7 } }, chopped: ['tree-2'] };
  const o = { kind: 'tree', id: 'tree-2', x: 0, y: 0 };
  assert.eq(runInteractable(makeCtx(scene, save), o), 'skip', 'skip, not consume');
  assert.eq(scene.invCount('wood'), 0, 'no wood from a spent stump');
});

test('tree: too-weak axe is gated (no wood, tap consumed)', () => {
  const scene = makeScene();
  // A shiny tree demands a Gold axe regardless of size; tier-1 axe should bounce.
  const save = { relics: { axe: { tier: 1 } }, chopped: [] };
  const o = { kind: 'tree', id: 'tree-3', x: 0, y: 0, species: 'maple' };
  if (treeAxeReqTier(o) <= 1) return;   // only meaningful when the tree out-tiers the axe
  assert.eq(runInteractable(makeCtx(scene, save), o), true, 'tap consumed by gate');
  assert.eq(scene.invCount('wood'), 0, 'gated chop yields nothing');
  assert.falsy(o.chopped, 'gated tree is not felled');
});

// --- Mineral rock -----------------------------------------------------------
test('mineralrock: ore is gated behind the pick tier', () => {
  const scene = makeScene();
  const save = { relics: { pick: { tier: 1 } } };       // too weak for a T4 deposit
  const o = { kind: 'mineralrock', id: 'mr-1', x: 0, y: 0, yieldTier: 4 };
  assert.eq(runInteractable(makeCtx(scene, save), o), true, 'tap consumed by gate');
  assert.eq(scene.invCount('gold_bar'), 0, 'gated ore drops no bar');
  assert.falsy(scene.brokenRockSet.has('mr-1'), 'gated rock is not broken');
});

test('mineralrock: plain rock drops 1-3 rockfruit and breaks', () => {
  const scene = makeScene();
  const save = { relics: { pick: { tier: 7 } } };
  const o = { kind: 'mineralrock', id: 'mr-2', x: 0, y: 0, yieldTier: 1 };
  assert.eq(runInteractable(makeCtx(scene, save), o), true);
  assert.inRange(scene.invCount('rockfruit'), 1, 3, 'plain rock = 1-3 stone');
  assert.truthy(scene.brokenRockSet.has('mr-2'), 'rock recorded as broken');
});

test('mineralrock: T4 ore yields exactly one namesake bar + coal', () => {
  const scene = makeScene();
  const save = { relics: { pick: { tier: 7 } } };
  const o = { kind: 'mineralrock', id: 'mr-3', x: 0, y: 0, yieldTier: 4 };
  runInteractable(makeCtx(scene, save), o);
  assert.eq(scene.invCount('gold_bar'), 1, 'T4 → one gold bar');
  assert.gte(scene.invCount('coal'), 1, 'ore also drops coal');
});

test('mineralrock: a broken rock is a no-op (consumes, no double loot)', () => {
  const scene = makeScene();
  const save = { relics: { pick: { tier: 7 } } };
  scene.brokenRockSet.add('mr-4');
  const o = { kind: 'mineralrock', id: 'mr-4', x: 0, y: 0, yieldTier: 4 };
  assert.eq(runInteractable(makeCtx(scene, save), o), true, 'spent rock consumes the tap');
  assert.eq(scene.invCount('gold_bar'), 0, 'no loot from an already-broken rock');
});

// --- Fruit tree -------------------------------------------------------------
test('fruittree: harvest yields 1-2 fruit, then is respawn-gated', () => {
  const scene = makeScene();
  const save = {};
  const o = { kind: 'fruittree', id: 'ft-1', x: 0, y: 0, species: 'apple' };
  assert.eq(runInteractable(makeCtx(scene, save), o), true);
  assert.inRange(scene.invCount('apple'), 1, 2, 'first pick = 1-2 fruit');
  // Immediate second tap: within the 24h window, so no extra fruit.
  runInteractable(makeCtx(scene, save), o);
  assert.inRange(scene.invCount('apple'), 1, 2, 'respawn gate blocks a second pick');
});

// --- Gather luck flag -------------------------------------------------------
test('gather luck: OFF by default → zeroed multipliers', () => {
  assert.eq(gatherLuckEnabled(), false, 'flag defaults off');
  const lk = gatherLuck({ relics: { ring: { tier: 7 }, amulet: { tier: 7 } } }, ['ring', 'amulet']);
  assert.eq(lk.tierP, 0, 'no ring tierP when off');
  assert.eq(lk.bonusP, 0, 'no amulet bonusP when off');
});

test('gather luck: ON wires declared ring/amulet into the roll', () => {
  // ringLuck / amuletBracketChance are IIFE-private in rarity.js; inject stubs
  // so gatherLuck (which resolves them as free globals) can read them.
  globalThis.ringLuck = () => 0.5;
  globalThis.amuletBracketChance = () => 1;   // always grant the bonus
  globalThis.window.GATHER_LUCK_ENABLED = true;
  try {
    const lk = gatherLuck({ relics: {} }, ['ring', 'amulet']);
    assert.eq(lk.tierP, 0.5, 'ring tierP wired through');
    assert.eq(lk.bonusP, 1, 'amulet bonusP wired through');
    // A fruit harvest with bonusP=1 always adds the +1 bonus fruit → 2-3.
    const scene = makeScene();
    const o = { kind: 'fruittree', id: 'ft-luck', x: 0, y: 0, species: 'apple' };
    runInteractable(makeCtx(scene, {}), o);
    assert.inRange(scene.invCount('apple'), 2, 3, 'amulet bonus fruit applied');
  } finally {
    globalThis.window.GATHER_LUCK_ENABLED = false;   // restore for later tests
    delete globalThis.ringLuck;
    delete globalThis.amuletBracketChance;
  }
});

test('registry: unknown kinds are not handled (driver returns false)', () => {
  const scene = makeScene();
  assert.eq(runInteractable(makeCtx(scene, {}), { kind: 'not-a-thing', id: 'x' }), false);
});
