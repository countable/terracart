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

  root.PolygonGeometry = { removeCollinear, triangulate, pointInRings };
})(globalThis);
