// Browser-only material and geometry studies. Nothing installs in normal play.
(function (global) {
  'use strict';
  const PREFIX = 'extra_assets/16x16/Rogue Adventure World/Rogue Adventure World [Sprites]/Tilesets/';
  const RAW = {
    hell: { path: PREFIX + 'RA_Hell.png', crop: [32, 112, 16, 16] },
    flow: { path: PREFIX + 'RA_Hell_Animations.png', crop: [32, 32, 16, 16] },
    rune: { path: PREFIX + 'RA_Ancient.png', crop: [304, 16, 16, 16] },
  };
  const GROUND = 'extra_assets/16x16/Rogue Adventure World/Rogue Adventure World [Sprites]/Tilesets/RA_Ground_Tiles.png';
  const SOURCE = {
    G04: { path: GROUND, crop: [224, 80, 16, 16] },
    G07: { path: GROUND, crop: [32, 208, 16, 16] },
    G08: { path: GROUND, crop: [224, 208, 16, 16] },
    G09: { path: GROUND, crop: [352, 208, 16, 16] },
    F02: { path: PREFIX + 'RA_Temple.png', crop: [48, 0, 16, 16] },
    ...RAW,
  };
  const CONCEPTS = [
    { id: 'caravan-ruts', family: 'md', title: 'Caravan wheel ruts',
      description: 'Warm compacted earth with two worn wagon tracks and an undisturbed center ridge.',
      material: 'G04', color: [103, 87, 58], contrast: .42, sources: ['G04'],
      restoration: 'The earth brightens slightly and the tracks become shallower; it remains an old dirt trade route.' },
    { id: 'gravel-causeway', family: 'md', title: 'Compacted gravel causeway',
      description: 'Pale gritty ground, a broad worn center and narrow dark drainage lines along the shoulders.',
      material: 'G07', color: [123, 116, 91], contrast: .58, sources: ['G07', 'G08'],
      restoration: 'A more even center and cleaner drainage edges, without new paving stones.' },
    { id: 'imperial-slabs', family: 'md', title: 'Ancient slab trade road',
      description: 'Broad worn stone slabs spanning the route, with sparse large joints rather than small cobbles.',
      material: 'F02', color: [110, 107, 91], contrast: .30, sources: ['F02', 'G09'],
      restoration: 'The large slab faces lighten and their inset edges become clearer.' },
    { id: 'broken-causeway', family: 'md', title: 'Buried old causeway',
      description: 'Olive gravel and earth with broken transverse remnants of an older engineered road.',
      material: 'G08', color: [104, 100, 73], contrast: .45, sources: ['G08', 'G04'],
      restoration: 'Missing stretches become compacted pale gravel while the surviving cross-course fragments remain.' },
    { id: 'teal-scar', family: 'lg', title: 'Turquoise dimensional scar',
      description: 'Dark native Hell crust split by a single wandering turquoise tear with sparse branching cracks.',
      material: 'hell', color: [32, 47, 47], contrast: .32, sources: ['hell'],
      restoration: 'The tear narrows and its turquoise lip steadies; the black road bed stays otherworldly.' },
    { id: 'violet-void', family: 'lg', title: 'Violet void channel',
      description: 'A broad near-black central gulf held between violet banks over recolored native lava-flow texture.',
      material: 'flow', color: [48, 36, 64], contrast: .21, sources: ['flow', 'hell'],
      restoration: 'The gulf becomes narrower and its pale violet perimeter reads as a stabilized boundary.' },
    { id: 'obsidian-faults', family: 'lg', title: 'Fractured obsidian road',
      description: 'Large black-rock plates separated by long oblique mint fractures; no continuous center stripe.',
      material: 'hell', color: [31, 42, 50], contrast: .48, sources: ['hell', 'G09'],
      restoration: 'The open fractures tighten into thin mineral seams between intact dark plates.' },
    { id: 'arcane-inlay', family: 'lg', title: 'Ancient dimensional conduit',
      description: 'A dark mineral road with paired turquoise channels and sparse glyphs lifted from native Ancient ruins art.',
      material: 'G09', color: [40, 49, 57], contrast: .24, sources: ['G09', 'rune'],
      restoration: 'The paired channels and native glyphs become pale, clean and continuous.' },
  ].map(row => ({ ...row, sources: row.sources.map(id => ({ id, ...SOURCE[id] })) }));

  const rawImages = new Map(), materialCache = new Map();
  let prepared;
  function canvas(size) {
    const c = document.createElement('canvas'); c.width = c.height = size; return c;
  }
  function prepare() {
    if (!prepared) prepared = Promise.all(Object.entries(RAW).map(async ([id, source]) => {
      const image = new Image(); image.src = '/' + source.path.split('/').map(encodeURIComponent).join('/');
      await image.decode(); rawImages.set(id, image);
    }));
    return prepared;
  }
  function nativeTile(id) {
    const c = canvas(16), ctx = c.getContext('2d');
    if (RAW[id]) {
      const image = rawImages.get(id);
      if (!image) throw Error('Call await RoadTreatments.prepare() before requesting raw art');
      ctx.drawImage(image, ...RAW[id].crop, 0, 0, 16, 16);
    } else if (!global.drawSelectedMaterial && typeof drawSelectedMaterial === 'undefined') {
      throw Error('The shipping selected terrain atlas is required');
    } else if (!drawSelectedMaterial(ctx, 16, id)) {
      throw Error('Selected material unavailable: ' + id);
    }
    return c;
  }
  // Recolor only at material preparation. Native pixel shape and tonal grain
  // remain the source, while distinct families use restrained earth/void ramps.
  function tonedTile(id, target, contrast) {
    const c = nativeTile(id), ctx = c.getContext('2d');
    const pixels = ctx.getImageData(0, 0, 16, 16), d = pixels.data;
    let sum = 0, count = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { sum += d[i] * .2126 + d[i + 1] * .7152 + d[i + 2] * .0722; count++; }
    const mean = sum / Math.max(1, count);
    for (let i = 0; i < d.length; i += 4) {
      const delta = (d[i] * .2126 + d[i + 1] * .7152 + d[i + 2] * .0722 - mean) * contrast;
      for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, target[k] + delta));
      d[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0); return c;
  }
  function concept(family, id) {
    const row = CONCEPTS.find(c => c.family === family && c.id === id);
    if (!row) throw Error('Unknown road treatment ' + family + ':' + id);
    return row;
  }
  function materialFor(family, id, restored) {
    const row = concept(family, id), key = family + ':' + id + ':' + !!restored;
    if (materialCache.has(key)) return materialCache.get(key);
    const c = canvas(128), g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    const lift = restored ? (family === 'md' ? 9 : 3) : 0;
    const source = tonedTile(row.material, row.color.map(v => v + lift), row.contrast);
    const scale = id === 'imperial-slabs' ? 4 : 2, step = 16 * scale;
    for (let y = 0; y < 128; y += step) for (let x = 0; x < 128; x += step) g.drawImage(source, x, y, step, step);
    if (id === 'gravel-causeway') {
      const grit = tonedTile('G08', [129 + lift, 123 + lift, 101 + lift], .35);
      g.globalAlpha = .18;
      for (let y = 0; y < 128; y += 32) for (let x = 0; x < 128; x += 32) g.drawImage(grit, x, y, 32, 32);
      g.globalAlpha = 1;
    }
    materialCache.set(key, c); return c;
  }

  function metrics(run) {
    const distances = [0];
    for (let i = 1; i < run.length; i++) distances.push(distances[i - 1] + Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y));
    return { run, distances, length: distances[distances.length - 1] || 0 };
  }
  function at(m, distance, offset = 0) {
    distance = Math.max(0, Math.min(m.length, distance));
    for (let i = 1; i < m.run.length; i++) {
      const end = m.distances[i];
      if (end < distance || end === m.distances[i - 1]) continue;
      const a = m.run[i - 1], b = m.run[i], length = end - m.distances[i - 1];
      const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length, t = (distance - m.distances[i - 1]) / length;
      return { x: a.x + (b.x - a.x) * t - dy * offset, y: a.y + (b.y - a.y) * t + dx * offset, dx, dy, nx: -dy, ny: dx };
    }
    const p = m.run[m.run.length - 1] || { x: 0, y: 0 }; return { ...p, dx: 1, dy: 0, nx: 0, ny: 1 };
  }
  function trace(m, offset = 0, rough = 0, step = 9) {
    const out = [];
    for (let s = 0; s <= m.length; s += step) out.push(at(m, s, offset + rough * (Math.sin(s * .13) * .62 + Math.sin(s * .31) * .38)));
    out.push(at(m, m.length, offset + rough * (Math.sin(m.length * .13) * .62 + Math.sin(m.length * .31) * .38)));
    return out;
  }
  function stroke(g, points, width, color, alpha, roadWidth) {
    if (points.length > 1) g.decorPath(width, color, points, alpha, roadWidth);
  }
  function cross(g, m, distance, left, right, width, color, alpha, roadWidth, slant = 0) {
    const a = at(m, distance - slant, left), b = at(m, distance + slant, right);
    stroke(g, [a, b], width, color, alpha, roadWidth);
  }
  let runeRows;
  function glyphRows() {
    if (runeRows) return runeRows;
    const ctx = nativeTile('rune').getContext('2d'), d = ctx.getImageData(0, 0, 16, 16).data;
    const rows = [];
    for (let y = 0; y < 16; y++) {
      let start = -1;
      for (let x = 0; x <= 16; x++) {
        const i = (y * 16 + x) * 4;
        const green = x < 16 && d[i + 3] > 0 && d[i + 1] > d[i] * 1.13 && d[i + 1] > d[i + 2] * 1.03 && d[i + 1] > 65;
        if (green && start < 0) start = x;
        if (!green && start >= 0) { rows.push([start, x, y]); start = -1; }
      }
    }
    runeRows = rows; return rows;
  }
  function glyph(g, m, distance, roadWidth, color, alpha) {
    const p = at(m, distance), scale = Math.min(1, roadWidth / 55);
    for (const [x0, x1, y] of glyphRows()) {
      const point = x => ({ x: p.x + p.nx * (x - 8) * scale + p.dx * (y - 8) * scale,
        y: p.y + p.ny * (x - 8) * scale + p.dy * (y - 8) * scale });
      stroke(g, [point(x0), point(x1)], Math.max(.8, scale), color, alpha, roadWidth);
    }
  }
  function decorate(scene, g, run, width, family, id, restored) {
    if (!g?.decorPath || run.length < 2 || !(width > 0)) return;
    concept(family, id);
    const m = metrics(run), ink = restored ? .6 : .8;
    if (!m.length) return;
    if (id === 'caravan-ruts') {
      stroke(g, trace(m), width * .13, 0xbea777, .22, width);
      for (const side of [-1, 1]) {
        stroke(g, trace(m, width * .235 * side, width * .012), width * .095, 0x4d432f, restored ? .38 : .72, width);
        stroke(g, trace(m, width * .235 * side - 1), 1, 0xd3bd8b, .23, width);
      }
    } else if (id === 'gravel-causeway') {
      stroke(g, trace(m), width * .48, 0xc1b594, restored ? .17 : .10, width);
      for (const side of [-1, 1]) {
        stroke(g, trace(m, width * .40 * side), 2.2, 0x4f5143, ink, width);
        stroke(g, trace(m, width * .45 * side), 1.1, 0xc0b599, .50, width);
      }
    } else if (id === 'imperial-slabs') {
      stroke(g, trace(m), 1.1, 0x4f5149, .68, width);
      for (let s = 13, i = 0; s < m.length; s += 32, i++) {
        cross(g, m, s, -width * .45, width * .45, 2.2, 0x474a42, .75, width);
        cross(g, m, s + 1.8, -width * .43, width * .43, 1, 0xc4bfa3, .44, width);
        if (!restored && i % 3 === 1) cross(g, m, s + 10, -width * .33, -.5, 1, 0x535247, .65, width, 2);
      }
    } else if (id === 'broken-causeway') {
      stroke(g, trace(m), width * .29, 0xb29a6b, .24, width);
      for (let s = 12, i = 0; s < m.length; s += 28, i++) {
        const side = i % 2 ? -1 : 1;
        cross(g, m, s, side * width * .08, side * width * .43, 6, 0x686853, .84, width, 1.5);
        cross(g, m, s - 2, side * width * .1, side * width * .4, 1.2, 0xc2b48b, .55, width, 1.5);
      }
    } else if (id === 'teal-scar') {
      const line = trace(m, 0, width * (restored ? .045 : .09), 8);
      stroke(g, line, width * .19, 0x387f75, .28, width);
      stroke(g, line, width * .105, 0x71cdb7, .85, width);
      stroke(g, line, width * (restored ? .035 : .055), 0x071c22, 1, width);
      for (let s = 27, i = 0; s < m.length; s += 62, i++) {
        const p = at(m, s), q = at(m, s + 10, (i % 2 ? -1 : 1) * width * .28);
        stroke(g, [p, q], restored ? .8 : 1.1, 0x70ad9f, .68, width);
      }
    } else if (id === 'violet-void') {
      const line = trace(m, 0, width * .07, 11);
      stroke(g, line, width * .43, 0x79558f, .62, width);
      stroke(g, line, width * .32, restored ? 0x201d34 : 0x100e20, 1, width);
      for (const side of [-1, 1]) stroke(g, trace(m, width * .17 * side, width * .07, 11), 1.5, restored ? 0xc9b2df : 0x9b75bd, .78, width);
    } else if (id === 'obsidian-faults') {
      for (let s = 16, i = 0; s < m.length; s += 42, i++) {
        const skew = i % 2 ? -10 : 10;
        cross(g, m, s, -width * .44, width * .44, restored ? 2 : 4, 0x101b23, 1, width, skew);
        cross(g, m, s, -width * .44, width * .44, restored ? .9 : 1.3, 0x6caea8, restored ? .88 : .60, width, skew);
        const p = at(m, s + skew * .3, width * .12), q = at(m, s + skew + 17, width * .21);
        stroke(g, [p, q], 1, 0x6caea8, .57, width);
      }
    } else if (id === 'arcane-inlay') {
      for (const side of [-1, 1]) {
        stroke(g, trace(m, width * .32 * side), 3.8, 0x152b31, .9, width);
        stroke(g, trace(m, width * .32 * side), restored ? 1.5 : 1, restored ? 0x99d9c2 : 0x508d82, .92, width);
      }
      for (let s = 22; s < m.length; s += 65) glyph(g, m, s, width, restored ? 0x9ccfb9 : 0x6a9e8e, restored ? .95 : .80);
    }
  }
  async function install(scene, selection) {
    await prepare();
    for (const family of ['md', 'lg']) if (selection[family]) concept(family, selection[family]);
    scene._roadTreatmentPreview = { ...selection };
    global.RoadOverlay?.invalidate(scene);
  }
  global.RoadTreatments = { CONCEPTS, prepare, materialFor, decorate, install };
})(window);
