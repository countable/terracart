// Surface populations belong to their landcover or winning authored variant.
// Budgets are independent of placement exclusions and player visibility.
(function (root) {
  'use strict';
  const FAUNA_PER_TILE = 160, ENEMIES_PER_TILE = 50;
  const LAND_FAUNA = {
    GRASS: { chicken: 5, cow: 4, butterfly: 4, rabbit: 3, horse: .4 },
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
  const SHORE_VARIANTS = new Set(['marine_meadow', 'mystic_reef', 'pirate_cove', 'shellwater_strand']);
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
    const total = rows.reduce((n, row) => n + weight(row), 0);
    if (!(total > 0)) return null;
    let at = value * total;
    for (const row of rows) { at -= weight(row); if (at < 0) return row; }
    return rows[rows.length - 1] || null;
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
    if (!base) return null;
    const key = `${name}:shore`;
    if (!landCache.has(key)) landCache.set(key, Object.freeze({ id: key, owner: 'land',
      fauna: weightedRows({}), haunting: base.haunting }));
    return landCache.get(key);
  }
  function variantProfile(id, kind) {
    const row = root.ZoneVariants?.byId(id);
    kind ||= row?.zone;
    const key = `${kind || ''}:${id}`;
    if (!variantCache.has(key)) {
      const mix = VARIANT_FAUNA[id] || (kind === 'grove' ? VARIANT_FAUNA.meadow
        : kind === 'tar' ? VARIANT_FAUNA.work_yard : VARIANT_FAUNA.stone_garden);
      const shore = SHORE_VARIANTS.has(id);
      variantCache.set(key, Object.freeze({ id, owner: 'zone', kind, fauna: weightedRows(mix),
        faunaBudget: Object.freeze(shore || id === 'quarry-crater' ? [0, 0] : kind === 'quarry' ? [2, 4] : [3, 8]),
        ...(shore ? { shoreFauna: Object.freeze(['crab', 'sea_turtle', 'gull'].map(kind => Object.freeze({ kind }))) } : {}),
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
        faunaBudget: Object.freeze(budget), haunting: id === 'pilgrim' }));
    }
    return roadCache.get(id);
  }
  function resolve(entry, index) {
    const grid = entry?.baseGrid || entry?.grid, type = grid?.[index];
    if (type == null || index < 0 || index >= grid.length) return { key: null, profile: null, type };
    const coverage = entry.zone?.coverage || entry.zone?.idx;
    const areaOwner = root.WorldGen.variantOwnerAt(entry, index);
    const owner = areaOwner === 'cave' ? areaOwner : coverage?.[index] ? 'zone' : areaOwner;
    if (owner === 'zone') {
      const slot = coverage?.[index], anchor = entry.zone?.anchors?.[slot - 1];
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
  function at(entry, cx, cy) { return resolve(entry, cy * entry?.cellsPerEdge + cx); }
  function faunaRows(profile) { return profile?.fauna || []; }
  function pickFauna(profile, id) { return pick(faunaRows(profile), unit(id + ':fauna'), row => row.weight)?.kind || null; }
  function faunaBudget(profile, id) {
    const range = profile?.faunaBudget;
    return range ? range[0] + Math.floor(unit(id + ':fauna-count') * (range[1] - range[0] + 1)) : 0;
  }
  function allows(kind, type, profile) {
    const name = nameOf(type);
    if (kind === 'cat' && name === 'WASTELAND') return false;
    if (kind === 'deer') return name === 'FOREST' || name === 'RESIDENTIAL';
    if (kind === 'butterfly' && (name === 'FOREST' || name === 'ORCHARD')) return false;
    if (kind === 'crow') return name === 'PARK' || name === 'GROVE'
      || ((profile?.owner === 'road' || (profile?.owner === 'zone' && profile.kind === 'grove'))
        && faunaRows(profile).some(row => row.kind === kind));
    if (kind === 'raven') return name === 'RESIDENTIAL';
    return root.BiomeProfiles?.faunaAllows(kind, type) ?? true;
  }
  function enemyRows(profile, type, context) {
    if (!profile || profile.owner === 'road') return [];
    const family = profile.owner === 'zone' ? root.EnemyHabitats?.SURFACE_FAMILIES[profile.id] : null;
    let eligible = root.EnemyRoster.ROWS.filter(row => !row.retired && row.surface && row.tier <= 3
      && row.attackType !== 'touch' && (family ? family.includes(row.id)
        : profile.owner === 'land' && row.surface.biomes.includes(nameOf(type))));
    if (!family) {
      eligible = eligible.filter(row => !['giant_crab', 'jellyfish'].includes(row.id) || context?.beach);
      if (context?.beach) eligible = eligible.filter(row => ['giant_crab', 'jellyfish'].includes(row.id));
    }
    const replaced = new Set(eligible.filter(row => row.variantType === 'Tint' && row.surface.replaceBase !== false).map(row => row.variantOf));
    return eligible.filter(row => !replaced.has(row.id));
  }
  function enemyKind(profile, id, type, context) {
    const rows = enemyRows(profile, type, context), weights = root.EnemyRoster.SURFACE_TIERS.at(-1).tierWeights;
    const tiers = [...new Set(rows.map(row => row.tier))];
    const tier = pick(tiers, unit(id + ':tier'), value => weights[value] || 0);
    const family = profile?.owner === 'zone';
    return pick(rows.filter(row => row.tier === tier), unit(id + ':enemy'),
      row => family ? row.surface.weight || 1 : row.surface.weight)?.id || null;
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
  function* populationSteps(scene, entry, tx, ty, opts = {}) {
    const WG = root.WorldGen, N = opts.N || entry.cellsPerEdge;
    const grid = opts.grid || entry.baseGrid || entry.grid;
    const cellM = opts.cellM || entry.tileEdgeM / N || scene.cellM;
    const tileM = entry.tileEdgeM || scene.tileEdgeM || N * cellM;
    const spawnOpts = opts.spawnOpts || WG.spawnOptsOf(entry);
    const occupied = spawnOpts.occupied || new Set();
    spawnOpts.occupied = occupied;
    const guardCells = opts.guardCells || new Set(), reserved = new Set();
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
    allocate(ordinary.filter(group => faunaRows(group.profile).length), FAUNA_PER_TILE, 'faunaRequested');
    allocate(ordinary.filter(group => enemyRows(group.profile, group.type, { beach: group.beach }).length), ENEMIES_PER_TILE, 'enemyRequested');
    for (const group of groups) {
      if (group.profile.owner !== 'land') group.faunaRequested = faunaBudget(group.profile, `${tx}|${ty}|${group.key}`);
      group.diagnostic = { key: group.key, profile: group.profile.id, rawCells: group.cells.length,
        fauna: counts(group.faunaRequested), enemies: counts(group.enemyRequested) };
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
      const group = groupsByKey.get(habitatOf[index]?.key);
      if (group?.profile.owner !== 'zone'
          || !faunaRows(group.profile).some(row => row.kind === creature.kind)
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
      for (let n = 0; n < pool.length; n++) {
        if ((n & 4095) === 4095) yield 'spawn habitat seat search';
        const index = pool[(start + n) % pool.length];
        if (reserved.has(index) || guardCells.has(index) || !sameOwner(group, index, aquatic)) continue;
        const cx = index % N, cy = Math.floor(index / N);
        if (!WG.isSpawnCell(grid, N, N, cx, cy, seatOpts, cls)) continue;
        reserved.add(index);
        occupied.add(index);
        return { cx, cy, x: tx * tileM + (cx + .5) * cellM, y: ty * tileM + (cy + .5) * cellM };
      }
      return null;
    }
    for (const group of groups) {
      for (let n = 0; n < group.faunaRequested; n++) {
        if ((attempts++ & 31) === 0) yield 'spawn habitat population';
        const seed = `${tx}|${ty}|${group.key}|fauna|${n}`;
        const kind = pickFauna(group.profile, seed);
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
        const kind = enemyKind(group.profile, id, group.type, { beach: group.beach });
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
    const totals = { fauna: counts(), enemies: counts() };
    for (const group of groups) for (const population of ['fauna', 'enemies']) {
      const row = group.diagnostic[population];
      row.shortfall = row.requested - row.placed;
      for (const field of ['requested', 'placed', 'shortfall']) totals[population][field] += row[field];
      if (row.authored) totals[population].authored = (totals[population].authored || 0) + row.authored;
    }
    entry.habitatPopulation = { regions: groups.map(group => group.diagnostic), totals,
      faunaRequested: totals.fauna.requested, enemyRequested: totals.enemies.requested };
    return out;
  }
  const api = { FAUNA_PER_TILE, ENEMIES_PER_TILE, LAND_FAUNA, VARIANT_FAUNA, landProfile, shoreProfile, variantProfile, roadProfile, resolve, at,
    faunaRows, pickFauna, faunaBudget, allows, enemyRows, enemyKind, populationSteps };
  root.HabitatSpawns = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
