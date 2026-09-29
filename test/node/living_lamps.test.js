// LIVING STREET LAMPS — a lit lamp remembers being visited.
//
//   · brightness: Streets.lampBrightness off save.lampVisits[id] — a visit
//     flares it to LAMP_BRIGHT_PEAK, it fades linearly to LAMP_DIM_FLOOR over
//     LAMP_FADE_MS, quantised to LAMP_BRIGHT_STEPS (what the lightmap keys on);
//   · the credit: Streets.lampCredit — the lamp's metres x min(1, since / fade),
//     banked through app.js _bankStreetMetres (the restore sweep's own lane);
//   · walking paths lay lamps at LAMP_PATH_SPACING_M, each worth the street gap;
//   · the save is a DELTA map, pruned at the fade and capped;
//   · the cats sit by walking-path lamps (the `attracts` lane).
//
// The app.js passes are the SHIPPING methods lifted by run.js
// (__trailCounter: the sweep + _visitStreetLamps / _markLampsRestored /
// _bankStreetMetres; __streetLampPasses: _streetLampsForTile).
(function () {
const S = Streets;
const H = 3600 * 1000;
const T0 = 1e12;

test('living lamps: the dim curve — peak on a visit, floor after a day, floor by default', () => {
  assert.eq(S.LAMP_DIM_FLOOR, 0.5, 'dims toward 50% of base');
  assert.eq(S.LAMP_BRIGHT_PEAK, 1.5, 'a visit flares it to 150% of base');
  assert.eq(S.LAMP_FADE_MS, 24 * H, 'over 24 h');
  assert.eq(S.lampBrightness(undefined, T0), 0.5, 'never visited (or pruned) = fully dim');
  assert.eq(S.lampBrightness(T0, T0), 1.5, 'just visited = 150%');
  assert.eq(S.lampBrightness(T0 - 12 * H, T0), 1.0, 'half a day on it is back at base');
  assert.eq(S.lampBrightness(T0 - 24 * H, T0), 0.5, 'a day on, fully dim');
  assert.eq(S.lampBrightness(T0 - 72 * H, T0), 0.5, 'and it stays there');
  let prev = Infinity;
  for (let h = 0; h <= 24; h += 0.25) {
    const b = S.lampBrightness(T0 - h * H, T0);
    assert.truthy(b <= prev + 1e-12, `never brightens as time passes (${h} h)`);
    prev = b;
  }
});

test('living lamps: brightness is QUANTISED to LAMP_BRIGHT_STEPS', () => {
  assert.eq(S.LAMP_BRIGHT_STEPS, 16);
  const seen = new Set();
  for (let m = 0; m <= 24 * 60; m += 7) {
    const b = S.lampBrightness(T0 - m * 60000, T0);
    const k = (b - S.LAMP_DIM_FLOOR) / (S.LAMP_BRIGHT_PEAK - S.LAMP_DIM_FLOOR) * S.LAMP_BRIGHT_STEPS;
    assert.inRange(k - Math.round(k), -1e-9, 1e-9, `step-aligned at ${m} min`);
    seen.add(b);
  }
  assert.eq(seen.size, S.LAMP_BRIGHT_STEPS + 1, 'sixteen steps between floor and peak');
  assert.eq(S.lampBrightness(T0 - 60000, T0), S.lampBrightness(T0, T0), 'a minute does not move it');
});

test('living lamps: the credit — three quarters of spacing x how dim, zero when just visited', () => {
  assert.eq(S.LAMP_CREDIT_SHARE, 0.75, 'a dark lamp pays 75% of its spacing');
  assert.eq(S.lampCredit(100, undefined, T0), 75, 'never visited: three quarters of the spacing');
  assert.eq(S.lampCredit(100, T0 - 24 * H, T0), 75, 'a day dark: the same');
  assert.eq(S.lampCredit(100, T0 - 48 * H, T0), 75, 'and no more than that however long');
  assert.inRange(S.lampCredit(100, T0 - H, T0), 75 / 24 - 1e-9, 75 / 24 + 1e-9, 'an hour: 1/24 of it');
  assert.eq(S.lampCredit(100, T0, T0), 0, 'standing next to it pays nothing');
  assert.eq(S.lampCredit(0, undefined, T0), 0, 'no spacing, no credit');
});

test('living lamps: WALKING PATHS lay lamps at half the spacing, each worth the street gap', () => {
  assert.eq(S.LAMP_PATH_SPACING_M, S.LAMP_SPACING_M / S.LAMP_PATH_SPACING_DIV, 'derived');
  assert.eq(S.LAMP_PATH_SPACING_DIV, 2, 'twice as close (the Book says so)');
  for (const c of ['footway', 'path', 'cycleway', 'pedestrian']) {
    assert.truthy(S.isWalkingPath({ class: c }), `${c} is a walking path`);
    assert.eq(S.lampLayFor({ class: c }).spacingM, S.LAMP_PATH_SPACING_M, `${c}: path spacing`);
  }
  assert.falsy(S.isWalkingPath({ class: 'minor' }), 'a street is not');
  assert.eq(S.lampLayFor({ class: 'minor' }).spacingM, S.LAMP_SPACING_M, 'a street keeps its spacing');
  assert.eq(S.lampLayFor({ class: 'footway' }, 50).spacingM, 50, 'a variant\'s own spacing wins');
  // Straight lines along x, in metres (mvtToM = 1).
  const line = (m) => [{ x: 0, y: 0 }, { x: m, y: 0 }];
  const along = (m, tags) => { const l = S.lampLayFor(tags); return S.lampsAlong(line(m), 1, l.spacingM, l.minLenM); };
  assert.eq(along(180, { class: 'minor' }).length, 2, 'a 180 m street: two lamps');
  assert.eq(along(180, { class: 'footway' }).length, 4, 'a 180 m path: four');
  // The floor stays the street's: a crossing stub stands none.
  assert.eq(S.LAMP_PATH_MIN_LEN_M, S.LAMP_SPACING_M / 2);
  assert.eq(along(30, { class: 'footway' }).length, 0, 'a 30 m footway (a crossing) stands no lamp');
  assert.eq(along(49, { class: 'footway' }).length, 0, 'nor anything under the street floor');
  assert.eq(along(60, { class: 'footway' }).length, 1, 'a 60 m path stands one');
  // Per lamp: a path lamp is worth the gap it halves, so a km of path pays 2 km.
  assert.eq(S.lampCreditM(50, true), 100, 'a path lamp stands in for a street gap');
  assert.eq(S.lampCreditM(100, false), 100, 'a street lamp is its own gap');
  const perKm = (tags, path) => along(1000, tags).length * S.lampCreditM(1000 / along(1000, tags).length, path);
  assert.inRange(perKm({ class: 'minor' }, false), 999, 1001, 'a street pays ~1 km per km a day on');
  assert.inRange(perKm({ class: 'footway' }, true), 1999, 2001, 'a path ~2 km per km');
});

test('living lamps: the save is a pruned, bounded DELTA map', () => {
  const save = {};
  const L = { id: 'lamp_a', spacingM: 100 };
  assert.eq(S.visitLamp(save, L, T0), 100 * S.LAMP_CREDIT_SHARE, 'first visit pays the credit share of the spacing');
  assert.eq(save.lampVisits.lamp_a, T0, 'and stamps the time');
  assert.inRange(S.visitLamp(save, L, T0 + 1000), 75 * 1000 / S.LAMP_FADE_MS - 1e-12, 75 * 1000 / S.LAMP_FADE_MS + 1e-12, 'a second later: almost nothing');
  assert.eq(S.visitLamp(save, { id: 'lamp_b', spacingM: 80 }, T0, false), 0, 'a restore-lit lamp is stamped for nothing');
  assert.eq(save.lampVisits.lamp_b, T0);
  save.lampVisits.old = T0 - 25 * H;
  S.pruneLampVisits(save, T0);
  assert.falsy('old' in save.lampVisits, 'a record past the fade says nothing the absence does not — pruned');
  assert.truthy('lamp_a' in save.lampVisits, 'fresh ones stay');
  const big = { lampVisits: {} };
  for (let i = 0; i < S.LAMP_VISITS_MAX + 50; i++) big.lampVisits['l' + i] = T0 - H + i;
  S.pruneLampVisits(big, T0);
  assert.eq(Object.keys(big.lampVisits).length, S.LAMP_VISITS_MAX, 'capped');
  assert.falsy('l0' in big.lampVisits, 'the oldest go first');
  assert.truthy(('l' + (S.LAMP_VISITS_MAX + 49)) in big.lampVisits, 'the newest stay');
});

test('living lamps: the light carries the brightness as a STEADY gain in frameKey', () => {
  const sc = (bright) => {
    const s = { depth: 0, cellM: 5, save: { energy: 100 }, _lights: [], _streetLamps: [{ x: 1, y: 1, id: 'L', lit: true, bright }] };
    Lighting.collectLamps(s, 0, 0, 1000);
    return s;
  };
  const dim = sc(0.5), base = sc(1), peak = sc(1.5);
  assert.eq(dim._lights[0].g, 0.5, 'a dim lamp is half its row');
  assert.eq(peak._lights[0].g, 1.5, 'a flared one half again');
  assert.eq(base._lights[0].g, undefined, 'base leaves the entry exactly as before');
  assert.eq(peak._lights[0].a, undefined, 'never the animated alpha');
  const key = (s, now) => Lighting.frameKey(s, { x: 0, y: 0 }, 0, 0, Lighting.profile(s), 64, 300, 10, null, null, now);
  assert.truthy(key(dim, 0) !== key(peak, 0), 'a brightness step moves the key');
  assert.eq(key(peak, 0), key(peak, 5000), 'and the clock stays out of it — a still view does not repaint');
  // A step and a minute agree: the app list re-reads the fade each minute, and
  // what it hands over is already quantised.
  const b1 = S.lampBrightness(T0 - 5 * H, T0), b2 = S.lampBrightness(T0 - 5 * H, T0 + S.LAMP_REFRESH_MS);
  assert.eq(key(sc(b1), 0), key(sc(b2), 0), 'a refresh within one step paints nothing new');
  assert.truthy(/let left = clamp01\(a\) \* \(L\.g == null \? 1 : L\.g\);/.test(LIGHTING_SRC),
    'the stamp scales by the gain (and stamps twice past 1 — the lighter composite adds)');
});

// ── The app.js visit pass, RUN ────────────────────────────────────────────
const SW = __trailCounter;
const LP = __streetLampPasses;
const N = 51, CELL_M = 7, TILE_EDGE_M = N * CELL_M, EXTENT = 4096;
const M_PER_PX = CELL_M * N / WorldGen.TILE_PX;
const way = (cls) => ({ id: 9, type: 2, tags: { class: cls },
  geom: [[{ x: 0, y: EXTENT / 2 }, { x: EXTENT, y: EXTENT / 2 }]] });
const mkEntry = (cls) => ({ cellsPerEdge: N, tileEdgeM: TILE_EDGE_M,
  layers: [{ name: 'transportation', extent: EXTENT, features: [way(cls)] }] });
const scene = (over) => Object.assign({
  depth: 0, save: { energy: 10, reachUpgrades: 0 }, cellM: CELL_M, cellsPerTile: N, mPerPx: M_PER_PX,
  originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, feetOffsetM: 0,
  playerM: { x: 0, y: 0 }, peekM: { x: 0, y: 0 }, gpsM: { x: 0, y: 0 },
  toasts: [], _toast(text, opts) { this.toasts.push({ text, opts }); },
  pops: [], _popCellNumber(text, color, ix, iy) { this.pops.push({ text, ix, iy }); },
  _drainTrailPrizes() {}, showMessageModal(o) { if (o.onDismiss) o.onDismiss(); },
  _burstAtWorld() { return 1; },
  ...SW,
  _streetLampsForTile: LP._streetLampsForTile,
}, over || {});
const withTile = (entry, fn) => {
  const key = WorldGen.tileKey(0, 0);
  const had = WorldGen.tileCache.get(key);
  WorldGen.tileCache.set(key, entry);
  const realNow = Date.now;
  let t = T0;
  Date.now = () => t;
  try { return fn({ at: (ms) => { t = T0 + ms; }, key }); }
  finally {
    Date.now = realNow;
    if (had === undefined) WorldGen.tileCache.delete(key); else WorldGen.tileCache.set(key, had);
  }
};
// Stand the feet on lamp L (its verge point), and move them well away.
const standAt = (s, L) => { s.playerM = { x: L.x, y: L.y }; };
const walkAway = (s) => { s.playerM = { x: 5, y: 5 }; };

test('living lamps: a visit to a lit lamp pays its credit onto the ladder, popped on its cell', () => {
  const entry = mkEntry('minor');
  withTile(entry, (clock) => {
    const s = scene();
    const lamps = s._streetLampsForTile(0, 0, entry);
    const L = lamps[1];
    assert.inRange(L.spacingM, 89, 90, 'a 357 m way laid 4 lamps, 89.25 m apart');
    assert.eq(L.creditM, L.spacingM, 'a street lamp is worth its own gap');
    standAt(s, L);
    assert.eq(s._visitStreetLamps(T0), 0, 'a DARK lamp (not restored) is nobody\'s lamp yet');
    Streets.restore(s.save, clock.key, L.lineKey, [[L.s - 5, L.s + 5]]);
    s._lampVisitKey = null;                       // the epoch moved; so does the key
    const paid = s._visitStreetLamps(T0);
    const full = L.creditM * Streets.LAMP_CREDIT_SHARE;
    assert.inRange(paid, full - 1e-6, full + 1e-6, 'never visited: the credit share of the spacing');
    assert.inRange(s.save.trail.metres, paid - 1e-6, paid + 1e-6, 'banked on the one ladder');
    assert.eq(s.pops.length, 1, 'one quiet pop');
    assert.eq(s.pops[0].text, `+${Math.round(paid)}m`, 'a +Nm');
    assert.truthy(s.pops[0].text.length <= MAP_MSG_MAX, 'inside the map budget');
    const c = worldMetersToAbsCell(s, L.x, L.y);
    assert.eq(`${s.pops[0].ix},${s.pops[0].iy}`, `${c.cellIX},${c.cellIY}`, 'on the lamp\'s own cell');
    assert.eq(s.save.lampVisits[L.id], T0, 'the visit is stamped');
    // Standing there: nothing more.
    s._lampVisitKey = null;
    assert.eq(s._visitStreetLamps(T0 + 60000), 0, 'standing by it pays nothing (edge-triggered)');
    // An hour away, back again: 1/24 of it.
    walkAway(s); s._visitStreetLamps(T0 + H);
    standAt(s, L);
    const again = s._visitStreetLamps(T0 + H);
    assert.inRange(again, full / 24 - 1e-6, full / 24 + 1e-6, 'an hour on: 1/24 of it');
    // Just visited: zero.
    walkAway(s); s._visitStreetLamps(T0 + H);
    standAt(s, L);
    assert.eq(s._visitStreetLamps(T0 + H), 0, 'straight back: zero');
  });
});

test('living lamps: no credit, no flare, while the passenger gate holds', () => {
  const entry = mkEntry('minor');
  withTile(entry, (clock) => {
    const s = scene({ isTooFast: () => true });
    const L = s._streetLampsForTile(0, 0, entry)[1];
    Streets.restore(s.save, clock.key, L.lineKey, [[L.s - 5, L.s + 5]]);
    standAt(s, L);
    assert.eq(s._visitStreetLamps(T0), 0, 'a passenger is paid nothing');
    assert.falsy(s.save.lampVisits && s.save.lampVisits[L.id], 'and the lamp is not flared');
    assert.falsy(s.save.trail && s.save.trail.metres, 'the ladder is untouched');
    s.isTooFast = () => false;
    assert.gt(s._visitStreetLamps(T0), 0, 'on foot again, the same lamp pays');
  });
});

test('living lamps: a lamp lit BY the restore starts bright and pays nothing', () => {
  const entry = mkEntry('minor');
  withTile(entry, (clock) => {
    const s = scene();
    const L = s._streetLampsForTile(0, 0, entry)[1];
    s.playerM = { x: L.x, y: TILE_EDGE_M / 2 };   // on the way, the lamp in reach
    clock.at(0); s._sweepStreets();
    clock.at(PATH_STONE_DWELL_MS); s._sweepStreets();
    assert.truthy(Streets.covers(Streets.restoredList(s.save, clock.key, L.lineKey), L.s), 'the sweep lit it');
    assert.eq(s.save.lampVisits[L.id], T0 + PATH_STONE_DWELL_MS, 'stamped as visited by the restore');
    const before = s.save.trail.metres;
    assert.eq(s._visitStreetLamps(T0 + PATH_STONE_DWELL_MS), 0, 'no second payment for the first walk');
    assert.eq(s.save.trail.metres, before);
    assert.eq(Streets.lampBrightness(s.save.lampVisits[L.id], T0 + PATH_STONE_DWELL_MS), 1.5, 'and it burns at the peak');
  });
});

test('living lamps: the frame list carries each lamp\'s brightness', () => {
  const entry = mkEntry('footway');
  withTile(entry, (clock) => {
    const lamps = LP._streetLampsForTile.call({}, 0, 0, entry);
    assert.truthy(lamps.every((L) => L.path), 'a footway\'s lamps are path lamps');
    assert.eq(lamps.length, Math.round(TILE_EDGE_M / Streets.LAMP_PATH_SPACING_M), 'at the path spacing');
    assert.inRange(lamps[0].creditM, 2 * lamps[0].spacingM - 1e-9, 2 * lamps[0].spacingM + 1e-9, 'each worth the street gap');
  });
  const updateSrc = APP_JS_SRC.slice(APP_JS_SRC.indexOf('  _updateStreetLamps() {'), APP_JS_SRC.indexOf('  // THE RIPEN PASS.'));
  assert.truthy(/bright: Streets\.lampBrightness\(Streets\.lampVisitAt\(this\.save, L\.id\), now\)/.test(updateSrc),
    'the one list carries `bright`, read by collectLamps');
});

test('living lamps: cats move beside WALKING-PATH lamps (the attracts lane)', () => {
  assert.eq(Streets.PATH_LAMP_ATTRACTS.cat, 0.5, 'half the tile\'s cats, as the other attractors');
  assert.falsy(StreetVariants.STREET_VARIANTS.some((r) => r.attracts && r.attracts.cat), 'no longer Lantern Row');
  const grid = new Array(N * N).fill(WorldGen.T.GRASS);
  const run = (cls) => {
    const entry = mkEntry(cls);
    const sc = Object.assign(new SceneCreatures(), { tileEdgeM: TILE_EDGE_M, cellM: CELL_M,
      _streetLampsForTile: LP._streetLampsForTile });
    const cats = Array.from({ length: 60 }, (_, i) => ({ id: `cat_${i}`, kind: 'cat', x: -100, y: -100 }));
    const moved = sc._seatFaunaOnFavouriteGround(entry, 0, 0, N, CELL_M, grid,
      { occupied: new Set() }, cats, null, [], new Set());
    return { entry, sc, cats, moved };
  };
  const p = run('footway');
  assert.gt(p.moved.cat || 0, 10, 'about half the cats move');
  assert.lt(p.moved.cat || 0, 50, '…not all of them');
  const lampCells = p.sc._pathLampCells(p.entry, 0, 0, N);
  for (const c of p.cats.filter((c) => c.x >= 0)) {
    assert.truthy(lampCells.has(Math.floor(c.y / CELL_M) * N + Math.floor(c.x / CELL_M)), 'seated beside a path lamp');
  }
  const r = run('minor');
  assert.eq(r.moved.cat || 0, 0, 'a street\'s lamps pull no cats');
  assert.truthy(/creatureSpawnClass\(sp\)/.test(SCENE_CREATURES_SRC), 'seats judged by the species\' own spawn class');
});
})();

test('living lamps: the Book tip quotes the owners\' numbers', () => {
  const tip = PLAY_TIPS.find((t) => /lamps fade over a day/.test(t));
  assert.truthy(tip, 'a tip teaches the fade');
  assert.eq(Streets.LAMP_FADE_MS, 24 * 3600 * 1000, '"over a day"');
  assert.truthy(/twice as close/.test(tip) && Streets.LAMP_PATH_SPACING_DIV === 2, '"twice as close"');
  assert.truthy(/pay as much apiece/.test(tip) && Streets.lampCreditM(50, true) === Streets.LAMP_SPACING_M,
    '"pay as much apiece" — a path lamp is worth a street gap');
  assert.truthy(/three quarters of a lamp's worth/.test(tip) && Streets.LAMP_CREDIT_SHARE === 0.75, '"three quarters"');
});
