// Authored cave areas claim their empty ground before ordinary floor dressing.
// Plans are immutable with respect to their inputs; applying one is explicit.
(function (root) {
  'use strict';
  const SPRING = Object.freeze({
    id: 'spring_cave', extentCells: 25, poolRadius: 3, sourceRadius: 0.65,
    mushroomRadius: 5, stoneRadius: 8, ringHalfWidth: 0.4, approachHalfWidth: 0.6
  });
  const GROVE_WEIGHTS = Object.freeze([
    { id: 'spring_cave', weight: 35 }, { id: 'goblin_warrens', weight: 30 },
    { id: 'mushroom_cavern', weight: 30 }, { id: 'gemstone_cavern', weight: 5 }
  ]);
  function select(anchor, depth) {
    if (depth !== 1 || anchor.kind !== 'grove') return null;
    let ticket = fnv1a(`cave-area|${root.ZoneVariants.identity(anchor)}|${depth}`) / 4294967296 * GROVE_WEIGHTS.reduce((sum, row) => sum + row.weight, 0);
    for (const row of GROVE_WEIGHTS) {
      ticket -= row.weight;
      if (ticket < 0) return row.id;
    }
    return null;
  }
  // Used by the preview as well as the live plan. The four radial approaches
  // meet the dry bank; they do not turn into bridges through the pool.
  function materialAt(u, v) {
    const r = Math.hypot(u, v);
    if (r <= SPRING.sourceRadius) return 'source';
    if (r <= SPRING.poolRadius) return 'water';
    if (Math.abs(u) <= SPRING.approachHalfWidth || Math.abs(v) <= SPRING.approachHalfWidth) return null;
    if (Math.abs(r - SPRING.mushroomRadius) <= SPRING.ringHalfWidth) return 'mushroom';
    if (Math.abs(r - SPRING.stoneRadius) <= SPRING.ringHalfWidth) return 'stone';
    return null;
  }
  function plan(ctx) {
    const out = { reserved: new Set(), areas: [], diagnostics: [], terrain: new Map(), objects: [], wildplants: [], moves: [] };
    const WG = root.WorldGen, V = root.ZoneVariants;
    const { surface, grid, N, tx, ty, tileEdgeM, depth } = ctx;
    const field = surface && surface.zone, coverage = field && (field.coverage || field.idx);
    if (depth !== 1 || !coverage || !V || !WG) return out;
    const source = field.caveSource || surface.caveSource || surface;
    const sourceGrid = source.baseGrid || source.grid;
    if (!sourceGrid) return out;
    const occupied = ctx.occupied || new Set();
    const frame = WG.tileFrame({ cellsPerEdge: N }, tx, ty, tileEdgeM);
    const landmarks = ctx.objects || [];
    const halo = (ix, iy) => {
      const cells = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!frame.inTile(ix + dx, iy + dy)) return null;
        cells.push((iy + dy) * N + ix + dx);
      }
      return cells;
    };
    const positionOf = object => out.moves.find(move => move.object === object) || frame.cellOf(object.x, object.y);
    const sourceOpts = { spawnWhy: source.spawnWhy || surface.spawnWhy, roadMask: surface.roadMask };
    const caveOpts = { spawnWhy: ctx.spawnWhy };
    // Coverage resolves ownership; identity order also makes diagnostics and
    // output order stable when a tile's anchor array is reordered.
    const anchors = (field.anchors || []).map((anchor, index) => ({ anchor, index, key: V.identity(anchor) }))
      .filter(s => select(s.anchor, depth) === SPRING.id).sort((a, b) => a.key.localeCompare(b.key));
    for (const s of anchors) {
      const a = V.anchorFrame(s.anchor, { N, tx, ty });
      const radius = SPRING.stoneRadius + SPRING.ringHalfWidth;
      const half = Math.ceil(radius);
      const [left, top] = a.local(a.originX - half * a.unit, a.originY - half * a.unit);
      const [right, bottom] = a.local(a.originX + half * a.unit, a.originY + half * a.unit);
      const diagnostic = { anchorKey: s.key, variant: SPRING.id, status: 'declined', reason: null };
      out.diagnostics.push(diagnostic);
      const cells = [];
      let reason = null;
      for (let iy = top; iy <= bottom && !reason; iy++) for (let ix = left; ix <= right; ix++) {
        const u = ((tx * 4096 + (ix + 0.5) * 4096 / N) - a.originX) / a.unit;
        const v = ((ty * 4096 + (iy + 0.5) * 4096 / N) - a.originY) / a.unit;
        if (Math.hypot(u, v) > radius) continue;
        if (!frame.inTile(ix, iy)) { reason = 'tile_boundary'; break; }
        const i = iy * N + ix;
        if (coverage[i] !== s.index + 1 || out.reserved.has(i)) { reason = 'ownership'; break; }
        if (grid[i] !== WG.T.CAVE_FLOOR ||
            !WG.isSpawnCell(sourceGrid, N, N, ix, iy, sourceOpts, 'minor') ||
            !WG.isSpawnCell(grid, N, N, ix, iy, caveOpts, 'minor')) { reason = 'blocked_ground'; break; }
        const material = materialAt(u, v);
        cells.push({ i, ix, iy, u, v, material });
      }
      if (reason) { diagnostic.reason = reason; continue; }
      const byCell = new Map(cells.map(c => [c.i, c]));
      const wet = i => ['source', 'water'].includes(byCell.get(i)?.material);
      // A grove's own mirrored reward can move to its bank; unrelated caches
      // and stairs remain fixed. Surface dressing uses this same POI match.
      const sourceChest = s.anchor.owned && (surface.genObjects || surface.objects || []).find(o =>
        o.kind === 'chest' && o._poiAt === `${s.anchor.lx},${s.anchor.ly}`);
      const mirror = sourceChest && landmarks.find(o => o.kind === 'chest' && o.caveOf === sourceChest.id);
      const old = mirror && positionOf(mirror);
      const oldHalo = old && halo(old.ix, old.iy);
      const relocating = oldHalo && oldHalo.some(wet);
      const dry = new Set(occupied);
      for (const move of out.moves) { dry.delete(move.from); dry.add(move.to); }
      if (relocating) dry.delete(old.iy * N + old.ix);
      for (const object of landmarks) {
        if (relocating && object === mirror) continue;
        const p = positionOf(object);
        // Preserve boundary landmarks too; their in-tile approach still counts.
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (frame.inTile(p.ix + dx, p.iy + dy)) dry.add((p.iy + dy) * N + p.ix + dx);
        }
      }
      let move = null;
      if (relocating) {
        // Prefer the east bank, then the other cardinal banks. The reward's
        // dry approach suppresses authored mushrooms just like any landmark.
        for (const [u, v] of [[5, 0], [0, 5], [-5, 0], [0, -5]]) {
          const [ix, iy] = a.local(a.originX + u * a.unit, a.originY + v * a.unit);
          const to = iy * N + ix, access = halo(ix, iy);
          if (byCell.get(to)?.material || !access || access.some(i => !byCell.has(i) || wet(i) || dry.has(i))) continue;
          move = { object: mirror, from: old.iy * N + old.ix, to, ...frame.centre(ix, iy), ix, iy };
          for (const i of access) dry.add(i);
          break;
        }
        if (!move) { diagnostic.reason = 'mirror_bank_blocked'; continue; }
      }
      if (cells.some(c => wet(c.i) && dry.has(c.i))) { diagnostic.reason = 'landmark_pool'; continue; }
      // Commit proposed movement to the plan only after the whole area passes.
      if (move) out.moves.push(move);
      const id = `cave_area|${s.key}|${depth}`;
      const reserved = new Set(cells.map(c => c.i));
      const [centreX, centreY] = a.local(a.originX, a.originY);
      out.areas.push({ id, kind: SPRING.id, anchorKey: s.key, depth, ix: centreX, iy: centreY,
        ...frame.centre(centreX, centreY), reserved });
      for (const c of cells) {
        out.reserved.add(c.i);
        if (c.material === 'source' || c.material === 'water') {
          out.terrain.set(c.i, c.material === 'source' ? WG.T.CAVE_WALL : WG.T.WATER);
          continue;
        }
        if (!c.material || dry.has(c.i)) continue;
        const p = frame.centre(c.ix, c.iy);
        const slotId = `${id}|${Math.round(c.u)},${Math.round(c.v)}|${c.material}`;
        const extra = { _ix: c.ix, _iy: c.iy, _cave: true, caveArea: id };
        if (c.material === 'mushroom') out.wildplants.push(WG.makeWildplant('mushroom', p.x, p.y, slotId, extra));
        else out.objects.push(WG.makeObject('mineralrock', p.x, p.y, slotId, { ...extra, requiredTier: 1, caveVariant: 0 }));
      }
      diagnostic.status = 'placed';
    }
    return out;
  }
  function apply(plan, grid, objects, wildplants, occupied) {
    for (const move of plan.moves) {
      Object.assign(move.object, { x: move.x, y: move.y, _ix: move.ix, _iy: move.iy });
      occupied.delete(move.from);
      occupied.add(move.to);
    }
    for (const [i, terrain] of plan.terrain) grid[i] = terrain;
    objects.push(...plan.objects);
    wildplants.push(...plan.wildplants);
    // Reservations deliberately do not become object occupancy. The caller
    // unions them into the gate supplied to ordinary fill and runtime spawns.
    const N = Math.sqrt(grid.length);
    for (const o of plan.objects.concat(plan.wildplants)) occupied.add(o._iy * N + o._ix);
    return plan;
  }
  root.CaveAreas = { SPRING, GROVE_WEIGHTS, select, materialAt, plan, apply };
})(typeof window !== 'undefined' ? window : globalThis);
