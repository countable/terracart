// ── Home / start area ───────────────────────────────────────────────────────
// Central hub for "near the start" geometry + early-game home-area tuning.
//
// The player begins at HOME_LON/HOME_LAT (or a teleport override) — see
// app.js START_LON/START_LAT. `startWorldM` (app.js) is that spawn point in
// absolute world metres, the SAME space every generated object's x/y lives in
// (playerM starts at {0,0}, so the player literally stands on startWorldM).
//
// A lot of early-game customization keys off being near that origin, or off
// being among the first houses/shops restored. This module owns the geometry
// ("am I near home?") and the home-area tuning that isn't bound to one specific
// shop, so future tweaks have one obvious place to live. Loaded BEFORE
// worldgen.js so tile generation can ask `HomeArea.isNear(...)` while building.
//
// ── INDEX of home-area customization still living elsewhere ──────────────────
// (Migrate each into here as it's next touched, routing through HomeArea.)
//   • Start origin / synthetic trailer ……… app.js  isStarterShop / ensureStarterShopId
//   • Starter blacksmith (1st restored) …… app.js  isStarterBlacksmith, PRESEED_RESTORE_ROLES
//   • Scarecrow shop (early house) ………… app.js  isScarecrowShop
//   • First market sells T1/T2 seeds …… app.js  isFirstMarket
//   • First 3 delivery houses → T1 produce app.js  isEarlyDeliveryHouse
//   • Starter loot crates (wood/rockfruit/seeds) app.js  STARTER_LOOT
//   • Starting money / no free tools …… items.js STARTING_MONEY, app.js starterToolsStripped
//   • Fort unlock cost ………………………… app.js  FORT_UNLOCK_WOOD
//
// Exposed as a global (no bundler): HomeArea
const HomeArea = {
  // World-metre position of the spawn/home origin. Set ONCE by the scene
  // (app.js) the moment startWorldM is known — before any tile is generated —
  // so worldgen, which runs on the same thread, can ask "is this near home?"
  // mid-build. Null until then, which `isNear` treats as "not near home" so
  // nothing is mis-flagged before the origin exists.
  worldM: null,
  setOrigin(x, y) { this.worldM = { x, y }; },

  // Radius (m) of the "near the start" zone the softwood rule below uses.
  NEAR_M: 100,

  // True iff (x, y) world-metres is within `radiusM` of the spawn origin. This
  // is the canonical "near home" test — prefer it over inline hypot checks so
  // every home-area feature shares one definition of the zone.
  isNear(x, y, radiusM = HomeArea.NEAR_M) {
    if (!this.worldM) return false;
    const dx = x - this.worldM.x, dy = y - this.worldM.y;
    return dx * dx + dy * dy <= radiusM * radiusM;
  },

  // Trees within NEAR_M of the start are SOFTWOOD (species 'pine'). The early
  // game needs wood for the starter blacksmith's first tools, and softwood
  // fells one axe-tier easier than the default (util.js treeSpeciesTierShift),
  // so the home grove is reliably harvestable bare-handed / with a Wood axe.
  // Returns the species string to store on the tree (the fallback elsewhere).
  softwoodSpeciesNear(x, y, fallbackSpecies) {
    return this.isNear(x, y) ? 'pine' : fallbackSpecies;
  },
};
