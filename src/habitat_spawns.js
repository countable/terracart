// Surface populations belong to their landcover or winning authored variant.
// Species rates apply to eligible cells of the most-specific owner. Legacy
// budget helpers below are retained only for save-identity migration.
(function (root) {
  'use strict';
  // Compatibility constants for legacyPopulationSteps. Only the declared
  // shoreline-length exception still uses faunaCount at runtime.
  const FAUNA_DENSITY = 0.7;
  const faunaCount = count => Math.round(count * FAUNA_DENSITY);
  const FAUNA_PER_TILE = faunaCount(160), ENEMIES_PER_TILE = 50;
  const FAUNA_SPACING_CELLS = 3;
  // One shared field for all species and habitat owners. Capped clearance
  // makes each candidate lookup constant-time, even on a crowded shore.
  function faunaSpacing(N, indices = []) {
    const clearance = new Uint8Array(N * N).fill(FAUNA_SPACING_CELLS);
    function add(index) {
      if (index < 0 || index >= N * N) return;
      const cx = index % N, cy = Math.floor(index / N), radius = FAUNA_SPACING_CELLS - 1;
      for (let y = Math.max(0, cy - radius); y <= Math.min(N - 1, cy + radius); y++) {
        for (let x = Math.max(0, cx - radius); x <= Math.min(N - 1, cx + radius); x++) {
          const i = y * N + x;
          clearance[i] = Math.min(clearance[i], Math.max(Math.abs(x - cx), Math.abs(y - cy)));
        }
      }
    }
    for (const index of indices) add(index);
    return { add, clearance: index => clearance[index] ?? 0 };
  }
  // MODE VISIBILITY: the legacy reserveBudget helper below is migration-only.
  // Live reserve candidates use density rows, sized by the
  // largest Difficulty landEnemyCountMul. Every mode generates the same
  // reserve after the base population (so base seats never move); each mode
  // shows its own share of it (reserveVisible).
  const maxLandEnemyMul = () => Math.max(1, ...Object.values(root.Difficulty?.PROFILES || {})
    .map(p => p.landEnemyCountMul || 1));
  const reserveBudget = () => Math.round(ENEMIES_PER_TILE * (maxLandEnemyMul() - 1));
  function reserveVisible(creature, modeProfile) {
    if (!creature?._landEnemyReserve) return true;
    const spare = maxLandEnemyMul() - 1;
    const share = spare > 0 ? ((modeProfile?.landEnemyCountMul || 1) - 1) / spare : 0;
    return root.EnemySpawns.roll(creature.id + ':mode') < share;
  }
  const LAND_FAUNA = {
    GRASS: { chicken: 5, cow: 4, butterfly: 4, rabbit: 3, crow: 2, horse: .4 },
    RESIDENTIAL: { cat: 4, dog: 4, chicken: 3, deer: 2, cow: .5, raven: .5 },
    FOREST: { deer: 6, rabbit: 3, dog: 1 },
    FARMLAND: { chicken: 6, cow: 5, rabbit: 2, horse: 1 },
    WASTELAND: { dog: 5, rabbit: 2, chicken: 1 },
    PARK: { butterfly: 5, rabbit: 4, crow: 3, chicken: 2, cat: 1 },
    GROVE: { butterfly: 5, rabbit: 4, crow: 3, chicken: 2 },
    WETLAND: { butterfly: 6, rabbit: 2, dog: 1 },
    ORCHARD: { chicken: 4, rabbit: 3, dog: 1 },
    ROCK: { rabbit: 3, dog: 2 },
    SAND: { rabbit: 2, dog: 1 },
    SCHOOL: { chicken: 3, butterfly: 3, cat: 2, rabbit: 2 },
    COMMERCIAL: { cat: 4, dog: 3 },
    INDUSTRIAL: { dog: 4, rabbit: 1 },
    PLAYGROUND: { butterfly: 4, rabbit: 3, cat: 1 },
    PITCH: { rabbit: 4, butterfly: 3, cow: 1 },
    CHURCHYARD: { rabbit: 3, cat: 1 },
    TAR_YARD: { dog: 3, rabbit: 1 },
  };
  const VARIANT_FAUNA = {
    meadow: { rabbit: 4, butterfly: 4, chicken: 2 },
    marine_meadow: {},
    mushroom_grove: { rabbit: 4, crow: 3, butterfly: 2 },
    orchard: { chicken: 3, rabbit: 3, dog: 1 },
    formal_garden: { butterfly: 4, rabbit: 3, chicken: 2, cat: 1 },
    hedge_garden: { rabbit: 4, butterfly: 3, chicken: 2, cat: 1 },
    ancient_grove: { crow: 4, rabbit: 3 },
    spooky_woods: { crow: 4, rabbit: 3 },
    sacred_grove: { crow: 3, rabbit: 3, butterfly: 2 },
    stone_garden: { rabbit: 3, cat: 1 },
    ordered_graves: { rabbit: 2, cat: 1 },
    overgrown_graves: { rabbit: 3, butterfly: 2 },
    broken_masonry: { dog: 3, rabbit: 2 },
    silent_circle: { rabbit: 3, cat: 1 },
    flint_field: { dog: 3, rabbit: 2 },
    broken_depot: { dog: 4, rabbit: 1 },
    seep: { butterfly: 3, rabbit: 2 },
    work_yard: { dog: 3, chicken: 1 },
    black_ring: { dog: 3, rabbit: 1 },
    // Shore-length fauna and authored beach pieces remain separate populations.
    mystic_reef: {},
    pirate_cove: {},
    shellwater_strand: {},
    'quarry-crater': {},
    'quarry-abandoned': { rabbit: 3, dog: 1 },
    'quarry-strip-mine': { dog: 2, rabbit: 1 },
    'quarry-stronghold': { dog: 3, rabbit: 1 },
  };
  const HAUNTED_LAND = new Set(['GRASS', 'FOREST', 'ROCK', 'SAND', 'RESIDENTIAL',
    'COMMERCIAL', 'INDUSTRIAL', 'WETLAND', 'ORCHARD']);
  const HAUNTED_VARIANTS = new Set(['ordered_graves', 'overgrown_graves', 'silent_circle', 'black_ring']);
  const landCache = new Map(), variantCache = new Map(), roadCache = new Map();
  const weightedRows = mix => Object.freeze(Object.entries(mix).map(([kind, weight]) => Object.freeze({ kind, weight })));
  const terrainNames = new Map();
  function nameOf(type) {
    if (typeof type === 'string') return type;
    if (!terrainNames.has(type)) terrainNames.set(type, Object.keys(root.WorldGen.T).find(name => root.WorldGen.T[name] === type));
    return terrainNames.get(type);
  }
  // Finalise nearby slot keys so sequential ordinals do not select long
  // runs of the same species or neighbouring seats.
  const unit = key => u01(avalanche32(root.EnemySpawns.hash('habitat|' + key)));
  function pick(rows, value, weight) {
    return weightedPickAt(rows, weight, value);
  }
  function landProfile(type) {
    const name = nameOf(type);
    if (!LAND_FAUNA[name]) return null;
    if (!landCache.has(name)) landCache.set(name, Object.freeze({ id: name, owner: 'land',
      fauna: weightedRows(LAND_FAUNA[name]), haunting: HAUNTED_LAND.has(name) }));
    return landCache.get(name);
  }
  function shoreProfile(type) {
    const name = nameOf(type), base = landProfile(type);
    if (!base && name !== 'WATER') return null;
    const key = `${name}:shore`;
    if (!landCache.has(key)) landCache.set(key, Object.freeze({ id: key, owner: 'land',
      fauna: weightedRows({}), haunting: !!base?.haunting,
      // Ordinary beach enemies favour shoreline jellyfish over sand crabs.
      enemyTierWeights: Object.freeze({ 1: 1, 2: 4 }) }));
    return landCache.get(key);
  }
  function variantProfile(id, kind) {
    const row = root.ZoneVariants?.byId(id);
    kind ||= row?.zone;
    const key = `${kind || ''}:${id}`;
    if (!variantCache.has(key)) {
      const mix = VARIANT_FAUNA[id] || (kind === 'grove' ? VARIANT_FAUNA.meadow
        : kind === 'tar' ? VARIANT_FAUNA.work_yard : VARIANT_FAUNA.stone_garden);
      variantCache.set(key, Object.freeze({ id, owner: 'zone', kind, fauna: weightedRows(mix),
        faunaBudget: Object.freeze(!Object.keys(mix).length ? [0, 0] : kind === 'quarry' ? [2, 4] : [3, 8]),
        haunting: HAUNTED_VARIANTS.has(id) }));
    }
    return variantCache.get(key);
  }
  function roadProfile(id) {
    const row = root.StreetVariants?.VARIANT_BY_ID?.[id];
    if (!row || row.size === 'path') return null;
    if (!roadCache.has(id)) {
      const mix = {}, budget = [0, 0];
      for (const [kind, range] of Object.entries(row.fauna || {})) {
        if (!Array.isArray(range) || !(range[1] > 0)) continue;
        mix[kind] = (range[0] + range[1]) / 2;
        budget[0] += range[0]; budget[1] += range[1];
      }
      roadCache.set(id, Object.freeze({ id, owner: 'road', fauna: weightedRows(mix),
        faunaBudget: Object.freeze(budget), habitatEnemies: row.habitatEnemies, haunting: row.haunting === true || id === 'pilgrim' }));
    }
    return roadCache.get(id);
  }
  function resolve(entry, index) {
    const grid = entry?.baseGrid || entry?.grid;
    const liveDiscard = (entry?.depth || 0) === 0 && !entry?._homeVariantGenerating && entry?.variantDiscarded?.[index];
    const type = liveDiscard ? (entry.grid?.[index] ?? grid?.[index]) : grid?.[index];
    if (type == null || index < 0 || index >= grid.length) return { key: null, profile: null, type };
    const coverage = entry.zone?.coverage || entry.zone?.idx;
    const owner = root.WorldGen.variantOwnerAt(entry, index);
    if (owner === 'home') return { key: 'home', profile: null, type, variant: 'home' };
    if (owner === 'zone') {
      const slot = coverage?.[index], anchor = root.WorldGen.zoneAnchorAt(entry, index);
      if (!anchor) return { key: null, profile: null, type };
      const variant = anchor.variant || root.ZoneVariants?.pick?.(anchor)?.id
        || root.ZoneVariants?.forKind(anchor.kind)?.[0]?.id;
      const identity = anchor.key != null ? `${anchor.kind}|${anchor.key}`
        : anchor.id != null ? `${anchor.kind}|${anchor.id}`
          : Number.isFinite(anchor.gx) && Number.isFinite(anchor.gy)
            ? `${anchor.kind}|${anchor.gx}|${anchor.gy}`
            : `${anchor.kind}|cell:${coverage.indexOf(slot)}`;
      return { key: `zone:${identity}`, profile: variantProfile(variant, anchor.kind), type, zoneSlot: slot, variant };
    }
    if (owner === 'road') {
      // Marks name the winning road profile. The full corridor reserves gaps
      // between marks too, so consult nearby marks without falling back to land.
      const marks = entry.streetMarks || entry.streetDress?.marks, N = entry.cellsPerEdge;
      const codes = entry.streetAreaVariants || entry.streetArea?.variants;
      let row = root.StreetVariants?.variantByCode(codes ? codes[index] : marks?.[index]);
      if (!codes && !row && marks) {
        const cx = index % N, cy = Math.floor(index / N);
        let distance = Infinity;
        for (let y = Math.max(0, cy - 12); y <= Math.min(N - 1, cy + 12); y++) {
          for (let x = Math.max(0, cx - 12); x <= Math.min(N - 1, cx + 12); x++) {
            const candidate = root.StreetVariants.variantByCode(marks[y * N + x]);
            const d = (x - cx) ** 2 + (y - cy) ** 2;
            if (candidate && d < distance) { distance = d; row = candidate; }
          }
        }
      }
      return { key: row ? `street:${row.id}` : null, profile: row ? roadProfile(row.id) : null,
        type, variant: row?.id };
    }
    if (owner) return { key: null, profile: null, type };
    const beach = !!entry.scenic?.shore?.mask?.[index];
    const profile = beach ? shoreProfile(type) : landProfile(type);
    return { key: profile ? `land:${root.WorldGen.T[nameOf(type)]}${beach ? ':shore' : ''}` : null,
      profile, type, beach };
  }
  function legacyFaunaRows(profile) { return profile?.fauna || []; }
  function legacyPickFauna(profile, id) { return pick(legacyFaunaRows(profile), unit(id + ':fauna'), row => row.weight)?.kind || null; }
  function faunaBudget(profile, id) {
    const range = profile?.faunaBudget;
    const count = range ? range[0] + Math.floor(unit(id + ':fauna-count') * (range[1] - range[0] + 1)) : 0;
    return profile?.owner === 'road' ? faunaCount(count) : count;
  }
  function allows(kind, type, profile) {
    const name = nameOf(type);
    if (kind === 'cat' && name === 'WASTELAND') return false;
    if (kind === 'deer') return name === 'FOREST' || name === 'RESIDENTIAL';
    if (kind === 'butterfly' && (name === 'FOREST' || name === 'ORCHARD')) return false;
    // Crows are the open country's corvid (GRASS; a park is always a Nexus,
    // so the grove profiles carry them there); ravens are the houses'.
    if (kind === 'crow') return name === 'GRASS' || name === 'PARK' || name === 'GROVE'
      || ((profile?.owner === 'road' || (profile?.owner === 'zone' && profile.kind === 'grove'))
        && faunaRows(profile).some(row => row.kind === kind));
    if (kind === 'raven') return name === 'RESIDENTIAL';
    return root.BiomeProfiles?.faunaAllows(kind, type) ?? true;
  }
  function legacyEnemyRows(profile, type, context) {
    if (!profile || profile.owner === 'road' && !profile.habitatEnemies) return [];
    if (profile.owner === 'road') return root.EnemyRoster.ROWS.filter(row => profile.habitatEnemies.kinds.includes(row.id));
    const family = profile.owner === 'zone' ? root.EnemyHabitats?.SURFACE_FAMILIES[profile.id] : null;
    let eligible = root.EnemyRoster.ROWS.filter(row => !row.retired && !row.signatureOnly && row.surface && row.tier <= 3
      && row.attackType !== 'touch' && (family ? family.includes(row.id)
        : profile.owner === 'land' && row.surface.biomes.includes(nameOf(type))));
    if (!family) {
      eligible = eligible.filter(row => !['giant_crab', 'jellyfish'].includes(row.id) || context?.beach);
      if (context?.beach) eligible = eligible.filter(row => ['giant_crab', 'jellyfish'].includes(row.id));
    }
    const replaced = new Set(eligible.filter(row => row.variantType === 'Tint' && row.surface.replaceBase !== false).map(row => row.variantOf));
    return eligible.filter(row => !replaced.has(row.id));
  }
  // A land row's draw weight on this biome: its surface `weightByBiome`
  // entry for the biome when it has one (the thief, heavier on RESIDENTIAL
  // ground than on COMMERCIAL), else its plain `weight`.
  function surfaceWeight(row, type) {
    return row.surface.weightByBiome?.[nameOf(type)] ?? row.surface.weight;
  }
  function legacyEnemyKind(profile, id, type, context) {
    const rows = legacyEnemyRows(profile, type, context), weights = profile?.enemyTierWeights || root.EnemyRoster.SURFACE_TIERS.at(-1).tierWeights;
    const tiers = [...new Set(rows.map(row => row.tier))];
    const tier = pick(tiers, unit(id + ':tier'), value => weights[value] || 0);
    const family = profile?.owner === 'zone';
    return pick(rows.filter(row => row.tier === tier), unit(id + ':enemy'),
      row => family ? row.surface.weight || 1 : surfaceWeight(row, type))?.id || null;
  }
  // Allocate counts from the raw habitat footprint. A restricted hole changes
  // the available seats, never this apportionment; rounding preserves the cap.
  function allocate(groups, budget, field) {
    const total = groups.reduce((sum, group) => sum + group.cells.length, 0);
    if (!total) return;
    let assigned = 0;
    const remainders = groups.map(group => {
      const exact = budget * group.cells.length / total;
      group[field] = Math.floor(exact); assigned += group[field];
      return { group, fraction: exact - group[field] };
    }).sort((a, b) => b.fraction - a.fraction || keyOrder(a.group.key, b.group.key));
    for (let i = 0; i < budget - assigned; i++) remainders[i].group[field]++;
  }
  function keyOrder(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function counts(requested = 0) { return { requested, placed: 0, shortfall: requested }; }
  // No save, Home, time or mode reads here: reserve the generated world first,
  // then let callers overlay their own captures, defeats and visibility.
  function* legacyPopulationSteps(scene, entry, tx, ty, opts = {}) {
    const WG = root.WorldGen, N = opts.N || entry.cellsPerEdge;
    const grid = opts.grid || entry.baseGrid || entry.grid;
    const cellM = opts.cellM || entry.tileEdgeM / N || scene.cellM;
    const tileM = entry.tileEdgeM || scene.tileEdgeM || N * cellM;
    const spawnOpts = opts.spawnOpts || WG.spawnOptsOf(entry);
    const occupied = spawnOpts.occupied || new Set();
    spawnOpts.occupied = occupied;
    const guardCells = opts.guardCells || new Set(), reserved = new Set();
    const faunaSeats = faunaSpacing(N);
    spawnOpts.creatureCells = reserved;
    const groupsByKey = new Map(), habitatOf = new Array(N * N);
    for (let i = 0; i < N * N; i++) {
      if ((i & 4095) === 0) yield 'spawn habitat coverage';
      const habitat = resolve(entry, i);
      habitatOf[i] = habitat;
      if (!habitat.profile || !habitat.key) continue;
      if (!groupsByKey.has(habitat.key)) groupsByKey.set(habitat.key, {
        key: habitat.key, profile: habitat.profile, type: habitat.type,
        zoneSlot: habitat.zoneSlot, beach: habitat.beach, cells: [], pools: new Map(), faunaRequested: 0, enemyRequested: 0,
      });
      groupsByKey.get(habitat.key).cells.push(i);
    }
    const groups = [...groupsByKey.values()].sort((a, b) => keyOrder(a.key, b.key));
    const ordinary = groups.filter(group => group.profile.owner === 'land');
    // Synthetic previews cover less area than a map tile. Scale their tile
    // budgets before placement; live scenes retain the full budget by default.
    const areaScale = scene.habitatTileAreaScale ?? 1;
    const budget = count => Math.round(count * areaScale);
    allocate(ordinary.filter(group => legacyFaunaRows(group.profile).length), budget(FAUNA_PER_TILE), 'faunaRequested');
    const armed = ordinary.filter(group => legacyEnemyRows(group.profile, group.type, { beach: group.beach }).length);
    allocate(armed, budget(ENEMIES_PER_TILE), 'enemyRequested');
    for (const group of groups) group.enemyReserve = 0;
    allocate(armed, budget(reserveBudget()), 'enemyReserve');
    for (const group of groups) {
      if (group.profile.owner === 'road') group.enemyRequested = group.profile.habitatEnemies?.count || 0;
      if (group.profile.owner !== 'land') group.faunaRequested = faunaBudget(group.profile, `${tx}|${ty}|${group.key}`);
      group.diagnostic = { key: group.key, profile: group.profile.id, rawCells: group.cells.length,
        fauna: counts(group.faunaRequested), enemies: counts(group.enemyRequested), reserve: counts(group.enemyReserve) };
      group.legacy = Array.from({ length: group.enemyRequested }, () => []);
      group.authoredFauna = new Map();
    }
    // Authored inhabitants can satisfy matching slots in their own Nexus
    // population. Other species and other owners never consume those slots.
    const frame = WG.tileFrame(entry, tx, ty, scene.tileEdgeM || tileM), authoredIds = new Set();
    for (const creature of opts.authoredCreatures || []) {
      if (creature.id && authoredIds.has(creature.id)) continue;
      if (creature.id) authoredIds.add(creature.id);
      const index = frame.idxOf(creature.x, creature.y);
      if (index < 0) continue;
      reserved.add(index);
      faunaSeats.add(index);
      const group = groupsByKey.get(habitatOf[index]?.key);
      if (group?.profile.owner !== 'zone'
          || !legacyFaunaRows(group.profile).some(row => row.kind === creature.kind)
          || !allows(creature.kind, grid[index], group.profile)) continue;
      group.authoredFauna.set(creature.kind, (group.authoredFauna.get(creature.kind) || 0) + 1);
    }
    // Carry old cell-based defeats onto stable habitat slots. Alias assignment
    // uses requested ordinals, so a placement hole cannot move a saved defeat.
    const legacyOrdinals = new Map(), legacyIds = new Set();
    for (const legacy of opts.legacyEnemies || []) {
      const group = groupsByKey.get(legacy.key);
      if (!group?.enemyRequested || !legacy.id || legacyIds.has(legacy.id)) continue;
      legacyIds.add(legacy.id);
      const ordinal = legacyOrdinals.get(group.key) || 0;
      group.legacy[ordinal % group.enemyRequested].push(legacy.id);
      legacyOrdinals.set(group.key, ordinal + 1);
    }
    const out = [], speciesOrdinals = new Map();
    let attempts = 0;
    const isAquatic = kind => !!root.EnemyRoster.get(kind)?.movement?.waterOnly;
    const classOf = kind => root.creatureSpawnClass(kind);
    function optionsFor(group, fauna, waterOnly = false, extraOccupied) {
      return { ...spawnOpts, occupied: extraOccupied || (fauna ? null : occupied),
        ...(group.zoneSlot ? { zoneSlot: group.zoneSlot } : {}), ...(waterOnly ? { waterOnly: true } : {}) };
    }
    function sameOwner(group, index, aquatic) {
      if (index < 0 || index >= N * N) return false;
      if (habitatOf[index]?.key === group.key) return true;
      // Water-edge seats inherit the ordinary shore candidate's habitat; an
      // unowned water cell has no land population of its own to spill into.
      return aquatic && group.profile.owner === 'land' && grid[index] === WG.T.WATER
        && !WG.variantOwnerAt(entry, index);
    }
    function* poolFor(group, kind, fauna) {
      const cacheKey = `${fauna ? 'fauna' : 'enemy'}:${kind}`;
      if (group.pools.has(cacheKey)) return group.pools.get(cacheKey);
      const pool = [], aquatic = isAquatic(kind), cls = classOf(kind);
      const seen = new Set(), waterOccupied = aquatic ? new Set(fauna ? guardCells : [...occupied, ...guardCells]) : null;
      const seatOpts = optionsFor(group, fauna, aquatic, waterOccupied);
      for (let n = 0; n < group.cells.length; n++) {
        if ((n & 4095) === 0) yield 'spawn habitat eligible seats';
        const i = group.cells[n], cx = i % N, cy = Math.floor(i / N);
        if (!aquatic) {
          if (guardCells.has(i) || (fauna && !allows(kind, grid[i], group.profile))) continue;
          if (WG.isSpawnCell(grid, N, N, cx, cy, seatOpts, cls)) pool.push(i);
          continue;
        }
        // Enumerate every reachable edge seat rather than caching only the
        // nearest water cell. Repeated dry candidates share this deduped pool.
        let seat;
        while ((seat = root.EnemyHabitats.surfaceSeat(entry, cx, cy, kind, seatOpts))) {
          const index = seat.cy * N + seat.cx;
          if (!seen.has(index) && !guardCells.has(index) && sameOwner(group, index, true)
              && WG.isSpawnCell(grid, N, N, seat.cx, seat.cy, seatOpts, cls)) pool.push(index);
          seen.add(index); waterOccupied.add(index);
        }
      }
      group.pools.set(cacheKey, pool);
      return pool;
    }
    function* seatFor(group, kind, id, fauna) {
      const pool = yield* poolFor(group, kind, fauna);
      if (!pool.length) return null;
      const start = Math.floor(unit(id + ':seat') * pool.length), aquatic = isAquatic(kind);
      const seatOpts = optionsFor(group, fauna, aquatic), cls = classOf(kind);
      let best = null, bestClearance = -1;
      for (let n = 0; n < pool.length; n++) {
        if ((n & 4095) === 4095) yield 'spawn habitat seat search';
        const index = pool[(start + n) % pool.length];
        if (reserved.has(index) || guardCells.has(index) || !sameOwner(group, index, aquatic)) continue;
        const cx = index % N, cy = Math.floor(index / N);
        if (!WG.isSpawnCell(grid, N, N, cx, cy, seatOpts, cls)) continue;
        const clearance = fauna ? faunaSeats.clearance(index) : FAUNA_SPACING_CELLS;
        if (clearance > bestClearance) { best = { index, cx, cy }; bestClearance = clearance; }
        if (clearance >= FAUNA_SPACING_CELLS) break;
      }
      if (!best) return null;
      // Keep the budget on constrained ground, choosing the least crowded
      // legal seat only after exhausting the well-spaced alternatives.
      const { index, cx, cy } = best;
      reserved.add(index);
      occupied.add(index);
      if (fauna) faunaSeats.add(index);
      return { cx, cy, x: tx * tileM + (cx + .5) * cellM, y: ty * tileM + (cy + .5) * cellM };
    }
    for (const group of groups) {
      for (let n = 0; n < group.faunaRequested; n++) {
        if ((attempts++ & 31) === 0) yield 'spawn habitat population';
        const seed = `${tx}|${ty}|${group.key}|fauna|${n}`;
        const kind = legacyPickFauna(group.profile, seed);
        if (!kind) continue;
        const ordinal = speciesOrdinals.get(kind) || 0;
        speciesOrdinals.set(kind, ordinal + 1);
        const authored = group.authoredFauna.get(kind) || 0;
        if (authored) {
          group.authoredFauna.set(kind, authored - 1);
          group.diagnostic.fauna.authored = (group.diagnostic.fauna.authored || 0) + 1;
          group.diagnostic.fauna.placed++;
          continue;
        }
        const id = `${kind}_${tx}_${ty}_${ordinal}`, seat = yield* seatFor(group, kind, id, true);
        if (!seat) continue;
        const point = { key: group.key, profile: group.profile.id, tx, ty, ...seat };
        const surfaceEnemy = !!root.EnemyRoster.get(kind)?.surface && !!root.Combat?.isEnemyKind(kind);
        out.push(WG.makeCreature(kind, seat.x, seat.y, id, {
          shiny: typeof faunaShiny === 'function' ? faunaShiny(kind, id) : false,
          ...(group.profile.owner === 'zone' ? { zoneVariant: group.profile.id } : {}),
          _habitatSpawn: point,
          ...(surfaceEnemy ? { _surfaceSpawn: { tx, ty, ...seat },
            ...root.EnemySpawns.concealment(kind, id, group.profile.id) } : {}),
        }));
        group.diagnostic.fauna.placed++;
      }
      for (let n = 0; n < group.enemyRequested; n++) {
        if ((attempts++ & 31) === 0) yield 'spawn habitat population';
        const id = `enemy_habitat_${tx}_${ty}_${encodeURIComponent(group.key)}_${n}`;
        const baseKind = legacyEnemyKind(group.profile, id, group.type, { beach: group.beach });
        const kind = typeof Weather !== 'undefined' ? Weather.enemyBirthKind(baseKind, id, scene) : baseKind;
        if (!kind) continue;
        const seat = yield* seatFor(group, kind, id, false);
        if (!seat) continue;
        const point = { key: group.key, profile: group.profile.id, tx, ty, ...seat };
        out.push(WG.makeCreature(kind, seat.x, seat.y, id, {
          shiny: false, ...root.EnemySpawns.concealment(kind, id, group.profile.id),
          _habitatSpawn: point, _surfaceSpawn: { tx, ty, ...seat },
          ...(group.legacy[n].length ? { _legacyDefeatIds: group.legacy[n] } : {}),
        }));
        group.diagnostic.enemies.placed++;
      }
    }
    // The mode reserve seats last, so the base population above is identical
    // whatever its size.
    for (const group of groups) {
      for (let n = 0; n < group.enemyReserve; n++) {
        if ((attempts++ & 31) === 0) yield 'spawn habitat reserve';
        const id = `enemy_habitat_${tx}_${ty}_${encodeURIComponent(group.key)}_r${n}`;
        const baseKind = legacyEnemyKind(group.profile, id, group.type, { beach: group.beach });
        const kind = typeof Weather !== 'undefined' ? Weather.enemyBirthKind(baseKind, id, scene) : baseKind;
        if (!kind) continue;
        const seat = yield* seatFor(group, kind, id, false);
        if (!seat) continue;
        const point = { key: group.key, profile: group.profile.id, tx, ty, ...seat };
        out.push(WG.makeCreature(kind, seat.x, seat.y, id, {
          shiny: false, ...root.EnemySpawns.concealment(kind, id, group.profile.id),
          _habitatSpawn: point, _surfaceSpawn: { tx, ty, ...seat }, _landEnemyReserve: true,
        }));
        group.diagnostic.reserve.placed++;
      }
    }
    const totals = { fauna: counts(), enemies: counts(), reserve: counts() };
    for (const group of groups) for (const population of ['fauna', 'enemies', 'reserve']) {
      const row = group.diagnostic[population];
      row.shortfall = row.requested - row.placed;
      for (const field of ['requested', 'placed', 'shortfall']) totals[population][field] += row[field];
      if (row.authored) totals[population].authored = (totals[population].authored || 0) + row.authored;
    }
    entry.habitatPopulation = { regions: groups.map(group => group.diagnostic), totals,
      faunaRequested: totals.fauna.requested, enemyRequested: totals.enemies.requested };
    return out;
  }
  // Candidates per 1,000 eligible cells, one independent row per species.
  // No tile allowance or normalization against other owners.
  // Approved zone tuning: explicit rates are expected individuals per 1,000
  // eligible cells. Rare signatures are already final rates, not multipliers.
  const DENSITY_ROWS = Object.freeze({
    "Terrain:GRASS": Object.freeze([{"kind":"chicken","category":"fauna","per1000":3.195652173913043},{"kind":"cow","category":"fauna","per1000":2.556521739130435},{"kind":"butterfly","category":"fauna","per1000":2.556521739130435},{"kind":"rabbit","category":"fauna","per1000":1.9173913043478261},{"kind":"crow","category":"fauna","per1000":1.2782608695652176},{"kind":"horse","category":"fauna","per1000":0.2556521739130435},{"kind":"slime","category":"enemy","per1000":0.9527777777777778,"signature":true},{"kind":"snake","category":"enemy","per1000":0.19055555555555556},{"kind":"plant","category":"enemy","per1000":2.2866666666666666},{"kind":"sheep","category":"fauna","per1000":2}]),
    "Terrain:RESIDENTIAL": Object.freeze([{"kind":"cat","category":"fauna","per1000":2.52},{"kind":"dog","category":"fauna","per1000":2.52},{"kind":"chicken","category":"fauna","per1000":1.8900000000000001},{"kind":"deer","category":"fauna","per1000":1.26},{"kind":"cow","category":"fauna","per1000":0.315},{"kind":"raven","category":"fauna","per1000":0.315},{"kind":"zombie","category":"enemy","per1000":0.6125},{"kind":"thief","category":"enemy","per1000":0.6125,"signature":true},{"kind":"ogre","category":"enemy","per1000":1.225}]),
    "Terrain:FOREST": Object.freeze([{"kind":"deer","category":"fauna","per1000":7.056000000000001},{"kind":"rabbit","category":"fauna","per1000":3.5280000000000005},{"kind":"dog","category":"fauna","per1000":1.1760000000000002},{"kind":"spider","category":"enemy","per1000":0.588},{"kind":"plant","category":"enemy","per1000":2.352},{"kind":"boar","category":"enemy","per1000":0.588,"signature":true},{"kind":"giant_bear","category":"enemy","per1000":2.352}]),
    "Terrain:FARMLAND": Object.freeze([{"kind":"chicken","category":"fauna","per1000":6.300000000000001},{"kind":"cow","category":"fauna","per1000":5.25},{"kind":"rabbit","category":"fauna","per1000":2.1},{"kind":"horse","category":"fauna","per1000":1.05},{"kind":"snake","category":"enemy","per1000":0.6533333333333333,"signature":true},{"kind":"farmer_goblin","category":"enemy","per1000":1.3066666666666666}]),
    "Terrain:WASTELAND": Object.freeze([{"kind":"dog","category":"fauna","per1000":3.6750000000000003},{"kind":"rabbit","category":"fauna","per1000":1.4700000000000002},{"kind":"chicken","category":"fauna","per1000":0.7350000000000001},{"kind":"ash_zombie","category":"enemy","per1000":0.5,"signature":true,"time":"night"}]),
    "Terrain:PARK": Object.freeze([{"kind":"butterfly","category":"fauna","per1000":5.88},{"kind":"rabbit","category":"fauna","per1000":4.704000000000001},{"kind":"crow","category":"fauna","per1000":3.5279999999999996},{"kind":"chicken","category":"fauna","per1000":2.3520000000000003},{"kind":"cat","category":"fauna","per1000":1.1760000000000002},{"kind":"plant","category":"enemy","per1000":0.5,"signature":true}]),
    "Terrain:GROVE": Object.freeze([{"kind":"butterfly","category":"fauna","per1000":5.25},{"kind":"rabbit","category":"fauna","per1000":4.2},{"kind":"crow","category":"fauna","per1000":3.1500000000000004},{"kind":"chicken","category":"fauna","per1000":2.1},{"kind":"treant","category":"enemy","per1000":0.5,"signature":true}]),
    "Terrain:WETLAND": Object.freeze([{"kind":"butterfly","category":"fauna","per1000":5.88},{"kind":"rabbit","category":"fauna","per1000":1.96},{"kind":"dog","category":"fauna","per1000":0.98},{"kind":"slime","category":"enemy","per1000":0.735},{"kind":"spider","category":"enemy","per1000":0.294},{"kind":"snake","category":"enemy","per1000":0.147},{"kind":"zombie","category":"enemy","per1000":2.352},{"kind":"golden_slime","category":"enemy","per1000":2.352,"signature":true},{"kind":"pig","category":"fauna","per1000":2}]),
    "Terrain:ORCHARD": Object.freeze([{"kind":"chicken","category":"fauna","per1000":7.3500000000000005},{"kind":"rabbit","category":"fauna","per1000":5.5125},{"kind":"dog","category":"fauna","per1000":1.8375000000000001},{"kind":"farmer_goblin","category":"enemy","per1000":2.9399999999999995,"signature":true}]),
    "Terrain:ROCK": Object.freeze([{"kind":"rabbit","category":"fauna","per1000":2.646},{"kind":"dog","category":"fauna","per1000":1.7639999999999998},{"kind":"skeleton","category":"enemy","per1000":3.43},{"kind":"skeleton_soldier","category":"enemy","per1000":3.43,"signature":true}]),
    "Terrain:SAND": Object.freeze([{"kind":"rabbit","category":"fauna","per1000":2.94},{"kind":"dog","category":"fauna","per1000":1.47},{"kind":"giant_crab","category":"enemy","per1000":0.5,"signature":true}]),
    "Terrain:SCHOOL": Object.freeze([{"kind":"chicken","category":"fauna","per1000":3.5280000000000005},{"kind":"butterfly","category":"fauna","per1000":3.5280000000000005},{"kind":"cat","category":"fauna","per1000":2.3520000000000003},{"kind":"rabbit","category":"fauna","per1000":2.3520000000000003},{"kind":"goblin_runt","category":"enemy","per1000":0.5,"signature":true}]),
    "Terrain:COMMERCIAL": Object.freeze([{"kind":"cat","category":"fauna","per1000":3.3600000000000003},{"kind":"dog","category":"fauna","per1000":2.5200000000000005},{"kind":"goblin","category":"enemy","per1000":0.5880000000000001,"signature":true},{"kind":"goblin_archer","category":"enemy","per1000":0.196},{"kind":"thief","category":"enemy","per1000":0.49000000000000005},{"kind":"club_goblin","category":"enemy","per1000":0.49000000000000005},{"kind":"sword_spirit","category":"enemy","per1000":0.196}]),
    "Terrain:INDUSTRIAL": Object.freeze([{"kind":"dog","category":"fauna","per1000":3.5279999999999996},{"kind":"rabbit","category":"fauna","per1000":0.8819999999999999},{"kind":"zombie","category":"enemy","per1000":2.45},{"kind":"marsh_zombie","category":"enemy","per1000":1.6333333333333335,"signature":true,"time":"night"},{"kind":"ash_zombie","category":"enemy","per1000":0.8166666666666668}]),
    "Terrain:PLAYGROUND": Object.freeze([{"kind":"butterfly","category":"fauna","per1000":7.3500000000000005},{"kind":"rabbit","category":"fauna","per1000":5.5125},{"kind":"cat","category":"fauna","per1000":1.8375000000000001},{"kind":"mini_slime","category":"enemy","per1000":0.5,"signature":true}]),
    "Terrain:PITCH": Object.freeze([{"kind":"rabbit","category":"fauna","per1000":5.880000000000001},{"kind":"butterfly","category":"fauna","per1000":4.41},{"kind":"cow","category":"fauna","per1000":1.4700000000000002},{"kind":"goblin_runt","category":"enemy","per1000":0.5,"signature":true}]),
    "Terrain:CHURCHYARD": Object.freeze([{"kind":"rabbit","category":"fauna","per1000":4.41},{"kind":"cat","category":"fauna","per1000":1.4700000000000002},{"kind":"ghost","category":"enemy","per1000":0.5,"signature":true,"time":"night"}]),
    "Terrain:TAR_YARD": Object.freeze([{"kind":"dog","category":"fauna","per1000":3.3075},{"kind":"rabbit","category":"fauna","per1000":1.1025},{"kind":"fire_slime","category":"enemy","per1000":0.5,"signature":true}]),
    "Nexus:meadow": Object.freeze([{"kind":"rabbit","category":"fauna","per1000":8.25},{"kind":"butterfly","category":"fauna","per1000":8.25},{"kind":"slime","category":"enemy","per1000":6.041666666666667,"signature":true},{"kind":"plant","category":"enemy","per1000":6.041666666666667}]),
    "Nexus:mushroom_grove": Object.freeze([{"kind":"crow","category":"fauna","per1000":9.9},{"kind":"butterfly","category":"fauna","per1000":6.6000000000000005},{"kind":"mushroom_monster","category":"enemy","per1000":33.333333333333336,"signature":true}]),
    "Nexus:orchard": Object.freeze([{"kind":"chicken","category":"fauna","per1000":12.375},{"kind":"dog","category":"fauna","per1000":4.125},{"kind":"farmer_goblin","category":"enemy","per1000":6.041666666666667,"signature":true},{"kind":"club_goblin","category":"enemy","per1000":6.041666666666667}]),
    "Nexus:formal_garden": Object.freeze([{"kind":"butterfly","category":"fauna","per1000":13.200000000000001},{"kind":"cat","category":"fauna","per1000":3.3000000000000003},{"kind":"slime","category":"enemy","per1000":6.041666666666667},{"kind":"plant","category":"enemy","per1000":6.041666666666667,"signature":true}]),
    "Nexus:hedge_garden": Object.freeze([{"kind":"rabbit","category":"fauna","per1000":13.200000000000001},{"kind":"cat","category":"fauna","per1000":3.3000000000000003},{"kind":"plant","category":"enemy","per1000":6.041666666666667},{"kind":"spider","category":"enemy","per1000":6.041666666666667,"signature":true}]),
    "Nexus:ancient_grove": Object.freeze([{"kind":"crow","category":"fauna","per1000":16.5},{"kind":"treant","category":"enemy","per1000":4.027777777777778,"signature":true},{"kind":"spider","category":"enemy","per1000":4.027777777777778},{"kind":"giant_bear","category":"enemy","per1000":4.027777777777778}]),
    "Nexus:sacred_grove": Object.freeze([{"kind":"butterfly","category":"fauna","per1000":16.5},{"kind":"dryad","category":"enemy","per1000":0.5,"signature":true}]),
    "Nexus:stone_garden": Object.freeze([{"kind":"cat","category":"fauna","per1000":16.5},{"kind":"slime","category":"enemy","per1000":6.041666666666667},{"kind":"skeleton","category":"enemy","per1000":6.041666666666667,"signature":true}]),
    "Nexus:ordered_graves": Object.freeze([{"kind":"cat","category":"fauna","per1000":16.5},{"kind":"zombie","category":"enemy","per1000":4.027777777777778},{"kind":"skeleton","category":"enemy","per1000":4.027777777777778},{"kind":"skeleton_soldier","category":"enemy","per1000":4.027777777777778,"signature":true}]),
    "Nexus:overgrown_graves": Object.freeze([{"kind":"butterfly","category":"fauna","per1000":16.5},{"kind":"zombie","category":"enemy","per1000":4.027777777777778,"signature":true,"time":"night"},{"kind":"spider","category":"enemy","per1000":4.027777777777778},{"kind":"skeleton","category":"enemy","per1000":4.027777777777778}]),
    "Nexus:broken_masonry": Object.freeze([{"kind":"dog","category":"fauna","per1000":16.5},{"kind":"club_goblin","category":"enemy","per1000":12.083333333333334,"signature":true}]),
    "Nexus:silent_circle": Object.freeze([{"kind":"cat","category":"fauna","per1000":16.5},{"kind":"skeleton","category":"enemy","per1000":6.041666666666667,"signature":true},{"kind":"skeleton_soldier","category":"enemy","per1000":6.041666666666667}]),
    "Nexus:flint_field": Object.freeze([{"kind":"dog","category":"fauna","per1000":16.5},{"kind":"club_goblin","category":"enemy","per1000":12.083333333333334,"signature":true}]),
    "Nexus:broken_depot": Object.freeze([{"kind":"dog","category":"fauna","per1000":16.5},{"kind":"skeleton","category":"enemy","per1000":6.041666666666667,"signature":true},{"kind":"club_goblin","category":"enemy","per1000":6.041666666666667}]),
    "Nexus:seep": Object.freeze([{"kind":"butterfly","category":"fauna","per1000":16.5},{"kind":"slime","category":"enemy","per1000":4.027777777777778},{"kind":"plant","category":"enemy","per1000":4.027777777777778},{"kind":"golden_slime","category":"enemy","per1000":4.027777777777778,"signature":true}]),
    "Nexus:work_yard": Object.freeze([{"kind":"dog","category":"fauna","per1000":12.375},{"kind":"chicken","category":"fauna","per1000":4.125},{"kind":"club_goblin","category":"enemy","per1000":12.083333333333334,"signature":true}]),
    "Nexus:black_ring": Object.freeze([{"kind":"dog","category":"fauna","per1000":16.5},{"kind":"skeleton","category":"enemy","per1000":6.041666666666667},{"kind":"skeleton_soldier","category":"enemy","per1000":6.041666666666667,"signature":true}]),
    "Nexus:quarry-abandoned": Object.freeze([{"kind":"rabbit","category":"fauna","per1000":9.0},{"kind":"cave_slime","category":"enemy","per1000":0.5,"signature":true}]),
    "Nexus:quarry-strip-mine": Object.freeze([{"kind":"dog","category":"fauna","per1000":9.0},{"kind":"goblin","category":"enemy","per1000":0.5,"signature":true},{"kind":"horned_sheep","category":"enemy","per1000":3}]),
    "Nexus:quarry-stronghold": Object.freeze([{"kind":"dog","category":"fauna","per1000":9.0},{"kind":"spear_goblin","category":"enemy","per1000":0.5,"signature":true}]),
    "Nexus:spooky_woods": Object.freeze([{"kind":"crow","category":"fauna","per1000":16.5}]),
    "Roads and paths:hedgerow": Object.freeze([{"kind":"rabbit","category":"fauna","per1000":7.5}]),
    "Roads and paths:overgrown": Object.freeze([{"kind":"rabbit","category":"fauna","per1000":7.5},{"kind":"butterfly","category":"fauna","per1000":7.5}]),
    "Roads and paths:orchard": Object.freeze([{"kind":"rabbit","category":"fauna","per1000":7.5}]),
    "Roads and paths:pilgrim": Object.freeze([{"kind":"crow","category":"fauna","per1000":7.5},{"kind":"sword_spirit","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:toadstool": Object.freeze([{"kind":"butterfly","category":"fauna","per1000":7.5},{"kind":"mushroom_monster","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:berry": Object.freeze([{"kind":"rabbit","category":"fauna","per1000":7.5}]),
    "Nexus:pirate_cove": Object.freeze([{"kind":"pirate_grunt","category":"enemy","per1000":12.083333333333334,"signature":true}]),
    "Nexus:mystic_reef": Object.freeze([{"kind":"giant_crab","category":"enemy","per1000":6.041666666666667},{"kind":"jellyfish","category":"enemy","per1000":6.041666666666667,"signature":true}]),
    "Nexus:shellwater_strand": Object.freeze([{"kind":"giant_crab","category":"enemy","per1000":6.041666666666667,"signature":true},{"kind":"jellyfish","category":"enemy","per1000":6.041666666666667}]),
    "Terrain:ROCKY_GROUND": Object.freeze([{"kind":"sand_skeleton","category":"enemy","per1000":0.5,"signature":true}]),
    "Terrain:GOLF": Object.freeze([{"kind":"slime","category":"enemy","per1000":0.5,"signature":true}]),
    "Terrain:WATER": Object.freeze([{"kind":"jellyfish","category":"enemy","per1000":0.5,"signature":true}]),
    "Terrain:PIER": Object.freeze([{"kind":"pirate_grunt","category":"enemy","per1000":0.5,"signature":true}]),
    "Park character:park_character_meadow": Object.freeze([{"kind":"slime","category":"enemy","per1000":0.5,"signature":true}]),
    "Park character:park_character_wooded": Object.freeze([{"kind":"boar","category":"enemy","per1000":0.5,"signature":true}]),
    "Park character:park_character_formal": Object.freeze([{"kind":"plant","category":"enemy","per1000":0.5,"signature":true}]),
    "Park character:park_character_common": Object.freeze([{"kind":"goblin_runt","category":"enemy","per1000":0.5,"signature":true}]),
    "Nexus:marine_meadow": Object.freeze([{"kind":"crab","category":"enemy","per1000":0.5,"signature":true}]),
    "Nexus:quarry-crater": Object.freeze([{"kind":"wurm","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:lantern": Object.freeze([{"kind":"ghost","category":"enemy","per1000":0.5,"signature":true,"time":"night"}]),
    "Roads and paths:barricade": Object.freeze([{"kind":"spear_goblin","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:greenway": Object.freeze([{"kind":"moss_slime","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:parkpath": Object.freeze([{"kind":"plant","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:snare": Object.freeze([{"kind":"goblin_trapper","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:thorny": Object.freeze([{"kind":"plant","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:golden_path": Object.freeze([{"kind":"golden_slime","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:slime_trail": Object.freeze([{"kind":"split_slime","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:poison_path": Object.freeze([{"kind":"purple_slime","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:fire_path": Object.freeze([{"kind":"fire_slime","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:paralysis_path": Object.freeze([{"kind":"spider","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:confusion_path": Object.freeze([{"kind":"pink_ghost","category":"enemy","per1000":0.5,"signature":true,"time":"night"}]),
    "Roads and paths:pottery": Object.freeze([{"kind":"snake","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:trade": Object.freeze([{"kind":"thief","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:rocky_path": Object.freeze([{"kind":"sand_skeleton","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:grassy_lane": Object.freeze([{"kind":"snake","category":"enemy","per1000":0.5,"signature":true}]),
    "Roads and paths:old_growth_path": Object.freeze([{"kind":"treant","category":"enemy","per1000":0.5,"signature":true},{"kind":"owlbear","category":"enemy","per1000":0.5}]),
    "Roads and paths:haunted_forest_path": Object.freeze([{"kind":"ghost","category":"enemy","per1000":0.5,"signature":true,"time":"night"}]),
    "Roads and paths:causeway": Object.freeze([{"kind":"giant_crab","category":"enemy","per1000":0.5,"signature":true}]),
  });
  const SIGNATURE_ENEMIES = Object.freeze({"Terrain:GRASS":{"kind":"slime","owned":false},"Terrain:RESIDENTIAL":{"kind":"thief","owned":false},"Terrain:FOREST":{"kind":"boar","owned":false},"Terrain:FARMLAND":{"kind":"snake","owned":false},"Terrain:WASTELAND":{"kind":"ash_zombie","owned":false},"Terrain:PARK":{"kind":"plant","owned":false},"Terrain:GROVE":{"kind":"treant","owned":false},"Terrain:WETLAND":{"kind":"golden_slime","owned":false},"Terrain:ORCHARD":{"kind":"farmer_goblin","owned":false},"Terrain:ROCK":{"kind":"skeleton_soldier","owned":false},"Terrain:ROCKY_GROUND":{"kind":"sand_skeleton","owned":false},"Terrain:SAND":{"kind":"giant_crab","owned":false},"Terrain:SCHOOL":{"kind":"goblin_runt","owned":false},"Terrain:COMMERCIAL":{"kind":"goblin","owned":false},"Terrain:INDUSTRIAL":{"kind":"marsh_zombie","owned":false},"Terrain:PLAYGROUND":{"kind":"mini_slime","owned":false},"Terrain:PITCH":{"kind":"goblin_runt","owned":false},"Terrain:CHURCHYARD":{"kind":"ghost","owned":false},"Terrain:TAR_YARD":{"kind":"fire_slime","owned":false},"Terrain:GOLF":{"kind":"slime","owned":false},"Terrain:WATER":{"kind":"jellyfish","owned":false},"Terrain:PIER":{"kind":"pirate_grunt","owned":false},"Park character:park_character_meadow":{"kind":"slime","owned":false},"Park character:park_character_wooded":{"kind":"boar","owned":false},"Park character:park_character_formal":{"kind":"plant","owned":false},"Park character:park_character_common":{"kind":"goblin_runt","owned":false},"Nexus:meadow":{"kind":"slime","owned":false},"Nexus:marine_meadow":{"kind":"crab","owned":false},"Nexus:mushroom_grove":{"kind":"mushroom_monster","owned":false},"Nexus:orchard":{"kind":"farmer_goblin","owned":false},"Nexus:formal_garden":{"kind":"plant","owned":false},"Nexus:hedge_garden":{"kind":"spider","owned":false},"Nexus:ancient_grove":{"kind":"treant","owned":false},"Nexus:sacred_grove":{"kind":"dryad","owned":false},"Nexus:stone_garden":{"kind":"skeleton","owned":false},"Nexus:ordered_graves":{"kind":"skeleton_soldier","owned":false},"Nexus:overgrown_graves":{"kind":"zombie","owned":false},"Nexus:broken_masonry":{"kind":"club_goblin","owned":false},"Nexus:silent_circle":{"kind":"skeleton","owned":false},"Nexus:flint_field":{"kind":"club_goblin","owned":false},"Nexus:broken_depot":{"kind":"skeleton","owned":false},"Nexus:seep":{"kind":"golden_slime","owned":false},"Nexus:work_yard":{"kind":"club_goblin","owned":false},"Nexus:black_ring":{"kind":"skeleton_soldier","owned":false},"Nexus:mystic_reef":{"kind":"jellyfish","owned":false},"Nexus:pirate_cove":{"kind":"pirate_grunt","owned":false},"Nexus:shellwater_strand":{"kind":"giant_crab","owned":false},"Nexus:quarry-crater":{"kind":"wurm","owned":false},"Nexus:quarry-abandoned":{"kind":"cave_slime","owned":false},"Nexus:quarry-strip-mine":{"kind":"goblin","owned":false},"Nexus:quarry-stronghold":{"kind":"spear_goblin","owned":false},"Nexus:spooky_woods":{"kind":"treant","owned":true},"Roads and paths:hedgerow":{"kind":"goblin_runt","owned":true},"Roads and paths:overgrown":{"kind":"boar","owned":true},"Roads and paths:orchard":{"kind":"farmer_goblin","owned":true},"Roads and paths:pilgrim":{"kind":"sword_spirit","owned":false},"Roads and paths:lantern":{"kind":"ghost","owned":false},"Roads and paths:burned":{"kind":"fire_slime","owned":true},"Roads and paths:barricade":{"kind":"spear_goblin","owned":false},"Roads and paths:toadstool":{"kind":"mushroom_monster","owned":false},"Roads and paths:promenade":{"kind":"metal_slime","owned":true},"Roads and paths:greenway":{"kind":"moss_slime","owned":false},"Roads and paths:parkpath":{"kind":"plant","owned":false},"Roads and paths:snare":{"kind":"goblin_trapper","owned":false},"Roads and paths:thorny":{"kind":"plant","owned":false},"Roads and paths:goblin_gang":{"kind":"goblin_runt","owned":true},"Roads and paths:golden_path":{"kind":"golden_slime","owned":false},"Roads and paths:slime_trail":{"kind":"split_slime","owned":false},"Roads and paths:spider_path":{"kind":"spider","owned":true},"Roads and paths:poison_path":{"kind":"purple_slime","owned":false},"Roads and paths:fire_path":{"kind":"fire_slime","owned":false},"Roads and paths:paralysis_path":{"kind":"spider","owned":false},"Roads and paths:confusion_path":{"kind":"pink_ghost","owned":false},"Roads and paths:berry":{"kind":"goblin_runt","owned":true},"Roads and paths:berry_trail":{"kind":"giant_bear","owned":true},"Roads and paths:pottery":{"kind":"snake","owned":false},"Roads and paths:trade":{"kind":"thief","owned":false},"Roads and paths:rocky_path":{"kind":"sand_skeleton","owned":false},"Roads and paths:grassy_lane":{"kind":"snake","owned":false},"Roads and paths:old_growth_path":{"kind":"treant","owned":false},"Roads and paths:haunted_forest_path":{"kind":"ghost","owned":false},"Roads and paths:way_of_variety":{"kind":"snake","owned":true},"Roads and paths:causeway":{"kind":"giant_crab","owned":false}});
  const SHORE_ENEMY_ROWS = Object.freeze([
    { kind: 'giant_crab', category: 'enemy', per1000: .98, beach: true },
  ]);
  function densityRows(owner, entry, index, shore = false) {
    const key = typeof owner === 'string' ? owner : owner?.key;
    let rows = DENSITY_ROWS[key] || [];
    // Park character replaces only the base park signature; it never adds a
    // second owner allowance, and cannot reach through Nexus/road ownership.
    if (key === 'Terrain:PARK' && entry && index != null) {
      const character = root.BiomeProfiles.PARK_CHARACTER_IDS[entry.parkCharacters?.[index] - 1];
      const replacement = character && DENSITY_ROWS['Park character:park_character_' + character];
      if (replacement) rows = rows.filter(row => !row.signature).concat(replacement);
    }
    if (key !== 'Terrain:SAND') return rows;
    // The signature applies to sand, while beach geometry adds the shoreline
    // density. Fold matching species into one roll to keep each ID unique.
    if (!(entry && index != null ? beachCell(entry, entry.baseGrid || entry.grid, entry.cellsPerEdge, index) : shore)) return rows;
    return SHORE_ENEMY_ROWS.reduce((out, shore) => {
      const match = out.findIndex(row => row.kind === shore.kind && row.category === shore.category);
      if (match < 0) return out.concat(shore);
      const copy = out.slice(); copy[match] = { ...out[match], per1000: out[match].per1000 + shore.per1000 };
      return copy;
    }, rows);
  }
  function enemyDeclaration(creature) {
    const key = creature?._spawnSource === 'zone-density' ? creature._spawnOwner
      : creature?._spawnSource === 'party-scaling' && creature._densityParent ? creature._densityOwner : null;
    if (!key) return null;
    let rows = DENSITY_ROWS[key] || [];
    if (key === 'Terrain:PARK' && creature._parkCharacter) {
      const character = root.BiomeProfiles.PARK_CHARACTER_IDS[creature._parkCharacter - 1];
      const replacement = DENSITY_ROWS['Park character:park_character_' + character];
      if (replacement) rows = rows.filter(row => !row.signature).concat(replacement);
    }
    return rows.find(row => row.category === 'enemy' && row.kind === creature.kind) || null;
  }
  // Aquatic beach rows belong to water itself, never borrow a neighbouring
  // Nexus/road table. Require an actual adjacent residual sand beach.
  function beachCell(entry, grid, N, index) {
    if (grid[index] !== root.WorldGen.T.WATER) return !!entry.scenic?.shore?.mask?.[index];
    const x=index%N,y=Math.floor(index/N);
    return [[-1,0],[1,0],[0,-1],[0,1]].some(([dx,dy])=>{
      const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=N||ny>=N)return false;
      const i=ny*N+nx;
      return grid[i]===root.WorldGen.T.SAND && entry.scenic?.shore?.mask?.[i]
        && root.SpawnPipeline.ownerAt(entry,i)?.key==='Terrain:SAND';
    });
  }
  function profileKey(profile) {
    if (!profile) return null;
    return profile.owner === 'land' ? 'Terrain:' + profile.id.split(':')[0]
      : profile.owner === 'zone' ? 'Nexus:' + profile.id : 'Roads and paths:' + profile.id;
  }
  function faunaRows(profile) {
    return densityRows(profileKey(profile)).filter(row => row.category === 'fauna')
      .map(row => ({ kind: row.kind, weight: row.per1000 }));
  }
  function pickFauna(profile, id) { return pick(faunaRows(profile), unit(id + ':fauna'), row => row.weight)?.kind || null; }
  function enemyRows(profile, type, context) {
    return densityRows(profileKey(profile), null, null, context?.beach).filter(row => row.category === 'enemy' && (!row.beach || context?.beach))
      .map(row => root.EnemyRoster.get(row.kind)).filter(Boolean);
  }
  function enemyKind(profile, id, type, context) {
    const rows = densityRows(profileKey(profile)).filter(row => row.category === 'enemy' && (!row.beach || context?.beach));
    return pick(rows, unit(id + ':enemy'), row => row.per1000)?.kind || null;
  }
  // Rates describe individuals. Grouping changes their spatial distribution,
  // not the expected population: roll fewer anchors by the mean group size.
  const PACK_PROFILE = Object.freeze({ chance: .65, min: 2, max: 4, radiusCells: 3 });
  const ENEMY_PACKS = Object.freeze(Object.fromEntries([
    'rat', 'goblin', 'goblin_archer', 'club_goblin', 'spear_goblin',
    'archer_goblin', 'goblin_trapper', 'farmer_goblin', 'bomb_goblin',
    'skeleton', 'skeleton_soldier', 'pirate_grunt', 'pirate_gunner',
  ].map(kind => [kind, PACK_PROFILE])));
  function packMean(kind) {
    const rule = ENEMY_PACKS[kind];
    return rule ? 1 - rule.chance + rule.chance * (rule.min + rule.max) / 2 : 1;
  }
  function packSize(kind, key) {
    const rule = ENEMY_PACKS[kind], roll = unit(key + '|pack-size');
    if (!rule || roll >= rule.chance) return 1;
    return rule.min + Math.min(rule.max - rule.min, Math.floor(roll / rule.chance * (rule.max - rule.min + 1)));
  }
  function packCells(kind, key, index, N, count = packSize(kind, key)) {
    if (count <= 1) return [index];
    const rule = ENEMY_PACKS[kind], cx = index % N, cy = Math.floor(index / N), nearby = [];
    for (let y = Math.max(0, cy - rule.radiusCells); y <= Math.min(N - 1, cy + rule.radiusCells); y++)
      for (let x = Math.max(0, cx - rule.radiusCells); x <= Math.min(N - 1, cx + rule.radiusCells); x++) {
        const i = y * N + x;
        if (i !== index) nearby.push(i);
      }
    nearby.sort((a, b) => unit(`${key}|pack-seat|${a}`) - unit(`${key}|pack-seat|${b}`) || a - b);
    return [index, ...nearby.slice(0, count - 1)];
  }
  function packMemberId(anchorId, ordinal, nexus) {
    if (!ordinal) return anchorId;
    // Nexus party encounters reserve their last ordinal for party extras.
    return nexus ? `${anchorId.slice(0, -2)}p${ordinal}_0` : `${anchorId}_p${ordinal}`;
  }
  // Independent cell/row draws: changing another owner's area cannot top up
  // this owner, and failed eligibility never moves a request to another cell.
  function* populationSteps(scene, entry, tx, ty, opts = {}) {
    const WG = root.WorldGen, N = opts.N || entry.cellsPerEdge;
    const grid = opts.grid || entry.baseGrid || entry.grid;
    const tileM = entry.tileEdgeM || scene.tileEdgeM;
    const cellM = opts.cellM || tileM / N;
    const spawnOpts = opts.spawnOpts || WG.spawnOptsOf(entry);
    const occupied = spawnOpts.occupied || new Set(), originalOccupied = new Set(occupied);
    spawnOpts.occupied = occupied;
    const reserved = new Set(opts.guardCells || []), spacing = faunaSpacing(N, [...reserved]);
    const frame = WG.tileFrame(entry, tx, ty, tileM);
    for (const creature of opts.authoredCreatures || []) {
      const index = frame.idxOf(creature.x, creature.y);
      if (index >= 0) { reserved.add(index); spacing.add(index); }
    }
    spawnOpts.creatureCells = reserved;
    const regions = new Map(), owners = new Array(N * N), habitats = new Array(N * N);
    // Passable props may share creature seats; preserve the full occupancy
    // ledger for later prop placement and legacy identity translation.
    const creatureOpts = root.CreatureSpawns.passableOpts(scene, entry, spawnOpts, reserved, tx, ty);
    for (let index = 0; index < N * N; index++) {
      if ((index & 2047) === 0) yield 'spawn owner coverage';
      const owner = owners[index] = root.SpawnPipeline.ownerAt(entry, index);
      const habitat = habitats[index] = resolve(entry, index);
      if (!owner || !densityRows(owner, entry, index).length || opts.ownerType && owner.type !== opts.ownerType) continue;
      const key = habitat.key || owner.key;
      if (!regions.has(key)) regions.set(key, { key, profile: owner.id, owner: owner.key, rawCells: 0,
        fauna: counts(), enemies: counts(), reserve: counts() });
      regions.get(key).rawCells++;
    }
    const sectionAt = entry.streetIndex ? root.StreetVariants.variantOwner(entry.streetIndex, N, Infinity, true) : null;
    const out = [], requests = [], reserves = [];
    for (let index = 0; index < N * N; index++) {
      if ((index & 1023) === 0) yield 'spawn zone rate rows';
      const owner = owners[index], habitat = habitats[index];
      if (!owner || opts.ownerType && owner.type !== opts.ownerType) continue;
      const region = regions.get(habitat.key || owner.key);
      if (!region) continue;
      const cx = index % N, cy = Math.floor(index / N);
      for (const row of densityRows(owner, entry, index)) {
        if (opts.category && row.category !== opts.category) continue;
        if (row.beach && !beachCell(entry, grid, N, index)) continue;
        const fauna = row.category === 'fauna';
        if (fauna && !allows(row.kind, grid[index], habitat.profile)) continue;
        const movement = root.EnemyRoster.get(row.kind)?.movement;
        const waterOnly = !!movement?.waterOnly;
        if (waterOnly && movement.shoreOnly && !WG.isShoreWaterCell(grid, N, N, cx, cy, spawnOpts)) continue;
        const gate = { ...creatureOpts, waterOnly };
        const cls = root.creatureSpawnClass(row.kind);
        if (!WG.isSpawnCell(grid, N, N, cx, cy, gate, cls)) continue;
        const key = `${tx}|${ty}|${owner.key}|${row.category}|${row.kind}|${index}`;
        const ownerHash = fnv1a(owner.key).toString(36);
        const id = fauna ? `${row.kind}_zone_${tx}_${ty}_${ownerHash}_${index}`
          : owner.type === 'zone' ? `zone_encounter_density_${tx}_${ty}_${ownerHash}_${row.kind}_${index}_0`
            : `enemy_habitat_density_${tx}_${ty}_${ownerHash}_${row.kind}_${index}`;
        const mean = fauna ? 1 : packMean(row.kind);
        const request = (field, requestKey, anchorId, list) => {
          const size = fauna ? 1 : packSize(row.kind, requestKey);
          region[field].requested += size;
          list.push({ row, owner, habitat, region, field, index, cx, cy, id: anchorId, key: requestKey, size });
        };
        if (root.SpawnPipeline.roll(key, row.per1000 / 1000 / mean))
          request(fauna ? 'fauna' : 'enemies', key, id, requests);
        // Mode reserve is another individual rate; packs do not multiply it.
        if (!fauna && owner.type === 'terrain'
            && root.SpawnPipeline.roll(key + '|reserve', row.per1000 / 1000 / mean * (maxLandEnemyMul() - 1)))
          request('reserve', key + '|reserve', id + '_r', reserves);
      }
    }
    // Stable category/identity order; reserve placement cannot displace base.
    requests.sort((a, b) => (a.row.category === 'fauna' ? 0 : 1) - (b.row.category === 'fauna' ? 0 : 1)
      || keyOrder(a.id, b.id));
    for (const request of [...requests, ...reserves]) {
      const { row, owner, habitat, region, field, index, cx, cy, id, size, key } = request;
      const fauna = row.category === 'fauna', pack = !fauna && ENEMY_PACKS[row.kind];
      const candidates = packCells(row.kind, key, index, N, size);
      let anchorPlaced = false;
      const records = yield* root.SpawnPipeline.generateSteps(null, {
        count: size, member: ordinal => ({ ordinal, id: packMemberId(id, ordinal, owner.type === 'zone') }),
        seat: member => {
          if (member.ordinal && !anchorPlaced) return null;
          const legal = i => {
            if (reserved.has(i)) return false;
            if (owners[i]?.key !== owner.key || habitats[i]?.key !== habitat.key) return false;
            if (owner.type === 'road' && sectionAt && sectionAt(i % N, Math.floor(i / N))?.key !== sectionAt(cx, cy)?.key) return false;
            if (!densityRows(owners[i], entry, i).some(candidate => candidate.kind === row.kind
                && candidate.category === row.category)) return false;
            if (row.beach && !beachCell(entry, grid, N, i)) return false;
            if (fauna && (!allows(row.kind, grid[i], habitats[i].profile) || spacing.clearance(i) < FAUNA_SPACING_CELLS)) return false;
            const movement = root.EnemyRoster.get(row.kind)?.movement;
            const x = i % N, y = Math.floor(i / N);
            if (movement?.waterOnly && movement.shoreOnly && !WG.isShoreWaterCell(grid, N, N, x, y, spawnOpts)) return false;
            const cls = root.creatureSpawnClass(row.kind);
            return WG.isSpawnCell(grid, N, N, x, y,
              { ...creatureOpts, waterOnly: !!movement?.waterOnly }, cls);
          };
          const candidate = candidates[member.ordinal];
          const seatIndex = candidate != null && legal(candidate) ? candidate : undefined;
          if (seatIndex == null) return null;
          const seatX = seatIndex % N, seatY = Math.floor(seatIndex / N);
          return { index: seatIndex, cx: seatX, cy: seatY,
            x: tx * tileM + (seatX + .5) * cellM, y: ty * tileM + (seatY + .5) * cellM };
        },
        create: (member, seat) => {
          const kind = !fauna && typeof Weather !== 'undefined'
            ? Weather.enemyBirthKind(row.kind, member.id, scene) : row.kind;
          const point = { key: habitat.key || owner.key, profile: owner.id, tx, ty, ...seat };
          const hostile = !fauna || !!root.EnemyRoster.get(kind)?.surface && root.Combat?.isEnemyKind(kind);
          return WG.makeCreature(kind, seat.x, seat.y, member.id, {
            shiny: fauna && typeof faunaShiny === 'function' ? faunaShiny(kind, member.id) : false,
            _spawnOwner: owner.key, _spawnSource: 'zone-density', _habitatSpawn: point,
            _spawnTime: row.time || 'any', _spawnRowKind: row.kind, _parkCharacter: entry.parkCharacters?.[seat.index],
            ...(pack ? { _spawnPack: { id, ordinal: member.ordinal, requested: size, cx, cy } } : {}),
            ...(member.ordinal ? { _legacyDefeatIds: [owner.type === 'zone'
              ? `zone_encounter_density_${tx}_${ty}_${fnv1a(owner.key).toString(36)}_${row.kind}_${seat.index}_0`
              : `enemy_habitat_density_${tx}_${ty}_${fnv1a(owner.key).toString(36)}_${row.kind}_${seat.index}${field === 'reserve' ? '_r' : ''}`] } : {}),
            ...(owner.type === 'zone' ? { zoneVariant: owner.id,
              ...(root.EnemyHabitats.emergesFromGround(kind, owner.id) ? { emergeFromGround: true, _burrowed: true } : {}) } : {}),
            ...(hostile ? { _surfaceSpawn: { tx, ty, ...seat },
              ...root.EnemySpawns.concealment(kind, member.id, owner.id) } : {}),
            ...(field === 'reserve' ? { _landEnemyReserve: true } : {}),
          });
        },
        onPlaced: (_, member, seat) => {
          if (!member.ordinal) anchorPlaced = true;
          reserved.add(seat.index); occupied.add(seat.index);
          if (fauna) spacing.add(seat.index);
          region[field].placed++;
        },
      });
      for (const c of records) {
        out.push(c);
        // Each base body receives party scaling exactly once. The pack itself
        // is not registered again as another population allowance.
        if (!fauna && owner.type === 'zone') root.EnemyHabitats.registerDensityEncounter(entry, c, occupied, owners);
      }
      if (size > 1) yield 'spawn enemy pack';
    }
    // Finite road populations use explicit section requests, not ambient
    // density or a tile allowance. The current map's section keys are bounded
    // by its canonical geometry (including tile-boundary cuts).
    const features = new Map();
    for (let index = 0; index < N * N; index++) {
      const owner = owners[index], row = owner?.type === 'road' && root.StreetVariants.VARIANT_BY_ID[owner.id]?.habitatEnemies;
      if (!row || opts.category === 'fauna' || opts.ownerType && opts.ownerType !== 'road') continue;
      const section = sectionAt?.(index % N, Math.floor(index / N));
      const key = section?.variant === owner.id ? section.key : `${owner.key}|${tx},${ty}`;
      if (!features.has(key)) features.set(key, { key, row, owner, cells: [] });
      features.get(key).cells.push(index);
    }
    for (const feature of [...features.values()].sort((a, b) => keyOrder(a.key, b.key))) {
      const h = habitats[feature.cells[0]], regionKey = h.key || feature.owner.key;
      let region = regions.get(regionKey);
      if (!region) regions.set(regionKey, region = { key: regionKey, profile: feature.owner.id, owner: feature.owner.key,
        rawCells: feature.cells.length, fauna: counts(), enemies: counts(), reserve: counts() });
      region.enemies.requested += feature.row.count;
      const candidates = feature.cells.slice().sort((a, b) => unit(feature.key + ':' + a) - unit(feature.key + ':' + b));
      const records = yield* root.SpawnPipeline.generateSteps({ frequency: { count: feature.row.count } }, {
        member: n => ({ kind: feature.row.kinds[n % feature.row.kinds.length], n,
          id: `enemy_habitat_section_${fnv1a(feature.key).toString(36)}_${n}` }),
        seat: member => {
          const cls = root.creatureSpawnClass(member.kind);
          const index = candidates.find(i => !reserved.has(i) && WG.isSpawnCell(grid, N, N, i % N, Math.floor(i / N),
            creatureOpts, cls));
          if (index == null) return null;
          return { index, cx: index % N, cy: Math.floor(index / N),
            x: tx * tileM + (index % N + .5) * cellM, y: ty * tileM + (Math.floor(index / N) + .5) * cellM };
        },
        create: (member, seat) => WG.makeCreature(member.kind, seat.x, seat.y, member.id, {
          shiny: false, _spawnSource: 'feature-encounter', _spawnOwner: feature.key,
          _habitatSpawn: { key: regionKey, profile: feature.owner.id, tx, ty, ...seat },
          _surfaceSpawn: { tx, ty, ...seat },
        }),
        onPlaced: (_, __, seat) => { reserved.add(seat.index); occupied.add(seat.index); region.enemies.placed++; },
      });
      out.push(...records);
    }
    // The older species-first stream is still replayed by the scene to retain
    // unrelated treasure RNG. Attach each historical cell ID once, without
    // deriving another population or consulting saved captures.
    const aliasesByKey = new Map(), seenLegacy = new Set();
    for (const legacy of opts.legacyEnemies || []) {
      if (!legacy.id || seenLegacy.has(legacy.id)) continue;
      seenLegacy.add(legacy.id);
      const pool = out.filter(c => c._surfaceSpawn && !c._landEnemyReserve && c._habitatSpawn.key === legacy.key);
      if (!pool.length) continue;
      const n = aliasesByKey.get(legacy.key) || 0;
      (pool[n % pool.length]._legacyDefeatIds ||= []).push(legacy.id);
      aliasesByKey.set(legacy.key, n + 1);
    }
    // Old quota generators are replayed only to translate existing save IDs.
    // They never contribute population counts or placements to the new world.
    const oldIds = scene.save?.caught || [];
    if (!opts.skipLegacy && oldIds.some(id => typeof id === 'string' && !id.includes('_zone_')
        && !id.includes('_density_') && id.includes(`_${tx}_${ty}_`))) {
      const legacyEntry = { ...entry }, legacyOpts = { ...spawnOpts, occupied: new Set(originalOccupied) };
      const legacy = yield* legacyPopulationSteps(scene, legacyEntry, tx, ty, { ...opts, spawnOpts: legacyOpts });
      if (oldIds.some(id => String(id).startsWith('zone_encounter_')))
        legacy.push(...yield* root.EnemyHabitats.legacySurfaceEncountersSteps(legacyEntry, tx, ty, new Set(originalOccupied)));
      const buckets = new Map();
      for (const c of out) {
        const key = `${c.kind}|${c._habitatSpawn?.key || c._spawnOwner}|${!!c._landEnemyReserve}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(c);
      }
      const assigned = new Map(), aliasTargets = new Map();
      for (const c of out) for (const alias of c._legacyDefeatIds || []) aliasTargets.set(alias, c.id);
      for (const old of legacy.sort((a, b) => keyOrder(a.id, b.id))) {
        const index = frame.idxOf(old.x, old.y), owner = owners[index];
        const bucketKey = `${old.kind}|${old._habitatSpawn?.key || habitats[index]?.key || owner?.key}|${!!old._landEnemyReserve}`;
        const candidates = buckets.get(bucketKey);
        if (!candidates?.length) continue;
        if (!assigned.has(bucketKey)) assigned.set(bucketKey, new Set());
        const used = assigned.get(bucketKey);
        // A lower new density can have fewer bodies than the legacy world.
        // Fill one-to-one first, then begin another deterministic alias cycle.
        if (used.size === candidates.length) used.clear();
        // Closest new stable candidate, with identity tie-break; never cross
        // species/owner boundaries to honour a historical capture or defeat.
        const target = candidates.filter(c => !used.has(c.id)).reduce((best, c) => {
          const d = (c.x - old.x) ** 2 + (c.y - old.y) ** 2;
          return !best || d < best.d || d === best.d && c.id < best.c.id ? { c, d } : best;
        }, null).c;
        used.add(target.id);
        const aliases = target._legacyDefeatIds ||= [];
        for (const id of [old.id, ...old._legacyDefeatIds || []]) {
          if (aliasTargets.has(id)) continue;
          aliasTargets.set(id, target.id); aliases.push(id);
        }
      }
    }
    const totals = { fauna: counts(), enemies: counts(), reserve: counts() };
    for (const region of regions.values()) for (const field of ['fauna', 'enemies', 'reserve']) {
      region[field].shortfall = region[field].requested - region[field].placed;
      for (const name of ['requested', 'placed', 'shortfall']) totals[field][name] += region[field][name];
    }
    entry.habitatPopulation = { regions: [...regions.values()], totals,
      faunaRequested: totals.fauna.requested, enemyRequested: totals.enemies.requested };
    return out;
  }
  const api = { FAUNA_DENSITY, faunaCount, FAUNA_PER_TILE, FAUNA_SPACING_CELLS, faunaSpacing, ENEMIES_PER_TILE, reserveBudget, reserveVisible, LAND_FAUNA, VARIANT_FAUNA, landProfile, shoreProfile, variantProfile, roadProfile, resolve,
    faunaRows, pickFauna, faunaBudget, allows, enemyRows, enemyKind, surfaceWeight, DENSITY_ROWS, SIGNATURE_ENEMIES, densityRows, enemyDeclaration, ENEMY_PACKS, packMean, packSize, packCells, packMemberId, populationSteps };
  root.HabitatSpawns = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
