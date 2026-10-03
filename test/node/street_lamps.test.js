// THE STREET LAMPS — app.js wiring for "a restored street lights its own
// way": one glowing cobble every Streets.lampSpacingM() metres of RESTORED
// carriageway. streets.js says where the stones stand (streets.test.js),
// lighting.js's `cobble` row is the light one throws and collectLamps reads
// the live list (lighting.test.js), road_overlay.js paints the stone
// (road_overlay.test.js) — this file pins the app.js glue: which cell each
// of the three passes measures from, what the tile cache and the memo key
// carry, and what never lights.
//
// app.js needs Phaser and can't load headlessly (no bridge exists for these
// methods in run.js), so — like feet_anchor.test.js and energy_pop.test.js —
// the wiring is pinned as SOURCE TEXT against SCENE_SRC.

(function () {
const app = SCENE_SRC;

// The three passes, as source, in the order drawRoadGeometry calls them.
const forTileSrc = app.slice(app.indexOf('  _streetLampsForTile(tx, ty, entry) {'),
                              app.indexOf('  // The lamps near the frame')) + ROAD_OVERLAY_SRC.slice(
  ROAD_OVERLAY_SRC.indexOf('  function lampSitesForTile('), ROAD_OVERLAY_SRC.indexOf('  function lampReservedCells('));
const updateSrc = app.slice(app.indexOf('  _updateStreetLamps() {'),
                             app.indexOf('  // THE RIPEN PASS.'));
// …and the DRAW is render.js's: a lamp goes through the shared world sprite
// pass like every other standing thing, so what is pinned here is the list it
// builds off scene._streetLamps and the RENDER_SPEC row that draws it.
const render = RENDER_SRC;
const lampListSrc = render.slice(render.indexOf('  const lampList ='),
                                 render.indexOf('  // Hide objects that are temporarily gone'));
const lampSpecSrc = render.slice(render.indexOf('    _streetlamp: {'),
                                 render.indexOf('    // Cave torch —'));

test('street lamps: the lit list is built from the CAMERA ANCHOR, never from the feet', () => {
  // The camera rule (CLAUDE.md): a world-DRAWN thing measures from the
  // camera anchor, so a peek drag brings the lamps at the peeked edge with
  // it. _updateStreetLamps answers "where do I draw this" and must read
  // viewAnchorCell — never playerReachCell / playerToWorldCell / a bare
  // playerM read for its own cell.
  assert.truthy(/const a = viewAnchorCell\(this\);/.test(updateSrc),
    '_updateStreetLamps reads the camera anchor');
  assert.falsy(/playerReachCell/.test(updateSrc), 'never the reach cell — that would starve a peek of its lamps');
  assert.falsy(/playerToWorldCell/.test(updateSrc), 'nor the raw player cell');
});

test('street lamps: the RESTORING sweep still measures from the REACH cell — the other side of the rule', () => {
  // _sweepStreets (which decides what actually turns to clean cobble) is
  // gameplay, not a draw pass, so it keeps using the body's own reach cell —
  // exactly like every tap gate and the fog reveal. Pinning both halves in
  // one test is the point: a peek must widen what you can SEE lit without
  // widening what you can RESTORE.
  const sweepSrc = app.slice(app.indexOf('  _sweepStreets() {'), app.indexOf('  // Forget every stretch'));
  assert.truthy(/const p = playerReachCell\(this\);/.test(sweepSrc),
    '_sweepStreets measures the scan from the reach cell');
  assert.falsy(/viewAnchorCell/.test(sweepSrc), 'never the camera anchor — a peek must not reach further than the arm');
  // …and _rescanStreets (the actual scan) takes that reach-cell point as a
  // parameter rather than deriving its own — so there is only one place in
  // the whole sweep that could ever read the wrong cell.
  assert.truthy(/_rescanStreets\(p, reachM, now, sight\)/.test(sweepSrc),
    'the reach-cell point is threaded through, not re-derived');
});

test('street lamps: the memo key carries Streets.epoch and the anchor cell', () => {
  // Streets.epoch(save) is the integer that changes exactly when a restore
  // banked new metres — folding it into the key is what lights the new
  // lamps on the very next frame a restore completes. The anchor cell is
  // there so standing still (the common case, every frame) costs nothing:
  // the whole tile scan below only runs when one of the two moves.
  // …plus the LIVING-LAMP inputs: the session's visit epoch and the fade's
  // clock bucketed at Streets.LAMP_REFRESH_MS (each lamp's `bright` is
  // quantised, so the lightmap moves only on a real step).
  assert.truthy(/const key = `\$\{cellIX\},\$\{cellIY\}\|\$\{Streets\.epoch\(this\.save\)\}\|\$\{this\._lampVisitEpoch \| 0\}`\s*\n\s*\+ `\|\$\{Math\.floor\(now \/ Streets\.LAMP_REFRESH_MS\)\}`;/.test(updateSrc),
    'the key is the anchor cell, Streets.epoch, the visit epoch and the fade bucket — nothing else');
  assert.truthy(/if \(this\._streetLampKey === key && this\._streetLamps\) return;/.test(updateSrc),
    'an unchanged key does no work at all');
});

test('street lamps: _streetLampsForTile caches on the TILE ENTRY, so a rebuilt tile re-derives', () => {
  // A tile rasterized before its Overpass bin arrives gets rebuilt into a NEW
  // entry object (CLAUDE.md's rebuild rule) that carries over only what it
  // cannot reconstruct. A lamp list is cheap to reconstruct, so it belongs on
  // the entry itself — never on a scene-level Map keyed by tile — so the
  // rebuilt entry simply starts with no cache and gets a fresh one.
  assert.truthy(/if \(entry\._streetLamps\) return entry\._streetLamps;/.test(forTileSrc),
    'cached on the entry, read back before recomputing');
  assert.truthy(/entry\._streetLamps = out;/.test(forTileSrc), 'and written back onto the entry, not a side map');
});

test('street lamps: only the metres inside the TILE SQUARE stand a lamp — no double stone in the buffer', () => {
  // MVT geometry runs past the tile edge into the buffer, and the same way
  // comes back inside the neighbour tile's copy. Without the tileSpans test
  // both tiles would place a stone (and a light) on the same stretch.
  assert.truthy(/const spans = Streets\.tileSpans\(line, mvtToM, extent\);/.test(forTileSrc),
    'the tile square is computed');
  assert.truthy(/if \(!Streets\.covers\(spans, sM\)\) continue;(\s*\/\/[^\n]*)?/.test(forTileSrc),
    'and every candidate lamp is checked against it before being kept');
});

test('street lamps: rail and transit never light', () => {
  assert.truthy(/if \(cls === 'rail' \|\| cls === 'transit'\) continue;/.test(forTileSrc),
    'a railway or a transit line is skipped before any lamp is placed on it');
});

test('street lamps: surface only — a cave has no streets to light', () => {
  assert.truthy(/if \(typeof Streets === 'undefined' \|\| \(this\.depth \?\? 0\) !== 0\) \{/.test(updateSrc),
    '_updateStreetLamps bails immediately below the surface');
  assert.truthy(/this\._streetLamps = null;/.test(updateSrc), 'and clears the list rather than leaving a stale one lit');
});

test('street lamps: a lamp is a STANDING sprite — it sorts by screen row with everything else', () => {
  // THE PAINTER RULE (CLAUDE.md): the lower object renders in front, and the
  // one place that implements it is drawObjects' screen-row z-order pass over
  // the shared world layer. A lamp had a pool of its own in cobbleContainer
  // (ground decoration, below the building footprints and below every sprite)
  // until Sep 2026, so it hid under any footprint or sprite on the map
  // whatever row it stood in — which is exactly what a layer of its own buys
  // you. It joins the pass the way the placed campfires and scarecrows do:
  // an item on filteredObj, which the z-order pass ranks by cell row.
  // (placedAs is the pass's one builder for a placed thing drawn as a
  // synthetic object kind — scarecrows, campfires and the lamps alike.)
  assert.truthy(/const lampList = placedAs\(scene\._streetLamps \|\| \[\], '_streetlamp', 'lamp',/.test(lampListSrc),
    'the list comes off the one app.js keeps (scene._streetLamps), as items of its own RENDER_SPEC kind');
  assert.truthy(/cullToView\(list, pWorldX, pWorldY, halfM, \(p, dx, dy\) => out\.push\(\{/.test(render),
    'measured from the CAMERA ANCHOR the whole pass projects from — a peek carries the lamps with the ground');
  assert.truthy(/for \(const L of lampList\) filteredObj\.push\(L\);/.test(render),
    'and pushed onto filteredObj, which is what the z-order pass ranks');
  // The shared pass uses continuous ground anchors, including a lamp's foot.
  assert.truthy(/Render\.sortWorldDepth\(zList\)/.test(render),
    'the one ground-depth sort ranks every item on that list');
  // …and app.js no longer draws lamps itself.
  assert.falsy(/_drawStreetLamps/.test(app), 'the lamp has no draw pass of its own any more');
  assert.falsy(/streetLampPool/.test(app), 'nor a pool of its own in the ground-decoration layer');
});

test('street lamps: an UNLIT lamp draws the BROKEN POST baked from the same painter, at the lit lamp\'s size and seat', () => {
  // A lamp stands on every LAMP_SPACING_M of street whether or not that
  // stretch is restored; the dark ones have to be visible or the lamps would
  // seem to appear from nowhere. Until Oct 2026 they wore a 16 px frame of
  // the old cobble sheet at a quarter the size and 57% alpha — a smudge next
  // to the lit lamp. Now the dark lamp is the SAME casting with its column
  // snapped (RoadOverlay.paintBrokenLamp), baked at runtime exactly as the
  // lit lamp is, so restoring a stretch changes the lamp and nothing else.
  assert.truthy(/const STREET_LAMP_BROKEN_TEX = 'street_lamp_broken';/.test(app), 'one bake for every street\'s broken post');
  assert.truthy(/_ensureBrokenLampTex\(\) \{[\s\S]{0,600}?RoadOverlay\.paintBrokenLamp\(lctx, S\);[\s\S]{0,80}?this\.textures\.addCanvas\(key, cvs\);/.test(app),
    'baked by the real painter with `broken` set, into a canvas texture');
  assert.truthy(/const key = STREET_LAMP_BROKEN_TEX;\s*\n\s*if \(this\.textures\.exists\(key\)\) return key;/.test(app), 'baked once');
  assert.truthy(/this\._ensureStreetLampTex\(UI_LAMP_GLOW\);\s*\n\s*this\._ensureBrokenLampTex\(\);/.test(app), 'baked at boot beside the lit lamp');
  // ONE RENDER_SPEC row, two bakes, picked by the one `lit` flag — and the
  // same frame, origin, nudge, size and alpha for both: the cobble's own
  // frame table, size and alpha are gone.
  assert.truthy(/key: \(o\) => \(o\.lit \? streetLampTexKey\(o\.glow\) : STREET_LAMP_BROKEN_TEX\)/.test(lampSpecSrc),
    'the texture branches on o.lit — a lit lamp by its own glow\'s bake, a dark one the broken post');
  assert.truthy(/frame: '__BASE',/.test(lampSpecSrc), 'the baked canvas is the only frame of either');
  assert.truthy(/RoadOverlay\.LAMP_DRAW_CELLS\) \|\| 2\.4\);\s*\n\s*s\.setDisplaySize\(px, px\)\.setAlpha\(1\);/.test(lampSpecSrc), 'both at the lamp\'s size, opaque');
  assert.falsy(/streetLampDark|STREET_LAMP_DARK_TEX|STREET_LAMP_DARK_ALPHA|STREET_LAMP_DARK_FRAME/.test(app + lampSpecSrc), 'no cobble lane left');
  // The placement footprint is untouched: the site radius still derives from
  // the old stone's width, so no lamp moved when its art did.
  assert.truthy(/const STREET_LAMP_DARK_CELLS = RoadOverlay\.LAMP_DARK_CELLS;/.test(app), 'the site footprint constant stays');
  assert.truthy(/const LAMP_DARK_CELLS = \{ road: 0\.64, path: 0\.584 \};/.test(ROAD_OVERLAY_SRC), 'at the widths it always had');
  // The tier is the terrain classifier's own answer, not a second class list.
  assert.truthy(/WorldGen\.classifyLine\('transportation', f\.tags \|\| \{\}\)/.test(forTileSrc),
    '_streetLampsForTile classifies the way with WorldGen.classifyLine');
  assert.eq(typeof WorldGen.classifyLine, 'function', 'which worldgen.js exports');
});

test('street lamps: the light collector reads the same list and skips the dark ones — one list, one flag, both readers', () => {
  // _updateStreetLamps keeps every lamp near the anchor and flags each `lit`
  // by Streets.covers over the restored intervals; the draw pass and
  // Lighting.collectLamps both read that flag, so a stone can never be drawn
  // lit while throwing no light, or the reverse.
  assert.truthy(/out\.push\(\{ \.\.\.L, lit: Streets\.covers\(iv, L\.s\),/.test(updateSrc),
    'the flag is Streets.covers over the line\'s restored list, on a fresh object (never written onto the tile cache)');
  assert.falsy(/if \(!Streets\.covers\(iv, L\.s\)\) continue;/.test(updateSrc), 'a dark lamp is no longer dropped from the list');
  assert.truthy(/if \(!L\.lit\) continue;/.test(LIGHTING_SRC), 'collectLamps skips a dark lamp');
});

test('street lamps: which lamps are lit is settled before the pass that draws them', () => {
  const body = app.slice(app.indexOf('  drawRoadGeometry() {'), app.indexOf('  drawBuildingGeometry() {'));
  const iLive = body.indexOf('this._drawStreetLive();');
  const iUpdate = body.indexOf('this._updateStreetLamps();');
  assert.truthy(iLive > 0 && iUpdate > iLive,
    'RoadOverlay.draw, then the live preview, then which lamps are lit');
  // …and the frame runs drawRoadGeometry BEFORE drawObjects, which is where
  // both readers of that list are: the sprite pass that draws each lamp and
  // Lighting.collectLamps that lights it. A list refreshed after them would
  // draw a frame late on the sweep that lights a stretch.
  const frame = app.slice(app.indexOf('    this.drawCells();'), app.indexOf('  drawCells() {'));
  const iRoad = frame.indexOf('this.drawRoadGeometry();');
  const iObjects = frame.indexOf('this.drawObjects();');
  assert.truthy(iRoad > 0 && iObjects > iRoad, 'the road pass runs before the sprite pass');
});


test('street lamps: the texture is baked once with RoadOverlay.paintLamp, keyed off the module\'s own LAMP_TEX_PX', () => {
  assert.truthy(/RoadOverlay\.paintLamp\(lctx, S, glow \|\| UI_LAMP_GLOW\)/.test(app), 'the real painter draws the baked texture, in the lamp\'s glow');
  assert.truthy(/const S = RoadOverlay\.LAMP_TEX_PX;/.test(app), 'sized off road_overlay.js\'s own texture constant');
  assert.truthy(/const key = streetLampTexKey\(glow\);\s*\n\s*if \(this\.textures\.exists\(key\)\) return key;/.test(app),
    'baked once per colour, not re-painted every boot or every lamp');
  assert.truthy(/this\._ensureStreetLampTex\(UI_LAMP_GLOW\);/.test(app), 'the default glow is baked at boot');
});

test('street lamps: the lamp STANDS on its point — the sprite\'s origin is the art\'s own ground line', () => {
  // road_overlay.js composes the baked square with the plinth, the shadow and
  // the pool of glow on LAMP_GROUND_FRAC (road_overlay.test.js pins that end),
  // which is BELOW the middle because a lamp is mostly post. Seating the
  // sprite by that fraction rather than by its centre is what puts the foot on
  // the lamp's world point — and so puts lighting.js's cookie, which lands on
  // that same point, in a pool at the lamp's foot instead of up in its glass.
  assert.truthy(/const STREET_LAMP_ORIGIN_Y =\s*\n?\s*\(typeof RoadOverlay !== 'undefined' && RoadOverlay\.LAMP_GROUND_FRAC\) \|\| ([\d.]+);/.test(app),
    'the origin comes from the module that paints the art, with a literal fallback only for load order');
  assert.eq(Number(app.match(/RoadOverlay\.LAMP_GROUND_FRAC\) \|\| ([\d.]+);/)[1]), RoadOverlay.LAMP_GROUND_FRAC,
    'and the load-order fallback agrees with it');
  assert.truthy(/origin: \(\) => \[0\.5, STREET_LAMP_ORIGIN_Y\],/.test(lampSpecSrc),
    'lit or broken, the lamp is seated on its ground line (the broken post is the same bake, Oct 2026)');
  // The post is drawn a few pixels below its point — art only: the verge
  // offset above and the light on the same point are unmoved. It counts
  // BECAUSE the row is not seated (a seated spec has its dyPx overwritten by
  // the seat pass, which is how three tuned offsets that moved nothing came to
  // ship), so the two pins belong together.
  assert.truthy(/dyPx: \(\) => STREET_LAMP_DY_PX,/.test(lampSpecSrc),
    'both posts take the nudge — the broken one stands on the same point');
  assert.truthy(/const STREET_LAMP_DY_PX = 3;/.test(app), 'three screen pixels, by eye — it dropped to one when the base came up 2 into its cell, now nudged back down 2px');
  assert.falsy(/seat: true/.test(lampSpecSrc),
    'and it is NOT run through the seat pass: SpriteLayout has no trimmed bounds for a canvas bake, '
    + 'and the ground line the art was painted at is the same answer one step earlier');
});

test('street lamps: nothing here reaches the save — generated, never stored, like the traps', () => {
  // The whole feature's state is entry._streetLamps (geometry, tile-cached)
  // and scene._streetLamps (the lit subset, frame-cached) — neither is
  // save.* or JSON that survives a reload. What DOES survive is exactly what
  // it always was: save.streets, the restored intervals — a lamp is lit
  // purely as a function of those, recomputed every time. (The one thing a
  // lamp adds is the LIVING-LAMP delta, save.lampVisits — when the player
  // last came by, keyed by the lamp's position-derived id; living_lamps.test.js.)
  assert.falsy(/save\.streetLamps/.test(app), 'no save.streetLamps field exists');
  assert.falsy(/save\._streetLamps/.test(app), 'and the live lists are never written onto save at all');
});

// ── The passes themselves, RUN ────────────────────────────────────────────
// The two placement passes are lifted by run.js and driven here over a real
// tile entry: a synthetic 180 m street across the middle of one tile, the
// real Streets algebra, the real coords projection.
//
// This is the half the source-text pins above could not see. Until Sep 2026
// _streetLampsForTile wrote its empty answer onto a tile entry that had no
// `layers` yet — and a tile's entry is in WorldGen.tileCache from the moment
// its FETCH starts, while this pass runs every frame — so every tile in the
// world was measured for lamps while it was still loading and cached as
// "no lamps here" for the rest of the session. Nothing ever lit.
{
const P = __streetLampPasses;

const TX = 8000, TY = 8000;                 // far from any other test's tiles
const CELLS = 51, CELL_M_T = 7;
const TILE_EDGE_M = CELLS * CELL_M_T;       // 357 m
const EXTENT = 4096;
const MVT_TO_M = TILE_EDGE_M / EXTENT;
const toMvt = (m) => m / MVT_TO_M;
// A straight 180 m street across the middle of the tile: two lamps, at 45 m
// and 135 m along it (lampsAlong spreads round(180/100) = 2 evenly).
const mkFeature = () => ({
  id: 4242, type: 2, tags: { class: 'residential' },
  geom: [[{ x: toMvt(100), y: toMvt(178) }, { x: toMvt(280), y: toMvt(178) }]],
});
const mkLayers = () => [{ name: 'transportation', extent: EXTENT, features: [mkFeature()] }];
const readyEntry = () => ({ tileEdgeM: TILE_EDGE_M, cellsPerEdge: CELLS, layers: mkLayers() });
test('street lamps: future lamp reservations cover the exact rendered feet and their cell-edge overlap', () => {
  const entry = readyEntry();
  const lamps = RoadOverlay.lampSitesForTile(TX, TY, entry);
  const reserved = RoadOverlay.lampReservedCells(TX, TY, entry);
  assert.truthy(lamps.length > 0);
  for (const lamp of lamps) {
    const ix = Math.floor((lamp.x - TX * TILE_EDGE_M) / CELL_M_T);
    const iy = Math.floor((lamp.y - TY * TILE_EDGE_M) / CELL_M_T);
    assert.truthy(reserved.has(iy * CELLS + ix), 'every unlit future lamp owns its foot cell');
  }
  assert.eq(JSON.stringify(lamps), JSON.stringify(P._streetLampsForTile(TX, TY, entry)), 'live renderer uses the same exact coordinates and identities');
  assert.truthy(reserved.size > lamps.length, 'feet straddling a grid boundary also reserve the adjoining cell');
});

test('street lamps: rasterized road decorations cannot occupy future lamp footprints', () => {
  let props = 0, sites = 0;
  for (let sample = 0; sample < 12; sample++) {
    const layers = mkLayers();
    const road = layers[0].features[0];
    road.tags.class = 'minor';
    layers.push({name:'landuse', extent:EXTENT, features:[{type:3, tags:{class:'park'},
      geom:[[{x:0,y:0},{x:EXTENT,y:0},{x:EXTENT,y:EXTENT},{x:0,y:EXTENT}]]}]});
    layers.push({name:'transportation_name', extent:EXTENT, features:[
      {type:2, tags:{name:`Hedge Lane ${sample}`}, geom:road.geom}
    ]});
    const tile = WorldGen.rasterizeTile(layers, CELLS, TX, TY, TILE_EDGE_M);
    const reserved = RoadOverlay.lampReservedCells(TX, TY,
      {...tile, layers, tileEdgeM:TILE_EDGE_M, cellsPerEdge:CELLS});
    sites += reserved.size;
    const dress = tile.streetDress;
    for (const o of [...dress.objects, ...dress.wildplants, ...dress.coins, ...dress.treasures]) {
      props++;
      const ix = Math.floor((o.x - TX * TILE_EDGE_M) / CELL_M_T);
      const iy = Math.floor((o.y - TY * TILE_EDGE_M) / CELL_M_T);
      assert.falsy(reserved.has(iy * CELLS + ix), `${o.id} collides with a lamp site`);
    }
  }
  assert.truthy(sites > 0 && props > 0, 'fixture exercises actual lamps and variant decorations');
});

const loadingEntry = () => ({ tileEdgeM: TILE_EDGE_M, cellsPerEdge: CELLS });   // no layers yet

// The scene the passes read: the player standing in the middle of that tile,
// no peek. startWorldM = originPx x mPerPx is the shipping relation (app.js),
// which is what puts absCellCenterMeters in the same frame the lamp points
// are built in (tx * tileEdgeM + local metres).
const mPerPx = TILE_EDGE_M / WorldGen.TILE_PX;
const lampScene = (over) => Object.assign({
  depth: 0,
  cellM: CELL_M_T,
  cellsPerTile: CELLS,
  mPerPx,
  originPx: { x: TX * WorldGen.TILE_PX + 128, y: TY * WorldGen.TILE_PX + 128 },
  startWorldM: { x: (TX * WorldGen.TILE_PX + 128) * mPerPx, y: (TY * WorldGen.TILE_PX + 128) * mPerPx },
  playerM: { x: 0, y: 0 },
  peekM: { x: 0, y: 0 },
  save: {},
  _streetLampsForTile: P._streetLampsForTile,
  _updateStreetLamps: P._updateStreetLamps,
}, over || {});

const KEY = WorldGen.tileKey(TX, TY);
// The pass scans the anchor's 3x3, and a tile MISSING from the cache is a
// tile that may still land — so the ring has to be whole before an answer is
// worth memoising. The eight neighbours are streetless but ready.
const withTile = (entry, fn) => {
  const had = new Map();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const k = WorldGen.tileKey(TX + dx, TY + dy);
      had.set(k, WorldGen.tileCache.get(k));
      WorldGen.tileCache.set(k, (dx || dy) ? { tileEdgeM: TILE_EDGE_M, cellsPerEdge: CELLS, layers: [] } : entry);
    }
  }
  try { return fn(); } finally {
    for (const [k, v] of had) {
      if (v === undefined) WorldGen.tileCache.delete(k); else WorldGen.tileCache.set(k, v);
    }
  }
};
// The lineKey the restored metres are filed under — Streets' own, off the
// same feature object the pass reads.
const lineKeyOf = () => Streets.lineKey(mkFeature(), 0);
const restoreAround = (save, s, halfM) =>
  Streets.restore(save, KEY, lineKeyOf(), [[s - halfM, s + halfM]]);

test('street lamps: a ready tile stands one lamp per Streets.lampSpacingM() of street', () => {
  const entry = readyEntry();
  const lamps = P._streetLampsForTile.call({}, TX, TY, entry);
  assert.eq(lamps.length, 2, 'a 180 m way carries two lamps');
  assert.eq(lamps.map((L) => Math.round(L.s)).join(','), '45,135', 'spread evenly, a half interval in at each end');
  // In ABSOLUTE world metres: the tile's own origin plus the point BESIDE the
  // line — 145 m along a way that runs due east, and one verge offset off it.
  const offM = Streets.lampOffsetM(WorldGen.roadOverlayWidthM({ class: 'residential' }),
                                   STREET_LAMP_R_CELLS * CELL_M_T);
  assert.inRange(lamps[0].x - TX * TILE_EDGE_M, 144.9, 145.1, 'the first stone stands 145 m into the tile');
  assert.inRange(lamps[0].y - TY * TILE_EDGE_M, 178 - offM - 0.1, 178 - offM + 0.1,
    '…and a verge offset off the centreline, square to a way running due east');
});

test('street lamps: a lamp stands ON THE VERGE — its stone just touching the band, never in the traffic', () => {
  // Until Sep 2026 the point came straight off the centreline, so every lamp
  // stood in the middle of the road it lit. The seat is DERIVED (streets.js
  // lampOffsetM): half the way's own drawn width — WorldGen.roadOverlayWidthM,
  // the number road_overlay.js strokes the band with and rasterizeTile stamps
  // roadMask from — plus the stone's radius, so the art kisses the kerb.
  const lamps = P._streetLampsForTile.call({}, TX, TY, readyEntry());
  const halfBandM = WorldGen.roadOverlayWidthM({ class: 'residential' }) / 2;
  const footRM = STREET_LAMP_R_CELLS * CELL_M_T;
  for (const L of lamps) {
    // The way runs due east down y = 178, so the whole offset is in y.
    const off = Math.abs((L.y - TY * TILE_EDGE_M) - 178);
    assert.inRange(off, halfBandM + footRM - 1e-6, halfBandM + footRM + 1e-6,
      'half the carriageway plus the lamp\'s footprint — off the road, touching it');
    assert.truthy(off - footRM >= halfBandM - 1e-6, 'no part of the lamp overlaps the band');
    assert.truthy(off - footRM <= halfBandM + 1e-6, 'and it is not floating out in the grass');
  }
  // …and the offset is the WAY's own, not one number for every road: a
  // motorway's band is far wider, so its lamps stand further out.
  const wide = Streets.lampOffsetM(WorldGen.roadOverlayWidthM({ class: 'motorway' }), footRM);
  const narrow = Streets.lampOffsetM(WorldGen.roadOverlayWidthM({ class: 'footway' }), footRM);
  assert.truthy(wide > narrow, 'a motorway seats its lamps further off the centreline than a footway');
});

test('street lamps: the verge offset is derived from the art the draw pass uses', () => {
  // STREET_LAMP_R_CELLS is the widest of the two stones a lamp can wear —
  // the baked one inside its halo square and the dark cobble it draws before
  // it lights — so NEITHER art overlaps the band, whichever is showing.
  assert.truthy(/const STREET_LAMP_R_CELLS = Math\.max\(/.test(app), 'the widest of the arts, not a typed gap');
  assert.truthy(/RoadOverlay\.LAMP_FOOT_R_CELLS/.test(app), 'the baked lamp\'s own plinth, from the module that paints it');
  assert.truthy(/STREET_LAMP_DARK_CELLS\.road \/ 2/.test(app), 'and the dark cobble\'s, halved to a radius');
  assert.eq(RoadOverlay.LAMP_FOOT_R_CELLS, RoadOverlay.LAMP_DRAW_CELLS * 0.085,
    'road_overlay derives it from the square it bakes the lamp in');
  assert.truthy(STREET_LAMP_R_CELLS >= RoadOverlay.LAMP_FOOT_R_CELLS, 'the lit lamp\'s foot fits inside it');
  assert.truthy(STREET_LAMP_R_CELLS >= STREET_LAMP_DARK_CELLS.road / 2, 'and so does the dark cobble');
  // The placement pass asks streets.js for the offset and hands it to the one
  // point resolver — never a second projection of its own.
  assert.truthy(/Streets\.lampOffsetM\(WorldGen\.roadOverlayWidthM\(f\.tags \|\| \{\}\), footRM\)/.test(forTileSrc),
    'the offset is half the way\'s roadOverlayWidthM plus the lamp\'s footprint');
  assert.truthy(/Streets\.pointAtM\(line, mvtToM, sM, offM\)/.test(forTileSrc),
    'and the point comes out of the same resolver the centreline does');
});

test('street lamps: a tile still LOADING is never memoised as lampless — the bug that lit nothing', () => {
  // A tile entry enters WorldGen.tileCache the moment its fetch starts, with
  // no `layers` until the build lands seconds later, and this pass runs on
  // every frame — so it ALWAYS meets a tile in that state. Writing the empty
  // answer onto the entry (the entry IS the cache) froze it there for the
  // tile's whole life, and every tile in the world went through it.
  const entry = loadingEntry();
  assert.eq(P._streetLampsForTile.call({}, TX, TY, entry).length, 0, 'nothing to place yet');
  assert.falsy(entry._streetLamps, 'and the miss is NOT written onto the entry');
  entry.layers = mkLayers();                      // …the build lands
  assert.eq(P._streetLampsForTile.call({}, TX, TY, entry).length, 2, 'the lamps appear the moment the tile is ready');
  assert.truthy(entry._streetLamps, 'only the real answer is memoised');
});

const litOf = (scene) => scene._streetLamps.filter((L) => L.lit);

test('street lamps: a ready tile stamps each lamp with the way\'s tier', () => {
  const lamps = P._streetLampsForTile.call({}, TX, TY, readyEntry());
  assert.eq(lamps[0].tier, WorldGen.T.ROAD, 'a residential street is the small road tier — the frame its dark stone draws');
});

test('street lamps: a restored stretch lights ITS lamp and only its lamp — the rest stay on the list, DARK', () => {
  const entry = readyEntry();
  const scene = lampScene();
  const lamps = P._streetLampsForTile.call({}, TX, TY, entry);
  withTile(entry, () => {
    scene._updateStreetLamps();
    assert.eq(scene._streetLamps.length, 2, 'both stones of a dilapidated street are on the list — drawn as plain cobbles');
    assert.eq(litOf(scene).length, 0, 'and none of them is lit');
    // Restore 12 m either side of the SECOND lamp — one dwell's worth.
    restoreAround(scene.save, lamps[1].s, 12);
    scene._updateStreetLamps();
    assert.eq(scene._streetLamps.length, 2, 'the list still carries both stones');
    assert.eq(litOf(scene).length, 1, 'exactly the lamp inside the restored metres lights');
    assert.eq(litOf(scene)[0].id, lamps[1].id, 'and it is that one, not its neighbour');
    assert.truthy(scene._streetLamps.every((L) => L.tier === WorldGen.T.ROAD), 'each carries its tier for the dark frame');
    assert.falsy(entry._streetLamps.some((L) => 'lit' in L), 'the flag lives on the frame list, never on the tile\'s cached geometry');
  });
});

test('street lamps: a lamp restored in an earlier session lights without the player taking a step', () => {
  // The frame memo is the same rule one level up: keyed on the anchor cell
  // and Streets.epoch, neither of which moves while the player stands still
  // watching the ring land. Stamping it over a still-loading ring would hold
  // "no lamps" until they happened to walk onto another cell — which on a
  // reload is every lamp they have ever earned.
  const entry = loadingEntry();
  const save = {};
  restoreAround(save, 135, 12);                   // banked before this session
  const scene = lampScene({ save });
  withTile(entry, () => {
    scene._updateStreetLamps();
    assert.eq(scene._streetLamps.length, 0, 'nothing to light while the tile is still loading');
    assert.eq(scene._streetLampKey, null, 'and the provisional answer is not memoised');
    entry.layers = mkLayers();                    // the tile lands; the player has not moved
    scene._updateStreetLamps();
    assert.eq(litOf(scene).length, 1, 'the lamp lights on the very next frame');
    assert.truthy(scene._streetLampKey, 'and NOW the answer is worth memoising');
  });
});

test('street lamps: a ready ring memoises, so standing still costs nothing', () => {
  const entry = readyEntry();
  const scene = lampScene();
  restoreAround(scene.save, 135, 12);
  withTile(entry, () => {
    scene._updateStreetLamps();
    const first = scene._streetLamps;
    assert.eq(first.filter((L) => L.lit).length, 1, 'the lamp is lit');
    scene._updateStreetLamps();
    assert.truthy(scene._streetLamps === first, 'the second frame reuses the same list');
  });
});

test('street lamps: a FAR ring tile still loading does not hold the memo open', () => {
  // The ring streams in for seconds after the centre; waiting on all eight
  // rebuilt this list every frame meanwhile. A tile that cannot hold a lamp
  // within the pass's pad (coords.js tileBoxReach) changes nothing when it
  // lands, so the answer is final without it.
  const entry = readyEntry();
  const scene = lampScene();
  restoreAround(scene.save, 135, 12);
  withTile(entry, () => {
    const k = WorldGen.tileKey(TX + 1, TY + 1);
    WorldGen.tileCache.set(k, loadingEntry());
    scene._updateStreetLamps();
    assert.eq(litOf(scene).length, 1, 'the centre tile\'s lamp lights');
    assert.truthy(scene._streetLampKey, 'and the answer is memoised though a far corner tile is still loading');
    const first = scene._streetLamps;
    scene._updateStreetLamps();
    assert.truthy(scene._streetLamps === first, 'the next frame reuses it');
  });
});

test('street lamps: a cave clears the list — surface only', () => {
  const scene = lampScene({ depth: 2 });
  scene._streetLamps = [{}]; scene._streetLampKey = 'stale';
  scene._updateStreetLamps();
  assert.eq(scene._streetLamps, null, 'no lamps underground');
  assert.eq(scene._streetLampKey, null, 'and no memo to come back to on the surface');
});

// ── THE GLOW: one colour per lamp, both halves read it ────────────────────
// A lamp sheds its STREET's colour: StreetVariants.lampGlowFor(rec) off the
// street-index record of its (feature, line), resolved ONCE onto the lamp
// entry's `glow` — null there means the plain UI_LAMP_GLOW. The baked art
// (streetLampTexKey → _ensureStreetLampTex → RoadOverlay.paintLamp) and the
// light (Lighting.collectLamps → the entry's colour) both read that one field.
const withIndex = (lines) => {
  const entry = readyEntry();
  // Real index records retain the source geometry for compact theme ranges.
  entry.streetIndex = { lines: lines.map(rec => ({
    ...rec, line: entry.layers[0].features[rec.fi]?.geom[rec.li],
  })) };
  return entry;
};
const themedVariant = () => StreetVariants.STREET_VARIANTS.find((v) => v.lampGlow && v.id !== 'lantern');

test('street lamps: each lamp carries its street\'s glow — StreetVariants.lampGlowFor(its line\'s rec), default UI_LAMP_GLOW', () => {
  // Not in the index at all: the plain violet.
  const plain = P._streetLampsForTile.call({}, TX, TY, readyEntry());
  assert.truthy(plain.length > 0 && plain.every((L) => L.glow === UI_LAMP_GLOW), 'a street off the index keeps UI_LAMP_GLOW');
  // A plain minor street IN the index: lampGlowFor says null → the default.
  const minorRec = { fi: 0, li: 0, size: 'minor', variant: null };
  const minor = P._streetLampsForTile.call({}, TX, TY, withIndex([minorRec]));
  assert.eq(minor[0].glow, StreetVariants.lampGlowFor(minorRec) || UI_LAMP_GLOW, 'a plain minor street: the default');
  // A themed street: its row's colour, read through lampGlowFor, never retyped.
  const v = themedVariant();
  assert.truthy(v, 'some variant row carries a lampGlow');
  const themedRec = { fi: 0, li: 0, size: v.size, variant: v.id };
  const themed = P._streetLampsForTile.call({}, TX, TY, withIndex([themedRec]));
  assert.eq(themed[0].glow, StreetVariants.lampGlowFor(themedRec), 'a themed street: its variant\'s glow');
  assert.truthy(themed.every((L) => L.glow === themed[0].glow), 'every lamp on the line the same');
  // An unthemed MAJOR road: whatever lampGlowFor says (the bandit torch).
  const majorRec = { fi: 0, li: 0, size: 'major', variant: null };
  const major = P._streetLampsForTile.call({}, TX, TY, withIndex([majorRec]));
  assert.eq(major[0].glow, StreetVariants.lampGlowFor(majorRec) || UI_LAMP_GLOW, 'an unthemed major road');
  // A record for a DIFFERENT line does not colour this one.
  const other = P._streetLampsForTile.call({}, TX, TY, withIndex([{ fi: 0, li: 1, size: v.size, variant: v.id }]));
  assert.eq(other[0].glow, UI_LAMP_GLOW, 'keyed by fi:li — another line\'s theme stays on that line');
  // …and the frame list carries it through untouched.
  assert.truthy(/out\.push\(\{ \.\.\.L, lit:/.test(updateSrc), 'the frame list spreads the tile lamp, glow and all');
});

test('street lamps: density and glow stop at the same compact theme intervals', () => {
  const rec = { fi:0,li:0,size:'major',variant:'lantern',
    variantRanges:[[60 / MVT_TO_M,120 / MVT_TO_M]] };
  const lamps = P._streetLampsForTile.call({},TX,TY,withIndex([rec]));
  const themed=lamps.filter(l=>l.s>=60 && l.s<=120), plain=lamps.filter(l=>l.s<60 || l.s>120);
  assert.gt(themed.length,0,'the compact lantern stretch has lamps');
  assert.gt(plain.length,0,'the plain road remains represented');
  assert.truthy(themed.every(l=>l.glow === StreetVariants.VARIANT_BY_ID.lantern.lampGlow));
  assert.truthy(plain.every(l=>l.glow === StreetVariants.BANDIT_STORY.lampGlow));
  assert.lt(themed[0].spacingM,plain[0].spacingM,'only the themed interval has dense lamps');
});

test('street lamps: the ART and the LIGHT read the one glow', () => {
  // The light: collectLamps colours the entry by the lamp's glow; the default
  // leaves the row's own colour (and cookie) alone.
  const v = themedVariant();
  const themed = P._streetLampsForTile.call({}, TX, TY, withIndex([{ fi: 0, li: 0, size: v.size, variant: v.id }]));
  const plain = P._streetLampsForTile.call({}, TX, TY, readyEntry());
  const ls = { depth: 0, cellM: CELL_M_T, _lights: [], _streetLamps: [
    { ...themed[0], lit: true, x: 0, y: 0, id: 't' }, { ...plain[0], lit: true, x: 1, y: 0, id: 'p' }] };
  Lighting.collectLamps(ls, 0, 0, 1000);
  const byId = {}; for (const L of ls._lights) byId[L.id] = L;
  assert.eq(byId.t.colour, parseInt(themed[0].glow.slice(1), 16), 'a themed lamp throws its glow');
  assert.eq(byId.p.colour, undefined, 'a plain lamp keeps the cobble row\'s colour — UI_LAMP_GLOW');
  assert.eq(Lighting.KINDS.cobble.colour, parseInt(UI_LAMP_GLOW.slice(1), 16), 'which is the default glow');
  // The art: the render row keys a lit lamp's texture by the same field.
  assert.truthy(/glow: L\.glow/.test(lampListSrc), 'the draw list carries the lamp\'s glow');
  assert.truthy(/streetLampTexKey\(o\.glow\)/.test(lampSpecSrc), 'and the sprite picks the bake for it');
});

test('street lamps: the baked art is cached PER COLOUR — the default keeps the old key', () => {
  // Lift the key scheme and the bake, and run them over a fake texture store.
  const STREET_LAMP_TEX_NAME = app.match(/const STREET_LAMP_TEX = '([^']+)';/)[1];
  const keySrc = app.slice(app.indexOf('function streetLampTexKey(glow) {'));
  const keyFn = keySrc.slice(0, keySrc.indexOf('\n}\n') + 2);
  const ensSrc = app.slice(app.indexOf('  _ensureStreetLampTex(glow) {'), app.indexOf('  // Every lamp of ONE tile'));
  const painted = [];
  const fakeRO = { LAMP_TEX_PX: 8, paintLamp: (cx, S, g) => painted.push(g) };
  const fakeDoc = { createElement: () => ({ getContext: () => ({}) }) };
  const mk = new Function('RoadOverlay', 'document', 'STREET_LAMP_TEX', 'UI_LAMP_GLOW',
    `${keyFn}\nreturn { streetLampTexKey, host: { ${ensSrc.trimEnd()} } };`);
  const { streetLampTexKey, host } = mk(fakeRO, fakeDoc, STREET_LAMP_TEX_NAME, UI_LAMP_GLOW);
  const store = new Map();
  host.textures = { exists: (k) => store.has(k), addCanvas: (k, c) => store.set(k, c) };
  assert.eq(streetLampTexKey(UI_LAMP_GLOW), STREET_LAMP_TEX_NAME, 'the default glow is the plain key, as before');
  assert.eq(streetLampTexKey(null), STREET_LAMP_TEX_NAME, 'and so is no glow');
  assert.eq(streetLampTexKey(UI_LAMP_GLOW.toUpperCase()), STREET_LAMP_TEX_NAME, 'case does not split a colour');
  assert.eq(streetLampTexKey('#FF8C2A'), streetLampTexKey('#ff8c2a'), 'one key per colour');
  assert.truthy(streetLampTexKey('#ff8c2a') !== STREET_LAMP_TEX_NAME, 'a themed glow gets its own key');
  // Forty lamps in two colours plus the default: three bakes.
  const glows = [];
  for (let i = 0; i < 40; i++) glows.push(i % 3 === 0 ? '#ff8c2a' : i % 3 === 1 ? '#4fd8c4' : UI_LAMP_GLOW);
  const keys = glows.map((g) => host._ensureStreetLampTex(g));
  assert.eq(painted.length, 3, 'one bake per distinct colour, not per lamp');
  assert.eq(store.size, 3);
  assert.eq(painted.sort().join(','), ['#4fd8c4', '#ff8c2a', UI_LAMP_GLOW].sort().join(','), 'each baked in its own glow');
  assert.eq(keys[0], streetLampTexKey('#ff8c2a'), 'and the key handed back is the one the sprite asks for');
});

test('street lamps: the frame pass bakes each LIT glow before the sprite pass draws it', () => {
  const v = themedVariant();
  const entry = withIndex([{ fi: 0, li: 0, size: v.size, variant: v.id }]);
  const baked = [];
  const scene = lampScene({ _ensureStreetLampTex: (g) => baked.push(g) });
  const lamps = P._streetLampsForTile.call({}, TX, TY, entry);
  withTile(entry, () => {
    scene._updateStreetLamps();
    assert.eq(baked.length, 0, 'no lamp lit, nothing to bake');
    restoreAround(scene.save, lamps[0].s, 12);
    restoreAround(scene.save, lamps[1].s, 12);
    scene._updateStreetLamps();
    assert.eq(litOf(scene).length, 2, 'both lamps lit');
    assert.eq(baked.join(','), StreetVariants.lampGlowFor({ size: v.size, variant: v.id }),
      'their one colour baked once');
  });
});

test('street lamps: scenic density follows the distance reward table', () => {
  const base = Streets.lampLayFor({ class: 'path' }).spacingM;
  for (const [kind, variant] of Object.entries(Scenic.KIND_ROW)) {
    assert.eq(StreetVariants.lampSpacingFor(variant, base), base / Scenic.SCENIC_MUL[kind]);
  }
  const original = Scenic.SCENIC_MUL.park;
  try {
    Scenic.SCENIC_MUL.park = 2.5;
    assert.eq(StreetVariants.lampSpacingFor(Scenic.KIND_ROW.park, base), base / 2.5,
      'changing distance rewards changes lantern density without another tuning value');
  } finally { Scenic.SCENIC_MUL.park = original; }
  assert.eq(StreetVariants.lampSpacingFor(null, base), base, 'ordinary paths keep their density');
  assert.eq(StreetVariants.lampSpacingFor('lantern', 100), 100 / StreetVariants.LANTERN_SPACING_DIV,
    'the authored Lantern Row still works');
});

test('street lamps: scenic segments share palette and lamp density without changing plain stretches', () => {
  const entry = readyEntry(), f = entry.layers[0].features[0];
  f.tags.class = 'path';
  entry.scenic = { lines: new Map([[Streets.lineKey(f, 0), [
    [0, toMvt(60), 'park'], [toMvt(60), toMvt(120), 'shore'],
  ]]]) };
  const lamps = P._streetLampsForTile.call({}, TX, TY, entry);
  assert.eq(lamps.filter((l) => l.s < 60).length, 2, 'park density reflects its scenic bonus, rounded to whole lamps');
  assert.eq(lamps.filter((l) => l.s >= 60 && l.s < 120).length, 2, 'promenade reflects its double distance bonus');
  assert.eq(lamps.filter((l) => l.s >= 120).length, 1, 'plain remainder keeps normal density');
  assert.eq(lamps.find((l) => l.s > 60 && l.s < 120).glow, StreetVariants.VARIANT_BY_ID.promenade.lampGlow, 'golden promenade lamps');
  const styles = StreetVariants.lineStyles(entry, f, 0, 0, MVT_TO_M);
  assert.eq(styles.map((r) => r.variant).join(','), 'parkpath,promenade,');
});

}
})();
