// Shop registry: specialty-shop taxonomy + per-type config (label, tint) for
// small-house shops. Address ending → role mapping:
//   9       → blacksmith (sooty tint, gem→relic forge)
//   2 / 6   → market    (red tint, produce-only stock — signs "Produce Shop")
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
//   Shops.toRoman(n)              → "XXVI" for 26 (clamped 1..3999)
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
  // The produce storefront is named for the GOODS IT SELLS, not for the trade
  // idiom — it signs as "Produce Shop", never "Market". Its stock is the shop's
  // identity, so the one that carries something else says so: the tutorial's
  // FIRST market stocks starter seeds instead of produce (app.js isFirstMarket)
  // and signs as "Seed Shop", so no sign promises stock the shop doesn't have.
  // Category, not item: the specific produce rotates with save.buyIndex, so a
  // per-item name would rewrite the sign every time the player bought anything.
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
  // stamped on save.firstMarketId, so renaming it would strand every save.
  const ROLE_LABEL = {
    blacksmith: 'Blacksmith',
    market:     'Produce Shop',
    trader:     'Trader',
    wizard:     'Wizard',
  };
  // What the produce shop signs as when it stocks seeds instead.
  const SEED_SHOP_LABEL = 'Seed Shop';

  // Player-facing name for a shop role, or null for a role with no sign.
  // `seedStock` flips the produce shop to its seed variant; `goods` is the
  // display name of the item a trader currently offers ("Rockfruit"), which
  // names the trader for it.
  function roleLabel(role, seedStock = false, goods = null) {
    if (role === 'market' && seedStock) return SEED_SHOP_LABEL;
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

  // Roman numeral renderer (1..3999). Used for the "Produce Shop XXVI" labels
  // above specialty shops.
  function toRoman(n) {
    n = Math.max(1, Math.min(3999, n | 0));
    const v = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
    const s = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
    let out = '';
    for (let i = 0; i < v.length; i++) {
      while (n >= v[i]) { out += s[i]; n -= v[i]; }
    }
    return out;
  }

  global.Shops = {
    shopType, shopInk,
    ROLE_LABEL, SEED_SHOP_LABEL, roleLabel,
    toRoman,
  };
})(window);
