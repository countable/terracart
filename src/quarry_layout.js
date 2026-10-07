// Quarry compositions fit their actual usable footprint. Finite rewards belong
// to the site, never to each repeating patch or foundation.
(function (root) {
  'use strict';
  function noise(x, y, salt = 0) {
    let h = Math.imul(x + 173, 374761393) ^ Math.imul(y + 719, 668265263) ^ salt;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // Cardinal connections in atlas order: straights, corners, T junctions,
  // then the cross and north/east/south/west end caps (named by closed tip).
  // Only isolated remnants keep ordinary rubble.
  const WALL_FRAME_BY_MASK = { 10: 0, 5: 1, 6: 2, 12: 3, 3: 4, 9: 5,
    11: 6, 7: 7, 14: 8, 13: 9, 15: 10, 4: 11, 8: 12, 1: 13, 2: 14 };
  const WALL_MASK_BY_FRAME = Object.fromEntries(Object.entries(WALL_FRAME_BY_MASK).map(([mask, frame]) => [frame, Number(mask)]));
  function wallMaskForFrame(frame) { return WALL_MASK_BY_FRAME[frame] ?? 0; }
  function wallFrameAt(cells, i, N) {
    const x = i % N, y = Math.floor(i / N);
    const mask = (y > 0 && cells.has(i - N) ? 1 : 0)
      | (x < N - 1 && cells.has(i + 1) ? 2 : 0)
      | (y < N - 1 && cells.has(i + N) ? 4 : 0)
      | (x > 0 && cells.has(i - 1) ? 8 : 0);
    return WALL_FRAME_BY_MASK[mask] ?? null;
  }
  // Fractional budgets round deterministically per site: retain the same
  // leading shafts while reducing the population average by the table scale.
  function entranceCount(s) {
    const scaled = (s.variant.entrances?.count || 0) * root.ZoneVariantData.quarryLayouts.entranceCountScale;
    return Math.floor(scaled) + (noise(s.a.key, 0, 0xca7e) < scaled % 1 ? 1 : 0);
  }
  // Authored mine mouths are ordinary generated stairs, so cave loading
  // mirrors their return ladders and gives each shaft a route farther down.
  function* entrancesSteps(s, ctx) {
    const settings = s.variant.entrances, WG = root.WorldGen;
    if (!settings || !s.a.owned || s.a.clipped) return [];
    const { N, tx, ty, tileEdgeM, grid } = ctx, opts = ctx.spawnOpts;
    const covered = new Set(s.cells), selected = [], result = [];
    const free = i => covered.has(i) && !ctx.tideSeats?.has(i)
      && !ctx.poiPadCells?.has(i)
      && WG.isSpawnCell(grid, N, N, i % N, Math.floor(i / N), opts, 'cave')
      && !WG.nearBuildingCell(grid, N, N, i % N, Math.floor(i / N))
      && !WG.nearPoiCell(opts.pois || [], i % N, Math.floor(i / N));
    const cells = s.cells.slice().sort((a, b) => noise(tx*N+a%N, ty*N+Math.floor(a/N), 0xca7e)
      - noise(tx*N+b%N, ty*N+Math.floor(b/N), 0xca7e) || a-b);
    for (let n = 0; n < cells.length && result.length < entranceCount(s); n++) {
      if ((n & 255) === 0) yield 'quarry mine entrances';
      const i = cells[n], ix = i % N, iy = Math.floor(i / N);
      if (!free(i) || selected.some(j => Math.max(Math.abs(ix-j%N),
        Math.abs(iy-Math.floor(j/N))) < settings.spacingCells)) continue;
      const approach = [[0,1],[1,0],[0,-1],[-1,0]].map(([dx,dy]) => [ix+dx,iy+dy])
        .find(([x,y]) => x >= 0 && y >= 0 && x < N && y < N && free(y*N+x));
      if (!approach) continue;
      const step = tileEdgeM / N;
      result.push(WG.makeObject('staircase', (tx*N+ix+.5)*step, (ty*N+iy+.5)*step,
        WG.caveStairId('down', 0, tx, ty, ix, iy), { dir:'down', depth:0,
          zoneKind:'quarry', zoneVariant:s.variant.id, zoneLayer:'entrance', _ix:ix, _iy:iy }));
      selected.push(i);
      for (const cell of [i, approach[1]*N+approach[0]]) {
        opts.occupied.add(cell); s.clear.add(cell); ctx.reservedCells?.add(cell);
      }
    }
    return result;
  }
  function* planSteps(s, { N, tx = 0, ty = 0 }) {
    const settings = root.ZoneVariantData.quarryLayouts;
    const { min: minPatch, max: maxPatch } = settings.patchSizeCells;
    const plan = { background: new Map(), wallFrames: new Map(), finds: [], guards: [], hazards: [], clear: new Set(), landmarks: [] };
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
        const h = hash(x, y, 113), d = settings.clippedMaterialDensity;
        // Crystal first, then stone, then the barrels past them, so the earlier
        // bands keep the same cells.
        // One fixed cell owns each sparse inhabitant. Never choose the first
        // surviving cell in a clipped fragment: that would duplicate it when
        // another piece of the same site arrives.
        const spacing = settings.clippedInhabitantSpacingCells;
        const gx = tx * N + x, gy = ty * N + y;
        const bx = Math.floor(gx / spacing), by = Math.floor(gy / spacing);
        const sx = bx * spacing + Math.floor(noise(bx, by, 157) * spacing);
        const sy = by * spacing + Math.floor(noise(bx, by, 163) * spacing);
        if (id === 'quarry-strip-mine' && gx === sx && gy === sy) {
          const kinds = s.variant.guards.kinds || [s.variant.guards.kind];
          put(x, y, kinds[Math.floor(noise(bx, by, 167) * kinds.length)]);
        }
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
      const poolRadius = Math.floor(settings.craterPoolSizeCells / 2);
      if (clearance < poolRadius + 2) return plan;
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
        if (d < 1 && !rim && Math.max(Math.abs(x-cx), Math.abs(y-cy)) > poolRadius) bowl.push(i);
      }
      bowl.sort((a, b) => hash(a % N, Math.floor(a / N), 59) - hash(b % N, Math.floor(b / N), 59) || a - b);
      if (s.a.owned) for (const i of bowl.slice(0, s.variant.finds.count)) { plan.finds.push({ i, material: 'crimson_ore' }); plan.clear.add(i); }
      // A dry altar island sits inside a rounded, continuous lava moat. Reserve
      // its bounding square so clipped corners stay bare; entrances end at lava.
      plan.shrineSeat = centre;
      for (let dy=-poolRadius;dy<=poolRadius;dy++) for (let dx=-poolRadius;dx<=poolRadius;dx++) {
        const i=(cy+dy)*N+cx+dx;
        plan.background.delete(i); plan.clear.add(i);
        if ((dx || dy) && Math.hypot(dx, dy) <= settings.craterPoolSizeCells / 2) plan.hazards.push(i);
      }
      return plan;
    }
    let spikeCount = 0;
    const reserved = new Set();
    const fits = (x, y, width, height = width) => {
      if (x + width > N || y + height > N) return false;
      for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
        const i = (y + dy) * N + x + dx;
        if (!covered.has(i) || reserved.has(i)) return false;
      }
      return true;
    };
    // Missing terrain may cut through a ruined wall. Keep a recognizable L
    // or U, rather than requiring every interior cell of the square to exist.
    const foundationAt = (x, y, size) => {
      const r = x + size - 1, b = y + size - 1, cx = x + Math.floor(size / 2), cy = y + Math.floor(size / 2);
      const available = (xx, yy) => xx >= 0 && yy >= 0 && xx < N && yy < N && covered.has(yy * N + xx);
      const usable = [], walls = [];
      for (let yy = y; yy <= b; yy++) for (let xx = x; xx <= r; xx++) {
        if (!available(xx, yy)) continue;
        const i = yy * N + xx;
        if (reserved.has(i)) return null;
        usable.push(i);
        if (xx === x || xx === r || yy === y || yy === b) walls.push(i);
      }
      if (walls.length < 7 || usable.length < 9) return null;
      const sides = [[], [], [], []];
      for (let n = 0; n < size; n++) {
        sides[0].push(available(x+n,y)); sides[1].push(available(r,y+n));
        sides[2].push(available(r-n,b)); sides[3].push(available(x,b-n));
      }
      const runs = sides.map(side => { let best=0,run=0; for (const free of side) { run=free?run+1:0; best=Math.max(best,run); } return best; });
      if (!sides.some((side,n) => side[size-1] && runs[n] >= 3 && runs[(n+1)%4] >= 3)) return null;
      const wallSet = new Set(walls), preferred = [cy*N+cx, cy*N+cx+1];
      usable.sort((a,b) => {
        const pa=preferred.indexOf(a),pb=preferred.indexOf(b);
        return (pa<0?2:pa)-(pb<0?2:pb) || Number(wallSet.has(a))-Number(wallSet.has(b))
          || (a%N-cx)**2+(Math.floor(a/N)-cy)**2-(b%N-cx)**2-(Math.floor(b/N)-cy)**2 || a-b;
      });
      const seats = usable.slice(0,2);
      if (walls.filter(i => !seats.includes(i)).length < 7) return null;
      return { seats, partial: usable.length !== size*size, available };
    };
    const centres = [], foundationSeats = [], verticalBenches = bottom - top > right - left;
    for (let y = top; y <= bottom; y++) {
      yield 'quarry patches';
      for (let x = left; x <= right; x++) {
        let size = id === 'quarry-stronghold' ? settings.foundationSizeCells : minPatch + Math.floor(hash(x, y, 97) * (maxPatch - minPatch + 1));
        const strip = id === 'quarry-strip-mine';
        const dimensions = size => strip ? (verticalBenches ? [minPatch, size] : [size, minPatch]) : [size, size];
        const foundation = id === 'quarry-stronghold' ? foundationAt(x, y, size) : null;
        if (id === 'quarry-stronghold') { if (!foundation) continue; }
        else while (size >= minPatch && !fits(x, y, ...dimensions(size))) size--;
        if (size < minPatch) continue;
        const [width, height] = dimensions(size);
        for (let yy = y - 1; yy <= y + height; yy++) for (let xx = x - 1; xx <= x + width; xx++) {
          if (xx >= 0 && xx < N && yy >= 0 && yy < N) reserved.add(yy * N + xx);
        }
        const r = x + width - 1, b = y + height - 1, cx = x + Math.floor(width / 2), cy = y + Math.floor(height / 2);
        const module = { kind: id === 'quarry-stronghold' ? 'foundation' : 'patch', bounds: [x, y, r, b], size };
        if (strip) module.axis = verticalBenches ? 'y' : 'x';
        plan.landmarks.push(module); centres.push(cy * N + cx);
        if (id === 'quarry-stronghold') {
          module.partial = foundation.partial; foundationSeats.push(foundation.seats);
          const door = foundation.available(cx,b) ? [cx,b] : null;
          module.doors = door ? [door] : [];
          // A surviving doorway stays open, without reserving blocked terrain.
          if (door) for (let n=0;n<=Math.max(Math.abs(door[0]-cx),Math.abs(door[1]-cy));n++) {
            const xx=cx+Math.sign(door[0]-cx)*n,yy=cy+Math.sign(door[1]-cy)*n;
            if (foundation.available(xx,yy)) plan.clear.add(yy*N+xx);
          }
          for (let yy = y; yy <= b; yy++) for (let xx = x; xx <= r; xx++) {
            if (xx === x || xx === r || yy === y || yy === b) put(xx, yy, 'stone');
          }
        } else if (id === 'quarry-abandoned') {
          for (let yy = y; yy <= b; yy++) for (let xx = x; xx <= r; xx++) {
            if (xx !== cx && (yy === y || xx === x) && hash(xx, yy, 71) < .65) put(xx, yy, 'stone');
          }
          if (hash(x, y, 41) < .5) put(cx, cy, 'copper_rock');
          else if (spikeCount < settings.abandonedMaxSpikes) { put(cx, cy, 'ground_spikes'); spikeCount++; }
          // Keep the existing patch roll and double each old barrel into a
          // corner pair, clear of the central find and the rubble edges.
          if (hash(x, y, 47) < .5) {
            put(r, b, 'quarry_barrel');
            put(r, b - 1, 'quarry_barrel');
          }
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
        const kinds = s.variant.guards.kinds || [s.variant.guards.kind];
        plan.guards.push({ i: centre, material: kinds[plan.guards.length % kinds.length] });
      }
      if (id === 'quarry-stronghold') for (const seats of foundationSeats.slice(0, Math.max(s.variant.finds.count, s.variant.guards.count || 0))) {
        if (plan.guards.length < s.variant.guards.count) plan.guards.push({ i: seats[0], material: 'goblin' });
        if (plan.finds.length < s.variant.finds.count) plan.finds.push({ i: seats[1], material: 'treasure_chest_t2' });
      }
      for (const entry of [...plan.finds, ...plan.guards]) { plan.background.delete(entry.i); plan.clear.add(entry.i); }
    }
    if (id === 'quarry-stronghold') {
      // Pot seats are interior, outside doors and finite reward/guard seats.
      for (const m of plan.landmarks) {
        const [x,y,r,b]=m.bounds;
        if (hash(x,y,197) >= settings.foundationPotChance) continue;
        for (let yy=y+1;yy<b;yy++) {
          let placed=false;
          for (let xx=x+1;xx<r;xx++) {
            const i=yy*N+xx;
            if (!covered.has(i) || plan.clear.has(i) || plan.background.has(i)) continue;
            put(xx,yy,'clay_pot'); placed=true; break;
          }
          if (placed) break;
        }
      }
      // Resolve joins only after doors, buried finds and guard seats have
      // removed their cells, so exposed wall ends receive their matching cap.
      const walls = new Set([...plan.background.keys()].filter(i => plan.background.get(i) === 'stone'));
      for (const i of walls) {
        const frame = wallFrameAt(walls, i, N);
        if (frame == null) continue;
        plan.background.set(i, 'stronghold_wall');
        plan.wallFrames.set(i, frame);
      }
    }
    return plan;
  }
  function weightedIndexForHash(hash, variants = root.ZoneVariants.forKind('quarry')) {
    let ticket = (hash >>> 0) / 4294967296 * variants.reduce((sum, v) => sum + v.weight, 0);
    for (let i = 0; i < variants.length; i++) {
      ticket -= variants[i].weight;
      if (ticket < 0) return i;
    }
    return variants.length - 1;
  }
  // Ruins need readable surviving walls; craters need a broader pocket and
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
      : true);
    // Preserve any fitting original choice. A rejected roll is redistributed
    // across all fitting layouts by weight, never handed to the next table row.
    const original = all[start % all.length];
    const candidates = variants.includes(original)
      ? [original, ...variants.filter(v => v !== original)] : variants;
    const fitting = [];
    for (const variant of candidates) {
      const plan = yield* planSteps({ a: { owned: true }, variant, cells }, context);
      // Find/guard counts remain maxima, not minimum occupancy requirements.
      if (!plan.landmarks.length || (variant.finds.count && !plan.finds.length)
          || (variant.guards.count && !plan.guards.length)) continue;
      if (variant === original) return variant.id;
      fitting.push(variant);
    }
    // Slivers that cannot seat an authored composition remain ordinary ground.
    if (!fitting.length) return null;
    const fallbackHash = Math.floor(noise(context.variantHash ?? siteHash(context.tx || 0, context.ty || 0, sorted[0]), 0, 193) * 4294967296);
    return fitting[weightedIndexForHash(fallbackHash, fitting)].id;
  }
  // A quarry site's one hash: its tile and the first (lowest) cell of its
  // component — what zone_coverage seeds the variant pick with, and what the
  // fit fallback above reads when a caller hands in none.
  function siteHash(tx, ty, first) {
    return (Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663) ^ Math.imul(first, 83492791)) >>> 0;
  }
  root.QuarryLayout = { entranceCount, entrancesSteps, planSteps, variantForSteps, wallFrameAt, wallMaskForFrame, weightedIndexForHash, siteHash };
})(typeof window !== 'undefined' ? window : globalThis);
