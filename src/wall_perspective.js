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
      group.blocks.length = 0; group.runs = null;
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
      group.runs = null;
      group.blocks.push({ building: group.building || null, points, topPoints: geometry.topPoints || points, allFaces: !!geometry.allFaces, bottom, top, colors, support, capped, winding: Math.sign(area),
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
      if (group) { group.blocks.length = 0; group.runs = null; group.alwaysActive = false; group.gfx.clear(); group.angle = NaN; }
    },
    update(scene) {
      const angle = scene.mapRot || 0, c = Math.cos(angle), s = Math.sin(angle);
      for (const group of Object.values(scene._wallPerspective || {})) {
        group.gfx.visible = this.active(scene) || (group.alwaysActive && (scene.depth ?? 0) === 0);
        if (!group.gfx.visible) continue;
        const player = scene.player, feet = scene.playerScreen?.();
        const visibilityKey = [angle, group.x, group.y, feet?.x, feet?.y,
          player?.visible, player?.x, player?.y, player?.displayWidth, player?.displayHeight, scene.save?.starterShopId].join(',');
        if (group.angle === angle && group.visibilityKey === visibilityKey) continue;
        const geometryChanged = group.angle !== angle;
        group.angle = angle; group.visibilityKey = visibilityKey;
        const g = group.gfx;
        for (const block of group.blocks) {
          block.depth = s * block.x + c * block.y;
          block.support.depth = s * block.support.x + c * block.support.y;
        }
        group.blocks.sort((a, b) => a.support.depth - b.support.depth
          || a.support.order - b.support.order || a.bottom - b.bottom
          || a.depth - b.depth || a.order - b.order);
        // Heights foreshorten like the low-poly houses (BuildingLowPoly.LOOK).
        const look = global.BuildingLowPoly?.LOOK, k = look?.heightScale ?? 1, inkPx = look?.inkPx || 0;
        for (const block of group.blocks) {
          const { points, topPoints, projected: v, bottom, top } = block;
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
        }
        // The visible triangles of one block, in draw order: sides, then the cap.
        const faces = (block, emit) => {
          const { points, projected: v, colors, winding } = block;
          for (const i of block.faceOrder) {
            const next = (i + 1) % points.length, a = points[i], b = points[next];
            // Only faces whose outward normal points toward screen-bottom.
            const screenDx = c * (b.x - a.x) - s * (b.y - a.y);
            if (!block.allFaces && screenDx * winding >= -1e-6) continue;
            const j = i * 4, n = next * 4, color = block.allFaces && screenDx * winding >= 0 ? colors.top : colors.face;
            emit(v[j], v[j + 1], v[n], v[n + 1], v[n + 2], v[n + 3], color);
            emit(v[j], v[j + 1], v[n + 2], v[n + 3], v[j + 2], v[j + 3], color);
          }
          if (!block.capped) return;
          for (let i = 1; i < points.length - 1; i++) {
            const j = i * 4 + 2, n = (i + 1) * 4 + 2;
            emit(v[2], v[3], v[j], v[j + 1], v[n], v[n + 1], colors.top);
          }
        };
        // Evaluate all visible wall triangles together so a whole building
        // fades consistently, including its battlements, when it hides a player.
        const buildings = new Map();
        for (const block of group.blocks) if (block.building) {
          let triangles = buildings.get(block.building);
          if (!triangles) buildings.set(block.building, triangles = []);
          faces(block, (x1,y1,x2,y2,x3,y3) => triangles.push([{x:x1,y:y1},{x:x2,y:y2},{x:x3,y:y3}]));
        }
        for (const [building, triangles] of buildings) building.alpha = typeof Render === 'undefined' || !Render.buildingFadeAlpha ? 1 : Render.buildingFadeAlpha(scene,
          building.key, building.footprint, triangles, building.anchor, {x:group.x,y:group.y});
        const alphaKey = [...buildings.keys()].map(b=>b.alpha).join(',');
        if (!geometryChanged && group.alphaKey === alphaKey) continue;
        group.alphaKey = alphaKey;
        g.clear();
        // The ink outline is drawn once per connected run — every block that
        // shares a ground vertex or a wall's support, so a ring of wall
        // sections and the teeth standing on it carry one outer outline with
        // no seams between them — before the first fill of that run.
        if (inkPx && !group.runs) group.runs = this.connectedRuns(group.blocks);
        const inked = new Set();
        for (const block of group.blocks) {
          if (inkPx) {
            const run = group.runs.get(block);
            if (!inked.has(run)) {
              inked.add(run);
              for (const other of run) faces(other, (x1, y1, x2, y2, x3, y3) => {
                g.fillStyle(look.ink, other.building?.alpha ?? 1);
                for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]])
                  g.fillTriangle(x1 + ox * inkPx, y1 + oy * inkPx, x2 + ox * inkPx, y2 + oy * inkPx, x3 + ox * inkPx, y3 + oy * inkPx);
              });
            }
          }
          faces(block, (x1, y1, x2, y2, x3, y3, color) => { g.fillStyle(color, block.building?.alpha ?? 1); g.fillTriangle(x1, y1, x2, y2, x3, y3); });
        }
      }
    },
    // Blocks joined by a shared ground vertex (at any level, so merlons join
    // the wall under them) or by one wall's support, as a Map from block to
    // its run (an array of blocks). Computed once per rebuild.
    connectedRuns(blocks) {
      const parent = blocks.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
      const seen = new Map(), supports = new Map();
      blocks.forEach((block, i) => {
        for (const p of block.points) {
          const key = p.x.toFixed(2) + ',' + p.y.toFixed(2);
          if (seen.has(key)) parent[find(i)] = find(seen.get(key)); else seen.set(key, i);
        }
        if (block.support) {
          if (supports.has(block.support)) parent[find(i)] = find(supports.get(block.support)); else supports.set(block.support, i);
        }
      });
      const runs = new Map(), byRoot = new Map();
      blocks.forEach((block, i) => {
        const root = find(i);
        if (!byRoot.has(root)) byRoot.set(root, []);
        byRoot.get(root).push(block); runs.set(block, byRoot.get(root));
      });
      return runs;
    },
  };
  global.WallPerspective = WallPerspective;
})(window);
