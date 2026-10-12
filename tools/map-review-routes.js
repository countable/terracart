// Hit-test the same source geometry and theme sections that the art layer draws.
(function (root) {
  const cache = new WeakMap();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  function distance(point, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
    return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
  }
  function routes(entry, edge) {
    const saved = cache.get(entry);
    if (saved?.edge === edge) return saved.rows;
    const rows = [], layer = entry.layers?.find(l => l.name === 'transportation');
    const scale = edge / (layer?.extent || 4096);
    for (const [fi, feature] of (layer?.features || []).entries()) {
      if (feature.type !== 2 || WorldGen.isLotLane(feature.tags)
          || WorldGen.classifyLine('transportation', feature.tags) == null) continue;
      const width = WorldGen.roadOverlayWidthM(feature.tags);
      if (!width) continue;
      for (const [li, line] of (feature.geom || []).entries()) {
        if (line.length < 2) continue;
        const record = entry.streetIndex?.lines?.find(r => r.fi === fi && r.li === li);
        for (const style of StreetVariants.lineStyles(entry, feature, fi, li, scale)) {
          const section = entry.streetIndex?.pathSections?.find(s => s.key === style.key);
          for (const clipped of MapReviewPaths.clipLine(Streets.subLineM(line, scale, style.a, style.b), edge)) {
            const points = clipped.map(p => ({ x: entry.tx * edge + p.x, y: entry.ty * edge + p.y }));
            rows.push({ entry, feature, record, section, style, width, points, scale,
              isPath: WorldGen.PATH_CLASSES.has(feature.tags?.class) });
          }
        }
      }
    }
    cache.set(entry, { edge, rows });
    return rows;
  }
  function content(hit) {
    const { entry, feature, record, section, style, width, scale, isPath } = hit;
    const owner = section || record, tags = feature.tags || {};
    const title = id => StreetVariants.VARIANT_BY_ID[id]?.title || id;
    const name = section?.name || record?.name || tags.name || (isPath ? 'Unnamed path' : 'Unnamed road');
    const rows = [`<b>${esc(name)}</b>`];
    const row = (label, value) => rows.push(`${label}: <b>${esc(value)}</b>`);
    row('Type', [isPath ? 'Walking path' : 'Road', tags.class, tags.subclass].filter(Boolean).join(' · '));
    row('Variant', StreetVariants.roadStoryFor(tags)?.title || title(style.variant) || (isPath ? 'Plain path' : 'Plain road'));
    const middle = (style.a + style.b) / (2 * scale);
    if (record?.nexusSuppressedRanges?.some(([a, b]) => middle >= a && middle < b)) {
      row('Theme suppressed', 'Inside nexus coverage');
    } else if (isPath && owner?.selectedVariant && owner.selectedVariant !== style.variant) {
      row('Scenic override', `${title(style.variant)} (weighted pick: ${title(owner.selectedVariant)})`);
    }
    row('Rendered width', `${width.toFixed(1)} m`);
    const length = section?.segmentLengthM || style.segmentLengthM || record?.segmentLengthM;
    row(length ? 'Assignment section' : 'Visible source segment', `${Math.round(length || style.b - style.a)} m`);
    if (section) row('Boundaries', `${section.startReason || 'unknown'} → ${section.endReason || 'unknown'}`);
    const context = owner?.affinityContext;
    const traits = Object.entries(context || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    row('Affinity context', traits.length ? traits.map(([trait, n]) => `${trait} ${Math.round(n * 100)}%`).join(', ') : 'Not recorded for this segment');
    if (context && owner?.size) {
      const boosts = StreetVariants.selectionWeights(name, owner.size, context).filter(r => r.nameMultiplier > 1);
      row('Name influence', boosts.length ? boosts.map(r => `${title(r.id)} ×${r.nameMultiplier.toFixed(1)}`).join(', ') : 'No matching name keywords');
    }
    for (const key of ['ref', 'surface', 'foot', 'access', 'layer', 'brunnel']) if (tags[key] != null) row(key, tags[key]);
    row('Source feature IDs', (section?.featureIds || [feature.id]).filter(id => id != null).join(', ') || 'Unavailable');
    if (owner?.key) rows.push(`<small>Section ${esc(owner.key)}</small>`);
    rows.push(`<small>Tile ${entry.tx}, ${entry.ty}</small>`);
    return rows.join('<br>');
  }
  function inspect({ world, point, project, edge }) {
    if (!world || world.scene?.depth > 0 || !(edge > 0)) return null;
    const pixel = project(point), hits = [];
    for (const entry of world.tiles) {
      // Source features have buffers; inspect the owning tile to avoid duplicates.
      if (entry.tx !== Math.floor(point.x / edge) || entry.ty !== Math.floor(point.y / edge)) continue;
      for (const route of routes(entry, edge)) {
        const points = route.points.map(project);
        const a = project(point), b = project({ x: point.x + route.width / 2, y: point.y });
        const tolerance = Math.max(6, Math.hypot(b.x - a.x, b.y - a.y));
        let nearest = Infinity;
        for (let i = 1; i < points.length; i++) nearest = Math.min(nearest, distance(pixel, points[i - 1], points[i]));
        if (nearest <= tolerance) hits.push({ ...route, distance: nearest });
      }
    }
    hits.sort((a, b) => a.distance - b.distance);
    const unique = hits.filter((hit, i) => !hits.slice(0, i).some(other =>
      other.feature === hit.feature && (other.style.key || other.record?.key) === (hit.style.key || hit.record?.key)));
    if (!unique.length) return null;
    return { hits: unique, content: unique.slice(0, 3).map(content).join('<hr>') };
  }
  root.MapReviewRoutes = { distance, routes, content, inspect };
})(globalThis);
