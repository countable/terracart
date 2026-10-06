// Cell-bound mushroom gas: a translucent, pixel-soft cloud over world sprites,
// under lighting and exploration fog. No textures or pixel readbacks per frame.
const GasRender = (() => {
  const FADE_MS = 320;
  const COLOR = 0xa68ac9;
  const HIGHLIGHT = 0xd5b8e6;

  // Phaser Graphics-compatible painter, also usable by the art preview adapter.
  // Stepped shoulders and sparse highlights keep a cell cloud from looking like
  // a rectangular terrain tint. All geometry stays inside its simulation cell.
  function paintCell(g, x, y, size, density, seed = 0, phase = 0) {
    // Square-root response keeps the spreading fringe visible: a .25-density
    // neighbour reads as a veil, while the source remains translucent.
    const alpha = Math.min(0.42, Math.sqrt(Math.max(0, density)) * 0.48);
    if (alpha < 0.001) return;
    const unit = size / 16;
    const wobble = Math.sin(phase + seed * 0.73);
    for (let row = 0; row < 8; row++) {
      const shoulder = [5, 2, 1, 0, 0, 1, 2, 5][row];
      const offset = (row + seed) % 3 === 0 ? 1 : 0;
      const left = shoulder + offset;
      const right = shoulder + ((row + seed) % 4 === 0 ? 1 : 0);
      const top = y + row * 2 * unit;
      g.fillStyle(COLOR, alpha * (row === 0 || row === 7 ? 0.35 : 0.72));
      g.fillRect(x + left * unit, top, (16 - left - right) * unit, 2 * unit);
      if (row > 1 && row < 6) {
        g.fillStyle(HIGHLIGHT, alpha * (0.16 + wobble * 0.025));
        const shift = (row * 3 + seed) % 4;
        g.fillRect(x + (left + 2 + shift) * unit, top, (7 - shift) * unit, unit);
      }
    }
    // A few drifting pale flecks suggest suspended spores without obscuring
    // the terrain, enemies or hidden source beneath the gas.
    g.fillStyle(HIGHLIGHT, alpha * 0.45);
    for (let i = 0; i < 3; i++) {
      const px = 3 + ((seed + i * 5) % 10);
      const py = 3 + ((seed * 3 + i * 7 + Math.floor(phase)) % 10);
      g.fillRect(x + px * unit, y + py * unit, unit, unit);
    }
  }

  function draw(scene) {
    const g = scene.gasGfx;
    if (!g) return;
    const now = scene.time?.now ?? performance.now();
    const depth = scene.depth ?? 0;
    let state = scene._gasVisual;
    if (!state || state.depth !== depth) {
      state = scene._gasVisual = { depth, cells: new Map() };
    }
    const anchor = viewAnchorWorldM(scene);
    const cells = MushroomGas.cells(scene);
    // Runtime retains this array until the simulation changes. Reconcile only
    // then; ordinary render frames avoid allocating a Set or walking the field.
    if (state.sourceCells !== cells) {
      state.sourceCells = cells;
      state.frameKey = null;
      const seen = new Set();
      for (const cell of cells) {
        const key = cellKeyFromAbsCell(cell.cellIX, cell.cellIY);
        seen.add(key);
        let entry = state.cells.get(key);
        if (!entry) {
          entry = { ...cell, from: 0, target: 0, changedAt: now };
          state.cells.set(key, entry);
        }
        if (entry.target !== cell.density) {
          entry.from = densityAt(entry, now);
          entry.target = cell.density;
          entry.changedAt = now;
        }
      }
      for (const [key, entry] of state.cells) {
        if (!seen.has(key) && entry.target !== 0) {
          entry.from = densityAt(entry, now);
          entry.target = 0;
          entry.changedAt = now;
        }
      }
    }
    // Geometry only changes at a modest visual cadence, or when the camera
    // moves. An idle empty field clears once and does no ongoing draw work.
    const frameKey = `${anchor.x}:${anchor.y}:${scene.viewCenterX}:${scene.viewCenterY}:${scene.cellM}:${state.cells.size ? Math.floor(now / 80) : 'empty'}:${depth}`;
    if (state.frameKey === frameKey) return;
    state.frameKey = frameKey;
    g.clear();
    for (const [key, entry] of state.cells) {
      if (!entry.target && now - entry.changedAt >= FADE_MS) {
        state.cells.delete(key);
        continue;
      }
      const center = absCellCenterMeters(scene, entry.cellIX, entry.cellIY);
      const p = deltaMToScreen(scene, center.x - anchor.x, center.y - anchor.y);
      const tile = absCellToTile(scene, entry.cellIX, entry.cellIY);
      const size = rowCellM(scene, tile.ty) / scene.cellM * CELL_PX;
      if (p.x + size / 2 < scene.viewLeft || p.y + size / 2 < scene.viewTop ||
          p.x - size / 2 > scene.viewLeft + scene.viewSize ||
          p.y - size / 2 > scene.viewTop + scene.viewSize) continue;
      const seed = ((Math.imul(entry.cellIX, 31) ^ entry.cellIY) >>> 0) % 997;
      paintCell(g, Math.round(p.x - size / 2), Math.round(p.y - size / 2),
        size, densityAt(entry, now), seed, now / 1800);
    }
  }

  function densityAt(entry, now) {
    const t = Math.min(1, Math.max(0, (now - entry.changedAt) / FADE_MS));
    return entry.from + (entry.target - entry.from) * t;
  }
  return { draw, paintCell };
})();
