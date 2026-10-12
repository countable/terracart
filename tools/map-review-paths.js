// Inspect the canonical path sections used for variant assignment.
(function (root) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function sourceEndpoints(world) {
    if (world.scene?.depth > 0) return [];
    return world.tiles.flatMap(e => {
      const extent = e.streetIndex?.extent || 4096;
      return (e.streetIndex?.lines || []).filter(rec => rec.size === 'path' && rec.line.length > 1)
        .flatMap(rec => [rec.line[0], rec.line[rec.line.length - 1]]
          .filter(p => p.x >= 0 && p.y >= 0 && p.x <= extent && p.y <= extent)
          .map(p => ({ x: e.tx + p.x / extent, y: e.ty + p.y / extent,
            label: `${rec.name || 'Path'} · ${rec.featureId != null ? '#' + rec.featureId : 'ID unavailable'}` })));
    });
  }
  function sections(world) {
    if (world.scene?.depth > 0) return [];
    const out = [];
    for (const e of world.tiles) {
      const extent = e.streetIndex?.extent || 4096;
      for (const rec of e.streetIndex?.pathSections || []) {
        const label = `${rec.name || 'Path'} · ${(rec.featureIds || []).map(id => '#' + id).join(', ') || 'ID unavailable'}`;
        const toGlobal = p => ({ x: e.tx + p.x / extent, y: e.ty + p.y / extent });
        for (const [a, b] of Streets.tileSpans(rec.line, 1, extent)) {
          const line = Streets.subLineM(rec.line, 1, a, b);
          if (line.length < 2 || b <= a) continue;
          const half = Streets.subLineM(line, 1, 0, (b - a) / 2);
          const ends = [line[0], line[line.length - 1]].map((p, i) => {
            const boundary = p.x <= 0 || p.y <= 0 || p.x >= extent || p.y >= extent;
            return { ...toGlobal(p), boundary,
              reason: boundary ? 'tile-edge cut' : (i === 0 ? rec.startReason : rec.endReason),
              inferred: boundary ? true : (i === 0 ? rec.startInferred : rec.endInferred) };
          });
          const name = String(rec.name || '').trim();
          const mapLabel = name && !/^#?[\d\s.,/-]+$/.test(name) ? name : '';
          out.push({ key: rec.key, label, mapLabel, variant: rec.variant, lengthM: rec.segmentLengthM,
            line: line.map(toGlobal), midpoint: toGlobal(half[half.length - 1]), ends,
            affinityContext: rec.affinityContext, tile: `${e.tx}/${e.ty}` });
        }
      }
    }
    return out;
  }
  function create({ map, toLL, getEdge, endpointsToggle, labelsToggle, summary }) {
    const pane = map.createPane('pathReview'); pane.style.zIndex = 460;
    const renderer = L.canvas({ pane: 'pathReview' });
    const dots = L.layerGroup(), labels = L.layerGroup();
    let available = false;
    function sync() {
      available && endpointsToggle.checked ? dots.addTo(map) : map.removeLayer(dots);
      available && labelsToggle.checked && map.getZoom() >= 17 ? labels.addTo(map) : map.removeLayer(labels);
    }
    function update(world) {
      dots.clearLayers(); labels.clearLayers();
      const rows = sections(world), edge = getEdge(), endpoints = new Map();
      available = !world.scene?.depth;
      endpointsToggle.disabled = labelsToggle.disabled = !available;
      const ll = p => toLL(p.x * edge, p.y * edge, edge);
      const pointKey = p => `${p.x.toFixed(8)},${p.y.toFixed(8)}`;
      const originals = new Set(sourceEndpoints(world).map(pointKey));
      const reasonLabel = reason => String(reason || 'section boundary').replace(/[-_]/g, ' ');
      for (const row of rows) {
        const variant = StreetVariants.VARIANT_BY_ID[row.variant];
        const detail = `<b>${esc(row.label)}</b><br>${esc(variant?.title || 'Plain path')} · ${Math.round(row.lengthM)} m assignment section<br>Section ${esc(row.key)} · tile ${esc(row.tile)}`;
        if (row.mapLabel) L.tooltip({ permanent: true, direction: 'center', className: 'path-label', opacity: 1 })
          .setLatLng(ll(row.midpoint)).setContent(esc(row.mapLabel)).addTo(labels);
        for (const end of row.ends) {
          const key = pointKey(end);
          let point = endpoints.get(key);
          if (!point) endpoints.set(key, point = { end, inferred: false, variants: new Set(), descriptions: new Set(), labels: new Set() });
          // A tile cut remains inferred even when a source endpoint shares its position.
          point.inferred ||= end.inferred ?? (end.boundary || !originals.has(key));
          point.variants.add(row.variant || '__plain');
          const reason = reasonLabel(end.reason);
          point.descriptions.add(detail + `<br>Boundary: ${esc(reason)}` + (end.boundary ? '; the path may continue.' : '.'));
          point.labels.add(`${row.label} · ${reason} · ${Math.round(row.lengthM)} m`);
        }
      }
      // Theme changes win even at natural endpoints and junctions. Draw them
      // last so overlapping white/orange dots cannot hide the transition.
      const priority = p => p.variants.size > 1 ? 2 : Number(p.inferred);
      const points = [...endpoints.values()].sort((a, b) => priority(a) - priority(b));
      for (const { end, inferred, variants, descriptions, labels: names } of points) {
        const transition = variants.size > 1;
        if (transition) {
          const themes = [...variants].map(id => StreetVariants.VARIANT_BY_ID[id]?.title || 'Plain path').join(' / ');
          names.add(`Theme transition: ${themes}`);
          descriptions.add(`<b>Theme transition:</b> ${esc(themes)}`);
        }
        L.circleMarker(ll(end), { renderer, pane: 'pathReview', radius: transition ? 5 : 4, color: '#262626', weight: 1.5,
          fillColor: transition ? '#ffd54f' : inferred ? '#ffb347' : '#ffffff', fillOpacity: 1, opacity: 1 })
          .bindTooltip([...names].map(esc).join('<br>'))
          .bindPopup([...descriptions].join('<hr>')).addTo(dots);
      }
      const measured = [...new Map(rows.filter(row => row.lengthM >= StreetVariants.PATH_SECTION_MIN_M && !row.ends.some(end => end.boundary))
        .map(row => [row.key, row])).values()];
      const mean = measured.length
        ? `${Math.round(measured.reduce((sum, row) => sum + row.lengthM, 0) / measured.length)} m mean (${measured.length} complete sections ≥${StreetVariants.PATH_SECTION_MIN_M} m)`
        : `No complete sections ≥${StreetVariants.PATH_SECTION_MIN_M} m for mean`;
      summary.textContent = available
        ? `${rows.length} path sections · ${endpoints.size} endpoint dots · ${mean}. Yellow: path theme transitions (drawn on top). Orange: inferred boundaries and tile cuts. White: natural/source endpoints without a theme change. Forks and true ends remain; nearby terrain and length guide extra splits. Named paths show labels at zoom 17+; hover or click a dot for boundary reasons and details.`
        : 'Path assignment geometry is available on the surface.';
      sync();
    }
    endpointsToggle.onchange = labelsToggle.onchange = sync;
    map.on('zoomend', sync);
    return { update };
  }
  root.MapReviewPaths = { sections, create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
