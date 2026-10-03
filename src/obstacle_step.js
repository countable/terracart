// Visual support height only: coordinates, movement and collision stay on the
// ground. Position owns the lift, so stopping or reversing never runs a timer
// out while the player's feet are still inside a prop.
const ObstacleStep = (() => {
  const BALANCE_SPEED_MUL = 0.7;
  function speedMul(support) { return (support?.liftPx || 0) > 0.5 ? BALANCE_SPEED_MUL : 1; }
  const PROFILES = Object.freeze({
    rock: Object.freeze({ liftPx: 4, radius: 0.25, top: 0.185, shape: 'round' }),
    wall: Object.freeze({ liftPx: 5, radius: 0.29, top: 0.21, shape: 'band' }),
    bush: Object.freeze({ liftPx: 3, radius: 0.25, top: 0.19, shape: 'round' }),
    hedge: Object.freeze({ liftPx: 6, radius: 0.29, top: 0.21, shape: 'band' }),
  });
  const KINDS = { mineralrock: 'rock', stronghold_wall: 'wall' };
  const CROPS = { rockfruit: 'rock', shrub: 'bush', berry: 'bush' };

  function profile(o) {
    if (!o) return null;
    if (o.kind === 'tree' && o.size === 'bush') return PROFILES.bush;
    if (o.kind === 'wildplant') {
      if (o.crop === 'shrub' && o._plantArt === 'zone_hedge') return PROFILES.hedge;
      return PROFILES[CROPS[o.crop]] || null;
    }
    return PROFILES[KINDS[o.kind]] || null;
  }

  function bandDistance(o, x, y) {
    const frame = o.kind === 'stronghold_wall' ? o.variant : o._hedgeFrame;
    const mask = QuarryLayout.wallMaskForFrame(frame ?? 0);
    let distance = Math.hypot(x, y);
    // Connected half-cell arms meet exactly at shared cell edges. Use the
    // union at corners and junctions, never a diagonal shortcut across them.
    for (const [bit, dx, dy] of [[1, 0, -0.5], [2, 0.5, 0], [4, 0, 0.5], [8, -0.5, 0]]) {
      if (!(mask & bit)) continue;
      const t = Math.max(0, Math.min(1, (x * dx + y * dy) / 0.25));
      distance = Math.min(distance, Math.hypot(x - t * dx, y - t * dy));
    }
    return distance;
  }

  // Radii are cell fractions; lift is in unzoomed game pixels. The caller
  // passes only present/uncleared props. Max support (never sum) also lets a
  // connected row of walls share its flat top instead of bouncing each cell.
  function sample(x, y, objects, cellM) {
    let liftPx = 0, obstacle = null, support = null;
    const supports = [];
    if (!(cellM > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return { liftPx, obstacle, profile: support, supports };
    for (const o of objects || []) {
      const p = profile(o);
      if (!p || !Number.isFinite(o.x) || !Number.isFinite(o.y)) continue;
      const dx = (x - o.x) / cellM, dy = (y - o.y) / cellM;
      const distance = p.shape === 'band' ? bandDistance(o, dx, dy) : Math.hypot(dx, dy);
      if (distance >= p.radius) continue;
      const t = Math.max(0, Math.min(1, (p.radius - distance) / (p.radius - p.top)));
      const height = p.liftPx * t * t * (3 - 2 * t);
      supports.push(o);
      if (height > liftPx) { liftPx = height; obstacle = o; support = p; }
    }
    return { liftPx, obstacle, profile: support, supports };
  }
  function balance(phaseCells, amount) {
    return Math.sin(phaseCells * Math.PI * 2 / 1.3) * 0.035 * Math.max(0, Math.min(1, amount));
  }
  return { BALANCE_SPEED_MUL, speedMul, PROFILES, profile, sample, balance };
})();
