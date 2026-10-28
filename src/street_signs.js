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
  // Keep the post just outside the actual vector band, not at a snapped
  // cell centre. The caller checks and claims the cell containing its feet.
  function edgeSeats(sign, cellM = 7) {
    const offset = sign.rec.halfW + cellM * .2;
    return [1, -1].map(side => {
      const x = sign.x + sign.nx * side * offset;
      const y = sign.y + sign.ny * side * offset;
      return { x, y, ix: Math.floor(x / cellM), iy: Math.floor(y / cellM) };
    });
  }
  return {direction,candidates,edgeSeats};
})();
if (typeof window !== 'undefined') window.StreetSigns = StreetSigns;
