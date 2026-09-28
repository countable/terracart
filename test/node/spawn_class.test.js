// THE SPAWN GATE (Sep 2026): entry.spawnWhy + isSpawnCell's spawn class.
//
// One per-tile mask (WorldGen.stampSpawnWhySteps, beside the road mask, in
// the sliced build) records WHY each cell is refused — reason bits
// (WorldGen.SPAWN_WHY): HARD ones refuse every spawn, TYPED ones only the
// classes whose row of WorldGen.SPAWN_CLASS_BLOCKS names them. Every spawner
// names its class; a creature's comes from creature_ai.js creatureSpawnClass.
//
// What is pinned:
//   · each reason on a synthetic tile: ROAD = the roadMask exactly, water /
//     buildings, restricted and kindergarten land (hard), school / college
//     grounds (typed, own cells only), fields (edge typed, interior hard),
//     industrial roadside only, behind-a-house, private ways, golf, the
//     house buffer on lot land only (a park beside houses stays open), the
//     kerb (fast movers only), sensitive ground, churchyards, quiet land;
//   · the class table, and the POI lift of PRIVATE;
//   · seam determinism: a house over the seam buffers this side of it, the
//     same distance from either tile, and a rebuild is byte-identical;
//   · every spawner in src/ passes a class (a source sweep);
//   · cave entrances only ever stand on cave ground (the fixture tiles);
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
const at = (r, cx, cy) => W.spawnClassOf(r.spawnWhy[cy * CPE + cx]);
const raw = (r, cx, cy) => r.spawnWhy[cy * CPE + cx];
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
const WHY = W.SPAWN_WHY;
const has = (r, cx, cy, bit) => !!(raw(r, cx, cy) & bit);
const grass = () => ({ name: 'landcover', features: [{ type: 3, tags: { class: 'grass', subclass: 'grass' }, geom: [whole()] }] });

test('spawn gate: the mask rides the build and the entry — reason bits, a Uint16 a cell', () => {
  const r = build([{ name: 'landuse', features: [residential()] }, paths()]);
  assert.truthy(r.spawnWhy instanceof Uint16Array, 'a Uint16Array of reasons');
  assert.eq(r.spawnWhy.length, CPE * CPE, 'one per cell');
  assert.truthy(/entry\.spawnWhy = spawnWhy;/.test(WORLDGEN_SRC), 'loadTile carries it');
  assert.truthy(/const spawnWhy = yield\* stampSpawnWhySteps\(/.test(WORLDGEN_SRC), 'stamped in the sliced build (yields)');
  // The verdict is DERIVED (the overlays' convenience): any hard reason is
  // INVALID, any typed one SUPPRESSED.
  assert.eq(W.SPAWN_WHY_HARD & W.SPAWN_WHY_TYPED, 0, 'hard and typed reasons are disjoint bits');
  for (const [k, bit] of Object.entries(WHY)) {
    assert.eq(W.spawnClassOf(bit), (bit & W.SPAWN_WHY_HARD) ? INV : SUP, `${k} reads as ${(bit & W.SPAWN_WHY_HARD) ? 'INVALID' : 'SUPPRESSED'}`);
  }
  assert.eq(W.spawnClassOf(WHY.HOUSE | WHY.ROAD), INV, 'a hard reason wins');
  assert.eq(W.spawnClassOf(0), OPEN, 'no reason: OPEN');
});

test('spawn gate: ROAD is the roadMask (≥ half the cell under the band) — a band\'s lick is not road', () => {
  const r = build([
    grass(),
    { name: 'water', features: [{ type: 3, tags: { class: 'lake' }, geom: [box(50, 50, 60, 60)] }] },
    { name: 'transportation', features: [
      { type: 2, tags: { class: 'minor' }, geom: [line([[0, 20], [CPE - 1, 20]])] },
      { type: 2, tags: { class: 'primary' }, geom: [line([[0, 40], [CPE - 1, 40]])] }] },
  ]);
  assert.eq(r.roadMask[20 * CPE + 10], 1, 'the street is road ground');
  assert.truthy(has(r, 10, 20, WHY.ROAD), 'the road band hosts nothing (ROAD)');
  assert.truthy(has(r, 55, 55, WHY.TERRAIN), 'water hosts nothing (TERRAIN)');
  assert.eq(raw(r, 10, 30), 0, 'plain grass carries no reason');
  // Every cell: ROAD iff the roadMask.
  for (let i = 0; i < CPE * CPE; i++) {
    if (!!(r.spawnWhy[i] & WHY.ROAD) !== !!r.roadMask[i]) { assert.truthy(false, `cell ${i}: ROAD disagrees with the roadMask`); break; }
  }
  // A cell the primary's band only licks (MAJOR_BAND, under half covered):
  // KERB — typed, never ROAD.
  let lick = -1;
  for (let y = 34; y < 47 && lick < 0; y++) {
    const i = y * CPE + 10;
    if ((r.roadClass[i] & W.ROAD_CLASS_MAJOR_BAND) && !r.roadMask[i]) lick = y;
  }
  if (lick >= 0) {
    assert.falsy(has(r, 10, lick, WHY.ROAD), 'a licked cell is not ROAD');
    assert.truthy(has(r, 10, lick, WHY.KERB), 'it is KERB');
  }
});

test('spawn gate: restricted land — hospital, rail, military, garages, construction — and KINDERGARTEN grounds are hard', () => {
  for (const cls of ['hospital', 'railway', 'military', 'garages', 'construction', 'kindergarten']) {
    const r = build([grass(), { name: 'landuse', features: [{ type: 3, tags: { class: cls }, geom: [box(20, 20, 40, 40)] }] }]);
    assert.eq(at(r, 30, 30), INV, `${cls} grounds host nothing`);
    assert.truthy(has(r, 30, 30, cls === 'kindergarten' ? WHY.KINDERGARTEN : WHY.RESTRICTED), `${cls}: by its reason`);
    assert.eq(at(r, 5, 5), OPEN, `${cls}: far outside is open`);
    const flora = r.wildplants.concat(r.objects.filter((o) => o.kind !== 'chest')).filter((o) => {
      const ix = Math.floor(o.x / 7), iy = Math.floor(o.y / 7);
      return ix >= 21 && ix <= 39 && iy >= 21 && iy <= 39;
    });
    assert.eq(flora.length, 0, `nothing generated stands on ${cls} land`);
  }
});

test('spawn gate: SCHOOL / college grounds are TYPED (minor things only), on the grounds\' own cells — no buffer', () => {
  for (const cls of ['school', 'college', 'university']) {
    assert.truthy(W.SCHOOL_LAND.has(cls) && !W.RESTRICTED_LAND.has(cls), `${cls}: school land, not restricted`);
    const r = build([grass(), { name: 'landuse', features: [{ type: 3, tags: { class: cls }, geom: [box(20, 20, 40, 40)] }] }]);
    assert.eq(at(r, 30, 30), SUP, `${cls}: suppressed, not refused`);
    assert.truthy(has(r, 30, 30, WHY.SCHOOL), 'by SCHOOL');
    assert.eq(raw(r, 43, 30), 0, `${cls}: the park beside it is untouched (no radius spills)`);
    const g = r.grid;
    assert.truthy(W.isSpawnCell(g, CPE, CPE, 30, 30, { spawnWhy: r.spawnWhy }, 'minor'), 'flora may grow on the field');
    for (const c of ['fauna', 'npc', 'attractor', 'enemy']) {
      assert.falsy(W.isSpawnCell(g, CPE, CPE, 30, 30, { spawnWhy: r.spawnWhy }, c), `${c}: not on school grounds`);
    }
    assert.falsy(W.isSpawnCell(g, CPE, CPE, 30, 30, { spawnWhy: r.spawnWhy, schoolHours: true }, 'minor'),
      'in school hours a timed spawn refuses the grounds whatever its class');
  }
  // School hours: weekdays 07:00–17:00, local.
  assert.truthy(W.isSchoolHours(new Date(2026, 8, 28, 9)), 'a Monday morning');
  assert.falsy(W.isSchoolHours(new Date(2026, 8, 28, 18)), 'a Monday evening');
  assert.falsy(W.isSchoolHours(new Date(2026, 8, 27, 11)), 'a Sunday');
  // The generated world never reads a clock.
  const gen = ['worldgen.js', 'zones.js', 'street_variants.js', 'lairs.js', 'npc.js', 'traps.js']
    .map((f) => ALL_SRC[f].replace(/\/\/.*$/gm, '')).join('\n');
  assert.falsy(/schoolHours:|isSchoolHours\(/.test(gen.replace(/function isSchoolHours[\s\S]*?\n  }\n/, '')
    .replace(/opts\.schoolHours/g, '')), 'no generated spawner passes schoolHours');
});

test('spawn gate: FIELDS — an orchard / farm EDGE hosts minor things, its INTERIOR nothing; industrial is roadside only', () => {
  for (const tags of [{ class: 'farmland', subclass: 'farmland' }, { class: 'farmland', subclass: 'orchard' }]) {
    const r = build([{ name: 'landcover', features: [
      { type: 3, tags: { class: 'grass', subclass: 'grass' }, geom: [whole()] },
      { type: 3, tags, geom: [box(10, 10, 50, 50)] }] }]);
    const t = r.grid[30 * CPE + 30];
    assert.truthy(W.FARM_TYPES.has(t), `${tags.subclass} paints a field (${t})`);
    assert.truthy(has(r, 30, 30, WHY.FARM_INTERIOR), `${tags.subclass}: the interior is FARM_INTERIOR`);
    assert.eq(at(r, 30, 30), INV, 'nothing grows or stands mid-field');
    // Find the field's west edge on row 30 and check the edge band.
    let x0 = 0;
    while (x0 < CPE && !W.FARM_TYPES.has(r.grid[30 * CPE + x0])) x0++;
    for (let k = 0; k < W.FARM_EDGE_CELLS; k++) {
      assert.truthy(has(r, x0 + k, 30, WHY.FARM) && !has(r, x0 + k, 30, WHY.FARM_INTERIOR), `${k} in from the edge: FARM`);
      assert.truthy(W.isSpawnCell(r.grid, CPE, CPE, x0 + k, 30, { spawnWhy: r.spawnWhy }, 'minor'), 'a fruit tree may stand there');
      for (const c of ['attractor', 'enemy', 'npc', 'cave']) {
        assert.falsy(W.isSpawnCell(r.grid, CPE, CPE, x0 + k, 30, { spawnWhy: r.spawnWhy }, c), `no ${c} on a field`);
      }
    }
    assert.truthy(has(r, x0 + W.FARM_EDGE_CELLS + 1, 30, WHY.FARM_INTERIOR), 'past the edge band: interior');
  }
  const ind = build([
    { name: 'landuse', features: [{ type: 3, tags: { class: 'industrial' }, geom: [whole()] }] },
    { name: 'transportation', features: [{ type: 2, tags: { class: 'minor' }, geom: [line([[0, 10], [CPE - 1, 10]])] }] },
  ]);
  assert.truthy(W.ROADSIDE_ONLY.has(ind.grid[40 * CPE + 30]), 'industrial is roadside-only ground');
  assert.truthy(at(ind, 30, 12) !== INV, 'two cells off the road is frontage');
  assert.truthy(has(ind, 30, 40, WHY.PRIVATE), 'the interior has no frontage (PRIVATE)');
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

test('spawn gate: within 40 m of a HOUSE is the typed HOUSE reason — on lot land only', () => {
  // A 7 m × 14 m (98 m²) single-storey house on residential land.
  const house = { type: 3, tags: { render_height: 6 }, geom: [box(30, 30, 31, 32)] };
  const r = build([{ name: 'landuse', features: [residential()] }, paths(), { name: 'building', features: [house] }]);
  const R = W.SPAWN_HOUSE_BUFFER_M / 7;
  assert.eq(at(r, 35, 31), SUP, '4 cells (28 m) off is buffered');
  assert.truthy(has(r, 35, 31, WHY.HOUSE), 'by HOUSE');
  assert.eq(at(r, 31 + Math.ceil(R) + 3, 31), OPEN, 'past 40 m is open');
  // Not a house: too big, too tall, or not on residential land.
  const tall = build([{ name: 'landuse', features: [residential()] }, paths(),
    { name: 'building', features: [{ ...house, tags: { render_height: 30 } }] }]);
  assert.eq(at(tall, 35, 31), OPEN, 'a tower block is no house');
  const shop = build([{ name: 'landuse', features: [{ type: 3, tags: { class: 'commercial' }, geom: [whole()] }] }, paths(),
    { name: 'building', features: [house] }]);
  assert.eq(at(shop, 35, 31), OPEN, 'a shop on commercial land is no house');
  // PUBLIC LAND is never suppressed by the houses: a park polygon beside the
  // house (whatever paint won its cells) stays open.
  const park = build([{ name: 'landuse', features: [residential()] }, paths(),
    { name: 'park', features: [{ type: 3, tags: { class: 'park' }, geom: [box(34, 26, 44, 36)] }] },
    { name: 'building', features: [house] }]);
  assert.falsy(has(park, 36, 31, WHY.HOUSE), 'a park by the houses carries no HOUSE');
  assert.falsy(has(park, 36, 31, WHY.BEHIND_HOUSE), 'nor BEHIND_HOUSE');
  assert.truthy(has(park, 31, 35, WHY.HOUSE), 'the yard next door still does');
  // …but a DESIGNATION polygon (a heritage conservation area drawn over the
  // whole neighbourhood) is no park: its yards keep the house rule.
  const heritage = build([{ name: 'landuse', features: [residential()] }, paths(),
    { name: 'park', features: [{ type: 3, tags: { class: 'protected_area' }, geom: [whole()] }] },
    { name: 'building', features: [house] }]);
  assert.truthy(has(heritage, 35, 31, WHY.HOUSE), 'a conservation area\'s yards still carry HOUSE');
  // The classes: animals, villagers, headstones and cave mouths ignore it.
  const g = r.grid, o = { spawnWhy: r.spawnWhy };
  for (const c of ['minor', 'fauna', 'fastFauna', 'npc', 'headstone', 'cave']) {
    assert.truthy(W.isSpawnCell(g, CPE, CPE, 35, 31, o, c), `${c}: by the houses is fine`);
  }
  for (const c of ['attractor', 'enemy', 'fastEnemy']) {
    assert.falsy(W.isSpawnCell(g, CPE, CPE, 35, 31, o, c), `${c}: not by a front window`);
  }
});

test('spawn gate: the major road\'s KERB BUFFER is the typed KERB reason — fast movers only', () => {
  const r = build([
    grass(),
    { name: 'transportation', features: [{ type: 2, tags: { class: 'primary' }, geom: [line([[0, 30], [CPE - 1, 30]])] }] },
  ]);
  let i = 30;
  while (r.roadMask[i * CPE + 10]) i++;
  assert.truthy(r.roadClass[i * CPE + 10] & W.ROAD_CLASS_MAJOR_BUFFER, 'the verge is in the kerb buffer');
  assert.eq(at(r, 10, i), SUP, 'and suppressed');
  assert.truthy(has(r, 10, i, WHY.KERB), 'by KERB');
  assert.eq(at(r, 10, i + 6), OPEN, 'well back is open');
  const o = { spawnWhy: r.spawnWhy };
  for (const c of ['fastEnemy', 'fastFauna']) assert.falsy(W.isSpawnCell(r.grid, CPE, CPE, 10, i, o, c), `${c}: off the kerb`);
  for (const c of ['minor', 'enemy', 'fauna', 'npc', 'headstone', 'attractor', 'cave']) {
    assert.truthy(W.isSpawnCell(r.grid, CPE, CPE, 10, i, o, c), `${c}: the kerb is not its reason`);
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

test('isSpawnCell: each class refuses every hard reason and its own row\'s typed ones (SPAWN_CLASS_BLOCKS)', () => {
  assert.eq(W.SPAWN_CLASSES.join(), 'minor,headstone,cave,fauna,fastFauna,npc,attractor,enemy,fastEnemy', 'the classes');
  const B = W.SPAWN_CLASS_BLOCKS;
  // The owner's table (Sep 2026).
  assert.eq(B.minor, 0, 'minor: hard reasons only');
  assert.eq(B.headstone, WHY.SENSITIVE, 'headstone: sensitive ground');
  assert.eq(B.cave, WHY.SENSITIVE | WHY.FARM, 'cave: sensitive ground, fields');
  assert.eq(B.fauna, WHY.SCHOOL | WHY.SENSITIVE, 'fauna: school, sensitive');
  assert.eq(B.fastFauna, B.fauna | WHY.KERB, 'fast fauna: + the kerb');
  assert.eq(B.npc, WHY.SCHOOL | WHY.SENSITIVE | WHY.FARM, 'npc: school, sensitive, fields');
  assert.eq(B.attractor, WHY.HOUSE | WHY.SCHOOL | WHY.SENSITIVE | WHY.FARM, 'attractor: houses, school, sensitive, fields');
  assert.eq(B.enemy, B.attractor, 'enemy: the attractor row');
  assert.eq(B.fastEnemy, B.enemy | WHY.KERB, 'fast enemy: + the kerb');
  const reasons = Object.values(WHY);
  const g = new Uint8Array(reasons.length + 1).fill(T.GRASS);
  const mask = Uint16Array.from([0, ...reasons]);
  const ok = (i, cls, extra) => W.isSpawnCell(g, g.length, 1, i, 0, { spawnWhy: mask, ...extra }, cls);
  for (const cls of W.SPAWN_CLASSES) {
    assert.truthy(ok(0, cls), `${cls}: a cell with no reason`);
    reasons.forEach((bit, k) => {
      const want = !(bit & W.SPAWN_WHY_HARD) && !(bit & B[cls]);
      assert.eq(ok(k + 1, cls), want, `${cls} on ${Object.keys(WHY)[k]}`);
    });
  }
  assert.truthy(ok(0, undefined), 'no class reads as minor');
  // PRIVATE (no frontage) is lifted by a POI in reach.
  const iP = reasons.indexOf(WHY.PRIVATE) + 1;
  assert.truthy(ok(iP, 'enemy', { pois: [{ ix: iP, iy: 0 }] }), 'a POI in reach vouches for a PRIVATE cell');
  assert.truthy(W.isFoeCell(g, g.length, 1, 0, 0, { spawnWhy: mask }), 'isFoeCell: the fast foe row');
  assert.falsy(W.isFoeCell(g, g.length, 1, reasons.indexOf(WHY.KERB) + 1, 0, { spawnWhy: mask }), 'kerb included');
  // Live terrain still refuses (a pond carved after the mask was stamped).
  const pond = g.slice(); pond[0] = T.WATER;
  assert.falsy(W.isSpawnCell(pond, g.length, 1, 0, 0, { spawnWhy: mask }, 'minor'), 'water on the live grid');
  assert.falsy(ok(0, 'minor', { occupied: new Set([0]) }), 'and what stands there');
});

test('relocateToSpawnCell: walks to the nearest cell THE CLASS may take', () => {
  const g = new Uint8Array(25).fill(T.GRASS);
  const mask = new Uint16Array(25).fill(WHY.HOUSE);
  mask[2 * 5 + 4] = 0;
  const opts = { spawnWhy: mask };
  assert.eq(JSON.stringify(W.relocateToSpawnCell(g, 5, 5, 2, 2, opts, 3, 'fauna')), JSON.stringify({ ix: 2, iy: 2 }), 'fauna stays put by the house');
  assert.eq(JSON.stringify(W.relocateToSpawnCell(g, 5, 5, 2, 2, opts, 3, 'attractor')), JSON.stringify({ ix: 4, iy: 2 }), 'an attractor walks off it');
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
  // (Column 3 and column 63 are footpaths — public ground, never HOUSE.)
  assert.eq(at(east, 4, 30), SUP, 'the house\'s own tile buffers it');
  let n = 0;
  for (let k = 2; k <= 4; k++) {
    assert.eq(at(west, CPE - k, 30), SUP, `the neighbour buffers it too, ${k} cell(s) from the seam`);
    n++;
  }
  assert.eq(n, 3, 'across the seam');
  const bare = build([lu, paths()], 0, 0);
  assert.eq(at(bare, CPE - 2, 30), OPEN, 'the control: without the house that ground is open');
  const again = build([lu, paths(), houseIn(EXTENT)], 0, 0);
  assert.eq(Array.from(again.spawnWhy).join(''), Array.from(west.spawnWhy).join(''), 'a rebuild is byte-identical');
});

test('spawn gate: the fixture tiles build the same mask twice (no load-order or frame input)', () => {
  const tx = 2754, ty = 5566;
  const N = W.cellsPerEdgeForTile(ty);
  const a = W.rasterizeTile(MVT.decodeTile(FIXTURE_TILES[`${tx}_${ty}`]), N, tx, ty, W.tileEdgeMeters(W.latOfRowCentre(ty)));
  const b = W.rasterizeTile(MVT.decodeTile(FIXTURE_TILES[`${tx}_${ty}`]), N, tx, ty, W.tileEdgeMeters(47));
  assert.eq(Array.from(a.spawnWhy).join(''), Array.from(b.spawnWhy).join(''),
    'the mask is generated: the save\'s frame (tileEdgeM) never moves it');
  const cls = [0, 0, 0];
  for (const v of a.spawnWhy) cls[W.spawnClassOf(v)]++;
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
  const CLASS_ARG = new RegExp(`^(?:'(?:${W.SPAWN_CLASSES.join('|')})'|cls|classOf\\(what\\)|spClass|guardClass|creatureSpawnClass\\((?:kind|kindStr)\\))$`);
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

test('cave entrances: a CAVE spawn — never on hard ground, sensitive ground or a field (the fixture tiles)', () => {
  let stairs = 0, byHouse = 0;
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
      const v = r.spawnWhy[iy * N + ix];
      assert.eq(v & (W.SPAWN_WHY_HARD | W.SPAWN_CLASS_BLOCKS.cave), 0, `${o.id} on cave ground`);
      if (v & WHY.HOUSE) byHouse++;
    }
  }
  assert.gt(stairs, 0, `the fixtures hold mine mouths (${stairs})`);
  assert.truthy(/isSpawnCell\(grid, N, N, lix, liy, stairOpts, 'cave'\)/.test(WORLDGEN_SRC), 'the stair asks as a cave spawn');
  assert.gte(W.CAVE_MOUTH_RELOCATE_CELLS, 2, 'a displaced mouth walks outward from its rock');
});

test('cave entrances: a displaced mouth walks off its rock to cave ground, deterministically', () => {
  // A rock cluster on sensitive ground: the cells round the rock are
  // SENSITIVE, clear ground three cells east.
  const N = 16, edge = N * 7;
  const grid = new Uint8Array(N * N).fill(T.GRASS);
  const spawnWhy = new Uint16Array(N * N).fill(WHY.SENSITIVE);
  for (let y = 0; y < N; y++) for (let x = 11; x < N; x++) spawnWhy[y * N + x] = 0;
  const rock = W.makeObject('mineralrock', 8.5 * 7, 8.5 * 7, 'mr_x', { caveVariant: 0, _clusterId: 'c1' });
  const mk = () => ({ grid, cellsPerEdge: N, objects: [rock], wildplants: [], roadMask: new Uint8Array(N * N), spawnWhy });
  const a = mk(), b = mk();
  W.maybePlaceCaveEntrance(a, 0, 0, edge, [rock], []);
  W.maybePlaceCaveEntrance(b, 0, 0, edge, [rock], []);
  const sa = a.objects.filter((o) => o.kind === 'staircase');
  assert.eq(sa.length, 1, 'the tile keeps its way down');
  const ix = Math.floor(sa[0].x / 7);
  assert.gte(ix, 11, 'on the clear ground');
  assert.lte(ix - 8, W.CAVE_MOUTH_RELOCATE_CELLS, 'within the walk');
  assert.eq(sa[0].id, b.objects.find((o) => o.kind === 'staircase').id, 'the same cell every build');
  // …and the house buffer is NOT a cave's reason: a mouth by the houses stays.
  const house = mk();
  house.spawnWhy = new Uint16Array(N * N).fill(WHY.HOUSE);
  W.maybePlaceCaveEntrance(house, 0, 0, edge, [rock], []);
  const sh = house.objects.filter((o) => o.kind === 'staircase');
  assert.eq(sh.length, 1, 'a mouth by the houses');
  assert.lte(Math.abs(Math.floor(sh[0].x / 7) - 8), 1, 'right beside its rock');
});

// ── Headstones and the churchyard ──────────────────────────────────────────

test('headstones: a HEADSTONE spawn — by the houses is fine, sensitive ground never (the zone dressing names it)', () => {
  assert.truthy(/what\.what === 'headstone'\) \? 'headstone'/.test(ALL_SRC['zones.js']), 'a pattern headstone');
  assert.truthy(/HEADSTONE_P \* s && ok\(ix, iy, 'headstone'\)/.test(ALL_SRC['zones.js']), 'a grave-lattice headstone too');
  assert.truthy(/ok\(ix, iy, 'attractor'\)/.test(ALL_SRC['zones.js']), 'the grove shrine is an attractor');
  const g = new Uint8Array(4).fill(T.CHURCHYARD);
  const mask = Uint16Array.from([0, WHY.HOUSE, WHY.KERB, WHY.SENSITIVE]);
  const ok = (i) => W.isSpawnCell(g, 4, 1, i, 0, { spawnWhy: mask }, 'headstone');
  assert.truthy(ok(1) && ok(2), 'by a house or a busy road');
  assert.falsy(ok(3), 'never on sensitive ground (round a real graveyard, a memorial)');
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
