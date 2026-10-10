// ─────────────────────────────────────────────────────────────────────────
// Lairs — the monsters nesting in a derelict structure, in EVERY mode.
//
// A ruin you walk past is scenery. A ruin with something living in it is a
// decision: go around, or go in for what the building is worth. In both
// modes (Difficulty.get().derelictLairs) an unclaimed structure may hold a small
// garrison, and BOTH what is in it and how many there are come off two facts
// about THE BUILDING and no others — so every player meets the same garrison
// in the same ruin:
//
//   HOW BIG THE BUILDING IS — a castle is worth more guards than a fort, a
//   fort more than a house. The tiers are the world's own building tiers
//   (T.BUILDING 9 / BUILDING_MED 11 / BUILDING_LARGE 12), so "bigger" is the
//   same judgement the map already draws. The tier also picks WHAT is in
//   there: a wrecked house is INFESTED by slimes, a fort or a castle is HELD
//   by goblins — see KIND_ORDER.
//
//   ITS OWN STRENGTH — a world-fixed value `t` in [0, 1] drawn from the
//   structure's own stream (garrisonFor). t = 0 is the named figures, t = 1
//   a castle holding LAIR_MAX_PER_STRUCTURE; the same t picks the rung of the
//   kind ladder; it is never distance from the player's HOME, which would make
//   a ruin's garrison depend on where each player started.
//
//   HOME NEVER WEAKENS A GUARD. A ruin by the trailer is held exactly as it is
//   for everyone else; the only thing Home does, for its own player, is HIDE a
//   guard too strong for the SAFE AREA (EnemySpawns.homeAllows — the same
//   distance bands as every surface foe), after this module has generated it.
//   The map still gets more
//   dangerous the further you push, which is the only pressure a GPS game can
//   apply: it cannot gate an area behind a key, so it prices the walk instead.
//
// THE NUMBERS ARE DERIVED, NOT TUNED — the same discipline as combat.js's
// dps identity. There are exactly three authored figures (TIER_GUARDS: a
// house 1, a fort 2, a castle 3, at t = 0) plus the ceiling, and the strength
// multiplier falls out of them: FAR_MUL is the ceiling over the biggest base,
// so a castle reaches exactly LAIR_MAX_PER_STRUCTURE at t = 1 and the other
// two tiers scale by the same factor (a fort 2 → 7, a house 1 → 3). Retune a lair by moving a TIER_GUARDS row or the
// ceiling; a fudge factor added here breaks the correspondence the tests pin.
//
// THEY HOLD, THEY HUNT, THEY GIVE UP. A garrison is a place, not a patrol:
// each guard carries `immobile: true`, meaning it does not WANDER, and
// scene_creatures.js's wanderCreatures routes it through `guardState` instead. At rest it
// stands on its seat, so the ruin reads as held from across the street — a
// garrison that wandered would walk itself off the building within a minute
// and the whole point, that THIS ruin is held, would be gone before the player
// got close enough to see it. Come near and the whole garrison comes at you at
// once; get clear and it walks back. Both rings are measured from the RUIN, so
// the chase is bounded and the ruin is still held for whoever comes at it
// next. See LAIR_AGGRO_CELLS.
//
// ── WHY THE GARRISON IS WOKEN, NOT SPAWNED ───────────────────────────────
//
// Every tier-9 house is a wreck until the player rebuilds it (app.js
// `_isHouseWreck`), so "derelict structure" is very nearly "building", and a
// dense city tile carries thousands of them. Materialising a garrison for all
// of them at tile-build time is tens of thousands of creature objects on one
// tile — memory, and a per-frame `forEachItemNear` walk over every one of them.
// The first cut of this module answered that with a per-tile budget, which
// bought the frame rate at the price of most ruins simply being empty.
//
// The answer instead is RESIDENCY. Nothing is materialised at build time: a
// tile keeps only an INDEX of its eligible structures (`buildIndex`, one small
// record per footprint, bucketed on a coarse grid), and `stepResidency` — run
// on a throttle from update() — wakes the garrisons of structures within
// LAIR_WAKE_CELLS of the player and puts back to sleep the ones past
// LAIR_SLEEP_CELLS. Live creatures then track what is actually AROUND the
// player rather than what a tile happens to contain, so a city block and a
// hamlet cost the same to stand in.
//
// The wake ring clears every other radius that matters, which is what makes
// the seam invisible: it is outside the sim bubble (a guard is resident well
// before wanderCreatures will think for it), outside the sprite cull (before
// it can be drawn), and outside bow range (before it can be shot). The gap
// between wake and sleep is hysteresis — one ring would thrash a garrison on
// and off while the player stood on it.
//
// ── GENERATED, NEVER STORED — and now PER STRUCTURE ──────────────────────
//
// The traps.js contract: a lair is a pure function of the world, and the only
// thing that ever reaches the save is the id of a guard the player has killed
// (save.caught, through the ordinary resolveDefeat path — a lair guard is an
// enemy like any other and pays its bounty).
//
// Residency sharpens that from per-TILE to per-STRUCTURE. A garrison is seeded
// from its own building's identity — `structureKey`, the tile plus the
// footprint centre's cell on THAT TILE'S OWN grid (tileEdgeM /
// entry.cellsPerEdge) — so it depends on nothing but the building itself.
// Never an absolute cell off world metres: those metres are in each save's
// own frame (tx * tileEdgeM, with tileEdgeM from the player's start
// latitude), so the same ruin would carry a different key — and a different
// garrison — for every player. That is what
// makes waking safe, and it retires a whole class of hazard the per-tile stream
// had: the draw no longer depends on the ORDER the polygons come in (a rebuild
// that adds an Overpass building would have shifted every index after it), on
// how many guards a neighbouring ruin happened to seat, or on which of them the
// player had already killed. Wake a ruin at any time, in any order, from any
// tile build, and it holds exactly what it held before.
//
// Node-testable: no DOM, no Phaser. WorldGen is read for makeRng / isSpawnCell
// (the shared spawn rule — see the road-mask invariant in CLAUDE.md), and a
// test can hand in a stub.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  // The most guards any one structure may hold, at t = 1.
  const LAIR_MAX_PER_STRUCTURE = 10;

  // ── The three authored figures ───────────────────────────────────────────
  // Guards at t = 0, by the world's own building tier. Everything else in
  // this module is derived from these four numbers.
  const TIER_GUARDS = {
    9:  1,   // T.BUILDING       — a wrecked house
    11: 2,   // T.BUILDING_MED   — a fort
    12: 3,   // T.BUILDING_LARGE — a castle
  };
  const TIERS = [9, 11, 12];
  const MAX_TIER_GUARDS = Math.max(...Object.values(TIER_GUARDS));
  // ── STREET STRUCTURES — a new REASON for a lair, not a new lane ─────────
  // A CAFÉ HOARD (StreetVariants.dress — the buried hoard beside a coffee
  // shop) is held the way a ruin is. It is a candidate in the same index,
  // woken by the same residency pass, seeded from its own key and seated by
  // the same foe rule — only its row differs:
  //   · ONE guard, whatever the strength (FIXED_GUARD_TIERS: capFor does
  //     not scale it — a hoard with five giants is a fort);
  //   · ALWAYS held (OCCUPANCY rate 1, never thinned — the dressing only
  //     hands in a guarded hoard);
  //   · held in EVERY mode (ALWAYS_AWAKE_TIERS), whatever stepResidency's
  //     `buildings` option says: these are the street's own.
  // They are NOT buildings: no footprint, no claim key, no part of the tile
  // budget (tileThin reads building shapes only). Street tiers are strings so
  // no terrain code can collide with them.
  // A BARRICADE (StreetVariants.dress, one per barricade on a barricade
  // road) and a BURNED ROW's stretch (one per (street key, stretch square) —
  // StreetVariants.BANDIT_STRETCH_UNITS) are the same reason again: one guard
  // each, always held, every mode. (There is no 'wagon' tier: a bus stop is on
  // the kerb by definition.)
  const STREET_TIER_GUARDS = { cafe: 1, barricade: 1, burned: 1, street_hedgerow: 2, street_overgrown: 1, street_orchard: 1, street_toadstool: 1 };
  Object.assign(TIER_GUARDS, STREET_TIER_GUARDS);
  // ── A TAR YARD — the same reason again (src/zones.js): the fire slimes at
  // a fuel station's pumps, seated about its chest. Fixed and always held
  // like a barricade, with the same fixed count in every mode.
  const ZONE_TIER_GUARDS = { tar: 2 };
  Object.assign(TIER_GUARDS, ZONE_TIER_GUARDS);
  // ── A GATE — the same reason again (Sep 2026): an OSM barrier=gate is no
  // chest any more but a SPAWN POINT marked by two posts (worldgen.js
  // gatePostsAt; spawnInTile hands the candidate in). ONE guard, fixed and
  // always held like a barricade, woken in EVERY mode — and it RE-RISES: the one
  // DAILY tier (DAILY_TIERS). Its guard's id carries the UTC day
  // (`lair_<sid>_<dayKey>_<i>`, garrisonFor), so killing it spends only
  // today's in save.caught and tomorrow's rises in the same seat; yesterday's
  // ids are pruned from save.caught (scene_creatures.js). WHO rises is the
  // gate's own strength `t` on its ladder (a slime or a goblin) — the world's,
  // the same for every player; the mode scales its blow like every foe's
  // (Combat.playerDamage's incomingDamageMul), not its count.
  const GATE_TIER_GUARDS = { gate: 1 };
  Object.assign(TIER_GUARDS, GATE_TIER_GUARDS);
  const DAILY_TIERS = new Set(Object.keys(GATE_TIER_GUARDS));
  // ── A HABITAT SITE — the same reason again (Oct 2026): a wetland's HUNGRY
  // MARSH and a rock outcrop's ORC STRONGHOLD (enemy_habitats.js
  // habitatLairs — one owner per sub-tile block) used to be a fourth seater
  // outside this file, with no guard cap, no kerb-aware seat and no quiet
  // home. Each is a lair candidate now (entry.streetLairs, the barricade's
  // lane) whose garrison is its own GROUPS row (marsh / stronghold — a tier
  // that is a group's alone always takes it, TIER_GROUP), so it shares the
  // whole garrison lifecycle: the wake ring, the mode's guard cap, the seat
  // rule, the quiet home and the safe area. Two guards, always held, every mode.
  const HABITAT_TIER_GUARDS = { habitat_marsh: 2, habitat_stronghold: 2 };
  Object.assign(TIER_GUARDS, HABITAT_TIER_GUARDS);
  const FIXED_GUARD_TIERS = new Set([...Object.keys(STREET_TIER_GUARDS), ...Object.keys(ZONE_TIER_GUARDS), ...DAILY_TIERS, ...Object.keys(HABITAT_TIER_GUARDS)]);
  const ALWAYS_AWAKE_TIERS = new Set([...Object.keys(STREET_TIER_GUARDS), ...Object.keys(ZONE_TIER_GUARDS), ...DAILY_TIERS, ...Object.keys(HABITAT_TIER_GUARDS)]);
  // The strength multiplier — NOT a tuned number. It is exactly what carries
  // the biggest structure from its t = 0 figure to the ceiling, so the ceiling
  // and the tier table are the only things to change.
  const FAR_MUL = LAIR_MAX_PER_STRUCTURE / MAX_TIER_GUARDS;

  // ── The roll ─────────────────────────────────────────────────────────────
  // The cap is the nominal garrison; the actual count is the cap less a
  // seeded shortfall of up to this fraction of it, so a lair is a surprise
  // rather than an arithmetic exercise the player can do from the map. Note
  // what the fraction does to the small end: a house (cap 1) and a fort
  // (cap 2) floor to no slack at all and always hold exactly their figure,
  // while a castle (cap 3) holds 2 or 3 and a maxed castle (cap 10) holds
  // 6 to 10. The named numbers are the typical ones, which is what "a castle
  // typically has 3" has to mean.
  const LAIR_SLACK = 0.4;

  // ── What is in it ────────────────────────────────────────────────────────
  // TWO AXES, one each. The BUILDING TIER picks the FAMILY, and the
  // structure's own strength `t` picks the rung within it — the same two
  // facts the count is already made of, saying a second thing.
  //
  //   A WRECKED HOUSE IS INFESTED. Nobody holds it; slimes are nesting in
  //   the damp — the SURFACE slime and nothing else (the cave keeps its own
  //   kinds), so a wreck's escalation is its COUNT (countFor), not its kind.
  //
  //   A FORT OR A CASTLE IS HELD. A fortification with nobody in it is not
  //   derelict, it is empty — so what holds a ruined keep is a GARRISON: a
  //   fort's is goblins, and a castle's is its old dead (skeletons), so the
  //   two fortifications never field the same foes (owner's call, Sep 2026).
  //   The giant skeleton is tinted aged-bone amber (its roster `tint`) so
  //   the castle's two rungs are not the same pixels. Crossing into goblins is the
  //   line the slimes-all-the-way ladder was drawn to avoid ("a goblin on the
  //   surface is a different decision about where the cave ends"), and the
  //   tier is what makes it safe to cross: a goblin is not loose in the
  //   fields, it is inside a fort, which is exactly where a player expects to
  //   meet one. Every wreck on the map is still slimes.
  //
  // THE RUNGS ARE EVENLY SPACED, not authored. A ladder is just its kinds in
  // order, weakest first, and rung `i` of `n` unlocks at `i / n` of `t` —
  // which gives the slime ladder its thirds
  // (0, 0.34, 0.67) — and the two-rung garrison ladders (goblin, archer;
  // skeleton, giant skeleton) take halves for free.
  // Adding a kind re-spaces its own ladder and nothing else.
  //
  // Every kind here must be a registered enemy (Combat.isEnemyKind) or the
  // guards would be scenery that cannot be fought: `slime` is the surface pest
  // and the rest are rows of combat.js's MONSTERS table. And no two kinds on ONE
  // ladder may be drawn the same — see the tint rule in sprite_layout.js; a
  // rung the player cannot see is not an escalation.
  const KIND_ORDER = {
    9:  ['slime'],                                 // T.BUILDING       — infested (surface kind only)
    11: ['goblin', 'goblin_archer'],               // T.BUILDING_MED   — held by goblins
    12: ['skeleton', 'skeleton_soldier'],            // T.BUILDING_LARGE — held by the dead
    // A café hoard: its guard is one of the approved surface T3 GIANTS
    // (EnemyRoster rows, variantType 'Giant', not eliteEligible — size never
    // stacks with Elite), never a shiny: a shiny's kill pays the relic-biased
    // elite roll and every café would flood the map with gear. (The old
    // 'close' tier's ladder; there is no 'wagon' tier — the safety pass.)
    cafe: ['skeleton_soldier', 'orc'],
    // A tar yard: fire slimes (the enemy_roster.js fire_slime row).
    tar: ['fire_slime'],
    // A barricade: the goblin who holds it.
    barricade: ['spear_goblin', 'archer_goblin'],
    street_hedgerow: ['slime'],
    street_overgrown: ['plant'],
    street_orchard: ['farmer_goblin'],
    street_toadstool: ['spider'],
    // A burned row's stretch: one fire slime in the tar (the fire slimes are
    // zone-seated, never a tile's wild spawn, so the burned row seats its own
    // here rather than relocating any).
    burned: ['fire_slime'],
    // A gate: the surface pest or the goblin who holds the way — half each,
    // off the gate's own strength.
    gate: ['slime', 'goblin'],
    // The habitat sites: their GROUPS rows seat these (the ladder is the
    // plain roll's, which a group tier never takes).
    habitat_marsh: ['plant', 'slime'],
    habitat_stronghold: ['orc', 'orc_shaman'],
  };
  const KIND_LADDER = {};
  for (const [tier, kinds] of Object.entries(KIND_ORDER)) {
    KIND_LADDER[tier] = kinds.map((kind, i) => ({ kind, minT: i / kinds.length }));
  }

  // ── GUARD GROUPS — an AUTHORED garrison in place of the plain roll ───────
  // (owner, Oct 2026: "more interesting guard groups"). The plain garrison is
  // a count off the tier's ladder; a GROUP is a composition — who stands
  // where, and what each one is told about the player — so a ruin can be a
  // horde, an ambush, a firing line or one monster worth the walk. Whether a
  // held structure takes a group, and which, is ONE draw of its own stream
  // (groupFor), after "held at all?" and its strength and before the count,
  // so it is the world's like everything else here: the same ruin is the
  // same ambush for every player. A row's explicit `chance` reserves that
  // share of held structures first; GROUP_RATE applies to the remaining
  // ticket for ordinary rows, and the rest roll the plain garrison.
  //
  // A GROUP IS A HOUSE'S OR A CASTLE'S, never both and never a fort's
  // (owner): most wrecked-house groups are one or two; occasional grunt
  // gangs contain three to eight — and sit round the walls as a wreck's slimes do; a castle's are
  // the big ones and start INSIDE THE KEEP like every castle garrison
  // (CORE_SEATED_TIERS: walking past is safe, walking in is the fight).
  //
  // A ROW: `tiers` (the one building tier that holds it), `minT` (the
  // strength below which it is not offered — a horde or an elite is a strong
  // ruin's), `coastal` (only a structure by the shore — the gulls), and
  // `members` in ORDER (easy wakes only the first lairGuardMax of a garrison,
  // so what matters most comes first: the decoy before its orcs, the elite
  // before its minions). `modeCap: false` preserves an authored full group
  // in both modes. A member: its `kind` (a registered enemy), `n` or inclusive
  // `nRange` (one seeded count draw), its
  // `place` (seatPolar — where in the formation), and what it is told:
  //   `aggroCells`      its own notice ring past the ruin's knot (guardState;
  //                     the decoy sees you from six cells, the orcs at the
  //                     back wall from two — so the one runs out at you and
  //                     the rest come once you are committed);
  //   `proximityCells`  a GHOST's dormancy (creature_ai.js ghostTick — the
  //                     Nexus variants' memorial-guard lane): it hovers on its
  //                     seat until you are this close, then the whole burst
  //                     rushes at once and burns, touches or fades (its
  //                     lifetime starts at the wake, not at the tile load);
  //   `elite`           stamped shiny — Combat.isElite's double pool and
  //                     blow, the elite's drop (the kind must be eliteEligible);
  //   `band`            a ring placement's radius band (× the ring).
  // PLACES (seatPolar): 'ring' round the footprint outside the walls (a
  // wreck's seating); inside the keep: 'core' the tight knot at the centre
  // (an elite), 'floor' anywhere on the floor (a horde), 'front' the inside
  // of the wall at the group's FACING (one draw per group) and 'behind' the
  // inside of the wall opposite; 'cloud' over the ruin, roof included, for a
  // kind that flies. Kinds here that live nowhere else (the runt, the
  // splitting slime, the storm gull) are roster rows with no surface or cave
  // pool: an authored garrison is the only thing that seats them.
  const GROUPS = {
    // ── A wrecked house: small ──
    grunt_gang: { label: 'Goblin grunt gang', tiers: [9], minT: 0, chance: .1, modeCap: false,
      story: 'Three to eight weak goblins crowd around the wreck. Each falls quickly; the gang comes together.',
      members: [{ kind: 'goblin_runt', nRange: [3, 8], place: 'ring' }] },
    splitter: { label: 'Splitting slime', tiers: [9], minT: 0,
      story: 'Strike it and it divides, half its health to each side. Finish a half before it divides again.',
      members: [{ kind: 'split_slime', n: 1, place: 'ring' }] },
    haunting: { label: 'Haunted wreck', tiers: [9], minT: 0,
      story: 'Two ghosts hang over the roof until you are close, then rise together. A torch or the sun burns them out.',
      members: [{ kind: 'ghost', n: 2, place: 'cloud', proximityCells: 4 }] },
    roost: { label: 'Bat roost', tiers: [9], minT: 0,
      story: 'A pair in the rafters: they hang still until the wreck notices you, then both swoop.',
      members: [{ kind: 'bat', n: 2, place: 'cloud' }] },
    // ── A castle: the big ones, inside the keep ──
    horde: { label: 'Goblin horde', tiers: [12], minT: 0.35,
      story: 'Fifteen runts fill the keep: nothing alone, a wall of teeth together.',
      members: [{ kind: 'goblin_runt', n: 15, place: 'floor' }] },
    decoy: { label: 'Decoy and rush', tiers: [12], minT: 0.3,
      story: 'One goblin at the front wall runs out to draw you in. The orcs at the back wall come once you are close.',
      members: [{ kind: 'goblin', n: 1, place: 'front', aggroCells: 6 },
                { kind: 'orc', n: 3, place: 'behind', aggroCells: 2 }] },
    archers: { label: 'Archer line', tiers: [12], minT: 0.2,
      story: 'A firing line along the front wall and nothing to charge: four archers keep their distance and loose together.',
      members: [{ kind: 'archer_goblin', n: 4, place: 'front', spread: 0.5 }] },
    ghosts: { label: 'Ghost burst', tiers: [12], minT: 0,
      story: 'Seven hang over the keep until you are close, then rise together. A torch or the sun burns them out.',
      members: [{ kind: 'ghost', n: 7, place: 'cloud', proximityCells: 4 }] },
    bats: { label: 'Bat swarm', tiers: [12], minT: 0.2,
      story: 'A roost in the towers: they hang still until the castle notices you, then the whole swarm swoops.',
      members: [{ kind: 'bat', n: 10, place: 'cloud' }] },
    elite_orc: { label: 'Elite orc', tiers: [12], minT: 0.5,
      story: 'One strong one, alone in the keep. Twice the pool, twice the blow, and an elite\'s drop.',
      members: [{ kind: 'orc', n: 1, place: 'core', elite: true }] },
    elite_soldier: { label: 'Elite skeleton soldier', tiers: [12], minT: 0.5,
      story: 'The castle\'s last captain, armoured and alone at its heart.',
      members: [{ kind: 'skeleton_soldier', n: 1, place: 'core', elite: true }] },
    warband: { label: 'Elite orc and runts', tiers: [12], minT: 0.5,
      story: 'An elite at the heart of the keep with five runts about the floor. The runts die fast; the orc does not.',
      members: [{ kind: 'orc', n: 1, place: 'core', elite: true },
                { kind: 'goblin_runt', n: 5, place: 'floor' }] },
    honour_guard: { label: 'Elite soldier and skeletons', tiers: [12], minT: 0.5,
      story: 'An elite captain at the heart of the castle and four skeletons about the floor.',
      members: [{ kind: 'skeleton_soldier', n: 1, place: 'core', elite: true },
                { kind: 'skeleton', n: 4, place: 'floor' }] },
    // ── A habitat site (HABITAT_TIER_GUARDS): the group IS the garrison, two
    // to three cells out round the site's point (a point has no footprint,
    // so the ring is the one-cell pad and the band takes it out) ──
    marsh: { label: 'Hungry marsh', tiers: ['habitat_marsh'], minT: 0,
      story: 'A biting plant in the reeds, and the slime that feeds beside it.',
      members: [{ kind: 'plant', n: 1, place: 'ring', band: [2, 3] },
                { kind: 'slime', n: 1, place: 'ring', band: [2, 3] }] },
    stronghold: { label: 'Orc stronghold', tiers: ['habitat_stronghold'], minT: 0,
      story: 'An orc and its shaman hold the bare rock.',
      members: [{ kind: 'orc', n: 1, place: 'ring', band: [2, 3] },
                { kind: 'orc_shaman', n: 1, place: 'ring', band: [2, 3] }] },
  };
  // A tier that is a group's alone (a habitat site's) always takes that
  // group — no draw, so the street tiers' streams are untouched.
  const TIER_GROUP = {};
  for (const [name, g] of Object.entries(GROUPS)) {
    for (const tier of g.tiers) if (typeof tier === 'string') TIER_GROUP[tier] = name;
  }
  // What a garrison member hands its offspring — a necromancer's summons,
  // a splitting slime's halves (creature_ai.js enemySummon / splitSlime):
  // its leash and ruin, its notice ring, its home, and the per-player
  // overlays that hide it (the quiet home, the amnesty, the surface spawn's
  // night rule) — so a hidden summoner never leaves its minions standing.
  const GARRISON_INHERIT = ['castle', 'lair', 'immobile', 'lairX', 'lairY', 'lairR', 'keepHW', 'keepHH', 'aggroCells',
    'homeX', 'homeY', '_surfaceSpawn', 'habitat', 'zoneVariant', '_hunting'];
  // The ordinary-group share after explicit fixed chances are reserved.
  // A castle is where the interesting fight belongs; a wreck is still mostly
  // slimes; a fort takes none.
  const GROUP_RATE = { 9: 0.3, 12: 0.5 };
  const TAU = Math.PI * 2;
  // A member's fixed/tier count or inclusive seeded range. Without an RNG,
  // return the range's minimum for table inspection; runtime/preview pass one.
  function memberCount(m, tier, rng) {
    const n = m.n;
    const count = m.nRange || (n && typeof n === 'object' ? n[tier] || 0 : n || 0);
    return root.CreatureSpawns.frequencyCount({ count }, rng || (() => 0));
  }
  // The groups a structure of `tier` at strength `t` may take, in table order.
  function groupRows(tier, t, coastal) {
    const out = [];
    for (const [name, g] of Object.entries(GROUPS)) {
      if (!g.tiers.includes(tier)) continue;
      if (t < (g.minT || 0)) continue;
      if (g.coastal && !coastal) continue;
      out.push(name);
    }
    return out;
  }
  // ONE draw selects explicit fixed shares first. The remaining ticket is
  // normalized before GROUP_RATE selects among ordinary eligible rows. A tier
  // with no rows still takes the draw so its existing seat stream is stable.
  function groupFor(tier, t, rng, coastal) {
    const rows = groupRows(tier, t, coastal);
    let ticket = rng(), remaining = 1;
    for (const name of rows) {
      const chance = GROUPS[name].chance;
      if (!(chance > 0)) continue;
      if (ticket < chance) return name;
      ticket -= chance; remaining -= chance;
    }
    const rate = GROUP_RATE[tier] || 0;
    const ordinary = rows.filter(name => GROUPS[name].chance == null);
    const r = remaining > 0 ? ticket / remaining : 1;
    if (!(rate > 0) || r >= rate || !ordinary.length) return null;
    return root.CreatureSpawns.pickWeighted(ordinary, r / rate, () => 1);
  }
  // A group laid out as per-guard specs, in member order: each with its
  // index within its member row (idx) and that row's count (of), which is what
  // seatPolar spaces by.
  function expandGroup(name, tier, rng) {
    const g = GROUPS[name];
    if (!g) return [];
    const members = g.members.map(m => ({ ...m,
      n: m.n && typeof m.n === 'object' ? m.n[tier] || 0 : m.n }));
    const expanded = root.CreatureSpawns.expandMembers({ members }, rng || (() => 0));
    const counts = new Map(), indices = new Map();
    for (const m of expanded) counts.set(m.memberIndex, (counts.get(m.memberIndex) || 0) + 1);
    return expanded.map(m => {
      const idx = indices.get(m.memberIndex) || 0, n = counts.get(m.memberIndex);
      indices.set(m.memberIndex, idx + 1);
      return { ...g.members[m.memberIndex], n, group: name, idx, of: n };
    });
  }
  // Where one guard stands, in polar terms about the ruin: the angle, and the
  // radius as a multiple of the BASE the placement names (`base`, one of the
  // four radii a structure has — see seatRadii). Try `a` is the seat attempt
  // (each later try turns a little further round). EXACTLY TWO DRAWS per
  // call whatever the placement, so every placement spends the stream alike.
  // `facing` is the group's one facing draw (front / behind).
  //   `core`: the seat may be a building cell (the keep's own floor);
  //   `over`: it may be a building cell for a kind that flies (the cloud).
  function seatPolar(spec, a, facing, rng) {
    const u = rng(), v = rng();
    const j = u - 0.5, i = spec.idx || 0, n = spec.of || 1;
    switch (spec.place) {
      case 'core':   return { ang: (i / n) * TAU + j * 0.8 + a * 0.7, rMul: Math.sqrt(v), core: true, base: 'core' };
      case 'floor':  return { ang: u * TAU + a * 0.7, rMul: Math.sqrt(v), core: true, base: 'floor' };
      case 'front':  return { ang: facing + (i - (n - 1) / 2) * (spec.spread ?? 0.45) + j * 0.3 + a * 0.5, rMul: 0.7 + v * 0.3, core: true, base: 'floor' };
      case 'behind': return { ang: facing + Math.PI + (i - (n - 1) / 2) * (spec.spread ?? 0.55) + j * 0.3 + a * 0.5, rMul: 0.7 + v * 0.3, core: true, base: 'floor' };
      case 'cloud':  return { ang: u * TAU + a * 0.7, rMul: 0.3 + v * 0.9, over: true, base: 'cloud' };
      default: {
        const band = spec.band || [1, 1.35];
        return { ang: (i / n) * TAU + j * 0.8 + a * 0.7, rMul: band[0] + v * (band[1] - band[0]), base: 'ring' };
      }
    }
  }
  // The four radii a structure of half-extents (halfW, halfH) has, in the
  // units it is measured in (metres in the game, cells on the sheet):
  //   core   the tight knot at the centre (LAIR_CORE_SPREAD_CELLS, never
  //          wider than the footprint) — the plain keep garrison, an elite;
  //   floor  the whole floor: a disc that fits inside the walls;
  //   cloud  just over the walls, for a flier;
  //   ring   outside the walls (LAIR_RING_PAD_CELLS past the corner) — a
  //          wreck's seating.
  function seatRadii(halfW, halfH, cellM) {
    const core = Math.max(0.5 * cellM, Math.min(LAIR_CORE_SPREAD_CELLS * cellM, halfW, halfH));
    const floor = Math.max(0.5 * cellM, Math.min(halfW, halfH) - 0.5 * cellM);
    return { core, floor, cloud: floor + cellM, ring: Math.hypot(halfW, halfH) + LAIR_RING_PAD_CELLS * cellM };
  }
  // Does this kind fly (a cloud seat may be over the roof)? The roster's own
  // movement pattern, read at call time.
  function flies(kind) {
    const p = root.EnemyRoster?.get?.(kind)?.movement?.pattern;
    return p === 'orbit_swoop' || p === 'ghost_glide';
  }
  // Is this structure BY THE SHORE (the gulls' condition)? Any shore-sand cell
  // (scenic.js's mask) within NEAR_SHORE_CELLS of its footprint.
  const NEAR_SHORE_CELLS = 6;
  function nearShore(entry, cand, N, cellM) {
    const mask = entry && entry.scenic && entry.scenic.shore && entry.scenic.shore.mask;
    if (!mask || !(N > 0)) return false;
    const r = Math.ceil(Math.max(cand.halfW || 0, cand.halfH || 0) / cellM) + NEAR_SHORE_CELLS;
    for (let y = Math.max(0, cand.iy - r); y <= Math.min(N - 1, cand.iy + r); y++) {
      for (let x = Math.max(0, cand.ix - r); x <= Math.min(N - 1, cand.ix + r); x++) {
        if (mask[y * N + x]) return true;
      }
    }
    return false;
  }
  // THE PREVIEW'S LAYOUT (tools/guard_groups_sheet.js): a group seated about a
  // square footprint on open ground by the SAME seatPolar and seat tries the
  // game uses, so the design sheet shows the arrangement the player meets.
  // Cells, relative to the footprint centre; halfW/halfH in cells. Ground
  // kinds never land on the footprint unless placed 'core'; a flier may
  // ('cloud'). `seed` picks the stream.
  function groupLayout(name, tier, halfW, halfH, seed) {
    const WG = root.WorldGen;
    const rng = WG ? WG.makeRng(hashKey(`preview_${name}_${tier}_${seed || 0}`)) : Math.random;
    const facing = rng() * TAU;
    const radii = seatRadii(halfW, halfH, 1);
    const out = [];
    for (const spec of expandGroup(name, tier, rng)) {
      let seat = null;
      for (let a = 0; a < LAIR_SEAT_TRIES && !seat; a++) {
        const p = seatPolar(spec, a, facing, rng);
        const r = radii[p.base] * p.rMul;
        const x = Math.cos(p.ang) * r, y = Math.sin(p.ang) * r;
        const onRoof = Math.abs(x) <= halfW && Math.abs(y) <= halfH;
        if (onRoof && !p.core && !(p.over && flies(spec.kind))) continue;
        seat = { x, y };
      }
      if (seat) out.push({ kind: spec.kind, x: seat.x, y: seat.y, place: spec.place, elite: !!spec.elite,
        aggroCells: spec.aggroCells, proximityCells: spec.proximityCells });
    }
    return { facing, coreR: radii.core, ringR: radii.ring, floorR: radii.floor, seats: out };
  }

  // ── Is this ruin held AT ALL? ────────────────────────────────────────────
  // A garrison must be a discovery, not a property of the MAP: looking in a
  // building has to be a gamble, so each one rolls for it — and the odds are
  // the TIER'S, the same axis that decides
  // what is in there and how many:
  //
  //   a CASTLE is nearly always held. It is the landmark version of the whole
  //   mechanic and a player who walks to one has decided to; finding it empty
  //   would be the anticlimax, not the surprise.
  //   a FORT usually is. Rarer on a real map than a house and a fortification
  //   besides, so "probably" reads better than either certainty.
  //   a WRECKED HOUSE is a third of the time. That is the number that makes a
  //   street worth walking down: two you can loot, one you cannot.
  //
  // `thinned` is which of them the per-tile budget below is allowed to touch.
  const OCCUPANCY = {
    9:  { rate: 1 / 3, thinned: true  },   // T.BUILDING       — the commons
    11: { rate: 2 / 3, thinned: false },   // T.BUILDING_MED   — a fort
    12: { rate: 0.95,  thinned: false },   // T.BUILDING_LARGE — a castle
    cafe:  { rate: 1, thinned: false },    // a café hoard
    tar:   { rate: 1, thinned: false },    // a tar yard's pumps
    barricade: { rate: 1, thinned: false },  // a barricade road's barricade
    burned: { rate: 1, thinned: false },   // a burned row's stretch
    street_hedgerow: { rate: 1, thinned: false },
    street_overgrown: { rate: 1, thinned: false },
    street_orchard: { rate: 1, thinned: false },
    street_toadstool: { rate: 1, thinned: false },
    gate:   { rate: 1, thinned: false },   // a gate's posts — held every day
    habitat_marsh: { rate: 1, thinned: false },      // a habitat site — always held
    habitat_stronghold: { rate: 1, thinned: false },
  };

  // Focus adapters expose their authored group references and existing
  // frequency/lifecycle data to the common spawn registry. Strength/count,
  // thinning and seats remain this geometry provider's deterministic stream.
  const FOCUS_RULES = Object.fromEntries(Object.keys(TIER_GUARDS).map(key => {
    const tier = /^\d+$/.test(key) ? Number(key) : key;
    return [key, {
      id: `lair_focus_${key}`, scope: 'focus',
      focus: tier === 9 ? 'house' : TIERS.includes(tier) ? 'building'
        : Object.hasOwn(STREET_TIER_GUARDS, tier) ? 'street'
        : Object.hasOwn(ZONE_TIER_GUARDS, tier) ? 'nexus'
        : Object.hasOwn(HABITAT_TIER_GUARDS, tier) ? 'habitat' : 'gate',
      groups: Object.fromEntries(Object.entries(GROUPS).filter(([, row]) => row.tiers.includes(tier))),
      frequency: { chance: OCCUPANCY[key]?.rate || 0, baseCount: TIER_GUARDS[key],
        groupRate: GROUP_RATE[key] || 0, thinned: !!OCCUPANCY[key]?.thinned },
      lifecycle: { residency: true, ownerOnly: true, daily: DAILY_TIERS.has(tier),
        modeCap: true, alwaysAwake: ALWAYS_AWAKE_TIERS.has(tier) },
    }];
  }));

  // ── The per-tile budget ──────────────────────────────────────────────────
  // A tile is ~1.6 km on a side (~2.5 km² at mid-latitudes) and a dense urban
  // one carries thousands of wrecks, so a flat one-in-three would put over a
  // THOUSAND held ruins on it — a warzone rather than a walk, and a rate the
  // player could no more read as "a third" than they could count them. So the
  // tile gets a ceiling on how many of its ruins are held, and the rates above
  // are scaled to meet it.
  //
  // THE CEILING WINS. It is a hard cap, not a target: whatever the table above
  // says, the expected number of held ruins on a tile is never more than this.
  // The tier rates are what the budget is spent ON, in priority order — they
  // decide who gets the room, not whether the room can be exceeded.
  //
  // TWO REGIMES, and the second is the whole reason there are two factors:
  //
  //   ROOM TO SPARE (every real tile). The rare tiers are paid FIRST and keep
  //   their authored rate, and the WRECKS are thinned by whatever is left.
  //   Scaling every tier equally instead would make a castle in a city 5%
  //   likely to be held, which is the opposite of what the table promises —
  //   and castles and forts are rare by construction, so they can never be the
  //   flood the budget exists for. On a village (100 buildings, ~33 expected)
  //   nothing is thinned and one house in three really is held; on a
  //   3000-building city the wrecks drop to ~8% and the landmarks are
  //   untouched.
  //
  //   OVER BUDGET ON LANDMARKS ALONE (a tile of nothing but castles — not a
  //   thing a real map produces, but the cap has to hold anyway). The wrecks
  //   get nothing, AND the landmarks are scaled back too, so the total still
  //   lands on the ceiling. This is what makes the cap a promise rather than a
  //   hope: there is no composition of buildings that puts more than
  //   LAIR_MAX_PER_TILE expected garrisons on one tile.
  const LAIR_MAX_PER_TILE = 250;

  // The two factors this tile's rates are multiplied by — `common` for the
  // THINNED tiers, `landmark` for the rest. Both are 1 on a tile inside its
  // budget; past it they are exactly what brings the expected count back to
  // LAIR_MAX_PER_TILE, spending the room on the landmarks first (see above).
  // Memoised on the entry — a fact about the tile, asked once per structure
  // that ever wakes.
  //
  //   ONE UNSLICED PASS, on purpose. It reads `tier` off each shape and adds a
  // number; there is no geometry, no allocation and no Map, so a 6000-building
  // tile costs a fraction of a millisecond — nothing like the ~7ms the bbox
  // index below costs, which is why THAT one is sliced and this one is not.
  // It also has to be whole before anything wakes: a factor computed off half
  // the tile would make whether a ruin is held depend on WHEN the player got
  // there, which is the one thing the per-structure seed exists to prevent.
  //
  //   A REBUILT ENTRY IS A NEW OBJECT and recomputes it (the CLAUDE.md rebuild
  // contract), and it lands on the SAME NUMBER: buildingShapes comes only from
  // the MVT tile, and the Overpass bin a rebuild is for carries trees, poles,
  // wells and chests — never a building. So the factor, and with it which
  // ruins are held, is the same before and after a rebuild. That matters more
  // than it looks: it is what keeps the whole mechanic identical between a
  // player whose bin arrived late and one whose bin was already cached.
  const NO_THINNING = { common: 1, landmark: 1 };
  function tileThin(entry) {
    if (!entry) return NO_THINNING;
    if (entry._lairThin) return entry._lairThin;
    const shapes = entry.buildingShapes || [];
    let reserved = 0, thinnable = 0;
    for (let i = 0; i < shapes.length; i++) {
      const sh = shapes[i];
      const occ = sh && OCCUPANCY[sh.tier];
      if (!occ) continue;
      if (occ.thinned) thinnable += occ.rate; else reserved += occ.rate;
    }
    let f;
    if (reserved >= LAIR_MAX_PER_TILE) {
      // The landmarks alone are over budget. They are still paid first, but
      // the ceiling is the ceiling: scale them onto it and leave nothing for
      // the wrecks. (reserved > 0 here, so the division is safe.)
      f = { common: 0, landmark: LAIR_MAX_PER_TILE / reserved };
    } else {
      const room = LAIR_MAX_PER_TILE - reserved;
      f = { common: thinnable > room ? room / thinnable : 1, landmark: 1 };
    }
    return (entry._lairThin = f);
  }

  // The odds a structure of `tier` is held on a tile whose factors are `thin`
  // (a tileThin result). 0 for a tier that holds no lair — the same answer
  // capFor gives it.
  function occupancyFor(tier, thin) {
    const occ = OCCUPANCY[tier];
    if (!occ) return 0;
    const f = thin || NO_THINNING;
    return occ.rate * (occ.thinned ? f.common : f.landmark);
  }

  // What this tile is expected to hold, all tiers together — the figure
  // LAIR_MAX_PER_TILE is the ceiling on. Exported so a test can hold the cap
  // against any composition of buildings rather than the two it thought of.
  function tileHeldExpected(entry) {
    const shapes = (entry && entry.buildingShapes) || [];
    const thin = tileThin(entry);
    let n = 0;
    for (let i = 0; i < shapes.length; i++) {
      if (shapes[i]) n += occupancyFor(shapes[i].tier, thin);
    }
    return n;
  }

  // ── Residency ────────────────────────────────────────────────────────────
  // How close the player must come for a ruin's garrison to exist, and how far
  // they must go for it to stop existing. The wake ring has to clear every
  // radius that could reveal a garrison that is not there yet — the sim bubble
  // (creature_ai.js CREATURE_SIM_CELLS, 12: a creature outside it does not think), the
  // sprite cull (VIEW_CELLS/2 + 1, whose corner is under 10), and bow range
  // (Combat SHOT_SPECS bow, 8) — so nothing is ever woken in view or shot at
  // before it is woken. `assertRingsClear` is the check, called by the test.
  const LAIR_WAKE_CELLS = 16;

  // ── The chase ────────────────────────────────────────────────────────────
  // A garrison HOLDS ITS RUIN until the player comes near, then comes at them
  // as a group, and gives up and walks back when they have got clear. The
  // resting half is what the old flat `immobile` bought — the ruin is visibly
  // held from across the street, which it would not be if the guards wandered
  // off — and the chase is what turns "a ruin with monsters in it" into a
  // decision made at speed.
  //
  // BOTH RINGS ARE MEASURED FROM THE RUIN, not from the guard, and both are
  // offset by the ruin's own seat radius (`c.lairR`, the ring the guards were
  // seated on). Two things fall out of that and neither is incidental:
  //
  //   THE GARRISON MOVES AS ONE. Every guard of a lair is the same distance
  //   question, so they notice together and give up together — the "pursuing
  //   group" rather than a trickle of individuals aggroing as the player
  //   brushes past each of them.
  //
  //   THE CHASE IS BOUNDED. A guard can never be more than a leash from its
  //   own ruin, so the garrison cannot be walked across the map and left
  //   somewhere it does not belong, and the ruin behind it is still held for
  //   the next player who comes at it from the other side. Measuring the leash
  //   from the GUARD instead would never break: a foe that keeps pace never
  //   falls behind, and the pursuit would only end when something else ended
  //   it.
  //
  // The offset by `lairR` is what keeps a castle honest — its footprint is
  // tens of metres across, so a ring measured from the CENTRE would have the
  // player standing on the battlements before anyone looked up.
  const LAIR_AGGRO_CELLS = 6;    // clear of the ruin's edge: the garrison notices
  // A KEEP'S GARRISON IS INSIDE IT (owner's call, Sep 2026). A fort's goblins
  // and a castle's skeletons stand in a knot about the footprint's CENTRE,
  // not on a ring round its walls, and they notice only a player who comes
  // near THEM — LAIR_CORE_AGGRO_CELLS past the knot, not LAIR_AGGRO_CELLS past
  // the walls. Walking by a castle is safe; walking into it is the fight.
  // The knot is LAIR_CORE_SPREAD_CELLS across at most, never wider than the
  // footprint itself, and its guards may cross their OWN floor (inOwnKeep)
  // to come out after the player — every other building stays solid to them.
  const CORE_SEATED_TIERS = new Set([11, 12]);   // T.BUILDING_MED / _LARGE
  const LAIR_CORE_SPREAD_CELLS = 1.5;
  const LAIR_CORE_AGGRO_CELLS = 3;
  const LAIR_LEASH_CELLS = 10;   // and this far out it gives up and goes home
  //   THE LEASH IS WHAT ENDS A CHASE (goblins and orcs run at 5.8 and 3 m/s,
  //   so a walking player cannot open the gap): a garrison follows to the
  //   leash and turns round there, whoever
  // is running. lair_chase_sim.test.js walks it.
  //   A GUARD WALKING HOME CAN FREEZE, and it is meant to. Past
  // CREATURE_SIM_CELLS (creature_ai.js, 12) wanderCreatures (scene_creatures.js) culls a creature entirely,
  // so a returning guard whose player kept going simply stops where it is.
  // That is the ordinary frozen-outside-the-bubble rule and it is harmless
  // here because of the ring order: the bubble is OUTSIDE the sprite cull, so
  // nothing is ever frozen in view, and coming back inside it puts the guard
  // straight back on the walk home. Go far enough instead and residency sleeps
  // the garrison, and the next wake re-seats it exactly where garrisonFor
  // always puts it — nothing decays either way. The leash is deliberately
  // INSIDE the bubble so the turn-round itself always happens somewhere the
  // guard is still thinking; that relation is pinned, and the whole sequence
  // is run for real in test/node/lair_chase_sim.test.js.
  // How close to its seat counts as home — a guard inside this is at rest
  // again. A fraction of a cell, so it is the arrival test and nothing more.
  const LAIR_SEAT_EPS_CELLS = 0.25;

  // And the gap to sleep is hysteresis: one ring would wake and sleep a
  // garrison every pass while the player stood on it. It is DERIVED from the
  // leash rather than authored, because a guard may be a whole leash from its
  // ruin when the player crosses out — sleeping the garrison is measured from
  // the RUIN, so the gap has to cover the distance a guard can have put
  // between itself and that ruin, or a pursuer would blink out in plain sight
  // on the way home. assertRingsClear checks what is left against the sprite
  // cull.
  const LAIR_SLEEP_CELLS = LAIR_WAKE_CELLS + LAIR_LEASH_CELLS;
  // The most guards that may be woken around the player at once. This is the
  // cap that the per-tile budget was reaching for and missing: what matters is
  // not how many a TILE holds — the player is never standing in all of it —
  // but how many are around them now, which is the same question on a city
  // block and in a hamlet. In the same order as the wild slimes a hard-mode
  // tile already puts within the wake ring, several times over.
  //   Nothing is ever un-woken to make room: a garrison already standing must
  // not blink out because the player walked toward a different ruin. The cap
  // only refuses NEW wakes, nearest ruin first, and walking away frees it.
  const LAIR_LIVE_MAX = 40;
  // The coarse grid the index buckets structures on, in cells. Sized to the
  // wake ring so a residency pass reads a 3×3 block of buckets instead of
  // walking every footprint on the tile.
  const LAIR_BUCKET_CELLS = 16;
  // Footprints taken into the index per residency pass — see indexChunk. About
  // half a millisecond's worth on the densest tile the build tests use, so even
  // a cold first slice stays well inside a frame.
  const LAIR_INDEX_CHUNK = 500;

  // How far outside a structure's own footprint a guard is seated, in cells.
  // Not ON the footprint: the spec's fauna rule is that nothing stands on a
  // building footing, and a guard drawn over a roof reads as a bug however it
  // got there. One cell out is close enough to read as "this ruin is held".
  const LAIR_RING_PAD_CELLS = 1;
  // Preserve the original polar draws first, then exhaust legal seats in
  // the same feature ring. Core/floor/cloud formations retain exact authored
  // placement: their geometry is part of the building encounter.
  const LAIR_SEAT_TRIES = 8;

  // The nominal garrison for a structure of `tier` at strength `t` (0..1,
  // the structure's own draw — see garrisonFor). 0 when the tier holds no
  // lair.
  function capFor(tier, t) {
    const base = TIER_GUARDS[tier];
    if (!base) return 0;
    if (FIXED_GUARD_TIERS.has(tier)) return base;
    const u = clamp01(Number.isFinite(t) ? t : 0);
    return Math.min(LAIR_MAX_PER_STRUCTURE,
                    Math.round(base * (1 + u * (FAR_MUL - 1))));
  }

  // The rolled count: the cap less a seeded shortfall. Takes exactly one draw
  // so a caller can reason about the stream.
  function countFor(cap, rng) {
    if (cap <= 0) return 0;
    const slack = Math.floor(cap * LAIR_SLACK);
    return cap - (slack > 0 ? Math.floor(rng() * (slack + 1)) : 0);
  }

  // Which kinds a lair of `tier` at strength `t` may hold, toughest last.
  // Empty for a tier that holds no lair at all — the same answer capFor gives.
  function kindsAt(tier, t) {
    const rows = KIND_LADDER[tier];
    if (!rows) return [];
    return rows.filter((k) => t >= k.minT).map((k) => k.kind);
  }
  // One guard's kind. Uniform over what has unlocked, so a maxed lair is a
  // mixed pack rather than ten of the worst thing on the ladder. Takes
  // exactly ONE draw whatever the ladder's length, so a caller can reason
  // about the stream (garrisonFor's seat rolls sit either side of it).
  function kindFor(tier, t, rng) {
    const ks = kindsAt(tier, t);
    const r = rng();
    if (!ks.length) return null;
    return ks[Math.min(ks.length - 1, Math.floor(r * ks.length))];
  }

  // THE STRUCTURE'S OWN IDENTITY, and the seed of its garrison: its tile and
  // the centre of its footprint as a cell on THAT TILE'S grid (tile-local
  // metres over tileEdgeM / entry.cellsPerEdge). The same `${tx}_${ty}_${ix}_${iy}`
  // shape worldgen mints object ids from. It is a fact about the building,
  // so it survives a tile rebuild, an eviction, a change in polygon order and
  // a garrison woken from a different tile of the ring — and, because neither
  // half is in world metres, it is the SAME key in every save, whatever
  // latitude that save's frame was projected at.
  function structureKey(tx, ty, ix, iy) { return `${tx}_${ty}_${ix}_${iy}`; }
  // A tile's own cell edge in metres — the grid a key and a seat are read on.
  // entry.cellsPerEdge is the tile's own (its latitude's), so this is too.
  // Falls back to the caller's cellM only for an entry with no grid size.
  function tileCellM(entry, tileEdgeM, cellM) {
    const n = entry && entry.cellsPerEdge;
    return (n > 0 && tileEdgeM > 0) ? tileEdgeM / n : cellM;
  }

  // The bounding box of a buildingShapes ring (tile-local metres), or null.
  // The same read _houseBlastGeometry does — a building's SOURCE polygon is
  // the real outline, where the object's own x/y is only its icon's cell.
  function ringBox(ring) {
    if (!ring || ring.length < 6) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      const rx = ring[i], ry = ring[i + 1];
      if (rx < x0) x0 = rx;
      if (rx > x1) x1 = rx;
      if (ry < y0) y0 = ry;
      if (ry > y1) y1 = ry;
    }
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) return null;
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
             halfW: (x1 - x0) / 2, halfH: (y1 - y0) / 2 };
  }

  // ── The index ────────────────────────────────────────────────────────────
  // One record per lair-eligible footprint on the tile, bucketed on a coarse
  // grid. No rng, no creatures, no save read — just where the structures are,
  // so a residency pass can ask "which ruins are near the player" without
  // walking a city's worth of polygons every time. Built once per tile entry
  // and cached on it; a rebuilt entry is a new object and simply builds a new
  // one (CLAUDE.md's rebuild contract — there is nothing here worth carrying).
  function newIndex(cellM) {
    return { bucketM: LAIR_BUCKET_CELLS * cellM, buckets: new Map(), next: 0, done: false };
  }

  // Take up to `limit` more footprints into `idx`, resuming where the last
  // call stopped. THE INDEX IS SLICED because this is the only pass over every
  // building on the tile and a dense one carries thousands: built in one go it
  // is ~7ms on a 6000-building tile, which is a dropped frame the first time
  // the player walks into a city. update() has no slicer of its own (the
  // rasterizer's is upstream of here), so the pass carries its own cursor and
  // spends a slice of it per residency pass instead. A half-indexed tile just
  // wakes fewer ruins for a second or two, and the wake ring is four cells
  // outside the sleep ring — twenty seconds of walking — so nothing shows.
  //
  // Two allocations it deliberately avoids, both paid per building: a bucket
  // key STRING (`bucketKey` packs the two grid coordinates into one integer)
  // and the structure's `sid` string (derived at wake time, for the handful of
  // candidates that ever reach the wake ring). The bbox is inlined for the
  // same reason — ringBox allocates a record this would copy and drop.
  function indexChunk(idx, entry, tx, ty, cellM, tileEdgeM, limit) {
    const shapes = (entry && entry.buildingShapes) || [];
    const ox = tx * tileEdgeM, oy = ty * tileEdgeM;
    const tcM = tileCellM(entry, tileEdgeM, cellM);
    const bucketM = idx.bucketM, buckets = idx.buckets;
    const end = Math.min(shapes.length, idx.next + (limit > 0 ? limit : shapes.length));
    for (let si = idx.next; si < end; si++) {
      const sh = shapes[si];
      if (!sh || sh.kind === 'temple' || sh.templeZone || !TIER_GUARDS[sh.tier]) continue;
      const ring = sh.ring;
      if (!ring || ring.length < 6) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < ring.length; i += 2) {
        const rx = ring[i], ry = ring[i + 1];
        if (rx < x0) x0 = rx;
        if (rx > x1) x1 = rx;
        if (ry < y0) y0 = ry;
        if (ry > y1) y1 = ry;
      }
      if (!Number.isFinite(x0) || !Number.isFinite(y0)) continue;
      const lx = (x0 + x1) / 2, ly = (y0 + y1) / 2;
      // Absolute centre — the world point the player's distance is measured
      // to (this save's frame; proximity only). The IDENTITY is the tile plus
      // the centre's cell on the tile's own grid (structureKey).
      const wx = ox + lx, wy = oy + ly;
      const cand = {
        tx, ty, ix: Math.floor(lx / tcM), iy: Math.floor(ly / tcM),
        tier: sh.tier, key: sh.key || null,
        wx, wy,                                  // absolute metres
        lx, ly,                                  // tile-local metres (seating)
        // The origin of the tile THIS SHAPE BELONGS TO, carried rather than
        // re-derived from wx: a footprint whose centre sits a metre the wrong
        // side of the seam would otherwise be seated against the neighbour's
        // origin while indexed against this tile's grid.
        ox, oy,
        halfW: (x1 - x0) / 2, halfH: (y1 - y0) / 2,
      };
      const bk = bucketKey(Math.floor(wx / bucketM), Math.floor(wy / bucketM));
      const b = buckets.get(bk);
      if (b) b.push(cand); else buckets.set(bk, [cand]);
    }
    idx.next = end;
    idx.done = end >= shapes.length;
    // The street structures (entry.streetLairs — spawnInTile stamps them off
    // StreetVariants) join the same buckets once, when the shapes are done.
    // A handful per tile, so no slicing. Their `sid` is minted where they are
    // found (a barricade's cell id, a café's global POI point).
    if (idx.done && !idx.streetDone) {
      idx.streetDone = true;
      for (const st of (entry && entry.streetLairs) || []) {
        const wx = ox + st.lx, wy = oy + st.ly;
        const cand = {
          tx, ty, ix: Math.floor(st.lx / tcM), iy: Math.floor(st.ly / tcM),
          tier: st.tier, key: null, sid: st.sid,
          wx, wy, lx: st.lx, ly: st.ly, ox, oy, halfW: 0, halfH: 0,
        };
        const bk = bucketKey(Math.floor(wx / bucketM), Math.floor(wy / bucketM));
        const b = buckets.get(bk);
        if (b) b.push(cand); else buckets.set(bk, [cand]);
      }
    }
    return idx;
  }

  // The whole tile in one go — what a test wants, and what a small tile costs
  // anyway. The shipping path goes through indexFor, which slices.
  function buildIndex(entry, tx, ty, cellM, tileEdgeM) {
    return indexChunk(newIndex(cellM), entry, tx, ty, cellM, tileEdgeM, Infinity);
  }

  // Two bucket-grid coordinates packed into one integer. A tile is 220 cells
  // and a bucket 16, so the per-tile span is tiny; the range here is what a
  // world coordinate needs, and a collision across it would only ever merge
  // two buckets (a correctness no-op — the distance test is exact).
  const BUCKET_SPAN = 1 << 16;
  function bucketKey(bx, by) { return (bx + 32768) * BUCKET_SPAN + (by + 32768); }

  // Cached accessor — one slice per residency pass until the tile is fully
  // indexed, then free. A rebuilt entry is a new object and simply starts a new
  // index (CLAUDE.md's rebuild contract: there is nothing here worth carrying,
  // and the buildingShapes it is derived from are new too).
  function indexFor(entry, tx, ty, cellM, tileEdgeM) {
    let idx = entry._lairIndex;
    if (!idx) idx = entry._lairIndex = newIndex(cellM);
    if (!idx.done) indexChunk(idx, entry, tx, ty, cellM, tileEdgeM, LAIR_INDEX_CHUNK);
    return idx;
  }

  // ── Waking one ruin ──────────────────────────────────────────────────────
  // The guards of ONE structure, seeded from that structure alone. Returns the
  // creature objects to add — the same shape spawnInTile builds, plus
  // `immobile` and the lair's own centre (so the sleep pass can measure a
  // guard's distance without looking its building back up).
  //
  // THE DRAW ORDER is fixed and pinned — every guard's kind and seat sit
  // downstream of it, so moving a draw re-rolls every lair on the map:
  //   1. held at all?          (occupancy — the tile's thinning is the only
  //                             input that is not the building's own)
  //   2. t, its strength       (0..1 → cap and kind ladder)
  //   3. a group, or not       (groupFor, exactly one draw — GROUPS)
  //   4. the group's facing    (one draw, taken on every path)
  //   5. the count             (countFor: one plain-path draw; authored
  //                             fixed compositions: none; nRange: one draw)
  //   then per guard: its kind (kindFor, exactly one draw), then its seat
  //   tries (seatPolar, two draws each).
  // NOTHING about the player — Home, save, frame — reaches a draw. Home is
  // applied after the fact, per player (the safe area, EnemySpawns.homeAllows).
  function isCitadel(cand) {
    return cand.tier === 12 && root.CastleStyles?.get(cand.key).guards === true;
  }

  function garrisonFor(entry, cand, opts) {
    const WG = root.WorldGen;
    const o = opts || {};
    const tileEdgeM = o.tileEdgeM;
    if (!WG || !entry || !entry.grid || !(tileEdgeM > 0)) return [];
    const N = entry.cellsPerEdge;
    if (!(N > 0)) return [];
    // Draw seats from the tile's generated layer. Player overlays may hide a
    // drawn guard below, but they never make its seat search consume another
    // random number and move the guards that follow it.
    if (cand.tier === 12 && typeof CastleStyles !== 'undefined'
      && !CastleStyles.get(cand.key).guards) return [];
    // Keep the actual, reachable garrison, including already defeated members.
    // Empty/blocked keeps can open only after this generation pass has run.
    const citadelIds = isCitadel(cand) ? [] : null;
    if (citadelIds) {
      entry._citadelGuards ||= new Map();
      entry._citadelGuards.set(cand.key, citadelIds);
    }
    const genGrid = entry.baseGrid || entry.grid;
    const genObjects = entry.genObjects || entry.objects || [];
    if (!cand.sid) cand.sid = structureKey(cand.tx, cand.ty, cand.ix, cand.iy);

    // ONE STREAM PER STRUCTURE, seeded from the structure's own key. Nothing
    // outside this building can move a single number in it.
    const rng = WG.makeRng(hashKey(cand.sid));
    // IS IT HELD AT ALL — the first question, so it is the first draw. Taken
    // from the structure's own stream like everything else here, which is what
    // makes an empty ruin as stable as a full one: it is empty on every wake,
    // every rebuild and every reload, rather than re-rolled into a garrison
    // the moment the player looks away. (stepResidency marks a lair resident
    // even when it wakes empty, so this is not even re-asked within a session.)
    // The tile's thinning factor is the only thing here that is not the
    // building's own — see tileThin.
    if (rng() >= occupancyFor(cand.tier, tileThin(entry))) return [];
    // ITS STRENGTH — the world's, not the player's. Uniform, so the garrison
    // sizes and ladders spread across the whole range on any one street.
    const t = rng();
    const cap = capFor(cand.tier, t);
    if (cap <= 0) return [];
    const cellM = tileEdgeM / N;
    // A GROUP OR THE PLAIN ROLL (GROUPS above) — one draw, then the group's
    // one FACING draw (front / behind placements turn on it). Both are taken
    // on every path so the plain garrison's seat draws start at the same
    // point of the stream whether or not the tier offers any group at all.
    const group = TIERS.includes(cand.tier) ? groupFor(cand.tier, t, rng, nearShore(entry, cand, N, cellM))
      : (TIER_GROUP[cand.tier] || null);
    const facing = rng() * TAU;
    const plan = group ? expandGroup(group, cand.tier, rng) : null;
    const baseCount = plan ? plan.length : countFor(cap, rng);
    // Hard barricades introduce ranged support, capped at a two-member team.
    const nWorld = cand.tier === 'barricade' && root.Difficulty?.mode() === 'hard' ? 2 : baseCount;
    // THE MODE'S GROUP CAP (Difficulty lairGuardMax — 2 on easy, none on
    // hard; owner, Sep 2026). Applied to the ROLLED count, after every world
    // draw above (occupancy, strength, count), so the world's garrison is the
    // same for everyone and easy simply wakes the first `lairGuardMax` of it:
    // guard i's id, kind and seat draws in the loop below are the same in
    // both modes, hard just keeps going. Never a second roll, never a
    // different pair. An authored modeCap:false row keeps its full formation.
    const modeMax = root.Difficulty?.get?.().lairGuardMax;
    const n = modeMax > 0 && GROUPS[group]?.modeCap !== false ? Math.min(nWorld, modeMax) : nWorld;
    // A BUILDING's garrison comes out after you, so its themed family drops
    // the rooted kinds (EnemyRoster.isRooted — the plants); a road variant's
    // stretch (a street tier) keeps them. The kind is picked off the filtered
    // list, so no seat draw moves.
    const rawFamily = root.EnemyHabitats?.buildingKinds(entry, cand);
    const mobile = rawFamily && TIERS.includes(cand.tier)
      ? rawFamily.filter((k) => !root.EnemyRoster?.isRooted(k)) : rawFamily;
    const family = mobile && mobile.length ? mobile : null;
    const ox = cand.ox, oy = cand.oy;
    const caught = o.caughtSet;
    const hpMemo = o.hpMemo;
    const spawnOpts = entry._spawnOpts || o.spawnOpts;
    // The kerb buffer is read off the spawn options' roadClass (spawnInTile
    // carries entry.roadClass there); an older options object without one
    // reads the entry's own — the same array, never a second derivation.
    const foeOpts = (spawnOpts && !spawnOpts.roadClass && entry.roadClass)
      ? Object.assign({}, spawnOpts, { roadClass: entry.roadClass }) : spawnOpts;
    // The live-ground cull matches SceneCreatures._cullOffLiveGround: objects
    // added after generation claim their cell, and a player-repainted cell
    // drops its guard only when the live terrain is no longer walkable.
    const generated = new Set(genObjects);
    const liveOccupied = WG.occupiedIndexSet(WG.tileFrame(entry, cand.tx, cand.ty, tileEdgeM),
      (entry.objects || []).filter((obj) => !generated.has(obj)));
    const liveBlocks = (ix, iy) => {
      const at = iy * N + ix;
      if (liveOccupied.has(at)) return true;
      return entry.grid !== genGrid && entry.grid[at] !== genGrid[at]
        && !WG.isWalkable(entry.grid[at]);
    };
    // A keep seats inside (CORE_SEATED_TIERS); every other lair on a ring
    // just off its footprint. seatR is the knot's / ring's radius either way,
    // and it is the `lairR` both chase rings are offset by — for a GROUP too,
    // whatever mix of placements its members take, so the garrison still
    // notices and gives up as one. A group member is placed by its own spec
    // (seatPolar): the knot (coreR) or the ring (ringR) by its place.
    const core = CORE_SEATED_TIERS.has(cand.tier);
    const radii = seatRadii(cand.halfW, cand.halfH, cellM);
    const seatR = core ? radii.core : radii.ring;
    const plainSpec = { place: core ? 'core' : 'ring', of: nWorld };
    const C = root.Combat;
    const reservedSeats = new Set();
    const sourceCell = cand.iy * N + cand.ix;
    const sourceOwner = WG.variantOwnerAt(entry, sourceCell);
    const sameOwner = at => {
      if (WG.variantOwnerAt(entry, at) !== sourceOwner) return false;
      if (sourceOwner === 'zone') return entry.zone.coverage[at] === entry.zone.coverage[sourceCell];
      if (sourceOwner === 'road') return entry.streetArea[at] === entry.streetArea[sourceCell];
      return true;
    };
    const out = [];
    // A DAILY tier's guard carries the UTC day in its id (see DAILY_TIERS).
    const day = DAILY_TIERS.has(cand.tier)
      ? String(o.dayKey || utcDayKey()) : null;
    for (let i = 0; i < n; i++) {
      const id = day ? `lair_${cand.sid}_${day}_${i}` : `lair_${cand.sid}_${i}`;
      const spec = plan ? plan[i] : Object.assign({ idx: i }, plainSpec);
      const legacyKind = kindFor(cand.tier, t, rng); // preserve the seat RNG stream
      const kind = plan ? spec.kind
        : cand.tier === 'barricade' ? (i === 0 ? 'spear_goblin' : 'archer_goblin')
        : family ? family[i % Math.min(family.length, 1 + Math.floor(t * family.length))] : legacyKind;
      if (!kind) continue;                    // no ladder for this tier
      const flier = plan && flies(kind);
      // Its seat class (the spawn gate): a fast guard also keeps off the kerb.
      const guardClass = Object.hasOwn(STREET_TIER_GUARDS, cand.tier) ? 'fastEnemy' : (typeof root.creatureSpawnClass === 'function')
        ? root.creatureSpawnClass(kind) : 'fastEnemy';
      const guardCell = (ix, iy) => Object.hasOwn(STREET_TIER_GUARDS, cand.tier)
        ? WG.isSpawnCell(genGrid, N, N, ix, iy, foeOpts, guardClass)
        : root.CreatureSpawns.isSpawnCell(genGrid, N, N, ix, iy, foeOpts, kind);
      let seat = null;
      let inKeep = false;
      for (let a = 0; a < LAIR_SEAT_TRIES && !seat; a++) {
        // Spaced round the ring by the WORLD's count (nWorld, the spec's
        // `of`), not the woken one, so a mode that wakes fewer (Difficulty
        // lairGuardMax) seats its guards exactly where the full garrison's
        // first ones stand. seatPolar is the one placement rule (two draws a
        // try), for the plain ring / knot and every group placement alike.
        const p = seatPolar(spec, a, facing, rng);
        const r = radii[p.base] * p.rMul;
        const lx = cand.lx + Math.cos(p.ang) * r;
        const ly = cand.ly + Math.sin(p.ang) * r;
        const ix = Math.floor(lx / cellM), iy = Math.floor(ly / cellM);
        if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
        // A keep's guard stands on its own floor — the one building cell the
        // shared rule (rightly) refuses everything else — at the exact drawn
        // point, not the cell centre, or a knot of them would stack into one.
        // A flier of a cloud may hang over the roof the same way.
        if ((p.core || (p.over && flier)) && WG.isBuildingTerrain(genGrid[iy * N + ix])) {
          seat = { x: ox + lx, y: oy + ly, ix, iy };
          inKeep = !!p.core;
          break;
        }
        // The shared seat rule (WorldGen.isSpawnCell at the guard's own
        // class): road mask included - a guard on the carriageway is the bug
        // CLAUDE.md's road invariant is about - AND outside the major roads'
        // kerb buffer (ROAD_CLASS_MAJOR_BUFFER), so no guard of any lair
        // stands where a chase would begin at the kerb. The verdict runs on
        // the GENERATED grid (baseGrid): player edits cull seats afterwards,
        // they never reroll them. The options come off
        // THE ENTRY (spawnInTile stashes the very object it spawned the tile's
        // fauna, traps and treasure with), never rebuilt here: a second
        // reading of "is this a road" is how the two drift. Only the VERDICT
        // changed: the draws are the same, so every seat that passes both rules is
        // the seat it always was.
        if (!guardCell(ix, iy)) continue;
        seat = (p.core || p.over) ? { x: ox + lx, y: oy + ly, ix, iy }   // a knot, not a stack
          : { x: ox + (ix + 0.5) * cellM, y: oy + (iy + 0.5) * cellM, ix, iy };
        inKeep = !!p.core;
      }
      if (!seat && (!spec.place || spec.place === 'ring')) {
        const band = spec.band || [1, 1.35], outer = radii.ring * band[1];
        const r = Math.ceil(outer / cellM + 1), centreX = Math.floor(cand.lx / cellM), centreY = Math.floor(cand.ly / cellM);
        let best = null, rank = Infinity;
        for (let iy = Math.max(0, centreY - r); iy <= Math.min(N - 1, centreY + r); iy++)
          for (let ix = Math.max(0, centreX - r); ix <= Math.min(N - 1, centreX + r); ix++) {
            const at = iy * N + ix, lx = (ix + .5) * cellM, ly = (iy + .5) * cellM;
            const distance = Math.hypot(lx - cand.lx, ly - cand.ly);
            // Cell centres approximate continuous polar seats by at most half
            // a cell diagonal. Never widen the feature's declared ring.
            if (distance < radii.ring * band[0] - cellM * Math.SQRT1_2
                || distance > outer + cellM * Math.SQRT1_2
                || reservedSeats.has(at) || !sameOwner(at)
                || !guardCell(ix, iy)) continue;
            const score = hashKey(`${id}:fallback:${ix}:${iy}`);
            if (score < rank) { rank = score; best = { x: ox + lx, y: oy + ly, ix, iy }; }
          }
        seat = best;
      }
      if (!seat) continue;                    // no ground in the authored feature
      reservedSeats.add(seat.iy * N + seat.ix);
      if (liveBlocks(seat.ix, seat.iy)) continue; // player overlay: drop, never reroll
      if (citadelIds) citadelIds.push(id);
      // Already killed. The draws above ran anyway — see the note below.
      if (caught && caught.has(id)) continue;
      // WG.makeCreature is the tile stream's one shape (worldgen.js) — reached
      // at CALL time, like every other WorldGen read in this file, because
      // lairs.js loads BEFORE worldgen.js.
      // ELITES ARE THE WORLD'S TOO: stamped off the guard's stable id at the
      // cave monsters' rate (app.js spawns them the same way), so the same
      // guard is an elite for every player. Only a MONSTER can be one
      // (Combat.isElite) — the wreck's surface slime never rolls shiny, the
      // faunaShiny exception.
      // SHINY_RATE by bare name: a top-level `const` in util.js is a script-
      // global binding, never a property of window, so reading it off root is
      // undefined in the browser.
      // A GROUP's `elite` member is stamped shiny outright (the kind must be
      // eliteEligible — guard_groups.test.js pins the table); every other
      // guard rolls the world's rate, away from the stairs
      // (EnemySpawns.rollsElite).
      const eligible = !!(C && C.monster(kind)?.eliteEligible);
      const shiny = eligible && (spec.elite === true
        || root.EnemySpawns.rollsElite(entry, kind, id, seat.x, seat.y, cellM));
      const g = WG.makeCreature(kind, seat.x, seat.y, id, {
        _sharedId: true,   // the world's garrison (EnemySpawns.isSharedId)
        shiny,
        ...(root.EnemyHabitats?.emergesFromGround(kind,
          root.EnemyHabitats.variantAt(entry, seat.ix, seat.iy) || cand.variant)
          ? { emergeFromGround: true, _burrowed: true } : {}),
        // `immobile` still means "this creature does not wander": app.js reads
        // it to route the guard through Lairs.guardState instead of the
        // ordinary fauna step. Where it goes from here is that state's answer,
        // and it needs three more facts about the ruin to give one — the seat
        // to come home to, and the centre and radius both rings are measured
        // from (see LAIR_AGGRO_CELLS).
        ...(citadelIds ? { castle: cand.key } : {}),
        immobile: true, lair: cand.sid, lairX: cand.wx, lairY: cand.wy,
        lairR: seatR, seatX: seat.x, seatY: seat.y,
        // Inside the footprint (the keep's knot, or a group member placed
        // 'core' at any tier): it may cross its own floor to come out
        // (inOwnKeep), and it notices only a player who comes near the knot.
        ...((core || inKeep) ? { keepHW: cand.halfW, keepHH: cand.halfH, aggroCells: LAIR_CORE_AGGRO_CELLS } : {}),
        // What the group tells this member (GROUPS): its own notice ring, a
        // ghost's dormancy, and the group it belongs to (tests, the sheet).
        ...(spec.aggroCells != null ? { aggroCells: spec.aggroCells } : {}),
        ...(spec.proximityCells != null ? { proximityCells: spec.proximityCells } : {}),
        ...(plan ? { group } : {}),
      });
      // A guard the player wounded and walked away from comes back wounded.
      // Session-only, like every other creature's `_hp` (combat.js) — it is
      // the sleep/wake cycle this covers, not a reload.
      if (hpMemo && hpMemo.has(id)) g._hp = hpMemo.get(id);
      out.push(g);
    }
    if (citadelIds) o.onCitadelGenerated?.(cand.key, citadelIds);
    return out;
  }

  // May this guard stand at (x, y) although the cell is a building? Only on
  // its OWN keep's footprint (its bounding box — keepHW / keepHH, stamped by
  // garrisonFor for CORE_SEATED_TIERS). Both step paths ask it beside the
  // fauna rule (Combat.faunaBlocksCell / creature_ai enemyCanStep).
  function inOwnKeep(c, x, y) {
    return !!c && c.keepHW > 0 && c.keepHH > 0
      && Math.abs(x - c.lairX) <= c.keepHW && Math.abs(y - c.lairY) <= c.keepHH;
  }

  // The UTC day a DAILY tier's guard rose on (its id — see DAILY_TIERS), or
  // null for any other id. A gate's sid starts `gate_` (worldgen.js
  // gatePostsAt), so the day is the 8 digits before the guard's index.
  // scene_creatures.js prunes save.caught of the ones not from today: they
  // can never be minted again, so the marker can never matter again.
  const DAILY_GUARD_ID = /^lair_gate_.+_(\d{8})_\d+$/;
  function dailyGuardDay(id) {
    const m = typeof id === 'string' ? DAILY_GUARD_ID.exec(id) : null;
    return m ? m[1] : null;
  }

  // A 32-bit hash of the structure key, for makeRng. Two neighbouring
  // buildings differ in one cell coordinate, so the mixing matters more here
  // than the range does.
  //
  // util.js's fnv1a — the one string hash the world's per-id looks read.
  const hashKey = fnv1a;

  // ── What a guard is doing this tick ──────────────────────────────────────
  // The one answer scene_creatures.js's wanderCreatures asks per guard, so the rings, the
  // hysteresis and the arrival test live HERE with the numbers rather than
  // spread across the movement loop. Three states and no others:
  //
  //   'hold'    at rest on its seat. It does not step, and it is not
  //             interested in the player — this is the old flat `immobile`.
  //   'hunt'    the player is inside the ruin's aggro ring (or was, and has
  //             not yet reached the leash). It steps toward them and it bites.
  //   'return'  it has given up and is walking back to its seat. It does NOT
  //             bite on the way: the player got clear, and a guard that kept
  //             leeching while it walked home would mean they had not.
  //
  // The hysteresis is `c._hunting`, which the CALLER stores back — session
  // state on the creature like `_hp`, so a guard slept mid-chase comes back
  // at its seat, holding. Between the two rings a guard that has never noticed
  // the player keeps holding and one already chasing keeps chasing, which is
  // what stops a garrison flickering while the player walks the boundary.
  // `noticed` is the caller's "is the player worth hunting at all" — app.js's
  // `unnoticed` (Shadow Powder, or a player downed on an empty bar) inverted.
  // Passed in rather than read here so this module stays pure, and it switches
  // the CHASE off exactly where it already switches the bite off: a garrison
  // that has lost the player walks home instead of milling about wherever it
  // happened to be standing when they vanished.
  function guardState(c, p, cellM, noticed) {
    if (!c || !c.lair) return null;
    if (!p || !(cellM > 0)) return 'hold';
    if (noticed !== false) {
      const dx = c.lairX - p.x, dy = c.lairY - p.y;
      const dLair = Math.sqrt(dx * dx + dy * dy) - (c.lairR || 0);
      if (dLair <= (c.aggroCells ?? LAIR_AGGRO_CELLS) * cellM) return 'hunt';
      if (c._hunting && dLair <= LAIR_LEASH_CELLS * cellM) return 'hunt';
    }
    if (!Number.isFinite(c.seatX) || !Number.isFinite(c.seatY)) return 'hold';
    const sx = c.x - c.seatX, sy = c.y - c.seatY;
    const eps = LAIR_SEAT_EPS_CELLS * cellM;
    return (sx * sx + sy * sy > eps * eps) ? 'return' : 'hold';
  }

  // ── The residency pass ───────────────────────────────────────────────────
  // Run on a throttle from app.js update(). Mutates each entry's `creatures`
  // in place: garrisons within the wake ring are added, garrisons past the
  // sleep ring are removed. Returns a small report for the tests.
  //
  //   ring   [{ entry, tx, ty }] — the player's 3×3 tile neighbourhood
  //   opts   cellM, tileEdgeM, playerM {x,y}, homeM {x,y} (only so the
  //          wake waits for Home's anchor — no tier or garrison reads it),
  //          isClaimed(key), caughtSet, hpMemo (Map id → hp, session-only),
  //          liveMax (test override)
  // Unknown garrisons never qualify. A generated empty keep has nobody left
  // to defeat, so it opens too; this also covers blocked or already cleared seats.
  function claimClearedCitadels(ring, caughtSet, onClear) {
    if (typeof onClear !== 'function') return;
    for (const tile of ring || []) {
      for (const [key, ids] of tile.entry?._citadelGuards || []) {
        if (!ids.every(id => caughtSet?.has(id))) continue;
        // Split offspring and summoned escorts can occupy a neighbouring
        // tile. Defeating the original body alone must not open its keep.
        const livingGuard = (ring || []).some(other => (other.entry?.creatures || [])
          .some(c => (c.castle === key || (c._splitRoot && ids.includes(c._splitRoot)))
            && !caughtSet?.has(c.id)));
        if (!livingGuard) onClear(key);
      }
    }
  }

  // Remove every cached body, including split/summoned guards in other tiles.
  // Stable guard identities can then be reused by a completely fresh attempt.
  function resetCitadel(entries, key, ids, hpMemo) {
    const guardIds = new Set(ids);
    for (const entry of entries) {
      for (const c of entry.creatures || []) {
        if (c.castle === key || guardIds.has(c.id) || guardIds.has(c._splitRoot)) {
          entry._lairResident?.delete(c.lair);
          hpMemo?.delete(c.id);
        }
      }
      if (entry.creatures) entry.creatures = entry.creatures.filter(c =>
        c.castle !== key && !guardIds.has(c.id) && !guardIds.has(c._splitRoot));
      for (const bucket of entry._lairIndex?.buckets.values() || []) {
        for (const cand of bucket) if (cand.key === key) entry._lairResident?.delete(cand.sid);
      }
      entry._citadelGuards?.delete(key);
    }
    for (const id of guardIds) hpMemo?.delete(id);
  }

  function stepResidency(ring, opts) {
    const o = opts || {};
    const cellM = o.cellM, tileEdgeM = o.tileEdgeM, p = o.playerM;
    const report = { woken: 0, slept: 0, live: 0 };
    if (!ring || !ring.length || !(cellM > 0) || !(tileEdgeM > 0) || !p) return report;
    const wakeR = LAIR_WAKE_CELLS * cellM, wakeR2 = wakeR * wakeR;
    const sleepR2 = (LAIR_SLEEP_CELLS * cellM) * (LAIR_SLEEP_CELLS * cellM);
    const liveMax = Number.isFinite(o.liveMax) ? o.liveMax : LAIR_LIVE_MAX;
    const isClaimed = typeof o.isClaimed === 'function' ? o.isClaimed : () => false;
    const hpMemo = o.hpMemo;
    // The building lairs are hard mode's (Difficulty derelictLairs, handed in
    // as `buildings`); the street structures wake in every mode. Default on,
    // so a caller that says nothing gets every lair, as before.
    const buildings = o.buildings !== false;

    // ── Sleep, and count what is left standing ──────────────────────────
    // One compacting walk per entry — never a splice per removal, which is
    // the quadratic CLAUDE.md's tile-build rule warns about in the other
    // direction.
    //
    // THE RESIDENT SET IS NOT REBUILT FROM THE CREATURES. It has to outlive
    // them: a ruin the player has CLEARED holds no creatures at all, and one
    // whose seats were all refused never had any, and neither may be re-rolled
    // on every pass for the rest of the session. So the set persists, a wake
    // adds to it, and only the sleep below takes anything out. A rebuilt entry
    // is a new object and arrives without one (CLAUDE.md's rebuild contract) —
    // it is derived from the carried creatures that once, which loses only the
    // memory of the empty ruins and costs one re-roll each.
    const caught = o.caughtSet;
    let live = 0;
    for (const t of ring) {
      const entry = t && t.entry;
      if (!entry) continue;
      const arr = entry.creatures;
      if (!entry._lairResident) {
        const derived = new Set();
        if (arr) for (const c of arr) { if (c && c.lair && !c.zoneVariant) derived.add(c.lair); }
        entry._lairResident = derived;
      }
      if (!arr || !arr.length) continue;
      const resident = entry._lairResident;
      const slept = new Set(), kept = new Set();
      let w = 0;
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        // Zone guards persist with the tile; only indexed lairs sleep/wake.
        if (c && c.lair && !c.zoneVariant) {
          const dx = c.lairX - p.x, dy = c.lairY - p.y;
          if (dx * dx + dy * dy > sleepR2) {
            // Remember the wound before letting it go, then drop it.
            if (hpMemo && Number.isFinite(c._hp)) hpMemo.set(c.id, c._hp);
            slept.add(c.lair);
            report.slept++;
            continue;
          }
          kept.add(c.lair);
          // A DEAD guard is still in the array — resolveDefeat marks
          // save.caught and leaves the object for the caught filters
          // downstream — but it is not a monster standing anywhere, so it must
          // not hold the live cap shut. A district the player has cleared
          // should let the next ruin in, not stay full of corpses.
          if (!(caught && caught.has(c.id))) live++;
        }
        arr[w++] = c;
      }
      arr.length = w;
      // A lair leaves the resident set only when its LAST guard slept — never
      // when its last guard was killed.
      for (const sid of slept) if (!kept.has(sid)) resident.delete(sid);
    }

    claimClearedCitadels(ring, caught, o.onCitadelCleared);

    // ── Wake, nearest ruin first ────────────────────────────────────────
    // Gather the candidates in range across the ring, then take them in order
    // of distance so the cap, when it binds, refuses the FURTHEST — the ones
    // the player is least likely to be looking at.
    if (live >= liveMax) { report.live = live; return report; }
    // NO HOME YET, NO WAKE. Home decides nothing about a garrison but what
    // this player sees of it (the safe area, EnemySpawns.homeAllows) — yet a
    // garrison woken before the anchor lands would stand in full by the
    // trailer. So the wake waits a pass for the anchor; nothing already
    // standing is touched.
    const home = o.homeM;
    if (!home || !Number.isFinite(home.x) || !Number.isFinite(home.y)) {
      report.live = live; return report;
    }
    const near = [];
    for (const t of ring) {
      const entry = t && t.entry;
      if (!entry || !entry.grid) continue;
      // A tile whose spawn pass has not run yet has no shared spawn options,
      // and the road rule is not something to approximate — skip it and pick
      // it up on the next pass.
      if (!entry._spawnOpts) continue;
      const idx = indexFor(entry, t.tx, t.ty, cellM, tileEdgeM);
      const resident = entry._lairResident;
      if (!resident) continue;          // set by the sleep pass above
      const bm = idx.bucketM;
      const bx0 = Math.floor((p.x - wakeR) / bm), bx1 = Math.floor((p.x + wakeR) / bm);
      const by0 = Math.floor((p.y - wakeR) / bm), by1 = Math.floor((p.y + wakeR) / bm);
      for (let by = by0; by <= by1; by++) {
        for (let bx = bx0; bx <= bx1; bx++) {
          const b = idx.buckets.get(bucketKey(bx, by));
          if (!b) continue;
          for (const cand of b) {
            const dx = cand.wx - p.x, dy = cand.wy - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > wakeR2) continue;
            // The structure's own key, built HERE rather than in the index:
            // only the few candidates that reach the wake ring ever need it,
            // and the index runs over every building on the tile.
            if (isCitadel(cand) && !o.isCitadelActive?.(cand.key)) continue;
            if (!buildings && !ALWAYS_AWAKE_TIERS.has(cand.tier) && !isCitadel(cand)) continue;
            if (!cand.sid) cand.sid = structureKey(cand.tx, cand.ty, cand.ix, cand.iy);
            if (resident.has(cand.sid)) {
              // Rebuilds carry live creatures but not the generation manifest.
              // Recover it before treating a carried garrison as complete.
              if (isCitadel(cand) && !entry._citadelGuards?.has(cand.key)) {
                garrisonFor(entry, cand, o);
              }
              continue;
            }
            // A structure the player has taken back is not derelict any more —
            // the same isClaimedKey test the derelict wash reads, so what is
            // lit as yours is what holds no monsters.
            if (cand.key && isClaimed(cand.key)) continue;
            near.push({ d2, cand, entry, resident });
          }
        }
      }
    }
    near.sort((a, b) => a.d2 - b.d2);
    for (const n of near) {
      if (live >= liveMax) break;
      const guards = garrisonFor(n.entry, n.cand, o);
      // Mark it resident even when it woke EMPTY — a ruin the player has
      // cleared, or one with nowhere to stand, must not be re-rolled on every
      // pass for the rest of the session.
      n.resident.add(n.cand.sid);
      if (!guards.length) continue;
      if (!n.entry.creatures) n.entry.creatures = [];
      for (const g of guards) n.entry.creatures.push(g);
      live += guards.length;
      report.woken += guards.length;
    }
    claimClearedCitadels(ring, caught, o.onCitadelCleared);
    report.live = live;
    return report;
  }

  // The rings this module depends on clearing, for the test to check against
  // the numbers app.js and combat.js actually own. Waking a garrison inside
  // any of these would let the player watch one appear, or shoot at a ruin
  // that is still empty.
  function assertRingsClear(simCells, cullCornerCells, shotCells) {
    return LAIR_WAKE_CELLS > simCells &&
           LAIR_WAKE_CELLS > cullCornerCells &&
           LAIR_WAKE_CELLS > shotCells &&
           LAIR_SLEEP_CELLS > LAIR_WAKE_CELLS &&
           // The chase needs one more: a guard is slept on ITS RUIN'S distance
           // from the player, but by then it may be a whole leash away from
           // that ruin on the way home — so what is left after the leash still
           // has to clear the sprite cull, or a pursuer would vanish in plain
           // sight instead of walking off. (The ruin's own seat radius eats a
           // little more of the margin, which is why this is not a tight fit.)
           LAIR_SLEEP_CELLS - LAIR_LEASH_CELLS > cullCornerCells &&
           // And the leash has to be outside the aggro ring, or a garrison on
           // the boundary would notice and give up on alternate passes.
           LAIR_LEASH_CELLS > LAIR_AGGRO_CELLS &&
           LAIR_LEASH_CELLS > LAIR_CORE_AGGRO_CELLS;
  }

  root.Lairs = {
    LAIR_MAX_PER_STRUCTURE, LAIR_SLACK,
    LAIR_WAKE_CELLS, LAIR_SLEEP_CELLS, LAIR_LIVE_MAX, LAIR_BUCKET_CELLS,
    LAIR_RING_PAD_CELLS, CORE_SEATED_TIERS, LAIR_CORE_SPREAD_CELLS, LAIR_CORE_AGGRO_CELLS, inOwnKeep, LAIR_SEAT_TRIES, LAIR_INDEX_CHUNK,
    LAIR_AGGRO_CELLS, LAIR_LEASH_CELLS, LAIR_SEAT_EPS_CELLS,
    OCCUPANCY, LAIR_MAX_PER_TILE, tileThin, occupancyFor, tileHeldExpected, guardState,
    TIER_GUARDS, TIERS, MAX_TIER_GUARDS, STREET_TIER_GUARDS, ZONE_TIER_GUARDS, GATE_TIER_GUARDS, HABITAT_TIER_GUARDS, DAILY_TIERS, dailyGuardDay, FIXED_GUARD_TIERS, ALWAYS_AWAKE_TIERS, FAR_MUL, KIND_ORDER, KIND_LADDER,
    TIER_GROUP, GARRISON_INHERIT,
    capFor, countFor, kindsAt, kindFor, structureKey, tileCellM,
    GROUPS, GROUP_RATE, FOCUS_RULES, NEAR_SHORE_CELLS, memberCount, groupRows, groupFor, expandGroup, seatPolar, seatRadii, flies, nearShore, groupLayout,
    hashKey, ringBox,
    bucketKey,
    newIndex, indexChunk, buildIndex, indexFor, garrisonFor, stepResidency, claimClearedCitadels, resetCitadel,
    assertRingsClear,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
