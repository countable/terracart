// Shared cel-pixel wall sheet and retained world-space triangles.
(function (global) {
  'use strict';
  const KEY = 'wall-materials-cel-v1', SIZE = 512, TILE = 128, PAD = 2;
  const WHITE = { u: 500 / SIZE, v: 500 / SIZE };
  const WOOD = { height: 8, tipHeight: 3.4, thickness: 3.36, width: 3.36, pitch: 4 };
  const slots = { hedgeTop: 0, hedgeSide: 1, stoneTop: 2, stoneSide: 3, woodTop: 4, woodSide: 5, stoneEnd: 6, stonePlain: 7 };
  const colors = { hedgeTop: 0x80995b, hedgeSide: 0x456e47, stoneTop: 0xc6baa4,
    stonePlain: 0xc6baa4, stoneSide: 0x968a76, stoneEnd: 0x968a76, woodTop: 0xe3c8a1, woodSide: 0xcba47d };
  const hash = (x, y) => ((Math.imul(x + 173, 374761393) ^ Math.imul(y + 97, 668265263)) >>> 0) / 4294967296;
  function multiplyColors(a, b) {
    const channel = shift => Math.round(((a >>> shift) & 255) * ((b >>> shift) & 255) / 255);
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
  }
  function prepare(scene) {
    if (!scene.textures?.createCanvas || !scene.textures?.exists) return null;
    if (scene.textures.exists(KEY)) return scene.textures.get(KEY);
    const texture = scene.textures.createCanvas(KEY, SIZE, SIZE), g = texture.getContext();
    for (const name of Object.keys(slots)) {
      const slot = slots[name], ox = slot % 4 * TILE + PAD, oy = Math.floor(slot / 4) * TILE + PAD, n = TILE - PAD * 2;
      g.save(); g.translate(ox, oy); g.beginPath(); g.rect(0, 0, n, n); g.clip();
      const fill = (color, x, y, w, h) => { g.fillStyle = color; g.fillRect(x, y, w, h); };
      fill('#' + colors[name].toString(16).padStart(6, '0'), 0, 0, n, n);
      if (name.startsWith('hedge')) {
        const side = name === 'hedgeSide';
        fill(side ? '#3d6542' : '#789153', 0, 0, n, n);
        for (let y = -8; y < n; y += 10) for (let x = -8; x < n; x += 12) {
          const v = hash(x, y), xx = x + Math.floor(hash(y, x) * 4);
          fill(side ? '#456e47' : '#80995b', xx + 1, y + 1, 8, 5);
          fill(side ? '#456e47' : '#80995b', xx + 3, y, 4, 7);
          if (v > .24) fill(side ? '#50794d' : '#8ca368', xx + 2, y + 1, 4, 1);
          if (v > .4) fill(side ? '#355b3c' : '#6c874f', xx + 6, y + 6, 2, 1);
        }
      } else if (name === 'stoneTop' || name === 'stonePlain') {
        for (let y = 3; y < n; y += 11) for (let x = 3; x < n; x += 13) {
          const v = hash(x, y);
          if (v > .48) fill(v > .8 ? '#d0c5b0' : '#bcb19b', x, y, 2, 1);
        }
        // One stone across the width, with only transverse cap joints.
        if (name === 'stoneTop') fill('#968d7d', Math.floor(n / 2), 0, 3, n);
      } else if (name === 'stoneSide' || name === 'stoneEnd') {
        for (let row = 0; row < 2; row++) {
          const y = row * n / 2;
          fill(row % 2 ? '#9e917d' : '#a29682', 0, y, n, n / 2);
          if (row) fill('#706c62', 0, y, n, 5);
          if (name === 'stoneSide') for (let x = (row % 2) * n / 4; x < n; x += n / 2) fill('#706c62', x, y + 5, 3, n / 2 - 5);
        }
        fill('#827764', 0, n * .76, n, n * .24);
        fill('#746a58', 0, n - 15, n, 8); fill('#615b50', 0, n - 7, n, 7);
      } else if (name === 'woodSide') {
        fill('#a37d63', 0, 0, 17, n); fill('#dfc29b', 24, 0, 16, n - 15);
        fill('#a17b60', 77, 44, 15, 30); fill('#a17b60', 91, 74, 12, 15);
        fill('#876752', 0, n - 18, n, 18);
      }
      g.restore();
      // Duplicate border texels so affine Canvas and GPU filtering cannot bleed atlas neighbours.
      g.drawImage(texture.getSourceImage(), ox, oy, n, 1, ox, oy - PAD, n, PAD);
      g.drawImage(texture.getSourceImage(), ox, oy + n - 1, n, 1, ox, oy + n, n, PAD);
      g.drawImage(texture.getSourceImage(), ox, oy - PAD, 1, TILE, ox - PAD, oy - PAD, PAD, TILE);
      g.drawImage(texture.getSourceImage(), ox + n - 1, oy - PAD, 1, TILE, ox + n, oy - PAD, PAD, TILE);
    }
    g.fillStyle = '#ffffff'; g.fillRect(496, 496, 8, 8);
    texture.refresh();
    texture.setFilter(global.Phaser?.Textures?.FilterMode?.NEAREST ?? 1);
    return texture;
  }
  function clip(poly, axis, bound, greater) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], ai = greater ? a[axis] >= bound : a[axis] <= bound,
        bi = greater ? b[axis] >= bound : b[axis] <= bound;
      if (ai) out.push(a);
      if (ai !== bi) {
        const t = (bound - a[axis]) / (b[axis] - a[axis]), p = {};
        for (const k of ['x', 'y', 'z', 's', 't']) p[k] = a[k] + (b[k] - a[k]) * t;
        out.push(p);
      }
    }
    return out;
  }
  // Split only at texture repeat boundaries; individual texels never create geometry.
  function surface(result, points, material, normal, tint = 0xffffff) {
    const slot = slots[material], ox = slot % 4 * TILE + PAD, oy = Math.floor(slot / 4) * TILE + PAD;
    const lo = Math.floor(Math.min(...points.map(p => p.s))), hi = Math.ceil(Math.max(...points.map(p => p.s)));
    const bottom = Math.floor(Math.min(...points.map(p => p.t))), top = Math.ceil(Math.max(...points.map(p => p.t)));
    for (let s = lo; s < Math.max(lo + 1, hi); s++) for (let t = bottom; t < Math.max(bottom + 1, top); t++) {
      let ring = clip(clip(points, 's', s, true), 's', s + 1, false);
      ring = clip(clip(ring, 't', t, true), 't', t + 1, false);
      if (ring.length < 3) continue;
      ring = ring.map(p => ({ x: p.x, y: p.y, z: p.z,
        u: (ox + (p.s - s) * (TILE - PAD * 2)) / SIZE,
        v: (oy + (p.t - t) * (TILE - PAD * 2)) / SIZE }));
      for (let i = 1; i + 1 < ring.length; i++) result.push({ points: [ring[0], ring[i], ring[i + 1]], normal, color: tint, flatColor: multiplyColors(colors[material], tint) });
    }
  }
  function geometry(kind, points, height, options = {}) {
    const wood = kind === 'wood' || kind === 'fort', hedge = kind === 'hedge';
    if (wood && points.length === 4) {
      points = points.flatMap((p, i) => [points[(i + 3) % 4], points[(i + 1) % 4]].map(q => {
        const length = Math.hypot(q.x - p.x, q.y - p.y), cut = Math.min(.35, length / 3);
        return { x: p.x + (q.x - p.x) * cut / length, y: p.y + (q.y - p.y) * cut / length };
      }));
    }
    const prefix = wood ? 'wood' : hedge ? 'hedge' : 'stone', faces = [], n = points.length;
    if (n < 3 || height <= 0) return faces;
    const open = options.openEdges || [], d = hedge ? 1.6 : .7, bevel = Math.min(height / 3, hedge ? 1.5 : .65);
    const normals = points.map((a, i) => { const b = points[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y); return { x: (b.y - a.y) / l, y: (a.x - b.x) / l }; });
    const cap = points.map((p, i) => {
      const prev = (i + n - 1) % n, a = normals[prev], b = normals[i], da = open[prev] ? 0 : d, db = open[i] ? 0 : d;
      const det = a.x * b.y - a.y * b.x;
      if (Math.abs(det) < 1e-8) return { x: p.x - b.x * db, y: p.y - b.y * db };
      return { x: p.x + (-da * b.y + db * a.y) / det, y: p.y + (-db * a.x + da * b.x) / det };
    });
    const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y));
    const horizontal = Math.max(...points.map(p => p.x)) - minX >= Math.max(...points.map(p => p.y)) - minY;
    const originX = options.textureOriginX || 0, originY = options.textureOriginY || 0;
    const topPoint = (p, runHorizontal = horizontal) => ({ ...p, z: height, s: hedge ? (p.x + originX) / 124 : ((runHorizontal ? p.x + originX : p.y + originY) / 14),
      t: hedge ? (p.y + originY) / 124 : ((runHorizontal ? p.y + originY : p.x + originX) / 32) });
    function topSurface(poly, normal, tint = 0xffffff) {
      // Connected arms keep transverse seams along their own run. Splits occur
      // only at the five footprint regions, never at individual texels.
      if (!hedge && options.capRegions?.length) {
        for (const region of options.capRegions) {
          let ring = clip(clip(poly, 'x', region.x0, true), 'x', region.x1, false);
          ring = clip(clip(ring, 'y', region.y0, true), 'y', region.y1, false);
          if (ring.length < 3) continue;
          surface(faces, ring.map(p => ({ ...topPoint(p, region.horizontal), z: p.z })),
            region.joints === false ? 'stonePlain' : 'stoneTop', normal, tint);
        }
      } else surface(faces, poly.map(p => ({ ...topPoint(p), z: p.z })), prefix + 'Top', normal, tint);
    }
    if (!wood) {
      const tris = global.PolygonGeometry.triangulate(cap);
      for (const tri of tris) topSurface(tri.map(p => ({ ...p, z: height, s: 0, t: 0 })), null);
    }
    const center = { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
    for (let i = 0; i < n; i++) {
      if (open[i]) continue;
      const j = (i + 1) % n, a = points[i], b = points[j], normal = normals[i], low = wood ? height : height - bevel;
      const alongX = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y), repeat = hedge ? 124 : 28;
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const sidePoint = (p, z, end) => ({ ...p, z,
        s: wood ? end : (alongX ? p.x + originX : p.y + originY) / repeat,
        t: 1 - z / (hedge ? 124 : low) });
      if (distance > 1e-8) surface(faces, [sidePoint(a, 0, 0), sidePoint(b, 0, 1), sidePoint(b, low, 1), sidePoint(a, low, 0)], (!wood && !hedge && distance <= 8 ? 'stoneEnd' : prefix + 'Side'), normal);
      if (wood) {
        surface(faces, [{ ...a, z: height, s: 0, t: 1 }, { ...b, z: height, s: 1, t: 1 },
          { ...center, z: height + WOOD.tipHeight, s: .5, t: 0 }], 'woodTop', null, normal.x * .4 + normal.y * .6 > 0 ? 0xf6eadc : 0xffffff);
      } else {
        const edge = [topPoint(a), topPoint(b), topPoint(cap[j]), topPoint(cap[i])];
        edge[0].z = edge[1].z = low;
        topSurface(edge, normal, hedge ? 0xc9d2ba : 0xffffff);
      }
    }
    if (options.tint != null) for (const face of faces) {
      face.color = multiplyColors(face.color, options.tint);
      face.flatColor = multiplyColors(face.flatColor, options.tint);
    }
    return faces;
  }
  global.WallMaterials = { prepare, geometry, WOOD, KEY, WHITE };
})(globalThis);
