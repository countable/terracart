// Shop registry: specialty-shop taxonomy + per-type config (label, tint) for
// small-house shops. Address ending → role mapping:
//   9       → blacksmith (sooty tint, gem→relic forge)
//   2 / 6   → market    (red tint, a THEMED shop — seed / supply / potion /
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
// shopTint() and shopLabel() used to live here too, but render.js deliberately
// reimplements both rather than calling them (see the comments by
// _houseSignText / the tint block in render.js): both read the OSM street
// ADDRESS digit, so a plain residential house whose address merely ended in
// the wrong digit got painted/labelled as a shop it wasn't — restore-order
// roles fixed that by keying off the house's resolved role instead. Deleted
// along with the now-unreferenced `label`/`tint` SHOP_CONFIG fields.

(function (global) {
  // Per-type config — adding a new shop type means one entry here, plus
  // wiring into shopInteract() for buy-side behaviour. Render.js reads this
  // table directly.
  //   ink: lettering colour painted on the shop's wood sign — picked to
  //        read on the SHOP_INK_BG dark-wood background (see render.js)
  const SHOP_CONFIG = {
    blacksmith: { ink: '#d8d8d8' },  // steel
    market:     { ink: '#ff7a6a' },  // red
    trader:     { ink: '#ffe066' },  // gold
  };

  // ── What the player calls each shop ───────────────────────────────────────
  // ONE table for every player-facing name: the map sign (render.js
  // _houseSignText), the restoration card (app.js shopInteract) and the offer
  // modal's flavour line (app.js buildingFlavorTitle) all read it, so a rename
  // lands in all three at once instead of drifting between them.
  //
  // The themed storefront (role key 'market') is named for the LINE IT SELLS,
  // never for the trade idiom — "Potion Shop", never "Market" — off its theme
  // (THEME_LABEL, resolved by themeAt). Category, not item: the specific stock
  // re-rolls every hour and on a paid re-roll, so a per-item name would rewrite
  // the sign every time the player looked away.
  //
  // The trader is named for the GOODS IT OFFERS, never for its street number:
  // "Rockfruit Trader", "Potato Seed Trader". Its barter is one item at a time
  // (app.js peekOrBuildTraderOffer), so unlike the produce shop the specific
  // item IS the identity — the sign is the advert for the deal inside, and it
  // rotates exactly when the offer does (the hourly shop bucket, a purchase or
  // a paid re-roll). Item, not category: the address numeral it replaced told
  // the player nothing about whether the walk over was worth it. With no offer
  // to name (no house id, an empty catalogue) it falls back to a bare "Trader".
  //
  // The role KEY stays 'market'. It is persisted in save.restoredHouses and
  // is read back by shopOrder, so renaming it would strand every save.
  const ROLE_LABEL = {
    blacksmith: 'Blacksmith',
    market:     'Shop',          // a themed shop with no theme to name (see THEME_LABEL)
    trader:     'Trader',
    wizard:     'Wizard',
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
    if (d === 2 || d === 6) return 'market';
    if (d === 1 || d === 8) return 'trader';
    return null;
  }

  // Resolve a house to its SHOP_CONFIG entry (or null for non-shops).
  const shopConfig = (house) => SHOP_CONFIG[shopType(house)] ?? null;

  // Lettering colour for the shop's wood-signage label. Picked to read on
  // SHOP_INK_BG (warm dark wood — see the label block in render.js).
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
  // order, the delivery.js houseOrder idiom), so a restored shop keeps its
  // line for good and a save that restored its shops before themes existed is
  // converted in place, in the order it restored them.
  //
  // Each visit sells ONE random item from the line at the shop's tier — the
  // nearest tier the line actually stocks (ties go LOWER), since no line has
  // an item at every tier. The relic line is gear, rolled by Gear.buildRelicOffer
  // (never at or below what the player already wears), so it has no pool here.
  const THEMES = ['seed', 'supply', 'potion', 'ore', 'relic', 'pet'];
  const THEME_LABEL = {
    seed: 'Seed Shop', supply: 'Supply Shop', potion: 'Potion Shop',
    ore: 'Ore Shop', relic: 'Relic Shop', pet: 'Pet Shop',
  };
  // Resolved at CALL time: items.js (BUY_LIST, the catalogue) is read when a
  // shop is opened, not when this file loads.
  const THEME_POOL = {
    // The seeds any shop may sell (BUY_LIST: T1..T3 crops — the magical
    // flowers stay find-only).
    seed:   () => (typeof BUY_LIST !== 'undefined' ? BUY_LIST.slice() : []),
    supply: () => ['wood', 'rockfruit', 'torch', 'rope', 'trap_kit', 'scarecrow', 'book'],
    potion: () => ['reach_potion', 'vigor_potion', 'speed_potion', 'shield_potion',
                   'growth_powder', 'shadow_powder', 'dragon_powder', 'frost_powder'],
    ore:    () => ['coal', 'copper_bar', 'iron_bar', 'gold_bar', 'platinum_bar', 'crimson_bar',
                   'frost_bar', 'sapphire', 'ruby', 'emerald', 'diamond'],
    pet:    () => ['chicken', 'dog', 'rabbit', 'cat', 'butterfly', 'crow', 'deer', 'cow'],
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
        if (rh[id] !== 'market') continue;
        if (id === house.id) return n;
        n++;
      }
    }
    return fnv1a(String(house.id) + '|theme') % THEMES.length;
  }

  function itemTier(id) {
    const it = (typeof ITEM_BY_ID !== 'undefined') ? ITEM_BY_ID[id] : null;
    return (it && it.baseTier) ?? ((typeof BASE_TIER !== 'undefined' && BASE_TIER[id]) || 1);
  }

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

  // The one item this shop sells right now, off the caller's seeded rng.
  function pickThemed(theme, tier, rng = Math.random) {
    const stock = themedStock(theme, tier);
    if (!stock.length) return null;
    return stock[Math.floor(rng() * stock.length) % stock.length];
  }

  global.Shops = {
    shopType, shopInk,
    ROLE_LABEL, roleLabel,
    THEMES, THEME_LABEL, themeAt, shopOrder, themedStock, pickThemed,
  };
})(window);
