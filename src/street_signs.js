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
  // FINGERBOARDS. A sign is drawn as a post plus one board per listed
  // direction (render.js RENDER_SPEC.roadsign / roadsign_board). Both textures
  // are baked at scene start (textures.js makeRoadSignTextures) from this one
  // table, which the seat maths and the tests read too. Source pixels, drawn
  // at `scale` like the other 16px roadside props.
  //   post:  a frame-filling pole on a plinth — its opaque bottom is the frame
  //          bottom, so the renderer's full-frame contact seat is the real one.
  //   board: a plank pointing EAST, its pivot the post end (origin [0, .5]);
  //          `tipX` is the arrowhead's column, which the bake test pins.
  //   Boards hang from `topRow` down at `pitch(n)` rows, so a two-road
  //   junction wears its boards near the top like a real fingerpost while a
  //   crowded one still shows every heading above the plinth (`lastRow`).
  const ART = Object.freeze({
    scale: 1.6,
    post: Object.freeze({ fw: 16, fh: 40, poleX: 6, poleW: 4, topRow: 4, lastRow: 32 }),
    board: Object.freeze({ fw: 22, fh: 9, tipX: 21, shaftTo: 15 }),
    maxPitch: 5, minPitch: 2,
  });
  function vector(direction) {
    const i = COMPASS.indexOf(direction);
    return i < 0 ? null : { x: Math.cos(i * Math.PI / 4), y: Math.sin(i * Math.PI / 4) };
  }
  // A board is a horizontal plank, so it lies in the same plane as the flat
  // ground marks and takes their projection (render.js GROUND_MARK.tilt): a
  // board pointing east or west keeps its full length, one pointing north or
  // south shows `tilt` of it, and the screen angle is the projected vector's.
  // The caller hands in the vector already turned for heading-up, since the
  // camera stays south of the screen however the map turns. A sprite can only
  // rotate and stretch, so the plank's width is not projected; its centre line
  // — the direction it points — is exact, which is what a wayfinding board is for.
  function boardPose(vec, tilt) {
    const x = vec.x, y = vec.y * tilt;
    return { angle: Math.atan2(y, x), length: Math.hypot(x, y) };
  }
  function boardPitch(count) {
    const span = ART.post.lastRow - ART.post.topRow;
    return Math.max(ART.minPitch, Math.min(ART.maxPitch, Math.floor(span / Math.max(1, count - 1))));
  }
  // Source row (post frame) of board `slot` of `count`, from the top down.
  function boardRow(slot, count) {
    return ART.post.topRow + slot * boardPitch(count);
  }
  return {direction,candidates,edgeSeats,ART,vector,boardPose,boardPitch,boardRow};
})();
if (typeof window !== 'undefined') window.StreetSigns = StreetSigns;
