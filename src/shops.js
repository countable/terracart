// Shop registry: specialty-shop taxonomy + per-type config (label, tint) for
// small-house shops. WHAT A RESTORED HOUSE IS, the player picks at the wreck
// (houses.js BUILD_OPTIONS / restoreAs — the role string frozen into
// save.restoredHouses). The address ending → role mapping below is only the
// LEGACY FALLBACK (Houses.houseShopRole) for a house whose ledger entry is a
// bare `true` — saves from before roles were frozen, and the sandbox, which
// stamps `true` so its test street shows every storefront:
//   9       → blacksmith (sooty tint, gem→relic forge)
//   2 / 4 / 6 → market  (red tint, a THEMED shop — seed / supply / potion /
//                        relic, by restore order; see themeAt)
//   1 / 8   → trader    (no tint, barter-only deals)
// Forts (BUILDING_MED) and civic slabs (BUILDING_LARGE) are excluded — the
// shopType helper returns null for any house that isn't the small tier.
//
// Depends on:
//   worldgen.js — WorldGen.T  (for T.BUILDING tier check)
//
// Exports as globals:
//   Shops.shopType(house)         → 'blacksmith' | 'market' | 'trader' | null
//   Shops.shopInk(house)          → signage lettering colour or null
//   Shops.roleLabel(role, seed, goods) → the player-facing NAME of a shop role
//
// There is no shopTint() / shopLabel(): the OSM address digit would paint a
// plain house as a shop it isn't, so render.js keys off the house's resolved
// role instead (see _houseSignText and the tint block there).

(function (global) {
  // Per-type config — a new shop type is one entry here plus wiring into
  // shopInteract(). ink: lettering colour on the wood sign, picked to read on
  // the SHOP_INK_BG dark-wood background (render.js).
  const SHOP_CONFIG = {
    blacksmith: { ink: '#d8d8d8' },  // steel
    market:     { ink: '#ff7a6a' },  // red
    trader:     { ink: UI_GOLD },    // gold
  };

  // ── What the player calls each shop ───────────────────────────────────────
  // ONE table for every player-facing name: the map sign (render.js
  // _houseSignText), the restoration card (app.js shopInteract) and the offer
  // modal's flavour line (app.js buildingFlavorTitle).
  //
  // The themed storefront (role key 'market') is named for the LINE IT SELLS
  // ("Potion Shop", never "Market") off its theme (THEME_LABEL, resolved by
  // themeAt). Category, not item: stock re-rolls hourly, so a per-item name
  // would rewrite the sign constantly.
  //
  // The trader is named for the GOODS IT OFFERS ("Rockfruit Trader"). Its
  // barter is one item at a time (app.js peekOrBuildTraderOffer), so the item
  // IS the identity, and the sign rotates exactly when the offer does. With no
  // offer to name it falls back to a bare "Trader".
  //
  // The role KEY stays 'market': it is persisted in save.restoredHouses and
  // read back by shopOrder.
  const ROLE_LABEL = {
    blacksmith: 'Blacksmith',
    market:     'Shop',          // a themed shop with no theme to name (see THEME_LABEL)
    trader:     'Trader',
    wizard:     'Wizard',
    turret:     'Turret',        // a lone castle tower on a house lot (houses.js BUILD_OPTIONS)
  };
  // Player-facing name for a shop role, or null for a role with no sign.
  // `theme` names a themed shop's line (THEMES); `goods` is the display name of
  // the item a trader currently offers ("Rockfruit"), which names the trader.
  function roleLabel(role, theme = null, goods = null) {
    if (role === 'market' && THEME_LABEL[theme]) return THEME_LABEL[theme];
    if (role === 'trader' && goods) return `${goods} ${ROLE_LABEL.trader}`;
    return ROLE_LABEL[role] ?? null;
  }
  // The sign on a building with NO shop role (render.js _houseSignText):
  // Home, the castle, the fort and the plain house, by the building's
  // tier, and the story tower by its MemoryStory.towerAccess state.
  const BUILDING_LABEL = { trailer: 'Home', 12: 'Castle', 11: 'Fort', 9: 'House' };
  const TOWER_LABEL = { locked: 'Sealed Tower', abandoned: 'Abandoned Tower', empty: 'Empty Tower', open: 'Wizard Tower' };

  function shopType(house) {
    if (!house || house.kind !== 'house') return null;
    if (house.tier !== WorldGen.T.BUILDING) return null;   // forts / civic slabs excluded
    const d = (house.address ?? 0) % 10;
    if (d === 9) return 'blacksmith';
    if (d === 2 || d === 4 || d === 6) return 'market';
    if (d === 1 || d === 8) return 'trader';
    return null;
  }

  // Resolve a house to its SHOP_CONFIG entry (or null for non-shops).
  const shopConfig = (house) => SHOP_CONFIG[shopType(house)] ?? null;

  const shopInk = (house) => shopConfig(house)?.ink ?? null;

  // ── THEMED SHOPS ──────────────────────────────────────────────────────────
  // A shop (role key 'market') sells ONE LINE at ONE TIER — the player's pick
  // on the restore modal (houses.js offerCards: a card per line and rank
  // the ladder has unlocked, LINE_RULES below). A market from before lines
  // were stored takes its line from its place in the order the player
  // restored shops (themeAt: seed, supply, potion, relic, round again a
  // tier higher).
  //
  // The order is the save's own record (save.restoredHouses keeps insertion
  // order, the delivery.js houseOrder idiom), so a restored shop keeps its line.
  //
  // Half the rolls offer batches from exactly one tier below, when stocked;
  // otherwise the nearest stocked tier (ties go LOWER). The relic line is gear, rolled by Gear.buildRelicOffer
  // (never at or below what the player already wears), so it has no pool here.
  // THE LINES AND THEIR RULES (owner, Oct 2026): the one table of shop lines
  // a Shop card can open — the tiers a line exists at (`maxTier`) and how
  // many may stand at one tier (`perTier`; unlimited when absent). Seed and
  // Supply stop at T3, the Magic Shop is one per tier, the Relic Shop runs
  // even tiers T2/T4/T6 any number deep; Magic uses T1/T3/T5/T7. The Ore Shop is gone. The Book and Pet
  // lines are NOT here — they are one-offs, SOLO_LINES. THEMES is the
  // table's keys, in this order: the legacy cycle (themeAt, for a market
  // restored before lines were stored) walks it.
  const SHOP_TIER_MAX = 7;
  const LINE_RULES = Object.freeze({
    seed:   { maxTier: 3 },
    supply: { maxTier: 3 },
    potion: { maxTier: SHOP_TIER_MAX, tiers: [1, 3, 5, 7], perTier: 1 },
    relic:  { maxTier: 6, tiers: [2, 4, 6] },
  });
  const THEMES = Object.keys(LINE_RULES);
  // ONE-OFF LINES (owner, Oct 2026): a line exactly ONE market per save
  // sells, outside the cycle — the Book Shop (save.bookshopId, from the 15th
  // restore) and the Pet Shop (save.petshopId, from the 12th), each its own
  // card in houses.js BUILD_OPTIONS (`solo`, stamped by registerSoloShop).
  // A solo shop is a market plus its stamp: shopOrder and marketLines skip
  // it, so the markets after it keep the lines they would have had, and the
  // line never comes round again at a higher tier — it is always T1.
  const SOLO_LINES = Object.freeze({ book: 'bookshopId', pet: 'petshopId' });
  const THEME_LABEL = {
    seed: 'Seed Shop', supply: 'Supply Shop', potion: 'Magic Shop',
    relic: 'Relic Shop',
    pet: 'Pet Shop', book: 'Book Shop',   // the one-offs (SOLO_LINES) — outside LINE_RULES
  };
  // What the Restored! card says a shop of each line looks like inside
  // (app.js presentWreckRestoreModal) — the line's own sentence, beside its name.
  const THEME_BLURB = {
    seed:   'You find packets of seeds on the shelves.',
    supply: 'You find supplies for the road on the shelves.',
    potion: 'You watch strange colours swirl in bottles behind the counter.',
    relic:  'You inspect the tools and armour hanging behind the counter.',
    pet:    'Soft collars and little charms hang above the counter.',
    book:   'Shelves of books line the walls.',
  };
  // Resolved at CALL time: items.js (BUY_LIST, the catalogue) is read when a
  // shop is opened, not when this file loads.
  const THEME_POOL = {
    // The seeds any shop may sell (BUY_LIST: T1..T3 crops — the magical
    // flowers stay find-only).
    seed:   () => (typeof BUY_LIST !== 'undefined' ? BUY_LIST.slice() : []),
    supply: () => ['wood', 'rubble', 'torch', 'rope', 'trap_disarm_kit', 'throwing_spear', 'javelin', 'scarecrow', 'barricade', 'magic_trap', 'sugar_potion', 'renovation_permit'],
    potion: () => ITEMS.filter(item => item.kind === 'magic' && !item.uniqueJewelry && !item.progressionOnly).map(item => item.id),
    pet:    () => ITEMS.filter(it => it.petAccessory).map(it => it.id),
    // The bookshop's line: only the Book, at the price ladder (shops_math.js listPrice).
    book:   () => ['book'],
  };


  // The line + tier for the Nth shop restored (0-based).
  function themeAt(order) {
    const o = Math.max(0, order | 0);
    return { theme: THEMES[o % THEMES.length], tier: 1 + Math.floor(o / THEMES.length) };
  }

  // 0-based place of this shop among the save's restored shops, in restore
  // order. A shop that isn't in the record (an address-derived market from
  // before roles were frozen) gets a stable place off its id instead, within
  // the first round, so it still has a line and it never shifts.
  function shopOrder(save, house) {
    if (!house || !house.id) return 0;
    const rh = (save && save.restoredHouses) || {};
    if (rh[house.id] === 'market') {
      let n = 0;
      for (const id of Object.keys(rh)) {
        if (rh[id] !== 'market' || isSoloShop(save, id)) continue;   // a solo shop takes no place in the cycle
        if (id === house.id) return n;
        n++;
      }
    }
    return fnv1a(String(house.id) + '|theme') % THEMES.length;
  }

  // The solo line this house was stamped with (SOLO_LINES), or null for a
  // market of the cycle. Every themed-shop reader goes through lineFor,
  // never themeAt directly.
  function soloLine(save, houseId) {
    if (!save || houseId == null) return null;
    for (const theme of Object.keys(SOLO_LINES)) {
      const id = save[SOLO_LINES[theme]];
      if (id != null && String(houseId) === String(id)) return theme;
    }
    return null;
  }
  function isSoloShop(save, houseId) { return soloLine(save, houseId) != null; }
  function isBookshop(save, houseId) { return soloLine(save, houseId) === 'book'; }
  // THE LINE AND THE TIER ARE THE PLAYER'S PICK: a market restored off a Shop
  // card carries its chosen line in save.shopLines[id] and its rank in
  // save.shopTiers[id] (houses.js restoreAs stamps both; storedTier reads
  // the rank for every ranked role). A market from before ranks were stored
  // takes one past the markets before it on the same line; one with no
  // stored line keeps the cycle's answer, themeAt(shopOrder). One walk over
  // the ledger resolves every market's line and tier in restore order.
  function marketLines(save) {
    const rh = (save && save.restoredHouses) || {};
    const stored = (save && save.shopLines) || {};
    const out = [];
    let n = 0;
    const seen = {};
    for (const id of Object.keys(rh)) {
      if (rh[id] !== 'market' || isSoloShop(save, id)) continue;
      let theme, tier;
      // Any line the pools know (a market picked as a Pet Shop before the
      // line became a one-off keeps its pet accessories), else the cycle's answer.
      if (LINE_RULES[stored[id]] || THEME_POOL[stored[id]]) { theme = stored[id]; tier = storedTier(save, id) ?? 1 + (seen[theme] || 0); }
      else ({ theme, tier } = themeAt(n));
      seen[theme] = (seen[theme] || 0) + 1;
      out.push({ id, theme, tier });
      n++;
    }
    return out;
  }
  function lineFor(save, house) {
    const solo = house ? soloLine(save, house.id) : null;
    if (solo) return { theme: solo, tier: 1 };
    const stored = save?.shopLines?.[house?.id];
    if (house && (LINE_RULES[stored] || THEME_POOL[stored])) {
      const row = marketLines(save).find((r) => r.id === String(house.id));
      if (row) return { theme: row.theme, tier: row.tier };
    }
    return themeAt(shopOrder(save, house));
  }
  // How many markets of this line stand at this tier.
  function lineCount(save, theme, tier) {
    return marketLines(save).filter((r) => r.theme === theme && r.tier === tier).length;
  }
  // May a market of `theme` be raised at `tier`? The line must exist at
  // that rank (LINE_RULES maxTier) and its per-tier cap (perTier) must not
  // be full. The ladder (tierCap) is the caller's question.
  function lineBuildable(save, theme, tier) {
    const rule = LINE_RULES[theme];
    if (!rule || !Number.isInteger(tier) || tier < 1 || tier > rule.maxTier) return false;
    if (rule.tiers && !rule.tiers.includes(tier)) return false;
    if (rule.perTier != null && lineCount(save, theme, tier) >= rule.perTier) return false;
    return true;
  }

  // An item's tier for stocking and the trader's lean (items.js itemTierOf,
  // the one lookup; an unknown id stocks as T1).
  function itemTier(id) { return itemTierOf(id, 1); }

  // ── RANKS ─────────────────────────────────────────────────────────────────
  // A shop, a smithy and a trader each carry a tier (T1..SHOP_TIER_MAX). THE
  // RANK IS THE PLAYER'S PICK (owner, Oct 2026): the restore modal offers a
  // card per rank the ladder has unlocked, any number may stand at one rank
  // (a line's own cap aside, LINE_RULES), and restoreAs stamps the pick in
  // save.shopTiers[id] — storedTier, which every reader below asks first. A
  // standing building climbs a rank under a RENOVATION PERMIT (items.js
  // renovation_permit, a T4 supply; houses.js renovateTo / renovate — the
  // ledger's second writer), to a rank the ladder has unlocked.
  //   THE LADDER (tierCap) climbs by MEMORIES, never by wrecks restored
  //   (owner, Oct 2026): rank t opens at (t - 1) × MEMORIES_PER_TIER
  //   lifetime memories (MemoryStory.total — the discovered ledger): T2 at
  //   five, T3 at ten, T7 at thirty. T1 waits only on the role's own slot
  //   (houses.js STORY_RESTORES).
  //   A smithy's anvil favours its own tier and forges nothing more than one
  //   tier above or below it (gear.js relicOfferWeights, opts.smithTier); a
  //   trader offers goods at exactly its tier (traderStock).
  // Houses from before ranks were stored keep the derivations that raised
  // them: the Nth smithy was tier N, a trader took the old restore-number
  // ladder's rank (traderTierAt). The map badge, the offer blurb, the
  // restore card and the Restored! card all read shopTier.
  const MEMORIES_PER_TIER = 5;
  const LEGACY_TRADER_TIER_EVERY = 5;
  const clampTier = (t) => Math.max(1, Math.min(SHOP_TIER_MAX, t | 0));
  function memoryTotal(save) {
    return (typeof MemoryStory !== 'undefined') ? MemoryStory.total(save || {}) : Object.keys(save?.discovered || {}).length;
  }
  function tierCap(save) { return clampTier(1 + Math.floor(memoryTotal(save) / MEMORIES_PER_TIER)); }
  function tierUnlockMemories(tier) { return Math.max(0, (tier | 0) - 1) * MEMORIES_PER_TIER; }
  function storedTier(save, houseId) {
    const t = save && save.shopTiers && houseId != null ? save.shopTiers[houseId] : null;
    return Number.isInteger(t) && t >= 1 ? clampTier(t) : null;
  }
  // The restored blacksmiths, in restore order.
  function smithIds(save) {
    const rh = (save && save.restoredHouses) || {};
    return Object.keys(rh).filter((id) => rh[id] === 'blacksmith');
  }
  function smithTier(save, house) {
    if (!house || house.id == null) return 1;
    const stored = storedTier(save, house.id);
    if (stored) return stored;
    const n = smithIds(save).indexOf(String(house.id));
    return clampTier(n < 0 ? 1 : n + 1);   // the stamped starter smith off the ledger: tier 1
  }
  // A trader raised as restore number `n` (1-based), before ranks were stored.
  function traderTierAt(n) { return clampTier(Math.floor(n / LEGACY_TRADER_TIER_EVERY)); }
  function traderTier(save, house) {
    if (!house || house.id == null) return 1;
    const stored = storedTier(save, house.id);
    if (stored) return stored;
    const n = Object.keys((save && save.restoredHouses) || {}).indexOf(String(house.id));
    return n < 0 ? 1 : traderTierAt(n + 1);
  }
  // The one tier every badge reads, by role; null for a role with none.
  function shopTier(save, house, role) {
    if (role === 'market') return lineFor(save, house).tier;
    if (role === 'blacksmith') return smithTier(save, house);
    if (role === 'trader') return traderTier(save, house);
    return null;
  }
  // How many houses of a ranked role (a smithy, a trader) stand at `tier`.
  function roleTierCount(save, role, tier) {
    const rh = (save && save.restoredHouses) || {};
    return Object.keys(rh).filter((id) => rh[id] === role && shopTier(save, { kind: 'house', id }, role) === tier).length;
  }
  // How much a shop of tier `tier` wants to carry an item of tier `itemT`:
  // full weight at its own tier, halved per tier away. A lean, not a wall —
  // a T1 trader still hands over the odd T3 seed.
  function tierAffinity(itemT, tier) { return 1 / Math.pow(2, Math.abs((itemT | 0) - (tier | 0))); }

  // What a shop of this line and tier can stock: every item of the line at the
  // nearest tier it carries (ties go to the lower tier). [] for the relic line.
  function themedStock(theme, tier) {
    const pool = THEME_POOL[theme];
    if (!pool) return [];
    const ids = pool().filter((id) => typeof ITEM_BY_ID === 'undefined' || ITEM_BY_ID[id]);
    if (!ids.length) return [];
    let best = null;
    for (const id of ids) {
      const t = itemTier(id);
      const d = Math.abs(t - tier);
      if (best === null || d < best.d || (d === best.d && t < best.t)) best = { d, t };
    }
    return ids.filter((id) => itemTier(id) === best.t);
  }

  // Half the shelves carry a batch from exactly one tier below, when the
  // line has such items. Sparse lines retain their nearest-tier fallback.
  const THEMED_BATCH_CHANCE = 0.5;
  function batchStock(theme, tier) {
    return tier > 1 ? (THEME_POOL[theme]?.() || []).filter(id => itemTier(id) === tier - 1) : [];
  }
  function themedOfferStock(theme, tier) {
    return [...new Set([...themedStock(theme, tier), ...batchStock(theme, tier)])];
  }
  function themedQuantity(id, tier, rng = Math.random) {
    return itemTier(id) === tier - 1 ? 2 + Math.floor(rng() * 3) : 1;
  }
  // The one item this shop sells right now, off the caller's seeded rng.
  function pickThemed(theme, tier, rng = Math.random) {
    const lower = batchStock(theme, tier);
    const stock = lower.length && rng() < THEMED_BATCH_CHANCE ? lower : themedStock(theme, tier);
    if (!stock.length) return null;
    return pickFromArray(stock, rng);
  }

  let prices = null;
  const traderStocks = new Map();
  function traderPrices() {
    if (!prices) {
      const gearIds = new Set(Gear.uniqueRelics().map(item => item.id));
      prices = Object.fromEntries(ITEMS.filter(item => !item.progressionOnly && !gearIds.has(item.id)).map(item => [item.id, itemValue(item.id)]));
    }
    return prices;
  }
  function traderStock(tier) {
    if (!traderStocks.has(tier)) traderStocks.set(tier, Object.keys(traderPrices()).filter(id => itemTier(id) === tier));
    return traderStocks.get(tier);
  }

  global.Shops = {
    shopType, shopInk,
    ROLE_LABEL, roleLabel, BUILDING_LABEL, TOWER_LABEL,
    THEMED_BATCH_CHANCE, batchStock, themedOfferStock, themedQuantity, traderPrices, traderStock,
    LINE_RULES, THEMES, SOLO_LINES, soloLine, isSoloShop, THEME_LABEL, THEME_BLURB, THEME_POOL, themeAt, shopOrder, isBookshop, marketLines, lineFor, lineCount, lineBuildable, themedStock, itemTier,
    MEMORIES_PER_TIER, SHOP_TIER_MAX, memoryTotal, tierCap, tierUnlockMemories, storedTier, smithTier, traderTierAt, traderTier, shopTier, roleTierCount, tierAffinity, pickThemed,
  };
})(window);
