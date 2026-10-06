// Sparse cell gas: diffusion conserves mass; only ventilated, thin gas vanishes.
(function (root) {
  'use strict';
  const STEP_MS = 1000;
  const DEFAULTS = Object.freeze({ minDensity: .025, maxCells: 4096, maxTopologyCells: 8192, maxSteps: 5 });
  const key = (x, y) => `${x},${y}`;
  const cardinal = (x, y) => [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }];

  function create(options = {}) {
    const config = { ...DEFAULTS, ...options };
    for (const name of ['maxCells', 'maxTopologyCells', 'maxSteps']) {
      if (!Number.isSafeInteger(config[name]) || config[name] < 1) throw new Error(`Invalid gas ${name}`);
    }
    if (!(config.minDensity >= 0) || !Number.isFinite(config.minDensity)) throw new Error('Invalid gas minDensity');
    return { cells: new Map(), revision: 0, remainderMs: 0, config };
  }

  // At capacity, refuse a new source rather than evicting trapped gas elsewhere.
  function inject(state, x, y, amount = 1) {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !(amount > 0) || !Number.isFinite(amount)) return false;
    const id = key(x, y), cell = state.cells.get(id);
    if (!cell && state.cells.size >= state.config.maxCells) return false;
    if (cell) cell.density += amount;
    else state.cells.set(id, { x, y, density: amount });
    state.revision++;
    return true;
  }

  function step(state, cellAt, neighbors) {
    const next = new Map(), terrain = new Map(), regions = new Map();
    let topologyRemaining = state.config.maxTopologyCells;
    function terrainAt(x, y) {
      const id = key(x, y);
      if (!terrain.has(id)) terrain.set(id, cellAt(x, y));
      return terrain.get(id);
    }
    // Reserve existing cells first: the memory cap must never erase their mass.
    for (const [id, c] of state.cells) next.set(id, { x: c.x, y: c.y, density: 0 });
    for (const [id, c] of state.cells) {
      const home = next.get(id);
      home.density += c.density;
      if (terrainAt(c.x, c.y) !== 'open') continue;
      for (const p of neighbors(c.x, c.y)) {
        if (terrainAt(p.x, p.y) !== 'open') continue;
        const targetId = key(p.x, p.y);
        let target = next.get(targetId);
        if (!target) {
          if (next.size >= state.config.maxCells) continue;
          target = { x: p.x, y: p.y, density: 0 };
          next.set(targetId, target);
        }
        const share = c.density / 8;
        target.density += share;
        home.density -= share;
      }
    }
    function ventilated(start) {
      const startId = key(start.x, start.y);
      if (regions.has(startId)) return regions.get(startId);
      if (terrainAt(start.x, start.y) !== 'open' || topologyRemaining === 0) return false;
      const pending = [start], visited = new Set([startId]);
      let exterior = false;
      // Unknown marks the edge of loaded terrain, but never receives diffusion.
      // A capped search is inconclusive, so keep the gas, including in huge rooms.
      while (pending.length && topologyRemaining > 0 && !exterior) {
        const c = pending.pop();
        topologyRemaining--;
        for (const p of neighbors(c.x, c.y)) {
          const id = key(p.x, p.y), kind = terrainAt(p.x, p.y);
          if (kind === 'unknown') { exterior = true; break; }
          if (kind !== 'open' || visited.has(id)) continue;
          if (regions.get(id) === true) { exterior = true; break; }
          visited.add(id);
          pending.push(p);
        }
      }
      for (const id of visited) regions.set(id, exterior);
      return exterior;
    }
    for (const [id, c] of next) {
      if (c.density < state.config.minDensity && ventilated(c)) next.delete(id);
    }
    state.cells = next;
    state.revision++;
  }

  // Drop excess catch-up on tab resume; never perform an unbounded foreground job.
  // The optional neighbor mapper handles the world's varying row widths.
  function advance(state, elapsedMs, cellAt, neighbors = cardinal) {
    if (!(elapsedMs > 0) || !Number.isFinite(elapsedMs)) return 0;
    const accumulated = state.remainderMs + Math.min(elapsedMs, STEP_MS * state.config.maxSteps);
    const steps = Math.min(Math.floor(accumulated / STEP_MS), state.config.maxSteps);
    state.remainderMs = accumulated % STEP_MS;
    for (let i = 0; i < steps; i++) step(state, cellAt, neighbors);
    return steps;
  }

  root.Gas = { STEP_MS, DEFAULTS, create, inject, advance };
})(typeof globalThis !== 'undefined' ? globalThis : this);
