// Inspect the generated cell, independently of which review overlays are visible.
(function (root) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const label = value => String(value ?? 'unknown').toLowerCase().replace(/_/g, ' ');

  function spawnVerdict(tier) {
    const classes=Object.keys(GameplayTiers.CLASS_TIERS);
    const permitted=classes.filter(cls=>GameplayTiers.allowed(tier,cls)).length;
    return !permitted?WorldGen.SPAWN_INVALID:permitted===classes.length?WorldGen.SPAWN_OPEN:WorldGen.SPAWN_SUPPRESSED;
  }

  // Query generated records, so inspection also works with markers hidden.
  function objectsAt(world, hit, renderedItems = []) {
    if (!hit) return [];
    const target = tileCellToAbs(world.scene, hit.entry.tx, hit.entry.ty, hit.x, hit.y);
    const found = [], seen = new Set();
    const owner = hit.entry.ownerKeys?.[hit.entry.owners?.[hit.cell]];
    const add = (entry, object, category) => {
      if (!object || !Number.isFinite(object.x) || !Number.isFinite(object.y)) return;
      const identity = object.id || object;
      if (seen.has(identity)) return;
      const structural = category === 'object' && owner && object.id === owner
        && ['house','temple','tower'].includes(object.kind);
      const footprint = Array.isArray(object.footprintCells) ? object.footprintCells
        : SpawnOwnership.footprintCells(world.scene, object._shrineExtentCells
          ? { ...object, _footprintCells: object._footprintCells || { width:object._shrineExtentCells, height:object._shrineExtentCells } } : object);
      if (!structural && !footprint.some(cell =>
        cell.cellIX === target.cellIX && cell.cellIY === target.cellIY)) return;
      seen.add(identity);
      found.push({ entry: entry || hit.entry, object, category });
    };
    for (const entry of world.tiles) {
      for (const object of entry.objects || []) add(entry, object, 'object');
      for (const object of entry.coinDrops || []) add(entry, object, 'object');
      for (const candidate of entry.wildplants || []) {
        const object = typeof ZoneReview !== 'undefined' ? ZoneReview.livePlant(candidate) : candidate;
        add(entry, object, 'plant');
      }
      for (const object of entry.creatures || []) add(entry, object, 'creature');
      for (const object of entry.traps || []) add(entry, { ...object, kind:'trap' }, 'object');
      for (const object of entry.reefCorals || []) add(entry, object, 'object');
      for (const object of entry.pathVents || entry.streetDress?.vents || []) add(entry, object, 'object');
    }
    for (const object of world.guards || []) add(null, object, 'creature');
    for (const item of renderedItems) add(item.e, item.o, item.category);
    return found;
  }

  function inspect(world, point, edge) {
    const tx = Math.floor(point.x / edge), ty = Math.floor(point.y / edge);
    const entry = world?.tiles.find(e => e.tx === tx && e.ty === ty);
    if (!entry?.grid) return null;
    const n = entry.cellsPerEdge;
    const x = Math.floor((point.x / edge - tx) * n), y = Math.floor((point.y / edge - ty) * n);
    if (x < 0 || y < 0 || x >= n || y >= n) return null;
    const i = y * n + x;
    const terrain = code => label(Object.keys(WorldGen.T).find(key => WorldGen.T[key] === code) ?? code);
    const rows = ['<b>Ground</b>'];
    const row = (name, value) => rows.push(`${name}: <b>${esc(value)}</b>`);
    row('Terrain', terrain(entry.grid[i]));
    row('Landcover beneath zone', terrain(Zones.landAt(entry.grid, entry.zone?.under, i)));
    const zone = Zones.at(entry, x, y);
    row('Zone', zone ? Zones.ZONE_KINDS[zone.kind]?.influence === false ? `${zone.kind} · mapped footprint`
      : `${zone.kind} · ${Zones.inCore(zone) ? 'core' : 'fringe'} · ${Math.round(zone.s * 100)}% influence` : 'none');
    if (zone) {
      const a = zone.anchor;
      row('Variant', ZoneVariants.byId(a.variant)?.name || a.variant || 'none');
      row('Zone nexus pattern', a.nexusPattern || 'none');
      rows.push('<small>The pattern belongs to this zone; it does not mean a nexus piece occupies this cell.</small>');
      if (Number.isFinite(a.R) && Zones.ZONE_KINDS[a.kind]?.influence !== false) row('Zone radius', `${a.R.toFixed(1)} m`);
      row('Anchor', a.key || `${a.gx}, ${a.gy}`);
    }
    const reasons = Object.entries(WorldGen.SPAWN_WHY).filter(([, bit]) => entry.spawnWhy?.[i] & bit).map(([name]) => label(name));
    const tier=WorldGen.spawnTierAt(entry.grid,i,{gameplayTiers:entry.gameplayTiers,spawnWhy:entry.spawnWhy});
    row('Gameplay tier', GameplayTiers.TIERS.find(t=>t.id===tier)?.label || 'Excluded');
    row('Source restriction evidence', reasons.join(', ') || 'none');
    row('Level', world.scene?.depth || 0);
    rows.push(`<small>Tile ${tx}, ${ty} · cell ${x}, ${y}</small>`);
    return { entry, x, y, cell: i, content: rows.join('<br>') };
  }
  root.MapReviewGround = { inspect, objectsAt, spawnVerdict };
})(globalThis);
