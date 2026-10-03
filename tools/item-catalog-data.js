// Pure catalogue data. Load after the game modules (game-loader.js).
// Chest membership is derived from eligible pools, never sampled: a tiny
// jackpot probability is still a possible source. Values are base list values,
// before difficulty, equipment, shop or trailer multipliers.
(function (root) {
  function chestContents(context, tier, depth = 0) {
    if (!context.startsWith('chest:')) return [];
    const theme = ChestThemes.normalize(context.slice(6));
    const out = new Set();
    // Include rare jackpot qualities through the actual context ceiling.
    // Share the game's group weights, eligibility and fallbacks, rather than
    // maintaining a second item pool just for this catalogue.
    const maxTier = lootContext(context, { tier, depth }).maxTier;
    for (let quality = 1; quality <= maxTier; quality++) {
      const opts = { theme, depth, tier, chestTier: tier };
      for (const [group, weight] of Object.entries(ChestThemes.weights(theme, quality, opts))) {
        if (!(weight > 0)) continue;
        const resolved = ChestThemes.resolve(group, quality, opts);
        if (resolved.kind === 'item') {
          for (const id of ChestThemes.selectableIds(resolved, opts)) out.add(id);
        } else if (resolved.kind === 'gear') {
          const cap = Math.min(7, Math.max(1, Math.round(1 + (tier - 1) * 2)));
          for (const { kind, slot } of ChestThemes.gearSlots(resolved.group)) {
            for (let t = 1; t <= cap; t++) out.add(`${kind}:${slot}:${t}`);
          }
        }
      }
    }
    return [...out];
  }

  function build() {
    const sources = new Map();
    for (const [biome, definition] of Object.entries(ChestThemes.themes)) {
      const context = 'chest:' + biome;
      // A chest's tier is its tile's quota seat (worldgen.js
      // seedChestTiers, read by loot.js chestTier): seats round-robin across
      // categories, so any theme can stand at T1 (unseated) up to T5, and a
      // zone nexus lifts that one more — so every theme is listed at every
      // tier, on the surface and below.
      void definition;
      for (const depth of [0, 1]) {
        if (depth && biome === 'roadside') continue;
        for (let tier = 1; tier <= CHEST_TIER_MAX; tier++) {
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
      growthStageMs: it.kind === 'seed' && it.grows ? Crops.stageHoldMs(it.grows) : null,
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
  // Ignore faint sprite-sheet fringe pixels when fitting catalogue portraits.
  function iconBounds({ data, width, height }) {
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 128) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return x1 < x0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  }
  root.ItemCatalog = { build, chestContents, iconBounds };
})(typeof window !== 'undefined' ? window : globalThis);
