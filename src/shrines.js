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
// THE LEVERS. A boon never adds a tuning factor of its own: it pulls a lever
// a potion, powder or hall already owns, and takes the LATER expiry of the
// two (max, never a sum), so a boon and a potion never stack past either.
//   speed   save.speedPotionUntil — the Potion of Speed's walk tiers
//   shield  save.shieldPotionUntil — the Shield potion's damageMul
//   reach   save.reachPotionUntil — the Potion of Reach
//   light   scene._torchUntil — the Torch (in memory, like the Torch)
//   hidden  scene._shadowUntil — Shadow Powder (in memory, like the powder)
// Four levers have no potion; their expiry lives in save.boonUntil[lever]
// and each is read at one site:
//   melee    Combat.trainingBonus — a Training Hall drill's bonus
//   thrift   app.js _walkRelics — the walking cost tier a Speed potion lends
//   fortune  interactables.js chest roll — +FORTUNE_TIER_BONUS chest tier
//   antidote Conditions.apply — poison cannot take hold (and is cured)
//   surefoot app.js _bodyHold — slow ground (tar, stakes) does not hold you
//
// Pure: no Phaser, no DOM. Reads Conditions at CALL time.
// Audit: test/node/shrines.test.js.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  const MIN = 60 * 1000;
  const FORTUNE_TIER_BONUS = 1;
  // At most this many street shrines per tile, lowest hash of the street key
  // first (StreetVariants.dressSteps), and this many scenic-path shrines,
  // lowest hash of the scenic stretch first (Scenic.dressSteps).
  const STREET_SHRINES_PER_TILE = 2;
  const SCENIC_SHRINES_PER_TILE = 1;

  // `streets` names StreetVariants rows: themed streets (minor / major) and
  // the scenic path rows (promenade, greenway, parkpath — Scenic.KIND_ROW).
  // `flash` is the map line on a visit (≤ MAP_MSG_MAX); `body` the one-fact
  // description (a hint, never the number). Frames are the sheet's order.
  const SHRINE_KINDS = {
    wayfarer_post: { frame: 0, light: 0xf2d9a0, lever: 'speed', durationMs: 5 * MIN,
      zones: ['formal_garden'], streets: ['pilgrim', 'parkpath'],
      name: "Wayfarer's post", flash: 'The bell rings. Walk on.',
      body: "The bell rope is smooth where other hands have held it. You wonder how far they walked after letting go." },
    lantern_saint: { frame: 1, light: 0xffb347, lever: 'light', durationMs: 5 * MIN,
      zones: [], streets: ['lantern'],
      name: 'Lantern saint', flash: 'Her lantern warms your hand.',
      body: "The stone hand holds its lantern low enough for you to reach. You like that someone thought to put it there." },
    tide_bell: { frame: 2, light: 0x9fdcff, lever: 'reach', durationMs: 3 * MIN,
      zones: ['mystic_reef', 'shellwater_strand'], streets: ['promenade'],
      name: 'Tide bell', flash: 'Your arms feel long as tides.',
      body: "The sound rolls out of the bell and seems to come back from much farther away. You stretch your fingers without knowing why." },
    bone_watcher: { frame: 3, light: 0xd8d4e8, lever: 'shield', durationMs: 3 * MIN,
      zones: ['ordered_graves', 'overgrown_graves'], streets: [],
      name: 'Bone watcher', flash: 'Something watches your back.',
      body: "You cannot see a face beneath the stone hood. Standing beside it, you find yourself leaving a little less room for whatever might come up behind you." },
    moss_cairn: { frame: 4, light: 0x9be08a, lever: 'hidden', durationMs: 3 * MIN,
      zones: ['ancient_grove'], streets: ['overgrown', 'greenway'],
      name: 'Moss cairn', flash: 'The moss hushes your steps.',
      body: "The moss gives softly under your fingers. You listen for your last footstep and realise you never heard it." },
    rust_totem: { frame: 5, light: 0xff8c2a, lever: 'melee', durationMs: 5 * MIN,
      zones: ['work_yard', 'broken_masonry', 'broken_depot'], streets: ['barricade'],
      name: 'Rust totem', flash: 'Your grip hardens like iron.',
      body: "Rough iron rises above you, its bolts stained orange. Your fingers close as though there ought to be a hilt between them." },
    wishing_well: { frame: 6, light: 0xefc46a, lever: 'fortune', durationMs: 5 * MIN,
      zones: ['meadow', 'hedge_garden'], streets: ['golden', 'hedgerow'],
      name: 'Wishing well', flash: 'A coin sinks. Luck stirs.',
      body: "Green coins lie beneath the water, their edges softened by the ripples. You try to choose a wish small enough to fit on one." },
    harvest_idol: { frame: 7, light: 0xffd07a, lever: 'thrift', durationMs: 10 * MIN,
      zones: ['orchard'], streets: ['orchard'],
      name: 'Harvest idol', flash: 'Your pack feels lighter.',
      body: "An apple rests at the straw figure’s feet, its skin rubbed bright. You think of all the things you carry and how little the figure seems to need." },
    toad_idol: { frame: 8, light: 0x7fe0a0, lever: 'antidote', durationMs: 5 * MIN,
      zones: ['mushroom_grove', 'seep'], streets: ['toadstool'],
      name: 'Toad idol', flash: 'A cool calm fills your blood.',
      body: "The green stone is cool beneath your palm. You swallow and find yourself thinking of clear water." },
    ember_altar: { frame: 9, light: 0xff5a3c, lever: 'surefoot', durationMs: 5 * MIN,
      zones: ['black_ring', 'flint_field'], streets: ['burned'],
      name: 'Ember altar', flash: 'Your feet feel light as ash.',
      body: "A small ember holds its shape in the soot. You lift one foot, then the other, thinking how easily ash leaves the ground." },
  };
  const KIND_IDS = Object.keys(SHRINE_KINDS);
  const byZone = new Map(), byStreet = new Map();
  for (const id of KIND_IDS) {
    for (const z of SHRINE_KINDS[id].zones) byZone.set(z, id);
    for (const s of SHRINE_KINDS[id].streets) byStreet.set(s, id);
  }
  const kindForZoneVariant = (variantId) => byZone.get(variantId) || null;
  const kindForStreet = (variantId) => byStreet.get(variantId) || null;

  // Where each lever's expiry lives (see the header). `ownTimer`: the lever
  // already shows its own countdown over the head (the Torch, Shadow Powder).
  const LEVERS = {
    speed:    { save: 'speedPotionUntil' },
    shield:   { save: 'shieldPotionUntil' },
    reach:    { save: 'reachPotionUntil' },
    light:    { scene: '_torchUntil', ownTimer: true },
    hidden:   { scene: '_shadowUntil', ownTimer: true },
    melee:    {}, thrift: {}, fortune: {}, antidote: {}, surefoot: {},
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
  // now + durationMs. save.shrineBoon remembers the last kind for the
  // countdown. Returns false for an unknown kind.
  function grant(save, kindId, now = Date.now(), scene = null) {
    const row = SHRINE_KINDS[kindId];
    if (!row || !save) return false;
    const L = LEVERS[row.lever];
    const until = Math.max(leverUntil(save, row.lever, scene), now + row.durationMs);
    if (L.save) save[L.save] = until;
    else if (L.scene) { if (scene) scene[L.scene] = until; }
    else (save.boonUntil ||= {})[row.lever] = until;
    if (row.lever === 'antidote' && root.Conditions) root.Conditions.cure(save, 'poison');
    save.shrineBoon = kindId;
    return true;
  }

  // The map line a visit shows (≤ MAP_MSG_MAX — shrines.test.js measures).
  function boonFlash(kindId) { return SHRINE_KINDS[kindId] ? SHRINE_KINDS[kindId].flash : ''; }

  // The countdown's remaining ms for the last boon, or 0 when it has run out
  // or its lever keeps its own countdown.
  function boonRemainingMs(save, scene, now = Date.now()) {
    const row = SHRINE_KINDS[save?.shrineBoon];
    if (!row || LEVERS[row.lever].ownTimer) return 0;
    return Math.max(0, leverUntil(save, row.lever, scene) - now);
  }

  // Drop expired boon-only expiries (save hygiene; nothing reads a past one).
  function normalize(save, now = Date.now()) {
    if (!save || !save.boonUntil) return;
    for (const [k, t] of Object.entries(save.boonUntil)) {
      if (!LEVERS[k] || !(Number(t) > now)) delete save.boonUntil[k];
    }
    if (save.shrineBoon && !SHRINE_KINDS[save.shrineBoon]) delete save.shrineBoon;
  }

  root.Shrines = {
    SHRINE_KINDS, KIND_IDS, LEVERS, FORTUNE_TIER_BONUS, STREET_SHRINES_PER_TILE, SCENIC_SHRINES_PER_TILE,
    kindForZoneVariant, kindForStreet, leverUntil, leverActive, grant, boonFlash, boonRemainingMs, normalize,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
