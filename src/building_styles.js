// Footprint architecture. Geometry is built only when the overlay changes;
// compass motion projects retained vertices through WallPerspective.
(function (global) {
  const EPS = 1e-6;
  const STYLES = {
    adobe: { wall: 0xc39870, roof: 0xcda77e, trim: 0xe1bd91, height: 10 },
    whitewash: { wall: 0xd4cdb4, roof: 0x709b9a, trim: 0xe8dfc6, height: 11 },
    brick: { wall: 0xa96e59, roof: 0x687a83, trim: 0xc79673, height: 12 },
    pyramid: { wall: 0xc6a17a, roof: 0xcfa55f, trim: 0xe2c58a, height: 8 },
    multistorey: { wall: 0xd4c8ac, roof: 0x857e9a, trim: 0xeee1bd, height: 12 },
    japanese: { wall: 0xd8c6a1, roof: 0x567e83, trim: 0x9f6651, height: 11 },
    fort: { wall: 0x9b9e91, roof: 0xb6b6a2, trim: 0xd5ceb2, height: 14 },
    ruin: { wall: 0xa98c73, roof: 0x9d826a, trim: 0xc6aa84, height: 4 },
  };
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const area = p => p.reduce((a, v, i) => { const q = p[(i + 1) % p.length]; return a + v.x * q.y - q.x * v.y; }, 0) / 2;
  function clean(points) {
    const out = [];
    for (const p of points || []) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return [];
      const last = out[out.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > EPS) out.push({ x: p.x, y: p.y });
    }
    if (out.length > 1 && Math.hypot(out[0].x - out.at(-1).x, out[0].y - out.at(-1).y) < EPS) out.pop();
    if (area(out) < 0) out.reverse();
    return out;
  }
  function inside(p, ring) {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if (Math.abs(cross(a, b, p)) < EPS && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS) return true;
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  }
  function intersects(a, b, c, d) {
    const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
    return abC * abD < -EPS && cdA * cdB < -EPS;
  }
  function simple(p) {
    for (let i = 0; i < p.length; i++) for (let j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue;
      if (intersects(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])) return false;
    }
    return true;
  }
  // Parallel-edge inset with a bounded miter. Invalid narrow wings terminate
  // the roof, rather than scaling vertices toward a centroid outside an L.
  function inset(ring, distance) {
    if (!distance) return ring.map(p => ({ ...p }));
    const result = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
      const lx = b.x - a.x, ly = b.y - a.y, rx = c.x - b.x, ry = c.y - b.y;
      const ll = Math.hypot(lx, ly), rl = Math.hypot(rx, ry);
      if (ll < EPS || rl < EPS) return null;
      const nx = -ly / ll - ry / rl, ny = lx / ll + rx / rl;
      const dot = nx * (-ly / ll) + ny * (lx / ll);
      if (Math.abs(dot) < 0.05) return null;
      const dx = nx * distance / dot, dy = ny * distance / dot;
      if (Math.hypot(dx, dy) > Math.abs(distance) * 5) return null;
      result.push({ x: b.x + dx, y: b.y + dy });
    }
    if (area(result) <= EPS || !simple(result)) return null;
    for (let i = 0; i < result.length; i++) {
      const a = result[i], b = result[(i + 1) % result.length], oldA = ring[i], oldB = ring[(i + 1) % ring.length];
      if ((b.x - a.x) * (oldB.x - oldA.x) + (b.y - a.y) * (oldB.y - oldA.y) <= EPS) return null;
      for (const t of [0, 0.25, 0.5, 0.75]) {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (distance > 0 && !inside(p, ring)) return null;
      }
    }
    return result;
  }
  function triangulate(ring) {
    const remaining = ring.map((_, i) => i), triangles = [];
    let budget = ring.length * ring.length;
    while (remaining.length > 3 && budget-- > 0) {
      let cut = false;
      for (let i = 0; i < remaining.length; i++) {
        const ids = [remaining[(i + remaining.length - 1) % remaining.length], remaining[i], remaining[(i + 1) % remaining.length]];
        const [a, b, c] = ids.map(j => ring[j]);
        if (cross(a, b, c) <= EPS) continue;
        if (remaining.some(j => !ids.includes(j) && cross(a, b, ring[j]) >= -EPS && cross(b, c, ring[j]) >= -EPS && cross(c, a, ring[j]) >= -EPS)) continue;
        triangles.push([a, b, c]); remaining.splice(i, 1); cut = true; break;
      }
      if (!cut) {
        const collinear = remaining.findIndex((j, i) => Math.abs(cross(ring[remaining[(i + remaining.length - 1) % remaining.length]], ring[j], ring[remaining[(i + 1) % remaining.length]])) < EPS);
        if (collinear < 0) return [];
        remaining.splice(collinear, 1);
      }
    }
    if (remaining.length === 3) triangles.push(remaining.map(i => ring[i]));
    return triangles;
  }
  function shade(color, amount) {
    return ((Math.round((color >> 16) * amount) << 16) | (Math.round(((color >> 8) & 255) * amount) << 8) | Math.round((color & 255) * amount));
  }
  function build(points, styleId = 'adobe', options = {}) {
    const ring = clean(points), style = STYLES[styleId] || STYLES.adobe;
    const result = { style: styleId, prisms: [], height: 0 };
    if (ring.length < 3 || area(ring) < EPS || !simple(ring) || !triangulate(ring).length) return result;
    const palette = { ...style, ...options.palette }, scale = options.scale || 1;
    const tint = options.claimed === false ? 0.83 : 1;
    const colors = c => ({ face: shade(c, 0.77 * tint), top: shade(c, tint), dark: shade(c, 0.60 * tint) });
    const add = (p, bottom, top, color, capped = false, topPoints = null, allFaces = false) => {
      result.prisms.push({ points: p, bottom, top, colors: colors(color), capped, topPoints, allFaces });
      result.height = Math.max(result.height, top);
    };
    const cap = (p, h, color) => { for (const tri of triangulate(p)) add(tri, h, h, color, true); };
    const slab = (p, lo, hi, color) => { add(p, lo, hi, color); cap(p, hi, color); };
    // Material marks are clipped in plan before being retained. Pairing
    // scanline crossings preserves concave notches without a rectangular
    // texture laid across empty space. A per-building budget bounds cost.
    let materialBudget = 80;
    const materialCap = (p, z, color) => {
      cap(p, z, color);
      if (options.geometryOnly) return;
      // Keep the finish clear of the raised parapet and its projected face.
      const finish = inset(p, 2 * scale);
      if (!finish) return;
      p = finish;
      const xs = p.map(v => v.x), ys = p.map(v => v.y);
      const north = Math.min(...ys), south = Math.max(...ys), left = Math.min(...xs);
      const pitch = Math.max(6 * scale, (south - north) / 18), thickness = 0.32 * scale;
      const spans = y => {
        const cuts = [];
        for (let i = 0; i < p.length; i++) {
          const a = p[i], b = p[(i + 1) % p.length];
          if ((a.y > y) !== (b.y > y)) cuts.push(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y));
        }
        cuts.sort((a, b) => a - b);
        return cuts;
      };
      const mark = (x0, y0, x1, y1, tone) => {
        if (materialBudget < 2 || x1 - x0 <= 0 || y1 <= y0) return;
        const rectangle = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
        if (rectangle.some(v => !inside(v, p))) return;
        for (let i = 0; i < p.length; i++) for (let j = 0; j < 4; j++) {
          if (intersects(p[i], p[(i + 1) % p.length], rectangle[j], rectangle[(j + 1) % 4])) return;
        }
        cap(rectangle, z + 0.04 * scale, shade(color, tone));
        materialBudget -= 2;
      };
      // Positions are anchored to the footprint, which translates with the
      // world. Panning and compass rotation cannot make the material crawl.
      for (let row = 1, y = north + pitch; y < south - thickness && materialBudget >= 2; row++, y += pitch) {
        const a = spans(y), b = spans(y + thickness);
        if (a.length !== b.length) continue;
        for (let i = 0; i + 1 < a.length && materialBudget >= 2; i += 2) {
          const x0 = Math.max(a[i], b[i]) + 0.3 * scale, x1 = Math.min(a[i + 1], b[i + 1]) - 0.3 * scale;
          mark(x0, y, x1, y + thickness, row % 3 === 0 ? 0.85 : 0.91);
          // One staggered joint per span gives flat clay/stone a tile rhythm
          // without repeating dozens of tiny quads across a large roof.
          const joint = left + (Math.floor((x0 - left) / (12 * scale)) + 1 + (row % 2) * 0.5) * 12 * scale;
          const yEnd = Math.min(y + pitch * 0.6, south - thickness);
          const end = spans(yEnd);
          if (end.length !== a.length || joint <= x0 || joint + thickness >= x1) continue;
          if (joint > end[i] + scale && joint + thickness < end[i + 1] - scale)
            mark(joint, y + thickness, joint + thickness, yEnd, 0.91);
        }
      }
    };
    const h = style.height * scale;
    const courses = (p, lo, hi, count, color) => {
      if (options.geometryOnly) return;
      for (let i = 1; i <= count; i++) {
        const z = lo + (hi - lo) * i / (count + 1);
        add(p, z, z + 0.28 * scale, color);
      }
    };
    const windows = (p, z) => {
      if (options.geometryOnly) return;
      let budget = 20;
      for (let i = 0; i < p.length && budget > 0; i++) {
        const a = p[i], b = p[(i + 1) % p.length], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
        if (length < 10 * scale) continue;
        const count = Math.min(2, Math.floor(length / (18 * scale)) + 1);
        const nx = dy / length * 0.15, ny = -dx / length * 0.15;
        for (let j = 1; j <= count && budget-- > 0; j++) {
          const t = j / (count + 1), half = 1.2 * scale / length;
          const a0 = { x: a.x + dx * (t - half), y: a.y + dy * (t - half) };
          const b0 = { x: a.x + dx * (t + half), y: a.y + dy * (t + half) };
          add([a0, { x: a0.x + nx, y: a0.y + ny }, { x: b0.x + nx, y: b0.y + ny }, b0], z, z + 2.2 * scale, shade(palette.roof, 0.6));
        }
      }
    };
    add(ring, 0, h, palette.wall);
    if (styleId !== 'ruin') {
      courses(ring, 0, h, styleId === 'brick' || styleId === 'fort' ? 3 : 1, shade(palette.wall, 0.9));
      windows(ring, h * 0.48);
    }
    if (styleId === 'ruin') {
      // Low, open walls keep the original damaged floor visible.
      result.prisms.length = 0; result.height = 0;
      const inner = inset(ring, 2 * scale);
      if (inner) {
        for (let i = 0; i < ring.length; i++) {
          const j = (i + 1) % ring.length;
          slab([ring[i], ring[j], inner[j], inner[i]], 0, (i % 3 === 0 ? 2.5 : 4) * scale, palette.wall);
        }
      } else slab(ring, 0, 2 * scale, palette.roof);
      return result;
    }
    if (styleId === 'pyramid' || styleId === 'japanese') {
      let current = ring, z = h;
      const japanese = styleId === 'japanese';
      if (japanese) current = inset(ring, -1.8 * scale) || ring;
      slab(current, h, h + 0.8 * scale, palette.trim); z += 0.8 * scale;
      const xs = current.map(p => p.x), ys = current.map(p => p.y);
      let lo = 0, hi = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
      // Find a common safe roof setback. Concave narrow wings end at a ridge
      // together; a large rectangular roof does not retain a huge flat centre.
      for (let i = 0; i < 8; i++) { const mid = (lo + hi) / 2; if (inset(current, mid)) lo = mid; else hi = mid; }
      const reach = lo * 0.94 / scale;
      const widths = options.geometryOnly && !japanese ? [reach] : japanese ? [reach * 0.2, reach * 0.35, reach * 0.45] : [reach / 4, reach / 4, reach / 4, reach / 4];
      const rises = options.geometryOnly && !japanese ? [9.2] : japanese ? [0.45, 1.5, 3.5] : [2.3, 2.3, 2.3, 2.3];
      for (let i = 0; i < widths.length; i++) {
        const next = inset(current, widths[i] * scale);
        if (!next) break;
        // Quiet material rows are retained loft strips; they follow every
        // roof edge and require no per-frame texture upload. Three strips per
        // slope band bounds the detail even on a city-sized footprint.
        const rows = options.geometryOnly ? 1 : 3;
        const rise = options.geometryOnly ? Math.min(rises[i], widths[i] * 0.45) : rises[i];
        for (let row = 0; row < rows; row++) {
          const interpolate = t => current.map((p, j) => ({ x: p.x + (next[j].x - p.x) * t, y: p.y + (next[j].y - p.y) * t }));
          add(interpolate(row / rows), z + rise * scale * row / rows,
            z + rise * scale * (row + 1) / rows, shade(palette.roof, options.geometryOnly ? 1 : row === 0 ? 0.92 : 1), false, interpolate((row + 1) / rows), true);
        }
        current = next; z += rise * scale;
      }
      cap(current, z, palette.roof);
      slab(current, z, z + 0.7 * scale, palette.trim);
    } else if (styleId === 'multistorey') {
      slab(ring, h - scale, h + scale, palette.trim);
      const upper = inset(ring, 3 * scale) || ring;
      slab(upper, h + scale, h * 2, palette.wall);
      courses(upper, h + scale, h * 2, 1, shade(palette.wall, 0.9));
      windows(upper, h * 1.5);
      slab(upper, h * 2, h * 2 + scale, palette.trim);
      materialCap(upper, h * 2 + scale, palette.roof);
    } else {
      materialCap(ring, h, palette.roof);
      const inner = inset(ring, 1.6 * scale);
      if (inner) for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        slab([ring[i], ring[j], inner[j], inner[i]], h, h + (styleId === 'fort' ? 2.5 : 1.3) * scale, palette.trim);
      }
    }
    return result;
  }
  function emit(scene, source, points, styleId, options) {
    const geometry = build(points, styleId, options), group = scene._wallPerspective[source];
    group.alwaysActive = true;
    const support = { x: points.reduce((v, p) => v + p.x, 0) / points.length,
      y: points.reduce((v, p) => v + p.y, 0) / points.length, order: group.blocks.length };
    for (const p of geometry.prisms) WallPerspective.prism(scene, source, p.points, p.bottom, p.top, p.colors, support, p.capped,
      { topPoints: p.topPoints, allFaces: p.allFaces });
    return geometry;
  }
  global.BuildingStyles = { STYLES, build, emit, inset, triangulate };
})(window);
