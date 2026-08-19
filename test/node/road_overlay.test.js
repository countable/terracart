// Headless tests for src/road_overlay.js — the black-@-30% overlay that draws
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
function makeGfx() {
  return {
    lines: [], cleared: 0, style: null,
    clear() { this.lines.length = 0; this.cleared++; },
    lineStyle(w, c, a) { this.style = { w, c, a }; },
    lineBetween(x1, y1, x2, y2) { this.lines.push([x1, y1, x2, y2]); },
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
// cellsPerTile = 512 → one cell is 5 m (WorldGen.CELL_M) and 0.5 world px.
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

test('road overlay: strokes black at 30% opacity', () => {
  clearTiles();
  putTile(0, 0, [line([{ x: 0, y: 0 }, { x: 16, y: 0 }])]);
  const scene = makeOverlayScene();
  RoadOverlay.draw(scene);
  assert.eq(scene.roadGeomGfx.style.c, 0x000000, 'colour is black');
  assert.eq(scene.roadGeomGfx.style.a, 0.30, 'alpha is 30%');
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
