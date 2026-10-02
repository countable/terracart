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
    return (Math.round(r * 0.48 + 9) << 16) | (Math.round(g * 0.50 + 13) << 8) | Math.round(b * 0.46 + 10);
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
  global.CastleStyles = Object.freeze({ TOWER_WIDTH: 32, TOWER_HEIGHT: 40, ids: Object.freeze(ids), variantFor, get });
})(window);
