// Street variants (src/street_variants.js) and the old trade roads.
//
// What this file holds still:
//   · THE KEY: a street is a name inside a parish — the same on both sides of
//     a tile seam (its lineKeys differ), different across a parish line, and
//     an unnamed way keys off its own geometry.
//   · THE ROLL: each row dresses ONE size, at its share (a name word nudges).
//   · ROCKS line only the chosen minor streets, never a hedgerow.
//   · DRESSING sits off the band and off anything already there, from
//     position-derived ids, the same set every time.
//   · THE OLD TRADE ROAD (internally "bandit"): a LOOK only since the Sep 2026
//     safety pass — a bus stop by a major band wears the wagon with its id
//     unchanged and holds NO guard, no dog is pulled onto a major verge, no
//     trap sits in the kerb buffer, and no copy says "bandit".
//   · THE KERB BUFFER: a barricade's goblin and a burned row's fire slime are
//     seated back beyond WorldGen.ROAD_CLASS_MAJOR_BUFFER, same side.
//   · CAFÉ HOARDS: beside a café (commercial fallback), on its side of any
//     major band, guarded only outside the buffer, HOARDS_PER_TILE a tile.
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

// The fixture's two cafés: one in the open park (row 40, col 25), one
// hugging the motorway's EAST kerb (col 47, row 56).
const CAFE_OPEN = [25, 40], CAFE_KERB = [47, 56];
const CAFES = [
  { type: 1, tags: { class: 'cafe', name: 'Open Cup' }, geom: [pts([CAFE_OPEN])] },
  { type: 1, tags: { class: 'cafe', name: 'Kerb Cup' }, geom: [pts([CAFE_KERB])] },
];
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
      ...CAFES,
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
  assert.gt(cherry, plain * 2, `a cherry street is far likelier an orchard (${cherry} vs ${plain})`);
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
test('index: the fixture\'s streets roll as searched, and its cafés are the hoard POIs', () => {
  const r = rasterize();
  const byName = (n) => r.streetIndex.lines.find((l) => l.name === n);
  assert.eq(byName(ROCKY).variant, null, 'the rock street is plain');
  assert.truthy(byName(ROCKY).rocks, 'and rock-lined');
  assert.eq(byName(HEDGE).variant, 'hedgerow', 'the hedge street is a hedgerow');
  const major = r.streetIndex.lines.filter((l) => l.size === 'major');
  assert.eq(major.length, 1, 'the motorway is the one major line');
  assert.eq(r.streetIndex.closes, undefined, 'no dead-end closes any more — the hoard left the hedgerow');
  const hp = r.streetIndex.hoardPois;
  assert.eq(hp.length, 2, 'both cafés, and nothing else (the bus stops are not commercial)');
  for (const p of hp) {
    assert.eq(p.gk, `${TX * EXTENT + p.x},${TY * EXTENT + p.y}`, 'keyed on the GLOBAL MVT point');
  }
  assert.truthy(SV.hoardPick(hp[0].gk) <= SV.hoardPick(hp[1].gk), 'sorted by the point\'s own hash');
  assert.truthy(r.streetIndex.roadClass === r.roadClass, 'the stamp pass leaves the tile\'s roadClass on the index');
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
test('rocks: a rock-lined street runs about one rock per 10 m of its length', () => {
  // The owner's figure, measured on a real block (the Kelowna fixtures: ~1
  // per 16 m at the old 20 m pivot, 9.8 m now — sidewalks, moats and yards
  // cull most of a cluster there). This fixture's open park culls almost
  // nothing, so the same pivot runs ~2.7 m a rock here (4.5+ m at the old
  // pivot): the tripwire is on that.
  const r = rasterize();
  const rocks = r.objects.filter((o) => o.kind === 'mineralrock' && o._street);
  const lenM = (CPE - 1) * WorldGen.CELL_M;
  assert.gt(rocks.length, 0, 'the street is lined');
  const per = lenM / rocks.length;
  assert.inRange(per, 2, 3.5, `one rock per ${per.toFixed(1)} m on open ground`);
});

test('dressing: clipped bushes line the hedgerow, off the band and off anything already there', () => {
  const r = rasterize();
  const { d, before } = dressed(r);
  // A hedge IS a shrub — the ordinary bush (no square hedge kind of its own);
  // its id keeps the 'hedge' prefix so a save's cut hedges stay cut.
  const hedges = d.wildplants.filter((p) => /^hedge_/.test(p.id));
  assert.gt(hedges.length, 4, 'the hedgerow is hedged');
  for (const h of hedges) assert.eq(h.crop, 'shrub', `${h.id} is a bush`);
  assert.falsy(d.wildplants.some((p) => p.crop === 'hedge'), 'no square hedge kind');
  assert.truthy(hedges.every((h) => h._streetArt === 'clipped' && wildplantSprite(h).sheet === 'approved_clipped_hedge'), 'every hedge uses the shared cut shrub appearance');
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
  assert.eq(wildplantOutput('shrub'), 'wood', 'a hedge is chopped for wood — it is a shrub');
  assert.eq(wildplantWorkRelic('shrub'), 'axe');
  assert.eq(wildplantOutput('barricade'), 'wood', 'and a barricade is broken up the same way');
});

test('hedgerow: aligned regular gates and fixed verge rows stay tidy around obstacles', () => {
  const rec = {variant:'hedgerow', key:'manicured', halfW:4, line:pts([[5,30],[47,30]])};
  const grid = new Uint8Array(CPE * CPE).fill(T.GRASS);
  const draw = (occupied = new Set(), spawnWhy = new Uint16Array(CPE * CPE)) => SV.dress({
    index:{extent:EXTENT,lines:[rec]}, tx:TX,ty:TY,N:CPE,tileEdgeM:TILE_EDGE_M,grid,
    spawnOpts:{occupied,spawnWhy,roadMask:new Uint8Array(CPE * CPE)},
  }).wildplants;
  const rows = draw();
  const north = rows.filter(p => cellOf(p.y,TY) < 30).map(p => cellOf(p.x,TX));
  const south = rows.filter(p => cellOf(p.y,TY) > 30).map(p => cellOf(p.x,TX));
  assert.eq(north.join(','),south.join(','),'garden gates line up across the road');
  assert.eq(new Set(rows.map(p => cellOf(p.y,TY))).size,2,'one fixed row on each side');
  const gaps = [];
  for (let x = north[0]; x < north[north.length-1]; x++) if (!north.includes(x)) gaps.push(x);
  assert.gt(gaps.length,4,'several regular gates');
  for (let i=1;i<gaps.length;i++) assert.eq(gaps[i]-gaps[i-1],SV.HEDGE_GATE_EVERY_CELLS);
  const target=rows[2], ix=cellOf(target.x,TX),iy=cellOf(target.y,TY),idx=iy*CPE+ix;
  const expected=rows.filter(p=>p.id!==target.id).map(p=>p.id).join(',');
  assert.eq(draw(new Set([idx])).map(p=>p.id).join(','),expected,'an obstacle removes only its slot');
  const reasons=new Uint16Array(CPE*CPE);reasons[idx]=WorldGen.SPAWN_WHY.RESTRICTED;
  assert.eq(draw(new Set(),reasons).map(p=>p.id).join(','),expected,'hard spawn gates leave a gap too');
  assert.eq(draw().map(p=>p.id).join(','),rows.map(p=>p.id).join(','),'rebuild is deterministic');
});

// ── Café hoards ─────────────────────────────────────────────────────────
const inBuf = (r, i) => !!(r.roadClass[i] & WorldGen.ROAD_CLASS_MAJOR_BUFFER);
const onBand = (r, i) => !!(r.roadClass[i] & WorldGen.ROAD_CLASS_MAJOR_BAND);
test('café hoards: beside the café, public ground, guarded only outside the kerb buffer', () => {
  const r = rasterize();
  const { d } = dressed(r);
  assert.eq(d.treasures.length, 2, 'one hoard per café (both under the per-tile cap)');
  const cafeLairs = d.lairs.filter((L) => L.tier === 'cafe');
  const hp = r.streetIndex.hoardPois;
  for (const t of d.treasures) {
    const ix = cellOf(t.x, TX), iy = cellOf(t.y, TY), i = iy * CPE + ix;
    assert.eq(t.rollBonus, 1, 'worth more than a plain X');
    assert.eq(t.id, WorldGen.cellId('treasure_cafe', TX, TY, ix, iy), 'id from tile + local cell');
    assert.truthy(WorldGen.isSpawnCell(r.grid, CPE, CPE, ix, iy, { roadMask: r.roadMask }), 'on public ground, off the band');
    const near = hp.find((p) => Math.max(Math.abs(Math.floor(p.x / CELL_MVT) - ix), Math.abs(Math.floor(p.y / CELL_MVT) - iy)) <= SV.HOARD_SEAT_CELLS);
    assert.truthy(near, `${t.id} is beside its café`);
    assert.falsy(SV.crossesMajorBand(r.roadClass, CPE, Math.floor(near.x / CELL_MVT), Math.floor(near.y / CELL_MVT), ix, iy),
      `${t.id} is on its café's side of the road`);
    if (t.guarded) {
      assert.falsy(inBuf(r, i), `${t.id}: a guarded hoard is outside the kerb buffer`);
      const L = cafeLairs.find((c) => cellOf(TX * TILE_EDGE_M + c.lx, TX) === ix && cellOf(TY * TILE_EDGE_M + c.ly, TY) === iy);
      assert.truthy(L, `${t.id}: its guard post is the hoard's cell`);
      assert.eq(L.sid, `cafe:${near.gk}`, 'keyed on the café\'s global point');
    }
  }
  assert.eq(cafeLairs.length, d.treasures.filter((t) => t.guarded).length, 'one guard post per guarded hoard, none for the rest');
  const open = d.treasures.find((t) => Math.abs(cellOf(t.x, TX) - CAFE_OPEN[0]) <= SV.HOARD_SEAT_CELLS
    && Math.abs(cellOf(t.y, TY) - CAFE_OPEN[1]) <= SV.HOARD_SEAT_CELLS);
  assert.truthy(open && open.guarded, 'the café in the open park holds a guarded hoard');
  const kerb = d.treasures.find((t) => t !== open);
  assert.gt(cellOf(kerb.x, TX), 44, 'the kerb café\'s hoard stays EAST of the motorway (never across the band)');
});

test('café hoards: a distinct guard is seated by Lairs outside the buffer', () => {
  assert.eq(Lairs.capFor('cafe', 1), 1, 'a strong hoard is still one guard');
  assert.truthy(Lairs.KIND_ORDER.cafe.every((kind) => {
    const row = EnemyRoster.get(kind);
    return row && !row.variantType && row.tier <= 4;
  }), 'a café hoard holds a distinct authored guard capped at T4');
  assert.truthy(Lairs.ALWAYS_AWAKE_TIERS.has('cafe'), 'every mode');
  assert.eq(Lairs.KIND_ORDER.close, undefined, 'the hedgerow close tier is gone');
  const r = rasterize();
  const { d, spawnOpts } = dressed(r);
  const posts = d.lairs.filter((L) => L.tier === 'cafe');
  assert.gt(posts.length, 0, 'a guarded hoard');
  const entry = { grid: r.grid, cellsPerEdge: CPE, buildingShapes: [], _spawnOpts: spawnOpts,
    roadClass: r.roadClass, streetLairs: posts, creatures: [] };
  const playerM = { x: TX * TILE_EDGE_M + posts[0].lx, y: TY * TILE_EDGE_M + posts[0].ly };
  const rep = Lairs.stepResidency([{ entry, tx: TX, ty: TY }], {
    cellM: TILE_EDGE_M / CPE, tileEdgeM: TILE_EDGE_M, playerM, homeM: { x: 0, y: 0 },
    caughtSet: new Set(), buildings: false });
  assert.gt(rep.woken, 0, 'easy (buildings off) still wakes the hoard\'s giant');
  for (const g of entry.creatures) {
    const i = cellOf(g.y, TY) * CPE + cellOf(g.x, TX);
    assert.falsy(inBuf(r, i), `${g.id} seated outside the kerb buffer`);
  }
});

test('café hoards: HOARDS_PER_TILE a tile, lowest hash first; commercial fallback only without a café', () => {
  const poi = (cls, cells) => ({ name: 'poi', features: cells.map((c, k) =>
    ({ type: 1, tags: { class: cls, name: cls + k }, geom: [pts([c])] })) });
  const five = [[5, 5], [15, 5], [25, 5], [35, 5], [5, 25]];
  const hp = SV.hoardPoisOf(poi('cafe', five), TX, TY, EXTENT);
  assert.eq(hp.length, 5, 'every owned café is a candidate');
  const layers5 = [{ name: 'landuse', features: [{ type: 3, tags: { class: 'park' }, geom: [wholeTile()] }] },
    { name: 'transportation', extent: EXTENT, features: [] }, poi('cafe', five)];
  const r = WorldGen.rasterizeTile(layers5, CPE, TX, TY, TILE_EDGE_M);
  const { d } = dressed(r);
  assert.eq(d.treasures.length, SV.HOARDS_PER_TILE, `capped at ${SV.HOARDS_PER_TILE} a tile`);
  const want = hp.slice(0, SV.HOARDS_PER_TILE).map((p) => `cafe:${p.gk}`).sort().join();
  assert.eq(d.lairs.filter((L) => L.tier === 'cafe').map((L) => L.sid).sort().join(), want,
    'the lowest-hash cafés (a pure function of the points)');
  // Fallback: a tile with no café buries beside a bakery; a café wins when present.
  const mixed = { name: 'poi', features: [...poi('bakery', [[5, 5]]).features, ...poi('cafe', [[40, 40]]).features] };
  assert.eq(SV.hoardPoisOf(mixed, TX, TY, EXTENT).length, 1, 'a café present → cafés only');
  assert.eq(SV.hoardPoisOf(poi('bakery', [[5, 5]]), TX, TY, EXTENT).length, 1, 'no café → the bakery');
  assert.eq(SV.hoardPoisOf(poi('bus', [[5, 5]]), TX, TY, EXTENT).length, 0, 'a bus stop is no shop');
  // POINT OWNERSHIP: a café in the MVT buffer (outside the square) is the neighbour's.
  const seam = { name: 'poi', features: [{ type: 1, tags: { class: 'cafe' }, geom: [[{ x: -20, y: 100 }]] },
    { type: 1, tags: { class: 'cafe' }, geom: [[{ x: EXTENT + 5, y: 100 }]] }] };
  assert.eq(SV.hoardPoisOf(seam, TX, TY, EXTENT).length, 0, 'a seam café is only its owner\'s');
  const own = SV.hoardPoisOf({ name: 'poi', features: [{ type: 1, tags: { class: 'cafe' }, geom: [[{ x: EXTENT - 20, y: 100 }]] }] }, TX - 1, TY, EXTENT);
  assert.eq(own[0].gk, `${(TX - 1) * EXTENT + EXTENT - 20},${TY * EXTENT + 100}`, 'and its owner keys it globally');
});

test('dressing: the same tile dresses the same way every time (generated, never stored)', () => {
  const a = dressed(rasterize()).d, b = dressed(rasterize()).d;
  const ids = (x) => [...x.objects, ...x.wildplants, ...x.treasures].map((o) => o.id).join('|');
  assert.eq(ids(b), ids(a), 'same pieces, same ids, same order');
});

// ── The old trade road ──────────────────────────────────────────────────
test('old trade road: no trap on this tile sits on a major verge or inside the kerb buffer', () => {
  const r = rasterize();
  const occ = occupiedOf(r);
  const traps = Traps.spawnSurface(r.grid, r.roadClass, CPE, CPE, TX, TY, TILE_EDGE_M,
    { roadMask: r.roadMask, occupied: occ, pois: [] }, 25);
  for (const tp of traps) {
    const i = tp._iy * CPE + tp._ix;
    assert.falsy(r.roadClass[i] & WorldGen.ROAD_CLASS_MAJOR_VERGE, `${tp.id} off the major verge`);
    assert.falsy(inBuf(r, i), `${tp.id} outside the kerb buffer`);
    assert.eq(r.roadMask[i], 0, `${tp.id} not on the band`);
  }
});

test('old trade road: the copy says "Old trade road" — no player-facing string says bandit', () => {
  assert.eq(SV.BANDIT_STORY.title, 'Old trade road');
  for (const row of [...SV.STREET_VARIANTS, SV.BANDIT_STORY]) {
    for (const f of ['title', 'body', 'flash']) {
      assert.falsy(/bandit/i.test(row[f] || ''), `${row.story} ${f} never says bandit`);
    }
  }
  assert.falsy(/keeps this close|something keeps it/i.test(SV.VARIANT_BY_ID.hedgerow.body),
    'the hedgerow no longer promises a guarded hoard behind a gate');
});

test('old trade road: a bus stop by a major band wears the wagon — same id, NO guard; the other stays a chest', () => {
  const r = rasterize();
  const stops = r.objects.filter((o) => o.kind === 'chest' && o.poiClass === 'bus');
  assert.eq(stops.length, 2, 'both stops are chests');
  const idsBefore = stops.map((o) => o.id).join('|');
  const looksBefore = stops.map((o) => chestLook(o).texKey);
  const lairs = SV.markBanditStops(r.objects, r.roadClass, CPE, TX, TY, TILE_EDGE_M);
  assert.eq(stops.map((o) => o.id).join('|'), idsBefore, 'ids untouched');
  const near = stops.find((o) => cellOf(o.x, TX) > 40), far = stops.find((o) => cellOf(o.x, TX) < 40);
  assert.truthy(near.banditStop, 'the motorway stop is stamped');
  assert.eq(chestLook(near).texKey, 'wagon', 'the motorway stop is a broken wagon');
  assert.truthy(chestLook(near).wagon && !chestLook(near).box, 'and nothing else');
  assert.eq(chestLook(far).texKey, looksBefore[stops.indexOf(far)], 'the park stop keeps its look');
  assert.eq(lairs.length, 0, 'NO guard post — no wagon goblins at all (the owner, Sep 2026)');
  assert.truthy(SV.isWagonStop(near.id), 'this fixture\'s motorway stop is one the hash picks');
  assert.eq(Lairs.KIND_ORDER.wagon, undefined, 'the wagon tier is gone from the lair tables');
  assert.eq(Lairs.capFor('wagon', 1), 0, 'and holds nobody');
  assert.falsy('wagon' in Lairs.OCCUPANCY, 'no occupancy row either');
});

test('old trade road: only about a third of the major-road stops are wagons, by the stop\'s own id', () => {
  assert.inRange(SV.WAGON_STOP_SHARE, 0.3, 0.34, 'about one in three');
  let n = 0;
  for (let i = 0; i < 3000; i++) if (SV.isWagonStop(WorldGen.cellId('c', 2000 + (i % 50), 3000 + ((i / 50) | 0), i % 97, i % 89))) n++;
  assert.inRange(n / 3000, 0.28, 0.39, `a third of stops (${n} / 3000)`);
  const r = rasterize();
  const near = r.objects.find((o) => o.kind === 'chest' && o.poiClass === 'bus' && cellOf(o.x, TX) > 40);
  const plain = Object.assign({}, near, { id: nameWhere((nm) => !SV.isWagonStop(nm), 'c_stop') });
  const objs = r.objects.map((o) => (o === near ? plain : o));
  SV.markBanditStops(objs, r.roadClass, CPE, TX, TY, TILE_EDGE_M);
  assert.falsy(plain.banditStop, 'not stamped');
  assert.eq(chestLook(plain).texKey, chestLook(Object.assign({}, near, { banditStop: false, id: plain.id })).texKey,
    'it wears the bus-stop look');
  assert.eq(SV.isWagonStop(near.id), SV.isWagonStop(String(near.id)), 'the id decides');
});

// The FAUNA ATTRACTOR lane (scene_creatures.js _seatFaunaOnFavouriteGround),
// lifted from the source and driven for real.
function liftAttract() {
  const src = SCENE_SRC;
  const a = src.indexOf('\n  _seatFaunaOnFavouriteGround(');
  const b = src.indexOf('\n  }\n', a);
  assert.truthy(a > 0 && b > a, 'found _seatFaunaOnFavouriteGround');
  const tries = +src.match(/const FAUNA_ATTRACT_TRIES = (\d+);/)[1];
  return new Function('FAUNA_ATTRACT_TRIES', `return {\n${src.slice(a + 1, b + 4)}\n};`)(tries);
}

test('old trade road: no dog is pulled onto a major verge — the road attracts nothing', () => {
  assert.eq(SV.BANDIT_STORY.attracts, undefined, 'the dogs are no longer the road\'s');
  assert.eq(SV.VARIANT_BY_ID.lantern.attracts, undefined,
    'nor the cats Lantern Row\'s (its marks lie inside the kerb buffer)');
  for (const row of SV.STREET_VARIANTS) {
    if (row.size === 'major') assert.eq(row.attracts, undefined, `${row.id}: a major row attracts no fauna`);
  }
  const m = liftAttract();
  const r = rasterize();
  const cellM = TILE_EDGE_M / CPE;
  const mk = (i) => WorldGen.makeCreature('dog', TX * TILE_EDGE_M + (5 + i) * cellM, TY * TILE_EDGE_M + 5 * cellM, `dog_${TX}_${TY}_${i}`);
  const creatures = [mk(0), mk(1)];
  const at = creatures.map((c) => `${c.x},${c.y}`).join('|');
  const opts = { roadMask: r.roadMask, occupied: occupiedOf(r), pois: [] };
  const scene = Object.assign({ tileEdgeM: TILE_EDGE_M }, m);
  const moved = scene._seatFaunaOnFavouriteGround({ roadClass: r.roadClass }, TX, TY, CPE, cellM, r.grid, opts, creatures, null);
  assert.falsy(moved.dog, 'no dog moved');
  assert.eq(creatures.map((c) => `${c.x},${c.y}`).join('|'), at, 'the dogs keep their drawn seats');
});

test('fauna attractors: a table, not code — every column names a spawned species and a share', () => {
  const cols = [...StreetVariants.STREET_VARIANTS.map((r) => [r.id, r.attracts]),
    ...Object.entries(Zones.ZONE_KINDS).map(([k, r]) => ['zone ' + k, r.attracts]),
    ...Object.entries(BIOME_ATTRACTS).map(([c, a]) => ['terrain ' + c, a])];
  const known = new Set([...FAUNA_ORDER, ...SHORE_FAUNA_ORDER, 'rabbit']);
  for (const [who, a] of cols) {
    if (!a) continue;
    for (const [sp, p] of Object.entries(a)) {
      assert.truthy(known.has(sp), `${who} attracts a creature kind (${sp})`);
      assert.truthy(p > 0 && p <= 1, `${who}: ${sp} at p ${p}`);
    }
  }
  const row = (id) => StreetVariants.VARIANT_BY_ID[id].attracts || {};
  assert.eq(row('orchard').deer, 0.5, 'Orchard Lane → deer');
  assert.eq(row('hedgerow').rabbit, 0.5, 'Hedgerow → rabbits');
  assert.eq(row('overgrown').rabbit, 0.5, 'Overgrown → rabbits');
  assert.eq(row('overgrown').butterfly, 0.5, 'Overgrown → butterflies');
  assert.eq(row('toadstool').butterfly, 0.5, 'Toadstool → butterflies');
  assert.eq(row('greenway').butterfly, 0.5, 'Greenway → butterflies');
  assert.eq(row('pilgrim').crow, 0.1, "Pilgrim's Way → crows");
  assert.falsy(Zones.ZONE_KINDS.stones.attracts?.crow, 'ordinary churchyards do not draw extra crows');
  const birdPulls = [...cols, ...ZoneVariants.rows.map(r => [r.id, r.attracts])]
    .filter(([, a]) => a?.crow || a?.raven);
  assert.eq(birdPulls.length, 1, 'only Pilgrim Way attracts birds');
  assert.eq(birdPulls[0][0], 'pilgrim');
  assert.eq(Zones.ZONE_KINDS.grove.attracts.deer, 0.5, 'grove → deer');
  assert.eq(Zones.ZONE_KINDS.grove.attracts.butterfly, 0.5, 'grove → butterflies');
  assert.eq(BIOME_ATTRACTS[WorldGen.T.WASTELAND].slime, 0.5, 'wasteland → slimes');
  assert.eq(BIOME_ATTRACTS[WorldGen.T.PITCH].deer, 0.5, 'sports pitch → deer');
  // The spawner reads the columns; it names no species of its own.
  const src = SCENE_SRC;
  const body = src.slice(src.indexOf('\n  _seatFaunaOnFavouriteGround('), src.indexOf('\n  }\n', src.indexOf('\n  _seatFaunaOnFavouriteGround(')));
  for (const sp of ['deer', 'cat', 'butterfly', 'dog', 'rabbit']) {
    assert.falsy(new RegExp(`'${sp}'`).test(body), `no '${sp}' literal in the lane`);
  }
});

test('fauna attractors: half of a species moves onto its ground, the rest stay; nothing is added', () => {
  const m = liftAttract();
  const r = rasterize();
  const cellM = TILE_EDGE_M / CPE;
  // A synthetic tile whose left half is WASTE ground (the terrain row: slimes).
  const N = CPE, grid = new Uint8Array(N * N).fill(WorldGen.T.GRASS);
  for (let y = 0; y < N; y++) for (let x = 0; x < N / 2; x++) grid[y * N + x] = WorldGen.T.WASTELAND;
  // Public ground beside it so the lot rule lets a spawn stand (a POI anchor in every row).
  const pois = []; for (let y = 0; y < N; y += 3) for (let x = 1; x < N / 2; x += 3) pois.push({ ix: x, iy: y });
  const opts = { roadMask: new Uint8Array(N * N), occupied: new Set(), pois };
  const slimes = [];
  for (let i = 0; i < 60; i++) slimes.push(WorldGen.makeCreature('slime', TX * TILE_EDGE_M + (N - 2) * cellM, TY * TILE_EDGE_M + (i % N) * cellM, `slime_${TX}_${TY}_${i}`));
  const cow = WorldGen.makeCreature('cow', TX * TILE_EDGE_M + (N - 3) * cellM, TY * TILE_EDGE_M, 'cow_y');
  const creatures = [...slimes, cow];
  const scene = Object.assign({ tileEdgeM: TILE_EDGE_M }, m);
  const moved = scene._seatFaunaOnFavouriteGround({ roadClass: new Uint8Array(N * N) }, TX, TY, N, cellM, grid, opts, creatures, null);
  assert.eq(creatures.length, 61, 'relocates, never adds');
  assert.inRange(moved.slime, 18, 42, `about half the slimes moved (${moved.slime} of 60)`);
  let onWaste = 0;
  for (const s of slimes) if (grid[cellOf(s.y, TY) * N + cellOf(s.x, TX)] === WorldGen.T.WASTELAND) onWaste++;
  assert.eq(onWaste, moved.slime, 'every moved slime is on the waste ground, the rest where they were drawn');
  assert.eq(cow.x, TX * TILE_EDGE_M + (N - 3) * cellM, 'the cow is not attracted');
  // Deterministic: the same tile moves the same animals to the same cells.
  const again = slimes.map((s) => WorldGen.makeCreature('slime', TX * TILE_EDGE_M + (N - 2) * cellM, s.y, s.id));
  scene._seatFaunaOnFavouriteGround({ roadClass: new Uint8Array(N * N) }, TX, TY, N, cellM, grid, { ...opts, occupied: new Set() }, again, null);
  assert.eq(again.map((s) => `${s.x},${s.y}`).join('|'), slimes.map((s) => `${s.x},${s.y}`).join('|'), 'same seats every build');
  // A pest amnesty cell is never a slime's new seat.
  const pestAll = { has: () => true };
  const fresh = slimes.slice(0, 10).map((s, i) => WorldGen.makeCreature('slime', TX * TILE_EDGE_M + (N - 2) * cellM, TY * TILE_EDGE_M + i * cellM, s.id));
  const m2 = scene._seatFaunaOnFavouriteGround({ roadClass: new Uint8Array(N * N) }, TX, TY, N, cellM, grid, { ...opts, occupied: new Set() }, fresh, pestAll);
  assert.falsy(m2.slime, 'no slime moves into the starting area\'s amnesty');
});

test('sports pitch affinity relocates existing deer without creating more animals', () => {
  const N = CPE, cellM = TILE_EDGE_M / N;
  const grid = new Uint8Array(N * N).fill(T.GRASS);
  for (let y = 0; y < N; y++) for (let x = 0; x < N / 2; x++) grid[y * N + x] = T.PITCH;
  const deer = Array.from({ length: 60 }, (_, i) => WorldGen.makeCreature('deer',
    TX * TILE_EDGE_M + (N - 2) * cellM, TY * TILE_EDGE_M + (i + .5) * cellM, `pitch_deer_${i}`));
  const scene = Object.assign({ tileEdgeM: TILE_EDGE_M }, liftAttract());
  const moved = scene._seatFaunaOnFavouriteGround({ roadClass: new Uint8Array(N * N) },
    TX, TY, N, cellM, grid, { occupied: new Set(), roadMask: new Uint8Array(N * N), pois: [] }, deer, null);
  assert.eq(deer.length, 60, 'affinity never adds deer');
  assert.inRange(moved.deer, 18, 42, 'approximately half the existing deer choose the pitch');
  assert.eq(deer.filter(d => grid[cellOf(d.y, TY) * N + cellOf(d.x, TX)] === T.PITCH).length, moved.deer);
});

// ── Toadstool Lane, the barricade's goblins, the burned row's fire slimes ──
const TOAD = nameWhere((n, k) => SV.variantFor(k, n, 'minor') === 'toadstool', 'Pale Lane');
const BARR = nameWhere((n, k) => SV.variantFor(k, n, 'major') === 'barricade', 'Gate Road');
const BURN = nameWhere((n, k) => SV.variantFor(k, n, 'major') === 'burned', 'Kiln Road');
function variantLayers() {
  const toad = pts([[0, 20], [CPE - 1, 20]]);
  const barr = pts([[40, 30], [40, CPE - 1]]);     // one owned end inside (row 30)
  const burn = pts([[20, 0], [20, CPE - 1]]);
  return [
    { name: 'landuse', features: [{ type: 3, tags: { class: 'park' }, geom: [wholeTile()] }] },
    { name: 'transportation', extent: EXTENT, features: [
      { type: 2, tags: { class: 'minor' }, geom: [toad] },
      { type: 2, tags: { class: 'secondary' }, geom: [barr] },
      { type: 2, tags: { class: 'secondary' }, geom: [burn] },
    ] },
    { name: 'transportation_name', extent: EXTENT, features: [
      { type: 2, tags: { name: TOAD }, geom: [toad] },
      { type: 2, tags: { name: BARR }, geom: [barr] },
      { type: 2, tags: { name: BURN }, geom: [burn] },
    ] },
  ];
}
const dressedVariants = () => {
  const r = WorldGen.rasterizeTile(variantLayers(), CPE, TX, TY, TILE_EDGE_M);
  return Object.assign({ r }, dressed(r));
};

test('toadstool lane: a minor row at 5%, its verge holds glowing mushrooms with occasional giant caps', () => {
  const row = SV.VARIANT_BY_ID.toadstool;
  assert.eq(row.size, 'minor'); assert.eq(row.share, 0.05);
  assert.eq(row.story, 'street_toadstool', 'its painting stem');
  // Appended after the seven older rows (code 8), and only the never-rolled
  // scenic 'path' rows (src/scenic.js) after it: no older row's code moves.
  assert.eq(row.code, 8, 'appended: no older row\'s code moves');
  assert.truthy(SV.STREET_VARIANTS.slice(row.code).every((r) => r.size === 'path' || r.id === 'golden' || r.id === 'snare' || r.id === 'thorny'), 'new rows append without changing existing codes');
  let plain = 0, named = 0;
  for (let i = 0; i < 20000; i++) {
    if (SV.variantFor(`s${i}|0,0`, `Maple ${i}`, 'minor') === 'toadstool') plain++;
    if (SV.variantFor(`s${i}|0,0`, `Mushroom ${i}`, 'minor') === 'toadstool') named++;
  }
  assert.gt(named, plain * 2, `a mushroom street is likelier a toadstool lane (${named} vs ${plain})`);
  const { d, r, before } = dressedVariants();
  const plants = d.wildplants.filter((w) => w._street === 'toadstool');
  assert.gt(plants.length, 4, 'the lane is dressed');
  const mush = plants.filter((w) => w.crop === 'mushroom').length;
  assert.truthy(plants.every((w) => ['mushroom', 'giant_mushroom'].includes(w.crop)), 'mushrooms only');
  assert.gt(plants.filter((w) => w.crop === 'giant_mushroom').length, 0, 'occasional giant caps');
  assert.gt(mush, plants.length / 2, `mostly mushrooms (${mush} of ${plants.length})`);
  for (const w of plants) assert.eq(wildplantSprite(w), CROP_SPRITE[w.crop], 'small and giant caps use their distinct crop art');
  assert.truthy(wildplantLight('mushroom'), 'and a mushroom glows');
  for (const w of plants) {
    const i = cellOf(w.y, TY) * CPE + cellOf(w.x, TX);
    assert.eq(r.roadMask[i], 0, 'off the band');
    assert.falsy(before.has(i), 'off anything already there');
  }
});

test('barricade road: one goblin per barricade, held in either mode', () => {
  assert.eq(Lairs.capFor('barricade', 1), 1, 'one goblin, whatever the strength');
  assert.eq(Lairs.KIND_ORDER.barricade.join(), 'spear_goblin,archer_goblin');
  assert.truthy(Lairs.ALWAYS_AWAKE_TIERS.has('barricade'), 'every mode');
  const { d, r, spawnOpts } = dressedVariants();
  const bars = d.wildplants.filter((w) => w.crop === 'barricade' && !w._streetScenery);
  const posts = d.lairs.filter((L) => L.tier === 'barricade');
  assert.gt(bars.length, 0, 'the owned end stands a barricade');
  assert.eq(posts.length, bars.length, 'one guard post per barricade');
  for (const b of bars) {
    assert.truthy(posts.some((L) => L.sid === b.id), `the post keys off its barricade (${b.id})`);
  }
  // THE KERB BUFFER: the goblin's post is seated BACK, on the barricade's
  // side of the road, within FOE_SEAT_BACK_CELLS of it.
  for (const L of posts) {
    const ix = Math.floor(L.lx / (TILE_EDGE_M / CPE)), iy = Math.floor(L.ly / (TILE_EDGE_M / CPE));
    assert.falsy(inBuf(r, iy * CPE + ix), `${L.sid}: the post is outside the kerb buffer`);
    const b = bars.find((w) => w.id === L.sid);
    const bx = cellOf(b.x, TX), by = cellOf(b.y, TY);
    assert.truthy(Math.max(Math.abs(bx - ix), Math.abs(by - iy)) <= SV.FOE_SEAT_BACK_CELLS, 'close behind its barricade');
    assert.falsy(SV.crossesMajorBand(r.roadClass, CPE, bx, by, ix, iy), 'never across the band');
  }
  const entry = { grid: r.grid, cellsPerEdge: CPE, buildingShapes: [], _spawnOpts: spawnOpts,
    roadClass: r.roadClass, streetLairs: posts, creatures: [] };
  const playerM = { x: TX * TILE_EDGE_M + posts[0].lx, y: TY * TILE_EDGE_M + posts[0].ly };
  const rep = Lairs.stepResidency([{ entry, tx: TX, ty: TY }], {
    cellM: TILE_EDGE_M / CPE, tileEdgeM: TILE_EDGE_M, playerM, homeM: { x: 0, y: 0 },
    caughtSet: new Set(), buildings: false });
  assert.gt(rep.woken, 0, 'easy (buildings off) still wakes the one beside you');
  assert.eq(entry.creatures[0].kind, 'spear_goblin');
  for (const g of entry.creatures) {
    assert.falsy(inBuf(r, cellOf(g.y, TY) * CPE + cellOf(g.x, TX)), `${g.id} stands outside the kerb buffer`);
  }
});

test('barricade support follows difficulty, independently of building garrisons', () => {
  const previous = Difficulty.mode();
  try {
    for (const mode of ['easy', 'hard']) {
      Difficulty.setMode(mode);
      const { d, r, spawnOpts } = dressedVariants();
      const post = d.lairs.find((L) => L.tier === 'barricade');
      const entry = { grid: r.grid, cellsPerEdge: CPE, buildingShapes: [], _spawnOpts: spawnOpts,
        roadClass: r.roadClass, streetLairs: [post], creatures: [] };
      Lairs.stepResidency([{ entry, tx: TX, ty: TY }], {
        cellM: TILE_EDGE_M / CPE, tileEdgeM: TILE_EDGE_M,
        playerM: { x: TX * TILE_EDGE_M + post.lx, y: TY * TILE_EDGE_M + post.ly },
        homeM: { x: 0, y: 0 }, caughtSet: new Set(), buildings: true });
      assert.eq(entry.creatures.map((c) => c.kind).sort().join(),
        mode === 'hard' ? 'archer_goblin,spear_goblin' : 'spear_goblin');
    }
  } finally { Difficulty.setMode(previous); }
});

test('kerb buffer: a barricade whose every seat is in the buffer gets no goblin (dropped, never forced)', () => {
  const { r, spawnOpts } = dressedVariants();
  // Paint the whole tile as buffer: no foe cell anywhere.
  const rc = Uint8Array.from(r.roadClass, (v) => v | WorldGen.ROAD_CLASS_MAJOR_BUFFER);
  const d = SV.dress({ index: r.streetIndex, tx: TX, ty: TY, N: CPE, tileEdgeM: TILE_EDGE_M, grid: r.grid,
    spawnOpts: Object.assign({}, spawnOpts, { occupied: new Set(), roadClass: rc }) });
  assert.gt(d.wildplants.filter((w) => w.crop === 'barricade').length, 0, 'the barricade still stands (scenery)');
  assert.eq(d.lairs.filter((L) => L.tier === 'barricade' || L.tier === 'burned').length, 0, 'but no foe is seated');
});

test('burned row: placed torches share the spawn gate and red lamps have twice the spacing', () => {
  assert.eq(SV.lampSpacingFor('burned', 100), 200);
  assert.eq(SV.VARIANT_BY_ID.burned.lampGlow, '#ff5a3c');
  const { d, r, before } = dressedVariants();
  const torches = d.objects.filter(o => o.kind === 'torch' && o._street === 'burned');
  assert.gt(torches.length, 4, 'several placed torches light the burned verge');
  assert.eq(JSON.stringify(torches), JSON.stringify(dressedVariants().d.objects.filter(o => o.kind === 'torch' && o._street === 'burned')));
  const cells = new Set();
  for (const o of d.objects) {
    const ix = cellOf(o.x, TX), iy = cellOf(o.y, TY), cell = iy*CPE+ix;
    assert.falsy(cells.has(cell), 'torches and debris never overlap');
    cells.add(cell);
    if (o.kind !== 'torch') continue;
    assert.eq(r.roadMask[cell], 0, 'torch stays off the roadway');
    assert.falsy(before.has(cell), 'preexisting occupants stay clear');
    assert.eq(o.id, WorldGen.cellId('torch_burned', TX, TY, ix, iy));
    assert.falsy(d.slowCells.has(cell), 'a torch is not slowing debris');
  }
  const blocked = WorldGen.rasterizeTile(variantLayers(), CPE, TX, TY, TILE_EDGE_M);
  blocked.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
  const blockedResult = SV.dress({ index: blocked.streetIndex, tx: TX, ty: TY, N: CPE,
    tileEdgeM: TILE_EDGE_M, grid: blocked.grid,
    spawnOpts: { roadMask: blocked.roadMask, spawnWhy: blocked.spawnWhy, occupied: new Set() } });
  assert.eq(blockedResult.objects.filter(o => o.kind === 'torch').length, 0);
});

test('burned row: one fire slime per stretch, keyed on the street and the square', () => {
  assert.eq(Lairs.capFor('burned', 1), 1);
  assert.eq(Lairs.KIND_ORDER.burned.join(), 'fire_slime');
  assert.truthy(Lairs.ALWAYS_AWAKE_TIERS.has('burned'), 'every mode');
  const { d } = dressedVariants();
  const posts = d.lairs.filter((L) => L.tier === 'burned');
  // The burned row runs down col 20 of tile (TX, TY): 8 squares of
  // BANDIT_STRETCH_UNITS, all inside this tile — one post each.
  const squares = EXTENT / SV.BANDIT_STRETCH_UNITS;
  assert.eq(posts.length, squares, `one per stretch (${posts.length})`);
  assert.eq(new Set(posts.map((L) => L.sid)).size, posts.length, 'distinct keys');
  const key = SV.streetKey(BURN, TX, TY);
  for (const L of posts) assert.truthy(L.sid.startsWith(`burned:${key}|`), 'keyed on the street');
  // Seated BACK: every fire slime's post is outside the kerb buffer.
  const { r } = dressedVariants();
  for (const L of posts) {
    const ix = Math.floor(L.lx / (TILE_EDGE_M / CPE)), iy = Math.floor(L.ly / (TILE_EDGE_M / CPE));
    assert.falsy(inBuf(r, iy * CPE + ix), `${L.sid}: outside the kerb buffer`);
    assert.eq(r.roadMask[iy * CPE + ix], 0, 'off the band');
  }
  // The same from a rebuild (no draws, no stored state).
  const again = dressedVariants().d.lairs.filter((L) => L.tier === 'burned').map((L) => L.sid).join();
  assert.eq(again, posts.map((L) => L.sid).join(), 'generated, the same every build');
});

// ── Slow going ──────────────────────────────────────────────────────────
test('slow: tar or stakes underfoot cap the body at SLOW_BODY_M_S, and the cap lets go', () => {
  const app = SCENE_SRC;
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
  const pinned = body(); pinned._slowHere = 'stakes'; pinned.save = { conditions: { pinned: { remainingMs: 5000 } } };
  assert.truthy(pinned._bodyHold().pinned && pinned._bodyHold().capMS == null, 'a pinned body is held, not capped');
  assert.truthy(SV.isSlowKind('tar') && SV.isSlowKind('stakes') && !SV.isSlowKind('waystone'),
    'the slow props are one table');
});

test('slow: the feet cell is read off playerToWorldCell, and the first contact flashes', () => {
  const src = SCENE_SRC.slice(SCENE_SRC.indexOf('\n  _tickStreetFeet() {'),
    SCENE_SRC.indexOf('\n  _bodyHold() {'));
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

// ── One end piece per street per tile (Sep 2026) ───────────────────────────
// A major road arrives cut into many short lines. The ends are pooled by street key and ONE seats per (street, tile): the end
// whose hash endPick is lowest and that seats. Same for Pilgrim's waystones.
const PILG = nameWhere((n, k) => SV.variantFor(k, n, 'minor') === 'pilgrim', 'Chapel Walk');
function piecewiseLayers() {
  // The barricade road down col 40 in FOUR pieces, the pilgrim way along
  // row 20 in THREE — every cut an owned end.
  const cuts = (a, b, n, at) => {
    const out = [];
    for (let k = 0; k < n; k++) {
      const p0 = Math.round(a + (b - a) * k / n), p1 = Math.round(a + (b - a) * (k + 1) / n);
      out.push(pts(at === 'col' ? [[40, p0], [40, p1]] : [[p0, 20], [p1, 20]]));
    }
    return out;
  };
  const barr = cuts(4, CPE - 5, 4, 'col'), pilg = cuts(4, CPE - 5, 3, 'row');
  return [
    { name: 'landuse', features: [{ type: 3, tags: { class: 'park' }, geom: [wholeTile()] }] },
    { name: 'transportation', extent: EXTENT, features: [
      ...barr.map((g) => ({ type: 2, tags: { class: 'secondary' }, geom: [g] })),
      ...pilg.map((g) => ({ type: 2, tags: { class: 'minor' }, geom: [g] })),
    ] },
    { name: 'transportation_name', extent: EXTENT, features: [
      ...barr.map((g) => ({ type: 2, tags: { name: BARR }, geom: [g] })),
      ...pilg.map((g) => ({ type: 2, tags: { name: PILG }, geom: [g] })),
    ] },
  ];
}
test('barricade + pilgrim: ONE end piece per street per tile, however many pieces it arrives in', () => {
  const r = WorldGen.rasterizeTile(piecewiseLayers(), CPE, TX, TY, TILE_EDGE_M);
  const lines = r.streetIndex.lines;
  assert.eq(lines.filter((l) => l.variant === 'barricade').length, 4, 'four barricade pieces');
  assert.eq(lines.filter((l) => l.variant === 'pilgrim').length, 3, 'three pilgrim pieces');
  const { d } = dressed(r);
  const bars = d.wildplants.filter((w) => w.crop === 'barricade' && !w._streetScenery);
  const ways = d.objects.filter((o) => o.kind === 'waystone');
  assert.eq(bars.length, 1, 'one barricade for the street in this tile');
  assert.eq(d.lairs.filter((L) => L.tier === 'barricade').length, 1, 'and one goblin');
  assert.eq(ways.length, 1, 'one waystone for the pilgrim way in this tile');
  // Deterministic, and off a hash of the street + the end's GLOBAL point.
  const again = dressed(WorldGen.rasterizeTile(piecewiseLayers(), CPE, TX, TY, TILE_EDGE_M)).d;
  assert.eq(again.wildplants.filter((w) => w.crop === 'barricade' && !w._streetScenery)[0].id, bars[0].id, 'the same end every build');
  assert.truthy(/u01\(`end\|\$\{grp\.v\}\|\$\{grp\.key\}\|\$\{gk\}`\)/.test(ALL_SRC['street_variants.js']),
    'the pick hashes variant, street key and the global end point');
});

// ── Dogs: no ground takes them whole any more (Sep 2026 safety pass) ─────
// With the road's `attracts` gone, no ground pulls the dogs whole, so a
// displaced dog stays lost, as any other species does.
test('old trade road: a displaced dog is no longer seated on the major verge', () => {
  const m = liftAttract();
  const r = rasterize();
  const cellM = TILE_EDGE_M / CPE;
  const lost = WorldGen.makeCreature('dog', NaN, NaN, `dog_${TX}_${TY}_9`);
  const creatures = [];
  const scene = Object.assign({ tileEdgeM: TILE_EDGE_M }, m);
  const moved = scene._seatFaunaOnFavouriteGround({ roadClass: r.roadClass }, TX, TY, CPE, cellM, r.grid,
    { roadMask: r.roadMask, occupied: new Set(), pois: [] }, creatures, null, [lost]);
  assert.falsy(moved.dog, 'not seated');
  assert.eq(creatures.length, 0, 'and not added');
});

test('short street dressing: mixed orchard rows and a visible maple growth sequence', () => {
  for (const v of ['orchard', 'overgrown']) {
    const name = nameWhere((n, k) => SV.variantFor(k, n, 'minor') === v, v);
    const line = pts([[2, 30], [60, 30]]);
    const ls = [
      { name: 'landuse', features: [{ type: 3, tags: { class: 'park' }, geom: [wholeTile()] }] },
      { name: 'transportation', extent: EXTENT, features: [{ type: 2, tags: { class: 'minor' }, geom: [line] }] },
      { name: 'transportation_name', features: [{ type: 2, tags: { name }, geom: [line] }] },
    ];
    const r = WorldGen.rasterizeTile(ls, CPE, TX, TY, TILE_EDGE_M);
    const d = dressed(r).d;
    const trees = d.objects.filter((o) => o._street === v);
    assert.gt(trees.length, 15, v + ' dresses the full short street');
    if (v === 'orchard') {
      const apples = trees.filter(o => o.kind === 'fruittree');
      assert.truthy(apples.every(o => o.species === WorldGen.fruitTreeSpecies(WorldGen.cellHash(TX, TY, cellOf(o.x, TX), cellOf(o.y, TY)))));
      const maples = trees.filter(o => o.kind === 'tree' && o.species === 'maple');
      assert.eq(apples.length, maples.length, 'half fruit trees, half deciduous on open ground');
      assert.eq(apples.length + maples.length, trees.length, 'only fruit trees and maples');
      assert.truthy(maples.every(o => treeGrowthStage(o) === 3), 'deciduous trees are mature');
      assert.eq(new Set(trees.map(o => o.id)).size, trees.length, 'tree identities remain distinct');
      assert.truthy(trees.some((o) => cellOf(o.y, TY) < 30) && trees.some((o) => cellOf(o.y, TY) > 30), 'both verges');
    } else {
      assert.eq([...new Set(trees.map((o) => o.variant))].join(), '1,2,3', 'saplings, young trees, mature trees in order');
      assert.truthy(trees.every((o) => o.kind === 'tree' && o.species === 'maple'), 'existing maple growth art and mechanics');
    }
  }
});

function indexOfLines(lines, name = HEDGE, tx = TX, ty = TY, mvtToM = 1) {
  return SV.buildIndex([
    { name: 'transportation', extent: EXTENT, features: lines.map(line => ({ type: 2, tags: { class: 'minor' }, geom: [line] })) },
    { name: 'transportation_name', extent: EXTENT, features: name ? lines.map(line => ({ type: 2, tags: { name }, geom: [line] })) : [] },
  ], tx, ty, mvtToM);
}
const themeGeometry = index => JSON.stringify(index.dressingLines.map(r => ({ key: r.key, variant: r.variant, line: r.line, patch: r.patch })));

test('street themes: 40% of all minor keys, with name bias only selecting identity', () => {
  let plain = 0, named = 0, golden = 0, namedGolden = 0;
  const n = 40000;
  for (let i = 0; i < n; i++) {
    const key = `road eligibility ${i}|0,0`;
    const a = SV.variantFor(key, null, 'minor');
    const b = SV.variantFor(key, 'Cherry Church Golden Lane', 'minor');
    plain += !!a; named += !!b; golden += a === 'golden'; namedGolden += b === 'golden';
    assert.eq(!!a, !!b, 'names cannot change eligibility');
  }
  assert.inRange(plain / n, .39, .41, '40% overall');
  assert.eq(named, plain);
  assert.inRange(golden / n, .015, .025, 'Golden Road is 2% of all minor roads');
  assert.eq(golden, namedGolden, 'name nudges cannot inflate the rare coin-road share');
});

test('street themes: exactly 500m, reversed duplicates and feature cuts keep identical dressing paths', () => {
  const a = { x: 100, y: 100 }, b = { x: 350, y: 100 }, c = { x: 600, y: 100 };
  const whole = indexOfLines([[a, c]]);
  const split = indexOfLines([[c, b], [a, b], [b, c]]);
  assert.eq(themeGeometry(whole), themeGeometry(split));
  assert.truthy(split.lines.every(r => r.variant === 'hedgerow' && r.streetLengthM === 500));
  assert.eq(split.dressingLines[0].patch, null, 'a complete compact road needs no artificial gaps');
  assert.eq(themeGeometry(indexOfLines([[a, c]], null)), themeGeometry(indexOfLines([[c, b], [b, a]], null)),
    'anonymous joined geometry is stable too');
});

const patchKey = (px, py) => `${TX * EXTENT + px},${TY * EXTENT + py}`;
const rowSquares = [0, 1024, 2048, 3072];
const LONG_HEDGE = nameWhere((n, k) => SV.variantFor(k, n, 'minor') === 'hedgerow', 'Long Hedge Road');

test('street themes: long and clipped roads wear their theme in sections, with plain gaps between', () => {
  const a = { x: -50, y: 100 }, b = { x: 1800, y: 100 }, c = { x: 4146, y: 100 };
  const whole = indexOfLines([[a, c]], LONG_HEDGE), split = indexOfLines([[c, b], [b, a]], LONG_HEDGE);
  assert.eq(themeGeometry(whole), themeGeometry(split), 'cuts and direction do not change theme geometry');
  const themedSquares = rowSquares;
  assert.eq(whole.dressingLines.map(r => r.patch).sort().join(';'), themedSquares.map(px => patchKey(px, 0)).sort().join(';'),
    'exactly the themed squares carry a section, each once');
  const patches = new Map();
  for (const rec of whole.dressingLines) {
    assert.eq(rec.variant, 'hedgerow');
    patches.set(rec.patch, (patches.get(rec.patch) || 0) + Streets.lineLengthM(rec.line, 1));
    for (const p of rec.line) assert.inRange(p.x % SV.LONG_PATCH_UNITS,
      SV.LONG_PATCH_UNITS * .3 - 1e-6, SV.LONG_PATCH_UNITS * .7 + 1e-6);
  }
  for (const length of patches.values()) assert.inRange(length, SV.MIN_VARIANT_LENGTH_M, SV.MAX_VARIANT_LENGTH_M, 'a section is between the min and the cap');
  const parts = SV.lineParts(whole.lines[0], 1);
  assert.gt(parts.filter(p => !p.variant && p.b - p.a >= SV.LONG_PATCH_UNITS * .6 - 1e-6).length, 1,
    'plain intervals visibly separate themes');
  assert.eq(SV.variantAt(whole.lines[0], 1024 + 50, 1), null, 'lattice boundary is a plain gap');
  for (const [line, squares] of [
    [[{x:-50,y:512},{x:4146,y:512}], rowSquares.map(px => patchKey(px, 0))],
    [[{x:512,y:-50},{x:512,y:4146}], rowSquares.map(py => patchKey(0, py))],
  ]) {
    const aligned = indexOfLines([line], LONG_HEDGE);
    const want = squares;
    assert.eq(aligned.dressingLines.map(r => r.patch).sort().join(';'), want.sort().join(';'),
      'a road following a patch boundary belongs to each themed patch exactly once');
  }
  const next = indexOfLines([[{x:-50,y:100},{x:4146,y:100}]], LONG_HEDGE, TX + 1);
  assert.truthy(next.dressingLines.every(r => r.variant === 'hedgerow'), 'named road keeps its identity across the tile seam');
});

test('street themes: each bounded road themes 40% of in-tile arclength', () => {
  const roads = [
    [{x:0,y:100},{x:4096,y:100}],
    [{x:1024,y:0},{x:1024,y:4096}],
    [{x:0,y:0},{x:4096,y:4096}],
    [{x:100,y:100},{x:900,y:100}],
    [{x:100,y:100},{x:450,y:100},{x:450,y:450},{x:100,y:450}],
  ];
  for (const line of roads) for (const scale of [.4, .7]) {
    if (line[0].x > 0 && line[0].y > 0 && Streets.lineLengthM(line, scale) <= 500) continue;
    const index = indexOfLines([line], LONG_HEDGE, TX, TY, scale);
    const themed = index.dressingLines.reduce((sum, rec) => sum + Streets.lineLengthM(rec.line, scale), 0);
    assert.inRange(themed / Streets.lineLengthM(line, scale), .399999, .400001,
      'coverage follows road length regardless of direction, bends or tile scale');
    const styled = SV.lineParts(index.lines[0], scale).filter(p => p.variant)
      .reduce((sum, p) => sum + p.b - p.a, 0);
    assert.inRange(styled / Streets.lineLengthM(line, scale), .399999, .400001,
      'paving and lamps use the same coverage');
  }
});

test('street themes: nothing shorter than MIN_VARIANT_LENGTH_M — not a street, not a section', () => {
  assert.eq(SV.MIN_VARIANT_LENGTH_M, 50);
  const stub = indexOfLines([[{ x: 100, y: 100 }, { x: 140, y: 100 }]]);
  assert.eq(stub.dressingLines.length, 0, 'a 40 m lane wears no theme');
  assert.eq(stub.lines[0].variant, null);
  assert.eq(stub.lines[0].selectedVariant, 'hedgerow', 'though it rolled one');
  const fine = indexOfLines([[{ x: 100, y: 100 }, { x: 150, y: 100 }]]);
  assert.eq(fine.dressingLines.length, 1, 'a 50 m lane does');
  // A long road clipping a themed square's corner leaves a piece too short to lay.
  const clipped = indexOfLines([[{ x: -50, y: 100 }, { x: 1024 + 60, y: 100 }]], LONG_HEDGE);
  assert.eq(clipped.dressingLines.length, 1, 'the final 60 m fragment would theme only 24 m: omitted');
  const longer = indexOfLines([[{ x: -50, y: 100 }, { x: 1024 + 125, y: 100 }]], LONG_HEDGE);
  assert.eq(longer.dressingLines.length, 2, 'a 125 m fragment can fit a 50 m section');
});

test('street themes: a row may set its own limits — the Golden Road keeps its carpet to 250 m', () => {
  assert.eq(SV.sectionLimits('golden').maxM, 250);
  assert.eq(JSON.stringify(SV.sectionLimits('hedgerow')), JSON.stringify({ maxM: 500, minM: 50, share: 0.4 }), 'the defaults');
  assert.eq(JSON.stringify(SV.sectionLimits(null)), JSON.stringify(SV.sectionLimits('hedgerow')));
  const GOLD = nameWhere((n, k) => SV.variantFor(k, n, 'minor') === 'golden', 'Gold Road');
  const short = indexOfLines([[{ x: 100, y: 100 }, { x: 340, y: 100 }]], GOLD);
  assert.eq(short.dressingLines.length, 1, 'a 240 m golden road is carpeted end to end');
  assert.eq(short.dressingLines[0].patch, null);
  const over = indexOfLines([[{ x: 100, y: 100 }, { x: 500, y: 100 }]], GOLD);
  const themed = over.dressingLines.reduce((n, r) => n + Streets.lineLengthM(r.line, 1), 0);
  assert.truthy(over.dressingLines.every(r => r.patch !== null), 'a 400 m one is bounded by its own cap');
  assert.lte(themed, 250 + 1e-6, 'and no square carpets more than the row allows');
  assert.gt(themed, 0);
});

test('street themes: a winding patch caps total arclength and yields during interval matching', () => {
  const points=[];
  for(let y=32;y<450;y++) points.push({x:40,y},{x:450,y});
  const WINDING = nameWhere((n, k) => SV.variantFor(k, n, 'minor') === 'hedgerow', 'Winding Road');
  const layers=[
    {name:'transportation',extent:EXTENT,features:[{type:2,tags:{class:'minor'},geom:[points]}]},
    {name:'transportation_name',extent:EXTENT,features:[{type:2,tags:{name:WINDING},geom:[points]}]},
  ];
  const it=SV.buildIndexSteps(layers,TX,TY,1); let r, yields=0;
  do { r=it.next(); if(r.value === 'street theme interval geometry') yields++; } while(!r.done);
  const total=r.value.dressingLines.reduce((n,rec)=>n+Streets.lineLengthM(rec.line,1),0);
  assert.inRange(total,499.99,500.01,'one patch cannot hide more than500m of winding street');
  // Additional short source segments are tested against its clipped theme.
  assert.gt(yields,0,'the interval comparison loop cooperates with sliced world generation');
});

test('golden road: coins carpet both verges without overlapping occupied or blocked cells', () => {
  const name = nameWhere((n,k) => SV.variantFor(k,n,'minor') === 'golden', 'Golden Street');
  // Cells 10–42: a 224 m lane, inside the Golden Road's own 250 m section
  // cap (sectionLimits), so the carpet runs end to end.
  const line = pts([[10,25],[42,25]]), split = [line[0], pts([[26,25]])[0], line[1]];
  const build = (lines, blocked = false, occupied = new Set(), roadMask = new Uint8Array(CPE*CPE)) => {
    const index = indexOfLines(lines, name, TX, TY, TILE_EDGE_M / EXTENT);
    const spawnWhy = new Uint16Array(CPE*CPE);
    if (blocked) spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
    const opts = { roadMask, roadClass: new Uint8Array(CPE*CPE), spawnWhy, occupied };
    const grid = new Uint8Array(CPE*CPE).fill(T.PARK);
    const result = SV.dress({ index, tx:TX, ty:TY, N:CPE, tileEdgeM:TILE_EDGE_M, grid, spawnOpts:opts });
    return { result, opts };
  };
  const { result, opts } = build([line]);
  assert.eq(SV.VARIANT_BY_ID.golden.story, 'street_golden');
  assert.eq(SV.VARIANT_BY_ID.golden.art, 'street_golden', 'show coins along both verges');
  assert.eq(SV.VARIANT_BY_ID.snare.art, 'street_snare', 'show the chest and its traps');
  assert.eq(result.coins.length, 198, '33 cells along each of six verge rows are full');
  assert.eq(new Set(result.coins.map(c => c.id)).size, result.coins.length, 'one pickup per cell');
  assert.eq(JSON.stringify(result.coins), JSON.stringify(build([[split[2],split[1]],[split[1],split[0]]]).result.coins));
  const rows = new Map();
  for (const coin of result.coins) {
    const iy = cellOf(coin.y, TY);
    if (!rows.has(iy)) rows.set(iy, []);
    rows.get(iy).push(cellOf(coin.x, TX));
  }
  assert.eq(rows.size, 6, 'three dense rows on each side');
  for (const [iy, xs] of rows) {
    assert.falsy(iy === 25, 'roadway stays clear');
    assert.eq(xs.length, 33);
    xs.sort((a,b) => a-b);
    for (let i=1; i<xs.length; i++) assert.eq(xs[i]-xs[i-1], 1, 'no gaps along a verge');
  }
  const occupiedCell = cellOf(result.coins[0].y, TY)*CPE + cellOf(result.coins[0].x, TX);
  const occupiedResult = build([line], false, new Set([occupiedCell])).result;
  assert.eq(occupiedResult.coins.length, result.coins.length-1);
  assert.falsy(occupiedResult.coins.some(c => c.id === result.coins[0].id));
  const crossingRoad = new Uint8Array(CPE*CPE);
  for (let y=0; y<CPE; y++) crossingRoad[y*CPE+26] = 1;
  const crossingResult = build([line], false, new Set(), crossingRoad).result;
  assert.eq(crossingResult.coins.length, result.coins.length-6, 'crossing roadway cuts all six coin rows');
  assert.falsy(crossingResult.coins.some(c => cellOf(c.x, TX) === 26));
  for(const coin of result.coins) {
    const ix=cellOf(coin.x,TX), iy=cellOf(coin.y,TY);
    assert.eq(coin.id,WorldGen.cellId('golden_coin',TX,TY,ix,iy));
    assert.eq(coin.kind,'coindrop'); assert.eq(coin.amount,1); assert.truthy(coin.seeded);
    assert.truthy(opts.occupied.has(iy*CPE+ix),'coin reserves its cell before save filtering');
  }
  assert.eq(build([line],true).result.coins.length,0,'hard restrictions prevent coin placement');
});


test('thorny path: dense deterministic brambles cross their minor road and enclose selected shrines', () => {
  const nameFor = shrine => nameWhere((n,k) => SV.variantFor(k,n,'minor') === 'thorny'
    && SV.streetShrineChosen(k) === shrine, 'Bramble Lane');
  const line = pts([[10,25],[42,25]]), mid = pts([[26,25]])[0];
  const build = (name, lines = [line], blocked = false, occupied = new Set(), crossing = false) => {
    const index = indexOfLines(lines, name, TX, TY, TILE_EDGE_M / EXTENT);
    const roadMask = new Uint8Array(CPE*CPE), spawnWhy = new Uint16Array(CPE*CPE);
    for (let x=10; x<=42; x++) roadMask[25*CPE+x] = 1;
    if (crossing) for (let y=0; y<CPE; y++) roadMask[y*CPE+26] = 1;
    if (blocked) spawnWhy.fill(WorldGen.SPAWN_WHY.PRIVATE);
    const opts = { roadMask, spawnWhy, occupied, roadClass: new Uint8Array(CPE*CPE) };
    const grid = new Uint8Array(CPE*CPE).fill(T.PARK);
    for(let x=10;x<=42;x++) { grid[25*CPE+x]=T.ROAD; spawnWhy[25*CPE+x] |= WorldGen.SPAWN_WHY.ROAD | WorldGen.SPAWN_WHY.TERRAIN; }
    const result = SV.dress({ index, tx:TX, ty:TY, N:CPE, tileEdgeM:TILE_EDGE_M,
      grid, spawnOpts: opts });
    return { result, opts };
  };
  const name = nameFor(false), { result, opts } = build(name);
  assert.eq(SV.VARIANT_BY_ID.thorny.title, 'Thorny Way');
  assert.eq(SV.VARIANT_BY_ID.thorny.code, SV.VARIANT_BY_ID.snare.code + 1, 'append preserves existing codes');
  assert.eq(SV.THORNY_VERGE_MAX_CELLS, 4);
  assert.inRange(result.wildplants.length / 264, 0.6, 0.95, 'dense irregular verges reach up to four cells');
  assert.eq(new Set(result.wildplants.map(p => p.id)).size, result.wildplants.length, 'unique shrubs');
  assert.eq(JSON.stringify(result), JSON.stringify(build(name, [[line[1],mid],[mid,line[0]]]).result),
    'reversal and fragments keep identical generated content');
  for (const plant of result.wildplants) {
    const ix=cellOf(plant.x,TX), iy=cellOf(plant.y,TY);
    assert.eq(plant.crop, 'shrub'); assert.eq(plant._streetArt, 'bramble');
    if (opts.roadMask[iy*CPE+ix]) assert.eq(iy,25,'only this authored road is crossed');
    assert.truthy(opts.occupied.has(iy*CPE+ix));
    assert.eq(plant.id, WorldGen.cellId('bramble',TX,TY,ix,iy));
  }
  const first = result.wildplants[0], occupiedCell = cellOf(first.y,TY)*CPE+cellOf(first.x,TX);
  assert.lt(build(name,[line],false,new Set([occupiedCell])).result.wildplants.length,result.wildplants.length,'occupied cells terminate their outward ray');
  const wall = new Set(Array.from({length:33},(_,x)=>27*CPE+x+10));
  const stopped = build(name,[line],false,wall).result;
  assert.falsy(stopped.wildplants.some(p=>cellOf(p.y,TY)>=27),'an obstacle band prevents brambles appearing behind it');
  assert.truthy(result.wildplants.some(p=>cellOf(p.y,TY)===25),'brambles span their road');
  assert.falsy(build(name,[line],false,new Set(),true).result.wildplants.some(p=>cellOf(p.x,TX)===26&&cellOf(p.y,TY)!==25),'a crossing road terminates the outward ray');
  assert.eq(build(name,[line],true).result.wildplants.length,0,'private land cannot host brambles');
  assert.eq(result.objects.filter(o=>o.kind==='grove_shrine').length,0,'unselected street has no shrine');

  const shrineName = nameFor(true), shrineResult = build(shrineName).result;
  const shrines = shrineResult.objects.filter(o=>o.kind==='grove_shrine');
  assert.eq(shrines.length,1,'selected street seats one shrine');
  const shrine = shrines[0], sx=cellOf(shrine.x,TX), sy=cellOf(shrine.y,TY);
  assert.eq(shrine.shrineKind, Shrines.kindForStreet('thorny'));
  const cells = new Set(shrineResult.wildplants.map(p=>cellOf(p.y,TY)*CPE+cellOf(p.x,TX)));
  assert.falsy(cells.has(sy*CPE+sx),'shrine seat stays free');
  for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) {
    if(dx || dy) assert.truthy(cells.has((sy+dy)*CPE+sx+dx),'two complete cuttable rings enclose the shrine');
  }
  assert.eq(JSON.stringify(shrineResult),JSON.stringify(build(shrineName,[[line[1],mid],[mid,line[0]]]).result));
  assert.eq(build(shrineName,[line],true).result.objects.filter(o=>o.kind==='grove_shrine').length,0,
    'private land cannot host the shrine');
});

test('snare lane: a deterministic central T3 cave cache surrounded by reserved traps', () => {
  const name = nameWhere((n,k) => SV.variantFor(k,n,'minor') === 'snare', 'Snare Street');
  const line = pts([[10,25],[54,25]]), middle = pts([[32,25]])[0];
  const build = (lines, blocked = false, occupied = new Set()) => {
    const index = indexOfLines(lines, name, TX, TY, TILE_EDGE_M / EXTENT);
    const spawnWhy = new Uint16Array(CPE*CPE);
    if (blocked) spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
    const roadMask = new Uint8Array(CPE*CPE), roadClass = new Uint8Array(CPE*CPE);
    const grid = new Uint8Array(CPE*CPE).fill(T.PARK);
    for (let x=10; x<=54; x++) { roadMask[25*CPE+x]=1; grid[25*CPE+x]=T.ROAD; }
    const opts = {roadMask, roadClass, spawnWhy, occupied};
    return {result: SV.dress({index,tx:TX,ty:TY,N:CPE,tileEdgeM:TILE_EDGE_M,grid,spawnOpts:opts}), opts, grid};
  };
  const {result,opts,grid} = build([line]);
  assert.eq(result.objects.length,1);
  const deterministicSnapshot = JSON.stringify(result);
  const chest=result.objects[0];
  assert.eq(chest.kind,'chest'); assert.eq(chestTier(chest),3);
  assert.eq(chestLook(chest).texKey,'chest'); assert.falsy(restocks(chest));
  assert.falsy(chest.depth,'the cache remains a surface object');
  assert.eq(chestLootDepth(chest),1,'the reward picker uses the canonical cave mix');
  assert.eq(chestLootDepth({depth:4}),4,'ordinary underground chests retain their depth');
  assert.eq(cellOf(chest.x,TX),32,'reward halfway along the street');
  assert.eq(result.traps.length,24,'two complete trap rings around the central reward');
  const occupied=new Set();
  for(const o of [chest,...result.traps]) {
    const ix=cellOf(o.x,TX),iy=cellOf(o.y,TY),i=iy*CPE+ix;
    assert.falsy(occupied.has(i)); occupied.add(i);
    assert.truthy(opts.occupied.has(i)); assert.falsy(opts.roadMask[i]);
    assert.truthy(WorldGen.isSpawnCell(grid,CPE,CPE,ix,iy,{...opts,occupied:new Set()},'fastEnemy'));
    if(o!==chest) { assert.eq(o._ix,ix); assert.eq(o._iy,iy); }
  }
  assert.eq(deterministicSnapshot,JSON.stringify(build([[line[1],middle],[middle,line[0]]]).result),
    'reversed, fragmented geometry keeps the cache and traps');
  assert.eq(build([line],true).result.objects.length,0,'restricted ground holds no reward');
  assert.eq(build([line],true).result.traps.length,0);
  assert.eq(build([line],false,new Set(Array.from({length:CPE*CPE},(_,i)=>i))).result.objects.length,0,
    'occupied ground holds no reward');
  const picked=build([line]).result;
  assert.eq(JSON.stringify(result.traps),JSON.stringify(picked.traps),'reload uses stable trap identities');
});

test('barricade scenery adds stakes and barriers without multiplying guards', () => {
  const { d } = dressedVariants();
  assert.gt(d.wildplants.filter((o) => o._streetScenery && o.crop === 'barricade').length, 4);
  assert.gt(d.objects.filter((o) => o._streetScenery && o.kind === 'stakes').length, 2);
  assert.eq(d.lairs.filter((o) => o.tier === 'barricade').length, 1);
});
test('hedgerow encounters: one stable post holds two ordinary slimes per street and tile', () => {
  const {d}=dressed(rasterize());
  const posts=d.lairs.filter(l=>l.tier==='street_hedgerow');
  assert.eq(posts.length,1);
  assert.eq(JSON.stringify(posts),JSON.stringify(dressed(rasterize()).d.lairs.filter(l=>l.tier==='street_hedgerow')));
  assert.eq(Lairs.STREET_TIER_GUARDS.street_hedgerow,2);
  assert.eq(Lairs.KIND_ORDER.street_hedgerow.join(','),'slime');
  assert.falsy(Lairs.DAILY_TIERS.has('street_hedgerow'),'defeated slimes do not reset daily');
  const N=64,edge=N*7,grid=new Uint8Array(N*N).fill(WorldGen.T.GRASS);
  const entry={cellsPerEdge:N,grid,objects:[],buildingShapes:[],_spawnOpts:{occupied:new Set(),roadMask:new Uint8Array(N*N),spawnWhy:new Uint16Array(N*N)}};
  const cand={tier:'street_hedgerow',sid:'hedge-slime-test',tx:0,ty:0,ox:0,oy:0,lx:32.5*7,ly:32.5*7,ix:32,iy:32,halfW:0,halfH:0};
  const wake=(caughtSet)=>Lairs.garrisonFor(entry,cand,{tileEdgeM:edge,caughtSet});
  const guards=wake();
  assert.eq(guards.length,2);assert.truthy(guards.every(g=>g.kind==='slime'));
  assert.eq(JSON.stringify(wake()),JSON.stringify(guards),'guard positions and IDs repeat');
  assert.eq(wake(new Set(guards.map(g=>g.id))).length,0,'caught ledger spends both guards');
  for(const guard of guards) entry._spawnOpts.occupied.add(Math.floor(guard.y/7)*N+Math.floor(guard.x/7));
  const blockedSeats=wake();
  assert.truthy(blockedSeats.every(g=>!entry._spawnOpts.occupied.has(Math.floor(g.y/7)*N+Math.floor(g.x/7))),'occupied seats, including lamps, stay clear');
  entry._spawnOpts.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
  assert.eq(wake().length,0,'hard spawn reasons prevent the pair');
});
test('themed street encounters: one finite spider post per street and tile, outside the kerb', () => {
  const { d, r } = dressedVariants();
  const posts = d.lairs.filter(l => l.tier === 'street_toadstool');
  assert.eq(posts.length, 1);
  const again = dressedVariants().d.lairs.filter(l => l.tier === 'street_toadstool');
  assert.eq(JSON.stringify(posts), JSON.stringify(again));
  for (const p of posts) {
    const ix = Math.floor(p.lx / (TILE_EDGE_M / CPE)), iy = Math.floor(p.ly / (TILE_EDGE_M / CPE));
    assert.falsy(inBuf(r, iy * CPE + ix));
  }
});



// Affinities alter which theme wins, never whether a road is special.
test('street affinity: context and names preserve the rarity gate for every key', () => {
  let orchardPlain = 0, orchardAligned = 0;
  for (let i = 0; i < 10000; i++) {
    const key = `affinity-road-${i}`;
    const neutral = SV.variantFor(key, null, 'minor');
    const aligned = SV.variantFor(key, null, 'minor', { cultivated: 1 });
    const named = SV.variantFor(key, 'Cherry Lane', 'minor', { cultivated: 1 });
    assert.eq(!!neutral, !!aligned, 'context cannot turn an ordinary road special');
    assert.eq(!!neutral, !!named, 'name cannot turn an ordinary road special');
    if (neutral === 'orchard') orchardPlain++;
    if (aligned === 'orchard') orchardAligned++;
  }
  assert.gt(orchardAligned, orchardPlain * 1.1, 'cultivated ground favours orchards across the fixed eligible keys');
  const chance = context => SV.selectionWeights(null, 'minor', context).find(r => r.id === 'orchard').probability;
  assert.gt(chance({cultivated:1}), chance(null), 'the weighted probability increases independently of hash sampling');
});

test('street affinity: conditional probabilities are normalized and retain alternatives', () => {
  const rows = SV.selectionWeights(null, 'minor', { cultivated: .6, woodland: .3, neutral: .1 });
  assert.inRange(rows.reduce((n, r) => n + r.probability, 0), .999999, 1.000001);
  const orchard = rows.find(r => r.id === 'orchard');
  assert.gt(orchard.contextMultiplier, 1);
  assert.truthy(rows.every(r => r.probability > 0), 'affinities never ban an eligible variant');
  assert.eq(SV.selectionWeights(null, 'path', { coastal: 1 }).length, 0, 'scenic paths keep geography selection');
});

test('street affinity: final coverage overrides halo ownership and length weights split context', () => {
  const N = 10, coverage = new Uint16Array(N * N), idx = new Uint8Array(N * N).fill(2);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) coverage[y*N+x] = x < 5 ? 1 : 2;
  const zone = { coverage, idx, anchors: [
    { kind: 'grove', variant: 'orchard' }, { kind: 'grove', variant: 'mushroom_grove' },
  ] };
  const rec = { key: 'mixed', affinityKey: 'mixed', size: 'minor', name: null,
    variantEligible: true, line: [{ x: 10, y: 50 }, { x: 90, y: 50 }] };
  const index = { extent: 100, lines: [rec] };
  for (const _ of SV.applyAffinitiesSteps(index, zone, N, 1)) {}
  assert.inRange(rec.affinityContext.cultivated, .24, .26, 'half the road is orchard; its two traits share that weight');
  assert.inRange(Object.values(rec.affinityContext).reduce((a,b) => a+b,0), .999999, 1.000001);
  assert.eq(rec.variant, SV.variantFor(rec.affinityKey, null, 'minor', rec.affinityContext));
});

test('street affinity: duplicates, reversed geometry and feature order keep one road choice', () => {
  const zone = { coverage: new Uint16Array(100).fill(1), anchors: [{ kind: 'grove', variant: 'orchard' }] };
  const line = [{x:10,y:50},{x:40,y:50}];
  const second = [{x:40,y:50},{x:90,y:50}];
  const make = (lines) => ({ extent:100, lines:lines.map(line => ({ line, key:'same', affinityKey:'same', size:'minor', variantEligible:true })) });
  const a = make([line,second]), b = make([second.slice().reverse(),line.slice().reverse(),line]);
  for (const index of [a,b]) for (const _ of SV.applyAffinitiesSteps(index,zone,10,1)) {}
  assert.eq(JSON.stringify(a.lines[0].affinityContext), JSON.stringify(b.lines[0].affinityContext));
  assert.truthy([...a.lines,...b.lines].every(r => r.variant === a.lines[0].variant));
  const excluded = { ...a.lines[0], variant: null, variantEligible:false };
  for (const _ of SV.applyAffinitiesSteps({extent:100,lines:[excluded]},zone,10,1)) {}
  assert.eq(excluded.variant,null,'length/seam exclusions cannot be revived');
});
test('street affinity: Golden Road retains its fixed share under every context', () => {
  for (const context of [{ cultivated: 1 }, { woodland: 1 }, { formal: 1 }]) {
    const golden = SV.selectionWeights('Cherry Lane', 'minor', context).find(r => r.id === 'golden');
    assert.inRange(golden.probability, .049999, .050001);
    for (let i = 0; i < 1000; i++) {
      const key = 'golden-affinity-' + i;
      assert.eq(SV.variantFor(key, null, 'minor') === 'golden',
        SV.variantFor(key, 'Cherry Lane', 'minor', context) === 'golden');
    }
  }
});

test('street affinity: local dressing follows the choice and bounded patches keep neutral identity', () => {
  const zone = { coverage: new Uint16Array(100).fill(1), anchors: [{ kind: 'grove', variant: 'orchard' }] };
  const line = [{x:10,y:50},{x:90,y:50}];
  const local = { key:'local', affinityKey:'local', size:'minor', variantEligible:true, line };
  const bounded = { key:'bounded', affinityKey:'bounded', size:'minor', variantEligible:false, variant:'hedgerow', line };
  const index = { extent:100, lines:[local,bounded], dressingLines:[{...local},{...bounded}] };
  for (const _ of SV.applyAffinitiesSteps(index,zone,10,1)) {}
  assert.eq(index.dressingLines[0].variant,local.variant);
  assert.eq(index.dressingLines[1].variant,'hedgerow');
  assert.eq(bounded.affinityContext,undefined);
});

test('street styles: patch gaps stay plain for paving and lamp consumers', () => {
  const line = [{x:0,y:0},{x:100,y:0}];
  const rec = {fi:0,li:0,line,size:'minor',variant:'golden',variantRanges:[[20,80]]};
  const styles = SV.lineStyles({streetIndex:{lines:[rec]}},{geom:[line]},0,0,2);
  assert.eq(JSON.stringify(styles.map(p=>[p.a,p.b,p.variant])),JSON.stringify([[0,40,null],[40,160,'golden'],[160,200,null]]));
});

function paintVerge(ctx) {
  const it = SV.paintTerrainSteps(ctx);
  let result = it.next();
  while (!result.done) result = it.next();
  return result.value;
}
function vergeFixture(variant = 'overgrown') {
  const N = 12;
  const grid = new Uint8Array(N*N).fill(T.GRASS);
  const roadMask = new Uint8Array(N*N), spawnWhy = new Uint16Array(N*N);
  for (let x=1;x<11;x++) grid[6*N+x]=T.ROAD,roadMask[6*N+x]=1;
  return { N, grid, roadMask, spawnWhy, index: {extent:N, dressingLines:[{
    key:'road', variant, halfW:3.5, line:[{x:1.5,y:6.5},{x:10.5,y:6.5}]
  }]}};
}
test('street terrain: agreed biome rows paint one and a half cells beyond road geometry', () => {
  for (const [variant, terrain] of Object.entries({hedgerow:T.PARK,overgrown:T.FOREST,
    orchard:T.ORCHARD,pilgrim:T.ROCK,lantern:T.COMMERCIAL,burned:T.INDUSTRIAL,
    barricade:T.WASTELAND,toadstool:T.WETLAND,golden:T.ROCK,promenade:T.SAND,
    greenway:T.GRASS,parkpath:T.PARK})) {
    assert.eq(SV.terrainFor(variant),terrain);
    const f=vergeFixture(variant), painted=paintVerge(f);
    assert.eq(f.grid[5*12+5],terrain);
    assert.eq(f.grid[7*12+5],terrain);
    assert.eq(f.grid[4*12+5],terrain,'new half-cell reaches the outer cell centre');
    assert.eq(f.grid[8*12+5],terrain,'both sides widen');
    assert.eq(painted[4*12+5],1);
    assert.eq(f.grid[3*12+5],T.GRASS,'outside the wider band');
    assert.eq(f.grid[6*12+5],T.ROAD,'road stays road');
    assert.eq(painted[5*12+5],1);
  }
});
test('street terrain: themed ground fills the roadway footprint without changing road rules', () => {
  const f=vergeFixture('overgrown'), N=f.N;
  f.streetGround=new Uint8Array(N*N);
  // A wide band partly covers ordinary terrain cells; the visible strip
  // outside the pavement must not keep its original grass.
  f.index.dressingLines[0].halfW=8;
  f.roadMask[5*N+5]=1;
  f.spawnWhy[5*N+5]=WorldGen.SPAWN_WHY.ROAD;
  f.spawnWhy[6*N+5]=WorldGen.SPAWN_WHY.ROAD | WorldGen.SPAWN_WHY.TERRAIN;
  const mask=Array.from(f.roadMask), reasons=Array.from(f.spawnWhy);
  const painted=paintVerge(f);
  assert.eq(f.grid[5*N+5],T.FOREST,'masked biome cells inherit the theme');
  assert.eq(painted[5*N+5],1);
  assert.eq(f.grid[6*N+5],T.ROAD,'road identity remains intact');
  assert.eq(f.streetGround[6*N+5],T.FOREST+1,'road backdrop is explicit, not neighbour-voted');
  assert.eq(JSON.stringify(Array.from(f.roadMask)),JSON.stringify(mask));
  assert.eq(JSON.stringify(Array.from(f.spawnWhy)),JSON.stringify(reasons));
  const path=vergeFixture('greenway');path.grid[6*N+5]=T.PATH;
  path.streetGround=new Uint8Array(N*N);paintVerge(path);
  assert.eq(path.streetGround[6*N+5],T.GRASS+1,'grass zero is distinct from an unset backdrop');
  assert.eq(path.grid[6*N+5],T.PATH);
});

test('street terrain: water, buildings, access and special zones take precedence', () => {
  const f=vergeFixture('promenade'), N=f.N;
  f.grid[5*N+2]=T.WATER;f.grid[5*N+3]=T.BUILDING;f.grid[5*N+4]=T.PATH;
  f.spawnWhy[5*N+5]=WorldGen.SPAWN_WHY.PRIVATE;
  f.spawnWhy[5*N+6]=WorldGen.SPAWN_WHY.RESTRICTED;
  f.zone={coverage:new Uint16Array(N*N),under:new Uint8Array(N*N)};
  f.zone.coverage[5*N+7]=1; f.zone.under[5*N+8]=T.PARK;
  const before=Array.from(f.grid), reasons=JSON.stringify(Array.from(f.spawnWhy));
  paintVerge(f);
  for(let x=2;x<=8;x++) assert.eq(f.grid[5*N+x],before[5*N+x]);
  assert.eq(f.grid[5*N+9],T.SAND);
  assert.eq(JSON.stringify(Array.from(f.spawnWhy)),reasons);
});
test('street terrain: intersections are independent of road ordering', () => {
  const f=vergeFixture(), other={...f.index.dressingLines[0],key:'another',variant:'golden'};
  f.index.dressingLines.push(other);
  const a={...f,grid:f.grid.slice()};paintVerge(a);
  f.index.dressingLines.reverse();paintVerge(f);
  assert.eq(JSON.stringify(Array.from(f.grid)),JSON.stringify(Array.from(a.grid)));
});
test('street terrain: rasterization preserves original affinity and cave inputs', () => {
  const painted=WorldGen.rasterizeTile(layers(),CPE,TX,TY,TILE_EDGE_M);
  const actual=SV.paintTerrainSteps;
  let baseline;
  try {
    SV.paintTerrainSteps=function*({N}) {return new Uint8Array(N*N);};
    baseline=WorldGen.rasterizeTile(layers(),CPE,TX,TY,TILE_EDGE_M);
  } finally {SV.paintTerrainSteps=actual;}
  assert.eq(JSON.stringify(painted.caveSource),JSON.stringify(baseline.caveSource));
  assert.eq(JSON.stringify(painted.streetIndex),JSON.stringify(baseline.streetIndex));
  assert.eq(JSON.stringify(painted.spawnWhy),JSON.stringify(baseline.spawnWhy));
});

test('street terrain: scenic intervals paint only their selected path span', () => {
  const f=vergeFixture();f.index.dressingLines=[];
  const feature={id:9,type:2,tags:{class:'path'},geom:[[{x:1.5,y:6.5},{x:10.5,y:6.5}]]};
  f.transportation={extent:12,features:[feature]};
  f.scenic={ext:12,lines:new Map([[Streets.lineKey(feature,0),[[2,5,'shore']]]])};
  paintVerge(f);
  assert.eq(f.grid[5*12+5],T.SAND);
  assert.eq(f.grid[5*12+9],T.GRASS,'outside scenic interval stays original');
});

test('street shrines: chosen streets seat safely and independently without a tile cap', () => {
  const build = (streets, chosen = true, blocked = false) => {
    const indexes = streets.map(([v, y]) => {
      const name = nameWhere((n, k) => SV.variantFor(k, n, 'minor') === v
        && SV.streetShrineChosen(k) === chosen, `Shrine ${v}`);
      return indexOfLines([pts([[10, y], [54, y]])], name, TX, TY, TILE_EDGE_M / EXTENT);
    });
    const index = { ...indexes[0], lines: indexes.flatMap(i => i.lines),
      dressingLines: indexes.flatMap(i => i.dressingLines), hoardPois: [] };
    const roadMask = new Uint8Array(CPE*CPE), grid = new Uint8Array(CPE*CPE).fill(T.PARK);
    for (const [, y] of streets) for (let x=10; x<=54; x++) { roadMask[y*CPE+x]=1; grid[y*CPE+x]=T.ROAD; }
    const opts = { roadMask, roadClass: new Uint8Array(CPE*CPE), spawnWhy: new Uint16Array(CPE*CPE), occupied: new Set() };
    if (blocked) opts.spawnWhy.fill(WorldGen.SPAWN_WHY.PRIVATE);
    const result = SV.dress({ index, tx:TX, ty:TY, N:CPE, tileEdgeM:TILE_EDGE_M, grid, spawnOpts: opts });
    return { result, grid, roadMask };
  };
  const { result, grid, roadMask } = build([['orchard', 25]]);
  const shrines = result.objects.filter(o => o.kind === 'grove_shrine');
  assert.eq(shrines.length, 1, 'one shrine for the orchard street');
  assert.eq(shrines[0].shrineKind, Shrines.kindForStreet('orchard'));
  assert.eq(shrines[0]._shrineStreet, 'orchard');
  const ix = cellOf(shrines[0].x, TX), iy = cellOf(shrines[0].y, TY);
  assert.falsy(roadMask[iy*CPE+ix], 'off the road');
  assert.truthy(WorldGen.isSpawnCell(grid, CPE, CPE, ix, iy,
    { roadMask, roadClass: new Uint8Array(CPE*CPE), spawnWhy: new Uint16Array(CPE*CPE), occupied: new Set() }, 'attractor'),
    'an attractor seat: open ground outside every buffer');
  assert.eq(JSON.stringify(shrines), JSON.stringify(build([['orchard', 25]]).result.objects.filter(o => o.kind === 'grove_shrine')),
    'stable rebuild');
  const many = build([['orchard', 10], ['toadstool', 30], ['overgrown', 50]]).result.objects.filter(o => o.kind === 'grove_shrine');
  assert.eq(many.length, 3, 'every selected street seats, even above the former cap: ' + many.map(o => o._shrineStreet).join(','));
  const reversed = build([['overgrown', 50], ['toadstool', 30], ['orchard', 10]]).result.objects.filter(o => o.kind === 'grove_shrine');
  assert.eq(JSON.stringify(many), JSON.stringify(reversed), 'street input order does not choose winners');
  assert.eq(build([['orchard', 25]], false).result.objects.filter(o => o.kind === 'grove_shrine').length, 0,
    'the other half receive no shrine');
  assert.eq(build([['orchard', 25]], true, true).result.objects.filter(o => o.kind === 'grove_shrine').length, 0,
    'selected streets still cannot place on private ground');
  const plain = build([['overgrown', 25]]).result.objects.filter(o => o.kind === 'grove_shrine');
  assert.eq(plain[0].shrineKind, 'moss_cairn');
});

test('street shrines: half of canonical street keys qualify and every road variant has a kind', () => {
  assert.eq(Shrines.STREET_SHRINE_CHANCE, 0.5);
  let chosen = 0;
  for (let i = 0; i < 10000; i++) {
    const name = 'Shrine frequency ' + i;
    const key = SV.streetKey(name, TX, TY);
    if (SV.streetShrineChosen(key)) chosen++;
    assert.eq(SV.streetShrineChosen(key), SV.streetShrineChosen(SV.streetKey(name, TX + 1, TY)),
      'adjacent tiles agree on a named street');
  }
  assert.inRange(chosen / 10000, 0.45, 0.55, 'roughly half, without a tile-density cap');
  for (const row of SV.STREET_VARIANTS.filter(row => ['minor', 'major'].includes(row.size))) {
    assert.truthy(Shrines.kindForStreet(row.id), row.id + ' has a shrine kind');
  }
});

test('authored street obstacles: only declared minor-road seats relax the road gate', () => {
  const W=WorldGen, grid=new Uint8Array([T.ROAD]), roadMask=new Uint8Array([1]);
  const mask=new Uint16Array([W.SPAWN_WHY.ROAD|W.SPAWN_WHY.TERRAIN]);
  const opts={roadMask,spawnWhy:mask,occupied:new Set(),roadClass:new Uint8Array(1),streetObstacleCells:new Set([0])};
  const ok=cls=>W.isSpawnCell(grid,1,1,0,0,opts,cls);
  assert.truthy(ok('streetObstacle'));
  for(const cls of W.SPAWN_CLASSES.filter(c=>c!=='streetObstacle')) assert.falsy(ok(cls),'ordinary '+cls+' still refuses road');
  opts.streetObstacleCells.clear();assert.falsy(ok('streetObstacle'));opts.streetObstacleCells.add(0);
  for(const reason of ['PRIVATE','RESTRICTED','QUIET','KINDERGARTEN','KERB']) {
    mask[0]|=W.SPAWN_WHY[reason];assert.falsy(ok('streetObstacle'),reason);mask[0]&=~W.SPAWN_WHY[reason];
  }
  opts.occupied.add(0);assert.falsy(ok('streetObstacle'));opts.occupied.clear();
  opts.roadClass[0]=W.ROAD_CLASS_MAJOR_BAND;assert.falsy(ok('streetObstacle'));opts.roadClass[0]=0;
  for(const t of [T.WATER,T.BUILDING,T.ROAD_MD,T.ROAD_LG]) {grid[0]=t;assert.falsy(ok('streetObstacle'),'terrain '+t);}
  opts.streetObstacleKind='barricade';opts.roadClass[0]=W.ROAD_CLASS_MAJOR_BAND;
  mask[0]|=W.SPAWN_WHY.KERB;
  assert.truthy(ok('streetObstacle'),'declared barricade pieces cross their major road');
  opts.streetObstacleCells.clear();assert.falsy(ok('streetObstacle'),'no exception beyond declared crossing');
  opts.streetObstacleCells.add(0);grid[0]=T.BUILDING;assert.falsy(ok('streetObstacle'),'barricades still stop at buildings');
});

test('barricade scenery: perpendicular lines reach four cells from the verge', () => {
  const {d}=dressedVariants();
  const pieces=[...d.objects,...d.wildplants].filter(o=>o._street==='barricade'&&o._streetScenery);
  const rows=new Map();
  for(const o of pieces){const y=cellOf(o.y,TY);if(!rows.has(y))rows.set(y,[]);rows.get(y).push(cellOf(o.x,TX));}
  assert.truthy([...rows.values()].some(xs=>xs.length>=6),'multiple pieces form cross-road lines');
  assert.truthy(pieces.some(o=>o.kind==='stakes'));
  assert.truthy(pieces.some(o=>o.crop==='barricade'));
  assert.eq(SV.BARRICADE_VERGE_MAX_CELLS,4);
});

test('barricades cross rasterized major roads, including diagonal pavement beyond the band center', () => {
  for (const roadClass of ['secondary', 'primary', 'motorway']) {
    for (const diagonal of [false, true]) {
      const line = diagonal
        ? [{ x: 32 * CELL_MVT, y: 32 * CELL_MVT }, { x: 55 * CELL_MVT, y: 55.5 * CELL_MVT }]
        : pts([[32, 32], [32, 63]]);
      const r = WorldGen.rasterizeTile([
        { name: 'landuse', features: [{ type: 3, tags: { class: 'park' }, geom: [wholeTile()] }] },
        { name: 'transportation', extent: EXTENT, features: [
          { type: 2, tags: { class: roadClass }, geom: [line] },
        ] },
        { name: 'transportation_name', extent: EXTENT, features: [
          { type: 2, tags: { name: BARR }, geom: [line] },
        ] },
      ], CPE, TX, TY, TILE_EDGE_M);
      const pieces = [...r.streetDress.objects, ...r.streetDress.wildplants]
        .filter(o => o._street === 'barricade' && o._streetScenery);
      const occupied = new Set(pieces.map(o => cellOf(o.y, TY) * CPE + cellOf(o.x, TX)));
      // The second diagonal crossing reaches this paved tile whose center
      // is outside a secondary road's 4.5 m half-width. Treating it as verge
      // used to reject its road terrain and stop the barrier mid-crossing.
      const x = diagonal ? 34 : 32, y = diagonal ? 33 : 35, i = y * CPE + x;
      assert.truthy(WorldGen.isRoadTerrain(r.grid[i]), `${roadClass}: fixture checks actual pavement`);
      assert.truthy(r.spawnWhy[i] & WorldGen.SPAWN_WHY.TERRAIN, 'ordinary terrain spawn exclusion remains');
      assert.truthy(occupied.has(i), `${roadClass}: barrier covers ${diagonal ? 'diagonal' : 'straight'} road tile`);
      assert.truthy(pieces.some(o => r.roadMask[cellOf(o.y, TY) * CPE + cellOf(o.x, TX)]),
        'barriers survive the full terrain/mask/dressing pipeline on the drawn band');
    }
  }
});

})();
