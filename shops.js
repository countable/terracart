// Shop registry: specialty-shop taxonomy + per-type config (label, tint,
// sell-price bonus) for small-house shops. Address ending → role mapping:
//   9       → blacksmith (sooty tint, gem→relic forge, +100% gem sells)
//   2 / 6   → market    (red tint, produce-only stock, +50% produce sells)
//   1 / 8   → trader    (no tint, barter-only deals, +25% on any sale)
// Forts (BUILDING_MED) and civic slabs (BUILDING_LARGE) are excluded — the
// shopType helper returns null for any house that isn't the small tier.
//
// Depends on:
//   worldgen.js — WorldGen.T  (for T.BUILDING tier check)
//   items.js    — ITEM_BY_ID  (for shopSellBonus's produce check)
//
// Exports as globals:
//   Shops.shopType(house)         → 'blacksmith' | 'market' | 'trader' | null
//   Shops.shopLabel(house)        → e.g. "Market XXVI" or null
//   Shops.shopTint(house)         → Phaser tint colour or null (no tint)
//   Shops.shopSellBonus(t, id)    → sell-price multiplier (1 by default)
//   Shops.isGem(id)               → true for sapphire / ruby / emerald
//   Shops.GEM_IDS                 → ['sapphire', 'ruby', 'emerald']
//   Shops.toRoman(n)              → "XXVI" for 26 (clamped 1..3999)

(function (global) {
  const GEM_IDS = ['sapphire', 'ruby', 'emerald'];
  const isGem = (id) => GEM_IDS.includes(id);

  // Per-type config — adding a new shop type means one entry here, plus
  // wiring into shopInteract() for buy-side behaviour. Render.js and the
  // sell-bonus dispatch read this table directly.
  const SHOP_CONFIG = {
    blacksmith: { label: 'Blacksmith', tint: 0x807068 },
    market:     { label: 'Market',     tint: 0xff6a6a },
    trader:     { label: 'Trader',     tint: null     },
  };

  function shopType(house) {
    if (!house || house.kind !== 'house') return null;
    if (house.tier !== WorldGen.T.BUILDING) return null;   // forts / civic slabs excluded
    const d = (house.address ?? 0) % 10;
    if (d === 9) return 'blacksmith';
    if (d === 2 || d === 6) return 'market';
    if (d === 1 || d === 8) return 'trader';
    return null;
  }

  function shopTint(house) {
    const t = shopType(house);
    return t ? SHOP_CONFIG[t].tint : null;
  }

  function shopLabel(house) {
    const t = shopType(house);
    if (!t) return null;
    // address+1 so a "house number 0" doesn't render as an empty roman numeral.
    return `${SHOP_CONFIG[t].label} ${toRoman((house.address ?? 0) + 1)}`;
  }

  // Sell-bonus multiplier applied on top of the normal sword/relic sellMul.
  // Returns 1 when the shop isn't a specialty or the item doesn't match its
  // associated category.
  function shopSellBonus(type, itemId) {
    if (!type) return 1;
    if (type === 'blacksmith') return isGem(itemId) ? 2.0 : 1;
    if (type === 'market')     return ITEM_BY_ID[itemId]?.kind === 'produce' ? 1.5 : 1;
    if (type === 'trader')     return 1.25;
    return 1;
  }

  // Roman numeral renderer (1..3999). Used for the "Market XXVI" labels above
  // specialty shops.
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
    GEM_IDS, isGem,
    shopType, shopLabel, shopTint, shopSellBonus,
    toRoman,
  };
})(window);
