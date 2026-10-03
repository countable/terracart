// World-fixed encounter context. Geography chooses a family; roster rows own
// strength and behaviour. Player progress never rerolls a habitat or its seats.
(function (root) {
  'use strict';
  const EXT = 4096, REGION = 1024;
  const FAMILIES = {
    natural: ['slime', 'cave_slime', 'bat', 'spider', 'purple_slime', 'gelatinous_cube'],
    roots: ['plant', 'spider', 'poison_spider', 'dryad', 'bone_plant'],
    warren: ['club_goblin', 'spear_goblin', 'archer_goblin', 'goblin_trapper', 'bomb_goblin', 'orc'],
    crypt: ['zombie', 'skeleton', 'skeleton_soldier', 'necromancer', 'lich', 'bone_plant', 'vampire_bat', 'sword_spirit'],
    stronghold: ['orc', 'orc_mage', 'orc_shaman', 'minotaur', 'spear_goblin', 'brute'],
    infernal: ['fire_elemental', 'red_demon', 'purple_demon', 'armoured_demon', 'fiend', 'succubus', 'hell_brute'],
    roost: ['red_demon', 'armoured_demon'],
  };
  const THEME_BANDS = [
    { max: 2, themes: ['natural', 'natural', 'natural', 'warren'] },
    { max: 4, themes: ['natural', 'roots', 'warren', 'crypt', 'stronghold'] },
    { max: 6, themes: ['roots', 'warren', 'crypt', 'stronghold', 'infernal'] },
    { max: 8, themes: ['crypt', 'stronghold', 'infernal', 'infernal', 'roots'] },
    { max: Infinity, themes: ['crypt', 'stronghold', 'infernal', 'infernal', 'roost'] },
  ];
  const GRAVEYARD_THEMES = ['ordered_graves', 'overgrown_graves'];
  function emergesFromGround(kind, theme) {
    return kind === 'zombie' && GRAVEYARD_THEMES.includes(theme);
  }
  const BUILDING_FAMILIES = {
    pirate_cove: ['pirate_grunt', 'pirate_gunner', 'pirate_captain'],
    mystic_reef: ['giant_crab', 'jellyfish'],
    orchard: ['farmer_goblin', 'club_goblin'],
    hedge_garden: ['plant', 'spider'], ancient_grove: ['treant', 'spider'],
    overgrown: ['plant', 'spider'], ordered_graves: ['zombie', 'skeleton', 'skeleton_soldier'],
    silent_circle: ['skeleton', 'skeleton_soldier'], overgrown_graves: ['zombie', 'spider', 'skeleton'],
    broken_masonry: ['club_goblin', 'spear_goblin', 'archer_goblin'],
    barricade: ['spear_goblin', 'archer_goblin'],
    hungry_marsh: ['plant', 'slime'], orc_stronghold: ['orc', 'orc_shaman', 'orc_mage'],
  };
  const SURFACE_FAMILIES = {
    ...BUILDING_FAMILIES,
    meadow: ['slime', 'plant'], mushroom_grove: ['mushroom_monster', 'spider', 'slime'],
    formal_garden: ['slime', 'plant'], stone_garden: ['slime', 'skeleton'],
    flint_field: ['club_goblin', 'spear_goblin'], broken_depot: ['skeleton', 'club_goblin'],
    seep: ['slime', 'plant', 'golden_slime'], work_yard: ['club_goblin', 'archer_goblin'],
    black_ring: ['skeleton', 'skeleton_soldier'], shellwater_strand: ['giant_crab', 'slime', 'jellyfish'],
  };
  // One encounter roll per ~84 m square at the usual 7 m cell size.
  // Most are solitary; 25% are pairs and 10% are trios. No per-kind budget.
  const SURFACE_ENCOUNTERS = { blockCells: 12, chance: .6, pairAt: .65, trioAt: .9, tries: 12 };
  function unit(key) {
    // Avalanche FNV: nearby spatial keys must not form long same-theme runs.
    let h = root.EnemySpawns.hash(key);
    h = Math.imul(h ^ h >>> 16, 0x7feb352d);
    h = Math.imul(h ^ h >>> 15, 0x846ca68b);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }
  function caveAt(entry, tx, ty, cx, cy, depth) {
    const N = entry.cellsPerEdge, gx = tx * EXT + (cx + .5) * EXT / N, gy = ty * EXT + (cy + .5) * EXT / N;
    const bx = Math.floor(gx / REGION), by = Math.floor(gy / REGION);
    let best = null;
    for (let y = by - 1; y <= by + 1; y++) for (let x = bx - 1; x <= bx + 1; x++) {
      const id = `habitat_${depth}_${x}_${y}`;
      const ax = (x + .2 + unit(id + ':x') * .6) * REGION;
      const ay = (y + .2 + unit(id + ':y') * .6) * REGION;
      const distance = (gx - ax) ** 2 + (gy - ay) ** 2;
      if (!best || distance < best.distance) best = { id, gx: ax, gy: ay, distance };
    }
    const band = THEME_BANDS.find(b => depth <= b.max);
    const theme = band.themes[Math.floor(unit(best.id + ':theme') * band.themes.length)];
    return { ...best, theme, kinds: FAMILIES[theme] };
  }
  function variantAt(entry, cx, cy) {
    const N = entry.cellsPerEdge, i = cy * N + cx;
    if (cx < 0 || cy < 0 || cx >= N || cy >= N) return null;
    const field = entry.zone;
    const slot = field && (field.coverage || field.idx)?.[i];
    if (slot) return field.anchors[slot - 1]?.variant || null;
    const sites = entry.habitatSites || [];
    const site = sites.find(s => Math.hypot(cx - s.cx, cy - s.cy) <= s.radiusCells);
    return site?.theme || null;
  }
  function surfaceAt(entry, cx, cy) {
    const i = cy * entry.cellsPerEdge + cx;
    return { theme: variantAt(entry, cx, cy), beach: !!entry.scenic?.shore?.mask?.[i] };
  }
  function surfaceEncounters(entry, tx, ty, occupied) {
    return root.WorldGen.runSteps(surfaceEncountersSteps(entry, tx, ty, occupied));
  }
  // Keep a whole encounter group together, but let the tile builder yield
  // between blocks. Failed placement attempts are work too, including on
  // tiles whose coverage never offers a seat.
  function* surfaceEncountersSteps(entry, tx, ty, occupied) {
    const WG = root.WorldGen, N = entry.cellsPerEdge, grid = entry.baseGrid || entry.grid;
    const cellM = entry.tileEdgeM / N, out = [], cfg = SURFACE_ENCOUNTERS;
    const opts = { ...entry._spawnOpts, roadMask: entry.roadMask, spawnWhy: entry.spawnWhy,
      roadClass: entry.roadClass, occupied };
    if (!entry.zone?.coverage) return out;
    for (let by = 0; by < N; by += cfg.blockCells) for (let bx = 0; bx < N; bx += cfg.blockCells) {
      yield 'spawn habitat encounter blocks';
      const id = `zone_encounter_${tx}_${ty}_${bx}_${by}`;
      if (unit(id + ':present') >= cfg.chance) continue;
      const size = unit(id + ':size'), count = size >= cfg.trioAt ? 3 : size >= cfg.pairAt ? 2 : 1;
      let anchor = null;
      for (let n = 0; n < count; n++) {
        for (let k = 0; k < cfg.tries; k++) {
          const key = `${id}:${n}:${k}`;
          const cx = anchor ? anchor.cx + Math.floor(unit(key + ':x') * 5) - 2
            : bx + Math.floor(unit(key + ':x') * Math.min(cfg.blockCells, N - bx));
          const cy = anchor ? anchor.cy + Math.floor(unit(key + ':y') * 5) - 2
            : by + Math.floor(unit(key + ':y') * Math.min(cfg.blockCells, N - by));
          if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
          const slot = entry.zone.coverage[cy * N + cx];
          if (!slot || (anchor && slot !== anchor.slot)) continue;
          const zoneVariant = entry.zone.anchors[slot - 1]?.variant;
          const family = SURFACE_FAMILIES[zoneVariant];
          if (!family) continue;
          const kinds = family.filter(kind => {
            const row = root.EnemyRoster.get(kind);
            return row?.surface && !row.retired && row.tier <= 3;
          });
          if (!kinds.length) continue;
          const kind = kinds[Math.floor(unit(`${id}:${n}:kind`) * kinds.length)];
          const cls = root.creatureSpawnClass(kind);
          if (!WG.isSpawnCell(grid, N, N, cx, cy, opts, cls)) continue;
          const x = tx * entry.tileEdgeM + (cx + .5) * cellM;
          const y = ty * entry.tileEdgeM + (cy + .5) * cellM;
          occupied.add(cy * N + cx);
          anchor ||= { cx, cy, slot };
          out.push(WG.makeCreature(kind, x, y, `${id}_${n}`, {
            zoneVariant, shiny: false,
            ...(emergesFromGround(kind, zoneVariant)
              ? { emergeFromGround: true, _burrowed: true } : {}),
            _surfaceSpawn: { x, y, tx, ty, cx, cy },
          }));
          break;
        }
        if (!anchor) break;
      }
    }
    return out;
  }
  function buildingKinds(entry, cand) {
    const N = entry.cellsPerEdge, cellM = entry.tileEdgeM / N;
    const cx = Number.isFinite(cand.ix) ? cand.ix : Math.floor(cand.lx / cellM);
    const cy = Number.isFinite(cand.iy) ? cand.iy : Math.floor(cand.ly / cellM);
    const theme = variantAt(entry, cx, cy) || cand.variant;
    if (theme) return BUILDING_FAMILIES[theme] || null;
    // Frontage may sit outside its street's narrow visual band. Read the
    // nearest authored street mark around the building footprint, once when
    // its garrison wakes, rather than rerolling a second local theme.
    const marks = entry.streetMarks || entry.streetDress?.marks;
    if (!marks) return null;
    const radius = Math.min(12, Math.ceil(Math.max(cand.halfW || 0, cand.halfH || 0) / cellM) + 3);
    let nearest = null;
    for (let y = Math.max(0, cy - radius); y <= Math.min(N - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(N - 1, cx + radius); x++) {
        const row = root.StreetVariants?.variantByCode(marks[y * N + x]);
        if (!row || !BUILDING_FAMILIES[row.id]) continue;
        const distance = (x - cx) ** 2 + (y - cy) ** 2;
        if (!nearest || distance < nearest.distance) nearest = { distance, kinds: BUILDING_FAMILIES[row.id] };
      }
    }
    return nearest?.kinds || null;
  }
  // Finite optional surface sites. One owner per sub-tile block; every seat
  // passes the normal enemy gate. No rewards or background objects are added.
  function surfaceSites(entry, tx, ty, occupied) {
    const WG = root.WorldGen, N = entry.cellsPerEdge, grid = entry.baseGrid || entry.grid;
    const cellM = entry.tileEdgeM / N, out = [], sites = [];
    const opts = { ...entry._spawnOpts, roadMask: entry.roadMask, spawnWhy: entry.spawnWhy,
      roadClass: entry.roadClass, occupied };
    for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) {
      const id = `habitat_surface_${tx}_${ty}_${bx}_${by}`;
      if (unit(id + ':present') >= .18) continue;
      const cx = Math.floor((bx + .5) * N / 4), cy = Math.floor((by + .5) * N / 4);
      const land = root.Zones?.landAt ? root.Zones.landAt(grid, entry.zone?.under, cy * N + cx) : grid[cy * N + cx];
      const theme = land === WG.T.WETLAND ? 'hungry_marsh' : land === WG.T.ROCK ? 'orc_stronghold' : null;
      if (!theme || WG.variantOwnerAt(entry, cy * N + cx)) continue;
      const kinds = theme === 'hungry_marsh' ? ['plant', 'slime'] : ['orc', 'orc_shaman'];
      const site = { id, theme, cx, cy, radiusCells: 7, guards: [] };
      for (let n = 0; n < kinds.length; n++) {
        const kind = kinds[n], cls = root.creatureSpawnClass?.(kind) || 'enemy';
        for (let k = 0; k < 32; k++) {
          const angle = k * 2.399963 + n * Math.PI, radius = 2 + Math.floor(k / 8);
          const x = cx + Math.round(Math.cos(angle) * radius), y = cy + Math.round(Math.sin(angle) * radius);
          if (x < 0 || y < 0 || x >= N || y >= N || WG.variantOwnerAt(entry, y * N + x)) continue;
          if (root.Zones?.landAt && root.Zones.landAt(grid, entry.zone?.under, y * N + x) !== land) continue;
          if (!WG.isSpawnCell(grid, N, N, x, y, opts, cls)) continue;
          const wx = (tx * N + x + .5) * cellM, wy = (ty * N + y + .5) * cellM;
          occupied.add(y * N + x);
          const guard = WG.makeCreature(kind, wx, wy, `${id}_${n}`, { habitat: theme,
            immobile: true, lair: id, lairX: (tx * N + cx + .5) * cellM,
            lairY: (ty * N + cy + .5) * cellM, lairR: 0, seatX: wx, seatY: wy, shiny: false });
          out.push(guard); site.guards.push(guard.id); break;
        }
      }
      if (site.guards.length) sites.push(site);
    }
    entry.habitatSites = sites;
    return out;
  }
  // A dragon is a single chamber encounter, never a member of the ambient bag.
  // Jittered habitat centres own seats, even when their territory crosses a
  // tile seam. Missing space means no roost; another tile never retries it.
  // The caller filters saved defeats/live edits AFTER reserving this seat.
  function caveSites(entry, tx, ty, depth, occupied) {
    if (depth < 9) return [];
    const WG = root.WorldGen, N = entry.cellsPerEdge;
    const grid = entry.baseGrid || entry.grid, cellM = entry.tileEdgeM / N;
    const objects = (entry.genObjects || entry.objects || []).filter(o => !o._synthetic);
    const stairs = objects.filter(o => o.kind === 'staircase').map(o => ({
      x: (o.x - tx * entry.tileEdgeM) / cellM - .5,
      y: (o.y - ty * entry.tileEdgeM) / cellM - .5,
    }));
    const opts = { roadMask: null, occupied, pois: [] }, out = [];
    const cls = root.creatureSpawnClass?.('red_dragon') || 'enemy';
    for (let by = 0; by < EXT / REGION; by++) for (let bx = 0; bx < EXT / REGION; bx++) {
      const rx = tx * EXT / REGION + bx, ry = ty * EXT / REGION + by;
      const regionId = `habitat_${depth}_${rx}_${ry}`;
      const gx = (rx + .2 + unit(regionId + ':x') * .6) * REGION;
      const gy = (ry + .2 + unit(regionId + ':y') * .6) * REGION;
      const cx = Math.floor((gx - tx * EXT) * N / EXT);
      const cy = Math.floor((gy - ty * EXT) * N / EXT);
      const habitat = caveAt(entry, tx, ty, cx, cy, depth);
      if (habitat.id !== regionId || habitat.theme !== 'roost') continue;
      const candidates = [];
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        candidates.push({ x: cx + dx, y: cy + dy, distance: dx * dx + dy * dy });
      }
      candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
      for (const { x, y } of candidates) {
        if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1) continue;
        if (caveAt(entry, tx, ty, x, y, depth).id !== regionId) continue;
        if (stairs.some(s => Math.hypot(x - s.x, y - s.y) < 5)) continue;
        let room = true;
        for (let dy = -1; dy <= 1 && room; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (grid[(y + dy) * N + x + dx] !== WG.T.CAVE_FLOOR
            || !WG.isSpawnCell(grid, N, N, x + dx, y + dy, opts, cls)) { room = false; break; }
        }
        if (!room) continue;
        const wx = tx * entry.tileEdgeM + (x + .5) * cellM;
        const wy = ty * entry.tileEdgeM + (y + .5) * cellM;
        occupied.add(y * N + x);
        out.push(WG.makeCreature('red_dragon', wx, wy, `dragon_roost_${depth}_${rx}_${ry}`, {
          _cave: true, habitat: 'roost', _habitatRegion: regionId,
          homeX: wx, homeY: wy, shiny: false,
        }));
        break;
      }
    }
    return out;
  }
  root.EnemyHabitats = { FAMILIES, THEME_BANDS, BUILDING_FAMILIES, SURFACE_FAMILIES, SURFACE_ENCOUNTERS,
    unit, caveAt, surfaceAt, surfaceEncounters, surfaceEncountersSteps, variantAt, emergesFromGround, buildingKinds, surfaceSites, caveSites };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.EnemyHabitats;
})(typeof window !== 'undefined' ? window : globalThis);
