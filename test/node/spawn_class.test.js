// THE SPAWN GATE (Sep 2026): entry.spawnClass + isSpawnCell's spawn class.
//
// One per-tile mask (WorldGen.stampSpawnClassSteps, beside the road mask, in
// the sliced build) says what each cell may host — OPEN, SUPPRESSED (minor
// things only) or INVALID (nothing) — and every spawner names what it seats:
// 'minor' (flora, rocks, X marks, scenery) takes OPEN + SUPPRESSED;
// 'attractor' (hoards, lair points, cave entrances, shrines, NPCs, a coin
// burst's scatter) and 'enemy' (fauna, guards, traps, headstones) take OPEN.
//
// What is pinned:
//   · each rule of the classifier on a synthetic tile: the road band, water /
//     buildings, restricted land, farm / orchard / industrial roadside only,
//     behind-a-house, private ways are no frontage, golf vouches for nobody,
//     the house / kerb / child / sensitive / churchyard buffers, quiet land,
//     commercial stays open;
//   · isSpawnCell's classes, and the POI lift of the frontage flag;
//   · seam determinism: a house over the seam buffers this side of it, the
//     same distance from either tile, and a rebuild is byte-identical;
//   · every spawner in src/ passes a class (a source sweep);
//   · cave entrances only ever stand on OPEN ground (the fixture tiles);
//   · the live private-ground veto is per-player only and fails open.
(function () {
const W = WorldGen;
const T = W.T;
const CPE = 64;
const TILE_EDGE_M = CPE * 7;          // cells are exactly 7 m (CELL_M)
const EXTENT = 4096;
const CELL_MVT = EXTENT / CPE;
const c2m = (c) => c * CELL_MVT + CELL_MVT / 2;
const pt = (cx, cy) => ({ x: c2m(cx), y: c2m(cy) });
const ring = (cells) => cells.map(([cx, cy]) => pt(cx, cy));
const box = (x0, y0, x1, y1) => ring([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
const line = (cells) => cells.map(([cx, cy]) => pt(cx, cy));
const whole = () => box(0, 0, CPE - 1, CPE - 1);
const OPEN = W.SPAWN_OPEN, SUP = W.SPAWN_SUPPRESSED, INV = W.SPAWN_INVALID;

function build(layers, tx = 0, ty = 0) {
  return W.rasterizeTile(layers, CPE, tx, ty, TILE_EDGE_M);
}
const at = (r, cx, cy) => W.spawnClassOf(r.spawnClass[cy * CPE + cx]);
const raw = (r, cx, cy) => r.spawnClass[cy * CPE + cx];
// A grid of public footpaths every 6 cells: every lot cell has frontage, so a
// test isolates ONE rule.
function paths(extra) {
  const f = [];
  for (let k = 3; k < CPE; k += 6) {
    f.push({ type: 2, tags: { class: 'path' }, geom: [line([[0, k], [CPE - 1, k]])] });
    f.push({ type: 2, tags: { class: 'path' }, geom: [line([[k, 0], [k, CPE - 1]])] });
  }
  return { name: 'transportation', features: f.concat(extra || []) };
}
const residential = () => ({ type: 3, tags: { class: 'residential' }, geom: [whole()] });

// ── The classifier, rule by rule ───────────────────────────────────────────

test('spawn gate: the mask rides the build and the entry, one byte a cell', () => {
  const r = build([{ name: 'landuse', features: [residential()] }, paths()]);
  assert.truthy(r.spawnClass instanceof Uint8Array, 'a Uint8Array');
  assert.eq(r.spawnClass.length, CPE * CPE, 'one per cell');
  assert.truthy(/entry\.spawnClass = spawnClass;/.test(WORLDGEN_SRC), 'loadTile carries it');
  assert.truthy(/const spawnClass = yield\* stampSpawnClassSteps\(/.test(WORLDGEN_SRC), 'stamped in the sliced build (yields)');
  assert.eq(W.spawnClassOf(W.SPAWN_NEEDS_FRONTAGE), INV, 'the frontage flag reads as INVALID');
  assert.eq(W.spawnClassOf(W.SPAWN_NEEDS_FRONTAGE | SUP), INV, 'whatever its low bits');
});

test('spawn gate: road band, water and buildings are INVALID; open grass is OPEN', () => {
  const r = build([
    { name: 'landcover', features: [{ type: 3, tags: { class: 'grass', subclass: 'grass' }, geom: [whole()] }] },
    { name: 'water', features: [{ type: 3, tags: { class: 'lake' }, geom: [box(50, 50, 60, 60)] }] },
    { name: 'transportation', features: [{ type: 2, tags: { class: 'minor' }, geom: [line([[0, 20], [CPE - 1, 20]])] }] },
  ]);
  assert.eq(r.roadMask[20 * CPE + 10], 1, 'the street is road ground');
  assert.eq(at(r, 10, 20), INV, 'the road band hosts nothing');
  assert.eq(at(r, 55, 55), INV, 'water hosts nothing');
  assert.eq(at(r, 10, 40), OPEN, 'plain grass is open to anything');
});

test('spawn gate: restricted land — school, kindergarten, hospital, rail, military, garages, construction — is INVALID', () => {
  for (const cls of ['school', 'kindergarten', 'hospital', 'railway', 'military', 'garages', 'construction']) {
    assert.truthy(W.RESTRICTED_LAND.has(cls), `${cls} is restricted`);
    const r = build([
      { name: 'landcover', features: [{ type: 3, tags: { class: 'grass', subclass: 'grass' }, geom: [whole()] }] },
      { name: 'landuse', features: [{ type: 3, tags: { class: cls }, geom: [box(20, 20, 40, 40)] }] },
    ]);
    assert.eq(at(r, 30, 30), INV, `${cls} grounds host nothing`);
    assert.eq(at(r, 5, 5), OPEN, `${cls}: far outside is open`);
    const flora = r.wildplants.concat(r.objects.filter((o) => o.kind !== 'chest')).filter((o) => {
      const ix = Math.floor(o.x / 7), iy = Math.floor(o.y / 7);
      return ix >= 21 && ix <= 39 && iy >= 21 && iy <= 39;
    });
    assert.eq(flora.length, 0, `nothing generated stands on ${cls} land`);
  }
});

test('spawn gate: farmland, orchard and industrial land are ROADSIDE only', () => {
  for (const [layer, tags] of [['landcover', { class: 'farmland', subclass: 'farmland' }],
    ['landcover', { class: 'farmland', subclass: 'orchard' }], ['landuse', { class: 'industrial' }]]) {
    const r = build([
      { name: layer, features: [{ type: 3, tags, geom: [whole()] }] },
      { name: 'transportation', features: [{ type: 2, tags: { class: 'minor' }, geom: [line([[0, 10], [CPE - 1, 10]])] }] },
    ]);
    const t = r.grid[40 * CPE + 30];
    assert.truthy(W.ROADSIDE_ONLY.has(t), `${tags.class} paints roadside-only ground (${t})`);
    assert.truthy(at(r, 30, 12) !== INV, `${tags.class}: two cells off the road is frontage`);
    assert.eq(at(r, 30, 40), INV, `${tags.class}: the interior is somebody's working ground`);
    assert.truthy(raw(r, 30, 40) & W.SPAWN_NEEDS_FRONTAGE, 'by the frontage flag');
  }
});

test('spawn gate: COMMERCIAL ground stays spawnable, frontage or not', () => {
  const r = build([{ name: 'landuse', features: [{ type: 3, tags: { class: 'commercial' }, geom: [whole()] }] }]);
  assert.eq(at(r, 32, 32), OPEN, 'a shopping centre\'s lot is open ground');
});

test('spawn gate: a back yard BEHIND a house is INVALID; the front yard is not', () => {
  // A street along row 10; a house footprint rows 13..16 (cols 20..27, 56 m²
  // a cell — a big one, beyond the house rule so no buffer muddies this); the
  // yard behind it at row 18 has a footpath 8 cells off to vouch for frontage.
  const r = build([
    { name: 'landuse', features: [residential()] },
    { name: 'transportation', features: [
      { type: 2, tags: { class: 'minor' }, geom: [line([[0, 10], [CPE - 1, 10]])] },
      { type: 2, tags: { class: 'path' }, geom: [line([[0, 21], [10, 21]])] },
    ] },
    { name: 'building', features: [{ type: 3, tags: { render_height: 20 }, geom: [box(18, 13, 30, 16)] }] },
  ]);
  assert.truthy(W.isBuildingTerrain(r.grid[14 * CPE + 24]), 'the house is painted');
  assert.truthy(at(r, 24, 12) !== INV, 'the front yard (street side) is not refused for being behind');
  assert.eq(at(r, 24, 18), INV, 'the yard behind the house is');
});

test('spawn gate: a PRIVATE way (driveway, access=no, foot=private|no) is no frontage', () => {
  for (const tags of [{ class: 'service', service: 'driveway' }, { class: 'minor', access: 'no' },
    { class: 'path', foot: 'private' }, { class: 'path', foot: 'no' }]) {
    assert.truthy(W.isPrivateWay(tags), `${JSON.stringify(tags)} is private`);
    const r = build([
      { name: 'landuse', features: [residential()] },
      { name: 'transportation', features: [{ type: 2, tags, geom: [line([[0, 30], [CPE - 1, 30]])] }] },
    ]);
    assert.eq(at(r, 20, 32), INV, `${JSON.stringify(tags)}: the lot beside it has no frontage`);
  }
  assert.falsy(W.isPrivateWay({ class: 'minor' }), 'an ordinary street is public');
  const pub = build([
    { name: 'landuse', features: [residential()] },
    { name: 'transportation', features: [{ type: 2, tags: { class: 'path' }, geom: [line([[0, 30], [CPE - 1, 30]])] }] },
  ]);
  assert.truthy(at(pub, 20, 32) !== INV, 'a public footpath is frontage');
});

test('spawn gate: a golf course vouches for nobody', () => {
  assert.falsy(W.PUBLIC_NEAR.has(T.GOLF), 'GOLF is out of PUBLIC_NEAR');
  const r = build([
    { name: 'landcover', features: [{ type: 3, tags: { class: 'grass', subclass: 'golf_course' }, geom: [box(0, 0, CPE - 1, 30)] }] },
    { name: 'landuse', features: [{ type: 3, tags: { class: 'residential' }, geom: [box(0, 31, CPE - 1, CPE - 1)] }] },
  ]);
  assert.eq(r.grid[20 * CPE + 20], T.GOLF, 'the course paints golf');
  assert.eq(at(r, 20, 20), OPEN, 'the course itself is open ground');
  assert.eq(at(r, 20, 33), INV, 'the yard backing onto it has no frontage');
});

test('spawn gate: within 40 m of a HOUSE is SUPPRESSED (minor things only)', () => {
  // A 7 m × 14 m (98 m²) single-storey house on residential land.
  const house = { type: 3, tags: { render_height: 6 }, geom: [box(30, 30, 31, 32)] };
  const r = build([{ name: 'landuse', features: [residential()] }, paths(), { name: 'building', features: [house] }]);
  const R = W.SPAWN_HOUSE_BUFFER_M / 7;
  assert.eq(at(r, 35, 31), SUP, '4 cells (28 m) off is buffered');
  assert.eq(at(r, 31 + Math.ceil(R) + 3, 31), OPEN, 'past 40 m is open');
  // Not a house: too big, too tall, or not on residential land.
  const tall = build([{ name: 'landuse', features: [residential()] }, paths(),
    { name: 'building', features: [{ ...house, tags: { render_height: 30 } }] }]);
  assert.eq(at(tall, 35, 31), OPEN, 'a tower block is no house');
  const shop = build([{ name: 'landuse', features: [{ type: 3, tags: { class: 'commercial' }, geom: [whole()] }] }, paths(),
    { name: 'building', features: [house] }]);
  assert.eq(at(shop, 35, 31), OPEN, 'a shop on commercial land is no house');
});

test('spawn gate: the major road\'s KERB BUFFER is SUPPRESSED', () => {
  const r = build([
    { name: 'landcover', features: [{ type: 3, tags: { class: 'grass', subclass: 'grass' }, geom: [whole()] }] },
    { name: 'transportation', features: [{ type: 2, tags: { class: 'primary' }, geom: [line([[0, 30], [CPE - 1, 30]])] }] },
  ]);
  let i = 30;
  while (r.roadMask[i * CPE + 10]) i++;
  assert.truthy(r.roadClass[i * CPE + 10] & W.ROAD_CLASS_MAJOR_BUFFER, 'the verge is in the kerb buffer');
  assert.eq(at(r, 10, i), SUP, 'and suppressed');
  assert.eq(at(r, 10, i + 6), OPEN, 'well back is open');
});

test('spawn gate: schools, kindergartens and playgrounds carry a 50 m buffer', () => {
  const R = Math.floor(W.SPAWN_CHILD_BUFFER_M / 7);
  for (const f of [
    { name: 'poi', features: [{ type: 1, tags: { class: 'school', subclass: 'kindergarten' }, geom: [[pt(32, 32)]] }] },
    { name: 'poi', features: [{ type: 1, tags: { class: 'school', subclass: 'school' }, geom: [[pt(32, 32)]] }] },
    { name: 'landuse', features: [{ type: 3, tags: { class: 'playground' }, geom: [box(31, 31, 33, 33)] }] },
  ]) {
    const r = build([{ name: 'landcover', features: [{ type: 3, tags: { class: 'grass', subclass: 'grass' }, geom: [whole()] }] }, f]);
    assert.eq(at(r, 32 + R - 1, 32), SUP, `${JSON.stringify(f.features[0].tags)}: inside 50 m`);
    assert.eq(at(r, 32 + R + 3, 32), OPEN, 'outside it');
  }
});

test('spawn gate: a SENSITIVE place is INVALID at its point and SUPPRESSED round it', () => {
  const r = build([
    { name: 'landcover', features: [{ type: 3, tags: { class: 'grass', subclass: 'grass' }, geom: [whole()] }] },
    { name: 'poi', features: [{ type: 1, tags: { class: 'memorial', name: 'Stolperstein' }, geom: [[pt(32, 32)]] }] },
  ]);
  assert.eq(at(r, 32, 32), INV, 'the memorial\'s own cell');
  assert.eq(at(r, 36, 32), SUP, 'the ground round it');
  assert.eq(at(r, 32 + Math.ceil(W.SPAWN_SENSITIVE_BUFFER_M / 7) + 2, 32), OPEN, 'past the buffer');
});

test('spawn gate: cemetery land is INVALID, and a church ON it suppresses its whole churchyard halo', () => {
  const layers = (church) => [
    { name: 'landcover', features: [{ type: 3, tags: { class: 'grass', subclass: 'grass' }, geom: [whole()] }] },
    { name: 'landuse', features: [{ type: 3, tags: { class: 'cemetery' }, geom: [box(28, 28, 36, 36)] }] },
    { name: 'poi', features: church ? [{ type: 1, tags: { class: 'place_of_worship', subclass: 'christian', name: 'St Mary Church' }, geom: [[pt(32, 32)]] }] : [] },
  ];
  const plain = build(layers(false)), church = build(layers(true));
  assert.eq(at(plain, 32, 32), INV, 'grave land hosts nothing (quiet land)');
  const d = Math.ceil(W.SPAWN_SENSITIVE_BUFFER_M / 7) + 3;   // past the cemetery's own buffer
  assert.eq(at(plain, 36 + d, 32), OPEN, 'past the cemetery\'s buffer is open');
  assert.eq(at(church, 36 + d, 32), SUP, 'but not round a church standing on it');
  assert.gte(W.churchyardBufferM(), Zones.ZONE_KINDS.stones.R, 'one number: the stones halo\'s reach');
});

// ── The classes ────────────────────────────────────────────────────────────

test('isSpawnCell: minor takes OPEN + SUPPRESSED; attractor and enemy take OPEN; nothing takes INVALID', () => {
  const g = new Uint8Array(9).fill(T.GRASS);
  const mask = Uint8Array.from([OPEN, SUP, INV, W.SPAWN_NEEDS_FRONTAGE, W.SPAWN_NEEDS_FRONTAGE | SUP, OPEN, OPEN, OPEN, OPEN]);
  const opts = { spawnClass: mask };
  const ok = (i, cls, o = opts) => W.isSpawnCell(g, 3, 3, i % 3, (i / 3) | 0, o, cls);
  assert.eq(W.SPAWN_CLASSES.join(), 'minor,attractor,enemy', 'three classes');
  assert.truthy(ok(0, 'minor') && ok(0, 'attractor') && ok(0, 'enemy'), 'OPEN: anything');
  assert.truthy(ok(1, 'minor'), 'SUPPRESSED: minor');
  assert.falsy(ok(1, 'attractor') || ok(1, 'enemy'), 'SUPPRESSED: no attractor, no enemy');
  assert.falsy(ok(2, 'minor') || ok(2, 'attractor') || ok(2, 'enemy'), 'INVALID: nothing');
  assert.falsy(ok(3, 'minor'), 'no frontage: nothing…');
  const withPoi = { spawnClass: mask, pois: [{ ix: 2, iy: 2 }] };
  assert.truthy(ok(3, 'minor', withPoi) && ok(3, 'enemy', withPoi), '…unless a POI in reach vouches (then its low bits: OPEN)');
  assert.truthy(ok(4, 'minor', withPoi), 'a vouched SUPPRESSED cell: minor');
  assert.falsy(ok(4, 'enemy', withPoi), 'still no enemy');
  assert.truthy(W.isFoeCell(g, 3, 3, 0, 0, opts) && !W.isFoeCell(g, 3, 3, 1, 0, opts), 'isFoeCell is the enemy class');
  // Live terrain still refuses (a pond carved after the mask was stamped).
  const pond = g.slice(); pond[0] = T.WATER;
  assert.falsy(W.isSpawnCell(pond, 3, 3, 0, 0, opts, 'minor'), 'water on the live grid');
  assert.falsy(W.isSpawnCell(g, 3, 3, 0, 0, { spawnClass: mask, occupied: new Set([0]) }, 'minor'), 'and what stands there');
});

test('relocateToSpawnCell: walks to the nearest cell THE CLASS may take', () => {
  const g = new Uint8Array(25).fill(T.GRASS);
  const mask = new Uint8Array(25).fill(SUP);
  mask[2 * 5 + 4] = OPEN;
  const opts = { spawnClass: mask };
  assert.eq(JSON.stringify(W.relocateToSpawnCell(g, 5, 5, 2, 2, opts, 3, 'minor')), JSON.stringify({ ix: 2, iy: 2 }), 'minor stays put');
  assert.eq(JSON.stringify(W.relocateToSpawnCell(g, 5, 5, 2, 2, opts, 3, 'attractor')), JSON.stringify({ ix: 4, iy: 2 }), 'an attractor walks to OPEN');
  assert.eq(W.relocateToSpawnCell(g, 5, 5, 2, 2, opts, 1, 'enemy'), null, 'or is dropped');
});

// ── Seams and determinism ──────────────────────────────────────────────────

test('spawn gate: a house over the seam buffers this side of it — the same from either tile', () => {
  // The house's footprint in tile (1,0)'s own frame, 1 cell in from its west
  // edge; tile (0,0) sees the same polygon in its MVT buffer, 64 cells east.
  const houseIn = (dx) => ({ name: 'building', features: [{ type: 3, tags: { render_height: 6 },
    geom: [[{ x: dx + 64, y: c2m(30) - 32 }, { x: dx + 64 + 64, y: c2m(30) - 32 }, { x: dx + 128, y: c2m(31) + 32 },
      { x: dx + 64, y: c2m(31) + 32 }, { x: dx + 64, y: c2m(30) - 32 }]] }] });
  const lu = { name: 'landuse', features: [{ type: 3, tags: { class: 'residential' },
    geom: [[{ x: -200, y: -200 }, { x: EXTENT + 200, y: -200 }, { x: EXTENT + 200, y: EXTENT + 200 }, { x: -200, y: EXTENT + 200 }, { x: -200, y: -200 }]] }] };
  const east = build([lu, paths(), houseIn(0)], 1, 0);
  const west = build([lu, paths(), houseIn(EXTENT)], 0, 0);
  assert.eq(at(east, 3, 30), SUP, 'the house\'s own tile buffers it');
  let n = 0;
  for (let k = 1; k <= 4; k++) {
    assert.eq(at(west, CPE - k, 30), SUP, `the neighbour buffers it too, ${k} cell(s) from the seam`);
    n++;
  }
  assert.eq(n, 4, 'across the seam');
  const bare = build([lu, paths()], 0, 0);
  assert.eq(at(bare, CPE - 2, 30), OPEN, 'the control: without the house that ground is open');
  const again = build([lu, paths(), houseIn(EXTENT)], 0, 0);
  assert.eq(Array.from(again.spawnClass).join(''), Array.from(west.spawnClass).join(''), 'a rebuild is byte-identical');
});

test('spawn gate: the fixture tiles build the same mask twice (no load-order or frame input)', () => {
  const tx = 2754, ty = 5566;
  const N = W.cellsPerEdgeForTile(ty);
  const a = W.rasterizeTile(MVT.decodeTile(FIXTURE_TILES[`${tx}_${ty}`]), N, tx, ty, W.tileEdgeMeters(W.latOfRowCentre(ty)));
  const b = W.rasterizeTile(MVT.decodeTile(FIXTURE_TILES[`${tx}_${ty}`]), N, tx, ty, W.tileEdgeMeters(47));
  assert.eq(Array.from(a.spawnClass).join(''), Array.from(b.spawnClass).join(''),
    'the mask is generated: the save\'s frame (tileEdgeM) never moves it');
  const cls = [0, 0, 0];
  for (const v of a.spawnClass) cls[W.spawnClassOf(v)]++;
  assert.truthy(cls[0] > 0 && cls[1] > 0 && cls[2] > 0, `all three classes occur on a real tile (${cls})`);
});

// ── Every spawner names its class ──────────────────────────────────────────

test('spawn gate: every isSpawnCell / relocateToSpawnCell call in src/ passes a spawn class', () => {
  const callArgs = (src, at) => {
    let depth = 0, i = at, start = -1;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '(') { if (depth++ === 0) start = i + 1; }
      else if (ch === ')') { if (--depth === 0) break; }
    }
    // Split the top-level arguments.
    const s = src.slice(start, i), out = [];
    let d = 0, cur = '';
    for (const ch of s) {
      if ('([{'.includes(ch)) d++;
      if (')]}'.includes(ch)) d--;
      if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const CLASS_ARG = /^(?:'(?:minor|attractor|enemy)'|cls|classOf\(what\)|o\.foe \? 'enemy' : 'attractor')$/;
  let calls = 0;
  const bad = [];
  for (const [file, src] of Object.entries(ALL_SRC)) {
    for (const [name, argN] of [['isSpawnCell', 7], ['relocateToSpawnCell', 8]]) {
      const re = new RegExp(`\\b${name}\\(`, 'g');
      let m;
      while ((m = re.exec(src))) {
        const lineStart = src.lastIndexOf('\n', m.index) + 1;
        const lineText = src.slice(lineStart, src.indexOf('\n', m.index));
        if (/^\s*\/\//.test(lineText) || /\bfunction\s+$/.test(src.slice(lineStart, m.index))) continue;   // comment / definition
        if (/\/\/.*$/.test(src.slice(lineStart, m.index))) continue;   // inside a trailing comment
        const args = callArgs(src, m.index + name.length);
        calls++;
        if (args.length !== argN || !CLASS_ARG.test(args[argN - 1])) bad.push(`${file}: ${lineText.trim()}`);
      }
    }
  }
  assert.gt(calls, 25, `the sweep found the spawners (${calls})`);
  assert.eq(bad.length, 0, `every call names its class:\n${bad.join('\n')}`);
});

// ── Cave entrances (the owner's "ladders") ─────────────────────────────────

test('cave entrances: an ATTRACTOR — never on SUPPRESSED or INVALID ground (the fixture tiles)', () => {
  let stairs = 0;
  for (const key of Object.keys(FIXTURE_TILES)) {
    const [tx, ty] = key.split('_').map(Number);
    const N = W.cellsPerEdgeForTile(ty), edge = W.tileEdgeMeters(W.latOfRowCentre(ty));
    const r = W.rasterizeTile(MVT.decodeTile(FIXTURE_TILES[key]), N, tx, ty, edge);
    const entry = { ...r, cellsPerEdge: N, objects: r.objects.slice() };
    W.maybePlaceCaveEntrance(entry, tx, ty, edge, r.objects, r.wildplants);
    for (const o of entry.objects) {
      if (o.kind !== 'staircase') continue;
      stairs++;
      const ix = Math.floor((o.x - tx * edge) / (edge / N)), iy = Math.floor((o.y - ty * edge) / (edge / N));
      assert.eq(W.spawnClassOf(r.spawnClass[iy * N + ix]), OPEN, `${o.id} on OPEN ground`);
    }
  }
  assert.gt(stairs, 0, `the fixtures hold mine mouths (${stairs})`);
  assert.truthy(/isSpawnCell\(grid, N, N, lix, liy, stairOpts, 'attractor'\)/.test(WORLDGEN_SRC), 'the stair asks as an attractor');
  assert.gte(W.CAVE_MOUTH_RELOCATE_CELLS, 2, 'a displaced mouth walks outward from its rock');
});

test('cave entrances: a displaced mouth walks off its rock to OPEN ground, deterministically', () => {
  // A rock cluster in a yard: the cells round the rock are SUPPRESSED, OPEN
  // ground three cells east.
  const N = 16, edge = N * 7;
  const grid = new Uint8Array(N * N).fill(T.GRASS);
  const spawnClass = new Uint8Array(N * N).fill(SUP);
  for (let y = 0; y < N; y++) for (let x = 11; x < N; x++) spawnClass[y * N + x] = OPEN;
  const rock = W.makeObject('mineralrock', 8.5 * 7, 8.5 * 7, 'mr_x', { caveVariant: 0, _clusterId: 'c1' });
  const mk = () => ({ grid, cellsPerEdge: N, objects: [rock], wildplants: [], roadMask: new Uint8Array(N * N), spawnClass });
  const a = mk(), b = mk();
  W.maybePlaceCaveEntrance(a, 0, 0, edge, [rock], []);
  W.maybePlaceCaveEntrance(b, 0, 0, edge, [rock], []);
  const sa = a.objects.filter((o) => o.kind === 'staircase');
  assert.eq(sa.length, 1, 'the tile keeps its way down');
  const ix = Math.floor(sa[0].x / 7);
  assert.gte(ix, 11, 'on the OPEN ground');
  assert.lte(ix - 8, W.CAVE_MOUTH_RELOCATE_CELLS, 'within the walk');
  assert.eq(sa[0].id, b.objects.find((o) => o.kind === 'staircase').id, 'the same cell every build');
});

// ── Headstones and the churchyard ──────────────────────────────────────────

test('headstones: an ENEMY spawn — only on OPEN ground (the zone dressing names it)', () => {
  assert.truthy(/what\.what === 'headstone'\) \? 'enemy'/.test(ALL_SRC['zones.js']), 'a pattern headstone is an enemy');
  assert.truthy(/HEADSTONE_P \* s && ok\(ix, iy, 'enemy'\)/.test(ALL_SRC['zones.js']), 'a grave-lattice headstone too');
  assert.truthy(/ok\(ix, iy, 'attractor'\)/.test(ALL_SRC['zones.js']), 'the grove shrine is an attractor');
});

// ── The live private-ground veto (per-player only) ─────────────────────────

test('private veto: an Overpass fence / private area masks its cells; unknown vetoes nothing', () => {
  const tx = 2754, ty = 5566;
  const N = W.cellsPerEdgeForTile(ty);
  const n = 1 << W.Z;
  const lon = (fx) => (tx + fx) / n * 360 - 180;
  const lat = (fy) => Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + fy) / n))) * 180 / Math.PI;
  const fence = { type: 'way', tags: { barrier: 'fence' }, geometry: [{ lat: lat(0.5), lon: lon(0.1) }, { lat: lat(0.5), lon: lon(0.3) }] };
  const yard = { type: 'way', tags: { access: 'private', landuse: 'residential' }, geometry: [
    { lat: lat(0.7), lon: lon(0.7) }, { lat: lat(0.7), lon: lon(0.8) }, { lat: lat(0.8), lon: lon(0.8) },
    { lat: lat(0.8), lon: lon(0.7) }, { lat: lat(0.7), lon: lon(0.7) }] };
  const mask = W.privateVetoMask([fence, yard], tx, ty);
  assert.eq(mask.length, N * N, 'on the tile\'s own grid (frame-free)');
  const c = (f) => Math.floor(f * N);
  assert.eq(mask[c(0.5) * N + c(0.2)], 1, 'the fence line');
  assert.eq(mask[c(0.75) * N + c(0.75)], 1, 'inside the private area');
  assert.eq(mask[c(0.2) * N + c(0.75)], 0, 'elsewhere nothing');
  assert.falsy(W.privateVetoAt(tx, ty, c(0.2), c(0.5)), 'before the fetch lands: no veto (fails open)');
  W.setPrivateVeto(tx, ty, mask);
  assert.truthy(W.privateVetoAt(tx, ty, c(0.2), c(0.5)), 'once it has');
  W.setPrivateVeto(tx, ty, null);
  const ql = W.buildPrivateVetoQL(tx, ty);
  assert.truthy(/barrier/.test(ql) && /access/.test(ql) && /out geom/.test(ql), 'fences and private areas, with geometry');
  assert.eq(W.PRIVATE_VETO_IDB_PREFIX, 'pvt1', 'cached under its own key prefix');
});

test('private veto: read by the per-player things only — never by the generated world', () => {
  const app = ALL_SRC['app.js'], ai = ALL_SRC['creature_ai.js'];
  assert.truthy(/privateVetoAt\(tx, ty, ix, iy\)/.test(ai), 'walkableDestination (the bounty, any destination)');
  assert.gte((app.match(/WorldGen\.privateVetoAt\(/g) || []).length, 3, 'the coin burst, the feet coins and the bounty pack');
  for (const f of ['worldgen.js', 'scene_creatures.js', 'zones.js', 'street_variants.js', 'lairs.js', 'traps.js', 'npc.js']) {
    const src = ALL_SRC[f].replace(/\/\/.*$/gm, '');
    const uses = (src.match(/privateVetoAt\(/g) || []).length;
    assert.eq(uses, f === 'worldgen.js' ? 1 : 0, `${f}: no generated spawner reads the live veto`);
  }
});
})();
