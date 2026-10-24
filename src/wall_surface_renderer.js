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
  // Wall commands repaint when their geometry changes. Retain their
  // Canvas path and UV transform for all intervening camera/player frames.
  function canvasBounds(t, image) {
    let cached = t.canvas;
    if (cached && !cached.dirty && cached.width === image.width && cached.height === image.height) return cached;
    const [a, b, c] = t.points;
    cached = t.canvas = { width: image.width, height: image.height,
      left: Math.min(a.x, b.x, c.x), right: Math.max(a.x, b.x, c.x),
      top: Math.min(a.y, b.y, c.y), bottom: Math.max(a.y, b.y, c.y),
      ready: false, path: null, matrix: null };
    return cached;
  }
  function prepareCanvasTriangle(t, image, cached) {
    if (cached.ready) return;
    cached.ready = true;
    cached.fill = '#' + t.color.toString(16).padStart(6, '0');
    const [a, b, c] = t.points;
    if (typeof Path2D !== 'undefined') {
      const path = cached.path = new Path2D();
      path.moveTo(a.x, a.y); path.lineTo(b.x, b.y); path.lineTo(c.x, c.y); path.closePath();
    }
    if (t.uv) {
      const [u, v, w] = t.uv, width = image.width, height = image.height;
      const u0 = u.u * width, u1 = u.v * height;
      const ux = v.u * width - u0, uy = v.v * height - u1;
      const vx = w.u * width - u0, vy = w.v * height - u1;
      const det = ux * vy - uy * vx;
      if (Math.abs(det) >= 1e-9) {
        const ax = b.x - a.x, ay = b.y - a.y, bx = c.x - a.x, by = c.y - a.y;
        const m0 = (ax * vy - bx * uy) / det, m1 = (ay * vy - by * uy) / det;
        const m2 = (bx * ux - ax * vx) / det, m3 = (by * ux - ay * vx) / det;
        cached.matrix = [m0, m1, m2, m3,
          a.x - m0 * u0 - m2 * u1,
          a.y - m1 * u0 - m3 * u1];
      }
    }
    return cached;
  }
  function outsideCamera(t, m, camera) {
    if (!(camera.width > 0 && camera.height > 0)) return false;
    const x = (t.left + t.right) / 2, y = (t.top + t.bottom) / 2;
    const hx = (t.right - t.left) / 2, hy = (t.bottom - t.top) / 2;
    const cx = m.a * x + m.c * y + m.e, cy = m.b * x + m.d * y + m.f;
    const rx = Math.abs(m.a) * hx + Math.abs(m.c) * hy;
    const ry = Math.abs(m.b) * hx + Math.abs(m.d) * hy;
    // Leave an antialiasing fringe; transform the full local bounds so this
    // remains conservative for rotation, reflection, and nonuniform scale.
    return cx + rx < camera.x - 2 || cx - rx > camera.x + camera.width + 2
      || cy + ry < camera.y - 2 || cy - ry > camera.y + camera.height + 2;
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
        const cached = canvasBounds(t, image);
        if (outsideCamera(cached, matrix, camera)) continue;
        prepareCanvasTriangle(t, image, cached);
        g.globalAlpha = t.alpha * src.alpha * camera.alpha;
        if (!cached.path) {
          const [a, b, c] = t.points;
          g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.closePath();
        }
        if (!t.uv) {
          g.fillStyle = cached.fill;
          if (cached.path) g.fill(cached.path); else g.fill();
          continue;
        }
        if (!cached.matrix) continue;
        g.save();
        if (cached.path) g.clip(cached.path); else g.clip();
        g.transform(...cached.matrix);
        g.drawImage(canvasSource(src._wallAtlas, t.color), 0, 0); g.restore();
      }
      g.restore();
    };
    if (texture.key === 'fdr_castle_atlas') global.FDRCastleCanvas?.attach(target);
  }
  function paint(target, x1, y1, x2, y2, x3, y3, color, alpha, face) {
    if (target._wallTriangles) {
      // Heading changes repaint the same retained command list. Reuse its
      // records rather than allocating three points per triangle per frame.
      // The FDR adapter keys its edge cache by record identity, so it retains
      // the replacement-record behavior that invalidates that separate cache.
      const pool = target._wallTrianglePool ||= [];
      const i = target._wallTriangles.length;
      let t = !target._fdrCanvasCoverage && pool[i];
      if (!t) t = pool[i] = { points: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }] };
      t.points[0].x = x1; t.points[0].y = y1;
      t.points[1].x = x2; t.points[1].y = y2;
      t.points[2].x = x3; t.points[2].y = y3;
      t.uv = face?.points; t.color = face ? (face.color ?? 0xffffff) : color; t.alpha = alpha;
      if (t.canvas) t.canvas.dirty = true;
      target._wallTriangles.push(t);
    }
    else { target.fillStyle(face?.flatColor ?? color, alpha); target.fillTriangle(x1, y1, x2, y2, x3, y3); }
  }
  global.WallSurfaceRenderer = { install, paint };
})(window);
