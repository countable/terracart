// Headless tests for src/road_overlay.js — the brown-@-19% overlay that draws
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
    clear() { this.paths.length = 0; this.cleared++; },
    lineStyle(w, c, a) { this.style = { w, c, a }; },
    beginPath() { this._cur = { style: this.style, pts: [] }; },
    moveTo(x, y) { this._cur.pts.push({ x, y }); },
    lineTo(x, y) { this._cur.pts.push({ x, y }); },
    strokePath() { this.paths.push(this._cur); this._cur = null; },
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
function putTile(tx, ty, features) {
  const entry = {
    tileEdgeM: TILE_EDGE_M,
    layers: [
      { name: 'water', extent: 4096, features: [] },
      { name: 'transportation', extent: 4096, features },
    ],
  };
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

test('road overlay: strokes earth brown at 19% opacity', () => {
  clearTiles();
  putTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }])]);
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  const style = scene.roadGeomGfx.paths[0].style;
  assert.eq(style.c, 0x6b4a2f, 'colour is the earth brown');
  assert.eq(style.a, 0.19, 'alpha is 19%');
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

test('road overlay: a residential street is stroked at its real 5 m width', () => {
  assert.eq(widthOfWay({ class: 'street' }), px(5), 'street');
  assert.eq(widthOfWay({ class: 'minor' }), px(5), 'minor');
  // Which is a little under the one cell the rasterizer paints for it — the
  // game's cell is 7 m, so a residential street doesn't fill its own band.
  assert.lt(5, WorldGen.CELL_M, 'a street is narrower than a game cell');
});

test('road overlay: bigger classes are drawn wider, in real-world proportion', () => {
  assert.eq(widthOfWay({ class: 'motorway' }),  px(12), 'motorway');
  assert.eq(widthOfWay({ class: 'trunk' }),     px(12), 'trunk');
  assert.eq(widthOfWay({ class: 'primary' }),   px(10), 'primary');
  assert.eq(widthOfWay({ class: 'secondary' }),  px(8), 'secondary');
  assert.eq(widthOfWay({ class: 'tertiary' }),   px(7), 'tertiary');
  // A motorway is wider than a game cell — it spills past the single-cell band
  // the rasterizer gives it, which is the whole point of drawing true widths.
  assert.gt(12, WorldGen.CELL_M, 'a motorway is wider than a game cell');
});

test('road overlay: footways and cycleways are person-wide, not road-wide', () => {
  assert.eq(widthOfWay({ class: 'footway' }),  px(2), 'footway');
  assert.eq(widthOfWay({ class: 'path' }),     px(2), 'path');
  assert.eq(widthOfWay({ class: 'cycleway' }), px(2.5), 'cycleway');
  assert.lt(widthOfWay({ class: 'footway' }), widthOfWay({ class: 'street' }), 'thinner than a street');
});

test('road overlay: widths come from the rasterizer\'s own table', () => {
  // One source of truth — the overlay must not drift from WorldGen.roadWidthM.
  for (const cls of ['motorway', 'primary', 'secondary', 'tertiary', 'street',
                     'service', 'pedestrian', 'track', 'cycleway', 'footway', 'pier']) {
    assert.eq(widthOfWay({ class: cls }), px(WorldGen.roadWidthM({ class: cls })), cls);
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

test('road overlay: on by default, off when the save says so', () => {
  assert.truthy(RoadOverlay.isOn(makeOverlayScene()), 'default on');
  assert.truthy(RoadOverlay.isOn(makeOverlayScene({ save: { roadGeomOverlay: true } })), 'explicit on');
  assert.falsy(RoadOverlay.isOn(makeOverlayScene({ save: { roadGeomOverlay: false } })), 'explicit off');
});

test('road overlay: switched off draws nothing and hides the layer', () => {
  clearTiles();
  putTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }])]);
  const scene = makeOverlayScene({ save: { roadGeomOverlay: false } });
  RoadOverlay.draw(scene);
  assert.eq(scene.roadGeomGfx.lines.length, 0, 'nothing stroked');
  assert.falsy(scene.roadGeomContainer.visible, 'layer hidden');
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
