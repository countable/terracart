// Read-only provenance for the review tool. Capture before spawnInTile mutates
// the rasterized arrays; never infer an object's source from its crop alone.
(function (root) {
  const SOURCES = {
    variant: { label: 'Variant layout', color: '#27d9c0' },
    ambient: { label: 'Earlier world generation', color: '#ffac50' },
    street: { label: 'Street dressing', color: '#68a7ff' },
    fringe: { label: 'Unnamed park fringe', color: '#a4bd68' },
    npc: { label: 'Residents', color: '#ece4a0' },
    fauna: { label: 'Fauna', color: '#ed8dce' },
    runtime: { label: 'Other runtime spawns', color: '#bc8cff' },
    place: { label: 'POIs and buildings', color: '#ededed' },
  };
  const key = a => `${a.kind}:${a.gx},${a.gy}`;
  function capture(e) {
    e._reviewParkingIds = new Set((e.parkingTreasures || []).map(o => o.id));
    e._reviewBaseIds = new Set([...(e.objects || []), ...(e.wildplants || [])].map(o => o.id));
    const street = e.streetDress || {};
    e._reviewStreetIds = new Set([...(street.objects || []), ...(street.wildplants || []), ...(street.treasures || [])].map(o => o.id));
  }
  function source(e, o, category) {
    if (['chest', 'house', 'tower', 'staircase'].includes(o.kind) || e._reviewParkingIds?.has(o.id)) return 'place';
    if (o.zoneVariant) return 'variant';
    if (category === 'creature' && o.kind === 'npc') return 'npc';
    if (category === 'creature' && !Combat.isEnemy(o)) return 'fauna';
    if (o.fringe) return 'fringe';
    if (o._street || e._reviewStreetIds?.has(o.id)) return 'street';
    if (e._reviewBaseIds?.has(o.id)) return 'ambient';
    return 'runtime';
  }
  function analyse(world, edge) {
    const zones = new Map();
    for (const e of world.tiles) {
      const f = e.zone, coverage = f && (f.coverage || f.idx);
      if (!coverage) continue;
      const names = new Map();
      for (const layer of e.layers || []) if (layer.name === 'poi') for (const feature of layer.features || []) {
        for (const ring of feature.geom || []) if (ring[0]) names.set(`${ring[0].x},${ring[0].y}`, feature.tags?.name);
      }
      const local = f.anchors.map((a, i) => {
        const id = key(a);
        if (!zones.has(id)) zones.set(id, { id, anchor: a, variant: ZoneVariants.byId(a.variant), name: '', fragments: [],
          coverage: 0, eligible: 0, suppressed: {ambient:0,street:0}, sources: {}, fauna: {}, layers: {}, finds: [0, 0], guards: [0, 0], background: {}, shortfalls: [] });
        const z = zones.get(id);
        z.name = z.name || names.get(`${a.lx},${a.ly}`) || '';
        z.fragments.push({ entry: e, slot: i + 1 });
        const suppressed = f.legacyRemovedByAnchor?.[id];
        if (suppressed) for (const k of ['ambient','street']) z.suppressed[k] += suppressed[k] || 0;
        const d = e.zoneDress?.diagnostics.find(d => d.anchorKey === a.key && d.variant === a.variant);
        if (d) {
          z.eligible += d.eligible;
          z.finds[0] += d.findsPlaced; z.finds[1] += d.findsRequested;
          z.guards[0] += d.guardsPlaced; z.guards[1] += d.guardsRequested;
          for (const [k, n] of Object.entries(d.background || {})) z.background[k] = (z.background[k] || 0) + n;
          z.shortfalls.push(...d.shortfalls);
        }
        return z;
      });
      for (const slot of coverage) if (slot) local[slot - 1].coverage++;
      const seen = new Set();
      for (const [category, objects] of [['object', e.objects], ['plant', e.wildplants], ['trap', e.traps], ['creature', e.creatures], ['treasure', e.treasure ? [e.treasure] : []], ['treasure', e.extraTreasures], ['treasure', e.parkingTreasures]]) {
        for (const o of objects || []) {
          const identity = `${category}:${o.id}`;
          if (seen.has(identity)) continue;
          seen.add(identity);
          const N = e.cellsPerEdge, ix = Math.floor((o.x / edge - e.tx) * N), iy = Math.floor((o.y / edge - e.ty) * N);
          if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
          const z = local[coverage[iy * N + ix] - 1];
          if (!z) continue;
          const from = source(e, o, category);
          z.sources[from] = (z.sources[from] || 0) + 1;
          if (from === 'fauna') z.fauna[o.kind] = (z.fauna[o.kind] || 0) + 1;
          if (from === 'variant') {
            const layer = o.zoneLayer || (category === 'creature' ? 'guard' : 'shrine');
            z.layers[layer] = (z.layers[layer] || 0) + 1;
          }
        }
      }
    }
    return zones;
  }
  root.ZoneReview = { SOURCES, key, capture, source, analyse };
})(window);
