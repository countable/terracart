// Gear core — equip rules, the relic/armor offer roll, and the forge/smelt
// recipes, extracted from app.js so they're testable headlessly (no scene, DOM).
//
// "Gear" spans save.relics (tools/jewelry/weapons) and save.armor (the four
// wearable slots that soak incoming damage). The scene keeps thin wrappers
// (app.js _equipGear / buildRelicOffer / blacksmithRecipe / smeltingRecipe /
// smeltUnlockedBars); Rewards.apply also routes through equip()
// here so every way a piece can be obtained lands in exactly one place.
//
// Depends on globals from items.js: MATERIAL_TIERS, RELIC_DEFS, ARMOR_DEFS,
// gearPrice.

(function (root) {
  'use strict';

  // The combat weapons — the ONLY slots `save.activeWeapon` ever holds.
  // Shared with app.js (inventory tap-to-activate) and combat.js (what
  // auto-engages / auto-fires); kept here too since equip() is what flips it
  // on a fresh pickup.
  const WEAPON_SLOTS = ['sword', 'dagger', 'lance', 'bow', 'staff', 'musket'];

  // Boons change what can be used, never what is owned. Expiry is read live
  // so a reload or an expired altar restores the original gear automatically.
  function effectiveRelics(save, now = Date.now()) {
    const relics = save?.relics || {};
    if (!Shrines.leverActive(save, 'wand', now) || (relics.staff?.tier || 0) >= Shrines.WAND_TIER) return relics;
    return { ...relics, staff: { tier: Shrines.WAND_TIER, temporary: true } };
  }
  function activeWeapon(save, now = Date.now()) {
    if (!Shrines.leverActive(save, 'wand', now)) return save?.activeWeapon;
    return save.boonWeapon?.until === save.boonUntil.wand ? save.boonWeapon.slot : 'staff';
  }

  // MELEE IS THE DEFAULT (owner, Oct 2026). The hands fight on their own the
  // way a sword does: app.js _combatTick auto-engages the nearest foe in
  // arm's reach whenever no RANGED weapon is in hand — a sword if owned, bare
  // hands on the tier-0 rung if not. Only an EQUIPPED bow or staff
  // (activeWeapon in Combat.RANGED_SLOTS) turns that off, and equipping one
  // is an explicit act: the Equip button under the Relics tab
  // (syncEquipButton), never a side effect of highlighting the slot.
  function meleeActive(save, now = Date.now()) {
    return !Combat.RANGED_SLOTS.includes(activeWeapon(save, now));
  }

  function selectWeapon(save, slot, now = Date.now()) {
    if (!WEAPON_SLOTS.includes(slot) || !effectiveRelics(save, now)[slot]) return false;
    if (Shrines.leverActive(save, 'wand', now)) {
      save.boonWeapon = { until: save.boonUntil.wand, slot };
    } else {
      save.activeWeapon = slot;
    }
    return true;
  }

  // Put the ranged weapon away: back to melee — the sword when one is owned,
  // else bare hands (no active weapon at all). The one way out of a bow or
  // staff besides equipping the other. During the wand boon it is the boon
  // choice that is cleared, so the lever's own staff doesn't spring back.
  function unequipWeapon(save, now = Date.now()) {
    const slot = effectiveRelics(save, now).sword ? 'sword' : null;
    if (Shrines.leverActive(save, 'wand', now)) {
      save.boonWeapon = { until: save.boonUntil.wand, slot };
    } else {
      save.activeWeapon = slot;
    }
    return true;
  }

  // Applied at the two work-wheel entry points, after the owned tool has
  // passed its access gate. Combat uses its own damage clock, not this rate.
  function workDurationMs(save, durationMs, now = Date.now()) {
    return durationMs / (Shrines.leverActive(save, 'work', now) ? Shrines.WORK_SPEED_MUL : 1);
  }

  // Equip a bought / forged / looted relic or armor piece. Armor just fills its
  // slot: its effect (soaking incoming damage — items.js armorReduction, spent
  // by Combat.mitigate) is read live off save.armor at the moment a blow lands,
  // so there is nothing to bank here.
  function equip(save, kind, slot, tier) {
    const def = gearDef(kind, slot);
    if (!def || !TIER_BY_NUM[tier] || (def.tiers && !def.tiers.includes(tier))) return;
    const owned = (kind === 'armor' ? save.armor : save.relics)?.[slot]?.tier || 0;
    if (tier <= owned) return;
    if (kind === 'armor') {
      save.armor = save.armor || {};
      save.armor[slot] = { tier };
      return;
    }
    save.relics = save.relics || {};
    save.relics[slot] = { tier };
    // Only one weapon fights at a time (combat.js) — the newest one obtained
    // or upgraded wins by default; the player can still switch back with the
    // Equip / Unequip button under the Relics inventory tab (app.js).
    if (WEAPON_SLOTS.includes(slot)) selectWeapon(save, slot);
  }

  // Pick a random relic OR armor piece the player can actually use (current slot
  // empty or strictly lower tier). Returns null when no upgrade is possible.
  // Armor and relic pools are normalised to ~50% airtime each; within each pool
  // weight ∝ 1/2^(tier-1) biases offers toward low tiers. `rng` defaults to
  // Math.random — pass a seeded one for stable per-bucket offers.
  // A SMITHY (opts.isBlacksmith) only ever offers what its anvil can forge
  // (blacksmithRecipe); an unforgeable seeded offer would shut the forge for
  // the whole hour bucket ("Anvil's resting").
  // THE SMITHY OFFERS THE LOWEST RUNG IT CAN (owner, Oct 2026). Per slot,
  // the lowest tier the anvil can forge above what is worn is that slot's
  // NEXT rung (`rank` 0); every tier past it is divided by
  // SMITHY_NEXT_RUNG_BIAS per rung skipped, on top of the low-tier curve
  // every shop has. And the smith keeps no relic/armour split: a bare slot
  // (a wooden tool or boots at tier 1, weight 1) outweighs the next upgrade
  // of a slot already kitted (tier 4 over tier 3: 1/8), whatever kind
  // either is — "missing a few wood pieces" is what the forge is for before
  // it is for finer metal. Cash shops and castles keep the original curve
  // and their exact seeded draws.
  const CASTLE_RELIC_MARKUP = 4;
  const SMITHY_NEXT_RUNG_BIAS = 4;
  // A TIERED SMITHY (opts.smithTier — shops.js smithTier, owner Oct 2026)
  // forges only within one tier of its own rank, and leans to its own: a
  // candidate at exactly its tier is weighed SMITHY_OWN_TIER_BIAS times over,
  // on top of the curve and the next-rung rule above. A kit already past the
  // forge's reach leaves it nothing to offer ("Nothing left to forge.").
  const SMITHY_OWN_TIER_BIAS = 4;
  // Every piece a shop could offer this save, with its weight: the pool
  // buildRelicOffer draws from (and gear.test.js reads directly). Null when
  // nothing is above what the player wears.
  function relicOfferWeights(save, opts = {}) {
    const candidates = [];
    const consider = (kind, slot, currentTier) => {
      let next = null;
      for (const t of MATERIAL_TIERS) {
        if (t.tier <= currentTier) continue;
        if (opts.isBlacksmith && !blacksmithRecipe(kind, slot, t.tier)) continue;
        if (next == null) next = t.tier;
        candidates.push({ kind, slot, tier: t.tier, rank: t.tier - next });
      }
    };
    for (const slot of Object.keys(RELIC_DEFS)) {
      if (RELIC_DEFS[slot].chestOnly) continue;
      consider('relic', slot, save.relics?.[slot]?.tier ?? 0);
    }
    for (const slot of Object.keys(ARMOR_DEFS)) consider('armor', slot, save.armor?.[slot]?.tier ?? 0);
    if (!candidates.length) return null;
    // A themed relic shop sells up to its own tier (opts.maxTier) — and, when
    // the player has outgrown that, the lowest tier still above what they wear.
    if (opts.maxTier != null) {
      const within = candidates.filter((c) => c.tier <= opts.maxTier);
      const lo = Math.min(...candidates.map((c) => c.tier));
      const keep = within.length ? within : candidates.filter((c) => c.tier === lo);
      candidates.length = 0;
      candidates.push(...keep);
    }
    const tierW = (t) => 1 / Math.pow(2, t - 1);
    if (opts.isBlacksmith) {
      const own = opts.smithTier | 0;
      const reach = own ? candidates.filter((c) => Math.abs(c.tier - own) <= 1) : candidates;
      if (!reach.length) return null;
      return reach.map((c) => ({ c, w: tierW(c.tier) / Math.pow(SMITHY_NEXT_RUNG_BIAS, c.rank)
        * (own && c.tier === own ? SMITHY_OWN_TIER_BIAS : 1) }));
    }
    const relicSum = candidates.filter((c) => c.kind === 'relic').reduce((a, c) => a + tierW(c.tier), 0);
    const armorSum = candidates.filter((c) => c.kind === 'armor').reduce((a, c) => a + tierW(c.tier), 0);
    const relicNorm = relicSum > 0 ? 1 / relicSum : 0;
    const armorNorm = armorSum > 0 ? 1 / armorSum : 0;
    return candidates.map((c) => ({
      c,
      w: (c.kind === 'relic' ? relicNorm : armorNorm) * tierW(c.tier),
    }));
  }

  function buildRelicOffer(save, rng = Math.random, opts = {}) {
    const weighted = relicOfferWeights(save, opts);
    if (!weighted) return null;
    const { kind, slot, tier } = weightedPickBy(weighted, (w) => w.w, rng).c;
    const pick = { kind, slot, tier };

    // Pricing: castle = a flat CASTLE_RELIC_MARKUP; everything else = random
    // 1.2..3.0× markup (houses.js priceMul owns the standing discounts).
    const baseP = gearPrice(pick.kind, pick.slot, pick.tier);
    const mul = opts.isCastle ? CASTLE_RELIC_MARKUP : 1.2 + rng() * 1.8;
    const price = Math.max(1, Math.ceil(baseP * mul));
    return { ...pick, price };
  }

  // Forge recipe for a gear piece. Tools use the tier-matched bar (T1 = plain
  // wood); the staff's emerald setting uses a geometric
  // gem ramp (1,2,4,…,32 from T2..T7) plus one bar. At the Frost tier every
  // staff is cut around DIAMONDS instead of emerald at Frost (JEWELRY_FROST_TIER). Returns null when uncraftable.
  const JEWELRY_FROST_TIER = 7;
  const JEWELRY_FROST_GEM = 'diamond';
  function blacksmithRecipe(kind, slot, tier) {
    if (!tier) return null;
    if (kind === 'relic' && !RELIC_DEFS[slot]) return null;
    if (kind === 'relic' && RELIC_DEFS[slot].chestOnly) return null;
    if (kind === 'armor' && !ARMOR_DEFS[slot]) return null;
    const JEWELRY_GEM = { staff: 'emerald' };
    const BAR_BY_TIER = [, 'wood', 'copper_bar', 'iron_bar', 'gold_bar', 'platinum_bar', 'crimson_bar', 'frost_bar'];
    const bar = BAR_BY_TIER[tier];
    if (!bar) return null;
    if (JEWELRY_GEM[slot]) {
      if (tier < 2) return null;   // no wooden jewelry
      const gemQty = Math.pow(2, tier - 2);
      const gem = (tier >= JEWELRY_FROST_TIER) ? JEWELRY_FROST_GEM : JEWELRY_GEM[slot];
      return [
        { id: gem, qty: gemQty },
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

  function smeltUnlockedBars() {
    return ['platinum_bar', 'crimson_bar', 'frost_bar'];
  }

  // ── THE TRADER'S GEAR SWAP ───────────────────────────────────────────────
  // On TRADER_GEAR_CHANCE of trader visits, the trader swaps equipment
  // instead of goods: one piece the player owns for a different piece OF THE
  // SAME TIER, any for any across relics, armour and unique relics. Pieces
  // are Rewards.apply shapes: { kind: 'relic'|'armor', slot, tier } or
  // { kind: 'item', id, qty: 1, tier }.
  //   • The player gives a piece they own. Bags never go: a smaller bag would
  //     spill the inventory. A shrine boon's temporary staff is not owned
  //     (save.relics, not effectiveRelics). Tomes are books, not relics.
  //   • The trader gives what equip() would actually take — a slot the player
  //     has empty or holds at a LOWER tier (so never the given slot itself) —
  //     or a unique relic the player does not carry.
  const TRADER_GEAR_CHANCE = 0.2;
  // Every unique relic that counts as equipment (tomes are books), read off
  // ITEMS once: the trader's sign asks for it every frame. The X mark's gear
  // class (rarity.js) draws from the same list.
  let _uniqueRelics = null;
  function uniqueRelics() {
    return _uniqueRelics || (_uniqueRelics = ITEMS.filter(item =>
      item.kind === 'unique_relic' && !item.tome && (item.baseTier | 0) > 0));
  }
  function gearTier(save, kind, slot) {
    return (kind === 'armor' ? save.armor : save.relics)?.[slot]?.tier || 0;
  }
  function traderGivablePieces(save) {
    const out = [];
    for (const slot of Object.keys(RELIC_DEFS)) {
      const tier = gearTier(save, 'relic', slot);
      if (tier > 0 && slot !== 'bags') out.push({ kind: 'relic', slot, tier });
    }
    for (const slot of Object.keys(ARMOR_DEFS)) {
      const tier = gearTier(save, 'armor', slot);
      if (tier > 0) out.push({ kind: 'armor', slot, tier });
    }
    for (const item of uniqueRelics()) {
      if (carriesItem(save, item.id)) out.push({ kind: 'item', id: item.id, qty: 1, tier: item.baseTier });
    }
    return out;
  }
  function traderTakeablePieces(save, tier, give) {
    const out = [];
    const fits = (kind, slot) => {
      const def = gearDef(kind, slot);
      return !!def && !!TIER_BY_NUM[tier] && (!def.tiers || def.tiers.includes(tier)) && gearTier(save, kind, slot) < tier;
    };
    for (const slot of Object.keys(RELIC_DEFS)) if (fits('relic', slot)) out.push({ kind: 'relic', slot, tier });
    for (const slot of Object.keys(ARMOR_DEFS)) if (fits('armor', slot)) out.push({ kind: 'armor', slot, tier });
    for (const item of uniqueRelics()) {
      if (item.baseTier === tier && item.id !== give?.id && !carriesItem(save, item.id)) {
        out.push({ kind: 'item', id: item.id, qty: 1, tier });
      }
    }
    return out;
  }
  // The chance roll is drawn first, every time, so what is owned never
  // changes how many numbers the stream spends before it.
  function traderGearSwap(save, rng = Math.random) {
    if (rng() >= TRADER_GEAR_CHANCE) return null;
    const options = traderGivablePieces(save)
      .map(give => ({ give, gets: traderTakeablePieces(save, give.tier, give) }))
      .filter(o => o.gets.length);
    if (!options.length) return null;
    const { give, gets } = options[Math.floor(rng() * options.length)];
    return { give, get: gets[Math.floor(rng() * gets.length)] };
  }
  const samePiece = (a, b) => a.kind === b.kind && a.slot === b.slot && a.id === b.id && a.tier === b.tier;
  // Still takeable as offered: the given piece is owned at that tier and the
  // received one is still wanted (the bag or a slot may have changed since).
  function traderSwapValid(save, swap) {
    if (!swap) return false;
    return traderGivablePieces(save).some(p => samePiece(p, swap.give))
      && traderTakeablePieces(save, swap.give.tier, swap.give).some(p => samePiece(p, swap.get));
  }
  // Hand the given piece over. The received piece goes through Rewards.apply
  // at the caller, like every other way gear is obtained.
  function surrenderPiece(save, piece) {
    if (piece.kind === 'item') { Inventory.remove(save, piece.id, 1); return; }
    if (piece.kind === 'armor') { save.armor[piece.slot] = null; return; }
    save.relics[piece.slot] = null;
    if (save.activeWeapon === piece.slot) unequipWeapon(save);
  }

  root.Gear = { effectiveRelics, activeWeapon, meleeActive, selectWeapon, unequipWeapon, workDurationMs, equip, buildRelicOffer, relicOfferWeights, SMITHY_NEXT_RUNG_BIAS, SMITHY_OWN_TIER_BIAS,
                blacksmithRecipe, smeltingRecipe, smeltUnlockedBars, WEAPON_SLOTS,
                TRADER_GEAR_CHANCE, uniqueRelics, traderGearSwap, traderSwapValid, surrenderPiece };
})(typeof globalThis !== 'undefined' ? globalThis : this);
