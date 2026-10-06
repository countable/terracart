// World-fixed encounter context. Geography chooses a family; roster rows own
// strength and behaviour. Player progress never rerolls a habitat or its seats.
(function (root) {
  'use strict';
  const EXT = 4096, REGION = 1024;
  const FAMILIES = {
    natural: ['slime', 'cave_slime', 'bat', 'spider', 'purple_slime', 'gelatinous_cube', 'troll'],
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
    hedge_garden: ['plant', 'spider'], ancient_grove: ['treant', 'spider', 'giant_bear'],
    overgrown: ['plant', 'spider'], ordered_graves: ['zombie', 'skeleton', 'skeleton_soldier', 'giant_reaper'],
    stone_garden: ['slime', 'skeleton', 'giant_reaper'],
    silent_circle: ['skeleton', 'skeleton_soldier', 'giant_reaper'], overgrown_graves: ['zombie', 'spider', 'skeleton', 'giant_reaper'],
    broken_masonry: ['club_goblin', 'spear_goblin', 'archer_goblin', 'giant_reaper'],
    barricade: ['spear_goblin', 'archer_goblin'],
    hungry_marsh: ['plant', 'slime'], orc_stronghold: ['orc', 'orc_shaman', 'orc_mage'],
  };
  const CASTLE_FAMILIES = { citadel: ['bugbear'] };
  const SURFACE_FAMILIES = {
    ...BUILDING_FAMILIES,
    meadow: ['slime', 'plant'], mushroom_grove: ['mushroom_monster'],
    formal_garden: ['slime', 'plant'],
    flint_field: ['club_goblin', 'spear_goblin'], broken_depot: ['skeleton', 'club_goblin'],
    seep: ['slime', 'plant', 'golden_slime'], work_yard: ['club_goblin'],
    black_ring: ['skeleton', 'skeleton_soldier'], shellwater_strand: ['giant_crab', 'slime', 'jellyfish'],
  };
  // One encounter roll per ~84 m square at the usual 7 m cell size.
  // Most are solitary; 25% are pairs and 10% are trios. No per-kind budget.
  const SURFACE_ENCOUNTERS = { blockCells: 12, chance: .6, pairAt: .65, trioAt: .9, tries: 12 };
  // Grove mushrooms roam individually, scattered across smaller patches.
  const SURFACE_ENCOUNTER_PROFILES = {
    mushroom_grove: { ...SURFACE_ENCOUNTERS, blockCells: 6, pairAt: 1, trioAt: 1 },
  };
  // Avalanche FNV (util.js avalanche32 over fnv1a): nearby spatial keys
  // must not form long same-theme runs.
  function unit(key) { return u01(avalanche32(root.EnemySpawns.hash(key))); }
  // One creature on one cell: claims the cell, seats the creature at the
  // cell's centre and stamps `extra` (a function of the seat's world point,
  // or a plain record) — what every seater below does.
  function seatCreature(entry, tx, ty, cx, cy, kind, id, extra, occupied) {
    const N = entry.cellsPerEdge, cellM = entry.tileEdgeM / N;
    const x = tx * entry.tileEdgeM + (cx + .5) * cellM;
    const y = ty * entry.tileEdgeM + (cy + .5) * cellM;
    occupied.add(cy * N + cx);
    return root.WorldGen.makeCreature(kind, x, y, id, typeof extra === 'function' ? extra(x, y) : extra);
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
    const WG = root.WorldGen, N = entry.cellsPerEdge, i = cy * N + cx;
    const grid = entry.baseGrid || entry.grid;
    let nearMinorRoad = false;
    // This is a habitat preference, not permission to stand on a road or lot.
    // The caller's ordinary spawn gate still owns private yards and road bands.
    if (grid[i] === WG.T.RESIDENTIAL && !WG.inMajorBuffer(entry.roadClass, N, cx, cy)) {
      const radius = WG.SPAWN_FRONTAGE;
      for (let y = Math.max(0, cy - radius); y <= Math.min(N - 1, cy + radius) && !nearMinorRoad; y++) {
        for (let x = Math.max(0, cx - radius); x <= Math.min(N - 1, cx + radius); x++) {
          if (grid[y * N + x] === WG.T.ROAD && !WG.onMajorBand(entry.roadClass, N, x, y)) {
            nearMinorRoad = true;
            break;
          }
        }
      }
    }
    return { theme: variantAt(entry, cx, cy), beach: !!entry.scenic?.shore?.mask?.[i], nearMinorRoad };
  }
  function surfaceEncounters(entry, tx, ty, occupied) {
    return root.WorldGen.runSteps(surfaceEncountersSteps(entry, tx, ty, occupied));
  }
  // Keep a whole encounter group together, but let the tile builder yield
  // between blocks. Failed placement attempts are work too, including on
  // tiles whose coverage never offers a seat.
  function* surfaceEncountersSteps(entry, tx, ty, occupied) {
    if (!entry.zone?.coverage) return [];
    const themes = [...new Set(entry.zone.anchors.map(a => a.variant))]
      .filter(theme => SURFACE_ENCOUNTER_PROFILES[theme]);
    const out = yield* surfaceEncounterProfileSteps(entry, tx, ty, occupied, null);
    for (const theme of themes) out.push(...yield* surfaceEncounterProfileSteps(entry, tx, ty, occupied, theme));
    return out;
  }
  function* surfaceEncounterProfileSteps(entry, tx, ty, occupied, theme) {
    const WG = root.WorldGen, N = entry.cellsPerEdge, grid = entry.baseGrid || entry.grid;
    const out = [], cfg = SURFACE_ENCOUNTER_PROFILES[theme] || SURFACE_ENCOUNTERS;
    const opts = { ...entry._spawnOpts, roadMask: entry.roadMask, spawnWhy: entry.spawnWhy,
      roadClass: entry.roadClass, occupied };
    if (!entry.zone?.coverage) return out;
    for (let by = 0; by < N; by += cfg.blockCells) for (let bx = 0; bx < N; bx += cfg.blockCells) {
      yield 'spawn habitat encounter blocks';
      const id = WG.cellId(theme ? `zone_encounter_${theme}` : 'zone_encounter', tx, ty, bx, by);
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
          if ((SURFACE_ENCOUNTER_PROFILES[zoneVariant] ? zoneVariant : null) !== theme) continue;
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
          anchor ||= { cx, cy, slot };
          out.push(seatCreature(entry, tx, ty, cx, cy, kind, `${id}_${n}`, (x, y) => ({
            zoneVariant, shiny: false,
            ...root.EnemySpawns.concealment(kind, `${id}_${n}`, zoneVariant),
            ...(emergesFromGround(kind, zoneVariant)
              ? { emergeFromGround: true, _burrowed: true } : {}),
            _surfaceSpawn: { x, y, tx, ty, cx, cy },
          }), occupied));
          break;
        }
        if (!anchor) break;
      }
    }
    return out;
  }
  function buildingKinds(entry, cand) {
    const castle = cand.tier === 12 && root.CastleStyles?.get(cand.key);
    if (CASTLE_FAMILIES[castle?.id]) return CASTLE_FAMILIES[castle.id];
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
    root.WorldGen.boxCells(N, N, cx, cy, radius, (x, y, i) => {
      const row = root.StreetVariants?.variantByCode(marks[i]);
      if (!row || !BUILDING_FAMILIES[row.id]) return;
      const distance = (x - cx) ** 2 + (y - cy) ** 2;
      if (!nearest || distance < nearest.distance) nearest = { distance, kinds: BUILDING_FAMILIES[row.id] };
    });
    return nearest?.kinds || null;
  }
  // Finite optional surface sites — a wetland's HUNGRY MARSH, a rock
  // outcrop's ORC STRONGHOLD: one owner per sub-tile block, each a LAIR
  // CANDIDATE (entry.streetLairs — the barricade's lane: { tier, sid, lx, ly })
  // whose garrison is its GROUPS row (lairs.js HABITAT_TIER_GUARDS: marsh /
  // stronghold), so it shares the garrison lifecycle — the wake ring, the
  // mode's guard cap, the kerb-aware seat rule, the quiet home and the safe
  // area — instead of seating its own. The sites are recorded on the entry
  // (variantAt reads their theme by radius). No rewards or background
  // objects are added. Returns the candidates; a caller that hands in the
  // entry's streetLairs list gets them pushed there too.
  const HABITAT_TIER = { hungry_marsh: 'habitat_marsh', orc_stronghold: 'habitat_stronghold' };
  function habitatLairs(entry, tx, ty) {
    const WG = root.WorldGen, N = entry.cellsPerEdge, grid = entry.baseGrid || entry.grid;
    const cellM = entry.tileEdgeM / N, sites = [], lairs = [];
    for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) {
      const id = WG.cellId('habitat_surface', tx, ty, bx, by);
      if (unit(id + ':present') >= .18) continue;
      const cx = Math.floor((bx + .5) * N / 4), cy = Math.floor((by + .5) * N / 4);
      const land = root.Zones?.landAt ? root.Zones.landAt(grid, entry.zone?.under, cy * N + cx) : grid[cy * N + cx];
      const theme = land === WG.T.WETLAND ? 'hungry_marsh' : land === WG.T.ROCK ? 'orc_stronghold' : null;
      if (!theme || WG.variantOwnerAt(entry, cy * N + cx)) continue;
      sites.push({ id, theme, cx, cy, radiusCells: 7 });
      lairs.push({ tier: HABITAT_TIER[theme], sid: id, lx: (cx + .5) * cellM, ly: (cy + .5) * cellM });
    }
    entry.habitatSites = sites;
    if (Array.isArray(entry.streetLairs)) entry.streetLairs.push(...lairs);
    return lairs;
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
    const opts = { roadMask: null, spawnWhy: entry.spawnWhy, occupied, pois: [] }, out = [];
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
        // Room: the whole 3 × 3 is open cave floor.
        if (WG.boxCells(N, N, x, y, 1, (nx, ny, i) => grid[i] !== WG.T.CAVE_FLOOR
          || !WG.isSpawnCell(grid, N, N, nx, ny, opts, cls))) continue;
        out.push(seatCreature(entry, tx, ty, x, y, 'red_dragon', `dragon_roost_${depth}_${rx}_${ry}`, (wx, wy) => ({
          _cave: true, habitat: 'roost', _habitatRegion: regionId,
          homeX: wx, homeY: wy, shiny: false,
        }), occupied));
        break;
      }
    }
    return out;
  }
  root.EnemyHabitats = { FAMILIES, THEME_BANDS, BUILDING_FAMILIES, CASTLE_FAMILIES, SURFACE_FAMILIES, SURFACE_ENCOUNTERS, HABITAT_TIER,
    unit, caveAt, surfaceAt, surfaceEncounters, surfaceEncountersSteps, variantAt, emergesFromGround, buildingKinds, habitatLairs, caveSites };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.EnemyHabitats;
})(typeof window !== 'undefined' ? window : globalThis);
