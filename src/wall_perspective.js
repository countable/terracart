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
    // THE SORT POINT OF A WALL against the player (the shared world sort:
    // render.js sortWorldDepth, heading_up.js' turned key s·x + c·y). A wall
    // is a slab standing on its baseline, so against a billboard at `at` it
    // orders by the baseline's depth AT THE PLAYER'S SCREEN COLUMN: the point
    // of the baseline sharing the player's across-screen coordinate
    // (c·x − s·y, perpendicular to the depth key), clamped to the wall's ends,
    // re-asked every frame. One fixed point for a whole wall (an end, a
    // centroid) cannot order a long or diagonal wall — the player in front of
    // its middle drew behind it at most headings (owner, Oct 2026). A wall
    // seen end-on (no across extent), or with no player to ask, takes the end
    // lowest on screen. BuildingLowPoly.wallSupport and the per-wall parts
    // below both ask this.
    wallSortPoint(a, b, angle, at) {
      const s = Math.sin(angle), c = Math.cos(angle);
      if (at) {
        const ua = c * a.x - s * a.y, ub = c * b.x - s * b.y, du = ub - ua;
        if (Math.abs(du) > 1e-6) {
          const t = Math.max(0, Math.min(1, ((c * at.x - s * at.y) - ua) / du));
          return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        }
      }
      const p = s * a.x + c * a.y >= s * b.x + c * b.y ? a : b;
      return { x: p.x, y: p.y };
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
        group = scene._wallPerspective[source] = { gfx, blocks: [], x: 0, y: 0, parts: [], perWall: false, mode: null };
      }
      group.blocks.length = 0; group.runs = null; group.buildings = null;
      group.alwaysActive = false;
      // PER WALL (Home's interior without the low-poly path): every block
      // draws into a part of its own in the world container, sorted against
      // the player at its wallSortPoint — see update and worldPieces. The
      // caller sets it after begin (building_overlay.js homeWalls).
      group.perWall = false;
      group.angle = NaN;
      return group;
    },
    // One per-wall part: a graphics object of the world sort's own
    // (`_worldGeometry`, like BuildingLowPoly's: never counter-rotated, its
    // `_huAnchor` the foot the turned sort reads).
    _part(scene) {
      const part = scene.add.graphics();
      part._worldGeometry = true;
      part._huAnchor = { x: 0, y: 0 };
      (scene.worldContainer || scene.buildingWallContainer).add(part);
      return part;
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
        segment: geometry.segment || null,   // the wall baseline this block stands on (addSegment), for its sort point
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
      for (let i = 0; i < sections; i++) {
        const lo = i / sections, hi = (i + 1) / sections;
        this.prism(scene, source, points(lo, hi), 0, height, colors, support, true,
          { segment: { ax: ax + dx * lo, ay: ay + dy * lo, bx: ax + dx * hi, by: ay + dy * hi } });
      }
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
      if (!group) return;
      group.blocks.length = 0; group.runs = null; group.buildings = null; group.alwaysActive = false; group.gfx.clear(); group.angle = NaN;
      group.perWall = false;
      for (const part of group.parts || []) if (part.visible) { part.visible = false; part.clear(); }
    },
    update(scene) {
      const angle = scene.mapRot || 0, c = Math.cos(angle), s = Math.sin(angle);
      for (const group of Object.values(scene._wallPerspective || {})) {
        group.gfx.visible = this.active(scene) || (group.alwaysActive && (scene.depth ?? 0) === 0);
        if (!group.gfx.visible) continue;
        const player = scene.player, feet = scene.playerScreen?.();
        const visibilityKey = [angle, group.x, group.y, feet?.x, feet?.y, group.perWall,
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
        group.buildings = buildings;
        for (const [building, triangles] of buildings) building.alpha = typeof Render === 'undefined' || !Render.buildingFadeAlpha ? 1 : Render.buildingFadeAlpha(scene,
          building.key, building.footprint, triangles, building.anchor, {x:group.x,y:group.y});
        const alphaKey = [...buildings.keys()].map(b=>b.alpha).join(',');
        const ink = (target, block) => { if (!inkPx) return;
          faces(block, (x1, y1, x2, y2, x3, y3) => {
            target.fillStyle(look.ink, block.building?.alpha ?? 1);
            for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]])
              target.fillTriangle(x1 + ox * inkPx, y1 + oy * inkPx, x2 + ox * inkPx, y2 + oy * inkPx, x3 + ox * inkPx, y3 + oy * inkPx);
          }); };
        const fill = (target, block) => faces(block, (x1, y1, x2, y2, x3, y3, color) => { target.fillStyle(color, block.building?.alpha ?? 1); target.fillTriangle(x1, y1, x2, y2, x3, y3); });
        const mode = group.perWall ? 'parts' : 'gfx', modeChanged = group.mode !== mode;
        group.mode = mode;
        if (group.perWall) {
          // ONE PART PER BLOCK, each anchored at its wall's sort point against
          // the player (wallSortPoint, in the group's space), every frame the
          // player or the heading moves; the shared world sort then seats the
          // player between the walls behind and the walls in front. The
          // group's own graphics stays empty meanwhile.
          const local = feet ? { x: feet.x - group.x, y: feet.y - group.y } : null;
          group.blocks.forEach((block, i) => {
            const part = group.parts[i] || (group.parts[i] = this._part(scene));
            const seg = block.segment;
            const p = seg ? this.wallSortPoint({ x: seg.ax, y: seg.ay }, { x: seg.bx, y: seg.by }, angle, local) : { x: block.x, y: block.y };
            part._huAnchor.x = p.x + group.x; part._huAnchor.y = p.y + group.y;
            part.visible = true; part.setPosition(group.x, group.y);
          });
          for (let i = group.blocks.length; i < group.parts.length; i++) { const part = group.parts[i]; if (part.visible) { part.visible = false; part.clear(); } }
          if (!geometryChanged && !modeChanged && group.alphaKey === alphaKey) continue;
          group.alphaKey = alphaKey;
          g.clear();
          group.blocks.forEach((block, i) => { const part = group.parts[i]; part.clear(); ink(part, block); fill(part, block); });
          continue;
        }
        for (const part of group.parts) if (part.visible) { part.visible = false; part.clear(); }
        if (!geometryChanged && !modeChanged && group.alphaKey === alphaKey) continue;
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
              for (const other of run) ink(g, other);
            }
          }
          fill(g, block);
        }
      }
    },
    // The per-wall parts as pieces of the shared world sort (render.js
    // drawObjects' zList, beside BuildingLowPoly.worldPieces): each part's
    // ground depth in world metres, off its anchor.
    worldPieces(scene) {
      const out = [], groups = scene._wallPerspective;
      if (!groups || (scene.depth ?? 0) !== 0) return out;
      this.update(scene);
      const anchor = typeof viewAnchorWorldM === 'function' ? viewAnchorWorldM(scene) : null;
      for (const group of Object.values(groups)) {
        if (!group.perWall || !group.gfx.visible) continue;
        group.blocks.forEach((block, i) => {
          const part = group.parts[i];
          if (!part) return;
          out.push({ sprite: part, rank: 1, layer: typeof WorldLayers === 'undefined' ? undefined : WorldLayers.STANDING_PROP,
            groundY: anchor ? anchor.y + (part._huAnchor.y - scene.viewCenterY) * scene.cellM / CELL_PX : part._huAnchor.y });
        });
      }
      return out;
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
