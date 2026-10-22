// Shared textured triangle adapter for retained walls. One atlas per texture
// manager, one command list per Graphics; rotation uploads vertices, not pixels.
(function (global) {
  // Canvas has no vertex tint. Cache shared material-color variants (not
  // per-wall bakes), including unclaimed palettes, for parity with WebGL.
  function canvasSource(texture, color) {
    const original = texture.getSourceImage();
    if (color === 0xffffff) return original;
    texture._wallTintSources ||= new Map();
    if (texture._wallTintSources.has(color)) return texture._wallTintSources.get(color);
    const canvas = document.createElement('canvas');
    canvas.width = original.width; canvas.height = original.height;
    const g = canvas.getContext('2d');
    g.drawImage(original, 0, 0); g.globalCompositeOperation = 'multiply';
    g.fillStyle = '#' + color.toString(16).padStart(6, '0'); g.fillRect(0, 0, canvas.width, canvas.height);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(original, 0, 0);
    texture._wallTintSources.set(color, canvas);
    return canvas;
  }
  function install(scene, target, atlas) {
    if (atlas) target._wallAtlas = atlas;
    if (target._wallTriangles) {
      if (target._wallAtlas?.key === 'fdr_castle_atlas') global.FDRCastleCanvas?.attach(target);
      return;
    }
    if (typeof target.renderWebGL !== 'function') return;
    const texture = atlas || WallMaterials.prepare(scene);
    if (!texture) return;
    target._wallTriangles = [];
    target._wallAtlas = texture;
    target.renderWebGL = function (renderer, src, camera, parentMatrix) {
      camera.addToRenderList(src);
      const matrix = Phaser.GameObjects.GetCalcMatrix(src, camera, parentMatrix).calc;
      const pipeline = renderer.pipelines.set(renderer.pipelines.get('MultiPipeline'), src);
      renderer.pipelines.preBatch(src);
      const atlas = src._wallAtlas;
      for (const t of src._wallTriangles) {
        if (pipeline.shouldFlush(3)) pipeline.flush();
        const unit = pipeline.setTexture2D(atlas.source[0].glTexture);
        const tint = Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha(t.color, t.alpha * src.alpha * camera.alpha);
        for (let i = 0; i < 3; i++) {
          const p = t.points[i], uv = t.uv?.[i] || WallMaterials.WHITE;
          pipeline.batchVert(matrix.getX(p.x, p.y), matrix.getY(p.x, p.y), uv.u, uv.v, unit, 0, tint);
        }
      }
      renderer.pipelines.postBatch(src);
    };
    target.renderCanvas = function (renderer, src, camera, parentMatrix) {
      camera.addToRenderList(src);
      const matrix = Phaser.GameObjects.GetCalcMatrix(src, camera, parentMatrix).calc;
      const g = renderer.currentContext, image = src._wallAtlas.getSourceImage();
      g.save();
      g.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
      g.imageSmoothingEnabled = false;
      for (const t of src._wallTriangles) {
        g.globalAlpha = t.alpha * src.alpha * camera.alpha;
        const [a, b, c] = t.points;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.closePath();
        if (!t.uv) { g.fillStyle = '#' + t.color.toString(16).padStart(6, '0'); g.fill(); continue; }
        const [u, v, w] = t.uv.map(p => ({ x: p.u * image.width, y: p.v * image.height }));
        const ux = v.x - u.x, uy = v.y - u.y, vx = w.x - u.x, vy = w.y - u.y;
        const det = ux * vy - uy * vx;
        if (Math.abs(det) < 1e-9) continue;
        const ax = b.x - a.x, ay = b.y - a.y, bx = c.x - a.x, by = c.y - a.y;
        const m0 = (ax * vy - bx * uy) / det, m1 = (ay * vy - by * uy) / det;
        const m2 = (bx * ux - ax * vx) / det, m3 = (by * ux - ay * vx) / det;
        g.save(); g.clip();
        g.transform(m0, m1, m2, m3, a.x - m0 * u.x - m2 * u.y, a.y - m1 * u.x - m3 * u.y);
        g.drawImage(canvasSource(src._wallAtlas, t.color), 0, 0); g.restore();
      }
      g.restore();
    };
    if (texture.key === 'fdr_castle_atlas') global.FDRCastleCanvas?.attach(target);
  }
  function paint(target, x1, y1, x2, y2, x3, y3, color, alpha, face) {
    if (target._wallTriangles) target._wallTriangles.push({
      points: [{ x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }],
      uv: face?.points, color: face ? (face.color ?? 0xffffff) : color, alpha,
    });
    else { target.fillStyle(face?.flatColor ?? color, alpha); target.fillTriangle(x1, y1, x2, y2, x3, y3); }
  }
  global.WallSurfaceRenderer = { install, paint };
})(window);
