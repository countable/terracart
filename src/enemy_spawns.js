// Stable world candidates; distance, daylight and tutorial state only hide them.
(function (root) {
  'use strict';
  const rows = () => root.EnemyRoster.ROWS;
  // Surface foes own their night threshold. Ghost dusk is a separate haunt
  // rule, so retuning ghosts cannot move ordinary foes between day and night.
  const SURFACE_NIGHT_DAYLIGHT = 0.25;
  // util.js's fnv1a / hash01, read at call time (util.js loads after this).
  const hash = value => fnv1a(value);
  const roll = key => hash01(key);
  // Ambient encounters and grove residents own stable concealment draws.
  const CONCEALMENT = {
    skeleton: { hidden: .25 }, skeleton_soldier: { hidden: .25 }, zombie: { hidden: .25 },
    spider: { hidden: .3 }, poison_spider: { hidden: .3 },
    bat: { stealthy: .25 }, vampire_bat: { stealthy: .25 }, goblin_trapper: { stealthy: .25 },
  };
  function concealment(kind, id, theme) {
    const base = root.EnemyRoster.get(kind)?.variantOf || kind;
    if (['ordered_graves', 'overgrown_graves'].includes(theme)
        && ['skeleton', 'skeleton_soldier', 'zombie'].includes(base)) return { hidden: true };
    const row = CONCEALMENT[base];
    if (!row) return {};
    const r = roll(id + ':concealment');
    if (r < (row.hidden || 0)) return { hidden: true };
    if (r < (row.hidden || 0) + (row.stealthy || 0)) return { stealthy: true };
    return {};
  }
  function pick(weighted, r) {
    const total = weighted.reduce((sum, x) => sum + x.weight, 0);
    if (!(total > 0)) return null;
    let n = r * total;
    for (const item of weighted) { n -= item.weight; if (n < 0) return item.row; }
    return weighted[weighted.length - 1].row;
  }
  function biomeName(type) {
    return Object.keys(root.WorldGen.T).find(key => root.WorldGen.T[key] === type);
  }
  function surfaceRows(type, context) {
    const biome = typeof type === 'string' ? type : biomeName(type);
    const eligible = rows().filter(row => !row.retired && row.surface && row.tier <= 3 && row.attackType !== 'touch' && row.surface.biomes.includes(biome))
      .filter(row => !['pirate_grunt', 'pirate_gunner', 'pirate_captain', 'giant_crab', 'jellyfish'].includes(row.id) || context?.beach)
      .filter(row => !row.surface.nearMinorRoad || context?.nearMinorRoad);
    const replaced = new Set(eligible.filter(row => row.variantType === 'Tint').map(row => row.variantOf));
    return eligible.filter(row => !replaced.has(row.id));
  }
  function surfaceKind(type, id, context) {
    let eligible = surfaceRows(type, context);
    if (context?.beach) {
      // Ordinary beaches: mostly resident crabs/slimes, occasional visitors.
      const visitors = ['pirate_grunt', 'pirate_gunner'];
      const pirate = roll(id + ':visitor') < .12;
      eligible = eligible.filter(row => pirate ? visitors.includes(row.id) : ['giant_crab', 'slime', 'jellyfish'].includes(row.id));
    }
    const weights = root.EnemyRoster.SURFACE_TIERS.at(-1).tierWeights;
    const tiers = [...new Set(eligible.map(row => row.tier))];
    const tier = pick(tiers.map(tier => ({ row: tier, weight: weights[tier] || 0 })), roll(id + ':tier'));
    return pick(eligible.filter(row => row.tier === tier).map(row => ({ row, weight: row.surface.weight })), roll(id + ':kind'))?.id || null;
  }
  // ── THE SAFE AREA: ONLY WEAK FOES LIVE NEAR HOME ─────────────────────────
  // A surface foe too strong for its distance from Home is simply NOT THERE
  // for this player — a wild seat, a park plant, a ruin's or a zone's guard
  // alike. Never weakened, never turned into something else (a fort by Home
  // held by slimes read as a bug; so did a softened goblin): the world's foe
  // stands on its seat for everyone, and near Home it is hidden for you. The
  // early-area NPC says so ("only weak monsters live here").
  //   HOW STRONG MAY A FOE BE HERE? The strongest tier the distance band in
  // EnemyRoster.SURFACE_TIERS gives any weight (T1 inside 250 m, T2 to 750 m,
  // T3 beyond), and no closer than its own row's surface minDistance (a Giant
  // Skeleton waits for 1500 m). Distance is from the FROZEN starter anchor —
  // the bands' own origin — to where the foe was GENERATED (its seat, or its
  // ruin), so a foe that chases you home does not vanish mid-fight.
  //   What this is NOT: the easy-mode QUIET HOME (quietHomeM, below) is a
  // second, mode-only hide of non-slime guards near the LIVE Home.
  function tierOf(kind) {
    const m = root.Combat && root.Combat.monster ? root.Combat.monster(kind) : null;
    const t = m && m.tier != null ? m.tier : root.EnemyRoster.get(kind)?.tier;
    return Number.isFinite(t) ? t : null;
  }
  function maxTierAt(distM) {
    const bands = root.EnemyRoster.SURFACE_TIERS;
    const band = bands.find(b => distM >= b.minDistance && (b.maxDistance == null || distM < b.maxDistance));
    if (!band) return Infinity;
    return Math.max(...Object.keys(band.tierWeights).filter(t => band.tierWeights[t] > 0).map(Number));
  }
  function allowedAt(kind, distM) {
    const tier = tierOf(kind);
    if (tier == null) return true;                 // not a ranked foe: never too strong
    if (tier > maxTierAt(distM)) return false;
    const min = root.EnemyRoster.get(kind)?.surface?.minDistance || 0;
    return distM >= min;
  }
  // May a foe of `kind` generated `distM` from Home live there? (No Home
  // known → yes: nothing to measure a safe area from.)
  function homeAllows(kind, distM) {
    return !Number.isFinite(distM) || allowedAt(kind, distM);
  }
  function homeAnchor(scene) {
    const home = scene?._starterTrailAnchor?.() || scene?.save?.starterCratesAt || scene?.startWorldM;
    return home && Number.isFinite(home.x) && Number.isFinite(home.y) ? home : null;
  }
  // The first Home circle admits chickens and one wild deer. This is a
  // per-player overlay: generated identities, positions and RNG stay intact.
  const HOME_FAUNA_RADIUS_M = root.EnemyRoster.SURFACE_TIERS[0].maxDistance;
  function homeFaunaAnchor(scene) {
    return (scene?.depth || 0) === 0 ? homeAnchor(scene) : null;
  }
  function homeFaunaSubject(c) {
    return !!c && c.kind !== 'npc' && !root.Combat.isTame(c)
      && !root.SpriteLayout.isSummoned(c.kind) && root.SpriteLayout.creatureWanders(c.kind)
      && (!root.Combat.isEnemyKind(c.kind) || root.SpriteLayout.creatureBehaviour(c.kind)?.animal);
  }
  function inHomeFaunaCircle(anchor, x, y) {
    return !!anchor && Math.hypot(x - anchor.x, y - anchor.y) <= HOME_FAUNA_RADIUS_M;
  }
  function liveHomeDeer(scene, c, anchor, caught) {
    return homeFaunaSubject(c) && root.SpriteLayout.baseKind(c.kind) === 'deer'
      && !caught.has(c.id) && !(c._hp <= 0) && !(c.hp <= 0)
      && inHomeFaunaCircle(anchor, c.x, c.y);
  }
  function homeFaunaAllows(scene, c, x = c?.x, y = c?.y) {
    if (!homeFaunaSubject(c)) return true;
    const anchor = homeFaunaAnchor(scene);
    if (!inHomeFaunaCircle(anchor, x, y)) return true;
    const kind = root.SpriteLayout.baseKind(c.kind);
    return kind === 'chicken' || (kind === 'deer' && c.id === scene._homeFaunaDeerId);
  }
  // Once per simulation step. Drawing can reuse the result unless a tile,
  // catch, death or Home change invalidated it since that step. No per-body
  // query scans the world. Retain the chosen deer while it remains eligible.
  function refreshHomeFauna(scene, force = true) {
    const anchor = homeFaunaAnchor(scene), caughtArray = scene.save?.caught || [];
    const entries = [...root.WorldGen.tileCache.values()];
    const previous = scene._homeFaunaState;
    const unchanged = previous && previous.x === anchor?.x && previous.y === anchor?.y
      && previous.caught === caughtArray && previous.caughtLength === caughtArray.length
      && previous.entries.length === entries.length
      && entries.every((entry, i) => previous.entries[i] === entry
        && previous.arrays[i] === entry.creatures && previous.lengths[i] === (entry.creatures?.length || 0));
    if (!force && unchanged && (!previous.deer || homeFaunaSubject(previous.deer)
      && !(previous.deer._hp <= 0) && !(previous.deer.hp <= 0)
      && !caughtArray.includes(previous.deer.id) && inHomeFaunaCircle(anchor, previous.deer.x, previous.deer.y))) {
      return scene._homeFaunaDeerId || null;
    }
    const caught = new Set(caughtArray), bodies = [];
    let deer = null, retained = null;
    for (const entry of entries) for (const c of entry.creatures || []) {
      bodies.push(c);
      if (!liveHomeDeer(scene, c, anchor, caught)) continue;
      if (c.id === scene._homeFaunaDeerId) retained = c;
      if (!deer || String(c.id) < String(deer.id)) deer = c;
    }
    deer = retained || deer;
    scene._homeFaunaDeerId = deer?.id || null;
    scene._homeFaunaState = { x: anchor?.x, y: anchor?.y, caught: caughtArray,
      caughtLength: caughtArray.length, entries, arrays: entries.map(e => e.creatures),
      lengths: entries.map(e => e.creatures?.length || 0), deer };
    for (const c of bodies) {
      if (homeFaunaSubject(c) || c._homeFaunaInactive) surfaceActive(scene, c);
    }
    return scene._homeFaunaDeerId;
  }
  // Permanent player-geography eligibility, separate from temporary daylight
  // and pest-amnesty visibility. Temple census reads this before activation.
  function homeEligible(scene, creature) {
    const at = creature?._surfaceSpawn;
    const guard = !at && creature?.lair ? creature : null;
    if (!at && !guard) return true;
    if (guard?.castle && scene?.save && root.Houses?.citadelBattleActive(scene.save, guard.castle)) return true;
    const anchor = homeAnchor(scene);
    if (guard) {
      const quietM = root.Difficulty?.get?.().quietHomeM || 0;
      const home = quietM > 0 && guard.kind !== 'slime' ? scene?.homeWorldPos?.() : null;
      if (home && Number.isFinite(home.x) && Number.isFinite(guard.lairX)
          && Math.hypot(guard.lairX - home.x, guard.lairY - home.y) < quietM) return false;
    }
    const x = at ? at.x : guard.lairX, y = at ? at.y : guard.lairY;
    return !anchor || !Number.isFinite(x) || !Number.isFinite(y)
      || homeAllows(creature.kind, Math.hypot(x - anchor.x, y - anchor.y));
  }
  // Is this SURFACE FOE here for this player? One lane, several reasons, all
  // per-player overlays that HIDE a generated foe and never re-roll it: the
  // SAFE AREA (homeAllows, above — every surface foe), then
  //   a roster spawn (`_surfaceSpawn`) — night-only rows by day, the pest
  //     amnesty;
  //   a garrison guard (`lair`, lairs.js / zone guards) — the QUIET HOME
  //     (Difficulty quietHomeM): on easy, nothing but a plain slime is held
  //     for you within that ring of your Home. A Home effect, so it is off
  //     the LIVE Home (homeWorldPos, like HOME_R) and there is none without
  //     one — unlike the safe area, which stays on the frozen starter
  //     anchor with the tier bands (lairs.test.js pins why). Measured from the RUIN
  //     (lairX/lairY), so a guard that chases you in does not blink out.
  // Stamps `_surfaceInactive`, which the draw, the AI and Combat.isEnemy read.
  function surfaceActive(scene, creature) {
    if (!creature) return true;
    // Remove only this overlay's stamp before recomputing other policies.
    // A pre-existing inactive reason survives leaving Home or entering a cave.
    if (creature._homeFaunaInactive) {
      creature._surfaceInactive = creature._surfaceInactiveBeforeHomeFauna;
      delete creature._surfaceInactiveBeforeHomeFauna;
      delete creature._homeFaunaInactive;
    }
    const active = surfaceEnemyActive(scene, creature);
    if (!homeFaunaAllows(scene, creature)) {
      creature._surfaceInactiveBeforeHomeFauna = creature._surfaceInactive;
      creature._homeFaunaInactive = true;
      creature._surfaceInactive = true;
      return false;
    }
    return active && !creature._surfaceInactive;
  }
  function surfaceEnemyActive(scene, creature) {
    const at = creature?._surfaceSpawn;
    const guard = !at && creature?.lair ? creature : null;
    if (!at && !guard) return true;
    let active = true;
    const anchor = homeAnchor(scene);
    if (guard) {
      // Fight is an explicit encounter, not an ambient threat near Home.
      // Hiding its generated guards leaves an active battle impossible to
      // complete. Only this castle's live battle bypasses the Home filters.
      if (guard.castle && scene?.save && root.Houses?.citadelBattleActive(scene.save, guard.castle)) {
        creature._surfaceInactive = false;
        return true;
      }
      const quietM = root.Difficulty?.get?.().quietHomeM || 0;
      const home = quietM > 0 && guard.kind !== 'slime' ? scene?.homeWorldPos?.() : null;
      if (home && Number.isFinite(home.x) && Number.isFinite(guard.lairX)) {
        active = Math.hypot(guard.lairX - home.x, guard.lairY - home.y) >= quietM;
      }
      if (active && anchor && Number.isFinite(guard.lairX) && Number.isFinite(guard.lairY)) {
        active = homeAllows(guard.kind, Math.hypot(guard.lairX - anchor.x, guard.lairY - anchor.y));
      }
      creature._surfaceInactive = !active;
      return active;
    }
    const row = root.EnemyRoster.get(creature.kind);
    const habitat = row?.surface;
    active = !!habitat;
    if (active && anchor) active = homeAllows(creature.kind, Math.hypot(at.x - anchor.x, at.y - anchor.y));
    if (active && habitat.time === 'night') {
      active = !!root.Lighting && root.Lighting.daylight(scene, Date.now()) < SURFACE_NIGHT_DAYLIGHT;
    }
    if (active && scene._pestFreeZone) active = !scene._pestFreeZone(at.tx, at.ty)?.has(at.cx, at.cy);
    creature._surfaceInactive = !active;
    return active;
  }
  function caveRows(depth, context) {
    return rows().filter(row => !row.retired && row.cave && row.attackType !== 'touch'
      && depth >= row.cave.minDepth && (row.cave.maxDepth == null || depth <= row.cave.maxDepth)
      && (row.cave.depthRule !== 'even' || depth % 2 === 0)
      && (!context || context.kinds.includes(row.id))
      && (depth >= 5 || !['red_demon', 'purple_demon', 'armoured_demon', 'fiend', 'succubus', 'hell_brute'].includes(row.id))
      && row.id !== 'red_dragon');
  }
  // Giants share at most 5% of the total bag, regardless of how many are added.
  function caveKind(depth, r, context) {
    const eligible = caveRows(depth, context);
    const giants = eligible.filter(row => row.variantType === 'Giant');
    const ordinary = eligible.filter(row => row.variantType !== 'Giant');
    const giantChance = giants.length && ordinary.length ? 0.05 : (giants.length ? 1 : 0);
    const giant = r < giantChance;
    const pool = giant ? giants : ordinary;
    const local = giant ? r / giantChance : (r - giantChance) / (1 - giantChance);
    return pick(pool.map(row => ({ row, weight: row.cave.weight })), local)?.id || null;
  }
  function surfaceId(tx, ty, cx, cy) { return root.WorldGen.cellId('enemy', tx, ty, cx, cy); }
  function caveId(depth, tx, ty, cx, cy) { return root.WorldGen.cellId(`enemy_cave_${depth}`, tx, ty, cx, cy); }
  // Legacy IDs encode ordinal seats (pack) or cells (roamers). Match either
  // suffix without tying a persistent defeat to the newly selected species.
  function legacyCaveDefeats(caught, depth, tx, ty) {
    const pack = new Set(), cells = new Set();
    const suffix = `_${depth}_${tx}_${ty}_`;
    for (const id of caught) {
      if (!id.startsWith('mon_')) continue;
      const at = id.lastIndexOf(suffix);
      if (at < 0) continue;
      const seat = id.slice(at + suffix.length);
      if (/^\d+$/.test(seat)) pack.add(Number(seat));
      else if (/^r\d+_\d+$/.test(seat)) cells.add(seat.slice(1));
    }
    return { pack, cells };
  }
  const caveContextAt = (entry, tx, ty, cx, cy, depth) => root.EnemyHabitats.caveAt(entry, tx, ty, cx, cy, depth);
  const api = { CONCEALMENT, concealment, HOME_FAUNA_RADIUS_M, homeFaunaSubject, homeFaunaAllows, refreshHomeFauna, caveContextAt, SURFACE_NIGHT_DAYLIGHT, hash, roll, surfaceRows, surfaceKind, surfaceActive, homeEligible, maxTierAt, homeAllows, caveRows, caveKind, surfaceId, caveId, legacyCaveDefeats };
  root.EnemySpawns = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
