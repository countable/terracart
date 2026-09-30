// SCENIC PATHS, BEACHES and VIEWPOINTS (src/scenic.js).
//
// What is pinned:
//   · DETECTION: which ways are walking paths (paths vs platforms, corridors,
//     tunnels, private ways, roads); the SIDEWALK FILTER (the safety rule —
//     within SIDEWALK_M of any vehicle way or BUSY_VERGE_M of a MAJOR one is
//     never scenic, whatever the name); the WATERFRONT radius (cells of the
//     tile's own grid, clamped inside the MVT buffer at every latitude); PARK
//     only in a named park or one of PARK_MIN_M2; GREENWAY by name or route.
//   · THE ONE LANE: scenic metres bank extra on the ONE ladder through the
//     shipping sweep (app.js _ripenStreets → _bankStreetMetres → Trail.bank),
//     the km chip reads TRUE metres (Trail.restoredMetres), and the living
//     lamps' re-walk credit is NOT multiplied.
//   · VIEWPOINTS: the scope's story, the relic once per save, the gift once
//     per UTC day; merge of near viewpoints; the grail chest's T4.
//   · BEACHES: the X count follows the shoreline (capped), inland sand keeps
//     the old stream; the tide line is a pure function of (id, UTC day), taken
//     into the day ledger (never save.picked).
//   · SAFETY + SEAMS on the real Kelowna fixtures: no scenic piece on a road
//     cell or off the spawn gate; a point near a seam classifies alike from
//     both tiles; a build is deterministic and pays only its own square.
(function () {
const S = Scenic;
const EXT = 4096;
const TX = 2754, TY = 5566;
const N = WorldGen.cellsPerEdgeForTile(TY);
const gM = (N * WorldGen.CELL_M) / EXT;          // generation metres per unit
const u = (m) => m / gM;                         // metres → units

// A synthetic tile's layers from { layerName: [feature, …] }.
const layersOf = (spec) => Object.entries(spec).map(([name, features]) => ({ name, extent: EXT, features }));
const line = (tags, pts) => ({ type: 2, tags, geom: [pts.map(([x, y]) => ({ x, y }))] });
const rect = (tags, x0, y0, x1, y1) => ({ type: 3, tags,
  geom: [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }]] });
const hline = (tags, y, x0 = 0, x1 = EXT) => line(tags, [[x0, y], [x1, y]]);
const FOOT = { class: 'path', subclass: 'footway' };
// Build a tile's scenic index (geometry kept) and read the kind of the path
// at its midpoint.
const buildOf = (spec, grid) => S.build(Object.fromEntries(layersOf(spec).map((l) => [l.name, l])), TX, TY, N, grid || null, true);
const kindsOf = (sc) => {
  const out = [];
  for (const ivs of sc.lines.values()) for (const iv of ivs) out.push(iv[2]);
  return out;
};
const onlyKind = (sc) => {
  const ks = [...new Set(kindsOf(sc))];
  return ks.length ? ks.join(',') : null;
};

// ── Detection ───────────────────────────────────────────────────────────
test('scenic: walking ways are paths and piers — never platforms, corridors, tunnels, private ways or roads', () => {
  for (const sub of ['footway', 'path', 'cycleway', 'pedestrian', 'steps']) {
    assert.truthy(S.isEligibleWay({ class: 'path', subclass: sub }), sub);
  }
  assert.truthy(S.isEligibleWay({ class: 'pier' }), 'a pier is a boardwalk');
  for (const sub of ['platform', 'corridor', 'platform_access']) {
    assert.falsy(S.isEligibleWay({ class: 'path', subclass: sub }), sub);
  }
  assert.falsy(S.isEligibleWay({ class: 'path', subclass: 'footway', indoor: 1 }), 'indoor');
  assert.falsy(S.isEligibleWay({ class: 'path', subclass: 'footway', brunnel: 'tunnel' }), 'tunnel');
  assert.falsy(S.isEligibleWay({ class: 'path', subclass: 'footway', foot: 'no' }), 'foot=no');
  assert.falsy(S.isEligibleWay({ class: 'path', subclass: 'footway', access: 'private' }), 'access=private');
  for (const c of ['minor', 'service', 'secondary', 'primary', 'track', 'rail']) {
    assert.falsy(S.isEligibleWay({ class: c }), c);
  }
});

test('scenic: a pavement is road — within SIDEWALK_M of a street, or BUSY_VERGE_M of a major road, a path is not scenic', () => {
  // A named park round everything, water beside it: only the road can say no.
  const park = rect({ class: 'park', name: 'Big Park' }, 0, 0, EXT, EXT);
  const lake = rect({ class: 'lake' }, 0, 2600, EXT, 3000);
  const near = buildOf({
    transportation: [hline({ class: 'minor' }, 2000), hline(FOOT, 2000 + u(S.SIDEWALK_M - 2), 500, 3500)],
    park: [park],
  });
  assert.eq(onlyKind(near), null, 'a footway 8 m off a residential street is its pavement');
  const clear = buildOf({
    transportation: [hline({ class: 'minor' }, 2000), hline(FOOT, 2000 + u(S.SIDEWALK_M + 4), 500, 3500)],
    park: [park],
  });
  assert.eq(onlyKind(clear), 'park', '14 m off it, inside the named park, it is a park path');
  // The busy verge beats even the waterfront.
  const busy = buildOf({
    transportation: [hline({ class: 'secondary' }, 2600 - u(S.BUSY_VERGE_M + 12)),
      hline(FOOT, 2600 - u(S.BUSY_VERGE_M - 3), 500, 3500)],
    water: [lake],
  });
  assert.eq(onlyKind(busy), null, 'a lakeside path 12 m off a secondary road is no promenade');
  assert.eq(S.isBusyWay({ class: 'tertiary' }), true, 'the kerb\'s own MAJOR tier (tertiary and up)');
  assert.eq(S.isVehicleWay({ class: 'service', service: 'driveway' }), false, 'a driveway is no street');
  assert.eq(S.isVehicleWay({ class: 'minor', brunnel: 'tunnel' }), false, 'nor a road underground');
});

test('scenic: the waterfront is SCENIC_SHORE_CELLS of the tile\'s own grid from water, inside the MVT buffer at every latitude', () => {
  const lake = rect({ class: 'lake' }, 0, 3000, EXT, 3600);
  const shoreM = S.SCENIC_SHORE_CELLS * EXT / N * gM;
  const by = buildOf({ transportation: [hline(FOOT, 3000 - u(shoreM - 4), 500, 3500)], water: [lake] });
  assert.eq(onlyKind(by), 'shore', `a path ${Math.round(shoreM - 4)} m from the lake is a promenade`);
  const far = buildOf({ transportation: [hline(FOOT, 3000 - u(shoreM + 25), 500, 3500)], water: [lake] });
  assert.eq(onlyKind(far), null, 'further back, with no park, it is a plain path');
  const pool = buildOf({ transportation: [hline(FOOT, 3000 - u(5), 500, 3500)],
    water: [rect({ class: 'swimming_pool' }, 0, 3000, EXT, 3600)] });
  assert.eq(onlyKind(pool), null, 'a swimming pool is no shore');
  const river = buildOf({ transportation: [hline(FOOT, 3000 - u(8), 500, 3500)],
    waterway: [hline({ class: 'river' }, 3000)] });
  assert.eq(onlyKind(river), 'shore', 'a river line is a shore');
  // Every radius a classification reads stays inside the ~64-unit buffer,
  // 30° to 65° N — so a point is classified alike from both sides of a seam.
  for (const lat of [30, 40, 47, 53, 57, 60, 65]) {
    const n = 16384, ty = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
    const Nr = WorldGen.cellsPerEdgeForTile(ty);
    const g = (Nr * WorldGen.CELL_M) / EXT;
    const shoreR = Math.min(S.SHORE_MAX_UNITS, S.SCENIC_SHORE_CELLS * EXT / Nr);
    assert.lte(shoreR, 60, `lat ${lat}: shore radius ${shoreR.toFixed(1)} units`);
    assert.lte(S.BUSY_VERGE_M / g, 64, `lat ${lat}: busy verge ${(S.BUSY_VERGE_M / g).toFixed(1)} units`);
    if (lat <= 55) assert.gte(shoreR * g, S.SCENIC_SHORE_CELLS * WorldGen.CELL_M - 0.01, `lat ${lat}: unclamped`);
  }
});

test('scenic: a park path needs a NAMED park or one of PARK_MIN_M2', () => {
  const side = Math.sqrt(S.PARK_MIN_M2) / gM;            // units on a side of 1 ha
  const path = hline(FOOT, 2000, 1900, 2100);
  const small = buildOf({ transportation: [path],
    landcover: [rect({ class: 'grass', subclass: 'park' }, 2000 - side * 0.35, 2000 - side * 0.35, 2000 + side * 0.35, 2000 + side * 0.35)] });
  assert.eq(onlyKind(small), null, 'an unnamed half-hectare green is not a park');
  const big = buildOf({ transportation: [path],
    landcover: [rect({ class: 'grass', subclass: 'park' }, 2000 - side * 0.8, 2000 - side * 0.8, 2000 + side * 0.8, 2000 + side * 0.8)] });
  assert.eq(onlyKind(big), 'park', 'an unnamed 2.5 ha one is');
  const wood = buildOf({ transportation: [path],
    landcover: [rect({ class: 'wood' }, 2000 - side * 0.8, 2000 - side * 0.8, 2000 + side * 0.8, 2000 + side * 0.8)] });
  assert.eq(onlyKind(wood), 'park', 'and so is a wood that size');
  const named = buildOf({ transportation: [path],
    park: [rect({ class: 'park', name: 'Pocket Park' }, 2000 - side * 0.3, 2000 - side * 0.3, 2000 + side * 0.3, 2000 + side * 0.3)] });
  assert.eq(onlyKind(named), 'park', 'a named pocket park counts whatever its size');
  assert.eq(S.ringsAreaU2([[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]]), 100);
});

test('scenic: greenway grass lines both verges deterministically and respects blocked or occupied cells', () => {
  const pts = [[800, 2000], [3200, 2000]];
  const spec = { transportation: [line(FOOT, pts)],
    transportation_name: [line({ class: 'path', name: 'Test Greenway' }, pts)] };
  const scenic = buildOf(spec);
  const grid = new Uint8Array(N * N).fill(WorldGen.T.GRASS);
  const edge = N * WorldGen.CELL_M;
  const grass = (sc, extra = {}, frame = edge) => S.dress({ scenic: sc, tx: TX, ty: TY, N,
    tileEdgeM: frame, grid, chests: [], spawnOpts: { occupied: new Set(), ...extra } }).wildplants;
  const a = grass(scenic), b = grass(buildOf(spec));
  assert.gt(a.length, 20, 'a visible row on both sides');
  assert.eq(a.map(p => p.id).join(), b.map(p => p.id).join(), 'repeatable cell identities');
  assert.eq(a.map(p => p.id).join(), grass(scenic, {}, edge * 1.3).map(p => p.id).join(), 'independent of drawing metre frame');
  assert.truthy(a.every(p => p.crop === 'longgrass' && p._street === 'greenway'), 'ordinary harvestable grass');
  const centreY = TY * edge + 2000 * edge / EXT;
  assert.truthy(a.some(p => p.y < centreY) && a.some(p => p.y > centreY), 'both verges');
  assert.eq(new Set(a.map(p => p.id)).size, a.length, 'one plant per cell');
  assert.eq(grass(scenic, { occupied: new Set(Array.from({ length: N * N }, (_, i) => i)) }).length, 0, 'occupancy');
  assert.eq(grass(scenic, { spawnWhy: new Uint16Array(N * N).fill(WorldGen.SPAWN_WHY.PRIVATE) }).length, 0, 'hard suppression');
  assert.eq(grass(scenic, { roadMask: new Uint8Array(N * N).fill(1) }).length, 0, 'road mask');
  assert.eq(grass(buildOf({ transportation: spec.transportation })).length, 0, 'ordinary paths do not gain greenway grass');
  assert.eq(grass(buildOf({ ...spec, transportation: [...spec.transportation, hline({ class: 'minor' }, 2000 + u(5))] })).length,
    0, 'the sidewalk safety filter also excludes grass');
});

test('scenic: a GREENWAY is a named or waymarked off-road path — the name alone never upgrades a pavement', () => {
  const pts = [[800, 1500], [3200, 1500]];
  const gw = buildOf({ transportation: [line(FOOT, pts)],
    transportation_name: [line({ class: 'path', name: 'Mission Creek Greenway' }, pts)] });
  assert.eq(onlyKind(gw), 'greenway', 'Mission Creek Greenway');
  const route = buildOf({ transportation: [line(FOOT, pts)],
    transportation_name: [line({ class: 'path', name: 'Trans Canada Trail', route_1_network: 'nwn' }, pts)] });
  assert.eq(onlyKind(route), 'greenway', 'a national walking route');
  const street = buildOf({ transportation: [line(FOOT, pts)],
    transportation_name: [line({ class: 'path', name: 'Ethel Street Protected Bike lane' }, pts)] });
  assert.eq(onlyKind(street), null, 'a bike lane named for its street is not a greenway');
  const beside = buildOf({ transportation: [line(FOOT, pts), hline({ class: 'minor' }, 1500 + u(5))],
    transportation_name: [line({ class: 'path', name: 'Abbott Active Transportation Corridor' }, pts)] });
  assert.eq(onlyKind(beside), null, 'a "corridor" beside a street is its pavement (the safety rule first)');
  assert.truthy(S.GREENWAY_RE.test('Seaside Seawall') && S.GREENWAY_RE.test('Mauerweg') && S.GREENWAY_RE.test('Burke-Gilman Trail'));
});

test('scenic: a line\'s intervals are in MVT arclength UNITS, inside the tile square, merged by kind', () => {
  // A path running from the buffer across a lake's shore and on inland.
  const sc = buildOf({ transportation: [line(FOOT, [[-60, 1000], [4150, 1000]])],
    water: [rect({ class: 'lake' }, 0, 1020, 2000, 1400)] });
  const ivs = [...sc.lines.values()][0];
  assert.truthy(ivs && ivs.length, 'the path has scenic metres');
  for (const iv of ivs) {
    assert.gte(iv[0], 60 - 1e-6, 'nothing before the square (the buffer is the neighbour\'s)');
    assert.lte(iv[1], 60 + 4096 + 1e-6, 'nothing after it');
    assert.eq(iv[2], 'shore');
  }
  assert.eq(ivs.length, 1, 'one merged run');
  assert.inRange(ivs[0][1] - 60, 2000 - 60, 2000 + 60, 'it ends where the lake does (± the shore radius)');
  // The census is generation metres.
  assert.inRange(sc.census.shore, (ivs[0][1] - ivs[0][0]) * gM - S.SAMPLE_M, (ivs[0][1] - ivs[0][0]) * gM + S.SAMPLE_M);
});

// ── The one lane ────────────────────────────────────────────────────────
test('scenic: bonusMetres pays (mul − 1) on the restored metres that ARE scenic, in the reader\'s frame', () => {
  const ivs = [[0, 1000, 'shore'], [2000, 3000, 'park']];
  const m = 0.5;                                         // frame metres per unit
  assert.eq(S.bonusMetres(ivs, [[0, 250]], m), 250 * (S.SCENIC_MUL.shore - 1), 'all shore');
  assert.eq(S.bonusMetres(ivs, [[400, 600]], m), 100 * (S.SCENIC_MUL.shore - 1), 'half of it shore');
  assert.eq(S.bonusMetres(ivs, [[1000, 1500]], m), 500 * (S.SCENIC_MUL.park - 1), 'all park');
  assert.eq(S.bonusMetres(ivs, [[600, 900]], m), 0, 'between the stretches: plain');
  assert.eq(S.bonusMetres(null, [[0, 10]], m), 0);
  assert.eq(S.kindAt(ivs, 1200, m), 'park');
  assert.eq(S.kindOfNewly(ivs, [[400, 1200]], m), 'shore', 'the richest kind touched');
  assert.eq(S.SCENIC_MUL.shore, 2, 'the owner\'s pick: water 2×');
  assert.eq(S.SCENIC_MUL.park, 1.75, 'park 1.75×');
  assert.eq(S.SCENIC_MUL.greenway, 1.75, 'greenway 1.75×');
});

{
  const SW = __trailCounter;
  const NN = 51, CELL_M = 7, TILE_EDGE_M = NN * CELL_M;
  const M_PER_PX = CELL_M * NN / WorldGen.TILE_PX;
  const MID_M = 25.5 * CELL_M;
  const way = { id: 7, type: 2, tags: { class: 'path', subclass: 'footway' },
    geom: [[{ x: 0, y: EXT / 2 }, { x: EXT, y: EXT / 2 }]] };
  const scene = () => Object.assign({
    depth: 0, save: { energy: 10, reachUpgrades: 0 }, cellM: CELL_M, cellsPerTile: NN, mPerPx: M_PER_PX,
    originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, feetOffsetM: 0,
    playerM: { x: MID_M, y: MID_M }, peekM: { x: 0, y: 0 }, gpsM: { x: MID_M, y: MID_M },
    toasts: [], _toast(text, opts) { this.toasts.push({ text, opts }); },
    _drainTrailPrizes() {}, showMessageModal(o) { if (o.onDismiss) o.onDismiss(); },
    _burstAtWorld() { return 1; },
    stories: [], _storySplashOnce(key) {
      const seen = this.save.storySeen = this.save.storySeen || {};
      if (seen[key]) return false; seen[key] = 1; this.stories.push(key); return true;
    },
    flashes: [], flash(t) { this.flashes.push(t); },
    ...SW,
  });
  const withScenic = (ivs, fn) => {
    const key = WorldGen.tileKey(0, 0);
    const entry = { cellsPerEdge: NN, tileEdgeM: TILE_EDGE_M,
      layers: [{ name: 'transportation', extent: EXT, features: [way] }] };
    entry.scenic = ivs ? { lines: new Map([[Streets.lineKey(way, 0), ivs]]) } : null;
    WorldGen.tileCache.set(key, entry);
    const realNow = Date.now;
    let t = 1e12;
    Date.now = () => t;
    try { return fn({ at: (ms) => { t = 1e12 + ms; } }); }
    finally { Date.now = realNow; WorldGen.tileCache.delete(key); }
  };
  const sweep = (s, clock) => { clock.at(0); s._sweepStreets(); clock.at(PATH_STONE_DWELL_MS); s._sweepStreets(); };

  test('scenic: a restore on a scenic way banks the bonus on the ONE ladder; the km chip reads true metres', () => {
    // The player's reach restores metres 161..196 of the way; its first half
    // (0..2048 units = 0..178.5 m) is a promenade.
    let plain = 0;
    withScenic(null, (clock) => { const s = scene(); sweep(s, clock); plain = s.save.trail.metres; });
    assert.inRange(plain, 35 - 0.01, 35 + 0.01, 'a plain path banks what it restored');
    withScenic([[0, EXT / 2, 'shore']], (clock) => {
      const s = scene();
      sweep(s, clock);
      const shoreM = TILE_EDGE_M / 2 - 23 * CELL_M;        // 161 → 178.5 m
      const bonus = shoreM * (S.SCENIC_MUL.shore - 1);
      assert.inRange(s.save.trail.metres, plain + bonus - 0.01, plain + bonus + 0.01,
        'the ladder banked the true metres plus the promenade\'s bonus');
      assert.inRange(s.save.trail.bonusM, bonus - 0.01, bonus + 0.01, 'the bonus is kept apart');
      assert.inRange(Trail.restoredMetres(s.save.trail), plain - 0.01, plain + 0.01,
        'the km chip reads the metres walked, not the ladder\'s');
      assert.eq(s.stories.length, 1, 'the first scenic metre tells the story');
      assert.eq(s.stories[0], 'street_scenic');
      assert.eq(s.toasts[0].text, Trail.progress(s.save.trail.metres, 0).label, 'the counter shows the ladder (the bonus in the prize)');
    });
  });

  test('scenic: the living lamps\' re-walk credit is NOT multiplied — the bonus is the first walk\'s', () => {
    const body = APP_JS_SRC.slice(APP_JS_SRC.indexOf('  _visitStreetLamps(now) {'), APP_JS_SRC.indexOf('  _markLampsRestored(meta, newly, now) {'));
    assert.truthy(/this\._bankStreetMetres\(paid, null, now, \{ quiet: true \}\)/.test(body), 'a lamp visit banks its credit plain');
    assert.falsy(/bonusM|Scenic/.test(body), 'and never asks the scenic table');
  });

  test('scenic: the multiplier rides the sweep, so a passenger and the drift home earn none of it', () => {
    const body = APP_JS_SRC.slice(APP_JS_SRC.indexOf('  _sweepStreets() {'), APP_JS_SRC.indexOf('  _resetStreetSight() {'));
    assert.truthy(/this\._driftingHome \|\| this\.isTooFast\?\.\(\)\) \{ this\._resetStreetSight\(\); return; \}/.test(body),
      'the one sweep refuses a passenger before anything is banked');
    const n = (APP_JS_SRC.match(/Scenic\.bonusMetres\(/g) || []).length;
    assert.eq(n, 1, 'one call site: the ripen pass');
  });
}

// ── Viewpoints ──────────────────────────────────────────────────────────
test('scenic: viewpoints — detection, merge, and the grail\'s tier', () => {
  assert.truthy(S.isViewpoint({ class: 'attraction', subclass: 'viewpoint' }));
  assert.falsy(S.isViewpoint({ class: 'attraction', subclass: 'zoo' }));
  assert.falsy(S.isViewpoint({ class: 'memorial', subclass: 'viewpoint' }), 'a memorial is never a vista');
  const pt = (x, y) => ({ type: 1, tags: { class: 'attraction', subclass: 'viewpoint' }, geom: [[{ x, y }]] });
  const near = u(S.VISTA_MERGE_M - 10), far = u(S.VISTA_MERGE_M + 10);
  const vs = S.collectVistas({ extent: EXT, features: [pt(1000, 1000), pt(1000 + near, 1000), pt(3000, 3000), pt(3000 + far, 3000), pt(-200, 500)] }, TX, TY, N);
  assert.eq(vs.length, 4, 'the one within MERGE_M of an earlier key merges away');
  assert.eq(vs.filter((v) => v.owned).length, 3, 'a point in the buffer is the neighbour\'s');
  assert.eq(chestBaseTier({ poiClass: 'attraction', poiDensity: 30, vista: 'grail' }), S.VISTA_CHEST_TIER.grail, 'the grail is its own tier whatever the count');
  assert.eq(chestTier({ poiClass: 'attraction', vista: 'grail' }), 4, 'T4');
  assert.eq(chestTier({ poiClass: 'vista', vista: 'shore' }), S.VISTA_CHEST_TIER.shore);
  assert.eq(POI_CATEGORY.vista, 'park', 'a stretch chest is a park chest');
});

test('scenic: the grail rolls its OWN pool (chest:vista), not the civic town hall\'s — ~150 value', () => {
  assert.eq(chestThemeFor({ poiClass: 'attraction', vista: 'grail' }), 'vista', 'the grail is chest:vista');
  assert.eq(chestThemeFor({ poiClass: 'vista', vista: 'shore' }), 'park', 'a stretch chest keeps its poiClass theme');
  assert.eq(chestThemeFor({ poiClass: 'attraction' }), 'civic', 'an ordinary attraction (museum, town hall) is unaffected');
  assert.truthy(ChestThemes.themes.vista, 'the theme exists');
  assert.eq(ChestThemes.themes.vista.tier, 4, 'the grail\'s own tier');
  // Monte-Carlo the average value of a T4 chest:vista pull (same shape as the
  // balancing sheet's describe()) and check it sits in the design target
  // 100-160 — well under a civic T4's ~440 (loot.js chestThemeFor's comment).
  const val = (r) => {
    if (!r) return 0;
    if (r.kind === 'gold') return (r.amount || 0) + (r.consolation || 0);
    if (r.kind === 'relic' || r.kind === 'armor') return (gearPrice(r.kind, r.slot, r.tier) || 0) + (r.consolation || 0);
    return (itemValue(r.id) || 0) * (r.qty || 1) + (r.consolation || 0);
  };
  const emptySave = { relics: {}, armor: {}, inv: {} };
  let sum = 0;
  const N = 6000;
  for (let i = 0; i < N; i++) sum += val(pickReward('chest:vista', emptySave, Math.random, { tier: 4, depth: 0 }));
  assert.inRange(sum / N, 90, 175, 'the one-time grail averages ~150 (design target 100-160)');
});

test('scenic: the scope — story once, the relic once per save, the gift once per UTC day', () => {
  const save = { relics: {}, coinBurstClaimed: {}, inv: {} };
  const stories = [], rolls = [], loot = [];
  const scene = makeScene({ save, flashLoot: (t) => loot.push(t),
    _storySplashOnce(key) { stories.push(key); return true; } });
  scene.save = save;
  const realGrant = globalThis.grantTreasureRoll;
  globalThis.grantTreasureRoll = (sc, sv, x, y, mark, ctx) => rolls.push(ctx);
  const realNow = Date.now;
  let t = Date.UTC(2026, 8, 28, 12);
  Date.now = () => t;
  try {
    const a = { kind: 'vista_scope', id: 'scope_1_2_3_4', x: 0, y: 0 };
    const b = { kind: 'vista_scope', id: 'scope_9_9_9_9', x: 0, y: 0 };
    const tap = (o) => runInteractable({ scene, save, sx: 0, sy: 0 }, o);
    tap(a);
    assert.eq(stories[0], S.VISTA_STORY.story, 'the vista tells its story');
    assert.eq(save.vistaRelic, 1, 'the first vista pays the relic');
    assert.eq(save.relics[S.FIRST_VISTA_SLOT].tier, 1, 'a Wood ' + S.FIRST_VISTA_SLOT);
    assert.eq(rolls.length, 1, 'and today\'s gift');
    assert.eq(rolls[0], S.VISTA_CONTEXT);
    assert.falsy(poiLit(a, spentSets(scene, save)), 'the gift taken, the POI light goes out');
    tap(a);
    assert.eq(rolls.length, 1, 'no second gift the same day');
    tap(b);
    assert.eq(rolls.length, 2, 'another scope has its own gift');
    assert.eq(save.relics[S.FIRST_VISTA_SLOT].tier, 1, 'but no second relic');
    t += 24 * 3600 * 1000;
    assert.truthy(poiLit(a, spentSets(scene, save)), 'the next UTC day it glows again');
    tap(a);
    assert.eq(rolls.length, 3, 'and gives again');
    assert.eq(S.firstVistaPrize({ relics: { amulet: { tier: 3 } } }).tier, 4, 'the relic is a tier over what you wear');
    assert.eq(S.firstVistaPrize({ vistaRelic: 1 }), null, 'once per save');
  } finally {
    Date.now = realNow;
    globalThis.grantTreasureRoll = realGrant;
  }
});

test('scenic: a scope is a rest spot on the fire\'s own ring and a light on it — not a ward', () => {
  assert.eq(Lighting.sourceKind({}, { kind: 'vista_scope' }), 'vista');
  assert.eq(Lighting.radiusCells('vista'), Lighting.radiusCells('fire'), 'its light is the rest ring (FIRE_REST_R)');
  assert.truthy(/_nearVista\(wx, wy, cells\) \{/.test(APP_JS_SRC), 'the rest reason');
  const creatures = SCENE_CREATURES_SRC || '';
  assert.falsy(/_nearVista/.test(creatures), 'no foe is turned away by a vista');
});

// ── Beaches ─────────────────────────────────────────────────────────────
test('scenic: the beach\'s X count follows the shoreline, capped; inland sand keeps its own stream', () => {
  assert.eq(S.beachXCount(0), 0);
  assert.eq(S.beachXCount(S.BEACH_X_SHORE_M * 5 + 1), 5, 'one per BEACH_X_SHORE_M');
  assert.eq(S.beachXCount(1e6), S.BEACH_X_MAX, 'capped');
  assert.eq(S.tideCount(S.TIDE_PER_M * 3), 3);
  assert.eq(S.tideCount(1e6), S.TIDE_MAX);
  // The shipping block (__bonusXMarks): a long beach strip, all of it shore.
  const NB = 300, CM = 7;
  const grid = new Uint8Array(NB * NB).fill(WorldGen.T.GRASS);
  const mask = new Uint8Array(NB * NB);
  const cells = [];
  for (let cy = 0; cy < NB; cy++) for (let cx = 0; cx < 3; cx++) {
    grid[cy * NB + cx] = WorldGen.T.SAND; mask[cy * NB + cx] = cx === 0 ? 2 : 1; cells.push(cy * NB + cx);
  }
  const shoreM = NB * CM;                          // 2100 m of waterline
  const entry = { grid, cellsPerEdge: NB, extraTreasures: [], objects: [], roadMask: null,
    scenic: { shore: { mask, cells, waterline: cells.filter((i) => mask[i] === 2), shoreM } } };
  const rng = () => 0.5;
  __bonusXMarks.call({ tileEdgeM: NB * CM, cellM: CM }, entry, 3, 4, NB, rng, {});
  const sand = entry.extraTreasures.filter((x) => /^treasure_sand_/.test(x.id));
  assert.eq(sand.length, S.beachXCount(shoreM), `a ${shoreM} m shore lays ${S.beachXCount(shoreM)} marks — past the old flat cap of 8`);
  // Deterministic: the beach's own stream, the same marks again.
  const again = { ...entry, extraTreasures: [] };
  __bonusXMarks.call({ tileEdgeM: NB * CM, cellM: CM }, again, 3, 4, NB, () => 0.1, {});
  assert.eq(again.extraTreasures.filter((x) => /^treasure_sand_/.test(x.id)).map((x) => x.id).join(),
    sand.map((x) => x.id).join(), 'the tile\'s shared stream does not move them');
});

test('scenic: the tide line is the same for everyone on a UTC day, new the next, and taken into the day ledger', () => {
  const pool = [];
  for (let i = 0; i < 400; i++) pool.push({ kind: 'wildplant', crop: 'shell', id: `tide_1_2_${i}_7`, tide: true, tideP: 0.25 });
  const day1 = '20260928', day2 = '20260929';
  const on1 = pool.filter((w) => S.tideLive(w, day1)).map((w) => `${w.id}:${w.crop}`);
  const copy = pool.map((w) => ({ ...w, _tideDay: undefined }));
  const on1b = copy.filter((w) => S.tideLive(w, day1)).map((w) => `${w.id}:${w.crop}`);
  assert.eq(on1.join(), on1b.join(), 'a pure function of (id, day)');
  assert.inRange(on1.length, 70, 130, `about tideP of the pool (${on1.length}/400)`);
  const on2 = pool.filter((w) => S.tideLive(w, day2)).map((w) => `${w.id}:${w.crop}`);
  assert.truthy(on2.join() !== on1.join(), 'a new tide the next day');
  const crops = new Set();
  for (let d = 0; d < 30; d++) for (const w of pool) if (S.tideLive(w, `202610${String(d + 1).padStart(2, '0')}`)) crops.add(w.crop);
  assert.truthy(crops.has('shell') && crops.has('driftwood') && crops.has('bottle'), 'shells, driftwood and now and then a bottle');
  // Spent: not there today, or taken today — the day ledger, never picked.
  const w = pool.find((p) => S.tideLive(p, day1));
  const save = { picked: [], coinBurstClaimed: {} };
  const sets = (s) => ({ ...spentSets(null, s), day: day1 });
  assert.falsy(isSpent(w, sets(save)), 'on the waterline and not yet taken');
  Macros.markToday(save, w.id, new Date(Date.UTC(2026, 8, 28, 10)));
  const realNow = Date.now;
  Date.now = () => Date.UTC(2026, 8, 28, 11);
  try { assert.truthy(isSpent(w, sets(save)), 'taken today'); } finally { Date.now = realNow; }
  const absent = pool.find((p) => !S.tideLive(p, day1));
  assert.truthy(isSpent(absent, sets({ picked: [], coinBurstClaimed: {} })), 'not on the waterline today');
  assert.eq(wildplantOutput('driftwood'), 'wood', 'driftwood is wood');
  assert.eq(wildplantRoll('bottle'), S.BOTTLE_CONTEXT, 'a bottle rolls');
  for (const note of S.BOTTLE_NOTES) assert.lte(note.length, 80, 'a note is a line: ' + note);
  assert.truthy(CROP_SPRITE.driftwood.frames && CROP_SPRITE.bottle.frames, 'the crops list their frames');
});

test('scenic: a tide pickup taps into the day ledger, never save.picked', () => {
  const src = INTERACT_SRC;
  const at = src.indexOf("{ name: 'wildplant', try: (ctx) => {");
  const body = src.slice(at, src.indexOf("{ name: 'coindrop'", at));
  assert.truthy(/if \(wp\.tide\) \{\s*if \(isSpent\(wp, spentSets\(scene, save\)\)\) return;\s*Macros\.markToday\(save, wp\.id\);/.test(body),
    'a tide pick is written to the day ledger');
  assert.truthy(/\(wp\) => \(wp\.tide \? !isSpent\(wp, tideSets\) : !pickedSet\.has\(wp\.id\)\)/.test(body),
    'and the tap asks the one spent predicate');
});

// ── Safety and seams on the real fixtures ───────────────────────────────
const decode = (key) => MVT.decodeTile(FIXTURE_TILES[key]);
const edgeFor = (ty) => WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(ty));
let _builds = null;
const fixtureBuilds = () => {
  if (_builds) return _builds;
  _builds = {};
  for (const key of ['2753_5565', '2753_5567', '2755_5567', '2754_5567']) {
    const [tx, ty] = key.split('_').map(Number);
    const Nf = WorldGen.cellsPerEdgeForTile(ty);
    _builds[key] = { tx, ty, N: Nf, edge: edgeFor(ty), r: WorldGen.rasterizeTile(decode(key), Nf, tx, ty, edgeFor(ty)) };
  }
  return _builds;
};

test('scenic: on the Kelowna fixtures every scenic piece stands off the road, on the spawn gate, never on another piece', () => {
  let pieces = 0, scopes = 0, grails = 0, tide = 0, chests = 0;
  for (const [key, b] of Object.entries(fixtureBuilds())) {
    const { r, tx, ty, N: Nf, edge } = b;
    const cm = edge / Nf;
    const seen = new Set();
    const d = r.scenicDress;
    for (const p of [...d.objects, ...d.wildplants]) {
      const ix = Math.floor((p.x - tx * edge) / cm), iy = Math.floor((p.y - ty * edge) / cm);
      const i = iy * Nf + ix;
      assert.eq(r.roadMask[i], 0, `${key} ${p.id}: off the drawn road`);
      assert.truthy(WorldGen.isSpawnCell(r.grid, Nf, Nf, ix, iy,
        { roadMask: r.roadMask, spawnWhy: r.spawnWhy, quiet: r.quietMask, roadClass: r.roadClass },
        p._street === 'greenway' ? 'minor' : 'reward'), `${key} ${p.id}: the spawn gate takes its class`);
      assert.falsy(seen.has(i), `${key} ${p.id}: one piece a cell`);
      seen.add(i);
      assert.truthy(p.id.endsWith(`_${tx}_${ty}_${ix}_${iy}`), `${key} ${p.id}: its id is its cell`);
      pieces++;
      if (p.kind === 'vista_scope') scopes++;
      if (p.kind === 'chest') chests++;
      if (p.tide) tide++;
    }
    grails += r.objects.filter((o) => o.vista === 'grail').length;
  }
  assert.gt(scopes, 0, 'a viewpoint stood its scope');
  assert.gte(grails + 0, scopes, 'every scope\'s chest is a grail');
  assert.gt(chests, 0, 'scenic stretches stood their chests');
  assert.gt(tide, 0, 'and a beach laid its tide pool');
  assert.gt(pieces, 0);
});

test('scenic: a point near a seam classifies alike from both tiles; a build is deterministic and pays only its square', () => {
  // Every fixture seam (east and south neighbours both present): a walking
  // path's point within 8 units of the seam, inside tile A's square, is
  // classified by A (its own square) and by B (its buffer) — the radii keep
  // every geometry either reads inside both buffers, so they must agree.
  const byName = (L) => Object.fromEntries(L.map((l) => [l.name, l]));
  const geoCache = new Map();
  const geoOf = (key) => {
    if (!geoCache.has(key)) {
      const [tx, ty] = key.split('_').map(Number);
      geoCache.set(key, S.build(byName(decode(key)), tx, ty, WorldGen.cellsPerEdgeForTile(ty), null, true)._geo);
    }
    return geoCache.get(key);
  };
  let n = 0, same = 0;
  for (const key of Object.keys(FIXTURE_TILES)) {
    const [tx, ty] = key.split('_').map(Number);
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const nb = `${tx + dx}_${ty + dy}`;
      if (!FIXTURE_TILES[nb] || WorldGen.cellsPerEdgeForTile(ty + dy) !== WorldGen.cellsPerEdgeForTile(ty)) continue;
      const ga = geoOf(key), gb = geoOf(nb);
      const tr = decode(key).find((l) => l.name === 'transportation');
      for (const f of tr.features) {
        if (f.type !== 2 || !S.isEligibleWay(f.tags)) continue;
        for (const ln of f.geom) for (let i = 1; i < ln.length; i++) {
          const p = ln[i - 1], q = ln[i];
          const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 2));
          for (let k = 0; k <= steps; k++) {
            const x = p.x + (q.x - p.x) * k / steps, y = p.y + (q.y - p.y) * k / steps;
            if (!(x >= 0 && x < EXT && y >= 0 && y < EXT)) continue;
            if (dx ? x < EXT - 8 : y < EXT - 8) continue;
            n++;
            if (S.classify(ga, x, y, false) === S.classify(gb, x - dx * EXT, y - dy * EXT, false)) same++;
          }
        }
      }
    }
  }
  assert.gt(n, 10, `the seams carry walking paths (${n} points)`);
  assert.eq(same, n, `every seam point (${n}) agrees`);
  const A = decode('2753_5565');
  const tr = A.find((l) => l.name === 'transportation');
  const Nf = WorldGen.cellsPerEdgeForTile(5565);
  // Determinism and the square.
  const again = S.build(byName(A), 2753, 5565, Nf, null);
  const once = S.build(byName(A), 2753, 5565, Nf, null);
  assert.eq(JSON.stringify([...again.lines]), JSON.stringify([...once.lines]), 'the same bytes build the same stretches');
  for (const f of tr.features) {
    if (f.type !== 2 || !S.isEligibleWay(f.tags)) continue;
    for (let li = 0; li < f.geom.length; li++) {
      const ivs = once.lines.get(Streets.lineKey(f, li));
      if (!ivs) continue;
      const spans = Streets.tileSpans(f.geom[li], 1, EXT);
      for (const iv of ivs) {
        assert.truthy(Streets.covers(spans, iv[0] + 1e-6) && Streets.covers(spans, iv[1] - 1e-6), 'inside the square');
      }
    }
  }
  // A stretch's square is tile-aligned: every chest this tile owns lies in it.
  for (const st of once.stretches) {
    const [sx, sy] = st.key.split('|')[0].split(',').map(Number);
    const U = StreetVariants.BANDIT_STRETCH_UNITS;
    assert.truthy(sx * U >= 2753 * EXT && (sx + 1) * U <= 2754 * EXT, 'the stretch\'s square is the tile\'s');
    assert.truthy(sy * U >= 5565 * EXT && (sy + 1) * U <= 5566 * EXT);
  }
});

// ── Copy, look and the Book ─────────────────────────────────────────────
test('scenic: the look rows, their lines and the paintings', () => {
  for (const kind of S.KIND_ORDER) {
    const row = S.rowFor(kind);
    assert.truthy(row, `${kind} wears a row`);
    assert.eq(row.size, 'path', 'the scenic size');
    assert.eq(row.share, 0, 'never rolled');
    assert.eq(StreetVariants.variantFor(`k${kind}|0,0`, 'Promenade', 'path'), null, 'no roll lands on it');
    assert.truthy(StreetVariants.lampGlowFor({ variant: row.id }), 'its lamps glow its colour');
    assert.lte([...row.flash].length, MAP_MSG_MAX, `map line: ${row.flash}`);
    assert.truthy(require_art(row.story), `painting ${row.story}`);
  }
  assert.lte([...S.VISTA_STORY.flash].length, MAP_MSG_MAX);
  assert.truthy(require_art(S.VISTA_STORY.story), 'the vista\'s painting');
  function require_art(stem) { return !!webpDims(`assets/art/${stem}.webp`); }
});

test('scenic: the Book re-derives its numbers', () => {
  const all = PLAY_TIPS.join('\n');
  assert.truthy(all.includes(`${S.SCENIC_MUL.shore}×`), 'the shore multiplier');
  assert.truthy(all.includes(`${S.SCENIC_MUL.park}×`), 'the park / greenway multiplier');
  assert.truthy(all.includes(`every ${S.BEACH_X_SHORE_M}m of shoreline`), 'the beach X rate');
  assert.truthy(/viewpoint's old scope[\s\S]*violet/.test(all) && S.VISTA_CHEST_TIER.grail === 4, 'the grail\'s gem');
  assert.truthy(/midnight UTC/.test(all) && /bottle/.test(all), 'the tide');
  const i = PLAY_TIPS.findIndex((t) => /A path by the water counts/.test(t));
  const j = PLAY_TIPS.findIndex((t) => /Roads and footpaths lie derelict/.test(t));
  assert.gt(i, j, 'taught after the road ladder it multiplies');
});
})();
