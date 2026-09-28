// ─────────────────────────────────────────────────────────────────────────
// Difficulty — the ONE table the two game modes are read from.
//
// Hard penalizes the receiving player's damage after armour. Enemy stats,
// ordinary populations and lair eligibility remain shared with Easy so players
// can fight the same creatures together. Tutorial, economy and crop-pest rules
// retain their per-save settings below.
//
// app.js pins save.mode at boot; an unset or pre-mode save defaults to Easy.
// Node-testable: no DOM, Phaser or globals read at load.
(function (root) {
  'use strict';

  const EASY = 'easy';
  const HARD = 'hard';

  const PROFILES = {
    [EASY]: {
      id: EASY,
      label: 'Easy mode',
      blurb: 'Guided steps, supply crates, a quiet home.',
      // ── Tutorial ──
      tutorial: true,           // starter ladder chip + green arrow + step rewards
      starterCrates: true,      // the supply-crate trail (seeds, rockfruit, wood)
      pestAmnesty: true,        // no slime / crow near home until the first harvest
      // ── Pests ──
      // The crop-raiding crow PUMP (scene_creatures.js wanderCreatures): a wild crow
      // dispatched just off-screen every ~90 s whenever a crow-edible crop is
      // planted and no wild crow is already near, which then flies at the
      // field. Off on easy — a crow you meet by walking into one is the whole
      // crow threat there — and on hard it is what stops farming from being a
      // quiet income you can leave unattended. The tile spawner's own crows
      // are NOT this flag: both modes get those.
      cropPests: false,
      // Garrison eligibility is shared in both modes (lairs.js).
      derelictLairs: true,
      // ── Economy ──
      startingMoney: 50,        // items.js STARTING_MONEY — the easy figure IS the base
      buyMul: 1,                // over buyMarkupRange — the trader / castle markup
                                // (NOT the roadside stands: ShopsMath.standPrice
                                // is the same in both modes)
      sellMul: 1,               // over trailerSellMultiplier — what Home pays for a haul
      // ── Combat ──
      incomingDamageMul: 1,    // recipient penalty, after armour
      enemyHpMul: 1,            // compatibility; shared HP and bounty
      enemyDmgMul: 1,           // over the surface slime's leech and every monster hit
      monsterCountMul: 1,       // over the cave spawner's 50 + 10/level
      slimeCountMul: 1,         // over BIOME_FAUNA.slime's per-tile count
      crowCountMul: 0.5,        // over BIOME_FAUNA.crow's per-tile count — half
                                 // as many wild crows on easy, since the crop-raid
                                 // pump (cropPests) is already off there
      // ── Traps ──
      trapCountMul: 10,         // over traps.js's base 10..18 roadside traps/tile —
                                 // 10x on easy too: the base rate reads as too rare
                                 // to ever meet in practice (see traps.test.js).
                                 // Cave traps aren't here: they're flat-scaled by
                                 // Traps.DUNGEON_DENSITY_MUL regardless of mode.
      trapBiteMul: 1,           // recipient penalty applies centrally after armour
      // ── The doorstep ──
      // The one creature GUARANTEED beside the starting trailer, whatever the
      // biome roll gave the tile (app.js `_placeHomeGreeter`). It is the first
      // living thing a new save sees, so it is the mode stating what kind of
      // game this is before a word of text does: easy hands you a chicken —
      // catchable, feedable, lays eggs — and hard puts a slime in the yard.
      // Set it to null for a mode with no greeter at all.
      homeGreeter: 'chicken',
      // How far out it stands, in Chebyshev cells from the trailer (app.js's
      // HOME_GREETER_* ring is the placer's own floor and ceiling, and both
      // still hold — this only says where inside them the mode wants its own).
      // A chicken is a welcome, so easy takes the placer's floor: it wants to
      // be right there in the yard.
      homeGreeterCells: 2,
      // Which way each greeter lies, one per compass point named
      // (app.js HOME_GREETER_DIR_VEC). Null asks for a single one on the
      // nearest legal cell of the ring, whichever way the ground allows —
      // one chicken in the yard, not a cordon of them.
      homeGreeterDirs: null,
    },
    [HARD]: {
      id: HARD,
      label: 'Hard mode',
      blurb: 'Thin purse, greedy traders, more damage taken.',
      tutorial: false,
      starterCrates: false,
      pestAmnesty: false,
      cropPests: true,          // crows are dispatched to your field, ~90 s apart
      derelictLairs: true,      // every ruin past the home ring is held, and holds more further out
      startingMoney: 20,        // $20 against $50 — a bag of seeds, not a plan
      buyMul: 1.5,              // traders want 1.8..4.5× base; a T7 bow still only reaches 1.5× par
      sellMul: 0.6,             // Home pays 60% — farming is a living, not the fastest one
      incomingDamageMul: 2.5,  // recipient penalty, after armour
      enemyHpMul: 1,            // shared enemy stats across players
      enemyDmgMul: 1,           // damage penalty belongs to the recipient
      monsterCountMul: 1,       // shared enemy population
      slimeCountMul: 1,         // shared enemy population
      crowCountMul: 1,          // the base 200/tile — easy is the one that's cut
      trapCountMul: 25,         // hard means it — 100 read as a minefield; halved twice (Sep 2026).
                                 // Per tile it spreads 0.3..1.7x around this (Traps.tileDanger)
      trapBiteMul: 1,           // receiving-player penalty is applied after armour
      homeGreeter: 'slime',     // "the slimes are in your yard from the first minute" — literally
      // …the whole yard. One on each side, ten cells out: a slime leeches on
      // contact and Hard increases damage taken, so seated at the easy chicken's 2
      // cells it was on the player inside the opening seconds, before the
      // how-to card had been read. Ten is past the viewport corner (7.8 cells)
      // — they are heard of before they are seen — but inside the sim bubble
      // (CREATURE_SIM_CELLS, the ring's own ceiling), so they are oozing in
      // from the first tick rather than frozen until the player walks at them.
      // And one PER SIDE, so there is no free direction to stroll off in: the
      // opening minute is a choice about which way to go, not a free one.
      homeGreeterCells: 10,
      homeGreeterDirs: ['n', 'e', 's', 'w'],
    },
  };

  // The mode the pure modules read (items.js, combat.js, energy.js have no
  // save handle). app.js pins it from save.mode at boot and at the choice.
  let active = EASY;

  function isMode(m) { return m === EASY || m === HARD; }
  // A save's mode, with the two fallbacks described above: an unset mode is
  // easy (a fresh save before the card, or a pre-mode veteran).
  function of(save) {
    const m = save && save.mode;
    return PROFILES[isMode(m) ? m : EASY];
  }
  function setMode(m) { active = isMode(m) ? m : EASY; return active; }
  function mode() { return active; }
  function get() { return PROFILES[active]; }
  function isHard() { return active === HARD; }

  root.Difficulty = { EASY, HARD, PROFILES, isMode, of, setMode, mode, get, isHard };
})(typeof globalThis !== 'undefined' ? globalThis : this);
