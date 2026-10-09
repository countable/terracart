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
    overgrown: ['plant', 'spider'], ordered_graves: ['zombie', 'skeleton', 'skeleton_soldier'],
    stone_garden: ['slime', 'skeleton'],
    silent_circle: ['skeleton', 'skeleton_soldier'], overgrown_graves: ['zombie', 'spider', 'skeleton'],
    broken_masonry: ['club_goblin', 'spear_goblin', 'archer_goblin'],
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
    black_ring: ['skeleton', 'skeleton_soldier'], shellwater_strand: ['giant_crab', 'jellyfish'],
  };
  // One encounter roll per ~84 m square at the usual 7 m cell size.
  // Most are solitary; 25% are pairs and 10% are trios. No per-kind budget.
  const SURFACE_ENCOUNTERS = { blockCells: 12, chance: .6, pairAt: .65, trioAt: .9, tries: 12 };
  // Grove mushrooms roam individually, scattered across smaller patches.
  const SURFACE_ENCOUNTER_PROFILES = {
    mushroom_grove: { ...SURFACE_ENCOUNTERS, blockCells: 6, pairAt: 1, trioAt: 1 },
  };
  // Public rules for the Nexus encounter lane. The existing family rows and
  // per-block frequency profiles remain their single tuning owners.
  const NEXUS_RULES = Object.fromEntries(Object.entries(SURFACE_FAMILIES).map(([id, kinds]) => [id, {
    id, category: 'nexus', allowed: { kinds },
    frequency: SURFACE_ENCOUNTER_PROFILES[id] || SURFACE_ENCOUNTERS,
  }]));
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
    const N = entry.cellsPerEdge, i = cy * N + cx;
    return { theme: variantAt(entry, cx, cy), beach: !!entry.scenic?.shore?.mask?.[i] };
  }

  // Aquatic foes stay in the first water cell alongside walkable land. The
  // same geometry owns generated seats and movement along the water's edge.
  function shoreWater(typeAt, cx, cy) {
    const WG = root.WorldGen;
    return typeAt(cx, cy) === WG.T.WATER && [[-1, 0], [1, 0], [0, -1], [0, 1]]
      .some(([dx, dy]) => { const type = typeAt(cx + dx, cy + dy); return type != null && WG.isWalkable(type); });
  }
  function surfaceSeat(entry, cx, cy, kind, opts) {
    const WG = root.WorldGen, N = entry.cellsPerEdge, grid = entry.baseGrid || entry.grid;
    const movement = root.EnemyRoster.get(kind)?.movement;
    if (!movement?.waterOnly) return root.CreatureSpawns.isSpawnCell(grid, N, N, cx, cy, opts, kind) ? { cx, cy } : null;
    const typeAt = (x, y) => x < 0 || y < 0 || x >= N || y >= N ? null : grid[y * N + x];
    const waterOpts = { ...opts, waterOnly: true };
    // A shore candidate can be several cells inland. Search nearest-first;
    // a denied water seat is lost, never given permission by its dry neighbour.
    const radius = root.Scenic?.SCENIC_SHORE_CELLS || 3;
    for (let r = 0; r <= radius; r++) for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
      if (movement.shoreOnly && !shoreWater(typeAt, x, y)) continue;
      const owner = WG.variantOwnerAt(entry, y * N + x);
      if (owner && !(owner === 'zone' && opts.zoneSlot === entry.zone?.coverage?.[y * N + x])) continue;
      if (root.CreatureSpawns.isSpawnCell(grid, N, N, x, y, waterOpts, kind)) return { cx: x, cy: y };
    }
    return null;
  }
  function surfaceEncounters(entry, tx, ty, occupied) {
    return root.WorldGen.runSteps(surfaceEncountersSteps(entry, tx, ty, occupied));
  }
  // Keep a whole encounter group together, but let the tile builder yield
  // between blocks. Failed placement attempts are work too, including on
  // tiles whose coverage never offers a seat.
  function* surfaceEncountersSteps(entry, tx, ty, occupied) {
    if (!entry.zone?.coverage) return [];
    const themes = [...new Set((entry.zone.anchors || []).map(a => a.variant))]
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
    // Population rolls use coverage before safety exclusions. Legal seats are
    // cached by owning Nexus and kind, then occupied seats are removed at use
    // time. A blocked block can borrow ground from its own Nexus, never another.
    const seats = new Map();
    const seatsFor = (slot, kind) => {
      const key = `${slot}:${kind}`;
      if (seats.has(key)) return seats.get(key);
      const rows = [], seen = new Set();
      for (let i = 0; i < N * N; i++) {
        if (entry.zone.coverage[i] !== slot || WG.variantOwnerAt(entry, i) !== 'zone') continue;
        const seat = surfaceSeat(entry, i % N, Math.floor(i / N), kind,
          { ...opts, occupied: null, zoneSlot: slot });
        if (!seat) continue;
        const at = seat.cy * N + seat.cx;
        if (entry.zone.coverage[at] !== slot || seen.has(at)) continue;
        seen.add(at); rows.push(seat);
      }
      seats.set(key, rows); return rows;
    };
    for (let by = 0; by < N; by += cfg.blockCells) for (let bx = 0; bx < N; bx += cfg.blockCells) {
      yield 'spawn habitat encounter blocks';
      const id = WG.cellId(theme ? `zone_encounter_${theme}` : 'zone_encounter', tx, ty, bx, by);
      if (unit(id + ':present') >= cfg.chance) continue;
      const coverage = [];
      for (let y = by; y < Math.min(N, by + cfg.blockCells); y++)
        for (let x = bx; x < Math.min(N, bx + cfg.blockCells); x++) {
          const slot = entry.zone.coverage[y * N + x];
          const variant = entry.zone.anchors[slot - 1]?.variant;
          if (slot && SURFACE_FAMILIES[variant]
              && (SURFACE_ENCOUNTER_PROFILES[variant] ? variant : null) === theme)
            coverage.push({ cx: x, cy: y, slot, zoneVariant: variant });
        }
      if (!coverage.length) continue;
      const owner = coverage[Math.floor(unit(id + ':owner') * coverage.length)];
      const { slot, zoneVariant } = owner;
      const rule = NEXUS_RULES[zoneVariant];
      const kinds = rule.allowed.kinds.filter(kind => {
        const row = root.EnemyRoster.get(kind);
        return row?.surface && !row.retired && row.tier <= 3;
      });
      if (!kinds.length) continue;
      const count = root.CreatureSpawns.frequencyCount({ pairAt: cfg.pairAt, trioAt: cfg.trioAt }, () => unit(id + ':size'));
      // Member n of this group: its kind, its seat, its body — the base
      // members below and a party's extras (scaleEncounters) alike.
      const group = { anchor: null };
      const member = n => ({ kind: root.CreatureSpawns.pickWeighted(kinds, unit(`${id}:${n}:kind`), () => 1), id: `${id}_${n}` });
      const seatFor = (taken, anchorOf) => ({ kind }, n) => {
          const rows = seatsFor(slot, kind).filter(p => !taken(p.cy * N + p.cx));
          if (!rows.length) return null;
          const anchor = anchorOf.anchor;
          const origin = anchor || owner;
          // Prefer nearby legal ground so ordinary groups stay together. Distance
          // bands retain variety instead of always filling the same nearest cell.
          const distance = p => Math.max(Math.abs(p.cx - origin.cx), Math.abs(p.cy - origin.cy));
          let radius = 2;
          let nearby = anchor ? rows.filter(p => distance(p) <= radius)
            : rows.filter(p => p.cx >= bx && p.cx < bx + cfg.blockCells
              && p.cy >= by && p.cy < by + cfg.blockCells);
          if (!nearby.length) {
            radius = Math.min(...rows.map(distance));
            nearby = rows.filter(p => distance(p) === radius);
          }
          const seat = nearby[Math.floor(unit(`${id}:${n}:seat`) * nearby.length)];
          anchorOf.anchor ||= seat;
          return seat;
        };
      const create = (claimed) => ({ kind, id: memberId }, seat) => seatCreature(entry, tx, ty, seat.cx, seat.cy, kind, memberId, (x, y) => ({
          zoneVariant, shiny: false,
          ...root.EnemySpawns.concealment(kind, memberId, zoneVariant),
          ...(emergesFromGround(kind, zoneVariant)
            ? { emergeFromGround: true, _burrowed: true } : {}),
          _surfaceSpawn: { x, y, tx, ty, cx: seat.cx, cy: seat.cy },
        }), claimed);
      out.push(...yield* root.CreatureSpawns.generateSteps(rule, {
        count, member, seat: seatFor(i => occupied.has(i), group), create: create(occupied),
      }));
      // A PARTY'S EXTRAS (scaleEncounters) are this group's members n ≥ count,
      // made by the same member / seat / create, against the tile's finished
      // generated occupancy (`occupied`, complete once the pass is over) plus
      // the group's own extras — never another group's, whose extras may
      // arrive in any order — so every device seats extra n on the same cell.
      if (count >= 1) groupsOf(entry).push({
        id, count, baseKind: member(0).kind, players: 1, extras: 0, elite: false, seated: new Set(),
        extra(n) {
          // Extras come in n order on every device, so they share one anchor.
          const anchorOf = this.anchorOf ||= { anchor: group.anchor };
          const own = this.seated;
          const m = member(n);
          const seat = seatFor(i => occupied.has(i) || own.has(i), anchorOf)(m, n);
          return seat ? create(own)(m, seat) : null;
        },
      });
    }

    return out;
  }

  // ── MORE PLAYERS, BIGGER GROUPS ─────────────────────────────────────────
  // A zone encounter group (surfaceEncounterProfileSteps) grows with the
  // number of players fighting near it, on each player's device: Multiplayer
  // counts P (this player plus peers near on this depth) and calls
  // scaleEncounters; offline P = 1 and nothing here runs. Only these groups
  // scale: a garrison has its own authored size (Lairs.GROUPS), a cave pack
  // or roamer is placed by the cave pass's two-step canonical seating, and
  // ghosts and other per-device mints are not shared at all.
  //   A group of c ≥ 2 grows to c × (1 + PARTY_GROWTH × (P − 1)), its
  // fraction rounded up when unit(`${id}:mp:${P}`) falls under it. A single
  // (c = 1) draws once per extra player k: under PARTY_ELITE_CHANCE on
  // unit(`${id}:mp:${k}`) it becomes an elite (the shiny flag and its rank
  // roll, Combat.rollEliteRank — the world's own elite) if it is not one
  // already and its kind may be; otherwise it gains a member. Every draw is
  // off the group id, so devices that agree on P agree on everything.
  //   STICKY: a group remembers the most players it has seen while its tile
  // is loaded and never shrinks — extras do not vanish when a friend steps
  // away mid-fight. A rebuilt tile is a new entry and starts again.
  const PARTY_GROWTH = 0.5;
  const PARTY_ELITE_CHANCE = 0.5;
  // Group records live beside the entry, not on it: the tile cache may be
  // serialised, and a record holds the group's seating closures.
  const GROUP_RECORDS = new WeakMap();
  function groupsOf(entry) {
    let list = GROUP_RECORDS.get(entry);
    if (!list) GROUP_RECORDS.set(entry, list = []);
    return list;
  }
  // The size a group of base `count` (its first member `kind`) reaches with
  // `players` players (pure).
  function partySize(id, count, players, kind) {
    if (!(players > 1)) return count;
    if (count < 2) return count + singleDraws(id, kind, players).extras;
    const exact = count * (1 + PARTY_GROWTH * (players - 1));
    const whole = Math.floor(exact);
    return whole + (unit(`${id}:mp:${players}`) < exact - whole ? 1 : 0);
  }
  // A single's draws for players 2..P: { elite, extras } (pure). `kind`
  // decides whether an upgrade is possible at all.
  function singleDraws(id, kind, players) {
    const C = root.Combat;
    const eligible = typeof kind === 'string' && !!C && C.isEnemyKind(kind) && C.monster(kind)?.eliteEligible !== false;
    let elite = false, extras = 0;
    for (let k = 1; k < players; k++) {
      if (unit(`${id}:mp:${k}`) < PARTY_ELITE_CHANCE && !elite && eligible) elite = true;
      else extras++;
    }
    return { elite, extras };
  }
  // Grow every group on `entry` to `players` (a number or per-group resolver,
  // sticky). Returns the NEW
  // creatures to add (shared-marked, minus `caught`; ids `${group}_${n}`
  // continuing the numbering) and the base members upgraded to elite in place.
  function scaleEncounters(entry, players, caught) {
    const added = [], upgraded = [];
    for (const g of GROUP_RECORDS.get(entry) || []) {
      const size = typeof players === 'function' ? players(g) : players;
      if (!Number.isInteger(size) || !(size > g.players)) continue;
      g.players = size;
      let want;
      if (g.count >= 2) want = partySize(g.id, g.count, size) - g.count;
      else {
        const base = (entry.creatures || []).find(c => c.id === `${g.id}_0`);
        const draws = singleDraws(g.id, g.baseKind, size);
        want = draws.extras;
        if (draws.elite && !g.elite) {
          g.elite = true;
          if (base && !base.shiny && !caught?.has(base.id)) { upgradeElite(base); upgraded.push(base); }
        }
      }
      for (let n = g.count + g.extras; n < g.count + want; n++) {
        g.extras++;
        const c = g.extra(n);
        if (!c) continue;
        if (caught?.has(c.id)) continue;
        added.push(root.EnemySpawns.markShared(c));
      }
    }
    return { added, upgraded };
  }
  // The world's elite, granted: the shiny flag and the rank its id rolls
  // (worldgen.js makeCreature's own roll), its wounds kept as a share.
  function upgradeElite(c) {
    const C = root.Combat;
    const before = C.maxHp(c), hp = c._hp;
    c.shiny = true;
    const rank = C.rollEliteRank(c.kind, c.id);
    if (rank) c.eliteRank = rank;
    if (Number.isFinite(hp)) c._hp = Math.max(1, Math.round(hp * C.maxHp(c) / before));
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
  root.EnemyHabitats = { FAMILIES, THEME_BANDS, BUILDING_FAMILIES, CASTLE_FAMILIES, SURFACE_FAMILIES, SURFACE_ENCOUNTERS, SURFACE_ENCOUNTER_PROFILES, NEXUS_RULES, HABITAT_TIER,
    unit, caveAt, surfaceAt, shoreWater, surfaceSeat, surfaceEncounters, surfaceEncountersSteps, variantAt,
    PARTY_GROWTH, PARTY_ELITE_CHANCE, partySize, singleDraws, scaleEncounters, groupsOf, emergesFromGround, buildingKinds, habitatLairs, caveSites };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.EnemyHabitats;
})(typeof window !== 'undefined' ? window : globalThis);
