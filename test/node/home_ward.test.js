// HOME IS A CAMPFIRE YOU OWN.
//
// A placed campfire does three things on one ring: it lights (Lighting.KINDS
// .fire), it rests you (FIRE_REST_R / FIRE_FULL_REST_S) and it repels slimes.
// Home does the same three on ONE ring of its own, HOME_R — and keeps the one
// thing a fire hasn't, the trade panel, which is a TAP on the building and no
// part of the ring at all.
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
  assert.truthy(/if \(c\.kind === 'slime' && !isTame && !homeWard\) \{/.test(wander),
    "the slime's leech is off inside the ring");
  assert.truthy(/if \(isMonster\(c\.kind\) && !homeWard\) \{/.test(wander),
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
})();
