// GHOSTS — the night's hostile, run through the REAL lifted wanderCreatures
// (run.js __wander) and its two helpers (__ghostSpawnPass / __ghostTick).
//
// What is pinned:
//   · the row: a MONSTERS kind (an enemy — wards, shots, bounty), a jog
//     (Combat.GHOST_SPEED_MPS, 2 m/s), a touch of 25 before
//     the mode / shield / armour, never drawn by the cave bag, no giant;
//   · the pump: surface only, only after dark, on its ~5-minute cadence, only
//     where it is dark, never inside Home's ring;
//   · the mover: it hovers, then it rushes; a touch lands the blow through
//     Combat.playerDamage and spends the ghost; nothing hunts a body;
//   · the burn: Lighting.brightnessAt — the lightmap's own model — scales the
//     damage, which is not a player kill; the race is won in the open at base
//     reach, and lost by a torch; no light's ring refuses its step.
(function () {

const CELL = 7;                          // WorldGen.CELL_M
const TICK_MS = 100;
const P = { x: CELL / 2, y: CELL / 2 };  // the player's feet, mid-cell

function ghostScene(creatures, over = {}) {
  const hits = [], pops = [], dmgCalls = [];
  const scene = Object.assign({
    cellM: CELL, depth: 0,
    save: { energy: 100, caught: [], armor: {}, planted: [], fires: [], released: [], reachUpgrades: 0 },
    startWorldM: { x: 0, y: 0 },
    playerM: { x: P.x, y: P.y },
    feetOffsetM: 0,
    originPx: { x: 0, y: 0 }, mPerPx: CELL, cellsPerTile: WorldGen.TILE_PX,
    viewCenterX: 0, viewCenterY: 0,
    _shots: [],
    isShadowActive: () => false,
    isUnnoticed() { return this.isShadowActive() || Combat.playerDowned(this.save.energy); },
    homeWorldPos: () => null,
    _castleWardPoints: () => [],
    playerToWorldCell: () => ({ tx: 0, ty: 0, ix: 0, iy: 0 }),
    cellAt: () => ({ loaded: true, type: 0 }),
    _cellBlocked: () => false,
    _nearAny(listKey, wx, wy, cells) {
      const r2 = (cells * CELL) ** 2;
      return (this.save[listKey] || []).some((e) => (e.x - wx) ** 2 + (e.y - wy) ** 2 < r2);
    },
    placedRockSet: null,
    // The kill path's shape: Combat's pool, and on death the caught marker —
    // the source is recorded so the test can ask who felled it.
    _damageEnemy(c, amount, source) {
      dmgCalls.push({ id: c.id, amount, source });
      if (Combat.damage(c, amount) > 0) return false;
      this.save.caught.push(c.id);
      c._felledBy = source;
      return true;
    },
    resolveDefeat: () => {},
    _popEnergy: (d, o) => pops.push({ d, o }),
    _warnIfTiring: () => {}, _flashPlayerHit: (n) => hits.push(n), _closeShopOnHit: () => {},
    _losePlayerEnergy(d) { const b = this.save.energy ?? 0; this.save.energy = Math.max(0, b - d); const l = b - this.save.energy; this._flashPlayerHit(l); return l; },
    updateEnergyDOM: () => {}, flash: () => {}, _wildCrowTick: () => {},
  }, over);
  scene.creatures = creatures;
  scene._hits = hits; scene._pops = pops; scene._dmgCalls = dmgCalls;
  return scene;
}

function tick(scene, ms) {
  const realForEach = WorldGen.forEachItem;
  const realNear = WorldGen.forEachItemNear;
  const realNow = performance.now;
  scene._simT = (scene._simT || 1e6) + ms;
  const t = scene._simT;
  const walk = (what, fn) => {
    if (what !== 'creatures') return;
    for (const c of scene.creatures.slice()) fn(c, 0, 0);
  };
  WorldGen.forEachItem = walk;
  WorldGen.forEachItemNear = (what, tx, ty, fn) => walk(what, fn);
  try {
    performance.now = () => t;
    __wander.call(scene);
  } finally {
    WorldGen.forEachItem = realForEach;
    WorldGen.forEachItemNear = realNear;
    performance.now = realNow;
  }
}
// Run at a forced daylight (window.__DAYLIGHT — Lighting.daylight's own knob),
// restored after, since every test file shares the one global.
function atDaylight(day, f) {
  const was = window.__DAYLIGHT;
  window.__DAYLIGHT = day;
  try { return f(); } finally { window.__DAYLIGHT = was; }
}
const mkGhost = (over = {}) => Object.assign({
  kind: 'ghost', id: 'ghost_0_0_1_0_1', x: P.x + 10 * CELL, y: P.y,
}, over);
const dist = (c) => Math.hypot(c.x - P.x, c.y - P.y) / CELL;
const alive = (scene, c) => !scene.save.caught.includes(c.id);

// Run until the ghost is spent (touched, burned, faded) or `seconds` pass.
function race(scene, g, seconds) {
  for (let t = 0; t < seconds * 1000 && alive(scene, g); t += TICK_MS) tick(scene, TICK_MS);
}

// ── The row ─────────────────────────────────────────────────────────────────
test('ghost: a MONSTERS row — an enemy, a jog over the ground', () => {
  const g = Combat.monster('ghost');
  assert.truthy(g, 'registered in the monster table');
  assert.truthy(Combat.isEnemy({ kind: 'ghost', id: 'ghost_x' }), 'an enemy: wards, shots, bounty');
  assert.eq(Combat.GHOST_SPEED_MPS, 2, 'a jog: 2 m/s, per the ask');
  assert.eq(g.mps, Combat.GHOST_SPEED_MPS, 'the live row carries it');
  assert.eq(g.dmg, 25, 'the touch is 25 before the mode, shield and armour');
  assert.eq(Combat.GHOST_TOUCH_DMG, 25);
  assert.falsy(Combat.spawnsUnderground('ghost'), 'never drawn by the cave bag');
  assert.truthy(Combat.spawnsUnderground('goblin'), 'which still draws the cave kinds');
  assert.falsy(MONSTERS.giant_ghost, 'no giant');
  assert.truthy(SpriteLayout.creatureHaunts('ghost'), 'moves by the ghost mover');
  assert.truthy(SpriteLayout.CREATURE_ART.ghost, 'has (temporary) art');
  assert.lt(SpriteLayout.creatureAlpha('ghost'), 1, 'see-through');
  assert.eq(SpriteLayout.creatureAlpha('goblin'), 1, 'and nothing else is');
  assert.gt(Combat.enemyBounty('ghost', 0), 0, 'a kill pays a bounty');
});

test('ghost: the cave bag skips a row with its own spawn', () => {
  const src = APP_JS_SRC;
  const body = src.slice(src.indexOf('  spawnCaveCreatures(entry, tx, ty, depth) {'));
  assert.truthy(/if \(!Combat\.spawnsUnderground\(kind\)\) continue;/.test(body.slice(0, 3000)),
    'spawnCaveCreatures asks the row before bagging it');
});

// ── The pump ────────────────────────────────────────────────────────────────
function pumpScene(over) {
  const entry = { creatures: [] };
  const scene = ghostScene(entry.creatures, over);
  scene._entry = entry;
  return scene;
}
function pump(scene, now) {
  const realGet = WorldGen.tileCache.get;
  const realNear = WorldGen.forEachItemNear;
  WorldGen.tileCache.get = () => scene._entry;
  WorldGen.forEachItemNear = (what, tx, ty, fn) => { for (const c of scene._entry.creatures) fn(c); };
  try {
    return __ghostSpawnPass(scene, now, P.x, P.y, { tx: 0, ty: 0 }, scene.homeWorldPos(), [],
      (HOME_R * CELL) ** 2, new Set(scene.save.caught));
  } finally {
    WorldGen.tileCache.get = realGet;
    WorldGen.forEachItemNear = realNear;
  }
}

test('ghost pump: nothing by day', () => {
  atDaylight(1, () => {
    const s = pumpScene();
    for (let t = 0; t < 30 * 60000; t += 1000) pump(s, t);
    assert.eq(s._entry.creatures.length, 0, 'half an hour of noon, no ghosts');
  });
  atDaylight(__ghost.GHOST_DARK_DAYLIGHT + 0.01, () => {
    const s = pumpScene();
    for (let t = 0; t < 30 * 60000; t += 1000) pump(s, t);
    assert.eq(s._entry.creatures.length, 0, 'nor at dusk, before it is dark');
  });
});

test('ghost pump: nothing underground, night or not', () => {
  atDaylight(0, () => {
    const s = pumpScene({ depth: 1 });
    for (let t = 0; t < 30 * 60000; t += 1000) pump(s, t);
    assert.eq(s._entry.creatures.length, 0, 'the caves have their own foes');
  });
});

test('ghost pump: after dark, a small group every ~5 minutes', () => {
  atDaylight(0, () => {
    const s = pumpScene();
    const groups = [];
    for (let t = 0; t <= 60 * 60000; t += 1000) {
      const n = pump(s, t);
      if (n) {
        groups.push({ t, n });
        // Spend them, so the near cap does not decide the count.
        for (const c of s._entry.creatures) if (!s.save.caught.includes(c.id)) s.save.caught.push(c.id);
      }
    }
    assert.gte(groups.length, 10, `an hour of night: ${groups.length} groups`);
    assert.lte(groups.length, 15, 'but not more than one per four minutes');
    const lo = __ghost.GHOST_SPAWN_MS - __ghost.GHOST_SPAWN_JITTER_MS;
    const hi = __ghost.GHOST_SPAWN_MS + __ghost.GHOST_SPAWN_JITTER_MS;
    assert.gte(groups[0].t, lo - 1000, 'the first group comes one delay after dark, not at once');
    for (let i = 1; i < groups.length; i++) {
      const gap = groups[i].t - groups[i - 1].t;
      assert.inRange(gap, lo - 1000, hi + 1000, `group ${i} came ${gap / 1000}s after the last`);
    }
    for (const g of groups) assert.inRange(g.n, __ghost.GHOST_GROUP_MIN, __ghost.GHOST_GROUP_MAX, 'group size');
    // Seated on the dispatch ring: off-screen, inside the sim bubble.
    for (const c of s._entry.creatures) {
      assert.eq(c.kind, 'ghost');
      assert.truthy(/^ghost_0_0_/.test(c.id), 'a clock id on the pest crow\'s pattern (pruned the same way)');
      assert.lt(Math.abs(dist(c) - PEST_CROW_SPAWN_CELLS), 1e-6, 'on the dispatch ring');
      assert.lt(dist(c), CREATURE_SIM_CELLS, 'inside the bubble, so it thinks');
    }
  });
});

test('ghost pump: only where it is dark, and never in Home\'s ring', () => {
  atDaylight(0, () => {
    // A ring of lit lamps all around the dispatch ring: nowhere is dark.
    const lamps = [];
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * Math.PI * 2;
      lamps.push({ id: 'lamp' + i, lit: true,
        x: P.x + Math.cos(a) * PEST_CROW_SPAWN_CELLS * CELL, y: P.y + Math.sin(a) * PEST_CROW_SPAWN_CELLS * CELL });
    }
    const lit = pumpScene({ _streetLamps: lamps });
    for (let t = 0; t < 30 * 60000; t += 1000) pump(lit, t);
    assert.eq(lit._entry.creatures.length, 0, 'every spawn point is lamp-lit, so none rise');
    // Home standing on the ring's every point is impossible, so: Home at the
    // player — the ring is outside HOME_R and they rise; widen the test to a
    // home out on the ring and check none rise inside its ring.
    const home = { x: P.x + PEST_CROW_SPAWN_CELLS * CELL, y: P.y };
    const s = pumpScene({ homeWorldPos: () => home });
    for (let t = 0; t < 120 * 60000; t += 1000) {
      if (pump(s, t)) for (const c of s._entry.creatures) if (!s.save.caught.includes(c.id)) s.save.caught.push(c.id);
    }
    assert.gt(s._entry.creatures.length, 0, 'ghosts still rise elsewhere on the ring');
    for (const c of s._entry.creatures) {
      assert.gt(Math.hypot(c.x - home.x, c.y - home.y), HOME_R * CELL, 'never inside Home\'s ring');
    }
  });
});

// ── The mover, the touch ────────────────────────────────────────────────────
test('ghost: it hovers where it rose, then rushes the player', () => {
  atDaylight(0, () => {
    const g = mkGhost();
    const s = ghostScene([g]);
    const x0 = g.x, y0 = g.y;
    for (let t = 0; t < __ghost.GHOST_HOVER_MS - 200; t += TICK_MS) tick(s, TICK_MS);
    assert.eq(g.x, x0, 'hovering: not a step');
    assert.eq(g.y, y0);
    const d0 = dist(g);
    for (let t = 0; t < 3000; t += TICK_MS) tick(s, TICK_MS);
    assert.lt(dist(g), d0, 'then it closes');
    assert.lt(Math.abs(g.y - P.y), 1e-9, 'on a committed line at the player — no meander');
    // At its pace: a jog, GHOST_SPEED_MPS over the ground.
    const mps = (d0 - dist(g)) * CELL / 3;
    assert.inRange(mps, Combat.GHOST_SPEED_MPS * 0.9, Combat.GHOST_SPEED_MPS * 1.1,
      `${mps.toFixed(2)} m/s, a jog`);
  });
});

test('ghost: a touch lands 25 through armour and spends the ghost — no coin', () => {
  atDaylight(0, () => {
    const g = mkGhost({ x: P.x + 3 * CELL });
    const s = ghostScene([g]);
    race(s, g, 30);
    assert.falsy(alive(s, g), 'spent');
    assert.falsy(g._felledBy, 'by the touch, not by a blow — nobody felled it');
    const mul = Difficulty.get().enemyDmgMul;
    const want = Combat.playerDamage(25 * mul, {});
    assert.eq(100 - s.save.energy, want, `the touch cost ${want}`);
    assert.eq(s._hits.length, 1, 'the body flinched, once');
    assert.eq(s._pops.length, 1, 'and the loss popped');
    assert.eq(s._pops[0].d, -want);
    // Armour soaks it, by the one rule.
    const armor = { head: { tier: 3 }, body: { tier: 3 } };
    const g2 = mkGhost({ id: 'ghost_0_0_2_0_1', x: P.x + 3 * CELL });
    const s2 = ghostScene([g2]);
    s2.save.armor = armor;
    race(s2, g2, 30);
    assert.eq(100 - s2.save.energy, Combat.playerDamage(25 * mul, armor), 'mitigated by the worn set');
  });
});

test('ghost: in the open at night, at base reach, it wins the race', () => {
  atDaylight(0, () => {
    const g = mkGhost();
    const s = ghostScene([g]);
    race(s, g, 60);
    assert.eq(s._hits.length, 1, 'it reached the player');
    const burned = s._dmgCalls.reduce((a, d) => a + d.amount, 0);
    assert.gt(burned, 0, 'but the player\'s own light burned it on the way in');
    assert.truthy(s._dmgCalls.every((d) => d.source === 'light'), 'and that burn is the light\'s');
  });
});

test('ghost: a torch, or a brighter Inner Light, burns it out before it arrives', () => {
  atDaylight(0, () => {
    const g = mkGhost();
    const s = ghostScene([g], { isTorchActive: () => true });
    race(s, g, 60);
    assert.eq(s._hits.length, 0, 'never touched the player');
    assert.eq(g._felledBy, 'light', 'burned out');
    assert.falsy(Combat.isPlayerKill('light'), 'a light kill is not the player\'s — the coin only');
    const g2 = mkGhost({ id: 'ghost_0_0_3_0_1' });
    const s2 = ghostScene([g2]);
    s2.save.reachUpgrades = 3;           // reach 4 cells
    race(s2, g2, 60);
    assert.eq(s2._hits.length, 0, 'three Inner Light upgrades hold it off');
  });
});

test('ghost: a campfire at the player\'s side does not hold it off — it comes in', () => {
  atDaylight(0, () => {
    const g = mkGhost();
    const s = ghostScene([g]);
    s.save.fires = [{ x: P.x, y: P.y }];
    let closest = Infinity;
    for (let t = 0; t < 60000 && alive(s, g); t += TICK_MS) {
      tick(s, TICK_MS);
      closest = Math.min(closest, dist(g));
    }
    assert.lt(closest, FIRE_REST_R - 0.5, 'it crossed into the fire\'s ring');
  });
});

test('ghost: so does a lit street lamp — its light only burns', () => {
  atDaylight(0, () => {
    const g = mkGhost();
    const s = ghostScene([g], { _streetLamps: [{ id: 'L', x: P.x, y: P.y, lit: true }] });
    let closest = Infinity;
    for (let t = 0; t < 60000 && alive(s, g); t += TICK_MS) {
      tick(s, TICK_MS);
      closest = Math.min(closest, dist(g));
    }
    const r = Lighting.radiusCells('cobble');
    assert.lt(closest, r - 0.5, 'it crossed into the lamp\'s ring');
  });
});

test('ghost: Home\'s ward routs it like any foe', () => {
  atDaylight(0, () => {
    const g = mkGhost();
    const s = ghostScene([g], { homeWorldPos: () => ({ x: P.x, y: P.y }) });
    race(s, g, 60);
    assert.eq(s._hits.length, 0, 'never touched the player at Home');
  });
});

test('ghost: NOTHING HUNTS A BODY — a downed player is not rushed', () => {
  atDaylight(0, () => {
    const g = mkGhost({ x: P.x + 3 * CELL });
    const s = ghostScene([g]);
    s.save.energy = 0;
    const d0 = dist(g);
    for (let t = 0; t < 20000; t += TICK_MS) tick(s, TICK_MS);
    assert.eq(dist(g), d0, 'it hovers where it is');
    assert.eq(s._hits.length, 0);
    // …and a Shadow Powder hides you the same way.
    const g2 = mkGhost({ id: 'ghost_0_0_4_0_1', x: P.x + 3 * CELL });
    const s2 = ghostScene([g2], { isShadowActive: () => true });
    for (let t = 0; t < 20000; t += TICK_MS) tick(s2, TICK_MS);
    assert.eq(s2._hits.length, 0, 'unnoticed under the powder');
  });
});

test('ghost: it fades if it never finds you', () => {
  atDaylight(0, () => {
    const g = mkGhost();
    const s = ghostScene([g], { isShadowActive: () => true });
    for (let t = 0; t < __ghost.GHOST_LIFETIME_MS + 1000; t += 500) tick(s, 500);
    assert.falsy(alive(s, g), 'gone at the end of its lifetime');
    assert.falsy(g._felledBy, 'faded, not felled — no coin');
  });
});

// ── The burn ────────────────────────────────────────────────────────────────
test('ghost burn: damage scales with brightness, and darkness is safe', () => {
  atDaylight(0, () => {
    // Held in place (a powder: it hovers), at three distances from a campfire.
    // The fire stands 10.5 cells off — past the player's ramp (so only the
    // fire lights it) and inside the sim bubble (so the ghost thinks).
    const fire = { x: P.x, y: P.y + 10.5 * CELL };
    const burnAt = (offCells) => {
      const g = mkGhost({ x: fire.x + offCells * CELL, y: fire.y });
      const s = ghostScene([g], { isShadowActive: () => true });
      s.save.fires = [fire];
      for (let t = 0; t < 1000; t += TICK_MS) tick(s, TICK_MS);
      return { dmg: s._dmgCalls.reduce((a, d) => a + d.amount, 0), s, g };
    };
    const near = burnAt(0.5), mid = burnAt(1.5), dark = burnAt(5);
    assert.gt(near.dmg, mid.dmg, 'nearer the fire, brighter, faster');
    assert.gt(mid.dmg, 0, 'the fire\'s edge still burns');
    assert.eq(dark.dmg, 0, 'out of every light: no burn at all');
    // Proportional: the damage over a second is the pool × exposure / burn-s.
    const sc = near.s;
    const b = Lighting.brightnessAt(sc, near.g.x, near.g.y) / Lighting.profile(sc, 0).lit;
    const expect = Combat.maxHp(near.g) * b * 1 / __ghost.GHOST_PLATEAU_BURN_S;
    assert.inRange(near.dmg, expect * 0.7, expect * 1.3, 'the pool × exposure over GHOST_PLATEAU_BURN_S');
  });
});

test('ghost burn: dawn burns what is left', () => {
  atDaylight(1, () => {
    const g = mkGhost();
    const s = ghostScene([g], { isShadowActive: () => true });
    race(s, g, __ghost.GHOST_PLATEAU_BURN_S + 2);
    assert.eq(g._felledBy, 'light', 'the sun finishes a ghost caught out in the day');
  });
  assert.eq(__ghost.ghostSunExposure(__ghost.GHOST_DARK_DAYLIGHT), 0, 'no sun burn while it is dark');
  assert.eq(__ghost.ghostSunExposure(1), 1, 'a full plateau\'s worth at noon');
});

// ── Lighting.brightnessAt is the lightmap's model ───────────────────────────
test('brightnessAt: the player\'s plateau, its ramp, then nothing', () => {
  atDaylight(0, () => {
    const s = ghostScene([]);
    const prof = Lighting.profile(s, 0);
    const feet = Lighting.brightnessAt(s, P.x, P.y);
    assert.inRange(feet, prof.lit * 0.99, prof.lit * 1.01, 'at the feet: the plateau\'s full level');
    const rim = Lighting.brightnessAt(s, P.x + 2 * CELL, P.y);
    assert.lt(rim, feet, 'the plateau eases toward its rim');
    assert.gt(rim, prof.edge, 'but is still over the ramp');
    const ramp = Lighting.brightnessAt(s, P.x + 5 * CELL, P.y);
    assert.lt(ramp, prof.edge + 1e-9, 'outside reach: the ramp');
    assert.gt(ramp, 0);
    assert.eq(Lighting.brightnessAt(s, P.x + 10 * CELL, P.y), 0, 'past the ramp: dark');
    s.save.energy = 0;
    const down = Lighting.brightnessAt(s, P.x + 2 * CELL, P.y);
    assert.lt(down, prof.edge, 'a downed player has no reach: no plateau, the ramp runs from the feet');
    assert.eq(down, Lighting.playerCookieAlpha(2 * CELL / (Lighting.radiusCells('player') * CELL), prof),
      'exactly the ramp\'s own curve');
  });
});

test('brightnessAt: a campfire, a lit lamp and a scanned light add; a dark lamp does not', () => {
  atDaylight(0, () => {
    const far = { x: P.x + 40 * CELL, y: P.y };
    const s = ghostScene([]);
    assert.eq(Lighting.brightnessAt(s, far.x, far.y), 0, 'dark');
    s.save.fires = [{ x: far.x, y: far.y }];
    assert.gt(Lighting.brightnessAt(s, far.x, far.y), 0.3, 'by a fire');
    s.save.fires = [];
    s._streetLamps = [{ id: 'L', x: far.x, y: far.y, lit: false }];
    assert.eq(Lighting.brightnessAt(s, far.x, far.y), 0, 'a dark lamp throws nothing');
    s._streetLamps[0].lit = true;
    assert.gt(Lighting.brightnessAt(s, far.x, far.y), 0.2, 'a lit one does');
    s._streetLamps = [];
    // A scanned light (Home) off the last frame's list, against its anchor.
    s._lightAnchor = { x: far.x - 3 * CELL, y: far.y };
    s._lights = [{ kind: 'trailer', dx: 3 * CELL, dy: 0, id: 'home' }];
    const home = Lighting.brightnessAt(s, far.x, far.y);
    assert.inRange(home, Lighting.KINDS.trailer.peak * Lighting.lum(Lighting.KINDS.trailer.colour) * 0.99,
      Lighting.KINDS.trailer.peak * Lighting.lum(Lighting.KINDS.trailer.colour) * 1.01,
      'at Home\'s centre: its peak at its colour\'s luminance');
    assert.eq(s._lights.length, 1, 'the frame\'s list is left as it was');
  });
});

})();
