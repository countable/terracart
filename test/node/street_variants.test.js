// Street variants (src/street_variants.js) and the bandit roads.
//
// What this file holds still:
//   · THE KEY: a street is a name inside a parish — the same on both sides of
//     a tile seam (its lineKeys differ), different across a parish line, and
//     an unnamed way keys off its own geometry.
//   · THE ROLL: each row dresses ONE size, at its share (a name word nudges).
//   · ROCKS line only the chosen minor streets, never a hedgerow.
//   · DRESSING sits off the band and off anything already there, from
//     position-derived ids, the same set every time.
//   · THE BANDIT ROAD: traps only on major verge / wasteland (traps.test.js
//     pins the predicate; here the whole tile), a bus stop by a major band
//     wears the wagon with its id unchanged and holds ONE goblin in either
//     mode, and the tile's dogs sit on the major verge.
//   · SLOW: tar / stakes cap the body's pace, and the cap lets go.
(function () {
const SV = StreetVariants;
const T = WorldGen.T;
const CPE = 64;
const TILE_EDGE_M = CPE * 7;
const EXTENT = 4096;
const CELL_MVT = EXTENT / CPE;
const cellToMvt = (c) => c * CELL_MVT + CELL_MVT / 2;
const pts = (cells) => cells.map(([cx, cy]) => ({ x: cellToMvt(cx), y: cellToMvt(cy) }));
const wholeTile = () => pts([[0, 0], [CPE - 1, 0], [CPE - 1, CPE - 1], [0, CPE - 1]]);
const TX = 5, TY = 7;

// A name whose street key rolls what we want (searched, so the test does not
// depend on which literal happens to hash where).
function nameWhere(pred, stem) {
  for (let i = 0; i < 5000; i++) {
    const name = `${stem} ${i}`;
    if (pred(name, SV.streetKey(name, TX, TY))) return name;
  }
  throw new Error('no name found for ' + stem);
}
const HEDGE = nameWhere((n, k) => SV.variantFor(k, n, 'minor') === 'hedgerow', 'Hedge Road');
const ROCKY = nameWhere((n, k) => SV.rocksFor(k, 'minor', SV.variantFor(k, n, 'minor'))
  && !SV.variantFor(k, n, 'minor'), 'Rock Road');

// Park ground (no private-yard rule in the way) with: a rock-lined minor
// street along row 12, a hedgerow minor street along row 50 from a junction
// with an unnamed minor street down col 10 to a DEAD END at col 30, a
// motorway down col 44, and two bus stops — one beside the motorway, one far
// from any major way.
function layers() {
  const tr = [
    { type: 2, tags: { class: 'minor' }, geom: [pts([[0, 12], [CPE - 1, 12]])] },
    { type: 2, tags: { class: 'minor' }, geom: [pts([[10, 20], [10, CPE - 1]])] },
    { type: 2, tags: { class: 'minor' }, geom: [pts([[10, 50], [20, 50], [30, 50]])] },
    { type: 2, tags: { class: 'motorway' }, geom: [pts([[44, 0], [44, CPE - 1]])] },
  ];
  const tn = [
    { type: 2, tags: { name: ROCKY }, geom: [pts([[0, 12], [CPE - 1, 12]])] },
    { type: 2, tags: { name: HEDGE }, geom: [pts([[10, 50], [20, 50], [30, 50]])] },
  ];
  return [
    { name: 'landuse', features: [{ type: 3, tags: { class: 'park' }, geom: [wholeTile()] }] },
    { name: 'transportation', extent: EXTENT, features: tr },
    { name: 'transportation_name', extent: EXTENT, features: tn },
    { name: 'poi', features: [
      { type: 1, tags: { class: 'bus', name: 'Stop A' }, geom: [pts([[46, 30]])] },
      { type: 1, tags: { class: 'bus', name: 'Stop B' }, geom: [pts([[20, 30]])] },
    ] },
  ];
}
const rasterize = () => WorldGen.rasterizeTile(layers(), CPE, TX, TY, TILE_EDGE_M);
const cellOf = (v, t) => Math.floor((v - t * TILE_EDGE_M) / (TILE_EDGE_M / CPE));
const occupiedOf = (r) => {
  const occ = new Set();
  for (const o of [...r.objects, ...r.wildplants]) {
    const ix = cellOf(o.x, TX), iy = cellOf(o.y, TY);
    if (ix >= 0 && iy >= 0 && ix < CPE && iy < CPE) occ.add(iy * CPE + ix);
  }
  return occ;
};
const dressed = (r) => {
  const spawnOpts = { roadMask: r.roadMask, occupied: occupiedOf(r), pois: [] };
  const before = new Set(spawnOpts.occupied);
  const d = SV.dress({ index: r.streetIndex, tx: TX, ty: TY, N: CPE, tileEdgeM: TILE_EDGE_M,
    grid: r.grid, spawnOpts });
  return { d, before, spawnOpts };
};

// ── The key ─────────────────────────────────────────────────────────────
test('street key: the same street keys alike across a seam, its lineKeys do not', () => {
  const name = 'Cherry  Lane';
  assert.eq(SV.streetKey(name, 100, 200), SV.streetKey('cherry lane', 101, 200),
    'neighbouring tiles in one parish share the key (case / spaces normalised)');
  assert.eq(SV.variantFor(SV.streetKey(name, 100, 200), name, 'minor'),
    SV.variantFor(SV.streetKey(name, 101, 200), name, 'minor'), 'and so the variant');
  const a = { id: 1, tags: { class: 'minor' }, geom: [[{ x: 4000, y: 10 }, { x: 4200, y: 10 }]] };
  const b = { id: 1, tags: { class: 'minor' }, geom: [[{ x: -96, y: 10 }, { x: 104, y: 10 }]] };
  assert.truthy(Streets.lineKey(a, 0) !== Streets.lineKey(b, 0),
    'the restoration lineKey is tile-local — it could never key a street');
  const P = SV.PARISH_TILES;
  assert.truthy(SV.streetKey(name, P - 1, 0) !== SV.streetKey(name, P, 0),
    'a parish line is the one place a street changes key');
  assert.eq(SV.normName('Straße'), SV.normName('STRASSE'), 'ß folds to ss');
  assert.eq(SV.normName('Café Row'), 'cafe row', 'diacritics strip');
});

test('street key: an unnamed way keys off its own geometry in its own tile', () => {
  const line = pts([[0, 3], [9, 3]]);
  assert.eq(SV.anonKey(1, 2, line), SV.anonKey(1, 2, pts([[0, 3], [9, 3]])), 'deterministic');
  assert.truthy(SV.anonKey(1, 2, line) !== SV.anonKey(2, 2, line), 'and tile-local');
});

// ── The roll ────────────────────────────────────────────────────────────
test('variants: each row dresses ONE size, at its share (±1.5%) over 40k keys', () => {
  const N = 40000;
  for (const size of ['minor', 'major']) {
    const got = {};
    for (let i = 0; i < N; i++) {
      const v = SV.variantFor(`plain street ${i}|0,0`, null, size);
      if (v) got[v] = (got[v] || 0) + 1;
    }
    for (const row of SV.STREET_VARIANTS) {
      const share = (got[row.id] || 0) / N;
      if (row.size !== size) { assert.eq(share, 0, `${row.id} never rolls on a ${size} street`); continue; }
      assert.inRange(share, row.share - 0.015, row.share + 0.015, `${row.id} share on ${size}`);
    }
  }
  assert.eq(SV.variantFor('x|0,0', 'x', null), null, 'a way of neither size is plain');
});

test('variants: a name word nudges its row (the sign foreshadows the street)', () => {
  let plain = 0, cherry = 0;
  for (let i = 0; i < 20000; i++) {
    if (SV.variantFor(`s${i}|0,0`, `Maple ${i}`, 'minor') === 'orchard') plain++;
    if (SV.variantFor(`s${i}|0,0`, `Cherry ${i}`, 'minor') === 'orchard') cherry++;
  }
  assert.gt(cherry, plain * 3, `a cherry street is far likelier an orchard (${cherry} vs ${plain})`);
});

test('variants: sizes follow the terrain tiers — major = ROAD_MD + ROAD_LG, minor = ROAD streets', () => {
  assert.eq(SV.sizeOfTags({ class: 'primary' }), 'major');
  assert.eq(SV.sizeOfTags({ class: 'tertiary' }), 'major');
  assert.eq(SV.sizeOfTags({ class: 'minor' }), 'minor');
  assert.eq(SV.sizeOfTags({ class: 'service' }), null, 'driveways and alleys stay plain');
  assert.eq(SV.sizeOfTags({ class: 'footway' }), null, 'a footpath is neither');
  assert.eq(SV.sizeOfTags({ class: 'rail' }), null, 'a railway is not a street');
});

test('variants: a quarter of minor streets are rock-lined, and never a hedgerow', () => {
  let rocks = 0, hedgeRocks = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const k = `st ${i}|0,0`, v = SV.variantFor(k, null, 'minor');
    if (SV.rocksFor(k, 'minor', v)) { rocks++; if (v === 'hedgerow') hedgeRocks++; }
  }
  assert.eq(hedgeRocks, 0, 'no hedgerow is ever rock-lined');
  assert.inRange(rocks / N, SV.ROCK_STREET_SHARE * 0.9 - 0.02, SV.ROCK_STREET_SHARE + 0.02,
    'about ROCK_STREET_SHARE of the (non-hedgerow) minor streets');
  assert.falsy(SV.rocksFor('st 1|0,0', 'major', null), 'a major road never is');
});

// ── The index and the rocks ─────────────────────────────────────────────
test('index: the fixture\'s streets roll as searched, and the dead end is a close', () => {
  const r = rasterize();
  const byName = (n) => r.streetIndex.lines.find((l) => l.name === n);
  assert.eq(byName(ROCKY).variant, null, 'the rock street is plain');
  assert.truthy(byName(ROCKY).rocks, 'and rock-lined');
  assert.eq(byName(HEDGE).variant, 'hedgerow', 'the hedge street is a hedgerow');
  const major = r.streetIndex.lines.filter((l) => l.size === 'major');
  assert.eq(major.length, 1, 'the motorway is the one major line');
  assert.eq(r.streetIndex.closes.length, 1, 'the hedgerow\'s east end is a dead end in the square');
  const cl = r.streetIndex.closes[0];
  assert.eq(cl.head.x, cellToMvt(30), 'the head is the dead end');
  assert.eq(cl.mouth.x, cellToMvt(10), 'the mouth is the junction');
  assert.eq(cl.rk, `close:${TX * EXTENT + cellToMvt(30)},${TY * EXTENT + cellToMvt(50)}`,
    'keyed on the dead end in GLOBAL MVT units');
});

test('rocks: only along the chosen minor street — none by the hedgerow, none in the park', () => {
  const r = rasterize();
  const rocks = r.objects.filter((o) => o.kind === 'mineralrock');
  assert.gt(rocks.length, 5, 'the rock street is lined');
  for (const o of rocks) {
    assert.truthy(o._street, `${o.id} is a street rock`);
    const iy = cellOf(o.y, TY);
    assert.inRange(iy, 12 - 5, 12 + 5, `${o.id} sits on the rock street's verge, not elsewhere`);
    assert.eq(r.roadMask[iy * CPE + cellOf(o.x, TX)], 0, `${o.id} is off the band`);
  }
});

// ── Dressing ────────────────────────────────────────────────────────────
test('dressing: hedges line the hedgerow, off the band and off anything already there', () => {
  const r = rasterize();
  const { d, before } = dressed(r);
  const hedges = d.wildplants.filter((p) => p.crop === 'hedge');
  assert.gt(hedges.length, 4, 'the hedgerow is hedged');
  const seen = new Set();
  for (const p of [...d.wildplants, ...d.objects]) {
    const ix = cellOf(p.x, TX), iy = cellOf(p.y, TY), i = iy * CPE + ix;
    assert.eq(r.roadMask[i], 0, `${p.id} under the band`);
    assert.falsy(before.has(i), `${p.id} on a cell something already held`);
    assert.falsy(seen.has(i), `${p.id} stacked on another piece`);
    seen.add(i);
    assert.truthy(WorldGen.isSpawnCell(r.grid, CPE, CPE, ix, iy, { roadMask: r.roadMask }),
      `${p.id} passes the shared spawn rule`);
    assert.eq(p.id.split('_').slice(-4).join('_'), `${TX}_${TY}_${ix}_${iy}`, `${p.id} is minted from its cell`);
  }
  assert.eq(wildplantOutput('hedge'), 'wood', 'a hedge is chopped for wood, like a shrub');
  assert.eq(wildplantWorkRelic('hedge'), 'axe');
  assert.eq(wildplantOutput('barricade'), 'wood', 'and a barricade is broken up the same way');
});

test('dressing: the close buries a hoard at its head and holds it with one lair candidate', () => {
  const r = rasterize();
  const { d } = dressed(r);
  assert.eq(d.treasures.length, 1, 'one hoard');
  assert.eq(d.treasures[0].rollBonus, 1, 'worth more than a plain X');
  assert.truthy(/^treasure_close_/.test(d.treasures[0].id), 'id from position');
  assert.eq(d.lairs.length, 1, 'one guard post');
  assert.eq(d.lairs[0].tier, 'close');
  assert.eq(d.lairs[0].sid, r.streetIndex.closes[0].rk, 'keyed on the close');
});

test('dressing: the same tile dresses the same way every time (generated, never stored)', () => {
  const a = dressed(rasterize()).d, b = dressed(rasterize()).d;
  const ids = (x) => [...x.objects, ...x.wildplants, ...x.treasures].map((o) => o.id).join('|');
  assert.eq(ids(b), ids(a), 'same pieces, same ids, same order');
});

// ── The bandit road ─────────────────────────────────────────────────────
test('bandit road: traps on this tile sit only on the major verge — never by a minor street', () => {
  const r = rasterize();
  const occ = occupiedOf(r);
  const traps = Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, TX, TY, TILE_EDGE_M,
    { roadMask: r.roadMask, occupied: occ, pois: [] }, 25);
  assert.gt(traps.length, 0, 'the motorway verge holds traps');
  for (const tp of traps) {
    const i = tp._iy * CPE + tp._ix;
    assert.truthy(r.roadClass[i] & WorldGen.ROAD_CLASS_MAJOR_VERGE, `${tp.id} on the major verge`);
    assert.eq(r.roadMask[i], 0, `${tp.id} not on the band`);
    assert.falsy(occ.has(i), `${tp.id} not under an object`);
  }
});

test('bandit road: a bus stop by a major band wears the wagon — same id; the other stays a chest', () => {
  const r = rasterize();
  const stops = r.objects.filter((o) => o.kind === 'chest' && o.poiClass === 'bus');
  assert.eq(stops.length, 2, 'both stops are chests');
  const idsBefore = stops.map((o) => o.id).join('|');
  const looksBefore = stops.map((o) => chestLook(o).texKey);
  const lairs = SV.markBanditStops(r.objects, r.roadClass, CPE, TX, TY, TILE_EDGE_M);
  assert.eq(stops.map((o) => o.id).join('|'), idsBefore, 'ids untouched');
  const near = stops.find((o) => cellOf(o.x, TX) > 40), far = stops.find((o) => cellOf(o.x, TX) < 40);
  assert.eq(chestLook(near).texKey, 'wagon', 'the motorway stop is a broken wagon');
  assert.truthy(chestLook(near).wagon && !chestLook(near).box, 'and nothing else');
  assert.eq(chestLook(far).texKey, looksBefore[stops.indexOf(far)], 'the park stop keeps its look');
  assert.eq(lairs.length, 1, 'one guard post, the wagon');
  assert.eq(lairs[0].tier, 'wagon');
  assert.eq(lairs[0].sid, WorldGen.cellId('wagon', TX, TY, cellOf(near.x, TX), cellOf(near.y, TY)),
    'its key is its position');
});

test('bandit road: a wagon and a close hold ONE guard each, in either mode', () => {
  assert.eq(Lairs.capFor('wagon', 1), 1, 'a strong wagon is still one goblin');
  assert.eq(Lairs.capFor('close', 1), 1, 'a strong close is still one guard');
  assert.eq(Lairs.KIND_ORDER.wagon.join(), 'goblin', 'a wagon holds a goblin');
  assert.truthy(Lairs.KIND_ORDER.close.every((k) => /^giant_goblin/.test(k)), 'a close holds a giant goblin');
  const r = rasterize();
  const { spawnOpts } = dressed(r);
  const entry = { grid: r.grid, cellsPerEdge: CPE, buildingShapes: [], _spawnOpts: spawnOpts,
    streetLairs: SV.markBanditStops(r.objects, r.roadClass, CPE, TX, TY, TILE_EDGE_M),
    creatures: [] };
  const stop = entry.streetLairs[0];
  const playerM = { x: TX * TILE_EDGE_M + stop.lx, y: TY * TILE_EDGE_M + stop.ly };
  const rep = Lairs.stepResidency([{ entry, tx: TX, ty: TY }], {
    cellM: TILE_EDGE_M / CPE, tileEdgeM: TILE_EDGE_M, playerM, homeM: { x: 0, y: 0 },
    caughtSet: new Set(), buildings: false,
  });
  assert.eq(rep.woken, 1, 'easy (buildings off) still wakes the wagon\'s one guard');
  const g = entry.creatures[0];
  assert.eq(g.kind, 'goblin');
  assert.eq(g.id, `lair_${stop.sid}_0`, 'the guard\'s id is the wagon\'s');
  const gi = cellOf(g.x, TX), gj = cellOf(g.y, TY);
  assert.eq(r.roadMask[gj * CPE + gi], 0, 'seated off the band');
  assert.truthy(Math.max(Math.abs(gi - cellOf(playerM.x, TX)), Math.abs(gj - cellOf(playerM.y, TY))) <= 2,
    'seated beside the wagon');
});

test('bandit road: every dog on a tile with a major verge sits on it, off its own stream', () => {
  const src = SCENE_CREATURES_SRC;
  const a = src.indexOf('\n  _seatDogsOnBanditRoads(');
  const b = src.indexOf('\n  }\n', a);
  assert.truthy(a > 0 && b > a, 'found _seatDogsOnBanditRoads');
  const tries = +src.match(/const DOG_ROAD_TRIES = (\d+);/)[1];
  const m = new Function('DOG_ROAD_TRIES', `return {\n${src.slice(a + 1, b + 4)}\n};`)(tries);
  const r = rasterize();
  const cellM = TILE_EDGE_M / CPE;
  const mk = (i) => WorldGen.makeCreature('dog', TX * TILE_EDGE_M + (5 + i) * cellM, TY * TILE_EDGE_M + 5 * cellM, `dog_${TX}_${TY}_${i}`);
  const cow = WorldGen.makeCreature('cow', TX * TILE_EDGE_M + 3 * cellM, TY * TILE_EDGE_M + 3 * cellM, 'cow_x');
  const creatures = [mk(0), mk(1), cow];
  const cowAt = [cow.x, cow.y];
  const opts = { roadMask: r.roadMask, occupied: occupiedOf(r), pois: [] };
  const scene = Object.assign({ tileEdgeM: TILE_EDGE_M }, m);
  scene._seatDogsOnBanditRoads({ roadClass: r.roadClass }, TX, TY, CPE, cellM, r.grid, opts, creatures);
  for (const d of creatures.filter((c) => c.kind === 'dog')) {
    const i = cellOf(d.y, TY) * CPE + cellOf(d.x, TX);
    assert.truthy(r.roadClass[i] & WorldGen.ROAD_CLASS_MAJOR_VERGE, `${d.id} is on the bandit road's verge`);
    assert.eq(r.roadMask[i], 0, `${d.id} is off the band`);
  }
  assert.eq(`${cow.x},${cow.y}`, cowAt.join(), 'no other fauna moves');
  // No major road: the dogs stay where they were drawn.
  const d0 = mk(0), at = [d0.x, d0.y];
  scene._seatDogsOnBanditRoads({ roadClass: new Uint8Array(CPE * CPE) }, TX, TY, CPE, cellM, r.grid, opts, [d0]);
  assert.eq(`${d0.x},${d0.y}`, at.join(), 'a tile with no bandit road keeps its dogs');
});

// ── Slow going ──────────────────────────────────────────────────────────
test('slow: tar or stakes underfoot cap the body at SLOW_BODY_M_S, and the cap lets go', () => {
  const app = APP_JS_SRC;
  const lift = (sig) => {
    const s = app.indexOf('\n  ' + sig), e = app.indexOf('\n  }\n', s);
    assert.truthy(s > 0 && e > s, `found ${sig}`);
    return app.slice(s + 1, e + 4);
  };
  const num = (n) => parseFloat(app.match(new RegExp(`const ${n} = ([\\d.]+);`))[1]);
  const SLOW = num('SLOW_BODY_M_S');
  assert.truthy(SLOW < num('WALK_M_S'), 'slower than a walk');
  const clock = { t: 0, now() { return this.t; } };
  const M = new Function('WALK_M_S', 'DEBUG_SPEED_MUL', 'FOLLOW_RAMP_M', 'DETOUR_COMMIT_MS',
    'performance', 'steerSpeedMul', 'SLOW_BODY_M_S',
    `return {\n${lift('_followStep(dt, capMS) {')},\n${lift('_bodyHold() {')}\n};`)(
    num('WALK_M_S'), num('DEBUG_SPEED_MUL'), num('FOLLOW_RAMP_M'), num('DETOUR_COMMIT_MS'),
    clock, () => 1, SLOW);
  const body = () => Object.assign({
    cellM: 7, feetOffsetM: 0, startWorldM: { x: 0, y: 0 },
    playerM: { x: 0, y: 0 }, _targetM: { x: 100, y: 0 },
    compassDeg: 0, _followPaused: false, _stickHeading: null,
    _busyWheel: () => null, _stickPushed: () => false, _walkRelics: () => [],
    _playDirected() {}, _startAutoMine() {}, _detourDir: () => null, _cellBlocked: () => false,
  }, M);
  const step = (s, secs) => {
    for (let i = 0; i < secs * 30; i++) {
      clock.t += 1000 / 30;
      const h = s._bodyHold();
      if (!h.pinned) s._followStep(1 / 30, h.capMS);
    }
  };
  const free = body(); step(free, 2);
  const slowed = body(); slowed._slowHere = 'tar'; step(slowed, 2);
  assert.inRange(slowed.playerM.x, SLOW * 2 - 0.1, SLOW * 2 + 0.1, 'on tar the body covers SLOW_BODY_M_S a second');
  assert.gt(free.playerM.x, slowed.playerM.x * 3, 'a free body chasing the same fix is far ahead');
  slowed._slowHere = null;
  const x0 = slowed.playerM.x; step(slowed, 1);
  assert.gt(slowed.playerM.x - x0, SLOW * 3, 'off the patch it catches up on the ordinary ramp');
  // One gate: the pin still wins over the slow.
  const pinned = body(); pinned._slowHere = 'stakes'; pinned._pinnedUntil = clock.t + 5000;
  assert.truthy(pinned._bodyHold().pinned && pinned._bodyHold().capMS == null, 'a pinned body is held, not capped');
  assert.truthy(SV.isSlowKind('tar') && SV.isSlowKind('stakes') && !SV.isSlowKind('waystone'),
    'the slow props are one table');
});

test('slow: the feet cell is read off playerToWorldCell, and the first contact flashes', () => {
  const src = APP_JS_SRC.slice(APP_JS_SRC.indexOf('\n  _tickStreetFeet() {'),
    APP_JS_SRC.indexOf('\n  _bodyHold() {'));
  assert.truthy(/this\.playerToWorldCell\(\)/.test(src), 'the FEET, never the camera anchor');
  assert.truthy(/entry\.slowCells\.get\(i\)/.test(src), 'the dressing\'s slow cells');
  for (const m of src.matchAll(/say\('([^']+)'/g)) {
    assert.truthy(m[1].length <= MAP_MSG_MAX, `"${m[1]}" fits the map`);
  }
  for (const row of [...SV.STREET_VARIANTS, SV.BANDIT_STORY]) {
    assert.truthy(row.flash.length <= MAP_MSG_MAX, `${row.story} flash fits the map`);
    assert.truthy(/^street_/.test(row.story), `${row.story} is a street story stem`);
  }
});
})();
