// Themed chest pools. Catalog membership, fallback and quantity policy are shared
// by the game and source/balance tools; geography remains owned by loot.js.
(function (global) {
  const flowers = ['flowers', 'forgetmenot', 'marigold', 'wildrose', 'starflower', 'sunflower', 'fireflower', 'iceflower'];
  const magicalFlowers = ['sunflower', 'fireflower', 'iceflower'];
  // Utility food can restore zero energy and still be a harvestable meal.
  const foodIds = () => ITEMS.filter(i => i.kind === 'produce'
    && Number.isFinite(FOOD_ENERGY[i.id]) && FOOD_ENERGY[i.id] >= 0 && !flowers.includes(i.id)).map(i => i.id);
  const cropSeeds = () => ITEMS.filter(i => i.kind === 'seed' && !i.plants && foodIds().includes(i.grows)).map(i => i.id);
  const groups = {
    uniqueRelics: { ids: () => ITEMS.filter(i => i.kind === 'unique_relic' && !isTome(i.id) && !i.progressionOnly).map(i => i.id), mixedTiers: true, fallback: 'magic' },
    supplies: { ids: { torch: 3, rope: 1, trap_disarm_kit: 1, throwing_spear: 1, sugar_potion: 1, blank_scroll: 1 }, starterWeapons: ['dagger', 'lance', 'musket'], starterWeaponChance: 0.25, fallback: 'torch' },
    field: { ids: ['torch', 'rope', 'trap_disarm_kit', 'throwing_spear'], fallback: 'torch' },
    farmSupplies: { ids: ['scarecrow', 'sugar_potion'], fallback: 'torch' },
    materials: { ids: ['wood', 'rubble', 'flint_shard', ...Object.values(MINERAL_TIERS).map(row => row.barId)] },
    cash: { kind: 'cash' },
    restorative: { ids: ['berry', 'cress', 'potato', 'egg', 'milk'] },
    food: { ids: foodIds, fallback: 'restorative' },
    foodSeeds: { ids: cropSeeds, fallback: 'food' },
    parkSeeds: { ids: () => [...cropSeeds(), ...ITEMS.filter(i => i.kind === 'seed' && i.plants).map(i => i.id)], fallback: 'restorative' },
    farmSeeds: { ids: cropSeeds, fallback: 'restorative' },
    farmProduce: { ids: () => cropSeeds().map(id => ITEM_BY_ID[id].grows), fallback: 'restorative' },
    flowerSeeds: { ids: magicalFlowers.map(id => id + '_seed'), fallback: 'flowers' },
    flowers: { ids: flowers },
    forage: { ids: flowers.filter(id => !magicalFlowers.includes(id)).concat(['berry', 'mushroom']) },
    growth: { ids: ['growth_powder'], fallback: { flora: 'flowers', farm: 'farmSupplies', default: 'parkSeeds' } },
    farmAnimals: { ids: ['chicken', 'cow', 'rabbit'], fallback: 'farmProduce' },
    // Surface magic lanes keep place identity while making cave-only potions
    // available above ground. Lower-tier magic remains useful in larger stacks.
    magic: { ids: () => ITEMS.filter(i => i.kind === 'magic' && !i.uniqueJewelry).map(i => i.id), mixedTiers: true, fallback: 'antidote' },
    travelMagic: { ids: ['reach_potion', 'speed_potion', 'shadow_powder', 'treasure_map'], mixedTiers: true, fallback: 'antidote' },
    combatMagic: { ids: ['protection_potion', 'immortal_potion', 'fire_resistance_potion', 'flight_potion', 'giant_potion', 'shielding_potion', 'raven_scroll', 'bones_scroll', 'wraith_scroll', 'blight_potion', 'thunder_scroll', 'dragon_powder', 'frost_powder', 'fireball_scroll', 'explosive_flask', 'fear_scroll', 'sleep_powder', 'psychosis_powder', 'grip_potion', 'poison_flask', 'taming_potion'], mixedTiers: true, fallback: 'antidote' },
    medicalMagic: { ids: { healing_potion: 3, revival_potion: 3, protection_potion: 2, shielding_potion: 2, resurrection_potion: 2, elixir: 1,
      regeneration_amulet: 0.3, vigor_amulet: 0.3 }, mixedTiers: true, fallback: 'antidote' },
    recovery: { ids: ['healing_potion', 'elixir'], fallback: 'restorative' },
    antidote: { ids: ['antidote'] },
    healing: { ids: { healing_potion: 3, revival_potion: 2, resurrection_potion: 1, elixir: 1 }, fallback: { vista: 'antidote', default: 'restorative' } },
    revival: { ids: { revival_potion: 3, resurrection_potion: 1 }, fallback: 'restorative' },
    shield: { ids: ['protection_potion', 'shielding_potion'], fallback: { health: 'restorative', worship: 'restorative', default: 'field' } },
    study: { ids: { reach_potion: 2, raven_scroll: 1, protection_potion: 1, shielding_potion: 1, shadow_powder: 1, blank_scroll: 1, fireball_scroll: 1, fear_scroll: 1, treasure_map: 1 }, mixedTiers: true, fallback: 'books' },
    shadow: { ids: { raven_scroll: 1, bones_scroll: 1, wraith_scroll: 1, shadow_powder: 1 }, mixedTiers: true, fallback: 'flowers' },
    gems: { ids: ['sapphire', 'ruby', 'emerald', 'diamond'], fallback: { culture: 'books', vista: 'antidote', commerce: 'cash', default: 'field' } },
    // Books feed the scholar's tome trades at every chest tier.
    books: { ids: ['book'], fallback: 'torch' },
    // Dedicated Book share for themes without their own books lane.
    plainBook: { ids: ['book'], fallback: 'torch' },
    sugar_potion: { ids: ['sugar_potion'], fallback: 'restorative' },
    torch: { ids: ['torch'] },
    rope: { ids: ['rope'], fallback: 'torch' },
    trapKit: { ids: ['trap_disarm_kit'], fallback: 'torch' },
    magicTrap: { ids: ['magic_trap'], fallback: 'field' },
    caveMagic: { ids: () => ITEMS.filter(i => i.kind === 'magic' && !i.uniqueJewelry).map(i => i.id), mixedTiers: true, fallback: 'torch' },
    caveGems: { ids: ['sapphire', 'ruby', 'emerald', 'diamond'], mixedTiers: true, fallback: 'field' },
    noncombatGear: { kind: 'gear', slots: ['bag', 'watering_can', 'hoe', 'fishing_rod', 'net'], fallback: { school: 'books', default: 'supplies' } },
    protectiveGear: { kind: 'gear', armorOnly: true, fallback: { vista: 'magic', default: 'field' } },
    culturalGear: { kind: 'gear', fallback: 'books' },
  };
  // THE OCT 2026 REBALANCE — one clean identity per theme:
  //   roadside  supplies, minerals, coins - never produce
  //   commerce  coins or gems, nothing else
  //   food      food, with a small animal chance - no seeds, no supplies
  //   flora     flowers or their seeds
  //   health    medical magic and the cherry-picked healing relics
  //   school    the story Book, and study magic
  //   culture   an even spread across everything
  //   worship   the chapel's daily blessing (the theme lives here alone)
  //   civic     unique relics, supplies, coins
  //   authority armour, supplies, combat magic - never produce
  const themes = {
    roadside: { weights: { supplies: 45, materials: 40, cash: 15 } },
    commerce: { weights: { cash: 70, gems: 30 } },
    food: { weights: { food: 95, farmAnimals: 5 } },
    park: { weights: { parkSeeds: 70, forage: 20, growth: 10 } },
    farm: { weights: { farmSeeds: 40, farmProduce: 30, farmAnimals: 15, farmSupplies: 10, growth: 5 } },
    flora: { weights: { flowerSeeds: 50, flowers: 50 } },
    health: { weights: { medicalMagic: 100 } },
    school: { weights: { books: 60, study: 40 } },
    culture: { weights: { culturalGear: 20, gems: 20, books: 20, magic: 20, cash: 20 } },
    worship: { weights: { revival: 50, shield: 25, books: 15, flowers: 10 } },
    civic: { weights: { uniqueRelics: 25, supplies: 45, cash: 30 } },
    authority: { weights: { protectiveGear: 40, supplies: 25, combatMagic: 35 } },
    // One-time grails reward equipment, unique relics or magic only. Their
    // exhausted/owned equipment and relic lanes also terminate in magic.
    vista: { weights: { protectiveGear: 45, uniqueRelics: 5, magic: 50 } },
  };
  // Final surface weights for displayed T3+ chests. Starter chests keep
  // their supplies; higher-tier chests favour progression and useful magic.
  const highTierWeights = {
    roadside: { supplies: 45, materials: 40, cash: 15 },
    commerce: { cash: 70, gems: 30 },
    food: { food: 95, farmAnimals: 5 },
    // Crop seeds and tree seeds share the park's seed pool.
    park: { parkSeeds: 60, forage: 15, growth: 25 },
    farm: { farmSeeds: 25, farmProduce: 30, farmAnimals: 15, farmSupplies: 5, growth: 25 },
    flora: { flowerSeeds: 50, flowers: 50 },
    health: { medicalMagic: 100 },
    school: { books: 60, study: 40 },
    culture: { culturalGear: 20, gems: 20, books: 20, magic: 20, cash: 20 },
    worship: { revival: 55, shield: 20, books: 15, healing: 10 },
    civic: { uniqueRelics: 25, supplies: 45, cash: 30 },
    authority: { protectiveGear: 40, supplies: 25, combatMagic: 35 },
  };
  const qualityFloor = chestTier => chestTier >= 3 ? chestTier : 1;
  for (const [theme, row] of Object.entries(themes)) {
    row.t1Fallback = ['food', 'park', 'farm', 'worship'].includes(theme) ? 'restorative'
      : theme === 'flora' ? 'flowers' : theme === 'school' ? 'books'
      : theme === 'health' || theme === 'vista' ? 'antidote'
      : theme === 'commerce' ? 'cash' : 'torch';
  }
  const BOOK_T2_SHARE = 20;
  const memberCache = new Map();
  const aliases = { lowtier: 'roadside' };
  const normalize = theme => themes[theme] ? theme : aliases[theme] || 'roadside';
  const seedMultiplier = tier => tier >= 6 ? 0.25 : tier === 5 ? 0.33 : tier === 4 ? 0.5 : 1;
  const seedTransfers = { foodSeeds: { food: 1 }, parkSeeds: { forage: 1 }, farmSeeds: { farmProduce: 1 }, flowerSeeds: { growth: 0.5, parkSeeds: 0.5 } };
  function weights(theme, tier, opts = {}) {
    theme = normalize(theme);
    const high = (opts.tier ?? tier) >= 3 && highTierWeights[theme];
    const out = { ...(high || themes[theme].weights) };
    for (const [seed, targets] of Object.entries(seedTransfers)) {
      if (high) continue; // high-tier rows already specify their final seed shares
      const removed = (out[seed] || 0) * (1 - seedMultiplier(tier));
      if (!removed) continue;
      out[seed] -= removed;
      for (const [group, share] of Object.entries(targets)) out[group] = (out[group] || 0) + removed * share;
    }
    if (theme === 'vista' && (tier < 2 || (opts.tier ?? tier) < 2)) {
      out.magic += out.uniqueRelics;
      delete out.uniqueRelics;
    }
    if (opts.depth > 0 && theme !== 'vista') {
      for (const key of Object.keys(out)) out[key] *= 0.6;
      let cave = tier <= 1 ? { antidote: 60, torch: 40 }
        : tier === 2 ? { caveMagic: 60, torch: 15, rope: 10, trapKit: 10, field: 5 }
        : { caveMagic: 80, caveGems: 10, field: 10 };
      // The trap follows its catalog tier; moving its rarity must not remove
      // it from cave loot by leaving its only weight on an ineligible rung.
      if (tier >= ITEM_BY_ID.magic_trap.baseTier) {
        cave.field -= 5;
        cave.magicTrap = 5;
      }
      // The rebalanced identities hold UNDERGROUND too (Oct 2026): commerce
      // is coins and gems only, so the cave mix's field supplies, magic
      // pools and traps never join it - the whole underground share rides
      // the gem lane instead.
      if (normalize(theme) === 'commerce') cave = { caveGems: 100 };
      for (const [key, value] of Object.entries(cave)) out[key] = (out[key] || 0) + value * 0.4;
    }
    // Rare permanent finds: one weighted lane, never ordinary shop or loot stock.
    if (tier >= 2 && (opts.tier ?? tier) >= 2) {
      const share = ['culture', 'authority'].includes(theme) ? 5 : 0;
      if (share) {
        for (const key of Object.keys(out)) out[key] *= (100 - share) / 100;
        out.uniqueRelics = share;
      }
    }
    // THE BOOK IN EVERY TIER-2 ROLL (Oct 2026, owner's call): the school's
    // book club (macros.js scholar*) needs Books to turn up, and the Book
    // only drops from the school, culture and worship rows — so every chest
    // SEATED at tier 2 (opts.tier, the chest's own tier: its rolls climb from
    // T1, rarity.js rollRewardQuality) carries at least BOOK_T2_SHARE of
    // books, the rest of the row scaled to make room. Rows already past the
    // share (the school's 60) and the rare-finds lane above (uniqueRelics —
    // exactly 5 where it exists) are left alone. A row with a books lane
    // (culture, worship) has it topped up; a row without one gets the
    // plainBook group. Applied last: the net share.
    if ((opts.tier ?? tier) === 2) {
      const have = out.books || 0;
      if (have < BOOK_T2_SHARE) {
        const keep = out.uniqueRelics || 0;
        const lane = have > 0 ? 'books' : 'plainBook';
        const rest = Object.values(out).reduce((a, b) => a + b, 0) - have - keep;
        if (rest > 0) for (const key of Object.keys(out)) if (key !== lane && key !== 'uniqueRelics') out[key] *= (100 - BOOK_T2_SHARE - keep) / rest;
        out[lane] = BOOK_T2_SHARE;
      }
    }
    return out;
  }
  function members(group) {
    if (memberCache.has(group)) return memberCache.get(group);
    const def = groups[group];
    if (!def) throw new Error('Unknown chest group: ' + group);
    const ids = typeof def.ids === 'function' ? def.ids() : def.ids || [];
    const result = Object.freeze(Array.isArray(ids) ? Object.fromEntries(ids.map(id => [id, ITEM_BY_ID[id]?.dropWeight || 1])) : { ...ids });
    memberCache.set(group, result);
    return result;
  }
  function eligible(group, tier, opts = {}) {
    const def = groups[group];
    if (!def) throw new Error('Unknown chest group: ' + group);
    return Object.keys(members(group)).filter(id => {
      const item = ITEM_BY_ID[id];
      return item && !isTome(id) && !item.shiny && (!item.caveOnly || opts.depth > 0)
        && (!(opts.chestTier >= 3 && tier >= opts.chestTier && item.kind === 'magic')
          || cap(id) * itemValue(id) >= TIER_VALUE[Math.min(5, opts.chestTier)] / 2)
        // Unique relics never drop to a
        // player who already carries one (ChestThemes.cap holds them to one
        // per chest; this holds them to one per save).
        && ((item.kind !== 'unique_relic' && !item.unique) || !carriesItem(opts.save, id))
        && (def.minTier?.[normalize(opts.theme)] ?? item.baseTier ?? 1) <= tier;
    });
  }
  function fallback(group, theme) {
    const f = groups[group].fallback;
    return typeof f === 'object' ? f[normalize(theme)] || f.default : f;
  }
  // Returns all eligible tiers. The picker uses the highest, except cave pools
  // (70% highest / 30% lower) and a recognized food venue's 70% preference.
  function resolve(group, tier, opts = {}) {
    const seen = new Set();
    const original = group;
    while (group) {
      if (seen.has(group)) throw new Error('Chest fallback cycle: ' + [...seen, group].join(' → '));
      seen.add(group);
      const def = groups[group];
      if (!def) throw new Error('Unknown chest group: ' + group);
      if (def.kind === 'cash' || (def.kind === 'gear' && (opts.chestTier ?? tier) > 1))
        return { group, ids: [], kind: def.kind, fallback: group !== original };
      let ids = eligible(group, tier, opts);
      if (group === 'foodSeeds' && opts.venueProduct) {
        const seed = ids.find(id => ITEM_BY_ID[id].grows === opts.venueProduct);
        if (seed) ids = [seed];
        else { group = 'food'; continue; }
      }
      if (ids.length) return { group, ids, kind: 'item', fallback: group !== original };
      group = fallback(group, opts.theme);
    }
    throw new Error('Chest group has no T1 fallback: ' + original);
  }
  function selectableIds(resolved, opts = {}) {
    if (!resolved.ids.length) return [];
    if (groups[resolved.group].mixedTiers) return resolved.ids.slice();
    const top = Math.max(...resolved.ids.map(id => ITEM_BY_ID[id].baseTier || 1));
    return resolved.ids.filter(id => (ITEM_BY_ID[id].baseTier || 1) === top
      || (resolved.group === 'food' && id === opts.venueProduct));
  }
  function pickItem(resolved, tier, rng, opts = {}) {
    let pool = resolved.ids;
    if (resolved.group === 'food' && pool.includes(opts.venueProduct) && rng() < 0.7) return opts.venueProduct;
    const top = Math.max(...pool.map(id => ITEM_BY_ID[id].baseTier || 1));
    const lower = pool.filter(id => (ITEM_BY_ID[id].baseTier || 1) < top);
    pool = groups[resolved.group].mixedTiers && lower.length && rng() < 0.3
      ? lower : pool.filter(id => (ITEM_BY_ID[id].baseTier || 1) === top);
    const weights = members(resolved.group);
    return weightedPickBy(pool, id => weights[id] || 1, rng);
  }
  function cap(id) {
    const item = ITEM_BY_ID[id];
    if (item.kind === 'unique_relic') return 1;
    if (['elixir', 'resurrection_potion', 'book', 'scarecrow', 'magic_trap'].includes(id)) return 1;
    if (item.kind === 'animal' || item.plants === 'fruittree'
      || ['sapphire', 'ruby', 'emerald', 'diamond'].includes(id)) return 1;
    if (item.kind === 'magic') return item.uniqueJewelry ? 1 : 6;
    if (item.plants === 'tree') return 5;
    if (item.kind === 'seed') return magicalFlowers.includes(item.grows) ? 1 : 9;
    if (magicalFlowers.includes(id) || item.kind === 'mineral') return 3;
    return 5;
  }
  function quantity(id, tier, bracket, rng = Math.random) {
    if (id === 'wood' || id === 'rubble') return Math.min(12, 3 + Math.floor(rng() * 6) + bracket * 2);
    const allowance = TIER_VALUE[tier] * (1 + 0.5 * bracket);
    const count = allowance / Math.max(1, PRICES[id] || itemValue(id));
    // Magic and timber seeds round up to fill the allowance. Fruit saplings
    // still award one tree; a T2 acorn draw can now pay a small planting stack.
    const roundUp = ITEM_BY_ID[id].kind === 'magic' || ITEM_BY_ID[id].plants === 'tree';
    return Math.min(cap(id), Math.max(1, roundUp ? Math.ceil(count) : Math.floor(count)));
  }
  function gearSlots(group) {
    const def = groups[group];
    return [
      ...Object.keys(RELIC_DEFS).filter(slot => !def.armorOnly && (!def.slots || def.slots.includes(slot))).map(slot => ({ kind: 'relic', slot })),
      ...Object.keys(ARMOR_DEFS).filter(slot => !def.slots || def.slots.includes(slot)).map(slot => ({ kind: 'armor', slot })),
    ];
  }
  function validate() {
    for (const [theme, def] of Object.entries(themes)) {
      if (Object.values(def.weights).reduce((a, b) => a + b, 0) !== 100) throw new Error('Chest weights must total 100: ' + theme);
      for (let tier = 1; tier <= 7; tier++) for (const depth of [0, 1]) {
        const row = weights(theme, tier, { depth });
        if (Math.abs(Object.values(row).reduce((a, b) => a + b, 0) - 100) > 1e-9) throw new Error('Chest weights must total 100: ' + theme + '/' + tier);
        for (const group of Object.keys(row)) resolve(group, tier, { theme, depth, chestTier: Math.min(5, tier) });
      }
    }
    return true;
  }
  // Catch authored errors early; runtime still has each theme's declared T1
  // terminal so an unexpected bad entry cannot consume a chest for nothing.
  try { validate(); } catch (error) { console.error('Chest theme validation failed', error); }
  global.ChestThemes = { themes, highTierWeights, qualityFloor, groups, normalize, weights, members, BOOK_T2_SHARE, eligible, resolve, selectableIds, pickItem, cap, quantity, gearSlots, seedMultiplier, validate };
})(window);
