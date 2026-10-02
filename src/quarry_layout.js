// Quarry compositions fit their actual usable footprint. Finite rewards belong
// to the site, never to each repeating patch or foundation.
(function (root) {
  'use strict';
  function noise(x, y, salt = 0) {
    let h = Math.imul(x + 173, 374761393) ^ Math.imul(y + 719, 668265263) ^ salt;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function* planSteps(s, { N, tx = 0, ty = 0 }) {
    const settings = root.ZoneVariantData.quarryLayouts;
    const { min: minPatch, max: maxPatch } = settings.patchSizeCells;
    const plan = { background: new Map(), finds: [], guards: [], hazards: [], clear: new Set(), landmarks: [] };
    const cells = s.cells.slice().sort((a, b) => a - b), covered = new Set(cells);
    if (!cells.length) return plan;
    const id = s.variant.id.replace(/_/g, '-');
    const hash = (x, y, salt = 0) => noise(tx * N + x, ty * N + y, salt);
    const put = (x, y, material) => {
      const i = y * N + x;
      if (x < 0 || y < 0 || x >= N || y >= N || !covered.has(i) || plan.background.has(i) || plan.clear.has(i)) return;
      plan.background.set(i, material);
    };
    // A clipped lot has no trustworthy complete bounds. Cell-addressed scatter
    // retain their identity as neighbouring source fragments arrive, with no
    // finite site rewards or falsely inferred crater centre.
    if (s.a.clipped) {
      for (let n = 0; n < cells.length; n++) {
        if ((n & 255) === 0) yield 'quarry clipped benches';
        const i = cells[n], x = i % N, y = Math.floor(i / N);
        const h = hash(x, y, 113), d = root.ZoneVariants.byId('quarry').background.materialDensity;
        // Crystal first, then stone, then the barrels (Oct 2026) past them —
        // the bands stone and crystal held before the barrels joined are the
        // same cells, so no bench moved when they did.
        if (h < d.crystal) put(x, y, 'crystal');
        else if (h < d.crystal + d.stone) put(x, y, 'stone');
        else if (h < d.crystal + d.stone + (d.barrel || 0)) put(x, y, 'barrel');
      }
      return plan;
    }
    let left = N, right = 0, top = N, bottom = 0;
    for (const i of cells) {
      left = Math.min(left, i % N); right = Math.max(right, i % N);
      top = Math.min(top, Math.floor(i / N)); bottom = Math.max(bottom, Math.floor(i / N));
    }
    if (id === 'quarry-crater') {
      const cx = (left + right) / 2, cy = (top + bottom) / 2;
      const rx = Math.max(1, (right - left) / 2 - 1), ry = Math.max(1, (bottom - top) / 2 - 1);
      plan.landmarks.push({ kind: 'crater', bounds: [left, top, right, bottom], centre: [cx, cy], radii: [rx, ry] });
      const bowl = [];
      for (let n = 0; n < cells.length; n++) {
        if ((n & 255) === 0) yield 'quarry crater';
        const i = cells[n], x = i % N, y = Math.floor(i / N);
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        const entrance = y > cy && Math.abs(x - cx) <= Math.max(1, rx * .12);
        if (entrance) { plan.clear.add(i); continue; }
        if (d >= .82 && d <= 1.04 && hash(x, y) < .78) put(x, y, 'stone');
        if (d < .65) bowl.push(i);
      }
      bowl.sort((a, b) => hash(a % N, Math.floor(a / N), 59) - hash(b % N, Math.floor(b / N), 59) || a - b);
      if (s.a.owned) for (const i of bowl.slice(0, s.variant.finds.count)) { plan.finds.push({ i, material: 'crimson_ore' }); plan.clear.add(i); }
      for (const i of bowl) if (!plan.clear.has(i) && hash(i % N, Math.floor(i / N), 23) < .035) {
        plan.hazards.push(i); plan.clear.add(i);
      }
      return plan;
    }
    const reserved = new Set();
    const fits = (x, y, size) => {
      if (x + size > N || y + size > N) return false;
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
        const i = (y + dy) * N + x + dx;
        if (!covered.has(i) || reserved.has(i)) return false;
      }
      return true;
    };
    const centres = [];
    for (let y = top; y <= bottom; y++) {
      yield 'quarry patches';
      for (let x = left; x <= right; x++) {
        let size = id === 'quarry-stronghold' ? settings.foundationSizeCells : minPatch + Math.floor(hash(x, y, 97) * (maxPatch - minPatch + 1));
        while (size >= minPatch && !fits(x, y, size)) size--;
        if (size < minPatch || (id === 'quarry-stronghold' && size !== settings.foundationSizeCells)) continue;
        for (let yy = y - 1; yy <= y + size; yy++) for (let xx = x - 1; xx <= x + size; xx++) {
          if (xx >= 0 && xx < N && yy >= 0 && yy < N) reserved.add(yy * N + xx);
        }
        const r = x + size - 1, b = y + size - 1, cx = x + Math.floor(size / 2), cy = y + Math.floor(size / 2);
        const module = { kind: id === 'quarry-stronghold' ? 'foundation' : 'patch', bounds: [x, y, r, b], size };
        plan.landmarks.push(module); centres.push(cy * N + cx);
        if (id === 'quarry-stronghold') {
          module.doors = [[cx, b]];
          // Keep the door and its approach clear even when background changes.
          for (let yy = cy; yy <= b; yy++) plan.clear.add(yy * N + cx);
          for (let yy = y; yy <= b; yy++) for (let xx = x; xx <= r; xx++) {
            if (xx === x || xx === r || yy === y || yy === b) put(xx, yy, 'stone');
          }
        } else if (id === 'quarry-abandoned') {
          for (let yy = y; yy <= b; yy++) for (let xx = x; xx <= r; xx++) {
            if (xx !== cx && (yy === y || xx === x) && hash(xx, yy, 71) < .65) put(xx, yy, 'stone');
          }
          put(cx, cy, hash(x, y, 41) < .5 ? 'copper_rock' : 'driftwood');
          // A barrel at half the patches' far corner (Oct 2026): what the
          // last shift left beside its timber — smashed for a coin or a tool.
          if (hash(x, y, 47) < .5) put(r, b, 'barrel');
        } else if (id === 'quarry-strip-mine') {
          for (let yy = y; yy <= b; yy += 2) for (let xx = x; xx <= r; xx++) if (xx !== cx) put(xx, yy, 'stone');
        }
      }
    }
    if (id === 'quarry-strip-mine') {
      const candidates = [...plan.background.keys()].filter(i => {
        const x = i % N, y = Math.floor(i / N); return (x + y) % 7 === 0 || (y % 7 === 2 && x - left > 23);
      }).sort((a, b) => hash(a % N, Math.floor(a / N), 113) - hash(b % N, Math.floor(b / N), 113) || a - b);
      for (const i of candidates.slice(0, Math.round(candidates.length * settings.sapphireAbundanceMultiplier))) plan.background.set(i, 'crystal');
    }
    if (s.a.owned) {
      if (id === 'quarry-strip-mine') for (const centre of centres.slice(0, s.variant.guards.count || 0)) {
        plan.guards.push({ i: centre, material: s.variant.guards.kind });
      }
      if (id === 'quarry-abandoned') for (const centre of centres.slice(0, s.variant.finds.count)) plan.finds.push({ i: centre + N, material: 'tool_crate' });
      if (id === 'quarry-stronghold') for (const centre of centres.slice(0, Math.max(s.variant.finds.count, s.variant.guards.count || 0))) {
        if (plan.guards.length < s.variant.guards.count) plan.guards.push({ i: centre, material: 'goblin' });
        if (plan.finds.length < s.variant.finds.count) plan.finds.push({ i: centre + 1, material: 'treasure_x' });
      }
      for (const entry of [...plan.finds, ...plan.guards]) { plan.background.delete(entry.i); plan.clear.add(entry.i); }
    }
    return plan;
  }
  root.QuarryLayout = { planSteps };
})(typeof window !== 'undefined' ? window : globalThis);
