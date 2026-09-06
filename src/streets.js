// ─────────────────────────────────────────────────────────────────────────
// Streets — the arithmetic behind STREET RESTORATION.
//
// The road band itself is what the player restores. A street is dilapidated
// by default; wherever a stretch of it has sat inside the lit reach
// CONTINUOUSLY for the dwell, that stretch turns to clean cobble, forever.
// "A stretch" is exact: a pair of arclengths in METRES along one line of one
// OSM way, never a cell, never a whole way.
//
// WHY METRES ALONG A LINE, NOT CELLS. The band is drawn as a stroked
// polyline at its true carriageway width; the terrain grid under-reports it
// (see the road rule in CLAUDE.md), so "which cells are road" can never say
// what the player actually sees restored. Arclength intervals are the same
// coordinate the overlay strokes in, so what lights is exactly what was in
// reach — and two halves of the same way restored on two different walks
// join into one run with no seam.
//
// A "STREET PIECE" IS ONE LINE OF ONE FEATURE, never the feature. About a
// quarter of the transportation features on a real tile are merged
// multi-lines (one had 42 disconnected lines over 6.8 km), so keying on the
// feature id alone would weld unrelated streets into one row. `lineKey`
// therefore hashes the LINE — its class, its two ends and its vertex count —
// beside the feature id.
//
// ONLY THE TILE SQUARE COUNTS. MVT geometry runs past [0, extent] into the
// tile's buffer, and the same metres come back inside the NEIGHBOUR tile's
// copy of the way. Restoring or paying for buffer metres would double-count
// every way that crosses a tile edge, so `tileSpans` clips to the square and
// the caller intersects with it.
//
// Pure arithmetic on purpose — no Phaser, no DOM, no scene — which is what
// lets test/node/streets.test.js pin the real shipping maths rather than a
// copy of it. Interval lists are ALWAYS sorted, merged and non-overlapping
// `[[a,b],[c,d],…]`; the save keeps the same list FLATTENED, `[a,b,c,d,…]`.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  // Slack for float arithmetic, in metres. An interval shorter than this is
  // not a stretch of street, it is rounding noise from a grid traversal — so
  // it is dropped — and two intervals closer than this are touching and merge.
  // A tenth of a nanometre: far below anything the projection can draw, far
  // above the error a few dozen hypot()s accumulate.
  const EPS = 1e-9;

  // ── Keys ────────────────────────────────────────────────────────────────
  // 32-bit FNV-1a, hex, zero-padded to 8. Stable forever: the save is keyed on
  // it, so a restored street must hash the same next week and next year.
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // The save key for ONE line of one transportation feature.
  //
  // `lineIdx` picks the line and nothing else — two features whose lines are
  // identical geometry at different indices key the same, which is the point:
  // the same way rasterized into two tiles must restore as one street. The id
  // is carried in the clear so a key is readable in a save dump; the hash is
  // what tells the feature's lines apart.
  function lineKey(feature, lineIdx) {
    const f = feature || {};
    const line = (f.geom && f.geom[lineIdx | 0]) || [];
    const n = line.length;
    const cls = (f.tags && f.tags.class != null) ? String(f.tags.class) : '';
    const a = n ? line[0] : { x: 0, y: 0 };
    const z = n ? line[n - 1] : { x: 0, y: 0 };
    const sig = `${cls}|${a.x},${a.y}|${z.x},${z.y}|${n}`;
    return `${f.id != null ? f.id : 0}:${fnv1a(sig)}`;
  }

  // ── Geometry along a line ───────────────────────────────────────────────
  // Every function here takes MVT integer vertices and `mvtToM`
  // (= tileEdgeM / layer.extent) and answers in TILE-LOCAL METRES.

  function segLenM(line, i, mvtToM) {
    return Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y) * mvtToM;
  }

  function lineLengthM(line, mvtToM) {
    if (!line || line.length < 2) return 0;
    let s = 0;
    for (let i = 1; i < line.length; i++) s += segLenM(line, i, mvtToM);
    return s;
  }

  // The point at arclength `s`, clamped to the line's ends. Null for a line
  // with no vertices at all — there is no point to give, and a caller that
  // gets {x:0,y:0} instead would silently stroke to the tile's corner.
  function pointAtM(line, mvtToM, s) {
    if (!line || !line.length) return null;
    if (line.length === 1) return { x: line[0].x * mvtToM, y: line[0].y * mvtToM };
    let want = Number.isFinite(s) ? s : 0;
    if (want < 0) want = 0;
    let acc = 0;
    for (let i = 1; i < line.length; i++) {
      const seg = segLenM(line, i, mvtToM);
      if (want <= acc + seg) {
        const u = seg > 0 ? (want - acc) / seg : 0;
        const a = line[i - 1], b = line[i];
        return { x: (a.x + (b.x - a.x) * u) * mvtToM, y: (a.y + (b.y - a.y) * u) * mvtToM };
      }
      acc += seg;
    }
    const last = line[line.length - 1];
    return { x: last.x * mvtToM, y: last.y * mvtToM };
  }

  // The exact sub-polyline between two arclengths, in tile-local metres:
  // interpolated endpoints with every interior vertex kept, so a restored run
  // follows the street's real bends instead of cutting the corner.
  //
  // An EMPTY range gives an EMPTY list — not a doubled point. A zero-length
  // run is nothing to stroke, and returning two identical points would draw a
  // round-cap dot on a street the player never restored.
  function subLineM(line, mvtToM, s0, s1) {
    if (!line || line.length < 2) return [];
    const len = lineLengthM(line, mvtToM);
    let a = Number.isFinite(s0) ? s0 : 0;
    let b = Number.isFinite(s1) ? s1 : 0;
    if (a < 0) a = 0; if (a > len) a = len;
    if (b < 0) b = 0; if (b > len) b = len;
    if (!(b - a > 0)) return [];
    const pts = [pointAtM(line, mvtToM, a)];
    let acc = 0;
    for (let i = 1; i < line.length; i++) {
      acc += segLenM(line, i, mvtToM);
      if (acc > a && acc < b) pts.push({ x: line[i].x * mvtToM, y: line[i].y * mvtToM });
    }
    pts.push(pointAtM(line, mvtToM, b));
    return pts;
  }

  // The arclength that lies INSIDE the tile square [0,extent]×[0,extent].
  //
  // Liang-Barsky per segment (the square is convex, so a segment enters and
  // leaves it at most once) — but a LINE may leave and re-enter, so the spans
  // are merged and every one of them is returned. Touching counts: a way
  // running exactly along the tile edge belongs to the tile.
  function tileSpans(line, mvtToM, extent) {
    const ext = extent > 0 ? extent : 4096;
    if (!line || line.length < 2) return [];
    const out = [];
    let s = 0;
    for (let i = 1; i < line.length; i++) {
      const x0 = line[i - 1].x, y0 = line[i - 1].y;
      const dx = line[i].x - x0, dy = line[i].y - y0;
      const seg = segLenM(line, i, mvtToM);
      if (!(seg > 0)) continue;
      let t0 = 0, t1 = 1, ok = true;
      const clip = (p, q) => {
        if (p === 0) return q >= 0;
        const r = q / p;
        if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
        else { if (r < t0) return false; if (r < t1) t1 = r; }
        return true;
      };
      ok = clip(-dx, x0) && clip(dx, ext - x0) && clip(-dy, y0) && clip(dy, ext - y0);
      if (ok && t1 > t0) out.push([s + t0 * seg, s + t1 * seg]);
      s += seg;
    }
    return mergeIntervals(out);
  }

  // The arclength whose CELL is in reach.
  //
  // Exact grid traversal (the same DDA worldgen's accumulateLineSpan walks),
  // NOT sampling: each segment is split at every cell boundary it crosses and
  // each piece is charged to the cell it actually lies in. Sampling at a fixed
  // step would either miss a cell the street clips the corner of or restore
  // metres either side of one it only grazes — and what restores has to be
  // exactly what the reach outline draws.
  //
  // `inReach(cellIX, cellIY)` takes TILE-LOCAL cell indices.
  function reachIntervals(line, mvtToM, cellM, inReach) {
    if (!line || line.length < 2 || !(cellM > 0) || typeof inReach !== 'function') return [];
    const k = mvtToM / cellM;              // MVT units → cells
    const out = [];
    let s = 0;
    for (let i = 1; i < line.length; i++) {
      const x0 = line[i - 1].x * k, y0 = line[i - 1].y * k;
      const x1 = line[i].x * k, y1 = line[i].y * k;
      const dx = x1 - x0, dy = y1 - y0;
      const lenCells = Math.hypot(dx, dy);
      if (!(lenCells > 0)) continue;
      const lenM = lenCells * cellM;
      let ix = Math.floor(x0), iy = Math.floor(y0);
      const ex = Math.floor(x1), ey = Math.floor(y1);
      const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
      const tDeltaX = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
      const tDeltaY = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
      let tMaxX = dx !== 0 ? ((dx > 0 ? (ix + 1 - x0) : (x0 - ix)) / Math.abs(dx)) : Infinity;
      let tMaxY = dy !== 0 ? ((dy > 0 ? (iy + 1 - y0) : (y0 - iy)) / Math.abs(dy)) : Infinity;
      let t = 0;
      // Bounded: a segment can only cross so many cells, and the +2 covers the
      // final partial cell plus any float wobble right on a boundary.
      const guard = Math.abs(ex - ix) + Math.abs(ey - iy) + 2;
      for (let n = 0; n <= guard; n++) {
        const tNext = Math.min(tMaxX, tMaxY, 1);
        if (tNext > t && inReach(ix, iy)) out.push([s + t * lenM, s + tNext * lenM]);
        if (tNext >= 1) break;
        t = tNext;
        if (tMaxX < tMaxY) { ix += stepX; tMaxX += tDeltaX; }
        else { iy += stepY; tMaxY += tDeltaY; }
      }
      s += lenM;
    }
    return mergeIntervals(out);
  }

  // ── Interval algebra ────────────────────────────────────────────────────
  // Every list that leaves this module is sorted, merged and non-overlapping,
  // so the callers never have to ask whether theirs is.

  function mergeIntervals(list) {
    if (!list || !list.length) return [];
    const src = [];
    for (const iv of list) {
      if (!iv) continue;
      const a = +iv[0], b = +iv[1];
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      if (!(b - a > EPS)) continue;          // empty or inverted — not a stretch
      src.push([a, b]);
    }
    if (!src.length) return [];
    src.sort((p, q) => p[0] - q[0]);
    const out = [src[0]];
    for (let i = 1; i < src.length; i++) {
      const cur = out[out.length - 1], nx = src[i];
      if (nx[0] <= cur[1] + EPS) { if (nx[1] > cur[1]) cur[1] = nx[1]; }
      else out.push(nx);
    }
    return out;
  }

  function intersect(a, b) {
    const A = mergeIntervals(a), B = mergeIntervals(b);
    const out = [];
    let i = 0, j = 0;
    while (i < A.length && j < B.length) {
      const lo = Math.max(A[i][0], B[j][0]);
      const hi = Math.min(A[i][1], B[j][1]);
      if (hi - lo > EPS) out.push([lo, hi]);
      if (A[i][1] < B[j][1]) i++; else j++;
    }
    return mergeIntervals(out);
  }

  function subtract(a, b) {
    const A = mergeIntervals(a), B = mergeIntervals(b);
    if (!B.length) return A;
    const out = [];
    for (const iv of A) {
      let lo = iv[0];
      const hi = iv[1];
      for (const cut of B) {
        if (cut[1] <= lo) continue;
        if (cut[0] >= hi) break;
        if (cut[0] - lo > EPS) out.push([lo, cut[0]]);
        if (cut[1] > lo) lo = cut[1];
        if (lo >= hi) break;
      }
      if (hi - lo > EPS) out.push([lo, hi]);
    }
    return mergeIntervals(out);
  }

  function union(a, b) {
    return mergeIntervals([].concat(a || [], b || []));
  }

  function totalM(list) {
    let s = 0;
    for (const iv of (list || [])) {
      if (!iv) continue;
      const d = (+iv[1]) - (+iv[0]);
      if (Number.isFinite(d) && d > 0) s += d;
    }
    return s;
  }

  // ── Save form ───────────────────────────────────────────────────────────
  // Flat pairs, because a save is JSON and `[a,b,c,d]` is half the bytes of
  // `[[a,b],[c,d]]` for the same numbers — and a walked city keeps one of
  // these per line of every way the player has ever stood beside.
  function flatten(list) {
    const out = [];
    for (const iv of mergeIntervals(list)) { out.push(iv[0], iv[1]); }
    return out;
  }

  function unflatten(flat) {
    if (!flat || !flat.length) return [];
    const out = [];
    for (let i = 0; i + 1 < flat.length; i += 2) out.push([+flat[i], +flat[i + 1]]);
    return mergeIntervals(out);
  }

  // ── The dwell ───────────────────────────────────────────────────────────
  // A stretch is RIPE when it has been in reach for EVERY INSTANT of the last
  // dwellMs. Sight only changes when the player's reach cell or radius does,
  // so the caller pushes a SNAPSHOT per line whenever that happens and asks
  // what is ripe every frame — the thing being waited on is the clock, not
  // the player.
  //
  // A snapshot's intervals hold from its own instant until the next snapshot
  // replaces them. So the window [now-dwell, now] is covered by every
  // snapshot inside it PLUS the one that was current when it opened (the
  // newest at or before now-dwell), and what has been in sight throughout is
  // the INTERSECTION of all of them. With no snapshot that old, the line has
  // simply not been watched long enough — the answer is [], never a guess.
  //
  // A line that LEAVES reach starts over: an empty snapshot drops the key's
  // whole history rather than recording a gap, because a history whose
  // boundary entry is empty would intersect to nothing forever.
  function createSight() {
    const hist = new Map();   // key → [{ t, iv }, …] oldest first

    function snapshot(now, key, intervals) {
      const iv = mergeIntervals(intervals);
      if (!iv.length) { hist.delete(key); return; }
      const rows = hist.get(key);
      if (rows) rows.push({ t: now, iv });
      else hist.set(key, [{ t: now, iv }]);
    }

    function ripe(now, dwellMs, key) {
      const rows = hist.get(key);
      if (!rows || !rows.length) return [];
      const cut = now - dwellMs;
      let bi = -1;
      for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].t <= cut) { bi = i; break; } }
      if (bi < 0) return [];                   // not in sight long enough
      if (bi > 0) rows.splice(0, bi);          // prune, keeping the boundary entry
      let acc = rows[0].iv;
      for (let i = 1; i < rows.length; i++) {
        acc = intersect(acc, rows[i].iv);
        if (!acc.length) break;
      }
      return acc.map((iv) => [iv[0], iv[1]]);
    }

    function ripeAll(now, dwellMs) {
      const out = [];
      for (const key of [...hist.keys()]) {
        const iv = ripe(now, dwellMs, key);
        if (iv.length) out.push({ key, intervals: iv });
      }
      return out;
    }

    return {
      snapshot, ripe, ripeAll,
      drop: (key) => { hist.delete(key); },
      clear: () => { hist.clear(); },
      keys: () => [...hist.keys()],
    };
  }

  // ── What has been restored ──────────────────────────────────────────────
  // save.streets = { "<z/tx/ty>": { "<lineKey>": [s0,s1, s0,s1, …] } }
  // save.streetsEpoch = n   ← bumped by any restore that actually added metres

  function restoredList(save, tileKey, key) {
    const tile = save && save.streets && save.streets[tileKey];
    return tile ? unflatten(tile[key]) : [];
  }

  // Union `intervals` into the save and report what was NEW. `addedM` is the
  // metres the player just earned — never the metres they walked past for the
  // second time — so the ladder can be banked straight off it.
  function restore(save, tileKey, key, intervals) {
    if (!save) return { addedM: 0, newly: [] };
    const prev = restoredList(save, tileKey, key);
    const add = mergeIntervals(intervals);
    const newly = subtract(add, prev);
    if (!newly.length) {
      // Nothing gained, so nothing is touched — no epoch bump, and the
      // overlay's rebuild key is unchanged, so the frame does not repaint.
      // The one thing worth doing is sweeping up an entry that stores no
      // metres at all (a hand-edited save, or a half-written row): an empty
      // row is weight in every future save write and answers nothing.
      const tile0 = save.streets && save.streets[tileKey];
      if (tile0 && Object.prototype.hasOwnProperty.call(tile0, key) && !prev.length) {
        delete tile0[key];
        if (!Object.keys(tile0).length) delete save.streets[tileKey];
      }
      return { addedM: 0, newly: [] };
    }
    if (!save.streets || typeof save.streets !== 'object') save.streets = {};
    let tile = save.streets[tileKey];
    if (!tile || typeof tile !== 'object') { tile = {}; save.streets[tileKey] = tile; }
    tile[key] = flatten(union(prev, newly));
    save.streetsEpoch = (save.streetsEpoch | 0) + 1;
    return { addedM: totalM(newly), newly };
  }

  // A cheap integer that changes whenever restore() added anything — the
  // overlay folds it into its rebuild key, so a restored stretch repaints on
  // the next frame and nothing repaints on the frames between.
  function epoch(save) {
    return save ? (save.streetsEpoch | 0) : 0;
  }

  root.Streets = {
    EPS,
    lineKey, lineLengthM, pointAtM, subLineM, tileSpans, reachIntervals,
    mergeIntervals, intersect, subtract, union, totalM, flatten, unflatten,
    createSight, restoredList, restore, epoch,
  };
})(typeof window !== 'undefined' ? window : globalThis);
