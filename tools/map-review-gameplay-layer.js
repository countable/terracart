// Review-only presentation of the proposed gameplay tiers. The pure classifier
// owns policy and geometry; this layer never changes the generated world.
(function (root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Centroids of actual polygons in the four cached research samples. These
  // are navigation shortcuts, not canned overlays: the current loaded source
  // geometry is classified at every destination, including unseen places.
  const SITES = [
    ['Mission Recreation Park', 'Kelowna', 49.840122, -119.478114],
    ['Mission Creek Greenway', 'Kelowna', 49.848356, -119.465315],
    ['Munson Pond Park', 'Kelowna', 49.863568, -119.460689],
    ['Stanley Park — southern sample', 'Vancouver', 49.294466, -123.144238],
    ['English Bay Beach Park', 'Vancouver', 49.283500, -123.141500],
    ['Vanier Park', 'Vancouver', 49.276137, -123.143068],
    ['Kitsilano Beach Park', 'Vancouver', 49.274865, -123.153277],
    ['Seattle Center', 'Seattle', 47.622061, -122.351266],
    ['Volunteer Park', 'Seattle', 47.630389, -122.315597],
    ['Judkins Park', 'Seattle', 47.593716, -122.303883],
    ['Volkspark Friedrichshain', 'Berlin', 52.527255, 13.435355],
    ['Görlitzer Park', 'Berlin', 52.497175, 13.436156],
    ['Fernsehturm / Neptunbrunnen plaza', 'Berlin', 52.520189, 13.408785],
  ];

  function create({ map, toLL, getEdge, toggle, legend, summary, details, opacity, sitePick }) {
    const pane = map.createPane('gameplayTiers');
    pane.style.zIndex = 425;
    pane.style.pointerEvents = 'none';
    const layer = L.layerGroup(), shown = new Set([1, 2, 3]);
    let world, source, result, pending, revision = 0;
    const tiers = GameplayTiers.TIERS;
    const row = id => tiers.find(t => t.id === id);
    const defaultDetails = 'Click coloured ground for its tier and source evidence. This proposal does not change current spawns.';
    details.textContent = defaultDetails;

    for (const id of [1, 2, 3, 0, 4]) {
      const tier = row(id), label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" data-tier="${id}"${shown.has(id) ? ' checked' : ''}>`
        + `<span class="sw sq" style="background:${esc(tier.color)}"></span> ${esc(tier.label)}`;
      label.title = tier.description;
      label.querySelector('input').onchange = event => {
        event.target.checked ? shown.add(id) : shown.delete(id);
        paint();
      };
      legend.appendChild(label);
    }
    for (const [index, site] of SITES.entries()) {
      const option = document.createElement('option');
      option.value = index; option.textContent = `${site[1]} · ${site[0]}`;
      sitePick.appendChild(option);
    }
    sitePick.onchange = () => {
      if (sitePick.value === '') return;
      const site = SITES[Number(sitePick.value)], url = new URL(location.href);
      url.searchParams.set('lat', site[2]); url.searchParams.set('lon', site[3]);
      url.searchParams.set('r', '1'); url.searchParams.set('tiers', '1');
      url.searchParams.set('site', site[0]); url.searchParams.set('base', 'osm');
      location.assign(url.href);
    };

    function sync() {
      if (toggle.checked) layer.addTo(map); else map.removeLayer(layer);
      if (toggle.checked && world && !result) void refresh();
    }
    function paint() {
      layer.clearLayers();
      if (!result) return;
      const edge = getEdge();
      for (const tile of result.tiles) {
        const e = tile.entry, n = e.cellsPerEdge;
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = n;
        const ctx = canvas.getContext('2d');
        // Horizontal runs keep the diagnostic overlay cheap even on large maps.
        for (let y = 0; y < n; y++) {
          let x = 0;
          while (x < n) {
            const id = tile.tiers[y * n + x], start = x++;
            while (x < n && tile.tiers[y * n + x] === id) x++;
            if (!shown.has(id)) continue;
            ctx.fillStyle = row(id).color; ctx.fillRect(start, y, x - start, 1);
          }
        }
        L.imageOverlay(canvas.toDataURL(), [
          toLL(e.tx * edge, (e.ty + 1) * edge, edge),
          toLL((e.tx + 1) * edge, e.ty * edge, edge),
        ], { pane: 'gameplayTiers', opacity: Number(opacity.value), interactive: false }).addTo(layer);
      }
      const stats = result.stats;
      summary.innerHTML = [1, 2, 3, 0, 4].map(id =>
        `<div><span style="color:${esc(row(id).color)}">${esc(row(id).label)}</span>`
        + ` <b>${(stats.ha[id] || 0).toFixed(2)} ha</b></div>`).join('')
        + '<p>Cell-centre estimates across all loaded tiles, including hidden tiers. Unknown and excluded land are not gameplay recommendations.</p>';
      sync();
    }
    async function refresh() {
      if (!world || result || pending) return;
      const token = revision, next = world, raw = source;
      summary.textContent = 'Classifying source geometry…';
      const task = WorldGen.runStepsSliced(() => GameplayTiers.buildSteps(next, raw));
      pending = task;
      try {
        const value = await task;
        if (token !== revision) return;
        result = value; paint();
      } catch (error) {
        if (token === revision) summary.textContent = `Tier review failed: ${error.message}`;
        console.error(error);
      } finally {
        if (pending === task) pending = null;
        if (token !== revision && toggle.checked) void refresh();
      }
    }
    function update(next, raw) {
      revision++; world = next; source = raw; result = null;
      layer.clearLayers(); details.textContent = defaultDetails;
      summary.textContent = 'Enable the layer to classify the loaded area.';
      if (toggle.checked) void refresh();
    }
    function inspect(latlng) {
      if (!result) return null;
      const z = 1 << WorldGen.Z, lat = latlng.lat * Math.PI / 180;
      const gx = (latlng.lng + 180) / 360 * z;
      const gy = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * z;
      const tile = result.tiles.find(t => t.entry.tx === Math.floor(gx) && t.entry.ty === Math.floor(gy));
      if (!tile) return null;
      const e = tile.entry, n = e.cellsPerEdge;
      const x = Math.floor((gx - e.tx) * n), y = Math.floor((gy - e.ty) * n), i = y * n + x;
      if (x < 0 || y < 0 || x >= n || y >= n) return null;
      const tier = row(tile.tiers[i]), reason = GameplayTiers.REASONS[tile.reasons[i]];
      const content = `<b>${esc(tier.label)}</b><p>${esc(tier.description)}</p>`
        + `<p><b>Evidence:</b> ${esc(reason?.label || 'No matching mapped evidence')}</p>`
        + '<p>Road corridors extend 3 game cells beyond the drawn edge. Tiers infer intended gameplay from map features, not live traffic.</p>'
        + '<small>Road surfaces and current access/spawn exclusions still apply. Review overlay only.</small>';
      details.innerHTML = content;
      return { tier: tier.id, reason: reason?.id, content, entry: e, cell: i };
    }
    map.on('click', event => {
      if (!toggle.checked || event.propagatedFrom || document.getElementById('placeHome')?.classList.contains('on')) return;
      const hit = inspect(event.latlng);
      if (hit) L.popup().setLatLng(event.latlng).setContent(hit.content).openOn(map);
    });
    toggle.onchange = sync;
    opacity.oninput = () => layer.eachLayer(image => image.setOpacity(Number(opacity.value)));
    return { update, inspect, layer, get result() { return result; } };
  }
  root.MapReviewGameplay = { create, SITES };
})(globalThis);
