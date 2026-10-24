// Purchased mountain edges, exported once at 32px with the RA olive-grey ramp.
// The world ring resolves tile seams; artwork never changes collision or access.
const MountainEdges = (() => {
  const KEY = 'mountain_edges';
  const OFFSETS = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
  // Prefer edge-sharing ground, then diagonal ground. Never sample another
  // rock or a structural footprint as the substrate of an exposed edge.
  function groundType(ring, stride, index) {
    const x = index % stride, y = Math.floor(index / stride);
    // A trimmed neighbour is the matching apron beneath the solid edge.
    for (const [dx, dy] of OFFSETS)
      if (x + dx >= 0 && x + dx < stride && y + dy >= 0
        && ring[index + dy * stride + dx] === 33) return 33;
    for (const [dx, dy] of OFFSETS) {
      if (x + dx < 0 || x + dx >= stride || y + dy < 0) continue;
      const type = ring[index + dy * stride + dx];
      if (type != null && type >= 0 && ![7,8,9,10,11,12,13,14,23,25,30,32].includes(type)) return type;
    }
    return 10; // Fully enclosed rock has no exposed substrate.
  }
  function select(ring, stride, index, x, y) {
    if (ring[index] !== 32) return null;
    let mask = 0;
    for (let bit = 0; bit < OFFSETS.length; bit++) {
      const [dx,dy] = OFFSETS[bit];
      if (ring[index + dy * stride + dx] === 32) mask |= 1 << bit;
    }
    const hash = (Math.imul(x,73856093) ^ Math.imul(y,19349663)) >>> 0;
    return {key:KEY, frame:(hash % 4) * 256 + mask};
  }
  return {select, groundType};
})();
if (typeof ASSETS !== 'undefined') ASSETS.mountain_edges = {
  kind:'spritesheet', path:'assets/terrain/mountain-edges.png', frameWidth:32, frameHeight:32,
};
if (typeof window !== 'undefined') window.MountainEdges = MountainEdges;
