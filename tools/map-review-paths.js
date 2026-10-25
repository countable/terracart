// Inspect the canonical path sections used for variant assignment.
(function (root) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // MVT buffers repeat neighboring geometry without that tile's theme assignments.
  // Trim before drawing, counting, or hit-testing so the owning tile wins.
  function clipLine(line, extent) {
    return Streets.tileSpans(line, 1, extent).filter(([a, b]) => b - a > 1e-6)
      .map(([a, b]) => Streets.subLineM(line, 1, a, b));
  }
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
  // Label geometry is screen-space and independent of Leaflet. Keep text on
  // a sufficiently straight stretch, upright, and clear of neighboring labels.
  function labelPlacements(rows, project, size, measure, zoom) {
    if (zoom < 17) return [];
    const accepted = [], bins = new Map(), seats = new Map(), binSize = 128;
    const keys = box => {
      const out = [];
      for (let y = Math.floor(box.top / binSize); y <= Math.floor(box.bottom / binSize); y++)
        for (let x = Math.floor(box.left / binSize); x <= Math.floor(box.right / binSize); x++) out.push(`${x},${y}`);
      return out;
    };
    const intersects = (a,b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    for (const row of rows) {
      const title = StreetVariants.VARIANT_BY_ID[row.variant]?.title || 'Plain path';
      const points = row.line.map(project), distances = [0];
      if (points.length < 2 || points.every(p => p.x < 0) || points.every(p => p.x > size.x)
        || points.every(p => p.y < 0) || points.every(p => p.y > size.y)) continue;
      for (let i=1;i<points.length;i++) distances.push(distances[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
      const length = distances[distances.length-1];
      let text = zoom >= 19 && row.mapLabel && row.mapLabel !== title ? `${title} · ${row.mapLabel}` : title;
      if (measure(text)+24 > length) text = title;
      const width = measure(text), half = width/2+8;
      if (length < half*2) continue;
      const at = distance => {
        for(let i=1;i<points.length;i++) if(distances[i]>=distance) {
          const span=distances[i]-distances[i-1],t=span ? (distance-distances[i-1])/span : 0;
          return {x:points[i-1].x+(points[i].x-points[i-1].x)*t,y:points[i-1].y+(points[i].y-points[i-1].y)*t};
        }
        return points[points.length-1];
      };
      // Long sections repeat at most once per 360 pixels. Start in the middle
      // so short sections get the most legible position before nearby repeats.
      const spacing = Math.max(360,width+100), candidates = [length/2];
      for(let d=spacing;d<length/2;d+=spacing)candidates.push(length/2-d,length/2+d);
      // Offer alternate seats if a midpoint bends sharply or meets another label.
      if(length < spacing*2)candidates.push(length*.3,length*.7);
      let last = null;
      for(const distance of candidates) {
        if(distance<half || distance>length-half || (last!=null && Math.abs(distance-last)<spacing*.8))continue;
        const a=at(distance-half),b=at(distance+half),p=at(distance);
        if(Math.hypot(b.x-a.x,b.y-a.y)<half*2*.94)continue;
        const dx=b.x-a.x,dy=b.y-a.y,span=Math.hypot(dx,dy);
        // A straight text baseline must not cut across a hairpin's inside.
        if(Math.abs((p.x-a.x)*dy-(p.y-a.y)*dx)/span>5)continue;
        let angle=Math.atan2(dy,dx);
        if(angle>Math.PI/2)angle-=Math.PI;
        if(angle< -Math.PI/2)angle+=Math.PI;
        const hx=Math.abs(Math.cos(angle))*half+Math.abs(Math.sin(angle))*10;
        const hy=Math.abs(Math.sin(angle))*half+Math.abs(Math.cos(angle))*10;
        const box={left:p.x-hx,right:p.x+hx,top:p.y-hy,bottom:p.y+hy};
        if(box.left<6||box.right>size.x-6||box.top<6||box.bottom>size.y-6)continue;
        if((seats.get(text)||[]).some(other=>Math.hypot(p.x-other.x,p.y-other.y)<spacing*.8))continue;
        const cells=keys(box);
        if(cells.some(key=>(bins.get(key)||[]).some(other=>intersects(box,other))))continue;
        accepted.push({text,x:p.x,y:p.y,angle,box,variant:row.variant});last=distance;
        if(!seats.has(text))seats.set(text,[]);seats.get(text).push(p);
        for(const key of cells){if(!bins.has(key))bins.set(key,[]);bins.get(key).push(box);}
      }
    }
    return accepted;
  }
  function labelLayer(map, toLL, getEdge) {
    const Layer=L.Layer.extend({
      initialize(){this.rows=[];this.placements=[];},
      onAdd(){
        this.canvas=L.DomUtil.create('canvas','leaflet-layer leaflet-zoom-hide path-label-canvas',map.getPane('pathReview'));
        this.canvas.setAttribute('aria-hidden','true');
        map.on('moveend zoomend resize',this.redraw,this);this.redraw();
      },
      onRemove(){map.off('moveend zoomend resize',this.redraw,this);this.canvas.remove();this.canvas=null;this.placements=[];},
      setRows(rows){this.rows=rows;if(this.canvas)this.redraw();},
      redraw(){
        if(!this.canvas)return;
        const size=map.getSize(),dpr=Math.min(devicePixelRatio||1,2),edge=getEdge();
        this.canvas.width=size.x*dpr;this.canvas.height=size.y*dpr;
        this.canvas.style.width=size.x+'px';this.canvas.style.height=size.y+'px';
        L.DomUtil.setPosition(this.canvas,map.containerPointToLayerPoint([0,0]));
        const g=this.canvas.getContext('2d');g.scale(dpr,dpr);
        g.font='600 11px system-ui, sans-serif';g.textAlign='center';g.textBaseline='middle';
        g.lineJoin='round';g.lineWidth=3;g.strokeStyle='rgba(248,243,224,.95)';g.fillStyle='#29352b';
        this.placements=labelPlacements(this.rows,p=>map.latLngToContainerPoint(toLL(p.x*edge,p.y*edge,edge)),size,text=>g.measureText(text).width,map.getZoom());
        for(const p of this.placements){g.save();g.translate(p.x,p.y);g.rotate(p.angle);g.strokeText(p.text,0,0);g.fillText(p.text,0,0);g.restore();}
      },
    });
    return new Layer();
  }
  function create({ map, toLL, getEdge, endpointsToggle, labelsToggle, summary }) {
    const pane = map.createPane('pathReview'); pane.style.zIndex = 460;
    const renderer = L.canvas({ pane: 'pathReview' });
    const dots = L.layerGroup(), labels = labelLayer(map,toLL,getEdge);
    let available = false;
    function sync() {
      available && endpointsToggle.checked ? dots.addTo(map) : map.removeLayer(dots);
      available && labelsToggle.checked && map.getZoom() >= 17 ? labels.addTo(map) : map.removeLayer(labels);
    }
    function update(world) {
      dots.clearLayers();
      const rows = sections(world), edge = getEdge(), endpoints = new Map();
      labels.setRows(rows);
      available = !world.scene?.depth;
      endpointsToggle.disabled = labelsToggle.disabled = !available;
      const ll = p => toLL(p.x * edge, p.y * edge, edge);
      const pointKey = p => `${p.x.toFixed(8)},${p.y.toFixed(8)}`;
      const originals = new Set(sourceEndpoints(world).map(pointKey));
      const reasonLabel = reason => String(reason || 'section boundary').replace(/[-_]/g, ' ');
      for (const row of rows) {
        const variant = StreetVariants.VARIANT_BY_ID[row.variant];
        const detail = `<b>${esc(row.label)}</b><br>${esc(variant?.title || 'Plain path')} · ${Math.round(row.lengthM)} m assignment section<br>Section ${esc(row.key)} · tile ${esc(row.tile)}`;
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
        ? `${rows.length} path sections · ${endpoints.size} endpoint dots · ${mean}. Yellow: path theme transitions (drawn on top). Orange: inferred boundaries and tile cuts. White: natural/source endpoints without a theme change. Forks and true ends remain; nearby terrain and length guide extra splits. Path variants are labelled along the path at zoom 17+, with source names at zoom 19+ where space permits; hover or click a dot for boundary reasons and details.`
        : 'Path assignment geometry is available on the surface.';
      sync();
    }
    endpointsToggle.onchange = labelsToggle.onchange = sync;
    map.on('zoomend', sync);
    return { update, labels };
  }
  root.MapReviewPaths = { clipLine, sections, labelPlacements, create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
