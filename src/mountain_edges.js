// Purchased mountain edges, exported once at 32px with the RA olive-grey ramp.
// The world ring resolves tile seams; artwork never changes collision or access.
const MountainEdges = (() => {
  const KEY = 'mountain_edges';
  const OFFSETS = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
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
  return {select};
})();
if (typeof ASSETS !== 'undefined') ASSETS.mountain_edges = {
  kind:'spritesheet', path:'assets/terrain/mountain-edges.png', frameWidth:32, frameHeight:32,
};
if (typeof window !== 'undefined') window.MountainEdges = MountainEdges;
