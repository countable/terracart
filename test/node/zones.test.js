// INFLUENCE ZONES (src/zones.js) — the Sacred Grove, the Old Stones, the Tar
// Yard.
//
// What is pinned:
//   · DETECTION: which POIs anchor which kind (charging stations, bbq pits
//     never; a church is the stones; a real cemetery, a memorial and every
//     other faith's place — or one whose faith is not given — anchor
//     nothing: WorldGen.isSensitivePoi answers first).
//   · THE FIELD: R = clamp(R_kind / (1 + q), R_MIN, R_kind), the merge
//     survivor rule, the window, and — on the real Kelowna 3×3 fixtures —
//     every anchor gets the same key, q, R and aspect from every tile that
//     sees it (the seam rule), with the poi buffer the design relies on.
//   · THE HALO: a zone repaints ONLY lot / commercial ground (RESIDENTIAL,
//     COMMERCIAL, WASTELAND); the full coverage then styles walkable ground
//     and replaces procedural scatter while preserving places and cave IDs.
//   · THE NEXUS: every piece is off the road band and off anything already
//     there, one per cell, position-derived; the nexus chest keeps its id and
//     wears one tier more.
//   · HEADSTONES: the hoard share by id, the one-off pay, the ghost roll.
//     (The churchyard's dusk / cadence reason is gone — ghosts.test.js.)
//   · TAR slows (the burned row's lane) and holds NO garrison (an oil-stained
//     lot, no fire enemies), the shrine's gift is daily, the story keys and
//     tips.
(function () {
const Z = Zones;
const T = WorldGen.T;
const EXT = 4096;
const TILE_TX = 2754, TILE_TY = 5566;   // the fixture with all three kinds owned

const decode = (key) => MVT.decodeTile(FIXTURE_TILES[key]);
const poiOf = (layers) => layers.find((l) => l.name === 'poi');
const fixtureKeys = () => Object.keys(FIXTURE_TILES).sort();
const edgeFor = (ty) => WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(ty));

// One fixture tile rasterized with and without the zones (Zones hidden from
// worldgen's `typeof Zones` guard), memoised — two real builds, shared.
let _pair = null;
function rasterPair() {
  if (_pair) return _pair;
  const layers = decode(`${TILE_TX}_${TILE_TY}`);
  const N = WorldGen.cellsPerEdgeForTile(TILE_TY), edge = edgeFor(TILE_TY);
  const saved = globalThis.Zones, paintRoad = StreetVariants.paintTerrainSteps;
  let off, on;
  try {
    // Isolate zone paint over source land. Otherwise the zone-off build
    // acquires road verges exactly where the zone-on build takes precedence.
    // Street terrain tests exercise that composition separately.
    StreetVariants.paintTerrainSteps = function* ({ N }) { return new Uint8Array(N*N); };
    globalThis.Zones = undefined;
    off = WorldGen.rasterizeTile(decode(`${TILE_TX}_${TILE_TY}`), N, TILE_TX, TILE_TY, edge);
    globalThis.Zones = saved;
    on = WorldGen.rasterizeTile(layers, N, TILE_TX, TILE_TY, edge);
  } finally {
    globalThis.Zones = saved;
    StreetVariants.paintTerrainSteps = paintRoad;
  }
  return (_pair = { on, off, N, edge });
}

// ── Detection ───────────────────────────────────────────────────────────────
test('zones: which POIs anchor which kind', () => {
  const a = (c, s) => Z.anchorOf({ class: c, subclass: s });
  assert.eq(a('park', 'park').kind, 'grove', 'a named park is a grove');
  assert.eq(a('park', 'bbq'), null, 'a grill is not a park');
  assert.eq(a('fuel', 'fuel').kind, 'tar', 'a fuel station is a tar yard');
  assert.eq(a('fuel', 'charging_station'), null, 'charging stations are excluded');
  assert.eq(a('place_of_worship', 'christian').kind, 'stones', 'a church: the invented churchyard');
  // Every other faith, and a place whose faith the tile does not name, is no
  // anchor at all — no stones, no rocks (fails closed: unknown is not ours).
  for (const faith of ['muslim', 'jewish', 'buddhist', 'hindu', 'sikh', undefined, '', 'place_of_worship']) {
    assert.eq(a('place_of_worship', faith), null, `${faith || 'no faith given'}: no anchor`);
  }
  // No faith given, but the NAME names a church: a church (worshipFaith). A
  // faith that IS given wins over the name.
  assert.eq(Z.anchorOf({ class: 'place_of_worship', name: 'Kelowna Gospel Fellowship' }).kind, 'stones');
  assert.eq(Z.anchorOf({ class: 'place_of_worship', name: 'St. Paul Kirche' }).kind, 'stones');
  assert.eq(Z.anchorOf({ class: 'place_of_worship', name: 'Beth Tikvah' }), null, 'a name that names no church: unknown, quiet');
  assert.eq(Z.anchorOf({ class: 'place_of_worship', subclass: 'scientologist', name: 'Church of Scientology' }), null);
  // A real cemetery is quiet green space: no stones zone, so no headstones,
  // no hoards and no ghosts.
  assert.eq(a('cemetery', 'cemetery'), null, 'a real cemetery anchors nothing');
  assert.eq(a('cemetery', 'grave_yard'), null);
  assert.eq(a('memorial', 'memorial'), null);
  // The sensitive-place table answers first, even for a kind that would anchor.
  assert.eq(Z.anchorOf({ class: 'park', subclass: 'park', name: 'Gedenkstätte am Park' }), null,
    'a memorial ground by name is no grove');
  assert.eq(a('school', 'school'), null);
});

// ── The formula ─────────────────────────────────────────────────────────────
test('zones: R is the kind\'s cap shrunk by crowding, clamped to R_MIN', () => {
  assert.eq(Z.ZONE_KINDS.grove.R, 60); assert.eq(Z.ZONE_KINDS.stones.R, 80); assert.eq(Z.ZONE_KINDS.tar.R, 50);
  assert.eq(Z.R_MIN_M, 30); assert.eq(Z.MERGE_M, 40); assert.eq(Z.W_MAX_M, 200);
  assert.eq(Z.radiusFor('grove', 0), 60, 'alone: the cap');
  assert.eq(Z.radiusFor('tar', 0), 50, 'isolated fuel station has a 50 m halo');
  assert.eq(Z.radiusFor('tar', 1), 30, 'crowded fuel station respects the shared floor');
  assert.eq(Z.radiusFor('grove', 5), 30, 'crowded: the floor');
  // The window fits the buffer at play latitudes (Berlin's row is the tightest).
  for (const ty of [5370, 5566, 5700]) assert.eq(Z.windowM(ty), 200, `row ${ty}: W = 200`);
});

test('zones: the merge drops the later key within MERGE_M, and q is symmetric', () => {
  const upm = Z.upmRow(TILE_TY);
  const u = (m) => Math.round(m / upm);
  const gx0 = TILE_TX * EXT + 1000, gy0 = TILE_TY * EXT + 1000;
  const list = [
    { kind: 'tar', gx: gx0, gy: gy0, owned: true },
    { kind: 'tar', gx: gx0 + u(20), gy: gy0, owned: true },    // 20 m: merged
    { kind: 'tar', gx: gx0, gy: gy0 + u(100), owned: true },   // 100 m: a neighbour
  ];
  const out = Z.resolveAnchors(list.map((a) => ({ ...a })));
  assert.eq(out.length, 2, 'the double-mapped station merges');
  assert.truthy(out.every((a) => !(a.gx === gx0 + u(20) && a.gy === gy0)), 'the LATER key goes');
  near(out[0].q, out[1].q, 1e-9, 'each is the other\'s crowding');
  near(out[0].q, 1 - 100 / 200, 0.01, 'q = 1 − d/W');
  near(out[0].R, 50 / (1 + out[0].q), 1e-9, 'R = R_kind / (1 + q)');
});
function near(a, b, eps, m) { assert.truthy(Math.abs(a - b) <= eps, `${m}: ${a} vs ${b}`); }

// ── Seam determinism, on the real fixtures ──────────────────────────────────
test('zones: the poi buffer the field relies on is there (−1024 … 5120)', () => {
  let lo = Infinity, hi = -Infinity;
  for (const k of fixtureKeys()) {
    for (const f of poiOf(decode(k)).features) {
      for (const ring of f.geom) for (const p of ring) { lo = Math.min(lo, p.x, p.y); hi = Math.max(hi, p.x, p.y); }
    }
  }
  assert.lte(lo, -Z.POI_BUFFER_UNITS + 64, `the buffer reaches out (min ${lo})`);
  assert.gte(hi, EXT + Z.POI_BUFFER_UNITS - 64, `on both sides (max ${hi})`);
});

test('zones: every anchor gets the same key, q, R and aspect from every tile that sees it', () => {
  const seen = new Map();
  let shared = 0;
  for (const k of fixtureKeys()) {
    const [tx, ty] = k.split('_').map(Number);
    const all = Z.resolveAnchors(Z.collectAnchors(poiOf(decode(k)), tx, ty));
    for (const a of all) {
      // Only anchors whose disc can reach this tile matter to it.
      const lx = a.gx - tx * EXT, ly = a.gy - ty * EXT;
      const pad = a.R * (1 + Z.EDGE_JITTER) / a.upm;
      if (lx < -pad || ly < -pad || lx > EXT + pad || ly > EXT + pad) continue;
      const id = `${a.kind}|${a.gx}|${a.gy}`;
      const sig = `${a.key}|${a.q.toFixed(9)}|${a.R.toFixed(9)}|${a.aspect}`;
      if (seen.has(id)) { shared++; assert.eq(sig, seen.get(id), `${id} seen alike from ${k}`); }
      else seen.set(id, sig);
    }
  }
  assert.gt(shared, 5, `anchors near a seam were checked from both sides (${shared})`);
});

test('zones: the ragged edge is a function of the global point, continuous across a seam', () => {
  // Two tiles see the same global point: one number. And it is ragged — not
  // a circle — but bounded by EDGE_JITTER.
  const a = { R: 80 };
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 2000; i++) {
    const gx = 2754 * EXT + i * 37.3, gy = 5566 * EXT + i * 11.1;
    const e = Z.edgeAt(a, gx, gy);
    lo = Math.min(lo, e); hi = Math.max(hi, e);
    assert.eq(Z.edgeAt(a, gx, gy), e, 'pure');
  }
  assert.gte(lo, 80 * (1 - Z.EDGE_JITTER)); assert.lte(hi, 80 * (1 + Z.EDGE_JITTER));
  assert.gt(hi - lo, 80 * Z.EDGE_JITTER * 0.8, 'the edge actually wanders');
  // Across the seam at x = 2755·4096 the noise is continuous.
  const gx = 2755 * EXT, gy = 5566 * EXT + 777;
  near(Z.edgeNoise(gx - 0.01, gy), Z.edgeNoise(gx + 0.01, gy), 1e-3, 'no step at the seam');
});

// ── The halo ────────────────────────────────────────────────────────────────
test('zones: zone styling owns coverage while roads, paths, water and buildings retain their ground', () => {
  const { on, off, N } = rasterPair();
  assert.truthy(on.zone && on.zone.anchors.length > 0, 'the fixture has a field');
  const over = new Set([T.RESIDENTIAL, T.COMMERCIAL, T.WASTELAND]);
  const zoneCodes = new Set([T.GROVE, T.CHURCHYARD, T.TAR_YARD]);
  let changed = 0;
  const byKind = {};
  for (let i = 0; i < N * N; i++) {
    if (on.grid[i] === off.grid[i]) {
      assert.falsy(zoneCodes.has(on.grid[i]), 'a zone code only where the halo painted');
      continue;
    }
    if (WorldGen.isBuildingTerrain(off.grid[i])) {
      assert.truthy(WorldGen.isBuildingTerrain(on.grid[i]), 'nexus conversion preserves the building footprint');
      const shape = on.buildingShapes.find(s => s.key === on.ownerKeys[on.owners[i]]);
      if (shape?.kind === 'temple') assert.eq(on.grid[i], T.BUILDING_LARGE, 'temples use their own stone footprint');
      continue;
    }
    changed++;
    assert.truthy(WorldGen.isWalkable(off.grid[i]) && !WorldGen.isRoadTerrain(off.grid[i]) &&
      !WorldGen.isBuildingTerrain(off.grid[i]) && ![T.PATH, T.PIER].includes(off.grid[i]),
      `cell ${i}: transport and structures retain their visible ground`);
    assert.falsy(on.roadMask[i], `cell ${i}: a visible road band stays untouched`);
    assert.eq(on.zone.under[i], off.grid[i], `cell ${i}: the land it painted over is recorded`);
    if (!(on.zone.coverage[i] > 0)) {
      // …or the PARK FRINGE (zone_ground.test.js pins its reach).
      assert.includes([T.GROVE, T.CHURCHYARD], on.grid[i], `cell ${i}: the fringe paints a park's halo`);
      byKind.fringe = (byKind.fringe || 0) + 1;
      continue;
    }
    const winner = on.zone.anchors[on.zone.coverage[i] - 1], kind = winner.kind;
    if (on.grid[i] === T.CAVE_LAVA) {
      assert.eq(ZoneVariants.pick(winner).id, 'quarry-crater', 'only crater layouts paint surface lava');
      assert.truthy(on.zoneDress.objects.some(o => o.kind === 'lava_vent' && o._iy * N + o._ix === i), 'lava has an authored hazard marker');
    } else assert.eq(on.grid[i], Z.terrainOf(kind), `cell ${i}: the winner's own terrain`);
    byKind[kind] = (byKind[kind] || 0) + 1;
  }
  assert.gt(changed, 50, `the halo painted (${changed} cells)`);
  assert.truthy(byKind.grove && byKind.stones && byKind.tar, `all three kinds painted: ${JSON.stringify(byKind)}`);
  for (const k of Object.keys(off.pathUnder)) {
    if (off.pathUnder[k] !== on.pathUnder[k]) {
      assert.truthy(WorldGen.isWalkable(off.pathUnder[k]) && zoneCodes.has(on.pathUnder[k]), `path ${k}: style the walkable land below visible cobbles`);
    }
  }
});

test('zones: covered ambience is replaced and only blocked nexus POIs may move', () => {
  const { on, off, N, edge } = rasterPair();
  const keep = o => {
    const x = Math.floor((o.x - TILE_TX * edge) / (edge / N));
    const y = Math.floor((o.y - TILE_TY * edge) / (edge / N));
    return !(/^(wp|hr|hm|ptree|tree|ft|mr|rb)_-?\d+_/.test(o.id) && on.zone.coverage[y * N + x]);
  };
  // An unsafe POI seat may move into its zone; all identities stay fixed,
  // and every unrelated object must still keep its exact position.
  const originals = new Map(off.objects.map(o => [o.id, o])), relocated = new Map();
  const cell = o => [Math.floor((o.x - TILE_TX * edge) / (edge / N)),
    Math.floor((o.y - TILE_TY * edge) / (edge / N))];
  for (const o of on.objects) {
    const original = originals.get(o.id);
    if (!o.zoneVariant || !original || (o.x === original.x && o.y === original.y)) continue;
    assert.eq(original.kind, 'chest', 'only nexus POIs change seats');
    assert.falsy(WorldGen.isSpawnCell(on.grid, N, N, ...cell(original),
      { roadMask: on.roadMask, spawnWhy: on.spawnWhy }, 'attractor'), 'old seat was blocked');
    assert.truthy(WorldGen.isSpawnCell(on.grid, N, N, ...cell(o),
      { roadMask: on.roadMask, spawnWhy: on.spawnWhy }, 'attractor'), 'new seat is eligible');
    relocated.set(o.id, original);
  }
  const sig = (arr) => arr.map((o) => `${o.kind === 'grove_shrine' ? 'chest' : o.kind}|${o.id}|${o.x.toFixed(3)}|${o.y.toFixed(3)}|${o.crop || ''}`).join('\n');
  const authoredStairs = new Set(on.zoneDress.objects.filter(o => o.kind === 'staircase' && o.zoneLayer === 'entrance'));
  for (const o of authoredStairs) assert.eq(on.objects.filter(p => p === o).length, 1, 'each authored shaft joins the generated layer exactly once');
  const templeSeats = new Set(on.objects.filter(o => o.kind === 'temple').map(o => `${o.x}|${o.y}`));
  const ordinary = o => !['house', 'tower', 'temple'].includes(o.kind) && !templeSeats.has(`${o.x}|${o.y}`);
  assert.eq(sig(on.objects.filter(o => !authoredStairs.has(o) && ordinary(o))
    .map(o => relocated.has(o.id) ? { ...o, x: relocated.get(o.id).x, y: relocated.get(o.id).y } : o)),
    sig(off.objects.filter(o => keep(o) && ordinary(o))), 'preserved non-building objects keep ids and positions');
  assert.eq(sig(on.wildplants), sig(off.wildplants.filter(keep)), 'preserved wild plants keep ids and positions');
  assert.gt(off.wildplants.length - on.wildplants.length, 0, 'covered legacy flora is actually replaced');
  assert.eq(JSON.stringify(on.streetDress && on.streetDress.objects.map((o) => o.id)),
    JSON.stringify(off.streetDress && off.streetDress.objects.filter(o => {
      const x = Math.floor((o.x - TILE_TX * edge) / (edge / N));
      const y = Math.floor((o.y - TILE_TY * edge) / (edge / N));
      return !on.zone.coverage[y * N + x];
    }).map((o) => o.id)), 'street dressing survives only outside zone coverage');
});

test('zones: the trap ground is the LAND\'s — a repainted waste lot stays trap ground', () => {
  const { on, off, N } = rasterPair();
  assert.truthy(on.zone.under, 'the halo records what it painted over');
  let ground = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const a = Traps.isTrapGround(off.grid, off.roadClass, N, N, x, y);
    assert.eq(Traps.isTrapGround(on.grid, on.roadClass, N, N, x, y, on.zone.under), a, `cell ${x},${y}`);
    if (a) ground++;
  }
  assert.gt(ground, 0, 'the fixture has trap ground');
  assert.truthy(/Difficulty\.get\(\)\.trapCountMul, entry\.zone && entry\.zone\.under\)/.test(SPAWN_IN_TILE_SRC),
    'spawnInTile hands the traps the land\'s class');
});

test('zones: mine mouths retain their original source when zone layouts replace mineral clusters', () => {
  const { on, off, N, edge } = rasterPair();
  const stairs = (r) => {
    const entry = { grid: r.grid, cellsPerEdge: N, objects: r.objects.slice(), wildplants: r.wildplants.slice(),
      zone: r.zone, caveSource: r.caveSource, roadMask: r.roadMask, poiPadCells: r.poiPadCells,
      spawnWhy: r.spawnWhy, quietMask: r.quietMask, roadClass: r.roadClass };
    WorldGen.maybePlaceCaveEntrance(entry, TILE_TX, TILE_TY, edge, r.objects, r.wildplants);
    return entry.objects.filter((o) => o.kind === 'staircase' && o.zoneLayer !== 'entrance').map((o) => o.id).sort().join(',');
  };
  assert.eq(stairs(on), stairs(off), 'the same staircase with and without the zones');
});

test('zones: road terrain leaves real-tile cave source identities unchanged', () => {
  const N=WorldGen.cellsPerEdgeForTile(TILE_TY), edge=edgeFor(TILE_TY);
  const actual=StreetVariants.paintTerrainSteps;
  const on=WorldGen.rasterizeTile(decode(`${TILE_TX}_${TILE_TY}`),N,TILE_TX,TILE_TY,edge);
  let off;
  try {
    StreetVariants.paintTerrainSteps=function* ({N}) {return new Uint8Array(N*N);};
    off=WorldGen.rasterizeTile(decode(`${TILE_TX}_${TILE_TY}`),N,TILE_TX,TILE_TY,edge);
  } finally {StreetVariants.paintTerrainSteps=actual;}
  assert.truthy(on.zone?.caveSource,'real fixture has special-zone cave source');
  assert.eq(JSON.stringify(on.zone.caveSource),JSON.stringify(off.zone.caveSource));
  if(off.caveSource) assert.eq(JSON.stringify(on.caveSource),JSON.stringify(off.caveSource));
  assert.eq(JSON.stringify(on.streetIndex),JSON.stringify(off.streetIndex),'paint cannot feed back into affinity');
});

// ── The nexus ───────────────────────────────────────────────────────────────
test('zones: every nexus piece is off the road band and off anything already there', () => {
  const { on, N, edge } = rasterPair();
  const d = on.zoneDress;
  assert.truthy(d && d.nexus.length > 0, 'the fixture laid a nexus');
  const cellOf = (o) => {
    const ix = Math.floor((o.x - TILE_TX * edge) / (edge / N)), iy = Math.floor((o.y - TILE_TY * edge) / (edge / N));
    return iy * N + ix;
  };
  const before = new Set();
  const authoredStairs = new Set(d.objects.filter(o => o.kind === 'staircase' && o.zoneLayer === 'entrance'));
  // These same records were promoted into the surface snapshot so caves can
  // mirror return ladders. Exclude only the identical record, never another
  // object sharing its cell; the checks below still catch real overlaps.
  for (const o of authoredStairs) assert.eq(on.objects.filter(p => p === o).length, 1, 'one generated shaft record');
  for (const o of [...on.objects, ...on.wildplants]) if (!authoredStairs.has(o)) before.add(cellOf(o));
  if (on.streetDress) for (const o of [...on.streetDress.objects, ...on.streetDress.wildplants, ...on.streetDress.treasures]) before.add(cellOf(o));
  const mine = new Set();
  const pieces = [...d.objects, ...d.wildplants];
  assert.gt(pieces.length, 5, `pieces were laid (${pieces.length})`);
  for (const p of pieces) {
    const i = cellOf(p);
    assert.falsy(on.roadMask[i], `${p.id} is not under a road band`);
    assert.falsy(before.has(i), `${p.id} is not on anything already there`);
    assert.falsy(mine.has(i), `${p.id} is one per cell`);
    assert.truthy(WorldGen.isWalkable(on.grid[i]), `${p.id} stands on walkable ground`);
    if (p.zone === 'quarry' && p.zoneLayer === 'find') {
      assert.truthy(on.zone.anchors.some(a => a.kind === 'quarry' &&
        p.id.startsWith(`zq_${ZoneVariants.pick(a).id}_${a.gx}_${a.gy}_find_`) && /_find_\d+$/.test(p.id)), `${p.id} uses its source anchor's identity`);
    } else if (p.zone === 'quarry' && p.zoneLayer === 'shrine') {
      assert.truthy(on.zone.anchors.some(a => a.owned && !a.clipped &&
        p.zoneVariant === ZoneVariants.pick(a).id && p.id === `zsh_${ZoneVariants.identity(a)}`),
        `${p.id} uses its complete source anchor's identity`);
    } else assert.truthy(p.zoneLayer === 'find' ? /^zf_(grove|stones|tar)_\d+_\d+_/.test(p.id) : /_\d+_\d+_\d+_\d+$/.test(p.id), `${p.id} has a stable anchor or tile-cell identity`);
    mine.add(i);
  }
  // Rasterized again: the same pieces, the same ids.
  const again = WorldGen.rasterizeTile(decode(`${TILE_TX}_${TILE_TY}`), N, TILE_TX, TILE_TY, edge);
  assert.eq(again.zoneDress.objects.map((o) => o.id).join(), d.objects.map((o) => o.id).join(), 'deterministic');
  // Ordinary nexus pieces remain tappable, traversable or hazardous;
  // zone_prop records are the explicit decorative exception.
  for (const o of d.objects) {
    if (o.kind === 'staircase') {
      assert.eq(o.zoneVariant, 'quarry-abandoned');
      assert.eq(o.zoneLayer, 'entrance');
      assert.eq(o.dir, 'down'); assert.eq(o.depth, 0); assert.falsy(o._synthetic);
      assert.eq(o.id, WorldGen.caveStairId('down', 0, TILE_TX, TILE_TY, o._ix, o._iy));
      assert.truthy(WorldGen.isSpawnCell(on.grid, N, N, o._ix, o._iy,
        { spawnWhy: on.spawnWhy, roadMask: on.roadMask }, 'cave'), 'shafts retain the cave spawn gate');
    } else if (o.kind === 'lava_vent') {
      assert.eq(o.zoneVariant, 'quarry-crater');
      assert.eq(on.grid[cellOf(o)], T.CAVE_LAVA, 'vent marks damaging terrain');
      assert.eq(Lighting.sourceKind({}, o), 'lava_vent', 'vent lights its hazard');
    } else if (o.kind === 'stronghold_wall') {
      assert.eq(o.zone, 'quarry');
      assert.eq(o.zoneVariant, 'quarry-stronghold');
      assert.eq(o.zoneLayer, 'background');
      assert.truthy(Number.isInteger(o.variant));
      assert.inRange(o.variant, 0, 14, 'wall uses an authored cardinal connection frame');
      assert.eq(INTERACTABLES[o.kind], INTERACTABLES.mineralrock, 'ruin walls use the existing stone extraction action');
      assert.truthy(WorldGen.isSpawnCell(on.grid, N, N, o._ix, o._iy,
        { spawnWhy: on.spawnWhy, roadMask: on.roadMask }, 'minor'), 'walls retain the normal scenery spawn gate');
      const owner = on.zone.coverage[cellOf(o)];
      const neighbors = new Set(d.objects.filter(p => ['stronghold_wall', 'mineralrock'].includes(p.kind)
        && p.zoneVariant === o.zoneVariant && p.zoneLayer === 'background'
        && on.zone.coverage[cellOf(p)] === owner).map(cellOf));
      assert.eq(o.variant, QuarryLayout.wallFrameAt(neighbors, cellOf(o), N), 'frame follows actual surviving wall neighbors');
    } else if (o.kind === 'zone_prop') {
      assert.eq(o.zoneLayer, 'decoration');
      assert.includes([6, 7, 39, 54, 61], o._zoneObjectFrame);
      assert.falsy(INTERACTABLES[o.kind], 'scenery adds no reward or tap action');
      assert.truthy(WorldGen.isSpawnCell(on.grid, N, N, o._ix, o._iy,
        { spawnWhy: on.spawnWhy, roadMask: on.roadMask }, 'minor'));
    } else assert.truthy(INTERACTABLES[o.kind] || StreetVariants.isSlowKind(o.kind), `${o.kind} does something`);
  }
  // Nexus flora (roses, flint, a symmetric figure's beds and shrubs) and the
  // park fringe's filler (the character's long grass or shrubs).
  const crops = Object.values(ZoneVariants.materials).filter(m => m.kind === 'wildplant').map(m => m.crop);
  for (const w of d.wildplants) assert.includes(crops, w.crop);
});

test('zones: the nexus chest keeps its id and wears one tier more, capped', () => {
  const { on, off } = rasterPair();
  const nex = on.objects.filter((o) => o.kind === 'chest' && o.zoneNexus);
  assert.gt(nex.length, 0, 'a nexus chest');
  const offIds = new Set(off.objects.filter((o) => o.kind === 'chest').map((o) => o.id));
  for (const c of nex) {
    assert.truthy(offIds.has(c.id), `${c.id}: the same id as without the zone`);
    const base = chestTier({ ...c, zoneNexus: null });
    assert.eq(chestTier(c), Math.min(CHEST_TIER_MAX, base + ZONE_NEXUS_TIER_BONUS),
      `${c.poiClass}: +${ZONE_NEXUS_TIER_BONUS}`);
  }
  assert.eq(ZONE_NEXUS_TIER_BONUS, 1);
  assert.eq(chestTier({ kind: 'chest', poiClass: 'florist', poiDensity: 1, depth: 4, zoneNexus: 'grove' }), CHEST_TIER_MAX, 'never past the ladder');
  // The tier the chest shows is the tier it pays: one function, both sides.
  assert.eq(chestTier({ kind: 'chest', poiClass: 'park', poiDensity: 10, zoneNexus: 'grove' }),
    chestTier({ kind: 'chest', poiClass: 'park', poiDensity: 10 }) + 1, 'the roll pays it too');
});

test('zones: the patterns — groves by character, graves are a per-cell rule, no other stones pattern', () => {
  assert.gte(Z.ASPECTS.grove.length, 3);
  assert.inRange(Z.ASPECTS.tar.length, 2, 3);
  // A church lays no fixed pattern: its headstones are the per-cell GRAVE
  // rule over the churchyard halo (zone_ground.test.js). The other faiths'
  // rock squares / rings went with their anchors.
  assert.eq(Z.ASPECTS.stones.join(), 'graves');
  assert.eq(Z.patternPieces('graves').length, 0, 'no fixed stones pattern');
  assert.eq(Z.ASPECTS.stones_quiet, undefined, 'no quiet-faith pattern left');
  assert.eq(Object.keys(Z.ASPECTS).sort().join(), 'beach,grove,quarry,stones,tar');
  // Every grove character's aspects are grove aspects.
  for (const [ch, list] of Object.entries(Z.GROVE_ASPECTS)) {
    assert.truthy(BiomeProfiles.PARK_CHARACTERS[ch], `${ch} is a park character`);
    for (const [asp, wt] of list) { assert.includes(Z.ASPECTS.grove, asp); assert.gt(wt, 0); }
  }
  for (const asp of [...Z.ASPECTS.grove, ...Z.ASPECTS.tar]) {
    const P = Z.patternPieces(asp);
    assert.gt(P.length, 3, `${asp} lays a pattern`);
    assert.falsy(P.some((p) => p.dx === 0 && p.dy === 0), `${asp} leaves the chest's cell alone`);
  }
});

// ── The nexus across a seam ─────────────────────────────────────────────────
// Two adjacent synthetic tiles (all park, no road, nothing there) see one
// anchor near their seam in their poi buffers. The pattern is the ANCHOR's:
// the union of both tiles' pieces is the pattern laid uncut, each piece once,
// by the tile whose square holds its cell, with that tile + cell's id and the
// variant the anchor's one stream gives it — whichever tile computed it.
const SEAM_TAGS = {
  grove: { class: 'park', subclass: 'park' },
  stones: { class: 'place_of_worship', subclass: 'christian' },
  tar: { class: 'fuel', subclass: 'fuel' },
};
function seamDress(tag, gx, gy, tx, ty, withChest) {
  const N = WorldGen.cellsPerEdgeForTile(ty), edge = edgeFor(ty);
  const lx = gx - tx * EXT, ly = gy - ty * EXT;
  const poi = { name: 'poi', features: [{ type: 1, geom: [[{ x: lx, y: ly }]], tags: SEAM_TAGS[tag] }] };
  const fld = Z.field(poi, tx, ty, N);
  const chests = [];
  if (withChest) {
    chests.push({ kind: 'chest', id: `chest_${tx}_${ty}_x`, _poiAt: `${lx},${ly}`,
      x: tx * edge + (lx / EXT) * edge, y: ty * edge + (ly / EXT) * edge });
  }
  const grid = new Uint8Array(N * N).fill(T.PARK);
  const res = fld ? Z.dress({ field: fld, tx, ty, N, tileEdgeM: edge, grid, chests,
    spawnOpts: { roadMask: new Uint8Array(N * N), occupied: new Set() } }) : null;
  return { tx, ty, N, edge, fld, res, chests };
}
const PREFIX = { rose: 'wz', flint: 'wz', tree: 'ztree', headstone: 'hs', tar: 'tar' };
const KIND_OF = { rose: 'wildrose', flint: 'flint', tree: 'tree', headstone: 'headstone', tar: 'tar' };
function checkSeam(tag, A, Bt, gx, gy, label) {
  const a = seamDress(tag, gx, gy, A[0], A[1], true);
  const b = seamDress(tag, gx, gy, Bt[0], Bt[1], false);
  const ra = a.fld && (a.fld.reach || []).find((x) => x.gx === gx && x.gy === gy);
  const rb = b.fld && (b.fld.reach || []).find((x) => x.gx === gx && x.gy === gy);
  assert.truthy(ra && rb, `${label}: both tiles reach the anchor`);
  const planA = Z.nexusPlan(ra), planB = Z.nexusPlan(rb);
  assert.eq(JSON.stringify(planB), JSON.stringify(planA), `${label}: both tiles replay the same draws`);
  // The uncut pattern: each anchor-grid cell centre as a global point → its tile.
  const tyA = Math.floor(gy / EXT), txA = Math.floor(gx / EXT);
  const Na = WorldGen.cellsPerEdgeForTile(tyA);
  const ax0 = Math.floor((gx - txA * EXT) * Na / EXT), ay0 = Math.floor((gy - tyA * EXT) * Na / EXT);
  const expect = new Map();
  const tiles = [a, b];
  for (const pc of planA.pieces) {
    const px = txA * EXT + (ax0 + pc.dx + 0.5) * EXT / Na, py = tyA * EXT + (ay0 + pc.dy + 0.5) * EXT / Na;
    const t = tiles.find((t) => Math.floor(px / EXT) === t.tx && Math.floor(py / EXT) === t.ty);
    assert.truthy(t, `${label}: the fixture keeps the pattern on the two tiles`);
    const ix = Math.floor((px - t.tx * EXT) * t.N / EXT), iy = Math.floor((py - t.ty * EXT) * t.N / EXT);
    const id = WorldGen.cellId(PREFIX[pc.what], t.tx, t.ty, ix, iy);
    assert.falsy(expect.has(id), `${label}: pattern cells are distinct`);
    expect.set(id, { pc, t, ix, iy });
  }
  const got = new Map();
  let inA = 0, inB = 0;
  for (const t of tiles) {
    for (const p of [...t.res.objects, ...t.res.wildplants]) {
      if (p.kind === 'grove_shrine') { assert.eq(t, a, `${label}: the shrine is the owner's`); continue; }
      assert.falsy(got.has(p.id), `${label}: ${p.id} laid once`);
      got.set(p.id, p);
      const ix = Math.floor((p.x - t.tx * t.edge) / (t.edge / t.N)), iy = Math.floor((p.y - t.ty * t.edge) / (t.edge / t.N));
      assert.truthy(p.id.endsWith(`_${t.tx}_${t.ty}_${ix}_${iy}`), `${label}: ${p.id} is its laying tile + cell`);
      if (t === a) inA++; else inB++;
    }
  }
  assert.gt(inA, 0, `${label}: the owner laid its side`);
  assert.gt(inB, 0, `${label}: the neighbour laid its side`);
  assert.eq([...got.keys()].sort().join(), [...expect.keys()].sort().join(), `${label}: the union is the uncut pattern`);
  for (const [id, e] of expect) {
    const p = got.get(id);
    assert.eq(p.kind === 'wildplant' || p.crop ? p.crop : p.kind, KIND_OF[e.pc.what], `${id}: the pattern's kind`);
    if (e.pc.what === 'tree') {
      assert.eq(p.variant, 1 + Math.floor(e.pc.v * 4), `${id}: its variant`);
      assert.eq(p.species, planA.species, `${id}: the anchor's species`);
    }
  }
  // The chest is the owner's: stamped there. No zone holds a garrison — the
  // tar yard is an oil-stained lot, not a garrison.
  assert.eq(a.chests[0].zoneNexus, ra.kind, `${label}: the owner stamps its chest`);
  assert.eq(a.res.lairs.length + b.res.lairs.length, 0, `${label}: no garrison on either side`);
  if (ra.kind === 'grove') {
    assert.eq(a.res.objects.filter((o) => o.kind === 'grove_shrine').length, 1, `${label}: one shrine`);
  }
  return ra.aspect;
}
// An anchor point near the seam whose aspect is one of `want` (the aspect is a
// hash of the point, so step along the seam until one fits).
function seamPoint(tag, want, base, step) {
  for (let k = 0; k < 400; k++) {
    const gx = base[0] + step[0] * k, gy = base[1] + step[1] * k;
    const r = Z.resolveAnchors(Z.collectAnchors({ features: [{ type: 1, geom: [[{ x: gx - TILE_TX * EXT, y: gy - TILE_TY * EXT }]], tags: SEAM_TAGS[tag] }] }, TILE_TX, TILE_TY));
    if (r.length && want.includes(r[0].aspect)) return [gx, gy];
  }
  throw new Error(`no ${want} point near the seam`);
}

test('zones: a nexus straddling an east/west seam is laid whole, once, by the tile each piece lands in', () => {
  const N = WorldGen.cellsPerEdgeForTile(TILE_TY);
  const seamX = (TILE_TX + 1) * EXT;
  const cellU = EXT / N;
  const cases = [
    ['grove', ['tree_ring', 'rose_in_trees', 'rose_rings']],
    ['tar', Z.ASPECTS.tar],
  ];
  // (A church's graves are per cell — each cell one tile's — and the
  // grove's SYMMETRIC figures are the owner's alone: zone_ground.test.js.)
  const seen = new Set();
  for (const [tag, want] of cases) {
    for (const asp of want) {
      // 1.5 cells west of the seam: the pattern reaches ±4 cells, both sides.
      const [gx, gy] = seamPoint(tag, [asp], [seamX - Math.round(1.5 * cellU), TILE_TY * EXT + 2000], [0, 7]);
      seen.add(checkSeam(tag, [TILE_TX, TILE_TY], [TILE_TX + 1, TILE_TY], gx, gy, `${tag}/${asp} east seam`));
    }
  }
  assert.gte(seen.size, 6, `every aspect crossed a seam (${[...seen].join(', ')})`);
});

test('zones: a nexus straddling a north/south seam where the rows\' grids differ is laid whole', () => {
  let ty = -1;
  for (let r = TILE_TY - 200; r < TILE_TY + 200; r++) {
    if (WorldGen.cellsPerEdgeForTile(r) !== WorldGen.cellsPerEdgeForTile(r + 1)) { ty = r; break; }
  }
  assert.gte(ty, 0, 'a row seam where N changes');
  const N = WorldGen.cellsPerEdgeForTile(ty);
  const seamY = (ty + 1) * EXT, cellU = EXT / N;
  const base = [TILE_TX * EXT + 1500, seamY - Math.round(2.5 * cellU)];
  for (const [tag, want] of [['grove', ['tree_ring', 'rose_in_trees']], ['tar', ['tar_grid', 'tar_cross']]]) {
    // resolveAnchors' row rule reads the anchor's row — seamPoint only picks
    // the aspect (a function of the point alone).
    const [gx, gy] = seamPoint(tag, want, base, [7, 0]);
    checkSeam(tag, [TILE_TX, ty], [TILE_TX, ty + 1], gx, gy, `${tag} south seam (N ${N} / ${WorldGen.cellsPerEdgeForTile(ty + 1)})`);
    // …and the neighbour laying the north side, anchor in the southern row.
    const [gx2, gy2] = seamPoint(tag, want, [base[0], seamY + Math.round(1.5 * cellU)], [7, 0]);
    checkSeam(tag, [TILE_TX, ty + 1], [TILE_TX, ty], gx2, gy2, `${tag} north seam`);
  }
});

// ── Headstones ──────────────────────────────────────────────────────────────
test('headstone: a fifth hold a one-off find, by the stone\'s own id', () => {
  let n = 0;
  const M = 20000;
  for (let i = 0; i < M; i++) if (Z.headstoneHoards(`hs_2754_5566_${i % 200}_${Math.floor(i / 200)}`)) n++;
  near(n / M, Z.HEADSTONE_HOARD_SHARE, 0.01, 'the share');
  assert.eq(Z.HEADSTONE_HOARD_SHARE, 0.2);
  assert.eq(Z.headstoneHoards('hs_1_2_3_4'), Z.headstoneHoards('hs_1_2_3_4'), 'the same stone every time');
});

function withRandom(v, f) {
  const real = Math.random;
  Math.random = () => v;
  try { return f(); } finally { Math.random = real; }
}
function withRaise(f) {
  const real = globalThis.raiseGhostAt;
  const raised = [];
  globalThis.raiseGhostAt = (scene, x, y, now, tag) => { raised.push({ x, y, tag }); return { kind: 'ghost' }; };
  try { return f(raised); } finally { globalThis.raiseGhostAt = real; }
}
test('headstone: a hoard pays once and is spent in save.opened; the stone stays', () => {
  let hoardId = null, plainId = null;
  for (let i = 0; i < 500 && (!hoardId || !plainId); i++) {
    const id = `hs_9_9_${i}_1`;
    if (Z.headstoneHoards(id)) hoardId = hoardId || id; else plainId = plainId || id;
  }
  withRaise(() => withRandom(0.99, () => {
    const scene = makeScene();
    const loots = [];
    scene.flashLoot = (t) => loots.push(t);
    const save = { opened: [], inv: [], relics: {}, money: 0 };
    runInteractable(makeCtx(scene, save), { kind: 'headstone', id: hoardId, x: 0, y: 0 });
    assert.includes(save.opened, hoardId, 'spent in the POI delta');
    assert.eq(loots.length, 1, 'it paid');
    runInteractable(makeCtx(scene, save), { kind: 'headstone', id: hoardId, x: 0, y: 0 });
    assert.eq(loots.length, 1, 'once');
    runInteractable(makeCtx(scene, save), { kind: 'headstone', id: plainId, x: 0, y: 0 });
    assert.eq(loots.length, 1, 'a plain stone pays nothing');
    assert.falsy(save.opened.includes(plainId), 'and records nothing');
  }));
});

test('headstone: Silent Circle pillars remain quiet while other grave variants keep their rewards', () => {
  const id = Array.from({length: 500}, (_, i) => `hs_quiet_${i}`).find(id => Z.headstoneHoards(id));
  assert.truthy(id, 'exercise a stone that normally holds a hoard');
  withRaise(raised => {
    const realRandom = Math.random;
    let rolls = 0;
    Math.random = () => { rolls++; return 0; };
    try {
      for (const variant of ['silent_circle', 'ordered_graves']) {
        const scene = makeScene(), loots = [];
        scene.flashLoot = t => loots.push(t);
        const save = { opened: [], inv: [], relics: {}, money: 0 };
        const object = { kind:'headstone', id, x:3, y:4, zoneVariant:variant };
        const ctx = makeCtx(scene, save);
        runInteractable(ctx, object);
        if (variant === 'silent_circle') {
          runInteractable(ctx, object);
          assert.eq(save.opened.length, 0, 'quiet pillars never spend a reward ledger entry');
          assert.eq(loots.length, 0, 'quiet pillars pay no hoard');
          assert.eq(raised.length, 0, 'quiet pillars never attempt to raise a ghost');
          assert.eq(rolls, 0, 'quiet pillars do not roll for an encounter');
          assert.falsy(ctx.dirty, 'quiet inspection leaves progress unchanged');
        } else {
          assert.includes(save.opened, id, 'ordinary variant keeps its hoard');
          assert.eq(loots.length, 1);
          assert.eq(raised.length, 1, 'ordinary variant keeps its ghost roll');
        }
      }
    } finally { Math.random = realRandom; }
  });
});

test('headstone: a tap raises a ghost one time in three, at any hour', () => {
  assert.eq(Z.HEADSTONE_GHOST_P, 1 / 3);
  withRaise((raised) => {
    const scene = makeScene();
    const save = { opened: [] };
    withRandom(Z.HEADSTONE_GHOST_P - 0.01, () => runInteractable(makeCtx(scene, save), { kind: 'headstone', id: 'hs_0_0_0_0', x: 3, y: 4 }));
    assert.eq(raised.length, 1, 'under the odds: a ghost');
    assert.eq(raised[0].x, 3, 'at the stone');
    withRandom(Z.HEADSTONE_GHOST_P + 0.01, () => runInteractable(makeCtx(scene, save), { kind: 'headstone', id: 'hs_0_0_0_0', x: 3, y: 4 }));
    assert.eq(raised.length, 1, 'over them: none');
  });
  // The source: the roll is not gated on the hour.
  assert.falsy(/daylight/i.test(INTERACTABLES.headstone.custom.toString()), 'no daylight gate');
});

test('raiseGhostAt: the night\'s own ghost, refused past GHOST_NEAR_MAX', () => {
  const entry = { creatures: [] };
  const realGet = WorldGen.tileCache.get, realNear = WorldGen.forEachItemNear;
  WorldGen.tileCache.get = () => entry;
  WorldGen.forEachItemNear = (what, tx, ty, fn) => { for (const c of entry.creatures) fn(c); };
  try {
    const scene = { tileEdgeM: 1000, save: { caught: [] } };
    for (let i = 0; i < __ghost.GHOST_NEAR_MAX + 3; i++) __raiseGhostAt(scene, 10, 10, 1000 + i, 'hs');
    assert.eq(entry.creatures.length, __ghost.GHOST_NEAR_MAX, 'the cap holds');
    assert.eq(entry.creatures[0].kind, 'ghost');
    assert.truthy(/^ghost_0_0_1000_hs_\d+$/.test(entry.creatures[0].id), 'the session id shape the prune knows');
  } finally { WorldGen.tileCache.get = realGet; WorldGen.forEachItemNear = realNear; }
});

// ── Tar, the shrine ─────────────────────────────────────────────────────────
test('tar yard: every tar pit is a slow cell (the burned row\'s lane, _bodyHold)', () => {
  const { on, N, edge } = rasterPair();
  const d = on.zoneDress;
  const tar = d.objects.filter((o) => o.kind === 'tar');
  assert.gt(tar.length, 0, 'the fixture\'s fuel yard laid tar');
  for (const o of tar) {
    const ix = Math.floor((o.x - TILE_TX * edge) / (edge / N)), iy = Math.floor((o.y - TILE_TY * edge) / (edge / N));
    assert.eq(d.slowCells.get(iy * N + ix), 'tar', `${o.id} slows`);
  }
  assert.truthy(StreetVariants.isSlowKind('tar'), 'one table both sides read');
  assert.truthy(/const zDress = entry\.zoneDress;[\s\S]*StreetVariants\.isSlowKind\(o\.kind\)\) slow\.set/.test(SPAWN_IN_TILE_SRC),
    'spawnInTile merges the zone\'s tar into the same slow map');
  assert.truthy(/capMS = \(!pinned && slow/.test(SCENE_SRC), 'and _bodyHold caps the body on it');
  assert.truthy(/'Tar drags at your feet\.'/.test(SCENE_SRC), 'tar SLOWS — it drags, it does not grip');
});

// The tar yard is an OIL-STAINED LOT (Sep 2026): a live fuel forecourt must
// never hold fire enemies. The pits still slow (above); nothing is pushed as
// a lair, and the copy promises no fire. (lairs.js keeps its 'tar' tier row
// for its own tests — it is simply never asked for.)
test('tar yard: no garrison — no fire slimes at a fuel station, and the copy promises none', () => {
  const { on } = rasterPair();
  assert.truthy(on.zoneDress.objects.some((o) => o.kind === 'tar'), 'the fixture\'s fuel yard is still a tar yard');
  assert.eq(on.zoneDress.lairs.length, 0, 'no zone pushes a lair');
  assert.falsy(on.zoneDress.lairs.some((L) => L.tier === 'tar'), 'no fire-slime garrison');
  const k = Z.ZONE_KINDS.tar;
  for (const line of [k.title, k.body, k.flash]) {
    assert.falsy(/flame|fire|burn|slime|moving/i.test(line), `no fire, no foe: ${line}`);
  }
  const tarPiece = STORY_ART_GEN_SRC.slice(STORY_ART_GEN_SRC.indexOf('zone_tar: scene('),
    STORY_ART_GEN_SRC.indexOf('zone_stones: scene('));
  const tarSubject = (tarPiece.match(/'(?:[^'\\]|\\.)*'/g) || []).join(' ');
  assert.truthy(/fuel/.test(tarSubject), 'the painting\'s subject was read');
  assert.falsy(/flame|aflame|fire|slime/i.test(tarSubject), `nor does its painting: ${tarSubject}`);
});

test('flint: a ground pickup that hands over the Flint item, its frames listed', () => {
  assert.eq(wildplantOutput('flint'), 'flint_shard');
  assert.eq(ITEM_BY_ID.flint_shard.name, 'Flint');
  assert.eq(wildplantWorkRelic('flint'), null, 'picked instantly');
  assert.truthy(Array.isArray(CROP_SPRITE.flint.frames), 'frames listed, never counted');
});

test('grove shrine: one gift a UTC day per shrine, in the coin-burst ledger', () => {
  const scene = makeScene();
  const loots = [], flashes = [];
  scene.flashLoot = (t) => loots.push(t);
  scene.flash = (t) => flashes.push(t);
  const save = { inv: [], relics: {}, money: 0, coinBurstClaimed: { stale_20000101: 1 } };
  const shrine = { kind: 'grove_shrine', id: 'sh_1_2_3_4', x: 0, y: 0 };
  runInteractable(makeCtx(scene, save), shrine);
  assert.eq(loots.length, 1, 'a gift');
  assert.eq(save.coinBurstClaimed[shrine.id + Delivery.dayKey()], 1, 'claimed for today');
  assert.falsy('stale_20000101' in save.coinBurstClaimed, 'other days pruned');
  runInteractable(makeCtx(scene, save), shrine);
  assert.eq(loots.length, 1, 'once a day');
  assert.truthy(/^Already visited\. \d+[smhd]\.$/.test(flashes[flashes.length - 1]), `the wait is shown: ${flashes[flashes.length - 1]}`);
  assert.lte(`The shrine rests. ${shortDuration(24 * 3600 * 1000)}.`.length, MAP_MSG_MAX, 'fits a map line');
  const ctxRow = LOOT_CONTEXTS[Z.SHRINE_CONTEXT];
  assert.truthy(ctxRow && ctxRow.favourite.id === 'growth_powder', 'a grove is known for its growth powder');
  let paid = 0;
  for (let i = 0; i < 200; i++) if (pickReward(Z.SHRINE_CONTEXT, { inv: [], relics: {} })) paid++;
  assert.eq(paid, 200, 'every roll pays');
  assert.eq(Lighting.sourceKind({}, shrine), 'shrine', 'and it is a light');
  assert.eq(Lighting.KINDS.shrine.flicker, 0);
});

// ── Park flora grows in clumps (BiomeProfiles FLORA_PATCH) ──────────────────
test('park flora: clumps are about a third of the plane, off the one noise helper', () => {
  const P = BiomeProfiles.FLORA_PATCH;
  assert.truthy(BiomeProfiles.patch(T.PARK) === P && BiomeProfiles.patch(T.GROVE) === P, 'the park row (and the grove it lends)');
  let inside = 0, n = 0;
  for (let i = 0; i < 300; i++) for (let j = 0; j < 300; j++) {
    const gx = 2754 * EXT + i * 23.7, gy = 5566 * EXT + j * 19.3;
    if (BiomeProfiles.patchMul(P, gx, gy) === P.dense) inside++;
    n++;
  }
  near(inside / n, P.share, 0.05, 'the clump share `cut` is measured for');
  assert.lt(P.share * P.dense + (1 - P.share) * P.sparse, 1, 'fewer plants in all than the old blanket');
  // One draw per candidate: the density is scaled, the draw is not moved.
  assert.truthy(/const d = patch\n\s*\? density \* BiomeProfiles\.patchMul\(patch,[^\n]*\n\s*: density;\n\s*if \(prng\(\) < d\)/.test(ALL_SRC['worldgen.js']),
    'spawnDebrisSteps scales the threshold of its one draw');
});

// A synthetic park (a landcover grass/park rectangle, nothing else on the
// tile) whose global centroid picks character `want`.
function syntheticPark(want) {
  const N = WorldGen.cellsPerEdgeForTile(TILE_TY), edge = edgeFor(TILE_TY);
  for (let wU = 4096; wU > 1024; wU -= 16) {
    if (BiomeProfiles.parkCharacterAt(TILE_TX * EXT + wU / 2, TILE_TY * EXT + 2048) !== want) continue;
    const ring = [{ x: 0, y: 0 }, { x: wU, y: 0 }, { x: wU, y: 4096 }, { x: 0, y: 4096 }, { x: 0, y: 0 }];
    const layers = [{ name: 'landcover', features: [{ type: 3, tags: { class: 'grass', subclass: 'park' }, geom: [ring] }] }];
    return { r: WorldGen.rasterizeTile(layers, N, TILE_TX, TILE_TY, edge), N, edge };
  }
  throw new Error('no ' + want + ' rectangle');
}
test('park flora: a clump is several times as full as the open lawn, in every scattered character', () => {
  const P = BiomeProfiles.FLORA_PATCH;
  for (const ch of ['meadow', 'wooded', 'common']) {
    const { r, N, edge } = syntheticPark(ch);
    const occ = new Set();
    for (const o of [...r.objects, ...r.wildplants]) {
      occ.add(Math.floor((o.y - TILE_TY * edge) / (edge / N)) * N + Math.floor((o.x - TILE_TX * edge) / (edge / N)));
    }
    let inN = 0, inOcc = 0, outN = 0, outOcc = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (r.grid[i] !== T.PARK) continue;
      const clump = BiomeProfiles.patchMul(P, TILE_TX * EXT + (x + 0.5) * EXT / N, TILE_TY * EXT + (y + 0.5) * EXT / N) === P.dense;
      if (clump) { inN++; if (occ.has(i)) inOcc++; } else { outN++; if (occ.has(i)) outOcc++; }
    }
    assert.gt(inN, 500, `${ch}: park cells in clumps`); assert.gt(outN, 500, `${ch}: and outside`);
    assert.gt(inOcc / inN, 4 * (outOcc / outN), `${ch} clumped: ${(100 * inOcc / inN).toFixed(1)}% vs ${(100 * outOcc / outN).toFixed(1)}%`);
    assert.lt(inOcc / inN, 0.35, `${ch}: dense, not packed`);
  }
});

test('grove variants: dense geometry preserves existing cells without a neighbour-density veto', () => {
  const { on, N, edge } = rasterPair();
  const cellOf = o => Math.floor((o.y - TILE_TY * edge) / (edge / N)) * N + Math.floor((o.x - TILE_TX * edge) / (edge / N));
  const base = new Set([...on.objects, ...on.wildplants].map(cellOf));
  if (on.streetDress) for (const o of [...on.streetDress.objects, ...on.streetDress.wildplants, ...on.streetDress.treasures]) base.add(cellOf(o));
  const pieces = [...on.zoneDress.objects, ...on.zoneDress.wildplants].filter(p => p.zone === 'grove');
  assert.gt(pieces.length, 0);
  for (const p of pieces) assert.falsy(base.has(cellOf(p)), `${p.id} leaves existing flora intact`);
});

// ── Stories, terrain enumerations, tips ─────────────────────────────────────
test('zones: each kind has a shipped story painting, and every line fits', () => {
  for (const [kind, row] of Object.entries(Z.ZONE_KINDS)) {
    assert.eq(row.story, `zone_${kind === 'beach' ? 'grove' : kind === 'quarry' ? 'stones' : kind}`, `${kind}: key`);
    assert.truthy(new RegExp(`^  ${row.art || row.story}: 'data:image/webp`, 'm').test(ART_THUMBS_SRC), `${kind} has its painting`);
    assert.lte(row.flash.length, MAP_MSG_MAX, `${kind}: the map line fits`);
    assert.truthy(row.title && row.body, `${kind}: title and body`);
  }
  assert.truthy(/drags/.test(Z.ZONE_KINDS.tar.body) && !/grips/.test(Z.ZONE_KINDS.tar.body), 'tar drags, it does not grip');
  assert.truthy(/this\._storySplashOnce\(zrow\.story, \{ art: zrow\.art \|\| zrow\.story, title: zrow\.title, body: zrow\.body \}\)/.test(SCENE_SRC),
    'the feet tick tells it, painted by its own stem');
});

test('zones: every zone terrain is enumerated — colour, texture, family, walkable, rounded', () => {
  const textures = new Function(TEXTURES_SRC + '\nreturn BIOME_TEX;')();
  const painters = { 28: 'drawGroveTex', 29: 'drawChurchyardTex', 31: 'drawTarYardTex' };
  for (const [name, code] of [['GROVE', 28], ['CHURCHYARD', 29], ['TAR_YARD', 31]]) {
    assert.eq(T[name], code, `T.${name}`);
    assert.eq(BiomeProfiles.T[name], code, `BiomeProfiles mirrors ${name}`);
    assert.truthy(new RegExp(`^  ${code}: 0x[0-9a-f]{6},`, 'm').test(SCENE_SRC), `COLORS[${code}]`);
    const texture = textures[code];
    assert.truthy(texture && Number.isInteger(texture.variants) && texture.variants > 0, `BIOME_TEX[${code}] has texture variants`);
    assert.eq(typeof texture.draw, 'function', `${name} has a callable painter`);
    assert.eq(texture.draw.name, painters[code], `${name} uses its material painter`);
    assert.truthy(WorldGen.isWalkable(code), `${name} is walkable`);
    assert.falsy(WorldGen.isLotTerrain(code), `${name} is not somebody's lot`);
    assert.truthy(Z.zoneTerrains().includes(code));
  }
  assert.eq(BiomeProfiles.flora(T.GROVE), BiomeProfiles.flora(T.PARK), 'a grove plays like a park');
  assert.falsy(BIOME_FAUNA.deer.primary.includes(T.GROVE), 'deer are confined to forest and residential ground');
  assert.truthy(/FLAT_ROUNDABLE = new Set\(\[[^\]]*\b29\b[^\]]*\b31\b/.test(RENDER_SRC), 'the two flat halos round their corners');
  assert.eq(T.GROVE !== 30 && T.CHURCHYARD !== 30 && T.TAR_YARD !== 30, true, '30 stays the unmapped veil');
});

test('tips: zone stories hint at the place without revealing odds', () => {
  const head = PLAY_TIPS.find(t => /headstone/i.test(t));
  assert.truthy(head && /ghost/i.test(head), 'a headstone may wake a ghost');
  assert.falsy(/\d/.test(head), 'the story does not give odds');
  for (const t of PLAY_TIPS) {
    assert.falsy(/(graveyard|churchyard)/i.test(t) && /(dusk|twice as often)/i.test(t), `no churchyard dusk rise: ${t}`);
    assert.falsy(/fuel yard/i.test(t) && /(fire slime|flame)/i.test(t), `no fire at a fuel yard: ${t}`);
    assert.falsy(/cemeter/i.test(t) && /(headstone|ghost|stones)/i.test(t), `no cemetery stones: ${t}`);
  }
  assert.eq(ZONE_NEXUS_TIER_BONUS, 1, 'the nexus bonus remains in gameplay');
});

test('tar yard: the oily ground takes no hoe, and says why', () => {
  const T = WorldGen.T;
  assert.truthy(NON_TILLABLE.has(T.TAR_YARD), 'TAR_YARD is non-tillable');
  assert.falsy(isTillable(T.TAR_YARD), 'isTillable agrees');
  assert.truthy(isTillable(T.GROVE) && isTillable(T.CHURCHYARD), 'the grove and churchyard still take one');
  const line = TERRAIN_FLAVOR[T.TAR_YARD];
  assert.truthy(line && line.length <= MAP_MSG_MAX, `a refusal that fits the map (${line})`);
});
test('beach anchors: source tags choose the theme without beach-name heuristics', () => {
  for (const tags of [{ class: 'beach' }, { subclass: 'beach' }, { natural: 'beach' }]) {
    assert.eq(Z.anchorOf(tags).kind, 'beach');
  }
  assert.eq(Z.anchorOf({ class: 'park', subclass: 'park', name: 'Pirate Beach Park' }).kind, 'grove');
  assert.eq(Z.ZONE_KINDS.beach.story, 'zone_grove', 'retain the saved story ledger');
  assert.eq(Z.ZONE_KINDS.beach.art, 'zone_shore', 'show the shrine above the sand');
});

// Real source data tags these places as parks while their sand polygons carry
// subclass=beach. Changing those polygon tags is the control: terrain stays sand.
test('beach parks: Kelowna mapped shores pair beach variants with marine meadows and preserve POIs', () => {
  const named = new Set(), variants = new Set();
  let shoreCells = 0, inlandCells = 0, pieces = 0;
  for (const [tx, ty] of [[2753,5565], [2753,5566], [2753,5567], [2754,5567]]) {
    const key = `${tx}_${ty}`, N = WorldGen.cellsPerEdgeForTile(ty), edge = N * WorldGen.CELL_M;
    const source = decode(key), control = decode(key);
    for (const layer of control) if (layer.name === 'landcover') for (const f of layer.features) {
      if (f.tags.subclass === 'beach') f.tags.subclass = 'sand';
    }
    const on = WorldGen.rasterizeTile(source, N, tx, ty, edge);
    const off = WorldGen.rasterizeTile(control, N, tx, ty, edge);
    const rotary = on.zone?.anchors.find(a => a.name === 'Rotary Beach Park' && a.kind === 'grove');
    if (rotary) {
      assert.eq(rotary.variant, 'marine_meadow', 'Rotary grass is coastal meadow, never mushroom grove ' + key + ' ' + JSON.stringify({owned:rotary.owned, gx:rotary.gx, gy:rotary.gy, anchors:on.zone.anchors.filter(a=>a.name===rotary.name).map(a=>({kind:a.kind,variant:a.variant,owned:a.owned}))}));
      const shore = on.zone.anchors.find(a => a.name === rotary.name && a.parkShore);
      assert.eq(shore?.variant, 'pirate_cove');
      if (shore.owned) {
        const objects = on.zoneDress.objects.filter(o => o.zoneVariant === 'pirate_cove');
        assert.truthy(objects.some(o => o._shrineArt === 'shipwreck'), 'Rotary has its ship: ' + JSON.stringify(on.zoneDress.diagnostics.filter(d => d.variant === 'pirate_cove')));
        assert.eq(objects.filter(o => o._shrineArt === 'shipwreck').length, 1, 'Rotary has one hiring service');
        assert.falsy(objects.some(o => o.zoneLayer === 'wreck'), 'no bonus hull chest');
        assert.eq(objects.filter(o => o.zoneLayer === 'shore_find').length, 2, 'Rotary has two shoreline chests');
        assert.eq(objects.filter(o => o.barrel).length, 3, 'Rotary has authored barrels');
        assert.eq(on.zoneDress.wildplants.filter(o => o.zoneVariant === 'pirate_cove' && o.crop === 'driftwood' && o.zoneLayer === 'decoration').length, 2, 'Rotary has sparse authored driftwood');
        assert.eq(on.zoneDress.guards.filter(o => o.zoneVariant === 'pirate_cove' && o.kind === 'crab').length, 3, 'Rotary has authored crabs');
      }
    }
    const beaches = (source.find(l => l.name === 'landcover')?.features || [])
      .filter(f => f.type === 3 && f.tags.subclass === 'beach');
    const inside = (p, rings) => {
      let yes = false;
      for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j], b = ring[i];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) yes = !yes;
      }
      return yes;
    };
    for (let i = 0; i < N*N; i++) {
      const a = on.zone?.anchors[(on.zone.coverage?.[i] || 0)-1];
      const b = off.zone?.anchors[(off.zone.coverage?.[i] || 0)-1];
      if (a?.parkShore) {
        shoreCells++; named.add(a.name); variants.add(ZoneVariants.pick(a).id);
        const point = {x: (i%N+.5)*4096/N, y: (Math.floor(i/N)+.5)*4096/N};
        assert.truthy(beaches.some(f => inside(point, f.geom)), `${a.name}: coverage stays inside mapped beach`);
      } else if (b?.kind === 'grove') {
        inlandCells++;
        assert.eq(a?.kind, 'grove', 'inland park keeps its grove');
        assert.eq(ZoneVariants.identity(a), ZoneVariants.identity(b), 'inland identity stays fixed');
      }
    }
    const poiIds = r => r.objects.filter(o => o._poiAt).map(o => o.id).sort().join(',');
    assert.eq(poiIds(on), poiIds(off), 'existing park POI ids survive without an extra POI');
    assert.truthy(JSON.stringify(on.zone?.caveSource) === JSON.stringify(off.zone?.caveSource), 'beach dressing preserves cave inputs');
    pieces += [...(on.zoneDress?.objects || []), ...(on.zoneDress?.wildplants || [])]
      .filter(o => o.zone === 'beach').length;
  }
  for (const name of ['Boyce-Gyro Beach Park', 'Rotary Beach Park', 'Strathcona Beach Park']) {
    assert.truthy(named.has(name), `${name}: mapped shore activates beach variants`);
  }
  assert.gt(shoreCells, 0, 'real mapped beach coverage exists');
  assert.gt(inlandCells, 0, 'inland grove coverage remains');
  assert.gt(pieces, 0, 'beach variants place actual game objects');
  assert.gt(variants.size, 1, 'real parks receive varied beach themes');
});
})();
