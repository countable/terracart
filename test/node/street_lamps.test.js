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
                              app.indexOf('  // The LIT lamps near the frame'));
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
})();
