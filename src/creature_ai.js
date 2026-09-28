// Creature AI helpers — the scene-free pieces of how wild things move and
// react: the slime's gait and charge, flee / stalk pacing, the keep-distance
// angle, monster stride, the ghosts (spawn pass, sun exposure, tick), the
// fished-up slime, the monster rout and wander-off, and the ward trip that
// turns a foe out of Home's or a castle's ring.
//
// Moved verbatim out of the top of app.js. Everything here is a plain
// top-level `const` / `function`, so it stays a global exactly as it was:
// wanderCreatures (scene_creatures.js) and the tests call these by bare name.
// This file loads BEFORE app.js, so an initializer here may only read literals
// or names defined above it in this file — anything from app.js is read at
// CALL time.
//
// What this is NOT: wanderCreatures itself. The per-tick branch logic (the
// `unnoticed` gate, the wards, Home's rout) lives in scene_creatures.js (the
// SceneCreatures mixin on the scene); these are the pieces it calls. See CLAUDE.md "NOTHING HUNTS A BODY" and "Home is a
// CAMPFIRE YOU OWN" before changing a pace or a ward here.

// ── The wild slime's gait ────────────────────────────────────────────────────
// The surface slime OOZES. It is the first enemy in the game and the only one
// above ground, it drifts toward whoever is nearby, and it leeches energy just
// by sitting on you — so how fast it closes is the whole of how threatening it
// is. Two numbers over the base wander (STEP_MS / STEP_M in wanderCreatures):
// how much longer one of its steps takes, and how far that step carries it.
//
// It hopped 0.6 of a cell every 5 s once — 0.84 m/s, near enough a stroll, so a
// slime that noticed you followed you home and there was no leaving it behind
// on foot. That was cut to 0.45 of a cell (0.42 m/s), which bought the walking
// away and overshot: at half a metre a second nothing a slime did read as
// closing on you, and the ooze was a thing you watched rather than a thing you
// dealt with. It is 0.675 now — the same cut, half of it given back, 0.63 m/s
// and still comfortably under the stroll that made it inescapable.
// The ONE number to change is the hop: it is what the amble, the charge and
// Home's rout are all read off, so raising it lifts every pace a slime has by
// the same fraction and keeps the relations between them (a charge is the ooze
// without the lazy beat; a rout is the ooze at the flee pace). The lazy beat
// is the OTHER half of the threat and is not a speed knob — cutting it to
// match the charge's cadence would not make a slime quicker, it would delete
// the charge. Its pursuit is unchanged throughout: half its steps amble your
// way (see the slime branch in wanderCreatures).
// The ceiling is a WALK, and combat.test.js is where it is stated: a charging
// slime is the fastest a slime ever moves, and at 0.945 m/s there is not much
// of that ceiling left — another 50% would put it past a walking pace and take
// the "leave it behind on foot" answer away with it.
const SLIME_STEP_MUL = 1.5;     // × the base wander cadence: a longer, lazier beat
const SLIME_HOP_CELLS = 0.675;  // cells covered by one ooze
// ── Struck, a slime CHARGES ──────────────────────────────────────────────────
// How long a creature keeps reacting to a hit. ONE window, two opposite
// reactions, because the two kinds of prey are opposite: a crow or a deer that
// is struck RUNS (the flee override in wanderCreatures), and a slime that is
// struck COMES AT YOU. Same number for both — being hit is one event — and it
// outlasts the wander step it interrupts, which is what the flee's original
// hand-typed 8000 was picked for.
//
// A charge is NOT a new speed. The slime keeps its hop (SLIME_HOP_CELLS) and
// drops the lazy BEAT it ambles on (SLIME_STEP_MUL), and every hop of the
// charge goes at the player at the monsters' own stalk jitter instead of half
// of them meandering off — so it closes several times faster than an
// unprovoked slime while still, deliberately, being slower than a walk. The
// gait note above is the thing that must not be undone: you can always walk
// away from a slime. You just can't stab one and stroll off any more.
//
// Until Sep 2026 nothing at all came of hitting one: the slime went back to
// its 50/50 meander, and a PET's bite actively pushed it AWAY — the flee
// override was written for birds and applied to every prey kind, so a dog
// worrying a slime shoved it out of its own owner's reach.
const STRUCK_REACTION_MS = 8000;
// ── RUNNING, not wandering ───────────────────────────────────────────────────
// What it costs a creature to be in a hurry, whatever the kind: a stride twice
// its own and a beat half as long, so it covers FOUR times the ground. Two
// things read this pair — the struck-prey flee override (a bird shoved off by
// a pet's teeth) and Home's rout (an enemy driven off the doorstep) — and they
// have to agree, or "it ran" would mean two different speeds depending on who
// did the frightening. Per-KIND flee gaits are a separate thing and stay on
// the kind (CREATURE_BEHAVIOUR's `flee` row): this is the multiplier for the
// kinds that have none, the slime and every cave monster among them.
const FLEE_STRIDE_MUL = 2;
const FLEE_BEAT_MUL = 0.5;
// A rare SHINY animal (isShiny, SHINY_RATE.animal) moves this much faster than
// its plain kind — its wander beat and its bolt from the net alike. One number
// both read. It was 2×, which stacked on the butterfly's own quickness into a
// blur that no net under tier 3 could hold.
const SHINY_SPEED_MUL = 1.5;
// The spread on a COMMITTED approach, in radians: tight enough to read as a
// line rather than a meander. The cave monsters stalk on it (a flyer doubles
// it, which is what makes a bat careen), and a charging slime borrows it —
// once it has been hit, it moves like the things that hunt you.
const STALK_JITTER = 0.8;
// A LAYER'S STALK (the goblin trapper — Combat.monsterLays): it wants to be
// `keepM` off the player, not on top of them. Inside that ring less half a
// cell it steps AWAY, past it plus half a cell it closes, and on the ring it
// circles (a quarter turn either way) — so it stays out of sword reach and
// keeps moving across the line it lays its snares on. The stalk's own jitter.
function keepDistanceAngle(dist, dxp, dyp, keepM, cellM) {
  const toward = Math.atan2(dyp, dxp);
  const j = (Math.random() - 0.5) * STALK_JITTER;
  if (dist < keepM - 0.5 * cellM) return toward + Math.PI + j;
  if (dist > keepM + 0.5 * cellM) return toward + j;
  return toward + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2 + j;
}
// Is this slime still coming for whoever hit it? Derived from `_lastDamagedT`
// — the stamp BOTH damage paths already set, the player's blows and shots via
// _damageEnemy and a pet's teeth in wanderCreatures — so "the player or their
// pet hit it" needs no second flag and cannot drift from the damage that
// caused it. WHERE it is asked is what makes it "if not warded": the charge is
// read below Home's ward in the angle chain (a warded slime is walking out and
// cannot bite), a lit campfire's ring still refuses every target cell inside
// it, and a player who is not there to be charged at — shadowed, or DOWNED on
// an empty bar (`unnoticed` in wanderCreatures) — is not charged at.
function slimeCharging(c) {
  return c.kind === 'slime' && c._lastDamagedT != null
    && Date.now() - c._lastDamagedT < STRUCK_REACTION_MS;
}
// ── The creature sim bubble ──────────────────────────────────────────────────
// The radius, in cells from the player's FEET, inside which a creature thinks:
// wanderCreatures culls on it before anything else, and beyond it a creature is
// frozen at its last position (it does not wander, hunt, leech, shoot or eat a
// crop). The viewport corner is VIEW_CELLS/2 * √2 ≈ 7.8 cells away, so this is
// about half a viewport of margin — enough that a stalking monster or an
// inbound crow is already moving by the time it crosses the glass, instead of
// starting the instant it becomes visible.
// Anything that spawns a creature "just off-screen" for the player to meet must
// land INSIDE this radius (see the crow pump's SPAWN_R), or it lands frozen.
const CREATURE_SIM_CELLS = 12;
// Where the crop-raiding crow pump seats the bird it dispatches (hard mode
// only — see wanderCreatures): past the viewport corner (7.8 cells) so it is
// never seen popping into being, but inside CREATURE_SIM_CELLS so it is
// thinking, and flying at the field, from the tick it is pushed.
const PEST_CROW_SPAWN_CELLS = 10;
// A MONSTER'S STRIDE, in cells: how far one step of the step chain carries it
// (wanderCreatures' stepM) — a full cell for a flier, 0.6 for everything that
// walks. Its PACE is this over its beat (the loop's STEP_MS / its row's
// speed). The ghost does not step — it glides at its row's `mps`.
function monsterStrideCells(mon) { return mon && mon.fly ? 1.0 : 0.6; }
// ── THE KERB: the major roads' buffer, and who may come near it ─────────────
// SAFETY (owner, Sep 2026): there must never be a need, or an advantage, to
// step onto a busy road to get away from something. The worldgen stamps a
// KERB BUFFER beside every MD/LG road (ROAD_CLASS_MAJOR_BUFFER — the band plus
// MAJOR_BUFFER_CELLS, about one base reach, either side), and the creature
// sim reads it three ways, each a REASON on a lane that already exists:
//   · NOTHING HOSTILE STEPS ONTO THE BAND — a refused target cell in the step
//     chain's cell tests, beside water, rocks and fires. Wild fauna neither.
//   · A FAST FOE (isFastFoe — anything that out-runs a walk, WALK_M_S) never
//     steps INTO the buffer from outside it (the same refused-cell test), and
//     never spawns in it (WorldGen.isFoeCell). A slow foe may stand anywhere
//     off the band: you out-walk it.
//   · A PLAYER WHOSE FEET ARE IN THE BUFFER IS WHERE EVERY CHASE ENDS
//     (`kerbLeash` in wanderCreatures): every hostile turns its back — one
//     more reason in the wander-off lane (standDown + an away angle), a lair
//     guard gives up and walks home, a ghost stops short. It reads the
//     player's FEET (playerM), never the camera anchor. Because the band is
//     inside the buffer, standing on the carriageway buys exactly what
//     standing on the pavement beside it does — nothing more — so the road is
//     never a refuge (test/node/kerb_refuge_sim.test.js runs it for every
//     hostile kind).
// What this is NOT: `unnoticed`. A Shadow Powder / an empty bar / a passenger's
// speed hide you from what would notice you, anywhere; the kerb is a place a
// chase gives up at, and only for as long as you stand in it.
// wanderCreatures' base beat (its STEP_MS): one cell a step at this cadence
// is the plain wander; a slime's gait and a monster's `speed` scale it.
const WANDER_STEP_MS = 5000;
// The tile bits under a world-metre point on the surface (0 underground, on
// an unloaded tile, or before its roadClass exists).
function roadClassBitsAt(scene, x, y) {
  if ((scene.depth || 0) !== 0) return 0;
  const edge = scene.tileEdgeM;
  if (!(edge > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
  const tx = Math.floor(x / edge), ty = Math.floor(y / edge);
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
  if (!entry || !entry.roadClass) return 0;
  const N = entry.cellsPerEdge;
  if (!(N > 0)) return 0;
  const ix = Math.floor((x - tx * edge) / (edge / N)), iy = Math.floor((y - ty * edge) / (edge / N));
  if (ix < 0 || iy < 0 || ix >= N || iy >= N) return 0;
  return entry.roadClass[iy * N + ix] | 0;
}
function inKerbAt(scene, x, y) { return !!(roadClassBitsAt(scene, x, y) & WorldGen.ROAD_CLASS_MAJOR_BUFFER); }
function onMajorRoadAt(scene, x, y) { return !!(roadClassBitsAt(scene, x, y) & WorldGen.ROAD_CLASS_MAJOR_BAND); }
// How fast this creature COMES AT YOU, metres per second, at the quickest the
// step chain ever moves it toward the player (a flee or a rout is away, and
// does not count): a ghost's glide (`mps`); the surface slime's charge (its
// hop at the base beat — the struck slime's quickened pace); a monster's
// stride over its `speed`-scaled beat; a hunted game animal's charge (its
// flee stride and beat — `fightsBack`). 0 for a rooted foe or anything that
// never comes at you. Derived from the same numbers the loop moves by, never
// a table of its own.
function foeChaseMps(c, cellM) {
  if (!c) return 0;
  const cm = cellM > 0 ? cellM : WorldGen.CELL_M;
  const m = Combat.monster(c.kind);
  if (m && m.stationary) return 0;
  // A ROSTER foe (enemy_roster.js — the one table rosterEnemyMove moves it
  // by): the quickest of its row's own speeds — the base pace, a slime's
  // charge, a fiend's lunge, a bat's peak flight. A legacy giant alias
  // (giant_goblin …) reads its base kind's row.
  const row = (typeof EnemyRoster !== 'undefined')
    && (EnemyRoster.get(c.kind) || (m && m.giant && EnemyRoster.get(m.giant)));
  if (row) return rosterChaseMps(row);
  if (m && m.mps) return m.mps;
  if (c.kind === 'slime') return SLIME_HOP_CELLS * cm / (WANDER_STEP_MS / 1000);
  if (m && m.speed) return monsterStrideCells(m) * cm * m.speed / (WANDER_STEP_MS / 1000);
  const fb = SpriteLayout.creatureFightsBack(c.kind);
  const flee = fb && SpriteLayout.creatureBehaviour(c.kind)?.flee;
  if (flee) return (flee.stepCells ?? 1) * cm / ((flee.stepMs ?? WANDER_STEP_MS) / 1000);
  return 0;
}
// Every `…speedMetersPerSecond` a roster row's movement declares, at its
// quickest (0 for a row that declares none). Derived from the row, never a
// list of fast kinds: a new kind or a retuned pace classifies itself.
function rosterChaseMps(row) {
  const mv = (row && row.movement) || {};
  let best = 0;
  for (const k of Object.keys(mv)) {
    if (/(^s|S)peedMetersPerSecond$/.test(k) && Number.isFinite(mv[k])) best = Math.max(best, mv[k]);
  }
  return best;
}
// A FAST FOE: one a walking player cannot simply out-walk.
function isFastFoe(c, cellM) { return foeChaseMps(c, cellM) > WALK_M_S; }

// ── SAME SIDE: nothing time-sensitive across a major road ────────────────────
// A timed or place-bound reward seated near the player (a pot of gold's coin
// burst, a guild bounty's pack, anything walkableDestination finds) must be
// reachable WITHOUT crossing an MD/LG band: sameSideField floods the surface
// from the player's cell over a lattice of cellM steps, 4-connected, refusing
// every ROAD_CLASS_MAJOR_BAND cell, out to SAME_SIDE_R_CELLS. A point is same
// side when its lattice node was reached. An unloaded tile (no grid yet) counts as a wall
// (unknown is not safe), and a field that met one is not memoised — the
// street-lamp rule: never stamp a memo read off a tile still loading.
// Memoised on the player's lattice cell + depth; built only on demand (a
// burst, a bounty, a destination), never per frame. Standing ON the band the
// flood starts from the nearest node off it (fixed ring order), so a player
// in the road gets the side they are nearest, not both.
const SAME_SIDE_R_CELLS = 24;
// `fx, fy` (optional): the feet, in world metres — the scene's own playerM
// when omitted (walkableDestination hands over the point it measures from).
function sameSideField(scene, fx, fy) {
  const cm = scene.cellM, edge = scene.tileEdgeM;
  const px = fx != null ? fx : scene.startWorldM.x + scene.playerM.x;
  const py = fy != null ? fy : scene.startWorldM.y + scene.playerM.y;
  const R = SAME_SIDE_R_CELLS, W = 2 * R + 1;
  const cx = Math.floor(px / cm), cy = Math.floor(py / cm);
  const key = `${scene.depth || 0}|${cx}|${cy}`;
  const memo = scene._sameSide;
  if (memo && memo.key === key) return memo;
  const ox = (cx + 0.5) * cm - R * cm, oy = (cy + 0.5) * cm - R * cm;
  const reached = new Uint8Array(W * W);
  const field = { key, ox, oy, cm, R, W, reached,
    test(x, y) {
      const i = Math.round((x - this.ox) / this.cm), j = Math.round((y - this.oy) / this.cm);
      return i >= 0 && j >= 0 && i < this.W && j < this.W && this.reached[j * this.W + i] === 1;
    } };
  // Underground there are no roads: everything in range is the same side.
  if ((scene.depth || 0) !== 0 || !(edge > 0) || !(cm > 0)) { reached.fill(1); return field; }
  let partial = false;
  const wall = new Uint8Array(W * W);   // 1 open, 2 blocked
  const blocked = (i, j) => {
    const k = j * W + i;
    if (!wall[k]) {
      const x = ox + i * cm, y = oy + j * cm;
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(Math.floor(x / edge), Math.floor(y / edge)));
      if (!entry || !entry.grid) { partial = true; wall[k] = 2; }
      else wall[k] = (roadClassBitsAt(scene, x, y) & WorldGen.ROAD_CLASS_MAJOR_BAND) ? 2 : 1;
    }
    return wall[k] === 2;
  };
  let si = R, sj = R;
  if (blocked(si, sj)) {
    let found = false;
    for (let r = 1; r <= R && !found; r++) {
      for (let d = -r; d <= r && !found; d++) {
        for (const [i, j] of [[R + d, R - r], [R + r, R + d], [R - d, R + r], [R - r, R - d]]) {
          if (!blocked(i, j)) { si = i; sj = j; found = true; break; }
        }
      }
    }
    if (!found) return field;
  }
  const queue = new Int32Array(W * W);
  let head = 0, tail = 0;
  reached[sj * W + si] = 1; queue[tail++] = sj * W + si;
  while (head < tail) {
    const k = queue[head++], i = k % W, j = (k / W) | 0;
    for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (ni < 0 || nj < 0 || ni >= W || nj >= W) continue;
      const nk = nj * W + ni;
      if (reached[nk] || blocked(ni, nj)) continue;
      reached[nk] = 1; queue[tail++] = nk;
    }
  }
  if (!partial) scene._sameSide = field;
  return field;
}
function sameSideAs(scene, x, y, fx, fy) { return sameSideField(scene, fx, fy).test(x, y); }
// ── GHOSTS ───────────────────────────────────────────────────────────────────
// After dark (and at any hour on an even cave level — ghostsHaunt) a few
// ghosts rise in the dark around the player, hover a moment,
// then rush them: a touch costs Combat's GHOST_TOUCH_DMG (the mode, the shield
// and armour have their say, as with every blow) and spends the ghost; light
// burns them (Lighting.brightnessAt, the lightmap's own model). Their row is
// combat.js MONSTERS.ghost (`spawn: 'night'` — never the cave bag, no giant),
// their mover is ghostTick below (SpriteLayout `haunts`), and they are SESSION
// state exactly like the pest crow: pushed into the player's tile entry with an
// id minted off the clock, never generated and never seated on a tile — a
// spent or slain ghost's marker in save.caught is pruned by the same pass the
// pest crow's is (wanderCreatures).
//   "After dark" is the daylight (Lighting.daylight, 1 noon .. 0 night) under
// GHOST_DARK_DAYLIGHT: 0.5 is the sun on the horizon, and 0.25 is a few
// degrees under it — dusk gone to dark.
//   Underground there is no night, so the roster's haunted-depth interval
// gates the LEVEL instead: every second depth (2, 4, 6, …) is haunted at every
// hour, while odd levels stay empty. The sun never reaches them either
// (ghostSunExposureAt).
const GHOST_DARK_DAYLIGHT = 0.25;
const GHOST_CAVE_EVERY = EnemyRoster.GHOST_SCALING.hauntedDepthEvery;
// (THE OLD STONES used to be a second reason here - from DUSK inside a
// church's or cemetery's zone, twice as often, fanned from the stones. Gone,
// Sep 2026, owner: it pulled players to churchyards at closing time and sent
// them fleeing through dark streets. A churchyard's headstone can still raise
// one when TAPPED (raiseGhostAt); the night itself is the same everywhere.)
// Is this a time and place ghosts rise? One predicate the pump reads: the
// surface after dark, or a haunted cave level at any hour.
function ghostsHaunt(depth, day) {
  if (depth > 0) return depth % GHOST_CAVE_EVERY === 0;
  return day < GHOST_DARK_DAYLIGHT;
}
// The roster sets the cadence and jitter so the pump and every balance tool
// answer to the same table. Five minutes plus or minus one minute reads as
// "every so often", not as a clock.
const GHOST_SPAWN_MS = EnemyRoster.GHOST_SCALING.cadenceSeconds * 1000;
const GHOST_SPAWN_JITTER_MS = EnemyRoster.GHOST_SCALING.jitterSeconds * 1000;
// A group rises together: its members' angles about the player fan across
// this much of a turn (radians), on the pest crow's ring (PEST_CROW_SPAWN_CELLS
// — past the viewport corner, inside the sim bubble, for the same reason).
const GHOST_GROUP_SPREAD = 1.2;
// "Dark": a spawn point whose added light (Lighting.brightnessAt) is at most
// this. Past the player's ramp (it ends one cell past the viewport corner) the
// player adds nothing, so what this refuses is a campfire, a lamp, a lit
// building — anywhere a light is standing.
const GHOST_SPAWN_DARK = 0.02;
// The hover: how long a risen ghost bobs where it rose before it rushes.
const GHOST_HOVER_MS = 2000;
// A touch: the ghost within this many cells of the player's feet.
const GHOST_TOUCH_CELLS = 0.5;
// THE BURN. A ghost's damage per second is its whole pool, times its light
// exposure, over GHOST_PLATEAU_BURN_S — where exposure 1 is the player's reach
// plateau at night at its brightest (Lighting.profile(scene, 0).lit, the
// plateau's derived level — a UNIT here, not a source). Daylight past
// GHOST_DARK_DAYLIGHT burns too (ghostSunExposure — 1 at noon), so a ghost
// caught out at dawn is gone.
//   THE PLAYER'S OWN GLOW DOES NOT BURN IT: exposure is brightnessAt with
// `playerGlow: false` — no plateau, no ramp, at any Inner Light reach. What
// burns it is a light the player CARRIES or STANDS BY: the hand torch (a
// collected source, so it stays in), a campfire, a lit lamp, a lit building.
// No light's ring refuses its step either — it is not afraid of the light, it
// comes straight in and burns if the light is one that burns it. A campfire
// does more than burn: it ROUTS the ghost (fireWardTrip, the ward latch).
//   Why 13: a torch must burn it out before it arrives. At its run
// (Combat.GHOST_SPEED_MPS, 3 m/s) from the spawn ring, the torch race is won
// up to ~17 and lost by 22 (ghosts.test.js runs it); 13 keeps a margin.
// Home, a claimed castle and a campfire rout it (the ward).
const GHOST_PLATEAU_BURN_S = 13;
// The burn is banked on this beat, not every frame (brightnessAt runs the
// collectors).
const GHOST_LIGHT_TICK_MS = 250;
// A ghost that has not found the player in this long fades away (spent, no
// coin) — a night of dodging must not leave the neighbourhood full of them.
const GHOST_LIFETIME_MS = 180000;
// The wait to the next group: GHOST_SPAWN_MS ± GHOST_SPAWN_JITTER_MS.
function ghostSpawnDelay(r) { return GHOST_SPAWN_MS + (2 * r - 1) * GHOST_SPAWN_JITTER_MS; }
// The sun's share of a ghost's exposure: 0 while it is dark enough for them,
// rising to a full plateau's worth at noon.
function ghostSunExposure(day) {
  return clamp01((day - GHOST_DARK_DAYLIGHT) / (1 - GHOST_DARK_DAYLIGHT));
}
// …and where the sun can reach it: nowhere underground (Lighting.daylight
// knows nothing of depth, so a cave ghost at noon must be told).
function ghostSunExposureAt(scene, wall) {
  return (scene.depth || 0) > 0 ? 0 : ghostSunExposure(Lighting.daylight(scene, wall));
}
// Surface haunts use the same declared habitat as ordinary foes. Evaluate
// the candidate's fixed world point, never its later chase position; crossing
// a biome boundary during pursuit does not make a ghost disappear.
function ghostSurfaceEligible(scene, x, y, cell) {
  const habitat = EnemyRoster.get('ghost').surface;
  const home = scene._starterTrailAnchor?.() || scene.save?.starterCratesAt || scene.startWorldM;
  if (!home || !Number.isFinite(home.x) || !Number.isFinite(home.y)) return false;
  const distance = Math.hypot(x - home.x, y - home.y);
  if (distance < habitat.minDistance || (habitat.maxDistance != null && distance >= habitat.maxDistance)) return false;
  return habitat.biomes.some(name => WorldGen.T[name] === cell.type);
}
// THE NIGHT PUMP — seats a group of ghosts in the dark about the player, once
// every ghostSpawnDelay while ghostsHaunt says so (the surface after dark, an
// even cave level always). Returns how many rose. The timer is disarmed
// whenever it doesn't, so the first group comes one delay after dark, a load,
// or the stairs down to a haunted level — never at once.
// `wardPts` / `wardR2` are wanderCreatures' Home + claimed-castle wards: a
// ghost never rises inside a ring that would only rout it.
function ghostSpawnPass(scene, now, px, py, pcW, homePos, castleWards, wardR2, caughtSet) {
  const depth = scene.depth || 0;
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(pcW.tx, pcW.ty));
  // Daylight is only asked on the surface (a cave level has no sun).
  if (!ghostsHaunt(depth, depth > 0 ? 0 : Lighting.daylight(scene, Date.now()))) {
    scene._nextGhostT = null; return 0;
  }
  // The stairs repoint the level: a timer armed on another depth is not this
  // level's, so a group can't rise the instant you arrive.
  if (scene._ghostDepth !== depth) { scene._ghostDepth = depth; scene._nextGhostT = null; }
  if (scene._nextGhostT == null) { scene._nextGhostT = now + ghostSpawnDelay(Math.random()); return 0; }
  if (now < scene._nextGhostT) return 0;
  scene._nextGhostT = now + ghostSpawnDelay(Math.random());
  if (!entry || !entry.creatures) return 0;
  let near = 0;
  WorldGen.forEachItemNear('creatures', pcW.tx, pcW.ty, (c) => {
    if (SpriteLayout.creatureHaunts(c.kind) && !caughtSet.has(c.id)) near++;
  });
  const profile = EnemyRoster.ghostProfile(depth);
  const want = Math.min(profile.nearMax - near,
    profile.groupMin + Math.floor(Math.random() * (profile.groupMax - profile.groupMin + 1)));
  const R = PEST_CROW_SPAWN_CELLS * scene.cellM;
  const base = Math.random() * Math.PI * 2;
  let made = 0;
  for (let i = 0; made < want && i < want * 8; i++) {
    // The fan first; if the dark is not there, anywhere on the ring.
    const a = i < want * 4 ? base + (Math.random() - 0.5) * GHOST_GROUP_SPREAD : Math.random() * Math.PI * 2;
    const x = px + Math.cos(a) * R, y = py + Math.sin(a) * R;
    const cell = scene.cellAt(x, y);
    if (!cell.loaded || (depth === 0 && !ghostSurfaceEligible(scene, x, y, cell))) continue;
    // A ghost is a FAST foe: never risen in a major road's kerb buffer.
    if (inKerbAt(scene, x, y)) continue;
    if (wardTrip({ x, y }, homePos, castleWards, wardR2)) continue;
    if (Lighting.brightnessAt(scene, x, y) > GHOST_SPAWN_DARK) continue;
    const ghost = makeGhost(x, y, now, pcW.tx, pcW.ty, made);
    ghost.kind = depth >= 6 && Math.random() < 1 / 3 ? 'pink_ghost' : 'ghost';
    ghost._artScale = profile.sizeMultiplier;
    entry.creatures.push(ghost);
    made++;
  }
  return made;
}
// One risen ghost — session state, id minted off the clock (the pest crow's
// shape, pruned by the same pass). The pump and a disturbed headstone both
// mint through here.
function makeGhost(x, y, now, tx, ty, tag) {
  return WorldGen.makeCreature('ghost', x, y,
    `ghost_${tx}_${ty}_${Math.floor(now)}_${tag}_${Math.floor(Math.random() * 1e4)}`,
    { _spawnT: now });
}
// A ghost raised AT a point, at any hour — a tapped headstone
// is an explicit player-triggered encounter, outside ordinary habitat rules.
// A tapped headstone
// (INTERACTABLES.headstone, src/zones.js). Pushed into the tile holding the
// point; refused (null) past the roster's nearby cap, or on an unloaded tile.
function raiseGhostAt(scene, x, y, now, tag) {
  const edge = scene.tileEdgeM;
  if (!(edge > 0)) return null;
  const tx = Math.floor(x / edge), ty = Math.floor(y / edge);
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
  if (!entry || !entry.creatures) return null;
  // Never in a major road's kerb buffer (a ghost is a fast foe — see THE KERB).
  if (inKerbAt(scene, x, y)) return null;
  const caught = new Set((scene.save && scene.save.caught) || []);
  let near = 0;
  WorldGen.forEachItemNear('creatures', tx, ty, (c) => {
    if (SpriteLayout.creatureHaunts(c.kind) && !caught.has(c.id)) near++;
  });
  const nearMax = EnemyRoster.ghostProfile(scene.depth || 0)?.nearMax ?? 0;
  if (near >= nearMax) return null;
  const g = makeGhost(x, y, now, tx, ty, tag);
  entry.creatures.push(g);
  return g;
}
// ── THE FISHED SLIME ─────────────────────────────────────────────────────────
// Now and then a cast hooks a wild slime instead of a fish (items.js
// FISH_SLIME_CHANCE, rolled by the fishing handler in interact.js). It lands on
// a land cell BESIDE the player — one cell out, any of the eight directions,
// never water, a road or a building (WorldGen.isWalkable) — and comes up
// ANGRY: its `_lastDamagedT` is stamped at the landing, so slimeCharging reads
// it as struck and it charges for STRUCK_REACTION_MS, leeching the moment it
// is in arm's reach. That is the existing "a struck slime charges" lane with a
// second reason (it was yanked out of the water), not a new aggression flag;
// every ward that turns a struck slime back (Home, a fire's ring, `unnoticed`)
// turns this one back too.
//   It is SESSION state exactly like the ghost and the pest crow: pushed into
// the player's tile entry with an id minted off the clock
// (`fished_slime_<tx>_<ty>_…`), pruned from save.caught by the same pass.
// Returns the creature, or null when no cell beside the player will take it
// (the handler then pays the fish instead).
function fishedSlimeSpawn(scene, now, px, py, pcW) {
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(pcW.tx, pcW.ty));
  if (!entry || !entry.creatures) return null;
  const base = Math.floor(Math.random() * 8);
  for (let k = 0; k < 8; k++) {
    const a = (base + k) * Math.PI / 4;
    const x = px + Math.cos(a) * scene.cellM, y = py + Math.sin(a) * scene.cellM;
    const cell = scene.cellAt(x, y);
    if (!cell.loaded || !WorldGen.isWalkable(cell.type)) continue;
    const c = WorldGen.makeCreature('slime', x, y,
      `fished_slime_${pcW.tx}_${pcW.ty}_${Math.floor(now)}_${Math.floor(Math.random() * 1e4)}`,
      { _lastDamagedT: Date.now() });
    entry.creatures.push(c);
    return c;
  }
  return null;
}
// ── WHERE A THING CAN BE PUT NEAR THE PLAYER ────────────────────────────────
// walkableDestination — the one answer to "a free surface cell about `dist`
// cells from the player": walkable, off the road band, under nothing already
// there. It asks the SHARED spawn rule (WorldGen.isSpawnCell with the tile's
// own entry._spawnOpts — the road mask and occupied set spawnInTile stashed),
// never a second reading of "is this a road" (CLAUDE.md "Nothing spawns on a
// road"). The scene's findWalkableDestination (scene_creatures.js) is the
// wrapper callers use; the guildhall's bounty (app.js) is the first.
//   DETERMINISTIC: the first angle comes from `opts.seed` (fnv1a, util.js) and
// the ring order is fixed — `dist`, then one nearer, one farther, two nearer,
// … down to one cell and out to twice `dist` — each ring walked from that
// angle in steps of about a cell. First hit wins, no Math.random.
//   Each cell is resolved on ITS tile's own grid (entry.cellsPerEdge — the
// world-frame rule), and returned as { tx, ty, ix, iy, x, y, n, entry } with
// x/y the cell's centre in world metres. Null underground, when nothing
// within reach will take it, or on a tile that has not run spawnInTile yet
// (no _spawnOpts — the shared rule is not ready to answer).
// `opts.accept(x, y)` may refuse a candidate for the caller's own reason
// (the bounty keeps out of Home's ward ring).
//   SAME SIDE, always: a destination is only one the player can reach without
// crossing a major road's band (sameSideAs — the flood from their cell), so
// nothing it seats ever sits across a busy road from them.
//   `opts.foe`: the thing seated is alive and hostile (a bounty's pack) — the
// seat rule is WorldGen.isFoeCell, which also keeps it out of the kerb buffer.
function walkableDestinationRings(dist) {
  const d = Math.max(1, Math.round(dist));
  const out = [d];
  for (let k = 1; k <= d; k++) {
    if (d - k >= 1) out.push(d - k);
    out.push(d + k);
  }
  return out;
}
function walkableDestination(scene, px, py, dist, opts) {
  const o = opts || {};
  if ((scene.depth || 0) !== 0) return null;
  const edge = scene.tileEdgeM, cellM = scene.cellM;
  if (!(edge > 0) || !(cellM > 0)) return null;
  const a0 = (fnv1a(String(o.seed ?? '')) / 4294967296) * Math.PI * 2;
  for (const r of walkableDestinationRings(dist)) {
    const steps = Math.max(8, Math.ceil(2 * Math.PI * r));
    for (let k = 0; k < steps; k++) {
      const a = a0 + (k / steps) * Math.PI * 2;
      const wx = px + Math.cos(a) * r * cellM, wy = py + Math.sin(a) * r * cellM;
      const tx = Math.floor(wx / edge), ty = Math.floor(wy / edge);
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
      if (!entry || !entry.grid || !entry._spawnOpts) continue;
      const N = entry.cellsPerEdge;
      if (!(N > 0)) continue;
      const cm = edge / N;
      const ix = Math.floor((wx - tx * edge) / cm), iy = Math.floor((wy - ty * edge) / cm);
      const seat = o.foe ? WorldGen.isFoeCell : WorldGen.isSpawnCell;
      if (!seat(entry.grid, N, N, ix, iy, entry._spawnOpts)) continue;
      const x = tx * edge + (ix + 0.5) * cm, y = ty * edge + (iy + 0.5) * cm;
      if (!sameSideAs(scene, x, y, px, py)) continue;
      if (o.accept && !o.accept(x, y)) continue;
      return { tx, ty, ix, iy, x, y, n: N, entry };
    }
  }
  return null;
}
// A CAMPFIRE ROUTS A GHOST — Home's mechanism (the ward latch: turned onto
// an away-from-the-fire angle and run to the sim bubble's edge), not the
// fire's own ward on other foes (a refused target cell, which held a ghost
// hovering at the ring). A ghost is not afraid of light — it comes straight
// through the player's glow — but a fire drives it off. This is a second
// REASON on the ward lane, asked only for a haunting kind: the nearest
// campfire on this depth whose FIRE_REST_R ring the ghost has crossed, or null.
function fireWardTrip(scene, c) {
  const fires = scene.save && scene.save.fires;
  if (!fires || !fires.length) return null;
  let best = null, bestD2 = (FIRE_REST_R * scene.cellM) * (FIRE_REST_R * scene.cellM);
  for (const f of fires) {
    if (!PlacedFloor.onDepth(f, scene.depth ?? 0)) continue;
    const dx = c.x - f.x, dy = c.y - f.y, d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) { best = f; bestD2 = d2; }
  }
  return best;
}
// ONE GHOST'S TICK — its mover, its burn, its touch. Returns what became of it:
//   'touch'   it reached the player (wanderCreatures lands the blow and spends it)
//   'burned'  the light finished it (_damageEnemy has already paid its coin)
//   'faded'   its GHOST_LIFETIME_MS ran out
//   null      it is still about.
// `pace` is metres per ms (its row's `mps`, Combat.GHOST_SPEED_MPS). HOVER first, in
// place; then a committed line at the player's feet at that pace, over any
// terrain (it is a ghost) and into any light — it is not afraid of the light,
// the light only burns it (no ring refuses its step, unlike the campfire's
// ward on other foes). Warded
// (Home, a claimed castle, and for a ghost a campfire — fireWardTrip;
// `warded`, the same latch every foe wears) it runs
// straight away from the ward; `unnoticed` (NOTHING HUNTS A BODY, or a Shadow
// Powder) it hovers where it is. Neither touches.
function ghostTick(scene, c, now, px, py, unnoticed, warded, pace) {
  if (c._spawnT == null) c._spawnT = now;
  const dt = c._ghostT != null ? Math.max(0, now - c._ghostT) : 0;
  c._ghostT = now;
  if (c._burnT == null) c._burnT = now;
  if (now - c._burnT >= GHOST_LIGHT_TICK_MS) {
    const burnS = (now - c._burnT) / 1000;
    c._burnT = now;
    const wall = Date.now();
    const exposure = Lighting.brightnessAt(scene, c.x, c.y, wall, { playerGlow: false }) / Lighting.profile(scene, 0).lit
      + ghostSunExposureAt(scene, wall);
    if (exposure > 0 && scene._damageEnemy(c, Combat.maxHp(c) * exposure * burnS / GHOST_PLATEAU_BURN_S, 'light')) {
      return 'burned';
    }
  }
  if (now - c._spawnT >= GHOST_LIFETIME_MS) return 'faded';
  if (now - c._spawnT < GHOST_HOVER_MS) return null;
  let ang = null;
  if (warded) ang = Math.atan2(c.y - c._wardFrom.y, c.x - c._wardFrom.x);
  else if (!unnoticed) ang = Math.atan2(py - c.y, px - c.x);
  if (ang == null) return null;
  const toPlayer = Math.hypot(px - c.x, py - c.y);
  const step = Math.min(pace * dt, warded ? Infinity : toPlayer);
  const nx = c.x + Math.cos(ang) * step, ny = c.y + Math.sin(ang) * step;
  // It glides over any terrain — but a ghost is a FAST foe, so it never
  // crosses INTO a major road's kerb buffer (THE KERB). One already inside
  // (risen before the rule, or routed through it) may still leave.
  if (inKerbAt(scene, nx, ny) && !inKerbAt(scene, c.x, c.y)) return null;
  c.x = nx; c.y = ny;
  if (Math.abs(Math.cos(ang)) > 1e-6) c._faceFlip = Math.cos(ang) < 0;
  if (warded) return null;
  return Math.hypot(px - c.x, py - c.y) <= GHOST_TOUCH_CELLS * scene.cellM ? 'touch' : null;
}
// How long a departing crow keeps flying away (_crowDepart): [base, spread]
// ms, so ~2.5–4 minutes — after a meal, or once the player starts hunting it.
const CROW_DEPART_MS = [150000, 90000];
// ── A foe WANDERS OFF now and then ───────────────────────────────────────────
// Every few minutes each hostile (Combat.isEnemy — the wild slime and every
// cave monster; never a pet, never a lair guard, whose seat and leash are
// Lairs.guardState's) turns its back on the player and walks away. Without it
// a foe that cannot reach you — a slime refused at a campfire's ring, a cave
// monster held off by a fire at the stairs — stalks the ring's edge forever,
// and a long rest at a fire ends with a wall of them piled against it.
//   HOW FAR: out to the edge of its RANGE × its kind's retreat (Combat.retreatMul,
// 1 unless the monster row says less) × [1, WANDER_OFF_MAX_MUL]. A foe has
// no notice radius of its own — it stalks you from anywhere it thinks at all —
// so its range IS the sim bubble, CREATURE_SIM_CELLS from the player's feet
// (the same edge Home's rout drives a foe out to). Past 1× it has left the
// bubble and freezes where it stands; the extra only plays out if you follow
// it, which is what makes the distance read as a choice rather than a leash.
//   HOW OFTEN: MIN + random × SPREAD of time it has spent THINKING (in the
// bubble), not wall time — a foe met after an hour away must not turn tail on
// the first frame just because its clock ran out while it was frozen.
//   NOT A NEW MOVER: while it goes, `wanderOff` is one more reason in the
// wanderCreatures lanes that already exist — `standDown` (no leech, no hit,
// no shot, no charge), the routed flee pace, and an away angle in the chain
// every step shares (so walls, water, rocks and fires refuse its cells as
// they refuse anybody's; Home's latch still trips if it strays into HOME_R,
// and Home's ward outranks it). Arriving, or the timeout, ends it and
// schedules the next one. Session state on the live creature (like `_hp`),
// never the save; a tile rebuild carries `creatures`, so it survives one.
const WANDER_OFF_MIN_MS = 120000;       // 2 minutes…
const WANDER_OFF_SPREAD_MS = 180000;    // …to 5, per foe, rerolled each time
const WANDER_OFF_MAX_MUL = 2;           // distance = range × [1, 2]
const WANDER_OFF_TIMEOUT_MS = 60000;    // gives up and turns back after this
// A tick gap longer than this means the foe was out of the bubble (or the tab
// was asleep); only this much of it counts toward the next wander-off.
const WANDER_OFF_TICK_CAP_MS = 1000;
// Start a wander-off NOW: the foe turns its back and walks away from the
// player to a rolled distance past the sim bubble's edge (the usual random
// range), standing down the whole way (no leech, no hit, no shot, no charge).
// The schedule in monsterWanderingOff calls it when its clock runs out; the
// Potion of Thunder calls it on every foe the bolt leaves standing. One
// retreat, two reasons.
function monsterRout(c, now, cellM) {
  c._wanderOffInMs = null;
  c._wanderOffUntilT = now + WANDER_OFF_TIMEOUT_MS;
  c._wanderOffDistM = CREATURE_SIM_CELLS * cellM * Combat.retreatMul(c.kind)
    * (1 + Math.random() * (WANDER_OFF_MAX_MUL - 1));
  // Turn NOW rather than finishing a hop at the player. (A creature that has
  // never chosen a step is seeded by the loop's own init; leave it to that.)
  if (c._nextChooseT != null) c._nextChooseT = now;
}
// Is this foe wandering off right now? Advances its schedule, starts a
// wander-off when the schedule runs out and ends one on arrival (distM, the
// foe's distance from the player, past its rolled distance) or on the timeout.
// Only called for a wild, non-lair enemy; see the block above for the rest.
function monsterWanderingOff(c, now, distM, cellM) {
  const dt = c._wanderOffSimT != null
    ? Math.min(WANDER_OFF_TICK_CAP_MS, Math.max(0, now - c._wanderOffSimT)) : 0;
  c._wanderOffSimT = now;
  if (c._wanderOffUntilT != null) {
    if (now < c._wanderOffUntilT && distM < c._wanderOffDistM) return true;
    c._wanderOffUntilT = null;           // arrived, or gave up: back to normal
    c._wanderOffDistM = null;
    c._wanderOffInMs = null;             // and the next one is rolled below
  }
  if (c._wanderOffInMs == null) c._wanderOffInMs = WANDER_OFF_MIN_MS + Math.random() * WANDER_OFF_SPREAD_MS;
  c._wanderOffInMs -= dt;
  if (c._wanderOffInMs > 0) return false;
  monsterRout(c, now, cellM);
  return true;
}

// Which ward, if any, a foe at c has just crossed into: Home first, then the
// nearest claimed-castle turret, each on the one ring (r2 = HOME_R², metres).
// Returns the ward's point (the rout runs away from it) or null. Pure, so the
// ward test drives it headless.
function wardTrip(c, homePos, castleWards, r2) {
  if (homePos) {
    const dx = c.x - homePos.x, dy = c.y - homePos.y;
    if (dx * dx + dy * dy <= r2) return homePos;
  }
  let best = null, bestD2 = r2;
  for (const t of castleWards || []) {
    const dx = c.x - t.x, dy = c.y - t.y, d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) { best = t; bestD2 = d2; }
  }
  return best;
}

// ── What a hunter of the player's may take ───────────────────────────────────
// A PEST CROW: the bird the hard-mode pump dispatches at a planted field
// (wanderCreatures mints its id `pest_crow_<tx>_<ty>_…`, the same prefix the
// save.caught prune reads). A wild crow the tile spawned is game, never a pest.
function isPestCrow(c) {
  return !!c && typeof c.id === 'string' && c.id.startsWith('pest_crow_');
}
// ONE predicate for wanderCreatures' pet scan: may `hunterKind` (a tame pet,
// or a summoned ally) go for creature `cr`? Two reasons, one lane:
//   a PET takes the kinds on its row's `prey` list (a cat crows; a dog deer
//     and slimes);
//   a hunter that `preysOnFoes` (the spirit raven) takes every Combat.isEnemy
//     foe and every pest crow — never a deer, a wild crow or anything tame.
// Nobody's hunter takes a tamed (released_) animal. The caller still skips
// what is already caught.
function huntsPrey(hunterKind, cr) {
  if (!cr || (typeof cr.id === 'string' && cr.id.startsWith('released_'))) return false;
  if (SpriteLayout.preysOnFoes(hunterKind)) return Combat.isEnemy(cr) || isPestCrow(cr);
  const prey = SpriteLayout.creaturePrey(hunterKind);
  return !!prey && prey.has(cr.kind);
}

// Shared crow/bat interpolation. A quadratic leg's peak is twice its mean;
// hostile flight uses this fact to cap actual metres/second, not just averages.
function creatureFlightEase(t) {
  t = Math.max(0, Math.min(1, t));
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

// Every segment is swept, including fast flights and lunges. Flying permits
// low terrain, never rock walls, buildings, unloaded cells or placed rocks.
function enemyCanStep(scene, c, row, x, y) {
  const cell = scene.cellAt(x, y);
  if (!cell.loaded) return false;
  if (scene._cellBlocked(x, y) || WorldGen.isBuildingTerrain(cell.type)) return false;
  if (scene.placedRockSet?.size) {
    const { cellIX, cellIY } = worldMetersToAbsCell(scene, x, y);
    if (scene.placedRockSet.has(cellKeyFromAbsCell(cellIX, cellIY))) return false;
  }
  if (row.movement.pattern !== 'orbit_swoop' && Combat.faunaBlocksCell(cell.type)) return false;
  // THE KERB (above): nothing hostile — flier or not — steps onto a major
  // road's band, and a FAST foe never steps INTO the buffer from outside it
  // (one already inside may leave). The same refused-cell reasons the old
  // step chain reads, on the roster's swept mover.
  const road = roadClassBitsAt(scene, x, y);
  if (road & WorldGen.ROAD_CLASS_MAJOR_BAND) return false;
  if ((road & WorldGen.ROAD_CLASS_MAJOR_BUFFER) && !inKerbAt(scene, c.x, c.y)
      && isFastFoe(c, scene.cellM)) return false;
  const fireAverts = !c.lair && (row.tier <= FIRE_WARD_MAX_DEPTH);
  return !(fireAverts && scene._nearAny?.('fires', x, y, FIRE_REST_R));
}
function enemySweep(scene, c, row, x, y) {
  const dx = x - c.x, dy = y - c.y;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (scene.cellM * 0.2)));
  const sx = c.x, sy = c.y;
  for (let i = 1; i <= n; i++) {
    const nx = sx + dx * i / n, ny = sy + dy * i / n;
    if (!enemyCanStep(scene, c, row, nx, ny)) return false;
    c.x = nx; c.y = ny;
  }
  if (Math.abs(dx) > 1e-6) c._faceFlip = dx < 0;
  return true;
}

// A wind-up is cancellable: leaving range, hiding or a ward cancels it.
// Cooldowns start when the attack starts, so the declared interval includes
// the wind-up rather than accidentally extending every attack cycle.
function enemyAttackReady(c, row, now, eligible) {
  if (!eligible) { c._attackWindupUntil = null; return false; }
  if (c._attackWindupUntil != null) {
    if (now < c._attackWindupUntil) return false;
    c._attackWindupUntil = null;
    return true;
  }
  if (now < (c._attackNextT || 0)) return false;
  c._attackNextT = now + row.damageIntervalSeconds * 1000;
  c._attackWindupUntil = now + row.windupSeconds * 1000;
  if (row.windupSeconds > 0) return false;
  c._attackWindupUntil = null;
  return true;
}
function rosterEnemyAttack(scene, c, row, now, px, py, inactive, dt) {
  const dist = Math.hypot(px - c.x, py - c.y);
  const attentive = !inactive && !Combat.playerDowned(scene.save.energy)
    && dist <= row.visionCells * scene.cellM;
  const clear = attentive && Combat.lineOfFire(c.x, c.y, px, py,
    (x, y) => scene._cellBlocked(x, y), scene.cellM);
  if (row.aura && clear && dist <= row.aura.radiusCells * scene.cellM) {
    const a = row.aura;
    const raw = a.rawDps * Combat.powerMul(c);
    const shield = (scene.save.shieldPotionUntil ?? 0) > Date.now() ? 0.5 : 1;
    // Energy.set stores integers. Bank fractions BEFORE calling the scene's
    // loss writer so 60 tiny frames cannot each become a minimum-one hit.
    const loss = Combat.playerDamageRate(raw * shield, scene.save.armor, dt,
      { packetSeconds: a.mitigationPacketSeconds });
    scene._enemyAuraFraction = (scene._enemyAuraFraction || 0) + loss;
    const whole = Math.floor(scene._enemyAuraFraction + 1e-9);
    if (whole > 0) {
      scene._enemyAuraFraction -= whole;
      scene._monsterDmgAccum = (scene._monsterDmgAccum || 0)
        + scene._losePlayerEnergy(whole, { closeShop: true });
    }
  }
  if (row.attackType === 'trap') {
    if (enemyAttackReady(c, row, now, clear && dist <= row.range * scene.cellM)) {
      scene._trapperLay(c, now, px, py);
    }
    return;
  }
  if (!row.dmg || row.attackType === 'touch') return;
  const swoop = row.movement.pattern === 'orbit_swoop';
  const eligible = clear && dist <= row.range * scene.cellM
    && (!swoop || (c._batSwooping && !c._batHit));
  if (!enemyAttackReady(c, row, now, eligible)) return;
  c._attackT0 = now;
  c._attackUntil = now + Math.max(600, row.windupSeconds * 1000);
  const raw = row.dmg * Combat.powerMul(c);
  if (row.attackType === 'projectile') {
    const shot = Combat.monsterShot(c.x, c.y, px, py, scene.cellM,
      raw * row.attackHits, row.attackHits);
    if (shot) {
      shot.projectile = row.projectile || (row.id === 'goblin_archer' ? 'arrow' : 'enemy_magic');
      shot.enemyKind = row.id;
      (scene._shots ||= []).push(shot);
    }
  } else {
    const damage = Combat.incomingDamage(scene.save, raw);
    const lost = scene._losePlayerEnergy(damage, { closeShop: true });
    scene._monsterDmgAccum = (scene._monsterDmgAccum || 0) + lost;
    const condition = Combat.monster(c.kind)?.condition;
    if (lost > 0 && condition) scene._applyCondition(condition);
  }
  if (swoop) c._batHit = true;
}

function rosterEnemyMove(scene, c, row, now, px, py, inactive, routed, lairState, dt) {
  const m = row.movement;
  const dist = Math.hypot(px - c.x, py - c.y);
  const sees = !inactive && dist <= row.visionCells * scene.cellM;
  let angle = Math.atan2(py - c.y, px - c.x);
  let speed = m.speedMetersPerSecond;
  let maxDistance = Math.max(0, dist - scene.cellM * 0.35);
  if (c._lastDamagedT && Date.now() - c._lastDamagedT >= 20 * 60 * 1000) {
    c._hp = Combat.maxHp(c); c._lastDamagedT = null;
  }
  if (routed) {
    const from = c._wardFrom || { x: px, y: py };
    angle = Math.atan2(c.y - from.y, c.x - from.x);
    maxDistance = Infinity;
    // Retreat is brisk but never exceeds the roster's fastest flight.
    speed = Math.min(6, speed * FLEE_STRIDE_MUL / FLEE_BEAT_MUL);
    c._batFlight = null; c._batSwooping = false;
  } else if (lairState === 'return') {
    angle = Math.atan2(c.seatY - c.y, c.seatX - c.x);
    maxDistance = Math.hypot(c.seatX - c.x, c.seatY - c.y);
    c._batFlight = null; c._batSwooping = false;
  } else if (!sees) {
    c._batFlight = null; c._batSwooping = false;
    c._lungeUntil = null; c._lungeWindupUntil = null;
    if (now >= (c._idleTurnT || 0)) {
      c._idleAngle = Math.random() * Math.PI * 2; c._idleTurnT = now + 3000;
    }
    angle = c._idleAngle; maxDistance = Infinity;
  } else if (m.pattern === 'orbit_swoop') {
    enemyBatMove(scene, c, row, now, px, py);
    return;
  } else if (m.pattern === 'scuttle_pause') {
    if (c._scuttleStart == null) c._scuttleStart = now;
    const cycle = m.scuttleSeconds + m.pauseSeconds;
    if (((now - c._scuttleStart) / 1000) % cycle >= m.scuttleSeconds) return;
    // A stable lateral bias for each scuttle, not frame-rate-dependent noise.
    const leg = Math.floor((now - c._scuttleStart) / (cycle * 1000));
    angle += (leg % 2 ? 1 : -1) * m.approachAngleJitterRadians / 2;
  } else if (m.pattern === 'anchor_spit' || m.pattern === 'strafe_cast' || m.pattern === 'keep_distance') {
    // The roster owns each ranged foe's movement. anchor_spit closes to its
    // preferred range and holds there; the other patterns may strafe or retreat.
    const preferred = m.preferredDistanceCells * scene.cellM;
    if (c._attackWindupUntil != null) return;
    if (Math.abs(dist - preferred) < scene.cellM * 0.5) {
      if (m.pattern === 'anchor_spit') return;
      angle += Math.PI / 2; maxDistance = Infinity;
    } else if (dist < preferred) { angle += Math.PI; maxDistance = preferred - dist; }
    else maxDistance = dist - preferred;
  } else if (m.pattern === 'lunge_recover') {
    if (c._lungeUntil != null && now < c._lungeUntil) {
      angle = c._lungeAngle; speed = m.lungeSpeedMetersPerSecond;
    } else if (c._lungeUntil != null) {
      c._lungeUntil = null; c._lungeRecoverUntil = now + m.lungeWindupSeconds * 1000;
      return;
    } else if (now < (c._lungeRecoverUntil || 0)) return;
    else if (c._lungeWindupUntil != null) {
      if (now < c._lungeWindupUntil) return;
      c._lungeWindupUntil = null;
      c._lungeUntil = now + m.lungeSeconds * 1000;
      c._lungeAngle = angle;
      c._lungeNextT = now + m.lungeCooldownSeconds * 1000;
      return;
    } else if (now >= (c._lungeNextT || 0)) {
      c._lungeWindupUntil = now + m.lungeWindupSeconds * 1000;
      return;
    }
  } else if (m.pattern === 'ooze' && slimeCharging(c)) {
    speed = m.chargeSpeedMetersPerSecond || speed;
  }
  if (c._attackWindupUntil != null && !routed) return;
  const step = Math.min(maxDistance, speed * dt);
  const sx = c.x, sy = c.y;
  if (!enemySweep(scene, c, row, c.x + Math.cos(angle) * step, c.y + Math.sin(angle) * step)) {
    // Slide around a blocked approach without spending a second frame's
    // movement budget. Stable handedness prevents left/right jitter.
    const remaining = Math.max(0, step - Math.hypot(c.x - sx, c.y - sy));
    if (c._avoidSide == null) c._avoidSide = Math.random() < 0.5 ? -1 : 1;
    for (const side of [c._avoidSide, -c._avoidSide]) {
      const a = angle + side * Math.PI / 2;
      const x = c.x + Math.cos(a) * remaining, y = c.y + Math.sin(a) * remaining;
      if (!enemyCanStep(scene, c, row, x, y)) continue;
      enemySweep(scene, c, row, x, y); c._avoidSide = side; break;
    }
  }
}

function enemyBatMove(scene, c, row, now, px, py) {
  const m = row.movement;
  if (c._batFlight) {
    const f = c._batFlight;
    const u = creatureFlightEase((now - f.start) / f.duration);
    const clear = enemySweep(scene, c, row, f.x + (f.tx - f.x) * u, f.y + (f.ty - f.y) * u);
    if (!clear || now >= f.start + f.duration) {
      c._batFlight = null;
      c._batPauseUntil = now + (m.pauseSeconds[0]
        + Math.random() * (m.pauseSeconds[1] - m.pauseSeconds[0])) * 1000;
      // Contact remains eligible at the end of a swoop during its recovery,
      // but _batHit permits just one blow on that leg.
    }
    return;
  }
  if (now < (c._batPauseUntil || 0)) return;
  c._batLeg = (c._batLeg || 0) + 1;
  c._batSwooping = (c._batSwooping && !c._batHit) || c._batLeg % m.swoopEveryLegs === 0;
  c._batHit = false;
  const radius = c._batSwooping ? m.swoopTargetRadiusCells
    : m.orbitRadiusCells[0] + Math.random() * (m.orbitRadiusCells[1] - m.orbitRadiusCells[0]);
  const a = Math.atan2(c.y - py, c.x - px) + 0.7 + Math.random() * 0.7;
  const tx = px + Math.cos(a) * radius * scene.cellM;
  const ty = py + Math.sin(a) * radius * scene.cellM;
  const distance = Math.hypot(tx - c.x, ty - c.y);
  const duration = m.flightSeconds[0] + Math.random() * (m.flightSeconds[1] - m.flightSeconds[0]);
  const leg = Math.min(distance, m.maxLegCells * scene.cellM, m.speedMetersPerSecond * duration / 2);
  const scale = distance > 0 ? leg / distance : 0;
  c._batFlight = { start: now, duration: duration * 1000,
    x: c.x, y: c.y, tx: c.x + (tx - c.x) * scale, ty: c.y + (ty - c.y) * scale };
}
