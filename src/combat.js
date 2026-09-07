// ─────────────────────────────────────────────────────────────────────────
// Combat — the ONE place the fight maths lives.
//
// Before this module a fight was a TIMER: you tapped a foe, a work wheel ran
// for `toolDurationMs × hp/15`, and when the arc closed the creature died. The
// weapon you carried only ever changed how long that arc took, and all three
// weapons (sword / bow / staff) did the identical thing.
//
// Now a fight is HIT POINTS, and the three weapons reach them differently:
//
//   sword          — melee. The combat wheel lands one BLOW per
//                    MELEE_INTERVAL_MS on the engaged foe (app.js
//                    `startCombat` / `_drawWorkProgress`), and being the
//                    ACTIVE weapon AUTO-ENGAGES the nearest enemy in reach,
//                    so you don't have to tap a slime that's already chewing
//                    on you. Melee reaches exactly as far as the player's lit
//                    reach and no further — the same cellInReach the tap gate
//                    and the reach silhouette use; a sword swings harder than
//                    a fist, never further.
//   bow / staff    — ranged. While an enemy is on screen the ACTIVE one of
//                    the two looses one shot a second (app.js `_combatTick`).
//                    The bow fires along the COMPASS HEADING — it does not
//                    home, so you aim by turning; the staff seeks, loosing its
//                    bolt straight at the NEAREST enemy in range whatever way
//                    you face (SHOT[].aim below). A hit drains the same HP
//                    pool the melee wheel does.
//   bare hands     — still work, still slow (the 9 s tier-0 rung).
//   monster arrows — a ranged monster (the goblin archer) shoots a visible
//                    arrow AT the player at the turret's cadence; it flies as
//                    a bow arrow and hits the player (monsterShot below,
//                    stepShots' `hostile` lane; app.js wanderCreatures fires
//                    it and _shotHitsPlayer takes the hit).
//   castle turrets — every `tower` object on screen with the player looses a
//                    Wood-tier bow arrow at the nearest enemy on screen, at
//                    one fifth the player's cadence (TURRET / turretTick
//                    below; app.js `_turretFire` is the scene glue).
//
// KILL TIMES ARE INHERITED, NOT RE-TUNED. The old wheel spent
// `toolDurationMs × hp/15` ms on a target, so the damage per second that
// reproduces it exactly is `15000 / toolDurationMs` — see `dpsForDurationMs`.
// That rate is the MELEE rung, and everything below is derived from it;
// nothing here is a magic number picked to feel right.
//
// ONLY ONE WEAPON FIGHTS AT A TIME. `save.activeWeapon` (app.js) picks which
// of sword/bow/staff auto-engages or auto-fires; the other owned weapons sit
// inert — no auto-engage, no auto-fire — until the player switches to them
// (tapping a weapon in the Relics inventory tab, or obtaining/forging a new
// one, which becomes active automatically). Because only one weapon can ever
// be in play, there is no split across ranged slots any more: there used to
// be one (bow and staff fired simultaneously and stacked, so their shares
// were priced to sum to one sword), but exclusivity already prevents the
// double-dip the split existed to fix. What's left is SHOT_DMG_MUL, a
// deliberate difference in KIND rather than a stacking guard: the bow (an
// arrow) delivers its tier's full melee-equivalent rate, same as the sword;
// the staff (a piercing bolt) delivers DOUBLE that, priced in energy per
// bolt — see the SHOT table below.
//
// WHAT COUNTS AS AN ENEMY (`isEnemy`): things that attack YOU — the cave
// monsters and the wild surface slime. Crows and deer are NOT enemies: they're
// game. Nothing auto-fires at them and no shot can hit them, so hunting stays
// a deliberate tap on the old timed wheel (and still takes any weapon's tier,
// bow and staff included — a bow-only player can still bring down a deer).
//
// Node-testable: no DOM, no Phaser, no WorldGen. The monster stat table lives
// HERE, beside the maths that reads it — it IS enemy data, and this is the one
// module that answers "is this an enemy", "how much HP" and "what does the kill
// pay". It used to live in app.js and arrive through `registerMonsters` at
// boot, which meant every headless test of a real foe ran on a table lifted out
// of app.js by regex. The shipping table is the DEFAULT registration now;
// `registerMonsters` stays for the tests that swap in a synthetic kind.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  // ── The monster table ────────────────────────────────────────────────────
  // Underground wandering MONSTERS. Mechanically they're the surface slime:
  // each drifts toward the player and drains energy when within RANGE — but
  // they differ by HP / RANGE / DMG / SPEED. Only the goblin archer reaches
  // past one cell (range 3), and a kind with range > 1 SHOOTS — a visible
  // arrow at the player at the castle turret's cadence, carrying
  // MONSTER_ARROW_HITS hits of `dmg` so its damage per minute is unchanged
  // (see monsterShot); everything else is melee (range 1) and leeches on
  // app.js's MONSTER_HIT_MS. Tougher kinds are gated to deeper levels via
  // minDepth, so descending introduces new foes. Placeholder art: every
  // monster reuses the slime sprite with a per-kind TINT (see render.js) until
  // dedicated sheets land — swapping in real art is a one-line assets.js +
  // render.js change per kind.
  //   hp     → the pool a fight drains (scaled off BASELINE_HP, 15)
  //   range  → cells within which it drains energy
  //   dmg    → energy drained per hit (one hit per MONSTER_HIT_MS per monster)
  //   speed  → step cadence multiplier (1 = slime cadence; higher = more often)
  //   weight → relative spawn share among the kinds eligible at a given depth
  // hp and dmg here are the BASELINE: every entry is doubled by CAVE_ENEMY_MUL
  // below, so what the game runs on is twice what is written.
  const MONSTERS_BASELINE = {
    cave_slime:    { name: 'Cave Slime',    hp: 15, range: 1, dmg: 2, speed: 0.7, minDepth: 1, weight: 5 },
    purple_slime:  { name: 'Purple Slime',  hp: 6,  range: 1, dmg: 1, speed: 1.8, minDepth: 1, weight: 4, fly: true },
    goblin:        { name: 'Goblin',        hp: 25, range: 1, dmg: 4, speed: 1.0, minDepth: 2, weight: 3 },
    goblin_archer: { name: 'Goblin Archer', hp: 18, range: 3, dmg: 3, speed: 0.8, minDepth: 3, weight: 2 },
  };
  // What the game runs on: the authored rows above, plus their giants, all
  // doubled. Built here rather than mutated in place so MONSTERS_BASELINE
  // stays readable as what was AUTHORED — the two derivations below are
  // proved against it by monster_stats.test.js.
  const MONSTERS = {};
  for (const [kind, m] of Object.entries(MONSTERS_BASELINE)) MONSTERS[kind] = { ...m };

  // ── GIANTS ───────────────────────────────────────────────────────────────
  // Every kind above has a GIANT form, `giant_<kind>`: GIANT_HP_MUL (4×) the
  // HP, introduced GIANT_DEPTH_STEP (2) levels deeper than its base kind, at
  // half the base kind's spawn share. Damage, range and speed are the base
  // kind's — it is a bigger, tougher body of the same foe, not a new one.
  // Derived here from the literal rather than authored, so a kind added above
  // has a giant the moment it has stats, and the doubling below reaches the
  // giants too.
  // There is no giant art: SpriteLayout.creatureArt draws the base kind's
  // sheet at GIANT_ART_SCALE (1.8), and everything that seats on the body
  // (wheel, health bar, tap box, shadow) resolves through the same helper. For
  // the quest board and the Discovery ledger a giant is ITS OWN KIND — a giant
  // goblin job wants giant goblins, and an elite giant goblin banks its own
  // badge beside the elite goblin's (app.js resolveDefeat credits victim.kind
  // as-is; quests.js QUEST_ENEMIES lists the giants). Its elite roll gets the
  // +2 tier of its deeper introduction for free (eliteRollBonus).
  const GIANT_HP_MUL = 4;
  const GIANT_DEPTH_STEP = 2;
  for (const [kind, m] of Object.entries(MONSTERS)) {
    MONSTERS[`giant_${kind}`] = {
      ...m,
      name: `Giant ${m.name}`,
      hp: m.hp * GIANT_HP_MUL,
      minDepth: m.minDepth + GIANT_DEPTH_STEP,
      weight: Math.max(1, Math.ceil((m.weight || 1) / 2)),
      giant: kind,
    };
  }
  // The first slime is the tutorial; everything past it is a real fight.
  //
  // The wild surface slime is the only enemy above ground and the first one
  // anybody meets — deliberately gentle, a crop pest you can walk away from.
  // Every enemy BEYOND it is underground, chosen by a player who went looking,
  // and those are twice the foe: double HP and double damage.
  //
  // Applied as ONE rule over the baseline above rather than eight retuned
  // numbers, so the ratio to that first slime stays readable at a glance and a
  // kind added to the table inherits the doubling the moment it has stats. The
  // knock-ons are derived and intended: the dps identity is untouched, so
  // double HP is exactly double the time to kill at any weapon tier, and
  // enemyBounty pays per HP, so a foe that takes twice as long pays twice as
  // much.
  const CAVE_ENEMY_MUL = 2;
  for (const m of Object.values(MONSTERS)) {
    m.hp *= CAVE_ENEMY_MUL;
    m.dmg *= CAVE_ENEMY_MUL;
  }

  // The registered table — the shipping MONSTERS by default. Kept as a
  // reference (not a copy) so a kind added above is an enemy here the same
  // instant; tests swap in a synthetic table through registerMonsters.
  let MONSTER_STATS = MONSTERS;
  function registerMonsters(table) { MONSTER_STATS = table || {}; }
  // One row of the registered table, or undefined. The one read for a kind's
  // range / dmg / speed / minDepth / fly — app.js's wander loop and the fire
  // ward ask through this rather than reaching for the literal, so a test that
  // registered a synthetic kind is answered about that kind.
  function monster(kind) { return MONSTER_STATS[kind]; }
  // Is this kind a cave MONSTER? Narrower than isEnemyKind, which also counts
  // the surface slime.
  function isMonster(kind) { return !!MONSTER_STATS[kind]; }

  // Non-monster fauna that can take damage. cat/dog/crow/deer are the pet-combat
  // ladder (a tame dog hunting a deer); `slime` is the surface pest, the one
  // non-monster kind that is also an ENEMY. app.js reads this through
  // creatureMaxHp so the pet fight and the player fight can't drift apart.
  //
  // The surface slime is 10, not the 15 it carried until Sep 2026. It is the
  // FIRST enemy — met on the surface, often with no sword at all — and at 15
  // it was nine seconds of bare-handed swinging for the one foe a new player
  // is guaranteed to meet. Ten is six seconds. Nothing else moves with it: the
  // bounty is derived from this number (enemyBounty below — a slime pays $2
  // now rather than $3), and BASELINE_HP below is a fixed anchor, not a
  // reading of this table.
  const FAUNA_HP = { cat: 20, dog: 40, crow: 8, deer: 15, slime: 10 };

  // Hard mode scales ENEMY pools (Difficulty.enemyHpMul, 1.5×) here, in the
  // one place both the wheel and the bounty read — so a hard-mode foe takes
  // 1.5× as long at any weapon tier AND pays 1.5× the wage, by the same
  // derivation an elite or a giant does. Game (crow, deer) and pets are not
  // enemies and keep their fauna HP whatever the mode.
  function creatureMaxHp(kind) {
    const m = MONSTER_STATS[kind];
    const base = (m && Number.isFinite(m.hp)) ? m.hp : (FAUNA_HP[kind] ?? 10);
    if (!isEnemyKind(kind) || typeof Difficulty === 'undefined') return base;
    return Math.round(base * Difficulty.get().enemyHpMul);
  }

  // ── Armour: what a blow costs the PLAYER ─────────────────────────────────
  // Every hit the player takes — the surface slime's leech, a cave monster's
  // melee, a goblin archer's arrow — is spent against the worn set's pool
  // before it reaches the bar. The pool is `armorReduction(save.armor)`
  // (items.js: each worn piece contributes its TIER), and it is spent over
  // MITIGATION_ROUNDS passes:
  //
  //   round 1  soak up to HALF the incoming damage, paying out of the pool
  //   round 2  halve what is LEFT of the pool, soak up to half of what is
  //            left of the blow
  //   …        MITIGATION_ROUNDS times in all
  //
  // Halves round DOWN, so a hit is never soaked to nothing by the arithmetic,
  // and MIN_PLAYER_DAMAGE is the floor: no attack ever lands for zero, however
  // good the armour.
  //
  // THE POOL IS SPENT, NOT RE-CHARGED — the single most important line here.
  // It shipped for a day handing each round the whole halved pool afresh, so a
  // pool of P could soak P + P/2 + P/4 + P/8 ≈ 1.9P in total: a full Wood set
  // (4) removed SEVEN points from a blow, which is most of anything this game
  // throws, and every tier above Wood was indistinguishable because they all
  // bottomed out at the floor. Now what survives a round is halved before the
  // next one, so the total soak can never exceed the pool and a piece is worth
  // exactly what it says it is worth. The halving still bites: it decays the
  // UNSPENT remainder, which is what stops a big pool carrying its full weight
  // into every round of a long blow.
  //
  // Between the two rules — a linear per-piece tier and a pool spent once —
  // armour lives on the same scale as the damage (1..16 across the whole
  // game), so every rung of the ladder tells. A T1 piece is a flat −1 on
  // every blow; a full Frost set takes a 24-point elite giant's swing to 5.
  //
  // Nothing here is the difficulty mode's or the shield potion's business:
  // both scale the blow BEFORE it arrives (app.js), and armour spends against
  // whatever is left — so a hard-mode hit is soaked as a hard-mode hit.
  const MITIGATION_ROUNDS = 4;
  const MIN_PLAYER_DAMAGE = 1;
  function mitigate(damage, reduction) {
    if (!(damage > 0)) return 0;
    let left = damage;
    let pool = Math.max(0, Math.floor(reduction || 0));
    for (let i = 0; i < MITIGATION_ROUNDS; i++) {
      const soaked = Math.min(pool, Math.floor(left / 2));
      left -= soaked;
      // What is LEFT of the pool, halved — never the pool handed out again.
      pool = Math.floor((pool - soaked) / 2);
      if (pool <= 0) break;      // nothing left to spend; the rest is a no-op
    }
    return Math.max(MIN_PLAYER_DAMAGE, left);
  }

  // The one call site shape app.js uses: a blow of `damage` against the worn
  // set. `hits` is for a monster ARROW, which carries several hits of the
  // table in one projectile (app.js MONSTER_ARROW_HITS) — armour soaks each
  // of those hits, not the bundle, or a slow archer would out-damage a melee
  // kind against armour precisely because its damage arrives in one lump.
  function playerDamage(damage, armor, hits = 1) {
    const n = Math.max(1, Math.round(hits || 1));
    const reduction = (typeof armorReduction === 'function') ? armorReduction(armor) : 0;
    if (n === 1) return mitigate(damage, reduction);
    return n * mitigate(damage / n, reduction);
  }

  // ── DOWNED: the bar is empty ─────────────────────────────────────────────
  // At zero energy the player has collapsed. They cannot reach (coords.js's
  // reachRadiusM returns 0 at 0 energy, so no cell is tappable), and none of
  // the three places a foe reaches the player can take another point off an
  // empty bar — every one of them already refuses. A hostile that goes on
  // stalking a body it is forbidden to bite is chasing nothing: it just
  // parks on the wreck, and on hard mode (where nothing but Home lifts the
  // bar off zero) it escorts the player the whole way home.
  //
  // So a downed player is simply NOT THERE to be hunted, exactly as a
  // Shadow Powder makes them: app.js's wanderCreatures reads this beside
  // `shadowed` and every hostile falls back to an aimless wander — no stalk,
  // no charge, no leech, no arrow — until the bar lifts off zero.
  // ONE expression, both sides: the test that drops the pursuit is the same
  // one that refuses the damage, so a foe can never be chasing a player it
  // cannot hurt. Written negated so a NaN bar counts as down, like the
  // `> 0` guards it replaces.
  function playerDowned(energy) { return !((energy ?? 0) > 0); }

  // ── Elites ───────────────────────────────────────────────────────────────
  // A SHINY cave monster is an elite: one multiplier over the kind's HP and
  // damage, the same shape as CAVE_ENEMY_MUL above so the dps identity
  // holds — an elite takes exactly twice as long to kill at any weapon tier
  // and hits exactly twice as hard. Only MONSTERS are elites: a shiny deer is
  // game, and the surface slime never rolls shiny at all.
  const ELITE_MUL = 2;
  function isElite(c) {
    return !!c && !!c.shiny && isMonster(c.kind);
  }
  function eliteMul(c) { return isElite(c) ? ELITE_MUL : 1; }
  // The HP pool of THIS instance — the kind's max times the elite multiplier.
  // Everything that seeds or refills a creature's HP reads this, never
  // creatureMaxHp(kind) directly, or an elite heals back to half its health.
  function maxHp(c) { return creatureMaxHp(c.kind) * eliteMul(c); }

  // Hostile kinds — every cave monster, plus the surface slime.
  function isEnemyKind(kind) {
    return isMonster(kind) || kind === 'slime';
  }
  // EVERY hostile kind, in the order the board should offer them: the surface
  // slime first (the only foe you can meet without going underground), then the
  // registered table in ITS OWN order — MONSTERS above is authored
  // shallowest-first and each `giant_` form is appended, so a giant always
  // lands after the kind it is a giant of.
  //
  // A FUNCTION, never a constant: registerMonsters can swap the table under it
  // (a test's synthetic kind), so the list is read at call time. quests.js'
  // board is the caller — it used to hand-type these nine kinds, which is how
  // a kind added to MONSTERS could quietly fail to be worth a bounty.
  function enemyKinds() {
    return ['slime', ...Object.keys(MONSTER_STATS)];
  }
  // A kind as the player reads it: 'giant_goblin_archer' → 'giant goblin
  // archer'. The registered `name` ('Giant Goblin Archer') is Title Case for
  // headings; this is the mid-sentence form a quest body wants, and it is the
  // only rule the names need — every kind is its id with the underscores
  // opened out.
  function enemyName(kind) {
    return String(kind || '').replace(/_/g, ' ');
  }

  // ── What a kill pays ─────────────────────────────────────────────────────
  // A defeated enemy used to drop NOTHING: you paid the work wheel and the
  // energy it drained off you and got a flash message, so the only rational
  // play was to walk around every foe you met. Now a kill pays coins, always.
  //
  // EVERY ENEMY DRAWS ONE, not just the cave monsters. `isEnemyKind` is the
  // single definition of "a thing that attacks you" — the cave monsters and
  // the surface slime — and it is what this reads, so a hostile kind added to
  // MONSTERS is priced the moment it has stats and can never end up fought for
  // free. The surface slime was exactly that gap: it fights you, it eats your
  // crops, and killing one paid nothing at all. Crow and deer are NOT enemies
  // (they're game) and still pay in feathers and meat instead.
  //
  // The bounty is DERIVED from `hp` — the same number that sets the wheel
  // length — rather than hand-tuned per kind, so a tougher foe can never
  // quietly pay less than an easier one. Roughly a coin per 5 HP, floored at 1:
  //   surface slime 10hp → $2 · purple slime 12hp → $2 · cave slime 30hp → $6 ·
  //   archer 36hp → $7 · goblin 50hp → $10
  //   (the cave kinds are the doubled ones — see CAVE_ENEMY_MUL above)
  // The HP comes from creatureMaxHp, which is the monster table first and the
  // fauna ladder second — one source, so the coins a kind pays and the HP you
  // have to chew through can't drift apart. Depth adds a slow climb on top (a
  // coin per 3 levels down) so descending pays for itself even where the same
  // kinds keep spawning; at the surface it contributes nothing.
  const ENEMY_COIN_PER_HP  = 1 / 5;
  const ENEMY_DEPTH_BONUS  = 1 / 3;    // extra coins per level below the surface
  // `hpMul` is the instance's multiplier over the kind's HP — eliteMul: an
  // elite has twice the pool, so it pays twice the per-HP wage, by the same
  // rule that makes a goblin pay more than a slime.
  // (Hard mode adds no wage of its own: creatureMaxHp already scales an
  // enemy's pool by Difficulty.enemyHpMul, and the per-HP rule carries that
  // into the coins — a foe that takes 1.5× as long pays 1.5× as much, same as
  // an elite.)
  function enemyBounty(kind, depth, hpMul = 1) {
    if (!isEnemyKind(kind)) return 0;
    return Math.max(1, Math.round(creatureMaxHp(kind) * (hpMul || 1) * ENEMY_COIN_PER_HP))
         + Math.floor(Math.max(0, depth || 0) * ENEMY_DEPTH_BONUS);
  }
  // Chance a defeated CAVE MONSTER also drops a buried-treasure roll —
  // literally the same pickReward('treasure:default') payout digging an X
  // gives, so the rare drop needs no table of its own and can't drift from the
  // one players already know. Deliberately small: the coins are the wage, this
  // is the surprise. Unlike the wage it stays a monsters-only thing — a buried
  // hoard is something you turn up underground, and the surface slime in your
  // potatoes is not standing on one.
  const MONSTER_TREASURE_CHANCE = 0.10;
  // An ELITE (shiny) monster is a different deal: its kill ALWAYS pays past
  // the wage — a Discovery badge the first time that kind is slain, and after
  // that a roll on the relic-biased 'treasure:elite' pool (rarity.js), never
  // the 10% roll above. The roll's tier is COMMENSURATE with the foe: each
  // level below the first and each level of the kind's own introduction depth
  // buys one tier-only step (pickReward's opts.rollBonus), so a goblin archer
  // (minDepth 3) met at depth 3 rolls four steps higher than a cave slime at
  // depth 1.
  const ELITE_TREASURE_CONTEXT = 'treasure:elite';
  function eliteRollBonus(kind, depth) {
    const intro = Math.max(1, monster(kind)?.minDepth || 1);
    return Math.max(0, (depth || 0) - 1) + (intro - 1);
  }

  // ── Where fauna may not step ─────────────────────────────────────────────
  // Terrain cell types fauna may NEVER move onto (spec §fauna: "no fauna may
  // move onto a building footing, or road"). WATER (3) + all building tiers
  // (9/11/12) + all road tiers (ROAD 7 / ROAD_LG 13 / ROAD_MD 14) + CAVE_WALL
  // (25). PATHS (8) are pedestrian / public and stay passable. Every wander,
  // flee, stalk and spawn seat in app.js asks this one predicate — it is about
  // the creatures, so it lives with them.
  const FAUNA_BLOCKED_TYPES = new Set([3, 9, 11, 12, 7, 13, 14, 25 /* CAVE_WALL */]);
  function faunaBlocksCell(type) { return FAUNA_BLOCKED_TYPES.has(type); }

  // A hostile INSTANCE. A slime tamed with a sapphire (id 'released_…') is a
  // pet: it must never be shot at, auto-engaged, or counted as "an enemy is on
  // screen" for the auto-fire gate.
  function isEnemy(c) {
    if (!c) return false;
    if (typeof c.id === 'string' && c.id.startsWith('released_')) return false;
    return isEnemyKind(c.kind);
  }

  // Current HP, lazily seeded from the kind's max the first time anything hits
  // it. Creatures are re-spawned from tile data on every reload, so `_hp` is
  // in-memory only — a foe you softened up and walked away from is whole again
  // next session, exactly like the timed wheel it replaces.
  function hp(c) {
    if (!Number.isFinite(c._hp)) c._hp = maxHp(c);
    return c._hp;
  }
  // Apply `amount` damage; returns the HP left (never below 0).
  function damage(c, amount) {
    c._hp = Math.max(0, hp(c) - Math.max(0, amount));
    return c._hp;
  }
  function hpFraction(c) {
    const max = maxHp(c) || 1;
    return clamp01(hp(c) / max);
  }

  // ── Damage ladders ───────────────────────────────────────────────────────
  // The identity described at the top: a wheel that took `durMs` to strip a
  // 15-HP foe was dealing 15000/durMs HP per second. Bare hands (tier 0,
  // 9000 ms) → 1.67 dps; wood (4000) → 3.75; frost (300) → 50.
  //
  // This 15 is the OLD WHEEL'S reference pool and nothing else — it is the
  // constant the whole weapon ladder is scaled against, so it is frozen even
  // though the slime it was named after is 10 HP now (FAUNA_HP above). Moving
  // it would silently re-rate every weapon in the game; to change how long a
  // given foe takes, move that kind's `hp` or TOOL_DURATION_MS instead.
  const BASELINE_HP = 15;
  function dpsForDurationMs(durMs) { return (BASELINE_HP * 1000) / Math.max(1, durMs); }

  // Melee is the SWORD's job now. Bow and staff shoot instead of swinging, so
  // they no longer shorten the combat wheel — carrying one and no sword fights
  // at the bare-handed rung, and the shots are what make up the difference.
  function meleeDps(relics) {
    const slot = relics && relics.sword ? 'sword' : null;
    return dpsForDurationMs(toolDurationMs(relics, slot));
  }

  // ── Melee cadence ────────────────────────────────────────────────────────
  // How often a blow LANDS on the enemy the player has engaged, in ms. A
  // sword fight is a sequence of swings, not a hose: the wheel used to drain
  // the foe's pool every frame at meleeDps and merely DRAW a slash twice a
  // second (app.js borrowed DMG_POPUP_BEAT_MS, 500 ms, because the damage
  // itself had no cadence of its own to borrow). Two blows a second read as a
  // blur, and a fight broken off mid-beat had still banked every frame of it.
  //
  // The interval CANCELS OUT of the delivered rate, exactly the way
  // FIRE_INTERVAL_MS does for a shot: one blow is one interval's worth of the
  // tier's melee rung (meleeSwingDamage below), so halving the attack rate
  // doubles what a blow lands and the kill-time identity at the top of this
  // file still holds at every tier. Slow it to change how a fight READS;
  // to change how LONG one takes, move TOOL_DURATION_MS or the kind's `hp`.
  const MELEE_INTERVAL_MS = 1000;

  // ── How far a melee attacker reaches ───────────────────────────────────
  // ONE cell, for the player and for a melee monster alike — and ONE number,
  // read by both sides, for the roadOverlayWidthM reason: a reach the player
  // has and the thing biting them does not is a difference nobody can see on
  // the screen and everybody feels in the fight.
  //
  // Until Sep 2026 melee reached the player's LIT reach — 2.5 cells at the
  // start and up to 5.5 with the six Inner Light upgrades — while every melee
  // monster (MONSTERS[kind].range 1) and the surface slime's leech had to be
  // ADJACENT. So you could stand three cells off a goblin and punch it to
  // death while it walked, and the Magic Shrine's reach upgrades quietly
  // doubled as combat range. Closing to arm's length is the whole cost of
  // choosing to melee something; the lit reach is about what you can WORK,
  // and it kept paying for a fight it was never priced for.
  //
  // The RANGED weapons are untouched: a bow or a staff is the thing you buy
  // to hit what you cannot punch (SHOT[].rangeCells).
  const MELEE_REACH_CELLS = 1;
  // The reach in metres, and the test both sides run. Centre-to-centre, which
  // is what the monster's own attack gate measures (app.js wanderCreatures
  // compares the creature's position against the player's FEET), so the two
  // are symmetric by construction rather than by two similar-looking circles.
  function meleeReachM(cellM) { return MELEE_REACH_CELLS * cellM; }
  function inMeleeReach(ax, ay, bx, by, cellM) {
    const r = meleeReachM(cellM);
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy <= r * r;
  }

  // What ONE blow takes off the foe: the tier's rate over one interval,
  // times `mul` for anything that multiplies the swing itself (app.js passes
  // 2 while the dragon is out). Damage per blow is derived here rather than
  // at the call site so the cadence and the payload can't drift apart — the
  // shotDamage discipline, for the blade.
  function meleeSwingDamage(relics, mul = 1) {
    return meleeDps(relics) * (mul || 1) * MELEE_INTERVAL_MS / 1000;
  }

  // The BASE fire beat — one shot every two seconds, and what the bow keeps.
  // Was 1000 — halving the cadence makes each shot a visible event instead of
  // a stream; shotDamage scales per-shot damage by the interval, so the
  // delivered rate is cadence-independent.
  //
  // A slot may fire on its own beat (SHOT[slot].fireIntervalMs, read through
  // fireIntervalMs() below). The STAFF fires on half the bow's cadence — one
  // bolt every other beat — and because shotDamage prices a shot at its own
  // slot's interval, that is PACING and not a nerf: a staff bolt simply
  // carries two beats' worth of damage and the dps identity above still
  // holds. Never halve a cadence without letting shotDamage see it, or the
  // weapon quietly loses half its damage.
  const FIRE_INTERVAL_MS = 2000;
  const STAFF_BEAT_MUL = 2;
  const RANGED_SLOTS = ['bow', 'staff'];
  // Per-slot shot geometry. `phaseMs` used to stagger the staff half a beat
  // off the bow so a player carrying both fired simultaneously heard an
  // alternating patter; only one ranged slot can ever be the active weapon
  // now, so it's a no-op, kept at 0 for both rather than an unexplained
  // half-second delay the first time the staff becomes active. Ranges/speeds
  // are in CELLS and cells-per-second so they hold at any cell size; the
  // viewport is 11 cells wide, so a bow shot crosses the screen and a staff
  // bolt very nearly does.
  //
  // The two weapons differ in KIND, not just tint:
  //   bow   — an arrow: a streak (lenPx/widthPx) that stops in the FIRST foe
  //           it hits and in anything solid on the way (cave rock, and on the
  //           surface standing trees / bushes / mineral rocks — app.js hands
  //           the test over as opts.blocked).
  //   staff — a magic bolt: a fat dot (dotPx radius at Wood tier; it GROWS
  //           with the staff's tier, see boltScale) that PIERCES — it damages
  //           every foe it passes exactly once and ignores the world test
  //           entirely (magic goes over rock and timber alike). Each bolt
  //           draws energyCost (1⚡) from the caster — app.js gates the shot
  //           on affording it — and delivers twice an arrow's damage PER
  //           SECOND (SHOT_DMG_MUL below): the energy is the price of the
  //           pierce and the punch. It arrives half as often as an arrow
  //           (fireIntervalMs), so one BOLT is four times one arrow.
  //
  // And they differ in how they AIM (`aim`):
  //   'compass' — the bow. The arrow goes where you are facing; aiming is
  //           turning, and a foe off your heading is simply not shot at.
  //   'nearest' — the staff. Magic seeks: the bolt is loosed straight at the
  //           NEAREST enemy on screen (aimAtNearest below), whatever way the
  //           body is facing, and only when one sits inside its range — a
  //           bolt that could never arrive would just burn the energy.
  //           The compass is coarse and jittery on a phone, and a spell
  //           that missed because you were standing a few degrees off read
  //           as broken rather than skilful.
  //
  // And they differ in RANGE, which for the staff is not a flat number at all.
  // `rangeFromReach` says the slot's range IS the player's own reach plus this
  // many cells — resolved per shot against the LIVE reach (rangeCellsFor
  // below), so it shrinks as the dark takes the reach back underground and
  // grows with the Inner Light upgrades. A seeking weapon that fires the
  // moment anything hostile is on screen fights the whole street for you at
  // no risk; one cell past the ring you can already act in makes a bolt
  // something you loose at a foe that has closed on you. The flat
  // `rangeCells` beside it is the standing fallback for a caller with no
  // scene to ask (and is the value at the starting reach, 2.5 + 1, so the two
  // agree where a new save begins). The BOW keeps a flat range: it is the
  // weapon you buy to hit what you cannot punch, and it does not aim itself.
  const SHOT = {
    bow:   { speedCps: 4.5, rangeCells: 8, color: 0xffe6a8, lenPx: 9, widthPx: 2,
             phaseMs: 0, aim: 'compass', fireIntervalMs: FIRE_INTERVAL_MS },
    staff: { speedCps: 2.0, rangeCells: 3.5, rangeFromReach: 1,
             color: 0x9ad6ff, dotPx: 3,
             phaseMs: 0, pierce: true, energyCost: 1, aim: 'nearest',
             growsWithTier: true,
             fireIntervalMs: FIRE_INTERVAL_MS * STAFF_BEAT_MUL },
  };
  // The range a slot is firing at, in cells. ONE resolver — the range that
  // decides whether to loose a bolt (shotHeading) and the range that stops it
  // (spawnShot's rangeM) are the same number by construction, so a staff can
  // never fire at a foe its bolt would die short of. `reachCells` is the
  // player's live reach (coords.js reachCells — the ring, not reachRadiusM's
  // potion/zero-energy special cases: this is a fight, and combat has not
  // followed the lit reach since MELEE_REACH_CELLS above). Omitted, a slot
  // falls back to its flat rangeCells.
  function rangeCellsFor(slot, reachCells) {
    const spec = SHOT[slot];
    if (!spec) return 0;
    if (spec.rangeFromReach == null || reachCells == null) return spec.rangeCells;
    return reachCells + spec.rangeFromReach;
  }
  // The beat a slot fires on. One reader for the cadence clock (app.js
  // stepShots) and the damage pricing (shotDamage) alike, so a slot's rate
  // and its per-shot damage cannot drift apart.
  function fireIntervalMs(slot) {
    const spec = SHOT[slot];
    return (spec && spec.fireIntervalMs) || FIRE_INTERVAL_MS;
  }
  // Damage weight per slot: a staff bolt lands double an arrow's share.
  const SHOT_DMG_MUL = { bow: 1, staff: 2 };
  // How close a shot has to pass to a foe's feet to count as a hit, in cells.
  // Both weapons now sweep the SAME tight radius: a shot has to actually
  // reach a foe, not just pass somewhere in its neighbourhood. The bow used
  // to carry a much wider radius (0.9 cells) to forgive a phone COMPASS
  // heading being coarse and jittery, but that forgiveness is exactly what
  // made a shot look like it "hit" a foe it visibly missed — so the bow now
  // takes the same collision precision the staff does, at the cost of the
  // compass needing to actually be lined up.
  const HIT_RADIUS_CELLS = 0.35;

  // ── Bolt size by tier ────────────────────────────────────────────────────
  // A slot flagged `growsWithTier` (the staff) fires a bigger shot the better
  // the relic: a Wood bolt is the base size, a Frost one is BOLT_MAX_TIER_MUL
  // times it, linear in between. The radius that HITS (the shot's `radiusM`,
  // what stepShots sweeps foes with) and the radius that DRAWS (its `dotPx`,
  // what app.js paints) come off the SAME `boltScale`, stamped onto the shot
  // by spawnShot — the roadOverlayWidthM discipline: a bolt drawn twice as
  // fat had better sweep twice as wide, and a single number keeps them from
  // drifting apart. The bow's arrow is not flagged: it stays at
  // HIT_RADIUS_CELLS at every tier.
  const MAX_TIER = 7;
  const BOLT_MAX_TIER_MUL = 2;
  function boltScale(slot, tier) {
    const spec = SHOT[slot];
    if (!spec || !spec.growsWithTier) return 1;
    const t = clamp(Math.floor(Number(tier) || 1), 1, MAX_TIER);
    return 1 + ((t - 1) / (MAX_TIER - 1)) * (BOLT_MAX_TIER_MUL - 1);
  }
  // The hit radius of a `slot` shot at `tier`, in world metres.
  function shotRadiusM(slot, tier, cellM) {
    return HIT_RADIUS_CELLS * cellM * boltScale(slot, tier);
  }
  // The drawn radius of a bolt at `tier`, in screen px (0 for a streak slot).
  function shotDotPx(slot, tier) {
    const spec = SHOT[slot];
    return spec && spec.dotPx ? spec.dotPx * boltScale(slot, tier) : 0;
  }

  // Damage per shot: one firing-interval's worth of that weapon tier's
  // melee-equivalent rate, weighted by the slot (SHOT_DMG_MUL — the staff
  // hits double, priced in energy per bolt). No split across ranged slots:
  // only one weapon ever fires (save.activeWeapon, app.js), so a bow alone
  // delivers its tier's FULL melee rate — same as a sword of that tier — and
  // a staff alone delivers double that. The interval cancels out of the
  // delivered per-second rate entirely; it only paces how chunky each hit
  // looks. An empty slot fires nothing at all.
  //
  // The floor of 1 is what keeps a wooden weapon firing at all once the
  // rounding is through; it only ever binds on rungs whose full rate is
  // already under two per second.
  function shotDamage(relics, slot) {
    if (!relics || !relics[slot]) return 0;
    const perSecond = dpsForDurationMs(toolDurationMs(relics, slot)) * (SHOT_DMG_MUL[slot] || 1);
    return Math.max(1, Math.round(perSecond * fireIntervalMs(slot) / 1000));
  }

  // The heading a 'nearest'-aimed slot fires along from (x, y): a vector to
  // the closest of `enemies`, or null when there is none — or none within
  // `maxRangeM` (optional; the slot's own rangeCells × cellM is what the
  // caller hands over, so the staff never spends a bolt on a foe it can't
  // reach). Ties go to the first listed, so the pick is stable frame to frame.
  // `enemies` is the caller's already-filtered hostile list, exactly as
  // stepShots takes it — a crow or a pet can no more be aimed at than hit.
  function aimAtNearest(x, y, enemies, maxRangeM) {
    let best = null, bestD2 = maxRangeM != null ? maxRangeM * maxRangeM : Infinity;
    for (const e of enemies || []) {
      const dx = e.x - x, dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > bestD2 || !(d2 > 0)) continue;
      bestD2 = d2;
      best = { x: dx, y: dy };
    }
    return best;
  }

  // Resolve the heading a slot fires along: the compass `facing` for a
  // 'compass' slot, the line to the nearest foe for a 'nearest' one. Returns
  // null when there is nothing to fire at, and app.js fires nothing then.
  function shotHeading(slot, x, y, facing, enemies, cellM, reachCells) {
    const spec = SHOT[slot];
    if (!spec) return null;
    if (spec.aim === 'nearest') return aimAtNearest(x, y, enemies, rangeCellsFor(slot, reachCells) * cellM);
    return facing || null;
  }

  // A shot in flight. `dir` is the heading (need not be normalised) — the
  // compass or the line to a foe, per shotHeading; a zero-length heading is
  // refused rather than firing a shot that sits on the player's feet forever.
  // `tier` is the firing relic's tier and sizes the shot (boltScale above):
  // `radiusM` is what stepShots sweeps foes with and `dotPx` what app.js
  // draws, both stamped here so they can't disagree. Omitted, it is tier 1.
  // `reachCells` is the caster's live reach, for the slots whose range is
  // derived from it (rangeCellsFor) — the same value shotHeading was handed,
  // so the bolt flies exactly as far as the check that loosed it.
  function spawnShot(slot, x, y, dir, cellM, dmg, tier, reachCells) {
    const mag = Math.hypot(dir?.x || 0, dir?.y || 0);
    if (!(mag > 0)) return null;
    const spec = SHOT[slot];
    return {
      slot, x, y,
      vx: dir.x / mag, vy: dir.y / mag,
      speedMps: spec.speedCps * cellM,
      rangeM: rangeCellsFor(slot, reachCells) * cellM,
      travelledM: 0,
      damage: dmg,
      pierce: !!spec.pierce,
      radiusM: shotRadiusM(slot, tier, cellM),
      dotPx: shotDotPx(slot, tier),
    };
  }

  // How finely a shot's flight is sampled against the world when the caller
  // supplies a `blocked` test, in cells. Half a cell is well under the
  // thinnest thing that can stop a shot (a cave wall is a whole cell), so a
  // frame long enough to carry a shot several cells still can't step over one.
  const BLOCK_SAMPLE_CELLS = 0.5;

  // Advance every shot by `dt` seconds and resolve the first enemy each one
  // touches. `enemies` is the caller's already-filtered hostile list; `onHit`
  // takes (enemy, shot). A shot is dropped when it hits, when it has flown its
  // range, or when it runs into something solid. Returns the survivors —
  // assign the result back.
  //
  // `hitRadiusM` is the fallback sweep for a shot that carries no `radiusM`
  // of its own; a shot from spawnShot always does (sized by its tier), and
  // that wins, so a Frost bolt sweeps wider than a Wood one through the same
  // call.
  //
  // No swept-collision maths for the FOES: the fastest shot covers ~0.5 m a
  // frame against a hit radius of ~6 m, so nothing can tunnel through one.
  //
  // `opts.blocked(x, y)` — optional world test for solid ground, in world
  // metres. This module knows nothing about the map, so the caller hands the
  // question over: underground, app.js answers with the cave-wall collision
  // test, which is what stops a bow or staff shooting through solid rock at a
  // monster in the next tunnel. Without it a shot ignores the world entirely,
  // which is exactly right on the surface — there is nothing up there a shot
  // should stop against (you can shoot over a fence or a river). A shot that
  // runs into rock stops at the face rather than inside it, so the streak
  // reads as hitting the wall, and it is then dropped.
  // `opts.cellM` sizes the sampling; it falls back to the hit radius, which is
  // just under a cell.
  //
  // `opts.hostileTargets` — what a HOSTILE shot (a monster's arrow, flagged
  // `hostile` by monsterShot) can hit: the player, handed over as a marker
  // `{ id, x, y }` at the feet. A hostile shot never sweeps `enemies` (an
  // archer can't shoot its own pack) and a friendly one never sweeps the
  // player; the two lists never mix, whichever order the shots sit in.
  function stepShots(shots, dt, enemies, hitRadiusM, onHit, opts) {
    const alive = [];
    const r2 = hitRadiusM * hitRadiusM;
    const blocked = opts && opts.blocked;
    const hostileTargets = (opts && opts.hostileTargets) || [];
    const sampleM = Math.max(0.01,
      ((opts && opts.cellM) || hitRadiusM) * BLOCK_SAMPLE_CELLS);
    for (const s of shots) {
      const targets = s.hostile ? hostileTargets : enemies;
      const sr2 = s.radiusM != null ? s.radiusM * s.radiusM : r2;
      const step = s.speedMps * dt;
      // How far of this frame's step the shot actually gets to travel: all of
      // it, unless something solid is in the way. A PIERCING shot (the staff
      // bolt) never consults the world at all — magic crosses rock and timber.
      let travel = step;
      let stopped = false;
      if (!s.pierce && blocked && step > 0) {
        const samples = Math.max(1, Math.ceil(step / sampleM));
        for (let i = 1; i <= samples; i++) {
          const t = (step * i) / samples;
          if (!blocked(s.x + s.vx * t, s.y + s.vy * t)) continue;
          travel = Math.max(0, t - step / samples);   // stop at the face, not inside
          stopped = true;
          break;
        }
      }
      s.x += s.vx * travel;
      s.y += s.vy * travel;
      s.travelledM += travel;
      if (s.pierce) {
        // Piercing: damage every foe inside the radius ONCE each, keep flying.
        // The per-shot hit ledger is what stops a slow bolt re-hitting the
        // same foe on every frame it spends crossing them.
        for (const e of targets) {
          const d2 = (e.x - s.x) * (e.x - s.x) + (e.y - s.y) * (e.y - s.y);
          if (d2 > sr2) continue;
          const key = e.id != null ? e.id : e;
          if (!s._struck) s._struck = new Set();
          if (s._struck.has(key)) continue;
          s._struck.add(key);
          onHit(e, s);
        }
      } else {
        let hit = null, bestD2 = sr2;
        for (const e of targets) {
          const d2 = (e.x - s.x) * (e.x - s.x) + (e.y - s.y) * (e.y - s.y);
          if (d2 <= bestD2) { bestD2 = d2; hit = e; }
        }
        // A foe standing right against the far side of the wall is more than a
        // hit radius from where the shot stopped, so this can't reach through.
        if (hit) { onHit(hit, s); continue; }
      }
      if (stopped) continue;                          // spent against the rock
      if (s.travelledM >= s.rangeM) continue;
      alive.push(s);
    }
    return alive;
  }

  // ── Castle turrets ───────────────────────────────────────────────────────
  // A castle's turrets (worldgen's `tower` objects, one per ~5 rim cells) are
  // archers. While an enemy is on screen, every turret ALSO on screen looses a
  // WOOD-TIER BOW ARROW at the nearest foe inside the bow's range — at ONE
  // FIFTH the player's cadence, so a rim of six covers the approach without
  // fighting the fight for you. Nothing here is tuned: the arrow IS the
  // player's bow arrow (SHOT.bow — same speed, range, streak, and it stops in
  // timber and rock the same way), its damage is what a Wood bow deals
  // (shotDamage over TURRET_RELICS, so a re-shaped tool ladder moves the
  // turrets with it), and the interval is the player's times TURRET_RATE_DIV.
  // A turret has no compass, so it aims the staff's way (aimAtNearest) and,
  // like the staff, holds fire — clock left due — while the nearest foe is
  // beyond the arrow's range, so it fires the instant one steps in.
  // "Enemy" is the caller's already-filtered list, exactly as stepShots takes
  // it: a turret can no more shoot a crow, a deer or a tamed slime than the
  // player's auto-fire can.
  const TURRET_RATE_DIV = 5;
  const TURRET = {
    slot: 'bow',
    tier: 1,                                              // Wood
    // The turret shoots the player's BOW arrow, so it paces off the bow's own
    // beat — never the bare base — times TURRET_RATE_DIV.
    fireIntervalMs: fireIntervalMs('bow') * TURRET_RATE_DIV,   // 10 s a turret
  };
  const TURRET_RELICS = { bow: { tier: TURRET.tier } };
  function turretShotDamage() { return shotDamage(TURRET_RELICS, TURRET.slot); }

  // Where in its cadence a turret starts, in ms — a deterministic hash of its
  // id spread over one interval, so the six turrets of a rim that all sight a
  // foe on the same frame don't volley as one and then fall silent together.
  // The same turret always gets the same phase, so the pattern is stable
  // across sightings and sessions.
  function turretPhaseMs(id) {
    return (fnv1a(id == null ? '' : id) % 1000) / 1000 * TURRET.fireIntervalMs;
  }

  // The arrow a turret at (x, y) looses at `enemies`: a bow shot along the
  // line to the nearest foe within the bow's range, or null when there is
  // none. `aimDistM` is stamped on for the draw — the arrow leaves the
  // battlements and comes down to chest height over that distance.
  function turretShot(x, y, enemies, cellM) {
    const heading = aimAtNearest(x, y, enemies, SHOT[TURRET.slot].rangeCells * cellM);
    if (!heading) return null;
    const shot = spawnShot(TURRET.slot, x, y, heading, cellM, turretShotDamage(), TURRET.tier);
    if (!shot) return null;
    shot.turret = true;
    shot.aimDistM = Math.hypot(heading.x, heading.y);
    return shot;
  }

  // Advance the on-screen turrets' clocks and return the arrows loosed this
  // frame. `clocks` is the caller's per-turret map (id → next-fire ms) and is
  // mutated in place; the caller clears it while no enemy is on screen so the
  // next sighting re-arms each turret at its phase rather than firing a
  // cadence that ran down in an empty street — the player's `_nextShotT`
  // rule. A turret whose nearest foe is out of range keeps its clock due.
  function turretTick(turrets, clocks, now, enemies, cellM) {
    const shots = [];
    for (const t of turrets || []) {
      let due = clocks[t.id];
      if (due == null) due = clocks[t.id] = now + turretPhaseMs(t.id);
      if (now < due) continue;
      const shot = turretShot(t.x, t.y, enemies, cellM);
      if (!shot) continue;
      clocks[t.id] = now + TURRET.fireIntervalMs;
      shots.push(shot);
    }
    return shots;
  }

  // ── Monster arrows ───────────────────────────────────────────────────────
  // A RANGED monster (MONSTERS[kind].range > 1 — the goblin archer and its
  // giant) attacks with a visible arrow, not the silent energy leech the
  // melee kinds land: app.js (wanderCreatures) looses one at the player
  // whenever they are inside the kind's range with a clear line of fire
  // (lineOfFire — the same rock that stops your arrow stops theirs), and the
  // arrow flies exactly as a bow arrow does, joining the one shot list. It is
  // flagged `hostile`, which is what makes stepShots sweep it against the
  // PLAYER (opts.hostileTargets) rather than the enemy list. Its damage is the
  // kind's `dmg` — one arrow is one hit of the table — and its cadence is the
  // castle turret's (MONSTER_SHOT_INTERVAL_MS = TURRET.fireIntervalMs), so an
  // archer and a turret trade arrows at the same pace. A distinct colour
  // keeps a shot coming AT you legible from one going out.
  const MONSTER_SHOT_INTERVAL_MS = TURRET.fireIntervalMs;
  const HOSTILE_ARROW_COLOR = 0xb0f08a;
  function monsterShot(x, y, targetX, targetY, cellM, dmg, hits = 1) {
    const heading = { x: targetX - x, y: targetY - y };
    const shot = spawnShot('bow', x, y, heading, cellM, dmg, 1);
    if (!shot) return null;
    shot.hostile = true;
    shot.color = HOSTILE_ARROW_COLOR;
    shot.aimDistM = Math.hypot(heading.x, heading.y);
    // How many hits of the kind's table this one arrow is carrying — armour
    // soaks them one at a time (playerDamage above), so a bundled volley is
    // mitigated exactly as the melee cadence it stands in for would be.
    shot.hits = Math.max(1, Math.round(hits || 1));
    return shot;
  }

  // Is there a clear line from (x0,y0) to (x1,y1)? Sampled at the same
  // resolution a shot's flight is, through the same caller-supplied world
  // test, so what stops an arrow stops a line of fire.
  //
  // For a RANGED MONSTER's attack. The goblin archer reaches three cells, and
  // without this it reaches them through solid rock — taking exactly the shot
  // the player is no longer allowed to take, from somewhere they often cannot
  // even see. Melee kinds are adjacent by definition and never consult it.
  // The endpoints are skipped: those are the two bodies, and a body is
  // standing on floor by definition.
  function lineOfFire(x0, y0, x1, y1, blocked, cellM) {
    if (!blocked) return true;
    const dx = x1 - x0, dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    if (!(dist > 0)) return true;
    const sampleM = Math.max(0.01, (cellM || 1) * BLOCK_SAMPLE_CELLS);
    const samples = Math.max(1, Math.ceil(dist / sampleM));
    for (let i = 1; i < samples; i++) {
      const t = i / samples;
      if (blocked(x0 + dx * t, y0 + dy * t)) return false;
    }
    return true;
  }

  // Health-bar tint. The bar has to read as health at a glance without a
  // number: full green, bloodied amber, nearly-dead red.
  function healthColor(frac) {
    if (frac > 0.5) return 0x6fdc6f;
    if (frac > 0.25) return 0xffc23d;
    return 0xff5a5a;
  }

  const api = {
    MONSTERS, MONSTERS_BASELINE, CAVE_ENEMY_MUL, GIANT_HP_MUL, GIANT_DEPTH_STEP,
    registerMonsters, monster, isMonster, FAUNA_HP, creatureMaxHp,
    ENEMY_COIN_PER_HP, ENEMY_DEPTH_BONUS, enemyBounty,
    MONSTER_TREASURE_CHANCE, ELITE_TREASURE_CONTEXT, eliteRollBonus,
    FAUNA_BLOCKED_TYPES, faunaBlocksCell,
    isEnemyKind, isEnemy, enemyKinds, enemyName, hp, damage, hpFraction,
    ELITE_MUL, isElite, eliteMul, maxHp,
    dpsForDurationMs, meleeDps, MELEE_INTERVAL_MS, meleeSwingDamage, shotDamage,
    MITIGATION_ROUNDS, MIN_PLAYER_DAMAGE, mitigate, playerDamage, playerDowned,
    MELEE_REACH_CELLS, meleeReachM, inMeleeReach,
    FIRE_INTERVAL_MS, STAFF_BEAT_MUL, fireIntervalMs,
    RANGED_SLOTS, SHOT, SHOT_DMG_MUL, HIT_RADIUS_CELLS, rangeCellsFor,
    MAX_TIER, BOLT_MAX_TIER_MUL, boltScale, shotRadiusM, shotDotPx,
    aimAtNearest, shotHeading, spawnShot, stepShots, lineOfFire, healthColor,
    TURRET, TURRET_RATE_DIV, turretShotDamage, turretPhaseMs, turretShot, turretTick,
    MONSTER_SHOT_INTERVAL_MS, HOSTILE_ARROW_COLOR, monsterShot,
  };
  root.Combat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
