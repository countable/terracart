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
//                    stepShots' `hostile` lane; scene_creatures.js wanderCreatures fires
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
// (the Equip button under the Relics inventory tab, or obtaining/forging a
// new one, which becomes active automatically). MELEE NEEDS NO WEAPON: with
// no bow or staff equipped the hands auto-engage exactly as a sword does, on
// the tier-0 rung (Gear.meleeActive). Because only one weapon can ever
// be in play, there is no split across ranged slots any more: there used to
// be one (bow and staff fired simultaneously and stacked, so their shares
// were priced to sum to one sword), but exclusivity already prevents the
// double-dip the split existed to fix. What's left is SHOT_DMG_MUL, a
// deliberate difference in KIND rather than a stacking guard: the bow (an
// arrow) delivers its tier's full melee-equivalent rate, same as the sword;
// the staff (a piercing, seeking bolt) delivers 4/15 of it — 5 damage every
// 5 s at Wood — and still costs energy per bolt; see the SHOT table below.
// (It was DOUBLE the bow until Sep 2026.)
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

  // Approved roster stats are final values: no implicit cave or giant doubling.
  const roster = root.EnemyRoster || (typeof require === 'function' ? require('./enemy_roster.js') : null);
  if (!roster) throw new Error('Load enemy_roster.js before combat.js');
  const SLIME_SIGHT_CELLS = roster.get('slime').visionCells;
  const GHOST_SPEED_MPS = roster.get('ghost').movement.speedMetersPerSecond;
  const GHOST_TOUCH_DMG = roster.get('ghost').dmg;
  const LAVA_DMG_PER_S = 2;
  function combatRow(row) {
    return {
      ...row,
      // Preserve the condition already carried by purple slimes in existing saves.
      ...(row.id === 'purple_slime' ? { condition: 'poison' } : {}),
      sight: row.visionCells,
      retreat: row.movement.retreatDistanceFraction || 1,
      // The legacy step lane needs a positive pace. The roster owns movement
      // in metres per second, so aliases inherit that value instead of a dead
      // speedCellsPerSecond field that froze them at zero.
      speed: row.movement.speedMetersPerSecond || 1,
      mps: row.movement.speedMetersPerSecond,
      minDepth: row.cave?.minDepth ?? 0,
      maxDepth: row.cave?.maxDepth ?? null,
      weight: row.cave?.weight || 0,
      spawn: row.attackType === 'touch' ? 'night' : (!row.cave ? 'surface' : undefined),
      fly: row.movement.pattern === 'orbit_swoop' || row.id === 'purple_slime',
      giant: row.variantType === 'Giant' ? row.variantOf : undefined,
      lays: row.attackType === 'trap' ? 'trap' : undefined,
    };
  }
  const MONSTERS = Object.fromEntries(roster.ROWS.map(row => [row.id, combatRow(row)]));
  // Existing zone-only enemy: preserve tar-yard and burned-row encounters.
  // These are final stats; it stays outside the ordinary cave and quest pools.
  MONSTERS.fire_slime = { name: 'Fire Slime', hp: 20, armor: 0, tier: 2, range: 0.6, dmg: 4, speed: 0.9,
    minDepth: 0, weight: 1, spawn: 'zone', sight: SLIME_SIGHT_CELLS, board: false, eliteEligible: true };

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
  // How far a kind wanders off, as a fraction of its activation range (the
  // `retreat` column above; 1 — a full retreat — for any kind without one,
  // the surface slime included). A giant inherits its base kind's.
  function retreatMul(kind) {
    const r = monster(kind)?.retreat;
    return (typeof r === 'number' && r > 0) ? r : 1;
  }
  // How far off, in cells, this kind notices the player (the `sight` column;
  // the surface slime, which has no row, is a slime and so SLIME_SIGHT_CELLS).
  // Infinity for a row without one: it sees as far as it thinks, the sim
  // bubble. A giant inherits its base kind's. Lair guards and the ghost have
  // rings of their own and never ask.
  function sightCells(kind, save) {
    const raw = kind === 'slime' ? SLIME_SIGHT_CELLS : monster(kind)?.sight;
    const sight = (typeof raw === 'number' && raw > 0) ? raw : Infinity;
    const cut = (typeof jewelryVisionReduction === 'function') ? jewelryVisionReduction(save) : 0;
    return Number.isFinite(sight) ? Math.max(0, sight - cut) : sight;
  }
  // Can this kind see a player `distM` metres off? The per-creature half of
  // wanderCreatures' `unseen` (the other half is the per-tick `unnoticed`).
  function seesPlayer(kind, distM, cellM, save) {
    return distM <= sightCells(kind, save) * cellM;
  }
  // Is this kind a cave MONSTER? Narrower than isEnemyKind, which also counts
  // the surface slime.
  function isMonster(kind) { return kind !== 'slime' && !!monster(kind); }
  // Does this monster land blows at all? A row with no `dmg` (the trapper)
  // never hits: app.js's melee drain and monster arrow both ask this, so a
  // harmless kind is harmless by its row, never by a `kind === …`.
  function monsterHits(kind) { return (monster(kind)?.dmg || 0) > 0; }
  // What a monster LAYS instead of hitting ('trap'), or null. A giant inherits
  // its base kind's (the giant rows are spreads of the base row).
  function monsterLays(kind) { return monster(kind)?.lays || null; }
  // Does the cave bag (scene_creatures.js spawnCaveCreatures) draw this kind? Every row
  // without a `spawn` column — the ghost's 'night' is the one that has one.
  function spawnsUnderground(kind) {
    const m = monster(kind);
    return !!m && !m.spawn && !!m.cave;
  }

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
  // A SUMMONED ally borrows a kind's stats rather than carrying its own: the
  // spirit raven (the Scroll of the Raven) is "equal to a slime", so
  // its pool is the surface slime's here and its bite is the slime's below
  // (petBite). One row, derived — a retune of the slime retunes the raven.
  // Its pool is the slime's BASE (FAUNA_HP), never the hard-mode enemy scale:
  // creatureMaxHp only scales Combat.isEnemy kinds, and the raven is yours.
  const SUMMONED_AS = { spirit_raven: 'slime', mercenary: 'goblin', summoned_skeleton: 'skeleton', summoned_wraith: 'ghost' };
  for (const [kind, model] of Object.entries(SUMMONED_AS)) {
    if (FAUNA_HP[model] != null) FAUNA_HP[kind] = FAUNA_HP[model];
  }
  function summonedAs(kind) { return SUMMONED_AS[kind] || null; }

  // Shared enemy pools never depend on the receiving player's mode.
  function creatureMaxHp(kind) {
    const model = summonedAs(kind);
    if (model) return creatureMaxHp(model);
    const m = monster(kind);
    return (m && Number.isFinite(m.hp)) ? m.hp : (FAUNA_HP[kind] ?? 10);
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
  // potions scale the blow before armour; the receiving player's Hard penalty
  // applies afterward so enemy stats remain shared across modes.
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
  // table in one projectile (scene_creatures.js MONSTER_ARROW_HITS) — armour soaks each
  // of those hits, not the bundle, or a slow archer would out-damage a melee
  // kind against armour precisely because its damage arrives in one lump.
  // Mode belongs to the recipient, after armour. Callers may supply a mode
  // for another player; local combat defaults to the active save's mode.
  function playerDamageMultiplier(mode) {
    if (typeof Difficulty === 'undefined') return mode === 'hard' ? 2.5 : 1;
    return (mode ? Difficulty.of({ mode }) : Difficulty.get()).incomingDamageMul;
  }
  function playerDamage(damage, armor, hits = 1, mode) {
    const n = Math.max(1, Math.round(hits || 1));
    const reduction = (typeof armorReduction === 'function') ? armorReduction(armor) : 0;
    return n * mitigate(damage / n, reduction) * playerDamageMultiplier(mode);
  }
  // Mitigate whole packets, then integrate the rate. The one-point hit floor
  // is never applied once per animation frame for an aura or ongoing damage.
  function playerDamageRate(rawDps, armor, dtSeconds, options = {}) {
    const packet = options.packetSeconds > 0 ? options.packetSeconds : 1;
    return playerDamage(rawDps * packet * (options.multiplier ?? 1), armor, 1, options.mode)
      / packet * Math.max(0, dtSeconds);
  }

  // Resolve an incoming blow after the attacker has applied its own power and
  // instance power. Player difficulty is applied after armour. Potion expiry is persisted as epoch milliseconds;
  // attack cooldowns use performance.now() and must not be passed as `now`.
  // Callers own energy loss, cooldowns and popup accumulation.
  function incomingDamage(save, damage, hits = 1, now = Date.now()) {
    if (playerDowned(save?.energy) || Conditions.damageImmune(save, now)) return 0;
    let mul = 1;
    if ((save.protectionPotionUntil ?? 0) > now) mul = CONSUMABLE_SPEC.protection_potion.damageMul;
    if ((save.shieldPotionUntil ?? 0) > now) mul = Math.min(mul, CONSUMABLE_SPEC.shield_potion.damageMul);
    const shielded = mul < 1 ? Math.ceil(damage * mul) : damage;
    return playerDamage(shielded, save.armor, hits, save.mode);
  }

  // Carrying several shields never stacks their protection. Subtract once
  // per projectile after potion, armour and mode have resolved its hit bundle.
  function projectileReduction(save) {
    let reduction = 0;
    for (const [id, spec] of Object.entries(CARRIED_ITEM_SPEC)) {
      if (carriesItem(save, id)) reduction = Math.max(reduction, spec.projectileReduction || 0);
    }
    return reduction;
  }
  function incomingProjectileDamage(save, damage, hits = 1, now = Date.now()) {
    return Math.max(0, incomingDamage(save, damage, hits, now) - projectileReduction(save));
  }

  // ── A THIEF'S BLOW: the purse or the bag, never the bar ──────────────────
  // A roster row that says `steals` lands its swoop on what it names: the
  // PURSE (`'coins'` — the raven) or the BAG (`'food'` — the gull). The one
  // enemy-hit site (creature_ai.js rosterEnemyAttack) asks incomingTheft
  // INSTEAD of incomingDamage and hands what it says to the scene's one
  // thief writer (app.js _losePlayerToThief — off the money through addMoney
  // or out of the bag through Inventory.remove, the flinch, the "-N" on the
  // player's cell). It never touches the energy bar, so armour, the shield
  // potion and the mode's incoming-damage penalty (all about a BLOW) do not
  // apply; being DOWNED does — nothing hunts a body.
  //   WHAT: a TAKE, { what: 'coins', n } or { what: 'food', id, n: 1 }, or
  //   null when there is nothing to take (an empty purse, a bag with no food
  //   in it, a body, a sated thief). One shape for both so the hit site and
  //   the writer branch on `what` alone.
  //   HOW MUCH: coins — ONE coin (THEFT_COINS; owner, Sep 2026: "ravens
  //   could steal just one coin, then retreat"): a raven takes one shiny
  //   thing, not a purse, and never more than the purse holds (a thief
  //   cannot take you below $0). Felling one still pays its full bounty, so a
  //   raven is always worth more felled than fed. Food — ONE piece, off the
  //   biggest meal in the bag (theftFood: the stack with the highest
  //   FOOD_ENERGY, the first such stack on a tie): the bird goes for the best
  //   thing you are carrying.
  //   HOW OFTEN: ONE snatch per thief per UTC day. A thief that has stolen
  //   today is SATED (theftSated): it stands down and flies off (the rout
  //   lane in wanderCreatures) until the day turns. The ledger is the save's
  //   `thefts` — { day, ids } — the thief's generated (cell) id, reset on a
  //   new day, so the cap survives a reload. One ledger for every kind of
  //   thief.
  function theftKind(kind) { return monster(kind)?.steals || null; }
  const THEFT_COINS = 1;
  function theftAmount(kind) { return theftKind(kind) === 'coins' ? THEFT_COINS : 0; }
  // The bag's biggest meal — the stack a food thief takes from. Food is what
  // FOOD_ENERGY (items.js) prices: the one table the eat button reads.
  function theftFood(save) {
    const table = typeof FOOD_ENERGY !== 'undefined' ? FOOD_ENERGY : {};
    let best = null, bestE = 0;
    for (const s of (save && save.inv) || []) {
      if (!s || !(s.count > 0)) continue;
      const e = table[s.id] || 0;
      if (e > bestE) { best = s.id; bestE = e; }
    }
    return best;
  }
  function theftDay(now) {
    return typeof utcDayKey === 'function' ? utcDayKey(now)
      : new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
  }
  function theftSated(save, c, now = Date.now()) {
    const l = save && save.thefts;
    return !!(l && c && l.day === theftDay(now) && Array.isArray(l.ids) && l.ids.indexOf(c.id) >= 0);
  }
  function incomingTheft(save, c, now = Date.now()) {
    const what = save && c ? theftKind(c.kind) : null;
    if (!what) return null;
    if (playerDowned(save.energy) || theftSated(save, c, now)) return null;
    if (what === 'coins') {
      const purse = Math.max(0, Math.floor(save.money ?? 0));
      const n = Math.min(purse, theftAmount(c.kind));
      return n > 0 ? { what, n } : null;
    }
    if (what === 'food') {
      const id = theftFood(save);
      return id ? { what, id, n: 1 } : null;
    }
    return null;
  }
  // Mark `c` sated for today (the scene calls this once a snatch is banked).
  function bankTheft(save, c, now = Date.now()) {
    const day = theftDay(now);
    if (!save.thefts || save.thefts.day !== day) save.thefts = { day, ids: [] };
    if (save.thefts.ids.indexOf(c.id) < 0) save.thefts.ids.push(c.id);
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
  // Shadow Powder makes them: scene_creatures.js's wanderCreatures reads this beside
  // `shadowed` and every hostile falls back to an aimless wander — no stalk,
  // no charge, no leech, no arrow — until the bar lifts off zero.
  // ONE expression, both sides: the test that drops the pursuit is the same
  // one that refuses the damage, so a foe can never be chasing a player it
  // cannot hurt. Written negated so a NaN bar counts as down, like the
  // `> 0` guards it replaces.
  function playerDowned(energy) { return !((energy ?? 0) > 0); }

  // ── Elites ───────────────────────────────────────────────────────────────
  // A SHINY cave monster is an elite: one multiplier over the kind's HP and
  // damage together. Elite eligibility owns monster reward rolls; shiny
  // power applies to every creature, including fauna and coin-stealing ravens.
  const ELITE_MUL = 2;
  function isElite(c) {
    return !!c && !!c.shiny && isEnemyKind(c.kind) && monster(c.kind)?.eliteEligible !== false;
  }
  function eliteMul(c) { return isElite(c) ? ELITE_MUL : 1; }
  const SHINY_SPEED_MUL = 1.5;
  function shinyMul(c) { return c?.shiny ? ELITE_MUL : 1; }
  function shinySpeedMul(c) { return c?.shiny ? SHINY_SPEED_MUL : 1; }
  // Raised adults retain their double strength, without stacking that same
  // shiny identity twice. Shiny babies also receive the universal bonus.
  const RAISED_MUL = 2;
  function raisedMul(c) {
    return (c && c.raised && !SpriteLayout.isBabyPet(c)) ? RAISED_MUL : 1;
  }

  // Enlarged crypt ghosts have a separate size-based strength bonus.
  function ghostSizeMul(c) {
    if (!SpriteLayout.creatureHaunts(c?.kind)) return 1;
    const scale = c._artScale ?? c.artScale ?? 1;
    return EnemyRoster.GHOST_SCALING.rows.reduce((mul, row) =>
      scale >= row.sizeMultiplier ? Math.max(mul, row.powerMultiplier ?? 1) : mul, 1);
  }
  function powerMul(c) { return Math.max(shinyMul(c), raisedMul(c)) * ghostSizeMul(c); }
  // The HP pool of THIS instance — the kind's max times its power.
  // Everything that seeds or refills a creature's HP reads this, never
  // creatureMaxHp(kind) directly, or an elite heals back to half its health.
  // Rounded (a softened pool is a fraction of the kind's), never below 1;
  // at power 1 or 2 it is exactly the integer it always was.
  function maxHp(c) {
    const base = Math.max(1, Math.round(creatureMaxHp(c.kind) * powerMul(c)));
    return root.PotionEffects ? Math.max(1, Math.ceil((base + root.PotionEffects.maxHpBonus(c))
      * root.PotionEffects.maxHpMul(c))) : base;
  }

  // Hostile kinds — every cave monster, plus the surface slime.
  function isEnemyKind(kind) {
    return isMonster(kind) || kind === 'slime';
  }
  // EVERY hostile kind, in the order the board should offer them: the surface
  // slime first (the only foe you can meet without going underground), then the
  // registered table in ITS OWN order (enemy_roster.js row order).
  //
  // A FUNCTION, never a constant: registerMonsters can swap the table under it
  // (a test's synthetic kind), so the list is read at call time. quests.js'
  // board is the caller — it used to hand-type these nine kinds, which is how
  // a kind added to MONSTERS could quietly fail to be worth a bounty.
  function enemyKinds() {
    return [...new Set(['slime', ...Object.keys(MONSTER_STATS)])];
  }
  // May the quest board name this kind in a kill job? Every enemy but a row
  // that says `board: false` (the fire slime) — the column, never a list.
  function onQuestBoard(kind) {
    const m = MONSTER_STATS[kind];
    return isEnemyKind(kind) && !(m && m.board === false);
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
  //   surface slime 10hp → $2 · purple slime 16hp → $3 · cave slime 24hp → $5 ·
  //   goblin 48hp → $10 · archer 57hp → $11 (enemy_roster.js values, Oct 2026)
  // The HP comes from creatureMaxHp, which is the monster table first and the
  // fauna ladder second — one source, so the coins a kind pays and the HP you
  // have to chew through can't drift apart. Depth adds a slow climb on top (a
  // coin per 3 levels down) so descending pays for itself even where the same
  // kinds keep spawning; at the surface it contributes nothing.
  const ENEMY_COIN_PER_HP  = 1 / 5;
  const ENEMY_DEPTH_BONUS  = 1 / 3;    // extra coins per level below the surface
  // `hpMul` is the instance's multiplier over the kind's HP — powerMul: an
  // elite has twice the pool, so it pays twice the per-HP wage, by the same
  // rule that makes a goblin pay more than a slime.
  // (Hard mode adds no wage of its own: creatureMaxHp already scales an
  // enemy's pool by Difficulty.enemyHpMul, and the per-HP rule carries that
  // into the coins — a foe that takes 1.5× as long pays 1.5× as much, same as
  // an elite.)
  function enemyBounty(kind, depth, hpMul = 1) {
    if (!isEnemyKind(kind)) return 0;
    // Treasure creatures can declare a fixed payout, independent of mode/depth.
    const fixed = monster(kind)?.bountyCoins;
    if (fixed != null) return fixed;
    return Math.max(1, Math.round(creatureMaxHp(kind) * (hpMul || 1) * ENEMY_COIN_PER_HP))
         + Math.floor(Math.max(0, depth || 0) * ENEMY_DEPTH_BONUS);
  }
  // WHO FELLED IT. The bounty is paid by every death — it drops on the foe's
  // cell as ONE coin carrying the whole amount (app.js _dropBountyCoin), for
  // whoever walks over to pick it up. Everything PAST the wage (the kind's
  // drop, the elite badge and roll, the 10% monster roll, the quest tick, the
  // shiny fanfare) is the PLAYER's reward and is paid only when the killer was
  // the player — their blade, bow, staff, potion or aura — or the player's own
  // pet. A claimed castle's turret (shot.source 'turret') is not the player:
  // it fells a foe for the coin alone, or a ring of walls would farm badges
  // and quests while you stood still. A source not on this list — a future
  // environmental killer — is not the player either. The one predicate
  // resolveDefeat reads; a shot's source is stamped on the shot (turretShot)
  // and read back through shotSource.
  const PLAYER_KILL_SOURCES = new Set(['player', 'pet', 'ally']);
  function isPlayerKill(source) { return PLAYER_KILL_SOURCES.has(source); }
  function shotSource(shot) {
    if (shot?._sourceGuard) return isCharmed(shot._sourceGuard) ? 'ally' : 'enemy';
    return (shot && shot.source) || 'player';
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
  // move onto a building footing, or a major road"). WATER (3) + all building
  // tiers (9/11/12) + the MAJOR road tiers (ROAD_LG 13 / ROAD_MD 14) +
  // CAVE_WALL (25). A minor street (ROAD 7) and PATHS (8) are crossable
  // (owner, Oct 2026: a wall at every side street boxed creatures into one
  // block); the major band itself is also refused by its roadClass bit (THE
  // KERB, creature_ai.js), and nothing SPAWNS on any road (isSpawnCell).
  // Every wander, flee, stalk and spawn seat in app.js asks this one
  // predicate — it is about the creatures, so it lives with them.
  const FAUNA_BLOCKED_TYPES = new Set([3, 9, 11, 12, 13, 14, 25 /* CAVE_WALL */]);
  function faunaBlocksCell(type) { return FAUNA_BLOCKED_TYPES.has(type); }

  // ── A STATUS LANDS ON A CREATURE ──────────────────────────────────────
  // THE ONE TABLE OF HOW A CREATURE'S STATUS LOOKS when it is given: the
  // word that pops over its head and the colour its body flicks for
  // STATUS_FLASH_MS (render.js drawCreatures reads both off the creature;
  // app.js _popCreatureText draws the word in the damage-number lane). A
  // sleep, a charm, the frost, a fear and the madness are rows here; a BURN
  // is the `burning` row of Conditions.DEFINITIONS (statusLook — the same
  // label and ink the player's chip wears), and a THROWN POTION's buff is
  // its Buffs.KINDS row (potion_effects.js apply). Every applier calls
  // flagStatus with its look, so a new status on a creature is a row here
  // and one flagStatus call, never a pop or a tint of its own. The marker
  // that STAYS over a sleeper's or an ally's head (Render.flowerStatusMarker)
  // reads the same colours.
  //   The flash is the same channel the player's own announcement uses
  // (app.js _flashPlayerStatus / _announceStatuses, STATUS_FLASH_MS): a
  // status landing on anybody looks the same.
  const STATUS_FLASH_MS = 400;
  const STATUS_LOOKS = Object.freeze({
    sleep:     Object.freeze({ label: 'Sleep',     color: '#bcdfff' }),
    charm:     Object.freeze({ label: 'Charm',     color: '#ff91b8' }),
    // The ice the body wears while it holds (util.js FROZEN_TINT).
    frozen:    Object.freeze({ label: 'Frozen',    color: '#' + FROZEN_TINT.toString(16).padStart(6, '0') }),
    fear:      Object.freeze({ label: 'Fear',      color: '#c77dff' }),
    psychosis: Object.freeze({ label: 'Psychosis', color: '#c6ff4d' }),
  });
  function statusLook(id) {
    const def = root.Conditions?.DEFINITIONS[id];
    if (def) return { label: def.label, color: def.ink };
    return STATUS_LOOKS[id] || null;
  }
  // A status has just LANDED on `c`: arm the flick and queue the word. The
  // flick's clock is performance.now() like a foe's burn and fear, whatever
  // clock the status itself keeps (sleep and frost keep wall time).
  function flagStatus(c, look, now = performance.now()) {
    if (!c || !look) return false;
    c._statusFlashLook = look;
    c._statusFlashUntilT = now + STATUS_FLASH_MS;
    c._statusPop = { label: look.label, color: look.color, atT: now };
    return true;
  }
  // The tint the flick paints this instant, or null once it has passed.
  function statusFlashTint(c, now = performance.now()) {
    const look = c?._statusFlashLook;
    if (!look || !((c._statusFlashUntilT || 0) > now)) return null;
    return parseInt(look.color.slice(1), 16);
  }

  const FLOWER_STATUS_MS = 60 * 1000;
  function isSleeping(c, now = Date.now()) { return !!c && (c._sleepUntil || 0) > now; }
  function isCharmed(c, now = Date.now()) { return !!c && (c._charmUntil || 0) > now; }
  function isBurrowed(c) { return !!c?._burrowed; }
  function isDisguised(c) {
    return !!c && !c._disguiseRevealed && !!root.EnemyRoster?.get(c.kind)?.disguise;
  }
  function isConcealed(c) { return isBurrowed(c) || isDisguised(c); }
  function flowerTarget(c) {
    return !!c && !c._surfaceInactive && !isConcealed(c) && isEnemyKind(c.kind)
      && !(typeof c.id === 'string' && c.id.startsWith('released_'));
  }
  function cancelCreatureAction(c) {
    c._moving = false;
    c._attackWindupUntil = null;
    c._attackAim = null;
    c._abilityWindupUntil = null;
    c._attackUntil = 0;
    c._batFlight = null;
    c._batSwooping = false;
    c._lungeUntil = 0;
    c._lungeWindupUntil = 0;
    c._startX = c._targetX = c.x;
    c._startY = c._targetY = c.y;
  }
  function applySleep(c, now = Date.now()) {
    if (!flowerTarget(c)) return false;
    c._sleepUntil = now + FLOWER_STATUS_MS;
    cancelCreatureAction(c);
    flagStatus(c, STATUS_LOOKS.sleep);
    return true;
  }
  function applyCharm(c, now = Date.now()) {
    if (!flowerTarget(c)) return false;
    c._charmUntil = now + FLOWER_STATUS_MS;
    cancelCreatureAction(c);
    c._wardFrom = null;
    c._wanderOffUntilT = null;
    flagStatus(c, STATUS_LOOKS.charm);
    return true;
  }
  // PSYCHOSIS (the Powder of Psychosis, app.js usePsychosisPowder): for
  // `durationMs` the foe loses its head — wanderCreatures reads
  // isPsychotic as one more reason in the ROUT lane (the flee pace, no blow,
  // no target) with a RANDOM angle each hop in place of fear's away angle;
  // rosterEnemyMove rolls the same random heading. The clock is
  // performance.now(), fear's (`_fearUntilT`), so the two share one `now` in
  // the step loop. Whatever it was winding up is dropped, and it turns NOW
  // rather than finishing a hop at the player (fear does the same through
  // monsterRout). Only a flower target — a hostile kind, never a pet.
  function isPsychotic(c, now = performance.now()) { return !!c && (c._psychosisUntilT || 0) > now; }
  function applyPsychosis(c, durationMs, now = performance.now()) {
    if (!flowerTarget(c)) return false;
    c._psychosisUntilT = now + durationMs;
    cancelCreatureAction(c);
    if (c._nextChooseT != null) c._nextChooseT = now;
    flagStatus(c, STATUS_LOOKS.psychosis, now);
    return true;
  }

  // A hostile INSTANCE. A slime tamed with a sapphire (id 'released_…') is a
  // pet: it must never be shot at, auto-engaged, or counted as "an enemy is on
  // screen" for the auto-fire gate. A rose's temporary ally gets the same
  // targeting exclusion while its charm lasts; buried creatures are likewise
  // unavailable until they surface. Their species remains unchanged.
  function isEnemy(c, now = Date.now()) {
    if (!c || c._surfaceInactive || isConcealed(c) || isCharmed(c, now)) return false;
    if (typeof c.id === 'string' && c.id.startsWith('released_')) return false;
    return isEnemyKind(c.kind);
  }

  // ── A pet's bite ─────────────────────────────────────────────────────────
  // What ONE bite in wanderCreatures' pet fight takes off the prey (the fight
  // resolves once per wander step). A tame animal worries its prey down, a
  // point a bite — PET_BITE, what the fight always dealt. A SUMMONED ally
  // bites with the blow of the kind it is summoned as (SUMMONED_AS): the
  // spirit raven lands the surface slime's leech, SLIME_LEECH_ENERGY (items.js
  // — the slime's one bite a second), and its row steps once a second, so it
  // deals what a slime deals at the rate a slime deals it. A monster model
  // would bite for its registered `dmg`.
  const PET_BITE = 1;
  function enemyBlow(kind) {
    const m = monster(kind);
    if (m) return m.dmg || 0;
    // The surface slime — the one enemy with no MONSTERS row (isEnemyKind).
    if (isEnemyKind(kind) && typeof SLIME_LEECH_ENERGY === 'number') return SLIME_LEECH_ENERGY;
    return PET_BITE;
  }
  function petBite(kind) {
    const model = SUMMONED_AS[kind];
    return model ? enemyBlow(model) : PET_BITE;
  }
  // THIS pet's blow: its kind's bite times its own power (a raised pet's
  // double). The fight in scene_creatures.js reads this, never petBite alone.
  function petBlow(c) {
    const base = petBite(c.kind) * powerMul(c);
    return root.PotionEffects ? (base + root.PotionEffects.meleeBonus(c)) * root.PotionEffects.meleeMul(c) : base;
  }

  // Current HP, lazily seeded from the kind's max the first time anything hits
  // it. Creatures are re-spawned from tile data on every reload, so `_hp` is
  // in-memory only — a foe you softened up and walked away from is whole again
  // next session, exactly like the timed wheel it replaces.
  function hp(c) {
    if (!Number.isFinite(c._hp)) c._hp = maxHp(c);
    return c._hp;
  }
  // Return actual HP removed for damage popups; damage() retains its HP-left
  // contract for existing defeat checks. Environmental/aura callers can pass
  // bypassArmor after computing a packet rate, avoiding a per-frame hit floor.
  function damageDealt(c, amount, options = {}) {
    const before = hp(c);
    if (isConcealed(c)) return 0;
    const raw = Math.max(0, amount) * (root.PotionEffects ? root.PotionEffects.damageMul(c) : 1);
    const hit = options.bypassArmor ? raw : mitigate(raw, monster(c.kind)?.armor || 0);
    if (hit > 0 && before > 0) c._sleepUntil = 0;
    c._hp = Math.max(0, before - hit);
    return before - c._hp;
  }
  function damage(c, amount, options) {
    damageDealt(c, amount, options);
    return c._hp;
  }
  function hpFraction(c) {
    const max = maxHp(c) || 1;
    return clamp01(hp(c) / max);
  }

  // Units and the player share the same burn clock and exposure scaling.
  // Unit clocks are performance.now(); state remains local like `_hp`.
  function burnDef() { return Conditions.DEFINITIONS.burning; }
  function canBurn(c) { return !!c && !isConcealed(c) && !monster(c.kind)?.lavaImmune; }
  function burning(c, now = performance.now()) {
    if (!c?._burnState) return false;
    return c._burnState.remainingMs > (c._burnExposed ? 0 : Math.max(0, now - c._burnAtT));
  }
  function ignite(c, now = performance.now(), by = 'fire') {
    if (root.Conditions?.fireImmune(c)) return false;
    if (!canBurn(c)) return false;
    if (c._burnState?.remainingMs > 0) { c._burnBy = by; return false; }
    const def = burnDef();
    c._burnState = { remainingMs: def.durationMs, nextTickMs: def.intervalMs };
    c._burnAtT = now;
    c._burnExposed = false;
    c._burnBy = by;
    // A FRESH burn announces itself (a body already alight re-stoked by
    // exposure returned above, so standing in a fire says it once).
    flagStatus(c, statusLook('burning'), now);
    return true;
  }
  // ── A creature's POISON ─────────────────────────────────────────────
  // The `poison` row of Conditions.DEFINITIONS, on a creature: the Poison
  // Flask (potion_effects.js apply) sets the row's duration and the tick
  // levies the row's energyLoss every intervalMs off its HP — the same
  // minute, the same bite a second, as the player's own poison. The clock is
  // performance.now() like the burn's, state in memory like `_hp`
  // (`_poisonState` — a thrown Antidote or Elixir deletes it, PotionEffects
  // .clearDebuffs). `by` names who poisoned it: the player's flask pays the
  // bounty on a kill (scene_fire.js _tickUnitPoison, the burn's dispatch).
  // A body no wound can reach (Conditions.damageImmune) runs the clock and
  // pays nothing.
  function poisonDef() { return Conditions.DEFINITIONS.poison; }
  function poisoned(c, now = performance.now()) {
    return !!c?._poisonState && c._poisonState.remainingMs > Math.max(0, now - c._poisonAtT);
  }
  function poison(c, now = performance.now(), by = 'player') {
    if (!c) return false;
    const def = poisonDef();
    const fresh = !poisoned(c, now);
    // A refresh runs the minute again without postponing the bite already due
    // (Conditions.apply's rule for the player).
    c._poisonState = { remainingMs: def.durationMs, nextTickMs: fresh ? def.intervalMs : Math.max(0, c._poisonState.nextTickMs - (now - c._poisonAtT)) };
    c._poisonAtT = now;
    c._poisonBy = by;
    if (fresh) flagStatus(c, statusLook('poison'), now);
    return fresh;
  }
  function poisonTick(c, now = performance.now()) {
    if (!c?._poisonState) return 0;
    const def = poisonDef();
    let { remainingMs, nextTickMs } = c._poisonState;
    let elapsed = Math.max(0, now - c._poisonAtT);
    let ticks = 0;
    // Advance to each bite's boundary, like Conditions.tick: a delayed frame
    // pays exactly what the one-second updates would.
    while (elapsed > 0 && remainingMs > 0) {
      const step = Math.min(elapsed, nextTickMs, remainingMs);
      remainingMs -= step; elapsed -= step; nextTickMs -= step;
      if (nextTickMs <= 0) { ticks++; nextTickMs = def.intervalMs; }
    }
    c._poisonAtT = now;
    if (remainingMs <= 0) { delete c._poisonState; c._poisonBy = null; }
    else c._poisonState = { remainingMs, nextTickMs };
    return root.Conditions?.damageImmune(c) ? 0 : ticks * def.energyLoss;
  }
  function burnTick(c, now = performance.now(), exposed = false) {
    if (root.Conditions?.fireImmune(c)) {
      if (root.PotionEffects) root.PotionEffects.extinguish(c);
      return 0;
    }
    if (!c?._burnState) return 0;
    const result = Conditions.advanceBurn(c._burnState, Math.max(0, now - c._burnAtT), exposed);
    c._burnState = { remainingMs: result.remainingMs, nextTickMs: result.nextTickMs };
    c._burnAtT = now;
    c._burnExposed = exposed;
    if (result.remainingMs <= 0) c._burnBy = null;
    return result.damage;
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
  //
  // `playerClass` (optional — save.playerClass, the wizard's one-time calling,
  // src/wizard.js CLASSES) is the PLAYER's own melee only: an ENFORCER lands
  // ENFORCER_MELEE_DPS more HP a second on top of the tier's rung. It is a
  // CLASS BONUS the player bought, not a fudge factor on the ladder: the rung
  // itself (15000 / toolDurationMs) is untouched, and a flat add rather than a
  // multiplier so it matters most where the rung is weakest — bare hands
  // (1.67 dps) nearly quadruple, a Frost blade (50 dps) barely notices.
  // Pets, turrets and monsters never pass a class.
  const ENFORCER_MELEE_DPS = 5;
  function meleeDps(relics, playerClass, weapon = 'sword') {
    const slot = MELEE_WEAPONS[weapon] && relics?.[weapon] ? weapon : null;
    const bonus = playerClass === 'enforcer' ? ENFORCER_MELEE_DPS : 0;
    return (dpsForDurationMs(toolDurationMs(relics, slot)) + bonus) / (MELEE_WEAPONS[weapon]?.intervalMul || 1);
  }

  // ── Melee cadence ────────────────────────────────────────────────────────
  // How often a blow LANDS on the enemy the player has engaged, in ms. A
  // sword fight is a sequence of swings, not a hose: the wheel used to drain
  // the foe's pool every frame at meleeDps and merely DRAW a slash twice a
  // second (app.js borrowed DMG_POPUP_BEAT_MS, 500 ms, because the damage
  // itself had no cadence of its own to borrow). Two blows a second read as a
  // blur, and a fight broken off mid-beat had still banked every frame of it.
  //
  // For the sword the interval CANCELS OUT of the delivered rate, exactly the way
  // FIRE_INTERVAL_MS does for a shot: one blow is one interval's worth of the
  // tier's melee rung (meleeSwingDamage below), so halving the attack rate
  // doubles what a blow lands and the kill-time identity at the top of this
  // file still holds at every tier. Slow it to change how a fight READS;
  // to change how LONG one takes, move TOOL_DURATION_MS or the kind's `hp`.
  const MELEE_INTERVAL_MS = 1000;
  // Off-weapons keep the matching sword's per-hit damage. Spear trades
  // half its attack speed for twice the reach.
  const MELEE_WEAPONS = {
    sword: { reachMul: 1, intervalMul: 1 },
    // A dagger stays inside the gap a closing foe stops at (creature_ai.js
    // rosterEnemyMove: 0.35 cell), or it could never land a blow.
    dagger: { reachMul: 0.75, intervalMul: 1 },
    spear: { reachMul: 2, intervalMul: 2 },
  };
  function meleeIntervalMs(slot) { return MELEE_INTERVAL_MS * (MELEE_WEAPONS[slot]?.intervalMul || 1); }

  // ── How far a melee attacker reaches ───────────────────────────────────
  // 0.6 CELL (owner, Oct 2026 — the foe-spacing gap: a crowd spread round the
  // player bites from arm's length, not from a cell off), for the player and
  // for a melee monster alike — and ONE number,
  // read by both sides, for the roadOverlayWidthM reason: a reach the player
  // has and the thing biting them does not is a difference nobody can see on
  // the screen and everybody feels in the fight.
  //
  // Until Sep 2026 melee reached the player's LIT reach — 2.5 cells at the
  // start and up to 5.5 with the six Inner Light upgrades — while every melee
  // monster (MONSTERS[kind].range 1) and the surface slime's leech had to be
  // ADJACENT. So you could stand three cells off a goblin and punch it to
  // death while it walked, and the Inner Light's reach upgrades quietly
  // doubled as combat range. Closing to arm's length is the whole cost of
  // choosing to melee something; the lit reach is about what you can WORK,
  // and it kept paying for a fight it was never priced for.
  //
  // The RANGED weapons are untouched: a bow or a staff is the thing you buy
  // to hit what you cannot punch (SHOT[].rangeCells).
  // The kinds whose roster row reaches further are named there: the spear
  // goblin's pole, a swooping flier's pass, a big body's arms (brutes, orc,
  // minotaur, the giants, the crab) — enemy_roster.js `range`.
  const MELEE_REACH_CELLS = 0.6;
  // The reach in metres, and the test both sides run. Centre-to-centre, which
  // is what the monster's own attack gate measures (scene_creatures.js wanderCreatures
  // compares the creature's position against the player's FEET), so the two
  // are symmetric by construction rather than by two similar-looking circles.
  function meleeReachM(cellM, slot) { return MELEE_REACH_CELLS * cellM * (MELEE_WEAPONS[slot]?.reachMul || 1); }
  function inMeleeReach(ax, ay, bx, by, cellM, slot) {
    const r = meleeReachM(cellM, slot);
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy <= r * r;
  }

  // What ONE blow takes off the foe: the tier's rate over one interval,
  // times `mul` for anything that multiplies the swing itself (app.js passes
  // 2 while the dragon is out). Damage per blow is derived here rather than
  // at the call site so the cadence and the payload can't drift apart — the
  // shotDamage discipline, for the blade. `playerClass` is meleeDps's (the
  // enforcer's flat bonus rides inside the rate, so the dragon doubles it too
  // — it multiplies the swing, whatever the swing is made of).
  // OFF THE GPS, THE BODY FIGHTS SOFTER. While the stick has walked the
  // player off their real position (app.js _offGps), every blow and shot of
  // their OWN — the melee wheel, the bow's arrow, the staff's bolt — lands at
  // OFF_GPS_ATTACK_MUL (a third softer). It rides the same `mul` the Dragon
  // Powder's ×2 does (app.js _attackMul), never a separate damage path: it
  // is a per-player state, like the dragon, not a property of the weapon.
  // Taught early in the Book (PLAY_TIPS, "a third softer" — books.test.js
  // re-derives it from here). Pets, powders, potions and traps are not the
  // player's attacks and are untouched.
  const OFF_GPS_ATTACK_MUL = 2 / 3;
  // The stick offset past which the body counts as walked off the fix, in
  // cells: a nudge to line up a tap is not a detour.
  const OFF_GPS_MIN_CELLS = 0.5;

  // ── Training (the Training Halls — loot.js MACRO_KIND_BY_CLASS 'training') ─
  // What the player BOUGHT at a hall, one DISCIPLINE per hall (Macros
  // trainingKindFor — off the hall's own id, so every player finds the same
  // hall teaching the same thing). ONE TABLE, every discipline a row:
  //   per    — what a level gives, for good (up to TRAINING_PERM_MAX levels);
  //   drill  — what the hall's day-long drill gives (TRAINING_BUFF_MS, one at
  //            a time per discipline, never stacking with itself);
  //   unit   — how it lands:
  //     'dmg'    flat damage on every hit of THAT attack type, after the
  //              multipliers (app.js _attackFlat): melee = each sword/fist
  //              blow, ranged = each arrow, magic = each staff bolt;
  //     'energy' added to the bar's cap (energy.js maxEnergy);
  //     'speed'  a fraction faster on every attack beat (trainingIntervalMul
  //              — the melee blow and both shot cadences; each hit keeps its
  //              damage, so speed is more hits, not bigger ones).
  // Levels live in save.training[kind], drills in save.trainingDrills[kind]
  // (an expiry stamp); a level is capped at TRAINING_PERM_MAX.
  // Pets, turrets, powders and potions are not the player's attacks.
  const TRAINING_KINDS = {
    melee:  { label: 'Melee',   per: 1,    drill: 5,    unit: 'dmg' },
    ranged: { label: 'Archery', per: 1,    drill: 5,    unit: 'dmg' },
    magic:  { label: 'Magic',   per: 1,    drill: 5,    unit: 'dmg' },
    energy: { label: 'Stamina', per: 10,   drill: 50,   unit: 'energy' },
    speed:  { label: 'Speed',   per: 0.05, drill: 0.25, unit: 'speed' },
  };
  const TRAINING_ORDER = ['melee', 'ranged', 'magic', 'energy', 'speed'];
  const TRAINING_PERM_MAX = 5;
  const TRAINING_BUFF_MS = 24 * 60 * 60 * 1000;
  // Which discipline a ranged weapon slot's hits train.
  const TRAINING_SLOT_KIND = { bow: 'ranged', musket: 'ranged', staff: 'magic' };
  function trainingLevel(save, kind) {
    const raw = save && save.training && save.training[kind];
    return clamp(Math.floor(Number(raw) || 0), 0, TRAINING_PERM_MAX);
  }
  function trainingDrillUntil(save, kind) {
    return Number(save && save.trainingDrills && save.trainingDrills[kind]) || 0;
  }
  function trainingBuffActive(save, kind, now = Date.now()) {
    return trainingDrillUntil(save, kind) > now;
  }
  // What a discipline gives right now: its levels plus a running drill.
  function trainingBonus(save, kind, now = Date.now()) {
    const row = TRAINING_KINDS[kind];
    if (!row) return 0;
    // Rust blesses blades and bows, sharing each discipline's drill cap.
    const drilled = trainingBuffActive(save, kind, now)
      || ((kind === 'melee' || kind === 'ranged') && !!root.Shrines && root.Shrines.leverActive(save, 'melee', now));
    return trainingLevel(save, kind) * row.per + (drilled ? row.drill : 0);
  }
  // The multiplier on every attack INTERVAL (melee blow, bow, staff): 1 over
  // one plus the speed bonus, so +25% speed is a beat 1/1.25 as long.
  function trainingIntervalMul(save, now = Date.now()) {
    return 1 / (1 + trainingBonus(save, 'speed', now));
  }


  function playerAttackIntervalMul(save, now = Date.now()) {
    return trainingIntervalMul(save, now) * Conditions.attackIntervalMul(save);
  }

  function meleeSwingDamage(relics, mul = 1, playerClass, slot = 'sword') {
    return meleeDps(relics, playerClass, slot) * (mul || 1) * meleeIntervalMs(slot) / 1000;
  }

  // The BASE fire beat — one shot every two seconds, and what the bow keeps.
  // Was 1000 — halving the cadence makes each shot a visible event instead of
  // a stream; shotDamage scales per-shot damage by the interval, so the
  // delivered rate is cadence-independent.
  //
  // A slot may fire on its own beat (SHOT[slot].fireIntervalMs, read through
  // fireIntervalMs() below). The STAFF fires on its own slower beat — a bolt
  // every 5 s (STAFF_BEAT_MUL × the bow's 2 s) — and because shotDamage prices a shot at its own
  // slot's interval, that is PACING and not a nerf: a staff bolt simply
  // carries its whole beat's worth of damage and the dps identity above still
  // holds. Never halve a cadence without letting shotDamage see it, or the
  // weapon quietly loses half its damage.
  const FIRE_INTERVAL_MS = 2000;
  const STAFF_BEAT_MUL = 2.5;   // a bolt every 5 s
  const RANGED_SLOTS = ['bow', 'staff', 'musket'];
  // Per-slot shot geometry. (A `phaseMs` once staggered the staff half a beat
  // off the bow; only one ranged slot can ever be the active weapon now, so it
  // was 0 for both and the field is gone — app.js arms a newly active weapon
  // to fire on the next pass.) Ranges/speeds
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
  //           on affording it — and delivers 4/15 of an arrow's damage
  //           PER SECOND (SHOT_DMG_MUL below): what it has is the pierce and
  //           the seeking, not the punch. It arrives on a 5 s beat (fireIntervalMs); between bolts app.js
  //           shows the next one charging by the player's hand; and it
  //           drifts slowly (1 cell/s, under a quarter of the arrow's).
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
  // And they differ in RANGE, which for a player's weapon is not a flat number.
  // `rangeFromReach` says the slot's range IS the player's own reach (the
  // vision ring) plus this many cells, resolved per shot against the LIVE
  // reach (rangeCellsFor below), so it shrinks as the dark takes the reach
  // back underground and grows with the Inner Light upgrades. The ARROW flies
  // one cell past the ring; MAGIC goes to the ring itself and no further. The
  // flat `rangeCells` is the fallback for a caller with no scene to ask (the
  // castle turrets have no reach and keep the bow's flat 8; the staff's flat
  // value is its reach at a new save's 2.5).
  // RANGED WEAPONS WAKE ONLY FOR A CLOSE FOE (owner's call, Sep 2026): the
  // bow and the staff fire only while a hostile stands within the player's
  // reach plus this many cells — the same "one past the ring" the staff's
  // range is built from. A foe further off on screen no longer draws fire.
  const RANGED_TRIGGER_PAST_REACH = 1;
  function rangedTriggerM(reachCells, cellM) {
    return ((reachCells ?? 2.5) + RANGED_TRIGGER_PAST_REACH) * cellM;
  }
  function anyEnemyWithin(x, y, enemies, maxM) {
    const m2 = maxM * maxM;
    for (const e of enemies || []) {
      if (isConcealed(e)) continue;
      const dx = e.x - x, dy = e.y - y;
      if (dx * dx + dy * dy <= m2) return true;
    }
    return false;
  }
  const BOW_SHOT = { speedCps: 4.5, rangeCells: 8, rangeFromReach: RANGED_TRIGGER_PAST_REACH,
    color: 0xffe6a8, lenPx: 9, widthPx: 2, aim: 'compass', fireIntervalMs: FIRE_INTERVAL_MS,
    ammo: { id: 'wood', shots: 20 } };
  const SHOT = {
    // `ammo`: the bow burns one WOOD per `shots` arrows, and will not fire
    // with none in the bag (app.js _combatTick). Energy is the staff's price;
    // wood is the bow's.
    bow: BOW_SHOT,
    musket: { ...BOW_SHOT,
              color: 0x555961, dotPx: 3, projectile: 'musket_ball', damageTier: 4,
              ammo: { id: 'coin', shots: 1, currency: true } },
    staff: { speedCps: 1.0, rangeCells: 2.5, rangeFromReach: 0,
             color: 0x9ad6ff, dotPx: 3,
             pierce: true, energyCost: 1, aim: 'nearest',
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
  // Damage weight per slot. The staff's is set so a WOOD bolt is 5 damage
  // every 5 s (1 HP/s): the wood rung's melee rate is 15000/4000 = 3.75 HP/s,
  // and 3.75 × 4/15 = 1. Higher tiers scale off their own rung the same way
  // (a Frost bolt: 50 HP/s × 4/15 × 5 s ≈ 67). Pinned in combat.test.js.
  const SHOT_DMG_MUL = { bow: 1, staff: 4 / 15 };
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
  // How BRIGHT a bolt burns at `tier`, 0..1: BOLT_MIN_GLOW at Wood up to full
  // at Frost, linear, on the same tier ramp as boltScale. A multiplier on the
  // bolt's glow (app.js _drawBolt / _drawStaffCharge) and on the light it
  // throws (lighting.js collectBolts) — a look, never a hit: damage and the
  // sweep stay boltScale's and shotDamage's. Its TINT is the staff's material
  // colour (items.js MATERIAL_TIERS, stamped by app.js like the bow's), so a
  // bolt shows its tier twice over: bigger and brighter, and in its metal.
  const BOLT_MIN_GLOW = 0.55;
  function boltGlow(slot, tier) {
    const spec = SHOT[slot];
    if (!spec || !spec.growsWithTier) return 1;
    const t = clamp(Math.floor(Number(tier) || 1), 1, MAX_TIER);
    return BOLT_MIN_GLOW + ((t - 1) / (MAX_TIER - 1)) * (1 - BOLT_MIN_GLOW);
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
  // lands 4/15 of it: 5 damage a 5 s bolt at Wood). No split across ranged slots:
  // only one weapon ever fires (save.activeWeapon, app.js), so a bow alone
  // delivers its tier's FULL melee rate — same as a sword of that tier — and
  // a staff alone lands 4/15 of that. The interval cancels out of the
  // delivered per-second rate entirely; it only paces how chunky each hit
  // looks. An empty slot fires nothing at all.
  //
  // The floor of 1 is what keeps a wooden weapon firing at all once the
  // rounding is through; it only ever binds on rungs whose full rate is
  // already under two per second.
  //
  // `playerClass` (optional — save.playerClass, src/wizard.js CLASSES): a
  // HUNTER's BOW shots carry HUNTER_BOW_MUL of the rate. A CLASS BONUS the
  // player bought at the wizard tower, not a fudge factor: it scales the
  // player's own arrows only, applied to the rate before rounding so the
  // floor of 1 still means what it says. The staff is not a bow, and
  // turretShotDamage passes no class — a turret is nobody's hunter.
  const HUNTER_BOW_MUL = 1.5;
  function shotDamage(relics, slot, playerClass) {
    if (!relics || !relics[slot]) return 0;
    const classMul = ((slot === 'bow' || slot === 'musket') && playerClass === 'hunter') ? HUNTER_BOW_MUL : 1;
    const damageRelics = SHOT[slot]?.damageTier ? { [slot]: { tier: SHOT[slot].damageTier } } : relics;
    const perSecond = dpsForDurationMs(toolDurationMs(damageRelics, slot)) * (SHOT_DMG_MUL[slot] || 1) * classMul;
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
      if (isConcealed(e)) continue;
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
  // `rangeCellsOverride` flies the shot a range of its own (the turret's).
  function spawnShot(slot, x, y, dir, cellM, dmg, tier, reachCells, rangeCellsOverride) {
    const mag = Math.hypot(dir?.x || 0, dir?.y || 0);
    if (!(mag > 0)) return null;
    const spec = SHOT[slot];
    return {
      slot, x, y,
      ...(spec.projectile ? { projectile: spec.projectile } : {}),
      vx: dir.x / mag, vy: dir.y / mag,
      speedMps: spec.speedCps * cellM,
      rangeM: (rangeCellsOverride ?? rangeCellsFor(slot, reachCells)) * cellM,
      travelledM: 0,
      damage: dmg,
      pierce: !!spec.pierce,
      radiusM: shotRadiusM(slot, tier, cellM),
      dotPx: shotDotPx(slot, tier),
      tier: tier || 1,
    };
  }

  // Scrolls use the spear's facing and range, with an impact blast instead
  // of a single hit. All tuning comes from the consumable's owning row.
  function spawnFireball(x, y, dir, cellM, spec) {
    const shot = spawnShot('bow', x, y, dir, cellM, spec.damage);
    if (!shot) return null;
    shot.projectile = 'fireball';
    shot.radiusM = spec.projectileRadiusCells * cellM;
    shot.blastRadiusM = spec.blastRadiusCells * cellM;
    shot.dotPx = spec.dotPx;
    shot.color = 0xff742d;
    return shot;
  }

  // A thrown flask bursts on the first foe or at the vision boundary. It
  // clears terrain; the scene ignites the square footprint on impact.
  function spawnExplosiveFlask(x, y, dir, cellM, rangeM, spec) {
    if (!(rangeM > 0) || !Number.isFinite(rangeM)) return null;
    const shot = spawnShot('bow', x, y, dir, cellM, spec.damage);
    if (!shot) return null;
    Object.assign(shot, {
      projectile: 'explosive_flask', rangeM, impactOnly: true,
      blastRadiusM: 0, radiusM: spec.projectileRadiusCells * cellM,
      dotPx: spec.dotPx, color: 0xffa32d,
    });
    return shot;
  }

  // Find the first contact along the whole frame's flight, including a
  // grazing contact between sample points. Only that foe takes impact damage.
  function stepImpactShot(s, dt, targets, onHit, opts) {
    const travel = Math.min(s.speedMps * dt, Math.max(0, s.rangeM - s.travelledM));
    let contact = null, distance = travel;
    for (const e of targets) {
      if (isConcealed(e)) continue;
      if (opts?.canHit && !opts.canHit(e, s)) continue;
      const dx = e.x - s.x, dy = e.y - s.y;
      const along = dx * s.vx + dy * s.vy;
      const across = dx * s.vy - dy * s.vx;
      const chordSquared = s.radiusM * s.radiusM - across * across;
      if (chordSquared < 0) continue;
      const halfChord = Math.sqrt(chordSquared);
      if (along + halfChord < 0) continue;
      const entry = Math.max(0, along - halfChord);
      if (entry > distance || (contact && entry === distance)) continue;
      contact = e;
      distance = entry;
    }
    s.x += s.vx * distance; s.y += s.vy * distance;
    s.travelledM += distance;
    if (contact) onHit(contact, s);
    if (contact || s.travelledM >= s.rangeM - 1e-8) {
      opts?.onExplode?.(s);
      return false;
    }
    return true;
  }

  function explodeShot(s, targets, onHit, opts, cellM) {
    const blocked = opts?.blocked && ((x, y) => opts.blocked(x, y, s));
    const struck = new Set();
    for (const e of targets) {
      if (isConcealed(e)) continue;
      if (!(s.damage > 0)) break;
      if (opts?.canHit && !opts.canHit(e, s)) continue;
      const key = e.id != null ? e.id : e;
      if (struck.has(key) || Math.hypot(e.x - s.x, e.y - s.y) > s.blastRadiusM) continue;
      if (!lineOfFire(s.x, s.y, e.x, e.y, blocked, cellM)) continue;
      struck.add(key);
      onHit(e, s);
    }
    opts?.onExplode?.(s);
  }

  // Sweep fireballs at sub-cell intervals, even after a long frame. Clamp
  // to their remaining range so a missed cast bursts at a stable distance.
  function stepExplosiveShot(s, dt, targets, onHit, opts, cellM) {
    const travel = Math.min(s.speedMps * dt, Math.max(0, s.rangeM - s.travelledM));
    const sampleM = Math.max(0.01, Math.min(cellM * BLOCK_SAMPLE_CELLS, s.radiusM));
    const samples = Math.max(1, Math.ceil(travel / sampleM));
    const step = travel / samples;
    const ignite = s.projectile === 'fireball' ? opts?.onFireCell : null;
    ignite?.(s.x, s.y, s);
    for (let i = 0; i < samples; i++) {
      const x = s.x + s.vx * step, y = s.y + s.vy * step;
      if (opts?.blocked?.(x, y, s)) {
        explodeShot(s, targets, onHit, opts, cellM);
        return false;
      }
      if (s.projectile === 'fireball') opts?.onFireSegment?.(s.x, s.y, x, y, s);
      s.x = x; s.y = y; s.travelledM += step;
      ignite?.(s.x, s.y, s);
      if (targets.some(e => !isConcealed(e) && (!opts?.canHit || opts.canHit(e, s))
          && Math.hypot(e.x - x, e.y - y) <= s.radiusM)) {
        explodeShot(s, targets, onHit, opts, cellM);
        return false;
      }
    }
    if (s.travelledM >= s.rangeM - 1e-8) {
      explodeShot(s, targets, onHit, opts, cellM);
      return false;
    }
    return true;
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
  // `opts.blocked(x, y, shot)` — optional world test for solid ground, in world
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
  // `opts.onFireCell(x, y, shot)` ignites fireball trail samples in world
  // metres, including the launch and final positions. The scene resolves
  // its tile grid and deduplicates cells already burned.
  // `opts.onFireSegment(x0, y0, x1, y1, shot)` supplies each accepted sweep
  // for exact grid traversal, including brief crossings at cell corners.
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
    const canHit = opts && opts.canHit;
    const sampleM = Math.max(0.01,
      ((opts && opts.cellM) || hitRadiusM) * BLOCK_SAMPLE_CELLS);
    for (const s of shots) {
      const targets = s.potionId ? (opts?.potionTargets || enemies) : s.hostile ? hostileTargets : enemies;
      if (s.blastRadiusM > 0 || s.impactOnly) {
        // Blasts can reach beyond the viewport used to choose auto-attack
        // targets. The caller supplies nearby hostiles across that boundary.
        const blastTargets = !s.hostile && opts?.explosiveTargets ? opts.explosiveTargets : targets;
        const flying = s.impactOnly
          ? stepImpactShot(s, dt, blastTargets, onHit, opts)
          : stepExplosiveShot(s, dt, blastTargets, onHit, opts, opts?.cellM || hitRadiusM);
        if (flying) alive.push(s);
        continue;
      }
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
          if (!blocked(s.x + s.vx * t, s.y + s.vy * t, s)) continue;
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
          if (isConcealed(e)) continue;
          if (canHit && !canHit(e, s)) continue;
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
          if (isConcealed(e)) continue;
          if (canHit && !canHit(e, s)) continue;
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
  // WOOD-TIER BOW ARROW at the nearest foe inside TURRET.rangeCells (3 cells,
  // owner's call Sep 2026 — the walls guard their own ground, not the street
  // beyond; the arrow flies that far and no further) — at ONE
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
    rangeCells: 3,
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
    const heading = aimAtNearest(x, y, enemies, TURRET.rangeCells * cellM);
    if (!heading) return null;
    const shot = spawnShot(TURRET.slot, x, y, heading, cellM, turretShotDamage(), TURRET.tier, null, TURRET.rangeCells);
    if (!shot) return null;
    shot.source = 'turret';   // not the player's: see isPlayerKill
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
      shot.castle = t.castle;
      shots.push(shot);
    }
    return shots;
  }

  // ── Monster arrows ───────────────────────────────────────────────────────
  // A RANGED monster (MONSTERS[kind].range > 1 — the goblin archer and its
  // giant) attacks with a visible arrow, not the silent energy leech the
  // melee kinds land: scene_creatures.js (wanderCreatures) looses one at the player
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
    MONSTERS,
    registerMonsters, monster, isMonster, monsterHits, monsterLays, spawnsUnderground, GHOST_SPEED_MPS, GHOST_TOUCH_DMG, LAVA_DMG_PER_S, retreatMul, sightCells, seesPlayer, SLIME_SIGHT_CELLS, FAUNA_HP, creatureMaxHp,
    SUMMONED_AS, summonedAs, PET_BITE, enemyBlow, petBite, petBlow,
    ENEMY_COIN_PER_HP, ENEMY_DEPTH_BONUS, enemyBounty,
    PLAYER_KILL_SOURCES, isPlayerKill, shotSource,
    MONSTER_TREASURE_CHANCE, ELITE_TREASURE_CONTEXT, eliteRollBonus,
    FAUNA_BLOCKED_TYPES, faunaBlocksCell,
    FLOWER_STATUS_MS, isSleeping, isCharmed, isBurrowed, isDisguised, isConcealed, applySleep, applyCharm,
    STATUS_FLASH_MS, STATUS_LOOKS, statusLook, flagStatus, statusFlashTint, isPsychotic, applyPsychosis,
    isEnemyKind, isEnemy, enemyKinds, onQuestBoard, enemyName, hp, damage, damageDealt, hpFraction,
    canBurn, burning, ignite, burnTick, poisoned, poison, poisonTick,
    ELITE_MUL, isElite, eliteMul, SHINY_SPEED_MUL, shinyMul, shinySpeedMul, ghostSizeMul, RAISED_MUL, raisedMul, powerMul, maxHp,
    TRAINING_KINDS, TRAINING_ORDER, TRAINING_PERM_MAX, TRAINING_BUFF_MS, TRAINING_SLOT_KIND,
    trainingLevel, trainingDrillUntil, trainingBuffActive, trainingBonus, trainingIntervalMul, playerAttackIntervalMul,
    dpsForDurationMs, meleeDps, MELEE_INTERVAL_MS, meleeSwingDamage, shotDamage,
    HUNTER_BOW_MUL, ENFORCER_MELEE_DPS,
    MITIGATION_ROUNDS, MIN_PLAYER_DAMAGE, mitigate, playerDamage, playerDamageRate, playerDamageMultiplier, incomingDamage, incomingProjectileDamage, projectileReduction, playerDowned,
    theftKind, THEFT_COINS, theftAmount, theftFood, theftDay, theftSated, incomingTheft, bankTheft,
    MELEE_REACH_CELLS, MELEE_WEAPONS, meleeIntervalMs, meleeReachM, inMeleeReach,
    FIRE_INTERVAL_MS, STAFF_BEAT_MUL, fireIntervalMs,
    RANGED_SLOTS, RANGED_TRIGGER_PAST_REACH, rangedTriggerM, anyEnemyWithin, SHOT, SHOT_DMG_MUL, HIT_RADIUS_CELLS, rangeCellsFor,
    OFF_GPS_ATTACK_MUL, OFF_GPS_MIN_CELLS,
    MAX_TIER, BOLT_MAX_TIER_MUL, boltScale, BOLT_MIN_GLOW, boltGlow, shotRadiusM, shotDotPx,
    aimAtNearest, shotHeading, spawnShot, spawnFireball, spawnExplosiveFlask, stepShots, lineOfFire, healthColor,
    TURRET, TURRET_RATE_DIV, turretShotDamage, turretPhaseMs, turretShot, turretTick,
    MONSTER_SHOT_INTERVAL_MS, HOSTILE_ARROW_COLOR, monsterShot,
  };
  root.Combat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
