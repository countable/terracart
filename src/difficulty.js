// ─────────────────────────────────────────────────────────────────────────
// Difficulty — the ONE table the two game modes are read from.
//
// The How-to-play card (index.html #howto) asks a new save which game it
// wants, once:
//
//   EASY  — "enable tutorial". The guided opening: the starter ladder chip,
//           the supply-crate trail, the green arrow, and a pest-free home
//           until the first harvest. The economy as shipped — farming,
//           exploring and rebuilding are the loop, and a fight is a choice.
//   HARD  — "no tutorial". No ladder, no crates, no arrow, no amnesty: the
//           slimes are in your yard from the first minute. The purse is
//           smaller, the traders greedier, Home pays less for a haul — and a
//           kill pays MORE, so fighting is the income rather than the thing
//           you walk around. Enemies are tougher, hit harder, come in bigger
//           packs and roll elite more often; passing out underground and a
//           night away both cost more.
//
// EVERY number that differs between the two lives HERE, as a multiplier over
// the easy-mode value (or a flag), and the shipping code reads it at the site
// that already owns the base number — buyMarkupRange keeps its 1.2..3.0×, the
// bounty keeps its coin-per-5-HP, the cave spawner its 50 + 10/level — so easy
// mode is BY CONSTRUCTION the game exactly as it was (every easy multiplier is
// 1, every flag on), and hard mode can't drift into a second copy of the
// balance. A knob that is not in this table is not a mode difference.
//
// The mode is per SAVE (save.mode, 'easy' | 'hard'), chosen once and kept —
// switching mid-game would let a player sell on easy and hunt on hard. A save
// that predates the field is easy (SaveMigrate backfills it: it was played
// with the tutorial); a fresh one carries NO mode until the card is answered,
// and reads as easy meanwhile so nothing before the choice is harsher than the
// tutorial. app.js pins the active mode with `setMode` at boot and at the
// choice, so the pure modules (items.js prices, combat.js HP, energy.js rest)
// can read it without a save handle.
//
// Node-testable: no DOM, no Phaser, no globals read at load.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  const EASY = 'easy';
  const HARD = 'hard';

  const PROFILES = {
    [EASY]: {
      id: EASY,
      label: 'Easy mode',
      blurb: 'Learn the ropes: guided steps, supply crates, a quiet home to farm from.',
      // ── Tutorial ──
      tutorial: true,           // starter ladder chip + green arrow + step rewards
      starterCrates: true,      // the supply-crate trail (seeds, rockfruit, wood)
      pestAmnesty: true,        // no slime / crow near home until the first harvest
      // ── Economy ──
      startingMoney: 50,        // items.js STARTING_MONEY — the easy figure IS the base
      buyMul: 1,                // over buyMarkupRange (traders) and standPrice (stalls)
      sellMul: 1,               // over trailerSellMultiplier — what Home pays for a haul
      bountyMul: 1,             // over enemyBounty — coins a kill pays
      passOutLossFrac: 0.5,     // share of the purse lost passing out underground
      offlineRestCapFrac: 1,    // how full a night away can refill energy to
      // ── Combat ──
      enemyHpMul: 1,            // over Combat.creatureMaxHp, enemies only
      enemyDmgMul: 1,           // over the surface slime's leech and every monster hit
      monsterCountMul: 1,       // over the cave spawner's 50 + 10/level
      slimeCountMul: 1,         // over BIOME_FAUNA.slime's per-tile count
      eliteRateMul: 1,          // over SHINY_RATE.monster (5%)
    },
    [HARD]: {
      id: HARD,
      label: 'Hard mode',
      blurb: 'No hand-holding: a thin purse, greedy traders, and a fight worth picking.',
      tutorial: false,
      starterCrates: false,
      pestAmnesty: false,
      startingMoney: 20,        // $20 against $50 — a bag of seeds, not a plan
      buyMul: 1.5,              // traders want 1.8..4.5× base; a T7 bow still only reaches 1.5× par
      sellMul: 0.6,             // Home pays 60% — farming is a living, not the fastest one
      bountyMul: 1.5,           // and on top of enemyHpMul (the bounty is per HP): a kill
                                // pays 2.25× in 1.5× the time — fighting out-earns farming
      passOutLossFrac: 0.75,    // three quarters of the purse, not half
      offlineRestCapFrac: 0.5,  // a night away rests you to half, never full
      enemyHpMul: 1.5,
      enemyDmgMul: 2,           // a slime leeches 6/s, a goblin hits for 16
      monsterCountMul: 1.5,     // 75 + 15/level, still under the spawner's 160 cap
      slimeCountMul: 2,         // 100 surface slimes a tile, and none of them wait for a harvest
      eliteRateMul: 3,          // 15% of monsters are elites
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
