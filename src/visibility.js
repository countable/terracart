// Current sight is separate from Fog's permanent exploration history.
// All positions are world metres; cell conversion always uses coords.js so
// latitude-dependent tile rows keep their own grid.
const Visibility = (() => {
  const CLEAR = 0, PARTIAL = 1, FULL = 2;
  const TREE_SIGHT_PENALTY = 2, PARTIAL_DARKNESS = 0.5, FULL_DARKNESS = 0.88;
  const states = new WeakMap();
  function objectCover(o) {
    if (ObstacleStep.profile(o)) return FULL;
    return o && (o.kind === 'tree' || o.kind === 'fruittree') ? PARTIAL : CLEAR;
  }
  function key(c) { return c.cellIX + '_' + c.cellIY; }
  function ready(scene) {
    return !!(scene?.originPx && scene.startWorldM && scene.playerM && scene.mPerPx > 0 && scene.cellsPerTile > 0);
  }

  function state(scene) {
    let s = states.get(scene);
    if (!s) { s = { revision: 0, cells: new Map(), rays: new Map() }; states.set(scene, s); }
    const frame = scene.game?.loop?.frame ?? scene.time?.now;
    const dug = scene.dugWallSet?.size || 0;
    const p = playerWorldM(scene);
    if (frame !== undefined && s.frame === frame && s.depth === scene.depth && s.dug === dug
        && s.px === p.x && s.py === p.y) return s;
    s.frame = frame;
    // Chunk queries inspect only the local sight/render region, never all the
    // objects in each loaded tile. The margin also covers off-screen enemies.
    const radius = Math.max(32, (scene.viewCells || 0) * 2) * scene.cellM;
    const pc = worldMetersToTileCell(scene, p.x, p.y);
    const entries = [], signature = [scene.depth, dug, pc.tx, pc.ty,
      Math.floor(p.x / scene.cellM), Math.floor(p.y / scene.cellM), scene.brokenRockSet?.size];
    for (const prop of ['chopped', 'picked', 'burnedObjects', 'burnedGround']) {
      const value = scene.save?.[prop]; signature.push(value, value?.length, value?.size);
    }
    for (let ty = pc.ty - 1; ty <= pc.ty + 1; ty++) {
      for (let tx = pc.tx - 1; tx <= pc.tx + 1; tx++) {
        const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
        if (!entry || (entry.depth != null && entry.depth !== (scene.depth || 0))) continue;
        entries.push(entry); signature.push(entry, entry.grid);
        for (const prop of ['objects', 'wildplants']) {
          const arr = entry[prop]; signature.push(arr, arr?.length, arr?.[arr.length-1]);
        }
      }
    }
    if (s.px !== p.x || s.py !== p.y) s.rays.clear();
    s.px = p.x; s.py = p.y;
    // The normal mutation paths also update save ledgers or array identity/
    // length. A bounded refresh catches in-place presentation edits as well.
    const now = scene.time?.now ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (s.signature && signature.length === s.signature.length
        && signature.every((v,i) => v === s.signature[i]) && now - s.refreshed < 100) return s;
    s.signature = signature; s.refreshed = now;
    const cells = new Map(), grids = [];
    const sets = spentSets(scene, scene.save);
    const roadNight = typeof RoadSafety !== 'undefined' && RoadSafety.isNight(scene);
    const add = o => {
      const cover = objectCover(o);
      if (!cover || Math.abs(o.x - p.x) > radius || Math.abs(o.y - p.y) > radius) return;
      if (isSpent(o, sets) || (o.kind === 'wildplant' && sets.picked.has(o.id))) return;
      if (typeof HiddenObjects !== 'undefined' && HiddenObjects.isHidden(scene.save, o)) return;
      if (roadNight && RoadSafety.objectHidden(scene, o, true)) return;
      const k = key(worldMetersToAbsCell(scene, o.x, o.y));
      cells.set(k, Math.max(cover, cells.get(k) || CLEAR));
    };
    for (const entry of entries) {
        grids.push(entry.grid);
        for (const prop of ['objects', 'wildplants']) {
          WorldGen.forEachItemInBox(entry, prop, p.x-radius, p.y-radius, p.x+radius, p.y+radius, add);
        }
    }
    let changed = s.depth !== scene.depth || s.dug !== dug || cells.size !== s.cells.size
      || grids.length !== s.grids?.length || grids.some((g, i) => g !== s.grids[i]);
    if (!changed) for (const [k, v] of cells) if (s.cells.get(k) !== v) { changed = true; break; }
    if (changed) { s.revision++; s.rays.clear(); }
    s.cells = cells; s.depth = scene.depth; s.dug = dug; s.grids = grids;
    return s;
  }

  function trace(scene, s, ax, ay, bx, by) {
    if (![ax, ay, bx, by].every(Number.isFinite) || !(scene.cellM > 0)) return CLEAR;
    const ap = worldMetersToTilePx(scene, ax, ay), bp = worldMetersToTilePx(scene, bx, by);
    const aty = Math.floor(ap.y / WorldGen.TILE_PX), bty = Math.floor(bp.y / WorldGen.TILE_PX);
    if (!scene.cellsForRow || aty === bty) return uniformTrace(scene, s, ax, ay, bx, by, ap, bp, aty);
    const first = key(worldMetersToAbsCell(scene, ax, ay));
    const last = key(worldMetersToAbsCell(scene, bx, by));
    if (first === last) return CLEAR;
    const dx = bx - ax, dy = by - ay;
    let t = 0, cover = CLEAR;
    // Traverse exact cell boundaries rather than sampling a line: thin walls
    // cannot slip between samples. Re-evaluate row width at each crossing.
    for (let step = 0; step < 4096 && t < 1; step++) {
      const x = ax + dx * t, y = ay + dy * t;
      const c = worldMetersToAbsCell(scene, x, y), k = key(c);
      if (k === last) break; // The facing blocker itself remains visible.
      if (k !== first) {
        if (scene.depth !== 0 && scene.cellAt) {
          const terrain = scene.cellAt(x, y);
          if (terrain.loaded && terrain.type === 25) return FULL;
        }
        cover = Math.max(cover, s.cells.get(k) || CLEAR);
        if (cover === FULL) return FULL;
      }
      const center = absCellCenterMeters(scene, c.cellIX, c.cellIY);
      const row = absRowOf(scene, c.cellIY);
      const half = rowCellPx(scene, row) * scene.mPerPx / 2;
      const nx = dx ? (center.x + Math.sign(dx) * half - ax) / dx : Infinity;
      const ny = dy ? (center.y + Math.sign(dy) * half - ay) / dy : Infinity;
      // A diagonal cannot see through the shared corner of two solid cells.
      // One wall alone still permits a grazing ray past its exposed corner.
      if (Number.isFinite(nx) && Math.abs(nx - ny) < 1e-10 && nx < 1) {
        const hitX = ax + dx * nx, hitY = ay + dy * nx;
        const epsilon = half * 1e-6;
        const solid = (sx, sy) => {
          const c = worldMetersToAbsCell(scene, sx, sy);
          if (s.cells.get(key(c)) === FULL) return true;
          const terrain = scene.depth !== 0 && scene.cellAt?.(sx, sy);
          return !!(terrain?.loaded && terrain.type === 25);
        };
        if (solid(hitX + Math.sign(dx)*epsilon, hitY - Math.sign(dy)*epsilon)
            && solid(hitX - Math.sign(dx)*epsilon, hitY + Math.sign(dy)*epsilon)) return FULL;
      }
      t = Math.max(t + 1e-9, Math.min(nx, ny) + 1e-9);
    }
    return cover;
  }
  // Most rays stay inside one tile row. Integer DDA then needs no coordinate
  // objects per crossed cell; only seam-crossing rays use the general path.
  function uniformTrace(scene, s, ax, ay, bx, by, ap, bp, ty) {
    const scale = rowCells(scene, ty) / WorldGen.TILE_PX;
    const x0 = ap.x * scale, y0 = ap.y * scale, x1 = bp.x * scale, y1 = bp.y * scale;
    let ix = Math.floor(x0), iy = Math.floor(y0);
    const ex = Math.floor(x1), ey = Math.floor(y1), sx = Math.sign(x1-x0), sy = Math.sign(y1-y0);
    const firstX = ix, firstY = iy;
    const abs = worldMetersToAbsCell(scene, ax, ay), shiftX = abs.cellIX-ix, shiftY = abs.cellIY-iy;
    const dx = x1-x0, dy = y1-y0;
    const stepX = dx ? 1/Math.abs(dx) : Infinity, stepY = dy ? 1/Math.abs(dy) : Infinity;
    let tx = dx ? ((sx > 0 ? ix+1 : ix)-x0)/dx : Infinity;
    let tyHit = dy ? ((sy > 0 ? iy+1 : iy)-y0)/dy : Infinity;
    const cave = scene.depth !== 0 && scene.cellAt;
    const at = (x,y) => {
      let v = s.cells.get((x+shiftX)+'_'+(y+shiftY)) || CLEAR;
      if (cave) {
        const terrain = scene.cellAt(ax+(x+.5-x0)/scale*scene.mPerPx, ay+(y+.5-y0)/scale*scene.mPerPx);
        if (terrain.loaded && terrain.type === 25) v = FULL;
      }
      return v;
    };
    let cover = CLEAR;
    for (let steps = 0; steps < 4096 && (ix !== ex || iy !== ey); steps++) {
      if (ix !== firstX || iy !== firstY) {
        cover = Math.max(cover, at(ix,iy));
        if (cover === FULL) return FULL;
      }
      if (Math.abs(tx-tyHit) < 1e-10) {
        if (at(ix+sx,iy) === FULL && at(ix,iy+sy) === FULL) return FULL;
        ix += sx; iy += sy; tx += stepX; tyHit += stepY;
      } else if (tx < tyHit) { ix += sx; tx += stepX; }
      else { iy += sy; tyHit += stepY; }
    }
    return cover;
  }
  function coverBetween(scene, ax, ay, bx, by) { return ready(scene) ? trace(scene, state(scene), ax, ay, bx, by) : CLEAR; }
  function playerCover(scene, x, y) {
    if (!ready(scene)) return CLEAR;
    const s = state(scene), k = x + ',' + y;
    if (s.rays.has(k)) return s.rays.get(k);
    const result = trace(scene, s, s.px, s.py, x, y);
    // Dynamic creatures must not grow the retained field without bound.
    if (s.rays.size >= 8192) s.rays.clear();
    s.rays.set(k, result);
    return result;
  }
  function invalidate(scene) {
    const s = states.get(scene);
    if (s) { s.frame = undefined; s.signature = null; s.rays.clear(); s.revision++; }
  }
  return { CLEAR, PARTIAL, FULL, TREE_SIGHT_PENALTY, PARTIAL_DARKNESS, FULL_DARKNESS,
    objectCover, coverBetween, playerCover, revision: scene => ready(scene) ? state(scene).revision : 0, invalidate };
})();
