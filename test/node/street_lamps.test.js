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
// the wiring is pinned as SOURCE TEXT against APP_JS_SRC, with the one
// self-contained arithmetic expression (STREET_LAMP_PX) lifted out and run.

(function () {
const app = APP_JS_SRC;

// The three passes, as source, in the order drawRoadGeometry calls them.
const forTileSrc = app.slice(app.indexOf('  _streetLampsForTile(tx, ty, entry) {'),
                              app.indexOf('  // The lamps near the frame'));
const updateSrc = app.slice(app.indexOf('  _updateStreetLamps() {'),
                             app.indexOf('  // The stones themselves:'));
const drawSrc = app.slice(app.indexOf('  _drawStreetLamps() {'),
                           app.indexOf('  // THE RIPEN PASS.'));

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
  assert.truthy(/const key = `\$\{cellIX\},\$\{cellIY\}\|\$\{Streets\.epoch\(this\.save\)\}`;/.test(updateSrc),
    'the key is the anchor cell plus Streets.epoch — nothing else');
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

test('street lamps: the stones are seated through worldMetersToScreen, never viewCenterX/Y, into cobbleContainer', () => {
  assert.truthy(/const p = this\.worldMetersToScreen\(L\.x, L\.y\);/.test(drawSrc),
    'the camera-anchored projection — a peek carries the stones with the ground');
  assert.falsy(/viewCenterX|viewCenterY/.test(drawSrc), 'never drawn at the viewport centre');
  assert.truthy(/Render\.renderPool\(this, pool, this\.cobbleContainer, list,/.test(drawSrc),
    'pooled sprites go into cobbleContainer — the road-surface layer, under the lightmap');
});

test('street lamps: an UNLIT lamp draws as the OLD ROAD COBBLE sprite, a lit one as the baked lamp', () => {
  // A lamp stands on every LAMP_SPACING_M of street whether or not that
  // stretch is restored; the dark ones have to be visible or the lamps would
  // seem to appear from nowhere. They wear the sheet the per-cell road stones
  // drew from until Sep 2026 — Road copiar.png, back in assets.js as 'cobble'
  // for this one job — at the frame that sheet used for the way's tier.
  assert.truthy(/const STREET_LAMP_DARK_TEX = 'cobble';/.test(app), 'the dark stone is the cobble sheet');
  assert.truthy(/cobble:\s*\{ kind: 'spritesheet', path: 'assets\/Objects\/Road copiar\.png',\s*frameWidth: 16, frameHeight: 16 \}/.test(ASSETS_SRC),
    'assets.js loads Road copiar.png as the cobble sheet again');
  // The old frame table, per tier: ROAD_LG 0 (densest cluster), ROAD_MD 5,
  // ROAD 1 (small cluster), PATH 3 (a single pebble) — and keyed by the
  // WorldGen.T NAME, so the code is looked up live rather than retyped.
  const m = app.match(/const STREET_LAMP_DARK_FRAME = \{ ROAD_LG: (\d+), ROAD_MD: (\d+), ROAD: (\d+), PATH: (\d+) \};/);
  assert.truthy(m, 'one frame per road tier');
  assert.eq(m.slice(1).map(Number).join(','), '0,5,1,3', 'the frames the per-cell stones drew');
  // A 5x4 sheet of 16px frames: every frame the table names is on it.
  for (const f of m.slice(1).map(Number)) assert.truthy(f >= 0 && f < 20, `frame ${f} is on the 80x64 sheet`);
  // The draw pass branches on the one `lit` flag: the baked lamp at its halo
  // size for a lit one, the cobble frame at the old stones' size and alpha
  // for a dark one — never the violet stone for both.
  assert.truthy(/if \(L\.lit\) \{/.test(drawSrc), 'the draw branches on L.lit');
  assert.truthy(/s\.setTexture\(STREET_LAMP_TEX\)/.test(drawSrc), 'a lit lamp is the baked stone');
  assert.truthy(/s\.setTexture\(STREET_LAMP_DARK_TEX, frame\)/.test(drawSrc), 'a dark lamp is the cobble sheet at its tier frame');
  assert.truthy(/const frame = streetLampDarkFrame\(L\.tier\);/.test(drawSrc), 'the frame comes from the lamp\'s own tier');
  assert.truthy(/setAlpha\(STREET_LAMP_DARK_ALPHA\)/.test(drawSrc), 'at the old stones\' alpha');
  assert.truthy(/const STREET_LAMP_DARK_ALPHA = 0\.57;/.test(app), 'the 57% the per-cell cobbles drew at');
  assert.truthy(/const STREET_LAMP_DARK_CELLS = \{ road: 0\.64, path: 0\.584 \};/.test(app), 'and their sizes: a road cluster at 0.64 of a cell, a path pebble at 0.584');
  // The tier is the terrain classifier's own answer, not a second class list.
  assert.truthy(/WorldGen\.classifyLine\('transportation', f\.tags \|\| \{\}\)/.test(forTileSrc),
    '_streetLampsForTile classifies the way with WorldGen.classifyLine');
  assert.eq(typeof WorldGen.classifyLine, 'function', 'which worldgen.js exports');
  // And the frame resolver, run: each T code lands on its frame, and a
  // non-road (null) falls back to the small road cluster.
  const resolve = new Function('WorldGen', app.slice(app.indexOf('const STREET_LAMP_DARK_FRAME ='), app.indexOf('// The old stones\' draw size')) + 'return streetLampDarkFrame;')(WorldGen);
  const T = WorldGen.T;
  assert.eq(resolve(T.ROAD_LG), 0); assert.eq(resolve(T.ROAD_MD), 5);
  assert.eq(resolve(T.ROAD), 1); assert.eq(resolve(T.PATH), 3);
  assert.eq(resolve(null), 1, 'an unclassified way draws the small cluster');
});

test('street lamps: the light collector reads the same list and skips the dark ones — one list, one flag, both readers', () => {
  // _updateStreetLamps keeps every lamp near the anchor and flags each `lit`
  // by Streets.covers over the restored intervals; the draw pass and
  // Lighting.collectLamps both read that flag, so a stone can never be drawn
  // lit while throwing no light, or the reverse.
  assert.truthy(/out\.push\(\{ \.\.\.L, lit: Streets\.covers\(iv, L\.s\) \}\);/.test(updateSrc),
    'the flag is Streets.covers over the line\'s restored list, on a fresh object (never written onto the tile cache)');
  assert.falsy(/if \(!Streets\.covers\(iv, L\.s\)\) continue;/.test(updateSrc), 'a dark lamp is no longer dropped from the list');
  assert.truthy(/if \(!L\.lit\) continue;/.test(LIGHTING_SRC), 'collectLamps skips a dark lamp');
});

test('street lamps: drawRoadGeometry runs the three passes in the order the frame needs them', () => {
  const body = app.slice(app.indexOf('  drawRoadGeometry() {'), app.indexOf('  drawBuildingGeometry() {'));
  const iLive = body.indexOf('this._drawStreetLive();');
  const iUpdate = body.indexOf('this._updateStreetLamps();');
  const iDraw = body.indexOf('this._drawStreetLamps();');
  assert.truthy(iLive > 0 && iUpdate > iLive && iDraw > iUpdate,
    'RoadOverlay.draw, then the live preview, then which lamps are lit, then the stones themselves');
});

test('street lamps: STREET_LAMP_PX is derived from RoadOverlay.LAMP_DRAW_CELLS x CELL_PX, not a hand-typed pixel count', () => {
  // Lift the literal declaration rather than retyping the number: a retune
  // of LAMP_DRAW_CELLS in road_overlay.js has to move this test with it.
  const m = app.match(/const STREET_LAMP_PX = CELL_PX \*\s*\n?\s*\(\(typeof RoadOverlay !== 'undefined' && RoadOverlay\.LAMP_DRAW_CELLS\) \|\| ([\d.]+)\);/);
  assert.truthy(m, 'STREET_LAMP_PX reads RoadOverlay.LAMP_DRAW_CELLS, with a literal fallback only for load order');
  // RoadOverlay IS loaded in this suite, so the real expression the game
  // computes is CELL_PX * RoadOverlay.LAMP_DRAW_CELLS — evaluate exactly
  // that, with both operands as the real, live values (not retyped copies).
  const expected = CELL_PX * RoadOverlay.LAMP_DRAW_CELLS;
  assert.gt(expected, 0, 'a real, positive size in pixels');
  // And the fallback literal in app.js agrees with RoadOverlay's own number —
  // if RoadOverlay ever failed to load, app.js would still draw the lamp at
  // the size RoadOverlay actually wants it.
  assert.eq(Number(m[1]), RoadOverlay.LAMP_DRAW_CELLS, 'the load-order fallback matches RoadOverlay.LAMP_DRAW_CELLS');
});

test('street lamps: the texture is baked once with RoadOverlay.paintLampStone, keyed off the module\'s own LAMP_TEX_PX', () => {
  assert.truthy(/RoadOverlay\.paintLampStone\(lctx, S\)/.test(app), 'the real painter draws the baked texture');
  assert.truthy(/const S = RoadOverlay\.LAMP_TEX_PX;/.test(app), 'sized off road_overlay.js\'s own texture constant');
  assert.truthy(/!this\.textures\.exists\(STREET_LAMP_TEX\)/.test(app), 'baked once, not re-painted every boot');
});

test('street lamps: nothing here reaches the save — generated, never stored, like the traps', () => {
  // The whole feature's state is entry._streetLamps (geometry, tile-cached)
  // and scene._streetLamps (the lit subset, frame-cached) — neither is
  // save.* or JSON that survives a reload. What DOES survive is exactly what
  // it always was: save.streets, the restored intervals — a lamp is lit
  // purely as a function of those, recomputed every time.
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
  const stoneRM = STREET_LAMP_R_CELLS * CELL_M_T;
  for (const L of lamps) {
    // The way runs due east down y = 178, so the whole offset is in y.
    const off = Math.abs((L.y - TY * TILE_EDGE_M) - 178);
    assert.inRange(off, halfBandM + stoneRM - 1e-6, halfBandM + stoneRM + 1e-6,
      'half the carriageway plus the stone — off the road, touching it');
    assert.truthy(off - stoneRM >= halfBandM - 1e-6, 'no part of the stone overlaps the band');
    assert.truthy(off - stoneRM <= halfBandM + 1e-6, 'and it is not floating out in the grass');
  }
  // …and the offset is the WAY's own, not one number for every road: a
  // motorway's band is far wider, so its lamps stand further out.
  const wide = Streets.lampOffsetM(WorldGen.roadOverlayWidthM({ class: 'motorway' }), stoneRM);
  const narrow = Streets.lampOffsetM(WorldGen.roadOverlayWidthM({ class: 'footway' }), stoneRM);
  assert.truthy(wide > narrow, 'a motorway seats its lamps further off the centreline than a footway');
});

test('street lamps: the verge offset is derived from the art the draw pass uses', () => {
  // STREET_LAMP_R_CELLS is the widest of the two stones a lamp can wear —
  // the baked one inside its halo square and the dark cobble it draws before
  // it lights — so NEITHER art overlaps the band, whichever is showing.
  assert.truthy(/const STREET_LAMP_R_CELLS = Math\.max\(/.test(app), 'the widest of the arts, not a typed gap');
  assert.truthy(/RoadOverlay\.LAMP_STONE_R_CELLS/.test(app), 'the baked stone\'s own radius, from the module that paints it');
  assert.truthy(/STREET_LAMP_DARK_CELLS\.road \/ 2/.test(app), 'and the dark cobble\'s, halved to a radius');
  assert.eq(RoadOverlay.LAMP_STONE_R_CELLS, RoadOverlay.LAMP_DRAW_CELLS * 0.16,
    'road_overlay derives it from the square it bakes the stone in');
  assert.truthy(STREET_LAMP_R_CELLS >= RoadOverlay.LAMP_STONE_R_CELLS, 'the lit stone fits inside it');
  assert.truthy(STREET_LAMP_R_CELLS >= STREET_LAMP_DARK_CELLS.road / 2, 'and so does the dark cobble');
  // The placement pass asks streets.js for the offset and hands it to the one
  // point resolver — never a second projection of its own.
  assert.truthy(/Streets\.lampOffsetM\(WorldGen\.roadOverlayWidthM\(f\.tags \|\| \{\}\), stoneRM\)/.test(forTileSrc),
    'the offset is half the way\'s roadOverlayWidthM plus the stone');
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

test('street lamps: a cave clears the list — surface only', () => {
  const scene = lampScene({ depth: 2 });
  scene._streetLamps = [{}]; scene._streetLampKey = 'stale';
  scene._updateStreetLamps();
  assert.eq(scene._streetLamps, null, 'no lamps underground');
  assert.eq(scene._streetLampKey, null, 'and no memo to come back to on the surface');
});
}
})();
