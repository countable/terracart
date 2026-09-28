// SENSITIVE PLACES and QUIET LAND (Sep 2026) — src/worldgen.js.
//
// What is pinned:
//   · THE TABLE: WorldGen.isSensitivePoi is the one answer to "may this real
//     place become game content?" — memorials (every memorial=*, the
//     Stolperstein included), monuments, cemeteries / grave_yards, genocide /
//     Holocaust sites by name, and every place of worship that is not a
//     church (a faith given that is not christian, or none given and a name
//     that names no church). A sensitive point MINTS NOTHING: no chest, no
//     stall, no zone anchor, no X, no gate, no board — on the MVT poi pass,
//     the sidecar / Overpass bin, and a bin cached before the table.
//   · THE OVERPASS QUERY no longer asks for historic=memorial.
//   · QUIET LAND: military, railway, reserve (boundary aboriginal_lands) and
//     cemetery polygons stamp `quietMask` (entry.quietMask), a per-cell
//     Uint8Array; isSpawnCell refuses a quiet cell (opts.quiet), and nothing
//     the build lays stands on one — scatter, chests, dressing, headstones,
//     the stair.
(function () {
  const W = WorldGen;
  const T = W.T;
  const CPE = 64, EXT = 4096, CELL = EXT / CPE, EDGE = 640, CM = EDGE / CPE;
  const pt = (ix, iy) => [[{ x: (ix + 0.5) * CELL, y: (iy + 0.5) * CELL }]];
  const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
  const cellRect = (c0, r0, c1, r1) => [rect(c0 * CELL, r0 * CELL, c1 * CELL, r1 * CELL)];
  const cellOf = (o) => Math.floor(o.y / CM) * CPE + Math.floor(o.x / CM);
  // A park tile (public ground: every cell may host a spawn) plus the layers
  // given, rasterized on the synthetic 64-cell grid.
  const build = (extra) => W.rasterizeTile([
    { name: 'landcover', features: [{ type: 3, tags: { class: 'grass', subclass: 'park' }, geom: [rect(-64, -64, 4160, 4160)] }] },
    ...extra,
  ], CPE, 0, 0, EDGE);

  // ── The table ─────────────────────────────────────────────────────────────
  test('sensitive places: one table — memorials, graves, genocide sites and other faiths', () => {
    const S = (tags) => W.isSensitivePoi(tags);
    for (const c of ['memorial', 'monument', 'cemetery', 'grave_yard']) assert.truthy(S({ class: c }), `${c} (MVT class)`);
    // OSM tags (Overpass / the sidecar's `tags`).
    assert.truthy(S({ memorial: 'stolperstein' }), 'a Stolperstein');
    assert.truthy(S({ memorial: 'plaque' }), 'any memorial=*');
    assert.truthy(S({ historic: 'memorial' }) && S({ historic: 'monument' }) && S({ historic: 'tomb' }));
    assert.truthy(S({ amenity: 'grave_yard' }) && S({ landuse: 'cemetery' }));
    assert.falsy(S({ memorial: 'no' }), 'memorial=no is not a memorial');
    // By name: what the tags may not say.
    assert.truthy(S({ class: 'museum', name: 'Holocaust Education Centre' }));
    assert.truthy(S({ class: 'attraction', name: 'Gedenkstätte Berliner Mauer' }));
    assert.truthy(S({ class: 'park', name: 'Mahnmal am Park' }));
    assert.falsy(S({ class: 'park', name: 'Memorial Park' }), '"Memorial Park" is a park');
    assert.falsy(S({ class: 'hospital', name: 'Memorial Hospital' }), 'and a hospital a hospital');
    // Worship: a church only.
    assert.falsy(S({ class: 'place_of_worship', subclass: 'christian' }), 'a church may be the chapel');
    for (const faith of ['jewish', 'muslim', 'buddhist', 'hindu', 'sikh', 'scientologist']) {
      assert.truthy(S({ class: 'place_of_worship', subclass: faith }), `${faith}: mints nothing`);
    }
    assert.truthy(S({ amenity: 'place_of_worship', religion: 'jewish' }), 'a synagogue by OSM tags');
    assert.truthy(S({ class: 'place_of_worship' }), 'no faith, no name: unknown fails closed');
    assert.truthy(S({ class: 'place_of_worship', name: 'Beth Tikvah' }), 'a name that names no church: closed');
    assert.falsy(S({ class: 'place_of_worship', name: 'Kelowna Gospel Fellowship' }), 'a church by name');
    assert.falsy(S({ class: 'place_of_worship', name: 'St. Marien Kirche' }));
    assert.truthy(S({ class: 'place_of_worship', subclass: 'scientologist', name: 'Church of Scientology' }),
      'a faith given wins over the name');
    assert.eq(W.worshipFaith({ class: 'place_of_worship', name: 'First Baptist' }), 'christian');
    assert.eq(W.worshipFaith({ class: 'place_of_worship' }), '');
    // Ordinary places stay ordinary.
    for (const c of ['cafe', 'park', 'museum', 'library', 'fuel', 'bus']) assert.falsy(S({ class: c }), c);
  });

  test('sensitive places: no chest class, no category, no theme, no label', () => {
    for (const c of ['memorial', 'monument', 'cemetery', 'grave_yard']) {
      assert.falsy(W.POI_USEFUL.has(c), `${c} is off the chest list`);
      assert.falsy(POI_CATEGORY[c], `${c} has no loot category`);
      assert.falsy(POI_CLASS_FALLBACK[c], `${c} has no label`);
    }
    assert.falsy(ChestThemes.themes ? ChestThemes.themes.memorial : false, 'no memorial theme');
    assert.eq(ChestThemes.normalize('memorial'), 'roadside', 'the memorial theme is gone');
    assert.falsy(/historic"="memorial/.test(WORLDGEN_SRC), 'the Overpass query never asks for memorials');
    assert.falsy(/tags\.historic === 'memorial'\) return 'memorial'/.test(WORLDGEN_SRC), 'nor maps them to a kind');
  });

  test('sensitive places: a sensitive POI mints nothing on the MVT pass — a church mints its chapel', () => {
    const poi = (ix, iy, tags) => ({ type: 1, tags, geom: pt(ix, iy) });
    const r = build([{ name: 'poi', features: [
      poi(8, 8, { class: 'memorial', subclass: 'memorial' }),
      poi(16, 8, { class: 'monument', subclass: 'monument' }),
      poi(24, 8, { class: 'cemetery', subclass: 'cemetery' }),
      poi(32, 8, { class: 'place_of_worship', subclass: 'jewish', name: 'Synagoge' }),
      poi(40, 8, { class: 'place_of_worship', subclass: 'muslim' }),
      poi(48, 8, { class: 'place_of_worship' }),
      poi(8, 24, { class: 'attraction', name: 'Gedenkstätte' }),
      poi(16, 24, { class: 'information', name: 'Stolperstein' }),
      poi(24, 24, { class: 'gate', name: 'KZ-Gedenkstätte' }),
      poi(32, 40, { class: 'place_of_worship', subclass: 'christian', name: 'St. Mary' }),
      poi(48, 40, { class: 'cafe', name: 'Corner Café' }),
    ] }]);
    const chests = r.objects.filter((o) => o.kind === 'chest');
    assert.eq(chests.map((o) => o.poiClass).sort().join(), 'cafe,place_of_worship', 'only the café and the church');
    const church = chests.find((o) => o.poiClass === 'place_of_worship');
    assert.eq(chestLook(church).macro && chestLook(church).macro.kind, 'chapel', 'the church stands as the chapel');
    assert.falsy(r.objects.some((o) => o.kind === 'infoboard' || o.kind === 'gatepost'), 'no board, no gate');
    // …and no zone: the church is the only anchor.
    const kinds = (r.zone && r.zone.anchors || []).map((a) => a.kind);
    assert.falsy(kinds.some((k) => k !== 'stones'), `only the church anchors (${kinds.join()})`);
  });

  test('sensitive places: the sidecar / Overpass bin mints no memorial, and a cached one is dropped', () => {
    const gj = { features: [
      { geometry: { type: 'Point', coordinates: [-119.47, 49.85] }, properties: { kind: 'memorial', osm_id: 1 } },
      { geometry: { type: 'Point', coordinates: [-119.4702, 49.85] },
        properties: { kind: 'picnic_table', osm_id: 2, tags: { memorial: 'bench' } } },
      { geometry: { type: 'Point', coordinates: [-119.471, 49.852] }, properties: { kind: 'bus_stop', osm_id: 99 } },
    ] };
    let chests = [];
    for (const b of W.buildBinsFromGeoJSON(gj, 49.85).values()) chests = chests.concat(b.chests);
    assert.eq(chests.map((c) => c.poiClass).join(), 'bus', 'only the bus stop');
    const N = 32;
    const entry = { grid: new Uint8Array(N * N).fill(T.GRASS), roadMask: new Uint8Array(N * N),
      cellsPerEdge: N, tileEdgeM: 320, objects: [], wildplants: [] };
    W.injectTileBin(entry, { chests: [
      { kind: 'chest', lix: 5, liy: 5, poiClass: 'memorial', id: 'sxc_1' },
      { kind: 'chest', lix: 20, liy: 20, poiClass: 'bus', id: 'sxc_3' },
    ] }, 0, 0);
    assert.eq(entry.objects.map((o) => o.poiClass).join(), 'bus', 'a bin cached before the table drops it');
  });

  // ── Quiet land ────────────────────────────────────────────────────────────
  test('quiet land: military, railway, reserve and cemetery cells stamp the mask; the look is kept', () => {
    const r = build([
      { name: 'landuse', features: [
        { type: 3, tags: { class: 'military' }, geom: cellRect(4, 4, 14, 14) },
        { type: 3, tags: { class: 'railway' }, geom: cellRect(20, 4, 30, 14) },
        { type: 3, tags: { class: 'cemetery' }, geom: cellRect(36, 4, 46, 14) },
        { type: 3, tags: { class: 'brownfield' }, geom: cellRect(4, 40, 14, 50) },
      ] },
      { name: 'boundary', features: [
        { type: 3, tags: { class: 'aboriginal_lands', name: 'Reserve 1' }, geom: cellRect(20, 40, 30, 50) },
        { type: 2, tags: { class: 'aboriginal_lands' }, geom: [rect(0, 0, 100, 100)] },
      ] },
    ]);
    const q = r.quietMask;
    assert.truthy(q instanceof Uint8Array && q.length === CPE * CPE, 'a per-cell mask');
    const at = (ix, iy) => q[iy * CPE + ix];
    assert.eq(at(8, 8), 1, 'military');
    assert.eq(at(25, 8), 1, 'railway');
    assert.eq(at(40, 8), 1, 'cemetery');
    assert.eq(at(25, 45), 1, 'reserve land (boundary aboriginal_lands)');
    assert.eq(at(8, 45), 0, 'brownfield is ordinary waste ground');
    assert.eq(at(60, 60), 0, 'the park is not quiet');
    assert.eq(r.grid[8 * CPE + 8], T.WASTELAND, 'military keeps the scrub look');
    assert.eq(r.grid[8 * CPE + 25], T.WASTELAND, 'railway land too');
    // The shared rule refuses a quiet cell and nothing else changes.
    assert.falsy(W.isSpawnCell(r.grid, CPE, CPE, 8, 8, { quiet: q }), 'isSpawnCell refuses quiet land');
    assert.truthy(W.isSpawnCell(r.grid, CPE, CPE, 60, 60, { quiet: q }), 'and passes open ground');
    // Nothing the build laid stands on it.
    for (const o of [...r.objects, ...r.wildplants]) {
      const i = cellOf(o);
      if (i >= 0 && i < CPE * CPE) assert.eq(q[i], 0, `${o.kind} ${o.id} is off quiet land`);
    }
    // A pure function of the tile's bytes: the same mask rebuilt.
    const again = build([
      { name: 'landuse', features: [{ type: 3, tags: { class: 'military' }, geom: cellRect(4, 4, 14, 14) }] }]);
    assert.eq(again.quietMask[8 * CPE + 8], 1, 'rebuilt, the same');
    assert.truthy(W.isQuietLand('landuse', { class: 'railway' }) && !W.isQuietLand('landuse', { class: 'industrial' }));
  });

  test('quiet land: a POI chest and a gate on quiet land mint nothing', () => {
    const r = build([
      { name: 'landuse', features: [{ type: 3, tags: { class: 'railway' }, geom: cellRect(4, 4, 30, 30) }] },
      { name: 'poi', features: [
        { type: 1, tags: { class: 'cafe', name: 'Station Café' }, geom: pt(10, 10) },
        { type: 1, tags: { class: 'gate' }, geom: pt(20, 20) },
        { type: 1, tags: { class: 'cafe', name: 'Corner Café' }, geom: pt(50, 50) },
      ] },
    ]);
    assert.eq(r.objects.filter((o) => o.kind === 'chest').map((o) => o.name).join(), 'Corner Café', 'the station café is quiet');
    assert.eq(r.objects.filter((o) => o.kind === 'gatepost').length, 0, 'no foe rises at a level crossing');
  });

  test('quiet land: the Kelowna reserve polygon is quiet, and nothing the build laid stands on it', () => {
    const tx = 2754, ty = 5567;
    const N = W.cellsPerEdgeForTile(ty), edge = W.tileEdgeMeters(W.latOfRowCentre(ty));
    const r = W.rasterizeTile(MVT.decodeTile(FIXTURE_TILES[`${tx}_${ty}`]), N, tx, ty, edge);
    let quiet = 0;
    for (let i = 0; i < N * N; i++) quiet += r.quietMask[i];
    assert.gt(quiet, 20, `Mission Creek 8 stamps quiet cells (${quiet})`);
    const all = [...r.objects, ...r.wildplants,
      ...((r.zoneDress && r.zoneDress.objects) || []), ...((r.zoneDress && r.zoneDress.wildplants) || []),
      ...((r.streetDress && r.streetDress.objects) || []), ...((r.streetDress && r.streetDress.wildplants) || [])];
    const cell = (o) => Math.floor((o.y - ty * edge) / (edge / N)) * N + Math.floor((o.x - tx * edge) / (edge / N));
    for (const o of all) {
      if (o.kind === 'house' || o.kind === 'tower') continue;   // a building is the land's, not a spawn
      const i = cell(o);
      if (i >= 0 && i < N * N) assert.eq(r.quietMask[i], 0, `${o.kind} ${o.id} is off quiet land`);
    }
  });

  test('quiet land: the entry carries it, and every seat outside the build can read it', () => {
    assert.truthy(/entry\.quietMask = quietMask;/.test(WORLDGEN_SRC), 'loadTile carries it on the entry (a rebuild re-derives it)');
    // Folded into the spawn gate (entry.spawnWhy): every reader below reads
    // the mask, and the quiet mask is one of its INVALID reasons.
    assert.truthy(/entry\.spawnWhy = spawnWhy;/.test(WORLDGEN_SRC), 'loadTile carries the spawn gate too');
    assert.truthy(/const stairOpts = \{ roadMask, quiet: entry\.quietMask, spawnWhy: entry\.spawnWhy/.test(WORLDGEN_SRC), 'the cave stair refuses it');
    assert.truthy(/const _sxSpawnOpts = \{ pois: _sxPois, roadMask, quiet, spawnWhy \};/.test(WORLDGEN_SRC), 'the bin injection reads it');
    assert.truthy(/\(quietMask && quietMask\[i\]\)/.test(WORLDGEN_SRC), 'the gate folds the quiet land in as INVALID');
    assert.truthy(/yield\* stampQuietLandSteps\(layers, quietMask, w, h, mvtToCell\);/.test(WORLDGEN_SRC),
      'stamped inside the sliced build, yielding (tile_build_blocks)');
  });
})();
