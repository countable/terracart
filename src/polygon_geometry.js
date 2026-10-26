// Pure footprint geometry shared by generation, visibility and building meshes.
(function (root) {
  'use strict';
  const EPSILON = 1e-8;
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const polyArea = ring => ring.reduce((sum, point, i) => {
    const next = ring[(i + 1) % ring.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;

  // Mutates an owned ring because geometry builders retain its starting point.
  function ensureCCW(ring) {
    if (polyArea(ring) < 0) ring.reverse();
    return ring;
  }

  // The optional tolerance admits points on an edge. Consumers pass their own
  // geometry epsilon because castle and building scales differ.
  function pointInPolygon(ring, point, epsilon = 0) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      if (epsilon > 0 && Math.abs(cross(a, b, point)) < epsilon
          && point.x >= Math.min(a.x, b.x) - epsilon && point.x <= Math.max(a.x, b.x) + epsilon
          && point.y >= Math.min(a.y, b.y) - epsilon && point.y <= Math.max(a.y, b.y) + epsilon) return true;
      if ((a.y > point.y) !== (b.y > point.y)
          && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

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

  // Intersect a convex subject with a counterclockwise convex clip ring.
  // Match castle clipping tolerance and never extrapolate near-parallel edges.
  function intersectConvex(subject, clip) {
    let polygon = subject;
    for (let i = 0; polygon.length && i < clip.length; i++) {
      const a = clip[i], b = clip[(i + 1) % clip.length], out = [];
      for (let j = 0; j < polygon.length; j++) {
        const p = polygon[j], q = polygon[(j + 1) % polygon.length];
        const dp = cross(a, b, p), dq = cross(a, b, q), ip = dp >= -1e-6, iq = dq >= -1e-6;
        if (ip) out.push(p);
        if (ip !== iq) {
          const t = Math.max(0, Math.min(1, dp / (dp - dq)));
          out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        }
      }
      polygon = out.filter((p, j) => Math.hypot(p.x - out[(j + out.length - 1) % out.length].x,
        p.y - out[(j + out.length - 1) % out.length].y) > 1e-6);
      if (polygon.length < 3 || Math.abs(polyArea(polygon)) <= 1e-6) polygon = [];
    }
    return polygon;
  }

  // Reuse this prepared clipper for all solid ground pieces of one building.
  // Fully contained pieces are retained unchanged; convex unions avoid seams.
  function createFootprintClipper(points) {
    let sourceTriangles;
    // A source ring can have hundreds of edges. Index its vertical spans once:
    // ray tests only need edges at the query height, and segment crossings only
    // need overlapping bounds. Keep the same epsilon predicates as FDR contains.
    const epsilon = 1e-6;
    const sourceEdges = points.map((a, i) => {
      const b = points[(i + 1) % points.length];
      return { a, b, left: Math.min(a.x, b.x), right: Math.max(a.x, b.x),
        north: Math.min(a.y, b.y), south: Math.max(a.y, b.y) };
    });
    const sourceNorth = sourceEdges.length ? Math.min(...sourceEdges.map(e => e.north)) : 0;
    const sourceSouth = sourceEdges.length ? Math.max(...sourceEdges.map(e => e.south)) : 0;
    const bucketHeight = Math.max(1, (sourceSouth - sourceNorth) / 64);
    const edgeBuckets = new Map();
    const bucketAt = y => Math.floor((y - sourceNorth) / bucketHeight);
    for (const edge of sourceEdges) {
      for (let i = bucketAt(edge.north - epsilon); i <= bucketAt(edge.south + epsilon); i++) {
        if (!edgeBuckets.has(i)) edgeBuckets.set(i, []);
        edgeBuckets.get(i).push(edge);
      }
    }
    const pointInside = p => {
      let inside = false;
      for (const { a, b, left, right, north, south } of edgeBuckets.get(bucketAt(p.y)) || []) {
        if (Math.abs(cross(a, b, p)) < epsilon
            && p.x >= left - epsilon && p.x <= right + epsilon
            && p.y >= north - epsilon && p.y <= south + epsilon) return true;
        if ((a.y > p.y) !== (b.y > p.y)
            && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    };
    const containsFootprint = ring => {
      if (!ring.every(pointInside)) return false;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        if (!pointInside({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) return false;
        const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
        const north = Math.min(a.y, b.y), south = Math.max(a.y, b.y);
        for (const edge of sourceEdges) {
          if (edge.right < left || edge.left > right || edge.south < north || edge.north > south) continue;
          const c = edge.a, d = edge.b;
          if (cross(a, b, c) * cross(a, b, d) < -epsilon
              && cross(c, d, a) * cross(c, d, b) < -epsilon) return false;
        }
      }
      return true;
    };
    const clipFootprint = ring => {
      if (containsFootprint(ring)) return [ring];
      if (!sourceTriangles) {
        const source = points.filter((p, i) => {
          const before = points[(i + points.length - 1) % points.length];
          return Math.hypot(p.x - before.x, p.y - before.y) > 1e-6;
        }).map(p => ({ x: p.x, y: p.y }));
        ensureCCW(source);
        removeCollinear(source);
        const first = source.reduce((best, p, i) => p.x < source[best].x
          || (p.x === source[best].x && p.y < source[best].y) ? i : best, 0);
        source.push(...source.splice(0, first));
        sourceTriangles = triangulate(source).map(points => ({ points,
          left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
          north: Math.min(...points.map(p => p.y)), south: Math.max(...points.map(p => p.y)) }));
      }
      const left = Math.min(...ring.map(p => p.x)), right = Math.max(...ring.map(p => p.x));
      const north = Math.min(...ring.map(p => p.y)), south = Math.max(...ring.map(p => p.y));
      const fragments = sourceTriangles.filter(t => t.right >= left && t.left <= right
        && t.south >= north && t.north <= south)
        .map(t => intersectConvex(ring, t.points)).filter(p => p.length >= 3);
      if (fragments.length < 2) return fragments;
      // Most clipped corners still form one convex strip. Recover its exact
      // union to avoid retaining the source triangulation's internal walls.
      const vertices = fragments.flat().sort((a, b) => a.x - b.x || a.y - b.y);
      const chain = list => {
        const hull = [];
        for (const p of list) {
          while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 1e-8) hull.pop();
          hull.push(p);
        }
        return hull.slice(0, -1);
      };
      const hull = [...chain(vertices), ...chain(vertices.slice().reverse())];
      const covered = fragments.reduce((sum, p) => sum + Math.abs(polyArea(p)), 0);
      if (Math.abs(Math.abs(polyArea(hull)) - covered) < 1e-5
          && containsFootprint(hull)) return [hull];
      return fragments;
    };
    clipFootprint.contains = containsFootprint;
    return clipFootprint;
  }

  root.PolygonGeometry = { cross, polyArea, ensureCCW, pointInPolygon,
    removeCollinear, triangulate, pointInRings, unionAreaInCell, intersectConvex, createFootprintClipper };
})(globalThis);
