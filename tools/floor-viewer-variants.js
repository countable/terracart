// Sandbox selection changes generation inputs, leaving the shipped placement
// and eligibility rules in charge of whether each nexus fits the region.
(function (root) {
  'use strict';
  const title = id => id.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  function caveWeights(depth) {
    const profile = root.WorldGen.floorProfile(depth);
    return 'caveAreas' in profile ? profile.caveAreas?.weights : root.CaveAreas.DEPTH_WEIGHTS?.[depth];
  }
  function options(depth) {
    const natural = { id: null, kind: null, label: 'Natural selection' };
    if (depth === 0) return [natural, ...root.ZoneVariantData.variants.map(row => ({
      id: row.id, kind: row.zone, label: `${title(row.zone)} · ${row.name || title(row.id)}`
    }))];
    const weights = caveWeights(depth);
    if (!weights) return [];
    return [natural, ...weights.filter(row => row.weight > 0).map(row => ({
      id: row.id, kind: 'grove', label: title(row.id)
    })), { id: 'mine_tunnels', kind: 'quarry', label: 'Mine Tunnels' }];
  }
  function select(depth, index) {
    const rows = options(depth);
    return rows.length ? rows[((index % rows.length) + rows.length) % rows.length] : null;
  }
  // Callers serialize rebuilds: these temporary selectors remain installed
  // across sliced generation, then restore even when a build fails.
  async function withSelection(depth, index, build) {
    const selected = select(depth, index);
    const V = root.ZoneVariants, W = root.WorldGen;
    const originalPick = V.pick, originalProfile = W.floorProfile;
    const legacyWeights = !('caveAreas' in originalProfile(depth)) && root.CaveAreas.DEPTH_WEIGHTS;
    const originalWeights = legacyWeights && legacyWeights[depth];
    if (selected?.id && depth === 0) {
      V.pick = anchor => {
        if (anchor.kind !== selected.kind) return originalPick(anchor);
        anchor.variant = selected.id;
        return V.byId(selected.id);
      };
    } else if (selected && selected.kind === 'grove') {
      if (legacyWeights) legacyWeights[depth] = [{ id: selected.id, weight: 1 }];
      else W.floorProfile = d => {
        const profile = originalProfile(d);
        return d === depth && profile.caveAreas ? { ...profile, caveAreas: {
          ...profile.caveAreas, weights: [{ id: selected.id, weight: 1 }]
        } } : profile;
      };
    }
    try { return await build(selected); }
    finally {
      V.pick = originalPick; W.floorProfile = originalProfile;
      if (legacyWeights && selected?.kind === 'grove') legacyWeights[depth] = originalWeights;
    }
  }
  root.FloorViewerVariants = { options, select, withSelection };
})(typeof globalThis !== 'undefined' ? globalThis : window);
