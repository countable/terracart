// Headless tests for src/road_overlay.js — the muted-brown band that draws
// the ORIGINAL OSM road linework (decoded MVT `transportation` lines) over the
// rasterized map.
//
// Nothing here needs Phaser: the module only reads scene fields, WorldGen's
// tile cache, and strokes into a Graphics-shaped object, so a recording stub
// pins the projection, the culling, the on/off gate, and the redraw cache.
//
// RoadOverlay + WorldGen are injected by run.js.

// CELL_PX lives in app.js, which isn't in the headless bundle. 32 is its real
// value (VIEW_CELLS × CELL_PX = 352 = the canvas width in index.html).
if (typeof CELL_PX === 'undefined') globalThis.CELL_PX = 32;

// ── Stubs ─────────────────────────────────────────────────────────────────
// Records what the overlay strokes: one entry per path, carrying the lineStyle
// in force when it was stroked. `lines` flattens those paths back into
// segments so the geometry assertions stay readable.
function makeGfx() {
  return {
    paths: [], cleared: 0, style: null, _cur: null,
    clear() { this.paths.length = 0; this.erased.length = 0; this.cleared++; },
    lineStyle(w, c, a) { this.style = { w, c, a }; },
    beginPath() { this._cur = { style: this.style, pts: [] }; },
    moveTo(x, y) { this._cur.pts.push({ x, y }); },
    lineTo(x, y) { this._cur.pts.push({ x, y }); },
    strokePath() { this.paths.push(this._cur); this._cur = null; },
    phase: null,
    texturePhase(x, y) { this.phase = { x, y }; },
    erased: [],
    eraseRect(x, y, w, h) { this.erased.push({ x, y, w, h }); },
    get lines() {
      const segs = [];
      for (const p of this.paths)
        for (let i = 1; i < p.pts.length; i++)
          segs.push([p.pts[i-1].x, p.pts[i-1].y, p.pts[i].x, p.pts[i].y]);
      return segs;
    },
  };
}
function makeContainer() {
  return {
    visible: true, x: 0, y: 0,
    setVisible(v) { this.visible = v; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
  };
}

// Scene fixture with round numbers: mPerPx = 10 so tileEdgeM = 2560, and
// cellsPerTile = 512 → one cell is 5 m and 0.5 world px. (The game's real cell
// is WorldGen.CELL_M = 7 m; 5 makes the projection arithmetic checkable by
// hand, and every assertion below is expressed against the fixture's cellM.)
// The player sits exactly on tile (0,0)'s NW corner, so world metres map
// straight onto screen pixels: sx = viewCenterX + (wm / 5) * 32.
const TILE_EDGE_M = 2560;
function makeOverlayScene(over) {
  const base = {
    startWorldM: { x: 0, y: 0 },
    playerM: { x: 0, y: 0 },
    mPerPx: 10,
    originPx: { x: 0, y: 0 },
    cellM: 5,
    cellsPerTile: 512,
    depth: 0,
    save: {},
    viewCenterX: 176, viewCenterY: 176,
    viewLeft: 0, viewTop: 0, viewSize: 352,
    roadGeomGfx: makeGfx(),
    roadGeomContainer: makeContainer(),
    playerToWorldCell() {
      const tilePx = WorldGen.TILE_PX;
      const wx = this.originPx.x + this.playerM.x / this.mPerPx;
      const wy = this.originPx.y + this.playerM.y / this.mPerPx;
      const tx = Math.floor(wx / tilePx), ty = Math.floor(wy / tilePx);
      const cellPxSize = tilePx / this.cellsPerTile;
      return { tx, ty, cx: (wx - tx * tilePx) / cellPxSize, cy: (wy - ty * tilePx) / cellPxSize };
    },
  };
  return Object.assign(base, over);
}

// One decoded-MVT-shaped tile entry. `pts` are MVT integer coords (extent
// 4096 across the tile edge); a 4096-unit tile spans TILE_EDGE_M metres.
function putTile(tx, ty, features, grid) {
  const entry = {
    tileEdgeM: TILE_EDGE_M,
    layers: [
      { name: 'water', extent: 4096, features: [] },
      { name: 'transportation', extent: 4096, features },
    ],
  };
  // `grid` (optional) is the rasterized terrain the keep-out pass reads. Pass
  // a { "ix_iy": type } map; anything unlisted is grass (0).
  if (grid) {
    const N = 512;
    const g = new Uint8Array(N * N);
    for (const k of Object.keys(grid)) {
      const [ix, iy] = k.split('_').map(Number);
      g[iy * N + ix] = grid[k];
    }
    entry.grid = g;
  }
  WorldGen.tileCache.set(`${WorldGen.Z}/${tx}/${ty}`, entry);
  return entry;
}
function clearTiles() { WorldGen.tileCache.clear(); }
const line = (pts, tags) => ({ type: 2, tags: tags || {}, geom: [pts] });

// MVT unit → metres for these fixtures (2560 m / 4096 units = 0.625 m).
const M = TILE_EDGE_M / 4096;

// ── Projection ────────────────────────────────────────────────────────────

test('road overlay: an MVT line projects to screen at the map scale', () => {
  clearTiles();
  // A 3-vertex way starting at the tile origin, running east then south.
  putTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }])]);
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  const g = scene.roadGeomGfx;
  assert.eq(g.lines.length, 2, 'two segments stroked');
  // 16 MVT units = 10 m = 2 cells = 64 px east of the player (screen centre).
  assert.eq(g.lines[0][0], 176, 'seg0 x1');
  assert.eq(g.lines[0][1], 176, 'seg0 y1');
  assert.eq(g.lines[0][2], 240, 'seg0 x2');
  assert.eq(g.lines[0][3], 176, 'seg0 y2');
  assert.eq(g.lines[1][2], 240, 'seg1 x2');
  assert.eq(g.lines[1][3], 240, 'seg1 y2');
});

test('road overlay: strokes muted, desaturated earth brown at 61% opacity', () => {
  clearTiles();
  // No class tag → not a path, not rail → falls to the vehicle-road colour.
  putTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }])]);
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  const style = scene.roadGeomGfx.paths[0].style;
  assert.eq(style.c, 0x3a322c, 'colour is the desaturated, darkened road earth');
  assert.eq(style.a, 0.61, 'alpha is 61%');
  // Desaturated, not merely darkened: the colour keeps its brightness but its
  // channels sit closer together than a saturated brown's would.
  const r = 0x3a, g = 0x32, b = 0x2c;
  assert.lt((r - b) / (r + b), 0.28, 'low chroma for its lightness');
});

test('road overlay: a footpath strokes lighter than a vehicle road', () => {
  clearTiles();
  putTile(0, 0, [
    line([{ x: 0, y: 0 }, { x: 16, y: 0 }], { class: 'footway' }),
    line([{ x: 0, y: 8 }, { x: 16, y: 8 }], { class: 'residential' }),
  ]);
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  const byColour = {};
  for (const p of scene.roadGeomGfx.paths) byColour[p.style.c] = (byColour[p.style.c] || 0) + 1;
  assert.eq(byColour[0x5c4b3f], 1, 'the footway keeps the lighter path earth');
  assert.eq(byColour[0x3a322c], 1, 'the residential street is the darker road earth');
  // The road colour must actually be darker (and less saturated) than the
  // path colour, not just a different hue — that's the whole point of the
  // split (spec: paved streets read as a harder surface than a dirt path).
  const pathL = (0x5c + 0x4b + 0x3f) / 3, roadL = (0x3a + 0x32 + 0x2c) / 3;
  assert.lt(roadL, pathL, 'road earth is darker than path earth');
});

// ── Width by class ────────────────────────────────────────────────────────
// The stroke is the class's real-world width at the map's scale: with the
// fixture's 5 m / 32 px cell a metre is 6.4 px.
// Computed the way the module computes it — (m / cellM) * CELL_PX — so the
// assertions aren't chasing float-association noise.
const px = (m) => (m / 5) * 32;
const widthOfWay = (tags) => {
  clearTiles();
  putTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }], tags)]);
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  return scene.roadGeomGfx.paths[0].style.w;
};

test('road overlay: a residential street is stroked at its real 5.5 m width', () => {
  // 5.5 m: the table was 5 until Sep 2026, when the band was measured ~10%
  // narrower than the street underfoot (see roadWidthM in worldgen.js).
  assert.eq(widthOfWay({ class: 'street' }), px(5.5), 'street');
  assert.eq(widthOfWay({ class: 'minor' }), px(5.5), 'minor');
  // Which is a little under the one cell the rasterizer paints for it — the
  // game's cell is 7 m, so a residential street doesn't fill its own band.
  assert.lt(5.5, WorldGen.CELL_M, 'a street is narrower than a game cell');
});

test('road overlay: bigger classes are drawn wider, in real-world proportion', () => {
  // The large tier carries a ×1.5 emphasis on top of its measured width (see
  // the next test); the mid classes are drawn at their true width.
  assert.eq(widthOfWay({ class: 'motorway' }),  px(12 * 1.5), 'motorway');
  assert.eq(widthOfWay({ class: 'trunk' }),     px(12 * 1.5), 'trunk');
  assert.eq(widthOfWay({ class: 'primary' }),   px(10 * 1.5), 'primary');
  assert.eq(widthOfWay({ class: 'secondary' }),  px(9), 'secondary');
  assert.eq(widthOfWay({ class: 'tertiary' }),   px(7.5), 'tertiary');
  // A motorway is wider than a game cell — it spills past the single-cell band
  // the rasterizer gives it, which is the whole point of drawing true widths.
  assert.gt(12, WorldGen.CELL_M, 'a motorway is wider than a game cell');
});

test('road overlay: the large tier is stroked 50% wider than its measured width', () => {
  // Exactly worldgen's ROAD_LG classes get the emphasis — nothing below them.
  for (const cls of ['motorway', 'trunk', 'primary'])
    assert.eq(widthOfWay({ class: cls }), px(WorldGen.roadWidthM({ class: cls }) * 1.5), cls);
  for (const cls of ['secondary', 'tertiary', 'street', 'service', 'pedestrian',
                     'track', 'cycleway', 'footway', 'pier'])
    assert.eq(widthOfWay({ class: cls }), px(WorldGen.roadWidthM({ class: cls })), cls);
  // The boost must not invert the hierarchy: a boosted primary still outweighs
  // a secondary, and the secondary keeps its lead over a street.
  assert.lt(widthOfWay({ class: 'secondary' }), widthOfWay({ class: 'primary' }), 'primary > secondary');
  assert.lt(widthOfWay({ class: 'street' }), widthOfWay({ class: 'secondary' }), 'secondary > street');
});

test('road overlay: footways and cycleways are person-wide, not road-wide', () => {
  assert.eq(widthOfWay({ class: 'footway' }),  px(2), 'footway');
  assert.eq(widthOfWay({ class: 'path' }),     px(2), 'path');
  assert.eq(widthOfWay({ class: 'cycleway' }), px(2.5), 'cycleway');
  assert.lt(widthOfWay({ class: 'footway' }), widthOfWay({ class: 'street' }), 'thinner than a street');
});

test('road overlay: widths come from the rasterizer\'s own table', () => {
  // One source of truth — WorldGen.roadOverlayWidthM, which is the measured
  // width from roadWidthM with the large tier's emphasis folded in. The
  // overlay strokes with it AND worldgen stamps its no-spawn road mask with
  // it, so the band drawn as road and the ground barred from spawning are the
  // same ground. Drift here would put rocks back in the traffic.
  const LARGE = new Set(['motorway', 'trunk', 'primary']);
  for (const cls of ['motorway', 'primary', 'secondary', 'tertiary', 'street',
                     'service', 'pedestrian', 'track', 'cycleway', 'footway', 'pier']) {
    const cover = WorldGen.roadOverlayWidthM({ class: cls });
    assert.eq(cover, WorldGen.roadWidthM({ class: cls }) * (LARGE.has(cls) ? 1.5 : 1),
      `${cls}: covered width derives from the measured one`);
    assert.eq(widthOfWay({ class: cls }), px(cover), cls);
  }
});

test('road overlay: wider classes are stroked first so narrow ones read on top', () => {
  clearTiles();
  putTile(0, 0, [
    line([{ x: 0, y: 0 }, { x: 16, y: 0 }], { class: 'footway' }),
    line([{ x: 0, y: 8 }, { x: 16, y: 8 }], { class: 'motorway' }),
    line([{ x: 0, y: 16 }, { x: 16, y: 16 }], { class: 'street' }),
  ]);
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  const widths = scene.roadGeomGfx.paths.map(p => p.style.w);
  assert.eq(widths.length, 3, 'three ways stroked');
  for (let i = 1; i < widths.length; i++)
    assert.truthy(widths[i - 1] > widths[i], 'widest first: ' + widths.join(','));
});

// ── Path continuity ───────────────────────────────────────────────────────

test('road overlay: a way is one continuous path, not loose segments', () => {
  clearTiles();
  // A wide band drawn segment-by-segment leaves a notch at every bend.
  putTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }], { class: 'primary' })]);
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  assert.eq(scene.roadGeomGfx.paths.length, 1, 'one path');
  assert.eq(scene.roadGeomGfx.paths[0].pts.length, 3, 'all three vertices in it');
});

test('road overlay: an off-screen detour breaks the path instead of shortcutting', () => {
  clearTiles();
  const far = Math.round(600 / M);   // 600 m away — far outside the 55 m view
  // On-screen, way off south, then back on-screen: the middle stretch is culled
  // and must NOT be replaced by a straight line across the viewport.
  putTile(0, 0, [line([
    { x: 0, y: 0 }, { x: 0, y: far }, { x: 16, y: far }, { x: 16, y: 0 },
  ])]);
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  for (const p of scene.roadGeomGfx.paths)
    assert.truthy(p.pts.length >= 2, 'no degenerate path');
  // No stroked segment may run straight across the view from the first vertex
  // to the last — that's the shortcut a single un-broken path would draw.
  const shortcut = scene.roadGeomGfx.lines.some(([x1, y1, x2, y2]) =>
    Math.abs(y1 - y2) < 1 && Math.abs(x1 - 176) < 1 && Math.abs(x2 - 240) < 1);
  assert.falsy(shortcut, 'culled stretch not bridged');
});

test('road overlay: geometry rides the world — moving the player shifts it', () => {
  clearTiles();
  putTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }])]);
  // Player 10 m (2 whole cells) east: the same way must draw 64 px further left.
  const scene = makeOverlayScene({ playerM: { x: 10, y: 0 } });
  RoadOverlay.draw(scene);
  assert.eq(scene.roadGeomGfx.lines[0][0], 112, 'x1 shifted by two cells');
  assert.eq(scene.roadGeomGfx.lines[0][2], 176, 'x2 shifted by two cells');
});

test('road overlay: sub-cell movement scrolls the container, not the geometry', () => {
  clearTiles();
  putTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }])]);
  // Half a cell (2.5 m) east — inside the same cell, so the strokes stay put
  // at their cell-snapped positions and the container carries the 16 px offset.
  const scene = makeOverlayScene({ playerM: { x: 2.5, y: 0 } });
  RoadOverlay.draw(scene);
  assert.eq(scene.roadGeomGfx.lines[0][0], 176, 'snapped x1 unchanged');
  assert.eq(scene.roadGeomContainer.x, -16, 'container carries the sub-cell offset');
});

// ── Rail ──────────────────────────────────────────────────────────────────

test('road overlay: railways are drawn in slate, not road earth', () => {
  clearTiles();
  putTile(0, 0, [
    line([{ x: 0, y: 0 }, { x: 16, y: 0 }], { class: 'rail' }),
    line([{ x: 0, y: 8 }, { x: 16, y: 8 }], { class: 'transit', subclass: 'tram' }),
    line([{ x: 0, y: 16 }, { x: 16, y: 16 }], { class: 'street' }),
  ]);
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  const byColour = {};
  for (const p of scene.roadGeomGfx.paths) byColour[p.style.c] = (byColour[p.style.c] || 0) + 1;
  assert.eq(byColour[0x565d69], 2, 'both rail classes stroke slate');
  assert.eq(byColour[0x3a322c], 1, 'the street keeps the road earth');
});

test('road overlay: railways get track furniture — two offset rails + perpendicular ties', () => {
  clearTiles();
  putTile(0, 0, [
    line([{ x: 0, y: 0 }, { x: 16, y: 0 }], { class: 'rail' }),      // 10 m due east
    line([{ x: 0, y: 16 }, { x: 16, y: 16 }], { class: 'street' }),  // control: no decor
  ]);
  // Stub with decorPath support — the plain stub gets no decor at all.
  const gfx = makeGfx();
  gfx.decor = [];
  gfx.decorPath = function (w, c, pts) { this.decor.push({ w, c, pts }); };
  const scene = makeOverlayScene({ roadGeomGfx: gfx });
  RoadOverlay.draw(scene);
  // Fixture scale: 32 px / 5 m cell = 6.4 px/m. Gauge 1.8 m → rails at
  // y = 176 ± 5.76; ties every 2.2 m = 14.08 px starting half a step in,
  // spanning ±(2.8/2)·6.4 = ±8.96 px across the bed.
  const rails = gfx.decor.filter(d => d.c === 0xb9c2cd);
  const ties = gfx.decor.filter(d => d.c === 0x463526);
  assert.eq(rails.length, 2, 'exactly two rails');
  const railYs = rails.map(r => r.pts[0].y).sort((a, b) => a - b);
  assert.inRange(railYs[0] - (176 - 5.76), -0.01, 0.01, 'left rail at -half gauge');
  assert.inRange(railYs[1] - (176 + 5.76), -0.01, 0.01, 'right rail at +half gauge');
  for (const r of rails) assert.eq(r.pts[0].y, r.pts[1].y, 'rail parallel to a straight run');
  assert.eq(ties.length, 5, 'ties at 14.08 px spacing across a 64 px run');
  assert.inRange(ties[0].pts[0].x - 183.04, -0.01, 0.01, 'first tie half a step in');
  for (const t of ties) {
    assert.eq(t.pts[0].x, t.pts[1].x, 'tie perpendicular to an east-west run');
    assert.inRange((t.pts[1].y - t.pts[0].y) - 2 * 8.96, -0.01, 0.01, 'tie spans the bed');
  }
  // The street contributed nothing to the decor pass.
  const streetY = 176 + 32 * 2;   // 16 MVT units = 10 m = 2 cells south
  assert.falsy(gfx.decor.some(d => d.pts.some(p => Math.abs(p.y - streetY) < 12)),
    'no track furniture on a road');
});

test('road overlay: rail and road of the same width are stroked separately', () => {
  clearTiles();
  // Both fall to the 3 m default width — bucketing on width alone would merge
  // them into one path list and paint the rail brown (or the road slate).
  putTile(0, 0, [
    line([{ x: 0, y: 0 }, { x: 16, y: 0 }], { class: 'rail' }),
    line([{ x: 0, y: 8 }, { x: 16, y: 8 }], { class: 'raceway' }),
  ]);
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  const paths = scene.roadGeomGfx.paths;
  assert.eq(paths.length, 2, 'two paths');
  assert.eq(paths[0].style.w, paths[1].style.w, 'same width');
  assert.truthy(paths[0].style.c !== paths[1].style.c, 'different colours');
});

// ── Keep-out (land only, never over a floor) ──────────────────────────────
// The band is punched out of the finished canvas over water and building
// cells. Cells are addressed off the player's own cell: the cell `ox` columns
// east / `oy` rows south lands at (viewCenterX + ox*32, viewCenterY + oy*32).

// The player's cell in the fixture — the tile-local cell holding world (0,0).
const _erasedAt = (g, ox, oy) => g.erased.some(r =>
  r.x === 176 + ox * 32 && r.y === 176 + oy * 32 && r.w === 32 && r.h === 32);

test('road overlay: water cells are punched out of the band', () => {
  clearTiles();
  // Two cells east of the player is water; one cell east is plain ground.
  putTile(0, 0, [line([{ x: -400, y: 0 }, { x: 400, y: 0 }])], { '2_0': 3 });
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  const g = scene.roadGeomGfx;
  assert.truthy(g.erased.length > 0, 'something was punched out');
  assert.truthy(_erasedAt(g, 2, 0), 'the water cell is cleared');
  assert.falsy(_erasedAt(g, 1, 0), 'the land cell beside it is not');
});

test('road overlay: building floors are punched out of the band', () => {
  clearTiles();
  // House (9), building_med (11) and castle floor (12) all keep the band off —
  // while buildings ARE their cells. (Polygonal mode is the next test.)
  putTile(0, 0, [line([{ x: -400, y: 0 }, { x: 400, y: 0 }])],
          { '1_0': 9, '2_0': 11, '3_0': 12, '4_0': 5 });
  const scene = makeOverlayScene();
  const prev = globalThis.__POLY_BUILDINGS;
  globalThis.__POLY_BUILDINGS = false;
  try {
    RoadOverlay.draw(scene);
    const g = scene.roadGeomGfx;
    for (const ox of [1, 2, 3]) assert.truthy(_erasedAt(g, ox, 0), 'floor cell ' + ox + ' cleared');
    assert.falsy(_erasedAt(g, 4, 0), 'the residential cell is left alone');
  } finally { globalThis.__POLY_BUILDINGS = prev; }
});

test('road overlay: in polygonal mode building CELLS keep the band', () => {
  // The cells aren't the building any more (building_overlay.js draws the
  // source ring in a layer above this one), so punching them out would cut a
  // staircase of holes in the road beside a polygon that already covers it.
  // Water is punched either way — it is still water.
  clearTiles();
  putTile(0, 0, [line([{ x: -400, y: 0 }, { x: 400, y: 0 }])],
          { '1_0': 9, '2_0': 11, '3_0': 12, '4_0': 3 });
  const scene = makeOverlayScene();
  const prev = globalThis.__POLY_BUILDINGS;
  globalThis.__POLY_BUILDINGS = true;
  try {
    RoadOverlay.draw(scene);
    const g = scene.roadGeomGfx;
    for (const ox of [1, 2, 3]) assert.falsy(_erasedAt(g, ox, 0), 'floor cell ' + ox + ' left alone');
    assert.truthy(_erasedAt(g, 4, 0), 'the water cell is still cleared');
  } finally { globalThis.__POLY_BUILDINGS = prev; }
});

test('road overlay: ordinary ground is never punched out', () => {
  clearTiles();
  putTile(0, 0, [line([{ x: -400, y: 0 }, { x: 400, y: 0 }])], { '1_0': 0, '2_0': 7 });
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  assert.eq(scene.roadGeomGfx.erased.length, 0, 'nothing cleared over grass or road');
});

test('road overlay: a tile with no rasterized grid is simply not punched', () => {
  clearTiles();
  putTile(0, 0, [line([{ x: -400, y: 0 }, { x: 400, y: 0 }])]);   // no grid
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  assert.eq(scene.roadGeomGfx.erased.length, 0, 'no grid, no keep-out');
  assert.truthy(scene.roadGeomGfx.lines.length > 0, 'the way is still drawn');
});

// ── Cobblestone ──────────────────────────────────────────────────────────
// The stone texture itself is painted by the canvas adapter (no DOM here),
// but the phase it's given is computed in the shared rebuild path, so the
// anchoring is testable: it's the screen position the world origin projects to.

test('road overlay: the cobblestone texture is phased to the world, not the screen', () => {
  clearTiles();
  putTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }])]);
  const still = makeOverlayScene();
  RoadOverlay.draw(still);
  assert.eq(still.roadGeomGfx.phase.x, 176, 'world origin is under the player');
  assert.eq(still.roadGeomGfx.phase.y, 176, 'ditto vertically');
  // Two cells east: the phase must travel exactly as far as the geometry did,
  // or the texture swims across the roads as the player walks.
  const moved = makeOverlayScene({ playerM: { x: 10, y: 0 } });
  RoadOverlay.draw(moved);
  assert.eq(moved.roadGeomGfx.phase.x, 112, 'phase shifted by two cells');
  assert.eq(moved.roadGeomGfx.phase.x - still.roadGeomGfx.phase.x,
            moved.roadGeomGfx.lines[0][0] - still.roadGeomGfx.lines[0][0],
            'phase and geometry moved together');
});

// ── Feature selection ─────────────────────────────────────────────────────

test('road overlay: only transportation LINES are drawn', () => {
  clearTiles();
  const pts = [{ x: 0, y: 0 }, { x: 16, y: 0 }];
  const entry = putTile(0, 0, [
    line(pts),
    { type: 1, tags: {}, geom: [[{ x: 0, y: 0 }]] },          // a point
    { type: 3, tags: {}, geom: [pts.concat([{ x: 0, y: 0 }])] }, // a polygon
  ]);
  entry.layers[0].features.push(line(pts));   // a line in the WATER layer
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  assert.eq(scene.roadGeomGfx.lines.length, 1, 'only the transportation line');
});

test('road overlay: draws the geometry worldgen discards (parking aisles)', () => {
  clearTiles();
  // Aisles are skipped by the rasterizer (worldgen.js) — the whole point of
  // this overlay is showing the SOURCE ways, including the dropped ones.
  putTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }], { class: 'service', service: 'parking_aisle' })]);
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  assert.eq(scene.roadGeomGfx.lines.length, 1, 'parking aisle still drawn');
});

// ── Culling ───────────────────────────────────────────────────────────────

test('road overlay: segments far outside the viewport are culled', () => {
  clearTiles();
  // 2000 MVT units ≈ 1250 m south — thousands of px below the 352 px view.
  putTile(0, 0, [line([{ x: 0, y: 2000 }, { x: 16, y: 2000 }])]);
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  assert.eq(scene.roadGeomGfx.lines.length, 0, 'off-screen segment skipped');
});

test('road overlay: a segment crossing the view is kept though both ends are outside', () => {
  clearTiles();
  const far = Math.round(500 / M);   // 500 m — well past either edge
  putTile(0, 0, [line([{ x: -far, y: 0 }, { x: far, y: 0 }])]);
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  assert.eq(scene.roadGeomGfx.lines.length, 1, 'crossing segment kept');
});

// ── Gating + redraw cache ─────────────────────────────────────────────────

test('road overlay: always on at the surface — the old save toggle is gone', () => {
  // The band IS how roads are drawn now, not a debug aid: a leftover
  // roadGeomOverlay:false in an old save must not blank the roads.
  clearTiles();
  putTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }])]);
  const scene = makeOverlayScene({ save: { roadGeomOverlay: false } });
  RoadOverlay.draw(scene);
  assert.gt(scene.roadGeomGfx.lines.length, 0, 'roads stroked despite the stale flag');
  assert.truthy(scene.roadGeomContainer.visible, 'layer visible');
});

test('road overlay: hidden underground (cave tiles have no MVT layers)', () => {
  clearTiles();
  putTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }])]);
  const scene = makeOverlayScene({ depth: 1 });
  RoadOverlay.draw(scene);
  assert.eq(scene.roadGeomGfx.lines.length, 0, 'nothing stroked underground');
  assert.falsy(scene.roadGeomContainer.visible, 'layer hidden underground');
});

test('road overlay: a still camera redraws once, a tile load repaints', () => {
  clearTiles();
  putTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }])]);
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  const after1 = scene.roadGeomGfx.cleared;
  RoadOverlay.draw(scene);
  RoadOverlay.draw(scene);
  assert.eq(scene.roadGeomGfx.cleared, after1, 'no rebuild while nothing changed');
  // A neighbouring tile finishing its load must repaint even standing still.
  putTile(1, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }])]);
  RoadOverlay.draw(scene);
  assert.eq(scene.roadGeomGfx.cleared, after1 + 1, 'tile load forces a repaint');
});

test('road overlay: invalidate() forces the next draw to rebuild', () => {
  clearTiles();
  putTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }])]);
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  const after1 = scene.roadGeomGfx.cleared;
  RoadOverlay.invalidate(scene);
  RoadOverlay.draw(scene);
  assert.eq(scene.roadGeomGfx.cleared, after1 + 1, 'rebuilt after invalidate');
});

test('road overlay: a tile with no decoded layers is skipped, not thrown on', () => {
  clearTiles();
  WorldGen.tileCache.set(`${WorldGen.Z}/0/0`, { tileEdgeM: TILE_EDGE_M });  // still loading
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  assert.eq(scene.roadGeomGfx.lines.length, 0, 'nothing stroked');
});

// ── Restored streets ──────────────────────────────────────────────────────
// A stretch the player has rebuilt (src/streets.js keeps the metre intervals
// in the save) is drawn AGAIN on a second target, in near-black clean cobble.
// src/streets.js is a separate module; these tests install a STUB `Streets`
// with the contract's semantics for the length of the test, so the overlay's
// half of the contract is pinned whether or not the real module is loaded —
// and so a suite that does load it isn't left with the stub afterwards.

const RO_ROAD_RESTORED = 0x161412;
const RO_PATH_RESTORED = 0x2e2620;

// The contract's API, minimally: lineKey / restoredList / subLineM / epoch.
// subLineM is a plain arclength walk of the polyline (the real one is the
// same walk with the tile-span bookkeeping around it).
const RO_STREETS_STUB = {
  lineKey(f, i) { return `${f.id}:${i}`; },
  epoch(save) { return (save && save.streetsEpoch) | 0; },
  restoredList(save, tileKey, key) {
    const flat = save && save.streets && save.streets[tileKey] && save.streets[tileKey][key];
    if (!flat) return [];
    const out = [];
    for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
    return out;
  },
  subLineM(lineIn, mvtToM, s0, s1) {
    const pts = lineIn.map((p) => ({ x: p.x * mvtToM, y: p.y * mvtToM }));
    const at = (s) => {
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
        const l = Math.hypot(dx, dy);
        if (acc + l >= s) {
          const t = l ? (s - acc) / l : 0;
          return { x: pts[i - 1].x + dx * t, y: pts[i - 1].y + dy * t, seg: i };
        }
        acc += l;
      }
      const last = pts[pts.length - 1];
      return { x: last.x, y: last.y, seg: pts.length };
    };
    const a = at(s0), b = at(s1);
    const out = [{ x: a.x, y: a.y }];
    for (let i = a.seg; i < b.seg; i++) out.push({ x: pts[i].x, y: pts[i].y });
    out.push({ x: b.x, y: b.y });
    return out;
  },
};

// Install the stub for one test and hand the global back afterwards.
function withStreets(fn) {
  const prev = globalThis.Streets;
  globalThis.Streets = RO_STREETS_STUB;
  try { return fn(); } finally { globalThis.Streets = prev; }
}

// A scene that gets the restored pass too: a second recording stub, exactly
// the way the game hands the module a second canvas.
function makeRestoredScene(over) {
  return makeOverlayScene(Object.assign({ roadRestoredGfx: makeGfx() }, over || {}));
}
const RO_KEY00 = () => WorldGen.tileKey(0, 0);
// One saved interval list, in the save shape Streets owns.
const roSave = (tileKey, key, flat, epoch) => ({
  streets: { [tileKey]: { [key]: flat } },
  streetsEpoch: epoch == null ? 1 : epoch,
});

test('road overlay: a restored interval is stroked from the save, in metres', () => {
  withStreets(() => {
    clearTiles();
    // 16 MVT units = 10 m due east of the player, id 7, one line (index 0).
    putTile(0, 0, [Object.assign(line([{ x: 0, y: 0 }, { x: 16, y: 0 }], { class: 'street' }), { id: 7 })]);
    // The player has rebuilt metres 2.5 → 7.5 of it: the middle half.
    const scene = makeRestoredScene({ save: roSave(RO_KEY00(), '7:0', [2.5, 7.5]) });
    RoadOverlay.draw(scene);
    const r = scene.roadRestoredGfx;
    assert.eq(r.paths.length, 1, 'one restored run');
    const p = r.paths[0];
    // 2.5 m = half a cell = 16 px east of centre; 7.5 m = 48 px.
    assert.eq(p.pts[0].x, 176 + 16, 'the run starts at the interval\'s first metre');
    assert.eq(p.pts[p.pts.length - 1].x, 176 + 48, 'and ends at its last');
    assert.eq(p.pts[0].y, 176, 'on the way itself');
    // Same width as the band under it — a restored street is the same street.
    assert.eq(p.style.w, px(5.5), 'stroked at the way\'s real width');
    assert.eq(p.style.c, RO_ROAD_RESTORED, 'near-black restored road');
    assert.eq(p.style.a, 0.92, 'the restored pass is near-opaque');
    // The dilapidated band is still drawn underneath, in full.
    assert.eq(scene.roadGeomGfx.paths.length, 1, 'the base band is untouched');
    assert.eq(scene.roadGeomGfx.paths[0].style.c, 0x3a322c, 'still dilapidated earth');
  });
});

test('road overlay: an unrestored way draws no restored stroke at all', () => {
  withStreets(() => {
    clearTiles();
    putTile(0, 0, [Object.assign(line([{ x: 0, y: 0 }, { x: 16, y: 0 }], { class: 'street' }), { id: 7 })]);
    const scene = makeRestoredScene({ save: { streets: {}, streetsEpoch: 0 } });
    RoadOverlay.draw(scene);
    assert.eq(scene.roadRestoredGfx.paths.length, 0, 'nothing restored, nothing stroked');
    assert.eq(scene.roadRestoredGfx.cleared, 1, 'the pass still ran and cleared');
  });
});

test('road overlay: a railway never restores, however the save reads', () => {
  withStreets(() => {
    clearTiles();
    // Both ways carry intervals; only the street may come back.
    putTile(0, 0, [
      Object.assign(line([{ x: 0, y: 0 }, { x: 16, y: 0 }], { class: 'rail' }), { id: 11 }),
      Object.assign(line([{ x: 0, y: 8 }, { x: 16, y: 8 }], { class: 'transit' }), { id: 12 }),
      Object.assign(line([{ x: 0, y: 16 }, { x: 16, y: 16 }], { class: 'street' }), { id: 13 }),
    ]);
    const k = RO_KEY00();
    const scene = makeRestoredScene({
      save: { streetsEpoch: 1, streets: { [k]: { '11:0': [0, 10], '12:0': [0, 10], '13:0': [0, 10] } } },
    });
    RoadOverlay.draw(scene);
    const r = scene.roadRestoredGfx;
    assert.eq(r.paths.length, 1, 'only the street is restored');
    assert.eq(r.paths[0].style.c, RO_ROAD_RESTORED, 'and it is the road colour');
    // A rail run would have landed on the player's own row / one cell south.
    assert.falsy(r.lines.some(([, y1]) => y1 === 176 || y1 === 176 + 32), 'no rail band restored');
  });
});

test('road overlay: a restored footpath is packed earth, not black cobble', () => {
  withStreets(() => {
    clearTiles();
    putTile(0, 0, [
      Object.assign(line([{ x: 0, y: 0 }, { x: 16, y: 0 }], { class: 'footway' }), { id: 21 }),
      Object.assign(line([{ x: 0, y: 16 }, { x: 16, y: 16 }], { class: 'street' }), { id: 22 }),
    ]);
    const k = RO_KEY00();
    const scene = makeRestoredScene({
      save: { streetsEpoch: 1, streets: { [k]: { '21:0': [0, 10], '22:0': [0, 10] } } },
    });
    RoadOverlay.draw(scene);
    const byColour = {};
    for (const p of scene.roadRestoredGfx.paths) byColour[p.style.c] = (byColour[p.style.c] || 0) + 1;
    assert.eq(byColour[RO_PATH_RESTORED], 1, 'the footway restores to dark packed earth');
    assert.eq(byColour[RO_ROAD_RESTORED], 1, 'the street restores to near-black');
    // The path colour is lighter than the road's — the split has to be visible.
    const pl = (0x2e + 0x26 + 0x20) / 3, rl = (0x16 + 0x14 + 0x12) / 3;
    assert.gt(pl, rl, 'restored path is lighter than restored road');
  });
});

test('road overlay: a restored stretch in a neighbouring tile carries its tile origin', () => {
  withStreets(() => {
    clearTiles();
    // Tile (-1,0) spans world x −2560…0 m: MVT 4080 is 10 m west of the player.
    putTile(-1, 0, [Object.assign(
      line([{ x: 4080, y: 0 }, { x: 4096, y: 0 }], { class: 'street' }), { id: 5 })]);
    const scene = makeRestoredScene({
      save: roSave(WorldGen.tileKey(-1, 0), '5:0', [5, 10]),
    });
    RoadOverlay.draw(scene);
    const p = scene.roadRestoredGfx.paths[0];
    assert.truthy(p, 'the neighbour tile\'s restored metres are drawn');
    // Metres 5..10 of a 10 m line ending at world x = 0 → −5 m … 0 m.
    assert.eq(p.pts[0].x, 176 - 32, 'starts one cell west of the player');
    assert.eq(p.pts[p.pts.length - 1].x, 176, 'and runs up to the tile edge');
  });
});

test('road overlay: a restore repaints, and nothing else does', () => {
  withStreets(() => {
    clearTiles();
    putTile(0, 0, [Object.assign(line([{ x: 0, y: 0 }, { x: 16, y: 0 }], { class: 'street' }), { id: 7 })]);
    const save = roSave(RO_KEY00(), '7:0', [0, 5], 1);
    const scene = makeRestoredScene({ save });
    RoadOverlay.draw(scene);
    const base1 = scene.roadGeomGfx.cleared, rest1 = scene.roadRestoredGfx.cleared;
    RoadOverlay.draw(scene);
    RoadOverlay.draw(scene);
    assert.eq(scene.roadRestoredGfx.cleared, rest1, 'a still camera repaints nothing');
    assert.eq(scene.roadGeomGfx.cleared, base1, 'the base canvas too');
    // Restoring more metres bumps the epoch — which is what repaints.
    save.streets[RO_KEY00()]['7:0'] = [0, 10];
    save.streetsEpoch = 2;
    RoadOverlay.draw(scene);
    assert.eq(scene.roadRestoredGfx.cleared, rest1 + 1, 'a new epoch repaints');
    assert.eq(scene.roadRestoredGfx.paths[0].pts[1].x, 176 + 64, 'and the longer stretch is drawn');
  });
});

test('road overlay: without the streets module the base band still draws', () => {
  const prev = globalThis.Streets;
  globalThis.Streets = undefined;
  try {
    clearTiles();
    putTile(0, 0, [Object.assign(line([{ x: 0, y: 0 }, { x: 16, y: 0 }], { class: 'street' }), { id: 7 })]);
    const scene = makeRestoredScene({ save: roSave(RO_KEY00(), '7:0', [0, 10]) });
    RoadOverlay.draw(scene);
    assert.eq(scene.roadGeomGfx.paths.length, 1, 'the dilapidated band is unconditional');
    assert.eq(scene.roadRestoredGfx.paths.length, 0, 'and nothing is restored without Streets');
  } finally { globalThis.Streets = prev; }
});

// ── The two procedural tiles ──────────────────────────────────────────────
// Both are painted by pure functions taking a 2D context, so the real drawing
// code runs here against a recorder (the same trick tilled_bed.test.js uses on
// textures.js). No canvas, no DOM.

function roRecorder() {
  const ops = [];
  const grad = { addColorStop: (o, c) => ops.push(['addColorStop', o, c]) };
  const ctx = new Proxy({}, {
    get: (_, k) => {
      if (k === 'createRadialGradient') return (...a) => { ops.push(['createRadialGradient', ...a]); return grad; };
      return (...a) => { ops.push([k, ...a]); };
    },
    set: (_, k, v) => { ops.push(['set:' + k, v]); return true; },
  });
  return { ctx, ops };
}
// The style in force at op index i.
function roStyleAt(ops, i, which) {
  let v = null;
  for (let j = 0; j < i; j++) if (ops[j][0] === 'set:' + which) v = ops[j][1];
  return v;
}
const roAlphaOf = (css) => {
  const m = /^rgba\([^)]*?,\s*([0-9.]+)\)$/.exec(String(css));
  return m ? Number(m[1]) : null;
};

test('weathering tile: the cracks are bold enough to read through the band alpha', () => {
  const { ctx, ops } = roRecorder();
  RoadOverlay.paintWeatherTile(ctx, 64);
  // Every stroked path, with the colour it was stroked in.
  const strokes = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i][0] !== 'stroke') continue;
    const css = roStyleAt(ops, i, 'strokeStyle');
    let pts = 0;
    for (let j = i - 1; j >= 0 && ops[j][0] !== 'stroke'; j--)
      if (ops[j][0] === 'lineTo' || ops[j][0] === 'moveTo') pts++;
    strokes.push({ css, pts, alpha: roAlphaOf(css) });
  }
  const dark = strokes.filter((s) => /rgba\(0,0,0/.test(s.css));
  const pale = strokes.filter((s) => /rgba\(255,255,255/.test(s.css));
  assert.gte(dark.length, 3, 'at least three crack paths');
  assert.eq(pale.length, dark.length, 'each crack gets its pale lip');
  for (const s of dark) {
    // The whole canvas is shown at 0.61 — a crack drawn faint arrives at the
    // player as nothing at all.
    assert.gte(s.alpha, 0.8, 'a crack is near-black');
    assert.gte(s.pts, 4, 'and jagged, not a straight scratch');
  }
  for (const s of pale) assert.lt(s.alpha, 0.3, 'the lip is a hint, not a highlight');
  assert.eq(roStyleAt(ops, ops.length, 'lineWidth'), 1, 'a crack is one pixel wide');
});

test('weathering tile: damp patches, lichen blooms and missing stones', () => {
  const { ctx, ops } = roRecorder();
  RoadOverlay.paintWeatherTile(ctx, 64);
  const blooms = ops.filter(([k]) => k === 'createRadialGradient');
  assert.eq(blooms.length, 5, 'three lichen blooms + two damp patches');
  const stops = ops.filter(([k]) => k === 'addColorStop');
  assert.eq(stops.length, blooms.length * 2, 'each bloom falls to nothing at its rim');
  for (let i = 1; i < stops.length; i += 2)
    assert.eq(roAlphaOf(stops[i][2]), 0, 'the outer stop is fully transparent');
  const pale = stops.filter((s) => s[1] === 0 && /255,255,255/.test(s[2]));
  const dark = stops.filter((s) => s[1] === 0 && /rgba\(0,0,0/.test(s[2]));
  assert.eq(pale.length, 3, 'three pale lichen blooms');
  assert.eq(dark.length, 2, 'two dark damp patches');
  assert.gte(roAlphaOf(dark[0][2]), 0.3, 'damp reads through the band alpha');
  // The missing stones are filled ellipses, not strokes.
  assert.eq(ops.filter(([k]) => k === 'ellipse').length, 2, 'two missing-stone pits');
  const pitFills = ops.map((o, i) => [o, i]).filter(([o]) => o[0] === 'fill')
    .map(([, i]) => roStyleAt(ops, i, 'fillStyle')).filter((c) => /rgba\(0,0,0/.test(c));
  assert.eq(pitFills.length, 2, 'both pits are dark');
  assert.gte(roAlphaOf(pitFills[0]), 0.5, 'a pit is a hole, not a smudge');
});

test('weathering tile: it is the same tile every session', () => {
  const a = roRecorder(), b = roRecorder();
  RoadOverlay.paintWeatherTile(a.ctx, 64);
  RoadOverlay.paintWeatherTile(b.ctx, 64);
  assert.eq(JSON.stringify(a.ops), JSON.stringify(b.ops), 'fixed seed, identical marks');
});

// Pull the setts out of a clean-tile recording: one sett is a black body fill,
// a per-stone tone fill and a bevel fill, each over its own rounded path.
function roSetts(ops) {
  const setts = [];
  let move = null, fillStyle = null;
  for (const [k, ...a] of ops) {
    if (k === 'set:fillStyle') fillStyle = a[0];
    else if (k === 'moveTo') move = { x: a[0], y: a[1] };
    else if (k === 'fill' && fillStyle === '#000' && move) setts.push({ x: move.x, y: move.y });
  }
  return setts;
}

test('clean tile: a pale mortar wash under brick-staggered courses', () => {
  const { ctx, ops } = roRecorder();
  RoadOverlay.paintCleanTile(ctx, 32);
  // The mortar goes down FIRST and covers the whole tile — the seams between
  // the setts are what is left of it.
  const firstRect = ops.findIndex(([k]) => k === 'fillRect');
  const firstFill = ops.findIndex(([k]) => k === 'fill');
  assert.truthy(firstRect >= 0 && firstRect < firstFill, 'the wash is laid before any sett');
  assert.eq(roAlphaOf(roStyleAt(ops, firstRect, 'fillStyle')), RoadOverlay.CLEAN_MORTAR_ALPHA,
    'mortar at the pale wash alpha');
  assert.eq(JSON.stringify(ops[firstRect].slice(1)), JSON.stringify([0, 0, 32, 32]),
    'over the whole tile');
  const setts = roSetts(ops);
  // 6 across × 8 courses. The odd courses are staggered half a sett, so the
  // one that runs off the right edge is drawn again a tile to the left — a
  // wrap copy of the same stone, so the pattern meets itself when it repeats.
  const inTile = setts.filter((s) => s.x >= 0);
  assert.eq(inTile.length, 48, '48 setts: 6 across, 8 courses');
  assert.eq(setts.length - inTile.length, 4, 'four wrap copies, one per staggered course');
  const rows = [...new Set(setts.map((s) => Math.round(s.y * 100)))];
  assert.eq(rows.length, 8, 'eight courses');
  const byRow = {};
  for (const s of inTile) (byRow[Math.round(s.y * 100)] = byRow[Math.round(s.y * 100)] || []).push(s.x);
  for (const k of Object.keys(byRow)) assert.eq(byRow[k].length, 6, 'six setts per course');
  // Courses alternate: every other one starts half a sett further east.
  const starts = Object.keys(byRow).sort((a, b) => a - b).map((k) => Math.min(...byRow[k]));
  assert.inRange(starts[1] - starts[0] - (32 / 6) / 2, -0.01, 0.01, 'the stagger is half a sett');
  assert.inRange(starts[2] - starts[0], -0.01, 0.01, 'and it alternates back');
});

test('clean tile: every sett is a body, a tone and a top bevel', () => {
  const { ctx, ops } = roRecorder();
  RoadOverlay.paintCleanTile(ctx, 32);
  const setts = roSetts(ops);
  const fills = ops.filter(([k]) => k === 'fill');
  assert.eq(fills.length, setts.length * 3, 'three fills per sett: body, tone, bevel');
  // The tone varies stone to stone (neighbours must not read identical), and
  // the bevel is one constant catch-light along the top of each.
  const white = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i][0] !== 'fill') continue;
    const css = roStyleAt(ops, i, 'fillStyle');
    if (/rgba\(255,255,255/.test(css)) white.push(roAlphaOf(css));
  }
  const bevels = white.filter((a) => a === RoadOverlay.CLEAN_BEVEL_ALPHA);
  assert.eq(bevels.length, setts.length, 'one bevel per sett');
  const tones = white.filter((a) => a !== RoadOverlay.CLEAN_BEVEL_ALPHA);
  assert.eq(tones.length, setts.length, 'one tone per sett');
  for (const t of tones) assert.inRange(t, 0.05, 0.12, 'the per-stone tone is slight');
  assert.gt(new Set(tones.map((t) => Math.round(t * 1000))).size, 10, 'the tones actually vary');
  // Rounded, not square: four quadratic corners per rounded rect.
  assert.eq(ops.filter(([k]) => k === 'quadraticCurveTo').length, fills.length * 4, 'rounded setts');
});

test('clean tile: a restored path keeps half the mortar of a street', () => {
  const road = roRecorder(), path = roRecorder();
  RoadOverlay.paintCleanTile(road.ctx, 32, RoadOverlay.CLEAN_MORTAR_ALPHA);
  RoadOverlay.paintCleanTile(path.ctx, 32, RoadOverlay.CLEAN_MORTAR_ALPHA * 0.5);
  const mortarOf = (r) => {
    const i = r.ops.findIndex(([k]) => k === 'fillRect');
    return roAlphaOf(roStyleAt(r.ops, i, 'fillStyle'));
  };
  assert.eq(mortarOf(path), mortarOf(road) / 2, 'packed earth has half the mortar');
  assert.eq(roSetts(path.ops).length, roSetts(road.ops).length, 'the same courses either way');
});

test('clean tile: it is the same tile every session', () => {
  const a = roRecorder(), b = roRecorder();
  RoadOverlay.paintCleanTile(a.ctx, 32);
  RoadOverlay.paintCleanTile(b.ctx, 32);
  assert.eq(JSON.stringify(a.ops), JSON.stringify(b.ops), 'fixed seed, identical setts');
});

// ── The LAMP STONE ──────────────────────────────────────────────────────────
// The glowing cobble a restored street carries every Streets.lampSpacingM()
// metres of it: a real radial-gradient halo plus a sett, baked once and drawn
// through the same recording 2D context paintCleanTile is pinned against
// above — never a stack of translucent rings (the blotching rule at the top
// of this file: a translucent stroke composites with ITSELF wherever a path
// doubles back).

test('lamp stone: paints inside its own square only', () => {
  const S = RoadOverlay.LAMP_TEX_PX;
  const { ctx, ops } = roRecorder();
  RoadOverlay.paintLampStone(ctx, S);
  const rect = ops.find(([k]) => k === 'fillRect');
  assert.truthy(rect, 'the halo wash covers a rect');
  assert.eq(JSON.stringify(rect.slice(1)), JSON.stringify([0, 0, S, S]), 'exactly the square, not past it');
  // Every arc (the sett fill and its rim stroke) sits centred in the square
  // with a radius that keeps it inside — never clipped by, or spilling past,
  // the tile's own edge.
  const arcs = ops.filter(([k]) => k === 'arc');
  assert.gte(arcs.length, 2, 'the sett body and its rim stroke');
  for (const [, cx, cy, r] of arcs) {
    assert.inRange(cx, 0, S, 'arc centre x inside the square');
    assert.inRange(cy, 0, S, 'arc centre y inside the square');
    assert.gte(cx - r, -S * 0.01, 'the circle does not spill past the left/top edge');
    assert.lte(cx + r, S * 1.01, 'nor past the right/bottom edge');
    assert.lt(r, S / 2, 'the stone never reaches the edge of its own tile');
  }
  // Every gradient is likewise centred on the square, with its outer radius
  // never wider than the square holding it.
  const grads = ops.filter(([k]) => k === 'createRadialGradient');
  for (const [, x0, y0, , x1, y1, r1] of grads) {
    assert.inRange(x0, 0, S); assert.inRange(y0, 0, S);
    assert.inRange(x1, 0, S); assert.inRange(y1, 0, S);
    assert.lte(r1, S, 'the gradient does not reach past the square it fills');
  }
});

test('lamp stone: a real radial gradient halo and sett, not a stack of translucent rings', () => {
  const { ctx, ops } = roRecorder();
  RoadOverlay.paintLampStone(ctx, 64);
  // Exactly two gradients — the wide halo wash and the sett's own core —
  // each with its own falloff to nothing, and exactly two strokable arcs (the
  // sett body and its rim). A stack of rings standing in for either would be
  // many more of both, and would double-composite over itself.
  const grads = ops.filter(([k]) => k === 'createRadialGradient');
  assert.eq(grads.length, 2, 'the halo and the stone core, nothing else');
  const arcs = ops.filter(([k]) => k === 'arc');
  assert.eq(arcs.length, 2, 'the sett fill and its rim stroke — one circle each, not a ring stack');
  assert.eq(ops.filter(([k]) => k === 'fill').length, 1, 'one filled sett');
  assert.eq(ops.filter(([k]) => k === 'stroke').length, 1, 'one stroked rim');
  // Both arcs share the same centre and radius: the rim traces the sett it
  // sits on, not a ring of its own size.
  const [, ax, ay, ar] = arcs[0];
  const [, bx, by, br] = arcs[1];
  assert.eq(ax, bx); assert.eq(ay, by); assert.eq(ar, br);
  // The halo gradient falls all the way to transparent at its rim — a real
  // falloff, not an opaque ring with a hard edge.
  const stops = ops.filter(([k]) => k === 'addColorStop');
  const haloStops = stops.slice(0, 9);   // the halo's own loop adds 9 (i/8, i=0..8)
  const lastA = roAlphaOf(haloStops[haloStops.length - 1][2]);
  assert.lt(lastA, 0.01, 'the halo fades to nothing by the edge of the square');
});

test('lamp stone: the stone is a fraction of the square, not the whole tile', () => {
  const S = 64;
  const { ctx, ops } = roRecorder();
  RoadOverlay.paintLampStone(ctx, S);
  const arcs = ops.filter(([k]) => k === 'arc');
  const r = arcs[0][3];
  // Derived from what is actually drawn, rather than retyping
  // road_overlay.js's own LAMP_STONE_FRAC: a lamp reads as a stone sitting on
  // the road, not a wash filling the whole cell it stands in.
  const frac = r / S;
  assert.inRange(frac, 0.08, 0.3, `the sett is a modest fraction of its tile, got ${frac.toFixed(3)}`);
});

test('lamp stone: painted in the restored street\'s own ink, not the old violet', () => {
  const { ctx, ops } = roRecorder();
  RoadOverlay.paintLampStone(ctx, 64);
  // UI_STREET_INK is '#e8e2d6' — pale warm stone. The lamp, the chips that
  // fly off a restored carriageway and the counter over it are one material,
  // never the blue-white the lit pebbles wore until Sep 2026.
  const hex = UI_STREET_INK.replace('#', '');
  const ir = parseInt(hex.slice(0, 2), 16), ig = parseInt(hex.slice(2, 4), 16), ib = parseInt(hex.slice(4, 6), 16);
  const stops = ops.filter(([k]) => k === 'addColorStop').map(([, , css]) => css);
  const inkStops = stops.filter((css) => css.startsWith(`rgba(${ir},${ig},${ib},`));
  assert.gt(inkStops.length, 0, `at least one stop is painted in UI_STREET_INK's own channels (${ir},${ig},${ib})`);
  // Never a violet: blue must not lead red the way a violet reads.
  assert.gte(ir, ib, 'warm stone: red at least blue, never a violet lead');
  // The rim stroke is dark, not the ink itself — what makes the sett read as
  // a laid stone by day rather than a smudge of light.
  const stroke = roStyleAt(ops, ops.length, 'strokeStyle');
  assert.truthy(/^rgba\(\d+,\d+,\d+,/.test(stroke), 'the rim is stroked, not left at the ink');
  const [, rr, rg, rb] = stroke.match(/^rgba\((\d+),(\d+),(\d+),/).map(Number);
  assert.lt(rr + rg + rb, ir + ig + ib, 'the rim is darker than the stone it outlines');
});

test('lamp stone: LAMP_TEX_PX and LAMP_DRAW_CELLS are exported for app.js to bake and size the sprite', () => {
  assert.gt(RoadOverlay.LAMP_TEX_PX, 0, 'a real texture size');
  assert.gt(RoadOverlay.LAMP_DRAW_CELLS, 0, 'a real on-screen size, in cells');
  // Drawn a bit under two cells across — big enough to read as sitting on the
  // carriageway, small enough that a lamp doesn't loom over the road it lights.
  assert.inRange(RoadOverlay.LAMP_DRAW_CELLS, 1, 2.5, 'about one to two cells, halo included');
});

// ── The live pass ─────────────────────────────────────────────────────────
// The dwell preview and the restore shine change every frame, so they go on a
// Graphics rather than either canvas — projected through the camera-anchored
// worldMetersToScreen, then compensated for the container's own sub-cell
// scroll (draw() moves the container, and worldMetersToScreen already
// accounts for that offset).

function makeLiveGfx() {
  return {
    cleared: 0, paths: [], style: null, _cur: null,
    clear() { this.cleared++; this.paths.length = 0; },
    lineStyle(w, c, a) { this.style = { w, c, a }; },
    beginPath() { this._cur = { style: this.style, pts: [] }; },
    moveTo(x, y) { this._cur.pts.push({ x, y }); },
    lineTo(x, y) { this._cur.pts.push({ x, y }); },
    strokePath() { this.paths.push(this._cur); this._cur = null; },
  };
}
// A scene under a PEEK: the container carries the sub-cell scroll (draw() sets
// it every frame) and worldMetersToScreen carries the camera anchor.
function makeLiveScene(over) {
  const gfx = makeLiveGfx();
  const container = {
    x: -7, y: 3, children: [], tops: 0,
    add(o) { this.children.push(o); return this; },
    bringToTop(o) { this.tops++; return this; },
  };
  return Object.assign({
    cellM: 5,
    roadGeomContainer: container,
    _liveGfx: gfx,
    add: { graphics: () => gfx },
    // 6.4 px per metre, anchored 100 m east / 200 m south of the world origin.
    worldMetersToScreen(x, y) { return { x: 176 + (x - 100) * 6.4, y: 176 + (y - 200) * 6.4 }; },
  }, over || {});
}

test('road overlay live: runs project through the camera anchor, minus the container scroll', () => {
  const scene = makeLiveScene();
  RoadOverlay.drawLive(scene, [{
    pts: [{ x: 100, y: 200 }, { x: 105, y: 200 }, { x: 105, y: 210 }],
    tags: { class: 'street' }, alpha: 0.5,
  }]);
  const g = scene._liveGfx;
  assert.eq(g.paths.length, 1, 'one run stroked');
  const pts = g.paths[0].pts;
  assert.eq(pts.length, 3, 'every vertex kept');
  // (100,200) projects to the screen centre; the container sits at (−7, 3), so
  // the stroke inside it has to be drawn 7 px right and 3 px up of that.
  assert.eq(pts[0].x, 176 + 7, 'container x offset compensated');
  assert.eq(pts[0].y, 176 - 3, 'container y offset compensated');
  assert.eq(pts[1].x, 176 + 5 * 6.4 + 7, 'five metres east');
  assert.eq(pts[2].y, 176 + 10 * 6.4 - 3, 'ten metres south');
  assert.eq(g.paths[0].style.w, px(5.5), 'stroked at the way\'s width');
  assert.eq(g.paths[0].style.c, RO_ROAD_RESTORED, 'default colour is the restored road');
  assert.eq(g.paths[0].style.a, 0.5, 'the caller owns the alpha');
});

test('road overlay live: the Graphics is made once, inside the overlay container', () => {
  const scene = makeLiveScene();
  RoadOverlay.drawLive(scene, []);
  assert.eq(scene.roadLiveGfx, scene._liveGfx, 'kept on the scene');
  assert.eq(scene.roadGeomContainer.children.length, 1, 'added to the overlay container');
  assert.truthy(scene.roadGeomContainer.tops > 0, 'and lifted above both band images');
  RoadOverlay.drawLive(scene, []);
  assert.eq(scene.roadGeomContainer.children.length, 1, 'not added again');
});

test('road overlay live: an empty frame clears and strokes nothing', () => {
  const scene = makeLiveScene();
  RoadOverlay.drawLive(scene, [{ pts: [{ x: 100, y: 200 }, { x: 110, y: 200 }], tags: {} }]);
  assert.eq(scene._liveGfx.paths.length, 1, 'a run this frame');
  RoadOverlay.drawLive(scene, []);
  assert.eq(scene._liveGfx.paths.length, 0, 'gone the next');
  assert.eq(scene._liveGfx.cleared, 2, 'cleared every call');
  RoadOverlay.drawLive(scene, null);
  assert.eq(scene._liveGfx.cleared, 3, 'a missing list is not a crash');
});

test('road overlay live: a path run and an explicit colour', () => {
  const scene = makeLiveScene();
  RoadOverlay.drawLive(scene, [
    { pts: [{ x: 100, y: 200 }, { x: 110, y: 200 }], tags: { class: 'footway' } },
    { pts: [{ x: 100, y: 210 }, { x: 110, y: 210 }], tags: { class: 'street' }, colour: 0xffffff, alpha: 0.9 },
  ]);
  const g = scene._liveGfx;
  assert.eq(g.paths[0].style.c, RO_PATH_RESTORED, 'a footway defaults to the restored path colour');
  assert.eq(g.paths[0].style.w, px(2), 'at a footway\'s width');
  assert.eq(g.paths[1].style.c, 0xffffff, 'the restore shine names its own colour');
});

test('road overlay live: headless without a Graphics factory, nothing happens', () => {
  const scene = { cellM: 5, roadGeomContainer: null };
  RoadOverlay.drawLive(scene, [{ pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }], tags: {} }]);
  assert.falsy(scene.roadLiveGfx, 'no Graphics conjured out of nothing');
});

// ── THE RESTORED PATCH IS SOFT ────────────────────────────────────────────
// A rebuilt stretch is a repair, not a decal: its silhouette is feathered into
// the dilapidated band under it, and the round caps its ends carry read as a
// lozenge once the corners go soft. The feather is applied to the patch's
// ALPHA ONLY — blurring the drawn layer would smear the clean setts into grey,
// which is the one thing the restored look is for.
(() => {
// A 2D context stub with a REAL `filter` property (the Proxy recorder above
// answers every get with a function, so a feature test would see one).
function softCtx(withFilter = true) {
  const ops = [];
  const c = {
    ops,
    lineWidth: 1, strokeStyle: '', globalCompositeOperation: 'source-over',
    beginPath() { ops.push(['beginPath']); },
    moveTo(x, y) { ops.push(['moveTo', x, y]); },
    lineTo(x, y) { ops.push(['lineTo', x, y]); },
    stroke() { ops.push(['stroke', this.lineWidth, this.strokeStyle, this.filter]); },
    drawImage(img) { ops.push(['drawImage', img, this.globalCompositeOperation]); },
    save() { ops.push(['save']); },
    restore() { ops.push(['restore']); },
  };
  if (withFilter) {
    let f = 'none';
    Object.defineProperty(c, 'filter', {
      get: () => f,
      // A real canvas keeps only what it can parse; anything else is dropped.
      set: (v) => { ops.push(['set:filter', v]); f = /^(none|blur\(.+\))$/.test(v) ? v : f; },
    });
  }
  return c;
}

// Stand a canvas factory up for the length of `fn` — scratchLayer builds its
// mask through document.createElement, which the headless context has no
// implementation of.
function withCanvases(fn) {
  const made = [];
  const real = document.createElement;
  document.createElement = () => {
    const ctx2 = softCtx(withCanvases.filter !== false);
    const canvas = { width: 0, height: 0, ctx: ctx2, getContext: () => ctx2 };
    made.push(canvas);
    return canvas;
  };
  try { fn(made); return made; } finally { document.createElement = real; }
}

// Two bands of different widths — a carriageway and a footway — because the
// feather is derived from the width it softens.
const SOFT_OPS = [
  { w: 24, c: 0x161412, pts: [10, 10, 90, 10, 90, 60] },
  { w: 8,  c: 0x161412, pts: [20, 80, 100, 80] },
];

test('restored patch: the edge is feathered through a blurred ALPHA mask', () => {
  withCanvases.filter = true;
  const layer = { ctx: softCtx(), canvas: null };
  const made = withCanvases(() => {
    RoadOverlay.softenEdge(layer, 128, SOFT_OPS);
  });
  assert.eq(made.length, 1, 'one scratch canvas — the mask');
  const mask = made[0].ctx;
  const strokes = mask.ops.filter(([k]) => k === 'stroke');
  assert.eq(strokes.length, SOFT_OPS.length, 'every op is replayed onto the mask');
  for (let i = 0; i < SOFT_OPS.length; i++) {
    // AT FULL WIDTH — a Gaussian leaves its half-maximum on the original edge,
    // so the patch stays exactly as wide as the band it repairs.
    assert.eq(strokes[i][1], SOFT_OPS[i].w, 'stroked at the band\'s own width');
    assert.eq(strokes[i][2], '#000', 'in flat ink: this is a mask, not a colour');
    assert.eq(strokes[i][3], `blur(${RoadOverlay.blurForWidth(SOFT_OPS[i].w).toFixed(2)}px)`,
      'under its own radius');
  }
  // The RADIUS IS A FRACTION OF THE BAND. A fixed radius eats a narrow way
  // alive: at the blur a carriageway wants, a footpath's centre never reaches
  // full alpha and the whole path restores ghostly.
  assert.lt(RoadOverlay.blurForWidth(8), RoadOverlay.blurForWidth(24),
    'a footway is feathered less than a carriageway');
  assert.eq(RoadOverlay.blurForWidth(1000), RoadOverlay.RESTORED_BLUR_PX,
    'and a wide band is capped');
  // The narrow band keeps a solid core. Measured on a real canvas: past about
  // a third of the width the centre of a footway never reaches full alpha, and
  // the restored path reads ghostly rather than soft.
  assert.lte(RoadOverlay.RESTORED_BLUR_FRAC, 1 / 3, 'the fraction stays under a third');
  assert.eq(RoadOverlay.blurForWidth(8), 8 * RoadOverlay.RESTORED_BLUR_FRAC,
    'a narrow band is feathered by its own fraction, not the cap');
  // The filter is put back afterwards, so nothing else on that scratch
  // inherits it.
  const filters = mask.ops.filter(([k]) => k === 'set:filter').map((o) => o[1]);
  // The feature probe (blur(1px) then none — a canvas that cannot blur
  // silently keeps 'none', which is what the probe reads), then one set per
  // band width, then the clear.
  assert.eq(filters.slice(0, 2).join(','), 'blur(1px),none', 'the probe asks and puts it back');
  assert.eq(filters[filters.length - 1], 'none', 'and the filter is cleared at the end');
  assert.eq(filters.length, 2 + SOFT_OPS.length + 1, 'one pass per band width');
  // …and composited as ALPHA. destination-in keeps the layer's own pixels and
  // takes only the mask's coverage, so the setts inside stay crisp.
  const draw = layer.ctx.ops.find(([k]) => k === 'drawImage');
  assert.truthy(draw, 'the mask lands on the layer');
  assert.eq(draw[2], 'destination-in', 'as alpha, never as paint');
  assert.eq(draw[1], made[0], 'and it is the mask that lands');
});

test('restored patch: no blur available means a hard edge, never a fake feather', () => {
  // A stack of translucent strokes standing in for a blur would blotch at
  // every junction — a translucent stroke composites with ITSELF wherever a
  // path doubles back, which is the trap the whole opaque-then-alpha rule at
  // the top of road_overlay.js exists to avoid. So where canvas can't blur,
  // the patch simply ships with its edge cut.
  withCanvases.filter = false;
  const layer = { ctx: softCtx(false), canvas: null };
  withCanvases(() => { RoadOverlay.softenEdge(layer, 128, SOFT_OPS); });
  withCanvases.filter = true;
  assert.eq(layer.ctx.ops.filter(([k]) => k === 'drawImage').length, 0, 'nothing is composited');
});

test('restored patch: the softening is the LAST thing the pass does', () => {
  const src = ROAD_OVERLAY_SRC;
  const at = src.indexOf('function commitRestored(pass) {');
  assert.gt(at, 0, 'found the restored pass');
  const body = src.slice(at, src.indexOf('\n  }\n', at));
  // Crisp first, feathered last: the setts and the kerb are laid at full
  // opacity and only the finished silhouette is melted into the band.
  const soften = body.indexOf('softenEdge(');
  const lastFill = body.lastIndexOf('patternFill(');
  assert.gt(soften, 0, 'the pass softens its patch');
  assert.gt(soften, lastFill, 'after the setts are laid, never before');
  assert.gt(body.indexOf('ctx.drawImage(layer.canvas'), soften, 'and before the layer lands');
  // The base band keeps its ragged bites; only the restored patch is soft.
  const baseAt = src.indexOf('function commitBase(pass) {');
  const baseBody = src.slice(baseAt, src.indexOf('\n  }\n', baseAt));
  assert.falsy(/softenEdge\(/.test(baseBody), 'the dilapidated band is not feathered');
});
})();
