// Approved underground materials shared by the game and floor tools.
(function (global) {
  'use strict';
  // BEGIN GENERATED THEMES
  const THEMES = [{"id":"l1","label":"L1 \u00b7 Sewer","cap":[76,68,65],"face":0,"ground":1,"road":2,"groundBroken":3,"groundGrate":4},{"id":"l2","label":"L2 \u00b7 Natural caves","cap":[86,70,51],"face":5,"ground":6,"road":6},{"id":"l3","label":"L3 \u00b7 Goblin warrens","cap":[88,68,57],"face":7,"ground":8,"road":9},{"id":"l4","label":"L4 \u00b7 Dwarven stone","cap":[69,74,103],"face":10,"ground":11,"road":11},{"id":"l5","label":"L5 \u00b7 Fungal Underdark","cap":[82,51,72],"face":12,"ground":13,"road":13},{"id":"l6","label":"L6 \u00b7 Lava and demons","cap":[30,27,31],"face":14,"faceAccent":15,"ground":16,"road":17},{"id":"l7","label":"L7 \u00b7 Dragon temple","cap":[75,61,111],"face":18,"ground":19,"road":20}];
  // END GENERATED THEMES
  const CELL = 32, HEIGHT = 19, WIDTH = 512, ATLAS_HEIGHT = 160;
  const theme = depth => THEMES[Math.max(0, Math.min(THEMES.length - 1, Math.floor(depth) - 1))];
  function variant(depth, x, y) {
    const material = theme(depth);
    return material.faceAccent !== undefined
      ? avalanche32(fnv1a(`wall:${material.id}:${x},${y}`)) >>> 30
      : ((x * 31) ^ y) & 3;
  }
  function drawAtlas(g, original, depth, source) {
    const material = theme(depth), old = original.getContext('2d');
    g.imageSmoothingEnabled = false;
    for (let v = 0; v < 4; v++) {
      const tile = v === 0 && material.faceAccent !== undefined ? material.faceAccent : material.face;
      const base = old.getImageData(0, v * (CELL + CAVE_WALL_TOP_LIFT), CELL, CELL);
      for (let mask = 0; mask < 16; mask++) {
        const image = g.createImageData(CELL, CELL);
        for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
          const d = Math.min(mask & 1 ? y : CELL, mask & 2 ? CELL - 1 - x : CELL,
            mask & 4 ? CELL - 1 - y : CELL, mask & 8 ? x : CELL);
          const light = (1 - CAVE_WALL_TOP_FALLOFF * Math.min(1, d / (CELL * .38))) / (1 - CAVE_WALL_TOP_FALLOFF);
          const at = (y * CELL + x) * 4;
          for (let k = 0; k < 3; k++) image.data[at + k] = Math.round(base.data[at + k] * light * material.cap[k] / CAVE_WALL_TOP_RGB[k]);
          image.data[at + 3] = 255;
        }
        const dx = mask * CELL, dy = v * CELL;
        g.putImageData(image, dx, dy);
        const wrap = (vertical, edge, inward) => {
          for (let k = 0; k < 3; k++) for (let t = 0; t < CELL; t++) {
            const x = vertical ? edge + inward * k : t, y = vertical ? t : edge + inward * k;
            g.drawImage(source, tile * 16 + t % 16, 3 + k, 1, 1, dx + x, dy + y, 1, 1);
            g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(dx + x, dy + y, 1, 1);
          }
        };
        if (mask & 8) wrap(true, 0, 1);
        if (mask & 2) wrap(true, CELL - 1, -1);
        if (mask & 1) wrap(false, 0, 1);
        if (mask & 4) wrap(false, CELL - 1, -1);
      }
      // Native pixels repeat twice per 32px wall, as in the approved 50% trial.
      for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < CELL; x++)
        g.drawImage(source, tile * 16 + x % 16, y % 16, 1, 1, v * CELL + x, 128 + y, 1, 1);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(v * CELL, 128, CELL, HEIGHT);
      g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(v * CELL, 128 + HEIGHT - 3, CELL, 2);
      g.fillStyle = '#151310'; g.fillRect(v * CELL, 128 + HEIGHT - 1, CELL, 1);
    }
  }
  function prepare(scene, depth) {
    const key = 'floor-wall-' + theme(depth).id;
    if (scene.textures.exists(key)) return scene.textures.get(key);
    if (!scene.textures.exists('floor_wall_sources')) return null;
    makeCaveWallEdges(scene, CELL);
    const texture = scene.textures.createCanvas(key, WIDTH, ATLAS_HEIGHT);
    drawAtlas(texture.getContext(), scene.textures.get('cave_wall_edges').getSourceImage(), depth,
      scene.textures.get('floor_wall_sources').getSourceImage());
    texture.refresh();
    texture.setFilter?.(global.Phaser?.Textures?.FilterMode?.NEAREST ?? 1);
    return texture;
  }
  function prepareAll(scene) {
    for (let depth = 1; depth <= THEMES.length; depth++) prepare(scene, depth);
    prepareGround(scene);
  }
  // L1's actual water (including the water beneath pier decking) and decorative
  // route channels share one material. This never changes terrain or walkability.
  const SEWER_WATER = 'floor-sewer-water';
  // Stable world-cell dressing: 14/16 stone, 1/16 broken, 1/16 grate.
  function sewerGroundRole(x, y) {
    const pick = avalanche32(fnv1a(`sewer-ground:${x},${y}`)) & 15;
    return pick === 0 ? 'groundBroken' : pick === 1 ? 'groundGrate' : 'ground';
  }
  function isSewerChannel(entry, index, type = entry?.grid?.[index]) {
    return entry?.depth === 1 && type === global.WorldGen.T.CAVE_FLOOR
      && !!entry.underground?.lane?.has(index);
  }
  function groundTexture(entry, index, type = entry?.grid?.[index]) {
    if (entry?.depth !== 1) return null;
    const T = global.WorldGen.T;
    if (type === T.WATER || type === T.PIER
      || isSewerChannel(entry, index, type)) return SEWER_WATER;
    if (type !== T.CAVE_FLOOR) return null;
    const n = entry.cellsPerEdge || 1;
    const role = sewerGroundRole((entry.tx || 0) * n + index % n,
      (entry.ty || 0) * n + Math.floor(index / n));
    return 'floor-sewer-' + role;
  }
  function prepareGround(scene) {

    if (!scene.textures.exists('floor_wall_sources')) return null;
    const source = scene.textures.get('floor_wall_sources').getSourceImage();
    for (const role of ['ground', 'groundBroken', 'groundGrate']) {
      const key = 'floor-sewer-' + role;
      if (scene.textures.exists(key)) continue;
      const tile = scene.textures.createCanvas(key, CELL, CELL), g = tile.getContext();
      g.imageSmoothingEnabled = false;
      g.drawImage(source, theme(1)[role] * 16, 0, 16, 16, 0, 0, CELL, CELL);
      tile.refresh(); tile.setFilter?.(global.Phaser?.Textures?.FilterMode?.NEAREST ?? 1);
    }
    if (scene.textures.exists(SEWER_WATER)) return scene.textures.get(SEWER_WATER);
    const texture = scene.textures.createCanvas(SEWER_WATER, CELL, CELL);
    const g = texture.getContext(); g.imageSmoothingEnabled = false;
    for (let y = 0; y < CELL; y += 16) for (let x = 0; x < CELL; x += 16)
      g.drawImage(source, theme(1).road * 16, 0, 16, 16, x, y, 16, 16);
    texture.refresh();
    texture.setFilter?.(global.Phaser?.Textures?.FilterMode?.NEAREST ?? 1);
    return texture;
  }
  function quad(points, normal, rect, range = [0, 1], span = [0, 1]) {
    const [x, y, w, h] = rect;
    const uv = (u, v) => ({u: u / WIDTH, v: v / ATLAS_HEIGHT});
    const top = y + .5 + (h - 1) * range[0], bottom = y + .5 + (h - 1) * range[1];
    const left = x + .5 + (w - 1) * span[0], right = x + .5 + (w - 1) * span[1];
    const coords = [uv(left, top), uv(right, top), uv(right, bottom), uv(left, bottom)];
    const verts = points.map((p, i) => ({...p, ...coords[i]}));
    return [[0, 1, 2], [0, 2, 3]].map(indices => ({points: indices.map(i => verts[i]), normal, color: 0xffffff}));
  }
  // L1 keeps its entire profile within the original cell. A recessed face
  // joins the full crown through a shoulder, then a three-segment quarter pipe
  // returns to the original floor boundary. The same retained faces rotate with
  // the compass; visibility remains WallPerspective's responsibility.
  const SEWER_RADIUS = 3, SEWER_STEPS = 3;
  function geometry(points, mask, v, depth = 0, diagonalMask = 0) {
    const faces = [], curved = depth === 1;
    const normals = points.map((a, i) => {
      const b = points[(i + 1) % 4], dx = b.x - a.x, dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      return {x: dy / length, y: -dx / length};
    });
    const profile = [{z: HEIGHT, inset: 0}];
    if (curved) {
      profile.push({z: HEIGHT - SEWER_RADIUS, inset: SEWER_RADIUS});
      for (let step = 0; step <= SEWER_STEPS; step++) {
        const angle = step * Math.PI / (2 * SEWER_STEPS);
        profile.push({z: step === SEWER_STEPS ? 0 : SEWER_RADIUS * (1 - Math.sin(angle)),
          inset: step === SEWER_STEPS ? 0 : SEWER_RADIUS * Math.cos(angle)});
      }
    } else profile.push({z: 0, inset: 0});
    const distances = [0];
    for (let i = 1; i < profile.length; i++) distances.push(distances[i - 1]
      + Math.hypot(profile[i].z - profile[i - 1].z, profile[i].inset - profile[i - 1].inset));
    const total = distances[distances.length - 1];
    for (let i = 0; i < 4; i++) if (mask & (1 << i)) {
      const next = (i + 1) % 4, prev = (i + 3) % 4;
      const a = points[i], b = points[next], normal = normals[i];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      // A closed diagonal at a hidden adjoining side is an inside corner.
      // Pin that endpoint and taper the recess over 3px to close the junction.
      const pinA = curved && !(mask & (1 << prev)) && !!(diagonalMask & (1 << i));
      const pinB = curved && !(mask & (1 << next)) && !!(diagonalMask & (1 << next));
      const stops = [0, ...(pinA ? [SEWER_RADIUS / length] : []),
        ...(pinB ? [1 - SEWER_RADIUS / length] : []), 1];
      const vertex = (t, p) => {
        const factor = t === 0 && pinA || t === 1 && pinB ? 0 : 1;
        let nx = normal.x, ny = normal.y;
        const adjoining = t === 0 ? prev : t === 1 ? next : -1;
        if (adjoining >= 0 && (mask & (1 << adjoining))) {
          nx += normals[adjoining].x; ny += normals[adjoining].y;
        }
        return {x: a.x + (b.x - a.x) * t - nx * p.inset * factor,
          y: a.y + (b.y - a.y) * t - ny * p.inset * factor, z: p.z};
      };
      for (let j = 1; j < profile.length; j++) for (let k = 1; k < stops.length; k++) {
        const lo = stops[k - 1], hi = stops[k];
        const strip = quad([vertex(lo, profile[j - 1]), vertex(hi, profile[j - 1]),
          vertex(hi, profile[j]), vertex(lo, profile[j])], normal,
          [v * CELL, 128, CELL, HEIGHT], [distances[j - 1] / total, distances[j] / total], [lo, hi]);
        faces.push(...strip);
      }
    }
    faces.push(...quad(points.map(p => ({...p, z: HEIGHT})), null, [(mask & 15) * CELL, v * CELL, CELL, CELL]));
    return faces;
  }
  global.FloorWallMaterials = {theme, variant, prepare, prepareAll, drawAtlas, geometry,
    sewerGroundRole, isSewerChannel, groundTexture, prepareGround, height: HEIGHT};
})(typeof window !== 'undefined' ? window : globalThis);
