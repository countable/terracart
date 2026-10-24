// Street variants (src/street_variants.js) and the old trade roads.
//
// What this file holds still:
//   · THE KEY: a street is a name inside a parish — the same on both sides of
//     a tile seam (its lineKeys differ), different across a parish line, and
//     an unnamed way keys off its own geometry.
//   · THE ROLL: minor streets retain their rarity; paths have a separate light theme pool.
//   · ROCKS line only the chosen minor streets, never a hedgerow.
//   · DRESSING sits off the band and off anything already there, from
//     position-derived ids, the same set every time.
//   · THE OLD TRADE ROAD (internally "bandit"): a LOOK only since the Sep 2026
//     safety pass — a bus stop by a medium band wears the wagon with its id
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
const ROCKY = nameWhere((n, k) => SV.variantFor(k, n, 'minor') === 'rocky_path', 'Rock Road');

// The fixture's two cafés: one in the open meadow (row 40, col 25), one
// hugging the trade road's EAST kerb (col 47, row 56).
const CAFE_OPEN = [25, 40], CAFE_KERB = [47, 56];
const CAFES = [
  { type: 1, tags: { class: 'cafe', name: 'Open Cup' }, geom: [pts([CAFE_OPEN])] },
  { type: 1, tags: { class: 'cafe', name: 'Kerb Cup' }, geom: [pts([CAFE_KERB])] },
];
// Meadow ground (no private-yard rule in the way) with: a rock-lined minor
// street along row 12, a hedgerow minor street along row 50 from a junction
// with an unnamed minor street down col 10 to a DEAD END at col 30, a
// trade road down col 44, and two bus stops — one beside the motorway, one far
// from any major way.
function layers() {
  const tr = [
    { type: 2, tags: { class: 'minor' }, geom: [pts([[0, 12], [CPE - 1, 12]])] },
    { type: 2, tags: { class: 'minor' }, geom: [pts([[10, 20], [10, CPE - 1]])] },
    { type: 2, tags: { class: 'minor' }, geom: [pts([[10, 50], [20, 50], [30, 50]])] },
    { type: 2, tags: { class: 'secondary' }, geom: [pts([[44, 0], [44, CPE - 1]])] },
  ];
  const tn = [
    { type: 2, tags: { name: ROCKY }, geom: [pts([[0, 12], [CPE - 1, 12]])] },
    { type: 2, tags: { name: HEDGE }, geom: [pts([[10, 50], [20, 50], [30, 50]])] },
  ];
  return [
    { name: 'landcover', features: [{ type: 3, tags: { class: 'meadow' }, geom: [wholeTile()] }] },
    { name: 'transportation', extent: EXTENT, features: tr },
    { name: 'transportation_name', extent: EXTENT, features: tn },
    { name: 'poi', features: [
      { type: 1, tags: { class: 'bus', name: 'Stop A' }, geom: [pts([[46, 30]])] },
      { type: 1, tags: { class: 'bus', name: 'Stop B' }, geom: [pts([[20, 30]])] },
      ...CAFES,
    ] },
  ];
}
// Street placement tests need open ground. Ordinary meadow flora has its
// own coverage tests; keep its fill from obscuring road densities and café
// seats while retaining the real terrain, roads, shared gates and dressing.
function openStreetTile(sourceLayers) {
  const flora = BiomeProfiles.flora, fill = { ...BiomeProfiles.GRASS_FILL };
  try {
    BiomeProfiles.flora = (terrain, ...args) => terrain === T.GRASS ? [] : flora(terrain, ...args);
    Object.assign(BiomeProfiles.GRASS_FILL, { dMin: 0, dMax: 0, dense: 0 });
    return WorldGen.rasterizeTile(sourceLayers, CPE, TX, TY, TILE_EDGE_M);
  } finally {
    BiomeProfiles.flora = flora;
    Object.assign(BiomeProfiles.GRASS_FILL, fill);
  }
}
const rasterize = () => openStreetTile(layers());
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
test('variants: minor streets and path sections use their normalized theme pools over 40k keys', () => {
  const N = 40000;
  for (const size of ['minor', 'major', 'path']) {
    const got = {};
    for (let i = 0; i < N; i++) {
      const v = SV.variantFor(`plain street ${i}|0,0`, null, size);
      if (v) got[v] = (got[v] || 0) + 1;
    }
    for (const row of SV.STREET_VARIANTS) {
      const share = (got[row.id] || 0) / N;
      if (size === 'path' ? !row.pathWeight : row.size !== size) {
        assert.eq(share, 0, `${row.id} never rolls on a ${size} street`); continue;
      }
      const weights = SV.selectionWeights(null, size, null, !!row.baseline);
      const totalShare = size === 'path' ? 1 : size === 'minor' ? (row.baseline ? 1 - SV.MINOR_VARIANT_SHARE : SV.MINOR_VARIANT_SHARE) : 0;
      const expected = (weights.find(w => w.id === row.id)?.probability || 0) * totalShare;
      assert.inRange(share, expected - 0.015, expected + 0.015, `${row.id} share on ${size}`);
    }
  }
  assert.eq(SV.variantFor('x|0,0', 'x', null), null, 'a way of neither size is plain');
});

test('variants: paths select authored path and shared ordinary themes', () => {
  const expected = SV.STREET_VARIANTS.filter(row => row.pathWeight > 0);
  const weights = SV.selectionWeights(null, 'path');
  assert.eq(weights.length, expected.length);
  const total = expected.reduce((sum, row) => sum + row.pathWeight, 0);
  for (const row of weights) assert.inRange(row.probability,
    SV.VARIANT_BY_ID[row.id].pathWeight / total - 1e-9,
    SV.VARIANT_BY_ID[row.id].pathWeight / total + 1e-9);
  for (const context of [null, { hostile: 1 }, { woodland: 1 }, { coastal: 1 }]) {
    for (let i = 0; i < 1000; i++) {
      const variant = SV.variantFor(`path-only-${i}`, 'Ember Kiln Cherry Golden Road', 'path', context);
      assert.truthy(SV.VARIANT_BY_ID[variant]?.pathWeight > 0);
    }
  }
});

test('variants: medium and large roads stay plain; Lantern Row and barricades belong to paths', () => {
  assert.eq(SV.VARIANT_BY_ID.burned.size, 'minor');
  assert.eq(SV.VARIANT_BY_ID.lantern.size, 'path');
  assert.eq(SV.VARIANT_BY_ID.barricade.size, 'path');
  assert.eq(SV.VARIANT_BY_ID.lantern.share, 0.12);
  for (const klass of ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']) {
    const size = SV.sizeOfTags({ class: klass });
    for (let i = 0; i < 1000; i++) {
      assert.eq(SV.variantFor(`burn-swap-${i}`, 'Ember Kiln Lantern Gate Road', size), null,
        'names cannot put any variant on a medium or large road');
    }
  }
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
  assert.eq(SV.sizeOfTags({ class: 'service' }), 'minor', 'driveways and alleys receive ordinary variants');
  assert.eq(SV.sizeOfTags({ class: 'footway' }), 'path', 'footpaths receive section variants');
  assert.eq(SV.sizeOfTags({ class: 'rail' }), null, 'a railway is not a street');
});

test('variants: only normal minor streets roll generic roadside rocks', () => {
  let rocks = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const k = `st ${i}|0,0`;
    if (SV.rocksFor(k, 'minor', null)) rocks++;
    for (const row of SV.STREET_VARIANTS) {
      assert.falsy(SV.rocksFor(k, 'minor', row.id), `${row.id} excludes generic rocks`);
    }
  }
  assert.inRange(rocks / N, SV.ROCK_STREET_SHARE - 0.02, SV.ROCK_STREET_SHARE + 0.02);
  assert.falsy(SV.rocksFor('st 1|0,0', 'major', null), 'a major road never is');
});

// ── The index and the rocks ─────────────────────────────────────────────
test('index: the fixture\'s streets roll as searched, and its cafés are the hoard POIs', () => {
  const r = rasterize();
  const byName = (n) => r.streetIndex.lines.find((l) => l.name === n);
  assert.eq(byName(ROCKY).variant, 'rocky_path', 'ordinary roads have a named variant');
  assert.eq(byName(HEDGE).variant, 'hedgerow', 'the hedge street is a hedgerow');
  const major = r.streetIndex.lines.filter((l) => l.size === 'major');
  assert.eq(major.length, 1, 'the secondary road is the one major line');
  assert.eq(r.streetIndex.closes, undefined, 'no dead-end closes any more — the hoard left the hedgerow');
  const hp = r.streetIndex.hoardPois;
  assert.eq(hp.length, 2, 'both cafés, and nothing else (the bus stops are not commercial)');
  for (const p of hp) {
    assert.eq(p.gk, `${TX * EXTENT + p.x},${TY * EXTENT + p.y}`, 'keyed on the GLOBAL MVT point');
  }
  assert.truthy(SV.hoardPick(hp[0].gk) <= SV.hoardPick(hp[1].gk), 'sorted by the point\'s own hash');
  assert.truthy(r.streetIndex.roadClass === r.roadClass, 'the stamp pass leaves the tile\'s roadClass on the index');
});

function dressRockyRoute(r) {
  return dressed({ ...r, streetIndex: { ...r.streetIndex,
    lines: r.streetIndex.lines.filter(rec => rec.name === ROCKY),
    dressingLines: r.streetIndex.dressingLines.filter(rec => rec.name === ROCKY),
  } }).d;
}
test('rocks: the rocky route keeps its common stone off the road band', () => {
  const r = rasterize();
  const rocks = dressRockyRoute(r).objects.filter((o) => o.kind === 'mineralrock' && o._street === 'rocky_path');
  assert.gt(rocks.length, 5, 'the rock street is lined');
  for (const o of rocks) {
    assert.truthy(o._street, `${o.id} is a street rock`);
    assert.truthy(o.id.includes('rocky_path'), `${o.id} belongs to the rocky variant`);
    assert.eq(o.requiredTier, 1);
    assert.eq(o.yieldTier, 1);
    const iy = cellOf(o.y, TY);
    assert.inRange(iy, 12 - 5, 12 + 5, `${o.id} sits on the rock street's verge, not elsewhere`);
    assert.eq(r.roadMask[iy * CPE + cellOf(o.x, TX)], 0, `${o.id} is off the band`);
  }
});

// ── Dressing ────────────────────────────────────────────────────────────
test('rocks: the simple rocky route scatters common stone finds along both verges', () => {
  const r = rasterize(), d = dressRockyRoute(r);
  const finds = [...d.objects, ...d.wildplants].filter(o => o._street === 'rocky_path');
  const lenM = (CPE - 1) * WorldGen.CELL_M;
  assert.gt(finds.length, 0, 'the street is lined');
  const per = lenM / finds.length;
  assert.inRange(per, 10, 13, `one common find per ${per.toFixed(1)} m on open ground`);
  assert.truthy(finds.every(o => o.kind === 'mineralrock' || ['flint', 'rubble'].includes(o.crop)), 'only common stone finds');
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

test('hedgerow: fully hedged on both verges, no gaps, and tidy around obstacles', () => {
  const rec = {variant:'hedgerow', key:'manicured', halfW:4, line:pts([[5,30],[47,30]])};
  const grid = new Uint8Array(CPE * CPE).fill(T.GRASS);
  const draw = (occupied = new Set(), spawnWhy = new Uint16Array(CPE * CPE)) => SV.dress({
    index:{extent:EXTENT,lines:[rec]}, tx:TX,ty:TY,N:CPE,tileEdgeM:TILE_EDGE_M,grid,
    spawnOpts:{occupied,spawnWhy,roadMask:new Uint8Array(CPE * CPE)},
  }).wildplants;
  const rows = draw();
  const north = rows.filter(p => cellOf(p.y,TY) < 30).map(p => cellOf(p.x,TX));
  const south = rows.filter(p => cellOf(p.y,TY) > 30).map(p => cellOf(p.x,TX));
  assert.eq(north.join(','),south.join(','),'the two rows match across the road');
  assert.eq(new Set(rows.map(p => cellOf(p.y,TY))).size,2,'one fixed row on each side');
  const sorted = north.slice().sort((a,b)=>a-b);
  assert.eq(new Set(sorted).size, sorted.length, 'one hedge per kerb cell');
  assert.eq(sorted.length, sorted[sorted.length-1]-sorted[0]+1, 'no gaps: every kerb cell along the lane is hedged');
  assert.gt(sorted.length, 30, 'the whole covered length');
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
  assert.truthy(open && open.guarded, 'the café in the open meadow holds a guarded hoard');
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
  const layers5 = [{ name: 'landcover', features: [{ type: 3, tags: { class: 'meadow' }, geom: [wholeTile()] }] },
    { name: 'transportation', extent: EXTENT, features: [] }, poi('cafe', five)];
  const r = openStreetTile(layers5);
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
  assert.eq(SV.BANDIT_STORY.title, 'Old Trade Road');
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
  const lairs = SV.markBanditStops(r.objects, r.roadClass, CPE, TX, TY, TILE_EDGE_M, { grid: r.grid, streetIndex: r.streetIndex, cellsPerEdge: CPE });
  assert.eq(stops.map((o) => o.id).join('|'), idsBefore, 'ids untouched');
  const near = stops.find((o) => cellOf(o.x, TX) > 40), far = stops.find((o) => cellOf(o.x, TX) < 40);
  assert.truthy(near.banditStop, 'the trade-road stop is stamped');
  assert.eq(chestLook(near).texKey, 'wagon', 'the trade-road stop is a broken wagon');
  assert.truthy(chestLook(near).wagon && !chestLook(near).box, 'and nothing else');
  assert.eq(chestLook(far).texKey, looksBefore[stops.indexOf(far)], 'the park stop keeps its look');
  assert.eq(lairs.length, 0, 'NO guard post — no wagon goblins at all (the owner, Sep 2026)');
  assert.truthy(SV.isWagonStop(near.id), 'this fixture\'s trade-road stop is one the hash picks');
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
  SV.markBanditStops(objs, r.roadClass, CPE, TX, TY, TILE_EDGE_M, { grid: r.grid, streetIndex: r.streetIndex, cellsPerEdge: CPE });
  assert.falsy(plain.banditStop, 'not stamped');
  assert.eq(chestLook(plain).texKey, chestLook(Object.assign({}, near, { banditStop: false, id: plain.id })).texKey,
    'it wears the bus-stop look');
  assert.eq(SV.isWagonStop(near.id), SV.isWagonStop(String(near.id)), 'the id decides');
});

test('ancient highway: bus stops retain their chest appearance', () => {
  const ls = layers();
  ls.find(l => l.name === 'transportation').features.find(f => f.tags.class === 'secondary').tags.class = 'motorway';
  const r = openStreetTile(ls);
  const stops = r.objects.filter(o => o.kind === 'chest' && o.poiClass === 'bus');
  assert.gt(stops.length, 0);
  SV.markBanditStops(r.objects, r.roadClass, CPE, TX, TY, TILE_EDGE_M, { grid: r.grid, streetIndex: r.streetIndex, cellsPerEdge: CPE });
  assert.truthy(stops.every(o => !o.banditStop), 'large highways have no themed wagon stops');
});

test('old trade road: ordinary Major road ground has no population profile', () => {
  assert.falsy(HabitatSpawns.landProfile(T.ROAD_MAJOR));
  for (const row of SV.STREET_VARIANTS.filter(row => row.size === 'major'))
    assert.eq(HabitatSpawns.faunaRows(HabitatSpawns.roadProfile(row.id)).length, 0);
});

test('Road Variant fauna: declared residents have valid species and local count ranges', () => {
  const known = new Set([...FAUNA_ORDER, ...SHORE_FAUNA_ORDER, 'rabbit']);
  for (const row of SV.STREET_VARIANTS) for (const [kind, range] of Object.entries(row.fauna || {})) {
    assert.truthy(known.has(kind), `${row.id}: declared resident is a creature`);
    assert.truthy(range.length === 2 && range.every(n => Number.isInteger(n) && n >= 0) && range[0] <= range[1]);
  }
  assert.eq(JSON.stringify(SV.VARIANT_BY_ID.orchard.fauna.rabbit), '[2,5]');
  assert.eq(JSON.stringify(SV.VARIANT_BY_ID.pilgrim.fauna.crow), '[2,5]');
  for (const row of SV.STREET_VARIANTS.filter(row => row.size === 'path'))
    assert.falsy(HabitatSpawns.roadProfile(row.id), 'scenic paths are not population owners');
});


test('sports pitches keep generated Deer on their Forest habitat', () => {
  const N = 32, grid = new Uint8Array(N * N).fill(T.FOREST);
  for (let i = 0; i < N * N; i++) if (i % N < N / 2) grid[i] = T.PITCH;
  const e = { cellsPerEdge: N, tileEdgeM: N * 7, grid, spawnWhy: new Uint16Array(N * N) };
  const out = WorldGen.runSteps(HabitatSpawns.populationSteps({ tileEdgeM: N * 7, cellM: 7 }, e, 0, 0, { spawnOpts: { spawnWhy: e.spawnWhy, occupied: new Set() } }));
  assert.truthy(out.some(c => c.kind === 'deer'));
  for (const c of out.filter(c => c.kind === 'deer')) assert.eq(grid[c._habitatSpawn.cy * N + c._habitatSpawn.cx], T.FOREST);
});

// ── Toadstool Lane, the barricade's goblins, the burned row's fire slimes ──
const TOAD = nameWhere((n, k) => SV.variantFor(k, n, 'minor') === 'toadstool', 'Pale Lane');
const BARR = 'Gate Path';
function withBarricadePaths(build) {
  const original = SV.variantFor;
  try {
    SV.variantFor = (key, name, size, context) => size === 'path' ? 'barricade' : original(key, name, size, context);
    return build();
  } finally { SV.variantFor = original; }
}
const BURN = nameWhere((n, k) => SV.variantFor(k, n, 'minor') === 'burned', 'Kiln Road');
function variantLayers() {
  const toad = pts([[0, 20], [CPE - 1, 20]]);
  const barr = pts([[40, 30], [40, CPE - 1]]);     // one owned end inside (row 30)
  const burn = pts([[20, 0], [20, CPE - 1]]);
  return [
    { name: 'landcover', features: [{ type: 3, tags: { class: 'meadow' }, geom: [wholeTile()] }] },
    { name: 'transportation', extent: EXTENT, features: [
      { type: 2, tags: { class: 'minor' }, geom: [toad] },
      { type: 2, tags: { class: 'path' }, geom: [barr] },
      { type: 2, tags: { class: 'minor' }, geom: [burn] },
    ] },
    { name: 'transportation_name', extent: EXTENT, features: [
      { type: 2, tags: { name: TOAD }, geom: [toad] },
      { type: 2, tags: { name: BARR }, geom: [barr] },
      { type: 2, tags: { name: BURN }, geom: [burn] },
    ] },
  ];
}
const dressedVariants = () => {
  const r = withBarricadePaths(() => WorldGen.rasterizeTile(variantLayers(), CPE, TX, TY, TILE_EDGE_M));
  return Object.assign({ r }, dressed(r));
};

test('toadstool lane: a minor row at 5%, its verge holds glowing mushrooms with occasional giant caps', () => {
  const row = SV.VARIANT_BY_ID.toadstool;
  assert.eq(row.size, 'minor'); assert.eq(row.share, 0.05);
  assert.eq(row.story, 'street_toadstool', 'its painting stem');
  // Appended after the seven older rows (code 8), and only the never-rolled
  // scenic 'path' rows (src/scenic.js) after it: no older row's code moves.
  assert.eq(row.code, 8, 'appended: no older row\'s code moves');
  assert.truthy(SV.STREET_VARIANTS.slice(row.code).every((r) => r.baseline || r.size === 'path' || r.id === 'golden' || r.id === 'snare' || r.id === 'thorny' || r.id === 'goblin_gang' || r.id === 'berry' || r.id === 'pottery' || r.id === 'trade'), 'new rows append without changing existing codes');
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
  assert.inRange(plants.filter((w) => w.crop === 'giant_mushroom').length / plants.length, 0.17, 0.35,
    'large caps appear in two of every three groups while small caps remain the majority');
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
  const blocked = withBarricadePaths(() => WorldGen.rasterizeTile(variantLayers(), CPE, TX, TY, TILE_EDGE_M));
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

test('street sight: a told variant entering the lit radius pops its map line once, at its nearest lit cell', () => {
  const start = SCENE_SRC.indexOf('\n  _tickStreetSight() {');
  const body = SCENE_SRC.slice(SCENE_SRC.indexOf('{', start) + 1, SCENE_SRC.indexOf('\n  }\n', start));
  const tick = new Function('reachRadiusM', 'playerReachCell', 'cellInReach', 'absCellToTile', 'WorldGen', 'StreetVariants', 'STREET_FLASH_GAP_MS', body);
  const row = SV.VARIANT_BY_ID.snare, N = 32, marks = new Uint8Array(N * N);
  const entry = { _spawned: true, streetMarks: marks };
  const WG = { tileKey: () => 'k', tileCache: new Map([['k', entry]]) };
  const scene = { cellM: 7, save: { storySeen: {} }, at: { cellIX: 10, cellIY: 10 }, pops: [],
    flashAtCell(text, ix, iy) { this.pops.push({ text, ix, iy }); } };
  const reach = 2.5 * 7 + 1;
  const inReach = (sc, ix, iy) => Math.hypot(ix - sc.at.cellIX, iy - sc.at.cellIY) * 7 <= reach;
  const toTile = (sc, ix, iy, o) => Object.assign(o, { tx: 0, ty: 0, ix, iy, n: N });
  const run = () => tick.call(scene, () => reach, (sc) => sc.at, inReach, toTile, WG, SV, 60000);
  for (let x = 0; x < N; x++) marks[14 * N + x] = row.code;   // a snare street along row 14
  run(); assert.eq(scene.pops.length, 0, 'out of reach');
  scene.at = { cellIX: 10, cellIY: 12 }; run();
  assert.eq(scene.pops.length, 0, 'an untold variant waits for the feet\'s story');
  scene.save.storySeen[row.story] = 1; scene.at = { cellIX: 10, cellIY: 10 }; run();
  scene.at = { cellIX: 10, cellIY: 12 }; run();
  assert.eq(scene.pops.length, 1, 'a told one pops as it comes into the light');
  assert.eq(scene.pops[0].text, row.flash);
  assert.eq(scene.pops[0].ix, 10); assert.eq(scene.pops[0].iy, 14);
  scene.at = { cellIX: 11, cellIY: 12 }; run();
  assert.eq(scene.pops.length, 1, 'walking along it in the light does not repeat');
  scene.at = { cellIX: 11, cellIY: 10 }; run(); scene.at = { cellIX: 11, cellIY: 12 }; run();
  assert.eq(scene.pops.length, 1, 'back within the street gap stays quiet');
  assert.truthy(/this\._tickStreetSight\(\)/.test(SCENE_SRC.slice(SCENE_SRC.indexOf('\n  _tickStreetFeet() {'))), 'read on every feet-cell change');
});

// ── One end piece per street per tile (Sep 2026) ───────────────────────────
// A path arrives cut into many short lines. The ends are pooled by street key and ONE seats per (street, tile): the end
// whose hash endPick is lowest and that seats. Pilgrim fragments share a puzzle set.
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
    { name: 'landcover', features: [{ type: 3, tags: { class: 'meadow' }, geom: [wholeTile()] }] },
    { name: 'transportation', extent: EXTENT, features: [
      ...barr.map((g) => ({ type: 2, tags: { class: 'path' }, geom: [g] })),
      ...pilg.map((g) => ({ type: 2, tags: { class: 'minor' }, geom: [g] })),
    ] },
    { name: 'transportation_name', extent: EXTENT, features: [
      ...barr.map((g) => ({ type: 2, tags: { name: BARR }, geom: [g] })),
      ...pilg.map((g) => ({ type: 2, tags: { name: PILG }, geom: [g] })),
    ] },
  ];
}
test('barricade + pilgrim: fragmented streets share one barricade and one compact waystone set', () => {
  const r = withBarricadePaths(() => WorldGen.rasterizeTile(piecewiseLayers(), CPE, TX, TY, TILE_EDGE_M));
  const lines = r.streetIndex.lines;
  assert.eq(lines.filter((l) => l.variant === 'barricade').length, 4, 'four barricade pieces');
  assert.eq(lines.filter((l) => l.variant === 'pilgrim').length, 3, 'three pilgrim pieces');
  const { d } = dressed(r);
  const bars = d.wildplants.filter((w) => w.crop === 'barricade' && !w._streetScenery);
  const ways = d.objects.filter((o) => o.kind === 'waystone');
  assert.eq(bars.length, 1, 'one barricade for the street in this tile');
  assert.eq(d.lairs.filter((L) => L.tier === 'barricade').length, 1, 'and one goblin');
  assert.truthy(ways.length >= 3 && ways.length <= 6, 'three to six stones for this pilgrim way');
  assert.eq(new Set(ways.map(o => o.waystoneSet)).size, 1, 'fragments share one puzzle');
  assert.truthy(ways.every(o => o.waystoneCount === ways.length), 'actual set count travels with every stone');
  assert.eq(new Set(ways.map(o => o.id)).size, ways.length, 'distinct occupied cells');
  assert.truthy(ways.every(o => Math.hypot(cellOf(o.x, TX) - cellOf(ways[0].x, TX),
    cellOf(o.y, TY) - cellOf(ways[0].y, TY)) <= 10), 'all stones are near the anchor');
  // Deterministic, and off a hash of the street + the end's GLOBAL point.
  const again = dressed(withBarricadePaths(() => WorldGen.rasterizeTile(piecewiseLayers(), CPE, TX, TY, TILE_EDGE_M))).d;
  assert.eq(JSON.stringify(again.objects.filter(o => o.kind === 'waystone')), JSON.stringify(ways), 'stable puzzle across rebuilds');
  assert.eq(again.wildplants.filter((w) => w.crop === 'barricade' && !w._streetScenery)[0].id, bars[0].id, 'the same end every build');
  assert.truthy(/hash01\(`end\|\$\{grp\.v\}\|\$\{grp\.key\}\|\$\{gk\}`\)/.test(ALL_SRC['street_variants.js']),
    'the pick hashes variant, street key and the global end point');
});

test('pilgrim sets: insufficient safe seats create no stones or partial occupancy', () => {
  const r = withBarricadePaths(() => WorldGen.rasterizeTile(piecewiseLayers(), CPE, TX, TY, TILE_EDGE_M));
  const baseline = dressed(r).d.objects.filter(o => o.kind === 'waystone');
  const free = new Set(baseline.slice(0, 2).map(o => cellOf(o.y, TY) * CPE + cellOf(o.x, TX)));
  const occupied = new Set(Array.from({ length: CPE * CPE }, (_, i) => i).filter(i => !free.has(i)));
  const countBefore = occupied.size;
  const d = SV.dress({ index: { ...r.streetIndex,
    lines: r.streetIndex.lines.filter(l => l.variant === 'pilgrim'),
    dressingLines: r.streetIndex.dressingLines?.filter(l => l.variant === 'pilgrim'),
    hoardPois: [], vehicleLines: [] },
    tx: TX, ty: TY, N: CPE, tileEdgeM: TILE_EDGE_M, grid: r.grid,
    spawnOpts: { roadMask: r.roadMask, occupied, pois: [] } });
  assert.eq(d.objects.filter(o => o.kind === 'waystone').length, 0, 'two legal seats cannot form a set');
  assert.eq(occupied.size, countBefore, 'rejected puzzle claims no seats');
});

test('short street dressing: fixed timber species with mixed orchard rows and pine growth', () => {
  for (const v of ['orchard', 'overgrown']) {
    const name = nameWhere((n, k) => SV.variantFor(k, n, 'minor') === v, v);
    const line = pts([[2, 30], [60, 30]]);
    const ls = [
      { name: 'landcover', features: [{ type: 3, tags: { class: 'meadow' }, geom: [wholeTile()] }] },
      { name: 'transportation', extent: EXTENT, features: [{ type: 2, tags: { class: 'minor' }, geom: [line] }] },
      { name: 'transportation_name', features: [{ type: 2, tags: { name }, geom: [line] }] },
    ];
    const r = WorldGen.rasterizeTile(ls, CPE, TX, TY, TILE_EDGE_M);
    const d = dressed(r).d;
    const trees = d.objects.filter((o) => o._street === v);
    assert.gt(trees.length, 15, v + ' dresses the full short street');
    const timber = trees.filter(o => o.kind === 'tree');
    assert.truthy(timber.every(o => o.treeSpeciesFixed === true && o.species === SV.VARIANT_BY_ID[v].treeSpecies),
      'the variant owns every timber tree species');
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
      assert.truthy(trees.every((o) => o.kind === 'tree' && o.species === 'pine'), 'overgrown lanes use pine throughout');
    }
  }
});

function indexOfLines(lines, name = HEDGE, tx = TX, ty = TY, mvtToM = 1) {
  return SV.buildIndex([
    { name: 'transportation', extent: EXTENT, features: lines.map(line => ({ type: 2, tags: { class: 'minor' }, geom: [line] })) },
    { name: 'transportation_name', extent: EXTENT, features: name ? lines.map(line => ({ type: 2, tags: { name }, geom: [line] })) : [] },
  ], tx, ty, mvtToM);
}
const specialLines = index => index.dressingLines.filter(r => !r.baselineGap);
const themeGeometry = index => JSON.stringify(index.dressingLines.map(r => ({ key: r.key, variant: r.variant, line: r.line, patch: r.patch })));

function pathIndex(features) {
  return SV.buildIndex([{ name: 'transportation', extent: EXTENT, features:
    features.map(f => ({ type: 2, tags: { class: 'path' }, ...f })) }], TX, TY, 1);
}
const pathSectionGeometry = index => JSON.stringify(index.pathSections.map(rec => ({
  key: rec.key, line: rec.line, variant: rec.variant, segmentLengthM: rec.segmentLengthM,
})));

test('path sections: geographic scenic majority overrides selection without fragmenting the section', () => {
  const index = pathIndex([{ id: 8, geom: [[{x:100,y:100},{x:220,y:100}]] }]);
  assert.eq(index.pathSections.length, 1);
  const section = index.pathSections[0];
  section.variant = 'lantern';
  SV.syncPathVariants(index);
  const rec = index.lines[0], originalKey = section.key;
  const classify = length => {
    const scenic = { lines: new Map([[rec.lineKey, [[0,length,'shore']]]]) };
    for (const _ of SV.applyPathScenicSteps(index, scenic)) {}
  };
  classify(50);
  assert.eq(section.variant, 'lantern', 'minority scenery retains the chosen path theme');
  classify(80);
  assert.eq(section.variant, 'promenade', 'majority shore scenery chooses the light coastal path');
  assert.eq(index.pathSections.length, 1);
  assert.eq(section.key, originalKey);
  assert.truthy(rec.variantSegments.every(part => part.variant === 'promenade'),
    'rendered source intervals inherit the whole-section geographic choice');
});

test('path sections: source endpoints guide assignment and reversed duplicates are stable', () => {
  const a = {x:100,y:100}, b = {x:400,y:100}, c = {x:750,y:100};
  const whole = pathIndex([{ id: 10, geom: [[a,c]] }]);
  const split = pathIndex([{ id: 12, geom: [[c,b]] }, { id: 11, geom: [[b,a]] }, { id: 12, geom: [[b,c]] }]);
  assert.gt(whole.pathSections.length, 1, 'long source spans gain inferred splits');
  assert.truthy(split.pathSections.some(rec => rec.line.some(p => p.x === b.x)),
    'a well-spaced source endpoint remains available as a boundary');
  assert.eq(pathSectionGeometry(split), pathSectionGeometry(pathIndex([{id:11,geom:[[a,b]]},{id:12,geom:[[b,c]]}])));
  assert.gt(split.pathSections.length, 0);
  assert.eq(split.pathSections.reduce((sum,rec) => sum + rec.segmentLengthM, 0), 650, 'duplicate source lines add no length');
  assert.eq([...new Set(split.pathSections.flatMap(rec => rec.featureIds))].sort().join(), '11,12',
    'joined sections retain identifiers of their contributing features');
  assert.truthy(split.lines.every(rec => rec.size === 'path' && Array.isArray(rec.variantSegments)),
    'source fragments keep section intervals for rasterization');
});

test('path sections: adding an earlier fork preserves downstream boundary identities', () => {
  const features = [
    {id:1,geom:[[{x:100,y:100},{x:1300,y:100}]]},
    {id:2,geom:[[{x:700,y:100},{x:700,y:180}]]},
  ];
  const before = pathIndex(features);
  const after = pathIndex([...features, {id:3,geom:[[{x:200,y:100},{x:200,y:180}]]}]);
  const downstream = index => index.pathSections.filter(rec =>
    rec.line.every(p => p.x >= 700 && p.y === 100));
  assert.gt(after.pathSections.length, before.pathSections.length, 'the new fork adds earlier boundaries');
  assert.gt(downstream(before).length, 0, 'there are downstream sections to compare');
  assert.eq(JSON.stringify(downstream(after).map(rec => [rec.key, rec.variant, rec.line])),
    JSON.stringify(downstream(before).map(rec => [rec.key, rec.variant, rec.line])),
    'an earlier split cannot renumber or reroll unchanged downstream sections');
});

test('path sections: a branch preserves the straight route and is stable under source ordering', () => {
  const a={x:100,y:100}, b={x:500,y:100}, c={x:900,y:100}, d={x:500,y:400};
  const features=[{id:1,geom:[[a,b]]},{id:2,geom:[[b,c]]},{id:3,geom:[[b,d]]}];
  const index=pathIndex(features);
  const reversed=pathIndex(features.slice().reverse().map(f=>({...f,geom:f.geom.map(line=>line.slice().reverse())})));
  assert.eq(pathSectionGeometry(index),pathSectionGeometry(reversed));
  assert.inRange(index.pathSections.reduce((sum,rec)=>sum+rec.segmentLengthM,0),1099.999999,1100.000001);
  assert.truthy(index.pathSections.every(rec=>rec.line.every(p=>p.y===100)||rec.line.every(p=>p.x===500)),
    'the branch never turns the straight route into a bent assignment');
});

test('path sections: an interior T junction matches an explicit vertex without bending the through route', () => {
  const a={x:100,y:100}, b={x:1200,y:100}, c={x:2300,y:100}, d={x:1200,y:700};
  const implicit=pathIndex([{id:1,geom:[[a,c]]},{id:2,geom:[[b,d]]}]);
  const explicit=pathIndex([{id:2,geom:[[d,b]]},{id:1,geom:[[c,b,a]]}]);
  assert.eq(pathSectionGeometry(implicit),pathSectionGeometry(explicit),
    'an endpoint on a segment interior connects identically to an authored vertex');
  assert.inRange(implicit.pathSections.reduce((sum,rec)=>sum+rec.segmentLengthM,0),2799.999999,2800.000001);
  for(const rec of implicit.pathSections) {
    assert.gt(rec.segmentLengthM,0);
    assert.truthy(rec.line.every(p=>p.y===100)||rec.line.every(p=>p.x===1200),
      'the straight through route never turns into the side branch');
  }
});

test('path sections: a closed loop has an inferred seam, not a trail end', () => {
  const line = [{x:100,y:100},{x:400,y:100},{x:400,y:400},{x:100,y:400},{x:100,y:100}];
  const index = pathIndex([{id:46,geom:[line]}]);
  const reversed = pathIndex([{id:46,geom:[line.slice().reverse()]}]);
  assert.eq(pathSectionGeometry(index), pathSectionGeometry(reversed), 'loop cuts are direction independent');
  assert.inRange(index.pathSections.reduce((sum,rec) => sum + rec.segmentLengthM, 0),1199.999999,1200.000001);
  assert.truthy(index.pathSections.every(rec => rec.segmentLengthM <= 550), 'loop sections obey the length limit');
  const boundaries = index.pathSections.flatMap(rec => [
    {reason:rec.startReason,inferred:rec.startInferred},
    {reason:rec.endReason,inferred:rec.endInferred},
  ]);
  assert.eq(boundaries.filter(p => p.reason === 'Loop seam').length, 2, 'both sides identify the loop seam');
  assert.truthy(boundaries.filter(p => p.reason === 'Loop seam').every(p => p.inferred), 'the seam is inferred');
  assert.truthy(boundaries.every(p => p.reason !== 'Path end'), 'closed loops have no true trail ends');
});

test('path sections: disconnected lines and different bridge levels stay separate', () => {
  const index = pathIndex([
    { id: 31, geom: [[{x:100,y:100},{x:400,y:100}]] },
    { id: 32, tags: {class:'path',layer:1,brunnel:'bridge'}, geom: [[{x:400,y:100},{x:700,y:100}]] },
    { id: 31, geom: [[{x:100,y:600},{x:400,y:600}]] },
  ]);
  assert.eq(index.pathSections.length, 3, 'neither an identifier nor a projected endpoint joins disconnected levels');
  assert.truthy(index.pathSections.every(rec => rec.featureIds.length === 1 && rec.segmentLengthM === 300));
});

test('path sections: long uniform spans balance length and preserve all geometry', () => {
  for (const length of [179, 180, 1000, 1001, 2199, 3500]) {
    const index = pathIndex([{id:44,geom:[[{x:100,y:100},{x:100+length,y:100}]]}]);
    const sections = index.pathSections;
    if (length <= 180) assert.eq(sections.length, 1, 'short true-end spans survive');
    else assert.inRange(length / sections.length, 250, 380, 'uniform spans average near 300 m');
    assert.inRange(sections.reduce((sum,rec) => sum + rec.segmentLengthM, 0), length-1e-6, length+1e-6,
      'all path length is assigned to sections');
    for (const rec of sections) {
      assert.inRange(rec.segmentLengthM, Math.min(length,180)-1e-6, 550+1e-6);
      assert.inRange(Streets.lineLengthM(rec.line,1), rec.segmentLengthM-1e-6, rec.segmentLengthM+1e-6);
    }
    const reversed = pathIndex([{id:44,geom:[[{x:100+length,y:100},{x:100,y:100}]]}]);
    assert.eq(pathSectionGeometry(index), pathSectionGeometry(reversed), 'inferred cuts are direction independent');
  }
});

function pathIndexWithContext(contextAt) {
  const index = pathIndex([{id:45,geom:[[{x:100,y:100},{x:900,y:100}]]}]);
  for (const _ of SV.buildPathSectionsSteps(index, TX, TY, 1, contextAt)) {}
  return index;
}

test('path sections: a sustained affinity transition attracts a nearby split', () => {
  const index = pathIndexWithContext(p => p.x < 400 ? {woodland:1} : {coastal:1});
  const boundaries = index.pathSections.flatMap(rec => [rec.line[0], rec.line[rec.line.length-1]]);
  assert.truthy(boundaries.some(p => Math.abs(p.x-400) <= 20),
    'a sustained woodland-to-coast transition near 300 m gets a boundary');
  assert.truthy(index.pathSections.every(rec => rec.segmentLengthM >= 180 && rec.segmentLengthM <= 550));
  const before = pathSectionGeometry(index);
  const dressingCount = index.dressingLines.length;
  for (const _ of SV.buildPathSectionsSteps(index, TX, TY, 1,
    p => p.x < 400 ? {woodland:1} : {coastal:1})) {}
  assert.eq(pathSectionGeometry(index), before, 'rebuilding affinity sections is deterministic');
  assert.eq(index.dressingLines.length, dressingCount, 'rebuilding does not duplicate path dressing');
});

test('path sections: a brief affinity patch does not create a transition split', () => {
  const plain = pathIndexWithContext(() => ({woodland:1}));
  const patch = pathIndexWithContext(p => p.x >= 390 && p.x < 410 ? {coastal:1} : {woodland:1});
  assert.eq(pathSectionGeometry(patch), pathSectionGeometry(plain),
    'a 20 m terrain patch is too brief to redirect boundaries');
});

test('path sections: tiny junction approaches merge without dropping branches or joining gaps', () => {
  const features = [
    {id: 51, geom: [[{x:100,y:100},{x:900,y:100}]]},
    {id: 52, geom: [[{x:110,y:100},{x:110,y:125}]]},
    {id: 53, geom: [[{x:120,y:100},{x:120,y:125}]]},
    {id: 54, geom: [[{x:890,y:100},{x:890,y:125}]]},
  ];
  const index = pathIndex(features);
  const through = index.pathSections.filter(r => r.line.every(p => p.y === 100));
  assert.truthy(through.every(r => r.segmentLengthM >= SV.PATH_SECTION_MIN_M),
    '10 m approaches and the gap between close forks belong to longer through sections');
  assert.inRange(index.pathSections.reduce((n,r)=>n+r.segmentLengthM,0),874.999,875.001,
    'merging preserves every metre of the main path and all three branches');
  assert.eq(index.pathSections.filter(r => Math.abs(r.segmentLengthM-25)<1e-6).length,3,
    'actual short dead ends remain separate');
  assert.eq(pathSectionGeometry(index), pathSectionGeometry(pathIndex(features.slice().reverse()
    .map(f=>({...f,geom:[f.geom[0].slice().reverse()]})))), 'source direction and ordering cannot change merges');
  const separate = pathIndex([
    {id:61,geom:[[{x:100,y:100},{x:120,y:100}]]},
    {id:62,geom:[[{x:121,y:100},{x:500,y:100}]]},
  ]);
  assert.truthy(separate.pathSections.some(r=>r.segmentLengthM===20), 'a one-metre gap is never bridged');
});

test('path sections: close optional endpoints are thinned deterministically and forks stay short', () => {
  const xs=[100,350,400,450,700,950];
  const features=xs.slice(1).map((x,i)=>({id:i+1,geom:[[{x:xs[i],y:100},{x,y:100}]]}));
  const index=pathIndex(features);
  assert.eq(pathSectionGeometry(index),pathSectionGeometry(pathIndex(features.slice().reverse().map(f=>({...f,geom:[f.geom[0].slice().reverse()]})))));
  assert.truthy(index.pathSections.length < features.length, 'close boundaries are removed');
  assert.truthy(index.pathSections.every(r=>r.segmentLengthM>=180-1e-6));
  assert.inRange(index.pathSections.reduce((n,r)=>n+r.segmentLengthM,0),849.999,850.001);
  const fork=pathIndex([{id:1,geom:[[{x:100,y:100},{x:900,y:100}]]},
    {id:2,geom:[[{x:200,y:100},{x:200,y:180}]]}]);
  assert.gt(fork.pathSections.length,3, 'fork and length boundaries both split the through path');
  assert.truthy(fork.pathSections.some(r=>Math.abs(r.segmentLengthM-80)<1e-6), 'short branch survives');
  assert.truthy(fork.pathSections.some(r=>Math.abs(r.segmentLengthM-100)<1e-6), 'short approach to fork survives');
});

test('street themes: 40% of all minor keys, with name bias only selecting identity', () => {
  let plain = 0, named = 0, golden = 0, namedGolden = 0;
  const n = 40000;
  for (let i = 0; i < n; i++) {
    const key = `road eligibility ${i}|0,0`;
    const a = SV.variantFor(key, null, 'minor');
    const b = SV.variantFor(key, 'Cherry Church Golden Lane', 'minor');
    plain += !SV.VARIANT_BY_ID[a]?.baseline; named += !SV.VARIANT_BY_ID[b]?.baseline; golden += a === 'golden'; namedGolden += b === 'golden';
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
  assert.eq(specialLines(whole).map(r => r.patch).sort().join(';'), themedSquares.map(px => patchKey(px, 0)).sort().join(';'),
    'exactly the themed squares carry a section, each once');
  const patches = new Map();
  for (const rec of specialLines(whole)) {
    assert.eq(rec.variant, 'hedgerow');
    patches.set(rec.patch, (patches.get(rec.patch) || 0) + Streets.lineLengthM(rec.line, 1));
    for (const p of rec.line) assert.inRange(p.x % SV.LONG_PATCH_UNITS,
      SV.LONG_PATCH_UNITS * .3 - 1e-6, SV.LONG_PATCH_UNITS * .7 + 1e-6);
  }
  for (const length of patches.values()) assert.inRange(length, SV.MIN_VARIANT_LENGTH_M, SV.MAX_VARIANT_LENGTH_M, 'a section is between the min and the cap');
  const parts = SV.lineParts(whole.lines[0], 1);
  assert.gt(parts.filter(p => SV.VARIANT_BY_ID[p.variant]?.baseline && p.b - p.a >= SV.LONG_PATCH_UNITS * .6 - 1e-6).length, 1,
    'plain intervals visibly separate themes');
  assert.truthy(SV.VARIANT_BY_ID[SV.variantAt(whole.lines[0], 1024 + 50, 1)]?.baseline, 'lattice boundary has an ordinary variant');
  for (const [line, squares] of [
    [[{x:-50,y:512},{x:4146,y:512}], rowSquares.map(px => patchKey(px, 0))],
    [[{x:512,y:-50},{x:512,y:4146}], rowSquares.map(py => patchKey(0, py))],
  ]) {
    const aligned = indexOfLines([line], LONG_HEDGE);
    const want = squares;
    assert.eq(specialLines(aligned).map(r => r.patch).sort().join(';'), want.sort().join(';'),
      'a road following a patch boundary belongs to each themed patch exactly once');
  }
  const next = indexOfLines([[{x:-50,y:100},{x:4146,y:100}]], LONG_HEDGE, TX + 1);
  assert.truthy(specialLines(next).every(r => r.variant === 'hedgerow'), 'named road keeps its identity across the tile seam');
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
    const themed = specialLines(index).reduce((sum, rec) => sum + Streets.lineLengthM(rec.line, scale), 0);
    assert.inRange(themed / Streets.lineLengthM(line, scale), .399999, .400001,
      'coverage follows road length regardless of direction, bends or tile scale');
    assert.truthy(SV.lineParts(index.lines[0], scale).every(p => p.variant), 'every road interval has a variant');
    assert.inRange(index.dressingLines.reduce((sum, rec) => sum + Streets.lineLengthM(rec.line, scale), 0) / Streets.lineLengthM(line, scale), .999999, 1.000001, 'special and ordinary dressing together cover the whole road');
    const styled = SV.lineParts(index.lines[0], scale).filter(p => p.variant && !SV.VARIANT_BY_ID[p.variant]?.baseline)
      .reduce((sum, p) => sum + p.b - p.a, 0);
    assert.inRange(styled / Streets.lineLengthM(line, scale), .399999, .400001,
      'paving and lamps use the same coverage');
  }
});

test('street themes: nothing shorter than MIN_VARIANT_LENGTH_M — not a street, not a section', () => {
  assert.eq(SV.MIN_VARIANT_LENGTH_M, 50);
  const stub = indexOfLines([[{ x: 100, y: 100 }, { x: 140, y: 100 }]]);
  assert.eq(specialLines(stub).length, 0, 'a 40 m lane gets no special theme');
  assert.truthy(SV.VARIANT_BY_ID[stub.lines[0].variant]?.baseline, 'short lanes receive an ordinary variant');
  assert.eq(stub.lines[0].selectedVariant, 'hedgerow', 'though it rolled one');
  const fine = indexOfLines([[{ x: 100, y: 100 }, { x: 150, y: 100 }]]);
  assert.eq(fine.dressingLines.length, 1, 'a 50 m lane does');
  // A long road clipping a themed square's corner leaves a piece too short to lay.
  const clipped = indexOfLines([[{ x: -50, y: 100 }, { x: 1024 + 60, y: 100 }]], LONG_HEDGE);
  assert.eq(specialLines(clipped).length, 1, 'the final 60 m fragment would theme only 24 m: omitted');
  const longer = indexOfLines([[{ x: -50, y: 100 }, { x: 1024 + 125, y: 100 }]], LONG_HEDGE);
  assert.eq(specialLines(longer).length, 2, 'a 125 m fragment can fit a 50 m section');
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
  const themed = specialLines(over).reduce((n, r) => n + Streets.lineLengthM(r.line, 1), 0);
  assert.truthy(specialLines(over).every(r => r.patch !== null), 'a 400 m one is bounded by its own cap');
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
  const total=specialLines(r.value).reduce((n,rec)=>n+Streets.lineLengthM(rec.line,1),0);
  assert.inRange(total,499.99,500.01,'one patch cannot hide more than500m of winding street');
  // Additional short source segments are tested against its clipped theme.
  assert.gt(yields,0,'the interval comparison loop cooperates with sliced world generation');
});

test('golden path: exact diagonal centreline seats, no verge coins, and blocked cells leave gaps', () => {
  const line = pts([[10, 15], [40, 35]]);
  const rec = { key: 'golden-path-test', line, variant: 'golden_path', size: 'path', halfW: 1 };
  const build = (blocked = false, occupied = new Set(), roadMask = new Uint8Array(CPE * CPE)) => {
    const spawnWhy = new Uint16Array(CPE * CPE);
    if (blocked) spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
    const index = { extent: EXTENT, lines: [rec], dressingLines: [rec], hoardPois: [] };
    return SV.dress({ index, tx: TX, ty: TY, N: CPE, tileEdgeM: TILE_EDGE_M,
      grid: new Uint8Array(CPE * CPE).fill(T.PATH),
      spawnOpts: { spawnWhy, occupied, roadMask, roadClass: new Uint8Array(CPE * CPE) } });
  };
  const result = build(), seats = [...result.coinSeats.get(rec.key).values()];
  assert.truthy(seats.length > 20, 'a line of coins along the path');
  const a = { x: TX * TILE_EDGE_M + 10.5 * 7, y: TY * TILE_EDGE_M + 15.5 * 7 };
  for (const seat of seats) {
    assert.inRange(Math.abs((seat.x - a.x) * 20 - (seat.y - a.y) * 30), 0, 1e-8,
      'coins stay exactly on the diagonal, not at off-path cell centres');
  }
  const idol = result.objects.find(o => o.shrineKind === 'golden_path_idol');
  assert.truthy(idol, 'the path gets its daily shrine');
  const shrines = result.objects.filter(o => o.shrineKind === 'golden_path_idol');
  assert.eq(shrines.length, 2, 'one activation shrine at each end');
  assert.eq(shrines[0].dailyVisitId, shrines[1].dailyVisitId, 'both share one daily reward');
  assert.falsy(shrines[0].id === shrines[1].id, 'each shrine has its own object identity');
  const end = { x: TX * TILE_EDGE_M + 40.5 * 7, y: TY * TILE_EDGE_M + 35.5 * 7 };
  for (const p of [a, end]) assert.truthy(shrines.some(o => Math.hypot(o.x - p.x, o.y - p.y) < 30),
    'a shrine is close to each end, not the midpoint');
  assert.eq(idol.coinSeats.length, seats.length);
  assert.eq(Shrines.kindForStreet('golden_path'), 'golden_path_idol');
  const cell = cellOf(seats[0].y, TY) * CPE + cellOf(seats[0].x, TX);
  assert.eq(build(false, new Set([cell])).coinSeats.get(rec.key).size, seats.length - 1);
  const roadMask = new Uint8Array(CPE * CPE); roadMask[cell] = 1;
  assert.eq(build(false, new Set(), roadMask).coinSeats.get(rec.key).size, seats.length - 1,
    'vehicle-road crossings remain clear');
  assert.eq(build(true).coinSeats.get(rec.key).size, 0, 'restricted ground stays clear');
});

test('golden road: coin seats line both verges, ride on its idol, and claim no cell', () => {
  const name = nameWhere((n,k) => SV.variantFor(k,n,'minor') === 'golden', 'Golden Street');
  // Cells 10–42: a 224 m lane, inside the Golden Road's own 250 m section
  // cap (sectionLimits), so the seats run end to end.
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
  const seatsOf = (result) => [...result.coinSeats.values()].flatMap((m) => [...m.values()]);
  const { result, opts } = build([line]);
  assert.eq(SV.VARIANT_BY_ID.golden.story, 'street_golden');
  assert.eq(SV.VARIANT_BY_ID.golden.art, 'street_golden', 'show coins along both verges');
  assert.eq(SV.VARIANT_BY_ID.snare.art, 'street_snare', 'show the chest and its traps');
  assert.eq(result.coins, undefined, 'the road lays no coins of its own');
  const seats = seatsOf(result);
  assert.eq(seats.length, 198, '33 cells along each of six verge rows are seats');
  assert.eq(new Set(seats.map(c => c.id)).size, seats.length, 'one seat per cell');
  assert.eq(JSON.stringify(seats.map(c => c.id).sort()),
    JSON.stringify(seatsOf(build([[split[2],split[1]],[split[1],split[0]]]).result).map(c => c.id).sort()));
  const idols = result.objects.filter(o => o.kind === 'grove_shrine' && o.shrineKind === 'golden_idol');
  assert.eq(idols.length, 1, 'every Golden Road gets its idol');
  assert.eq(idols[0].coinSeats.length, 198, 'the idol carries the seats');
  assert.eq(Shrines.kindForObject(idols[0]).reward, 'coins', 'its tap is the coin spree');
  const rows = new Map();
  for (const seat of seats) {
    const iy = cellOf(seat.y, TY);
    if (!rows.has(iy)) rows.set(iy, []);
    rows.get(iy).push(cellOf(seat.x, TX));
  }
  assert.eq(rows.size, 6, 'three dense rows on each side');
  for (const [iy, xs] of rows) {
    assert.falsy(iy === 25, 'roadway stays clear');
    assert.eq(xs.length, 33);
    xs.sort((a,b) => a-b);
    for (let i=1; i<xs.length; i++) assert.eq(xs[i]-xs[i-1], 1, 'no gaps along a verge');
  }
  const occupiedCell = cellOf(seats[0].y, TY)*CPE + cellOf(seats[0].x, TX);
  const occupiedSeats = seatsOf(build([line], false, new Set([occupiedCell])).result);
  assert.eq(occupiedSeats.length, seats.length-1);
  assert.falsy(occupiedSeats.some(c => c.id === seats[0].id));
  const crossingRoad = new Uint8Array(CPE*CPE);
  for (let y=0; y<CPE; y++) crossingRoad[y*CPE+26] = 1;
  const crossingSeats = seatsOf(build([line], false, new Set(), crossingRoad).result);
  assert.eq(crossingSeats.length, seats.length-6, 'crossing roadway cuts all six seat rows');
  assert.falsy(crossingSeats.some(c => cellOf(c.x, TX) === 26));
  const idolCell = cellOf(idols[0].y, TY)*CPE + cellOf(idols[0].x, TX);
  for (const seat of seats) {
    const ix=cellOf(seat.x,TX), iy=cellOf(seat.y,TY);
    assert.eq(seat.id,WorldGen.cellId('golden_coin',TX,TY,ix,iy));
    if (iy*CPE+ix !== idolCell) assert.falsy(opts.occupied.has(iy*CPE+ix), 'a seat claims no cell');
  }
  assert.eq(seatsOf(build([line],true).result).length,0,'hard restrictions prevent seats');
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
  assert.eq(SV.VARIANT_BY_ID.thorny.terrain, 'WASTELAND', 'a thorn lane\'s verge is dry khaki scrub');
  assert.eq(SV.VARIANT_BY_ID.thorny.terrainVergeCells, SV.THORNY_VERGE_MAX_CELLS, 'painted as deep as its thickets');
  const strays = result.wildplants.filter(p => Math.abs(cellOf(p.y,TY) - 25) > SV.THORNY_VERGE_MAX_CELLS);
  assert.gt(strays.length, 0, 'stray brambles scatter past the thickets');
  assert.falsy(result.wildplants.some(p => Math.abs(cellOf(p.y,TY) - 25) > SV.THORNY_SCATTER_CELLS + 1),
    'and stop at the scatter reach');
  const thicket = result.wildplants.length - strays.length;
  assert.inRange(thicket / 264, 0.35, 0.75, 'thickets plus the strays among them');
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
  const SV_SNARE_CLUSTER_REACH = 4;   // the cluster's radius plus its cross-section spread
  const name = nameWhere((n,k) => SV.variantFor(k,n,'minor') === 'snare', 'Snare Street');
  const line = pts([[10,25],[54,25]]), middle = pts([[32,25]])[0];
  const build = (lines, blocked = false, occupied = new Set(), major = false) => {
    const index = indexOfLines(lines, name, TX, TY, TILE_EDGE_M / EXTENT);
    const spawnWhy = new Uint16Array(CPE*CPE);
    if (blocked) spawnWhy.fill(blocked === true ? WorldGen.SPAWN_WHY.RESTRICTED : blocked);
    const roadMask = new Uint8Array(CPE*CPE), roadClass = new Uint8Array(CPE*CPE);
    const grid = new Uint8Array(CPE*CPE).fill(T.PARK);
    for (let x=10; x<=54; x++) { roadMask[25*CPE+x]=1; grid[25*CPE+x]=T.ROAD; }
    if (major) roadClass.fill(WorldGen.ROAD_CLASS_MAJOR_BAND | WorldGen.ROAD_CLASS_MAJOR_BUFFER);
    const opts = {roadMask, roadClass, spawnWhy, occupied};
    return {result: SV.dress({index,tx:TX,ty:TY,N:CPE,tileEdgeM:TILE_EDGE_M,grid,spawnOpts:opts}), opts, grid};
  };
  const {result,opts,grid} = build([line]);
  const caches = r => r.objects.filter(o=>o._street==='snare');
  assert.eq(caches(result).length,1);
  const deterministicSnapshot = JSON.stringify(result);
  const chest=caches(result)[0];
  assert.eq(chest.kind,'chest'); assert.eq(chestTier(chest),3);
  assert.eq(chestLook(chest).texKey,'chest'); assert.falsy(restocks(chest));
  assert.falsy(chest.depth,'the cache remains a surface object');
  assert.eq(chestLootDepth(chest),1,'the reward picker uses the canonical cave mix');
  assert.eq(chestLootDepth({depth:4}),4,'ordinary underground chests retain their depth');
  assert.eq(cellOf(chest.x,TX),32,'reward halfway along the street');
  assert.gt(result.traps.length,24,'dense cluster spans the road and both verges');
  for (let x=30; x<=34; x++) {
    assert.truthy(result.traps.some(t=>t._ix===x && t._iy===25),'no road passage through the cluster');
  }
  assert.truthy(result.traps.some(t=>t._iy<25),'traps reach the opposite verge');
  assert.truthy(result.traps.some(t=>t._iy>25),'traps cover the reward verge');
  const strays=result.traps.filter(t=>Math.abs(t._ix-32)>SV_SNARE_CLUSTER_REACH);
  assert.inRange(strays.length,1,4,'a few lone snares down the lane, off the cluster');
  assert.truthy(strays.every(t=>Math.abs(t._iy-25)<=1),'strays sit on the band or its first verge cell');
  assert.truthy(strays.every(a=>strays.every(b=>a===b||Math.max(Math.abs(a._ix-b._ix),Math.abs(a._iy-b._iy))>=3)),'strays keep apart');
  const occupied=new Set();
  for(const o of [chest,...result.traps]) {
    const ix=cellOf(o.x,TX),iy=cellOf(o.y,TY),i=iy*CPE+ix;
    assert.falsy(occupied.has(i)); occupied.add(i);
    assert.truthy(opts.occupied.has(i));
    if(o===chest) assert.falsy(opts.roadMask[i],'reward stays off the road');
    const gate={...opts,occupied:new Set(),streetObstacleCells:new Set([i]),streetObstacleKind:'snare'};
    assert.truthy(WorldGen.isSpawnCell(grid,CPE,CPE,ix,iy,gate,opts.roadMask[i]?'streetObstacle':'fastEnemy'));
    if(o!==chest) { assert.eq(o._ix,ix); assert.eq(o._iy,iy); }
  }
  assert.eq(deterministicSnapshot,JSON.stringify(build([[line[1],middle],[middle,line[0]]]).result),
    'reversed, fragmented geometry keeps the cache and traps');
  assert.eq(caches(build([line],true).result).length,0,'restricted ground holds no reward');
  assert.eq(build([line],true).result.traps.length,0);
  assert.eq(build([line],WorldGen.SPAWN_WHY.PRIVATE).result.traps.length,0,'private land stays excluded');
  assert.eq(build([line],false,new Set(),true).result.traps.length,0,'major roads and their buffers stay excluded');
  assert.inRange(Math.abs(cellOf(chest.y,TY)-25),1,2,'cache sits immediately beside its own road');
  assert.eq(caches(build([line],false,new Set(Array.from({length:CPE*CPE},(_,i)=>i))).result).length,0,
    'occupied ground holds no reward');
  const picked=build([line]).result;
  assert.eq(JSON.stringify(result.traps),JSON.stringify(picked.traps),'reload uses stable trap identities');
});

test('dead ends: each unjoined Small-road end in the tile holds one tier-1 supply crate, opened once', () => {
  const name = nameWhere((n,k) => SV.VARIANT_BY_ID[SV.variantFor(k,n,'minor')]?.baseline, 'Quiet Close');
  const dress = (lines) => {
    const index = indexOfLines(lines, name, TX, TY, TILE_EDGE_M / EXTENT);
    const roadMask = new Uint8Array(CPE*CPE), grid = new Uint8Array(CPE*CPE).fill(T.PARK);
    const opts = {roadMask, roadClass: new Uint8Array(CPE*CPE), spawnWhy: new Uint16Array(CPE*CPE), occupied: new Set()};
    return SV.dress({index,tx:TX,ty:TY,N:CPE,tileEdgeM:TILE_EDGE_M,grid,spawnOpts:opts}).objects.filter(o=>/^crate_end/.test(o.id));
  };
  const lone = dress([pts([[10,25],[40,25]])]);
  assert.eq(lone.length,2,'both ends of a lone close');
  for (const c of lone) {
    assert.truthy(c.kind==='chest' && c.crate,'a supply crate');
    assert.eq(chestTier(c),SV.DEAD_END_CRATE_TIER); assert.eq(SV.DEAD_END_CRATE_TIER,1);
    assert.falsy(restocks(c),'opened once: no POI class, no restock');
  }
  assert.truthy(lone.some(c=>Math.abs(cellOf(c.x,TX)-10)<=4) && lone.some(c=>Math.abs(cellOf(c.x,TX)-40)<=4),'seated at the ends');
  const tee = dress([pts([[10,25],[40,25]]), pts([[25,10],[25,25]])]);
  assert.eq(tee.length,3,'a T: the stem\'s junction end holds none, its far end does');
  assert.falsy(tee.some(c=>Math.abs(cellOf(c.x,TX)-25)<=1 && Math.abs(cellOf(c.y,TY)-25)<=1),'no crate at the junction');
  assert.eq(dress([pts([[10,25],[CPE,25]])]).length,1,'an end clipped at the tile edge is not a dead end');
  assert.eq(JSON.stringify(dress([pts([[40,25],[10,25]])])),JSON.stringify(lone),'reversed geometry keeps the crates');
});

test('barricade scenery adds stakes and barriers without multiplying guards', () => {
  const { d } = dressedVariants();
  assert.gt(d.wildplants.filter((o) => o._streetScenery && o.crop === 'barricade').length, 4);
  assert.gt(d.objects.filter((o) => o._streetScenery && o.kind === 'stakes').length, 2);
  assert.eq(d.lairs.filter((o) => o.tier === 'barricade').length, 1);
});
test('hedgerow encounters: one stable post holds two hedge-ambush runts per street and tile', () => {
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
  assert.eq(guards.length,2);assert.truthy(guards.every(g=>g.kind==='goblin_runt'&&g.ambush),'Lairs.GROUPS.street_hedgerow: the ambushers');
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
    assert.eq(!!SV.VARIANT_BY_ID[neutral]?.baseline, !!SV.VARIANT_BY_ID[aligned]?.baseline, 'context cannot turn an ordinary road special');
    assert.eq(!!SV.VARIANT_BY_ID[neutral]?.baseline, !!SV.VARIANT_BY_ID[named]?.baseline, 'name cannot turn an ordinary road special');
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
  assert.truthy(SV.selectionWeights(null, 'path', { coastal: 1 }).some(r => r.id === 'lantern'), 'paths can receive Lantern Row');
  assert.eq(SV.selectionWeights(null, 'major', { coastal: 1 }).length, 0, 'medium and large roads have no theme weights');
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

test('street styles: patch gaps use ordinary variants for paving and lamp consumers', () => {
  const line = [{x:0,y:0},{x:100,y:0}];
  const rec = {fi:0,li:0,line,size:'minor',variant:'golden',fallbackVariant:'grassy_lane',variantRanges:[[20,80]]};
  const styles = SV.lineStyles({streetIndex:{lines:[rec]}},{geom:[line]},0,0,2);
  assert.eq(JSON.stringify(styles.map(p=>[p.a,p.b,p.variant])),JSON.stringify([[0,40,'grassy_lane'],[40,160,'golden'],[160,200,'grassy_lane']]));
});

function paintVerge(ctx) {
  const it = SV.paintTerrainSteps(ctx);
  let result = it.next();
  while (!result.done) result = it.next();
  return result.value;
}
test('street ground: the claim reaches two cells and paints over residential land cover there', () => {
  // Hedgerow terrain over a lane on row 6 with no band of its own (halfW 0):
  // rows 4 and 8 sit exactly two cells out, row 3 three. Residential lot
  // cells carry the gate's PRIVATE reason (land access), which used to keep
  // every land-excluded cell's own paint; the lane now owns its two cells.
  const f = vergeFixture('hedgerow');
  f.index.dressingLines[0].halfW = 0;
  const N = f.N, W = WorldGen.SPAWN_WHY;
  for (const y of [3, 4, 5]) for (let x = 1; x < 11; x++) { f.grid[y*N+x] = T.RESIDENTIAL; f.spawnWhy[y*N+x] = W.PRIVATE; }
  f.grid[8*N+5] = T.GRASS; f.spawnWhy[8*N+5] = W.RESTRICTED;      // restricted ground keeps its paint
  const painted = paintVerge(f), park = T.PARK;
  assert.eq(f.grid[5*N+5], park, 'a residential kerb cell takes the lane\'s ground');
  assert.eq(f.grid[4*N+5], park, 'two cells out too (TERRAIN_VERGE_CELLS = 2)');
  assert.eq(f.grid[3*N+5], T.RESIDENTIAL, 'three cells out the lot keeps its lawn');
  assert.eq(f.grid[8*N+5], T.GRASS, 'other land-access exclusions still block the paint');
  assert.truthy(painted[4*N+5] && !painted[3*N+5]);
  assert.eq(SV.TERRAIN_VERGE_CELLS, 2);
});

test('street ground: Thorny Way paints its dry scrub as deep as its thickets', () => {
  // Same lane on row 6 (halfW 0). Rows 2..10 sit within four cells; a
  // residential lot three cells out keeps its lawn (past the claim the paint
  // is cosmetic, so land access holds), open ground there turns to scrub.
  const f = vergeFixture('thorny');
  f.index.dressingLines[0].halfW = 0;
  const N = f.N, W = WorldGen.SPAWN_WHY;
  f.grid[3*N+4] = T.RESIDENTIAL; f.spawnWhy[3*N+4] = W.PRIVATE;
  paintVerge(f);
  assert.eq(f.grid[5*N+5], T.WASTELAND, 'the kerb row');
  assert.eq(f.grid[2*N+5], T.WASTELAND, 'four cells out');
  assert.eq(f.grid[10*N+5], T.WASTELAND, 'four cells out on the other side');
  assert.eq(f.grid[3*N+4], T.RESIDENTIAL, 'a lot past the claim keeps its lawn');
  assert.truthy(f.grid[1*N+5] !== T.WASTELAND, 'five cells out is untouched');
});

function vergeFixture(variant = 'overgrown') {
  const N = 12;
  const grid = new Uint8Array(N*N).fill(T.GRASS);
  const roadMask = new Uint8Array(N*N), spawnWhy = new Uint16Array(N*N);
  for (let x=1;x<11;x++) grid[6*N+x]=T.ROAD,roadMask[6*N+x]=1;
  return { N, grid, roadMask, spawnWhy, index: {extent:N, dressingLines:[{
    key:'road', variant, halfW:3.5, line:[{x:1.5,y:6.5},{x:10.5,y:6.5}]
  }]}};
}
// The overgrown street's posts (SV.dress → res.lairs) for a street `key`;
// `fragments` doubles the geometry, `blocked` restricts every cell.
function overgrownPosts(key, fragments = false, blocked = false) {
  const f = vergeFixture(), rec = f.index.dressingLines[0];
  rec.key = key;
  if (fragments) f.index.dressingLines.push({...rec, line: rec.line.slice()});
  if (blocked) f.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
  return SV.dress({...f, tx:0, ty:0, tileEdgeM:f.N*7,
    spawnOpts:{roadMask:f.roadMask, spawnWhy:f.spawnWhy, occupied:new Set()}}).lairs;
}
// Wake one street post's garrison on a 64-cell grass tile; `marked` stamps
// the whole tile as an overgrown street (entry.streetMarks), the way a real
// tile carries its dressing.
function wakeStreetPost(tier, sid, caughtSet, marked = false) {
  const N=64,entry={cellsPerEdge:N,tileEdgeM:N*7,grid:new Uint8Array(N*N).fill(T.GRASS),objects:[],buildingShapes:[],
    _spawnOpts:{occupied:new Set(),roadMask:new Uint8Array(N*N),spawnWhy:new Uint16Array(N*N)}};
  if (marked) entry.streetMarks = new Uint8Array(N*N).fill(SV.VARIANT_BY_ID.overgrown.code);
  const cand={tier,sid,tx:0,ty:0,ox:0,oy:0,lx:32.5*7,ly:32.5*7,ix:32,iy:32,halfW:0,halfH:0};
  return Lairs.garrisonFor(entry,cand,{tileEdgeM:N*7,caughtSet});
}
test('forest roads: one third add one finite giant bear without replacing the plant', () => {
  const tier = 'street_forest_bear';
  assert.eq(SV.VARIANT_BY_ID.overgrown.extraEncounters.find(e => e.tier === tier).chance, 1 / 3);
  assert.truthy(SV.EXTRA_ENCOUNTER_TIERS.has(tier));
  const build = overgrownPosts;
  let selected = 0, chosen;
  for (let i=0;i<300;i++) {
    const key = `forest-test-${i}`, posts = build(key), bears = posts.filter(p=>p.tier===tier);
    assert.eq(posts.filter(p=>p.tier==='street_overgrown').length,1,'plant remains');
    assert.lte(bears.length,1);
    if (bears.length) { selected++; chosen=key; }
  }
  assert.inRange(selected,75,125,'seeded population is approximately one third');
  const posts = build(chosen).filter(p=>p.tier===tier);
  assert.eq(JSON.stringify(build(chosen).filter(p=>p.tier===tier)),JSON.stringify(posts),'reload is stable');
  assert.eq(JSON.stringify(build(chosen,true).filter(p=>p.tier===tier)),JSON.stringify(posts),'duplicate fragments do not multiply posts');
  assert.eq(build(chosen,false,true).filter(p=>p.tier===tier).length,0,'restricted land excludes bears');
  const wake=caughtSet=>wakeStreetPost(tier,posts[0].sid,caughtSet);
  const bears=wake();assert.eq(bears.length,1);assert.eq(bears[0].kind,'giant_bear');
  assert.eq(wake(new Set([bears[0].id])).length,0,'defeated bear stays gone');
  // On a real tile the street's marks name a building family (EnemyHabitats
  // BUILDING_FAMILIES.overgrown: plants and spiders); the bear's post is
  // authored by its own ladder and keeps its bear.
  const marked=wakeStreetPost(tier,posts[0].sid,undefined,true);
  assert.eq(marked.map(g=>g.kind).join(),'giant_bear','the street family never re-themes the bear');
  assert.falsy(Lairs.DAILY_TIERS.has(tier));
});
test('forest roads: every overgrown street posts a sounder of two wild boars beside the plant', () => {
  const tier = 'street_wild_boar';
  assert.eq(SV.VARIANT_BY_ID.overgrown.extraEncounters.find(e => e.tier === tier).chance, 1, 'every overgrown street');
  assert.truthy(SV.EXTRA_ENCOUNTER_TIERS.has(tier));
  assert.eq(Lairs.STREET_TIER_GUARDS[tier], 2, 'a sounder of two');
  assert.eq(Lairs.KIND_ORDER[tier].join(), 'boar', 'held by boars');
  assert.truthy(Lairs.FIXED_GUARD_TIERS.has(tier) && Lairs.ALWAYS_AWAKE_TIERS.has(tier), 'a street post: fixed count, every mode');
  assert.eq(Lairs.OCCUPANCY[tier].rate, 1, 'always held');
  let chosen;
  for (let i=0;i<40;i++) {
    const key = `boar-test-${i}`, posts = overgrownPosts(key);
    assert.eq(posts.filter(p=>p.tier===tier).length,1,`${key}: one boar post`);
    assert.eq(posts.filter(p=>p.tier==='street_overgrown').length,1,`${key}: the plant remains`);
    chosen = key;
  }
  const posts = overgrownPosts(chosen).filter(p=>p.tier===tier);
  assert.eq(JSON.stringify(overgrownPosts(chosen).filter(p=>p.tier===tier)),JSON.stringify(posts),'reload is stable');
  assert.eq(JSON.stringify(overgrownPosts(chosen,true).filter(p=>p.tier===tier)),JSON.stringify(posts),'duplicate fragments do not multiply posts');
  assert.eq(overgrownPosts(chosen,false,true).filter(p=>p.tier===tier).length,0,'restricted land excludes boars');
  const plant = overgrownPosts(chosen).find(p=>p.tier==='street_overgrown');
  assert.truthy(plant.sid !== posts[0].sid && (plant.lx !== posts[0].lx || plant.ly !== posts[0].ly), 'its own post, not the plant\'s seat');
  const wake=(caughtSet,marked)=>wakeStreetPost(tier,posts[0].sid,caughtSet,marked);
  const boars=wake();
  assert.eq(boars.map(g=>g.kind).join(),'boar,boar','two boars wake');
  assert.eq(wake(new Set([boars[0].id])).map(g=>g.id).join(),boars[1].id,'a defeated boar stays gone, the other keeps its seat');
  assert.eq(wake(undefined,true).map(g=>g.kind).join(),'boar,boar','the street family never re-themes the sounder');
  // The street's own stretch still takes the street family (its plants, a spider).
  for (const g of wakeStreetPost('street_overgrown',plant.sid,undefined,true)) assert.includes(['plant','spider'],g.kind);
  assert.falsy(Lairs.DAILY_TIERS.has(tier));
});

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
  for (const row of SV.STREET_VARIANTS.filter(row => !row.baseline && ['minor', 'major'].includes(row.size))) {
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
  assert.falsy(ok('streetObstacle'),'barricades cannot cross medium or large roads');
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
  const crossingRows = [...rows.keys()].sort((a, b) => a - b);
  assert.gt(crossingRows.length, 1, 'the road has repeated crossings');
  for (let i = 1; i < crossingRows.length; i++) {
    const gapM = (crossingRows[i] - crossingRows[i - 1]) * WorldGen.CELL_M;
    assert.inRange(gapM, 43, 57, 'single barricade layers sit about 50 m apart after cell snapping');
  }
});

test('medium and large roads remain free of themed obstacles, including diagonal pavement', () => {
  for (const roadClass of ['secondary', 'primary', 'motorway']) {
    for (const diagonal of [false, true]) {
      const line = diagonal
        ? [{ x: (32 - 23 / Math.hypot(23, 23.5)) * CELL_MVT,
            y: (32 - 23.5 / Math.hypot(23, 23.5)) * CELL_MVT },
            { x: 55 * CELL_MVT, y: 55.5 * CELL_MVT }]
        : pts([[32, 32], [32, 63]]);
      const r = WorldGen.rasterizeTile([
        { name: 'landcover', features: [{ type: 3, tags: { class: 'meadow' }, geom: [wholeTile()] }] },
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
      // The first diagonal crossing reaches this paved tile whose center
      // is outside a secondary road's 4.5 m half-width. Treating it as verge
      // used to reject its road terrain and stop the barrier mid-crossing.
      const x = diagonal ? 34 : 32, y = diagonal ? 33 : 36, i = y * CPE + x;
      assert.truthy(WorldGen.isRoadTerrain(r.grid[i]), `${roadClass}: fixture checks actual pavement`);
      assert.truthy(r.spawnWhy[i] & WorldGen.SPAWN_WHY.TERRAIN, 'ordinary terrain spawn exclusion remains');
      assert.falsy(occupied.has(i), `${roadClass}: pavement remains unobstructed`);
      assert.eq(pieces.length, 0, 'medium and large roads have no barricade dressing');
      assert.truthy(r.streetIndex.lines.every(rec => rec.variant === null), 'all major source lines remain plain');
      assert.eq(r.streetIndex.dressingLines.length, 0, 'no themed sections are assigned');
    }
  }
});


test('Goblin Gang Street: six barrel stacks and thirty grunts, deterministic and safe', () => {
  const row = SV.VARIANT_BY_ID.goblin_gang;
  assert.eq(row.size, 'minor');
  const grid = new Uint8Array(CPE * CPE).fill(T.GRASS);
  const roadMask = new Uint8Array(grid.length), roadClass = new Uint8Array(grid.length);
  const streetArea = new Uint8Array(grid.length);
  for (let y = 28; y <= 34; y++) for (let x = 8; x <= 55; x++) {
    streetArea[y * CPE + x] = row.code;
    if (y >= 30 && y <= 32) { grid[y * CPE + x] = T.ROAD; roadMask[y * CPE + x] = 1; }
  }
  const rec = { variant: row.id, key: 'gang-test', lineKey: 'gang-test', size: 'minor',
    line: pts([[10, 31], [53, 31]]), halfW: 7 };
  const index = { extent: EXTENT, lines: [rec], vehicleLines: [], hoardPois: [], roadClass };
  function run(blocked = false) {
    const spawnOpts = { roadMask, roadClass, occupied: new Set(), pois: [] };
    if (blocked) spawnOpts.spawnWhy = new Uint16Array(grid.length).fill(WorldGen.SPAWN_WHY.PRIVATE);
    const d = SV.dress({ index, tx: TX, ty: TY, N: CPE, tileEdgeM: TILE_EDGE_M, grid, spawnOpts });
    return { d, spawnOpts };
  }
  const { d, spawnOpts } = run();
  const barrels = d.objects.filter(o => o.barrel && o._street === row.id);
  assert.eq(barrels.length, 30);
  assert.eq(d.lairs.length, 6);
  assert.eq(JSON.stringify(d), JSON.stringify(run().d), 'stable ids and positions');
  const previous = Difficulty.mode();
  try {
    for (const mode of ['easy', 'hard']) {
      Difficulty.setMode(mode);
      const entry = { grid, cellsPerEdge: CPE, roadClass, streetArea, _spawnOpts: spawnOpts,
        buildingShapes: [], streetLairs: d.lairs, creatures: [] };
      const idx = Lairs.buildIndex(entry, TX, TY, TILE_EDGE_M / CPE, TILE_EDGE_M);
      const candidates = [...idx.buckets.values()].flat().filter(c => c.tier === 'street_goblin_gang');
      const guards = candidates.flatMap(c => Lairs.garrisonFor(entry, c, { tileEdgeM: TILE_EDGE_M, homeM: { x: 0, y: 0 } }));
      assert.eq(guards.length, 30, mode + ' keeps six five-grunt gangs');
      for (const g of guards) {
        assert.eq(g.kind, 'goblin_runt');
        const at = cellOf(g.y, TY) * CPE + cellOf(g.x, TX);
        assert.eq(roadMask[at], 0);
      }
    }
  } finally { Difficulty.setMode(previous); }
  const blocked = run(true).d;
  assert.eq(blocked.lairs.length, 0);
  assert.eq(blocked.objects.filter(o => o.barrel).length, 0);
});

// ── House barrels on plain Small streets ────────────────────────────────
// A plain Small street along row 6 (halfW half a cell: the verge's k = 1 is
// row 5 / row 7). North of it a HOUSE (T.BUILDING, rows 2-3, cols 3-5: the
// ray hits its wall at k = 3, its frontage is rows 5 and 4), a FORT
// (BUILDING_MED, rows 2-3, cols 8-9) and a house out of reach (row 0, cols
// 1-2: k = 6). South a second house (rows 9-10, cols 7-8).
function houseFixture(tx = 0, ty = 0, over = {}) {
  const N = 12;
  const grid = new Uint8Array(N * N).fill(T.GRASS);
  const roadMask = new Uint8Array(N * N), spawnWhy = new Uint16Array(N * N);
  for (let x = 1; x < 11; x++) { grid[6 * N + x] = T.ROAD; roadMask[6 * N + x] = 1; spawnWhy[6 * N + x] = WorldGen.SPAWN_WHY.ROAD; }
  for (const y of [2, 3]) for (const x of [3, 4, 5]) grid[y * N + x] = T.BUILDING;
  for (const y of [2, 3]) for (const x of [8, 9]) grid[y * N + x] = T.BUILDING_MED;
  for (const x of [1, 2]) grid[x] = T.BUILDING;
  for (const y of [9, 10]) for (const x of [7, 8]) grid[y * N + x] = T.BUILDING;
  for (let i = 0; i < N * N; i++) if (grid[i] !== T.GRASS && grid[i] !== T.ROAD) spawnWhy[i] = WorldGen.SPAWN_WHY.TERRAIN;
  const rec = { key: 'plain', name: 'Plain Street', size: 'minor', variant: null, variantRanges: null,
    halfW: 3.5, lineKey: 'plain-row-6', line: [{ x: 1.5, y: 6.5 }, { x: 10.5, y: 6.5 }], ...over };
  const index = { extent: N, lines: [rec], dressingLines: [] };
  const spawnOpts = { roadMask, spawnWhy, occupied: new Set() };
  return { N, grid, roadMask, spawnWhy, index, rec, spawnOpts, tx, ty };
}
const houseBarrels = (f) => SV.dress({ index: f.index, tx: f.tx, ty: f.ty, N: f.N, tileEdgeM: f.N * 7,
  grid: f.grid, spawnOpts: f.spawnOpts }).objects.filter(o => /^h(?:barrel|crate)_/.test(o.id));
const cellsOf = (f, list) => list.map(o => ({ ix: Math.floor((o.x - f.tx * f.N * 7) / 7), iy: Math.floor((o.y - f.ty * f.N * 7) / 7) }));
const northOf = (f) => cellsOf(f, houseBarrels(f)).filter(c => c.iy < 6);

test('house barrels: 0-2 per house, on the verge between the house and the street', () => {
  assert.eq(SV.HOUSE_BARRELS_MAX, 2);
  assert.eq(JSON.stringify(SV.HOUSE_BARREL_ODDS), JSON.stringify([0.5, 0.4, 0.1]), 'quieter plain streets');
  let north = 0, south = 0, seen = new Set();
  for (let tx = 0; tx < 120; tx++) {
    const f = houseFixture(tx, 3), got = cellsOf(f, houseBarrels(f));
    for (const o of houseBarrels(f)) assert.truthy(o.kind === 'chest' && o._houseFront && (o.barrel === true || (o.crate && o.tierSeed === 1)), 'a loot barrel or a tier-1 crate');
    const n = got.filter(c => c.iy < 6), s = got.filter(c => c.iy > 6);
    assert.lte(n.length, 2, 'at most two before the north house'); assert.lte(s.length, 2, 'and the south');
    for (const c of n) assert.truthy(c.ix >= 3 && c.ix <= 5 && (c.iy === 4 || c.iy === 5), `north frontage only: ${c.ix},${c.iy}`);
    for (const c of s) assert.truthy(c.ix >= 7 && c.ix <= 8 && (c.iy === 7 || c.iy === 8), `south frontage only: ${c.ix},${c.iy}`);
    assert.eq(got.filter(c => c.iy === 5 && c.ix >= 1 && c.ix <= 2).length, 0, 'the house out of reach stands none');
    assert.eq(got.filter(c => c.iy === 5 && c.ix >= 8).length, 0, 'the fort stands none');
    north += n.length; south += s.length; seen.add(n.length);
  }
  assert.eq([...seen].sort().join(','), '0,1,2', 'every count of 0, 1 and 2 occurs');
  assert.inRange(north / 120, 0.4, 0.8, 'about 0.6 a house on average');
  assert.inRange(south / 120, 0.4, 0.8);
});

test('house barrels: a cluster a cell back from the kerb, the reward gate, and stable', () => {
  let f = null;
  for (let tx = 0; tx < 200 && !f; tx++) if (northOf(houseFixture(tx, 3)).length === 2) f = houseFixture(tx, 3);
  assert.truthy(f, 'a house that rolls two');
  const cells = northOf(f);
  assert.truthy(cells.every(c => c.iy === 4), 'both a cell back from the kerb cell (row 5), never on it');
  assert.eq(Math.abs(cells[0].ix - cells[1].ix), 1, 'clustered: adjacent along the frontage');
  assert.eq(JSON.stringify(houseBarrels(houseFixture(f.tx, f.ty))), JSON.stringify(houseBarrels(houseFixture(f.tx, f.ty))), 'a reload lays the same');
  // Occupied back cells pull a barrel onto the kerb cell — the last resort —
  // never into the wall.
  const g = houseFixture(f.tx, f.ty);
  for (let x = 0; x < g.N; x++) g.spawnOpts.occupied.add(4 * g.N + x);
  const back = northOf(g);
  assert.eq(back.length, 2); assert.truthy(back.every(c => c.iy === 5), 'the kerb cell, only when nothing deeper is free');
  // A frontage one cell deep (the wall at k = 2) stands its barrels on that cell.
  const one = houseFixture(f.tx, f.ty);
  for (const x of [3, 4, 5]) { one.grid[4 * one.N + x] = T.BUILDING; one.spawnWhy[4 * one.N + x] = WorldGen.SPAWN_WHY.TERRAIN; }
  assert.truthy(northOf(one).every(c => c.iy === 5), 'a one-deep frontage uses its only cell');
  // A Major-and-Medium kerb (the reward gate's KERB) refuses the seat.
  const k = houseFixture(f.tx, f.ty);
  for (let x = 0; x < k.N; x++) for (const y of [4, 5]) k.spawnWhy[y * k.N + x] |= WorldGen.SPAWN_WHY.KERB;
  assert.eq(northOf(k).length, 0, 'none on a kerb');
  // A themed street or a Major road dresses no house barrels.
  assert.eq(houseBarrels(houseFixture(f.tx, f.ty, { variant: 'hedgerow' })).length, 0, 'a themed street');
  assert.eq(houseBarrels(houseFixture(f.tx, f.ty, { size: 'major', variant: null })).length, 0, 'a Major road');
});

test('house barrels: one in ten seats stands a tier-1 crate, decided by the seat', () => {
  assert.eq(SV.HOUSE_CRATE_SHARE, 0.1);
  let all = 0, crates = 0;
  for (let tx = 0; tx < 400; tx++) for (const o of houseBarrels(houseFixture(tx, 11))) {
    all++;
    if (o.crate) { crates++; assert.truthy(/^hcrate_/.test(o.id) && o.tierSeed === 1 && !o.barrel, 'a dead-end style crate'); }
    else assert.truthy(o.barrel === true && /^hbarrel_/.test(o.id));
  }
  assert.gt(all, 300);
  assert.inRange(crates / all, 0.06, 0.14, 'about a tenth are crates');
});

test('house barrels: a terrace rolls a house per frontage span', () => {
  // One joined footprint along the whole north verge: rows 2-3, cols 1..10
  // (ten samples) — two spans of HOUSE_FRONT_SPAN_CELLS, up to four barrels.
  assert.eq(SV.HOUSE_FRONT_SPAN_CELLS, 6);
  let most = 0;
  for (let tx = 0; tx < 150; tx++) {
    const f = houseFixture(tx, 9);
    for (let x = 1; x < 11; x++) for (const y of [2, 3]) { f.grid[y * f.N + x] = T.BUILDING; f.spawnWhy[y * f.N + x] = WorldGen.SPAWN_WHY.TERRAIN; }
    for (const x of [1, 2]) { f.grid[x] = T.GRASS; f.spawnWhy[x] = 0; }
    const n = northOf(f).length;
    assert.lte(n, 4); most = Math.max(most, n);
  }
  assert.gt(most, 2, 'a terrace stands more than one house\'s worth');
});

// ── Berry Lane / Berry Trail ─────────────────────────────────────────────
// The lane on row 6 of vergeFixture (halfW half a cell): its bushes stand on
// rows 5 and 7 (k = 1) or, where a seat is taken, rows 4 and 8 (walk 2).
function berryLane(tx, variant = 'berry', key = `berry-${tx}`) {
  const f = vergeFixture(variant);
  f.index.dressingLines[0].key = key;
  const d = SV.dress({ ...f, tx, ty: 0, tileEdgeM: f.N * 7,
    spawnOpts: { roadMask: f.roadMask, spawnWhy: f.spawnWhy, occupied: new Set() } });
  const cellOfM = v => Math.floor((v - 0) / 7);
  const bushes = d.wildplants.filter(p => /^wp_berrylane_/.test(p.id))
    .map(p => ({ ...p, ix: cellOfM(p.x - tx * f.N * 7), iy: cellOfM(p.y) }));
  return { d, bushes, f };
}
test('berry lane: a Small-road row and a path row, appended last, bushes of every kind on both verges', () => {
  const lane = SV.VARIANT_BY_ID.berry, trail = SV.VARIANT_BY_ID.berry_trail;
  assert.eq(lane.size, 'minor'); assert.eq(lane.share, 0.05);
  assert.eq(trail.size, 'path'); assert.eq(trail.pathWeight, 0.04);
  assert.eq(trail.code, lane.code + 1); assert.eq(SV.VARIANT_BY_ID.pottery.code, trail.code + 1, 'only Pottery Road after them');
  assert.eq(lane.art, 'street_berry', 'dedicated berry lane painting');
  assert.truthy(SV.VERGE_ROWS.berry === SV.VERGE_ROWS.berry_trail, 'one dressing for the lane and the trail');
  let named = 0, plain = 0;
  for (let i = 0; i < 20000; i++) {
    if (SV.variantFor(`s${i}|0,0`, `Maple ${i}`, 'minor') === 'berry') plain++;
    if (SV.variantFor(`s${i}|0,0`, `Blueberry ${i}`, 'minor') === 'berry') named++;
  }
  assert.gt(named, plain * 2, `a berry street is likelier a Berry Lane (${named} vs ${plain})`);
  const counts = {}, total = { n: 0 };
  let thorns = 0, gold = 0;
  for (let tx = 0; tx < 300; tx++) {
    const { bushes } = berryLane(tx, tx % 2 ? 'berry' : 'berry_trail');
    for (const b of bushes) {
      assert.truthy(b.iy !== 6 && Math.abs(b.iy - 6) <= 2, `on a verge: ${b.ix},${b.iy}`);
      assert.truthy(['shrub', 'berry', 'poisonberry', 'goldenberry'].includes(b.crop), b.crop);
      assert.truthy(b._street === 'berry' || b._street === 'berry_trail');
      counts[b.crop] = (counts[b.crop] || 0) + 1; total.n++;
      if (b._streetArt === 'bramble') { thorns++; assert.eq(b.crop, 'shrub', 'a thorn is a shrub in its bramble look'); }
      if (b.crop === 'goldenberry') { gold++; assert.falsy(b._streetArt, 'a golden bush wears no other look'); }
    }
  }
  assert.gt(total.n, 2000, 'both verges are lined');
  for (const crop of ['shrub', 'berry', 'poisonberry']) assert.gt(counts[crop], total.n / 10, `${crop} bushes are common`);
  assert.gt(thorns, total.n / 6, 'thorns are common too');
  assert.lte(thorns / total.n, SV.BERRY_LANE_THORN_MAX, 'but never more than a third of the bushes');
  assert.inRange(SV.BERRY_LANE_BUSHES.find(b => b.art === 'bramble').below - SV.BERRY_LANE_BUSHES[2].below, 0.3 - 1e-9, 0.3 + 1e-9, 'the table says so');
  assert.inRange(gold / total.n, GOLDEN_BUSH_SHARE.street * 0.6, GOLDEN_BUSH_SHARE.street * 1.5, 'one bush in fifty is golden');
  assert.eq(GOLDEN_BUSH_SHARE.street, 1 / 50);
  const a = berryLane(7), b = berryLane(7);
  assert.eq(JSON.stringify(a.bushes), JSON.stringify(b.bushes), 'a reload lays the same bushes');
});

test('berry lane: goblin runts hide behind the bushes — one-runt ambush posts, a third of them held', () => {
  assert.eq(Lairs.STREET_TIER_GUARDS.street_berry, 1);
  assert.eq(Lairs.KIND_ORDER.street_berry.join(','), 'goblin_runt');
  assert.eq(SV.BERRY_RUNT_CHANCE, 1 / 3);
  let posts = 0, lanes = 0;
  for (let tx = 0; tx < 200; tx++) {
    const { d } = berryLane(tx);
    const runts = d.lairs.filter(l => l.tier === 'street_berry');
    for (const r of runts) {
      const iy = Math.floor(r.ly / 7);
      assert.truthy(iy === 4 || iy === 8, `behind the bush row: row ${iy}`);
    }
    posts += runts.length; lanes++;
  }
  // The 63 m lane holds two 40 m posts (at 20 m and 60 m), a third of them held.
  assert.inRange(posts / lanes, 0.45, 0.85, 'a third of the posts are held');
  assert.eq(JSON.stringify(berryLane(3).d.lairs), JSON.stringify(berryLane(3).d.lairs), 'stable');
  const N=64,edge=N*7,grid=new Uint8Array(N*N).fill(WorldGen.T.GRASS);
  const entry={cellsPerEdge:N,grid,objects:[],buildingShapes:[],_spawnOpts:{occupied:new Set(),roadMask:new Uint8Array(N*N),spawnWhy:new Uint16Array(N*N)}};
  const cand={tier:'street_berry',sid:'berry-runt-test',tx:0,ty:0,ox:0,oy:0,lx:32.5*7,ly:32.5*7,ix:32,iy:32,halfW:0,halfH:0};
  const guards=Lairs.garrisonFor(entry,cand,{tileEdgeM:edge,caughtSet:new Set()});
  assert.eq(guards.length,1);
  assert.truthy(guards[0].kind==='goblin_runt'&&guards[0].ambush,'Lairs.GROUPS.street_berry: one ambusher');
});

// ── Pottery Road ─────────────────────────────────────────────────────────
// The road on row 6 of vergeFixture (halfW half a cell): its front rank
// stands on rows 4 and 8 (k = 2) or, where a seat is taken, rows 3 and 9
// (k = 3); the back rank on rows 3 and 9 — never on the kerb cells (rows 5
// and 7).
function potteryRoad(tx, key = `pottery-${tx}`, over = {}) {
  const f = vergeFixture('pottery');
  f.index.dressingLines[0].key = key;
  if (over.kerb) for (let x = 0; x < f.N; x++) for (const y of [3, 4, 8, 9]) f.spawnWhy[y * f.N + x] |= WorldGen.SPAWN_WHY.KERB;
  const occupied = new Set(over.occupied || []);
  const d = SV.dress({ ...f, tx, ty: 0, tileEdgeM: f.N * 7,
    spawnOpts: { roadMask: f.roadMask, spawnWhy: f.spawnWhy, occupied } });
  const cellOfM = v => Math.floor(v / 7);
  const pots = d.objects.filter(o => /^pot_/.test(o.id))
    .map(o => ({ ...o, ix: cellOfM(o.x - tx * f.N * 7), iy: cellOfM(o.y) }));
  return { d, pots, f };
}
test('pottery road: a Small-road row, appended last, two ranks of clay pots a cell back from the kerb on both verges', () => {
  const row = SV.VARIANT_BY_ID.pottery;
  assert.eq(row.size, 'minor'); assert.eq(row.share, 0.05); assert.eq(row.code, SV.VARIANT_BY_ID.trade.code - 1, 'older row codes stay stable');
  assert.eq(row.art, 'street_pottery', 'dedicated pottery painting'); assert.eq(row.sectionMaxM, 250);
  assert.truthy(Shrines.kindForStreet('pottery'), 'its shrine kind');
  assert.eq(SV.POTTERY_GAP, 0.15); assert.eq(SV.POTTERY_BACK_GAP, 0.5);
  let named = 0, plain = 0;
  for (let i = 0; i < 20000; i++) {
    if (SV.variantFor(`s${i}|0,0`, `Maple ${i}`, 'minor') === 'pottery') plain++;
    if (SV.variantFor(`s${i}|0,0`, `Kiln ${i}`, 'minor') === 'pottery') named++;
  }
  assert.gt(named, plain * 2, `a kiln street is likelier a Pottery Road (${named} vs ${plain})`);
  let front = 0, back = 0, samples = 0, north = 0, south = 0;
  for (let tx = 0; tx < 200; tx++) {
    const { pots } = potteryRoad(tx);
    samples += 9 * 2;   // the line spans nine cells (x 1.5 to 10.5): a sample each, two sides
    for (const p of pots) {
      assert.truthy(p.kind === 'chest' && p.barrel === true && p.barrelStyle === 'clay_pot' && p._street === 'pottery', 'a generated clay pot');
      assert.truthy([3, 4, 8, 9].includes(p.iy), `a cell or two back from the kerb: ${p.ix},${p.iy}`);
      if (p.iy < 6) north++; else south++;
      if (p.iy === 4 || p.iy === 8) front++; else back++;
    }
  }
  assert.inRange(front / samples, 1 - SV.POTTERY_GAP - 0.05, 1 - SV.POTTERY_GAP + 0.05, 'POTTERY_GAP of the front seats are left empty');
  assert.inRange(back / samples, 1 - SV.POTTERY_BACK_GAP - 0.05, 1 - SV.POTTERY_BACK_GAP + 0.05, 'POTTERY_BACK_GAP of the back seats are left empty');
  assert.inRange(north / south, 0.8, 1.25, 'both verges');
  const a = potteryRoad(7), b = potteryRoad(7);
  assert.eq(JSON.stringify(a.pots), JSON.stringify(b.pots), 'a reload lays the same pots');
  // A taken k = 2 seat pushes the pot a cell further out, never onto the kerb.
  const g = potteryRoad(7, 'pottery-7', { occupied: Array.from({ length: 12 }, (_, x) => 4 * 12 + x) });
  assert.truthy(g.pots.length > 0 && g.pots.filter(p => p.iy < 6).every(p => p.iy === 3), 'the next cell out');
  // The reward gate: a Major-and-Medium kerb refuses every pot.
  assert.eq(potteryRoad(7, 'pottery-7', { kerb: true }).pots.length, 0, 'none on a kerb');
});

// ── Trade Row ─────────────────────────────────────────────────────────────
// The road on row 6 of vergeFixture: its barrels stand on rows 4 and 8
// (k = 2), its grunt posts a cell behind them (rows 3 and 9, k = 3).
function tradeRow(tx, key = `trade-${tx}`) {
  const f = vergeFixture('trade');
  f.index.dressingLines[0].key = key;
  const d = SV.dress({ ...f, tx, ty: 0, tileEdgeM: f.N * 7,
    spawnOpts: { roadMask: f.roadMask, spawnWhy: f.spawnWhy, occupied: new Set() } });
  const cellOfM = v => Math.floor(v / 7);
  const barrels = d.objects.filter(o => /^trade_barrel_/.test(o.id))
    .map(o => ({ ...o, ix: cellOfM(o.x - tx * f.N * 7), iy: cellOfM(o.y) }));
  const grunts = d.lairs.filter(l => l.tier === 'street_trade').map(l => ({ ...l, iy: cellOfM(l.ly) }));
  return { d, barrels, grunts };
}
test('trade row: a Small-road row, appended last, barrels a cell back from the kerb and grunt pairs behind them', () => {
  const row = SV.VARIANT_BY_ID.trade;
  assert.eq(row.size, 'minor'); assert.eq(row.share, 0.04); assert.eq(row.code, SV.VARIANT_BY_ID.rocky_path.code - 1, 'older row codes stay stable');
  assert.eq(row.art, 'street_trade', 'dedicated trade row painting'); assert.eq(row.sectionMaxM, 250);
  assert.truthy(Shrines.kindForStreet('trade'), 'its shrine kind');
  assert.eq(SV.TRADE_BARREL_GAP, 0.3); assert.eq(SV.TRADE_GRUNT_STEP_M, 25); assert.eq(SV.TRADE_GRUNT_CHANCE, 2 / 3);
  assert.eq(Lairs.STREET_TIER_GUARDS.street_trade, 2, 'a pair of grunts a post');
  assert.eq(Lairs.KIND_ORDER.street_trade.join(','), 'goblin_runt');
  assert.eq(Lairs.GROUPS.street_trade.members[0].n, 2);
  let named = 0, plain = 0;
  for (let i = 0; i < 20000; i++) {
    if (SV.variantFor(`s${i}|0,0`, `Maple ${i}`, 'minor') === 'trade') plain++;
    if (SV.variantFor(`s${i}|0,0`, `Market ${i}`, 'minor') === 'trade') named++;
  }
  assert.gt(named, plain * 2, `a market street is likelier a Trade Row (${named} vs ${plain})`);
  let total = 0, samples = 0, posts = 0, roads = 0;
  for (let tx = 0; tx < 200; tx++) {
    const { barrels, grunts } = tradeRow(tx);
    samples += 10 * 2; roads++;
    for (const b of barrels) {
      assert.truthy(b.kind === 'chest' && b.barrel === true && b.barrelStyle === 'barrel' && b._street === 'trade', 'a generated wooden barrel');
      assert.eq(b.iy, b.iy < 6 ? 4 : 8, `a cell back from the kerb: ${b.ix},${b.iy}`);
      total++;
    }
    for (const g of grunts) { assert.truthy(g.iy === 3 || g.iy === 9, `behind the barrel row: ${g.iy}`); posts++; }
  }
  // The grunt posts take a few seats first, so a little under the gap's share.
  assert.inRange(total / samples, 1 - SV.TRADE_BARREL_GAP - 0.12, 1 - SV.TRADE_BARREL_GAP + 0.05, 'about TRADE_BARREL_GAP of the seats are left empty');
  // Ten cells of road: two or three posts, two thirds of them held.
  assert.inRange(posts / roads, 1.2, 2.3, 'about two grunt posts on the fixture\'s road');
  const a = tradeRow(7), b = tradeRow(7);
  assert.eq(JSON.stringify([a.barrels, a.grunts]), JSON.stringify([b.barrels, b.grunts]), 'a reload lays the same');
});
test('common route themes: deterministic dressing, dense variety and shared safety gates', () => {
  const ids = ['rocky_path', 'grassy_lane', 'old_growth_path', 'haunted_forest_path', 'way_of_variety'];
  const dress = (variant, blocked = false) => {
    const f = vergeFixture(variant);
    if (blocked) f.spawnWhy.fill(WorldGen.SPAWN_WHY.RESTRICTED);
    return SV.dress({ ...f, tx: 0, ty: 0, tileEdgeM: f.N * 7,
      spawnOpts: { roadMask: f.roadMask, spawnWhy: f.spawnWhy, occupied: new Set() } });
  };
  for (const id of ids) {
    const a = dress(id), b = dress(id), blocked = dress(id, true);
    const finds = [...a.objects, ...a.wildplants];
    assert.gt(finds.length, 0, id + ' dresses its verges');
    assert.eq(JSON.stringify(finds), JSON.stringify([...b.objects, ...b.wildplants]), id + ' is stable');
    assert.eq(blocked.objects.length + blocked.wildplants.length, 0, id + ' respects restricted ground');
    assert.truthy(finds.every(o => Math.floor(o.y / 7) !== 6), id + ' leaves the route clear');
  }
  const variety = dress('way_of_variety');
  const finds = [...variety.objects, ...variety.wildplants];
  assert.gt(finds.length, 30, 'variety thickly fills two verge rows per side');
  assert.gt(new Set(finds.map(o => o.crop || o.kind)).size, 4, 'variety mixes common interactables');
  assert.truthy(dress('haunted_forest_path').objects.some(o => o.kind === 'headstone'), 'haunted route has headstones');
  assert.truthy(dress('old_growth_path').objects.some(o => o.kind === 'tree' && o.variant === 3), 'old growth has mature trees');
});
})();
