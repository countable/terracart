// THE WORLD IS THE SAME FOR EVERYONE — whatever latitude their home is at.
//
// Multiplayer players must see the IDENTICAL generated world given the same
// MVT / Overpass / sidecar bytes. What differed was each save's home latitude
// (app.js START_LAT → WorldGen.loadTile(tx, ty, START_LAT)): the tile edge in
// metres (tileEdgeMeters(lat)) and the cell count (cellsPerEdgeForLat(lat))
// both came from it, and generation read both — scatter steps in metres, areas
// in m², ids built from Math.round of frame metres, a global floor(x / CELL_M)
// cell, the sidecar snapped on a CELL_M grid in frame metres.
//
// The split that fixed it:
//   • the GRID is the tile's own: cellsPerEdgeForTile(ty), from the latitude
//     of the tile's row — a pure function of ty;
//   • the FRAME (tileEdgeM from the save's lat) only places a settled cell in
//     world metres for drawing. Positions may differ between saves; which
//     cell holds what, every id, every seed, every species / variant / tier
//     may not.
//
// These tests build one synthetic MVT tile under several START_LATs — two
// with the same legacy cell count and one across a cellsPerEdgeForLat flip —
// and require the generated world to be identical cell for cell.
(function () {
const W = WorldGen;
const EXTENT = 4096;
// A real Kelowna-ish tile: row 5567 sits at ~49.845°.
const { x: TX, y: TY } = W.tileXYForLonLat(-119.47, 49.85);
// 49.82 and 49.854 share a legacy cell count (225); 49.80 flips it (226).
const LATS = [49.80, 49.82, 49.854];

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}
// The fixture is in MVT units, like real tile bytes: nothing in it knows a
// latitude. Every pass that has a metre in it gets something to chew on —
// forest + orchard scatter, residential / industrial / quarry rock clusters,
// commercial hedge maze, buildings of every tier, roads (and so the road
// mask), a pier, footpaths, street names, POI chests (incl. a park pad and a
// civic block) and parking X marks.
function layers() {
  const rnd = lcg(2468);
  const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }];
  const pts = (a) => a.map(([x, y]) => ({ x, y }));
  const blob = (cx, cy, r, n) => {
    const a = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n * 2 * Math.PI;
      a.push({ x: cx + r * (1 + 0.3 * Math.sin(3 * t)) * Math.cos(t), y: cy + r * (1 + 0.3 * Math.sin(3 * t)) * Math.sin(t) });
    }
    return [a];
  };
  const b = [];
  for (let i = 0; i < 400; i++) {
    const gx = i % 20, gy = Math.floor(i / 20), st = EXTENT / 20;
    const big = i % 37 === 0;
    b.push({ type: 3, tags: { render_height: 4 + rnd() * 4 },
      geom: [rect(gx * st + rnd() * 5, gy * st + rnd() * 5, (big ? 90 : 20) + rnd() * 15, (big ? 70 : 18) + rnd() * 15)] });
  }
  const roads = [];
  for (let i = 0; i <= 8; i++) {
    const p = 30 + i * 480;
    roads.push({ type: 2, tags: { class: i % 3 ? 'minor' : 'primary' }, geom: [pts([[0, p], [EXTENT, p + 7]])] });
    roads.push({ type: 2, tags: { class: 'minor' }, geom: [pts([[p, 0], [p + 11, EXTENT]])] });
  }
  roads.push({ type: 2, tags: { class: 'path' }, geom: [pts([[100, 100], [900, 1300], [1700, 1500]])] });
  roads.push({ type: 2, tags: { class: 'pier' }, geom: [pts([[2600, 2200], [2600, 2500]])] });
  const names = roads.slice(0, 4).map((r, i) => ({ type: 2, tags: { name: `Road ${i}` }, geom: r.geom }));
  const pois = [];
  for (let i = 0; i < 40; i++) pois.push({ type: 1, tags: { class: 'restaurant', name: 'p' + (i % 30) }, geom: [[{ x: rnd() * EXTENT, y: rnd() * EXTENT }]] });
  pois.push({ type: 1, tags: { class: 'park', name: 'Green' }, geom: [[{ x: 1210, y: 2950 }]] });
  pois.push({ type: 1, tags: { class: 'sports_centre', name: 'Arena' }, geom: [[{ x: 3300, y: 600 }]] });
  pois.push({ type: 1, tags: { class: 'hospital', name: 'Care' }, geom: [[{ x: 700, y: 3700 }]] });
  for (let i = 0; i < 6; i++) pois.push({ type: 1, tags: { class: 'parking' }, geom: [[{ x: rnd() * EXTENT, y: rnd() * EXTENT }]] });
  return [
    { name: 'landcover', features: [
      { type: 3, tags: { class: 'grass' }, geom: blob(1000, 1000, 700, 60) },
      { type: 3, tags: { class: 'wood' }, geom: blob(3000, 1000, 600, 50) },
      { type: 3, tags: { class: 'forest' }, geom: blob(3300, 1900, 300, 40) },
      { type: 3, tags: { class: 'orchard' }, geom: blob(1000, 3000, 500, 40) },
    ] },
    { name: 'landuse', features: [
      { type: 3, tags: { class: 'residential' }, geom: blob(2048, 2048, 1800, 90) },
      { type: 3, tags: { class: 'industrial' }, geom: blob(3100, 3100, 500, 40) },
      { type: 3, tags: { class: 'quarry' }, geom: blob(2400, 3600, 250, 30) },
      { type: 3, tags: { class: 'commercial' }, geom: blob(600, 2000, 300, 30) },
    ] },
    { name: 'water', features: [{ type: 3, tags: { class: 'lake' }, geom: blob(2600, 2350, 250, 30) }] },
    { name: 'transportation', features: roads },
    { name: 'transportation_name', features: names },
    { name: 'building', features: b },
    { name: 'poi', features: pois },
  ];
}

// Everything generation decides, keyed on the TILE-LOCAL cell (the frame's
// metres are allowed to differ, and are the only thing left out).
function world(lat) {
  const edge = W.tileEdgeMeters(lat);
  const N = W.cellsPerEdgeForTile(TY);
  const r = W.rasterizeTile(layers(), N, TX, TY, edge);
  const cw = edge / N;
  const cell = (o) => `${Math.floor((o.x - TX * edge) / cw)},${Math.floor((o.y - TY * edge) / cw)}`;
  const objs = r.objects.map((o) => [o.kind, o.id, cell(o), o.species, o.variant, o.tier,
    o.requiredTier, o.yieldTier, o.caveVariant, o.poiClass, o.address, o._biome, o.castle, o.flagPost].join('|')).sort();
  const wps = r.wildplants.map((p) => [p.crop, p.id, cell(p), p._biome].join('|')).sort();
  const park = r.parkingTreasures.map((t) => [t.id, cell(t)].join('|')).sort();
  const keys = r.ownerKeys.filter(Boolean).join(',');
  return { N, edge, r, objs, wps, park, keys, labels: JSON.stringify(r.roadLabels), pathUnder: JSON.stringify(r.pathUnder) };
}

let _cache = null;
const worlds = () => _cache || (_cache = LATS.map(world));

test('world frame: the fixture crosses a legacy cellsPerEdgeForLat flip', () => {
  const legacy = LATS.map((l) => W.cellsPerEdgeForLat(l));
  assert.eq(legacy[1], legacy[2], '49.82 and 49.854 share a legacy cell count');
  assert.truthy(legacy[0] !== legacy[1], `49.80 flips it (${legacy.join(' / ')}) — the case that used to re-grid the world`);
  const ws = worlds();
  for (const w of ws) assert.eq(w.N, ws[0].N, 'but every save builds the tile on its OWN grid');
  assert.truthy(ws[0].edge !== ws[2].edge, 'and the frames really do differ');
});

test('world frame: grid, road mask and path under-biomes are identical in every frame', () => {
  const [a, ...rest] = worlds();
  for (const b of rest) {
    assert.eq(b.r.grid.length, a.r.grid.length, 'grid size');
    let d = 0;
    for (let i = 0; i < a.r.grid.length; i++) if (a.r.grid[i] !== b.r.grid[i]) d++;
    assert.eq(d, 0, 'terrain cells that differ');
    let m = 0;
    for (let i = 0; i < a.r.roadMask.length; i++) if (a.r.roadMask[i] !== b.r.roadMask[i]) m++;
    assert.eq(m, 0, 'road-mask cells that differ (the mask width is in cells, not frame metres)');
    assert.eq(b.pathUnder, a.pathUnder, 'path under-biomes');
    assert.eq(b.labels, a.labels, 'road labels');
    assert.eq(b.keys, a.keys, 'building owner keys');
  }
});

test('world frame: every object — kind, id, cell, species, variant, tier — is identical in every frame', () => {
  const [a, ...rest] = worlds();
  assert.gt(a.objs.length, 200, 'the fixture actually generated a world');
  const kinds = new Set(a.r.objects.map((o) => o.kind));
  for (const k of ['tree', 'fruittree', 'mineralrock', 'house', 'chest', 'tower']) {
    assert.truthy(kinds.has(k), `the fixture exercises ${k}`);
  }
  for (const b of rest) {
    assert.eq(b.objs.length, a.objs.length, 'object count');
    assert.eq(b.objs.join('\n'), a.objs.join('\n'), 'objects');
    assert.eq(b.park.join('\n'), a.park.join('\n'), 'parking X marks');
  }
});

test('world frame: every wild plant is identical in every frame', () => {
  const [a, ...rest] = worlds();
  assert.gt(a.wps.length, 100, 'the fixture grew wild plants');
  for (const b of rest) {
    assert.eq(b.wps.length, a.wps.length, 'wild plant count');
    assert.eq(b.wps.join('\n'), a.wps.join('\n'), 'wild plants');
  }
});

test('world frame: ids are tile + local cell, never frame metres', () => {
  const [a] = worlds();
  const pre = `_${TX}_${TY}_`;
  for (const o of a.r.objects) {
    if (o.kind === 'tower') continue;   // absolute-cell castle keys, frame-free by construction
    assert.truthy(o.id.includes(pre), `${o.kind} id carries its tile: ${o.id}`);
  }
  const ids = new Set(a.r.objects.map((o) => o.id));
  assert.eq(ids.size, a.r.objects.length, 'object ids are unique on the tile');
});

test('world frame: generation never reads the player\'s home (softwood is an overlay)', () => {
  const edge = W.tileEdgeMeters(LATS[1]);
  const N = W.cellsPerEdgeForTile(TY);
  const prev = HomeArea.worldM;
  try {
    HomeArea.worldM = null;
    const bare = W.rasterizeTile(layers(), N, TX, TY, edge);
    // Home in the middle of the wood: under the old rule every tree near it
    // came out a pine for this player only.
    const tree = bare.objects.find((o) => o.kind === 'tree' && o.species !== 'pine');
    assert.truthy(tree, 'the fixture has a non-pine tree to test with');
    HomeArea.setOrigin(tree.x, tree.y);
    const homed = W.rasterizeTile(layers(), N, TX, TY, edge);
    const sp = (r) => r.objects.filter((o) => o.kind === 'tree').map((o) => `${o.id}:${o.species}`).join(',');
    assert.eq(sp(homed), sp(bare), 'a home next to the wood changes no generated species');
    // …and the overlay is where the rule lives now.
    const changed = HomeArea.applySoftwood(homed.objects);
    assert.gt(changed, 0, 'applySoftwood stamps pine on the trees near home');
    assert.eq(homed.objects.find((o) => o.id === tree.id).species, 'pine', 'the tree at home is softwood for this player');
    assert.eq(HomeArea.applySoftwood(homed.objects), 0, 'the overlay is idempotent');
  } finally {
    HomeArea.worldM = prev;
  }
});

test('world frame: cellsPerEdgeForTile is a pure function of the row', () => {
  const lat = W.latOfRowCentre(TY);
  assert.eq(W.cellsPerEdgeForTile(TY), Math.round(W.tileEdgeMeters(lat) / W.CELL_M),
    'the tile\'s own latitude, over the nominal cell');
  assert.eq(W.cellsPerEdgeForTile(TY), 225, 'pinned for the fixture row');
  // The row's centre lies between its two edges.
  const top = W.tileXYForLonLat(0, lat).y;
  assert.eq(top, TY, 'latOfRowCentre is inside the row');
  // Rows further south (larger ty, nearer the equator here) are longer, so
  // never have FEWER cells than the row above.
  for (let ty = TY - 40; ty < TY + 40; ty++) {
    assert.lte(W.cellsPerEdgeForTile(ty), W.cellsPerEdgeForTile(ty + 1), `row ${ty} vs ${ty + 1}`);
  }
  // Frame metres per cell: the frame edge over the tile's own count.
  const e = W.tileEdgeMeters(49.80);
  assert.eq(W.cellSizeM(e, TY), e / 225, 'cellSizeM = frame edge / own count');
});

test('world frame: sidecar / Overpass bins are frame-free (tile-local cells, not metres)', () => {
  // A small GeoJSON sample around the fixture tile: an OSM tree, a detected
  // tree with no id, a fruit tree, a pole, a fountain, a parking lot, a bus
  // stop, a tree row.
  const lon0 = -119.47, lat0 = 49.846;
  const F = (kind, dx, dy, props) => ({ type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon0 + dx, lat0 + dy] },
    properties: { kind, ...props } });
  const gj = { type: 'FeatureCollection', features: [
    F('tree', 0.0001, 0.0002, { osm_id: 101 }),
    F('tree', 0.0013, 0.0007, { score: 0.9, crown_m: 6 }),
    F('fruittree', 0.0021, -0.0004, { score: 0.8 }),
    F('pole', -0.0007, 0.0011, { osm_id: 202 }),
    F('fountain', 0.0031, 0.0003, {}),
    F('parking', -0.0015, -0.0009, {}),
    F('bus_stop', 0.0004, -0.0017, { osm_id: 303, tags: { name: 'Stop' } }),
    F('tree_row', -0.0022, 0.0019, { osm_id: 404 }),
  ] };
  const dump = (bins) => JSON.stringify([...bins.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  const outs = LATS.map((l) => dump(W.buildBinsFromGeoJSON(gj, l)));
  for (const o of outs) assert.eq(o, outs[0], 'the bins do not depend on the save\'s latitude');
  const bins = W.buildBinsFromGeoJSON(gj, LATS[0]);
  const bin = bins.get(`${TX}_${TY}`);
  assert.truthy(bin, 'the sample lands in the fixture tile');
  const N = W.cellsPerEdgeForTile(TY);
  for (const k of ['trees', 'fruittrees', 'poles', 'wells', 'parking', 'chests', 'shrubs']) {
    for (const r of bin[k]) {
      assert.eq(r.x, undefined, `${k} row carries no frame x`);
      assert.inRange(r.lix, 0, N - 1, `${k} row carries a local cell`);
      assert.inRange(r.liy, 0, N - 1, `${k} row carries a local cell`);
    }
  }
  assert.eq(bin.trees.find((t) => t.id === 'tree_osm_101') != null, true, 'an OSM tree is named by its osm_id');
  assert.eq(bin.chests[0].id, 'sxc_303', 'a sidecar chest is named by its osm_id');
  assert.truthy(/^well_\d+_\d+_\d+_\d+$/.test(bin.wells[0].id), 'a fountain with no id is named by tile + cell');
});

// ── Caves: derived from the GENERATED layer above, never the live entry ───────
// A cave level is the negative of the level above it, and it mirrors that
// level's chests and down-stairs. It used to read the LIVE entry — the grid
// app.js carves ponds / wells into, the objects the Overpass bin (when it
// happened to be cached) and the starter ladder (one player's) were pushed
// onto — so the cave under a tile depended on who descended and when. Now it
// reads entry.baseGrid / entry.genObjects, frozen at build.
async function caveUnder(edgeM, tamper) {
  const TXC = 900001, TYC = 900002, N = 32, cw = edgeM / N;
  const at = (ix, iy) => ({ x: TXC * edgeM + (ix + 0.5) * cw, y: TYC * edgeM + (iy + 0.5) * cw });
  const grid = new Uint8Array(N * N);                 // all grass…
  for (let i = 0; i < N; i++) grid[12 * N + i] = W.T.WATER;   // …with a river
  const stair = W.makeObject('staircase', at(5, 5).x, at(5, 5).y, W.caveStairId('down', 0, TXC, TYC, 5, 5), { dir: 'down', depth: 0 });
  const chest = W.makeObject('chest', at(20, 6).x, at(20, 6).y, `c_${TXC}_${TYC}_20_6`, { poiClass: 'restaurant', name: 'Deli' });
  const gen = [stair, chest];
  const entry = { status: 'ready', grid: grid.slice(), baseGrid: grid, cellsPerEdge: N, tileEdgeM: edgeM, depth: 0,
    objects: gen.slice(), genObjects: gen, wildplants: [] };
  if (tamper) {
    // Everything one player's session does to the live entry.
    for (let i = 0; i < N; i++) entry.grid[25 * N + i] = W.T.WATER;          // a carved pond
    entry.objects.push(W.makeObject('staircase', at(28, 28).x, at(28, 28).y, 'starter_ladder',
      { dir: 'down', depth: 0, _synthetic: true }));                        // the starter ladder
    entry.objects.push(W.makeObject('chest', at(8, 20).x, at(8, 20).y, 'sxc_77',
      { poiClass: 'restaurant', name: 'Bin Cafe' }));                       // an Overpass-bin chest
  }
  const key = W.tileKey(TXC, TYC);
  const surface = W.setDepth(0);
  surface.set(key, entry);
  const caves = W.setDepth(1);
  caves.delete(key);
  try {
    const cave = await W.loadTile(TXC, TYC, 49.85);
    const cell = (o) => `${Math.floor((o.x - TXC * edgeM) / cw)},${Math.floor((o.y - TYC * edgeM) / cw)}`;
    return {
      grid: Array.from(cave.grid).join(''),
      objs: cave.objects.map((o) => `${o.kind}|${o.id}|${cell(o)}|${o.dir || ''}|${o.yieldTier || ''}|${o.caveVariant ?? ''}`).sort().join('\n'),
      wps: cave.wildplants.map((p) => `${p.crop}|${p.id}|${cell(p)}`).sort().join('\n'),
    };
  } finally {
    caves.delete(key);
    W.setDepth(0).delete(key);
  }
}

test('world frame: a cave is the same in every frame, and ignores the live entry above', async () => {
  const base = await caveUnder(32 * 7, false);
  const framed = await caveUnder(32 * 7.31, false);
  assert.eq(framed.grid, base.grid, 'cave grid in another frame');
  assert.eq(framed.objs, base.objs, 'cave objects in another frame');
  assert.eq(framed.wps, base.wps, 'cave wild plants in another frame');
  const lived = await caveUnder(32 * 7, true);
  assert.eq(lived.grid, base.grid, 'a carved surface cell does not reach the cave');
  assert.eq(lived.objs, base.objs, 'a synthetic ladder or a bin chest above changes no cave object');
  assert.eq(lived.wps, base.wps, 'nor any cave wild plant');
  assert.truthy(/staircase\|stair_up_1_900001_900002_5_5\|5,5/.test(base.objs), 'the generated stair is mirrored, on its cell');
  assert.truthy(/chest\|c_900001_900002_20_6_d1\|/.test(base.objs), 'the generated chest is mirrored');
});
})();
