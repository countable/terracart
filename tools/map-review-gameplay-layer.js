// Presentation of the authoritative per-cell gameplay tiers.
(function (root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function create({ map, toLL, getEdge, toggle, legend, summary, details, opacity }) {
    const pane = map.createPane('gameplayTiers');
    pane.style.zIndex = 425;
    pane.style.pointerEvents = 'none';
    const layer = L.layerGroup(), shown = new Set([1, 2, 3]);
    let world, source, result, pending, revision = 0;
    const tiers = GameplayTiers.TIERS;
    const row = id => tiers.find(t => t.id === id);
    const defaultDetails = 'Click coloured ground for its tier and source evidence. These tiers govern spawn eligibility.';
    details.textContent = defaultDetails;

    for (const id of [1, 2, 3, 4]) {
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
      summary.innerHTML = [1, 2, 3, 4].map(id =>
        `<div><span style="color:${esc(row(id).color)}">${esc(row(id).label)}</span>`
        + ` <b>${(stats.ha[id] || 0).toFixed(2)} ha</b></div>`).join('')
        + '<p>Cell-centre estimates across all loaded tiles, including hidden tiers. Excluded land includes areas without qualifying mapped evidence.</p>';
      sync();
    }
    async function refresh() {
      if (!world || result || pending) return;
      const token = revision, next = world, raw = source;
      summary.textContent = 'Classifying source geometry…';
      const task = Promise.resolve(GameplayTiers.fromEntries(next))
        .then(value => value || WorldGen.runStepsSliced(() => GameplayTiers.buildSteps(next, raw)));
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
      const allowed = Object.keys(GameplayTiers.CLASS_TIERS).filter(cls => GameplayTiers.allowed(tier.id, cls));
      const content = `<b>${esc(tier.label)}</b><p>${esc(tier.description)}</p>`
        + `<p><b>Evidence:</b> ${esc(reason?.label || 'No matching mapped evidence')}</p>`
        + `<p><b>Allowed spawn classes:</b> ${allowed.length ? allowed.map(esc).join(', ') : 'None'}</p>`
        + '<p>MD/LG road buffers extend 3 game cells beyond their edges; intersection buffers extend 5 cells. Mapped paths and their 1-cell buffer interrupt Passing ground. Street surfaces override zones: medium/large are excluded, small through streets are calm, and small dead ends are passing. Passing excludes hazards and fast movers.</p>'
        + '<small>Excluded cells cannot host spawns. Live occupancy and placement constraints also apply.</small>';
      details.innerHTML = content;
      return { tier: tier.id, reason: reason?.id, content, entry: e, cell: i };
    }
    toggle.onchange = sync;
    opacity.oninput = () => layer.eachLayer(item => item.setOpacity(Number(opacity.value)));
    return { update, inspect, layer, get result() { return result; } };
  }
  root.MapReviewGameplay = { create };
})(globalThis);
