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
// All shiny creatures move 1.5x faster; Combat owns the shared multiplier.
const SHINY_SPEED_MUL = Combat.SHINY_SPEED_MUL;
// Ordinary wild movement targets 10 m/s. The universal shiny multiplier
// applies afterwards, including to fast bats and crow flights; it is not capped.
const WILD_SPEED_CEILING_MPS = 10;
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
// The tile cell under a surface point: { entry, N, i } or null.
function tileCellAt(scene, x, y) {
  if ((scene.depth || 0) !== 0) return null;
  const edge = scene.tileEdgeM;
  if (!(edge > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const tx = Math.floor(x / edge), ty = Math.floor(y / edge);
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
  if (!entry || !entry.grid) return null;
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
  return !!t && WorldGen.isLotTerrain(t.entry.grid[t.i]);
}
// ALLOWLISTED raw roadMask read (spawn_gate_sweep.test.js): GEOMETRY, not the
// gate — which way the street runs, so a retreat can run along it. Nothing
// here places anything.
function roadAt(scene, x, y) {
  const t = tileCellAt(scene, x, y);
  return !!t && (!!(t.entry.roadMask && t.entry.roadMask[t.i]) || WorldGen.isRoadTerrain(t.entry.grid[t.i]));
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
  return Math.atan2(ty, tx) + (Math.random() - 0.5) * ROADSIDE_JITTER;
}
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
  // charge, a fiend's lunge, a bat's peak flight. A Giant variant row
  // with no speeds of its own reads its base kind's row.
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
  const hostileSpecies = Combat.isEnemyKind(c.kind) && !String(c.id).startsWith('released_');
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
// (THE OLD STONES used to be a second reason here - from DUSK inside a
// church's or cemetery's zone, twice as often, fanned from the stones. Gone,
// Sep 2026, owner: it pulled players to churchyards at closing time and sent
// them fleeing through dark streets. A churchyard's headstone can still raise
// one when TAPPED (raiseGhostAt); the night itself is the same everywhere.)
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
  return habitat.biomes.some(name => WorldGen.T[name] === cell.type);
}
// THE NIGHT PUMP — seats a group of ghosts in the dark about the player, once
// every ghostSpawnDelay while ghostsHaunt says so (the surface after dark, a
// crypt pocket from GHOST_SCALING.minCryptDepth at any hour). Returns how many rose. The timer is disarmed
// whenever it doesn't, so the first group comes one delay after dark, a load,
// or the stairs down to a haunted level — never at once.
// `wardPts` / `wardR2` are wanderCreatures' Home + claimed-castle wards: a
// ghost never rises inside a ring that would only rout it.
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
    profile.groupMin + Math.floor(Math.random() * (profile.groupMax - profile.groupMin + 1)));
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
//   It is SESSION state exactly like the ghost and the pest deer: pushed into
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
      if (!WorldGen.isSpawnCell(entry.grid, N, N, ix, iy, entry._spawnOpts, cls)) continue;
      if (WorldGen.privateVetoAt(tx, ty, ix, iy)) continue;
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
  pace *= (PotionEffects.speedMul(c) * Combat.shinySpeedMul(c));
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
// How far a CROP RAIDER (the deer — SpriteLayout `raidsCrops`) notices a
// planted crop it may eat, in cells (wanderCreatures raidStep): the on-screen
// sim range, so it spots a field from across the viewport but not from the
// next street. It does not teleport in — every step is its own gait's — so a
// far deer visibly walks toward the beds. A dispatched pest (isPest) has no
// limit: it was sent at the field.
const RAID_NOTICE_CELLS = 8;
// THE HUNT IS TIMED, NOT ROLLED (owner, Sep 2026: "a 50/50 chance with a T1
// net, depending on timing, standing right on it"). A hunted crow does NOT
// bolt the instant the wheel starts — it keeps its own rhythm, finishes the
// perch it is sitting (or the glide it is on, and the perch that ends it)
// and leaves on its NEXT launch (_crowDepart 'hunted'). So the race is
// between the net's wheel and how much perch the crow had left when you
// tapped: tap one that has just settled and it sits through a wood net's
// 4 s; tap one about to hop and it is gone. It used to launch at once
// (_perchUntilT = now), so the wheel raced its first hop, and whether that
// 2–2.5-cell hop happened to land on a cell still inside the reach diamond
// — a die roll on its direction — decided the hunt, not the player.
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
// one (WILD_SPEED_CEILING_MPS). The roam used to peak at 44 m/s, the dash at
// 80.
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
  if (!cr || Combat.isCharmed(cr) || (typeof cr.id === 'string' && cr.id.startsWith('released_'))) return false;
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
  if (!scene._groundFireAtWorld) return true;
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
  if (c.stationary || Combat.monster(c.kind)?.stationary || row?.movement.pattern === 'anchor_spit') return true;
  row = row || { tier: Combat.monster(c.kind)?.minDepth || 1, movement: { pattern: 'walk' } };
  if (!c._fireEscapeRoute || now >= (c._fireEscapePlanT || 0)) {
    c._fireEscapeRoute = enemyFireEscapeRoute(scene, c, row);
    c._fireEscapePlanT = now + 250;
  }
  const point = c._fireEscapeRoute[0];
  if (!point) return true;
  const distance = Math.hypot(point.x - c.x, point.y - c.y);
  const speed = Math.min(SpriteLayout.creatureMaxMps(c.kind), foeChaseMps(c, scene.cellM) / FLEE_BEAT_MUL);
  const step = Math.min(distance, speed * dt * Combat.shinySpeedMul(c));
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
  if (!previous || !Combat.isEnemy(c) || !scene._walkHazardExposure) return false;
  const dt = Math.min(0.1, Math.max(0, (now - previous.now) / 1000));
  const rate = scene._walkHazardExposure(previous.x, previous.y, c.x, c.y);
  c._walkHazardAccum = (c._walkHazardAccum || 0) + rate * dt;
  const damage = Math.floor(c._walkHazardAccum + 1e-9);
  if (!damage) return false;
  c._walkHazardAccum = Math.max(0, c._walkHazardAccum - damage);
  return !!scene._damageEnemy(c, damage, 'obstacle');
}

// Every segment is swept, including fast flights and lunges. Flying permits
// low terrain, never rock walls, buildings, unloaded cells or placed rocks.
function enemyCanStep(scene, c, row, x, y, escaping = false) {
  if (!fireStepAllowed(scene, c, x, y, escaping)) return false;
  const cell = scene.cellAt(x, y);
  if (!cell.loaded) return false;
  if (scene._cellBlocked(x, y)) return false;
  // A building is solid, except a keep's own floor to its garrison.
  const ownFloor = WorldGen.isBuildingTerrain(cell.type) && Lairs.inOwnKeep(c, x, y);
  if (WorldGen.isBuildingTerrain(cell.type) && !ownFloor) return false;
  if (scene.placedRockSet?.size) {
    const { cellIX, cellIY } = worldMetersToAbsCell(scene, x, y);
    if (scene.placedRockSet.has(cellKeyFromAbsCell(cellIX, cellIY))) return false;
  }
  if (row.movement.pattern !== 'orbit_swoop' && !ownFloor && Combat.faunaBlocksCell(cell.type)) return false;
  // THE KERB (above): nothing hostile — flier or not — steps onto a major
  // road's band, and a FAST foe never steps INTO the buffer from outside it
  // (one already inside may leave). The same refused-cell reasons the old
  // step chain reads, on the roster's swept mover.
  const road = roadClassBitsAt(scene, x, y);
  if (road & WorldGen.ROAD_CLASS_MAJOR_BAND) return false;
  if ((road & WorldGen.ROAD_CLASS_MAJOR_BUFFER) && !inKerbAt(scene, c.x, c.y)
      && isFastMover(c, scene.cellM)) return false;
  const fireAverts = !c.lair && (row.tier <= FIRE_WARD_MAX_DEPTH);
  return !(fireAverts && scene._nearAny?.('fires', x, y, FIRE_REST_R));
}
function enemySweep(scene, c, row, x, y, now = performance.now(), escaping = false) {
  let dx = x - c.x, dy = y - c.y;
  const distance = Math.hypot(dx, dy);
  // Sharp plants and spikes are passable. Prefer the body's same short jog
  // when it fits; a broad belt has no trivial detour, so keep going through.
  if (!escaping && distance > 0 && scene._walkHazardExposure?.(c.x, c.y, x, y) > 0) {
    const open = (ox, oy) => {
      const nx = c.x + ox * scene.cellM, ny = c.y + oy * scene.cellM;
      return enemyCanStep(scene, c, row, nx, ny) && enemyWalkHazardRate(scene, nx, ny) === 0;
    };
    const jog = committedDetourDir(c, dx / distance, dy / distance, open, now);
    if (jog) { dx = jog.x * distance; dy = jog.y * distance; }
  }
  const n = Math.max(1, Math.ceil(distance / (scene.cellM * 0.2)));
  const sx = c.x, sy = c.y;
  let clear = true;
  for (let i = 1; i <= n; i++) {
    const nx = sx + dx * i / n, ny = sy + dy * i / n;
    if (!enemyCanStep(scene, c, row, nx, ny, escaping)) { clear = false; break; }
    c.x = nx; c.y = ny;
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
// A caster's support action uses its own interruptible wind-up. Summons have
// two fixed identity slots per caster: defeated slots never refill after a
// reload, so neither enemy count nor rewards can grow without bound.
function enemySupportAllies(scene, c, radiusCells) {
  const pc = worldMetersToTileCell(scene, c.x, c.y), allies = [];
  const caught = new Set(scene.save.caught || []);
  WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, ally => {
    if (ally !== c && Combat.isEnemy(ally) && !caught.has(ally.id)
        && Math.hypot(ally.x - c.x, ally.y - c.y) <= radiusCells * scene.cellM
        && Combat.lineOfFire(c.x, c.y, ally.x, ally.y,
          (x, y) => enemySightBlocked(scene, c, x, y), scene.cellM)) allies.push(ally);
  });
  return allies;
}
function enemySummon(scene, c, ability) {
  const kind = ability.kind, row = EnemyRoster.get(kind);
  if (!row) return false;
  const pc = worldMetersToTileCell(scene, c.x, c.y);
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
  if (!entry?.creatures) return false;
  const caught = new Set(scene.save.caught || []);
  const existing = new Set();
  WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, other => existing.add(other.id));
  for (let slot = 0; slot < ability.maxMinions; slot++) {
    const id = `${c.id}_summon_${slot}`;
    if (caught.has(id) || existing.has(id)) continue;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const x = c.x + Math.cos(angle) * scene.cellM, y = c.y + Math.sin(angle) * scene.cellM;
      const cell = worldMetersToTileCell(scene, x, y);
      const destination = WorldGen.tileCache.get(WorldGen.tileKey(cell.tx, cell.ty));
      if (!destination?.creatures || !enemyCanStep(scene, c, row, x, y)) continue;
      const n = destination.cellsPerEdge;
      const grid = destination.baseGrid || destination.grid;
      const opts = destination._spawnOpts;
      if (!grid || !opts || !WorldGen.isSpawnCell(grid, n, n, cell.ix, cell.iy, opts, creatureSpawnClass(kind))) continue;
      if (destination.creatures.some(other => !caught.has(other.id)
          && Math.hypot(other.x - x, other.y - y) < scene.cellM * 0.7)) continue;
      const child = WorldGen.makeCreature(kind, x, y, id);
      // A garrison's escort inherits its leash and difficulty, not a new lair.
      for (const key of ['lair', 'immobile', 'lairX', 'lairY', 'lairR', 'keepHW', 'keepHH', 'aggroCells', 'homeX', 'homeY']) {
        if (c[key] != null) child[key] = c[key];
      }
      child.seatX = x; child.seatY = y;
      child._summonerId = c.id;
      destination.creatures.push(child);
      return true;
    }
    return false;
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
  const twin = WorldGen.makeCreature(c.kind, seats[1].x, seats[1].y, id, { shiny: false });
  for (const key of ['lair', 'immobile', 'lairX', 'lairY', 'lairR', 'keepHW', 'keepHH', 'aggroCells', 'homeX', 'homeY', '_surfaceSpawn', 'habitat', 'zoneVariant', '_hunting', '_lastDamagedT']) {
    if (c[key] != null) twin[key] = c[key];
  }
  twin._hp = half; twin._splitShare = share; twin._splitRoot = root; twin._splitNextT = c._splitNextT;
  // Each half's seat is where it now stands, so a garrison's halves walk home
  // to two seats rather than piling onto one.
  if (c.lair) { c.seatX = c.x; c.seatY = c.y; twin.seatX = twin.x; twin.seatY = twin.y; }
  entry.creatures.push(twin);
  return twin;
}
function enemySupportTick(scene, c, row, now, eligible) {
  const a = row.ability;
  if (!a) return false;
  if (!eligible || (c._abilityWindupUntil != null && c._lastDamagedT !== c._abilityDamageStamp)) {
    c._abilityWindupUntil = null;
    return false;
  }
  if (c._abilityWindupUntil != null) {
    if (now < c._abilityWindupUntil) return true;
    c._abilityWindupUntil = null;
    if (a.type === 'heal') {
      const allies = enemySupportAllies(scene, c, a.radiusCells);
      const target = allies.find(ally => Combat.hp(ally) < Combat.maxHp(ally));
      if (target) {
        target._hp = Math.min(Combat.maxHp(target), Combat.hp(target) + a.amount);
        target._supportUntil = now + 600;
      }
    } else if (a.type === 'summon') enemySummon(scene, c, a);
    return true;
  }
  if (now < (c._abilityNextT || 0)) return false;
  if (a.type === 'heal' && !enemySupportAllies(scene, c, a.radiusCells)
    .some(ally => Combat.hp(ally) < Combat.maxHp(ally))) {
    c._abilityNextT = now + 1000;
    return false;
  }
  c._abilityNextT = now + a.intervalSeconds * 1000;
  c._abilityWindupUntil = now + a.windupSeconds * 1000;
  c._abilityDamageStamp = c._lastDamagedT;
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
function rosterEnemyAttack(scene, c, row, now, px, py, inactive, dt, npcTarget = null, creatureTarget = null) {
  if (Combat.isSleeping(c) || (Combat.isCharmed(c) && !creatureTarget)) return;
  if (creatureTarget && Combat.isCharmed(c) === Combat.isCharmed(creatureTarget)) return;
  if (row.attackType === 'none') return;
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
  if (row.aura && clear && dist <= row.aura.radiusCells * scene.cellM) {
    if (npcTarget) { NPC.hit(scene, npcTarget, Date.now(), row.aura.rawDps * Combat.powerMul(c) * dt); return; }
    if (creatureTarget) {
      scene._damageEnemy(creatureTarget, row.aura.rawDps * Combat.powerMul(c) * dt,
        Combat.isCharmed(c) ? 'ally' : 'enemy', { bypassArmor: true });
    } else {
      const a = row.aura;
      const raw = a.rawDps * Combat.powerMul(c);
      const shield = PotionEffects.damageMul(scene.save);
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
  }
  if (row.attackType === 'trap') {
    const ready = enemyAttackReady(c, row, now, clear && dist <= attackRange * scene.cellM);
    if (ready || c._attackWindupUntil != null) SpriteLayout.faceCreature(c, px - c.x, py - c.y);
    if (ready && !Combat.isCharmed(c)) {
      scene._trapperLay(c, now, px, py);
    }
    return;
  }
  if ((!row.dmg && !row.steals) || row.attackType === 'touch') return;
  const swoop = row.movement.pattern === 'orbit_swoop';
  const lunging = row.movement.pattern === 'lunge_recover' && now < (c._lungeUntil || 0);
  const shaped = ['area', 'breath', 'blast'].includes(row.attackType);
  const winding = c._attackWindupUntil != null;
  // A `chargeOnly` charger (the boar) has no blow of its own: it hurts only
  // what it runs into mid-charge, once a charge.
  const eligible = (shaped && winding ? attentive : clear && dist <= attackRange * scene.cellM)
    && (!swoop || (c._batSwooping && !c._batHit)) && (!lunging || !c._lungeHit)
    && (!row.movement.chargeOnly || lunging);
  // The charge already warned before moving; contact lands once without
  // starting a second melee wind-up that would stop the charge mid-stride.
  const ready = enemyAttackReady(c, lunging ? {...row, windupSeconds: 0} : row, now, eligible);
  if (shaped && !winding && (c._attackWindupUntil != null || ready)) {
    c._attackAim = { x: px, y: py, angle: Math.atan2(py - c.y, px - c.x) };
  }
  if (ready || c._attackWindupUntil != null) {
    const aim = shaped ? c._attackAim : {x: px, y: py};
    SpriteLayout.faceCreature(c, aim.x - c.x, aim.y - c.y);
  }
  if (!ready) return;
  c._attackT0 = now;
  c._attackUntil = now + Math.max(600, row.windupSeconds * 1000);
  const raw = row.attackType === 'melee' || row.attackType === 'touch'
    ? (row.dmg * Combat.powerMul(c) + PotionEffects.meleeBonus(c)) * PotionEffects.meleeMul(c)
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
    const damage = Combat.incomingDamage(scene.save, raw);
    const lost = scene._losePlayerEnergy(damage, { closeShop: true });
    scene._monsterDmgAccum = (scene._monsterDmgAccum || 0) + lost;
    const condition = Combat.monster(c.kind)?.condition;
    if (lost > 0 && condition) scene._applyCondition(condition);
  }
  if (swoop) c._batHit = true;
  if (lunging) c._lungeHit = true;
}

// FOE SPACING: foes may brush against each other, but each keeps about
// FOE_SPACING_CELLS from the next. The push is a unit-scaled vector away from
// every live foe nearer than that (stronger the closer it is), or null when
// the foe has room. It steers the step in rosterEnemyMove, inside the foe's own
// pace; nothing is ever blocked by it, so a crowd can still squeeze through a
// gap. Exact overlap breaks the tie off the ids, so two stacked foes part.
// A swooping flier (enemyBatMove) and a lair guard walking home are not pushed.
const FOE_SPACING_CELLS = 0.6;
function foeSpacingPush(scene, c) {
  const bodies = scene._foeBodies;
  if (!bodies || bodies.length < 2) return null;
  const r = FOE_SPACING_CELLS * scene.cellM;
  let x = 0, y = 0;
  for (const o of bodies) {
    if (o === c) continue;
    const dx = c.x - o.x, dy = c.y - o.y;
    if (Math.abs(dx) >= r || Math.abs(dy) >= r) continue;
    const d = Math.hypot(dx, dy);
    if (d >= r) continue;
    const w = (r - d) / r;
    if (d > 1e-6) { x += dx / d * w; y += dy / d * w; continue; }
    const a = (strHash31(String(c.id)) - strHash31(String(o.id))) % 628 / 100;
    x += Math.cos(a) * w; y += Math.sin(a) * w;
  }
  const len = Math.hypot(x, y);
  if (len < 1e-6) return null;
  return len > 1 ? { x: x / len, y: y / len } : { x, y };
}

function rosterEnemyMove(scene, c, row, now, px, py, inactive, routed, lairState, dt, creatureTarget = null) {
  if (Combat.isSleeping(c)) return;
  if (c._lastDamagedT && Date.now() - c._lastDamagedT >= 20 * 60 * 1000) {
    c._hp = Combat.maxHp(c); c._lastDamagedT = null;
  }
  const m = row.movement;
  // Roots cannot wander, pursue, flee from wards or shuffle back to a seat.
  // Attack suppression still uses the ordinary ward/hidden/downed gates.
  if (c.stationary || m.pattern === 'anchor_spit') return;
  if (c._abilityWindupUntil > now || c._reloadUntil > now) return;
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
        const step = Math.min(distance, m.speedMetersPerSecond * dt * (PotionEffects.speedMul(c) * Combat.shinySpeedMul(c)));
        enemySweep(scene, c, row, c.x + (c._territoryX - c.x) / distance * step,
          c.y + (c._territoryY - c.y) / distance * step, now);
      }
      return;
    }
  }
  let angle = Math.atan2(py - c.y, px - c.x);
  let speed = m.speedMetersPerSecond;
  let maxDistance = Math.max(0, dist - scene.cellM * 0.35);
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
  } else if (m.pattern === 'flee') {
    angle += Math.PI; maxDistance = Infinity;
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
  const pace = speed * dt * (PotionEffects.speedMul(c) * Combat.shinySpeedMul(c));
  let step = Math.min(maxDistance, pace);
  // Foes keep a little room between them (FOE_SPACING_CELLS): the spacing
  // push joins the approach inside the same per-frame budget, so a crowd
  // spreads round the player rather than stacking, and never moves faster.
  const push = lairState === 'return' ? null : foeSpacingPush(scene, c);
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
    if (c._avoidSide == null) c._avoidSide = Math.random() < 0.5 ? -1 : 1;
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
  const duration = (m.flightSeconds[0] + Math.random() * (m.flightSeconds[1] - m.flightSeconds[0])) / (PotionEffects.speedMul(c) * Combat.shinySpeedMul(c));
  const leg = Math.min(distance, m.maxLegCells * scene.cellM,
    m.speedMetersPerSecond * (PotionEffects.speedMul(c) * Combat.shinySpeedMul(c)) * duration / 2);
  const scale = distance > 0 ? leg / distance : 0;
  c._batFlight = { start: now, duration: duration * 1000,
    x: c.x, y: c.y, tx: c.x + (tx - c.x) * scale, ty: c.y + (ty - c.y) * scale };
}

// Temporary allies keep their species' movement, reach and attack cadence.
// Hostiles can choose a nearer charmed creature instead of the player; they
// remain ordinary creatures and never enter the permanent pet/save ledger.
function flowerOpponent(scene, c, px, py, caught, wall = Date.now()) {
  const charmed = Combat.isCharmed(c, wall);
  if (!charmed && !Combat.isEnemy(c, wall)) return null;
  const pc = worldMetersToTileCell(scene, c.x, c.y);
  const sight = Combat.sightCells(c.kind) * scene.cellM;
  let best = null, distance = charmed || scene.isUnnoticed(c) ? sight : Math.min(sight, Math.hypot(px - c.x, py - c.y));
  const consider = other => {
    if (other === c || caught.has(other.id) || other._surfaceInactive) return;
    const opponent = charmed ? Combat.isEnemy(other, wall) : Combat.isCharmed(other, wall);
    if (!opponent || Combat.hp(other) <= 0) return;
    const d = Math.hypot(other.x - c.x, other.y - c.y);
    if (d > sight - PotionEffects.visionReduction(other, wall) * scene.cellM) return;
    if (d > distance || !Combat.lineOfFire(c.x, c.y, other.x, other.y,
      (x, y) => enemySightBlocked(scene, c, x, y), scene.cellM)) return;
    best = other; distance = d;
  };
  if (!charmed && scene._charmedOpponents) scene._charmedOpponents.forEach(consider);
  else WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, consider);
  return best;
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
  if (Combat.canBurn(c) && !Conditions.fireImmune(c) && (scene.depth === 0 || scene.depth === WorldGen.LAVA_DEPTH)
      && now >= (c._lavaNextT || 0)) {
    c._lavaNextT = now + 1000;
    const under = scene.cellAt(c.x, c.y);
    if (under.loaded && under.type === WorldGen.T.CAVE_LAVA) {
      Combat.ignite(c, now, 'lava');
      if (scene._damageEnemy(c, Combat.LAVA_DMG_PER_S, 'lava')) return true;
    }
  }
  if (Combat.isSleeping(c)) {
    if (SpriteLayout.creatureHaunts(c.kind)) {
      const fate = ghostTick(scene, c, now, c.x, c.y, true, false, 0);
      if (fate === 'faded') (scene.save.caught ||= []).push(c.id);
    }
    c._moving = false; c._enemyTickT = now; c._ghostT = now; return true;
  }
  // Fear uses the ordinary retreat lane, even when fire just woke a sleeper.
  if (!charmed && c._fearUntilT > now) return false;
  if (!charmed && !target) return false;
  const dt = c._enemyTickT == null ? 0 : Math.min(0.1, Math.max(0, (now - c._enemyTickT) / 1000));
  c._enemyTickT = now;
  const row = EnemyRoster.get(c.kind);
  if (!row) return true;
  if (SpriteLayout.creatureHaunts(c.kind)) {
    const fate = ghostTick(scene, c, now, target?.x ?? c.x, target?.y ?? c.y, !target, false, Combat.monster(c.kind).mps / 1000);
    if (fate === 'touch' && target) scene._damageEnemy(target, row.dmg * Combat.powerMul(c), charmed ? 'ally' : 'enemy');
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
