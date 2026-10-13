// Any ground variant may neighbour any other. A feature crossing an edge
// must continue into every variant, not only a repeat of its own texture.
(() => {
  const painters = new Function('lerp', TEXTURES_SRC + '\nreturn { drawForestTex, drawSandTex, drawWetlandTex, drawCastleFloorTex, seededRand };')(
    (a, b, t) => a + (b - a) * t);
  const size = 32;
  function draw(name, seed) {
    const arcs = [], strokes = [], rects = [];
    let path = [];
    const ctx = {
      clearRect() {}, beginPath() { path = []; },
      arc(x, y, r) { arcs.push({ x, y, r, ink: this.fillStyle }); }, fill() {},
      moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); },
      stroke() { strokes.push({ path, ink: this.strokeStyle, width: this.lineWidth }); },
      fillRect(x, y, w, h) { rects.push({ x, y, w, h, ink: this.fillStyle }); },
    };
    painters[name](ctx, size, typeof seed === 'function' ? seed : painters.seededRand(seed));
    return { arcs, strokes, rects };
  }
  const edgeArcs = arcs => arcs.filter(({ x, y, r }) => x - r < 1 || y - r < 1 || x + r > size - 1 || y + r > size - 1);
  for (const name of ['drawForestTex', 'drawWetlandTex']) {
    test(`ground seams: ${name} joins blobs across mixed variants`, () => {
      const first = draw(name, 7919);
      const border = edgeArcs(first.arcs);
      assert.gt(border.length, 0, 'some blobs cross the boundary, avoiding a bare grid');
      for (const seed of [1, 2, 1001, 7920, 0xffffffff]) {
        assert.eq(JSON.stringify(edgeArcs(draw(name, seed).arcs)), JSON.stringify(border),
          'every variant has the same boundary blobs including their ink');
      }
      for (const blob of border) {
        for (const [dx, dy] of [[-size, 0], [size, 0], [0, -size], [0, size]]) {
          const x = blob.x + dx, y = blob.y + dy, r = blob.r;
          if (x + r <= 0 || x - r >= size || y + r <= 0 || y - r >= size) continue;
          assert.truthy(first.arcs.some(a => Math.abs(a.x - x) < 1e-9 && Math.abs(a.y - y) < 1e-9 && a.r === r && a.ink === blob.ink),
            'the clipped part re-enters the opposite edge');
        }
      }
      assert.truthy(JSON.stringify(first.arcs) !== JSON.stringify(draw(name, 7920).arcs),
        'interior blobs still vary');
    });
  }
  for (const name of ['drawSandTex', 'drawWetlandTex']) {
    test(`ground seams: ${name} ripple paths meet their neighbours`, () => {
      const first = draw(name, 7919).strokes;
      assert.gt(first.length, 0, 'ripple paths remain visible');
      assert.eq(JSON.stringify(first), JSON.stringify(draw(name, 7920).strokes),
        'mixed variants share ripple geometry, width and ink');
      for (const { path, width } of first) {
        // Compare the full join: one sample before, on and after the edge.
        for (const x of [-1, 0, 1]) {
          const left = path.find(p => p[0] === x), right = path.find(p => p[0] === x + size);
          assert.truthy(left && right, 'path extends past the edge instead of ending at a cap');
          assert.inRange(left[1] - right[1], -1e-9, 1e-9, 'periodic join has no jump or kink');
        }
        for (const [, y] of path) assert.inRange(y, width / 2, size - width / 2, 'no ripple clips at top or bottom');
      }
    });
  }
  test('ground seams: castle joints have one quiet line with stronger corners', () => {
    for (let layout = 0; layout < 16; layout++) {
      let first = true;
      const { rects } = draw('drawCastleFloorTex', () => {
        if (!first) return 0.5;
        first = false;
        return layout / 0xffffffff;
      });
      const joints = rects.filter(r => r.w === 1 && r.h === 1);
      const pixels = new Set();
      for (const { x, y, ink } of joints) {
        assert.truthy(ink.startsWith('rgba(0,0,0,'), 'joints have no parallel highlight strip');
        assert.truthy(x % 16 === 0 || y % 16 === 0, 'each joint is only one pixel wide');
        const pixel = `${x},${y}`;
        assert.falsy(pixels.has(pixel), 'intersections paint once, avoiding doubled opacity');
        pixels.add(pixel);
      }
      const alpha = (x, y) => Number(joints.find(r => r.x === x && r.y === y).ink.split(',')[3].slice(0, -1));
      assert.lte(alpha(5, 0), 0.05, 'cell-boundary middles stay understated');
      assert.gt(alpha(0, 0), alpha(5, 0) * 4, 'corners retain the stone shape');
      assert.eq(rects.filter(r => r.w > 1 && r.h > 1).length, layout < 4 ? 3 : 4,
        'occasional joined pairs preserve mostly quarter-cell slabs');
    }
  });
  test('ground seams: marsh reeds fit entirely within the cell', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const { x, y, w, h } of draw('drawWetlandTex', seed).rects) {
        assert.inRange(x, 0, size - w, 'reed fits horizontally');
        assert.inRange(y, 0, size - h, 'reed fits vertically');
      }
    }
  });
})();
