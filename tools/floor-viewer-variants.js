// Preview selectors change generation inputs; shipping placement rules still
// decide which scenery fits. Rebuilds must be serialized while they are active.
(function (root) {
  'use strict';
  const title = id => id.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  function caveWeights(depth) {
    const profile = root.WorldGen.floorProfile(depth);
    return 'caveAreas' in profile ? profile.caveAreas?.weights : root.CaveAreas.DEPTH_WEIGHTS?.[depth];
  }
  function families(depth) {
    const out = [];
    if (depth === 0) {
      for (const kind of [...new Set(root.ZoneVariantData.variants.map(row => row.zone))])
        out.push({ type: 'nexus', kind, rows: root.ZoneVariants.forKind(kind).map(row => ({ id: row.id, label: row.name })) });
      for (const kind of ['minor', 'major', 'path']) out.push({ type: 'road', kind,
        rows: root.StreetVariants.STREET_VARIANTS.filter(row => row.size === kind).map(row => ({ id: row.id, label: row.title || title(row.id) })) });
    } else {
      const weights = caveWeights(depth);
      if (weights) {
        out.push({ type: 'nexus', kind: 'grove', rows: weights.filter(row => row.weight > 0).map(row => ({ id: row.id, label: title(row.id) })) });
        out.push({ type: 'nexus', kind: 'quarry', rows: [{ id: 'mine_tunnels', label: 'Mine Tunnels' }] });
      }
      if (root.WorldGen.floorProfile(depth).streetMirror) {
        for (const [kind, ids] of [['path', root.Underground.THEMES], ['minor', root.Underground.STREET_THEMES]])
          out.push({ type: 'road', kind, rows: ids.map(id => ({ id, label: title(id) })) });
      }
    }
    return out.filter(family => family.rows.length);
  }
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  function count(depth) {
    const rows = families(depth);
    return rows.length ? rows.reduce((n, family) => n * family.rows.length / gcd(n, family.rows.length), 1) + 1 : 0;
  }
  function select(depth, index) {
    const length = count(depth);
    if (!length) return null;
    index = ((index % length) + length) % length;
    const picks = index ? families(depth).map(family => ({ type: family.type, kind: family.kind,
      ...family.rows[(index - 1) % family.rows.length] })) : [];
    return { id: index ? `variants-${index}` : null, index, label: index ? `Variant index ${index}` : 'Natural selection',
      nexuses: picks.filter(row => row.type === 'nexus'), roads: picks.filter(row => row.type === 'road') };
  }
  const options = depth => Array.from({ length: count(depth) }, (_, i) => select(depth, i));
  async function withSelection(depth, index, build) {
    const selected = select(depth, index), restores = [];
    const replace = (object, key, value) => { const previous = object[key]; restores.push(() => { object[key] = previous; }); object[key] = value; };
    const V = root.ZoneVariants, W = root.WorldGen, SV = root.StreetVariants;
    try {
      if (selected?.id && depth === 0) {
        const picks = new Map(selected.nexuses.map(row => [row.kind, row.id])), originalPick = V.pick;
        replace(V, 'pick', anchor => {
          const id = picks.get(anchor.kind);
          if (!id) return originalPick(anchor);
          anchor.variant = id; return V.byId(id);
        });
        const roads = new Map(selected.roads.map(row => [row.kind, row.id])), originalRoad = SV.variantFor;
        replace(SV, 'variantFor', (key, name, size, context) => roads.get(size) || originalRoad(key, name, size, context));
        const scenicKind = Object.keys(root.Scenic.KIND_ROW).find(kind => root.Scenic.KIND_ROW[kind] === roads.get('path'));
        const originalClassify = root.Scenic.classify;
        replace(root.Scenic, 'classify', (...args) => originalClassify(...args) ? scenicKind : null);
      } else if (selected?.id) {
        const grove = selected.nexuses.find(row => row.kind === 'grove');
        if (grove) {
          const originalProfile = W.floorProfile;
          if (!('caveAreas' in originalProfile(depth))) replace(root.CaveAreas.DEPTH_WEIGHTS, depth, [{ id: grove.id, weight: 1 }]);
          else replace(W, 'floorProfile', d => {
            const profile = originalProfile(d);
            return d === depth && profile.caveAreas ? { ...profile, caveAreas: { ...profile.caveAreas, weights: [{ id: grove.id, weight: 1 }] } } : profile;
          });
        }
        if (selected.roads.length) {
          const originalProject = root.Underground.project;
          replace(root.Underground, 'project', (...args) => {
            const result = originalProject(...args);
            if (result.depth === depth) for (const route of result.routes)
              route.theme = selected.roads.find(row => row.kind === (route.street ? 'minor' : 'path')).id;
            return result;
          });
        }
      }
      return await build(selected);
    } finally { for (const restore of restores.reverse()) restore(); }
  }
  root.FloorViewerVariants = { families, count, options, select, withSelection };
})(typeof globalThis !== 'undefined' ? globalThis : window);
