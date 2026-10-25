// Fixed MD/LG surfaces. These follow road class and restoration, never variant
// assignment. Native material pixels and rune rows are baked offline by
// tools/build_road_surfaces.py; rebuilds never read image pixels.
(function (global) {
  'use strict';
  const TILE_PX = 128;
  const MATERIAL_FRAME = { md: [0, 1], lg: [2, 3] };
  const materials = new Map();
  /* RUNE_ROWS_START */
  const RUNE_ROWS = [[6,9,2],[10,11,2],[5,6,3],[6,8,4],[9,10,4],[5,11,6],[6,7,7],[8,9,7],[6,10,8],[5,7,10],[9,11,10],[5,6,11],[7,9,11],[10,11,11],[5,6,12],[10,11,12]];
  /* RUNE_ROWS_END */

  function familyFor(tags) {
    const WG = global.WorldGen;
    if (!WG) return null;
    const tier = WG.classifyLine('transportation', tags || {});
    return tier === WG.T.ROAD_MD ? 'md' : tier === WG.T.ROAD_LG ? 'lg' : null;
  }
  function setSource(source) {
    materials.clear();
    if (!source || typeof document === 'undefined') return;
    for (const [family, frames] of Object.entries(MATERIAL_FRAME)) {
      for (let state = 0; state < 2; state++) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = TILE_PX;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(source, frames[state] * TILE_PX, 0, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
        materials.set(`${family}:${!!state}`, canvas);
      }
    }
  }
  function tile(family, restored) {
    return materials.get(`${family}:${!!restored}`) || null;
  }
  function metrics(run) {
    const distances = [0];
    for (let i = 1; i < run.length; i++) {
      distances.push(distances[i - 1] + Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y));
    }
    return { run, distances, length: distances[distances.length - 1] || 0 };
  }
  function at(m, distance, offset = 0) {
    const s = Math.max(0, Math.min(m.length, distance));
    let low = 1, high = m.run.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (m.distances[mid] < s) low = mid + 1;
      else high = mid;
    }
    const i = low, a = m.run[i - 1], b = m.run[i];
    const length = m.distances[i] - m.distances[i - 1];
    const dx = length ? (b.x - a.x) / length : 1;
    const dy = length ? (b.y - a.y) / length : 0;
    const t = length ? (s - m.distances[i - 1]) / length : 0;
    return { x: a.x + (b.x - a.x) * t - dy * offset,
      y: a.y + (b.y - a.y) * t + dx * offset, dx, dy, nx: -dy, ny: dx };
  }
  // Clip the arclength ranges before sampling. A distant or long source way
  // cannot turn one viewport rebuild into thousands of invisible glyphs.
  function visibleSpans(m, scene, width) {
    if (!(scene?.viewSize > 0)) return [[0, m.length]];
    const pad = width + 12;
    const left = scene.viewLeft - pad, right = scene.viewLeft + scene.viewSize + pad;
    const top = scene.viewTop - pad, bottom = scene.viewTop + scene.viewSize + pad;
    const spans = [];
    for (let i = 1; i < m.run.length; i++) {
      const a = m.run[i - 1], b = m.run[i], dx = b.x - a.x, dy = b.y - a.y;
      let lo = 0, hi = 1, rejected = false;
      for (const [p, q] of [[-dx, a.x-left], [dx, right-a.x], [-dy, a.y-top], [dy, bottom-a.y]]) {
        if (!p) { if (q < 0) rejected = true; continue; }
        const t = q / p;
        if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
      }
      if (rejected || hi < lo) continue;
      const length = m.distances[i] - m.distances[i - 1];
      const span = [m.distances[i - 1] + lo*length, m.distances[i - 1] + hi*length];
      const last = spans[spans.length - 1];
      if (last && span[0] <= last[1] + 1e-5) last[1] = span[1]; else spans.push(span);
    }
    return spans;
  }
  function firstRepeat(start, step, offset, phase) {
    return Math.ceil((start + phase - offset) / step) * step + offset - phase;
  }
  function trace(m, lo, hi, phase, offset = 0, rough = 0, step = 8) {
    const shift = s => offset + rough * (Math.sin((s+phase)*.13)*.62 + Math.sin((s+phase)*.31)*.38);
    const points = [at(m, lo, shift(lo))];
    for (let s = firstRepeat(lo, step, 0, phase); s < hi; s += step) {
      if (s > lo + 1e-5) points.push(at(m, s, shift(s)));
    }
    // Include source vertices so banks and drains follow bends exactly.
    const anchors = m.distances.filter(s => s > lo && s < hi);
    if (anchors.length) {
      const all = [lo, hi, ...anchors];
      for (let s = firstRepeat(lo, step, 0, phase); s < hi; s += step) if (s > lo) all.push(s);
      return all.sort((a,b) => a-b).map(s => at(m, s, shift(s)));
    }
    points.push(at(m, hi, shift(hi))); return points;
  }
  function stroke(g, points, width, color, alpha, roadWidth) {
    if (points.length > 1) g.decorPath(width, color, points, alpha, roadWidth);
  }
  function noise(index, salt) {
    let n = (index ^ salt) >>> 0;
    n = Math.imul(n ^ n >>> 16, 0x7feb352d);
    n = Math.imul(n ^ n >>> 15, 0x846ca68b);
    return ((n ^ n >>> 16) >>> 0) / 4294967296;
  }
  function glyph(g, m, distance, roadWidth) {
    const p = at(m, distance), scale = Math.min(1, roadWidth / 55);
    for (const [x0, x1, y] of RUNE_ROWS) {
      const point = x => ({ x: p.x + p.nx*(x-8)*scale + p.dx*(y-8)*scale,
        y: p.y + p.ny*(x-8)*scale + p.dy*(y-8)*scale });
      stroke(g, [point(x0), point(x1)], Math.max(.8, scale), 0x9ccfb9, .95, roadWidth);
    }
  }
  function medium(g, m, spans, width, restored, phase) {
    for (const [lo, hi] of spans) {
      if (restored) {
        // This is the approved restored Compacted Gravel Causeway treatment.
        stroke(g, trace(m, lo, hi, phase), width*.48, 0xc1b594, .17, width);
        for (const side of [-1, 1]) {
          stroke(g, trace(m, lo, hi, phase, width*.40*side), 2.2, 0x4f5143, .6, width);
          stroke(g, trace(m, lo, hi, phase, width*.45*side), 1.1, 0xc0b599, .5, width);
        }
      } else {
        // No continuous kerb/drain ink survives. Bare gravel is cracked and
        // the silhouette loses irregular chunks on alternating shoulders.
        for (let s = firstRepeat(lo, 43, 17, phase); s < hi; s += 43) {
          const index = Math.floor((s+phase-17)/43), side = index & 1 ? -1 : 1;
          const start = at(m, s, side*width*(.12 + noise(index, 29)*.08));
          const bend = at(m, s+3, -side*width*.10);
          const end = at(m, s+8, -side*width*.32);
          stroke(g, [start, bend, end], 1.2, 0x47493c, .88, width);
          if (g.cutPath) {
            const edge = at(m, s+12, side*width*.49);
            const bite = at(m, s+15, side*width*.40);
            g.cutPath(4 + noise(index, 89)*4, [edge, bite], width);
          }
        }
        // More frequent small scallops keep the outer boundary rough between
        // the larger missing sections. Stable distance salts prevent crawling.
        if (g.cutPath) for (let s = firstRepeat(lo, 19, 6, phase); s < hi; s += 19) {
          const index = Math.floor((s+phase-6)/19), side = index & 1 ? -1 : 1;
          const p = at(m, s, side*width*.50), q = at(m, s+2, side*width*.47);
          g.cutPath(2 + noise(index, 137)*3, [p, q], width);
        }
      }
    }
  }
  function large(g, m, spans, width, restored, phase) {
    for (const [lo, hi] of spans) {
      if (!restored) {
        // The approved Turquoise Dimensional Scar.
        const scar = trace(m, lo, hi, phase, 0, width*.09);
        stroke(g, scar, width*.19, 0x387f75, .28, width);
        stroke(g, scar, width*.105, 0x71cdb7, .85, width);
        stroke(g, scar, width*.055, 0x071c22, 1, width);
        for (let s = firstRepeat(lo, 62, 27, phase); s < hi; s += 62) {
          const index = Math.floor((s+phase-27)/62), side = index & 1 ? -1 : 1;
          stroke(g, [at(m, s), at(m, s+10, side*width*.28)], 1.1, 0x70ad9f, .68, width);
        }
      } else {
        // The approved Ancient Dimensional Conduit, using native rune pixels.
        for (const side of [-1, 1]) {
          stroke(g, trace(m, lo, hi, phase, width*.32*side), 3.8, 0x152b31, .9, width);
          stroke(g, trace(m, lo, hi, phase, width*.32*side), 1.5, 0x99d9c2, .92, width);
        }
        for (let s = firstRepeat(lo, 65, 22, phase); s < hi; s += 65) glyph(g, m, s, width);
      }
    }
  }
  // run is projected road geometry; startM identifies its first point along
  // the ORIGINAL source way. Partial repairs therefore keep the same phase.
  function decorate(scene, g, run, widthPx, family, restored, options = {}) {
    if (!g?.decorPath || !run || run.length < 2 || !(widthPx > 0)) return;
    if (family !== 'md' && family !== 'lg') return;
    const m = metrics(run);
    if (!m.length) return;
    const pxPerM = options.pxPerM || ((global.SpriteLayout?.CELL_PX || 32) / (scene?.cellM || 7));
    const phase = (options.startM || 0) * pxPerM;
    const spans = visibleSpans(m, scene, widthPx);
    if (family === 'md') medium(g, m, spans, widthPx, !!restored, phase);
    else large(g, m, spans, widthPx, !!restored, phase);
  }
  global.RoadSurfaces = { TILE_PX, familyFor, setSource, tile, decorate };
})(window);
