// Retained architectural prisms. Ground vertices follow the map camera;
// elevation is an inverse-rotated vector, so height always points screen-up.
// Phaser batches the explicit triangles through WebGL (Canvas also works).
// Only footprint/material changes allocate geometry; heading changes repaint
// one command buffer per source, without canvas textures or polygon tessellation.
(function (global) {
  const WallPerspective = {
    active(scene) {
      return !!scene._headingUp && (scene.depth ?? 0) === 0;
    },
    begin(scene, source) {
      if (!scene._wallPerspective) {
        scene._wallPerspective = {};
        scene.events?.once('shutdown', () => { scene._wallPerspective = null; });
      }
      let group = scene._wallPerspective[source];
      if (!group) {
        const gfx = scene.add.graphics();
        scene.buildingWallContainer.add(gfx);
        group = scene._wallPerspective[source] = { gfx, blocks: [], x: 0, y: 0 };
      }
      group.blocks.length = 0;
      group.alwaysActive = false;
      group.angle = NaN;
      return group;
    },
    // A footprint extruded between two elevations (convex when capped). Retain projected
    // coordinates too, avoiding temporary vertex objects during rotation.
    prism(scene, source, points, bottom, top, colors, support = null, capped = true, geometry = {}) {
      const group = scene._wallPerspective[source];
      // Match the padded overlay window. A city-sized footprint may intersect
      // the view while almost all of its perimeter is far away.
      if (Number.isFinite(scene.viewLeft) && Number.isFinite(scene.viewSize)) {
        const pad = CELL_PX * 2 + Math.max(Math.abs(bottom), Math.abs(top));
        let left = Infinity, right = -Infinity, north = Infinity, south = -Infinity;
        for (const p of points) {
          left = Math.min(left, p.x); right = Math.max(right, p.x);
          north = Math.min(north, p.y); south = Math.max(south, p.y);
        }
        if (right < scene.viewLeft - pad || left > scene.viewLeft + scene.viewSize + pad
          || south < scene.viewTop - pad || north > scene.viewTop + scene.viewSize + pad) return;
      }
      let area = 0, x = 0, y = 0;
      for (let i = 0; i < points.length; i++) {
        const p = points[i], q = points[(i + 1) % points.length];
        area += p.x * q.y - q.x * p.y; x += p.x; y += p.y;
      }
      if (Math.abs(area) < 1e-6) return;
      support ||= { x: x / points.length, y: y / points.length, order: group.blocks.length };
      group.blocks.push({ points, topPoints: geometry.topPoints || points, allFaces: !!geometry.allFaces, bottom, top, colors, support, capped, winding: Math.sign(area),
        x: x / points.length, y: y / points.length, order: group.blocks.length,
        faceOrder: Array.from({ length: points.length }, (_, i) => i), faceDepth: new Float64Array(points.length),
        projected: new Float64Array(points.length * 4) });
    },
    addSegment(scene, source, spec) {
      const { ax, ay, bx, by, height, thickness, face, top, dark } = spec;
      const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
      if (!length || !height || !thickness) return;
      const nx = spec.nx ?? -dy / length, ny = spec.ny ?? dx / length;
      const points = (lo, hi) => [
        { x: ax + dx * lo, y: ay + dy * lo },
        { x: ax + dx * hi, y: ay + dy * hi },
        { x: ax + dx * hi + nx * thickness, y: ay + dy * hi + ny * thickness },
        { x: ax + dx * lo + nx * thickness, y: ay + dy * lo + ny * thickness },
      ];
      const colors = { face, top, dark };
      // Keep this wall's crowns above its body sections, but below nearer
      // unrelated walls. Retain the shared ordering anchor across frames.
      const support = { x: (ax + bx + nx * thickness) / 2,
        y: (ay + by + ny * thickness) / 2,
        order: scene._wallPerspective[source].blocks.length };
      // Short sections keep painter ordering local on angled/concave rings.
      const sections = Math.max(1, Math.ceil(length / CELL_PX));
      for (let i = 0; i < sections; i++)
        this.prism(scene, source, points(i / sections, (i + 1) / sections), 0, height, colors, support);
      const width = spec.toothWidth;
      if (!width || !spec.toothHeight || length < width) return;
      const count = spec.merlons ?? Math.max(1, Math.round((length - width) / 8) + 1);
      const pitch = count > 1 ? (length - width) / (count - 1) : 0;
      for (let i = 0; i < count; i++) {
        if (spec.missing?.includes(i)) continue;
        this.prism(scene, source, points(i * pitch / length, Math.min(1, (i * pitch + width) / length)),
          height, height + spec.toothHeight, { ...colors, top: spec.crownTop ?? top }, support);
      }
    },
    finish(scene, source) {
      const group = scene._wallPerspective?.[source];
      if (group) group.angle = NaN;
      this.update(scene);
    },
    offset(scene, source, x, y) {
      const group = scene._wallPerspective?.[source];
      if (!group) return;
      group.x = x; group.y = y;
      group.gfx.setPosition(x, y);
    },
    clear(scene, source) {
      const group = scene._wallPerspective?.[source];
      if (group) { group.blocks.length = 0; group.alwaysActive = false; group.gfx.clear(); group.angle = NaN; }
    },
    update(scene) {
      const angle = scene.mapRot || 0, c = Math.cos(angle), s = Math.sin(angle);
      for (const group of Object.values(scene._wallPerspective || {})) {
        group.gfx.visible = this.active(scene) || (group.alwaysActive && (scene.depth ?? 0) === 0);
        if (!group.gfx.visible || group.angle === angle) continue;
        group.angle = angle;
        const g = group.gfx;
        g.clear();
        for (const block of group.blocks) {
          block.depth = s * block.x + c * block.y;
          block.support.depth = s * block.support.x + c * block.support.y;
        }
        group.blocks.sort((a, b) => a.support.depth - b.support.depth
          || a.support.order - b.support.order || a.bottom - b.bottom
          || a.depth - b.depth || a.order - b.order);
        // Heights foreshorten like the low-poly houses (BuildingLowPoly.LOOK),
        // and each wall run (one support) gets the same ink outline: its
        // visible triangles in ink at eight one-pixel offsets, then the fills.
        const look = global.BuildingLowPoly?.LOOK, k = look?.heightScale ?? 1;
        const inkPx = look?.inkPx || 0, ink = [];
        const flushInk = () => {
          if (!ink.length) return;
          g.fillStyle(look.ink, 1);
          for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]])
            for (const t of ink) g.fillTriangle(t[0] + ox * inkPx, t[1] + oy * inkPx, t[2] + ox * inkPx, t[3] + oy * inkPx, t[4] + ox * inkPx, t[5] + oy * inkPx);
          for (const t of ink) { g.fillStyle(t[6], 1); g.fillTriangle(t[0], t[1], t[2], t[3], t[4], t[5]); }
          ink.length = 0;
        };
        const tri = (x1, y1, x2, y2, x3, y3, color) => {
          if (inkPx) ink.push([x1, y1, x2, y2, x3, y3, color]);
          else { g.fillStyle(color, 1); g.fillTriangle(x1, y1, x2, y2, x3, y3); }
        };
        let run = null;
        for (const block of group.blocks) {
          const { points, topPoints, projected: v, bottom, top, colors, winding } = block;
          if (block.support !== run) { flushInk(); run = block.support; }
          for (let i = 0; i < points.length; i++) {
            const p = points[i], j = i * 4;
            v[j] = p.x - s * bottom * k; v[j + 1] = p.y - c * bottom * k;
            v[j + 2] = topPoints[i].x - s * top * k; v[j + 3] = topPoints[i].y - c * top * k;
          }
          if (block.allFaces) {
            for (let i = 0; i < points.length; i++) {
              const j = (i + 1) % points.length;
              block.faceDepth[i] = s * (points[i].x + points[j].x + topPoints[i].x + topPoints[j].x)
                + c * (points[i].y + points[j].y + topPoints[i].y + topPoints[j].y);
            }
            block.faceOrder.sort((a, b) => block.faceDepth[a] - block.faceDepth[b]);
          }
          for (const i of block.faceOrder) {
            const next = (i + 1) % points.length, a = points[i], b = points[next];
            // Only faces whose outward normal points toward screen-bottom.
            const screenDx = c * (b.x - a.x) - s * (b.y - a.y);
            if (!block.allFaces && screenDx * winding >= -1e-6) continue;
            const j = i * 4, n = next * 4, color = block.allFaces && screenDx * winding >= 0 ? colors.top : colors.face;
            tri(v[j], v[j + 1], v[n], v[n + 1], v[n + 2], v[n + 3], color);
            tri(v[j], v[j + 1], v[n + 2], v[n + 3], v[j + 2], v[j + 3], color);
          }
          if (!block.capped) continue;
          for (let i = 1; i < points.length - 1; i++) {
            const j = i * 4 + 2, n = (i + 1) * 4 + 2;
            tri(v[2], v[3], v[j], v[j + 1], v[n], v[n + 1], colors.top);
          }
        }
        flushInk();
      }
    },
  };
  global.WallPerspective = WallPerspective;
})(window);
