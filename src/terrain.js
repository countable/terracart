// Promoted procedural layouts shared by live terrain dressing and the layout lab.
// Geometry and material assignment are deterministic and independent of world tiles.
(function (root) {
  'use strict';
  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }
  function mix(a, b, t) {
    return a + (b - a) * t;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a += 0x6d2b79f5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function options(input) {
    const s = { width: 33, height: 33, seed: 2718, layout: 'hilbert', ...input };
    if (![s.width, s.height].every((n) => Number.isInteger(n) && n >= 4 && n <= 96))
      throw new RangeError('Terrain layout dimensions must be integers from 4 to 96.');
    if (s.layout !== 'hilbert') throw new Error('Unknown terrain layout: ' + s.layout);
    return s;
  }
  function hilbertPath(s) {
    let bias = 0;
    const requestedBias = Number(s.bias ?? 1),
      sideSign = 1;
    const areaCache = new WeakMap(),
      shortcutPaths = new WeakSet();
    function areaScore(path) {
      if (!areaCache.has(path)) {
        let sum = 0;
        for (let i = 1; i < path.length; i++) {
          const a = path[i - 1],
            b = path[i];
          sum += a.cx * b.cy - b.cx * a.cy;
        }
        areaCache.set(path, -sum);
      }
      return areaCache.get(path) * sideSign * (bias === 2 ? -1 : 1);
    }
    function better(candidate, best) {
      if (!candidate) return false;
      if (!best) return true;
      const difference =
        bias && (shortcutPaths.has(candidate) || shortcutPaths.has(best))
          ? areaScore(candidate) - areaScore(best)
          : 0;
      return difference ? difference > 0 : candidate.length > best.length;
    }
    const order = clamp(s.order ?? 3, 1, 5),
      side = 2 ** order;
    const skipChance = [
      0,
      clamp((s.skip?.[0] ?? 35) / 100),
      clamp((s.skip?.[1] ?? 35) / 100),
      clamp((s.skip?.[2] ?? 0) / 100)
    ];
    const nodes = Array.from({ length: side * side }, (_, index) => {
      let x = 0,
        y = 0,
        t = index;
      for (let scale = 1; scale < side; scale *= 2) {
        const rx = 1 & (t >> 1),
          ry = 1 & (t ^ rx);
        if (!ry) {
          if (rx) {
            x = scale - 1 - x;
            y = scale - 1 - y;
          }
          [x, y] = [y, x];
        }
        x += scale * rx;
        y += scale * ry;
        t = Math.floor(t / 4);
      }
      return { cx: x, cy: y };
    });
    function trace(vertices) {
      const path = [],
        seen = new Set();
      const add = (p) => {
        const previous = path[path.length - 1];
        if (previous && previous.cx === p.cx && previous.cy === p.cy) return true;
        const key = p.cy * s.width + p.cx;
        if (seen.has(key)) return false;
        // A new point may touch only its predecessor, never an older fold.
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ]) {
          const x = p.cx + dx,
            y = p.cy + dy;
          if (
            x >= 1 &&
            x < s.width - 1 &&
            y >= 1 &&
            y < s.height - 1 &&
            seen.has(y * s.width + x) &&
            (!previous || x !== previous.cx || y !== previous.cy)
          )
            return false;
        }
        seen.add(key);
        path.push(p);
        return true;
      };
      for (const p of vertices) {
        if (!path.length) {
          add(p);
          continue;
        }
        let { cx, cy } = path[path.length - 1];
        while (cx !== p.cx || cy !== p.cy) {
          if (cx !== p.cx) cx += Math.sign(p.cx - cx);
          else cy += Math.sign(p.cy - cy);
          if (!add({ cx, cy })) return null;
        }
      }
      return path;
    }
    function shortcut(first, last, x1, y1, x2, y2) {
      const direct = trace([first, last]);
      shortcutPaths.add(direct);
      if (!bias) return direct;
      let around = null;
      if (first.cy === last.cy) {
        const y = first.cy === y1 ? y2 : y1;
        around = trace([first, { cx: first.cx, cy: y }, { cx: last.cx, cy: y }, last]);
      } else if (first.cx === last.cx) {
        const x = first.cx === x1 ? x2 : x1;
        around = trace([first, { cx: x, cy: first.cy }, { cx: x, cy: last.cy }, last]);
      }
      if (around) shortcutPaths.add(around);
      return better(around, direct) ? around : direct;
    }
    function visit(start, level, x1, y1, x2, y2, greedy = true) {
      const count = 4 ** level,
        block = nodes.slice(start, start + count),
        rawFirst = nodes[start],
        rawLast = nodes[start + count - 1];
      const minX = Math.min(...block.map((p) => p.cx)),
        maxX = Math.max(...block.map((p) => p.cx)),
        minY = Math.min(...block.map((p) => p.cy)),
        maxY = Math.max(...block.map((p) => p.cy));
      const width = x2 - x1,
        height = y2 - y1;
      const corner = (p) => ({ cx: p.cx === minX ? x1 : x2, cy: p.cy === minY ? y1 : y2 });
      const first = corner(rawFirst),
        last = corner(rawLast);
      if (level === 0) return [{ cx: Math.floor((x1 + x2) / 2), cy: Math.floor((y1 + y2) / 2) }];
      const skip =
        level < order &&
        level <= 3 &&
        rng((s.seed ^ 65291 ^ Math.imul(start + 1, 73856093) ^ Math.imul(level, 19349663)) >>> 0)() <
          skipChance[level];
      // A fold needs room for its interior; otherwise use the same entry-to-exit
      // shortcut as a manual skip, without reducing detail elsewhere in the curve.
      if (skip || width < 2 || height < 2) return shortcut(first, last, x1, y1, x2, y2);
      // Reserve a one-cell gutter between siblings, crossed only by the
      // connector between consecutive Hilbert regions.
      const middleX = x1 + Math.floor((x2 - x1) / 2),
        middleY = y1 + Math.floor((y2 - y1) / 2),
        children = [];
      for (let quadrant = 0; quadrant < 4; quadrant++) {
        const childStart = start + (quadrant * count) / 4,
          p = nodes[childStart];
        const east = p.cx > (minX + maxX) / 2,
          south = p.cy > (minY + maxY) / 2;
        const bounds = [
          east ? middleX + 1 : x1,
          south ? middleY + 1 : y1,
          east ? x2 : middleX - 1,
          south ? y2 : middleY - 1
        ];
        const detailed = visit(childStart, level - 1, ...bounds, greedy),
          simple = shortcut(detailed[0], detailed[detailed.length - 1], ...bounds);
        children.push({ childStart, east, south, bounds, detailed, simple });
      }
      const combine = (parts) => {
        const path = trace([first, ...parts.flat(), last]);
        if (path && parts.some((part) => shortcutPaths.has(part))) shortcutPaths.add(path);
        return path;
      };
      let chosen = children.map((c) => c.detailed),
        best = combine(chosen);
      // Keep as many detailed siblings as possible before simplifying a parent.
      if (!best)
        for (let mask = 0; mask < 16; mask++) {
          const parts = children.map((c, i) => (mask & (1 << i) ? c.detailed : c.simple)),
            candidate = combine(parts);
          if (better(candidate, best)) {
            best = candidate;
            chosen = parts;
          }
        }
      // At the fine scales, let either facing child claim the gutter when its
      // neighbor leaves room, accepting changes only against the complete path.
      if (best && greedy && level <= 3 && shortcutPaths.has(best))
        for (let pass = 0; pass < 2; pass++)
          for (let i = 0; i < children.length; i++) {
            const c = children[i];
            for (const expand of [1, 2, 3]) {
              const bounds = c.bounds.slice();
              if (expand & 1) bounds[c.east ? 0 : 2] = middleX;
              if (expand & 2) bounds[c.south ? 1 : 3] = middleY;
              const expanded = visit(c.childStart, level - 1, ...bounds, false),
                others = [0, 1, 2, 3].filter((j) => j !== i);
              for (let mask = 0; mask < 8; mask++) {
                const parts = chosen.slice();
                parts[i] = expanded;
                others.forEach((j, bit) => {
                  if (mask & (1 << bit))
                    parts[j] = shortcut(parts[j][0], parts[j][parts[j].length - 1], ...children[j].bounds);
                });
                const candidate = combine(parts);
                if (better(candidate, best)) {
                  best = candidate;
                  chosen = parts;
                }
                if (mask === 0 && candidate) break;
              }
            }
          }
      return best || shortcut(first, last, x1, y1, x2, y2);
    }
    const neutral = visit(0, order, 1, 1, s.width - 2, s.height - 2);
    // Bias changes only a route that actually used a random or required shortcut.
    if (!requestedBias || !shortcutPaths.has(neutral)) return neutral;
    bias = requestedBias;
    const favored = visit(0, order, 1, 1, s.width - 2, s.height - 2);
    return better(favored, neutral) ? favored : neutral;
  }
  function filledHilbert(s) {
    const path = hilbertPath(s),
      side = Number(s.side ?? 1),
      points = [];
    const asPoint = (p) => ({ ...p, x: (p.cx + 0.5) / s.width, y: (p.cy + 0.5) / s.height });
    if (side === 0) return path.map(asPoint);
    const boundary = new Set(path.map((p) => p.cy * s.width + p.cx)),
      first = path[0],
      last = path[path.length - 1];
    // The Hilbert endpoints lie on the top edge. Close that edge to make the
    // boundary, then fill either side by scanline parity. Both include the edge.
    for (let x = Math.min(first.cx, last.cx); x <= Math.max(first.cx, last.cx); x++)
      boundary.add(first.cy * s.width + x);
    for (let cy = 1; cy < s.height - 1; cy++) {
      const scanY = cy + 0.001,
        crossings = [];
      for (let i = 0; i < path.length; i++) {
        const a = path[i],
          b = path[(i + 1) % path.length];
        if (a.cy > scanY !== b.cy > scanY)
          crossings.push(a.cx + ((scanY - a.cy) * (b.cx - a.cx)) / (b.cy - a.cy));
      }
      crossings.sort((a, b) => a - b);
      let crossing = 0;
      for (let cx = 1; cx < s.width - 1; cx++) {
        while (crossing < crossings.length && crossings[crossing] < cx) crossing++;
        const inside = crossing % 2 === 1;
        if (boundary.has(cy * s.width + cx) || (side === 1 ? inside : !inside))
          points.push(asPoint({ cx, cy }));
      }
    }
    return points;
  }

  function path(input) {
    const s = options(input);
    return hilbertPath(s).map((p) => ({ ...p, x: (p.cx + 0.5) / s.width, y: (p.cy + 0.5) / s.height }));
  }
  function generate(input) {
    const s = options(input),
      points = filledHilbert(s);
    if (!s.inverted) return points;
    const occupied = new Set(points.map((p) => p.cy * s.width + p.cx)),
      inverse = [];
    for (let cy = 1; cy < s.height - 1; cy++)
      for (let cx = 1; cx < s.width - 1; cx++) {
        if (!occupied.has(cy * s.width + cx))
          inverse.push({ cx, cy, x: (cx + 0.5) / s.width, y: (cy + 0.5) / s.height });
      }
    return inverse;
  }
  function allocate(total, weights) {
    if (!weights.length) return [];
    const sum = weights.reduce((a, b) => a + b, 0);
    const raw = weights.map((w) => total * (sum ? w / sum : 1 / weights.length));
    const counts = raw.map(Math.floor);
    const order = raw
      .map((value, i) => ({ i, remainder: value - counts[i] }))
      .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
    const remaining = total - counts.reduce((a, b) => a + b, 0);
    for (let i = 0; i < remaining; i++) counts[order[i].i]++;
    return counts;
  }
  // Rank the same seats for both live material allocation and lab slot assignment.
  function rank(points, input, mask = points) {
    const s = { width: 33, height: 33, seed: 2718, selection: 'density', affinity: 51, ...input };
    const occupied = new Set(mask.map((p) => p.cy * s.width + p.cx));
    const random = rng(s.seed + 103),
      phase = rng(s.seed + 601)() * 6.28;
    const densities = points.map((p) => {
      if (s.selection !== 'density' || s.affinity === 0) return 0;
      let sum = 0;
      for (let dy = -7; dy <= 7; dy++)
        for (let dx = -7; dx <= 7; dx++) {
          const x = p.cx + dx,
            y = p.cy + dy;
          if (x >= 0 && x < s.width && y >= 0 && y < s.height && occupied.has(y * s.width + x))
            sum += Math.exp(-(dx * dx + dy * dy) / (2 * 2.2 ** 2));
        }
      return sum;
    });
    const low = Math.min(...densities),
      high = Math.max(...densities);
    return points
      .map((p, i) => {
        const field = (Math.sin(p.x * 7 + phase) + Math.cos(p.y * 8 - phase)) / 2;
        const affinity =
          s.selection === 'density' ? 1 - (densities[i] - low) / (high - low || 1) : (field + 1) / 2;
        return { ...p, rank: mix(random(), affinity, clamp(s.affinity / 100)) };
      })
      .sort((a, b) => a.rank - b.rank);
  }
  function scaleAt(p, input, occupied) {
    const s = { seed: 2718, variation: 0, ...input };
    let neighbors = 0;
    if (s.clusterSize)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = p.cx + dx,
            y = p.cy + dy;
          if ((dx || dy) && x >= 0 && x < s.width && y >= 0 && y < s.height && occupied.has(y * s.width + x))
            neighbors++;
        }
    const random = rng((s.seed ^ Math.imul(p.cx, 8929) ^ Math.imul(p.cy, 3989)) >>> 0)();
    return 1 + ((s.clusterSize ? neighbors / 8 : random) - 0.5) * 0.7 * clamp(s.variation, 0, 100) / 100;
  }
  function assign(points, input, slots) {
    if (!slots.length) return [];
    const s = options(input),
      counts = allocate(
        points.length,
        slots.map((slot) => Math.max(0, slot.share))
      );
    const ranked = rank(points, s),
      occupied = new Set(points.map((p) => p.cy * s.width + p.cx)),
      assigned = [];
    let offset = 0;
    slots.forEach((slot, type) => {
      for (const p of ranked.slice(offset, offset + counts[type])) {
        const { rank: priority, ...cell } = p;
        assigned.push({ ...cell, type, material: slot.material, scale: scaleAt(p, s, occupied) });
      }
      offset += counts[type];
    });
    return assigned;
  }
  root.TerrainLayouts = { path, generate, assign, rank, allocate, scaleAt };
})(typeof window !== 'undefined' ? window : globalThis);
