// Turret-free stone sanctuary. Coordinates and widths are canvas pixels.
(function (global) {
  const colors = Object.freeze({ floor: '#d8d5c8', face: '#8b929a',
    shadow: '#687581', coping: '#edeadd', edge: '#fff9e8', dormant: '#586f7c', joint: '#b3b7b6',
    active: '#b9fbff', glow: '#45d9ff' });
  const darkColors = Object.freeze({ ...colors, floor: '#565969', face: '#303744',
    shadow: '#242c39', coping: '#858b99', edge: '#b0b6c2', dormant: '#91a6b1', joint: '#414958' });
  const glyphs = [
    [[0, -5, 0, 5], [0, -5, 4, -1, 0, 2, -4, -1, 0, -5]],
    [[-4, -4, 0, 0, 4, -4], [0, -5, 0, 5], [-3, 3, 0, 0, 3, 3]],
    [[0, -5, -4, 0, 0, 5, 4, 0, 0, -5], [-4, 0, 4, 0]],
    [[-3, 5, -3, -5, 3, -1, -3, 2], [0, 0, 4, 5]],
  ];
  function points(ring) {
    if (!ring || ring.length < 3) return [];
    return typeof ring[0] === 'number'
      ? Array.from({ length: Math.floor(ring.length / 2) }, (_, i) => ({ x: ring[i * 2], y: ring[i * 2 + 1] }))
      : ring;
  }
  function trace(ctx, ring) {
    ctx.beginPath(); ctx.moveTo(ring[0].x, ring[0].y);
    for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
    ctx.closePath();
  }
  function inside(x, y, ring) {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  }
  function bounds(ring) {
    return ring.reduce((b, p) => ({ left: Math.min(b.left, p.x), right: Math.max(b.right, p.x),
      top: Math.min(b.top, p.y), bottom: Math.max(b.bottom, p.y) }),
    { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
  }
  // Find an interior altar site even when the OSM ring is concave.
  function altar(ring) {
    const b = bounds(ring); let best = null;
    for (let y = 1; y < 10; y++) for (let x = 1; x < 10; x++) {
      const p = { x: b.left + (b.right - b.left) * x / 10, y: b.top + (b.bottom - b.top) * y / 10 };
      if (!inside(p.x, p.y, ring)) continue;
      let radius = Infinity;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], q = ring[(i + 1) % ring.length], dx = q.x - a.x, dy = q.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        radius = Math.min(radius, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
      }
      if (!best || radius > best.radius) best = { ...p, radius };
    }
    return best;
  }
  function glyph(ctx, x, y, size, variant) {
    ctx.beginPath();
    for (const line of glyphs[variant % glyphs.length]) {
      ctx.moveTo(x + line[0] * size, y + line[1] * size);
      for (let i = 2; i < line.length; i += 2) ctx.lineTo(x + line[i] * size, y + line[i + 1] * size);
    }
    ctx.stroke();
  }
  function drawRunes(ctx, sourceRing, options = {}) {
    const ring = points(sourceRing); if (ring.length < 3) return;
    const scale = options.scale || 1, active = !!options.activated, paint = options.dark ? darkColors : colors;
    ctx.save(); trace(ctx, ring); ctx.clip();
    ctx.lineCap = 'square'; ctx.lineJoin = 'miter';
    ctx.strokeStyle = active ? paint.active : paint.dormant;
    ctx.lineWidth = 1.3 * scale;
    if (active) { ctx.shadowColor = paint.glow; ctx.shadowBlur = 9 * scale; }
    let count = 0;
    for (let i = 0; i < ring.length && count < 96; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y); if (length < 22 * scale) continue;
      const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
      const n = Math.min(12, Math.floor(length / (30 * scale)) || 1);
      for (let j = 0; j < n && count < 96; j++) {
        const t = (j + 0.5) / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        const sign = inside(x - dy * 9 * scale, y + dx * 9 * scale, ring) ? 1 : -1;
        const px = x - dy * 9 * scale * sign, py = y + dx * 9 * scale * sign;
        if (inside(px, py, ring)) glyph(ctx, px, py, scale * 0.75, count++);
      }
    }
    const site = altar(ring);
    if (site && site.radius > 14 * scale) {
      const radius = Math.min(20 * scale, site.radius - 10 * scale);
      ctx.beginPath(); ctx.arc(site.x, site.y, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(site.x, site.y, radius * 0.76, 0, Math.PI * 2); ctx.stroke();
      glyph(ctx, site.x, site.y, radius / 8, 0);
    }
    ctx.restore();
  }
  function draw(ctx, sourceRing, options = {}) {
    const ring = points(sourceRing); if (ring.length < 3) return;
    const scale = options.scale || 1, b = bounds(ring), paint = options.dark ? darkColors : colors;
    ctx.save();
    if (options.faces !== false) {
      ctx.save(); ctx.translate(0, 6 * scale); trace(ctx, ring);
      ctx.fillStyle = paint.face; ctx.fill(); ctx.restore();
    }
    trace(ctx, ring); ctx.fillStyle = paint.floor; ctx.fill(); ctx.clip();
    // Bounded masonry grid; long temple footprints do not create unbounded work.
    const step = Math.max(20 * scale, (b.right - b.left) / 48, (b.bottom - b.top) / 48);
    ctx.lineWidth = scale; ctx.strokeStyle = paint.joint;
    for (let y = b.top, row = 0; y < b.bottom; y += step, row++) {
      for (let x = b.left - (row % 2) * step / 2; x < b.right; x += step) {
        ctx.strokeRect(x, y, step, step);
      }
    }
    trace(ctx, ring); ctx.lineWidth = 13 * scale; ctx.strokeStyle = paint.shadow; ctx.stroke();
    trace(ctx, ring); ctx.lineWidth = 10 * scale; ctx.strokeStyle = paint.coping; ctx.stroke();
    trace(ctx, ring); ctx.lineWidth = 2 * scale; ctx.strokeStyle = paint.edge; ctx.stroke();
    ctx.restore();
    drawRunes(ctx, ring, options);
  }
  const material = paint => Object.freeze(Object.fromEntries(['floor', 'face', 'coping', 'edge', 'shadow']
    .map(key => [key === 'shadow' ? 'outline' : key, parseInt(paint[key].slice(1), 16)])));
  const marble = material(colors), tar = material(darkColors);
  function palette(activated = false, dark = false) { return dark ? tar : marble; }
  global.TempleArt = Object.freeze({ draw, drawRunes, colors, darkColors, palette });
})(window);
