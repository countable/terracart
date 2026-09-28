// PARK CHARACTERS, THE PARK FRINGE and THE ZONE GROUND (Sep 2026).
//
// What is pinned:
//   · PARK CHARACTERS (BiomeProfiles.PARK_CHARACTERS): one table, a pure hash
//     of a GLOBAL point picks the row at its share; a park polygon holding a
//     named-park POI wears THAT POI's character, and so does the grove the POI
//     anchors (src/zones.js); park density on the Kelowna fixtures is ~40%
//     under the old single PARK row.
//   · THE PARK FRINGE (Zones.fringeSteps): a ragged ≤ 20 m band of GROVE
//     (CHURCHYARD round a cemetery) over lot / commercial ground only, the
//     land recorded in `under`; the same band from either side of a seam; a
//     light smattering of the character's filler out to FRINGE_FILL_M.
//   · THE GRAVES: a ghost anchor's headstones are a per-cell rule over its
//     walkable CHURCHYARD cells on the grave-row lattice — they wrap the
//     church building (Kelowna Gospel Fellowship, whose POI sits inside its
//     footprint, kept 2 of a fixed pattern's 8 pieces); every churchyard rock
//     wears the one look.
//   · RESCUE: a blocked pattern piece walks outward along its ray.
//   · SYMMETRIC FIGURES: laid whole about the POI cell, shifted outward
//     together when blocked, or dropped — never lopsided, never by a
//     neighbour tile.
(function () {
const Z = Zones;
const BP = BiomeProfiles;
const T = WorldGen.T;
const EXT = 4096;
function near(a, b, eps, m) { assert.truthy(Math.abs(a - b) <= eps, `${m}: ${a} vs ${b}`); }

// ── Park characters ─────────────────────────────────────────────────────────
test('park characters: one table, picked off a global point at its shares', () => {
  const ids = BP.PARK_CHARACTER_IDS;
  assert.eq(ids.join(), 'meadow,wooded,formal,common');
  near(ids.reduce((t, id) => t + BP.PARK_CHARACTERS[id].share, 0), 1, 1e-9, 'the shares sum to one');
  for (const id of ids) {
    const row = BP.PARK_CHARACTERS[id];
    assert.truthy(row.patch === BP.FLORA_PATCH, `${id} keeps the clumps`);
    assert.includes(['longgrass', 'shrub'], row.filler, `${id}: a filler for its fringe`);
    assert.truthy(row.pad && row.pad.shrub >= 0 && row.pad.longgrass >= 0, `${id}: a POI pad row`);
    assert.eq(BP.flora(T.PARK, id), row.flora, `${id}: flora(T.PARK, id) reads the row`);
  }
  assert.truthy(BP.PARK_CHARACTERS.wooded.trees, 'a wooded park grows trees');
  assert.truthy(BP.PARK_CHARACTERS.formal.hedgeRows, 'a formal park is clipped into hedge rows');
  assert.eq(BP.flora(T.PARK), BP.PARK_CHARACTERS.common.flora, 'no character: the plain lawn');
  const got = {};
  const M = 20000;
  for (let i = 0; i < M; i++) {
    const c = BP.parkCharacterAt(2754 * EXT + (i % 200) * 37, 5566 * EXT + Math.floor(i / 200) * 41);
    got[c] = (got[c] || 0) + 1;
  }
  for (const id of ids) near(got[id] / M, BP.PARK_CHARACTERS[id].share, 0.02, `${id} at its share`);
  assert.eq(BP.parkCharacterAt(100.2, 200.4), BP.parkCharacterAt(100, 200), 'integer MVT points');
  // A wooded park's mushrooms grow on park ground — and ONLY there, not
  // on every lawn a residential spill reaches.
  assert.truthy(BP.allows('mushroom', T.PARK) && BP.allows('mushroom', T.GROVE));
  assert.falsy(BP.allows('mushroom', T.GRASS), 'a plain lawn keeps its old verdict');
});

// A whole-tile synthetic park polygon + optional POIs, on tile (TX, TY).
const TX = 2754, TY = 5566;
const N0 = WorldGen.cellsPerEdgeForTile(TY), EDGE0 = WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(TY));
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];

test('park characters: a named park keeps its character while declarative coverage replaces its old hedge rows', () => {
  // Find a compact rectangle whose centroid is not formal, then place a
  // formal park POI inside it. The baseline proves the POI changes the park.
  const HALF = 600;
  let scenario = null;
  for (let cy = HALF; cy <= EXT - HALF && !scenario; cy += 73) {
    for (let cx = HALF; cx <= EXT - HALF && !scenario; cx += 71) {
      if (BP.parkCharacterAt(TX * EXT + cx, TY * EXT + cy) === 'formal') continue;
      for (let y = cy - HALF + 40; y < cy + HALF - 40 && !scenario; y += 29) {
        for (let x = cx - HALF + 40; x < cx + HALF - 40; x += 37) {
          if (BP.parkCharacterAt(TX * EXT + x, TY * EXT + y) !== 'formal') continue;
          scenario = { cx, cy, poi: { x, y } };
          break;
        }
      }
    }
  }
  assert.truthy(scenario, 'the fixture contains a non-formal park with a formal POI cell');
  const { cx, cy, poi } = scenario;
  const ring = rect(cx - HALF, cy - HALF, cx + HALF, cy + HALF);
  assert.falsy(BP.parkCharacterAt(TX * EXT + cx, TY * EXT + cy) === 'formal',
    'the no-POI park keeps its non-formal centroid character');
  const build = (withPoi) => WorldGen.rasterizeTile([
    { name: 'landcover', features: [{ type: 3, tags: { class: 'grass', subclass: 'park' }, geom: [ring] }] },
    { name: 'poi', features: withPoi ? [{ type: 1, tags: { class: 'park', subclass: 'park', name: 'Test Park' }, geom: [[poi]] }] : [] },
  ], N0, TX, TY, EDGE0);
  const hedges = (r) => r.wildplants.filter((w) => /^hr_/.test(w.id)).length;
  let legacy;
  const coverage = globalThis.ZoneCoverage;
  try {
    globalThis.ZoneCoverage = undefined;
    legacy = build(true);
  } finally { globalThis.ZoneCoverage = coverage; }
  const on = build(true);
  assert.gt(hedges(legacy), 20, 'the legacy formal character generated hedge rows');
  assert.eq(hedges(on), 0, 'the declared variant replaces those rows throughout its park');
  assert.gt(on.zoneDress.wildplants.length + on.zoneDress.objects.length, 0, 'the replacement has interactables');
  assert.eq(hedges(build(false)), 0, 'without it the park keeps its own character');
  // Every hedge on the row lattice.
  for (const w of legacy.wildplants.filter((x) => /^hr_/.test(x.id))) {
    const iy = +w.id.split('_')[4];
    assert.eq((TY * N0 + iy) % BP.PARK_CHARACTERS.formal.hedgeRows.period, 0, `${w.id} on a hedge row`);
  }
  const a = on.zone.reach.find((x) => x.kind === 'grove');
  assert.truthy(a, 'the grove');
  assert.eq(a.character, 'formal', 'the grove reads the same character');
  assert.truthy(Z.GROVE_ASPECTS.formal.some(([asp]) => asp === a.aspect), `a formal aspect (${a.aspect})`);
});

test('park density: covered parks replace ambience and unrelated park ground keeps it', () => {
  // MEASURED before the characters (rasterize + zone dressing, the nine
  // Kelowna fixtures): 1797 of 10277 park cells held something — 0.1749.
  const BEFORE = 0.1749;
  let park = 0, held = 0, outsideHeld = 0;
  for (const key of Object.keys(FIXTURE_TILES).sort()) {
    const [tx, ty] = key.split('_').map(Number);
    const N = WorldGen.cellsPerEdgeForTile(ty), edge = WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(ty));
    const r = WorldGen.rasterizeTile(MVT.decodeTile(FIXTURE_TILES[key]), N, tx, ty, edge);
    const occ = new Set();
    const zd = r.zoneDress || { objects: [], wildplants: [] };
    for (const o of [...r.objects, ...r.wildplants]) {
      occ.add(Math.floor((o.y - ty * edge) / (edge / N)) * N + Math.floor((o.x - tx * edge) / (edge / N)));
    }
    for (let i = 0; i < N * N; i++) if ((r.zone?.under?.[i] || r.grid[i]) === T.PARK) {
      park++;
      if (occ.has(i)) { held++; if (!r.zone?.coverage?.[i]) outsideHeld++; }
    }
    for (const o of [...r.objects, ...r.wildplants].filter(o => /^(wp|hr|ptree)_/.test(o.id))) {
      const i = Math.floor((o.y - ty * edge) / (edge / N)) * N + Math.floor((o.x - tx * edge) / (edge / N));
      assert.falsy(r.zone?.coverage?.[i], `${o.id}: no old ambience under a declared pattern`);
    }
  }
  assert.gt(park, 5000, 'the fixtures have parks');
  const now = held / park;
  assert.lte(now, BEFORE * 0.62, `park occupancy ${now.toFixed(4)} vs ${BEFORE} before`);
  assert.gt(outsideHeld, 0, 'uncovered parks retain their ambient decoration');
});

// ── The park fringe ─────────────────────────────────────────────────────────
// A residential tile with one park rectangle (cells ~[PX0, PX1)), no roads.
function fringeTile(tx, ty, parkRing, cls) {
  const N = WorldGen.cellsPerEdgeForTile(ty), edge = WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(ty));
  const tags = cls === 'cemetery' ? { class: 'cemetery' } : { class: 'grass', subclass: 'park' };
  const layers = [
    { name: 'landcover', features: parkRing ? [{ type: 3, tags, geom: [parkRing] }] : [] },
    { name: 'landuse', features: [{ type: 3, tags: { class: 'residential' }, geom: [rect(-64, -64, 4160, 4160)] }] },
  ];
  if (cls === 'cemetery') {
    layers[0].features = [];
    layers.push({ name: 'park', features: [] });
    layers[1].features.push({ type: 3, tags, geom: [parkRing] });
  }
  return { r: WorldGen.rasterizeTile(layers, N, tx, ty, edge), N, edge };
}
// Exact generation metres from cell (ix, iy)'s centre to an MVT rectangle.
function distToRect(N, ix, iy, x0, y0, x1, y1) {
  const u = EXT / N, gM = N * WorldGen.CELL_M / EXT;
  const cx = (ix + 0.5) * u, cy = (iy + 0.5) * u;
  const dx = Math.max(x0 - cx, 0, cx - x1), dy = Math.max(y0 - cy, 0, cy - y1);
  return Math.hypot(dx, dy) * gM;
}

test('park fringe: a ragged band ≤ 20 m of GROVE over lot ground, the land kept in `under`', () => {
  const [x0, y0, x1, y1] = [1500, 1500, 2500, 2300];
  const { r, N } = fringeTile(TX, TY, rect(x0, y0, x1, y1), 'park');
  const CELL = WorldGen.CELL_M;
  const hi = Z.FRINGE_M * (1 + Z.FRINGE_JITTER), lo = Z.FRINGE_M * (1 - Z.FRINGE_JITTER);
  assert.lte(hi, 20.0001, 'the band never reaches past 20 m (the ~23 m landcover buffer)');
  let band = 0, inner = 0, innerPainted = 0;
  for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
    const i = iy * N + ix;
    if (r.grid[i] === T.PARK) continue;
    const d = distToRect(N, ix, iy, x0, y0, x1, y1);
    if (r.grid[i] === T.GROVE) {
      band++;
      assert.lte(d, hi + CELL, `cell ${ix},${iy} painted at ${d.toFixed(1)} m`);
      assert.eq(r.zone.under[i], T.RESIDENTIAL, 'the land it painted over');
    } else {
      assert.eq(r.grid[i], T.RESIDENTIAL, 'nothing else changes');
    }
    if (d > 0 && d <= lo - CELL) { inner++; if (r.grid[i] === T.GROVE) innerPainted++; }
  }
  assert.gt(band, 40, `the band painted (${band} cells)`);
  assert.eq(innerPainted, inner, 'everything well inside the band is painted');
  assert.falsy(Z.at({ zone: r.zone, cellsPerEdge: N }, Math.floor(1450 * N / EXT), Math.floor(2000 * N / EXT)),
    'the fringe is ground, not a zone');
  // A cemetery's fringe is churchyard.
  const c = fringeTile(TX, TY, rect(x0, y0, x1, y1), 'cemetery');
  let yard = 0;
  for (let i = 0; i < N * N; i++) if (c.r.grid[i] === T.CHURCHYARD) yard++;
  assert.gt(yard, 40, 'a cemetery spills churchyard');
});

test('park fringe: the smattering — the character\'s filler, on the spawn rule, out to FRINGE_FILL_M', () => {
  const [x0, y0, x1, y1] = [1200, 1200, 2800, 2800];
  const { r, N, edge } = fringeTile(TX, TY, rect(x0, y0, x1, y1), 'park');
  const ch = BP.parkCharacterAt(TX * EXT + 2000, TY * EXT + 2000);
  const fill = r.zoneDress.wildplants.filter((w) => w.fringe);
  assert.gt(fill.length, 3, `a few (${fill.length})`);
  let ring = 0;
  for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
    const d = distToRect(N, ix, iy, x0, y0, x1, y1);
    if (d > 0 && d <= Z.FRINGE_FILL_M) ring++;
  }
  assert.lt(fill.length / ring, Z.FRINGE_FILL_P, 'a LIGHT smattering');
  for (const w of fill) {
    const ix = Math.floor((w.x - TX * edge) / (edge / N)), iy = Math.floor((w.y - TY * edge) / (edge / N));
    const d = distToRect(N, ix, iy, x0, y0, x1, y1);
    assert.gt(d, 0, `${w.id} outside the park`);
    assert.lte(d, Z.FRINGE_FILL_M + WorldGen.CELL_M, `${w.id} within reach (${d.toFixed(1)} m)`);
    assert.eq(w.crop, BP.PARK_CHARACTERS[ch].filler, `${w.id}: the ${ch} park's filler`);
    assert.eq(r.roadMask[iy * N + ix], 0, 'off the road');
    assert.truthy(/^wpf_/.test(w.id), 'a tile + cell id');
  }
});

test('park fringe: the same band from either side of a seam (the park in the neighbour\'s buffer)', () => {
  // A park in tile TX whose east edge stops 5 units short of the seam; tile
  // TX+1 sees it in its landcover buffer, clipped at −64.
  const east = TX + 1;
  const clipped = fringeTile(east, TY, rect(-64, 1500, -5, 2600), 'park');
  const whole = fringeTile(east, TY, rect(-2400, 1500, -5, 2600), 'park');
  const N = clipped.N;
  let painted = 0;
  for (let i = 0; i < N * N; i++) {
    assert.eq(clipped.r.grid[i], whole.r.grid[i], `cell ${i % N},${(i / N) | 0}: the clip changes nothing`);
    if (clipped.r.grid[i] === T.GROVE) painted++;
  }
  assert.gt(painted, 10, `the neighbour paints its side of the band (${painted})`);
  // …and the ragged edge is one plane: no step at the seam.
  const gx = east * EXT, gy = TY * EXT + 2000;
  near(Z.fringeReach(gx - 0.01, gy), Z.fringeReach(gx + 0.01, gy), 1e-3, 'continuous across the seam');
});

// ── The graves and the churchyard rocks ─────────────────────────────────────
test('churchyards: the selected variant dresses the Gospel Fellowship coverage beyond its POI', () => {
  const tx = 2754, ty = 5567;
  const N = WorldGen.cellsPerEdgeForTile(ty), edge = WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(ty));
  const build = () => WorldGen.rasterizeTile(MVT.decodeTile(FIXTURE_TILES[`${tx}_${ty}`]), N, tx, ty, edge);
  const r = build(), f = r.zone, d = r.zoneDress;
  const cellOf = o => Math.floor((o.y - ty * edge) / (edge / N)) * N + Math.floor((o.x - tx * edge) / (edge / N));
  const gospel = f.anchors.findIndex(a => a.lx === 1747 && a.ly === 655);
  assert.gte(gospel, 0);
  assert.truthy(ZoneVariants.byId(f.anchors[gospel].variant));
  const mine = [...d.objects, ...d.wildplants].filter(o => f.coverage[cellOf(o)] === gospel + 1);
  assert.gt(mine.filter(o => o.zoneLayer === 'background').length, 6, 'recognizable background beyond the old six POI pieces');
  for (const o of mine) {
    const i = cellOf(o), cls = o.kind === 'headstone' ? 'headstone' : 'minor';
    assert.truthy(WorldGen.isSpawnCell(r.grid, N, N, i % N, Math.floor(i / N), { roadMask: r.roadMask, spawnWhy: r.spawnWhy }, cls));
    assert.eq(o.zoneVariant, f.anchors[gospel].variant);
    if (o.kind === 'mineralrock' && (o.yieldTier || 1) === 1) {
      assert.eq(o.rockVariant, SpriteLayout.CHURCHYARD_ROCK_VARIANT);
      assert.eq(SpriteLayout.plainRockStones(o), 1);
    }
  }
  assert.eq(JSON.stringify(build().zoneDress.objects), JSON.stringify(d.objects), 'rebuild keeps geometry and identities');
});

// ── Rescue and symmetric figures (synthetic all-park tiles) ─────────────────
const GROVE_TAGS = { class: 'park', subclass: 'park' };
function groveDress(gx, gy, tx, ty, block) {
  const N = WorldGen.cellsPerEdgeForTile(ty), edge = WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(ty));
  const poi = { name: 'poi', features: [{ type: 1, geom: [[{ x: gx - tx * EXT, y: gy - ty * EXT }]], tags: GROVE_TAGS }] };
  const fld = Z.field(poi, tx, ty, N);
  const grid = new Uint8Array(N * N).fill(T.PARK);
  const a = fld && fld.reach.find((x) => x.gx === gx && x.gy === gy);
  const c = a ? Z.nexusCentre(a, ty, N) : null;
  if (block && c) for (const [dx, dy] of block) {
    const cell = Z.nexusPieceCell(c, dx, dy, tx, ty, N);
    if (cell) grid[cell.iy * N + cell.ix] = T.BUILDING;
  }
  const res = fld ? Z.dress({ field: fld, tx, ty, N, tileEdgeM: edge, grid, chests: [],
    spawnOpts: { roadMask: new Uint8Array(N * N), occupied: new Set() } }) : null;
  const offsets = (res ? [...res.objects, ...res.wildplants] : []).filter((p) => p.zone === 'grove').map((p) => {
    const ix = Math.floor((p.x - tx * edge) / (edge / N)), iy = Math.floor((p.y - ty * edge) / (edge / N));
    return { p, dx: ix - c.ax0, dy: iy - c.ay0 };
  });
  return { a, res, offsets, N };
}
function groveAt(aspect, base, step) {
  for (let k = 0; k < 20000; k++) {
    const gx = base[0] + step[0] * k, gy = base[1] + step[1] * k;
    const r = Z.resolveAnchors(Z.collectAnchors({ features: [{ type: 1, geom: [[{ x: gx - TX * EXT, y: gy - TY * EXT }]], tags: GROVE_TAGS }] }, TX, TY));
    if (r.length && r[0].aspect === aspect) return [gx, gy];
  }
  throw new Error('no ' + aspect);
}

test('rescue: a blocked pattern piece walks outward along its ray', () => {
  const [gx, gy] = groveAt('tree_ring', [TX * EXT + 1900, TY * EXT + 1900], [3, 5]);
  const free = groveDress(gx, gy, TX, TY);
  const trees = free.offsets.filter((o) => o.p.kind === 'tree');
  assert.gt(trees.length, 4, 'the ring laid');
  const t0 = trees[0];
  const blocked = groveDress(gx, gy, TX, TY, [[t0.dx, t0.dy]]);
  const moved = blocked.offsets.filter((o) => o.p.kind === 'tree');
  assert.eq(moved.length, trees.length, 'no tree lost to the block');
  const out = moved.find((o) => !trees.some((t) => t.dx === o.dx && t.dy === o.dy));
  assert.truthy(out, 'one tree moved');
  const r0 = Math.hypot(t0.dx, t0.dy), r1 = Math.hypot(out.dx, out.dy);
  assert.gt(r1, r0, 'outward');
  assert.lte(r1 - r0, Z.RESCUE_CELLS + 1, 'at most RESCUE_CELLS on');
  near(Math.atan2(out.dy, out.dx), Math.atan2(t0.dy, t0.dx), 0.35, 'along its own ray');
});

test('symmetric figures: compass roses laid whole about the POI, shifted together, or dropped', () => {
  const [gx, gy] = groveAt('compass_roses', [TX * EXT + 1800, TY * EXT + 2100], [7, 3]);
  const key = (o) => `${o.dx},${o.dy}`;
  const free = groveDress(gx, gy, TX, TY);
  const roses = free.offsets.filter((o) => o.p.crop === 'wildrose').map(key).sort();
  assert.eq(roses.join(' '), ['0,-2', '0,2', '-2,0', '2,0'].sort().join(' '), 'one rose at each cardinal point');
  // The north cell blocked: all four move out ONE step together.
  const shifted = groveDress(gx, gy, TX, TY, [[0, -2]]).offsets.filter((o) => o.p.crop === 'wildrose').map(key).sort();
  assert.eq(shifted.join(' '), ['0,-3', '0,3', '-3,0', '3,0'].sort().join(' '), 'the figure stays symmetric');
  // The whole north ray blocked: the figure is dropped, never lopsided.
  const ray = []; for (let k = 2; k <= 2 + Z.RESCUE_CELLS; k++) ray.push([0, -k]);
  const dropped = groveDress(gx, gy, TX, TY, ray).offsets.filter((o) => o.p.crop === 'wildrose');
  assert.eq(dropped.length, 0, 'dropped whole');
  // Every aspect's figure is mirror-symmetric in its offsets.
  for (const asp of Z.SYMMETRIC_ASPECTS) {
    const P = Z.patternPieces(asp);
    const set = new Set(P.map((p) => `${p.what}:${p.dx},${p.dy}`));
    for (const p of P) assert.truthy(set.has(`${p.what}:${-p.dx},${p.dy}`), `${asp}: mirrored left-right`);
    for (let k = 1; k <= Z.RESCUE_CELLS; k++) {
      const moved = new Set(P.map((p) => `${p.what}:${Z.rayStep(p.dx, p.dy, k).join()}`));
      for (const p of P) {
        const [x, y] = Z.rayStep(p.dx, p.dy, k);
        assert.truthy(moved.has(`${p.what}:${-x},${y}`), `${asp} step ${k}: still mirrored`);
      }
    }
  }
});

test('symmetric figures: the anchor\'s own tile lays them; a figure that crosses a seam is nobody\'s', () => {
  const N = N0, seamX = (TX + 1) * EXT, cellU = EXT / N;
  const [gx, gy] = groveAt('compass_roses', [seamX - Math.round(1.5 * cellU), TY * EXT + 1500], [0, 7]);
  const own = groveDress(gx, gy, TX, TY), nb = groveDress(gx, gy, TX + 1, TY);
  assert.eq(own.offsets.filter((o) => o.p.crop === 'wildrose').length, 0, 'the owner cannot lay it whole');
  assert.eq((nb.res ? nb.res.wildplants : []).filter((w) => w.crop === 'wildrose').length, 0, 'the neighbour never lays half');
});

test('grove aspects: weighted so roses stay the rarer prize; compass roses ~1 named park in 6-7', () => {
  const got = {};
  let n = 0;
  for (let k = 0; k < 6000; k++) {
    const gx = TX * EXT + 100 + (k * 53) % 3900, gy = TY * EXT + 100 + Math.floor(k / 70) * 43;
    const r = Z.resolveAnchors(Z.collectAnchors({ features: [{ type: 1, geom: [[{ x: gx - TX * EXT, y: gy - TY * EXT }]], tags: GROVE_TAGS }] }, TX, TY));
    got[r[0].aspect] = (got[r[0].aspect] || 0) + 1; n++;
  }
  const compass = (got.compass_roses || 0) / n;
  assert.inRange(compass, 1 / 8, 1 / 5.5, `compass roses at ${(compass * 100).toFixed(1)}%`);
  const roseAspects = ['rose_rings', 'rose_in_trees', 'compass_roses'].reduce((t, a) => t + (got[a] || 0), 0) / n;
  assert.lt(roseAspects, 0.5, `rose-bearing aspects at ${(roseAspects * 100).toFixed(0)}% (were two in three)`);
});
})();
