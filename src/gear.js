// Gear core — equip rules, the relic/armor offer roll, and the forge/smelt
// recipes, extracted from app.js so they're testable headlessly (no scene, DOM).
//
// "Gear" spans save.relics (tools/jewelry/weapons) and save.armor (the four
// wearable slots that also raise max energy). The scene keeps thin wrappers
// (app.js _equipGear / buildRelicOffer / blacksmithRecipe / smeltingRecipe /
// smeltUnlockedBars); interact.js's equipGearReward also routes through equip()
// here so the armor energy-bump math lives in exactly one place.
//
// Depends on globals from items.js: maxEnergyFromArmor, MATERIAL_TIERS,
// RELIC_DEFS, ARMOR_DEFS, gearPrice, bestWeaponTier; and Energy (energy.js).

(function (root) {
  'use strict';

  // Which smeltable bars unlock at which shrine level (mirrors the produce→bar
  // transform unlocks). Moved here from a MapScene class field.
  const SMELT_UNLOCK_LEVEL = { platinum_bar: 4, crimson_bar: 5, frost_bar: 6 };

  // Equip a bought / forged / looted relic or armor piece. Armor also recomputes
  // max energy and grants the freshly-unlocked headroom (captured BEFORE
  // mutating armor so the bump is the delta, not the whole new max).
  function equip(save, kind, slot, tier) {
    if (kind === 'armor') {
      save.armor = save.armor || {};
      if (typeof maxEnergyFromArmor === 'function') {
        const oldMax = (typeof Energy !== 'undefined') ? Energy.maxEnergy(save) : maxEnergyFromArmor(save.armor);
        save.armor[slot] = { tier };
        const newMax = maxEnergyFromArmor(save.armor);
        const bump = Math.max(0, newMax - oldMax);
        save.maxEnergy = newMax;
        save.energy = Math.min(newMax, (save.energy ?? 0) + bump);
      } else {
        save.armor[slot] = { tier };
      }
      return;
    }
    save.relics = save.relics || {};
    save.relics[slot] = { tier };
  }

  // Pick a random relic OR armor piece the player can actually use (current slot
  // empty or strictly lower tier). Returns null when no upgrade is possible.
  // Armor and relic pools are normalised to ~50% airtime each; within each pool
  // weight ∝ 1/2^(tier-1) biases offers toward low tiers. `rng` defaults to
  // Math.random — pass a seeded one for stable per-bucket offers.
  function buildRelicOffer(save, rng = Math.random, opts = {}) {
    const candidates = [];
    const consider = (kind, slot, currentTier) => {
      for (const t of MATERIAL_TIERS) {
        if (t.tier <= currentTier) continue;
        candidates.push({ kind, slot, tier: t.tier });
      }
    };
    for (const slot of Object.keys(RELIC_DEFS)) consider('relic', slot, save.relics?.[slot]?.tier ?? 0);
    for (const slot of Object.keys(ARMOR_DEFS)) consider('armor', slot, save.armor?.[slot]?.tier ?? 0);
    if (!candidates.length) return null;

    const tierW = (t) => 1 / Math.pow(2, t - 1);
    const relicSum = candidates.filter((c) => c.kind === 'relic').reduce((a, c) => a + tierW(c.tier), 0);
    const armorSum = candidates.filter((c) => c.kind === 'armor').reduce((a, c) => a + tierW(c.tier), 0);
    const relicNorm = relicSum > 0 ? 1 / relicSum : 0;
    const armorNorm = armorSum > 0 ? 1 / armorSum : 0;
    const weighted = candidates.map((c) => ({
      c,
      w: (c.kind === 'relic' ? relicNorm : armorNorm) * tierW(c.tier),
    }));
    const total = weighted.reduce((a, b) => a + b.w, 0);
    let r = rng() * total;
    let pick = weighted[weighted.length - 1].c;
    for (const w of weighted) { r -= w.w; if (r <= 0) { pick = w.c; break; } }

    // Pricing: castle = flat 4.0× discounted by Bow tier (1 - t/7) → T7 par;
    // everything else = random 1.2..3.0× markup.
    const baseP = gearPrice(pick.kind, pick.slot, pick.tier);
    let mul;
    if (opts.isCastle) {
      const f = 1 - ((typeof bestWeaponTier === 'function') ? bestWeaponTier(save.relics) : 0) / 7;
      mul = 1 + 3 * f;
    } else {
      mul = 1.2 + rng() * 1.8;
    }
    const price = Math.max(1, Math.ceil(baseP * mul));
    return { ...pick, price };
  }

  // Forge recipe for a gear piece. Tools use the tier-matched bar (T1 = plain
  // wood); jewelry (ring→ruby, staff→emerald, amulet→sapphire) uses a geometric
  // gem ramp (1,2,4,…,32 from T2..T7) plus one bar. Returns null when uncraftable.
  function blacksmithRecipe(kind, slot, tier) {
    if (!tier) return null;
    const JEWELRY_GEM = { ring: 'ruby', staff: 'emerald', amulet: 'sapphire' };
    const BAR_BY_TIER = [, 'wood', 'copper_bar', 'iron_bar', 'gold_bar', 'platinum_bar', 'crimson_bar', 'frost_bar'];
    const bar = BAR_BY_TIER[tier];
    if (!bar) return null;
    if (JEWELRY_GEM[slot]) {
      if (tier < 2) return null;   // no wooden jewelry
      const gemQty = Math.pow(2, tier - 2);
      return [
        { id: JEWELRY_GEM[slot], qty: gemQty },
        { id: bar, qty: 1 },
      ];
    }
    return [{ id: bar, qty: Math.max(5, tier) }];
  }

  // Bar smelting recipe — only T5+ bars (platinum/crimson/frost) are smelted
  // from a flower + the prior bar; T2-T4 are mined. Returns null otherwise.
  function smeltingRecipe(barId) {
    const RECIPES = {
      platinum_bar: [{ id: 'sunflower', qty: 1 }, { id: 'gold_bar', qty: 1 }],
      crimson_bar: [{ id: 'fireflower', qty: 1 }, { id: 'platinum_bar', qty: 1 }],
      frost_bar: [{ id: 'iceflower', qty: 1 }, { id: 'crimson_bar', qty: 1 }],
    };
    return RECIPES[barId] || null;
  }

  // Which smeltable bars the forge will smelt right now, gated by shrine level
  // (platinum L4, crimson L5, frost L6). Empty until shrine L4.
  function smeltUnlockedBars(save) {
    const lvl = save.shrineLevel ?? 1;
    return ['platinum_bar', 'crimson_bar', 'frost_bar'].filter((id) => lvl >= SMELT_UNLOCK_LEVEL[id]);
  }

  root.Gear = { SMELT_UNLOCK_LEVEL, equip, buildRelicOffer, blacksmithRecipe, smeltingRecipe, smeltUnlockedBars };
})(typeof globalThis !== 'undefined' ? globalThis : this);
