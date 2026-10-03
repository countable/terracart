// Pure interpretation of the shared zone table. Coordinates are integer game
// cells, phased from the settled POI; nothing here depends on tile load order.
(function (root) {
  'use strict';
  const data = root.ZoneVariantData;
  const rows = data.variants;
  const indexed = new Map(rows.map(row => [row.id, row]));
  const kinds = new Map();
  for (const row of rows) {
    if (!kinds.has(row.zone)) kinds.set(row.zone, []);
    kinds.get(row.zone).push(row);
  }
  // A headstone is scenery with its own spawn gate. Ghost eligibility is
  // checked at interaction time, not by applying the enemy gate to the stone.
  const materials = Object.fromEntries(Object.entries(data.materials).map(([id, row]) =>
    [id, Object.assign({}, row, { id }, row.kind === 'headstone' ? { spawnClass: 'headstone' } : {})]));
  const mod = (value, n) => ((value % n) + n) % n;
  const byId = id => indexed.get(id) || null;
  const forKind = kind => kinds.get(kind) || [];
  function identity(anchor) {
    return Number.isFinite(anchor.gx) && Number.isFinite(anchor.gy)
      ? `${anchor.kind}|${anchor.gx}|${anchor.gy}` : `${anchor.kind}|${anchor.key}`;
  }
  // Traits describe appearance, not eligibility: unusual combinations remain possible.
  const TRAITS = {
    meadow: ['cultivated'], mushroom_grove: ['woodland', 'damp'], orchard: ['cultivated', 'woodland'],
    formal_garden: ['formal', 'cultivated'], hedge_garden: ['formal', 'cultivated'], ancient_grove: ['woodland', 'sacred'],
    stone_garden: ['formal', 'sacred'], ordered_graves: ['formal', 'sacred'], overgrown_graves: ['woodland', 'sacred'],
    broken_masonry: ['ruined'], silent_circle: ['sacred'], flint_field: ['ruined'], broken_depot: ['ruined'],
    seep: ['damp'], work_yard: ['formal'], black_ring: ['ruined'],
    mystic_reef: ['coastal', 'sacred'], pirate_cove: ['coastal', 'ruined'], shellwater_strand: ['coastal', 'damp']
  };
  const RELATED = new Set(['cultivated|formal', 'cultivated|woodland', 'damp|woodland', 'coastal|damp', 'formal|sacred', 'sacred|woodland']);
  const OPPOSED = new Set(['formal|ruined', 'cultivated|ruined']);
  const pair = (a, b) => [a, b].sort().join('|');
  function traitsFor(value) {
    if (!value) return [];
    if (typeof value === 'string') return TRAITS[value] || [];
    if (Array.isArray(value.affinities)) return value.affinities;
    if (value.id && TRAITS[value.id]) return TRAITS[value.id];
    const row = value.kind && pick(value);
    return row ? traitsFor(row) : [];
  }
  function affinityMultiplier(candidateTraits, context) {
    const traits = Array.isArray(candidateTraits) ? candidateTraits : traitsFor(candidateTraits);
    let total = 0, weighted = 0;
    for (const [trait, amount] of Object.entries(context || {})) {
      if (!(Number.isFinite(amount) && amount > 0)) continue;
      // One best relationship per context trait: tagging an object twice never
      // multiplies boosts, and a matching trait wins over an incidental clash.
      let affinity = 1;
      if (traits.includes(trait)) affinity = 2;
      else if (traits.some(t => RELATED.has(pair(t, trait)))) affinity = 1.3;
      else if (traits.some(t => OPPOSED.has(pair(t, trait)))) affinity = 0.6;
      weighted += amount * affinity;
      total += amount;
    }
    return total ? weighted / total : 1;
  }
  // Only the anchor's own source tags are shared verbatim by buffered tiles.
  // A polygon clipped differently by each observer cannot safely inform this roll.
  function geographyTraits(tags) {
    const t = tags || {}, result = new Set();
    const values = [t.class, t.subclass, t.landuse, t.natural, t.leisure, t.garden_type];
    const has = (...terms) => values.some(v => terms.includes(v));
    if (has('wood', 'forest', 'woodland')) result.add('woodland');
    if (has('orchard', 'vineyard', 'farmland', 'allotments')) result.add('cultivated');
    if (has('garden', 'formal', 'botanical')) { result.add('formal'); result.add('cultivated'); }
    if (has('wetland', 'marsh', 'swamp', 'water')) result.add('damp');
    if (has('beach', 'coastline')) result.add('coastal');
    if (has('place_of_worship', 'cemetery', 'grave_yard')) result.add('sacred');
    if (has('brownfield', 'ruins') || t.ruins === 'yes' || t.historic === 'ruins') result.add('ruined');
    const traits = [...result].sort();
    return Object.fromEntries(traits.map(trait => [trait, 1 / traits.length]));
  }
  function contextFor(anchor) {
    if (anchor.geographicTraits && Object.keys(anchor.geographicTraits).length) return anchor.geographicTraits;
    // Park character already determines the ordinary parent ground from a
    // global anchor hash. Use it only when source geography gives no detail.
    if (anchor.kind === 'grove') {
      const character = anchor.character || (root.BiomeProfiles && Number.isFinite(anchor.gx) && Number.isFinite(anchor.gy)
        ? root.BiomeProfiles.parkCharacterAt(anchor.gx, anchor.gy) : null);
      if (character === 'wooded') return { woodland: 1 };
      if (character === 'formal') return { formal: 1 };
    }
    return {};
  }
  // A handful of contexts are shared by thousands of cells. Cache their
  // weights rather than mutable anchors; overrides and edited anchor traits
  // always take effect immediately. Bound the cache for review-tool inputs.
  const weightCache = new Map();
  function weightedChoices(anchor) {
    const context = contextFor(anchor), candidates = forKind(anchor.kind);
    const contextKey = Object.keys(context).sort().filter(k => Number.isFinite(context[k]) && context[k] > 0)
      .map(k => `${k}:${context[k]}`).join('|');
    const tableKey = candidates.map(row => `${row.id}:${row.weight}:${traitsFor(row).join(',')}`).join('|');
    const key = `${anchor.kind};${contextKey};${tableKey}`;
    let result = weightCache.get(key);
    if (!result) {
      const choices = candidates.map(row => {
        const multiplier = affinityMultiplier(traitsFor(row), context);
        return { row, multiplier, weight: row.weight * multiplier };
      });
      result = { choices, total: choices.reduce((sum, c) => sum + c.weight, 0) };
      if (weightCache.size >= 64) weightCache.delete(weightCache.keys().next().value);
      weightCache.set(key, result);
    }
    return result;
  }
  function selectionWeights(anchor) {
    return weightedChoices(anchor).choices.map(choice => ({ ...choice }));
  }
  function pick(anchor) {
    const fixed = byId(anchor.variant);
    if (fixed && fixed.zone === anchor.kind) return fixed;
    const { choices: candidates, total } = weightedChoices(anchor);
    let ticket = (fnv1a(`zone-variant|${identity(anchor)}`) / 4294967296) * total;
    for (const choice of candidates) {
      ticket -= choice.weight;
      if (ticket < 0) return choice.row;
    }
    return candidates.length ? candidates[candidates.length - 1].row : null;
  }
  // An explicit zone lamp tint wins over the street theme. Read the same
  // coverage winner as the dressing, including associated park ground.
  // Untinted zones leave the street's own palette intact.
  function lampGlowAt(entry, ix, iy) {
    const field = entry && entry.zone, n = entry && entry.cellsPerEdge;
    const coverage = field && (field.coverage || field.idx);
    if (!coverage || !(n > 0) || !Number.isInteger(ix) || !Number.isInteger(iy) ||
        ix < 0 || iy < 0 || ix >= n || iy >= n) return null;
    const anchor = field.anchors[coverage[iy * n + ix] - 1];
    const row = anchor && pick(anchor);
    return row && typeof row.lampGlow === 'string' && /^#[0-9a-f]{6}$/i.test(row.lampGlow)
      ? row.lampGlow : null;
  }
  function rotation(anchor) {
    if (Number.isInteger(anchor.rotation)) return mod(anchor.rotation, 4);
    if (Number.isFinite(anchor.approachDx) && Number.isFinite(anchor.approachDy) &&
        (anchor.approachDx || anchor.approachDy)) {
      return mod(Math.round((Math.atan2(anchor.approachDy, anchor.approachDx) + Math.PI / 2) / (Math.PI / 2)), 4);
    }
    return fnv1a(`zone-orientation|${identity(anchor)}`) % 4;
  }
  function rotate(x, y, turns) {
    switch (mod(turns, 4)) {
      case 1: return [-y, x];
      case 2: return [-x, -y];
      case 3: return [y, -x];
      default: return [x, y];
    }
  }
  function inverseRotate(x, y, turns) { return rotate(x, y, -turns); }
  function poiOrigin(variant) { return variant.background.poiOrigin.cell.slice(); }
  function cycle(material, bx, by) {
    return typeof material === 'string' ? material : material.cycle[mod(bx + by, material.cycle.length)];
  }
  const slotMaps = new WeakMap();
  function slotAt(background, x, y) {
    let map = slotMaps.get(background);
    if (!map) {
      map = new Map(background.slots.map(slot => [slot.at.join(','), slot.material]));
      slotMaps.set(background, map);
    }
    return map.get(`${x},${y}`) || null;
  }
  // Separate hash lanes make occupancy independent of material choice. Mix the
  // FNV result to avoid its low-bit structure showing up as rows in a scatter.
  function unitHash(key) {
    let h = fnv1a(key);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function sample(variant, u, v, anchorKey) {
    const b = variant.background;
    if (b.type === 'seeded_scatter') {
      const seed = `${anchorKey}|${variant.id}|${u}|${v}`;
      // Row geometry controls available seats; conditional occupancy keeps
      // the declared density measured over the whole area, including aisles.
      const rows = b.rows;
      if (rows && mod(rows.axis === 'vertical' ? u : v, rows.spacingCells) >= rows.lineWidthCells) return null;
      const rowFraction = rows ? rows.lineWidthCells / rows.spacingCells : 1;
      if (unitHash(`${seed}|occupancy`) >= b.nominalDensity / rowFraction) return null;
      let ticket = unitHash(`${seed}|material`) * b.nominalDensity;
      for (const [material, density] of Object.entries(b.materialDensity)) {
        ticket -= density;
        if (ticket < 0) return material;
      }
      return null;
    }
    if (b.type === 'line_grid' || b.type === 'bounded_line_grid') {
      const step = b.spacingCells;
      if (b.type === 'bounded_line_grid' && (u < 0 || v < 0 || u > b.plots[0] * step || v > b.plots[1] * step)) return null;
      const override = b.slots && slotAt(b, mod(u, step), mod(v, step));
      if (override) return override;
      const horizontal = mod(v, step) < b.lineWidthCells;
      const vertical = mod(u, step) < b.lineWidthCells;
      if (horizontal && vertical) return b.intersectionMaterial;
      if (horizontal) return b.horizontalMaterial;
      if (vertical) return b.verticalMaterial;
      const centers = b.plotCenters;
      if (centers && mod(u, step) === centers.offsetCells[0] && mod(v, step) === centers.offsetCells[1]) {
        const bx = Math.floor(u / step), by = Math.floor(v / step);
        if (centers.excludePoiPlot && bx === b.poiPlot[0] && by === b.poiPlot[1]) return null;
        return cycle(centers.material, bx, by);
      }
      return null;
    }
    if (b.type === 'concentric_rings') {
      if (u < 0 || v < 0 || u >= b.extentCells[0] || v >= b.extentCells[1]) return null;
      return slotAt(b, u, v);
    }
    if (b.type === 'repeat_motif') {
      const [w, h] = b.repeatCells;
      const material = slotAt(b, mod(u, w), mod(v, h));
      if (material) return cycle(material, Math.floor(u / w), Math.floor(v / h));
      const scatter = b.gapScatter;
      return scatter && unitHash(`${anchorKey}|${variant.id}|${u}|${v}|gap`) < scatter.chance
        ? scatter.material : null;
    }
    return null;
  }
  // Finite finds are offsets from ONE anchor, never one set per motif or tile.
  function findOffsets(variant, radiusCells) {
    // Footprint-fitted quarry finds are planned by QuarryLayout, not offsets
    // from a synthetic POI. Their table targets name the finite budget only.
    if (variant.quarryLayout) return [];
    const origin = poiOrigin(variant);
    const step = variant.background.spacingCells;
    return variant.finds.targets.map(target => {
      const xy = target.plot
        ? [Math.round((target.plot[0] + 0.5) * step - origin[0]), Math.round((target.plot[1] + 0.5) * step - origin[1])]
        : target.radiusFraction.map(value => Math.round(value * radiusCells));
      return { id: target.id, material: target.material || variant.finds.material, dx: xy[0], dy: xy[1] };
    });
  }
  root.ZoneVariants = { rows, materials, byId, forKind, pick, sample, findOffsets,
    identity, poiOrigin, rotation, rotate, inverseRotate, lampGlowAt,
    traitsFor, affinityMultiplier, geographyTraits, contextFor, selectionWeights };
})(typeof window !== 'undefined' ? window : globalThis);
