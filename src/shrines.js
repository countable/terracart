// ─────────────────────────────────────────────────────────────────────────
// Shrines — the ten SHRINE KINDS and the timed BOON each one lends.
//
// A shrine kind is a row of SHRINE_KINDS: its frame on the generated sheet
// (assets/Objects/Generated/shrines.png, SpriteLayout.shrineKindArt), its
// light colour (Lighting.KINDS `shrine_<id>`), the zone variants and street
// variants it stands in, and the ONE lever its boon pulls for durationMs.
//
// Every shrine is still a `grove_shrine` object — the daily shrine: one
// visit per UTC day per shrine through Macros.usedToday / markToday, its
// light, its seat. `o.shrineKind` names the row; a shrine without one keeps
// the old treasure gift (Zones.SHRINE_CONTEXT). A kind's boon REPLACES that
// gift (owner, Sep 2026).
//
// Shield, reach and light share their existing item timers. Other timed
// boons persist in save.boonUntil and never stack in strength; `boon` is
// the word their countdown shows (src/buffs.js reads it — every running
// boon shows over the head, each in the kind's light colour). Wayfarer's
// post immediately applies the same food effects as a Pairy.
// Pure apart from the scene food-effect callback; no Phaser or DOM.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  const MIN = 60 * 1000;
  const FORTUNE_LUCK_BONUS = 0.10;
  const WORK_SPEED_MUL = 3;
  const REGEN_PER_SECOND = 1;
  const WAND_TIER = 6;
  // Each special street independently receives a shrine with this chance;
  // safe seating still decides whether it can stand there. Scenic paths keep
  // their separate per-tile limit.
  const STREET_SHRINE_CHANCE = 0.5;
  const SCENIC_SHRINES_PER_TILE = 1;

  // `streets` names StreetVariants rows: themed streets (minor / major) and
  // the scenic path rows (promenade, greenway, parkpath — Scenic.KIND_ROW).
  // `flash` is the map line on a visit (≤ MAP_MSG_MAX); `body` the one-fact
  // description (a hint, never the number). Frames are the sheet's order.
  const SHRINE_KINDS = {
    wayfarer_post: { art: 'shrine_wayfarer_post', frame: 0, light: 0xf2d9a0, lever: 'pairy', get durationMs() { return CONSUMABLE_SPEC.pairy.durationMs; },
      zoneVariants: ['formal_garden'], streets: ['pilgrim', 'parkpath'],
      name: "Wayfarer's post", flash: 'The bell rings. Seek treasure.',
      body: "You ring the bell. The taste of a Pairy fills your mouth, and you sense treasure nearby." },
    lantern_saint: { art: 'shrine_lantern_saint', frame: 1, light: 0xffb347, lever: 'light', durationMs: 5 * MIN,
      zoneVariants: [], streets: ['lantern'],
      name: 'Lantern saint', flash: 'Her lantern warms your hand.',
      body: "A stone saint holds out a lantern. You pause beneath its warm light." },
    tide_bell: { art: 'shrine_tide_bell', frame: 2, light: 0x9fdcff, lever: 'reach', durationMs: 3 * MIN,
      zoneVariants: ['shellwater_strand'], streets: ['promenade'],
      name: 'Tide bell', flash: 'Your arms feel long as tides.',
      body: "You ring the bell and hear the rush of waves. The sound seems close, though the shore is far away." },
    bone_watcher: { art: 'shrine_bone_watcher', frame: 3, light: 0xd8d4e8, lever: 'shield', durationMs: 3 * MIN,
      zoneVariants: ['ordered_graves', 'overgrown_graves'], streets: [],
      name: 'Bone watcher', flash: 'Something watches your back.',
      body: "A hooded stone figure stands guard. You rest beside it, feeling safer." },
    moss_cairn: { art: 'shrine_moss_cairn', frame: 4, light: 0x9be08a, lever: 'hidden', durationMs: 3 * MIN, boon: 'Unseen',
      zoneVariants: ['ancient_grove', 'sacred_grove'], streets: ['overgrown', 'greenway', 'thorny'],
      name: 'Moss cairn', flash: 'The moss hushes your steps.',
      body: "You touch the mossy stones. Nearby creatures look past you, unaware of your presence." },
    rust_totem: { art: 'shrine_rust_totem', frame: 5, light: 0xff8c2a, lever: 'melee', durationMs: 5 * MIN, boon: 'Grip',
      zoneVariants: ['work_yard', 'broken_masonry', 'broken_depot'], streets: ['barricade', 'snare'],
      name: 'Rust totem', flash: 'Your grip hardens like iron.',
      body: "You touch the rusted iron. Your arms feel stronger as you grip your weapon." },
    wishing_well: { art: 'shrine_wishing_well', frame: 6, light: 0xefc46a, lever: 'fortune', durationMs: 15 * MIN, boon: 'Luck',
      zoneVariants: ['meadow', 'hedge_garden'], streets: ['golden', 'hedgerow'],
      name: 'Wishing well', flash: 'A coin sinks. Luck stirs.',
      body: "Green coins glint at the bottom of the well. You lean over the edge and make a wish." },
    harvest_idol: { art: 'shrine_harvest_idol', frame: 7, light: 0xffd07a, lever: 'work', durationMs: 15 * MIN, boon: 'Hardworking',
      zoneVariants: ['orchard'], streets: ['orchard'],
      name: 'Harvest idol', flash: 'Your hands move swiftly.',
      body: "You lay your hand on the straw figure. Your weariness lifts, and your hands move swiftly through their work." },
    toad_idol: { art: 'shrine_toad_idol', frame: 8, light: 0x7fe0a0, lever: 'regen', durationMs: 8 * MIN, boon: 'Mending',
      zoneVariants: ['mushroom_grove', 'seep'], streets: ['toadstool'],
      name: 'Toad idol', flash: 'Your wounds begin to heal.',
      body: "You touch the cool stone toad. The pain eases as your wounds begin to heal." },
    ember_altar: { art: 'shrine_ember_altar', frame: 9, light: 0xff5a3c, lever: 'wand', durationMs: 5 * MIN, boon: 'Ember',
      zoneVariants: ['black_ring', 'flint_field', 'quarry-crater'], streets: ['burned'],
      name: 'Ember altar', flash: 'Fire gathers in your hands.',
      body: "You reach toward the glowing ember. Fire gathers in your hands, ready to strike." },
  };
  const REWARD_KINDS = {
    mystic_reef: { name: 'Reef treasury', art: 'visit_gold', reward: 'coins', fillScreen: true,
      body: 'You touch the sea-worn stone. Gold washes out across the shore.', light: 0x9fdcff },
    waystone: { name: 'Waystone', art: 'shrine_waystone', reward: 'book',
      body: 'You rest your hand on the stone. Words from an old book come back to you.', light: 0xf2d9a0 },
    grove: { name: 'Sacred grove shrine', art: 'shrine_grove', reward: 'treasure',
      body: 'You approach the shrine beneath the trees. A small gift waits at its feet.', light: 0xc8f5a0 },
  };
  // Resolve the shared presentation row without changing generation identities.
  // Returns the row itself; callers use its art/reward or boon lever.
  function kindForObject(o) {
    if (o?.kind === 'waystone') return REWARD_KINDS.waystone;
    if (o?.kind !== 'grove_shrine') return null;
    return REWARD_KINDS[o.zoneVariant] || SHRINE_KINDS[o.shrineKind] || REWARD_KINDS.grove;
  }
  const KIND_IDS = Object.keys(SHRINE_KINDS);
  const byZoneVariant = new Map(), byStreet = new Map();
  for (const id of KIND_IDS) {
    for (const z of SHRINE_KINDS[id].zoneVariants) byZoneVariant.set(z, id);
    for (const s of SHRINE_KINDS[id].streets) byStreet.set(s, id);
  }
  const kindForZoneVariant = (variantId) => byZoneVariant.get(variantId) || null;
  const kindForStreet = (variantId) => byStreet.get(variantId) || null;

  // Where each lever's expiry lives (see the header): a potion's save field,
  // the Torch's in-memory scene field, or (no entry) save.boonUntil[lever].
  // Buffs.KINDS reads this to seat each boon's countdown on the right row.
  const LEVERS = {
    pairy:    { instant: true },
    shield:   { save: 'shieldPotionUntil' },
    reach:    { save: 'reachPotionUntil' },
    light:    { scene: '_torchUntil' },
    hidden:   {},
    melee:    {}, fortune: {}, work: {}, regen: {}, wand: {},
  };

  function leverUntil(save, lever, scene) {
    const L = LEVERS[lever];
    if (!L) return 0;
    if (L.save) return Number(save?.[L.save]) || 0;
    if (L.scene) return Number(scene?.[L.scene]) || 0;
    return Number(save?.boonUntil?.[lever]) || 0;
  }
  // The boon-only levers (their readers ask this).
  function leverActive(save, lever, now = Date.now()) {
    return (Number(save?.boonUntil?.[lever]) || 0) > now;
  }

  // Lend kind's boon: the lever's expiry becomes the later of its own and
  // now + durationMs. Returns false for an unknown kind.
  function grant(save, kindId, now = Date.now(), scene = null) {
    const row = SHRINE_KINDS[kindId];
    if (!row || !save) return false;
    const L = LEVERS[row.lever];
    if (L.instant) {
      if (!scene?._consumeFoodEffects) return false;
      scene._consumeFoodEffects('pairy', false, now);
      return true;
    }
    return extend(save, row.lever, row.durationMs, now, scene);
  }
  // Pull `lever` for durationMs from now: its expiry becomes the later of its
  // own and now + durationMs (never stacking in strength). The one writer
  // of every lever — a shrine's grant above, and a potion that lends the
  // same boon (app.js drinkHardworkingPotion pulls `work` for its own
  // shorter spell) — so the two can never keep separate clocks.
  function extend(save, lever, durationMs, now = Date.now(), scene = null) {
    const L = LEVERS[lever];
    if (!L || L.instant || !save) return false;
    const until = Math.max(leverUntil(save, lever, scene), now + durationMs);
    if (L.save) save[L.save] = until;
    else if (L.scene) { if (scene) scene[L.scene] = until; }
    else (save.boonUntil ||= {})[lever] = until;
    return true;
  }

  // The map line a visit shows (≤ MAP_MSG_MAX — shrines.test.js measures).
  function boonFlash(kindId) { return SHRINE_KINDS[kindId] ? SHRINE_KINDS[kindId].flash : ''; }

  // Drop expired boon-only expiries (save hygiene; nothing reads a past one)
  // and the retired `shrineBoon` (running boons show through Buffs.KINDS).
  function normalize(save, now = Date.now()) {
    if (!save) return;
    delete save.shrineBoon;
    if (!save.boonUntil) return;
    for (const [k, t] of Object.entries(save.boonUntil)) {
      if (!LEVERS[k] || !(Number(t) > now)) delete save.boonUntil[k];
    }
  }

  root.Shrines = {
    SHRINE_KINDS, REWARD_KINDS, kindForObject, KIND_IDS, LEVERS, FORTUNE_LUCK_BONUS, WORK_SPEED_MUL, REGEN_PER_SECOND, WAND_TIER, STREET_SHRINE_CHANCE, SCENIC_SHRINES_PER_TILE,
    kindForZoneVariant, kindForStreet, leverUntil, leverActive, grant, extend, boonFlash, normalize,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
