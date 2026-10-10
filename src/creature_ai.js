// Creature AI helpers — the scene-free pieces of how wild things move and
// react: the slime's charge, flee / stalk pacing, the roster movers
// (rosterEnemyMove / rosterEnemyAttack), the ghosts (spawn pass, sun
// exposure, tick), the fished-up slime, the monster rout and wander-off, and
// the ward trip that turns a foe out of Home's or a castle's ring.
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

// ── Struck, a slime CHARGES ──────────────────────────────────────────────────
// How long a creature keeps reacting to a hit. ONE window, two opposite
// reactions, because the two kinds of prey are opposite: a crow or a deer that
// is struck RUNS (the flee override in wanderCreatures), and a slime that is
// struck COMES AT YOU. Same number for both — being hit is one event — and it
// outlasts the wander step it interrupts, which is what the flee's original
// hand-typed 8000 was picked for.
//
// The surface slime OOZES: its row's movement (enemy_roster.js `slime`,
// pattern 'ooze') is 1.1 m/s, under a brisk walk, so you can always walk
// away from one — the first enemy in the game must be left behind on foot.
// A charge is its row's chargeSpeedMetersPerSecond (1.6, rosterEnemyMove's
// ooze branch): quicker, still under BRISK_WALK_MPS. You just can't stab one
// and stroll off any more.
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
// IN A HURRY, in metres per second — the ONE retreat pace of every mover
// that moves in m/s: a roster foe's rout (rosterEnemyMove), its escape from
// fire (enemyFireEscapeTick), a warded ghost's run (ghostTick). The pair
// above over `base` (four times the ground), under the kind's own ceiling
// (SpriteLayout.creatureMaxMps) and the wild speed ceiling every row's base
// numbers sit under (WILD_SPEED_CEILING_MPS): a 5.8 m/s goblin retreats at
// 10, never slower than it chases. No cap of its own (the old flat 6 m/s is
// gone); a shiny's 1.5 and the frost's slow ride on top through
// Combat.paceMul, at the site. The animals' step chain is the same rule in
// cells and beats (FLEE_STRIDE_MUL / FLEE_BEAT_MUL over the gait).
function hurryMps(c, base) {
  return Math.min(SpriteLayout.creatureMaxMps(c.kind), WILD_SPEED_CEILING_MPS,
    base * FLEE_STRIDE_MUL / FLEE_BEAT_MUL);
}
// How long a mad roster foe (Combat.isPsychotic, rosterEnemyMove) holds one
// random heading before rolling the next — a stagger, not a spin.
const PSYCHOSIS_TURN_MS = 700;
// All shiny creatures move 1.5x faster; Combat owns the shared multiplier.
const SHINY_SPEED_MUL = Combat.SHINY_SPEED_MUL;
// Ordinary wild movement targets 10 m/s. The universal shiny multiplier
// applies afterwards, including to fast bats and crow flights; it is not capped.
const WILD_SPEED_CEILING_MPS = 10;
// The spread on a COMMITTED approach, in radians: tight enough to read as a
// line rather than a meander. A hunted deer charges on it (wanderCreatures'
// gameCharge branch).
const STALK_JITTER = 0.8;
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
// How often wanderCreatures re-asks EnemySpawns.surfaceActive of a surface foe
// OUTSIDE the bubble (inside it: every tick). Its inputs — daylight, Home, the
// pest amnesty — move over minutes, so a second of staleness on a frozen,
// far-off seat changes nothing anyone can see.
const SURFACE_RECHECK_MS = 1000;
// Where the crop-raiding pest pump seats the deer it dispatches (hard mode
// only — see wanderCreatures): past the viewport corner (7.8 cells) so it is
// never seen popping into being, but inside CREATURE_SIM_CELLS so it is
// thinking, and walking at the field, from the tick it is pushed. The ghosts
// rise on the same ring.
const PEST_SPAWN_CELLS = 10;
// How often that pump may dispatch one (owner, Oct 2026: "just once per
// hour"; it was every 90 s). Wall clock, kept in the save (pestDispatchAt):
// on the page clock a reload restarted the hour, and garden deer never came.
const PEST_DISPATCH_MS = 60 * 60 * 1000;
// How often a due pump re-asks while it cannot dispatch (a deer already near,
// no crop, no legal seat).
const PEST_RECHECK_MS = 30 * 1000;
// ── THE KERB: the major roads' buffer, and who may come near it ─────────────
// SAFETY (owner, Sep 2026): there must never be a need, or an advantage, to
// step onto a busy road to get away from something. The worldgen stamps a
// KERB BUFFER beside every MD/LG road (ROAD_CLASS_MAJOR_BUFFER — the band plus
// MAJOR_BUFFER_CELLS, about one base reach, either side), and the creature
// sim reads it three ways, each a REASON on a lane that already exists:
//   · NOTHING HOSTILE STEPS ONTO THE BAND — a refused target cell in the step
//     chain's cell tests, beside water, rocks and fires. Wild fauna neither.
//   · A FAST FOE (isFastMover — anything that out-runs a BRISK walk,
//     BRISK_WALK_MPS) never
//     steps INTO the buffer from outside it (the same refused-cell test), and
//     never spawns in it (WorldGen.isSpawnCell(…, creatureSpawnClass(kind)):
//     the fast rows refuse KERB). A slow foe may stand anywhere off the
//     band: you out-walk it.
//   · A PLAYER WHOSE FEET ARE IN THE BUFFER IS WHERE EVERY CHASE ENDS
//     (`kerbLeash` in wanderCreatures): every hostile turns its back — one
//     more reason in the wander-off lane (standDown + an away angle), a lair
//     guard gives up and walks home, a ghost stops short. It reads the
//     player's FEET (playerM), never the camera anchor. Because the band is
//     inside the buffer, standing on the carriageway buys exactly what
//     standing on the pavement beside it does — nothing more — so the road is
//     never a refuge (test/node/kerb_refuge_sim.test.js runs it for every
//     hostile kind).
// Junctions use the same refused-cell lane. Every non-allied creature refuses
// an MD/LG junction's full exclusion zone. A fast mover refuses to enter a
// Small-road junction's one-cell suppression buffer from outside it.
// What this is NOT: `unnoticed`. A Shadow Powder / an empty bar / a passenger's
// speed hide you from what would notice you, anywhere; the kerb is a place a
// chase gives up at, and only for as long as you stand in it.
// wanderCreatures' base beat (its STEP_MS): one cell a step at this cadence
// is the plain wander; a slime's gait and a monster's `speed` scale it.
const WANDER_STEP_MS = 5000;
// The tile bits under a world-metre point on the surface (0 underground, on
// an unloaded tile, or before its roadClass exists).
function roadClassBitsAt(scene, x, y) {
  const t = tileCellAt(scene, x, y);
  return t && t.entry.roadClass ? t.entry.roadClass[t.i] | 0 : 0;
}
function inKerbAt(scene, x, y) { return !!(roadClassBitsAt(scene, x, y) & WorldGen.ROAD_CLASS_MAJOR_BUFFER); }
function inSoftJunctionAt(scene, x, y) { return !!(roadClassBitsAt(scene, x, y) & WorldGen.ROAD_CLASS_JUNCTION_SOFT); }

// ── THE ROADSIDE RUN: a retreat in a residential area runs along the street ──
// Every retreat in wanderCreatures is an AWAY angle — a bolting animal away
// from the player, a foe routed away from Home's ward, one wandering off or
// turned back at the kerb, struck prey shoved off by a pet. On open ground
// "away" is fine. Between houses it is not: away from the player is INTO the
// nearest yard, and a deer that bolts through a garden or a slime that flees
// behind a house reads as walking through walls, and stands in ground the
// spawn gate says nobody's creature belongs on (BEHIND_HOUSE / PRIVATE).
//   So on LOT ground (WorldGen.isLotTerrain — a residential yard, or the
// wasteland painted as one), or when the away step would land in a yard,
// the retreat is bent onto the ROADSIDE: the nearest street within
// ROADSIDE_R_CELLS (its roadMask band or its road terrain), run ALONG it, on
// the creature's own side, ROADSIDE_VERGE_CELLS off the road — the pavement,
// never the carriageway (major road terrain refuses every wild step; the kerb
// rules above refuse the major band and its buffer as they always did). The
// street's line is the principal axis of its cells about the nearest one;
// of the two ways along it the run takes the one nearer the away angle, so
// it is still a retreat, and aims ROADSIDE_AHEAD_CELLS up the verge so a
// creature deep in a yard first comes OUT to the roadside and then along it.
//   And a retreat step never ENTERS a yard it is not already in: the yard
// reason bits (yardReasonAt — the spawn gate's own BEHIND_HOUSE | PRIVATE,
// off entry.spawnWhy) refuse the target cell, the way the kerb refuses the
// band; one already in a yard may step anywhere (a refused cell for it would
// be the stall the scarecrow note in the chain warns about).
//   Null when there is no street near, or the creature is not among houses:
// the caller keeps its plain away angle. Surface only. A step-time cost, not
// a frame cost: (2R+1)² cell reads on the retreat steps of the handful of
// creatures in the sim bubble, every few hundred ms each.
const ROADSIDE_R_CELLS = 4;
const ROADSIDE_AHEAD_CELLS = 3;
const ROADSIDE_VERGE_CELLS = 1;
const ROADSIDE_JITTER = 0.3;
const ROADSIDE_YARD_BITS = () => WorldGen.SPAWN_WHY.BEHIND_HOUSE | WorldGen.SPAWN_WHY.PRIVATE;
// The tile cell under a surface point — the cached tile and its flat index
// on the tile's OWN grid (entry.cellsPerEdge, the world-frame rule): { entry,
// N, i } or null (underground, off any cached tile). The one reader every
// per-cell question below asks (the kerb bits, the yard reasons, the lot,
// the road); the entry's arrays may still be missing on a tile mid-build, so
// a caller checks the one it reads.
function tileCellAt(scene, x, y) {
  if ((scene.depth || 0) !== 0) return null;
  const edge = scene.tileEdgeM;
  if (!(edge > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const tx = Math.floor(x / edge), ty = Math.floor(y / edge);
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
  if (!entry) return null;
  const N = entry.cellsPerEdge;
  if (!(N > 0)) return null;
  const ix = Math.floor((x - tx * edge) / (edge / N)), iy = Math.floor((y - ty * edge) / (edge / N));
  if (ix < 0 || iy < 0 || ix >= N || iy >= N) return null;
  return { entry, N, i: iy * N + ix };
}
// The spawn gate's yard reasons on the cell under a point (0 where none).
function yardReasonAt(scene, x, y) {
  const t = tileCellAt(scene, x, y);
  return t && t.entry.spawnWhy ? (t.entry.spawnWhy[t.i] & ROADSIDE_YARD_BITS()) : 0;
}
function lotAt(scene, x, y) {
  const t = tileCellAt(scene, x, y);
  return !!t && !!t.entry.grid && WorldGen.isLotTerrain(t.entry.grid[t.i]);
}
// ALLOWLISTED raw roadMask read (spawn_gate_sweep.test.js): GEOMETRY, not the
// gate — which way the street runs, so a retreat can run along it. Nothing
// here places anything.
function roadAt(scene, x, y) {
  const t = tileCellAt(scene, x, y);
  return !!t && (!!(t.entry.roadMask && t.entry.roadMask[t.i]) || WorldGen.isRoadTerrain(t.entry.grid?.[t.i]));
}
// LAUNCH A STEP: the creature's hop (or a crow's glide — `clockField`
// '_flightT0') from where it stands to (tx, ty), from `now`. The one writer
// of the five fields the step chain's interpolation reads.
function launchStep(c, tx, ty, now, clockField = '_stepT0') {
  c._startX = c.x; c._startY = c.y;
  c._targetX = tx; c._targetY = ty;
  c[clockField] = now;
}
// The centre of cell (cx, cy) of tile (tx, ty), in world metres, on the
// TILE'S OWN grid (`cellM` = tileEdgeM / entry.cellsPerEdge — CLAUDE.md
// "Every player sees the SAME generated world": the generation frame, never
// the save's px frame coords.js tileCellCenterMeters projects through). The
// one conversion every seat in the spawn passes (scene_creatures.js) takes.
function tileCellCentre(tileEdgeM, tx, ty, cellM, cx, cy) {
  return { x: tx * tileEdgeM + (cx + 0.5) * cellM, y: ty * tileEdgeM + (cy + 0.5) * cellM };
}
// World-derived creatures have a stable identity before multiplayer connects.
// Keep independent decision streams so a roadside check, another creature, or
// unrelated visual/loot randomness cannot change the next idle/bat choice.
// Session-local counters deliberately do not claim to synchronize clocks,
// targets or terrain; recreating a creature restarts its decision sequence.
function enemyMovementRandom(c, decision) {
  if (c._sharedId !== true || typeof c.id !== 'string') return Math.random();
  const counters = c._movementDecisions ||= Object.create(null);
  const turn = counters[decision] || 0;
  counters[decision] = turn + 1;
  return u01(avalanche32(fnv1a(`movement:${c.id}:${decision}:${turn}`)));
}

// WHERE A SHOVED ANIMAL RUNS TO: `distM` away along its flee angle
// (`c._fleeAngle` — away from what hit it), bent onto the roadside among
// houses (roadsideRunAngle; a ±0.3 rad jitter only on an unbent angle), the
// first of four tries the one step test takes as a retreat
// (creatureStepRefused — never into a yard). { x, y } or null (cornered:
// stand still this tick). The animals' flee override and the crow's panic
// dash take the same search.
function fleeTarget(scene, c, distM) {
  const shove = c._fleeAngle ?? 0;
  const run = roadsideRunAngle(scene, c, shove);
  const fa = run ?? shove;
  for (let attempt = 0; attempt < 4; attempt++) {
    const a = fa + (run != null ? 0 : (Math.random() - 0.5) * 0.6);
    const x = c.x + Math.cos(a) * distM, y = c.y + Math.sin(a) * distM;
    if (!creatureStepRefused(scene, c, x, y, { retreating: true })) return { x, y };
  }
  return null;
}
// The bent angle, or null (keep the away angle). `away` is the retreat's own
// angle, radians.
function roadsideRunAngle(scene, c, away) {
  if ((scene.depth || 0) !== 0) return null;
  const cm = scene.cellM;
  if (!(cm > 0)) return null;
  const ax = c.x + Math.cos(away) * cm, ay = c.y + Math.sin(away) * cm;
  if (!lotAt(scene, c.x, c.y) && !lotAt(scene, ax, ay) && !yardReasonAt(scene, ax, ay)) return null;
  const R = ROADSIDE_R_CELLS;
  const cells = [];
  let near = null, nearD2 = Infinity;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (!roadAt(scene, c.x + dx * cm, c.y + dy * cm)) continue;
      cells.push({ dx, dy });
      const d2 = dx * dx + dy * dy;
      if (d2 < nearD2) { nearD2 = d2; near = { dx, dy }; }
    }
  }
  if (!near) return null;
  // The street's line: the principal axis of its cells within two of the
  // nearest one. One cell alone has no line.
  let n = 0, sxx = 0, syy = 0, sxy = 0;
  for (const p of cells) {
    if (Math.max(Math.abs(p.dx - near.dx), Math.abs(p.dy - near.dy)) > 2) continue;
    const ex = p.dx - near.dx, ey = p.dy - near.dy;
    n++; sxx += ex * ex; syy += ey * ey; sxy += ex * ey;
  }
  if (n < 2) return null;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let dx = Math.cos(theta), dy = Math.sin(theta);
  if (dx * Math.cos(away) + dy * Math.sin(away) < 0) { dx = -dx; dy = -dy; }   // the way that is still away
  // The creature's own side of the street: the normal that points from the
  // nearest road cell back toward it.
  let nx = -dy, ny = dx;
  if (nx * -near.dx + ny * -near.dy < 0) { nx = -nx; ny = -ny; }
  const tx = (near.dx + dx * ROADSIDE_AHEAD_CELLS + nx * ROADSIDE_VERGE_CELLS) * cm;
  const ty = (near.dy + dy * ROADSIDE_AHEAD_CELLS + ny * ROADSIDE_VERGE_CELLS) * cm;
  return Math.atan2(ty, tx) + (enemyMovementRandom(c, 'roadside') - 0.5) * ROADSIDE_JITTER;
}
// The bend for a per-frame mover (rosterEnemyMove runs every frame, the
// step chain every few hundred ms): the same answer, re-asked at most every
// ROADSIDE_RECHECK_MS per creature, the plain `away` angle where there is no
// bend. The (2R+1)² cell reads stay a step-time cost.
const ROADSIDE_RECHECK_MS = 300;
function roadsideRunAngleCached(scene, c, away, now) {
  if (c._roadsideT == null || now - c._roadsideT >= ROADSIDE_RECHECK_MS || now < c._roadsideT) {
    c._roadsideT = now;
    c._roadsideAngle = roadsideRunAngle(scene, c, away);
  }
  return c._roadsideAngle ?? away;
}
// How fast this creature COMES AT YOU, metres per second, at the quickest it
// ever moves toward the player (a flee or a rout is away, and does not
// count): a roster foe's quickest declared speed (rosterChaseMps — the base
// pace, a slime's charge, a fiend's lunge, a bat's peak flight, a ghost's
// glide); a hunted game animal's charge (its flee stride and beat —
// `fightsBack`). 0 for anything that never comes at you. Derived from the
// same numbers the movers move by, never a table of its own.
function foeChaseMps(c, cellM) {
  if (!c) return 0;
  const cm = cellM > 0 ? cellM : WorldGen.CELL_M;
  const row = typeof EnemyRoster !== 'undefined' && EnemyRoster.get(c.kind);
  if (row) return rosterChaseMps(row);
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
// THE FAST-MOVER LINE (owner, Sep 2026): a BRISK walk. Only a mover whose top
// speed is over it is kept off the kerb (the spawn gate's KERB reason, and
// the step rule into the kerb buffer). The wild slime's 1.6 m/s charge is
// under it: you out-walk a slime by stepping out, so it is NOT fast.
const BRISK_WALK_MPS = 1.8;
// An ANIMAL's top speed, m/s: the quicker of its gait hop and its bolt (the
// CREATURE_BEHAVIOUR row — the numbers the wander loop moves it by; the base
// beat WANDER_STEP_MS and one cell where the row is silent).
function faunaTopMps(kind, cellM) {
  const beh = SpriteLayout.creatureBehaviour(kind);
  if (!beh) return 0;
  const cm = cellM > 0 ? cellM : WorldGen.CELL_M;
  const pace = (g) => (g.stepCells ?? 1) * cm / ((g.stepMs ?? WANDER_STEP_MS) / 1000);
  return Math.min(Math.max(pace(beh), beh.flee ? pace(beh.flee) : 0), SpriteLayout.creatureMaxMps(kind));
}
// Anything wild — foe or animal — that out-runs a brisk walk.
function isFastMover(c, cellM) {
  if (!c) return false;
  const hostileSpecies = Combat.isEnemyKind(c.kind) && !Combat.isTame(c);
  const mps = hostileSpecies ? foeChaseMps(c, cellM) : faunaTopMps(c.kind, cellM);
  return mps > BRISK_WALK_MPS;
}
// A creature's SPAWN CLASS (WorldGen.SPAWN_CLASS_BLOCKS): enemy or fauna, and
// fast or not — derived from the kind's own data, never typed at a call
// site. Read at the GENERATION cell size (WorldGen.CELL_M) so every player's
// tile seats the same creatures.
function creatureSpawnClass(kind) {
  const c = { kind };
  const fast = isFastMover(c, WorldGen.CELL_M);
  if (Combat.isEnemy(c)) return fast ? 'fastEnemy' : 'enemy';
  return fast ? 'fastFauna' : 'fauna';
}
globalThis.creatureSpawnClass = creatureSpawnClass;

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
  const px = fx != null ? fx : playerWorldM(scene).x;
  const py = fy != null ? fy : playerWorldM(scene).y;
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
// After dark (and at any hour in a deep crypt pocket — ghostsHaunt) a few
// ghosts rise in the dark around the player, hover a moment,
// then rush them: a touch costs Combat's GHOST_TOUCH_DMG (the mode, the shield
// and armour have their say, as with every blow) and spends the ghost; light
// burns them (Lighting.brightnessAt, the lightmap's own model). Their row is
// combat.js MONSTERS.ghost (`spawn: 'night'` — never the cave bag, no giant),
// their mover is ghostTick below (SpriteLayout `haunts`), and they are SESSION
// state exactly like the pest deer: pushed into the player's tile entry with an
// id minted off the clock, never generated and never seated on a tile — a
// spent or slain ghost's marker in save.caught is pruned by the same pass the
// pest deer's is (wanderCreatures).
//   "After dark" is the daylight (Lighting.daylight, 1 noon .. 0 night) under
// GHOST_DARK_DAYLIGHT: 0.5 is the sun on the horizon, and 0.25 is a few
// degrees under it — dusk gone to dark.
//   Underground there is no night, so the PLACE gates them instead: a crypt
// pocket (the cave habitat EnemySpawns.caveContextAt reads as 'crypt') from
// EnemyRoster.GHOST_SCALING.minCryptDepth down is haunted at every hour, on
// odd and even levels alike; every other cave ground stays empty. The sun
// never reaches them either (ghostSunExposureAt).
const GHOST_DARK_DAYLIGHT = 0.25;
// A churchyard's headstone can still raise a ghost when TAPPED (raiseGhostAt);
// ambient haunting is declared by the owning habitat profile.
// Is this a time and place ghosts rise? One predicate the pump reads: the
// surface after dark, or a haunted cave level at any hour.
function ghostsHaunt(depth, day, habitat) {
  if (depth > 0) return depth >= EnemyRoster.GHOST_SCALING.minCryptDepth && habitat === 'crypt';
  return day < GHOST_DARK_DAYLIGHT;
}
// The roster sets the cadence and jitter so the pump and every balance tool
// answer to the same table. Five minutes plus or minus one minute reads as
// "every so often", not as a clock.
const GHOST_SPAWN_MS = EnemyRoster.GHOST_SCALING.cadenceSeconds * 1000;
const GHOST_SPAWN_JITTER_MS = EnemyRoster.GHOST_SCALING.jitterSeconds * 1000;
// A group rises together: its members' angles about the player fan across
// this much of a turn (radians), on the pest pump's ring (PEST_SPAWN_CELLS
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
  const tx = Math.floor(x / scene.tileEdgeM), ty = Math.floor(y / scene.tileEdgeM);
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
  let profile;
  if (entry?.cellsPerEdge && (entry.baseGrid || entry.grid)) {
    const cm = scene.tileEdgeM / entry.cellsPerEdge;
    const cx = Math.floor((x - tx * scene.tileEdgeM) / cm);
    const cy = Math.floor((y - ty * scene.tileEdgeM) / cm);
    profile = HabitatSpawns.resolve(entry, cy * entry.cellsPerEdge + cx)?.profile;
    if (!CreatureSpawns.gateAt(scene, x, y, 'ghost')) return false;
  } else profile = HabitatSpawns.landProfile(cell.type);
  return !!profile?.haunting;
}
// THE NIGHT PUMP — seats a group of ghosts in the dark about the player, once
// every ghostSpawnDelay while ghostsHaunt says so (the surface after dark, a
// crypt pocket from GHOST_SCALING.minCryptDepth at any hour). Returns how many rose. The timer is disarmed
// whenever it doesn't, so the first group comes one delay after dark, a load,
// or the stairs down to a haunted level — never at once.
// `wardPts` / `wardR2` are wanderCreatures' Home + claimed-castle wards: a
// ghost never rises inside a ring that would only rout it.
// Triggered encounters share frequency and placement with habitat spawns;
// their trigger, identity and behavior remain owned by these event handlers.
const CreatureSpawnEvents = {
  ghost(depth) {
    const profile = EnemyRoster.ghostProfile(depth);
    return { id: 'ghost_pump', source: 'event', kind: 'ghost',
      frequency: { unit: 'event', count: [profile.groupMin, profile.groupMax] } };
  },
  headstone: { id: 'headstone_ghost', source: 'event', kind: 'ghost', frequency: { unit: 'event', count: 1 } },
  fishedSlime: { id: 'fished_slime', source: 'event', kind: 'slime', frequency: { unit: 'event', count: 1 } },
  nest: { id: 'nest_bush', source: 'event', frequency: { unit: 'event', count: 1 } },
  hive() { return { id: 'hive_bees', source: 'event', kind: 'bee', frequency: { unit: 'event', count: WorldGen.HIVE_SPEC.bees } }; },
  summon(ability) { return { id: 'enemy_summon_slots', source: 'event', kind: ability.kind,
    frequency: { unit: 'event', count: ability.maxMinions } }; },
};
globalThis.CreatureSpawnEvents = CreatureSpawnEvents;
function ghostSpawnPass(scene, now, px, py, pcW, homePos, castleWards, wardR2, caughtSet) {
  const depth = scene.depth || 0;
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(pcW.tx, pcW.ty));
  // Daylight is only asked on the surface (a cave level has no sun).
  const habitatAt = (tile, tx, ty, x, y) => {
    if (!tile || !tile.cellsPerEdge) return 'natural';
    const cellM = scene.tileEdgeM / tile.cellsPerEdge;
    return EnemySpawns.caveContextAt(tile, tx, ty,
      Math.floor((x - tx * scene.tileEdgeM) / cellM),
      Math.floor((y - ty * scene.tileEdgeM) / cellM), depth).theme;
  };
  const habitat = depth > 0 ? habitatAt(entry, pcW.tx, pcW.ty, px, py) : null;
  if (!ghostsHaunt(depth, depth > 0 ? 0 : Lighting.daylight(scene, Date.now()), habitat)) {
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
    CreatureSpawns.frequencyCount(CreatureSpawnEvents.ghost(depth).frequency, Math.random));
  const R = PEST_SPAWN_CELLS * scene.cellM;
  const base = Math.random() * Math.PI * 2;
  let made = 0;
  for (let i = 0; made < want && i < want * 8; i++) {
    // The fan first; if the dark is not there, anywhere on the ring.
    const a = i < want * 4 ? base + (Math.random() - 0.5) * GHOST_GROUP_SPREAD : Math.random() * Math.PI * 2;
    const x = px + Math.cos(a) * R, y = py + Math.sin(a) * R;
    const cell = scene.cellAt(x, y);
    if (!cell.loaded || (depth === 0 && !ghostSurfaceEligible(scene, x, y, cell))) continue;
    if (depth > 0) {
      const tx = Math.floor(x / scene.tileEdgeM), ty = Math.floor(y / scene.tileEdgeM);
      const tile = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
      if (habitatAt(tile, tx, ty, x, y) !== 'crypt') continue;
    }
    // The shared gate includes the ghost's fast suppression on every floor.
    if (!CreatureSpawns.gateAt(scene, x, y, 'ghost')) continue;
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
// One risen ghost — session state, id minted off the clock (the pest deer's
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
  // The authored headstone/plate owns this occupied cell; geographical
  // exclusions and the ghost's fast suppression still apply.
  if (!CreatureSpawns.gateAt(scene, x, y, 'ghost', { occupied: null })) return null;
  const caught = new Set((scene.save && scene.save.caught) || []);
  let near = 0;
  WorldGen.forEachItemNear('creatures', tx, ty, (c) => {
    if (SpriteLayout.creatureHaunts(c.kind) && !caught.has(c.id)) near++;
  });
  const nearMax = EnemyRoster.ghostProfile(scene.depth || 0)?.nearMax ?? 0;
  if (near >= nearMax) return null;
  const generated = WorldGen.runSteps(CreatureSpawns.generateSteps(CreatureSpawnEvents.headstone, {
    member: () => ({ kind: 'ghost' }), seat: () => ({ x, y }),
    create: () => makeGhost(x, y, now, tx, ty, tag),
    onPlaced: ghost => entry.creatures.push(ghost),
  }));
  return generated[0] || null;
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
//   It is SESSION state exactly like the ghost and the pest deer: pushed into
// the player's tile entry with an id minted off the clock
// (`fished_slime_<tx>_<ty>_…`), pruned from save.caught by the same pass.
// Returns the creature, or null when no cell beside the player will take it
// (the handler then pays the fish instead).
function fishedSlimeSpawn(scene, now, px, py, pcW) {
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(pcW.tx, pcW.ty));
  if (!entry || !entry.creatures) return null;
  const generated = WorldGen.runSteps(CreatureSpawns.generateSteps(CreatureSpawnEvents.fishedSlime, {
    member: () => ({ kind: 'slime' }),
    seat: () => ringSeat(px, py, scene.cellM, Math.floor(Math.random() * 8) * Math.PI / 4,
      (x, y) => CreatureSpawns.gateAt(scene, x, y, 'slime')),
    create: (member, seat) => WorldGen.makeCreature('slime', seat.x, seat.y,
      `fished_slime_${pcW.tx}_${pcW.ty}_${Math.floor(now)}_${Math.floor(Math.random() * 1e4)}`,
      { _lastDamagedT: Date.now() }),
    onPlaced: slime => entry.creatures.push(slime),
  }));
  return generated[0] || null;
}
// THE RING SEAT: the first of the eight compass points `r` metres about
// (cx, cy), from angle `base` clockwise, that `ok(x, y)` takes — the fished
// slime beside the player, a necromancer's skeleton beside its master, the
// pest deer on the spawn ring. { x, y } or null.
function ringSeat(cx, cy, r, base, ok) {
  for (let k = 0; k < 8; k++) {
    const a = base + k * Math.PI / 4;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (ok(x, y)) return { x, y };
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
//   `opts.cls`: the spawn class of what is seated (WorldGen.SPAWN_CLASS_BLOCKS
// — a bounty's pack passes its foes' class); default 'attractor' (a
// destination a timed reward waits at).
//   PRIVATE GROUND: a destination is per-player already, so it also reads this
// player's live fence / private-area veto (WorldGen.privateVetoAt — none when
// the fetch failed or has not landed).
// (the minor class never applies: nothing is sent to wait on SUPPRESSED ground)
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
  const cls = o.cls || 'attractor';
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
      if (o.kind ? !CreatureSpawns.gateAt(scene, wx, wy, o.kind)
        : !WorldGen.isSpawnCell(entry.grid, N, N, ix, iy, entry._spawnOpts, cls)) continue;
      if (WorldGen.privateVetoAt(tx, ty, ix, iy)) continue;
      const x = tx * edge + (ix + 0.5) * cm, y = ty * edge + (iy + 0.5) * cm;
      if (!sameSideAs(scene, x, y, px, py)) continue;
      if (o.accept && !o.accept(x, y)) continue;
      return { tx, ty, ix, iy, x, y, n: N, entry };
    }
  }
  return null;
}
// A harvested shaking bush releases an ordinary creature beside its old seat.
// Placement uses the existing deterministic spawn/road/private-ground gate.
function spawnNestBushCreature(scene, bush, type) {
  const habitatAt = (x, y) => {
    const tx = Math.floor(x / scene.tileEdgeM), ty = Math.floor(y / scene.tileEdgeM);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
    if (!entry?.cellsPerEdge) return null;
    const cm = scene.tileEdgeM / entry.cellsPerEdge;
    const cx = Math.floor((x - tx * scene.tileEdgeM) / cm);
    const cy = Math.floor((y - ty * scene.tileEdgeM) / cm);
    return HabitatSpawns.resolve(entry, cy * entry.cellsPerEdge + cx);
  };
  const habitat = habitatAt(bush.x, bush.y);
  const kind = type === 'slime' ? 'slime' : HabitatSpawns.pickFauna(habitat?.profile, `${bush.id}|nest-fauna`);
  if (!kind) return null;
  const id = `nest_${bush.id}`;
  if ((scene.save.caught || []).includes(id)) return null;
  const enemy = Combat.isEnemyKind(kind);
  const home = scene.homeWorldPos?.(), castles = scene._castleWardPoints?.() || [];
  const point = walkableDestination(scene, bush.x, bush.y, 1, {
    seed: id, kind, cls: creatureSpawnClass(kind),
    accept(x, y) {
      const t = scene.cellAt(x, y).type;
      const targetHabitat = habitatAt(x, y);
      if (habitat && targetHabitat?.key !== habitat.key) return false;
      if (!enemy) return HabitatSpawns.allows(kind, t, habitat?.profile);
      const tx = Math.floor(x / scene.tileEdgeM), ty = Math.floor(y / scene.tileEdgeM);
      const n = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty)).cellsPerEdge;
      const cm = scene.tileEdgeM / n;
      const c = { kind, id, x, y, _surfaceSpawn: { x, y, tx, ty,
        cx: Math.floor((x - tx * scene.tileEdgeM) / cm), cy: Math.floor((y - ty * scene.tileEdgeM) / cm) } };
      return EnemySpawns.surfaceActive(scene, c)
        && !wardTrip(c, home, castles, (HOME_R * scene.cellM) ** 2)
        && !scene._nearAny?.('fires', x, y, FIRE_REST_R);
    },
  });
  if (!point) return null;
  const creatures = point.entry.creatures || (point.entry.creatures = []);
  if (creatures.some(c => c.id === id)) return null;
  const generated = WorldGen.runSteps(CreatureSpawns.generateSteps(CreatureSpawnEvents.nest, {
    member: () => ({ kind, id }), seat: () => point,
    create: () => EnemySpawns.markShared(WorldGen.makeCreature(kind, point.x, point.y, id, { shiny: false,
      ...(enemy ? { _surfaceSpawn: { x: point.x, y: point.y, tx: point.tx, ty: point.ty, cx: point.ix, cy: point.iy } } : {}) })),
    onPlaced: creature => creatures.push(creature),
  }));
  return generated[0] || null;
}

// A hive's daily defenders use ordinary enemy seating and combat. Plan the
// entire swarm first so a refused placement cannot partially spend a visit.
function planHiveBees(scene, hive) {
  const out = [], seats = new Set();
  const day = utcDayKey();
  const count = CreatureSpawns.frequencyCount(CreatureSpawnEvents.hive().frequency, Math.random);
  for (let i = 0; i < count; i++) {
    const id = `hivebee_${hive.id}_${day}_${i}`;
    const point = walkableDestination(scene, hive.x, hive.y, 1, {
      seed: id, kind: 'bee', cls: creatureSpawnClass('bee'),
      accept(x, y) {
        return !seats.has(`${x},${y}`) && !(x === hive.x && y === hive.y);
      },
    });
    if (!point) return [];
    seats.add(`${point.x},${point.y}`);
    out.push({ entry: point.entry, creature: EnemySpawns.markShared(WorldGen.makeCreature('bee', point.x, point.y, id,
      { shiny: false, homeX: hive.x, homeY: hive.y })) });
  }
  return out;
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
  // Routed by a ward it RUNS (hurryMps, like every other foe); the pace
  // multiplier (shiny, a thrown Speed, the frost's slow) rides on top.
  if (warded) pace = hurryMps(c, pace * 1000) / 1000;
  pace *= Combat.paceMul(c);
  // A finite memorial guard is visible but dormant until approached. Its
  // lifetime begins at awakening, not while the player passes far away.
  if (c.proximityCells && !c._awakened) {
    if (unnoticed || warded || Math.hypot(px - c.x, py - c.y) > c.proximityCells * scene.cellM) return null;
    c._awakened = true; c._spawnT = now;
  }
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
  if (enemyFireEscapeTick(scene, c, EnemyRoster.get(c.kind), now, Math.min(0.1, dt / 1000))) return null;
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
  if (!fireStepAllowed(scene, c, nx, ny)) return null;
  SpriteLayout.updateCreatureFacing(c, nx - c.x, ny - c.y, now);
  c.x = nx; c.y = ny;
  if (warded) return null;
  return Math.hypot(px - c.x, py - c.y) <= GHOST_TOUCH_CELLS * scene.cellM ? 'touch' : null;
}
// How long a departing crow keeps flying away (_crowDepart): [base, spread]
// ms, so ~2.5–4 minutes — once the player starts hunting it.
const CROW_DEPART_MS = [150000, 90000];
// How far a CROP RAIDER (the deer or the crow — SpriteLayout `raidsCrops`) notices a
// planted crop it may eat, in cells (wanderCreatures raidStep): the on-screen
// sim range, so it spots a field from across the viewport but not from the
// next street. It does not teleport in — every step is its own gait's — so a
// far deer visibly walks toward the beds. A dispatched pest (isPest) has no
// limit: it was sent at the field.
const RAID_NOTICE_CELLS = 8;
// How many perch cycles a crow sits ON a crop before it is eaten
// (_wildCrowTick): the first landing starts the count, each landing on the
// same crop spends one. The player's window to net, scare or set a pet on it.
const CROW_RAID_PERCHES = 2;
// THE HUNT IS TIMED, NOT ROLLED (owner, Sep 2026: "a 50/50 chance with a T1
// net, depending on timing, standing right on it"). A hunted crow does NOT
// bolt the instant the wheel starts — it keeps its own rhythm, finishes the
// perch it is sitting (or the glide it is on, and the perch that ends it)
// and leaves on its NEXT launch (_crowDepart 'hunted'). So the race is
// between the net's wheel and how much perch the crow had left when you
// tapped: tap one that has just settled and it sits through a wood net's
// 4 s; tap one about to hop and it is gone. (Launching at once made the
// hunt a die roll on the first hop's direction.)
//   The departure hop itself is here, one row: `cells` out and `ms` of
// glide per leg. Three cells clears the base reach (2.5 cells + 1 m, whole
// cells — coords.js cellInReach) from wherever it sat, so the hop always
// ends the hunt and never the roll above; it is exempt from the 2.5-cell
// approach cap in _wildCrowTick, which exists to make a crow APPROACH a crop
// over several hops, not to keep a fleeing one near. The 1.5 s glide is the
// pace the odds are tuned on: test/node/crow_hunt_odds.test.js drives the
// real tick against every net tier and pins the wood net's coin flip (and
// that bare hands never take a crow, a tier-3 net nearly always does).
//   THE ONE EXCEPTION TO THE SPEED CEILING (WILD_SPEED_CEILING_MPS). This
// hop is 21 m in 1.5 s — a 14 m/s mean, a 28 m/s peak on the eased leg —
// and the hunt's odds above are tuned on exactly that: a T1 net's 4 s wheel
// against the crow's remaining perch plus the ~1.1 s it takes this hop to
// clear the reach (plus the wheel's 1 s grace). Under the ceiling (a 4.2 s+
// hop) the crow could never clear the reach inside a 4 s wheel and a T1 net
// took a crow 97 times in 100, bare hands 8 (test/node/crow_hunt_odds.test.js
// measured it) — the owner's "coin flip, depending on timing" cannot survive
// a 10 m/s hop with the reach, the grace and the net wheel as they are. So
// the one burst stays, declared here, measured as the exception in
// test/node/speed_ceiling.test.js, and flagged for the owner: slow the hop
// and retune the hunt (reach, grace or wheel), or keep the burst.
const CROW_DEPART_HOP = { cells: 3, ms: 1500 };
// The crow's PEAK flight speed, m/s: every OTHER glide in _wildCrowTick — the
// roam, the panic dash away from a pet — is a quadratic leg
// (creatureFlightEase, whose peak is twice its mean), so it lasts
// 2 × distance / this, and a longer hop is a longer glide, never a faster
// one (WILD_SPEED_CEILING_MPS).
const CROW_FLIGHT_MPS = 9;
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
    * (1 + enemyMovementRandom(c, 'rout-distance') * (WANDER_OFF_MAX_MUL - 1));
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
  if (c._wanderOffInMs == null) c._wanderOffInMs = WANDER_OFF_MIN_MS + enemyMovementRandom(c, 'rout-delay') * WANDER_OFF_SPREAD_MS;
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
// A PEST: the animal the hard-mode pump dispatches at a planted field — a
// DEER since Sep 2026 (it was a crow; the owner moved crop-raiding to the
// deer). wanderCreatures mints its id `pest_deer_<tx>_<ty>_…`, the prefix the
// save.caught prune reads (`pest_crow_` markers from older sessions prune the
// same way). A wild deer the tile spawned is game, never a pest.
function isPest(c) {
  return !!c && typeof c.id === 'string' && c.id.startsWith('pest_');
}
// ONE predicate for wanderCreatures' pet scan: may `hunterKind` (a tame pet,
// or a summoned ally) go for creature `cr`? Two reasons, one lane:
//   a PET takes the kinds on its row's `prey` list (a cat crows; a dog deer
//     and slimes);
//   a hunter that `preysOnFoes` (the spirit raven) takes every Combat.isEnemy
//     foe and every dispatched pest — never a wild deer, a crow or anything
//     tame.
// Nobody's hunter takes a tamed (released_) animal. The caller still skips
// what is already caught.
function huntsPrey(hunterKind, cr) {
  if (!cr || Combat.isConcealed(cr) || Combat.isCharmed(cr) || Combat.isTame(cr)) return false;
  if (SpriteLayout.preysOnFoes(hunterKind)) return Combat.isEnemy(cr) || isPest(cr);
  const prey = SpriteLayout.creaturePrey(hunterKind);
  return !!prey && prey.has(cr.kind);
}

// Shared crow/bat interpolation. A quadratic leg's peak is twice its mean;
// hostile flight uses this fact to cap actual metres/second, not just averages.
function creatureFlightEase(t) {
  t = Math.max(0, Math.min(1, t));
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

// Check the whole segment: a long hop must not skip a burning cell. An
// escape may cross existing flames only while its starting point is on fire.
function fireStepAllowed(scene, c, x, y, escaping = false) {
  if (!scene._groundFireAtWorld || Conditions.flying(c)) return true;
  const wallNow = Date.now();
  let leavingFire = escaping && GroundFire.active(scene._groundFireAtWorld(c.x, c.y), wallNow);
  const n = Math.max(1, Math.ceil(Math.hypot(x - c.x, y - c.y) / (scene.cellM * 0.2)));
  for (let i = 1; i <= n; i++) {
    const fire = GroundFire.active(scene._groundFireAtWorld(
      c.x + (x - c.x) * i / n, c.y + (y - c.y) * i / n), wallNow);
    if (fire && !leavingFire) return false;
    if (!fire) leavingFire = false;
  }
  return true;
}

function enemyFireSafe(scene, x, y) {
  const record = scene._groundFireAtWorld?.(x, y);
  if (GroundFire.active(record, Date.now())) return false;
  // Burned ground cannot reignite, even underneath a surviving tree.
  if (record) return true;
  const cell = worldMetersToAbsCell(scene, x, y);
  return !scene._groundFireFuel?.({ ...cell, depth: scene.depth || 0 }).length;
}

// A small local search prefers no fire crossings, then the shortest route.
// Fuel is traversable: stopping at the first grass cell would strand a foe in
// a forest. Cardinal legs and the ordinary sweep gates preserve solid walls,
// roads and campfire wards. No search can inspect more than 289 cells.
function enemyFireEscapeRoute(scene, c, row) {
  if (enemyFireSafe(scene, c.x, c.y)) return [];
  const origin = worldMetersToAbsCell(scene, c.x, c.y);
  const start = { ...origin, x: c.x, y: c.y, cost: 0, path: [] };
  const pending = [start], best = new Map([[`${origin.cellIX}_${origin.cellIY}`, 0]]);
  let visited = 0;
  while (pending.length && visited++ < 289) {
    pending.sort((a, b) => a.cost - b.cost);
    const current = pending.shift();
    if (current.path.length && enemyFireSafe(scene, current.x, current.y)) return current.path;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const cell = absCellOffset(scene, current.cellIX, current.cellIY, dx, dy);
      const point = absCellCenterMeters(scene, cell.cellIX, cell.cellIY);
      if (Math.abs(point.x - c.x) > scene.cellM * 8 || Math.abs(point.y - c.y) > scene.cellM * 8) continue;
      const from = { ...c, x: current.x, y: current.y };
      if (!fireStepAllowed(scene, from, point.x, point.y, true)) continue;
      const n = Math.max(1, Math.ceil(Math.hypot(point.x - from.x, point.y - from.y) / (scene.cellM * 0.2)));
      let clear = true;
      for (let i = 1; i <= n; i++) {
        const x = from.x + (point.x - from.x) * i / n;
        const y = from.y + (point.y - from.y) * i / n;
        if (!enemyCanStep(scene, from, row, x, y, true)
            || (!c.lair && yardReasonAt(scene, x, y) && !yardReasonAt(scene, from.x, from.y))) {
          clear = false; break;
        }
      }
      if (!clear) continue;
      const fire = GroundFire.active(scene._groundFireAtWorld?.(point.x, point.y), Date.now());
      const cost = current.cost + 1 + (fire ? 1000 : 0);
      const key = `${cell.cellIX}_${cell.cellIY}`;
      if (best.has(key) && best.get(key) <= cost) continue;
      best.set(key, cost);
      pending.push({ ...cell, ...point, cost, path: [...current.path, point] });
    }
  }
  return [];
}

// LAVA BURNS FOES TOO (Combat.LAVA_DMG_PER_S, the player's rate — app.js
// _tickLava): whole points once a second off the foe's own HP through
// _damageEnemy, so the health bar and the "-2" read as any other blow; a
// foe it kills is the ground's kill ('lava' is no player source —
// Combat.isPlayerKill): the bounty coin and nothing past it. On the surface
// (a vent) and the lava level; never a body lava cannot burn (Combat.canBurn
// — concealed or lavaImmune), a fire-immune one, or a tame one (a pet is
// never burned). The standing burn itself is _tickUnitFire's (its exposure
// reads the same cell), so nothing here re-lights it. True when it killed.
function lavaTick(scene, c, now) {
  if (!Combat.canBurn(c) || Combat.isTame(c) || Conditions.fireImmune(c)) return false;
  if (scene.depth !== 0 && scene.depth !== WorldGen.LAVA_DEPTH) return false;
  if (now < (c._lavaNextT || 0)) return false;
  c._lavaNextT = now + 1000;
  const under = scene.cellAt(c.x, c.y);
  return under.loaded && under.type === WorldGen.T.CAVE_LAVA
    && !!scene._damageEnemy(c, Combat.LAVA_DMG_PER_S, 'lava');
}

// Burning takes priority over attacks, charges and idle pauses. Once safe,
// the enemy waits out its burn rather than immediately chasing into fuel.
function enemyFireEscapeTick(scene, c, row, now, dt) {
  if (!Combat.isEnemy(c) || !Combat.burning(c, now)) {
    c._fireEscapeRoute = null;
    return false;
  }
  c._startX = c._targetX = c.x; c._startY = c._targetY = c.y;
  c._stepT0 = c._nextChooseT = now;
  c._attackWindupUntil = c._lungeUntil = c._batT0 = null;
  row = row || EnemyRoster.get(c.kind);
  if (c.stationary || !row || row.movement.pattern === 'anchor_spit') return true;
  if (!c._fireEscapeRoute || now >= (c._fireEscapePlanT || 0)) {
    c._fireEscapeRoute = enemyFireEscapeRoute(scene, c, row);
    c._fireEscapePlanT = now + 250;
  }
  const point = c._fireEscapeRoute[0];
  if (!point) return true;
  const distance = Math.hypot(point.x - c.x, point.y - c.y);
  // Out of the fire at the hurry pace (hurryMps over the row's base speed),
  // times the one pace multiplier.
  const speed = hurryMps(c, row.movement.speedMetersPerSecond || foeChaseMps(c, scene.cellM));
  const step = Math.min(distance, speed * dt * Combat.paceMul(c));
  if (distance > 0 && !enemySweep(scene, c, row, c.x + (point.x - c.x) / distance * step,
      c.y + (point.y - c.y) / distance * step, now, true)) c._fireEscapeRoute = null;
  else if (step >= distance) c._fireEscapeRoute.shift();
  return true;
}

// Shared with the GPS-following body: try a one-cell jog that also clears
// the forward neighbour, holding the chosen side so each jog cannot reverse it.
function committedDetourDir(owner, ux, uy, open, now, commitMs = 1000) {
  const fwd = Math.abs(ux) >= Math.abs(uy) ? [Math.sign(ux), 0] : [0, Math.sign(uy)];
  if (!fwd[0] && !fwd[1]) return null;
  const perp = fwd[0] !== 0 ? [0, 1] : [1, 0];
  const hold = owner._detourHold;
  const held = hold && now < hold.until && hold.fx === fwd[0] && hold.fy === fwd[1];
  const lean = fwd[0] !== 0 ? Math.sign(uy) : Math.sign(ux);
  const first = held ? hold.side : (lean < 0 ? -1 : 1);
  for (const side of [first, -first]) {
    const x = perp[0] * side, y = perp[1] * side;
    if (open(x, y) && open(x + fwd[0], y + fwd[1])) {
      owner._detourHold = { fx: fwd[0], fy: fwd[1], side, until: now + commitMs };
      return { x, y };
    }
  }
  return null;
}

function enemyWalkHazardRate(scene, x, y) {
  if (!scene._walkHazardCell) return 0;
  const p = worldMetersToTileCell(scene, x, y);
  return scene._walkHazardCell(p.tx, p.ty, p.ix, p.iy);
}

// Resolve last frame's actual movement before AI can take another step. This
// also covers flights, fear retreats and charmed foes without a second mover.
// The shared exposure query excludes cut/burned pieces and takes max overlap.
function enemyWalkHazardTick(scene, c, now) {
  const previous = c._walkHazardPrevious;
  c._walkHazardPrevious = { x: c.x, y: c.y, now };
  if (Conditions.flying(c)) { c._walkHazardAccum = 0; return false; }
  if (!previous || !Combat.isEnemy(c) || !scene._walkHazardExposure) return false;
  if (previous.x === c.x && previous.y === c.y) return false;
  const dt = Math.min(0.1, Math.max(0, (now - previous.now) / 1000));
  const rate = scene._walkHazardExposure(previous.x, previous.y, c.x, c.y);
  const damage = bankWhole(c, '_walkHazardAccum', rate * dt);
  if (!damage) return false;
  return !!scene._damageEnemy(c, damage, 'obstacle');
}

// A FOE'S BLOW LANDS ON THE PLAYER — the one writer for every contact in the
// sim (a roster foe's melee and aura, a slime trail, a ghost's touch, a
// hunted deer's butt, a thrown Blight's drain). `raw` is the blow after the
// attacker's own power (Combat.meleeBlow); the shield, armour and mode have
// their say through Combat.incomingDamage unless the caller already
// mitigated a packet rate (`mitigated`: Combat.playerDamageRate, fractional
// — the scene's writer banks the pips: _losePlayerEnergy, Energy.set, the
// flinch, a shop shut). What was lost joins the scene's ONE drain roll-up
// (app.js _bankDrain, the 'monsters' lane popped as "⚔️ monsters"), never a
// pop of its own; a row's `condition` lands with a blow that cost something.
function foeBlowLands(scene, c, raw, { condition = null, mitigated = false } = {}) {
  const dmg = mitigated ? raw : Combat.incomingDamage(scene.save, raw);
  if (!(dmg > 0)) return 0;
  const lost = scene._losePlayerEnergy(dmg, { closeShop: true });
  scene._bankDrain?.('monsters', -lost, { label: '⚔️ monsters' });
  if (lost > 0 && typeof Pirates !== 'undefined') Pirates.onHit(scene, c);
  const raid = c && Combat.monster(c.kind)?.hitAndRun;
  if (lost > 0 && raid && !Combat.raidSpent(scene.save, c)) {
    Combat.bankRaid(scene.save, c);
    const taken = scene._losePlayerCoins(raid.coins, null);
    scene._toast?.(`${Combat.monster(c.kind).name} stole ${taken} coins!`, { tier: 'note' });
    if (typeof persistSave === 'function') persistSave(scene.save);
  }
  if (lost > 0 && condition) scene._applyCondition(condition);
  return lost;
}

// ── THE ONE STEP TEST: may `c` step onto (x, y)? ─────────────────────────
// Both movers ask it — rosterEnemyMove's sweep through enemyCanStep, the
// animals' and pets' step chain directly — so a refused cell is refused to
// everything alike: a placed rock; water / a building / a major road
// (Combat.faunaBlocksCell; a keep's own floor to its garrison); THE KERB
// (nothing steps onto a major band, a FAST mover never INTO the buffer from
// outside it — an ally goes where it likes); and on a RETREAT (`retreating`:
// a rout, a bolt, the kerb turn, a flee pattern) never INTO a yard it is not
// already in (THE ROADSIDE RUN; a lair guard walks home through its own
// ruin's). A FOE (`row`) is also held by ground fire (fireStepAllowed;
// `escaping` lets it leave a burning cell), an unloaded cell, a cave wall
// (scene._cellBlocked), a building's wall and a campfire's ward
// (fireAverse); a flier (orbit_swoop) crosses low terrain.
function creatureStepRefused(scene, c, x, y, { row = null, retreating = false, escaping = false } = {}) {
  if (typeof EnemySpawns !== 'undefined' && !EnemySpawns.homeFaunaAllows(scene, c, x, y)) return true;
  if (!fireStepAllowed(scene, c, x, y, escaping)) return true;
  const trap = Conditions.flying(c) ? null : characterTrapAt(scene, x, y);
  if (trap && trap !== characterTrapAt(scene, c.x, c.y)) return true;
  const cell = scene.cellAt(x, y);
  if (!cell.loaded) return true;
  if (row) {
    if (!cell.loaded) return true;
    if (scene._cellBlocked(x, y)) return true;
  }
  // A building is solid, except a keep's own floor to its garrison.
  const ownFloor = cell.loaded && WorldGen.isBuildingTerrain(cell.type) && Lairs.inOwnKeep(c, x, y);
  if (row && WorldGen.isBuildingTerrain(cell.type) && !ownFloor) return true;
  if (scene.placedRockSet?.size) {
    const { cellIX, cellIY } = worldMetersToAbsCell(scene, x, y);
    if (scene.placedRockSet.has(cellKeyFromAbsCell(cellIX, cellIY))) return true;
  }
  if (row?.movement.waterOnly) {
    if (cell.type !== WorldGen.T.WATER) return true;
    if (row.movement.shoreOnly) {
      const typeAt = (cx, cy) => {
        const neighbour = scene.cellAt(x + cx * scene.cellM, y + cy * scene.cellM);
        return neighbour.loaded ? neighbour.type : null;
      };
      if (!EnemyHabitats.shoreWater(typeAt, 0, 0)) return true;
    }
  } else if (cell.loaded && row?.movement.pattern !== 'orbit_swoop' && !ownFloor && Combat.faunaBlocksCell(cell.type)) return true;
  if (!Combat.isAlly(c)) {
    const road = roadClassBitsAt(scene, x, y);
    if (road & WorldGen.ROAD_CLASS_MAJOR_BAND) return true;
    if (road & WorldGen.ROAD_CLASS_JUNCTION_EXCLUDE) return true;
    if ((road & WorldGen.ROAD_CLASS_MAJOR_BUFFER) && !inKerbAt(scene, c.x, c.y)
        && isFastMover(c, scene.cellM)) return true;
    if ((road & WorldGen.ROAD_CLASS_JUNCTION_SOFT) && !inSoftJunctionAt(scene, c.x, c.y)
        && isFastMover(c, scene.cellM)) return true;
    if (retreating && !c.lair && yardReasonAt(scene, x, y) && !yardReasonAt(scene, c.x, c.y)) return true;
  }
  return !!row && fireAverse(c, row) && !!scene._nearAny?.('fires', x, y, FIRE_REST_R);
}
// The roster mover's door to it. Every segment is swept, including fast
// flights and lunges. `retreating` is stamped on the creature by
// rosterEnemyMove for the sweep (`c._retreating`), so a routed foe's whole
// segment keeps out of the yards.
function enemyCanStep(scene, c, row, x, y, escaping = false) {
  return !creatureStepRefused(scene, c, x, y, { row, escaping, retreating: !!c._retreating });
}
// FIRE AVERSION — the ONE rule for which foe a lit campfire turns back: a
// WILD foe introduced at the cave's entry level (the row's `cave.minDepth`
// ≤ FIRE_WARD_MAX_DEPTH — the surface slime, the cave slime, the bat; a
// surface-only row with no cave window counts as entry level). A cave DEPTH,
// never the power tier: a purple slime is tier 1 but a depth-3 kind and
// walks through firelight; a goblin (minDepth 3) or its archer is
// undeterred by it. NOT A LAIR GUARD, whatever kind it is: a garrison is a
// place, not wandering fauna — a campfire dropped by the door cannot empty
// a ruin, and a guard walking home past a fire would freeze in the street.
// The ward's ring is FIRE_REST_R, the ring the fire lights and warms, never
// a literal of its own. Both movers read this one predicate through
// creatureStepRefused (test/node/home_ward.test.js).
function fireAverse(c, row) { return !Conditions.flying(c) && !c.lair && (row.cave?.minDepth ?? 1) <= FIRE_WARD_MAX_DEPTH; }
function enemySweep(scene, c, row, x, y, now = performance.now(), escaping = false, allow = null) {
  let dx = x - c.x, dy = y - c.y;
  const distance = Math.hypot(dx, dy);
  // Sharp plants, spikes and visible cave-ins prefer the body's same short jog
  // when it fits; a broad belt has no trivial detour, so keep going through.
  const collapseExposure = (nx, ny) => globalThis.EnvironmentHazards?.exposure?.(scene, c.x, c.y, nx, ny) || 0;
  if (!escaping && !Conditions.flying(c) && distance > 0
      && (scene._walkHazardExposure?.(c.x, c.y, x, y) > 0 || collapseExposure(x, y) > 0)) {
    const open = (ox, oy) => {
      const nx = c.x + ox * scene.cellM, ny = c.y + oy * scene.cellM;
      return (!allow || allow(nx, ny)) && enemyCanStep(scene, c, row, nx, ny) && enemyWalkHazardRate(scene, nx, ny) === 0
        && !(globalThis.EnvironmentHazards?.exposure?.(scene, nx, ny, nx, ny) > 0);
    };
    const jog = committedDetourDir(c, dx / distance, dy / distance, open, now);
    if (jog) { dx = jog.x * distance; dy = jog.y * distance; }
  }
  const n = Math.max(1, Math.ceil(distance / (scene.cellM * 0.2)));
  const sx = c.x, sy = c.y;
  let clear = true;
  for (let i = 1; i <= n; i++) {
    const nx = sx + dx * i / n, ny = sy + dy * i / n;
    if ((allow && !allow(nx, ny)) || !enemyCanStep(scene, c, row, nx, ny, escaping)) { clear = false; break; }
    globalThis.EnvironmentHazards?.touch?.(scene, c, c.x, c.y, nx, ny);
    c.x = nx; c.y = ny;
    if (row?.trail && c._laySlimeTrail) enemyLaySlimeTrail(scene, c, row);
  }
  // A blocked sweep can still advance partway. Face only its accepted motion.
  SpriteLayout.updateCreatureFacing(c, c.x - sx, c.y - sy, now);
  return clear;
}

// Walls and buildings block hostile sight even on the surface, where the
// player's cave-only _cellBlocked predicate deliberately returns false.
function enemySightBlocked(scene, c, x, y) {
  const cell = scene.cellAt(x, y);
  if (!cell.loaded || scene._cellBlocked(x, y)) return true;
  if (WorldGen.isBuildingTerrain(cell.type) && !Lairs.inOwnKeep(c, x, y)) return true;
  if (scene.placedRockSet?.size) {
    const cell = worldMetersToAbsCell(scene, x, y);
    if (scene.placedRockSet.has(cellKeyFromAbsCell(cell.cellIX, cell.cellIY))) return true;
  }
  return false;
}

// ── A CADENCE: a cooldown with an interruptible wind-up ──────────────────
// The one state machine behind a foe's attack and its support ability: two
// fields on the creature (`next`, when the beat is due again; `windup`, the
// tell in progress or null), the beat starting when the tell does so the
// declared interval includes the wind-up rather than extending every cycle.
// Returns 'fire' the instant the blow lands (the tell over, or no tell),
// 'winding' while the tell runs, 'wait' otherwise. Not `eligible` (leaving
// range, hiding, a ward) cancels the tell. A CHILLED foe (Combat.slowMul —
// the frost) beats on a longer interval; the tell itself is untouched (a
// slow does not interrupt, and does not stretch a tell).
const ATTACK_CADENCE = { next: '_attackNextT', windup: '_attackWindupUntil' };
const ABILITY_CADENCE = { next: '_abilityNextT', windup: '_abilityWindupUntil' };
function cadence(c, slot, intervalMs, windupMs, now, eligible) {
  if (!eligible) { c[slot.windup] = null; return 'wait'; }
  if (c[slot.windup] != null) {
    if (now < c[slot.windup]) return 'winding';
    c[slot.windup] = null;
    return 'fire';
  }
  if (now < (c[slot.next] || 0)) return 'wait';
  c[slot.next] = now + intervalMs / Combat.slowMul(c);
  if (!(windupMs > 0)) { c[slot.windup] = null; return 'fire'; }
  c[slot.windup] = now + windupMs;
  return 'winding';
}
function enemyAttackReady(c, row, now, eligible) {
  return cadence(c, ATTACK_CADENCE, row.damageIntervalSeconds * 1000, row.windupSeconds * 1000, now, eligible) === 'fire';
}
// ── THE NEAREST CREATURE to `c` ────────────────────────────────────────────
// ONE scan for every "who is closest" the sim asks: a caster's wounded
// ally, a charmed foe's opponent, a hostile's nearest neighbour or ally, a
// pet's prey. Over `opts.pool` when given (a prepared list: the charmed
// allies, the neighbours in range), else the 3×3 tile ring round `c`
// (WorldGen.forEachItemNear — or round `opts.tile`, the player's, for a
// pet's scan); never `c` itself or a concealed body; within `radiusM`;
// `accept(other, d)` says what counts; `opts.los` also asks for a clear line
// of fire (Combat.lineOfFire over enemySightBlocked — the same rock that
// stops an arrow). The nearest, or null — or every one that counts, in the
// order met, with `opts.all` (a healer's wounded allies).
function nearestCreature(scene, c, radiusM, accept, opts = {}) {
  let best = null, bestD = radiusM;
  const all = opts.all ? [] : null;
  const consider = other => {
    if (other === c || Combat.isConcealed(other)) return;
    const d = Math.hypot(other.x - c.x, other.y - c.y);
    if (d > bestD || !accept(other, d)) return;
    if (opts.los && !Combat.lineOfFire(c.x, c.y, other.x, other.y,
      (x, y) => enemySightBlocked(scene, c, x, y), scene.cellM)) return;
    if (all) all.push(other); else { best = other; bestD = d; }
  };
  if (opts.pool) opts.pool.forEach(consider);
  else {
    const pc = opts.tile || worldMetersToTileCell(scene, c.x, c.y);
    WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, consider);
  }
  return all || best;
}
// A caster's support action uses its own interruptible wind-up. Summons have
// two fixed identity slots per caster: defeated slots never refill after a
// reload, so neither enemy count nor rewards can grow without bound.
function enemySupportAllies(scene, c, radiusCells) {
  const caught = new Set(scene.save.caught || []);
  return nearestCreature(scene, c, radiusCells * scene.cellM,
    ally => Combat.isEnemy(ally) && !caught.has(ally.id), { los: true, all: true });
}
// What a garrison's child inherits from its parent (a necromancer's summon,
// a split slime's twin): lairs.js GARRISON_INHERIT — the leash, the seat
// bounds, the aggro ring, the home, the surface seat and habitat, the zone
// variant and the hunt. Read at call time (lairs.js loads first).
function garrisonInherit() { return Lairs.GARRISON_INHERIT; }
function enemySummon(scene, c, ability) {
  const kind = ability.kind, row = EnemyRoster.get(kind);
  if (!row) return false;
  const pc = worldMetersToTileCell(scene, c.x, c.y);
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
  if (!entry?.creatures) return false;
  const caught = new Set(scene.save.caught || []);
  const existing = new Set();
  WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, other => existing.add(other.id));
  const slots = CreatureSpawns.frequencyCount(CreatureSpawnEvents.summon(ability).frequency, Math.random);
  for (let slot = 0; slot < slots; slot++) {
    const id = `${c.id}_summon_${slot}`;
    if (caught.has(id) || existing.has(id)) continue;
    let destination = null;
    const seat = ringSeat(c.x, c.y, scene.cellM, 0, (x, y) => {
      const cell = worldMetersToTileCell(scene, x, y);
      destination = WorldGen.tileCache.get(WorldGen.tileKey(cell.tx, cell.ty));
      if (!destination?.creatures || !enemyCanStep(scene, c, row, x, y)) return false;
      const grid = destination.baseGrid || destination.grid;
      const opts = destination._spawnOpts;
      if (!grid || !opts || !CreatureSpawns.gateAt(scene, x, y, kind)) return false;
      return !destination.creatures.some(other => !caught.has(other.id)
          && Math.hypot(other.x - x, other.y - y) < scene.cellM * 0.7);
    });
    if (!seat) return false;
    {
      const { x, y } = seat;
      // Its id extends its summoner's, so it is world-shared when they are.
      const child = EnemySpawns.markShared(WorldGen.makeCreature(kind, x, y, id), c._sharedId === true);
      // A garrison's escort inherits its leash, its ground and its
      // difficulty (GARRISON_INHERIT — the one list a split twin reads too),
      // not a new lair: quiet-home and the amnesty hide the skeletons with
      // their necromancer.
      for (const key of garrisonInherit()) if (c[key] != null) child[key] = c[key];
      child.seatX = x; child.seatY = y;
      child._summonerId = c.id;
      destination.creatures.push(child);
      return true;
    }
  }
  return false;
}
// ── THE SPLITTING SLIME (a roster row's `ability.type === 'split'`) ───────
// Struck, it DIVIDES: the blow's victim keeps half its remaining pool and
// steps one cell to one side of the blow, and a twin with the other half
// rises one cell to the other side — perpendicular to the striker first (the
// two flank you), along the line of the blow when a flank is blocked, and not
// at all when neither pair of cells is open. It stops dividing once a half
// would carry less than the row's minHp, so the total pool is CONSERVED and
// the swarm is bounded (32 hp at minHp 4 is at most eight slimes). One split
// per cooldownSeconds: the melee wheel calls the damage lane every frame.
//   The twin is the lineage's: its id is the root guard's plus a serial that
// skips anything already in save.caught (a killed twin stays killed, and a
// re-split never re-mints it), it inherits the garrison fields exactly as a
// summoned escort does (enemySummon), and both halves carry `_splitShare`,
// halved each time, so the BOUNTY of the lineage sums to one slime's
// (resolveDefeat reads it) however many pieces it is paid in. Session-only
// like every other `_hp`: a re-woken ruin seats the one slime it generated.
//   Returns the twin, or null when nothing divided. Pure of any particular
// damage source: app.js _damageEnemy (a blow, never lava, light or a burn —
// a burning slime would divide every tick) and the pet fight both call it.
function enemySplit(scene, c, fromX, fromY, now) {
  const row = EnemyRoster.get(c.kind), a = row && row.ability;
  if (!a || a.type !== 'split') return null;
  const hp = Combat.hp(c);
  if (hp < 2 * a.minHp) return null;
  if (now < (c._splitNextT || 0)) return null;
  const cellM = scene.cellM;
  const base = Math.atan2(c.y - fromY, c.x - fromX);
  let seats = null;
  for (const angles of [[base + Math.PI / 2, base - Math.PI / 2], [base, base + Math.PI]]) {
    const pair = [];
    for (const ang of angles) {
      const x = c.x + Math.cos(ang) * cellM, y = c.y + Math.sin(ang) * cellM;
      if (!enemyCanStep(scene, c, row, x, y)) break;
      pair.push({ x, y });
    }
    if (pair.length === 2) { seats = pair; break; }
  }
  if (!seats) return null;
  const tc = worldMetersToTileCell(scene, seats[1].x, seats[1].y);
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(tc.tx, tc.ty));
  if (!entry || !entry.creatures) return null;
  const caught = new Set((scene.save && scene.save.caught) || []);
  const root = c._splitRoot || c.id;
  const serial = scene._splitSerial || (scene._splitSerial = new Map());
  let n = serial.get(root) || 0, id;
  do { n++; id = `${root}_s${n}`; } while (caught.has(id) || entry.creatures.some(o => o.id === id));
  serial.set(root, n);
  const half = Math.floor(hp / 2);
  const share = (c._splitShare ?? 1) / 2;
  c._hp = hp - half; c._splitShare = share; c._splitRoot = root; c._splitNextT = now + a.cooldownSeconds * 1000;
  c.x = seats[0].x; c.y = seats[0].y;
  // Another character can split this slime during its own turn. Refresh the
  // original now; the newborn joins the next pass's body list as before.
  if (scene._characterSpacingIndex) updateCharacterSpacingIndex(scene._characterSpacingIndex, c);
  const twin = WorldGen.makeCreature(c.kind, seats[1].x, seats[1].y, id, { shiny: false });
  for (const key of [...garrisonInherit(), '_lastDamagedT']) if (c[key] != null) twin[key] = c[key];
  twin._hp = half; twin._splitShare = share; twin._splitRoot = root; twin._splitNextT = c._splitNextT;
  // Each half's seat is where it now stands, so a garrison's halves walk home
  // to two seats rather than piling onto one.
  if (c.lair) { c.seatX = c.x; c.seatY = c.y; twin.seatX = twin.x; twin.seatY = twin.y; }
  entry.creatures.push(twin);
  return twin;
}
// The caster's support beat (ABILITY_CADENCE): a blow taken during the tell
// breaks it (the damage stamp); a healer with nobody wounded looks again in
// a second rather than spending its beat. True while the ability holds the
// foe (its tell, or the instant it lands).
// The support ability this foe uses: its elite rank's when it has one (an
// ascendant summons copies of its basic form — Combat.ELITE_RANKS), else the
// row's. Built once per creature so the cadence reads a stable object.
function supportAbility(c, row) {
  const own = Combat.eliteRank(c)?.ability;
  if (!own) return row.ability;
  return c._rankAbility ||= { ...own, kind: row.variantOf || c.kind };
}
function enemySupportTick(scene, c, row, now, eligible) {
  const a = supportAbility(c, row);
  if (!a) return false;
  const winding = c._abilityWindupUntil != null;
  if (winding && c._lastDamagedT !== c._abilityDamageStamp) eligible = false;
  if (!winding && eligible && now >= (c._abilityNextT || 0) && a.type === 'heal'
      && !enemySupportAllies(scene, c, a.radiusCells).some(ally => Combat.hp(ally) < Combat.maxHp(ally))) {
    c._abilityNextT = now + 1000;
    return false;
  }
  const phase = cadence(c, ABILITY_CADENCE, a.intervalSeconds * 1000, a.windupSeconds * 1000, now, eligible);
  if (!winding && phase === 'winding') c._abilityDamageStamp = c._lastDamagedT;
  if (phase !== 'fire') return phase === 'winding';
  if (a.type === 'heal') {
    const target = enemySupportAllies(scene, c, a.radiusCells).find(ally => Combat.hp(ally) < Combat.maxHp(ally));
    if (target) {
      target._hp = Math.min(Combat.maxHp(target), Combat.hp(target) + a.amount);
      target._supportUntil = now + 600;
    }
  } else if (a.type === 'summon') enemySummon(scene, c, a);
  return true;
}
// The target footprint is fixed when the tell begins. Moving out avoids the
// blow; it cannot follow the player at the moment it lands.
function enemyAreaContains(c, row, px, py, cellM) {
  const aim = c._attackAim;
  if (!aim) return false;
  if (row.attackType === 'area') return Math.hypot(px - aim.x, py - aim.y) <= row.area.radiusCells * cellM;
  if (row.attackType === 'blast') return Math.hypot(px - c.x, py - c.y) <= row.blast.radiusCells * cellM;
  const angle = Math.atan2(py - c.y, px - c.x);
  const delta = Math.atan2(Math.sin(angle - aim.angle), Math.cos(angle - aim.angle));
  return Math.hypot(px - c.x, py - c.y) <= PotionEffects.range(c, row.range) * cellM
    && Math.abs(delta) <= row.breath.halfAngleRadians;
}
// Render time is monotonic even when the combat caller supplies a simulation clock.
function creatureMeleeSwing(c, targetX, targetY, reachCells) {
  const dx = targetX - c.x, dy = targetY - c.y;
  const length = Math.hypot(dx, dy);
  c._meleeSwing = { startT: performance.now(), reachCells,
    dir: length > 0 ? { x: dx / length, y: dy / length } : { x: 0, y: 1 } };
}

// A FOE AFTER ANOTHER PLAYER (Multiplayer.enemyTarget's peer body, in the
// npcTarget lane): this device's copy faces the peer's spot and, in reach,
// swings a melee kind's blow at its row's beat — and that is all. No damage,
// condition, theft, shot, web, trap or blast happens here: the peer's own
// device runs the same foe at them and applies its blows there, to them.
function peerFeint(scene, c, row, now, tx, ty) {
  if (Combat.isConcealed(c) || c._emergeUntil > now || Combat.isSleeping(c) || Combat.isParalyzed(c)
      || row.attackType === 'none') return false;
  const reach = PotionEffects.range(c, row.range);
  if (Math.hypot(tx - c.x, ty - c.y) > reach * scene.cellM) return false;
  SpriteLayout.faceCreature(c, tx - c.x, ty - c.y);
  if (row.attackType !== 'melee' || now < (c._peerFeintT || 0)) return false;
  c._peerFeintT = now + (row.damageIntervalSeconds || 1) * 1000;
  creatureMeleeSwing(c, tx, ty, reach);
  return true;
}
function rosterEnemyAttack(scene, c, row, now, px, py, inactive, dt, npcTarget = null, creatureTarget = null) {
  if (npcTarget?.peer) { if (!inactive) peerFeint(scene, c, row, now, px, py); return; }
  if (Combat.raidSpent(scene.save, c) || Combat.isPacified(c) || Combat.isPacified(creatureTarget)) return;
  if (Combat.isConcealed(c) || c._emergeUntil > now || Combat.isSleeping(c) || Combat.isParalyzed(c) || (Combat.isCharmed(c) && !creatureTarget)) return;
  if (creatureTarget && (Combat.isConcealed(creatureTarget)
      || Combat.isCharmed(c) === Combat.isCharmed(creatureTarget))) return;
  if (row.attackType === 'none') return;
  if (row.meleeWhenCondition) {
    const melee = !npcTarget && !creatureTarget && Conditions.active(scene.save, row.meleeWhenCondition.id);
    const mode = melee ? 'condition_melee' : 'primary';
    // Each attack retains its cooldown when the target enters/leaves the
    // condition; switching also cancels the old attack's unfinished wind-up.
    if (c._conditionalAttackMode && c._conditionalAttackMode !== mode) {
      (c._attackModeNext ||= {})[c._conditionalAttackMode] = c._attackNextT || 0;
      c._attackNextT = c._attackModeNext[mode] || 0;
      c._attackWindupUntil = null; c._attackAim = null;
    }
    c._conditionalAttackMode = mode;
    if (melee) row = {...row, ...row.meleeWhenCondition, id: row.id, attackType:'melee'};
  }
  const targetKey = creatureTarget?.id || npcTarget?.id || 'player';
  if (c._attackTargetKey != null && c._attackTargetKey !== targetKey) {
    c._attackWindupUntil = null; c._attackAim = null;
  }
  c._attackTargetKey = targetKey;
  if (npcTarget && !NPC.canTarget(scene, npcTarget)) inactive = true;
  const dist = Math.hypot(px - c.x, py - c.y);
  const attackRange = PotionEffects.range(c, row.range);
  if ((creatureTarget || npcTarget) && dist > Math.max(0,
    row.visionCells - PotionEffects.visionReduction(creatureTarget || npcTarget)) * scene.cellM) inactive = true;
  const territory = row.movement.territoryCells;
  const inTerritory = !territory || Math.hypot(px - (c._territoryX ?? c.homeX ?? c.x),
    py - (c._territoryY ?? c.homeY ?? c.y)) <= territory * scene.cellM;
  const attentive = !inactive && (creatureTarget || npcTarget || !Combat.playerDowned(scene.save.energy))
    && inTerritory && (creatureTarget || npcTarget || Combat.seesPlayer(c.kind, dist, scene.cellM, scene.save));
  if (row.movement.pattern === 'lunge_recover'
      && (now < (c._lungeWindupUntil || 0) || now < (c._lungeRecoverUntil || 0))) {
    enemyAttackReady(c, row, now, false);
    return;
  }
  const clear = attentive && Combat.lineOfFire(c.x, c.y, px, py,
    (x, y) => enemySightBlocked(scene, c, x, y), scene.cellM);
  if (!Combat.isCharmed(c) && enemySupportTick(scene, c, row, now, clear)) {
    SpriteLayout.faceCreature(c, px - c.x, py - c.y);
    return;
  }
  if (row.aura && clear && dist <= auraRadiusCells(row.aura) * scene.cellM) {
    if (npcTarget) {
      NPC.hit(scene, npcTarget, Date.now(), row.aura.rawDps * Combat.powerMul(c) * dt);
    } else if (creatureTarget) {
      scene._damageEnemy(creatureTarget, row.aura.rawDps * Combat.powerMul(c) * dt,
        Combat.isCharmed(c) ? 'ally' : 'enemy', { bypassArmor: true });
    } else {
      // Mitigated as one-second PACKETS (Combat.playerDamageRate — never the
      // one-point floor per frame), then the fractional rate goes to the one
      // blow writer, which banks whole pips.
      const a = row.aura;
      const raw = a.rawDps * Combat.powerMul(c);
      const loss = Combat.playerDamageRate(raw * PotionEffects.damageMul(scene.save), scene.save.armor, dt,
        { packetSeconds: a.mitigationPacketSeconds });
      foeBlowLands(scene, c, loss, { mitigated: true });
    }
  }
  if (row.attackType === 'trap') {
    const ready = enemyAttackReady(c, row, now, clear && dist <= attackRange * scene.cellM);
    if (ready || c._attackWindupUntil != null) SpriteLayout.faceCreature(c, px - c.x, py - c.y);
    if (ready && !Combat.isCharmed(c)) {
      scene._trapperLay(c, now, px, py);
    }
    return;
  }
  if ((!row.dmg && !row.steals && row.attackType !== 'web') || row.attackType === 'touch') return;
  const swoop = row.movement.pattern === 'orbit_swoop';
  const lunging = row.movement.pattern === 'lunge_recover' && now < (c._lungeUntil || 0);
  const shaped = ['area', 'breath', 'blast'].includes(row.attackType);
  const fixedAim = shaped || row.attackType === 'web';
  const winding = c._attackWindupUntil != null;
  // A `chargeOnly` charger (the boar) has no blow of its own: it hurts only
  // what it runs into mid-charge, once a charge.
  const eligible = (fixedAim && winding ? attentive : clear && dist <= attackRange * scene.cellM)
    && dist >= (row.minRange || 0) * scene.cellM
    && (!swoop || (c._batSwooping && !c._batHit)) && (!lunging || !c._lungeHit)
    && (!row.movement.chargeOnly || lunging);
  // The charge already warned before moving; contact lands once without
  // starting a second melee wind-up that would stop the charge mid-stride.
  const ready = enemyAttackReady(c, lunging ? {...row, windupSeconds: 0} : row, now, eligible);
  if (fixedAim && !winding && (c._attackWindupUntil != null || ready)) {
    c._attackAim = { x: px, y: py, angle: Math.atan2(py - c.y, px - c.x) };
  }
  if (ready || c._attackWindupUntil != null) {
    const aim = fixedAim ? c._attackAim : {x: px, y: py};
    SpriteLayout.faceCreature(c, aim.x - c.x, aim.y - c.y);
  }
  if (!ready) return;
  c._attackT0 = now;
  c._attackUntil = now + Math.max(600, row.windupSeconds * 1000);
  if (row.attackType === 'web') {
    // Commit to the cell aimed at during wind-up; dodging never steers the silk.
    SpiderWebs.launch(scene, c, c._attackAim.x, c._attackAim.y);
    return;
  }
  if (row.attackType === 'melee') creatureMeleeSwing(c, px, py, attackRange);
  const raw = row.attackType === 'melee' || row.attackType === 'touch'
    ? Combat.meleeBlow(c, row.dmg)
    : row.dmg * Combat.powerMul(c);
  if (row.movement.stopToReload) c._reloadUntil = now + row.movement.reloadSeconds * 1000;
  if (row.attackType === 'blast') {
    // A spent bomb carrier disappears without paying a kill reward.
    (scene.save.caught ||= []).push(c.id);
    if (typeof persistSave === 'function') persistSave(scene.save);
  }
  if (shaped && (!clear || !enemyAreaContains(c, row, px, py, scene.cellM))) return;
  if (row.attackType === 'projectile') {
    const shot = Combat.monsterShot(c.x, c.y, px, py, scene.cellM,
      raw * row.attackHits, row.attackHits);
    if (shot) {
      shot.projectile = row.projectile || (row.id === 'goblin_archer' ? 'arrow' : 'enemy_magic');
      shot.enemyKind = row.id;
      if (row.projectileCondition) shot.condition = row.projectileCondition;
      if (row.projectileSpeedMetersPerSecond) shot.speedMps = row.projectileSpeedMetersPerSecond;
      shot._sourceGuard = c;
      shot.hostile = !Combat.isCharmed(c);
      (scene._shots ||= []).push(shot);
    }
  } else if (creatureTarget) {
    scene._damageEnemy(creatureTarget, raw, Combat.isCharmed(c) ? 'ally' : 'enemy');
  } else if (npcTarget) {
    NPC.hit(scene, npcTarget, Date.now(), raw);
  } else if (row.steals) {
    // A THIEF'S SWOOP (Combat.incomingTheft — the raven's coins, the gull's
    // food): the same hit, on the purse or the bag instead of the bar, banked
    // by the scene's one thief writer. Nothing here touches energy.
    const take = Combat.incomingTheft(scene.save, c, Date.now());
    if (take) scene._losePlayerToThief(take, c);
  } else {
    foeBlowLands(scene, c, raw, { condition: Combat.monster(c.kind)?.condition });
  }
  if (swoop) c._batHit = true;
  if (lunging) c._lungeHit = true;
}

// Shared soft spacing for every mobile body. The scene gathers nearby actors
// once per sim tick, including the player. An injured/stationary body still
// occupies space; only its own movement is held. Spacing never teleports or
// spends more than the mover's usual step budget.
const FOE_SPACING_CELLS = 0.6;
// Rebuilt for each wander pass. Refresh a body's bucket after its movement,
// including early-return lanes, so later foes see its new position this tick.
function buildCharacterSpacingIndex(scene) {
  const index = { bodies: scene._characterBodies || scene._foeBodies, radius: FOE_SPACING_CELLS * scene.cellM,
    buckets: new Map(), records: new Map() };
  for (let order = 0; order < index.bodies.length; order++) {
    const body = index.bodies[order];
    index.records.set(body, { body, order, key: null });
    updateCharacterSpacingIndex(index, body);
  }
  return index;
}

function updateCharacterSpacingIndex(index, body) {
  const record = index.records.get(body);
  if (!record) return;
  const key = Math.floor(body.x / index.radius) + ',' + Math.floor(body.y / index.radius);
  if (key === record.key) return;
  if (record.key !== null) {
    const old = index.buckets.get(record.key);
    old.delete(record);
    if (!old.size) index.buckets.delete(record.key);
  }
  let bucket = index.buckets.get(key);
  if (!bucket) index.buckets.set(key, bucket = new Set());
  bucket.add(record);
  record.key = key;
}

function characterSpacingCandidates(index, c) {
  const bx = Math.floor(c.x / index.radius), by = Math.floor(c.y / index.radius);
  const nearby = [];
  for (let y = by - 1; y <= by + 1; y++) {
    for (let x = bx - 1; x <= bx + 1; x++) {
      const bucket = index.buckets.get(x + ',' + y);
      if (bucket) for (const record of bucket) nearby.push(record);
    }
  }
  // Preserve the original summation order, including exact-overlap tie breaks.
  nearby.sort((a, b) => a.order - b.order);
  return nearby;
}

function characterSpacingPush(scene, c) {
  const bodies = scene._characterBodies || scene._foeBodies;
  if (!bodies || bodies.length < 2) return null;
  const r = FOE_SPACING_CELLS * scene.cellM;
  let x = 0, y = 0;
  const index = scene._characterSpacingIndex;
  const candidates = index && index.bodies === bodies && index.radius === r
    ? characterSpacingCandidates(index, c) : null;
  for (const candidate of candidates || bodies) {
    const o = candidates ? candidate.body : candidate;
    if (o === c || (o.id && o.id === c.id)) continue;
    const dx = c.x - o.x, dy = c.y - o.y;
    if (Math.abs(dx) >= r || Math.abs(dy) >= r) continue;
    const d = Math.hypot(dx, dy);
    if (d >= r) continue;
    const w = (r - d) / r;
    if (d > 1e-6) { x += dx / d * w; y += dy / d * w; continue; }
    // One axis for the pair, opposite signs for its two members: hashing a
    // signed difference gives equal cosine pushes and can preserve a pile.
    const first = String(c.id) < String(o.id), ids = [String(c.id), String(o.id)].sort();
    const a = (strHash31(ids.join('|')) >>> 0) / 4294967296 * Math.PI * 2;
    const sign = first ? 1 : -1;
    x += Math.cos(a) * w * sign; y += Math.sin(a) * w * sign;
  }
  const len = Math.hypot(x, y);
  if (len < 1e-6) return null;
  return len > 1 ? { x: x / len, y: y / len } : { x, y };
}
function foeSpacingPush(scene, c) { return characterSpacingPush(scene, c); }

function characterTrapAt(scene, x, y) {
  if (typeof Traps === 'undefined' || !scene.originPx || !scene.startWorldM) return null;
  const p = worldMetersToTileCell(scene, x, y);
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(p.tx, p.ty));
  const trap = Traps.trapAt(entry, p.ix, p.iy);
  return trap && !Traps.isTrapDisarmed(scene.save || {}, trap) ? trap : null;
}

// Non-roster movers share the enemy's swept steps and committed hazard detour.
// `pace` also lets a resting follower gently part from overlapping characters.
function characterMove(scene, c, x, y, now, { pace = Math.hypot(x - c.x, y - c.y), allow = null } = {}) {
  if (!(pace > 0) || c.stationary || (typeof Pets !== 'undefined' && Pets.isDown(c))) return false;
  const push = characterSpacingPush(scene, c);
  let dx = x - c.x + (push?.x || 0) * pace, dy = y - c.y + (push?.y || 0) * pace;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return false;
  const step = Math.min(length, pace), sx = c.x, sy = c.y;
  dx = dx / length * step; dy = dy / length * step;
  if (!enemySweep(scene, c, null, sx + dx, sy + dy, now, false, allow)) {
    const remaining = Math.max(0, step - Math.hypot(c.x - sx, c.y - sy));
    const side = c._avoidSide ?? ((strHash31(c.id || '') & 1) ? 1 : -1);
    for (const turn of [side, -side]) {
      const nx = c.x - dy / step * remaining * turn, ny = c.y + dx / step * remaining * turn;
      if ((allow && !allow(nx, ny)) || creatureStepRefused(scene, c, nx, ny)) continue;
      if (enemySweep(scene, c, null, nx, ny, now, false, allow)) { c._avoidSide = turn; break; }
    }
  }
  return Math.hypot(c.x - sx, c.y - sy) > 1e-9;
}

// Release/rejoin seats are deterministic for the individual, but checked live
// against terrain, traps and other bodies. A crowded/blocked area waits; it
// never falls back to stacking everyone on the player's feet.
function characterFreePoint(scene, c, x, y, bodies = scene._characterBodies || scene._foeBodies || []) {
  const phase = (strHash31(c.id || '') >>> 0) / 4294967296 * Math.PI * 2;
  for (const ring of [0.8, 1.3, 2, 3]) {
    for (let i = 0; i < 12; i++) {
      const angle = phase + i * Math.PI / 6;
      const nx = x + Math.cos(angle) * ring * scene.cellM, ny = y + Math.sin(angle) * ring * scene.cellM;
      const probe = { ...c, x: nx, y: ny };
      if (characterTrapAt(scene, nx, ny) || creatureStepRefused(scene, probe, nx, ny)
          || enemyWalkHazardRate(scene, nx, ny) > 0) continue;
      if (bodies.some(o => o !== c && o.id !== c.id && Math.hypot(nx - o.x, ny - o.y) < FOE_SPACING_CELLS * scene.cellM)) continue;
      return { x: nx, y: ny };
    }
  }
  return null;
}

// Discovery gates movement and effects for wild animals as well as enemies.
function enemyConcealmentTick(scene, c) {
  if (!c.hidden && !c.stealthy) return false;
  HiddenObjects.reveal(scene, c);
  c._discovered = !HiddenObjects.isHidden(scene.save, c);
  return !c._discovered;
}

// A camouflaged foe holds its authored seat until the player gets close.
// The same predicate keeps weapons and the renderer on the disguised state.
function enemyDisguiseTick(scene, c, px, py) {
  if (!Combat.isDisguised(c)) return false;
  const disguise = EnemyRoster.get(c.kind).disguise;
  if (Math.hypot(px - c.x, py - c.y) > disguise.revealCells * scene.cellM) return true;
  c._disguiseRevealed = true;
  c._hunting = true;
  scene._burstAtWorld?.('timber', c.x, c.y);
  return false;
}

function enemyStartEmerging(scene, c, row, now) {
  c._emergeT0 = now;
  c._emergeUntil = now + (row.movement.emergeSeconds || 0.8) * 1000;
  scene._burstAtWorld?.('stone', c.x, c.y);
}
// Burrowing foes alternate between hidden travel and a visible attack window.
// Candidate emergence cells are authored by the strip mine, never the player.
function enemyBurrowTick(scene, c, row, now) {
  if (!row) return false;
  const m = row.movement;
  if (c._emergeUntil > now) return true;
  if (c.emergeFromGround && !c._hasEmerged) {
    c._burrowed = true;
    const { x: px, y: py } = playerWorldM(scene);
    if (scene.isUnnoticed(c) || !Combat.seesPlayer(c.kind, Math.hypot(px - c.x, py - c.y), scene.cellM, scene.save)) return true;
    c._burrowed = false; c._hasEmerged = true;
    enemyStartEmerging(scene, c, row, now);
    return true;
  }
  if (m.pattern !== 'burrow') return false;
  const duration = (range, decision) => (range[0] + enemyMovementRandom(c, decision) * (range[1] - range[0])) * 1000;
  if (c._burrowNextT == null || (!c._burrowed && now >= c._burrowNextT)) {
    c._burrowed = true;
    c._burrowNextT = now + duration(m.burrowSeconds, 'burrow-delay');
    c._attackWindupUntil = null;
    c._walkHazardPrevious = null;
  }
  if (!c._burrowed) return false;
  if (now < c._burrowNextT) return true;
  const cells = c.burrowCells;
  for (let attempt = 0; attempt < 16; attempt++) {
    let x = c.homeX ?? c.x, y = c.homeY ?? c.y;
    if (cells?.length) {
      const point = cells[Math.floor(enemyMovementRandom(c, 'burrow-seat') * cells.length)];
      x = point.x; y = point.y;
    }
    if (!enemyCanStep(scene, c, row, x, y)) continue;
    c.x = x; c.y = y;
    c._burrowed = false;
    enemyStartEmerging(scene, c, row, now);
    c._burrowNextT = c._emergeUntil + duration(m.surfacedSeconds, 'surface-delay');
    c._attackNextT = c._emergeUntil;
    return true;
  }
  c._burrowNextT = now + 1000;
  return true;
}

// Trails belong to the ground, so they survive their maker and expire on the
// wall clock, including time spent away or on another dungeon level.
function enemyLaySlimeTrail(scene, c, row) {
  const trail = row.trail, now = Date.now();
  const spacing = trail.spacingCells * scene.cellM;
  const key = `${scene.depth || 0}:${Math.round(c.x / spacing)}:${Math.round(c.y / spacing)}`;
  const patches = scene.save.slimeTrails ||= {};
  const previous = patches[key];
  if (previous && now - previous.createdAt < 1000) return;
  patches[key] = { x: c.x, y: c.y, depth: scene.depth || 0, createdAt: now,
    expiresAt: now + trail.durationSeconds * 1000,
    radius: trail.radiusCells * scene.cellM, rawDps: trail.rawDps * Combat.powerMul(c) };
  if (typeof persistSave === 'function') persistSave(scene.save);
}
function enemySlimeTrailTick(scene, px, py, dt, now = Date.now()) {
  const patches = scene.save.slimeTrails;
  if (!patches) return;
  let rawDps = 0, expired = false;
  for (const [key, patch] of Object.entries(patches)) {
    if (patch.expiresAt <= now) { delete patches[key]; expired = true; continue; }
    if (patch.depth === (scene.depth || 0)
        && Math.hypot(px - patch.x, py - patch.y) <= patch.radius) {
      // Overlapping marks form one puddle rather than multiplying damage.
      rawDps = Math.max(rawDps, patch.rawDps);
    }
  }
  if (expired && typeof persistSave === 'function') persistSave(scene.save);
  if (!rawDps || Combat.playerDowned(scene.save.energy) || Conditions.flying(scene.save, now)) return;
  // One-second packets through the one blow writer (the aura's shape).
  foeBlowLands(scene, null, Combat.playerDamageRate(rawDps * PotionEffects.damageMul(scene.save),
    scene.save.armor, dt, { packetSeconds: 1 }), { mitigated: true });
}

function rosterEnemyMove(scene, c, row, now, px, py, inactive, routed, lairState, dt, creatureTarget = null) {
  if (c._pirateParleyPending) return;
  if (Combat.raidSpent(scene.save, c)) { routed = true; creatureTarget = null; }
  if (Combat.isPacified(c)) { inactive = true; creatureTarget = null; }
  if (Combat.isConcealed(c) || Combat.isSleeping(c) || Combat.isParalyzed(c)) return;
  Combat.healIfRested(c);
  const m = row.meleeWhenCondition && c._attackTargetKey === 'player'
      && Conditions.active(scene.save, row.meleeWhenCondition.id)
    ? {...row.movement, pattern:'pursue'} : row.movement;
  // Roots cannot wander, pursue, flee from wards or shuffle back to a seat.
  // Attack suppression still uses the ordinary ward/hidden/downed gates.
  if (c.stationary || m.pattern === 'anchor_spit' || m.pattern === 'burrow') return;
  if (c._abilityWindupUntil > now || c._reloadUntil > now) return;
  // A RETREAT (the rout, a flee pattern) runs the ROADSIDE among houses
  // (roadsideRunAngle, below) and never steps INTO a yard (creatureStepRefused
  // reads this stamp through enemyCanStep's sweep).
  c._retreating = routed || m.pattern === 'flee';
  const dist = Math.hypot(px - c.x, py - c.y);
  let sees = !inactive && (creatureTarget
    ? dist <= Combat.sightCells(c.kind) * scene.cellM
    : Combat.seesPlayer(c.kind, dist, scene.cellM, scene.save));
  if (m.territoryCells) {
    c._territoryX ??= c.homeX ?? c.x; c._territoryY ??= c.homeY ?? c.y;
    const radius = m.territoryCells * scene.cellM;
    if (Math.hypot(px - c._territoryX, py - c._territoryY) > radius) sees = false;
    if (!sees && !routed) {
      const distance = Math.hypot(c.x - c._territoryX, c.y - c._territoryY);
      if (distance > scene.cellM * 0.2) {
        const step = Math.min(distance, m.speedMetersPerSecond * dt * Combat.paceMul(c));
        enemySweep(scene, c, row, c.x + (c._territoryX - c.x) / distance * step,
          c.y + (c._territoryY - c.y) / distance * step, now);
      }
      return;
    }
  }
  let angle = Math.atan2(py - c.y, px - c.x);
  let speed = m.speedMetersPerSecond;
  let maxDistance = m.pattern === 'engulf' ? dist : Math.max(0, dist - scene.cellM * 0.35);
  c._laySlimeTrail = !!row.trail && sees && !routed && lairState !== 'return' && !Combat.isCharmed(c);
  if (routed) {
    const from = c._wardFrom || { x: px, y: py };
    angle = Math.atan2(c.y - from.y, c.x - from.x);
    // MAD (Combat.isPsychotic): the rout's pace on a RANDOM heading,
    // re-rolled every PSYCHOSIS_TURN_MS so it runs every which way; Home's
    // ward (_wardFrom) still drives it out of the ring.
    if (!c._wardFrom && Combat.isPsychotic(c, now)) {
      if (now >= (c._madTurnT || 0)) {
        c._madAngle = enemyMovementRandom(c, 'psychosis') * Math.PI * 2; c._madTurnT = now + PSYCHOSIS_TURN_MS;
      }
      angle = c._madAngle;
    }
    angle = roadsideRunAngleCached(scene, c, angle, now);
    maxDistance = Infinity;
    speed = hurryMps(c, speed);
    c._batFlight = null; c._batSwooping = false;
  } else if (lairState === 'return') {
    angle = Math.atan2(c.seatY - c.y, c.seatX - c.x);
    maxDistance = Math.hypot(c.seatX - c.x, c.seatY - c.y);
    c._batFlight = null; c._batSwooping = false;
  } else if (!sees) {
    c._batFlight = null; c._batSwooping = false;
    c._lungeUntil = null; c._lungeWindupUntil = null;
    if (now >= (c._idleTurnT || 0)) {
      // An idle wander among houses keeps to the street too.
      const idle = enemyMovementRandom(c, 'idle') * Math.PI * 2;
      c._idleAngle = roadsideRunAngle(scene, c, idle) ?? idle; c._idleTurnT = now + 3000;
    }
    angle = c._idleAngle; maxDistance = Infinity;
  } else if (m.pattern === 'flee') {
    angle = roadsideRunAngleCached(scene, c, angle + Math.PI, now); maxDistance = Infinity;
  } else if (m.pattern === 'orbit_swoop') {
    enemyBatMove(scene, c, row, now, px, py);
    return;
  } else if (m.pattern === 'orbit_trail') {
    const radius = m.orbitRadiusCells * scene.cellM;
    // A tangent plus radial correction produces a continuous circle, while
    // allowing the ring to follow a moving player.
    const radial = Math.max(-1, Math.min(1, (dist - radius) / radius));
    angle += Math.atan2(1, radial * 2);
    maxDistance = Infinity;
  } else if (m.pattern === 'scuttle_pause') {
    if (c._scuttleStart == null) c._scuttleStart = now;
    const cycle = m.scuttleSeconds + m.pauseSeconds;
    if (((now - c._scuttleStart) / 1000) % cycle >= m.scuttleSeconds) return;
    // A stable lateral bias for each scuttle, not frame-rate-dependent noise.
    const leg = Math.floor((now - c._scuttleStart) / (cycle * 1000));
    angle += (leg % 2 ? 1 : -1) * m.approachAngleJitterRadians / 2;
  } else if (m.pattern === 'strafe_cast' || m.pattern === 'keep_distance') {
    // Mobile ranged foes strafe or retreat; rooted spitters returned above.
    const preferred = m.preferredDistanceCells * scene.cellM;
    if (c._attackWindupUntil != null) return;
    if (Math.abs(dist - preferred) < scene.cellM * 0.5) {
      angle += Math.PI / 2; maxDistance = Infinity;
    } else if (dist < preferred) { angle += Math.PI; maxDistance = preferred - dist; }
    else maxDistance = dist - preferred;
  } else if (m.pattern === 'lunge_recover') {
    if (c._lungeUntil != null && now < c._lungeUntil) {
      angle = c._lungeAngle; speed = m.lungeSpeedMetersPerSecond;
      maxDistance = Infinity;
    } else if (c._lungeUntil != null) {
      c._lungeUntil = null; c._lungeRecoverUntil = now + m.lungeWindupSeconds * 1000;
      return;
    } else if (now < (c._lungeRecoverUntil || 0)) return;
    else if (c._lungeWindupUntil != null) {
      if (now < c._lungeWindupUntil) return;
      c._lungeWindupUntil = null;
      c._lungeUntil = now + m.lungeSeconds * 1000;
      c._lungeNextT = now + m.lungeCooldownSeconds * 1000;
      return;
    } else if (now >= (c._lungeNextT || 0)) {
      c._lungeAngle = angle; c._lungeHit = false;
      c._attackWindupUntil = null; c._attackNextT = now;
      c._lungeWindupUntil = now + m.lungeWindupSeconds * 1000;
      SpriteLayout.faceCreature(c, px - c.x, py - c.y);
      return;
    } else if (m.chargeOnly) {
      // Between charges a charge-only foe stands its ground and watches.
      SpriteLayout.faceCreature(c, px - c.x, py - c.y);
      return;
    }
  } else if (m.pattern === 'ooze' && slimeCharging(c)) {
    speed = m.chargeSpeedMetersPerSecond || speed;
  }
  if (c._attackWindupUntil != null && !routed) return;
  const pace = speed * dt * Combat.paceMul(c);
  let step = Math.min(maxDistance, pace);
  // Foes keep a little room between them (FOE_SPACING_CELLS): the spacing
  // push joins the approach inside the same per-frame budget, so a crowd
  // spreads round the player rather than stacking, and never moves faster.
  const push = lairState === 'return' || m.pattern === 'engulf' || m.pattern === 'orbit_trail'
    ? null : foeSpacingPush(scene, c);
  if (push) {
    const vx = Math.cos(angle) * step + push.x * pace, vy = Math.sin(angle) * step + push.y * pace;
    const len = Math.hypot(vx, vy);
    if (len > 1e-9) { angle = Math.atan2(vy, vx); step = Math.min(len, pace); }
  }
  const sx = c.x, sy = c.y;
  if (!enemySweep(scene, c, row, c.x + Math.cos(angle) * step, c.y + Math.sin(angle) * step, now)) {
    if (c._lungeUntil != null) {
      c._lungeUntil = null;
      c._lungeRecoverUntil = now + m.lungeWindupSeconds * 1000;
      return;
    }
    // Slide around a blocked approach without spending a second frame's
    // movement budget. Stable handedness prevents left/right jitter.
    const remaining = Math.max(0, step - Math.hypot(c.x - sx, c.y - sy));
    if (c._avoidSide == null) c._avoidSide = enemyMovementRandom(c, 'avoidance') < 0.5 ? -1 : 1;
    for (const side of [c._avoidSide, -c._avoidSide]) {
      const a = angle + side * Math.PI / 2;
      const x = c.x + Math.cos(a) * remaining, y = c.y + Math.sin(a) * remaining;
      if (!enemyCanStep(scene, c, row, x, y)) continue;
      enemySweep(scene, c, row, x, y, now); c._avoidSide = side; break;
    }
  }
}

function enemyBatMove(scene, c, row, now, px, py) {
  const m = row.movement;
  if (c._batFlight) {
    const f = c._batFlight;
    const u = creatureFlightEase((now - f.start) / f.duration);
    const clear = enemySweep(scene, c, row, f.x + (f.tx - f.x) * u, f.y + (f.ty - f.y) * u, now);
    if (!clear || now >= f.start + f.duration) {
      c._batFlight = null;
      c._batPauseUntil = now + (m.pauseSeconds[0]
        + enemyMovementRandom(c, 'bat-pause') * (m.pauseSeconds[1] - m.pauseSeconds[0])) * 1000;
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
    : m.orbitRadiusCells[0] + enemyMovementRandom(c, 'bat-radius') * (m.orbitRadiusCells[1] - m.orbitRadiusCells[0]);
  const a = Math.atan2(c.y - py, c.x - px) + 0.7 + enemyMovementRandom(c, 'bat-angle') * 0.7;
  const tx = px + Math.cos(a) * radius * scene.cellM;
  const ty = py + Math.sin(a) * radius * scene.cellM;
  const distance = Math.hypot(tx - c.x, ty - c.y);
  const paceMul = Combat.paceMul(c);
  const duration = (m.flightSeconds[0] + enemyMovementRandom(c, 'bat-duration') * (m.flightSeconds[1] - m.flightSeconds[0])) / paceMul;
  const leg = Math.min(distance, m.maxLegCells * scene.cellM,
    m.speedMetersPerSecond * paceMul * duration / 2);
  const scale = distance > 0 ? leg / distance : 0;
  c._batFlight = { start: now, duration: duration * 1000,
    x: c.x, y: c.y, tx: c.x + (tx - c.x) * scale, ty: c.y + (ty - c.y) * scale };
}

// Temporary allies keep their species' movement, reach and attack cadence.
// A hostile ATTACKS WHAT IS NEAREST: a charmed creature wins its attention
// only when it is nearer than the player (unless the player is unnoticed)
// AND nearer than any neighbour it could target (NPC.enemyTarget — the same
// nearest scan over the prepared neighbours), so a foe with a charmed slime
// six cells off and a neighbour one cell off goes for the neighbour; the
// sim loop's own NPC-or-player pick then settles the rest. A charmed foe
// takes the nearest enemy in its sight. Opponents remain ordinary creatures
// and never enter the permanent pet/save ledger.
function flowerOpponent(scene, c, px, py, caught, wall = Date.now()) {
  const charmed = Combat.isCharmed(c, wall);
  if (!charmed && !Combat.isEnemy(c, wall)) return null;
  const sight = Combat.sightCells(c.kind) * scene.cellM;
  let limit = sight;
  if (!charmed) {
    const unnoticed = scene.isUnnoticed(c);
    if (!unnoticed) limit = Math.min(limit, Math.hypot(px - c.x, py - c.y));
    const npc = typeof NPC !== 'undefined' && NPC.enemyTarget
      ? NPC.enemyTarget(scene, c, EnemyRoster.get(c.kind) || { visionCells: Combat.sightCells(c.kind) }, px, py, unnoticed) : null;
    if (npc) limit = Math.min(limit, Math.hypot(npc.x - c.x, npc.y - c.y));
  }
  return nearestCreature(scene, c, limit, (other, d) => {
    if (caught.has(other.id) || other._surfaceInactive) return false;
    if (!(charmed ? Combat.isEnemy(other, wall) : Combat.isCharmed(other, wall)) || Combat.hp(other) <= 0) return false;
    return d <= sight - PotionEffects.visionReduction(other, wall) * scene.cellM;
  }, { los: true, pool: !charmed && scene._charmedOpponents ? scene._charmedOpponents : null });
}
function flowerCreatureTick(scene, c, now, px, py, caught, wards = null) {
  const asleep = Combat.isSleeping(c), charmed = Combat.isCharmed(c);
  const target = asleep ? null : flowerOpponent(scene, c, px, py, caught);
  if (!asleep && !charmed && !target) return false;
  // Wild foes retain the Home/castle rout and their lair leash when an ally
  // becomes tempting prey. Fall through to the ordinary rout/return mover.
  if (!asleep && !charmed && target) {
    const warded = c._wardFrom || (wards && wardTrip(c, wards.homePos, wards.castleWards, wards.radiusSq))
      || (SpriteLayout.creatureHaunts(c.kind) && fireWardTrip(scene, c));
    const lairState = c.lair ? Lairs.guardState(c, { x: px, y: py }, scene.cellM, !scene.isUnnoticed(c)) : null;
    if (warded || (lairState && lairState !== 'hunt')) return false;
  }
  // Temporary allegiance and sleep do not protect from ordinary hazards.
  if (scene._tickUnitFire?.(c, now)) return true;
  if (scene._tickUnitPoison?.(c, now)) return true;
  if (lavaTick(scene, c, now)) return true;
  if (Combat.isSleeping(c)) {
    if (SpriteLayout.creatureHaunts(c.kind)) {
      const fate = ghostTick(scene, c, now, c.x, c.y, true, false, 0);
      if (fate === 'faded') (scene.save.caught ||= []).push(c.id);
    }
    c._moving = false; c._enemyTickT = now; c._ghostT = now; return true;
  }
  // Fear and madness use the ordinary retreat lane, even when fire just woke a sleeper.
  if (!charmed && (c._fearUntilT > now || Combat.isPsychotic(c, now))) return false;
  if (!charmed && !target) return false;
  const dt = c._enemyTickT == null ? 0 : Math.min(0.1, Math.max(0, (now - c._enemyTickT) / 1000));
  c._enemyTickT = now;
  const row = EnemyRoster.get(c.kind);
  if (!row) return true;
  if (SpriteLayout.creatureHaunts(c.kind)) {
    const fate = ghostTick(scene, c, now, target?.x ?? c.x, target?.y ?? c.y, !target, false, row.movement.speedMetersPerSecond / 1000);
    if (fate === 'touch' && target) scene._damageEnemy(target, Combat.meleeBlow(c, row.dmg), charmed ? 'ally' : 'enemy');
    if (fate === 'touch' || fate === 'faded') {
      (scene.save.caught ||= []).push(c.id);
      if (typeof persistSave === 'function') persistSave(scene.save);
    }
    return true;
  }
  if (!target || caught.has(target.id)) { c._moving = false; return true; }
  rosterEnemyAttack(scene, c, row, now, target.x, target.y, false, dt, null, target);
  if (!caught.has(c.id)) rosterEnemyMove(scene, c, row, now, target.x, target.y, false, false, null, dt, target);
  return true;
}
