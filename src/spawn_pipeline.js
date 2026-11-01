// Shared execution for ambient tables and explicit feature-owned requests.
// Only ambient requests resolve a geographic owner; events, saved individuals
// and authored encounters arrive with an owner and retain their own lifecycle.
(function (root) {
  'use strict';
  const terrainNames = new Map();
  function terrainName(type) {
    if (!terrainNames.has(type)) terrainNames.set(type,
      Object.keys(root.WorldGen.T).find(key => root.WorldGen.T[key] === type));
    return terrainNames.get(type);
  }
  function ownerAt(entry, index) {
    const grid = entry?.baseGrid || entry?.grid;
    if (!grid || index < 0 || index >= grid.length) return null;
    const terrain = grid[index], owner = root.WorldGen.variantOwnerAt(entry, index);
    if (owner === 'zone') {
      const anchor = root.WorldGen.zoneAnchorAt(entry, index);
      const id = anchor?.variant || (anchor && root.ZoneVariants?.pick?.(anchor)?.id) || 'unassigned';
      return { key: 'Nexus:' + id, type: 'zone', id, terrain, anchor };
    }
    if (owner === 'road') {
      const codes = entry.streetAreaVariants || entry.streetArea?.variants || entry.streetMarks || entry.streetDress?.marks;
      const id = root.StreetVariants?.variantByCode(codes?.[index])?.id || 'unassigned';
      return { key: 'Roads and paths:' + id, type: 'road', id, terrain };
    }
    if (owner) return { key: 'Owner:' + owner, type: owner, id: owner, terrain };
    const name = terrainName(terrain);
    const id = ['EXCLUSION_ROCK', 'ROCKY_GROUND'].includes(name)
      ? terrainName(entry.variantBaseGrid?.[index] ?? terrain) : name;
    return { key: 'Terrain:' + id, type: 'terrain', id, terrain };
  }
  // Avalanche avoids correlations between neighbouring row/cell string keys.
  function roll(key, probability) {
    if (!(probability > 0)) return false;
    if (probability >= 1) return true;
    return u01(avalanche32(fnv1a('spawn|' + key))) < probability;
  }
  function frequencyCount(spec, rng) {
    const row = spec || {};
    if (row.count != null) {
      if (!Array.isArray(row.count)) return Math.max(0, Math.floor(Number(row.count) || 0));
      const lo = Math.max(0, Math.floor(Number(row.count[0]) || 0));
      const hi = Math.max(lo, Math.floor(Number(row.count[1]) || lo));
      if (hi === lo || typeof rng !== 'function') return lo;
      return lo + Math.min(hi - lo, Math.floor(Math.max(0, Math.min(.999999999999, rng())) * (hi - lo + 1)));
    }
    const roll = typeof rng === 'function' ? rng() : 0;
    if (row.trioAt != null && roll >= row.trioAt) return 3;
    if (row.pairAt != null && roll >= row.pairAt) return 2;
    return 1;
  }

  const isGenerator = value => !!value && typeof value.next === 'function';
  function* generateSteps(rule, context) {
    const ctx = context || {}, placed = [];
    const count = ctx.count == null ? frequencyCount(rule?.frequency, ctx.rng) : ctx.count;
    for (let n = 0; n < count; n++) {
      const memberResult = ctx.member ? ctx.member(n) : {};
      const member = isGenerator(memberResult) ? yield* memberResult : memberResult;
      if (!member) continue;
      const seatResult = ctx.seat ? ctx.seat(member, n) : null;
      const seat = isGenerator(seatResult) ? yield* seatResult : seatResult;
      if (!seat) continue;
      const createResult = ctx.create ? ctx.create(member, seat, n) : { ...member, ...seat };
      const record = isGenerator(createResult) ? yield* createResult : createResult;
      if (!record) continue;
      const placedResult = ctx.onPlaced && ctx.onPlaced(record, member, seat, n);
      if (isGenerator(placedResult)) yield* placedResult;
      placed.push(record);
    }
    return placed;
  }
  root.SpawnPipeline = { ownerAt, roll, frequencyCount, generateSteps };
})(globalThis);
