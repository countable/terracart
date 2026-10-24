(function () {
  function fixture() {
    const previous = window.Phaser, draws = [], transforms = [];
    const image = { width: 64, height: 32 };
    const matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const camera = { x: 0, y: 0, width: 100, height: 100, alpha: .5, addToRenderList() {} };
    const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      clip() {}, fill() {}, transform(...args) { transforms.push(args); },
      drawImage(source) { draws.push({ source, alpha: this.globalAlpha }); } };
    window.Phaser = { GameObjects: { GetCalcMatrix() { return { calc: matrix }; } } };
    const target = { renderWebGL() {}, alpha: .5 };
    WallSurfaceRenderer.install({}, target, { getSourceImage: () => image });
    const face = { points: [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 0, v: 1 }] };
    return { target, image, face, camera, matrix, draws, transforms,
      paint(x = 0) { WallSurfaceRenderer.paint(target, x, 0, x + 32, 0, x, 16, 0xffffff, .5, face); },
      render() { target.renderCanvas({ currentContext: ctx }, target, camera); },
      close() { window.Phaser = previous; } };
  }
  test('wall surfaces: retained UV transforms survive pans and refresh for atlas dimensions', () => {
    const f = fixture();
    try {
      f.paint(); f.render();
      const first = f.target._wallTriangles[0].canvas;
      assert.eq(f.draws.length, 1); assert.eq(f.draws[0].alpha, .125, 'triangle, object and camera alpha multiply');
      assert.eq(first.matrix.join(','), '0.5,0,0,0.5,0,0');
      f.matrix.e = 10; f.render();
      assert.eq(f.target._wallTriangles[0].canvas, first, 'camera pan reuses local triangle preparation');
      f.image.width = 128; f.render();
      assert.eq(f.target._wallTriangles[0].canvas.matrix[0], .25, 'resizing an atlas changes its UV scale');
      assert.truthy(f.target._wallTriangles[0].canvas !== first);
      f.target._wallTriangles.length = 0; f.render();
      assert.eq(f.draws.length, 3, 'clearing commands leaves no cached stale geometry');
    } finally { f.close(); }
  });
  test('wall surfaces: heading repaint reuses commands without retaining stale paths or UV transforms', () => {
    const f = fixture();
    try {
      f.paint(); f.render();
      const command = f.target._wallTriangles[0], cache = command.canvas;
      f.target._wallTriangles.length = 0; f.paint(200); f.render();
      assert.eq(f.target._wallTriangles[0], command, 'ordinary wall commands are pooled');
      assert.truthy(command.canvas !== cache, 'repainting invalidates prepared path and bounds');
      assert.eq(f.draws.length, 1, 'the new offscreen geometry does not draw through stale bounds');
      f.target._fdrCanvasCoverage = true;
      f.target._wallTriangles.length = 0; f.paint();
      assert.truthy(f.target._wallTriangles[0] !== command, 'the FDR adapter retains identity-based cache invalidation');
    } finally { f.close(); }
  });
  test('wall surfaces: viewport rejection follows rotation and retains edge coverage', () => {
    const f = fixture();
    try {
      f.paint(200); f.render(); assert.eq(f.draws.length, 0, 'offscreen local triangles skip rasterization');
      assert.eq(f.target._wallTriangles[0].canvas.matrix, null, 'offscreen geometry skips UV preparation too');
      f.matrix.a = 0; f.matrix.b = 1; f.matrix.c = -1; f.matrix.d = 0; f.matrix.e = 30; f.matrix.f = -180;
      f.render(); assert.eq(f.draws.length, 1, 'rotating and translating an offscreen triangle into view draws it');
      assert.truthy(f.target._wallTriangles[0].canvas.matrix, 'entering view lazily prepares its texture transform');
      Object.assign(f.matrix, { a: 1, b: 0, c: 0, d: 1, e: -101, f: 0 });
      f.render(); assert.eq(f.draws.length, 2, 'triangle touching the viewport edge is retained');
      f.face.points[2] = f.face.points[1];
      f.target._wallTriangles.length = 0; f.paint(0); f.matrix.e = 0; f.render();
      assert.eq(f.draws.length, 2, 'degenerate UV triangles do not draw');
    } finally { f.close(); }
  });
})();
