// Creature AI helpers — the scene-free pieces of how wild things move and
// react: the slime's gait and charge, flee / stalk pacing, the keep-distance
// angle, monster stride, the ghosts (spawn pass, sun exposure, tick), the
// fished-up slime, the monster rout and wander-off, and the ward trip that
// turns a foe out of Home's or a castle's ring.
//
// Moved verbatim out of the top of app.js. Everything here is a plain
// top-level `const` / `function`, so it stays a global exactly as it was:
// wanderCreatures (app.js) and the tests call these by bare name. This file
// loads BEFORE app.js, so an initializer here may only read literals or names
// defined above it in this file — anything from app.js is read at CALL time.
//
// What this is NOT: wanderCreatures itself. The per-tick branch logic (the
// `unnoticed` gate, the wards, Home's rout) stays in app.js; these are the
// pieces it calls. See CLAUDE.md "NOTHING HUNTS A BODY" and "Home is a
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
// speed); the ghost's continuous glide reads the same pair, so "twice the
// goblin's speed" is twice the goblin's ground speed and not a second number.
function monsterStrideCells(mon) { return mon && mon.fly ? 1.0 : 0.6; }
// ── GHOSTS ───────────────────────────────────────────────────────────────────
// After dark a few ghosts rise in the dark around the player, hover a moment,
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
// degrees under it — dusk gone to dark. Underground there is no night to
// rise in (the caves have their own foes).
const GHOST_DARK_DAYLIGHT = 0.25;
// The cadence: one group every GHOST_SPAWN_MS (5 minutes), ± the jitter, so a
// night reads as "every so often", not as a clock.
const GHOST_SPAWN_MS = 300000;
const GHOST_SPAWN_JITTER_MS = 60000;
// How many rise at once, and the most that may be about the player at a time
// (a long night with the pump outpacing the light must not become a swarm).
const GHOST_GROUP_MIN = 1;
const GHOST_GROUP_MAX = 3;
const GHOST_NEAR_MAX = 6;
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
// exposure, over GHOST_PLATEAU_BURN_S — where exposure 1 is the player's own
// reach plateau at night at its brightest (Lighting.profile(scene, 0).lit,
// the plateau's derived level), so a ghost held at the player's feet lasts
// GHOST_PLATEAU_BURN_S seconds. Daylight past GHOST_DARK_DAYLIGHT burns too
// (ghostSunExposure — 1 at noon), so a ghost caught out at dawn is gone.
//   Why 6: a ghost rushing a player at base reach (2.5 cells) from the spawn
// ring takes ~1 plateau-second in the ramp and ~3 crossing the plateau —
// about 4.1 of its 6 (measured: ~69% of its pool), so it arrives with about a
// third of itself left and the touch lands. Two Inner Light upgrades still
// let it through, barely; from three (reach 4 cells) it burns out on the
// doorstep, and a torch's light burns it out long before. A campfire and a lit
// lamp hold it at their ring (ghostRefused) in the player's light until it
// burns; Home and a claimed castle rout it (the ward). ghosts.test.js runs the
// race.
const GHOST_PLATEAU_BURN_S = 6;
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
// THE NIGHT PUMP — seats a group of ghosts in the dark about the player, once
// every ghostSpawnDelay while it is dark on the surface. Returns how many
// rose. The timer is disarmed by day and underground, so the first group of a
// night comes one delay after dark (or after a load at night), never at once.
// `wardPts` / `wardR2` are wanderCreatures' Home + claimed-castle wards: a
// ghost never rises inside a ring that would only rout it.
function ghostSpawnPass(scene, now, px, py, pcW, homePos, castleWards, wardR2, caughtSet) {
  if ((scene.depth || 0) !== 0) { scene._nextGhostT = null; return 0; }
  if (!(Lighting.daylight(scene, Date.now()) < GHOST_DARK_DAYLIGHT)) { scene._nextGhostT = null; return 0; }
  if (scene._nextGhostT == null) { scene._nextGhostT = now + ghostSpawnDelay(Math.random()); return 0; }
  if (now < scene._nextGhostT) return 0;
  scene._nextGhostT = now + ghostSpawnDelay(Math.random());
  const entry = WorldGen.tileCache.get(WorldGen.tileKey(pcW.tx, pcW.ty));
  if (!entry || !entry.creatures) return 0;
  let near = 0;
  WorldGen.forEachItemNear('creatures', pcW.tx, pcW.ty, (c) => {
    if (SpriteLayout.creatureHaunts(c.kind) && !caughtSet.has(c.id)) near++;
  });
  const want = Math.min(GHOST_NEAR_MAX - near,
    GHOST_GROUP_MIN + Math.floor(Math.random() * (GHOST_GROUP_MAX - GHOST_GROUP_MIN + 1)));
  const R = PEST_CROW_SPAWN_CELLS * scene.cellM;
  const base = Math.random() * Math.PI * 2;
  let made = 0;
  for (let i = 0; made < want && i < want * 8; i++) {
    // The fan first; if the dark is not there, anywhere on the ring.
    const a = i < want * 4 ? base + (Math.random() - 0.5) * GHOST_GROUP_SPREAD : Math.random() * Math.PI * 2;
    const x = px + Math.cos(a) * R, y = py + Math.sin(a) * R;
    if (!scene.cellAt(x, y).loaded) continue;
    if (wardTrip({ x, y }, homePos, castleWards, wardR2)) continue;
    if (Lighting.brightnessAt(scene, x, y) > GHOST_SPAWN_DARK) continue;
    entry.creatures.push(WorldGen.makeCreature('ghost', x, y,
      `ghost_${pcW.tx}_${pcW.ty}_${Math.floor(now)}_${made}_${Math.floor(Math.random() * 1e4)}`,
      { _spawnT: now }));
    made++;
  }
  if (made && scene.flash) scene.flash('👻 Ghosts in the dark!', scene.viewCenterX, scene.viewCenterY - 60);
  return made;
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
// A STANDING LIGHT'S RING REFUSES A GHOST'S STEP — the campfire's ward
// mechanism (a refused target, never a turn, so it holds at the edge rather
// than freezing inside), and for the ghost the lit street lamp's too: it is a
// thing of the dark, and the two lights a player can stand beside on purpose
// are the two it will not cross. The ring is each light's own radius — the
// fire's FIRE_REST_R, the lamp's Lighting.KINDS.cobble row — so what refuses
// it is exactly what is lit. It holds there in the player's light and burns.
// NOT Home's ward (that routs, _wardFrom) and not the burn (that is
// brightnessAt, and reaches every light).
function ghostRefused(scene, x, y) {
  if (scene._nearAny('fires', x, y, FIRE_REST_R)) return true;
  const lamps = scene._streetLamps;
  if (!lamps || !lamps.length) return false;
  const r = Lighting.radiusCells('cobble') * scene.cellM;
  for (const L of lamps) {
    if (L.lit && (L.x - x) * (L.x - x) + (L.y - y) * (L.y - y) < r * r) return true;
  }
  return false;
}
// ONE GHOST'S TICK — its mover, its burn, its touch. Returns what became of it:
//   'touch'   it reached the player (wanderCreatures lands the blow and spends it)
//   'burned'  the light finished it (_damageEnemy has already paid its coin)
//   'faded'   its GHOST_LIFETIME_MS ran out
//   null      it is still about.
// `pace` is metres per ms (monsterStrideCells over its beat). HOVER first, in
// place; then a committed line at the player's feet at that pace, over any
// terrain (it is a ghost) — except a campfire's or a lit lamp's ring
// (ghostRefused: the fire ward's refused step, never a turn). Warded
// (Home, a claimed castle — `warded`, the same latch every foe wears) it runs
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
    const exposure = Lighting.brightnessAt(scene, c.x, c.y, wall) / Lighting.profile(scene, 0).lit
      + ghostSunExposure(Lighting.daylight(scene, wall));
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
  if (!ghostRefused(scene, nx, ny)) {
    c.x = nx; c.y = ny;
    if (Math.abs(Math.cos(ang)) > 1e-6) c._faceFlip = Math.cos(ang) < 0;
  }
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
