// Pure catalogue data. Load after the game modules (game-loader.js).
// Chest membership is derived from eligible pools, never sampled: a tiny
// jackpot probability is still a possible source. Values are base list values,
// before difficulty, equipment, shop or trailer multipliers.
(function (root) {
  function chestContents(context, tier, depth = 0) {
    if (!context.startsWith('chest:')) return [];
    const ctx = lootContext(context, { tier, depth });
    if (!ctx) return [];
    const out = new Set();
    for (const [cls, weight] of Object.entries(ctx.classBias)) {
      if (!(weight > 0)) continue;
      if (cls === 'relic') {
        if (!(ctx.relicCap > 0)) continue;
        // rollGearUpgrade uses the chest tier directly, not the item jackpot
        // tier or relicCap. Already-owned gear can turn into coins, not upgrade
        // past this ceiling. The wizard's ring is excluded by that picker.
        const cap = Math.min(7, Math.max(1, Math.round(1 + (tier - 1) * 2)));
        for (const [kind, defs] of [['relic', RELIC_DEFS], ['armor', ARMOR_DEFS]]) {
          for (const slot of Object.keys(defs)) {
            if (kind === 'relic' && slot === 'ring') continue;
            for (let t = 1; t <= cap; t++) out.add(`${kind}:${slot}:${t}`);
          }
        }
        continue;
      }
      if (cls === 'bundle') {
        for (const id of BUNDLE_IDS) out.add(id);
        continue;
      }
      const pools = ITEMS_BY_CLASS_TIER[cls];
      if (!pools) continue;
      const cap = Math.min(ctx.maxTier ?? 7, Math.max(...Object.keys(pools).map(Number)));
      // The chain can spend every step on quantity, leaving tier 1; up to
      // seven jackpot steps can reach every tier through the class/context cap.
      // Missing tiers fall back DOWN to the nearest populated pool.
      for (let t = 1; t <= cap; t++) {
        const fav = ctx.favourite;
        const candidates = !fav ? [] : fav.ids
          ? Object.entries(fav.ids).filter(([id, w]) => w > 0 && ITEM_BY_ID[id]?.kind === cls
              && (!fav.tierCapped || (ITEM_BY_ID[id].baseTier ?? 1) <= t)).map(([id]) => id)
          : (ITEM_BY_ID[fav.id]?.kind === cls ? [fav.id] : []);
        if (fav?.p > 0) for (const id of candidates) out.add(id);
        if (fav?.p >= 1 && candidates.length) continue;
        let pool = pools[t];
        for (let lower = t - 1; lower >= 1 && !pool?.length; lower--) pool = pools[lower];
        for (const id of pool || []) out.add(id);
      }
    }
    return [...out];
  }

  function build() {
    const sources = new Map();
    for (const context of Object.keys(LOOT_CONTEXTS).filter(key => key.startsWith('chest:'))) {
      const biome = context.slice('chest:'.length);
      const baseTier = CHEST_TIER_BY_CATEGORY[biome] || 2;
      const minTier = Math.max(1, baseTier - CHEST_TIER_HOME_RINGS_M.length);
      for (const depth of [0, 1]) {
        if (depth && CHEST_CAVE_SKIP_CATEGORIES.has(biome)) continue;
        for (let tier = minTier; tier <= (depth ? CHEST_TIER_MAX : baseTier); tier++) {
          const source = { context, tier, depth,
            label: `${biome} · T${tier} · ${depth ? 'underground' : 'surface'}` };
          for (const id of chestContents(context, tier, depth)) {
            if (!sources.has(id)) sources.set(id, []);
            sources.get(id).push(source);
          }
        }
      }
    }
    const addFixed = (id, context, label, tier = 0) => {
      if (!sources.has(id)) sources.set(id, []);
      if (!sources.get(id).some(source => source.context === context)) {
        sources.get(id).push({ context, tier, depth: 0, label });
      }
    };
    if (typeof Starter !== 'undefined') {
      for (const reward of Starter.STARTER_LOOT) {
        addFixed(reward.id, 'fixed:starter-supplies', 'Starter supply crate · easy mode');
      }
    }
    if (typeof STARTER_STASH !== 'undefined') {
      for (const reward of STARTER_STASH) {
        addFixed(reward.id, 'fixed:starter-stash', 'Starter stash crate · easy mode');
      }
    }
    if (typeof STARTER_RELIC_SLOTS !== 'undefined') {
      for (const slot of STARTER_RELIC_SLOTS) {
        for (const material of MATERIAL_TIERS.filter(t => t.tier >= STARTER_RELIC_TIER)) {
          addFixed(`relic:${slot}:${material.tier}`, 'fixed:starter-relic',
            'Starter relic chest' + (material.tier > STARTER_RELIC_TIER ? ' · conditional owned-gear upgrade' : ''), material.tier);
        }
      }
    }
    const rows = ITEMS.map(it => ({
      id: it.id, itemId: it.id, name: it.name, category: it.kind,
      inventoryCategory: invCatForItem(it.id), tier: it.baseTier,
      value: itemValue(it.id), description: ITEM_EFFECTS[it.id] || '',
      chests: sources.get(it.id) || [],
    }));
    for (const [kind, defs] of [['relic', RELIC_DEFS], ['armor', ARMOR_DEFS]]) {
      for (const slot of Object.keys(defs)) {
        for (const material of MATERIAL_TIERS) {
          const tier = material.tier, id = `${kind}:${slot}:${tier}`;
          rows.push({ id, gear: { kind, slot, tier }, name: gearName(kind, slot, tier),
            category: kind, inventoryCategory: kind, tier,
            value: gearPrice(kind, slot, tier),
            description: kind === 'armor'
              ? `−${armorSlotReduction(tier)} damage soaked${slot === 'boots' ? '; ' + ARMOR_DEFS.boots.blurb : ''}`
              : gearDef(kind, slot).blurb || '',
            chests: sources.get(id) || [],
          });
        }
      }
    }
    return rows;
  }
  root.ItemCatalog = { build, chestContents };
})(typeof window !== 'undefined' ? window : globalThis);
