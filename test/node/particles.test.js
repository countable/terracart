// Particle bursts (src/particles.js): the preset table, the reduced-motion
// gate, the viewport gate, the emitter config — and the call sites, pinned as
// source text because app.js / interact.js can't load headlessly.
//
// The bursts replaced app.js _starburst (eight tweened ✦ Text objects behind
// a fanfare) and added the two world bursts that had no effect at all: the
// cobble lighting under the player's reach and a crop reaching its next
// stage. The rules the source pins guard are the QC ones: a world burst is
// PROJECTED (worldMetersToScreen), never placed off the player, and the crop
// tick's bursts are gated on the viewport.

(function () {
const app = APP_JS_SRC;
const near = (a, b, eps, m) => { if (Math.abs(a - b) > eps) throw new Error(`${m || 'near'}: ${a} vs ${b}`); };

// Derived, not listed: the completeness / burstCount / emitterConfig checks
// below should cover a preset the moment it is added, without a second copy of
// the table here to keep in step.
const KINDS = Object.keys(Particles.PRESETS);

test('particles: every preset is complete and its ranges are ordered', () => {
  for (const k of KINDS) {
    const p = Particles.PRESETS[k];
    assert.truthy(p, `preset ${k}`);
    assert.gt(p.count, 0, `${k} count`);
    assert.truthy(p.tex && p.tex.shape && p.tex.color && p.tex.size > 0, `${k} tex`);
    for (const key of ['angle', 'speed', 'lifespan', 'scale', 'alpha', 'rotate']) {
      assert.eq(p[key].length, 2, `${k}.${key} is a pair`);
    }
    assert.lte(p.speed[0], p.speed[1], `${k} speed range`);
    assert.lte(p.lifespan[0], p.lifespan[1], `${k} lifespan range`);
    assert.gt(p.lifespan[0], 0, `${k} lives`);
    assert.lte(p.lifespan[1], 1500, `${k} is a burst, not a stream`);
    assert.truthy(Number.isFinite(p.gravityY), `${k} gravityY`);
  }
});

test('particles: the presets are drawn in the UI colour language', () => {
  const P = Particles.PRESETS;
  assert.eq(P.jackpot.tex.color, UI_GOLD, 'jackpot stars are the game gold');
  assert.eq(P.shiny.tex.color, UI_GOLD_PALE, 'shiny stars are the pale gold of its headline');
  assert.eq(P.stone.tex.color, UI_TRAIL_LIT, 'stone chips are the lit-cobble violet');
  assert.eq(P.trailspark.tex.color, UI_TRAIL_LIT, 'and so are the sparks of the blast');
  assert.eq(P.sprout.tex.color, UI_GREEN, 'leaf flecks are the success green');
  assert.eq(P.pain.tex.color, UI_DANGER_INK, 'a hit throws the danger ink');
});

test('particles: the world bursts stay on their cell — stone kicks up, leaves drift up, drops fall back', () => {
  const P = Particles.PRESETS;
  // Phaser angles: 270 is straight up. Every cone is centred there.
  for (const k of ['stone', 'sprout', 'water']) {
    assert.inRange(P[k].angle[0], 180, 270, `${k} cone starts above the horizon`);
    assert.inRange(P[k].angle[1], 270, 360, `${k} cone ends above the horizon`);
  }
  assert.gt(P.stone.gravityY, 0, 'chips fall back down');
  assert.lt(P.sprout.gravityY, 0, 'leaves float up');
  assert.gt(P.water.gravityY, 0, 'drops fall back onto the plant');
  // A throw stays inside a cell: v·t at the longest life and fastest launch,
  // ignoring gravity (which only pulls it back), is under two cells.
  const cell = (typeof CELL_PX === 'number') ? CELL_PX : 32;
  for (const k of ['stone', 'water']) {
    const reach = P[k].speed[1] * P[k].lifespan[1] / 1000;
    assert.lt(reach, cell * 2.5, `${k} does not sprinkle the neighbours`);
  }
  // The water cone is the tightest — a sprinkle onto the cell, not a spray.
  assert.lte(P.water.angle[1] - P.water.angle[0], P.stone.angle[1] - P.stone.angle[0],
    'drops fall in a narrower cone than the chips fly');
});

test('particles: lighting a cobble is a BLAST — a full ring of sparks beside the chips', () => {
  // The chips alone were a small dull puff on a stone that had only changed
  // colour ("a dull lavender", Sep 2026). The spark ring is the flash: thrown
  // every way, weightless, burning out to nothing — and it reaches further
  // than the chips, which stay on their cell, but still only a cell or so.
  const P = Particles.PRESETS, s = P.trailspark;
  assert.eq(s.tex.shape, 'star', 'sparks, not chips');
  assert.eq(s.tex.core, '#ffffff', 'with a white-hot core');
  assert.eq(s.angle[0], 0); assert.eq(s.angle[1], 360, 'a full ring');
  assert.eq(s.gravityY, 0, 'weightless');
  assert.eq(s.scale[1], 0, 'burns out to nothing');
  assert.eq(s.alpha[1], 0, 'and fades out entirely');
  const cell = (typeof CELL_PX === 'number') ? CELL_PX : 32;
  const reach = s.speed[1] * s.lifespan[1] / 1000;
  const chips = P.stone.speed[1] * P.stone.lifespan[1] / 1000;
  assert.gt(reach, chips, 'the ring goes further than the chips');
  assert.lt(reach, cell * 3, 'but stays on the stone\'s own patch');
  assert.gte(P.stone.count + s.count, 20, 'enough of both to read as a burst');
});

test('particles: burstCount is the preset count, zero under reduced motion or for an unknown kind', () => {
  for (const k of KINDS) {
    assert.eq(Particles.burstCount(k, false), Particles.PRESETS[k].count, k);
    assert.eq(Particles.burstCount(k, true), 0, `${k} reduced motion`);
  }
  assert.eq(Particles.burstCount('nope', false), 0);
});

test('particles: emitterConfig never streams and carries every preset range', () => {
  for (const k of KINDS) {
    const c = Particles.emitterConfig(k);
    const p = Particles.PRESETS[k];
    assert.eq(c.emitting, false, `${k} only explodes`);
    assert.eq(c.speed.min, p.speed[0]); assert.eq(c.speed.max, p.speed[1]);
    assert.eq(c.lifespan.min, p.lifespan[0]); assert.eq(c.lifespan.max, p.lifespan[1]);
    assert.eq(c.angle.min, p.angle[0]); assert.eq(c.angle.max, p.angle[1]);
    assert.eq(c.scale.start, p.scale[0]); assert.eq(c.scale.end, p.scale[1]);
    assert.eq(c.alpha.start, p.alpha[0]); assert.eq(c.alpha.end, p.alpha[1]);
    assert.eq(c.gravityY, p.gravityY);
  }
  assert.eq(Particles.emitterConfig('nope'), null);
});

test('particles: onScreen is the viewport square plus the margin', () => {
  const scene = { viewLeft: 100, viewTop: 200, viewSize: 352 };
  assert.truthy(Particles.onScreen(scene, 100, 200), 'top-left corner');
  assert.truthy(Particles.onScreen(scene, 452, 552), 'bottom-right corner');
  assert.falsy(Particles.onScreen(scene, 99, 300), 'a px left of the view');
  assert.falsy(Particles.onScreen(scene, 300, 553), 'a px below the view');
  assert.truthy(Particles.onScreen(scene, 99, 553, 1), 'inside the margin');
  assert.falsy(Particles.onScreen({}, 10, 10), 'no view → no');
  assert.falsy(Particles.onScreen(scene, NaN, 10), 'NaN → no');
});

test('particles: burst is a no-op without a scene that can draw', () => {
  assert.eq(Particles.burst(null, 'jackpot', 0, 0), 0);
  assert.eq(Particles.burst({}, 'jackpot', 0, 0), 0, 'no add/textures/fxContainer');
});

test('particles: burst explodes the preset count through one lazily-made emitter per kind', () => {
  const calls = [];
  const made = [];
  const scene = {
    _reducedMotion: false,
    fxContainer: { add: (em) => made.push(em) },
    textures: { exists: () => true },
    add: { particles: (x, y, key, cfg) => {
      const em = { key, cfg, explode: (n, px, py) => calls.push([key, n, px, py]) };
      return em;
    } },
  };
  assert.eq(Particles.burst(scene, 'stone', 10, 20), Particles.PRESETS.stone.count);
  assert.eq(Particles.burst(scene, 'stone', 30, 40), Particles.PRESETS.stone.count);
  assert.eq(made.length, 1, 'the second burst reused the first emitter');
  assert.eq(made[0].key, Particles.texKey('stone'), 'the emitter draws the baked stone chip');
  assert.eq(calls.length, 2);
  assert.eq(calls[1][2], 30); assert.eq(calls[1][3], 40);
  scene._reducedMotion = true;
  assert.eq(Particles.burst(scene, 'stone', 1, 1), 0, 'reduced motion throws nothing');
  assert.eq(calls.length, 2);
});

// ── Call sites, as source text ────────────────────────────────────────────

test('particles: the fanfares burst through Particles, and the tweened-text burst is gone', () => {
  assert.falsy(/_starburst\(/.test(app), 'app.js no longer defines or calls _starburst');
  assert.truthy(/this\._burstAt\('jackpot', t\.x, t\.y\)/.test(app), 'flashJackpot bursts at its banner');
  assert.truthy(/this\._burstAt\('shiny', banner\.x, banner\.y\)/.test(app), 'flashShiny bursts at its banner');
});

test('particles: a world burst is projected through worldMetersToScreen and gated on the viewport', () => {
  const a = app.indexOf('  _burstAtWorld(kind, wmx, wmy, opts) {');
  assert.truthy(a > 0, 'found _burstAtWorld');
  const body = app.slice(a, app.indexOf('\n  }\n', a));
  assert.truthy(/const p = this\.worldMetersToScreen\(wmx, wmy\);/.test(body),
    'projected, never placed off the player or viewCenterX/Y');
  assert.falsy(/viewCenter[XY]/.test(body), 'no viewCenter in the projection');
  assert.truthy(/Particles\.onScreen\(this, p\.x, p\.y, margin\)/.test(body),
    'gated on the viewport');
  assert.truthy(/const margin = CELL_PX \+ Math\.max\(0, \(opts && opts\.ringPx\) \|\| 0\);/.test(body),
    'with a cell of margin, grown by the ring — a building half off-screen still sparks');
  const c = app.indexOf('  _burstAtCell(kind, ix, iy) {');
  const cbody = app.slice(c, app.indexOf('\n  }\n', c));
  assert.truthy(/absCellCenterMeters\(this, ix, iy\)/.test(cbody), 'a cell burst goes through the cell centre');
  assert.truthy(/this\._burstAtWorld\(kind, c\.x, c\.y\)/.test(cbody), '…and then the world projection');
});

test('particles: every cobble that lights blasts on its own cell', () => {
  const a = app.indexOf('  _sweepCobbleTrails() {');
  const body = app.slice(a, app.indexOf('\n  }\n', a));
  assert.truthy(/if \(!this\._activatePathStone\(tx, ty, s\.ix, s\.iy\)\) continue;\n\s+lit \+= 1;\n[\s\S]{0,600}const bc = absCellCenterMeters\(this, s\.ix, s\.iy\);/.test(body),
    'the blast follows the activation, on the CELL CENTRE of the stone that lit');
  assert.truthy(/this\._blastAt\(bc\.x, bc\.y, \{ radiusCells: BLAST_STONE_R_CELLS, chips: 'stone', sparks: 'trailspark' \}\);/.test(body),
    'one blast per stone: the stone chips and the violet spark ring');
  assert.falsy(/_burstAtCell/.test(body), 'and no second burst beside it');
});

// ── ONE BLAST, TWO SIZES ──────────────────────────────────────────────────

test('particles: a ring throws its particles off the WALLS, and scales the count with it', () => {
  const cell = (typeof CELL_PX === 'number') ? CELL_PX : 32;
  // ringPx 0 is a point — that IS a cobble, and its look is unchanged.
  const at0 = Particles.ringPoints(0, 4);
  assert.eq(at0.length, 4);
  assert.truthy(at0.every((p) => p.x === 0 && p.y === 0), 'no ring, one point');
  // A ring puts every point ON the circle, evenly spaced, none on top of another.
  const pts = Particles.ringPoints(50, 8);
  assert.eq(pts.length, 8);
  for (const p of pts) near(Math.hypot(p.x, p.y), 50, 1e-9, 'on the ring');
  const angles = pts.map((p) => Math.atan2(p.y, p.x));
  const uniq = new Set(angles.map((a) => a.toFixed(6)));
  assert.eq(uniq.size, 8, 'eight distinct directions');
  // Count scaling: the preset's own count at a point, one preset-count per
  // cell of ring radius, capped so a castle can't flood the pool.
  const n = Particles.PRESETS.timber.count;
  assert.eq(Particles.burstCount('timber', false), n, 'a bare call is the preset count');
  assert.eq(Particles.burstCount('timber', false, {}), n, 'and so is an empty opts');
  assert.eq(Particles.burstCount('timber', false, { ringPx: 0 }), n, 'a point ring changes nothing');
  assert.eq(Particles.burstCount('timber', false, { ringPx: cell * 3 }), n * 3, 'three cells, three times as many');
  assert.eq(Particles.burstCount('timber', false, { ringPx: cell * 0.4 }), n, 'never FEWER than the preset');
  assert.eq(Particles.burstCount('timber', false, { count: 4 }), 4, 'an outright override');
  assert.eq(Particles.burstCount('timber', false, { ringPx: cell * 1000 }), Particles.BURST_MAX, 'capped');
  assert.eq(Particles.burstCount('timber', true, { ringPx: cell * 3 }), 0, 'and still nothing under reduced motion');
});

test('particles: a burst in another colour bakes its own texture and its own emitter', () => {
  // Baked, never tinted (setTint is a no-op under the Canvas fallback), so a
  // colour variant is a second texture and a second emitter — and the plain
  // key is untouched, so nothing that never asked for a colour moves.
  assert.eq(Particles.texKey('stone'), 'fx_stone', 'the preset keeps its plain key');
  assert.eq(Particles.texKey('stone', '#ff0000'), 'fx_stone_ff0000');
  const made = [], calls = [], baked = [];
  const have = new Set();
  const scene = {
    fxContainer: { add: (em) => made.push(em) },
    textures: { exists: (k) => have.has(k) },
    make: { graphics: () => ({
      fillStyle() {}, fillCircle() {}, fillPoints() {}, fillRect() {}, fillEllipse() {},
      generateTexture: (k) => { baked.push(k); have.add(k); }, destroy() {},
    }) },
    add: { particles: (x, y, key) => ({ key, explode: (n, px, py) => calls.push([key, n, px, py]) }) },
  };
  Particles.burst(scene, 'timber', 0, 0);
  Particles.burst(scene, 'timber', 0, 0, { colour: '#ff0000' });
  Particles.burst(scene, 'timber', 0, 0, { colour: '#ff0000' });
  assert.eq(baked.join(','), 'fx_timber,fx_timber_ff0000', 'one bake per colour, once');
  assert.eq(made.length, 2, 'and one emitter per colour, reused after');
  assert.eq(calls[0][0], 'fx_timber');
  assert.eq(calls[1][0], 'fx_timber_ff0000');
});

test('particles: a ring burst explodes around the circle, a point burst all at once', () => {
  const calls = [];
  const scene = {
    fxContainer: { add() {} },
    textures: { exists: () => true },
    add: { particles: (x, y, key) => ({ key, explode: (n, px, py) => calls.push([n, px, py]) }) },
  };
  const cell = (typeof CELL_PX === 'number') ? CELL_PX : 32;
  const n = Particles.burstCount('buildspark', false, { ringPx: cell * 2 });
  assert.eq(Particles.burst(scene, 'buildspark', 100, 100, { ringPx: cell * 2 }), n);
  assert.eq(calls.length, n, 'one explode per ring point');
  for (const [c, px, py] of calls) {
    assert.eq(c, 1, 'one particle each');
    near(Math.hypot(px - 100, py - 100), cell * 2, 1e-6, 'off the wall, not the middle');
  }
  calls.length = 0;
  assert.eq(Particles.burst(scene, 'stone', 5, 6), Particles.PRESETS.stone.count);
  assert.eq(calls.length, 1, 'a cobble is still one explode at one point');
  assert.eq(calls[0][1], 5); assert.eq(calls[0][2], 6);
});

test('particles: a restored building throws TIMBER and the restore green', () => {
  const P = Particles.PRESETS;
  assert.eq(P.timber.tex.shape, 'chip', 'debris off a building is chips');
  assert.gt(P.timber.gravityY, 0, 'and it falls, like the stone chips — debris, not a firework');
  assert.inRange(P.timber.angle[0], 180, 270, 'thrown up off the walls');
  assert.inRange(P.timber.angle[1], 270, 360);
  assert.eq(P.buildspark.tex.shape, 'star', 'the sparks are stars');
  assert.eq(P.buildspark.tex.color, UI_GREEN,
    'in UI_GREEN — the colour the Restored! card is already set in');
  assert.eq(P.buildspark.angle[0], 0); assert.eq(P.buildspark.angle[1], 360, 'a full ring');
  assert.eq(P.buildspark.gravityY, 0, 'weightless, like the cobble\'s');
  assert.eq(P.buildspark.scale[1], 0); assert.eq(P.buildspark.alpha[1], 0, 'and burns out to nothing');
  // The road's own pair is UNCHANGED — a stone looks exactly as it did.
  assert.eq(P.stone.tex.color, UI_TRAIL_LIT);
  assert.eq(P.stone.count, 12); assert.eq(P.trailspark.count, 10);
});

test('particles: _blastAt is ONE entry point — the light, the chips and the sparks', () => {
  const a = app.indexOf('  _blastAt(wmx, wmy, opts) {');
  assert.truthy(a > 0, 'found _blastAt');
  const body = app.slice(a, app.indexOf('\n  }\n', a));
  // The LIGHT gets WORLD METRES: the lightmap re-anchors it every frame, so a
  // peek drag leaves the flash on the ground (CLAUDE.md's camera rule).
  assert.truthy(/Lighting\.blast\(this, wmx, wmy, \{/.test(body), 'the flash is fired in world metres');
  assert.falsy(/viewCenter[XY]|worldMetersToScreen/.test(body), 'the light is never projected here');
  // The PARTICLES go through the projection, once each, with the ring.
  assert.truthy(/this\._burstAtWorld\(o\.chips,  wmx, wmy, popts\)/.test(body), 'the chips');
  assert.truthy(/this\._burstAtWorld\(o\.sparks, wmx, wmy, popts\)/.test(body), 'and the sparks');
  assert.truthy(/const popts = \{ ringPx, colour: o\.material \};/.test(body),
    'both off the same ring, in the same material');
  // Headless-safe: no Phaser, no Lighting, no projection and it still returns.
  assert.truthy(/typeof Lighting !== 'undefined' && Lighting\.blast/.test(body), 'no Lighting, no throw');
});

test('particles: a restored wreck blasts at its footprint, before the card opens', () => {
  const a = app.indexOf('  presentWreckRestoreModal(sx, sy, house) {');
  const body = app.slice(a, app.indexOf('\n  }\n\n', a));
  const blast = body.indexOf('this._blastAt(bg.x, bg.y, {');
  assert.truthy(blast > 0, 'the restore fires a blast');
  const frozen = body.indexOf('this.save.restoredHouses[house.id] = restoredRole;');
  const saved = body.indexOf('persistSave(this.save);');
  const card = body.indexOf('this.showChestRewardModal({');
  assert.truthy(frozen > 0 && saved > frozen, 'the role is frozen and banked first');
  assert.truthy(blast > saved, 'the blast goes off once the restore is real');
  assert.truthy(card > blast, 'and BEFORE the card opens over it');
  assert.truthy(/chips: 'timber', sparks: 'buildspark',/.test(body), 'timber off the walls, green sparks');
  assert.truthy(/radiusCells: bg\.radiusCells, ringPx: bg\.ringPx,/.test(body),
    'both sized off the footprint');
  // …and the footprint geometry has a floor: an unknown one is a cell.
  const g = app.indexOf('  _houseBlastGeometry(house) {');
  const gbody = app.slice(g, app.indexOf('\n  }\n', g));
  assert.truthy(/sh\.key !== house\.id/.test(gbody),
    'the footprint is the building shape keyed by the house\'s own id');
  assert.truthy(/Math\.sqrt\(house\.area\) \/ 2/.test(gbody), 'falling back to its polygon area');
  assert.truthy(/halfW = halfH = cellM \/ 2;/.test(gbody), 'and to one cell');
  assert.truthy(/Math\.hypot\(halfW, halfH\) \/ cellM/.test(gbody), 'the radius is the half-diagonal');
  assert.truthy(/BLAST_HOUSE_PAD_CELLS/.test(gbody), 'plus the pad that clears the roof');
});

test('particles: a crop reaching its next stage bursts on every path that grows it', () => {
  // The once-a-second tick asks Crops which plants moved and bursts those.
  const a = app.indexOf('  advanceGrowth() {');
  const body = app.slice(a, app.indexOf('\n  }\n', a));
  assert.truthy(/Crops\.advanceGrowth\(this\.save, Date\.now\(\), advanced\)/.test(body), 'the tick collects the advanced plants');
  assert.truthy(/for \(const p of advanced\) this\._burstAtWorld\('sprout', p\.x, p\.y\);/.test(body), '…and bursts each');
  // The area watering (rainberry) bursts the ones the can jumped.
  const w = app.indexOf('  waterCropsWithin(radius) {');
  const wbody = app.slice(w, app.indexOf('\n  }\n', w));
  assert.truthy(/for \(const p of jumpedPlants\) this\._burstAtWorld\('sprout', p\.x, p\.y\);/.test(wbody));
  // The tap handler: the tap that beats the tick, and the can's jump.
  const inter = INTERACT_JS_SRC;
  assert.truthy(/scene\.flash\(`🌱 \$\{stageReadout\(\)\} — water it`, sx, sy\);\n\s+scene\._burstAtWorld\?\.\('sprout', cwmx, cwmy\);/.test(inter),
    'the tap-advance bursts on the cell');
  assert.truthy(/if \(jumped\) scene\._burstAtWorld\?\.\('sprout', cwmx, cwmy\);/.test(inter),
    'the can jump bursts on the cell');
});

test('particles: watering a crop says so and sprinkles the cell', () => {
  // The tap on a dry plant used to flash only the stage readout — the same
  // line an already-watered plant gives — with no burst, so nothing showed
  // the watering had happened. Now it names the action like till / plant /
  // harvest do, says HOW when there is no can (the only hint one exists), and
  // throws the water burst on the cell, before the jump's sprout burst.
  const inter = INTERACT_JS_SRC;
  const a = inter.indexOf("    if (!p.watered_t) {");
  assert.truthy(a > 0, 'found the watering branch');
  const body = inter.slice(a, inter.indexOf('\n    }\n', a));
  assert.truthy(/const how = can\?\.tier \? 'watered' : 'watered by hand';/.test(body),
    'bare hands are named when there is no can');
  // The no-can line shares the flash with the stage readout and the wait, so
  // the verb phrase stays short — "you water by cupping your hands" overran.
  const m = /const how = can\?\.tier \? 'watered' : '([^']+)';/.exec(body);
  assert.truthy(m && m[1].split(' ').length <= 3, 'the no-can verb phrase is at most three words');
  assert.truthy(/`💧 \$\{how\} — \$\{stageReadout\(\)\}`/.test(body),
    'the flash leads with the verb, then the stage readout');
  assert.truthy(/scene\._burstAtWorld\?\.\('water', cwmx, cwmy\);\n\s+if \(jumped\) scene\._burstAtWorld\?\.\('sprout', cwmx, cwmy\);/.test(body),
    'the water burst lands on the cell, under the jump burst');
  assert.truthy(Particles.PRESETS.water, 'the water preset exists');
  assert.eq(Particles.PRESETS.water.tex.shape, 'drop', 'and it throws drops');
});

test('particles: Crops.advanceGrowth / waterWithin report the plants they moved', () => {
  const HOLD = Crops.STAGE_HOLD_MS;
  const save = { planted: [
    { x: 0, y: 0, crop: 'berry', stage: 0, watered_t: 1000 },
    { x: 5, y: 5, crop: 'berry', stage: 1, watered_t: 0 },
    { x: 9, y: 9, crop: 'berry', stage: 2, watered_t: 1000 },
  ] };
  const advanced = [];
  assert.eq(Crops.advanceGrowth(save, 1000 + HOLD, advanced), true);
  assert.eq(advanced.length, 2, 'the two watered plants moved');
  assert.eq(advanced[0], save.planted[0]); assert.eq(advanced[1], save.planted[2]);
  assert.eq(Crops.advanceGrowth(save, 1000 + HOLD), false, 'the plain call still returns the boolean');
  const jumped = [];
  const s2 = { planted: [{ x: 0, y: 0, crop: 'berry', stage: 0, watered_t: 0 }] };
  const out = Crops.waterWithin(s2, 0, 0, 10, 5000, { can: { tier: Crops.CAN_TOP_TIER } }, () => 0, jumped);
  assert.eq(out.jumped, 1);
  assert.eq(jumped[0], s2.planted[0], 'the jumped plant is reported');
});
})();
