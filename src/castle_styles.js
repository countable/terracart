// One material family for each castle's tower, ramparts and courtyard.
// Identity is stable across tile loads; restoration changes its condition only.
(function (global) {
  const variants = [
    { id: 'citadel', name: 'Citadel', floor: 0xaaa7a4,
      stone: { LITE: 0xc4c0bb, BODY: 0x999795, FACE: 0x858487, SIDE: 0x797a80, SHADOW: 0x5b5d67, DARK: 0x393d49 },
      rampart: { merlons: 4, toothWidth: 4, toothHeight: 4, wallHeight: 8 } },
    { id: 'ruin', name: 'Weathered Ruin', floor: 0xa6a087,
      stone: { LITE: 0xbdb9a4, BODY: 0x959a85, FACE: 0x858c79, SIDE: 0x747e6c, SHADOW: 0x596957, DARK: 0x384b3f },
      rampart: { merlons: 4, toothWidth: 4, toothHeight: 3, wallHeight: 7, broken: true } },
    { id: 'bastion', name: 'Intact Bastion', guards: false, floor: 0xc3b597,
      stone: { LITE: 0xd4cbb7, BODY: 0xb7aa91, FACE: 0xa2977f, SIDE: 0x968b77, SHADOW: 0x756d5d, DARK: 0x4f4a41 },
      rampart: { merlons: 4, toothWidth: 5, toothHeight: 4, wallHeight: 8 } },
    { id: 'archive', name: 'Old Archive Court', floor: 0xb3a88c,
      stone: { LITE: 0xc6bca5, BODY: 0xa49c88, FACE: 0x928b7b, SIDE: 0x827e72, SHADOW: 0x656559, DARK: 0x444a43 },
      rampart: { merlons: 4, toothWidth: 4, toothHeight: 3, wallHeight: 8, woodTop: true } },
  ];
  const wood = { LITE: 0xc2a16b, BODY: 0x967549, FACE: 0x80613e, SHADOW: 0x624e37, DARK: 0x423b2d };
  const ids = variants.map(v => v.id);
  const cache = new Map();
  function variantFor(key) {
    if (ids.includes(key)) return key;
    let h = 0x811c9dc5;
    for (const ch of String(key || 'castle')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
    return ids[(h >>> 0) % ids.length];
  }
  // A shared, pure condition treatment, already baked into every returned
  // colour. Callers must not apply the general building wash a second time.
  function weathered(c) {
    const r = c >> 16, g = (c >> 8) & 255, b = c & 255;
    return (Math.round(r * 0.65 + 10) << 16) | (Math.round(g * 0.68 + 10) << 8) | Math.round(b * 0.64 + 9);
  }
  function get(keyOrVariant, claimed = true) {
    const id = variantFor(keyOrVariant), key = `${id}:${claimed ? 1 : 0}`;
    if (cache.has(key)) return cache.get(key);
    const source = variants.find(v => v.id === id);
    const paint = c => claimed ? c : weathered(c);
    const palette = p => Object.freeze(Object.fromEntries(Object.entries(p).map(([k, c]) => [k, paint(c)])));
    const value = Object.freeze({ id, name: source.name, guards: source.guards !== false, floor: paint(source.floor),
      stone: palette(source.stone), wood: palette(wood),
      rampart: Object.freeze({ woodTop: false, broken: false, ...source.rampart }),
      towerFrame: ids.indexOf(id) });
    cache.set(key, value);
    return value;
  }
  // Source-ring placements shared by the tiled and polygon floor passes.
  // They never enter world objects, collision, interaction or spawn budgets.
  const columnCache = new WeakMap();
  function columnSites(key, ring, cellM) {
    if (variantFor(key) !== 'ruin' || !ring || !(cellM > 0)) return [];
    const cached = columnCache.get(ring);
    if (cached && cached.key === key && cached.cellM === cellM) return cached.sites;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, area = 0;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      left = Math.min(left, ring[i]); right = Math.max(right, ring[i]);
      top = Math.min(top, ring[i + 1]); bottom = Math.max(bottom, ring[i + 1]);
      area += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
    }
    const count = Math.min(5, Math.floor(Math.abs(area) / 2 / (cellM * cellM) / 9));
    let seed = 0x811c9dc5;
    for (const ch of String(key)) seed = Math.imul(seed ^ ch.charCodeAt(0), 0x01000193);
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const clear = (x, y) => {
      let inside = false;
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const ax = ring[j], ay = ring[j + 1], bx = ring[i], by = ring[i + 1];
        if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
        const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
        const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0;
        if (Math.hypot(x - ax - t * dx, y - ay - t * dy) < cellM * 0.8) return false;
      }
      return inside;
    };
    const sites = [];
    for (let tries = 0; tries < 120 && sites.length < count; tries++) {
      const x = left + random() * (right - left), y = top + random() * (bottom - top);
      if (!clear(x, y) || sites.some(p => Math.hypot(x - p.x, y - p.y) < cellM * 1.3)) continue;
      sites.push({ x, y, height: [12, 16, 20][sites.length % 3] });
    }
    columnCache.set(ring, { key, cellM, sites });
    return sites;
  }
  function columnTexture(scene, claimed) {
    const key = `castle_column_${claimed ? 'restored' : 'weathered'}`;
    if (scene.textures.exists(key)) return key;
    if (!scene.textures.exists('pillar')) return null;
    const texture = scene.textures.createCanvas(key, 16, 20), ctx = texture.getContext();
    // Keep the existing fluted shaft and stone plinth, removing its intact cap.
    ctx.drawImage(scene.textures.get('pillar').getSourceImage(), 0, 12, 16, 18, 0, 2, 16, 18);
    const image = ctx.getImageData(0, 0, 16, 20), data = image.data, stone = get('ruin', claimed).stone;
    for (let y = 0; y < 20; y++) for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      if (data[i + 3] < 128 || y < 2 + (x % 3)) { data[i + 3] = 0; continue; }
      const light = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const color = stone[light < 65 ? 'DARK' : light < 105 ? 'SHADOW' : light < 145 ? 'FACE' : light < 180 ? 'BODY' : 'LITE'];
      data[i] = color >> 16; data[i + 1] = (color >> 8) & 255; data[i + 2] = color & 255; data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    for (const height of [12, 16, 20]) texture.add(height, 0, 0, 20 - height, 16, height);
    texture.refresh();
    return key;
  }
  global.CastleStyles = Object.freeze({ TOWER_WIDTH: 32, TOWER_HEIGHT: 48, ids: Object.freeze(ids), variantFor, get, columnSites, columnTexture });
})(window);
