// Approved underground materials shared by the game and floor tools.
(function (global) {
  'use strict';
  // BEGIN GENERATED THEMES
  const THEMES = [{"id":"l1","label":"L1 \u00b7 Sewer","cap":[76,68,65],"face":0,"ground":1,"road":2},{"id":"l2","label":"L2 \u00b7 Natural caves","cap":[86,70,51],"face":3,"ground":4,"road":4},{"id":"l3","label":"L3 \u00b7 Goblin warrens","cap":[88,68,57],"face":5,"ground":6,"road":7},{"id":"l4","label":"L4 \u00b7 Dwarven stone","cap":[69,74,103],"face":8,"ground":9,"road":9},{"id":"l5","label":"L5 \u00b7 Fungal Underdark","cap":[82,51,72],"face":10,"ground":11,"road":11},{"id":"l6","label":"L6 \u00b7 Lava and demons","cap":[30,27,31],"face":12,"faceAccent":13,"ground":14,"road":15},{"id":"l7","label":"L7 \u00b7 Dragon temple","cap":[75,61,111],"face":16,"ground":17,"road":18}];
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
  function groundTexture(entry, index, type = entry?.grid?.[index]) {
    if (entry?.depth !== 1) return null;
    const T = global.WorldGen.T;
    return type === T.WATER || type === T.PIER
      || (type === T.CAVE_FLOOR && entry.underground?.lane?.has(index))
      ? SEWER_WATER : null;
  }
  function prepareGround(scene) {
    if (scene.textures.exists(SEWER_WATER)) return scene.textures.get(SEWER_WATER);
    if (!scene.textures.exists('floor_wall_sources')) return null;
    const source = scene.textures.get('floor_wall_sources').getSourceImage();
    const texture = scene.textures.createCanvas(SEWER_WATER, CELL, CELL);
    const g = texture.getContext(); g.imageSmoothingEnabled = false;
    for (let y = 0; y < CELL; y += 16) for (let x = 0; x < CELL; x += 16)
      g.drawImage(source, theme(1).road * 16, 0, 16, 16, x, y, 16, 16);
    texture.refresh();
    texture.setFilter?.(global.Phaser?.Textures?.FilterMode?.NEAREST ?? 1);
    return texture;
  }
  function quad(points, normal, rect) {
    const [x, y, w, h] = rect;
    const uv = (u, v) => ({u: u / WIDTH, v: v / ATLAS_HEIGHT});
    const coords = [uv(x + .5, y + .5), uv(x + w - .5, y + .5),
      uv(x + w - .5, y + h - .5), uv(x + .5, y + h - .5)];
    const verts = points.map((p, i) => ({...p, ...coords[i]}));
    return [[0, 1, 2], [0, 2, 3]].map(indices => ({points: indices.map(i => verts[i]), normal, color: 0xffffff}));
  }
  function geometry(points, mask, v) {
    const faces = [];
    for (let i = 0; i < 4; i++) if (mask & (1 << i)) {
      const a = points[i], b = points[(i + 1) % 4], dx = b.x - a.x, dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      faces.push(...quad([{...a, z: HEIGHT}, {...b, z: HEIGHT}, {...b, z: 0}, {...a, z: 0}],
        {x: dy / length, y: -dx / length}, [v * CELL, 128, CELL, HEIGHT]));
    }
    faces.push(...quad(points.map(p => ({...p, z: HEIGHT})), null, [(mask & 15) * CELL, v * CELL, CELL, CELL]));
    return faces;
  }
  global.FloorWallMaterials = {theme, variant, prepare, prepareAll, drawAtlas, geometry,
    groundTexture, prepareGround, height: HEIGHT};
})(typeof window !== 'undefined' ? window : globalThis);
