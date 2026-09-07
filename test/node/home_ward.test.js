// HOME IS A CAMPFIRE YOU OWN.
//
// A placed campfire does three things on one ring: it lights (Lighting.KINDS
// .fire), it rests you (FIRE_REST_R / FIRE_FULL_REST_S) and it repels the
// surface slime plus the cave's own entry-level monsters (FIRE_WARD_MAX_DEPTH).
// Home does the same three on ONE ring of its own, HOME_R — reaching every
// registered enemy, not just the weak ones — and keeps the one thing a fire
// hasn't, the trade panel, which is a TAP on the building and no part of the
// ring at all.
//
// The three must be ONE number or they drift, which is the roadOverlayWidthM
// discipline: the lit circle IS the safe circle IS the circle you recover in,
// so a player reads the whole rule off the picture. lighting.test.js pins the
// light against HOME_R; this file pins the other two.
//
// The rest half runs for real — run.js lifts homeWorldPos + isRestingAtHome
// out of app.js onto a stub scene. The ward half lives inside wanderCreatures
// (which needs Phaser), so it is pinned as source text, plus the arithmetic
// that says why the branch is shaped the way it is.

(function () {
const app = APP_JS_SRC;
const CELL_M = 5;

// A stub scene for the lifted methods: Home is the synthetic starter trailer
// at the origin, the O(1) branch and the one a new save is always in.
function trailerScene(over) {
  return Object.assign({
    depth: 0,
    cellM: CELL_M,
    ensureStarterShopId() {},
    save: { starterShopId: 'starter_trailer',
            starterTrailer: { id: 'starter_trailer', x: 0, y: 0 } },
    homeWorldPos: __home.homeWorldPos,
    isRestingAtHome: __home.isRestingAtHome,
  }, over);
}

test('home: the rest is a RING, not a doormat', () => {
  const s = trailerScene();
  const r = HOME_R * CELL_M;
  // The doorstep — where the player stands to work the starter plot, two
  // cells out — rests them. It rested them at neither the doormat nor the
  // doorstep before: the trailer counted only from its own snapped cell.
  assert.truthy(s.isRestingAtHome(2 * CELL_M, 0), 'two cells out is inside Home');
  assert.truthy(s.isRestingAtHome(0, 0), 'and so is standing on it');
  assert.truthy(s.isRestingAtHome(r * 0.99, 0), 'right out to the rim');
  assert.falsy(s.isRestingAtHome(r * 1.01, 0), 'and not a step past it');
  // Round, not square: the corner of the bounding box is outside.
  assert.falsy(s.isRestingAtHome(r * 0.8, r * 0.8), 'the ring is a circle');
});

test('home: no Home, no ring — and none of it crosses a depth', () => {
  assert.falsy(trailerScene({ save: { } }).isRestingAtHome(0, 0),
    'a save with no Home yet rests nowhere');
  // The world is GPS-mirrored down the levels, so a surface Home must not
  // rest, light or ward a cave at the same (x, y) — the rule _nearAny applies
  // to every placed ward.
  const deep = trailerScene({ depth: 2 });
  assert.eq(deep.homeWorldPos(), null, 'Home does not exist underground');
  assert.falsy(deep.isRestingAtHome(0, 0), 'so it rests nobody there');
});

test('home: an adopted house is Home by the same ring, resolved once', () => {
  // The other branch: a real house adopted in the trailer's place. It is a
  // walk of every object in every cached tile, so it MUST memoise — all three
  // effects ask it every frame, and the un-memoised scan was already the one
  // per-frame O(cached tiles × objects) in the render-loop audit.
  let scans = 0;
  const tiles = new Map([['t', { objects: [
    { kind: 'house', id: 'other', x: 999, y: 999 },
    { kind: 'house', id: 'adopted', x: 3 * CELL_M, y: 0 },
  ] }]]);
  const counting = { values: () => { scans++; return tiles.values(); } };
  const s = trailerScene({
    save: { starterShopId: 'adopted', starterTrailer: { id: 'starter_trailer', x: 0, y: 0 } },
  });
  const realCache = WorldGen.tileCache;
  WorldGen.tileCache = counting;
  try {
    assert.eq(s.homeWorldPos().x, 3 * CELL_M, 'Home is the adopted house, not the nearest one');
    for (let i = 0; i < 20; i++) s.homeWorldPos();
    assert.eq(scans, 1, 'and the tile walk ran once, not once per frame');
    // The ring is measured from the HOUSE now, not from the stale trailer.
    assert.truthy(s.isRestingAtHome(3 * CELL_M, 0), 'resting at the adopted house');
    // Two cells the far side of the trailer: inside the ring the TRAILER
    // would have thrown, outside the one the adopted house does.
    assert.falsy(s.isRestingAtHome(-2 * CELL_M, 0), 'not at the trailer it replaced');
  } finally { WorldGen.tileCache = realCache; }
});

test('home: a miss is never memoised', () => {
  // A miss means the house's tile simply is not loaded yet. Caching it would
  // leave Home dark, cold and unwarded until the player adopted somewhere else.
  const empty = new Map();
  const s = trailerScene({ save: { starterShopId: 'adopted' } });
  const realCache = WorldGen.tileCache;
  WorldGen.tileCache = empty;
  try {
    assert.eq(s.homeWorldPos(), null, 'not found while its tile is unloaded');
    empty.set('t', { objects: [{ kind: 'house', id: 'adopted', x: 0, y: 0 }] });
    assert.truthy(s.homeWorldPos(), 'and found the moment the tile arrives');
  } finally { WorldGen.tileCache = realCache; }
});

// ── The ward ──────────────────────────────────────────────────────────────
// wanderCreatures needs Phaser, so the branch is pinned as source text.

const wander = (() => {
  const a = app.indexOf('\n  wanderCreatures() {');
  const b = app.indexOf('\n  }\n', a);
  assert.truthy(a > 0 && b > a, 'found wanderCreatures');
  return app.slice(a, b);
})();

test('ward: what is warded is what the game calls an ENEMY', () => {
  assert.truthy(/const homeWard = !!homePos && !isTame && Combat\.isEnemy\(c\) &&/.test(wander),
    'Combat.isEnemy — the registered-hostile test, so a kind added to the '
    + 'monster table is warded the day it ships, and a tamed slime is not');
  assert.truthy(/const homePos = this\.homeWorldPos\(\);/.test(wander),
    'Home is resolved ONCE per tick, above the creature loop');
  assert.truthy(/const HOME_WARD_R2 = \(HOME_R \* this\.cellM\) \* \(HOME_R \* this\.cellM\);/.test(wander),
    'and the ward ring is HOME_R — the same number that lights and rests');
});

test('ward: a warded foe turns AWAY FROM HOME, and cannot bite on the way out', () => {
  assert.truthy(/\} else if \(homeWard\) \{[\s\S]{0,900}?angle = Math\.atan2\(c\.y - homePos\.y, c\.x - homePos\.x\)/.test(wander),
    'the angle is away from HOME');
  // Away-from-PLAYER would shove the foe around the ring with the player
  // still inside it, so the branch must not read the player's bearing.
  const branch = wander.match(/\} else if \(homeWard\) \{([\s\S]*?)\n          \} else if \(c\.kind === 'slime'\)/);
  assert.truthy(branch, 'the ward branch sits ahead of the slime chase');
  assert.falsy(/dxp|dyp/.test(branch[1]), 'not away-from-player');
  // And it is an ANGLE, never a refused target cell — a foe deep inside the
  // ring would have all six attempts rejected by a cell test and freeze on
  // the doorstep (the stall the scarecrow comment warns about).
  assert.falsy(/homeWard[^\n]*\)\s*continue;/.test(wander), 'no refused-cell ward');
  // Both drains are gated: a ward that let a slime leech its way to the door
  // makes the doorstep no safer, only slower to lose the bar on.
  assert.truthy(/if \(c\.kind === 'slime' && !isTame &&[^)]*!homeWard\) \{/.test(wander),
    "the slime's leech is off inside the ring");
  assert.truthy(/if \(isMonster\(c\.kind\) &&[^)]*!homeWard\) \{/.test(wander),
    "and so is a monster's melee and its arrow");
});

test('ward: away-from-home actually LEAVES, from anywhere in the ring', () => {
  // Why away-from-home and not away-from-player, as arithmetic: a foe on the
  // far side of Home from the player, told to flee the player, walks THROUGH
  // the door. The jitter is ±0.4 rad, well inside the half-turn that would
  // let a hop come back toward Home.
  const JITTER = 0.4;
  const homeX = 0, homeY = 0;
  for (const bearing of [0, 1, 2, 3, 4, 5]) {
    for (const dist of [0.05, 1, 2, 3.9]) {
      const cx = homeX + Math.cos(bearing) * dist * CELL_M;
      const cy = homeY + Math.sin(bearing) * dist * CELL_M;
      for (const j of [-JITTER, 0, JITTER]) {
        const angle = Math.atan2(cy - homeY, cx - homeX) + j;
        const step = 0.6 * CELL_M;      // a slime's ooze, the slowest there is
        const nx = cx + Math.cos(angle) * step, ny = cy + Math.sin(angle) * step;
        assert.gt(Math.hypot(nx, ny), Math.hypot(cx, cy),
          `a hop from ${dist} cells out at bearing ${bearing} moves outward`);
      }
    }
  }
});

test('ward: a foe struck on the doorstep is routed to the sim bubble\'s edge', () => {
  // Home's ring is only HOME_R (4 cells), so a warded foe walked out, stopped
  // being warded the moment it crossed, and turned straight back around — the
  // yard was quiet for a step. Hit one WHILE it is being warded and the ward
  // radius becomes CREATURE_SIM_CELLS for that foe alone until it is out: the
  // edge of the sim bubble, which is as far as anything is driven in this game.
  assert.gt(CREATURE_SIM_CELLS, HOME_R,
    'the rout is a bigger ring than the ward, or it would not be a rout');

  // The mark is set where the damage is BANKED — _damageEnemy is the one place
  // every source of player damage funnels through (melee wheel, bow, staff,
  // a turret), so no route can rout and another not.
  const dmg = app.slice(app.indexOf('  _damageEnemy(c, amount) {'));
  const head = dmg.slice(0, dmg.indexOf('\n  }\n'));
  assert.truthy(/c\._routedFromHome = true;/.test(head),
    'a hit inside the ring marks the foe routed');
  assert.truthy(/this\.homeWorldPos\(\)/.test(head),
    'against the SHARED resolver — surface-only and memoised, not a second '
    + 'idea of where Home is');
  assert.truthy(/HOME_R \* this\.cellM/.test(head),
    'and the mark is set by the WARD ring: routed means it was being warded');
  assert.truthy(/Combat\.isEnemy\(c\)/.test(head),
    'a pet is never routed from its own home');

  // The bigger ring is the sim bubble's own radius, derived not retyped.
  assert.truthy(
    /const HOME_ROUT_R2 = \(CREATURE_SIM_CELLS \* this\.cellM\) \* \(CREATURE_SIM_CELLS \* this\.cellM\);/
      .test(app),
    'the rout radius IS CREATURE_SIM_CELLS — the 12-cell edge, one number');

  // And the ward branch reads it, so a routed foe keeps the same treatment
  // (away-from-Home angle, bite switched off) all the way out.
  assert.truthy(
    /homeD2 <= \(c\._routedFromHome \? HOME_ROUT_R2 : HOME_WARD_R2\)/.test(app),
    'one ward, two radii — the routed foe is warded to the bubble edge');
  assert.truthy(/if \(c\._routedFromHome && homeD2 > HOME_ROUT_R2\) c\._routedFromHome = false;/
    .test(app),
    'and it clears itself once out, so nothing about the rout persists');
});

test('ward: the routed foe is driven by the SAME angle, so it cannot stall', () => {
  // The rout changes the RADIUS and nothing else: still away-from-HOME, still
  // an angle rather than a refused target cell. Away-from-player would shove a
  // foe around the ring, and a cell test would reject all six attempts for one
  // deep inside a 12-cell ring and freeze it on the doormat — which is exactly
  // the stall the ward's own comment warns about, made twelve cells wide.
  const ward = app.slice(app.indexOf('} else if (homeWard) {') + 1);
  const branch = ward.slice(0, ward.indexOf('} else if'));
  assert.truthy(/Math\.atan2\(c\.y - homePos\.y, c\.x - homePos\.x\)/.test(branch),
    'away from HOME, at any radius');
  assert.falsy(/continue;/.test(branch),
    'an angle, never a refused cell — a 12-cell refusal ring would stall it');

  // Geometry: from anywhere inside the routed ring, one step away-from-home
  // strictly increases the distance, so it always makes progress out.
  const step = 0.6;
  for (const d of [0.1, 1, 6, 11.9]) {
    for (const jit of [-0.4, 0, 0.4]) {      // the branch's ±0.4 rad jitter
      const a = Math.atan2(0, d) + jit;      // foe due east of Home at distance d
      const nx = d + Math.cos(a) * step, ny = Math.sin(a) * step;
      assert.gt(Math.hypot(nx, ny), d,
        `a routed foe ${d} cells out still moves outward at jitter ${jit}`);
    }
  }
});

test('ward: the ring is one number, and Home out-rests and out-reaches a fire', () => {
  const m = app.match(/const HOME_R = ([\d.]+);/);
  assert.truthy(m, 'HOME_R is a plain literal, liftable by run.js');
  assert.eq(Number(m[1]), HOME_R, 'and that is the number the tests ran on');
  assert.gt(HOME_R, FIRE_REST_R,
    'Home reaches further than the field expedient it replaces');
  // Selling is untouched by any of this: the trade panel is a tap on the
  // building, not an effect of the ring.
  assert.falsy(/homeWard[^\n]*shop/i.test(app), 'the ward knows nothing about the shop');
});

// ── The fire ward's depth cap ────────────────────────────────────────────
// A campfire's ward reaches past the surface slime into the cave, but only
// its entry-level monsters (FIRE_WARD_MAX_DEPTH) — a goblin (minDepth 2) or
// its archer (minDepth 3), and their giants pushed GIANT_DEPTH_STEP deeper
// still, are undeterred by firelight. Only Home's stronger ward reaches
// those, and Home does not exist underground (homeWorldPos returns null off
// the surface — see the "no Home, no ring" test above), so a goblin met in a
// cave is never warded by anything.

test('fire ward: the depth cap is a named number, and the real table agrees with it', () => {
  assert.eq(FIRE_WARD_MAX_DEPTH, 1, 'only the first cave level is warded off by fire');
  assert.lte(MONSTERS.cave_slime.minDepth, FIRE_WARD_MAX_DEPTH, 'cave slime is warded');
  assert.lte(MONSTERS.purple_slime.minDepth, FIRE_WARD_MAX_DEPTH, 'purple slime is warded');
  assert.gt(MONSTERS.goblin.minDepth, FIRE_WARD_MAX_DEPTH, "a goblin is past a campfire's reach");
  assert.gt(MONSTERS.goblin_archer.minDepth, FIRE_WARD_MAX_DEPTH, 'so is its archer');
  // Giants are pushed GIANT_DEPTH_STEP deeper than their base kind, so none of
  // them ever qualify even if a future base kind's minDepth were lowered to 1.
  for (const kind of Object.keys(MONSTERS)) {
    if (!MONSTERS[kind].giant) continue;
    assert.gt(MONSTERS[kind].minDepth, FIRE_WARD_MAX_DEPTH, `${kind} is never warded by a campfire`);
  }
});

test('fire ward: wanderCreatures reads the same cap the table is built on', () => {
  assert.truthy(
    /const fireAverts = c\.kind === 'slime' \|\|\s*\(isMon && \(mon\.minDepth \|\| 1\) <= FIRE_WARD_MAX_DEPTH\);/.test(wander),
    'the surface slime and any monster at or under the depth cap are averted');
  assert.truthy(/if \(fireAverts && this\._nearAny\('fires', tx, ty, 4\)\) continue;/.test(wander),
    "a refused target cell, exactly like the scarecrow ward above it — a fire never triggers a home-style flee");
  // The fire ward never gates a monster's ATTACK the way homeWard does — it
  // only keeps a warded kind from wandering closer, so a monster already in
  // range when the fire is lit can still land its hit. Weaker than Home on
  // purpose: a campfire is a field expedient, not a doorstep.
  assert.falsy(/isMonster\(c\.kind\) && !shadowed && !homeWard && !fireAverts/.test(wander),
    "a monster's attack check is untouched by the fire ward");
});
})();
