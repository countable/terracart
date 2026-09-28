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
  function pick(anchor) {
    const fixed = byId(anchor.variant);
    if (fixed && fixed.zone === anchor.kind) return fixed;
    const candidates = forKind(anchor.kind);
    const total = candidates.reduce((n, row) => n + row.weight, 0);
    let ticket = (fnv1a(`zone-variant|${identity(anchor)}`) / 4294967296) * total;
    for (const row of candidates) {
      ticket -= row.weight;
      if (ticket < 0) return row;
    }
    return candidates[candidates.length - 1] || null;
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
      if (unitHash(`${seed}|occupancy`) >= b.nominalDensity) return null;
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
    const origin = poiOrigin(variant);
    const step = variant.background.spacingCells;
    return variant.finds.targets.map(target => {
      const xy = target.plot
        ? [Math.round((target.plot[0] + 0.5) * step - origin[0]), Math.round((target.plot[1] + 0.5) * step - origin[1])]
        : target.radiusFraction.map(value => Math.round(value * radiusCells));
      return { id: target.id, material: variant.finds.material, dx: xy[0], dy: xy[1] };
    });
  }
  root.ZoneVariants = { rows, materials, byId, forKind, pick, sample, findOffsets,
    poiOrigin, rotation, rotate, inverseRotate };
})(typeof window !== 'undefined' ? window : globalThis);
