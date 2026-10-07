// Authored cave areas claim their empty ground before ordinary floor dressing.
// Plans are immutable with respect to their inputs; applying one is explicit.
(function (root) {
  'use strict';
  const SPRING = Object.freeze({
    id: 'spring_cave', extentCells: 25, poolRadius: 3, sourceRadius: 0.65,
    mushroomRadius: 5, stoneRadius: 8, ringHalfWidth: 0.4, approachHalfWidth: 0.6
  });
  const BUDGETS = Object.freeze({ referenceCells: 625, referenceRooms: 25,
    mushrooms: 8, harvest: 32, gems: 16, ore: 24 });
  function select(anchor, depth) {
    const profile = root.WorldGen.floorProfile(depth).caveAreas;
    if (!profile) return null;
    if (anchor.kind === 'quarry') return 'mine_tunnels';
    if (anchor.kind !== 'grove') return null;
    const weights = profile.weights;
    let ticket = fnv1a(`cave-area|${root.ZoneVariants.identity(anchor)}|${depth}`) / 4294967296 * weights.reduce((sum, row) => sum + row.weight, 0);
    for (const row of weights) {
      ticket -= row.weight;
      if (ticket < 0) return row.id;
    }
    return null;
  }
  // Used by the preview as well as the live plan. The four radial approaches
  // meet the dry bank; they do not turn into bridges through the pool.
  function materialAt(u, v) {
    const r = Math.hypot(u, v);
    if (r <= SPRING.sourceRadius) return 'source';
    if (r <= SPRING.poolRadius) return 'water';
    if (Math.abs(u) <= SPRING.approachHalfWidth || Math.abs(v) <= SPRING.approachHalfWidth) return null;
    if (Math.abs(r - SPRING.mushroomRadius) <= SPRING.ringHalfWidth) return 'mushroom';
    if (Math.abs(r - SPRING.stoneRadius) <= SPRING.ringHalfWidth) return 'stone';
    return null;
  }
  function plan(ctx) {
    const out = { reserved: new Set(), areas: [], diagnostics: [], terrain: new Map(), objects: [], wildplants: [], moves: [], replacements: [], encounters: [] };
    const WG = root.WorldGen, V = root.ZoneVariants;
    const { surface, grid, N, tx, ty, tileEdgeM, depth } = ctx;
    const field = surface && surface.zone, coverage = field && (field.coverage || field.idx);
    const profile = WG?.floorProfile(depth).caveAreas;
    if (!profile || !coverage || !V || !WG) return out;
    const source = field.caveSource || surface.caveSource || surface;
    const sourceGrid = source.baseGrid || source.grid;
    if (!sourceGrid) return out;
    const occupied = ctx.occupied || new Set();
    const frame = WG.tileFrame({ cellsPerEdge: N }, tx, ty, tileEdgeM);
    const landmarks = ctx.objects || [];
    const halo = (ix, iy) => {
      const cells = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!frame.inTile(ix + dx, iy + dy)) return null;
        cells.push((iy + dy) * N + ix + dx);
      }
      return cells;
    };
    const positionOf = object => out.moves.find(move => move.object === object) || frame.cellOf(object.x, object.y);
    const sourceOpts = { spawnWhy: source.spawnWhy || surface.spawnWhy, roadMask: surface.roadMask };
    const caveOpts = { spawnWhy: ctx.spawnWhy };
    // Coverage resolves ownership; identity order also makes diagnostics and
    // output order stable when a tile's anchor array is reordered.
    const anchors = (field.anchors || []).map((anchor, index) => ({ anchor, index, key: V.identity(anchor) }))
      .filter(s => select(s.anchor, depth)).sort((a, b) => a.key.localeCompare(b.key));
    for (const s of anchors) {
      const a = V.anchorFrame(s.anchor, { N, tx, ty });
      const variant = select(s.anchor, depth);
      if (variant === 'dungeon_maze') { planMaze(ctx, out, s, a, frame, sourceGrid, sourceOpts); continue; }
      if (variant !== SPRING.id) { planNexus(ctx, out, s, a, frame, sourceGrid, sourceOpts); continue; }
      const radius = SPRING.stoneRadius + SPRING.ringHalfWidth;
      const half = Math.ceil(radius);
      const [left, top] = a.local(a.originX - half * a.unit, a.originY - half * a.unit);
      const [right, bottom] = a.local(a.originX + half * a.unit, a.originY + half * a.unit);
      const diagnostic = { anchorKey: s.key, variant: SPRING.id, status: 'declined', reason: null };
      out.diagnostics.push(diagnostic);
      const cells = [];
      let reason = null;
      for (let iy = top; iy <= bottom && !reason; iy++) for (let ix = left; ix <= right; ix++) {
        const u = ((tx * 4096 + (ix + 0.5) * 4096 / N) - a.originX) / a.unit;
        const v = ((ty * 4096 + (iy + 0.5) * 4096 / N) - a.originY) / a.unit;
        if (Math.hypot(u, v) > radius) continue;
        if (!frame.inTile(ix, iy)) { reason = 'tile_boundary'; break; }
        const i = iy * N + ix;
        if (coverage[i] !== s.index + 1 || out.reserved.has(i)) { reason = 'ownership'; break; }
        if ((grid[i] !== WG.T.CAVE_FLOOR && !(profile.carveWalls && grid[i] === WG.T.CAVE_WALL)) ||
            !WG.isSpawnCell(sourceGrid, N, N, ix, iy, sourceOpts, 'minor') ||
            !WG.isSpawnCell(sourceGrid, N, N, ix, iy, caveOpts, 'minor')) { reason = 'blocked_ground'; break; }
        const material = materialAt(u, v);
        cells.push({ i, ix, iy, u, v, material });
      }
      if (reason) { diagnostic.reason = reason; continue; }
      if (profile.carveWalls && !cells.some(c => grid[c.i] === WG.T.CAVE_FLOOR)) {
        diagnostic.reason = 'no_floor_access'; continue;
      }
      const byCell = new Map(cells.map(c => [c.i, c]));
      const wet = i => ['source', 'water'].includes(byCell.get(i)?.material);
      // A grove's own mirrored reward can move to its bank; unrelated caches
      // and stairs remain fixed. Surface dressing uses this same POI match.
      const sourceChest = s.anchor.owned && (surface.genObjects || surface.objects || []).find(o =>
        o.kind === 'chest' && o._poiAt === `${s.anchor.lx},${s.anchor.ly}`);
      const mirror = sourceChest && landmarks.find(o => o.kind === 'chest' && o.caveOf === sourceChest.id);
      const old = mirror && positionOf(mirror);
      const oldHalo = old && halo(old.ix, old.iy);
      const relocating = oldHalo && oldHalo.some(wet);
      const dry = new Set([...occupied, ...(ctx.routeLane || [])]);
      for (const move of out.moves) { dry.delete(move.from); dry.add(move.to); }
      if (relocating) dry.delete(old.iy * N + old.ix);
      for (const object of landmarks) {
        if (relocating && object === mirror) continue;
        const p = positionOf(object);
        // Preserve boundary landmarks too; their in-tile approach still counts.
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (frame.inTile(p.ix + dx, p.iy + dy)) dry.add((p.iy + dy) * N + p.ix + dx);
        }
      }
      let move = null;
      if (relocating) {
        // Prefer the east bank, then the other cardinal banks. The reward's
        // dry approach suppresses authored mushrooms just like any landmark.
        for (const [u, v] of [[5, 0], [0, 5], [-5, 0], [0, -5]]) {
          const [ix, iy] = a.local(a.originX + u * a.unit, a.originY + v * a.unit);
          const to = iy * N + ix, access = halo(ix, iy);
          if (byCell.get(to)?.material || !access || access.some(i => !byCell.has(i) || wet(i) || dry.has(i))) continue;
          move = { object: mirror, from: old.iy * N + old.ix, to, ...frame.centre(ix, iy), ix, iy };
          for (const i of access) dry.add(i);
          break;
        }
        if (!move) { diagnostic.reason = 'mirror_bank_blocked'; continue; }
      }
      if (cells.some(c => wet(c.i) && dry.has(c.i))) { diagnostic.reason = 'landmark_pool'; continue; }
      // Commit proposed movement to the plan only after the whole area passes.
      if (move) out.moves.push(move);
      const id = `cave_area|${s.key}|${depth}`;
      const reserved = new Set(cells.map(c => c.i));
      const [centreX, centreY] = a.local(a.originX, a.originY);
      out.areas.push({ id, kind: SPRING.id, anchorKey: s.key, depth, ix: centreX, iy: centreY,
        ...frame.centre(centreX, centreY), reserved });
      for (const c of cells) {
        out.reserved.add(c.i);
        if (grid[c.i] === WG.T.CAVE_WALL) out.terrain.set(c.i, WG.T.CAVE_FLOOR);
        if (c.material === 'source' || c.material === 'water') {
          out.terrain.set(c.i, c.material === 'source' ? WG.T.CAVE_WALL : WG.T.WATER);
          continue;
        }
        if (!c.material || dry.has(c.i)) continue;
        const p = frame.centre(c.ix, c.iy);
        const slotId = `${id}|${Math.round(c.u)},${Math.round(c.v)}|${c.material}`;
        const extra = { _ix: c.ix, _iy: c.iy, _cave: true, caveArea: id };
        if (c.material === 'mushroom') out.wildplants.push(WG.makeWildplant('mushroom', p.x, p.y, slotId, extra));
        else out.objects.push(WG.makeObject('mineralrock', p.x, p.y, slotId, { ...extra, requiredTier: 1, caveVariant: 0 }));
      }
      addEncounters(ctx, out, out.areas[out.areas.length - 1], cells, dry,
        [[-4,-2],[4,-2],[-4,2],[4,2],[-6,0],[0,6]].map(([u,v]) => ({u,v,kind:'skeleton',hidden:true,dormant:true,revealDistanceCells:1})));
      diagnostic.status = 'placed';
    }
    return out;
  }
  function addEncounters(ctx, out, area, cells, dry, seats) {
    const used = new Set([...out.objects, ...out.wildplants].map(o => o._iy * ctx.N + o._ix));
    for (const [slot, seat] of seats.entries()) {
      const c = cells.find(c => Math.abs(c.u - seat.u) < .51 && Math.abs(c.v - seat.v) < .51);
      if (!c || dry.has(c.i) || used.has(c.i) ||
          (out.terrain.get(c.i) ?? ctx.grid[c.i]) !== root.WorldGen.T.CAVE_FLOOR) continue;
      const frame = root.WorldGen.tileFrame({ cellsPerEdge: ctx.N }, ctx.tx, ctx.ty, ctx.tileEdgeM);
      out.encounters.push({ ...seat, ...frame.centre(c.ix, c.iy), id: `${area.id}|enemy|${slot}`,
        _ix: c.ix, _iy: c.iy, caveArea: area.id, depth: ctx.depth });
      used.add(c.i);
    }
  }
  // All room plans share canonical cell coordinates and the same gates. A
  // blocked building remains an island in a chamber, never a carving target.
  // Mine regions claim only the existing floor: ore does not dig its own access.
  function planNexus(ctx, out, state, anchor, frame, sourceGrid, sourceOpts) {
    const W = root.WorldGen, { N, tx, ty, depth, grid, surface } = ctx;
    const profile = W.floorProfile(depth).caveAreas;
    const kind = select(state.anchor, depth), mine = kind === 'mine_tunnels';
    const coverage = surface.zone.coverage || surface.zone.idx;
    const id = `cave_area|${state.key}|${depth}`;
    const diagnostic = { anchorKey: state.key, variant: kind, status: 'declined', reason: null };
    out.diagnostics.push(diagnostic);
    const cells = [], radius = SPRING.stoneRadius + SPRING.ringHalfWidth;
    const [left, top] = anchor.local(anchor.originX - 9 * anchor.unit, anchor.originY - 9 * anchor.unit);
    const [right, bottom] = anchor.local(anchor.originX + 9 * anchor.unit, anchor.originY + 9 * anchor.unit);
    const source = root.Underground?.surfaceData(surface);
    for (let iy = top; iy <= bottom; iy++) for (let ix = left; ix <= right; ix++) {
      const u = ((tx * 4096 + (ix + .5) * 4096 / N) - anchor.originX) / anchor.unit;
      const v = ((ty * 4096 + (iy + .5) * 4096 / N) - anchor.originY) / anchor.unit;
      if (Math.hypot(u, v) > radius) continue;
      if (!frame.inTile(ix, iy)) { diagnostic.reason = 'tile_boundary'; return; }
      const i = iy * N + ix;
      if (coverage[i] !== state.index + 1 || out.reserved.has(i)) continue;
      if (grid[i] !== W.T.CAVE_FLOOR && (mine || !profile.carveWalls || grid[i] !== W.T.CAVE_WALL)) continue;
      const projectedStreet = mine && ctx.routeStreetCells?.has(i);
      if (projectedStreet) {
        // The route prepass already proved this is an eligible small street;
        // only its existing cave floor is usable, never the neighbouring walls.
        if (!source || !root.Underground.allowed(source, i, true) ||
            !W.isSpawnCell(grid, N, N, ix, iy, {spawnWhy:ctx.spawnWhy}, 'minor')) continue;
      } else if (!W.isSpawnCell(sourceGrid, N, N, ix, iy, sourceOpts, 'minor') ||
          !W.isSpawnCell(sourceGrid, N, N, ix, iy, {spawnWhy:ctx.spawnWhy}, 'minor') ||
          (source && !root.Underground.allowed(source, i))) continue;
      cells.push({ i, ix, iy, u: Math.round(u), v: Math.round(v) });
    }
    if (cells.length < (mine ? 8 : 45)) { diagnostic.reason = 'insufficient_ground'; return; }
    // A chamber must be reachable from existing geology floor. Flood within
    // candidate ground; disconnected fragments do not mint duplicate budgets.
    const byCell = new Map(cells.map(c => [c.i, c]));
    const seeds = cells.filter(c => grid[c.i] === W.T.CAVE_FLOOR);
    if (!seeds.length) { diagnostic.reason = 'no_floor_access'; return; }
    seeds.sort((a,b) => Math.hypot(a.u,a.v) - Math.hypot(b.u,b.v) || a.i-b.i);
    const reached = new Set([seeds[0].i]), queue = [seeds[0]];
    for (let k = 0; k < queue.length; k++) {
      const c = queue[k];
      for (const i of [c.i-1,c.i+1,c.i-N,c.i+N]) if (byCell.has(i) && !reached.has(i)) {
        reached.add(i); queue.push(byCell.get(i));
      }
    }
    const usable = cells.filter(c => reached.has(c.i));
    if (usable.length < (mine ? 8 : 45)) { diagnostic.reason = 'insufficient_connected_ground'; return; }
    const [ix, iy] = anchor.local(anchor.originX, anchor.originY);
    const area = { id, kind, anchorKey: state.key, depth, ix, iy, ...frame.centre(ix, iy), reserved: reached };
    out.areas.push(area);
    for (const c of usable) {
      out.reserved.add(c.i);
      if (grid[c.i] === W.T.CAVE_WALL) out.terrain.set(c.i, W.T.CAVE_FLOOR);
    }
    const dry = new Set([...(ctx.occupied || []), ...(ctx.routeLane || [])]);
    for (const object of ctx.objects || []) {
      const p = frame.cellOf(object.x, object.y);
      for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++)
        if (frame.inTile(p.ix+dx,p.iy+dy)) dry.add((p.iy+dy)*N+p.ix+dx);
    }
    const used = new Set(dry);
    const cross = c => Math.abs(c.u) <= 1 || Math.abs(c.v) <= 1;
    const court = c => !mine && Math.hypot(c.u,c.v) < 3;
    const free = c => !used.has(c.i) && (mine || !cross(c));
    const order = (list, salt) => list.slice().sort((a,b) =>
      fnv1a(`${id}|${salt}|${a.u},${a.v}`) - fnv1a(`${id}|${salt}|${b.u},${b.v}`));
    const put = (c, objectKind, extra={}) => {
      if (!c || used.has(c.i)) return false;
      const p = frame.centre(c.ix,c.iy), slot = `${id}|${c.u},${c.v}|${objectKind}`;
      const attrs = { _ix:c.ix, _iy:c.iy, _cave:true, caveArea:id, depth, ...extra };
      if (objectKind === 'mushroom') out.wildplants.push(W.makeWildplant('mushroom',p.x,p.y,slot,attrs));
      else out.objects.push(W.makeObject(objectKind,p.x,p.y,slot,attrs));
      used.add(c.i); return true;
    };
    const shrine = kind === 'goblin_warrens' ? 'ember_altar' : kind === 'mushroom_cavern' ? 'toad_idol' : null;
    if (shrine) {
      const seat = usable.filter(free).sort((a,b) => Math.hypot(a.u,a.v)-Math.hypot(b.u,b.v) || a.i-b.i)
        .find(c => [-1,0,1].every(dy => [-1,0,1].every(dx => {
          const i=(c.iy+dy)*N+c.ix+dx; return reached.has(i) && !used.has(i);
        })));
      if (put(seat,'grove_shrine',{shrineKind:shrine})) {
        for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) used.add((seat.iy+dy)*N+seat.ix+dx);
      }
    }
    const seats = [];
    if (kind === 'goblin_warrens') {
      // Independent row and column spans give 3x3, 3x5 and 5x3 rooms.
      // Doors sit at each wall midpoint; the cardinal avenue always remains.
      const rooms = [];
      const ys=[-7,-3,3,7];
      for (let row=0;row<3;row++) {
        const xs=row===1 ? [-7,-1,3,7] : [-7,-3,3,7];
        for (let col=0;col<3;col++) {
          const r={left:xs[col],right:xs[col+1],top:ys[row],bottom:ys[row+1]};
          r.u=Math.round((r.left+r.right)/2); r.v=Math.round((r.top+r.bottom)/2);
          const interior=usable.filter(c=>c.u>r.left&&c.u<r.right&&c.v>r.top&&c.v<r.bottom);
          if(interior.length >= 6) rooms.push(r);
        }
      }
      area.roomCount=rooms.length;
      area.rooms=rooms;
      const roomLane = new Set(usable.filter(c => rooms.some(r =>
        (c.u === r.u && c.v >= r.top && c.v <= r.bottom) ||
        (c.v === r.v && c.u >= r.left && c.u <= r.right))).map(c => c.i));
      const budget=Math.max(1,Math.round(rooms.length * profile.goblins/BUDGETS.referenceRooms));
      for(const room of order(rooms.map((r,i)=>({...r,i})), 'rooms').slice(0,budget)) {
        const c=usable.filter(c=>c.u>room.left&&c.u<room.right&&c.v>room.top&&c.v<room.bottom&&free(c))
          .sort((a,b)=>Math.hypot(a.u-room.u,a.v-room.v)-Math.hypot(b.u-room.u,b.v-room.v))[0];
        if(c) {seats.push({...c,kind:profile.spearGoblins && seats.length%2 ? 'spear_goblin':'club_goblin'}); used.add(c.i);}
      }
      for(const c of usable) {
        if(!free(c)||court(c)||roomLane.has(c.i)) continue;
        const wall=rooms.some(r=> ((c.u===r.left||c.u===r.right)&&c.v>=r.top&&c.v<=r.bottom&&c.v!==r.v)
          ||((c.v===r.top||c.v===r.bottom)&&c.u>=r.left&&c.u<=r.right&&c.u!==r.u));
        if(wall) put(c,'mineralrock',{requiredTier:1,caveVariant:0});
      }
      // One finite store per five fitted rooms replaces the ambient containers
      // excluded by this area's reservation; no ordinary reward cache is added.
      const allocated = W.caveContainerBudget(tx,ty,depth);
      const spent = out.objects.filter(o => o.barrel).length;
      const storeCount = Math.min(Math.ceil(rooms.length/5), Math.max(0, allocated-spent));
      const stores=order(usable.filter(c=>free(c)&&!court(c)&&!roomLane.has(c.i)), 'stores').slice(0,storeCount);
      for(const c of stores) put(c,'chest',{barrel:true});
    } else if(kind === 'mushroom_cavern') {
      const enemies=Math.max(1,Math.round(usable.length*BUDGETS.mushrooms/BUDGETS.referenceCells));
      for(const c of order(usable.filter(c=>free(c)&&!court(c)), 'enemies').slice(0,enemies)) {
        seats.push({...c,kind:'mushroom_monster'}); used.add(c.i);
      }
      const count=Math.max(1,Math.round(usable.length*BUDGETS.harvest/BUDGETS.referenceCells));
      for(const c of order(usable.filter(c=>free(c)&&!court(c)), 'beds').slice(0,count)) put(c,'mushroom');
    } else {
      const pockets=order(usable.filter(c=>free(c)&&!court(c)&&
        (mine || Math.hypot(c.u,c.v)>5)), 'pockets');
      const count=Math.max(1,Math.round(usable.length*(mine?BUDGETS.ore:BUDGETS.gems)/BUDGETS.referenceCells));
      for(const c of pockets.slice(0,count)) {
        const mineral = mine ? {yieldTier:Math.max(2,depth),requiredTier:Math.max(1,depth-1)}
          : root.Underground.gem(depth,`${id}|${c.u},${c.v}`);
        if(mineral) put(c,'mineralrock',mineral);
      }
      if(!mine) for(const c of order(usable.filter(c=>free(c)&&!court(c)), 'enemies').slice(0,depth+1))
        seats.push({...c,kind:['cave_slime','bat','spider'][seats.length]});
    }
    addEncounters(ctx,out,area,usable,dry,seats);
    diagnostic.status='placed';
  }
  const MAZE = Object.freeze({ width: 34, height: 33, step: 3, loops: .77, seed: 2718,
    enemySpacing: 12, shrineKind: 'ember_altar', treasureTier: 3 });
  // The reviewed layout-lab braid, phased from the canonical grove focus.
  // Repeat its open border on large footprints rather than stretching cells.
  const mazeMask = (() => {
    let seed = MAZE.seed + 47291;
    const random = () => {
      seed += 0x6D2B79F5;
      let t = seed; t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    const cols = Math.floor((MAZE.width - 3) / MAZE.step) + 1;
    const rows = Math.floor((MAZE.height - 3) / MAZE.step) + 1;
    const mask = new Set(), links = new Set(), degree = new Uint8Array(cols * rows);
    const coord = i => [1 + i % cols * MAZE.step, 1 + Math.floor(i / cols) * MAZE.step];
    const edge = (a,b) => `${Math.min(a,b)}:${Math.max(a,b)}`;
    const neighbors = i => {
      const x = i % cols, y = Math.floor(i / cols), out = [];
      if (x) out.push(i-1); if (x < cols-1) out.push(i+1);
      if (y) out.push(i-cols); if (y < rows-1) out.push(i+cols);
      return out;
    };
    const add = (x,y) => mask.add(y * MAZE.width + x);
    const join = (a,b) => {
      let [x,y] = coord(a); const [tx,ty] = coord(b); add(x,y);
      while (x !== tx || y !== ty) {
        x += Math.sign(tx-x); y += Math.sign(ty-y); add(x,y);
      }
      links.add(edge(a,b)); degree[a]++; degree[b]++;
    };
    const start = Math.floor(random() * cols * rows), seen = new Set([start]), stack = [start];
    add(...coord(start));
    while (stack.length) {
      const a = stack[stack.length-1], choices = neighbors(a).filter(b => !seen.has(b));
      if (!choices.length) { stack.pop(); continue; }
      const b = choices[Math.floor(random()*choices.length)]; seen.add(b); join(a,b); stack.push(b);
    }
    for (let a=0; a<degree.length; a++) {
      if (degree[a] !== 1 || random() >= MAZE.loops) continue;
      const choices = neighbors(a).filter(b => !links.has(edge(a,b)));
      if (choices.length) join(a,choices[Math.floor(random()*choices.length)]);
    }
    return mask;
  })();
  function mazeWallAt(u,v) {
    const mod = (n,m) => ((n % m) + m) % m;
    return mazeMask.has(mod(v + Math.floor(MAZE.height/2), MAZE.height) * MAZE.width
      + mod(u + Math.floor(MAZE.width/2), MAZE.width));
  }
  function planMaze(ctx, out, state, anchor, frame, sourceGrid, sourceOpts) {
    const W = root.WorldGen, { N, tx, ty, depth, grid, surface } = ctx;
    const profile = W.floorProfile(depth).caveAreas;
    const coverage = surface.zone.coverage || surface.zone.idx;
    const source = root.Underground?.surfaceData(surface);
    const id = `cave_area|${state.key}|${depth}`;
    const diagnostic = { anchorKey: state.key, variant: 'dungeon_maze', status: 'declined', reason: null };
    out.diagnostics.push(diagnostic);
    const cells = new Map();
    for (let i=0; i<coverage.length; i++) {
      if (coverage[i] !== state.index+1 || out.reserved.has(i)) continue;
      const ix=i%N, iy=Math.floor(i/N);
      if (grid[i] !== W.T.CAVE_FLOOR && !(profile.carveWalls && grid[i] === W.T.CAVE_WALL)) continue;
      if (!W.isSpawnCell(sourceGrid,N,N,ix,iy,sourceOpts,'minor') ||
          !W.isSpawnCell(sourceGrid,N,N,ix,iy,{spawnWhy:ctx.spawnWhy},'minor') ||
          (source && !root.Underground.allowed(source,i))) continue;
      const u = Math.round((tx*4096+(ix+.5)*4096/N-anchor.originX)/anchor.unit);
      const v = Math.round((ty*4096+(iy+.5)*4096/N-anchor.originY)/anchor.unit);
      cells.set(i,{i,ix,iy,u,v});
    }
    const neighbors = i => {
      const x=i%N, y=Math.floor(i/N), list=[];
      if (x) list.push(i-1); if (x<N-1) list.push(i+1);
      if (y) list.push(i-N); if (y<N-1) list.push(i+N);
      return list.filter(j=>cells.has(j));
    };
    const [fx,fy] = anchor.local(anchor.originX,anchor.originY), focus = fy*N+fx;
    const ownFocus = state.anchor.owned && frame.inTile(fx,fy) && cells.has(focus);
    const sourcePoi = ownFocus && (surface.genObjects || surface.objects || []).find(o =>
      ['chest','grove_shrine'].includes(o.kind) && o._poiAt === `${state.anchor.lx},${state.anchor.ly}`);
    const mirror = sourcePoi && (ctx.objects || []).find(o => o.kind==='chest' && o.caveOf===sourcePoi.id);
    const mirrorCell = mirror && frame.cellOf(mirror.x,mirror.y);
    const dry = new Set([...(ctx.occupied || []), ...(ctx.routeLane || [])]);
    if (mirrorCell) dry.delete(mirrorCell.iy*N+mirrorCell.ix);
    for (const object of ctx.objects || []) {
      if (object === mirror) continue;
      const p = frame.cellOf(object.x,object.y);
      for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++)
        if (frame.inTile(p.ix+dx,p.iy+dy)) dry.add((p.iy+dy)*N+p.ix+dx);
    }
    const focusFree = ownFocus && !dry.has(focus)
      && W.isSpawnCell(sourceGrid,N,N,fx,fy,sourceOpts,'attractor')
      && W.isSpawnCell(sourceGrid,N,N,fx,fy,{spawnWhy:ctx.spawnWhy},'attractor');
    // Even a replaced mirror keeps its old approach open. If the focus is
    // blocked, the retained mirror must never be buried by the wall mask.
    if (mirrorCell) for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++)
      if (frame.inTile(mirrorCell.ix+dx,mirrorCell.iy+dy)) dry.add((mirrorCell.iy+dy)*N+mirrorCell.ix+dx);
    for (const c of cells.values()) if (Math.abs(c.u)<=1 && Math.abs(c.v)<=1) dry.add(c.i);
    const walls = new Set([...cells.values()].filter(c => mazeWallAt(c.u,c.v) && !dry.has(c.i)
      // Keep one open cell along every clipped boundary and tile seam.
      && neighbors(c.i).length===4).map(c=>c.i));
    const remaining = new Set(cells.keys()), reserved = new Set();
    while (remaining.size) {
      const first=remaining.values().next().value, component=[first]; remaining.delete(first);
      for (let k=0;k<component.length;k++) for (const j of neighbors(component[k]))
        if (remaining.delete(j)) component.push(j);
      const access=component.filter(i=>grid[i]===W.T.CAVE_FLOOR);
      if (!access.length) continue;
      const start=component.includes(focus) ? focus : access[0];
      walls.delete(start);
      // A 0/1 shortest-path tree connects every originally open cell while
      // cutting the fewest walls on each route. Never tunnel outside eligibility.
      const distance=new Map([[start,0]]), parent=new Map(), buckets=[[start]];
      for (let cost=0;cost<buckets.length;cost++) {
        const bucket=buckets[cost] || [];
        for (let k=0;k<bucket.length;k++) {
          const i=bucket[k]; if (distance.get(i)!==cost) continue;
          for (const j of neighbors(i)) {
            const next=cost+(walls.has(j)?1:0);
            if (next >= (distance.get(j) ?? Infinity)) continue;
            distance.set(j,next); parent.set(j,i);
            (buckets[next] || (buckets[next]=[])).push(j);
          }
        }
      }
      const connected=new Set([start]);
      for (const target of component.filter(i=>!walls.has(i))) {
        let i=target;
        while (!connected.has(i)) { connected.add(i); walls.delete(i); i=parent.get(i); }
      }
      for (const i of component) {
        reserved.add(i); out.reserved.add(i);
        out.terrain.set(i,walls.has(i)?W.T.CAVE_WALL:W.T.CAVE_FLOOR);
      }
    }
    if (!reserved.size) { diagnostic.reason='no_floor_access'; return; }
    const area={id,kind:'dungeon_maze',anchorKey:state.key,depth,ix:fx,iy:fy,
      ...frame.centre(fx,fy),reserved};
    out.areas.push(area);
    if (focusFree && reserved.has(focus)) {
      const shrine = fnv1a(`${id}|focus`) % 2 === 0;
      const extra={_ix:fx,_iy:fy,_cave:true,caveArea:id,depth,
        ...(mirror ? {caveOf:mirror.caveOf,poiClass:mirror.poiClass,poiDensity:mirror.poiDensity,
          rank:mirror.rank,name:mirror.name} : {}),
        ...(shrine ? {shrineKind:MAZE.shrineKind} : {tierSeed:MAZE.treasureTier-chestTierDepthBonus(depth)})};
      const p=frame.centre(fx,fy);
      const reward=W.makeObject(shrine?'grove_shrine':'chest',p.x,p.y,mirror?.id || `${id}|focus`,extra);
      if (mirror) out.replacements.push({object:mirror,replacement:reward,from:mirrorCell.iy*N+mirrorCell.ix,to:focus});
      else out.objects.push(reward);
      area.focusId=reward.id;
    } else if (ownFocus) diagnostic.focusShortfall='occupied';
    // Cell-addressed seats have one identity across observers; larger regions
    // get more encounters without a second budget at every clipped fragment.
    for (const i of reserved) {
      const c=cells.get(i);
      if (walls.has(i) || dry.has(i) || Math.hypot(c.u,c.v)<4) continue;
      const roll=avalanche32(fnv1a(`${id}|enemy|${c.u},${c.v}`))/4294967296;
      if (roll >= 1/(MAZE.enemySpacing*MAZE.enemySpacing)) continue;
      const kind=root.EnemySpawns.caveKind(depth,roll*MAZE.enemySpacing*MAZE.enemySpacing);
      if (!kind) continue;
      const spClass=creatureSpawnClass(kind);
      if (!W.isSpawnCell(sourceGrid,N,N,c.ix,c.iy,sourceOpts,spClass) ||
          !W.isSpawnCell(sourceGrid,N,N,c.ix,c.iy,{spawnWhy:ctx.spawnWhy},spClass)) continue;
      out.encounters.push({kind,...frame.centre(c.ix,c.iy),
        id:`${id}|enemy|${c.u},${c.v}`,_ix:c.ix,_iy:c.iy,caveArea:id,depth});
    }
    diagnostic.status='placed';
  }

  function apply(plan, grid, objects, wildplants, occupied) {
    for (const change of plan.replacements || []) {
      const index = objects.indexOf(change.object);
      if (index < 0) continue;
      objects[index] = change.replacement;
      occupied.delete(change.from); occupied.add(change.to);
    }
    for (const move of plan.moves) {
      Object.assign(move.object, { x: move.x, y: move.y, _ix: move.ix, _iy: move.iy });
      occupied.delete(move.from);
      occupied.add(move.to);
    }
    for (const [i, terrain] of plan.terrain) grid[i] = terrain;
    objects.push(...plan.objects);
    wildplants.push(...plan.wildplants);
    // Reservations deliberately do not become object occupancy. The caller
    // unions them into the gate supplied to ordinary fill and runtime spawns.
    const N = Math.sqrt(grid.length);
    for (const o of plan.objects.concat(plan.wildplants)) occupied.add(o._iy * N + o._ix);
    return plan;
  }
  root.CaveAreas = { SPRING, BUDGETS, MAZE, select, materialAt, mazeWallAt, plan, apply };
})(typeof window !== 'undefined' ? window : globalThis);
