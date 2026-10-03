// Review the exact geometry retained by the pruning pass, never re-infer it.
(function (root) {
  const REASONS = {
    parking_aisle: 'Explicit service=parking_aisle tag',
    parking_poi: 'Nearby parking-lot marker contributed to the removal threshold',
    nearby_aisle: 'Nearby tagged parking aisle contributed to the removal threshold',
    connected_rows: 'Connected parallel parking rows',
    parking_hairpin: 'Parking hairpin with an interior row',
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function create({map, toLL, getEdge, removedToggle, keptToggle, filter, summary}) {
    const pane = map.createPane('laneReview'); pane.style.zIndex = 450;
    const renderer = L.canvas({pane:'laneReview'}), removed = L.layerGroup(), kept = L.layerGroup();
    let world, removedCount = 0, keptCount = 0;
    function sync() {
      for (const [layer, on] of [[removed,removedToggle.checked],[kept,keptToggle.checked]]) {
        if (on) layer.addTo(map); else map.removeLayer(layer);
      }
      summary.textContent = `${removedCount} removed · ${keptCount} kept service-line fragments across loaded tiles. Click a line for evidence.`;
    }
    function update(next) {
      world = next; removed.clearLayers(); kept.clearLayers(); removedCount = keptCount = 0;
      const edge = getEdge(), seen = new Set();
      function add(entry, feature, line, extent, reasons, isRemoved) {
        if (!line || line.length < 2) return;
        const explicit = reasons.includes('parking_aisle');
        if (isRemoved && ((filter.value === 'inferred' && explicit) || (filter.value === 'explicit' && !explicit))) return;
        const global = line.map(p => [entry.tx + p.x / extent, entry.ty + p.y / extent]);
        const forward = JSON.stringify(global), backward = JSON.stringify([...global].reverse());
        const key = `${isRemoved}|${forward < backward ? forward : backward}`;
        if (seen.has(key)) return; seen.add(key);
        const pts = global.map(([x,y]) => toLL(x * edge,y * edge,edge));
        let metres = 0;
        for (let n = 1; n < line.length; n++) metres += Math.hypot(line[n].x-line[n-1].x,line[n].y-line[n-1].y);
        metres *= entry.cellsPerEdge * WorldGen.CELL_M / extent;
        const tags = feature.tags || {}, title = isRemoved ? 'Removed parking lane' : 'Kept service road';
        const details = isRemoved ? (reasons.length ? reasons.map(r => REASONS[r] || r) : ['Removal reason unavailable in this snapshot'])
          : [tags.service ? `Retained service subtype: ${tags.service}` : 'Did not match the parking-removal rules'];
        const popup = `<b>${title}</b><br>${details.map(esc).join('<br>')}<hr>`
          + `${Math.round(metres)} m · tile ${entry.tx}, ${entry.ty}<br>`
          + `Source feature: ${esc(feature.id ?? 'unavailable')} (may contain multiple ways)<br>`
          + Object.entries(tags).map(([k,v]) => `${esc(k)}=${esc(v)}`).join('<br>')
          + (isRemoved ? '<hr>Absent from road masks, lamps and restoration. Retained as quarry input where eligible.' : '');
        const layer = isRemoved ? removed : kept, color = isRemoved ? '#ff40c8' : '#31d9ff';
        L.polyline(pts,{renderer,pane:'laneReview',color:'#111',weight:isRemoved?9:7,opacity:.7,interactive:false}).addTo(layer);
        L.polyline(pts,{renderer,pane:'laneReview',color,weight:isRemoved?5:3,opacity:1,dashArray:isRemoved?'9 5':null,bubblingMouseEvents:false})
          .bindTooltip(`${title} · ${Math.round(metres)} m`)
          .bindPopup(popup).addTo(layer);
        if (isRemoved) removedCount++; else keptCount++;
      }
      for (const entry of world?.tiles || []) {
        const transport = entry.layers?.find(l => l.name === 'transportation');
        if (!transport) continue;
        for (const record of transport.parkingLanes || []) for (let i=0;i<record.lines.length;i++) {
          add(entry,record.f,record.lines[i],record.extent || transport.extent || 4096,
            record.reasons?.[i] || (WorldGen.isParkingAisle(record.f.tags) ? ['parking_aisle'] : []),true);
        }
        for (const feature of transport.features || []) if (feature.type === 2 && feature.tags?.class === 'service') {
          for (const line of feature.geom || []) add(entry,feature,line,transport.extent || 4096,[],false);
        }
      }
      sync();
    }
    removedToggle.onchange = keptToggle.onchange = sync;
    filter.onchange = () => update(world);
    return {update,removed,kept};
  }
  root.MapReviewLanes = {create};
})(window);
