// Cosmetic building impacts. Rings and world coordinates are shared with the
// building overlay; nothing is damaged, saved, or made impassable.
const WallSmash = (() => {
  const CLEARANCE_M = 2;
  const PAUSE_MS = 110;
  function crossing(ax, ay, bx, by, ring, ox = 0, oy = 0) {
    const dx = bx - ax, dy = by - ay;
    let first = null;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const x = ox + ring[j], y = oy + ring[j + 1];
      const ex = ring[i] - ring[j], ey = ring[i + 1] - ring[j + 1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((x - ax) * ey - (y - ay) * ex) / den;
      const u = ((x - ax) * dy - (y - ay) * dx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (!first || t < first.t)) {
        // Orient the wall normal toward the side the body is trying to enter.
        const length = Math.hypot(ex, ey), sign = den > 0 ? 1 : -1;
        first = { t, x: ax + t * dx, y: ay + t * dy, edge: i,
          normalX: sign * ey / length, normalY: -sign * ex / length };
      }
    }
    return first;
  }
  function hit(scene, nx, ny, now) {
    const ax = scene.startWorldM.x + scene.playerM.x;
    const ay = scene.startWorldM.y + scene.playerM.y + (scene.feetOffsetM || 0);
    const bx = scene.startWorldM.x + nx, by = scene.startWorldM.y + ny + (scene.feetOffsetM || 0);
    let nearest = null;
    for (const [key, entry] of WorldGen.tileCache) {
      if (!entry.tileEdgeM || entry.depth) continue;
      const [, tx, ty] = key.split('/').map(Number);
      const ox = tx * entry.tileEdgeM, oy = ty * entry.tileEdgeM;
      if (Math.max(ax, bx) < ox || Math.min(ax, bx) > ox + entry.tileEdgeM ||
          Math.max(ay, by) < oy || Math.min(ay, by) > oy + entry.tileEdgeM) continue;
      for (const [shapeIndex, shape] of (entry.buildingShapes || []).entries()) {
        if (!shape.ring || shape.cleared) continue;
        const h = crossing(ax, ay, bx, by, shape.ring, ox, oy);
        if (!h) continue;
        // Resolve ownership only for walls crossed by this movement segment.
        // Looking up every distant footprint makes dense tiles quadratic.
        const house = (entry.objects || []).find(o => o.id === shape.key);
        if (typeof Houses !== 'undefined' && Houses.isHouseWreck(scene.save || {},
          house || { id: shape.key, kind: 'house', tier: shape.tier })) continue;
        const id = `${key}:${shape.key ?? shapeIndex}:${h.edge}`;
        if ((scene._wallSmashPass?.get(id) || 0) > now) continue;
        if (!nearest || h.t < nearest.t) nearest = { ...h, id };
      }
    }
    return nearest;
  }
  function hold(scene, nx, ny) {
    if (scene.depth) { scene._wallSmashPending = null; return false; }
    const now = performance.now(), h = hit(scene, nx, ny, now);
    if (!h) { scene._wallSmashPending = null; return false; }
    // GPS and manual steering both advance this target independently of the
    // body. Waiting longer never substitutes for actually clearing the wall.
    const target = scene._targetM;
    const clearance = target ?
      (scene.startWorldM.x + target.x - h.x) * h.normalX +
      (scene.startWorldM.y + target.y + (scene.feetOffsetM || 0) - h.y) * h.normalY : -Infinity;
    const pending = scene._wallSmashPending;
    if (clearance < CLEARANCE_M) {
      scene._wallSmashPending = { ...h, until: null };
      return true;
    }
    if (!pending || pending.id !== h.id || pending.until == null) {
      scene._wallSmashPending = { ...h, until: now + PAUSE_MS };
      return true;
    }
    if (now < pending.until) return true;
    scene._wallSmashPending = null;
    const passes = scene._wallSmashPass ||= new Map();
    for (const [id, until] of passes) if (until <= now) passes.delete(id);
    passes.set(h.id, now + 700);
    scene.flashAtWorld?.('SMASH!', h.x, h.y);
    return false;
  }
  return { crossing, hold, PAUSE_MS, CLEARANCE_M };
})();
