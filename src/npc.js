// Seeded neighbours. Identity is world data; conversation rotates by UTC day.
// Keep this stream separate from fauna so adding people never moves animals.
const NPC = (() => {
  // Residents an inhabited tile draws (bounded attempts below keep a sparse
  // tile cheap). Far residents cost the sim loop one distance check a frame
  // (scene_creatures.js wanderCreatures) and the draw a viewport cull, so a
  // tile of fifty is a few hundred multiply-adds — the NPC count is not a
  // frame budget. Was 40 (Sep 2026: more neighbours, more to say).
  const COUNT = 50;
  // ROLES are what a neighbour has to say when tapped (dialogue below): the
  // scout points at things, the scholar reads the Book, merchant and trader
  // sell, the MASON talks wrecks off the restoration ledger, the LAMPLIGHTER
  // reads the street-lamp ledger, the KEEPER tells the story of the zone it
  // stands in (Zones.ZONE_KINDS[kind].keeper — the zone row owns its copy).
  // The story neighbours by the starting trailer (STORY_ROLES) are placed,
  // not drawn, and speak through MemoryStory.npcDialogue.
  const PROFILES = {
    village: { prefixes: ['Al', 'Bel', 'Mar', 'Ros'], roots: ['an', 'ell', 'in', 'or'], suffixes: ['a', 'en', 'ie', 'wyn'], colors: [0xe8bb91, 0xbfc8ee, 0xeeb3cb], roles: ['scout', 'scout', 'scout', 'scout', 'merchant', 'merchant', 'trader', 'trader', 'trader', 'scholar', 'mason', 'lamplighter'], theme: 'supply' },
    farm: { prefixes: ['Br', 'Fen', 'Haz', 'Row'], roots: ['am', 'ell', 'in', 'or'], suffixes: ['a', 'en', 'ie', 'wyn'], colors: [0xdec58d, 0xe9ba96, 0xc6ce9c], roles: ['scout', 'scout', 'merchant', 'trader', 'mason'], theme: 'seed' },
    market: { prefixes: ['Cal', 'Dar', 'Mer', 'Val'], roots: ['an', 'ell', 'in', 'or'], suffixes: ['a', 'en', 'ie', 'is'], colors: [0xe7b1d8, 0xaacde9, 0xe5d593], roles: ['merchant', 'trader', 'merchant', 'scout', 'mason', 'lamplighter'], theme: 'supply' },
    woodland: { prefixes: ['Syl', 'Lin', 'Fa', 'El'], roots: ['ar', 'eth', 'ir', 'ow'], suffixes: ['a', 'iel', 'en', 'yn'], colors: [0xacc79a, 0xc3bf8c, 0xa4c8bd], roles: ['scout', 'scout', 'scout', 'scout', 'scout', 'trader', 'trader', 'trader', 'trader', 'scholar'], theme: 'seed' },
    shrine: { prefixes: ['Ae', 'Eli', 'Gala', 'Syl'], roots: ['lan', 'riel', 'thar', 'wen'], suffixes: ['iel', 'ia', 'eth', 'wyn'], colors: [0x70cf86, 0x87db96, 0x59bc78, 0x9bdd7f], roles: ['scout', 'scout', 'scholar', 'trader', 'keeper', 'keeper'], theme: 'potion' },
    // The fox people of the groves (Oct 2026, owner's call): their own zone
    // and role names, so they never read as the shrine's neighbours.
    grove: { prefixes: ['Ru', 'Vix', 'Tod', 'Sor'], roots: ['an', 'el', 'in', 'ow'], suffixes: ['a', 'en', 'ie', 'y'], colors: [0xe0b48a, 0xd9a77c, 0xe8c49b], roles: ['scout', 'scout', 'scholar', 'trader', 'keeper', 'keeper'], theme: 'potion' },
  };
  // Every zone labels every role: a keeper reseated by the zone guarantee in
  // spawn(), or a role added to one profile later, must never title as
  // "undefined".
  const LABELS = {
    village: { scout: 'Wayfinder', scholar: 'Storykeeper', merchant: 'Peddler', trader: 'Barterer', mason: 'Mason', lamplighter: 'Lamplighter', keeper: 'Keeper' },
    farm: { scout: 'Fieldwalker', scholar: 'Almanac Keeper', merchant: 'Seed Seller', trader: 'Harvest Trader', mason: 'Barn Raiser', lamplighter: 'Lamplighter', keeper: 'Keeper' },
    market: { scout: 'Town Guide', scholar: 'Scribe', merchant: 'Peddler', trader: 'Market Trader', mason: 'Stonemason', lamplighter: 'Lamplighter', keeper: 'Keeper' },
    woodland: { scout: 'Ranger', scholar: 'Lorekeeper', merchant: 'Herbalist', trader: 'Forager', mason: 'Woodwright', lamplighter: 'Lamplighter', keeper: 'Grove Keeper' },
    shrine: { scout: 'Shrine Warden', scholar: 'Shrine Lorekeeper', merchant: 'Herbalist', trader: 'Shrine Trader', mason: 'Shrine Mason', lamplighter: 'Lantern Keeper', keeper: 'Shrine Keeper' },
    grove: { scout: 'Fox Tracker', scholar: 'Fox Storyteller', merchant: 'Fox Herbalist', trader: 'Fox Trader', mason: 'Den Builder', lamplighter: 'Fox Lantern Bearer', keeper: 'Den Keeper' },
  };
  function identity(id, zone = 'village') {
    if (!PROFILES[zone]) zone = 'village';
    const p = PROFILES[zone], rng = WorldGen.makeRng(fnv1a(`${id}:identity:${zone}`));
    const pick = a => a[Math.floor(rng() * a.length)];
    const name = pick(p.prefixes) + pick(p.roots) + pick(p.suffixes);
    const role = pick(p.roles);
    return { name, role, zone, roleLabel: LABELS[zone][role], npcVariant: Math.floor(rng() * 3), tint: pick(p.colors), shopTheme: p.theme };
  }
  function zoneFor(type, nearShrine = false, influence = null) {
    const T = WorldGen.T;
    // Zone influence also covers ground that the halo cannot repaint.
    // Hostile yards stay empty even when a shrine stands nearby.
    if (type === T.TAR_YARD || influence?.kind === 'tar') return null;
    if (type === T.GROVE || influence?.kind === 'grove') return 'grove';
    if (nearShrine || type === T.CHURCHYARD || influence?.kind === 'stones') return 'shrine';
    if (type === T.RESIDENTIAL || type === T.SCHOOL) return 'village';
    if (type === T.FARMLAND || type === T.ORCHARD) return 'farm';
    if (type === T.COMMERCIAL) return 'market';
    if (type === T.PARK) return 'woodland';
    return null;
  }
  function isShrine(o) {
    return o.kind === 'shrine' || o.kind === 'grove_shrine' || o.poiClass === 'place_of_worship' || o.role === 'wizard';
  }
  function spawn(scene, entry, tx, ty, opts) {
    const N = entry.cellsPerEdge, cellM = scene.tileEdgeM / N;
    const grid = entry.baseGrid || entry.grid;
    const objects = entry.genObjects || entry.objects || [];
    const shrines = objects.filter(isShrine);
    const rng = WorldGen.makeRng(fnv1a(`npc:${tx}:${ty}`));
    const result = [], used = new Set();
    // Bounded attempts keep sparse/water tiles cheap. Uninhabited terrain
    // stays empty; shrine surroundings are the exception, within six cells.
    for (let attempt = 0; attempt < COUNT * 30 && result.length < COUNT; attempt++) {
      let cx = Math.floor(rng() * N), cy = Math.floor(rng() * N);
      // Sample around landmarks too: a small shrine grove should not need
      // to win a lottery against an entire kilometre-wide tile.
      if (shrines.length && attempt % 5 === 0) {
        const anchor = shrines[Math.floor(rng() * shrines.length)];
        cx = Math.floor((anchor.x / scene.tileEdgeM - tx) * N) + Math.floor(rng() * 11) - 5;
        cy = Math.floor((anchor.y / scene.tileEdgeM - ty) * N) + Math.floor(rng() * 11) - 5;
      }
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
      const idx = cy * N + cx;
      if (used.has(idx)) continue;
      const x = (tx + (cx + 0.5) / N) * scene.tileEdgeM;
      const y = (ty + (cy + 0.5) / N) * scene.tileEdgeM;
      const shrine = shrines.some(o => Math.hypot(o.x - x, o.y - y) <= cellM * 6);
      const influence = typeof Zones !== 'undefined' ? Zones.at(entry, cx, cy) : null;
      const zone = zoneFor(grid[idx], shrine, influence);
      // A villager is someone a player walks up to (a shop, the day's talk):
      // an 'npc' spawn (the spawn gate) — by the houses is fine, not on school
      // or sensitive ground, not in a field.
      if (!zone || !WorldGen.isSpawnCell(grid, N, N, cx, cy, opts, 'npc')) continue;
      used.add(idx);
      const id = `npc_${tx}_${ty}_${cx}_${cy}`;
      // zoneKind: the named zone (Zones.ZONE_KINDS) the resident stands in,
      // if any — what a keeper tells the story of.
      result.push(WorldGen.makeCreature('npc', x, y, id, { ...identity(id, zone), zoneKind: influence?.kind || null, homeX: x, homeY: y }));
    }
    seatKeepers(result);
    return result;
  }
  // EVERY NAMED ZONE WITH RESIDENTS HAS A KEEPER: the zone's story should not
  // depend on the role lottery. The first shrine-profile resident drawn on
  // each zone kind (the draw order above is seeded, so the same one every
  // build, for every player) becomes its keeper when the roll seated none.
  function seatKeepers(people) {
    const kept = new Set(people.filter(c => c.role === 'keeper' && c.zoneKind).map(c => c.zoneKind));
    for (const c of people) {
      if (!c.zoneKind || kept.has(c.zoneKind) || (c.zone !== 'shrine' && c.zone !== 'grove')) continue;
      c.role = 'keeper'; c.roleLabel = LABELS[c.zone].keeper;
      kept.add(c.zoneKind);
    }
  }
  // Restoration is a per-save overlay, like the shrine itself. Give it a
  // separate per-house stream: restoring a shrine cannot reroll neighbours.
  function shrineResidents(scene, entry, tx, ty) {
    const N = entry.cellsPerEdge, cellM = scene.tileEdgeM / N;
    const grid = entry.baseGrid || entry.grid;
    const people = entry.creatures || (entry.creatures = []);
    const ids = new Set(people.map(c => c.id));
    for (const house of entry.objects || []) {
      if (house.kind !== 'house' || scene.houseShopRole?.(house) !== 'wizard') continue;
      const rng = WorldGen.makeRng(fnv1a(`npc:shrine:${house.id}`));
      const used = new Set();
      for (let attempt = 0; attempt < 120 && used.size < 4; attempt++) {
        const cx = Math.floor((house.x / scene.tileEdgeM - tx) * N) + Math.floor(rng() * 11) - 5;
        const cy = Math.floor((house.y / scene.tileEdgeM - ty) * N) + Math.floor(rng() * 11) - 5;
        if (cx < 0 || cy < 0 || cx >= N || cy >= N || used.has(cy * N + cx)) continue;
        const influence = typeof Zones !== 'undefined' ? Zones.at(entry, cx, cy) : null;
        if (!zoneFor(grid[cy * N + cx], true, influence)) continue;
        if (!WorldGen.isSpawnCell(grid, N, N, cx, cy, entry._spawnOpts, 'npc')) continue;
        used.add(cy * N + cx);
        const id = `npc_shrine_${house.id}_${cx}_${cy}`;
        if (ids.has(id)) continue;
        const x = (tx + (cx + 0.5) / N) * scene.tileEdgeM;
        const y = (ty + (cy + 0.5) / N) * scene.tileEdgeM;
        people.push(WorldGen.makeCreature('npc', x, y, id, { ...identity(id, 'shrine'), homeX: x, homeY: y }));
        ids.add(id);
      }
    }
  }
  function restoreShrine(scene, house) {
    const cell = scene.cellAt(house.x, house.y);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(cell.tx, cell.ty));
    if (entry?._spawned && entry._spawnOpts) shrineResidents(scene, entry, cell.tx, cell.ty);
  }
  // A neighbour's stroll: a slow walking pace (m/s, well under the brisk-walk
  // fast-mover line) in short legs, a few seconds' rest between, never more
  // than WANDER_CELLS from where it was seated. It was 0.045 cells/s with up
  // to 16 s rests — about a pixel a second, which read as standing still.
  const WALK_MPS = 0.8;
  const WANDER_CELLS = 4;
  const REST_MS = [2500, 6000];     // [base, spread]
  const REST_MS_AFTER_HIT = 60000;
  const RESTING_LINE = '<em>One hand pressed to the wound, waving you off.</em>\n“I’m all right. Just resting my wounds.”';
  function restore(scene, c) {
    const until = scene.save.npcRestUntil?.[c.id] || 0;
    if (until > (c._npcRestUntilEpoch || 0)) c._npcRestUntilEpoch = until;
    return c;
  }
  function isDormant(c, now = Date.now()) {
    return c?.kind === 'npc' && (c._npcRestUntilEpoch || 0) > now;
  }
  function hit(scene, c, now = Date.now(), damage = Combat.creatureMaxHp('npc')) {
    if (c?.kind !== 'npc') return false;
    restore(scene, c);
    if (isDormant(c, now)) return false;
    if (c._hp <= 0) c._hp = Combat.maxHp(c);
    const lost = Combat.damageDealt(c, damage);
    if (!(lost > 0)) return false;
    if (Combat.hp(c) > 0) return true;
    c._npcRestUntilEpoch = now + REST_MS_AFTER_HIT;
    c._moving = false;
    c._npcSteps = 0;
    const ledger = scene.save.npcRestUntil ||= {};
    for (const id of Object.keys(ledger)) if (ledger[id] <= now) delete ledger[id];
    ledger[c.id] = c._npcRestUntilEpoch;
    if (typeof persistSave === 'function') persistSave(scene.save);
    return true;
  }
  function canTarget(scene, c) {
    if (isDormant(c)) return false;
    const wards = scene._npcWardContext;
    if (wards && wardTrip(c, wards.home, wards.castles, wards.radius2)) return false;
    if (typeof inKerbAt === 'function' && inKerbAt(scene, c.x, c.y)) return false;
    return !scene._nearAny?.('fires', c.x, c.y, FIRE_REST_R);
  }
  // Refresh membership four times a second, not once per enemy per frame.
  // Objects remain live: a moving or newly wounded neighbour is checked at use.
  function prepareTargets(scene, pc, px, py, radius, now) {
    if (scene._npcTargetDepth === scene.depth && now < (scene._npcTargetsNext || 0)) return;
    scene._npcTargetDepth = scene.depth;
    scene._npcTargetsNext = now + 250;
    const targets = scene._npcCombatTargets = [];
    WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, c => {
      if (c.kind === 'npc' && Math.hypot(c.x - px, c.y - py) <= radius + scene.cellM) {
        restore(scene, c); targets.push(c);
      }
    });
  }
  function enemyTarget(scene, enemy, row, px, py, playerHidden) {
    let best = null;
    let d2 = playerHidden ? Infinity : (enemy.x - px) ** 2 + (enemy.y - py) ** 2;
    d2 = Math.min(d2, (row.visionCells * scene.cellM) ** 2);
    for (const c of scene._npcCombatTargets || []) {
      const distance2 = (enemy.x - c.x) ** 2 + (enemy.y - c.y) ** 2;
      if (typeof PotionEffects !== 'undefined' && distance2 > (Math.max(0,
        row.visionCells - PotionEffects.visionReduction(c)) * scene.cellM) ** 2) continue;
      if (distance2 >= d2 || !canTarget(scene, c) || enemySightBlocked(scene, enemy, c.x, c.y)) continue;
      if (!Combat.lineOfFire(enemy.x, enemy.y, c.x, c.y,
        (x, y) => enemySightBlocked(scene, enemy, x, y), scene.cellM)) continue;
      best = c; d2 = distance2;
    }
    return best;
  }
  function tick(scene, c, now, dt) {
    restore(scene, c);
    if (isDormant(c)) { c._moving = false; return; }
    if (c._hp <= 0) c._hp = Combat.maxHp(c);
    // Integrate only active time: returning to a neighbour never jumps them
    // across their old path. Small steps cannot skip a road cell or building.
    dt = Math.min(0.1, Math.max(0, dt));
    c._moving = false;
    if (now < (c._npcRestUntil || 0)) return;
    if (!c._npcRng) c._npcRng = WorldGen.makeRng(fnv1a(`${c.id}:walk`));
    if (!c._npcSteps || c._npcSteps <= 0) {
      const angle = c._npcRng() * Math.PI * 2;
      c._npcDX = Math.cos(angle); c._npcDY = Math.sin(angle);
      c._npcSteps = 2 + c._npcRng() * 5;
      c._startX = c.x; c._startY = c.y;
      c._targetX = c.x + c._npcDX * scene.cellM;
      c._targetY = c.y + c._npcDY * scene.cellM;
    }
    const step = WALK_MPS * dt * (typeof PotionEffects !== 'undefined' ? PotionEffects.speedMul(c) : 1);
    const x = c.x + c._npcDX * step, y = c.y + c._npcDY * step;
    const dest = scene.cellAt(x, y);
    const blocked = !dest.loaded || dest.underRoad || Combat.faunaBlocksCell(dest.type) || WorldGen.isRoadTerrain(dest.type)
      || Math.hypot(x - (c.homeX ?? c.x), y - (c.homeY ?? c.y)) > scene.cellM * WANDER_CELLS;
    if (!blocked) { c.x = x; c.y = y; c._moving = dt > 0; c._faceFlip = c._npcDX < 0; }
    c._npcSteps -= dt;
    if (blocked || c._npcSteps <= 0) {
      c._npcSteps = 0;
      c._npcRestUntil = now + REST_MS[0] + c._npcRng() * REST_MS[1];
      c._moving = false;
    }
  }
  // THE SAFE AREA'S WARDEN — the one placed neighbour (Starter
  // placeSafeAreaWarden), standing by the starting trailer on every save. Its
  // one line is the explanation for EnemySpawns.homeAllows: near Home only
  // weak monsters are ever met, and nobody knows why (the bible: memory 30
  // answers it). The one owner of that sentence; MemoryStory.npcDialogue
  // closes the warden's first talk with it.
  const WARDEN_LINE = '“You picked a good spot. Only the weak things come near here. Nobody knows why.”';
  // THE STORY NEIGHBOURS — placed by the starting trailer (Starter
  // placeSafeAreaWarden seats them in this order, the warden first so its
  // seat never moves). What each says is MemoryStory.npcDialogue's, by act:
  // the WITNESS tells of the night the Warmonger took the roofs, the
  // WANDERER has no home until the next restoration after you meet them,
  // the BELIEVER lauds the wise wizard and the tower that might bring him back.
  // `minMemories` is WHEN each one is here (storyNeighbourDue): on a new save
  // the wanderer, Tilly, is the one neighbour on screen; the others come in
  // as the past does, at that many recovered memories (MemoryStory.total) —
  // the warden at three, the survivor at six, the believer at nine (Oct 2026,
  // owner's call). `arrives: 'rescue'` keeps a row off the trailer: the
  // survivor arrives through StoryEncounters, hunted by a goblin archer, and
  // stays where she was saved. `name` is the character's own; each named
  // neighbour wears its own untinted sheet (SpriteLayout.NPC_SHEETS `role`
  // rows). `artScale` is the row's INSTANCE size
  // (SpriteLayout.creatureInstScale — the sprite, its shadow, the tap box and
  // the bar seats all read it): the wanderer is a child, drawn at
  // CHILD_SCALE of a grown neighbour.
  const CHILD_SCALE = 0.7;
  const STORY_ROLES = {
    warden: { label: 'Warden', name: 'Bryn', art: 'npc_bryn', minMemories: 3 },
    witness: { label: 'Survivor', name: 'Maud', art: 'npc_maud', minMemories: 6, arrives: 'rescue' },
    wanderer: { label: 'Wanderer', name: 'Tilly', art: 'npc_tilly', housedArt: 'npc_tilly_happy', artScale: CHILD_SCALE, minMemories: 0 },
    believer: { label: 'Believer', name: 'Edda', art: 'npc_edda', minMemories: 9 },
    archaeologist: { label: 'Dragon Archaeologist', name: 'Orrin', art: 'npc_orrin', minMemories: 0, radiusM: 250 },
  };
  const STORY_NEIGHBOURS = Object.keys(STORY_ROLES);
  function storyNeighbour(id, role) {
    const row = STORY_ROLES[role];
    return { ...identity(id, 'village'), ...(row?.name ? { name: row.name } : {}), role, roleLabel: row?.label || 'Neighbour', ...(row?.artScale ? { artScale: row.artScale } : {}) };
  }
  function warden(id) { return storyNeighbour(id, 'warden'); }
  function memoriesOf(save) {
    return typeof MemoryStory !== 'undefined' ? MemoryStory.total(save) : Object.keys(save?.discovered || {}).length;
  }
  function storyNeighbourDue(save, role) {
    return memoriesOf(save) >= (STORY_ROLES[role]?.minMemories ?? 0);
  }

  // THE PEOPLE COME BACK AS THE PAST DOES (Sep 2026, owner's call). A tile's
  // residents are still drawn in full by spawn() — the same people on the
  // same seats for every player — but at the start of a save none of them
  // is about: Tilly by the trailer is the one neighbour on screen. They
  // RETURN as memories are recovered, RETURN_PER_MEMORY of the tile's draw
  // order per memory (returnedCount), and a returning resident does not go
  // back to its old seat: it lingers where there is something to come back
  // to — inside Home's ring (scene.inHomeRing, the quiet ground the warden
  // explains) or within LINGER_CELLS of a RESTORED house (the restoration
  // ledger, save.restoredHouses). On a tile with neither, nobody returns.
  // A named zone's KEEPER never left (stayers: the first keeper the draw
  // seats on each zone kind — the one seatKeepers guarantees — keeps its
  // seat and its story: "the fire took the roofs, not the stone"); the
  // wizard tower's shrine neighbours arrive with its restoration (shrineResidents).
  // Arrivals are seated only OFF SCREEN
  // (tickArrivals), so a neighbour is found on the doorstep, never seen to
  // appear on it. The seat is drawn on the resident's own stream
  // (`<id>:return`), so a given ledger seats a given person on one cell.
  const RETURN_PER_MEMORY = 2;
  const LINGER_CELLS = WANDER_CELLS;
  const ARRIVALS_MS = 2000;
  function returnedCount(save) { return memoriesOf(save) * RETURN_PER_MEMORY; }
  function stayers(residents) {
    const kept = new Set(), ids = new Set();
    for (const c of residents) {
      if (c.role !== 'keeper' || !c.zoneKind || kept.has(c.zoneKind)) continue;
      kept.add(c.zoneKind); ids.add(c.id);
    }
    return ids;
  }
  // What a returning resident can come back to on this tile: Home, and the
  // restored houses, in a stable order (Home first, then by id).
  function anchorsIn(scene, entry, tx, ty) {
    const tx0 = tx * scene.tileEdgeM, ty0 = ty * scene.tileEdgeM;
    const inside = (x, y) => x >= tx0 && x < tx0 + scene.tileEdgeM && y >= ty0 && y < ty0 + scene.tileEdgeM;
    const anchors = [];
    const home = scene.homeWorldPos?.();
    if (home && inside(home.x, home.y)) anchors.push({ key: '', x: home.x, y: home.y, home: true });
    for (const o of (entry.objects || [])) {
      if (o.kind !== 'house' || !scene.save.restoredHouses?.[o.id] || (home && o.id === home.id)) continue;
      anchors.push({ key: String(o.id), x: o.x, y: o.y, home: false });
    }
    anchors.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return anchors;
  }
  function lingerSeat(scene, entry, tx, ty, r, anchors, occupied, spawnOpts) {
    const N = entry.cellsPerEdge, cellM = scene.tileEdgeM / N;
    const tx0 = tx * scene.tileEdgeM, ty0 = ty * scene.tileEdgeM;
    const rng = WorldGen.makeRng(fnv1a(`${r.id}:return`));
    const a = anchors[Math.floor(rng() * anchors.length)];
    const ax = Math.floor((a.x - tx0) / cellM), ay = Math.floor((a.y - ty0) / cellM);
    const cells = [];
    for (let cy = ay - LINGER_CELLS; cy <= ay + LINGER_CELLS; cy++) {
      for (let cx = ax - LINGER_CELLS; cx <= ax + LINGER_CELLS; cx++) {
        if (cx < 0 || cy < 0 || cx >= N || cy >= N || (cx === ax && cy === ay) || occupied.has(cx + ',' + cy)) continue;
        if (Combat.faunaBlocksCell(entry.grid[cy * N + cx])) continue;
        if (!WorldGen.isSpawnCell(entry.grid, N, N, cx, cy, spawnOpts, 'npc')) continue;
        const x = tx0 + (cx + 0.5) * cellM, y = ty0 + (cy + 0.5) * cellM;
        if (a.home && scene.inHomeRing && !scene.inHomeRing(x, y)) continue;
        cells.push({ x, y, cx, cy });
      }
    }
    return cells.length ? cells[Math.floor(rng() * cells.length)] : null;
  }
  // Seat the residents of `entry` that are due and not yet about. Idempotent
  // by id; returns the newcomers. `opts.offscreen(x, y)` may refuse a seat the
  // player would watch fill (tickArrivals passes it; a tile just spawned has
  // no such worry and passes none).
  function arrivals(scene, entry, tx, ty, residents = entry?._residents, opts = {}) {
    if (!entry || !entry.grid || !entry._spawned || !Array.isArray(residents)) return [];
    const N = entry.cellsPerEdge, cellM = scene.tileEdgeM / N;
    const tx0 = tx * scene.tileEdgeM, ty0 = ty * scene.tileEdgeM;
    const people = entry.creatures || (entry.creatures = []);
    const present = new Set(people.map(c => c.id));
    const cellKey = (x, y) => Math.floor((x - tx0) / cellM) + ',' + Math.floor((y - ty0) / cellM);
    const occupied = new Set();
    for (const o of (entry.objects || [])) occupied.add(cellKey(o.x, o.y));
    for (const w of (entry.wildplants || [])) occupied.add(cellKey(w.x, w.y));
    for (const c of people) occupied.add(cellKey(c.x, c.y));
    const due = returnedCount(scene.save), stayed = stayers(residents);
    const spawnOpts = entry._spawnOpts || { roadMask: entry.roadMask, spawnWhy: entry.spawnWhy };
    let anchors = null;
    const added = [];
    residents.forEach((r, i) => {
      if (present.has(r.id)) return;
      let seat;
      if (stayed.has(r.id)) seat = { x: r.x, y: r.y };
      else {
        if (i >= due) return;
        if (!anchors) anchors = anchorsIn(scene, entry, tx, ty);
        if (!anchors.length) return;
        seat = lingerSeat(scene, entry, tx, ty, r, anchors, occupied, spawnOpts);
        if (!seat) return;
      }
      if (opts.offscreen && !opts.offscreen(seat.x, seat.y)) return;
      const c = { ...r, x: seat.x, y: seat.y, homeX: seat.x, homeY: seat.y };
      people.push(c);
      present.add(c.id);
      occupied.add(cellKey(c.x, c.y));
      added.push(c);
    });
    return added;
  }
  // Is the world point out of the player's sight — past the viewport's half
  // width, plus a cell — so a neighbour seated there is found, not watched
  // appearing? A scene with no viewport (a test) hides nothing.
  function offscreenAt(scene) {
    if (!(scene.viewSize > 0) || !(scene.mPerPx > 0) || !scene.playerM || !scene.startWorldM) return () => true;
    const half = (scene.viewSize / 2) * scene.mPerPx + scene.cellM;
    const px = scene.startWorldM.x + scene.playerM.x, py = scene.startWorldM.y + scene.playerM.y;
    return (x, y) => Math.max(Math.abs(x - px), Math.abs(y - py)) > half;
  }
  // The arrivals pass (app.js update, on the modal-gate cadence): every
  // surface tile that has spawned seats whoever is due since — a memory
  // recovered, a house restored — off screen; the starter tile also seats
  // the story neighbours that are due (Starter.placeSafeAreaWarden).
  function tickArrivals(scene, now = Date.now()) {
    if ((scene.depth || 0) !== 0 || now < (scene._npcArrivalsNext || 0)) return 0;
    scene._npcArrivalsNext = now + ARRIVALS_MS;
    const offscreen = offscreenAt(scene);
    let n = 0;
    for (const entry of WorldGen.tileCacheFor(0).values()) {
      const at = entry?._residentsTile;
      if (!at || !entry._spawned || !entry.grid) continue;
      n += arrivals(scene, entry, at.tx, at.ty, entry._residents, { offscreen }).length;
      if (entry._starterTile && typeof Starter !== 'undefined') n += Starter.placeSafeAreaWarden(scene, entry, at.tx, at.ty, { offscreen }) | 0;
    }
    if (typeof Starter !== 'undefined') n += Starter.placeDistantStoryNeighbours(scene, { offscreen }) | 0;
    return n;
  }
  // Where a thing stands, from the speaker: compass point and paces (a pace
  // is three quarters of a metre; the scout, the mason and the keeper share it).
  function whereabouts(c, o, d) {
    const angle = (Math.atan2(o.y - c.y, o.x - c.x) * 180 / Math.PI + 450) % 360;
    const dir = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(angle / 45) % 8];
    return `about ${Math.max(1, Math.round(d / 0.75))} paces ${dir} of here`;
  }
  // The nearest wreck still waiting (Houses.isHouseWreck — the one wreck
  // verdict) within a walk of the speaker, or null.
  function nearestWreck(scene, c, radius = 250) {
    if (typeof Houses === 'undefined') return null;
    let best = null;
    for (const entry of WorldGen.tileCache.values()) WorldGen.forEachItemInBox(entry, 'objects', c.x - radius, c.y - radius, c.x + radius, c.y + radius, o => {
      if (!Houses.isHouseWreck(scene.save, o)) return;
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      if (d <= radius && (!best || d < best.d || (d === best.d && String(o.id) < String(best.o.id)))) best = { o, d };
    });
    return best;
  }
  const KEEPER_DEFAULT = [
    '<em>Does not stop sweeping.</em>\n“This shrine is older than the town. The Breaking never touched it. I sweep the step each morning and light the lantern each night. Someone has to.”',
    '“The Breaking took the roofs, not the stone. Someone has to keep the old places, so I do.”',
  ];
  // NEIGHBOUR COPY (CLAUDE.md, Dialogs): spoken words in curly quotes, an
  // action in <em> on its own line, the body HTML (showMessageModal), the
  // vocabulary the story bible's (the Breaking, fifty years, the road as safe
  // ground). A talk is PAGES — one dialog each, "Next" between them (interact
  // below) — and `body`, the pages joined, for the one-box readers (the shop
  // blurb via offerArt, the tests). A wait a neighbour SAYS is spokenDuration.
  function talkOf(title, pages) {
    pages = (Array.isArray(pages) ? pages : [pages]).filter(p => p != null && p !== '');
    return { title, pages, body: pages.join('\n\n') };
  }
  // What the scout saw, by what it was; `where` is whereabouts() below.
  const SIGHTINGS = {
    shrine: where => `“A shrine, ${where}. The Breaking never touched it.”`,
    chest: where => `“A chest, ${where}. Nobody has touched it since the Breaking.”`,
    foe: where => `“Something roams ${where}. Keep to the road if it turns on you.”`,
    elite: where => `“Something big roams ${where}. Keep to the road if it turns on you.”`,
  };
  function dialogue(scene, c, now = Date.now()) {
    const day = utcDayIndex(now), seed = fnv1a(`${c.id}:talk`);
    const title = `${c.name} · ${c.roleLabel || LABELS[c.zone || 'village'][c.role]}`;
    const daily = a => a[((seed + day) >>> 0) % a.length];
    let body, target = null;
    restore(scene, c);
    const story = !isDormant(c, now) && typeof MemoryStory !== 'undefined'
      && MemoryStory.npcDialogue(scene, c);
    if (isDormant(c, now)) {
      body = RESTING_LINE;
    } else if (story) {
      body = story;
    } else if (c.role === 'warden') {
      body = WARDEN_LINE;
    } else if (c.role === 'scholar') {
      body = `<em>Thumbs a scorched page.</em>\n“Listen to this. I read it in a book:”\n“${daily(PLAY_TIPS)}”`;
    } else if (c.role === 'merchant' || c.role === 'trader') {
      body = daily(c.role === 'merchant'
        ? ['<em>Lifts the cloth off the basket.</em>\n“Fresh in this morning, stranger. Have a look.”',
          '“A little stock for the road. The road is the one safe place left, they say.”',
          '<em>Glances at your hood, and says nothing of it.</em>\n“Anything you need before you head out?”']
        : ['<em>Weighs a jar in one hand.</em>\n“Maybe you have what I need, and I you.”',
          '“Fifty years of making do teaches a fair swap. Let us see what we can exchange.”',
          '“A fair trade makes the walk worthwhile.”']);
    } else if (c.role === 'keeper') {
      // The zone row owns its keeper's copy; a keeper off a plain shrine grove
      // (no named zone) has the default lines.
      const row = typeof Zones !== 'undefined' && c.zoneKind ? Zones.ZONE_KINDS[c.zoneKind] : null;
      body = daily(row?.keeper?.length ? row.keeper : KEEPER_DEFAULT);
    } else if (c.role === 'mason') {
      // Off the restoration ledger (save.restoredHouses) and the wreck
      // verdict, never a count of its own.
      const mended = Object.keys(scene.save.restoredHouses || {}).length;
      const wreck = nearestWreck(scene, c);
      const where = wreck ? `“The nearest wreck still waiting is ${whereabouts(c, wreck.o, wreck.d)}.”` : '“No wreck near here still waits, that I know of.”';
      body = (mended
        ? `“${mended === 1 ? 'One roof stands' : `${mended} roofs stand`} again since you came. Fifty years nobody laid a stone here, and then you.”\n<em>Nods up the street.</em>`
        : daily(['<em>Runs a hand along a cracked wall.</em>\n“Every roof on the lane came down in one night. Stone remembers its shape, though. Mend one wreck and the street will follow.”',
          '“Nobody has laid a stone here since the Breaking. The wrecks are waiting for hands.”'])) + '\n' + where;
    } else if (c.role === 'lamplighter') {
      // The living lamps (Streets lampVisits: pruned at LAMP_FADE_MS, so the
      // count is the lamps still burning brighter for the player).
      const lit = Object.keys(scene.save.lampVisits || {}).length;
      const fade = typeof Streets !== 'undefined' && Streets.LAMP_FADE_MS ? spokenDuration(Streets.LAMP_FADE_MS) : 'a day';
      body = lit
        ? `<em>Squints down the lane.</em>\n“${lit === 1 ? 'One lamp burns' : `${lit} lamps burn`} brighter for your passing tonight. Stay away ${fade} and they forget you. Lamps are like that.”`
        : daily(['<em>Taps a dark lamp post.</em>\n“Dark since the Breaking, every one. The roads were spared, but nobody was left to light them. Walk under one. It remembers you.”',
          '“A lamp only wants company. Pass under one and watch what it does.”']);
    } else {
      const radius = 250, candidates = [];
      const sets = spentSets(scene, scene.save), caught = setOf(scene.save.caught || []);
      const add = (o, label) => {
        const d = Math.hypot(o.x - c.x, o.y - c.y);
        if (d <= radius) candidates.push({ o, label, d });
      };
      for (const entry of WorldGen.tileCache.values()) WorldGen.forEachItemInBox(entry, 'objects', c.x - radius, c.y - radius, c.x + radius, c.y + radius, o => {
        if (isShrine(o) || (o.kind === 'house' && scene.houseShopRole(o) === 'wizard')) add(o, 'shrine');
        else if (o.kind === 'chest' && !isSpent(o, sets) && chestLook(o).texKey === 'chest') {
          const cell = scene.cellAt?.(o.x, o.y);
          if (!cell?.loaded || cell.tx == null || !Fog.seen(cell.tx, cell.ty, cell.ix, cell.iy)) add(o, 'chest');
        }
      });
      WorldGen.forEachItem('creatures', o => {
        if (!caught.has(o.id) && Combat.isEnemy(o)) add(o, Combat.isElite(o) ? 'elite' : 'foe');
      });
      candidates.sort((a, b) => String(a.o.id).localeCompare(String(b.o.id)));
      if (candidates.length) {
        const { o, label, d } = daily(candidates);
        target = { targetId: o.id, x: o.x, y: o.y, depth: scene.depth || 0,
          category: label, type: label === 'foe' || label === 'elite' ? 'creature' : 'object' };
        body = `${daily(['<em>Points past the wrecks.</em>', '<em>Nods down the lane.</em>', '<em>Lowers their voice.</em>'])}\n${SIGHTINGS[label](whereabouts(c, o, d))}`;
      } else body = daily(['“Quiet lanes today. Nothing new to show you. Come back tomorrow.”', '<em>Shrugs.</em>\n“Nothing new on this stretch today. Try me tomorrow.”', '“No fresh sightings today. I will keep looking.”']);
    }
    const talk = talkOf(title, body);
    if (target) talk.target = target;
    return talk;
  }
  // Named neighbours share a story painting across every dialogue surface.
  // Other residents use the same RGB multiplication as Phaser's world tint,
  // including alpha, cached on the live NPC rather than a global roster.
  function portrait(scene, c) {
    const row = STORY_ROLES[c.role];
    if (row?.housedArt && typeof MemoryStory !== 'undefined' && MemoryStory.wandererHoused(scene.save, c)) return row.housedArt;
    if (row?.art) return row.art;
    if (c._portrait) return c._portrait;
    const sheet = SpriteLayout.npcSheet(c);
    const source = scene.textures.get(sheet.idle).getSourceImage();
    const sprite = document.createElement('canvas'); sprite.width = 48; sprite.height = 48;
    const ctx = sprite.getContext('2d'); ctx.drawImage(source, 0, 0, 48, 48, 0, 0, 48, 48);
    const pixels = ctx.getImageData(0, 0, 48, 48), tint = sheet.tint ?? c.tint ?? 0xffffff;
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] *= ((tint >> 16) & 255) / 255;
      pixels.data[i + 1] *= ((tint >> 8) & 255) / 255;
      pixels.data[i + 2] *= (tint & 255) / 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const canvas = document.createElement('canvas'); canvas.width = 352; canvas.height = 448;
    const out = canvas.getContext('2d'); out.fillStyle = '#203128'; out.fillRect(0, 0, 352, 448);
    out.imageSmoothingEnabled = false;
    out.drawImage(sprite, 8, 8, 32, 28, 104, sheet.portraitY ?? 12, 144, 126);
    c._portrait = canvas.toDataURL();
    return c._portrait;
  }
  function offerArt(scene, c) {
    if (c?.kind !== 'npc') return {};
    const talk = dialogue(scene, c);
    return { art: portrait(scene, c), title: talk.title, blurb: talk.body };
  }
  function interact(scene, c, sx, sy) {
    // A dialog SHOWN, not merely present: index.html's static overlays
    // (#story, #howto, …) always carry .game-modal and only toggle display,
    // so a presence test swallowed every tap on every neighbour.
    if (scene._dialogOpen?.()) return;
    c._moving = false;
    c._npcRestUntil = performance.now() + 12000;
    const talk = dialogue(scene, c);
    // A talk of several pages is one dialog per page, "Next" between them
    // (the revive panels' pattern, app.js), the same portrait throughout.
    const say = () => {
      if (talk.target && !isDormant(c)) {
        scene.save.wayfarerCompass = { ...talk.target, until: Date.now() + Scenic.TELESCOPE_DURATION_MS };
        persistSave(scene.save);
      }
      const art = portrait(scene, c), pages = talk.pages;
      const show = i => scene.showMessageModal({ title: talk.title, body: pages[i], kind: 'note', art,
        okLabel: i < pages.length - 1 ? 'Next' : 'OK', onDismiss: i < pages.length - 1 ? () => show(i + 1) : undefined });
      show(0);
    };
    if (isDormant(c)) { say(); return; }
    if (c.role === 'archaeologist' && typeof MemoryStory !== 'undefined') {
      const conversation = MemoryStory.archaeologistConversation(scene.save);
      const art = portrait(scene, c);
      let answered = false;
      scene.showChestRewardModal({
        kind: 'note', header: talk.title, name: conversation.title,
        sub: conversation.body, art,
        actions: [
          ...conversation.choices.map(choice => ({
            label: choice.label,
            onClick: () => {
              if (answered) return;
              answered = true;
              const reply = MemoryStory.acknowledgeArchaeologist(scene.save, conversation.id, choice.id);
              if (!reply) return;
              if (typeof persistSave === 'function') persistSave(scene.save);
              scene.showMessageModal({ kind: 'note', title: talk.title, body: reply.body, art });
            },
          })),
          // Leaving or reloading does not consume an introduction or a topic.
          { label: 'Another time', onClick: () => { answered = true; } },
        ],
      });
      return;
    }
    if (typeof StoryEncounters !== 'undefined' && StoryEncounters.interact(scene, c)) return;
    if (c.role !== 'merchant' && c.role !== 'trader') { say(); return; }
    // No per-hour deal cap (shops_math.js header), but a peddling trader
    // rests briefly after a closed deal (ShopsMath.DEAL_COOLDOWN_MS — the same
    // row and number the trader's house flashes in shopInteract), and says
    // the wait in a speaking voice. The deal is banked through recordDeal for
    // the trader's stock turnover and that cooldown.
    const dealWait = ShopsMath.dealWaitMs(scene.save, c, c.role);
    if (dealWait > 0) {
      scene.showMessageModal({ title: talk.title, body: `I have just traded. Come back in ${spokenDuration(dealWait)}.`, art: portrait(scene, c), kind: 'trade' });
      return;
    }
    const record = () => { ShopsMath.recordDeal(scene.save, c); };
    if (c.role === 'trader') scene.presentTraderOffer(sx, sy, c, record);
    else scene.presentThemedShop(sx, sy, c, record);
  }
  return { REST_MS_AFTER_HIT, RESTING_LINE, restore, isDormant, hit, canTarget, prepareTargets, enemyTarget, COUNT, PROFILES, LABELS, WALK_MPS, WANDER_CELLS, WARDEN_LINE, CHILD_SCALE, STORY_ROLES, STORY_NEIGHBOURS, storyNeighbour, warden, storyNeighbourDue, RETURN_PER_MEMORY, LINGER_CELLS, returnedCount, stayers, anchorsIn, arrivals, offscreenAt, tickArrivals, KEEPER_DEFAULT, nearestWreck, identity, zoneFor, spawn, seatKeepers, shrineResidents, restoreShrine, tick, dialogue, portrait, offerArt, interact };
})();
