// Shop registry: specialty-shop taxonomy + per-type config (label, tint) for
// small-house shops. WHAT A RESTORED HOUSE IS, the player picks at the wreck
// (houses.js BUILD_OPTIONS / restoreAs — the role string frozen into
// save.restoredHouses). The address ending → role mapping below is only the
// LEGACY FALLBACK (Houses.houseShopRole) for a house whose ledger entry is a
// bare `true` — saves from before roles were frozen, and the sandbox, which
// stamps `true` so its test street shows every storefront:
//   9       → blacksmith (sooty tint, gem→relic forge)
//   2 / 4 / 6 → market  (red tint, a THEMED shop — seed / supply / potion /
//                        ore / relic / pet, by restore order; see themeAt)
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
    trader:     { ink: '#ffe066' },  // gold
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
  // A shop (role key 'market') sells ONE LINE, and which line is its place in
  // the order the player restored shops: the first is a seed shop, then a
  // supply shop, a potion shop, an ore shop, a relic shop and a pet shop — and
  // round again one TIER higher (the seventh shop is a T2 seed shop). So the
  // neighbourhood opens up in the order a player can use it, and every shop
  // after the sixth is a better version of one they already know.
  //
  // The order is the save's own record (save.restoredHouses keeps insertion
  // order, the delivery.js houseOrder idiom), so a restored shop keeps its line.
  //
  // Each visit sells one item type: half the rolls favour batches from one
  // tier below; otherwise the nearest stocked tier (ties go LOWER). The relic
  // line is gear, rolled by Gear.buildRelicOffer
  // (never at or below what the player already wears), so it has no pool here.
  // THE CYCLE: the lines a Shop card offers, round and round a tier up
  // (themeAt). The Book and Pet lines are NOT in it — see SOLO_LINES.
  const THEMES = ['seed', 'supply', 'potion', 'ore', 'relic'];
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
    ore: 'Ore Shop', relic: 'Relic Shop', pet: 'Pet Shop',
    book: 'Book Shop',   // the one BOOKSHOP (lineFor) — outside the THEMES cycle
  };
  // What the Restored! card says a shop of each line looks like inside
  // (app.js presentWreckRestoreModal) — the line's own sentence, beside its name.
  const THEME_BLURB = {
    seed:   'You find packets of seeds on the shelves.',
    supply: 'You find supplies for the road on the shelves.',
    potion: 'You watch strange colours swirl in bottles behind the counter.',
    ore:    'You find ore for the forge piled on the counter.',
    relic:  'You inspect the tools and armour hanging behind the counter.',
    pet:    'You hear paws and hooves shuffling nearby.',
    book:   'Shelves of books line the walls.',
  };
  // Resolved at CALL time: items.js (BUY_LIST, the catalogue) is read when a
  // shop is opened, not when this file loads.
  const THEME_POOL = {
    // The seeds any shop may sell (BUY_LIST: T1..T3 crops — the magical
    // flowers stay find-only).
    seed:   () => (typeof BUY_LIST !== 'undefined' ? BUY_LIST.slice() : []),
    supply: () => ['wood', 'rubble', 'torch', 'rope', 'trap_disarm_kit', 'throwing_spear', 'javelin', 'scarecrow', 'magic_trap', 'taming_potion'],
    potion: () => ITEMS.filter(item => item.kind === 'magic' && !item.uniqueJewelry).map(item => item.id),
    ore:    () => ['flint_shard', 'copper_bar', 'iron_bar', 'gold_bar', 'platinum_bar', 'crimson_bar',
                   'frost_bar', 'sapphire', 'ruby', 'emerald', 'diamond'],
    pet:    () => ['chicken', 'dog', 'rabbit', 'cat', 'butterfly', 'crow', 'deer', 'cow'],
    // The bookshop's line: only the Book, at the price ladder (shops_math.js listPrice).
    book:   () => ['book'],
  };

  const LINE_TIERS = { relic: [2, 4, 6], potion: [1, 3, 5, 7] };
  function lineTier(theme, index) {
    const tiers = LINE_TIERS[theme];
    return tiers ? tiers[Math.min(Math.max(0, index), tiers.length - 1)] : index + 1;
  }
  const knownLine = theme => THEMES.includes(theme) || !!THEME_POOL[theme];

  // Shared by pet shops and egg hatching; callers receive their own array.
  function petItems() { return THEME_POOL.pet(); }

  // The line + tier for the Nth shop restored (0-based).
  function themeAt(order) {
    const o = Math.max(0, order | 0);
    const theme = THEMES[o % THEMES.length];
    return { theme, tier: lineTier(theme, Math.floor(o / THEMES.length)) };
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
  // THE LINE IS THE PLAYER'S PICK: a market restored off the Shop cards carries
  // its chosen line in save.shopLines[id] (houses.js restoreAs); its TIER is one
  // step along its tier ladder per earlier market on the same line. No stored
  // line means the cycle's answer, themeAt(shopOrder). One walk over the ledger
  // resolves every market's line and tier in restore order (marketLines).
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
      // line left the cycle keeps selling pets), else the cycle's answer.
      if (knownLine(stored[id])) { theme = stored[id]; tier = lineTier(theme, seen[theme] || 0); }
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
    if (house && knownLine(stored)) {
      const row = marketLines(save).find((r) => r.id === String(house.id));
      if (row) return { theme: row.theme, tier: row.tier };
    }
    return themeAt(shopOrder(save, house));
  }
  // The tier a NEW market would carry: the next step on its line's ladder.
  function lineTierFor(save, theme) {
    return lineTier(theme, marketLines(save).filter((r) => r.theme === theme).length);
  }
  // The line the next shop would sell: the one Shop card before the pairs begin
  // (marketOffers); counts every restored market but the solo shops.
  function nextLine(save) {
    return themeAt(marketLines(save).length);
  }
  // THE SHOP CARDS ON OFFER for restore `order` (0-based; houses.js
  // BUILD_OPTIONS market row). Until restore number MARKET_PAIR_FROM one
  // card, the cycle's next line; from then on TWO lines, and the pair moves
  // on with every restore — five lines, so the same pair comes round every
  // fifth rebuild. Each names the tier the pick would carry (lineTierFor).
  const MARKET_PAIR_FROM = 9;
  function marketOffers(save, order) {
    const n = (order | 0) + 1;
    if (n < MARKET_PAIR_FROM) {
      const { theme } = nextLine(save);
      return [{ theme, tier: lineTierFor(save, theme) }];
    }
    const k = n - MARKET_PAIR_FROM;
    return [0, 1].map((i) => {
      const theme = THEMES[(2 * k + i) % THEMES.length];
      return { theme, tier: lineTierFor(save, theme) };
    });
  }

  function itemTier(id) {
    const it = (typeof ITEM_BY_ID !== 'undefined') ? ITEM_BY_ID[id] : null;
    return (it && it.baseTier) ?? ((typeof BASE_TIER !== 'undefined' && BASE_TIER[id]) || 1);
  }

  // ── SMITHY AND TRADER TIERS ───────────────────────────────────────────────
  // A blacksmith and a trader carry a tier the way a shop carries its line's
  // tier, and both come off the restoration ledger, never a stored number:
  //   SMITHY  — one per tier. The Nth blacksmith raised is tier N (its place
  //             among restored blacksmiths, smithOrder), and the card for the
  //             NEXT one is offered only once restore number ≥ N × SMITH_TIER_EVERY
  //             (the first keeps the ladder's own slot, houses.js
  //             STORY_RESTORES.blacksmith). Its anvil favours its own tier and
  //             forges nothing more than one tier above or below it
  //             (gear.js relicOfferWeights, opts.smithTier).
  //   TRADER  — any number per tier. A trader's tier is the restore number it
  //             was raised at over TRADER_TIER_EVERY (floored, at least 1), so
  //             the fifth to ninth rebuild raise T1 traders, the tenth a T2.
  //             Its barter offers goods at exactly its tier (traderStock).
  // The map badge, the offer blurb, the restore card and the Restored! card
  // all read shopTier.
  const SMITH_TIER_EVERY = 5, TRADER_TIER_EVERY = 5, SHOP_TIER_MAX = 7;
  const clampTier = (t) => Math.max(1, Math.min(SHOP_TIER_MAX, t | 0));
  // The restored blacksmiths, in restore order.
  function smithIds(save) {
    const rh = (save && save.restoredHouses) || {};
    return Object.keys(rh).filter((id) => rh[id] === 'blacksmith');
  }
  function smithCount(save) { return smithIds(save).length; }
  function smithTier(save, house) {
    if (!house || house.id == null) return 1;
    const n = smithIds(save).indexOf(String(house.id));
    return clampTier(n < 0 ? 1 : n + 1);   // the stamped starter smith off the ledger: tier 1
  }
  // The tier of the blacksmith the NEXT pick would raise, and the restore
  // number that pick needs (1-based); the first follows the ladder instead.
  function nextSmithTier(save) { return clampTier(smithCount(save) + 1); }
  function smithUnlockAt(tier) { return tier * SMITH_TIER_EVERY; }
  // A trader raised as restore number `n` (1-based).
  function traderTierAt(n) { return clampTier(Math.floor(n / TRADER_TIER_EVERY)); }
  function traderTier(save, house) {
    if (!house || house.id == null) return 1;
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
  // How much a shop of tier `tier` wants to carry an item of tier `itemT`:
  // full weight at its own tier, halved per tier away. Exact-tier trader
  // stock uses traderStock instead.
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
    return stock[Math.floor(rng() * stock.length) % stock.length];
  }

  let prices = null;
  const traderStocks = new Map();
  function traderPrices() {
    if (!prices) {
      const gearIds = new Set(Gear.uniqueRelics().map(item => item.id));
      prices = Object.fromEntries(ITEMS.filter(item => !gearIds.has(item.id)).map(item => [item.id, itemValue(item.id)]));
    }
    return prices;
  }
  function traderStock(tier) {
    if (!traderStocks.has(tier)) traderStocks.set(tier, Object.keys(traderPrices()).filter(id => itemTier(id) === tier));
    return traderStocks.get(tier);
  }

  global.Shops = {
    shopType, shopInk,
    ROLE_LABEL, roleLabel,
    LINE_TIERS, lineTier, THEMED_BATCH_CHANCE, batchStock, themedOfferStock, themedQuantity, traderPrices, traderStock,
    THEMES, SOLO_LINES, soloLine, isSoloShop, THEME_LABEL, THEME_BLURB, THEME_POOL, themeAt, shopOrder, isBookshop, marketLines, lineFor, lineTierFor, nextLine, MARKET_PAIR_FROM, marketOffers, themedStock, itemTier,
    SMITH_TIER_EVERY, TRADER_TIER_EVERY, SHOP_TIER_MAX, smithCount, smithTier, nextSmithTier, smithUnlockAt, traderTierAt, traderTier, shopTier, tierAffinity, pickThemed, petItems,
  };
})(window);
