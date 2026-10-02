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
    // retains its identity as neighbouring source fragments arrive, with no
    // finite site rewards or falsely inferred crater centre.
    if (s.a.clipped) {
      for (let n = 0; n < cells.length; n++) {
        if ((n & 255) === 0) yield 'quarry clipped benches';
        const i = cells[n], x = i % N, y = Math.floor(i / N);
        const h = hash(x, y, 113), d = root.ZoneVariants.byId('quarry').background.materialDensity;
        // Crystal first, then stone, then the barrels (Oct 2026) past them —
        // the bands stone and crystal held before the barrels joined are the
        // same cells, so no bench moved when they did.
        // One fixed cell owns each sparse inhabitant. Never choose the first
        // surviving cell in a clipped fragment: that would duplicate it when
        // another piece of the same site arrives.
        const spacing = settings.clippedInhabitantSpacingCells;
        const gx = tx * N + x, gy = ty * N + y;
        const bx = Math.floor(gx / spacing), by = Math.floor(gy / spacing);
        const sx = bx * spacing + Math.floor(noise(bx, by, 157) * spacing);
        const sy = by * spacing + Math.floor(noise(bx, by, 163) * spacing);
        if (id === 'quarry-strip-mine' && gx === sx && gy === sy) put(x, y, s.variant.guards.kind);
        else if (h < d.crystal) put(x, y, 'crystal');
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
      // Eight-neighbour erosion finds a genuine interior, even when the
      // footprint wraps around a building or has a long, thin connecting arm.
      const depth = new Map(), queue = [], directions = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
      const neighbour = (x, y) => x >= 0 && y >= 0 && x < N && y < N && covered.has(y * N + x);
      let meanX = 0, meanY = 0;
      for (const i of cells) {
        const x = i % N, y = Math.floor(i / N); meanX += x; meanY += y;
        if (directions.some(([dx,dy]) => !neighbour(x + dx, y + dy))) { depth.set(i, 1); queue.push(i); }
      }
      for (let n = 0; n < queue.length; n++) {
        if ((n & 255) === 0) yield 'quarry crater clearance';
        const i = queue[n], x = i % N, y = Math.floor(i / N);
        for (const [dx,dy] of directions) {
          const j = (y + dy) * N + x + dx;
          if (neighbour(x + dx, y + dy) && !depth.has(j)) { depth.set(j, depth.get(i) + 1); queue.push(j); }
        }
      }
      meanX /= cells.length; meanY /= cells.length;
      let centre = cells[0], clearance = 0, distance = Infinity;
      for (const i of cells) {
        const d = (i % N - meanX) ** 2 + (Math.floor(i / N) - meanY) ** 2;
        if (depth.get(i) > clearance || (depth.get(i) === clearance && d < distance)) {
          centre = i; clearance = depth.get(i); distance = d;
        }
      }
      // An intact bowl needs room for its rim, ore and an entrance. A sliver
      // should select another quarry form instead of advertising a crater.
      if (clearance < 3) return plan;
      const cx = centre % N, cy = Math.floor(centre / N);
      let rx = clearance - 1, ry = clearance - 1;
      const ellipseFits = (ax, ay) => {
        for (let y = -Math.floor(ay * 1.04); y <= Math.floor(ay * 1.04); y++) {
          for (let x = -Math.floor(ax * 1.04); x <= Math.floor(ax * 1.04); x++) {
            if (Math.hypot(x / ax, y / ay) <= 1.04 && !neighbour(cx + x, cy + y)) return false;
          }
        }
        return true;
      };
      while (!ellipseFits(rx, ry)) { rx--; ry--; }
      // Stretch inside the actual free ground, never through a missing cell.
      const axes = right - left >= bottom - top ? ['x','y'] : ['y','x'];
      for (const axis of axes) {
        const withinAspect = () => {
          const ax = rx + (axis === 'x'), ay = ry + (axis === 'y');
          return Math.max(ax, ay) / Math.min(ax, ay) <= settings.craterMaxAspectRatio;
        };
        while (withinAspect() && ellipseFits(rx + (axis === 'x'), ry + (axis === 'y'))) {
          if (axis === 'x') rx++; else ry++;
          yield 'quarry crater extent';
        }
      }
      plan.landmarks.push({ kind: 'crater', bounds: [cx - rx, cy - ry, cx + rx, cy + ry], centre: [cx, cy], radii: [rx, ry] });
      const bowl = [];
      for (let n = 0; n < cells.length; n++) {
        if ((n & 255) === 0) yield 'quarry crater';
        const i = cells[n], x = i % N, y = Math.floor(i / N);
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        const entrance = y > cy && Math.abs(x - cx) <= Math.max(1, rx * .12);
        if (entrance) { plan.clear.add(i); continue; }
        const rim = d <= 1.04 && [[-1,0],[1,0],[0,-1],[0,1]].some(([dx,dy]) =>
          Math.hypot((x + dx - cx) / rx, (y + dy - cy) / ry) > 1.04);
        if (rim) put(x, y, 'stone');
        if (d < .65 && !rim) bowl.push(i);
      }
      bowl.sort((a, b) => hash(a % N, Math.floor(a / N), 59) - hash(b % N, Math.floor(b / N), 59) || a - b);
      if (s.a.owned) for (const i of bowl.slice(0, s.variant.finds.count)) { plan.finds.push({ i, material: 'crimson_ore' }); plan.clear.add(i); }
      const vents = bowl.filter(i => !plan.clear.has(i) && hash(i % N, Math.floor(i / N), 23) < .035);
      const centreDistance = i => (i % N - cx) ** 2 + (Math.floor(i / N) - cy) ** 2;
      vents.sort((a, b) => centreDistance(a) - centreDistance(b) || a - b);
      for (const i of vents.slice(0, settings.craterMaxHazards)) {
        plan.hazards.push(i); plan.clear.add(i);
      }
      return plan;
    }
    const reserved = new Set();
    const fits = (x, y, width, height = width) => {
      if (x + width > N || y + height > N) return false;
      for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
        const i = (y + dy) * N + x + dx;
        if (!covered.has(i) || reserved.has(i)) return false;
      }
      return true;
    };
    const centres = [], verticalBenches = bottom - top > right - left;
    for (let y = top; y <= bottom; y++) {
      yield 'quarry patches';
      for (let x = left; x <= right; x++) {
        let size = id === 'quarry-stronghold' ? settings.foundationSizeCells : minPatch + Math.floor(hash(x, y, 97) * (maxPatch - minPatch + 1));
        const strip = id === 'quarry-strip-mine';
        const dimensions = size => strip ? (verticalBenches ? [minPatch, size] : [size, minPatch]) : [size, size];
        while (size >= minPatch && !fits(x, y, ...dimensions(size))) size--;
        if (size < minPatch || (id === 'quarry-stronghold' && size !== settings.foundationSizeCells)) continue;
        const [width, height] = dimensions(size);
        for (let yy = y - 1; yy <= y + height; yy++) for (let xx = x - 1; xx <= x + width; xx++) {
          if (xx >= 0 && xx < N && yy >= 0 && yy < N) reserved.add(yy * N + xx);
        }
        const r = x + width - 1, b = y + height - 1, cx = x + Math.floor(width / 2), cy = y + Math.floor(height / 2);
        const module = { kind: id === 'quarry-stronghold' ? 'foundation' : 'patch', bounds: [x, y, r, b], size };
        if (strip) module.axis = verticalBenches ? 'y' : 'x';
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
          if (verticalBenches) {
            for (let xx = x; xx <= r; xx += 2) for (let yy = y; yy <= b; yy++) if (yy !== cy) put(xx, yy, 'stone');
          } else {
            for (let yy = y; yy <= b; yy += 2) for (let xx = x; xx <= r; xx++) if (xx !== cx) put(xx, yy, 'stone');
          }
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
  // Ruins need one intact foundation; craters need a broader pocket and
  // enough total ground. Measure usable squares, respecting holes and bends.
  function* variantForSteps(cells, context, start) {
    const settings = root.ZoneVariantData.quarryLayouts, N = context.N;
    const squares = new Map(), sorted = cells.slice().sort((a, b) => a - b);
    let widest = 0;
    for (let n = 0; n < sorted.length; n++) {
      if ((n & 255) === 0) yield 'quarry shape eligibility';
      const i = sorted[n], x = i % N;
      const size = 1 + Math.min(x ? squares.get(i - 1) || 0 : 0,
        squares.get(i - N) || 0, x ? squares.get(i - N - 1) || 0 : 0);
      squares.set(i, size); widest = Math.max(widest, size);
      if (widest >= Math.max(settings.foundationSizeCells, settings.broadPatchSizeCells)) break;
    }
    const all = root.ZoneVariants.forKind('quarry');
    const variants = all.filter(v => v.id === 'quarry-crater'
      ? cells.length >= settings.largeSiteMinCells && widest >= settings.broadPatchSizeCells
      : v.id !== 'quarry-stronghold' || widest >= settings.foundationSizeCells);
    // Keep a fitting site's original roll. Only an ineligible roll maps into
    // the smaller pool, so admitting ruins restores existing fitting sites.
    const original = variants.indexOf(all[start % all.length]);
    start = original >= 0 ? original : start % variants.length;
    for (let n = 0; n < variants.length; n++) {
      const variant = variants[(start + n) % variants.length];
      const plan = yield* planSteps({ a: { owned: true }, variant, cells }, context);
      // Find/guard counts remain maxima, not minimum occupancy requirements.
      if (plan.landmarks.length && (!variant.finds.count || plan.finds.length)
          && (!variant.guards.count || plan.guards.length)) return variant.id;
    }
    // Slivers that cannot seat any authored composition retain useful stone
    // scatter instead of claiming a fortress or a crater that isn't there.
    return 'quarry';
  }
  root.QuarryLayout = { planSteps, variantForSteps };
})(typeof window !== 'undefined' ? window : globalThis);
