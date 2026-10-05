// THE OVERLAY FRAME NAMES ONLY THE TILES IT CAN DRAW. The road and building
// canvases rebuild when their key moves, and the key named which of the 3x3
// tiles had their geometry — so every ring tile finishing its build repainted
// both (7-31 ms and 11-30 ms) though it lay a kilometre off-screen. The frame
// (coords.js overlayFrame) now takes only the tiles whose square, widened by
// OVERLAY_TILE_SLACK, reaches the padded view: those are both what the rebuild
// draws and what its key names, so the key still covers every input. The
// street-lamp pass waits only on tiles that could hold a lamp in its pad.
(() => {
  if (typeof CELL_PX === 'undefined') globalThis.CELL_PX = 32;
  const EDGE = 2560;                       // mPerPx 10 x 256 px
  const gfx = () => ({
    cleared: 0, paths: [], erased: [], _cur: null,
    clear() { this.cleared++; this.paths.length = 0; },
    lineStyle() {}, beginPath() { this._cur = []; }, moveTo() {}, lineTo() {},
    strokePath() { this.paths.push(this._cur); },
    texturePhase() {}, eraseRect() {},
  });
  const scene = (px, py) => ({
    startWorldM: { x: 0, y: 0 }, playerM: { x: px, y: py },
    mPerPx: 10, originPx: { x: 0, y: 0 }, cellM: 5, cellsPerTile: 512, tileEdgeM: EDGE,
    depth: 0, save: {},
    viewCenterX: 176, viewCenterY: 176, viewLeft: 0, viewTop: 0, viewSize: 352,
    roadGeomGfx: gfx(),
    roadGeomContainer: { setVisible() { return this; }, setPosition() { return this; } },
    playerToWorldCell() {
      const tilePx = WorldGen.TILE_PX;
      const wx = this.originPx.x + this.playerM.x / this.mPerPx;
      const wy = this.originPx.y + this.playerM.y / this.mPerPx;
      const tx = Math.floor(wx / tilePx), ty = Math.floor(wy / tilePx);
      const c = tilePx / this.cellsPerTile;
      return { tx, ty, cx: (wx - tx * tilePx) / c, cy: (wy - ty * tilePx) / c };
    },
  });
  const put = (tx, ty) => WorldGen.tileCache.set(WorldGen.tileKey(tx, ty), {
    tileEdgeM: EDGE,
    layers: [{ name: 'transportation', extent: 4096,
      features: [{ type: 2, tags: { class: 'residential' }, geom: [[{ x: 0, y: 2048 }, { x: 4096, y: 2048 }]] }] }],
  });
  const withCache = (fn) => {
    const had = new Map(WorldGen.tileCache);
    WorldGen.tileCache.clear();
    try { fn(); } finally {
      WorldGen.tileCache.clear();
      for (const [k, v] of had) WorldGen.tileCache.set(k, v);
    }
  };

  test('overlay frame: a ring tile far off-screen is not an input — its arrival repaints nothing', () => {
    withCache(() => {
      const s = scene(EDGE / 2, EDGE / 2);         // the middle of tile (0, 0)
      put(0, 0);
      RoadOverlay.draw(s);
      const key = s._roadGeomKey, n = s.roadGeomGfx.cleared;
      assert.eq(overlayFrame(s, (e) => !!e.layers).tiles.length, 1, 'only the centre tile reaches the view');
      for (const [tx, ty] of [[1, 0], [-1, 0], [0, 1], [1, 1], [-1, -1]]) put(tx, ty);
      RoadOverlay.draw(s);
      assert.eq(s._roadGeomKey, key, 'the key does not move');
      assert.eq(s.roadGeomGfx.cleared, n, 'and the canvas is not rebuilt');
    });
  });

  test('overlay frame: a tile the view DOES reach still repaints when it lands', () => {
    withCache(() => {
      const s = scene(EDGE - 20, EDGE / 2);       // 20 m from tile (1, 0)
      put(0, 0);
      RoadOverlay.draw(s);
      const key = s._roadGeomKey, n = s.roadGeomGfx.cleared;
      put(1, 0);
      RoadOverlay.draw(s);
      assert.truthy(s._roadGeomKey !== key, 'the key names the neighbour now in hand');
      assert.eq(s.roadGeomGfx.cleared, n + 1, 'and the canvas is rebuilt with it');
      assert.eq(overlayFrame(s, (e) => !!e.layers).tiles.length, 2, 'the two tiles the view reaches');
    });
  });

  test('overlay frame: every tile the view can reach is kept — nothing drawable is dropped', () => {
    const s = scene(EDGE / 2, EDGE / 2);
    for (let i = 0; i <= 40; i++) {
      // Walk the anchor across tile (0, 0) and past its edges: a tile whose
      // square (the MVT buffer aside) the padded view overlaps is always in.
      s.playerM.x = -EDGE * 0.05 + (EDGE * 1.1) * (i / 40);
      const a = viewAnchorWorldM(s);
      const halfM = (s.viewSize / 2 + CELL_PX * 3) / CELL_PX * s.cellM;
      for (const tx of [-1, 0, 1]) {
        const overlaps = a.x + halfM > tx * EDGE && a.x - halfM < (tx + 1) * EDGE;
        if (overlaps) assert.truthy(overlayTileInView(s, tx, 0), `tile ${tx} overlaps the view at x=${Math.round(a.x)}`);
      }
    }
    assert.truthy(overlayTileInView({}, 5, 5), 'a scene without a view keeps every tile');
  });

  test('street lamps: a loading ring tile out of reach no longer holds the memo open (source pin)', () => {
    const upd = SCENE_SRC.slice(SCENE_SRC.indexOf('  _updateStreetLamps() {'), SCENE_SRC.indexOf('  // THE RIPEN PASS.'));
    assert.truthy(/tileBoxReach\(E, tx, ty, c\.x - pad, c\.y - pad, c\.x \+ pad, c\.y \+ pad\)\) pending = true;/.test(upd),
      'pending only for a tile that could hold a lamp in the pad');
    const visit = SCENE_SRC.slice(SCENE_SRC.indexOf('  _visitStreetLamps(now) {'));
    assert.truthy(/tileBoxReach\(E, tx, ty, px - R, py - R, px \+ R, py \+ R\)\) pending = true;/.test(visit),
      'and the visit pass likewise');
  });
})();
