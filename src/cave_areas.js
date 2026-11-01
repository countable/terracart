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
  // THE FOUR-PER-FLOOR GROVE PROGRAM (implemented from the reviewed draft,
  // docs/data/underground-zone-variants.draft.json levelProgram): floors 1
  // and 4-8 select their own grove variants beside the floor-2/3 classics.
  // Each variant pairs a challenge or novel environment with its bonus, and
  // every grove rolls a SIGNATURE enemy set - often one kind - so it need not
  // always spawn (kinds follow the roster's cave windows; authored seats may
  // take named-zone exceptions, like the spring's skeletons). Pure-visual
  // props ride the street-decoration art table (`_streetArt`), so no new art
  // ships with the program; ember eggs read as clay pots, silk as stakes and
  // creeping vines, fossils as mineable rock, pending the draft's candidates.
  const SHRINES = Object.freeze({ goblin_warrens: 'ember_altar', mushroom_cavern: 'toad_idol',
    moss_garden: 'moss_cairn', glowworm_grotto: 'lantern_saint', echo_hollow: 'bone_watcher',
    petrified_grove: 'toad_idol', ember_sanctum: 'ember_altar' });
  const SIGNATURES = Object.freeze({
    gemstone_cavern: [{ kinds: ['thief'], chance: .4 }],
    dungeon_maze: [{ kinds: ['goblin_trapper'], chance: .5 }],
    quicksand_cavern: [{ kinds: ['cave_slime'], count: 2, chance: .5 }],
    mine_tunnels: [{ kinds: ['club_goblin'], count: 2, chance: .5 }],
    flooded_cistern: [{ byDepth: { 1: ['cave_slime'], 5: ['gelatinous_cube'] }, chance: .5 }],
    magma_atoll: [{ kinds: ['red_demon'], chance: .35 }],
    moss_garden: [{ kinds: ['purple_slime'], count: 4, chance: .75 }],
    rat_cache_den: [{ kinds: ['rat'], count: 6, chance: .8 }, { kinds: ['thief'], chance: .35 }],
    glowworm_grotto: [{ byDepth: { 1: ['bat'], 5: ['vampire_bat'] }, count: 3, chance: .6 }],
    echo_hollow: [{ kinds: ['skeleton'], count: 6, chance: 1 }],
    obsidian_vault: [{ byDepth: { 4: ['goblin'], 7: ['orc_mage'] }, count: 3, chance: .7 }],
    fossil_ridge: [{ kinds: ['plant'], count: 2, chance: .5 }],
    petrified_grove: [{ kinds: ['plant'], count: 2, chance: .5 }],
    ember_sanctum: [{ byDepth: { 6: ['fiend'], 7: ['fiend'], 8: ['succubus'] }, count: 2, chance: .6 }],
    obsidian_garden: [{ kinds: ['poison_spider'], count: 2, chance: .5 }],
    salamander_nest: [{ kinds: ['fiend'], count: 2, chance: .85 }],
    bone_hoard: [{ byDepth: { 7: ['dryad'], 8: ['bone_plant'] }, count: 3, chance: .6 }],
    web_gallery: [{ kinds: ['poison_spider'], count: 3, chance: 1 }],
    egg_nursery: [{ kinds: ['orc_shaman'], chance: .8 }, { kinds: ['red_dragon'], chance: .1 }]
  });
  // Variant seats beyond the dressing: fixed offsets in anchor cells, with
  // per-floor kinds where the roster changes (authored seats, spring-style).
  const SEATS = Object.freeze({
    flooded_cistern: { offsets: [[-5, -4], [5, -4], [-6, 3], [6, 4]],
      kinds: { 1: ['cave_slime', 'cave_slime', 'rat', 'rat'], 5: ['vampire_bat', 'vampire_bat', 'goblin', 'goblin'] } },
    magma_atoll: { offsets: [[-5, -4], [5, -3], [-4, 5]], kinds: { 6: ['fiend', 'fiend', 'fiend'], 7: ['fiend', 'fiend', 'fiend'] } },
    moss_garden: { offsets: [[-5, -4], [5, -4], [-4, 5], [5, 5]], kinds: { 1: ['purple_slime'], 5: ['purple_slime'] } },
    rat_cache_den: { offsets: [[-6, -4], [6, -4], [-4, 4], [4, 5], [-6, 7], [7, -2], [-5, 0]],
      kinds: { 1: ['rat', 'rat', 'rat', 'rat', 'rat', 'rat', 'cave_slime'] } },
    glowworm_grotto: { offsets: [[-5, -6], [5, -4], [-3, 6]], kinds: { 1: ['bat'], 5: ['vampire_bat'] } },
    echo_hollow: { offsets: [[-6, -6], [6, -6], [-6, 5], [6, 6], [-3, -3], [3, 3]],
      kinds: { 4: ['skeleton'], 5: ['skeleton'] }, hidden: true },
    obsidian_vault: { offsets: [[-1, -1], [1, -1], [0, 5]], kinds: { 4: ['goblin', 'skeleton', 'goblin'], 7: ['orc_mage', 'fiend', 'orc_mage'] } },
    fossil_ridge: { offsets: [[-5, 3], [4, -5]], kinds: { 4: ['plant'] } },
    petrified_grove: { offsets: [[-4, 4], [5, -4]], kinds: { 4: ['plant'] } },
    ember_sanctum: { offsets: [[-6, 3], [3, -6]], kinds: { 6: ['fiend'], 7: ['fiend'], 8: ['succubus'] } },
    obsidian_garden: { offsets: [[-5, -5], [5, 5]], kinds: { 6: ['poison_spider'] } },
    salamander_nest: { offsets: [[-5, 5], [5, -5]], kinds: { 6: ['fiend'] } },
    bone_hoard: { offsets: [[-5, -4], [5, -5], [-4, 6]], kinds: { 7: ['dryad'], 8: ['bone_plant'] } },
    web_gallery: { offsets: [[-6, -5], [6, -4], [-4, 6]], kinds: { 8: ['poison_spider'] } },
    egg_nursery: { offsets: [[0, 7], [-6, -5], [6, -5]], kinds: { 8: ['orc_shaman', 'bone_plant', 'bone_plant'] } }
  });
  // Moat islands: the focal chest waits on an island ringed by water or
  // lava, crossed only by stepping-stone lanes (draft `moat_island` rows).
  const ISLANDS = Object.freeze({
    flooded_cistern: Object.freeze({ terrain: 'WATER', islandRadius: 3.2, moatWidth: 2.4, jitter: .7,
      crossings: [[0, -1], [0, 1]], bankJitter: .8, bankRadius: 8,
      bankArt: { 1: 'green_slick', 5: 'luminous_bulbs' }, bankCrop: { 1: 'slime_slick', 5: 'mushroom_bush' } }),
    magma_atoll: Object.freeze({ terrain: 'CAVE_LAVA', islandRadius: 3.2, moatWidth: 2.4, jitter: 1.2,
      crossings: [[0, -1], [1, 0]], bankJitter: 1, bankRadius: 8,
      bankArt: { 6: 'fire_rock', 7: 'fire_rock' }, bankRock: true })
  });
  function select(anchor, depth) {
    const profile = root.WorldGen.floorProfile(depth).caveAreas;
    if (!profile) return null;
    if (anchor.kind === 'quarry') return 'mine_tunnels';
    if (anchor.kind !== 'grove') return null;
    const weights = profile.weights;
    let ticket = fnv1a(`cave-area|${root.ZoneVariants.identity(anchor)}|${root.WorldGen.floorProfile(depth).generationDepth ?? depth}`) / 4294967296 * weights.reduce((sum, row) => sum + row.weight, 0);
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
    const out = { reserved: new Set(), quicksand: new Set(), areas: [], diagnostics: [], terrain: new Map(), objects: [], wildplants: [], moves: [], replacements: [], encounters: [] };
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
    const sourceOpts = { gameplayTiers: surface.gameplayTiers || source.gameplayTiers, spawnWhy: source.spawnWhy || surface.spawnWhy, roadMask: surface.roadMask };
    const caveOpts = { spawnWhy: ctx.spawnWhy };
    // Coverage resolves ownership; identity order also makes diagnostics and
    // output order stable when a tile's anchor array is reordered.
    const anchors = (field.anchors || []).map((anchor, index) => ({ anchor, index, key: V.identity(anchor) }))
      .filter(s => select(s.anchor, depth)).sort((a, b) => a.key.localeCompare(b.key));
    for (const s of anchors) {
      const a = V.anchorFrame(s.anchor, { N, tx, ty });
      const variant = select(s.anchor, depth);
      if (variant === 'dungeon_maze') { planMaze(ctx, out, s, a, frame, sourceGrid, sourceOpts); continue; }
      if (ISLANDS[variant]) { planIsland(ctx, out, s, a, frame, sourceGrid, sourceOpts); continue; }
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
    const used = new Set([...out.objects, ...out.wildplants, ...out.encounters]
      .map(o => o._iy * ctx.N + o._ix));
    for (const [slot, seat] of seats.entries()) {
      const c = cells.find(c => Math.abs(c.u - seat.u) < .51 && Math.abs(c.v - seat.v) < .51);
      if (!c || dry.has(c.i) || used.has(c.i) ||
          (out.terrain.get(c.i) ?? ctx.grid[c.i]) !== root.WorldGen.T.CAVE_FLOOR) continue;
      const frame = root.WorldGen.tileFrame({ cellsPerEdge: ctx.N }, ctx.tx, ctx.ty, ctx.tileEdgeM);
      out.encounters.push({ ...seat, ...frame.centre(c.ix, c.iy),
        id: `${area.id}|${seat.salt || 'enemy'}|${slot}`,
        _ix: c.ix, _iy: c.iy, caveArea: area.id, depth: ctx.depth });
      used.add(c.i);
    }
  }
  // A moat island (draft `moat_island`): the whole moat disc must be eligible
  // floor - a wall stabbing the ring breaks it, so the plan declines instead
  // of carving. Cells classify from seeded per-angle bands exactly the way
  // the preview paints them: island inside, water/lava ring, stone lanes.
  function planIsland(ctx, out, state, anchor, frame, sourceGrid, sourceOpts) {
    const W = root.WorldGen, { N, tx, ty, depth, grid, surface } = ctx;
    const kind = select(state.anchor, depth), spec = ISLANDS[kind];
    const coverage = surface.zone.coverage || surface.zone.idx;
    const id = `cave_area|${state.key}|${depth}`;
    const seedId = `cave_area|${state.key}|${W.floorProfile(depth).generationDepth ?? depth}`;
    const roll = (salt, key) => avalanche32(fnv1a(`${seedId}|${salt}|${key}`)) / 4294967296;
    const diagnostic = { anchorKey: state.key, variant: kind, status: 'declined', reason: null };
    out.diagnostics.push(diagnostic);
    const radius = spec.islandRadius + spec.moatWidth + spec.jitter + .5;
    const half = Math.ceil(radius);
    const [left, top] = anchor.local(anchor.originX - half * anchor.unit, anchor.originY - half * anchor.unit);
    const [right, bottom] = anchor.local(anchor.originX + half * anchor.unit, anchor.originY + half * anchor.unit);
    const source = root.Underground?.surfaceData(surface);
    const cells = [];
    let reason = null;
    for (let iy = top; iy <= bottom && !reason; iy++) for (let ix = left; ix <= right; ix++) {
      const u = ((tx * 4096 + (ix + .5) * 4096 / N) - anchor.originX) / anchor.unit;
      const v = ((ty * 4096 + (iy + .5) * 4096 / N) - anchor.originY) / anchor.unit;
      if (Math.hypot(u, v) > radius) continue;
      if (!frame.inTile(ix, iy)) { reason = 'tile_boundary'; break; }
      const i = iy * N + ix;
      if (coverage[i] !== state.index + 1 || out.reserved.has(i)) { reason = 'ownership'; break; }
      if (grid[i] !== W.T.CAVE_FLOOR ||
          !W.isSpawnCell(sourceGrid, N, N, ix, iy, sourceOpts, 'minor') ||
          !W.isSpawnCell(sourceGrid, N, N, ix, iy, { spawnWhy: ctx.spawnWhy }, 'minor') ||
          (source && !root.Underground.allowed(source, i))) { reason = 'blocked_ground'; break; }
      cells.push({ i, ix, iy, u: Math.round(u), v: Math.round(v), fu: u, fv: v });
    }
    if (reason) { diagnostic.reason = reason; return; }
    const band = c => {
      const th = Math.round(Math.atan2(c.fv, c.fu) * 100) / 100;
      const inner = spec.islandRadius + (roll('in', th) * 2 - 1) * spec.jitter;
      const outer = inner + spec.moatWidth + (roll('out', th) * 2 - 1) * spec.jitter * .5;
      return Math.hypot(c.fu, c.fv) <= inner ? 'island'
        : Math.hypot(c.fu, c.fv) <= outer ? 'moat' : null;
    };
    const byCell = new Map(cells.map(c => [c.i, c]));
    const kindOf = new Map();
    for (const c of cells) {
      const b = band(c);
      if (b === 'moat' && spec.crossings.some(([du, dv]) =>
        Math.abs(c.fu * dv - c.fv * du) <= .5 && c.fu * du + c.fv * dv > 0)) {
        kindOf.set(c.i, 'stone'); // the only crossing: whole lane cells
      } else if (b) kindOf.set(c.i, b);
    }
    const wet = i => kindOf.get(i) === 'moat';
    // Landmark halos (stairs, caches, routes) must never land in the moat.
    const dry = new Set([...(ctx.occupied || []), ...(ctx.routeLane || [])]);
    for (const object of ctx.objects || []) {
      const p = frame.cellOf(object.x, object.y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        if (frame.inTile(p.ix + dx, p.iy + dy)) dry.add((p.iy + dy) * N + p.ix + dx);
    }
    if (cells.some(c => wet(c.i) && dry.has(c.i))) { diagnostic.reason = 'landmark_pool'; return; }
    // The grove's mirrored cache becomes the island's focal chest when one
    // survives; no mirror means the island stands without one (never minted).
    const sourceChest = state.anchor.owned && (surface.genObjects || surface.objects || []).find(o =>
      o.kind === 'chest' && o._poiAt === `${state.anchor.lx},${state.anchor.ly}`);
    const mirror = sourceChest && (ctx.objects || []).find(o => o.kind === 'chest' && o.caveOf === sourceChest.id);
    const old = mirror && frame.cellOf(mirror.x, mirror.y);
    const focus = cells.find(c => c.u === 0 && c.v === 0) ||
      cells.filter(c => kindOf.get(c.i) === 'island').sort((a, b) => Math.hypot(a.fu, a.fv) - Math.hypot(b.fu, b.fv))[0];
    if (!focus || kindOf.get(focus.i) !== 'island') { diagnostic.reason = 'no_island_focus'; return; }
    if (mirror && old) out.moves.push({ object: mirror, from: old.iy * N + old.ix, to: focus.i,
      ...frame.centre(focus.ix, focus.iy), ix: focus.ix, iy: focus.iy });
    const reserved = new Set(cells.map(c => c.i));
    const [cx, cy] = anchor.local(anchor.originX, anchor.originY);
    const area = { id, kind, anchorKey: state.key, depth, ix: cx, iy: cy,
      ...frame.centre(cx, cy), reserved, moat: new Set([...kindOf].filter(([, k]) => k === 'moat').map(([i]) => i)) };
    out.areas.push(area);
    for (const c of cells) {
      out.reserved.add(c.i);
      if (kindOf.get(c.i) === 'moat') out.terrain.set(c.i, W.T[spec.terrain]);
    }
    // Bank props ring the moat on unclaimed floor; lanes stay clear.
    const used = new Set(dry);
    for (let iy = top - 2; iy <= bottom + 2; iy++) for (let ix = left - 2; ix <= right + 2; ix++) {
      if (!frame.inTile(ix, iy)) continue;
      const u = ((tx * 4096 + (ix + .5) * 4096 / N) - anchor.originX) / anchor.unit;
      const v = ((ty * 4096 + (iy + .5) * 4096 / N) - anchor.originY) / anchor.unit;
      const r = Math.hypot(u, v), th = Math.round(Math.atan2(v, u) * 100) / 100;
      if (Math.abs(u) <= 1 || Math.abs(v) <= 1) continue;
      const eff = spec.bankRadius + (roll('bank', th) * 2 - 1) * spec.bankJitter;
      if (Math.abs(r - eff) > .5) continue;
      const i = iy * N + ix;
      if (reserved.has(i) || used.has(i) || coverage[i] !== state.index + 1 ||
          grid[i] !== W.T.CAVE_FLOOR) continue;
      used.add(i);
      const p = frame.centre(ix, iy);
      if (spec.bankRock) out.objects.push(W.makeObject('mineralrock', p.x, p.y,
        `${id}|${Math.round(u)},${Math.round(v)}|bank`, { _ix: ix, _iy: iy, _cave: true, caveArea: id, depth,
          requiredTier: 1, yieldTier: 1, _streetArt: spec.bankArt[depth] }));
      else out.wildplants.push(W.makeWildplant(spec.bankCrop[depth], p.x, p.y,
        `${id}|${Math.round(u)},${Math.round(v)}|bank`, { _ix: ix, _iy: iy, _cave: true, caveArea: id, depth,
          _streetArt: spec.bankArt[depth] }));
    }
    seatEncounters(ctx, out, area, cells, dry, kind, seedId, depth);
    diagnostic.status = 'placed';
  }
  function landmarksOf(ctx) { return ctx.objects || []; }
  // Fixed authored seats plus the signature roll share one matcher; `salt`
  // keeps signature ids distinct from fixed seats across reloads.
  function seatEncounters(ctx, out, area, cells, dry, kind, seedId, depth) {
    const seats = [];
    const plan = SEATS[kind];
    if (plan) for (const [n, [u, v]] of plan.offsets.entries()) {
      const kinds = plan.kinds[depth] || plan.kinds[Math.min(...Object.keys(plan.kinds))];
      seats.push({ u, v, kind: kinds[Math.min(n, kinds.length - 1)], salt: 'enemy',
        ...(plan.hidden ? { hidden: true, dormant: true, revealDistanceCells: 1 } : {}) });
    }
    addEncounters(ctx, out, area, cells, dry, seats);
    rollSignatures(ctx, out, area, cells, dry, kind, seedId, depth);
  }
  // The signature roll: per set, once per area, on its own stable stream.
  function rollSignatures(ctx, out, area, cells, dry, kind, seedId, depth) {
    const spread = [[-7, -3], [7, -3], [-7, 4], [7, 4], [0, -7], [0, 7], [-3, -7], [3, 7]];
    for (const [n, set] of (SIGNATURES[kind] || []).entries()) {
      if (avalanche32(fnv1a(`${seedId}|signature|${n}`)) / 4294967296 >= (set.chance ?? 1)) continue;
      const kinds = set.byDepth?.[depth] || set.byDepth?.[Math.min(...Object.keys(set.byDepth))] || set.kinds;
      const seats = [];
      for (let k = 0; k < (set.count || 1); k++) seats.push({
        u: spread[(k + n * 2) % spread.length][0], v: spread[(k + n * 2) % spread.length][1],
        kind: kinds[k % kinds.length], salt: `sig${n}` });
      addEncounters(ctx, out, area, cells, dry, seats);
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
    const seedId = `cave_area|${state.key}|${W.floorProfile(depth).generationDepth ?? depth}`;
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
      fnv1a(`${seedId}|${salt}|${a.u},${a.v}`) - fnv1a(`${seedId}|${salt}|${b.u},${b.v}`));
    const put = (c, objectKind, extra={}) => {
      if (!c || used.has(c.i)) return false;
      const p = frame.centre(c.ix,c.iy), slot = `${id}|${c.u},${c.v}|${objectKind}`;
      const attrs = { _ix:c.ix, _iy:c.iy, _cave:true, caveArea:id, depth, ...extra };
      if (objectKind === 'mushroom') out.wildplants.push(W.makeWildplant('mushroom',p.x,p.y,slot,attrs));
      else out.objects.push(W.makeObject(objectKind,p.x,p.y,slot,attrs));
      used.add(c.i); return true;
    };
    if (kind === 'quicksand_cavern') {
      // Preserve the dry cardinal approaches, focus, routes and landmark halos.
      // The explicit mask makes ordinary sand elsewhere harmless.
      area.quicksand = new Set();
      for (const c of usable.filter(c => free(c) && !court(c))) {
        out.terrain.set(c.i, W.T.SAND);
        out.quicksand.add(c.i); area.quicksand.add(c.i);
      }
      rollSignatures(ctx, out, area, usable, dry, kind, seedId, depth);
      diagnostic.status = 'placed';
      return;
    }
    const shrine = SHRINES[kind] || null;
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
    } else if (SEATS[kind]) {
      // The four-per-floor grove program: seeded theme patterns (the same
      // shapes the preview bakes) seated through the street art table, so no
      // new art ships. Court and approach lanes stay clear by the shared
      // free()/cross() contract above.
      const roll = (salt, u, v) => avalanche32(fnv1a(`${seedId}|${salt}|${u},${v}`)) / 4294967296;
      const angDist = (a, b) => { const d = Math.abs(a - b) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };
      const plant = (c, crop, art) => { if (!c || used.has(c.i)) return;
        const p = frame.centre(c.ix, c.iy);
        out.wildplants.push(W.makeWildplant(crop, p.x, p.y, `${id}|${c.u},${c.v}|${crop}`,
          { _ix: c.ix, _iy: c.iy, _cave: true, caveArea: id, depth, ...(art ? { _streetArt: art } : {}) }));
        used.add(c.i); };
      const mineral = (c, art, extra = {}) =>
        put(c, 'mineralrock', { requiredTier: 1, caveVariant: 0, ...(art ? { _streetArt: art, yieldTier: 1 } : {}), ...extra });
      const pot = (c, style) => put(c, 'chest', { barrel: true, ...(style ? { barrelStyle: style } : {}) });
      const gem = c => { const g = root.Underground.gem(depth, `${id}|${c.u},${c.v}`); if (g) put(c, 'mineralrock', g); };
      const at = (u, v) => open.find(c => Math.abs(c.u - u) < .51 && Math.abs(c.v - v) < .51);
      const open = usable.filter(c => free(c) && !court(c));
      if (kind === 'moss_garden') {
        const centres = order(open, 'mossC').slice(0, 5).map(c => ({ c, s: 1.4 + roll('spread', c.u, c.v) * 1.3 }));
        for (const c of open) {
          let best = null;
          for (const k of centres) { const d = Math.hypot(c.u - k.c.u, c.v - k.c.v); if (d <= k.s && (!best || d < best.d)) best = { d: d, s: k.s }; }
          if (!best || roll('moss', c.u, c.v) < .25) continue;
          if (best.d > best.s * .72 && roll('edge', c.u, c.v) < .4)
            roll('mr', c.u, c.v) < .3 ? mineral(c, 'mossy_rock') : put(c, 'mushroom');
          else plant(c, 'slime_slick', 'green_slick');
        }
      } else if (kind === 'rat_cache_den') {
        const base = roll('rot', 0, 0) * Math.PI * 2;
        let barrels = 0;
        for (const c of open) {
          const r = Math.hypot(c.u, c.v), th = Math.atan2(c.v, c.u);
          if (r >= 3.6 && r <= 5 && angDist(th, base) < 1.35 && roll('rat', c.u, c.v) < .8)
            barrels < 5 && roll('barrel', c.u, c.v) < .45 ? (pot(c), barrels++) : mineral(c);
        }
        for (const k of order(open, 'slickC').slice(0, 2))
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
            if (roll('slick', k.u + dx, k.v + dy) < .7) plant(at(k.u + dx, k.v + dy), 'slime_slick', 'green_slick');
      } else if (kind === 'glowworm_grotto') {
        for (let k = 0; k < 3; k++) {
          const a = roll('chord', k, 0) * Math.PI * 2;
          for (const c of open) {
            const r = Math.hypot(c.u, c.v);
            if (r > 9 || Math.abs(c.u * Math.sin(a) - c.v * Math.cos(a)) > .6 || roll('glow', c.u, c.v) < .18) continue;
            plant(c, 'mushroom_bush', (c.u + c.v) % 7 === 3 && roll('orb', c.u, c.v) < .5 ? 'green_orb' : 'luminous_bulbs');
          }
        }
        for (const c of order(open, 'rockC').slice(0, 5)) mineral(c);
      } else if (kind === 'echo_hollow') {
        for (const R of [4, 6, 8]) for (const c of open)
          if (Math.abs(Math.hypot(c.u, c.v) - R) <= .45 && roll('echo', c.u, c.v) > .35) put(c, 'stakes');
        for (const c of order(open, 'dustC').slice(0, 7)) mineral(c, 'dusty_stones');
        plant(at(-3, -3), 'mushroom_bush', 'green_orb'); // the gong seat's glow
      } else if (kind === 'fossil_ridge') {
        for (const c of open) {
          const band = Math.floor((c.u + c.v + Math.round((roll('fj', c.u, c.v) - .5) * 3)) / 6);
          if (band !== 1 && band !== 4) { if (roll('fr', c.u, c.v) < .05) mineral(c); continue; }
          if (roll('ff', c.u, c.v) < .35) mineral(c); // fossil seam: mineable rock, art pending
          else if (roll('fg', c.u, c.v) > .93) gem(c);
        }
      } else if (kind === 'petrified_grove') {
        for (const c of open) {
          const r = Math.hypot(c.u, c.v);
          if (Math.abs(r - 5.5) <= .55 && roll('pg', c.u, c.v) > .25)
            roll('pt', c.u, c.v) < .7 ? plant(c, 'shrub', 'mossy_tree') : mineral(c);
          else if (Math.abs(r - 8) <= .45 && roll('pm', c.u, c.v) < .35) put(c, 'mushroom');
          else if (roll('ps', c.u, c.v) < .05) mineral(c);
        }
      } else if (kind === 'ember_sanctum') {
        for (let k = 0; k < 6; k++) {
          const a = k * Math.PI / 3 + Math.PI / 6;
          for (const R of [3.2, 5.2, 7.2]) {
            if (roll('es', k, R) < .15) continue;
            plant(at(Math.round(Math.cos(a) * R), Math.round(Math.sin(a) * R)), 'torch', 'flame_pillar');
          }
          const b = k * Math.PI / 3 + Math.PI / 3 + Math.PI / 6;
          plant(at(Math.round(Math.cos(b) * 4.2), Math.round(Math.sin(b) * 4.2)), 'torch', 'upright_flame');
        }
        for (const c of open) if (Math.hypot(c.u, c.v) > 7 && roll('er', c.u, c.v) < .3) mineral(c, 'fire_rock');
      } else if (kind === 'obsidian_garden') {
        for (const c of open) {
          const bed = ((c.u - c.v) % 7 + 7) % 7;
          if (bed > 1) continue;
          if (Math.abs(c.u) > 8 && roll('ou', c.u, c.v) > .7) pot(c, 'street_decor_dark_urn');
          else if (roll('og', c.u, c.v) < .33) plant(c, 'rubble', 'dark_rubble');
        }
        // Hidden pits stay with the floor's own trap pass; the garden only
        // leans on it by never seating over it (used cells block trap picks).
        for (const c of order(open.filter(c => ((c.u - c.v) % 7 + 7) % 7 <= 1), 'crest').slice(0, 2)) gem(c);
      } else if (kind === 'salamander_nest') {
        for (const c of open) {
          const r = Math.hypot(c.u, c.v);
          if (r < 3.4 || r > 6.6) continue;
          const phase = ((r - 3.4) / .3) * .5;
          if (angDist(Math.atan2(c.v, c.u), phase) < .35) pot(c, 'clay_pot'); // ember eggs, art pending
        }
        for (const c of order(open.filter(c => Math.hypot(c.u, c.v) > 7), 'rockC').slice(0, 7)) mineral(c, 'fire_rock');
        plant(at(0, -8), 'torch', 'flame_pillar');
      } else if (kind === 'bone_hoard') {
        for (const [k, R, span] of [[0, 5, 3.4], [1, 7, 2.6]]) {
          const base = roll('brot', k, 0) * Math.PI * 2;
          for (const c of open)
            if (Math.abs(Math.hypot(c.u, c.v) - R) <= .6 && angDist(Math.atan2(c.v, c.u), base) < span / 2
              && roll('bone', c.u, c.v) < .8) plant(c, 'bone_fragments', 'bone_fragments');
        }
        for (const c of order(open, 'bowlC').slice(0, 3)) plant(c, 'golden_bowl', 'golden_bowl');
        for (const c of order(open.filter(c => Math.hypot(c.u, c.v) > 7), 'rubC').slice(0, 5)) plant(c, 'rubble', 'dark_rubble');
      } else if (kind === 'web_gallery') {
        // The braid's wall lines sheeted in silk: creeping vines harvest as
        // threads, stakes carry the slow; husks cocoon at seeded junctions.
        const off = fnv1a(`${seedId}|silk`) % 17;
        for (const c of open) if (mazeWallAt(c.u + off, c.v + off))
          roll('silk', c.u, c.v) < .35 ? put(c, 'stakes') : plant(c, 'creeping_vine');
        for (const c of order(open, 'huskC').slice(0, 4)) plant(c, 'bone_fragments', 'bone_fragments');
      } else if (kind === 'egg_nursery') {
        for (const c of open) {
          const r = Math.hypot(c.u, c.v);
          if (angDist(Math.atan2(c.v, c.u), Math.PI / 2) < .45) continue; // the keeper's lane
          if ((Math.abs(r - 3.4) <= .5 && roll('en1', c.u, c.v) < .55) ||
              (Math.abs(r - 5.4) <= .5 && roll('en2', c.u, c.v) < .3)) pot(c, 'clay_pot');
          else if (r > 7 && roll('er', c.u, c.v) < .2) mineral(c, 'fire_rock');
        }
        plant(at(-7, 3), 'rubble', 'dark_rubble'); plant(at(7, -3), 'golden_bowl', 'golden_bowl');
      } else if (kind === 'obsidian_vault') {
        // One strong-room: wall ring with a lane door each side (approaches
        // stay open by contract), urns and a bowl inside, the garrison seated.
        for (const c of usable) {
          const box = Math.max(Math.abs(c.u), Math.abs(c.v));
          if (box === 3 && !(Math.abs(c.u) <= 1 || Math.abs(c.v) <= 1)) mineral(c);
        }
        const inside = order(open.filter(c => Math.max(Math.abs(c.u), Math.abs(c.v)) < 3), 'vaultC').slice(0, 3);
        pot(inside[0], 'street_decor_dark_urn'); pot(inside[1], 'street_decor_dark_urn');
        plant(inside[2], 'golden_bowl', 'golden_bowl');
      }
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
    if (SEATS[kind]) seatEncounters(ctx, out, area, usable, dry, kind, seedId, depth);
    else { addEncounters(ctx, out, area, usable, dry, seats);
      rollSignatures(ctx, out, area, usable, dry, kind, seedId, depth); }
    diagnostic.status='placed';
  }
  const MAZE = Object.freeze({ width: 34, height: 33, step: 3, loops: .77, seed: 2718,
    enemySpacing: 12, shrineKind: 'ember_altar', treasureTier: 3 });
  // THE BRAID — the one maze layout generator: a spanning tree of WALL LINES
  // over a lattice of nodes `step` cells apart (the first at `origin`), drawn
  // by a seeded depth-first walk, then `loops` of its dead ends joined to a
  // neighbour. The open floor is what the lines leave. Returns the wall
  // cells as `y * width + x`. The dungeon maze reads it through mazeWallAt
  // (MAZE, the reviewed layout-lab braid); the grove temple's maze trial
  // builds its own small braid with it (temple_puzzles.js mazeBoard).
  function mazeBraid({ width, height, step, loops, seed: seed0, origin = 1 }) {
    let seed = seed0 + 47291;
    const random = () => {
      seed += 0x6D2B79F5;
      let t = seed; t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    const cols = Math.floor((width - origin - 2) / step) + 1;
    const rows = Math.floor((height - origin - 2) / step) + 1;
    const mask = new Set(), links = new Set(), degree = new Uint8Array(cols * rows);
    const coord = i => [origin + i % cols * step, origin + Math.floor(i / cols) * step];
    const edge = (a,b) => `${Math.min(a,b)}:${Math.max(a,b)}`;
    const neighbors = i => {
      const x = i % cols, y = Math.floor(i / cols), out = [];
      if (x) out.push(i-1); if (x < cols-1) out.push(i+1);
      if (y) out.push(i-cols); if (y < rows-1) out.push(i+cols);
      return out;
    };
    const add = (x,y) => mask.add(y * width + x);
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
      if (degree[a] !== 1 || random() >= loops) continue;
      const choices = neighbors(a).filter(b => !links.has(edge(a,b)));
      if (choices.length) join(a,choices[Math.floor(random()*choices.length)]);
    }
    return mask;
  }
  // The reviewed layout-lab braid, phased from the canonical grove focus.
  // Repeat its open border on large footprints rather than stretching cells.
  const mazeMask = mazeBraid(MAZE);
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
    const seedId = `cave_area|${state.key}|${W.floorProfile(depth).generationDepth ?? depth}`;
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
      const shrine = fnv1a(`${seedId}|focus`) % 2 === 0;
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
      const roll=avalanche32(fnv1a(`${seedId}|enemy|${c.u},${c.v}`))/4294967296;
      if (roll >= 1/(MAZE.enemySpacing*MAZE.enemySpacing)) continue;
      const kind=root.EnemySpawns.caveKind(depth,roll*MAZE.enemySpacing*MAZE.enemySpacing);
      if (!kind) continue;
      const spClass=creatureSpawnClass(kind);
      if (!W.isSpawnCell(sourceGrid,N,N,c.ix,c.iy,sourceOpts,spClass) ||
          !W.isSpawnCell(sourceGrid,N,N,c.ix,c.iy,{spawnWhy:ctx.spawnWhy},spClass)) continue;
      out.encounters.push({kind,...frame.centre(c.ix,c.iy),
        id:`${id}|enemy|${c.u},${c.v}`,_ix:c.ix,_iy:c.iy,caveArea:id,depth});
    }
    rollSignatures(ctx, out, area, [...reserved].map(i => cells.get(i)).filter(Boolean), dry, 'dungeon_maze', seedId, depth);
    diagnostic.status='placed';
  }

  // The city is the background floor, not a collection of grove-only pockets.
  // Its room lattice repeats in world cells; doors and protected approaches
  // remain open even where roads or buildings clip a room.
  function planCity(ctx, out = { reserved: new Set(), areas: [], diagnostics: [], terrain: new Map(),
    objects: [], wildplants: [], moves: [], replacements: [], encounters: [] }) {
    const W = root.WorldGen, { grid, N, tx, ty, tileEdgeM, depth } = ctx;
    const cfg = W.floorProfile(depth).warren;
    if (!cfg) return out;
    const frame = W.tileFrame({ cellsPerEdge: N }, tx, ty, tileEdgeM);
    const id = `goblin_city|${depth}|${tx},${ty}`;
    const reserved = new Set(), passages = new Set(), protectedCells = new Set(ctx.routeLane || []);
    for (const i of ctx.routeCells || []) protectedCells.add(i);
    const occupied = new Set(ctx.occupied || []);
    for (const object of [...(ctx.objects || []), ...out.objects, ...out.wildplants]) {
      const p = frame.cellOf(object.x, object.y);
      occupied.add(p.iy * N + p.ix);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        if (frame.inTile(p.ix + dx, p.iy + dy)) protectedCells.add((p.iy + dy) * N + p.ix + dx);
    }
    const eligible = new Uint8Array(grid.length), walls = new Set(), rooms = new Map();
    const mod = (a, b) => ((a % b) + b) % b;
    const opts = { spawnWhy: ctx.spawnWhy };
    for (let i = 0; i < grid.length; i++) {
      const x = i % N, y = Math.floor(i / N);
      if (out.reserved.has(i) || grid[i] !== W.T.CAVE_FLOOR ||
          !W.isSpawnCell(grid, N, N, x, y, opts, 'minor')) continue;
      eligible[i] = 1;
      reserved.add(i); out.reserved.add(i);
      const gx = tx * N + x, gy = ty * N + y;
      const u = mod(gx, cfg.roomCells), v = mod(gy, cfg.roomCells);
      const mid = Math.floor(cfg.roomCells / 2);
      const lane = u === mid || u === mid + 1 || v === mid || v === mid + 1;
      if (lane || protectedCells.has(i) || x === 0 || y === 0 || x === N - 1 || y === N - 1) passages.add(i);
      else if (u === 0 || v === 0) walls.add(i);
      const key = `${Math.floor(gx / cfg.roomCells)},${Math.floor(gy / cfg.roomCells)}`;
      if (!rooms.has(key)) rooms.set(key, []);
      rooms.get(key).push(i);
    }
    // A clear rim joins clipped rooms around every pre-existing obstacle.
    for (const i of walls) {
      const x = i % N, y = Math.floor(i / N);
      if ([-1, 0, 1].some(dy => [-1, 0, 1].some(dx =>
        !frame.inTile(x + dx, y + dy) || !eligible[(y + dy) * N + x + dx]))) {
        walls.delete(i); passages.add(i);
      }
    }
    if (!reserved.size) return out;
    const area = { id, kind: 'goblin_warrens', city: true, depth, reserved, passages,
      protected: protectedCells, roomCount: rooms.size };
    out.areas.push(area);
    const put = (i, kind, extra) => {
      const ix = i % N, iy = Math.floor(i / N);
      const at = frame.centre(ix, iy);
      const object = W.makeObject(kind, at.x, at.y,
        `${id}|${ix},${iy}|${kind}`, { _ix: ix, _iy: iy, _cave: true, caveArea: id, depth, ...extra });
      out.objects.push(object); occupied.add(i);
    };
    for (const i of walls) if (!occupied.has(i)) put(i, 'mineralrock', { requiredTier: 1, caveVariant: 0 });
    let stores = Math.max(0, W.caveContainerBudget(tx, ty, depth)
      - [...(ctx.objects || []), ...out.objects].filter(o => o.barrel).length);
    for (const [key, cells] of rooms) {
      const seats = cells.filter(i => !occupied.has(i) && !protectedCells.has(i) && !passages.has(i));
      seats.sort((a, b) => fnv1a(`${id}|seat|${a}`) - fnv1a(`${id}|seat|${b}`));
      if (fnv1a(`${id}|room|${key}`) / 4294967296 < cfg.enemyChance) {
        const kinds = cfg.enemies;
        const kind = kinds[fnv1a(`${id}|kind|${key}`) % kinds.length];
        const cls = creatureSpawnClass(kind);
        const i = seats.find(i => W.isSpawnCell(grid, N, N, i % N, Math.floor(i / N), opts, cls));
        if (i != null) {
          const ix = i % N, iy = Math.floor(i / N);
          out.encounters.push({ ...frame.centre(ix, iy), kind, id: `${id}|enemy|${key}`,
            _ix: ix, _iy: iy, caveArea: id, depth });
          occupied.add(i);
        }
      }
      if (stores > 0) {
        const i = seats.find(i => !occupied.has(i) && W.isSpawnCell(grid, N, N,
          i % N, Math.floor(i / N), opts, 'reward'));
        if (i != null) { put(i, 'chest', { barrel: true }); stores--; }
      }
    }
    return out;
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
  root.CaveAreas = { SPRING, BUDGETS, MAZE, select, materialAt, mazeBraid, mazeWallAt, plan, planCity, apply };
})(typeof window !== 'undefined' ? window : globalThis);
