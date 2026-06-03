// Shop registry: specialty-shop taxonomy + per-type config (label, tint) for
// small-house shops. Address ending → role mapping:
//   9       → blacksmith (sooty tint, gem→relic forge)
//   2 / 6   → market    (red tint, produce-only stock)
//   1 / 8   → trader    (no tint, barter-only deals)
// Forts (BUILDING_MED) and civic slabs (BUILDING_LARGE) are excluded — the
// shopType helper returns null for any house that isn't the small tier.
//
// Depends on:
//   worldgen.js — WorldGen.T  (for T.BUILDING tier check)
//
// Exports as globals:
//   Shops.shopType(house)         → 'blacksmith' | 'market' | 'trader' | null
//   Shops.shopLabel(house)        → e.g. "Market XXVI" or null
//   Shops.shopTint(house)         → Phaser tint colour or null (no tint)
//   Shops.shopInk(house)          → signage lettering colour or null
//   Shops.toRoman(n)              → "XXVI" for 26 (clamped 1..3999)

(function (global) {
  // Per-type config — adding a new shop type means one entry here, plus
  // wiring into shopInteract() for buy-side behaviour. Render.js reads this
  // table directly.
  //   label: prefix on the signage ("Market XXVI")
  //   tint:  multiplied into the house sprite, null = no tint
  //   ink:   lettering colour painted on the shop's wood sign — picked to
  //          read on the SHOP_INK_BG dark-wood background (see render.js)
  const SHOP_CONFIG = {
    blacksmith: { label: 'Blacksmith', tint: 0x807068, ink: '#d8d8d8' },  // steel
    market:     { label: 'Market',     tint: 0xff6a6a, ink: '#ff7a6a' },  // red
    trader:     { label: 'Trader',     tint: null,     ink: '#ffe066' },  // gold
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

  // Resolve a house to its SHOP_CONFIG entry (or null for non-shops).
  const shopConfig = (house) => SHOP_CONFIG[shopType(house)] ?? null;

  const shopTint = (house) => shopConfig(house)?.tint ?? null;

  // Lettering colour for the shop's wood-signage label. Picked to read on
  // SHOP_INK_BG (warm dark wood — see the label block in render.js).
  const shopInk = (house) => shopConfig(house)?.ink ?? null;

  function shopLabel(house) {
    const cfg = shopConfig(house);
    if (!cfg) return null;
    // address+1 so a "house number 0" doesn't render as an empty roman numeral.
    return `${cfg.label} ${toRoman((house.address ?? 0) + 1)}`;
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
    shopType, shopLabel, shopTint, shopInk,
    toRoman,
  };
})(window);
