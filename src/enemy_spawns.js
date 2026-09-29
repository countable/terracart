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
  function surfaceRows(type) {
    const biome = typeof type === 'string' ? type : biomeName(type);
    const eligible = rows().filter(row => row.surface && row.tier <= 3 && row.attackType !== 'touch' && row.surface.biomes.includes(biome));
    const replaced = new Set(eligible.filter(row => row.variantType === 'Tint').map(row => row.variantOf));
    return eligible.filter(row => !replaced.has(row.id));
  }
  function surfaceKind(type, id) {
    const eligible = surfaceRows(type);
    const weights = root.EnemyRoster.SURFACE_TIERS.at(-1).tierWeights;
    const tiers = [...new Set(eligible.map(row => row.tier))];
    const tier = pick(tiers.map(tier => ({ row: tier, weight: weights[tier] || 0 })), roll(id + ':tier'));
    return pick(eligible.filter(row => row.tier === tier).map(row => ({ row, weight: row.surface.weight })), roll(id + ':kind'))?.id || null;
  }
  function tierAcceptance(tier, distance) {
    const bands = root.EnemyRoster.SURFACE_TIERS;
    const band = bands.find(b => distance >= b.minDistance && (b.maxDistance == null || distance < b.maxDistance));
    if (!band) return 0;
    const base = bands.at(-1).tierWeights;
    const scale = Math.max(...Object.keys(base).map(t => (band.tierWeights[t] || 0) / base[t]));
    return ((band.tierWeights[tier] || 0) / base[tier]) / scale;
  }
  // Is this SURFACE FOE here for this player? One lane, several reasons, all
  // per-player overlays that HIDE a generated foe and never re-roll it:
  //   a roster spawn (`_surfaceSpawn`) — its habitat's distance band from
  //     Home, its tier's acceptance there, night-only rows, the pest amnesty;
  //   a garrison guard (`lair`, lairs.js / zone guards) — the QUIET HOME
  //     (Difficulty quietHomeM): on easy, nothing but a plain slime is held
  //     for you within that ring of your Home. A Home effect, so it is off
  //     the LIVE Home (homeWorldPos, like HOME_R) and there is none without
  //     one — unlike the tier bands and lairMul, which stay on the frozen
  //     starter anchor (lairs.test.js pins why). Measured from the RUIN
  //     (lairX/lairY), so a guard that chases you in does not blink out.
  // Stamps `_surfaceInactive`, which the draw, the AI and Combat.isEnemy read.
  function surfaceActive(scene, creature) {
    const at = creature?._surfaceSpawn;
    const guard = !at && creature?.lair ? creature : null;
    if (!at && !guard) return true;
    let active = true;
    if (guard) {
      const quietM = root.Difficulty?.get?.().quietHomeM || 0;
      const home = quietM > 0 && guard.kind !== 'slime' ? scene?.homeWorldPos?.() : null;
      if (home && Number.isFinite(home.x) && Number.isFinite(guard.lairX)) {
        active = Math.hypot(guard.lairX - home.x, guard.lairY - home.y) >= quietM;
      }
      creature._surfaceInactive = !active;
      return active;
    }
    const row = root.EnemyRoster.get(creature.kind);
    const habitat = row?.surface;
    const home = scene._starterTrailAnchor?.() || scene.save?.starterCratesAt || scene.startWorldM;
    active = !!habitat;
    if (active && home && Number.isFinite(home.x) && Number.isFinite(home.y)) {
      const distance = Math.hypot(at.x - home.x, at.y - home.y);
      active = distance >= habitat.minDistance && (habitat.maxDistance == null || distance < habitat.maxDistance)
        && roll(creature.id + ':activation') < tierAcceptance(row.tier, distance);
    }
    if (active && habitat.time === 'night') {
      active = !!root.Lighting && root.Lighting.daylight(scene, Date.now()) < SURFACE_NIGHT_DAYLIGHT;
    }
    if (active && scene._pestFreeZone) active = !scene._pestFreeZone(at.tx, at.ty)?.has(at.cx, at.cy);
    creature._surfaceInactive = !active;
    return active;
  }
  function caveRows(depth) {
    return rows().filter(row => row.cave && row.attackType !== 'touch'
      && depth >= row.cave.minDepth && (row.cave.maxDepth == null || depth <= row.cave.maxDepth)
      && (row.cave.depthRule !== 'even' || depth % 2 === 0));
  }
  // Giants share at most 5% of the total bag, regardless of how many are added.
  function caveKind(depth, r) {
    const eligible = caveRows(depth);
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
  const api = { SURFACE_NIGHT_DAYLIGHT, hash, roll, surfaceRows, surfaceKind, surfaceActive, tierAcceptance, caveRows, caveKind, surfaceId, caveId, legacyCaveDefeats };
  root.EnemySpawns = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
