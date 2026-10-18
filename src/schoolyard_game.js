// Render-free rules for the schoolyard flag game. All times are seconds.
(function (root) {
  'use strict';
  const SPEC = Object.freeze({ duration: 30, period: 3, size: 7,
    blueRate: 1, redRate: -3, purpleBonus: 5, direction: Object.freeze({ x: 1, y: 0 }) });
  const PATTERN = Object.freeze([
    '..b.r..', 'r...p.b', '.b.r...', 'p..b..r',
    '..r.b..', 'b.p...r', '.r..b..',
  ]);
  const COLORS = { b: 'blue', r: 'red', p: 'purple' };
  const EPSILON = 1e-9;

  function start() {
    return { elapsed: 0, score: 0, step: 0, active: true,
      blueSeconds: 0, redSeconds: 0, claimed: new Set() };
  }
  function remaining(run) { return Math.max(0, SPEC.duration - run.elapsed); }

  function color(run, x, y, preview = false) {
    if (!run.active || !Number.isInteger(x) || !Number.isInteger(y) ||
        x < 0 || y < 0 || x >= SPEC.size || y >= SPEC.size) return null;
    const step = run.step + (preview ? 1 : 0);
    const sourceX = ((x - step) % SPEC.size + SPEC.size) % SPEC.size;
    const value = COLORS[PATTERN[y][sourceX]] || null;
    return value === 'purple' && !preview && run.claimed.has(y * SPEC.size + x) ? 'blue' : value;
  }

  function claim(run, position) {
    if (color(run, position.x, position.y) === 'purple') {
      run.claimed.add(position.y * SPEC.size + position.x);
      run.score += SPEC.purpleBonus;
    }
  }

  function tick(run, position, dt) {
    if (!run.active || !Number.isFinite(dt) || dt < 0) return run;
    position = position || {};
    claim(run, position);
    const end = Math.min(SPEC.duration, run.elapsed + dt);
    // Split long frames at shifts, so one frame cannot score the old pattern
    // for the entire round. Partial occupancy persists when leaving a color.
    while (run.elapsed < end) {
      const boundary = Math.min(end, (run.step + 1) * SPEC.period);
      const span = boundary - run.elapsed;
      const value = color(run, position.x, position.y);
      if (value === 'blue' || value === 'red') {
        const key = value + 'Seconds';
        run[key] += span;
        const seconds = Math.floor(run[key] + EPSILON);
        run[key] = Math.max(0, run[key] - seconds);
        run.score += seconds * SPEC[value + 'Rate'];
      }
      run.elapsed = boundary;
      if (remaining(run) === 0) { run.active = false; break; }
      if (run.elapsed >= (run.step + 1) * SPEC.period) {
        run.step++;
        run.claimed.clear();
        claim(run, position);
      }
    }
    return run;
  }

  root.SchoolyardGame = { SPEC, start, color, tick, remaining };
})(typeof globalThis !== 'undefined' ? globalThis : this);
