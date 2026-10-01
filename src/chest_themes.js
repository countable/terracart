// Themed chest pools. Catalog membership, fallback and quantity policy are shared
// by the game and source/balance tools; geography remains owned by loot.js.
(function (global) {
  const flowers = ['flowers', 'forgetmenot', 'marigold', 'wildrose', 'starflower', 'sunflower', 'fireflower', 'iceflower'];
  const magicalFlowers = ['sunflower', 'fireflower', 'iceflower'];
  // Utility food can restore zero energy and still be a harvestable meal.
  const foodIds = () => ITEMS.filter(i => i.kind === 'produce' && !i.cooked
    && Number.isFinite(FOOD_ENERGY[i.id]) && FOOD_ENERGY[i.id] >= 0 && !flowers.includes(i.id)).map(i => i.id);
  const cropSeeds = () => ITEMS.filter(i => i.kind === 'seed' && foodIds().includes(i.grows)).map(i => i.id);
  const groups = {
    uniqueRelics: { ids: () => ITEMS.filter(i => i.kind === 'unique_relic').map(i => i.id), mixedTiers: true, fallback: 'torch' },
    supplies: { ids: { torch: 3, rope: 1, trap_kit: 1, honey: 1 }, fallback: 'torch' },
    field: { ids: ['torch', 'rope', 'trap_kit'], fallback: 'torch' },
    farmSupplies: { ids: ['scarecrow', 'honey'], fallback: 'torch' },
    materials: { ids: ['wood', 'rockfruit'] },
    cash: { kind: 'cash' },
    restorative: { ids: ['berry', 'cress', 'potato', 'egg', 'milk'] },
    food: { ids: foodIds, fallback: 'restorative' },
    foodSeeds: { ids: cropSeeds, fallback: 'food' },
    parkSeeds: { ids: cropSeeds, fallback: 'restorative' },
    farmSeeds: { ids: cropSeeds, fallback: 'restorative' },
    farmProduce: { ids: () => cropSeeds().map(id => ITEM_BY_ID[id].grows), fallback: 'restorative' },
    flowerSeeds: { ids: magicalFlowers.map(id => id + '_seed'), fallback: 'flowers' },
    flowers: { ids: flowers },
    forage: { ids: flowers.filter(id => !magicalFlowers.includes(id)).concat(['berry', 'mushroom']) },
    saplings: { ids: ['acorn', 'apple_sapling', 'peach_sapling'], fallback: { flora: 'flowers', default: 'parkSeeds' } },
    growth: { ids: ['growth_powder'], fallback: { flora: 'flowers', farm: 'farmSupplies', default: 'parkSeeds' } },
    farmAnimals: { ids: ['chicken', 'cow', 'rabbit'], fallback: 'farmProduce' },
    companions: { ids: ['cat', 'dog', 'rabbit'], fallback: 'animalFood' },
    animalFood: { ids: () => [...new Set(['cat', 'dog', 'rabbit'].flatMap(k => ANIMAL_FOOD[k] || []))], fallback: 'restorative' },
    recovery: { ids: ['vigor_potion', 'elixir'], fallback: 'restorative' },
    antidote: { ids: ['antidote'] },
    healing: { ids: { vigor_potion: 3, revive_potion: 2, resurrection_potion: 1, elixir: 1 }, fallback: { vista: 'antidote', default: 'restorative' } },
    revival: { ids: { revive_potion: 3, resurrection_potion: 1 }, fallback: 'restorative' },
    shield: { ids: ['shield_potion'], fallback: { health: 'restorative', worship: 'restorative', default: 'field' } },
    study: { ids: { reach_potion: 2, raven_potion: 1, shield_potion: 1 }, fallback: 'books' },
    shadow: { ids: { raven_potion: 1, shadow_powder: 1 }, fallback: 'flowers' },
    gems: { ids: ['sapphire', 'ruby', 'emerald', 'diamond'], fallback: { culture: 'books', vista: 'antidote', default: 'field' } },
    // The story Book is a T1 item: every book chest can hand one, whatever
    // its rolled quality (the old minTier {school: 1} override died with the
    // tomes - it would have admitted THEM at T1 too, because it replaced the
    // baseTier check for the whole group). The TOMES sit at T3/4/5, and
    // pickItem takes the top tier present, so they replace the Book exactly
    // at and above its own tier.
    books: { ids: ['book', 'tome_sight', 'tome_raven', 'tome_storm'], fallback: 'torch' },
    honey: { ids: ['honey'], fallback: 'restorative' },
    torch: { ids: ['torch'] },
    rope: { ids: ['rope'], fallback: 'torch' },
    trapKit: { ids: ['trap_kit'], fallback: 'torch' },
    magicTrap: { ids: ['magic_trap'], fallback: 'field' },
    caveMagic: { ids: () => ITEMS.filter(i => i.kind === 'magic' && !i.uniqueJewelry).map(i => i.id), mixedTiers: true, fallback: 'torch' },
    caveGems: { ids: ['sapphire', 'ruby', 'emerald', 'diamond'], mixedTiers: true, fallback: 'field' },
    noncombatGear: { kind: 'gear', slots: ['bags', 'can', 'hoe', 'rod', 'bugnet'], fallback: { school: 'books', default: 'supplies' } },
    protectiveGear: { kind: 'gear', armorOnly: true, fallback: 'field' },
    culturalGear: { kind: 'gear', fallback: 'books' },
  };
  const themes = {
    roadside: { tier: 1, weights: { supplies: 45, materials: 40, cash: 15 } },
    commerce: { tier: 1, weights: { cash: 60, supplies: 25, restorative: 15 } },
    food: { tier: 1, weights: { food: 80, foodSeeds: 15, honey: 5 } },
    park: { tier: 2, weights: { parkSeeds: 45, saplings: 25, forage: 20, growth: 10 } },
    farm: { tier: 3, weights: { farmSeeds: 40, farmProduce: 30, farmAnimals: 15, farmSupplies: 10, growth: 5 } },
    flora: { tier: 4, weights: { flowerSeeds: 45, flowers: 30, saplings: 15, growth: 10 } },
    health: { tier: 3, weights: { recovery: 35, antidote: 25, revival: 20, restorative: 10, shield: 10 } },
    school: { tier: 3, weights: { books: 55, field: 15, study: 20, noncombatGear: 10 } },
    culture: { tier: 3, weights: { culturalGear: 35, gems: 30, books: 25, study: 10 } },
    worship: { tier: 3, weights: { revival: 50, shield: 25, books: 15, flowers: 10 } },
    civic: { tier: 3, weights: { supplies: 35, cash: 30, books: 20, noncombatGear: 15 } },
    authority: { tier: 3, weights: { protectiveGear: 40, field: 40, healing: 15, cash: 5 } },
    pets: { tier: 3, weights: { companions: 70, animalFood: 20, supplies: 10 } },
    // The VIEWPOINT GRAIL (src/scenic.js Scenic.VISTA_CHEST_TIER.grail, T4,
    // one-time — loot.js chestThemeFor routes o.vista==='grail' here instead
    // of its poiClass's 'civic' theme). A lookout's own pool, not the town
    // hall's: a small relic chance (noncombatGear — a real gear/relic roll at
    // T4), a gem, a good consumable (healing) and coins, weighted light on
    // the relic (T4 gear is steep — baseCost*costMul/4, up to ×70 at T7 on a
    // jackpot) so the one-time grail averages ~150 value (design target
    // 100-160), not the ~440 a civic T4 chest pays. Measured 20k-sample MC,
    // scratchpad scenic2/vista_theme.js: 149.9 avg.
    // Vista grails hold treasure, never workaday goods: equipment (armour),
    // relics (the uniqueRelics lane), magic items (potions, gems) or coins -
    // no tools, no produce, no field supplies (anywhere in the fallback
    // chain, which is why every vista fallback terminates at 'antidote',
    // a T1 magic potion whose group can never be empty).
    vista: { tier: 4, weights: { protectiveGear: 1, gems: 15, healing: 42, cash: 42 } },
  };
  for (const [theme, row] of Object.entries(themes)) {
    row.t1Fallback = ['food', 'park', 'farm', 'health', 'worship', 'pets'].includes(theme) ? 'restorative'
      : theme === 'flora' ? 'flowers' : theme === 'school' ? 'books'
      : theme === 'vista' ? 'antidote' : 'torch';
  }
  const memberCache = new Map();
  const aliases = { lowtier: 'roadside' };
  const normalize = theme => themes[theme] ? theme : aliases[theme] || 'roadside';
  const seedMultiplier = tier => tier >= 6 ? 0.25 : tier === 5 ? 0.33 : tier === 4 ? 0.5 : 1;
  const seedTransfers = { foodSeeds: { food: 1 }, parkSeeds: { forage: 1 }, farmSeeds: { farmProduce: 1 }, flowerSeeds: { growth: 0.5, saplings: 0.5 } };
  function weights(theme, tier, opts = {}) {
    const out = { ...themes[normalize(theme)].weights };
    for (const [seed, targets] of Object.entries(seedTransfers)) {
      const removed = (out[seed] || 0) * (1 - seedMultiplier(tier));
      if (!removed) continue;
      out[seed] -= removed;
      for (const [group, share] of Object.entries(targets)) out[group] = (out[group] || 0) + removed * share;
    }
    if (opts.depth > 0) {
      for (const key of Object.keys(out)) out[key] *= 0.6;
      const cave = tier <= 1 ? { antidote: 60, torch: 40 }
        : tier === 2 ? { caveMagic: 60, torch: 15, rope: 10, trapKit: 10, field: 5 }
        : { caveMagic: 80, caveGems: 10, field: 10 };
      // The trap follows its catalog tier; moving its rarity must not remove
      // it from cave loot by leaving its only weight on an ineligible rung.
      if (tier >= ITEM_BY_ID.magic_trap.baseTier) {
        cave.field -= 5;
        cave.magicTrap = 5;
      }
      for (const [key, value] of Object.entries(cave)) out[key] = (out[key] || 0) + value * 0.4;
    }
    // Rare permanent finds: one weighted lane, never ordinary shop or loot stock.
    if (tier >= 2 && (opts.tier ?? tier) >= 2) {
      const share = ['culture', 'authority', 'vista'].includes(normalize(theme)) ? 5 : 0;
      if (share) {
        for (const key of Object.keys(out)) out[key] *= (100 - share) / 100;
        out.uniqueRelics = share;
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
      return item && !item.shiny && !item.cooked && (!item.caveOnly || opts.depth > 0)
        && (item.kind !== 'unique_relic' || !carriesItem(opts.save, id))
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
    if (['antidote', 'elixir', 'resurrection_potion', 'book', 'scarecrow', 'magic_trap',
         'tome_sight', 'tome_raven', 'tome_storm'].includes(id)) return 1;
    if (['animal', 'sapling'].includes(item.kind) || ['sapphire', 'ruby', 'emerald', 'diamond'].includes(id)) return 1;
    if (item.kind === 'magic') return 3;
    if (item.kind === 'seed') return magicalFlowers.includes(item.grows) ? 1 : 9;
    if (magicalFlowers.includes(id) || item.kind === 'mineral') return 3;
    return 5;
  }
  function quantity(id, tier, bracket, rng = Math.random) {
    if (id === 'wood' || id === 'rockfruit') return Math.min(12, 3 + Math.floor(rng() * 6) + bracket * 2);
    const allowance = TIER_VALUE[tier] * (1 + 0.5 * bracket);
    return Math.min(cap(id), Math.max(1, Math.floor(allowance / Math.max(1, PRICES[id] || itemValue(id)))));
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
        for (const group of Object.keys(weights(theme, tier, { depth }))) resolve(group, tier, { theme, depth, chestTier: tier });
      }
    }
    return true;
  }
  // Catch authored errors early; runtime still has each theme's declared T1
  // terminal so an unexpected bad entry cannot consume a chest for nothing.
  try { validate(); } catch (error) { console.error('Chest theme validation failed', error); }
  global.ChestThemes = { themes, groups, normalize, weights, members, eligible, resolve, selectableIds, pickItem, cap, quantity, gearSlots, seedMultiplier, validate };
})(window);
