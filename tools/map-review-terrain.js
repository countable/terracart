// Outline unions of terrain cells, including holes, without internal grid lines.
(function (root) {
  function borders(tiles, type) {
    const byTile = new Map(tiles.map(e => [`${e.tx},${e.ty}`, e]));
    const segments = [];
    let cells = 0;
    const isType = (e, x, y) => {
      const n = e.cellsPerEdge;
      if (x >= 0 && y >= 0 && x < n && y < n) return e.grid[y * n + x] === type;
      const gx = e.tx + (x + 0.5) / n, gy = e.ty + (y + 0.5) / n;
      const tx = Math.floor(gx), ty = Math.floor(gy), other = byTile.get(`${tx},${ty}`);
      if (!other) return false;
      const m = other.cellsPerEdge;
      return other.grid[Math.floor((gy - ty) * m) * m + Math.floor((gx - tx) * m)] === type;
    };
    for (const e of tiles) {
      const n = e.cellsPerEdge;
      for (const value of e.grid) if (value === type) cells++;
      // Merge adjacent collinear edges before handing them to Leaflet.
      for (let y = 0; y <= n; y++) {
        let start = -1;
        for (let x = 0; x <= n; x++) {
          const edge = x < n && isType(e, x, y - 1) !== isType(e, x, y);
          if (edge && start < 0) start = x;
          if (!edge && start >= 0) {
            segments.push([[e.tx + start / n, e.ty + y / n], [e.tx + x / n, e.ty + y / n]]);
            start = -1;
          }
        }
      }
      for (let x = 0; x <= n; x++) {
        let start = -1;
        for (let y = 0; y <= n; y++) {
          const edge = y < n && isType(e, x - 1, y) !== isType(e, x, y);
          if (edge && start < 0) start = y;
          if (!edge && start >= 0) {
            segments.push([[e.tx + x / n, e.ty + start / n], [e.tx + x / n, e.ty + y / n]]);
            start = -1;
          }
        }
      }
    }
    return { segments, cells };
  }

  function create({ map, legend, status, getWorld, getType, toLL, getEdge }) {
    const pane = map.createPane('terrainHighlight');
    pane.style.zIndex = 625;
    pane.style.pointerEvents = 'none';
    const renderer = L.canvas({ pane: 'terrainHighlight', padding: 0.5 });
    const layer = L.layerGroup().addTo(map);
    let selected = null;
    function update() {
      layer.clearLayers();
      for (const button of legend.querySelectorAll('[data-terrain]')) {
        button.setAttribute('aria-pressed', String(button.dataset.terrain === selected));
      }
      if (!selected) {
        status.textContent = 'Click a ground type to outline it. Click again to clear.';
        return;
      }
      const result = borders(getWorld()?.tiles || [], getType(selected));
      const edge = getEdge();
      const lines = result.segments.map(line => line.map(([x, y]) => toLL(x * edge, y * edge, edge)));
      const style = { renderer, pane: 'terrainHighlight', interactive: false, opacity: 1, lineCap: 'round', lineJoin: 'round' };
      if (lines.length) {
        L.polyline(lines, { ...style, color: '#111', weight: 8 }).addTo(layer);
        L.polyline(lines, { ...style, color: '#fff', weight: 5 }).addTo(layer);
      }
      status.textContent = `${selected.toLowerCase().replace(/_/g, ' ')}: ${result.cells.toLocaleString()} cells outlined in white.`;
    }
    legend.addEventListener('click', event => {
      const button = event.target.closest('[data-terrain]');
      if (!button || !legend.contains(button)) return;
      selected = selected === button.dataset.terrain ? null : button.dataset.terrain;
      update();
    });
    return { update };
  }
  root.TerrainReview = { borders, create };
})(globalThis);
