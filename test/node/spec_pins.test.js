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
// SUPERSEDED (Sep 2026). Armor no longer touches the energy CAP at all: it
// soaks the damage an attack takes off the bar instead (items.js
// armorReduction, spent by Combat.mitigate), so there is no delta to bump and
// the finding has nothing left to be a bug about. What replaces it is pinned
// here — equipping is inert on energy, and what a piece is worth is read live
// off save.armor at the moment a blow lands.
// ─────────────────────────────────────────────────────────────────────────────

test('#1 armor equip: fills the slot and leaves energy alone', () => {
  const save = { relics: {}, armor: {}, energy: 40, maxEnergy: 100 };
  Gear.equip(save, 'armor', 'chest', 2);
  assert.eq(save.armor.chest.tier, 2, 'the slot is filled');
  assert.eq(save.energy, 40, 'no headroom granted — armour is not a bigger bar');
  assert.eq(Energy.maxEnergy(save), 100, 'and the cap is untouched by armour');
});

test('#1 armor equip: a whole worn set never lengthens the bar', () => {
  const save = { relics: {}, armor: {}, energy: 100, eaten: [] };
  for (const slot of Object.keys(ARMOR_DEFS)) Gear.equip(save, 'armor', slot, 7);
  assert.eq(Energy.maxEnergy(save), STARTING_ENERGY,
    'a full Frost set is still the starting bar');
  assert.gt(armorReduction(save.armor), 0, 'what it bought is a soak pool instead');
});

test('#1 armor equip: upgrading a slot replaces its tier (and its soak)', () => {
  const save = { relics: {}, armor: { helmet: { tier: 1 } }, energy: 50 };
  assert.eq(armorReduction(save.armor), 1, 'a Wood helmet soaks 1');
  Gear.equip(save, 'armor', 'helmet', 3);
  assert.eq(save.armor.helmet.tier, 3, 'the slot holds one piece, the newer one');
  assert.eq(armorReduction(save.armor), 3, 'T3 soaks 3 — the new tier, not 1 + 3');
  assert.eq(save.energy, 50, 'and the bar is where it was');
});

test('#1 reward grant: the interact path equips the same way', () => {
  // Reward grants delegate gear to Gear.equip.
  const save = { relics: {}, armor: {}, energy: 100, maxEnergy: 100 };
  const scene = makeScene();
  Rewards.apply(save, { kind: 'armor', slot: 'legs', tier: 2 }, scene);
  assert.eq(save.armor.legs.tier, 2, 'looted armour lands in its slot');
  assert.eq(armorReduction(save.armor), 2, 'and starts soaking immediately');
  assert.eq(save.energy, 100, 'without touching the bar');
});

// The approved thematic chest design supersedes the old flat-gear-rate spec.
// These are surface group probabilities before quality eligibility/fallbacks.
test('chest themes: gear belongs to civic, cultural and protective groups', () => {
  for (const theme of ['roadside', 'commerce', 'food', 'health', 'park', 'farm', 'flora', 'worship', 'memorial', 'pets']) {
    const gearShare = Object.entries(ChestThemes.weights(theme, 4))
      .filter(([group]) => ChestThemes.groups[group].kind === 'gear')
      .reduce((sum, [, weight]) => sum + weight, 0);
    assert.eq(gearShare, 0, `${theme}: no unrelated gear`);
  }
  assert.eq(ChestThemes.weights('civic', 4).noncombatGear, 15);
  assert.eq(ChestThemes.weights('school', 4).noncombatGear, 10);
  assert.eq(ChestThemes.weights('culture', 4).culturalGear, 35);
  assert.eq(ChestThemes.weights('authority', 4).protectiveGear, 40);
});

test('chest themes: roadside never awards gear, even at high quality', () => {
  const rng = seededPrng(0x51de);
  for (let i = 0; i < 2000; i++) {
    const reward = pickReward('chest:lowtier', { relics: {}, armor: {} }, rng, { tier: 5 });
    assert.truthy(reward.kind === 'item' || reward.kind === 'gold');
    assert.truthy(['supplies', 'materials', 'cash'].includes(reward.group));
  }
});

test('#7 no milestone gate on gear tiers: a top chest can roll every tier', () => {
  // SPEC BUG (audit #7): spec requires harvest/catch milestone gating; the
  // code has none. chestRelicAllowedTiers (which ignored its progress and
  // returned every tier) was dead weight and is gone — the ceiling is the
  // chest tier's own `preferred` clamp inside rollGearUpgrade.
  assert.eq(typeof chestRelicAllowedTiers, 'undefined', 'the always-all-tiers stub is gone');
  const seen = new Set();
  let s = 7;
  const rng = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i < 4000; i++) {
    const r = rollGearUpgrade(rng, {}, 5, {});
    if (r && r.kind !== 'gold') seen.add(r.tier);
  }
  assert.eq([...seen].sort((a, b) => a - b).join(','), '1,2,3,4,5,6,7',
    'with no progress at all, a tier-5 chest reaches every gear tier');
});

test('chest themes: T1 excludes gear for every location, even on jackpot rolls', () => {
  for (const theme of Object.keys(ChestThemes.themes)) {
    for (const depth of [0, 2]) {
      const rng = seededPrng(771);
      for (let i = 0; i < 300; i++) {
        const reward = pickReward('chest:' + theme, { relics: {}, armor: {} }, rng, { tier: 1, depth });
        assert.falsy(reward.kind === 'relic' || reward.kind === 'armor', `${theme}, depth ${depth}: T1 gear`);
      }
    }
  }
});

test('chest themes: civic gear is restricted to noncombat tools', () => {
  const allowed = new Set(['bags', 'can', 'hoe', 'rod', 'bugnet']);
  const rng = seededPrng(8301);
  let gearCount = 0;
  for (let i = 0; i < 3000; i++) {
    const reward = pickReward('chest:civic', { relics: {}, armor: {} }, rng, { tier: 4 });
    assert.falsy(reward.kind === 'armor', 'civic cannot award protective gear');
    if (reward.kind === 'relic') {
      gearCount++;
      assert.truthy(allowed.has(reward.slot), `civic gear slot ${reward.slot}`);
    }
  }
  assert.gt(gearCount, 0, 'the noncombat gear group actually resolves');
});

test('chest themes: culture can award relics and armor; authority awards protective gear only', () => {
  for (const theme of ['culture', 'authority']) {
    const kinds = new Set();
    const rng = seededPrng(55121);
    for (let i = 0; i < 3000; i++) {
      const reward = pickReward('chest:' + theme, { relics: {}, armor: {} }, rng, { tier: 4 });
      if (reward.kind === 'relic' || reward.kind === 'armor') kinds.add(reward.kind);
    }
    assert.truthy(kinds.has('armor'), `${theme} provides armor`);
    assert.eq(kinds.has('relic'), theme === 'culture', 'only culture includes relics');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// FINDING #8 — shopSellBonus: function absent from Shops namespace
// Spec (ECONOMY): "Sale price = PRICES[id] × sword multiplier × the shop's
// specialty bonus." The audit referenced Shops.shopSellBonus (shops.js:71-77)
// defining gem +100% / produce +50% / trader +25%.
//
// Current shops.js: the Shops namespace exposes only shopType, shopInk,
// roleLabel (shopLabel/shopTint/toRoman have since been deleted as dead code —
// render.js never called shopLabel/shopTint, and stopped calling toRoman once
// the address-numeral suffix was dropped from every building sign).
// shopSellBonus is not defined anywhere in the loaded module set.
//
// SPEC BUG (audit #8): specialty sell bonus is defined but was never wired into
// a sale path. The function has since been removed entirely; the bonus is still
// absent from any sale code path.
// ─────────────────────────────────────────────────────────────────────────────

test('#8 Shops namespace exposes exactly the expected surface (no sell-bonus entry)', () => {
  const exposed = Object.keys(Shops).sort();
  // The known exported keys from shops.js IIFE global.Shops = { ... }.
  // shopLabel/shopTint were dropped entirely (dead code — render.js
  // deliberately reimplements both off the resolved house role instead of
  // the address digit these read; see the comment atop shops.js). toRoman
  // was dropped once its one call site (the sign's address-numeral suffix)
  // was removed — no building sign carries a street number any more.
  assert.truthy(exposed.includes('shopType'),  'shopType present');
  assert.falsy(exposed.includes('shopLabel'),  'shopLabel removed (dead code)');
  assert.falsy(exposed.includes('shopTint'),   'shopTint removed (dead code)');
  assert.truthy(exposed.includes('shopInk'),   'shopInk present');
  assert.falsy(exposed.includes('toRoman'),    'toRoman removed (no more address numerals)');
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
// index.html's inline readActiveSlotData() runs at PARSE time, before save.js
// has loaded, so it can't call into save.js — it hardcodes its own copy of the
// slot-registry key ('terracart.saves'), which save.js defines as SAVES_KEY.
// It reads the active slot's data through the registry's own `slot.key`, so
// it no longer carries a copy of SAVE_VERSION_KEY at all — and the pin below
// fails if one ever comes back out of step with save.js. (This pin used to
// mirror an older readActiveSaveRaw() by hand; that function was renamed and
// the check went vacuous. It now reads INDEX_HTML_SRC, lifted by run.js.)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// FINDING #10 — app.js's CELL_PX is a standalone literal, not sourced from
// SpriteLayout.CELL_PX
//
// app.js declares `const CELL_PX = 32;` independently of the authoritative
// export SpriteLayout.CELL_PX (=32). app.js loads LAST in the browser, so an
// alias (`const CELL_PX = SpriteLayout.CELL_PX;`) would be safe there — but
// run.js lifts CELL_PX out of app.js headlessly with a numeric-literal regex
// (`const CELL_PX = ([\d.]+);`, see the walk-home-timings block above), and an
// alias would no longer match that pattern, breaking the headless suite.
// So the literal stays, and this pin catches drift instead: `CELL_PX` here is
// that same regex-lifted value straight from src/app.js (run.js sets it as a
// global, same as WALK_M_S etc. above); it must equal SpriteLayout.CELL_PX.
// ─────────────────────────────────────────────────────────────────────────────

test('#10 app.js CELL_PX literal matches SpriteLayout.CELL_PX', () => {
  assert.eq(CELL_PX, SpriteLayout.CELL_PX,
    'app.js\'s CELL_PX literal (lifted from source by run.js) must equal the authoritative SpriteLayout.CELL_PX — update both together if the cell size ever changes');
});

test('#9 index.html\'s hardcoded save-key fallback matches save.js\'s constants', () => {
  const src = INDEX_HTML_SRC;
  const m = src.match(/\n\s*function readActiveSlotData\(\) \{([\s\S]*?)\n\s*\}\n/);
  assert.truthy(m, 'index.html still has readActiveSlotData() — if it was renamed, repoint this pin');
  const body = m[1];
  const keys = [...body.matchAll(/localStorage\.getItem\(\s*'([^']+)'/g)].map((x) => x[1]);
  assert.eq(keys.length, 1, 'exactly one hardcoded key: the slot registry');
  assert.eq(keys[0], SAVES_KEY, 'index.html\'s slot-registry key must match save.js SAVES_KEY');
  assert.truthy(/localStorage\.getItem\(slot\.key/.test(body),
    'the slot\'s data is read through the registry\'s own key, not a hardcoded version key');
  // Any save-data key literal anywhere in index.html must be save.js's.
  for (const lit of src.match(/'terracart\.save\.v\d+'/g) || []) {
    assert.eq(lit.slice(1, -1), SAVE_VERSION_KEY,
      'a hardcoded save-data key in index.html must match save.js SAVE_VERSION_KEY');
  }
});
