// spec_pins.test.js — pins actual code behaviour against spec-audit-2026-05-31.md
// findings. Where code diverges from spec the assertion targets the CURRENT
// (possibly-buggy) behaviour and is tagged SPEC BUG. Where code matches spec,
// the assertion is the spec value and should stay green.
//
// Browser-harness-only findings (app.js-only, not headless-reachable):
//   #3  Path-stone reward mechanic (app.js:4593-4602)
//   #4  Grassland half-time tilling (app.js, no biome branch in interact's till)
//   #5  Fauna-on-roads (app.js:2117, 2217, 2441 wander gates)
//
// Findings not reachable without a bridge:
//   #8  shopSellBonus — function was removed from shops.js entirely;
//       Shops namespace exposes only shopType/shopInk/toRoman (shopLabel and
//       shopTint were themselves later removed as dead code — render.js
//       never called either).
//       No bridging needed — its absence IS the finding (never wired, now gone).

// ─── Deterministic PRNG (mulberry32, copied from loot.test.js) ───────────────
function seededPrng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FINDING #1 — Armor equip must bump current energy by the delta
// Spec (ENERGY & FOOD): "Equipping better armor bumps current energy by the
// delta too."
//
// The audit reported the bug was in interact.js:108-116 (equipGearReward) and
// two app.js paths. The equip math was extracted to Gear.equip (gear.js:23-36).
// Current gear.js captures oldMax BEFORE mutating save.armor, so the delta is
// computed correctly. All three test cases below should pass against spec.
// ─────────────────────────────────────────────────────────────────────────────

test('#1 armor equip: first piece bumps current energy by the full delta', () => {
  const save = { relics: {}, armor: {}, energy: 100, maxEnergy: 100 };
  const maxBefore = save.maxEnergy;
  Gear.equip(save, 'armor', 'chest', 2);
  // chest.energyPerTier=25 → delta = 25*2 = 50
  const expectedDelta = 25 * 2;
  assert.eq(save.maxEnergy, maxBefore + expectedDelta, 'maxEnergy raised correctly');
  assert.eq(save.energy, 100 + expectedDelta, 'current energy bumped by full delta');
});

test('#1 armor equip: second piece bumps by ITS delta only (not the whole cap)', () => {
  const save = { relics: {}, armor: {}, energy: 100, maxEnergy: 100 };
  Gear.equip(save, 'armor', 'helmet', 1);   // helmet +10
  const capAfterHelmet = save.maxEnergy;    // 110
  save.energy = 5;                          // spend down
  Gear.equip(save, 'armor', 'boots', 3);    // boots.energyPerTier=8 → delta=24
  const delta = save.maxEnergy - capAfterHelmet;
  assert.eq(delta, 8 * 3, 'boots raised cap by boots-only delta');
  assert.eq(save.energy, 5 + delta, 'energy bumped by boots delta only, not whole cap');
});

test('#1 armor equip: upgrading a slot bumps by the TIER difference, not the whole new value', () => {
  // Player already has T1 helmet (10 energy), upgrades to T3 (30 energy).
  // Delta should be +20, not +30.
  const save = { relics: {}, armor: { helmet: { tier: 1 } }, energy: 50, maxEnergy: 110 };
  Gear.equip(save, 'armor', 'helmet', 3);
  // helmet energyPerTier=10; oldMax accounts for T1 (10); newMax includes T3 (30); delta=+20
  assert.eq(save.maxEnergy, 130, 'cap raised from 110 to 130');
  assert.eq(save.energy, 70, 'energy bumped by 20 (T3-T1 delta), not 30');
});

test('#1 equipGearReward: routes through Gear.equip — armor bump propagates from interact path', () => {
  // equipGearReward is the global from interact.js. It delegates to Gear.equip.
  // Verify energy bump still fires through the interact path.
  const save = { relics: {}, armor: {}, energy: 100, maxEnergy: 100 };
  const scene = makeScene();
  equipGearReward({ kind: 'armor', slot: 'legs', tier: 2 }, save, scene);
  // legs.energyPerTier=15 → delta=30
  assert.eq(save.maxEnergy, 130, 'maxEnergy raised via equipGearReward');
  assert.eq(save.energy, 130, 'current energy bumped by delta via equipGearReward');
});

// ─────────────────────────────────────────────────────────────────────────────
// FINDING #6 — Chest relic/armor odds are NOT a flat 10%
// Spec: "10% of opens roll a RELIC or ARMOR instead of normal loot."
// Code: uses per-biome classBias.relic weights (3.75%–15% unnormalised share).
//
// Because weightedPick normalises against the full bias sum, the effective
// relic probability is bias.relic / sum(all bias weights). We pin the actual
// computed effective probability for each biome — none equal 10%.
// SPEC BUG (audit #6): spec wants a flat 10% relic/armor rate for all chests;
// code uses per-biome weights that produce different effective probabilities.
// ─────────────────────────────────────────────────────────────────────────────

function effectiveRelicP(contextKey) {
  const ctx = LOOT_CONTEXTS[contextKey];
  if (!ctx || !ctx.classBias) return 0;
  const bias = ctx.classBias;
  const total = Object.values(bias).reduce((a, b) => a + b, 0);
  return (bias.relic || 0) / total;
}

test('#6 chest relic probability varies by biome, is NOT a flat 10% (SPEC BUG)', () => {
  // SPEC BUG (audit #6): spec requires flat 10%; code produces biome-specific rates.
  // Assert the ACTUAL values from the current LOOT_CONTEXTS table.

  // lowtier: classBias.relic = 0.0375; total ≈ 1.0325 (sum of declared weights)
  const ltP = effectiveRelicP('chest:lowtier');
  assert.gt(ltP, 0, 'lowtier has a nonzero relic share');
  assert.lt(ltP, 0.10, 'lowtier relic rate is below the spec-required 10%');
  // SPEC BUG: should be 0.10, is actually ~3.6%

  // civic: classBias.relic = 0.15; sum ≈ 1.0; effectively ~15%
  const civicP = effectiveRelicP('chest:civic');
  assert.gt(civicP, 0.10, 'civic relic rate exceeds the spec-required 10%');
  // SPEC BUG: should be 0.10, is actually ~15%

  // flora: classBias.relic = 0.15; sum ≈ 1.0; effectively ~15%
  const floraP = effectiveRelicP('chest:flora');
  assert.gt(floraP, 0.10, 'flora relic rate exceeds the spec-required 10%');
  // SPEC BUG: should be 0.10, is actually ~15%

  // food: classBias.relic = 0.06; sum ≈ 0.92 → ~6.5%
  const foodP = effectiveRelicP('chest:food');
  assert.lt(foodP, 0.10, 'food relic rate is below 10%');
  // SPEC BUG: should be 0.10, is actually ~6.5%
});

test('#6 relic odds across biomes are not equal to each other', () => {
  // Confirms the odds genuinely differ (they are not accidentally all 10%).
  const biomes = ['chest:lowtier','chest:commerce','chest:food','chest:civic','chest:health','chest:park','chest:farm','chest:flora'];
  const probs = biomes.map(effectiveRelicP);
  const min = Math.min(...probs);
  const max = Math.max(...probs);
  assert.gt(max - min, 0.05, 'spread between biome relic rates exceeds 5pp');
});

// ─────────────────────────────────────────────────────────────────────────────
// FINDING #7 — Chests CAN produce ARMOR via rollGearUpgrade; milestone gating
// was removed; T1 chests cannot roll relics/armor (relicCap=0).
//
// Spec: chest opens roll relic OR ARMOR, "gated by your harvest/catch
// milestones." Code: ARMOR is producible (rollGearUpgrade returns armor/relic);
// chestRelicAllowedTiers() always returns [1..7] (milestone gating removed).
// T1 chests: relicCap=0 → relic weight is scrubbed → no relic/armor at all.
//
// SPEC BUG (audit #7 partial): milestone gating is absent; chestRelicAllowedTiers
// ignores its `progress` argument and always returns all tiers.
// NOTE: The claim "ARMOR is never producible" was TRUE at audit time but the
// code has since been updated — rollGearUpgrade now handles armor. We pin the
// CURRENT (fixed) behaviour.
// ─────────────────────────────────────────────────────────────────────────────

test('#7 chestRelicAllowedTiers: always returns all 7 tiers regardless of progress (SPEC BUG)', () => {
  // SPEC BUG (audit #7): spec requires harvest/catch milestone gating;
  // code ignores progress and returns every tier unconditionally.
  const noProgress = {};
  const lowProgress = { harvest: 2, catch: 1 };
  const highProgress = { harvest: 100, catch: 50 };

  const fromNone = chestRelicAllowedTiers(noProgress);
  const fromLow  = chestRelicAllowedTiers(lowProgress);
  const fromHigh = chestRelicAllowedTiers(highProgress);

  assert.eq(fromNone.length, 7, 'no progress: all 7 tiers allowed (milestone gating absent)');
  assert.eq(fromLow.length,  7, 'low progress: still all 7 (gating absent)');
  assert.eq(fromHigh.length, 7, 'high progress: still all 7 (gating absent)');
  assert.eq(JSON.stringify(fromNone), JSON.stringify(fromHigh), 'progress has no effect on allowed tiers');
});

test('#7 T1 chests (relicCap=0) cannot produce relic or armor', () => {
  // T1 chests: chestTierMod[1].relicCap=0 → relic weight scrubbed from bias.
  // This matches the behavior that lowtier/bus chests can't offer any relic.
  const RELIC_KINDS = new Set(['relic', 'armor', 'gold']); // gold = consolation from relic path
  let relicRolls = 0;
  const N = 400;
  for (let s = 1; s <= N; s++) {
    const r = pickReward('chest:lowtier', { relics: {}, armor: {} }, seededPrng(s * 7), { tier: 1 });
    if (r && (r.kind === 'relic' || r.kind === 'armor')) relicRolls++;
    // Gold consolation from the walk-up ladder is allowed even from T1 relic rolls —
    // but T1 has relicCap=0 so the relic class is scrubbed and rollGearUpgrade is never called.
  }
  assert.eq(relicRolls, 0, 'T1 chest: zero relic/armor rolls across ' + N + ' seeds (relicCap=0)');
});

test('#7 T2+ chests can produce armor via rollGearUpgrade', () => {
  // rollGearUpgrade includes armor slots in slotPool — so a T2 chest can produce armor.
  // Drive many seeds until we find at least one armor result.
  let armorFound = false;
  // With an empty save, every slot is upgradeable — armor should appear eventually.
  for (let s = 1; s <= 2000 && !armorFound; s++) {
    const r = pickReward('chest:civic', { relics: {}, armor: {} }, seededPrng(s * 13), { tier: 4 });
    if (r && r.kind === 'armor') armorFound = true;
  }
  assert.truthy(armorFound, 'T4 civic chest produced at least one armor result across 2000 seeds');
});

test('#7 T2 chest relic path resolves via rollGearUpgrade (relic or armor or gold)', () => {
  // Verify that when the relic class is chosen for a T2 chest, rollGearUpgrade
  // is invoked and the result is a valid gear outcome.
  const GEAR_KINDS = new Set(['relic', 'armor', 'gold']);
  let gearCount = 0;
  const N = 200;
  for (let s = 1; s <= N; s++) {
    // Use civic which has highest relic bias (15%) to maximise gear rolls.
    const r = pickReward('chest:civic', { relics: {}, armor: {} }, seededPrng(s * 31), { tier: 2 });
    if (r && GEAR_KINDS.has(r.kind)) gearCount++;
  }
  // With civic's ~15% relic share at T2, expect some gear results across 200 seeds.
  assert.gt(gearCount, 0, 'T2 civic chest produced at least one gear (relic/armor/gold) result');
});

// ─────────────────────────────────────────────────────────────────────────────
// FINDING #8 — shopSellBonus: function absent from Shops namespace
// Spec (ECONOMY): "Sale price = PRICES[id] × sword multiplier × the shop's
// specialty bonus." The audit referenced Shops.shopSellBonus (shops.js:71-77)
// defining gem +100% / produce +50% / trader +25%.
//
// Current shops.js: the Shops namespace exposes only shopType, shopInk,
// toRoman (shopLabel/shopTint have since been deleted as dead code —
// render.js never called them). shopSellBonus is not defined anywhere in the
// loaded module set.
//
// SPEC BUG (audit #8): specialty sell bonus is defined but was never wired into
// a sale path. The function has since been removed entirely; the bonus is still
// absent from any sale code path.
// ─────────────────────────────────────────────────────────────────────────────

test('#8 Shops namespace: shopSellBonus is absent (function was removed)', () => {
  // SPEC BUG (audit #8): spec requires a specialty sell bonus applied at sale time.
  // The function was once in shops.js but is now gone; it was never wired into
  // any sale path. We assert the CURRENT state: the function does not exist.
  assert.falsy(typeof Shops.shopSellBonus === 'function',
    'Shops.shopSellBonus should NOT be a function — it was removed (never wired)');
});

test('#8 Shops namespace exposes exactly the expected surface (no sell-bonus entry)', () => {
  const exposed = Object.keys(Shops).sort();
  // The known exported keys from shops.js IIFE global.Shops = { ... }.
  // shopLabel/shopTint were dropped entirely (dead code — render.js
  // deliberately reimplements both off the resolved house role instead of
  // the address digit these read; see the comment atop shops.js).
  assert.truthy(exposed.includes('shopType'),  'shopType present');
  assert.falsy(exposed.includes('shopLabel'),  'shopLabel removed (dead code)');
  assert.falsy(exposed.includes('shopTint'),   'shopTint removed (dead code)');
  assert.truthy(exposed.includes('shopInk'),   'shopInk present');
  assert.truthy(exposed.includes('toRoman'),   'toRoman present');
  assert.falsy(exposed.includes('shopSellBonus'), 'shopSellBonus is absent from Shops');
});

test('#8 shopType: address-digit routing matches documented digit rules', () => {
  // Address digit 9 → blacksmith, 2/6 → market, 1/8 → trader, others → null.
  const makeHouse = (addr) => ({ kind: 'house', tier: WorldGen.T.BUILDING, address: addr });
  assert.eq(Shops.shopType(makeHouse(9)),  'blacksmith', 'digit 9 → blacksmith');
  assert.eq(Shops.shopType(makeHouse(19)), 'blacksmith', '19 mod 10 = 9 → blacksmith');
  assert.eq(Shops.shopType(makeHouse(2)),  'market',     'digit 2 → market');
  assert.eq(Shops.shopType(makeHouse(6)),  'market',     'digit 6 → market');
  assert.eq(Shops.shopType(makeHouse(1)),  'trader',     'digit 1 → trader');
  assert.eq(Shops.shopType(makeHouse(8)),  'trader',     'digit 8 → trader');
  assert.eq(Shops.shopType(makeHouse(5)),  null,         'digit 5 → null (no specialty)');
  assert.eq(Shops.shopType(makeHouse(0)),  null,         'digit 0 → null');
});

// ─────────────────────────────────────────────────────────────────────────────
// FINDING #9 — index.html's boot-time save-key fallback can silently drift
// from save.js's real constants
//
// index.html's inline readActiveSaveRaw() (~line 1399) runs at PARSE time,
// before save.js has loaded, so it can't call into save.js — it hardcodes its
// own copies of the two localStorage keys instead: 'terracart.saves' (the slot
// registry, ~line 1401) and 'terracart.save.v4' (the legacy/default slot's
// data key, the `key` fallback at ~line 1402). save.js:22,24 defines the same
// two strings as SAVES_KEY / SAVE_VERSION_KEY. Nothing ties the two copies
// together, so a future version bump (v4 → v5) that only touches save.js
// would leave index.html quietly reading the WRONG key before the scene even
// boots.
//
// The vm sandbox this suite runs in has no fs/require (see the comments in
// mvt.test.js and spawn_roads.test.js), so this test can't open index.html and
// diff it live the way SHOP_INTERACT_SRC etc. do for app.js (those are lifted
// by run.js, in plain node scope, before the sandbox exists). Instead the
// index.html literals are hand-mirrored below, tagged with the line they come
// from, and checked against save.js's REAL (live, loaded-from-source)
// constants — so bumping SAVE_VERSION_KEY/SAVES_KEY without updating BOTH
// index.html and this mirror fails the suite immediately, loudly, instead of
// only in a browser with a stale localStorage key.
// ─────────────────────────────────────────────────────────────────────────────

test('#9 index.html\'s hardcoded save-key fallback matches save.js\'s constants', () => {
  // Hand-mirrored from index.html readActiveSaveRaw() — keep these two
  // literals equal to what's actually written there.
  const INDEX_HTML_SAVES_KEY = 'terracart.saves';       // index.html ~line 1401
  const INDEX_HTML_SAVE_KEY  = 'terracart.save.v4';     // index.html ~line 1402
  assert.eq(SAVES_KEY, INDEX_HTML_SAVES_KEY,
    'save.js SAVES_KEY must match index.html\'s hardcoded slot-registry key');
  assert.eq(SAVE_VERSION_KEY, INDEX_HTML_SAVE_KEY,
    'save.js SAVE_VERSION_KEY must match index.html\'s hardcoded fallback data key — '
    + 'a version bump here MUST also update index.html\'s readActiveSaveRaw() and this pin');
});
