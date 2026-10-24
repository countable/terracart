// Pure footprint geometry shared by generation, visibility and building meshes.
(function (root) {
  'use strict';
  const EPSILON = 1e-8;
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

  // Mutates an owned ring. Callers retain their winding/canonicalization order:
  // that order determines ear selection and therefore the retained roof mesh.
  function removeCollinear(ring) {
    let changed = true;
    while (changed && ring.length > 3) {
      changed = false;
      for (let i = 0; i < ring.length; i++) {
        if (Math.abs(cross(ring[(i + ring.length - 1) % ring.length], ring[i], ring[(i + 1) % ring.length])) < EPSILON) {
          ring.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    return ring;
  }

  // Ear-clip a counterclockwise, collinear-pruned ring. Preserve its vertex
  // references and starting vertex; failure returns no partial triangulation.
  function triangulate(ring) {
    const pending = ring.slice(), triangles = [];
    while (pending.length > 3) {
      let found = false;
      for (let i = 0; i < pending.length; i++) {
        const a = pending[(i + pending.length - 1) % pending.length], b = pending[i], c = pending[(i + 1) % pending.length];
        if (cross(a, b, c) <= EPSILON) continue;
        if (pending.some(p => p !== a && p !== b && p !== c
          && cross(a, b, p) >= -EPSILON && cross(b, c, p) >= -EPSILON && cross(c, a, p) >= -EPSILON)) continue;
        triangles.push([a, b, c]);
        pending.splice(i, 1);
        found = true;
        break;
      }
      if (!found) return [];
    }
    if (pending.length === 3) triangles.push(pending);
    return triangles;
  }

  // Even-odd over all feature rings: holes subtract regardless of winding.
  function pointInRings(rings, x, y) {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j], b = ring[i];
        if ((a.y > y) !== (b.y > y)) {
          const xint = a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y);
          if (x < xint) inside = !inside;
        }
      }
    }
    return inside;
  }

  // Union of independent footprint rings inside one unit cell. Split at
  // vertices, edge crossings and cell-boundary crossings: between those x
  // coordinates the union's vertical length is linear, so its midpoint
  // integral is exact, including concave and overlapping footprints.
  function unionAreaInCell(rings, cx, cy) {
    const edges = [], cuts = [cx, cx + 1];
    const addCut = x => { if (x > cx && x < cx + 1) cuts.push(x); };
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      addCut(a.x);
      if (a.x === b.x) continue;
      const edge = { a, b, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) };
      if (edge.hi <= cx || edge.lo >= cx + 1) continue;
      edges.push(edge);
      if (a.y !== b.y) for (const y of [cy, cy + 1]) {
        const t = (y - a.y) / (b.y - a.y);
        if (t > 0 && t < 1) addCut(a.x + t * (b.x - a.x));
      }
    }
    const at = (edge, x) => edge.a.y + (x - edge.a.x) * (edge.b.y - edge.a.y) / (edge.b.x - edge.a.x);
    for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i], b = edges[j];
      const lo = Math.max(cx, a.lo, b.lo), hi = Math.min(cx + 1, a.hi, b.hi);
      if (lo >= hi) continue;
      const d0 = at(a, lo) - at(b, lo), d1 = at(a, hi) - at(b, hi);
      if (d0 * d1 < 0) addCut(lo + (hi - lo) * d0 / (d0 - d1));
    }
    cuts.sort((a, b) => a - b);
    let area = 0;
    for (let k = 1; k < cuts.length; k++) {
      const width = cuts[k] - cuts[k - 1];
      if (!(width > 0)) continue;
      const x = (cuts[k] + cuts[k - 1]) / 2, spans = [];
      for (const ring of rings) {
        const ys = [];
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[j], b = ring[i];
          if ((a.x > x) !== (b.x > x)) ys.push(a.y + (x - a.x) * (b.y - a.y) / (b.x - a.x));
        }
        ys.sort((a, b) => a - b);
        for (let i = 0; i + 1 < ys.length; i += 2) {
          const lo = Math.max(cy, ys[i]), hi = Math.min(cy + 1, ys[i + 1]);
          if (hi > lo) spans.push([lo, hi]);
        }
      }
      spans.sort((a, b) => a[0] - b[0]);
      let length = 0, end = cy;
      for (const [lo, hi] of spans) if (hi > end) { length += hi - Math.max(lo, end); end = hi; }
      area += width * length;
    }
    return Math.min(1, Math.max(0, area));
  }

  root.PolygonGeometry = { removeCollinear, triangulate, pointInRings, unionAreaInCell };
})(globalThis);
