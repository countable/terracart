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
      pestAmnesty: true,        // no slime / crow / raven near home until the first harvest
      // ── Pests ──
      // The crop-raiding PEST PUMP (scene_creatures.js wanderCreatures): a wild
      // deer dispatched just off-screen once an hour (PEST_DISPATCH_MS) whenever a crop a deer eats
      // is planted and no wild deer is already near, which then walks at the
      // field. Off on easy — a deer you meet by walking into one is the whole
      // deer threat there — and on hard it is what stops farming from being a
      // quiet income you can leave unattended. The tile spawner's own deer
      // are NOT this flag: both modes get those. (The pest was a crow until
      // Sep 2026; the owner moved crop-raiding to the deer.)
      cropPests: false,
      // Garrison eligibility is shared in both modes (lairs.js).
      derelictLairs: true,
      // THE GROUP CAP (owner, Sep 2026: "reduce guard group size max to 2 on
      // easy"): the most guards any one lair WAKES for this player. The world
      // rolls the same garrison for everyone (lairs.js garrisonFor — held or
      // not, strength, count, kinds, seats); easy wakes only the first two of
      // it, so a maxed castle's ten is a pair here and the same pair, in the
      // same seats, that hard meets first. null = no cap (the world's own
      // figure, up to LAIR_MAX_PER_STRUCTURE).
      lairGuardMax: 2,
      // THE QUIET HOME: a garrison guard of anything but the plain slime
      // whose ruin sits within this many metres of THIS player's Home is
      // hidden for them (EnemySpawns.surfaceActive — the same per-player
      // "hide, never re-roll" lane as the pest amnesty). The ruin is still
      // held for everyone else (and the safe area, EnemySpawns.homeAllows,
      // hides it near Home in every mode when it is too strong); a wreck's
      // slimes stay. 0 = off. Metres, off the live Home.
      quietHomeM: 350,
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
      crowCountMul: 0.5,        // visibility share of generated habitat Crows
                                 // as many wild crows on easy (a quieter sky,
                                 // fewer birds casing your field)
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
      cropPests: true,          // deer are dispatched to your field, once an hour
      derelictLairs: true,      // every ruin is held; its strength is the building's own (lairs.js), never distance from Home
      lairGuardMax: null,       // no group cap: a maxed castle wakes its whole ten
      quietHomeM: 0,            // no quiet home: a fort by the trailer is held for you too
      startingMoney: 20,        // $20 against $50 — a bag of seeds, not a plan
      // FARMING BREAKS EVEN ON HARD (owner, Oct 2026): a seed bought at an
      // average trader and sold at Home as its average harvest no longer
      // loses money (difficulty.test.js pins it). Easy prices the T3 crops at
      // a 25% margin (items.js PRICES), so sellMul / buyMul stays at or above
      // ~0.78 — it was 0.4 at 1.5 / 0.6, a $16 loss on every starfruit.
      buyMul: 1.15,             // traders want 1.38..3.45× base
      sellMul: 0.9,             // Home pays 90% — farming is a living, not the fastest one
      incomingDamageMul: 2.5,  // recipient penalty, after armour
      enemyHpMul: 1,            // shared enemy stats across players
      enemyDmgMul: 1,           // damage penalty belongs to the recipient
      monsterCountMul: 1,       // shared enemy population
      crowCountMul: 1,          // all generated habitat Crows are visible
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
