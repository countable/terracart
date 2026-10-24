// Compare exact ordered footprints with the former string-key implementation.
// Set insertion, connected-component traversal, bridge ties and isFree calls
// affect later deterministic ownership passes, so membership alone is insufficient.
(function () {
  function referenceTidy(cells, dropCrumbs, isFree) {
    const free = typeof isFree === 'function' ? isFree : () => true;
    const key = (x, y) => x + ',' + y;
    let set = new Set(cells.map(([x, y]) => key(x, y)));
    const has = (x, y) => set.has(key(x, y));
    const orthN = (x, y) => (has(x + 1, y) ? 1 : 0) + (has(x - 1, y) ? 1 : 0)
                          + (has(x, y + 1) ? 1 : 0) + (has(x, y - 1) ? 1 : 0);
    if (dropCrumbs && set.size > 1) {
      // Largest 8-connected component (first-found wins ties — input order is
      // the deterministic scanline order, so this is stable across reloads).
      const seen = new Set();
      let best = null;
      for (const start of set) {
        if (seen.has(start)) continue;
        const comp = [start];
        seen.add(start);
        for (let i = 0; i < comp.length; i++) {
          const [x, y] = comp[i].split(',').map(Number);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const k = key(x + dx, y + dy);
            if (set.has(k) && !seen.has(k)) { seen.add(k); comp.push(k); }
          }
        }
        if (!best || comp.length > best.length) best = comp;
      }
      set = new Set(best);
    }
    for (let changed = true; changed; ) {
      changed = false;
      // Notch / pinhole fill: empty cells bordered on ≥3 orthogonal sides.
      for (const k of [...set]) {
        const [x, y] = k.split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ex = x + dx, ey = y + dy;
          if (!has(ex, ey) && orthN(ex, ey) >= 3 && free(ex, ey)) { set.add(key(ex, ey)); changed = true; }
        }
      }
      // Diagonal-only contact: bridge with the empty corner cell that ends up
      // better connected.
      for (const k of [...set]) {
        const [x, y] = k.split(',').map(Number);
        for (const dy of [-1, 1]) {
          if (!has(x + 1, y + dy) || has(x + 1, y) || has(x, y + dy)) continue;
          const n1 = orthN(x + 1, y), n2 = orthN(x, y + dy);
          const ranked = n1 > n2 ? [[x + 1, y], [x, y + dy]] : n2 > n1 ? [[x, y + dy], [x + 1, y]]
                       : dy < 0 ? [[x, y + dy], [x + 1, y]] : [[x + 1, y], [x, y + dy]];  // tie → the upper cell
          // Bridge with the better-connected corner, or the other one if that
          // cell belongs to someone else. If neither is free the diagonal
          // contact stays — never worth an overlap.
          const pick = ranked.find(([px, py]) => free(px, py));
          if (!pick) continue;
          set.add(key(pick[0], pick[1]));
          changed = true;
        }
      }
    }
    return [...set].map(k => k.split(',').map(Number));
  }

  function compare(cells, dropCrumbs, free) {
    const original = JSON.stringify(cells), expectedCalls = [], actualCalls = [];
    const check = calls => free && ((x, y) => { calls.push([x, y]); return free(x, y); });
    const expected = referenceTidy(cells, dropCrumbs, check(expectedCalls));
    const actual = WorldGen.tidyFootprintCells(cells, dropCrumbs, check(actualCalls));
    assert.eq(JSON.stringify(actual), JSON.stringify(expected), 'ordered cells match for ' + original);
    assert.eq(JSON.stringify(actualCalls), JSON.stringify(expectedCalls), 'claim vetoes run in the same order');
    assert.eq(JSON.stringify(cells), original, 'source footprint remains unchanged');
  }
  test('footprint tidy: numeric keys preserve components, pinholes, bridge ties and veto order', () => {
    const shapes = [[], [[0, 0]], [[0, 0], [0, 0]], [[0, 0], [1, 1]],
      [[0, 1], [1, 0]], [[0, 0], [1, 0], [4, 3], [5, 3]],
      [[4, 3], [5, 3], [0, 0], [1, 0]],
      [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
      [[0, 0], [1, 0], [1, 1], [2, 2], [3, 2], [3, 3]],
      [[0, 0], [1, 0], [0, 4], [1, 4]]];
    const vetoes = [undefined, () => false, (x, y) => ((x * 17 + y * 31) & 3) !== 0];
    for (const [ox, oy] of [[0, 0], [-4, -3], [223, 224], [-230, 240]])
      for (const shape of shapes) for (const drop of [false, true]) for (const free of vetoes)
        compare(shape.map(([x, y]) => [x + ox, y + oy]), drop, free);
  });
  test('footprint tidy: shuffled generated masks preserve exact cleanup order across tile borders', () => {
    let state = 0x71d1f00d;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    for (let sample = 0; sample < 500; sample++) {
      const width = 2 + Math.floor(random() * 7), height = 2 + Math.floor(random() * 7);
      const ox = Math.floor(random() * 460) - 230, oy = Math.floor(random() * 460) - 230;
      const density = .1 + random() * .8, cells = [];
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
        if (random() < density) cells.push([x + ox, y + oy]);
      for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]];
      }
      if (cells.length && sample % 5 === 0) cells.push(cells[0].slice());
      const salt = Math.floor(random() * 8);
      for (const drop of [false, true]) {
        compare(cells, drop);
        compare(cells, drop, (x, y) => ((x * 17 + y * 31 + salt) & 7) > 1);
      }
    }
  });
})();
