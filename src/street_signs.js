// Wayfinding names come only from roads that meet this endpoint. These are
// local directions, not invented destinations or a global route planner.
const StreetSigns = (() => {
  const COMPASS = ['East','Southeast','South','Southwest','West','Northwest','North','Northeast'];
  function direction(dx, dy) {
    return COMPASS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
  }
  function title(rec) {
    const row = typeof StreetVariants !== 'undefined' && StreetVariants.VARIANT_BY_ID?.[rec.variant];
    return row?.title || rec.title || rec.name || rec.variant?.replaceAll('_', ' ');
  }
  function candidates(index, cellM = 7) {
    const scale = index.mvtToM || 1;
    const rows = (index.dressingLines || index.lines || []).filter(r => r.variant && r.line?.length > 1);
    const result = [], seen = new Set();
    for (const rec of rows) {
      // Canonical endpoint ownership prevents duplicate signs for reversed
      // geometry and gives each road section one stable roadside landmark.
      const ends = [rec.line[0], rec.line.at(-1)].sort((a,b) => a.x-b.x || a.y-b.y);
      const p = ends[0], key = `${rec.key}|${rec.variant}|${p.x},${p.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const directions = [], listed = new Set();
      for (const other of rows) {
        if ((other.tags?.layer || 0) !== (rec.tags?.layer || 0) || (other.tags?.brunnel || '') !== (rec.tags?.brunnel || '')) continue;
        let closest = null, d2 = Infinity, tangent = null;
        for (let i = 1; i < other.line.length; i++) {
          const a = other.line[i-1], b = other.line[i], dx = b.x-a.x, dy = b.y-a.y;
          const len2 = dx*dx+dy*dy;
          if (!len2) continue;
          const t = Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2));
          const q = {x:a.x+t*dx,y:a.y+t*dy}, distance = (q.x-p.x)**2+(q.y-p.y)**2;
          if (distance < d2) { d2=distance; closest=q; tangent={a,b,t}; }
        }
        if (!closest || Math.sqrt(d2)*scale > cellM*2) continue;
        // At a junction a line can lead both ways. At its endpoint it only
        // points into the line, never beyond the supplied map geometry.
        const targets = [];
        if (tangent.t > .05) targets.push(tangent.a);
        if (tangent.t < .95) targets.push(tangent.b);
        for (const target of targets) {
          const dx=target.x-closest.x,dy=target.y-closest.y;
          if (Math.hypot(dx,dy)*scale < cellM*.2) continue;
          const heading=direction(dx,dy), id=heading+'|'+other.variant;
          if (listed.has(id)) continue;
          listed.add(id);directions.push({direction:heading,title:title(other),variant:other.variant});
        }
      }
      if (!directions.length) continue;
      const adjacent = rec.line[0] === p ? rec.line[1] : rec.line.at(-2);
      const dx=adjacent.x-p.x,dy=adjacent.y-p.y,len=Math.hypot(dx,dy);
      const ahead=Math.min(cellM*1.5,len*scale*.5);
      result.push({rec,x:p.x*scale+dx/len*ahead,y:p.y*scale+dy/len*ahead,
        nx:-dy/len,ny:dx/len,directions:directions.sort((a,b)=>a.direction.localeCompare(b.direction)||a.title.localeCompare(b.title))});
    }
    return result;
  }
  // A shared atlas covers all eight-way junction combinations. Bake once at
  // scene startup; rebuilding visible cells only selects a frame.
  function frame(object) {
    return (object.directions || []).reduce((mask, row) => {
      const bit = COMPASS.indexOf(row.direction);
      return bit < 0 ? mask : mask | (1 << bit);
    }, 0);
  }
  function paint(ctx, mask) {
    // Low octagonal stone compass: its arms use screen/world north, not
    // the conventional left/right boards of an upright signpost.
    const polygon = (points, fill) => {
      ctx.fillStyle = fill; ctx.beginPath();
      points.forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
      ctx.closePath(); ctx.fill();
    };
    polygon([[7,5],[25,5],[29,9],[29,25],[25,29],[7,29],[3,25],[3,9]], '#252d2e');
    polygon([[7,3],[25,3],[29,7],[29,23],[25,27],[7,27],[3,23],[3,7]], '#96876a');
    polygon([[8,5],[24,5],[27,8],[27,22],[24,25],[8,25],[5,22],[5,8]], '#344747');
    for (let i=0;i<8;i++) {
      if (!(mask & (1 << i))) continue;
      const angle=i*Math.PI/4, dx=Math.cos(angle), dy=Math.sin(angle);
      const points=[[3,-2],[7,-2],[7,-4],[12,0],[7,4],[7,2],[3,2]]
        .map(([along,across]) => [Math.round(16+dx*along-dy*across),Math.round(15+dy*along+dx*across)]);
      polygon(points, '#e7c47d');
      ctx.strokeStyle='#f5dfaa'; ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(16+dx*4,15+dy*4);ctx.lineTo(16+dx*9,15+dy*9);ctx.stroke();
    }
    ctx.fillStyle='#1e3033';ctx.fillRect(13,12,6,6);
    ctx.fillStyle='#8cb7aa';ctx.fillRect(14,13,4,4);
  }
  return {direction,candidates,frame,paint};
})();
if (typeof window !== 'undefined') window.StreetSigns = StreetSigns;
