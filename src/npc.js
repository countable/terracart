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
  };
  // Every zone labels every role: a keeper reseated by the zone guarantee in
  // spawn(), or a role added to one profile later, must never title as
  // "undefined".
  const LABELS = {
    village: { scout: 'Wayfinder', scholar: 'Storykeeper', merchant: 'Peddler', trader: 'Barterer', mason: 'Mason', lamplighter: 'Lamplighter', keeper: 'Keeper' },
    farm: { scout: 'Fieldwalker', scholar: 'Almanac Keeper', merchant: 'Seed Seller', trader: 'Harvest Trader', mason: 'Barn Raiser', lamplighter: 'Lamplighter', keeper: 'Keeper' },
    market: { scout: 'Town Guide', scholar: 'Scribe', merchant: 'Peddler', trader: 'Market Trader', mason: 'Stonemason', lamplighter: 'Lamplighter', keeper: 'Keeper' },
    woodland: { scout: 'Ranger', scholar: 'Lorekeeper', merchant: 'Herbalist', trader: 'Forager', mason: 'Woodwright', lamplighter: 'Lamplighter', keeper: 'Grove Keeper' },
    shrine: { scout: 'Shrine Warden', scholar: 'Elven Lorekeeper', merchant: 'Herbalist', trader: 'Grove Trader', mason: 'Shrine Mason', lamplighter: 'Lantern Keeper', keeper: 'Shrine Keeper' },
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
    if (nearShrine || type === T.GROVE || type === T.CHURCHYARD
      || influence?.kind === 'grove' || influence?.kind === 'stones') return 'shrine';
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
      if (!c.zoneKind || kept.has(c.zoneKind) || c.zone !== 'shrine') continue;
      c.role = 'keeper'; c.roleLabel = LABELS.shrine.keeper;
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
  const RESTING_LINE = "I'm ok, just resting my wounds.";
  function restore(scene, c) {
    const until = scene.save.npcRestUntil?.[c.id] || 0;
    if (until > (c._npcRestUntilEpoch || 0)) c._npcRestUntilEpoch = until;
    return c;
  }
  function isDormant(c, now = Date.now()) {
    return c?.kind === 'npc' && (c._npcRestUntilEpoch || 0) > now;
  }
  function hit(scene, c, now = Date.now()) {
    if (c?.kind !== 'npc') return false;
    restore(scene, c);
    if (isDormant(c, now)) return false;
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
    const step = WALK_MPS * dt;
    const x = c.x + c._npcDX * step, y = c.y + c._npcDY * step;
    const dest = scene.cellAt(x, y);
    const blocked = !dest.loaded || dest.underRoad || Combat.faunaBlocksCell(dest.type)
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
  // weak monsters are ever met, and nobody knows why.
  const WARDEN_LINE = 'This is a safe area. For some reason only weak monsters live here.';
  // THE STORY NEIGHBOURS — placed by the starting trailer (Starter
  // placeSafeAreaWarden seats them in this order, the warden first so its
  // seat never moves). What each says is MemoryStory.npcDialogue's, by act:
  // the WITNESS tells of the night the Warmonger took the roofs, the
  // WANDERER has no home until the next restoration after you meet them,
  // the BELIEVER lauds the wise wizard and the tower that might bring him back.
  const STORY_ROLES = { warden: 'Warden', witness: 'Survivor', wanderer: 'Wanderer', believer: 'Believer' };
  const STORY_NEIGHBOURS = Object.keys(STORY_ROLES);
  function storyNeighbour(id, role) {
    return { ...identity(id, 'village'), role, roleLabel: STORY_ROLES[role] || 'Neighbour' };
  }
  function warden(id) { return storyNeighbour(id, 'warden'); }
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
    'This shrine is older than the town. I sweep its step each morning and light its lantern each night.',
    'The fire took the roofs, not the stone. Someone has to keep the old places, so I do.',
  ];
  function dialogue(scene, c, now = Date.now()) {
    const day = utcDayIndex(now), seed = fnv1a(`${c.id}:talk`);
    const title = `${c.name} · ${c.roleLabel || LABELS[c.zone || 'village'][c.role]}`;
    const daily = a => a[((seed + day) >>> 0) % a.length];
    let body;
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
      body = `I read this in a book:\n“${daily(PLAY_TIPS)}”`;
    } else if (c.role === 'merchant' || c.role === 'trader') {
      body = daily(c.role === 'merchant'
        ? ['I brought fresh supplies today. Take a look.', 'A little stock for the road ahead.', 'See anything you need for your travels?']
        : ['Perhaps we each have what the other needs.', 'Let us see what we can exchange today.', 'A fair trade makes the walk worthwhile.']);
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
      const where = wreck ? ` The nearest wreck still waiting is ${whereabouts(c, wreck.o, wreck.d)}.` : ' No wreck near here still waits, that I know of.';
      body = (mended
        ? `${mended === 1 ? 'One roof stands' : `${mended} roofs stand`} again since you came.`
        : daily(['Every roof here came down in the one night. Stone remembers its shape, though. Mend one wreck and the street will follow.',
          'Nobody has laid a stone here since the fire. The wrecks are waiting for hands.'])) + where;
    } else if (c.role === 'lamplighter') {
      // The living lamps (Streets lampVisits: pruned at LAMP_FADE_MS, so the
      // count is the lamps still burning brighter for the player).
      const lit = Object.keys(scene.save.lampVisits || {}).length;
      const fade = typeof Streets !== 'undefined' && Streets.LAMP_FADE_MS ? shortDuration(Streets.LAMP_FADE_MS) : 'a day';
      body = lit
        ? `${lit === 1 ? 'One lamp burns' : `${lit} lamps burn`} brighter for your passing tonight. Stay away ${fade} and they forget.`
        : daily(['The lamps along the road have been dark since the fire. Walk beneath one and it will remember you.',
          'A lamp only wants company. Pass under it and watch what it does.']);
    } else {
      const radius = 250, candidates = [];
      const opened = setOf(scene.save.opened || []), caught = setOf(scene.save.caught || []);
      const add = (o, label) => {
        const d = Math.hypot(o.x - c.x, o.y - c.y);
        if (d <= radius) candidates.push({ o, label, d });
      };
      for (const entry of WorldGen.tileCache.values()) WorldGen.forEachItemInBox(entry, 'objects', c.x - radius, c.y - radius, c.x + radius, c.y + radius, o => {
        if (isShrine(o) || (o.kind === 'house' && scene.houseShopRole(o) === 'wizard')) add(o, 'a shrine');
        else if (o.kind === 'chest' && !opened.has(o.id)) {
          const cell = scene.cellAt?.(o.x, o.y);
          if (!cell?.loaded || cell.tx == null || !Fog.seen(cell.tx, cell.ty, cell.ix, cell.iy)) add(o, 'an undiscovered chest');
        }
      });
      WorldGen.forEachItem('creatures', o => {
        if (!caught.has(o.id) && Combat.isEnemy(o)) add(o, Combat.isElite(o) ? 'an elite foe' : 'a roaming foe');
      });
      candidates.sort((a, b) => String(a.o.id).localeCompare(String(b.o.id)));
      if (candidates.length) {
        const { o, label, d } = daily(candidates);
        body = `${daily(['I spotted', 'On my walk I noticed', 'Keep an eye out for'])} ${label}, ${whereabouts(c, o, d)}.`;
      } else body = daily(['The paths are quiet today. I have no nearby discoveries to share.', 'I have seen nothing new nearby today. Come back tomorrow.', 'No fresh sightings today. I will keep looking.']);
    }
    return { title, body };
  }
  // Use the same RGB multiplication as Phaser's world tint, including alpha.
  // Cache on the live NPC, not in a growing global table of everyone met.
  function portrait(scene, c) {
    if (c._portrait) return c._portrait;
    const sheet = SpriteLayout.NPC_SHEETS[c.npcVariant || 0];
    const source = scene.textures.get(sheet.idle).getSourceImage();
    const sprite = document.createElement('canvas'); sprite.width = 48; sprite.height = 48;
    const ctx = sprite.getContext('2d'); ctx.drawImage(source, 0, 0, 48, 48, 0, 0, 48, 48);
    const pixels = ctx.getImageData(0, 0, 48, 48), tint = c.tint;
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] *= ((tint >> 16) & 255) / 255;
      pixels.data[i + 1] *= ((tint >> 8) & 255) / 255;
      pixels.data[i + 2] *= (tint & 255) / 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const canvas = document.createElement('canvas'); canvas.width = 352; canvas.height = 448;
    const out = canvas.getContext('2d'); out.fillStyle = '#203128'; out.fillRect(0, 0, 352, 448);
    out.imageSmoothingEnabled = false;
    out.drawImage(sprite, 8, 8, 32, 28, 104, 12, 144, 126);
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
    if (isDormant(c)) {
      scene.showMessageModal({ ...talk, kind: 'note', art: portrait(scene, c) });
      return;
    }
    if (typeof StoryEncounters !== 'undefined' && StoryEncounters.interact(scene, c)) return;
    if (c.role !== 'merchant' && c.role !== 'trader') {
      scene.showMessageModal({ ...talk, kind: 'note', art: portrait(scene, c) });
      return;
    }
    const ready = scene.shopReadiness(c);
    if (!ready.ready) {
      scene.showMessageModal({ title: talk.title, body: `I have finished trading for now. Come back in ${shortDuration(ready.waitMs)}.`, art: portrait(scene, c), kind: 'trade' });
      return;
    }
    const record = () => { scene.shopBucketState(c).deals += 1; };
    if (c.role === 'trader') scene.presentTraderOffer(sx, sy, c, record);
    else scene.presentThemedShop(sx, sy, c, record);
  }
  return { REST_MS_AFTER_HIT, RESTING_LINE, restore, isDormant, hit, canTarget, prepareTargets, enemyTarget, COUNT, PROFILES, LABELS, WALK_MPS, WANDER_CELLS, WARDEN_LINE, STORY_ROLES, STORY_NEIGHBOURS, storyNeighbour, warden, KEEPER_DEFAULT, nearestWreck, identity, zoneFor, spawn, seatKeepers, shrineResidents, restoreShrine, tick, dialogue, portrait, offerArt, interact };
})();
