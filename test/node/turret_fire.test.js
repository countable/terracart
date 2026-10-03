// turret_fire.test.js — castle turrets shoot Wood-tier bow arrows at monsters.
//
// What this suite is defending:
//
//  1. THE TURRET FIRES THE PLAYER'S ARROW, NOT ITS OWN. A turret's shot is a
//     `bow` shot from Combat.spawnShot — same speed, range and streak, blocked
//     by the same timber and rock — with the damage a WOOD bow deals
//     (shotDamage over a tier-1 bow). Nothing in the turret block is a tuned
//     number: a re-shaped tool ladder or bow spec moves the turrets with it.
//
//  2. ONE FIFTH THE PLAYER'S RATE. Turret cadence is FIRE_INTERVAL_MS ×
//     TURRET_RATE_DIV; over a long fight a turret looses exactly a fifth of
//     what the player's bow does.
//
//  3. THE ENEMY SET IS THE PLAYER'S. turretTick takes the caller's filtered
//     hostile list, and app.js hands it the same `enemies` _combatTick built
//     with Combat.isEnemy — so a turret can no more shoot a crow, a deer or a
//     tamed slime than the auto-fire can. Both halves are pinned: the maths
//     here, and the app.js call site as source text (SCENE_SRC).
//
//  4. THE WALLS ARE A REWARD, NOT SCENERY. Only a CLAIMED castle's turrets
//     fire — the same isClaimedKey test that already decides whether the tower
//     is drawn in the shaded palette and whether it gives off light. All three
//     said "this castle is not yours" while the fourth shot arrows for you.
//
//  5. A RIM DOESN'T VOLLEY. Each turret starts at a phase hashed from its id,
//     inside one interval, and the clocks are cleared while no enemy is on
//     screen so the next sighting re-arms at those phases.

(function () {
const CELL = 7;
const goblin = (id, x, y) => ({ kind: 'goblin', id, x, y });

test('turret art: atlas variants bake shared stone and wood in both restoration states', () => {
  const art = new Function('lerp', 'CastleStyles', TEXTURES_SRC
    + '\nreturn { makeTowerTexture, CASTLE_STONE, CASTLE_STONE_UNCLAIMED };')(lerp, CastleStyles);
  const W = CastleStyles.TOWER_WIDTH, H = CastleStyles.TOWER_HEIGHT;
  const width = W * CastleStyles.ids.length;
  const source = new Uint8ClampedArray(width * H * 4);
  const at = (x, y) => (y * width + x) * 4;
  for (let frame = 0; frame < CastleStyles.ids.length; frame++) {
    source.set([120, 120, 120, 255], at(frame * W, frame + 2));
    source.set([180, 100, 60, 255], at(frame * W + 1, frame + 2));
    source.set([250, 250, 250, 80], at(frame * W + 2, 0));
    for (let y = H - 11; y < H; y++) source.set([120, 120, 120, 255], at(frame * W, y));
  }
  const before = JSON.stringify(CastleStyles.ids.map(id => [CastleStyles.get(id), CastleStyles.get(id, false)]));
  const textures = new Map();
  const scene = { textures: {
    exists: key => textures.has(key),
    get: key => key === 'castle_tower_shapes' ? { getSourceImage: () => source } : textures.get(key),
    getFrame: (key, frame) => textures.get(key)?.get(frame),
    createCanvas(key, w, h) {
      let pixels;
      const frames = new Map();
      const ctx = { drawImage(img) { pixels = new Uint8ClampedArray(img); },
        getImageData: () => ({ data: pixels }), putImageData(img) { pixels = img.data; } };
      const tex = { w, h, getContext: () => ctx, refresh() {}, get: n => frames.get(n),
        add(n, sourceIndex, x, y, fw, fh) { frames.set(n, { x, y, width: fw, height: fh }); },
        pixel(x, y) { return Array.from(pixels.slice(at(x, y), at(x, y) + 4)); } };
      textures.set(key, tex); return tex;
    },
  } };
  art.makeTowerTexture(scene);
  art.makeTowerTexture(scene, art.CASTLE_STONE_UNCLAIMED, 'tower_unclaimed');
  const rgb = hex => [hex >> 16, (hex >> 8) & 255, hex & 255, 255].join(',');
  for (const [key, claimed] of [['tower', true], ['tower_unclaimed', false]]) {
    const tex = textures.get(key);
    assert.eq(tex.w, width); assert.eq(tex.h, H);
    CastleStyles.ids.forEach((id, frame) => {
      const material = CastleStyles.get(id, claimed);
      assert.eq(tex.pixel(frame * W, frame + 2).join(','), rgb(material.stone.FACE), 'stone follows wall material');
      assert.eq(tex.pixel(frame * W + 1, frame + 2).join(','), rgb(material.rampart.woodTop ? material.wood.FACE : material.stone.FACE), 'archive timber keeps its wood material');
      assert.eq(tex.pixel(frame * W + 2, 0)[3], 0, 'soft source fringe does not become opaque');
      assert.eq(tex.get(frame).castleCrownY, frame + 2, 'crown follows opaque art, not the atlas top');
      assert.eq(tex.get(frame).x, frame * W);
      assert.eq(tex.get(frame).width, W);
      assert.eq(tex.pixel(frame * W, H - 1)[3], 77, 'foot is 30% opaque');
      assert.eq(tex.pixel(frame * W, H - 10)[3], 255, 'fade reaches full opacity within ten rows');
      assert.eq(tex.pixel(frame * W, H - 11)[3], 255, 'shaft above the fade stays opaque');
      let previous = 0;
      for (let y = H - 1; y >= H - 10; y--) {
        const alpha = tex.pixel(frame * W, y)[3];
        assert.gt(alpha, previous, 'each row grows more opaque upward');
        previous = alpha;
      }
      assert.eq(tex.pixel(frame * W + 3, H - 1)[3], 0, 'fade does not fill transparent silhouette gaps');
    });
  }
  assert.eq(JSON.stringify(CastleStyles.ids.map(id => [CastleStyles.get(id), CastleStyles.get(id, false)])), before,
    'baking must not recolour walls or floors');
  const spec = Render.objectAppearance({ textures: scene.textures, save: {} }, new Map()).RENDER_SPEC.tower;
  assert.eq(spec.scale, 1); assert.eq(spec.dyPx, CELL_PX / 2);
  for (const id of CastleStyles.ids) {
    assert.eq(spec.frame({ castle: id }), CastleStyles.get(id).towerFrame);
    assert.eq(Render.towerCrownHeight(scene.textures, id), H - CastleStyles.get(id).towerFrame - 2);
  }
  assert.eq(spec.key({}, { textures: scene.textures, isClaimedKey: () => false }), 'tower_unclaimed');
  assert.eq(spec.key({}, { textures: scene.textures, isClaimedKey: () => true }), 'tower');
});

test('turret art: missing frame uses the shared tower height for its crown', () => {
  assert.eq(Render.towerCrownHeight({ getFrame: () => null }, 'ruin'), CastleStyles.TOWER_HEIGHT);
});

test('turret: a Wood-tier bow at one fifth the player cadence — all derived', () => {
  assert.eq(Combat.TURRET.slot, 'bow', 'a turret is an archer');
  assert.eq(Combat.TURRET.tier, 1, 'Wood tier');
  assert.eq(Combat.TURRET_RATE_DIV, 5, 'one fifth the player rate');
  assert.eq(Combat.TURRET.fireIntervalMs, Combat.FIRE_INTERVAL_MS * 5,
    'the interval is the player interval × 5, never a literal');
  assert.eq(Combat.turretShotDamage(), Combat.shotDamage({ bow: { tier: 1 } }, 'bow'),
    'the damage is what a Wood bow deals per shot');
  assert.lt(Combat.turretShotDamage(), Combat.shotDamage({ bow: { tier: 7 } }, 'bow'),
    'and it is not a Frost bow');
});

test('turret: the arrow is the bow arrow, aimed at the nearest foe in range', () => {
  const near = goblin('near', 0, -2 * CELL);
  const far  = goblin('far', 4 * CELL, 0);
  const shot = Combat.turretShot(0, 0, [far, near], CELL);
  assert.truthy(shot, 'fires');
  assert.eq(shot.slot, 'bow', 'a bow shot');
  assert.eq(shot.source, 'turret', 'flagged as the turret\'s');
  assert.eq(Combat.shotSource(shot), 'turret', 'read back as the turret\'s');
  assert.falsy(Combat.isPlayerKill(Combat.shotSource(shot)), 'and a turret kill is not the player\'s');
  assert.eq(shot.speedMps, Combat.SHOT.bow.speedCps * CELL, 'the bow\'s speed');
  assert.eq(Combat.TURRET.rangeCells, 3, 'a turret guards three cells');
  assert.eq(shot.rangeM, Combat.TURRET.rangeCells * CELL, 'the arrow flies the turret\'s range');
  assert.falsy(shot.pierce, 'an arrow stops in the first foe and in solid ground');
  assert.eq(shot.damage, Combat.turretShotDamage(), 'Wood bow damage');
  assert.truthy(shot.vx === 0 && shot.vy === -1, 'lined up on the NEAR foe, not the far one');
  assert.eq(shot.aimDistM, 2 * CELL, 'the aim distance is stamped for the draw descent');
  // Fly it: the near foe takes the hit, the far one is never touched.
  let live = [shot];
  const struck = [];
  while (live.length) {
    live = Combat.stepShots(live, 1 / 60, [near, far], Combat.HIT_RADIUS_CELLS * CELL,
      (e) => struck.push(e.id));
  }
  assert.eq(struck.join(','), 'near');
});

test('turret: holds fire with nothing in range, and with nothing at all', () => {
  const beyond = goblin('b', (Combat.TURRET.rangeCells + 0.5) * CELL, 0);
  assert.eq(Combat.turretShot(0, 0, [beyond], CELL), null, 'beyond the turret\'s range: no arrow');
  assert.eq(Combat.turretShot(0, 0, [], CELL), null, 'nothing on screen: no arrow');
  assert.eq(Combat.turretShot(5, 5, [goblin('on', 5, 5)], CELL), null,
    'a foe standing on the turret gives no heading');
});

test('turret: the phase is a stable hash inside one interval, and spreads a rim', () => {
  const ids = ['tw_100_200', 'tw_105_200', 'tw_110_200', 'tw_100_205', 'tw_100_210', 'tw_115_215'];
  const phases = ids.map(Combat.turretPhaseMs);
  for (const p of phases) assert.inRange(p, 0, Combat.TURRET.fireIntervalMs - 1e-9, 'inside one interval');
  assert.eq(Combat.turretPhaseMs('tw_100_200'), phases[0], 'the same turret always gets the same phase');
  assert.gt(new Set(phases.map((p) => Math.round(p))).size, 1, 'a rim does not all fire at once');
});

test('turret: over a long fight a turret looses one fifth of what the bow does', () => {
  const foe = goblin('f', 3 * CELL, 0);
  const turret = { id: 'tw_1_1', x: 0, y: 0 };
  const clocks = {};
  const T = 100_000;                       // 100 s of fight, 60 Hz
  let turretShots = 0, playerShots = 0, nextPlayer = null;
  for (let now = 0; now < T; now += 1000 / 60) {
    turretShots += Combat.turretTick([turret], clocks, now, [foe], CELL).length;
    // The player's bow loop, as _combatTick runs it: arm on first sighting,
    // then one shot every FIRE_INTERVAL_MS.
    if (nextPlayer == null) nextPlayer = now;
    else if (now >= nextPlayer) { playerShots++; nextPlayer = now + Combat.FIRE_INTERVAL_MS; }
  }
  assert.eq(playerShots, 50, 'the bow: one every 2 s');
  assert.eq(turretShots, 10, 'the turret: one every 10 s');
  assert.gt(clocks[turret.id], T - 1, 'its clock is left armed for the next shot');
});

test('turret: first sighting arms at the phase, out-of-range keeps the clock due, and a cleared clock re-arms', () => {
  const turret = { id: 'tw_2_2', x: 0, y: 0, castle: 'archive' };
  const inRange = goblin('i', 2 * CELL, 0);
  const beyond = goblin('b', (Combat.SHOT.bow.rangeCells + 2) * CELL, 0);
  const phase = Combat.turretPhaseMs(turret.id);
  const clocks = {};
  assert.eq(Combat.turretTick([turret], clocks, 1000, [inRange], CELL).length, phase === 0 ? 1 : 0,
    'the first frame arms rather than fires (unless the phase is exactly 0)');
  assert.eq(clocks[turret.id], 1000 + phase, 'armed at its phase');
  // Due, but the only foe is out of range: nothing fires and the clock stays due.
  const due = clocks[turret.id];
  assert.eq(Combat.turretTick([turret], clocks, due + 1, [beyond], CELL).length, 0, 'holds fire');
  assert.eq(clocks[turret.id], due, 'the clock is left due, not pushed out');
  // One steps in: fires at once.
  const fired = Combat.turretTick([turret], clocks, due + 2, [beyond, inRange], CELL);
  assert.eq(fired.length, 1, 'fires the instant one is in range');
  assert.eq(fired[0].castle, turret.castle, 'arrow keeps castle identity for the correct variant crown');
  assert.eq(clocks[turret.id], due + 2 + Combat.TURRET.fireIntervalMs, 'and the full interval is charged');
  // app.js clears the clocks while no enemy is on screen; the next sighting
  // then re-arms at the phase instead of firing immediately.
  const fresh = {};
  Combat.turretTick([turret], fresh, 50_000, [inRange], CELL);
  assert.eq(fresh[turret.id], 50_000 + phase, 're-armed at the phase');
});

test('turret: several turrets keep independent clocks', () => {
  const foe = goblin('f', 2 * CELL, 2 * CELL);
  const rim = [{ id: 'tw_a', x: 0, y: 0 }, { id: 'tw_b', x: 4 * CELL, y: 0 }, { id: 'tw_c', x: 0, y: 4 * CELL }];
  const clocks = {};
  let total = 0;
  for (let now = 0; now < 60_000; now += 1000 / 60) total += Combat.turretTick(rim, clocks, now, [foe], CELL).length;
  assert.eq(total, 18, 'three turrets, six arrows each over a minute');
  assert.eq(Object.keys(clocks).length, 3, 'one clock per turret');
});

// ── The app.js call site ────────────────────────────────────────────────────
// app.js can't load headlessly, so the glue is pinned as source text.
test('turret: app.js fires the turrets from _combatTick with the SAME enemy list, surface only', () => {
  const app = SCENE_SRC;
  const tick = app.slice(app.indexOf('  _combatTick(dt) {'), app.indexOf('  _turretFire(now, px, py, halfSpanM, enemies, pc) {'));
  assert.truthy(tick.length > 0, '_combatTick precedes _turretFire');
  assert.truthy(/if \(enemies\.length && this\.depth === 0\) \{\s*\n\s*this\._turretFire\(now, px, py, halfSpanM, enemies, pcTick\);/.test(tick),
    'the turrets are fired inside _combatTick, on its own enemies list, on the surface only');
  assert.truthy(/\} else \{\s*\n\s*this\._turretNextT = \{\};/.test(tick),
    'the turret clocks are cleared while no enemy is on screen');
  const fire = app.slice(app.indexOf('  _turretFire(now, px, py, halfSpanM, enemies, pc) {'), app.indexOf('  _drawShots() {'));
  assert.truthy(/if \(o\.kind !== 'tower'\) return;/.test(fire), 'only castle turrets shoot');
  // ONLY A CASTLE YOU HAVE CLAIMED. The same isClaimedKey test the tower's art
  // (render.js 'tower_unclaimed') and its light (lighting.js sourceKind)
  // already read — a castle that draws dead and gives off no light must not be
  // shooting arrows at everything that walks past it, and claiming one is what
  // turns its walls on.
  assert.truthy(/if \(!this\.isClaimedKey\(o\.castle\)\) return;/.test(fire),
    'an unclaimed castle\'s turrets hold their fire');
  assert.truthy(/Math\.abs\(o\.x - px\) > halfSpanM \|\| Math\.abs\(o\.y - py\) > halfSpanM/.test(fire),
    'a turret has to be on screen — the same viewport box the enemies were culled with');
  assert.truthy(/Combat\.turretTick\(scan\.list, this\._turretNextT, now, enemies, this\.cellM\)/.test(fire),
    'the cadence and the aim come from combat.js');
  assert.truthy(/this\._shots\.push\(shot\)/.test(fire), 'turret arrows join the one shot list — same flight, same hit, same bounty');
  // Turret arrows are drawn leaving the battlements and descending to the
  // common chest height — derived from the tower art, not a tuned lift.
  assert.truthy(/shot\.liftFromPx = Render\.towerCrownHeight\(this\.textures, shot\.castle\) - CELL_PX \/ 2 - 4;/.test(fire), 'each arrow starts at its own castle variant crown');
  assert.truthy(/if \(s\.liftFromPx != null\)/.test(app), '_drawShots honours the turret lift');
});
test('ranged weapons: wake only for a foe within the reach plus a cell', () => {
  const reach = 2.5, trig = Combat.rangedTriggerM(reach, CELL);
  assert.eq(Combat.RANGED_TRIGGER_PAST_REACH, 1);
  assert.eq(trig, (reach + 1) * CELL);
  assert.eq(Combat.SHOT.bow.rangeFromReach, Combat.RANGED_TRIGGER_PAST_REACH, 'the arrow\'s range is the same ring');
  assert.eq(Combat.SHOT.staff.rangeFromReach, 0, 'magic stops at the vision range itself');
  assert.truthy(Combat.anyEnemyWithin(0, 0, [goblin('in', trig - 1, 0)], trig), 'inside: armed');
  assert.falsy(Combat.anyEnemyWithin(0, 0, [goblin('out', trig + 1, 0)], trig), 'on screen but beyond: silent');
  assert.truthy(/const rangedArmed = !this\.isShadowActive\(\)\s*\n\s*&& Combat\.anyEnemyWithin\(px, py, enemies, Combat\.rangedTriggerM\(reachCells\(this\), this\.cellM\)\);\s*\n\s*if \(rangedArmed\)/.test(SCENE_SRC),
    'the auto-fire loop is gated on it (and holds its fire under a Shadow Powder)');
});

})();
