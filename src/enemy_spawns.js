// Stable world candidates; distance, daylight and tutorial state only hide them.
(function (root) {
  'use strict';
  const rows = () => root.EnemyRoster.ROWS;
  // Surface foes own their night threshold. Ghost dusk is a separate haunt
  // rule, so retuning ghosts cannot move ordinary foes between day and night.
  const SURFACE_NIGHT_DAYLIGHT = 0.25;
  const hash = value => {
    let h = 2166136261;
    for (const c of String(value)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  const roll = key => hash(key) / 4294967296;
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
      .filter(row => !['pirate_grunt', 'pirate_gunner', 'pirate_captain', 'giant_crab', 'jellyfish'].includes(row.id) || context?.beach);
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
    const at = creature?._surfaceSpawn;
    const guard = !at && creature?.lair ? creature : null;
    if (!at && !guard) return true;
    let active = true;
    const anchor = homeAnchor(scene);
    if (guard) {
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
  function surfaceId(tx, ty, cx, cy) { return `enemy_${tx}_${ty}_${cx}_${cy}`; }
  function caveId(depth, tx, ty, cx, cy) { return `enemy_cave_${depth}_${tx}_${ty}_${cx}_${cy}`; }
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
  const api = { caveContextAt, SURFACE_NIGHT_DAYLIGHT, hash, roll, surfaceRows, surfaceKind, surfaceActive, maxTierAt, homeAllows, caveRows, caveKind, surfaceId, caveId, legacyCaveDefeats };
  root.EnemySpawns = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
