// Small retained solids for the map. All detail lives on world-space surfaces,
// so a compass turn reveals the other sides instead of turning a flat picture.
(function (global) {
  'use strict';
  function random(id) {
    let seed = 2166136261;
    for (const c of String(id ?? 'prop')) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
    return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  }
  function shade(color, value) {
    return [16, 8, 0].reduce((out, shift) => out | Math.min(255, Math.round(((color >>> shift) & 255) * value)) << shift, 0);
  }
  function polygon(faces, points) {
    for (let i = 1; i < points.length - 1; i++) faces.push({ points: [points[0], points[i], points[i + 1]] });
  }
  function crate(options) {
    const { x = 0, y = 0, width = 13, depth = width, height = 6 } = options;
    const points = [{ x: x - width / 2, y: y - depth / 2 }, { x: x + width / 2, y: y - depth / 2 },
      { x: x + width / 2, y: y + depth / 2 }, { x: x - width / 2, y: y + depth / 2 }];
    const faces = [];
    polygon(faces, points.slice().reverse().map(p => ({ ...p, z: 0 })));
    for (let i = 0; i < 4; i++) {
      const a = points[i], b = points[(i + 1) % 4];
      polygon(faces, [{ ...a, z: 0 }, { ...b, z: 0 }, { ...b, z: height }, { ...a, z: height }]);
    }
    polygon(faces, points.map(p => ({ ...p, z: height })));
    return { points, bottom: 0, top: height, colors: { face: 0x96734c, top: 0xb69a70 }, materialFaces: faces };
  }
  function rock(options) {
    const { x = 0, y = 0, width = 17, depth = width * .95, height = 4, id } = options;
    const rng = random(id), n = 7, phase = rng() * .3, faces = [];
    const base = [], shoulder = [], crown = [];
    for (let i = 0; i < n; i++) {
      const angle = phase + i * Math.PI * 2 / n, radius = .94 + rng() * .08;
      const dx = Math.cos(angle) * width / 2 * radius, dy = Math.sin(angle) * depth / 2 * radius;
      base.push({ x: x + dx, y: y + dy, z: 0 });
      shoulder.push({ x: x + dx * .97, y: y + dy * .97, z: height * .38 });
      crown.push({ x: x + dx * .68 - width * .055, y: y + dy * .68, z: height * (.90 + rng() * .07) });
    }
    polygon(faces, base.slice().reverse());
    const peak = { x: x - width * .035, y: y + depth * .025, z: height };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      polygon(faces, [base[i], base[j], shoulder[j], shoulder[i]]);
      // Triangulated shoulders make a worn boulder, with no vertical cylinder wall.
      polygon(faces, [shoulder[i], shoulder[j], crown[j]]);
      polygon(faces, [shoulder[i], crown[j], crown[i]]);
      polygon(faces, [crown[i], crown[j], peak]);
    }
    return { points: base.map(({ x, y }) => ({ x, y })), bottom: 0, top: height,
      colors: { face: 0x687180, top: 0xa2aab7 }, materialFaces: faces };
  }
  const MATERIALS = ['plain', 'flint', 'quartz', 'topaz', 'amethyst', 'sapphire', 'ruby', 'emerald',
    'diamond', 'copper', 'iron', 'gold', 'platinum', 'crimson', 'frost'];
  const ATLAS = { key: 'prop_materials', size: 256, stride: 20, padding: 2, columns: 8, rockStart: 8 };
  function uv(slot, u, v) {
    // Stay inside texel centres. Padded copies guard both renderers from bleed.
    return { u: (slot % ATLAS.columns * ATLAS.stride + 2.5 + u * 15) / ATLAS.size,
      v: (Math.floor(slot / ATLAS.columns) * ATLAS.stride + 2.5 + v * 15) / ATLAS.size };
  }
  function geometry(kind, options = {}) {
    const mesh = kind === 'crate' ? crate(options) : rock(options);
    const { x = 0, y = 0, tint = 0xffffff } = options;
    const width = options.width ?? (kind === 'crate' ? 13 : 17);
    const depth = options.depth ?? (kind === 'crate' ? width : width * .95);
    const height = options.height ?? (kind === 'crate' ? 6 : 4);
    const frame = options.frame ?? (kind === 'crate' ? 0
      : Math.max(0, MATERIALS.indexOf(options.mineral || 'plain')) * 2 + (width > 20 ? 1 : 0));
    // The approved sprite owns planks, trim, stone clusters and ore flecks.
    // Texture the closed shell directly; surface detail comes from the atlas.
    for (const face of mesh.materialFaces) {
      const [a, b, c] = face.points;
      const ab = { x: b.x-a.x, y: b.y-a.y, z: b.z-a.z }, ac = { x: c.x-a.x, y: c.y-a.y, z: c.z-a.z };
      const normal = { x: ab.y*ac.z-ab.z*ac.y, y: ab.z*ac.x-ab.x*ac.z, z: ab.x*ac.y-ab.y*ac.x };
      const top = Math.abs(normal.z) >= Math.max(Math.abs(normal.x), Math.abs(normal.y));
      const sideX = Math.abs(normal.x) > Math.abs(normal.y);
      const slot = kind === 'crate' ? Math.min(3, Math.max(0, frame)) * 2 + (top ? 1 : 0)
        : ATLAS.rockStart + Math.min(64, Math.max(0, frame));
      face.materialSlot = slot;
      face.color = kind === 'crate' ? (top ? 0xffffff : 0xe8e8e8) : shade(tint, top ? 1 : .92);
      face.points = face.points.map(p => {
        const planar = kind === 'rock' || top;
        const u = planar || !sideX ? (p.x-x)/width+.5 : (p.y-y)/depth+.5;
        const v = planar ? (p.y-y)/depth+.5 : 1-p.z/height;
        return { x: p.x, y: p.y, z: p.z, ...uv(slot, Math.max(0,Math.min(1,u)), Math.max(0,Math.min(1,v))) };
      });
    }
    // Retain adjacency once. At each heading only an edge separating a
    // visible face from a hidden face can belong to the outer silhouette.
    const edges = new Map(), key = p => `${p.x},${p.y},${p.z}`;
    for (const face of mesh.materialFaces) for (let i = 0; i < 3; i++) {
      const a = key(face.points[i]), b = key(face.points[(i+1)%3]);
      const id = [a,b].sort().join('|');
      if (!edges.has(id)) edges.set(id, []);
      edges.get(id).push({ face, a: i, b: (i+1)%3 });
    }
    mesh.topOutline = { width: 1, color: 0x000000, edges: [...edges.values()] };
    return mesh;
  }
  global.PropLowPoly = { MATERIALS, ATLAS, geometry };
})(window);
