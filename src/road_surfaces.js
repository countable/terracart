// Fixed MD/LG surfaces. These follow road class and restoration, never variant
// assignment. Native ground grain and rune rows are baked offline by
// tools/build_road_surfaces.py; rebuilds never read image pixels.
(function (global) {
  'use strict';
  const TILE_PX = 128;
  const MATERIAL_FRAME = { md: [0, 1], lg: [2, 3] };
  // Each weathered frame's mean opaque colour, measured offline from
  // surfaces.png (rebuilds never read pixels). Street-name labels take
  // their ink from it (RoadOverlay.labelInk); re-measure when the atlas changes.
  const MEAN_COLOR = { md: '#776f60', lg: '#1f2e2e' };
  const materials = new Map();
  /* RUNE_ROWS_START */
  const RUNE_ROWS = [[6,9,2],[10,11,2],[5,6,3],[6,8,4],[9,10,4],[5,11,6],[6,7,7],[8,9,7],[6,10,8],[5,7,10],[9,11,10],[5,6,11],[7,9,11],[10,11,11],[5,6,12],[10,11,12]];
  /* RUNE_ROWS_END */

  function familyFor(tags) {
    const WG = global.WorldGen;
    if (!WG) return null;
    const tier = WG.classifyLine('transportation', tags || {});
    return tier === WG.T.ROAD_MD ? 'md' : tier === WG.T.ROAD_LG ? 'lg' : null;
  }
  function setSource(source) {
    materials.clear();
    if (!source || typeof document === 'undefined') return;
    for (const [family, frames] of Object.entries(MATERIAL_FRAME)) {
      for (let state = 0; state < 2; state++) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = TILE_PX;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(source, frames[state] * TILE_PX, 0, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
        materials.set(`${family}:${!!state}`, canvas);
      }
    }
  }
  function tile(family, restored) {
    return materials.get(`${family}:${!!restored}`) || null;
  }
  function metrics(run) {
    const distances = [0];
    for (let i = 1; i < run.length; i++) {
      distances.push(distances[i - 1] + Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y));
    }
    const normals = run.slice(1).map((p,i) => {
      const dx=p.x-run[i].x,dy=p.y-run[i].y,length=Math.hypot(dx,dy);
      return length ? {x:-dy/length,y:dx/length} : null;
    });
    const joins=run.map((p,i) => {
      let a=i-1,b=i;
      while (a>=0 && !normals[a]) a--;
      while (b<normals.length && !normals[b]) b++;
      const before=normals[a] || normals[b] || {x:0,y:1};
      const after=normals[b] || before;
      const x=before.x+after.x,y=before.y+after.y,len=Math.hypot(x,y);
      if (len<1e-5) return after;
      const scale=Math.min(2,2/len)/len;
      return {x:x*scale,y:y*scale};
    });
    return { run, distances, joins, length: distances[distances.length - 1] || 0 };
  }
  function at(m, distance, offset = 0) {
    const s = Math.max(0, Math.min(m.length, distance));
    let low = 1, high = m.run.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (m.distances[mid] < s) low = mid + 1;
      else high = mid;
    }
    const i = low, a = m.run[i - 1], b = m.run[i];
    const length = m.distances[i] - m.distances[i - 1];
    const dx = length ? (b.x - a.x) / length : 1;
    const dy = length ? (b.y - a.y) / length : 0;
    const t = length ? (s - m.distances[i - 1]) / length : 0;
    // Interpolate the bounded vertex miters along each segment. An offset
    // channel now meets its next segment at the same point at every bend.
    const ja=m.joins[i-1],jb=m.joins[i];
    const nx=ja.x+(jb.x-ja.x)*t,ny=ja.y+(jb.y-ja.y)*t;
    return { x: a.x + (b.x - a.x) * t + nx * offset,
      y: a.y + (b.y - a.y) * t + ny * offset, dx, dy, nx: -dy, ny: dx };
  }
  // Clip the arclength ranges before sampling. A distant or long source way
  // cannot turn one viewport rebuild into thousands of invisible glyphs.
  function visibleSpans(m, scene, width) {
    if (!(scene?.viewSize > 0)) return [[0, m.length]];
    const pad = width + 12;
    const left = scene.viewLeft - pad, right = scene.viewLeft + scene.viewSize + pad;
    const top = scene.viewTop - pad, bottom = scene.viewTop + scene.viewSize + pad;
    const spans = [];
    for (let i = 1; i < m.run.length; i++) {
      const a = m.run[i - 1], b = m.run[i], dx = b.x - a.x, dy = b.y - a.y;
      let lo = 0, hi = 1, rejected = false;
      for (const [p, q] of [[-dx, a.x-left], [dx, right-a.x], [-dy, a.y-top], [dy, bottom-a.y]]) {
        if (!p) { if (q < 0) rejected = true; continue; }
        const t = q / p;
        if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
      }
      if (rejected || hi < lo) continue;
      const length = m.distances[i] - m.distances[i - 1];
      const span = [m.distances[i - 1] + lo*length, m.distances[i - 1] + hi*length];
      const last = spans[spans.length - 1];
      if (last && span[0] <= last[1] + 1e-5) last[1] = span[1]; else spans.push(span);
    }
    return spans;
  }
  function firstRepeat(start, step, offset, phase) {
    return Math.ceil((start + phase - offset) / step) * step + offset - phase;
  }
  function trace(m, lo, hi, phase, offset = 0, rough = 0, step = 8) {
    const shift = s => offset + rough * (Math.sin((s+phase)*.13)*.62 + Math.sin((s+phase)*.31)*.38);
    const points = [at(m, lo, shift(lo))];
    for (let s = firstRepeat(lo, step, 0, phase); s < hi; s += step) {
      if (s > lo + 1e-5) points.push(at(m, s, shift(s)));
    }
    // Include source vertices so banks and drains follow bends exactly.
    const anchors = m.distances.filter(s => s > lo && s < hi);
    if (anchors.length) {
      const all = [lo, hi, ...anchors];
      for (let s = firstRepeat(lo, step, 0, phase); s < hi; s += step) if (s > lo) all.push(s);
      return all.sort((a,b) => a-b).map(s => at(m, s, shift(s)));
    }
    points.push(at(m, hi, shift(hi))); return points;
  }
  function stroke(g, points, width, color, alpha, roadWidth) {
    if (points.length > 1) g.decorPath(width, color, points, alpha, roadWidth);
  }
  function noise(index, salt) {
    let n = (index ^ salt) >>> 0;
    n = Math.imul(n ^ n >>> 16, 0x7feb352d);
    n = Math.imul(n ^ n >>> 15, 0x846ca68b);
    return ((n ^ n >>> 16) >>> 0) / 4294967296;
  }
  function glyph(g, m, distance, roadWidth) {
    const p = at(m, distance), scale = Math.min(.65, roadWidth / 80);
    for (const [x0, x1, y] of RUNE_ROWS) {
      const point = x => ({ x: p.x + p.nx*(x-8)*scale + p.dx*(y-8)*scale,
        y: p.y + p.ny*(x-8)*scale + p.dy*(y-8)*scale });
      stroke(g, [point(x0), point(x1)], Math.max(.55, scale), 0x9ccfb9, .95, roadWidth);
    }
  }
  // Face geometry is expressed in arclength/cross-road coordinates. Keeping
  // the repeat anchored to the original way makes a repair reveal the same
  // stones, rather than sliding a new pattern under the completed interval.
  function face(g, m, s, offset, length, breadth, color, alpha, width, salt) {
    const chip = Math.min(length,breadth)*(.12+noise(salt,371)*.12);
    const notch = .65+noise(salt,373)*.7;
    const points = [[-length/2+chip,-breadth/2], [length/2-chip*notch,-breadth/2+.25],
      [length/2,-breadth/2+chip*notch], [length/2-.25,breadth/2-chip],
      [length/2-chip*1.4,breadth/2], [-length/2+chip*notch,breadth/2-.3],
      [-length/2,breadth/2-chip*notch], [-length/2+.15,-breadth/2+chip]]
      .map(([along, across]) => at(m, s+along, offset+across));
    if (g.decorPolygon) g.decorPolygon(color, points, alpha, width);
    else stroke(g, [at(m,s-length/2,offset),at(m,s+length/2,offset)], breadth, color, alpha, width);
  }
  function edge(g, points, width, color, alpha, roadWidth) {
    if (points.length < 2) return;
    if (g.edgePath) g.edgePath(width,color,points,alpha,roadWidth);
    else stroke(g,points,width,color,alpha,roadWidth);
  }
  function medium(g, m, spans, width, restored, phase) {
    const course = 26, band = 2.3, rowStep = 3.6;
    const rows = Math.floor(width*.88/rowStep);
    for (const [lo, hi] of spans) {
      // Closely packed small setts sit within larger worn stone dividers.
      // No green ink: the silhouette and alpha fringe expose actual terrain.
      for (let row = 0; row < rows; row++) {
        const off = (row-(rows-1)/2)*rowStep;
        if (Math.abs(Math.abs(off)-width*.32) < 2) continue;
        for (let s = firstRepeat(lo-3, 6.5, (row&1)*3.25, phase); s < hi+3; s += 6.5) {
          const index = Math.round((s+phase)*4), salt = row*131+41;
          const crossDistance = ((s+phase)%course+course)%course;
          if (crossDistance < 2 || crossDistance > course-2) continue;
          const keep = noise(index,salt);
          if (!restored && keep < .23) continue;
          const tone = noise(index,salt+1);
          const color = tone < .33 ? 0x938a74 : tone < .7 ? 0xa69b81 : 0xb5a98e;
          const jitter=(noise(index,salt+2)-.5)*1.2;
          const half=1.65+noise(index,salt+3)*.8;
          const tilt=(noise(index,salt+4)-.5)*.5;
          stroke(g, [at(m,Math.max(0,s-half),off+jitter),at(m,Math.min(m.length,s+half),off+jitter+tilt)],
            1.8+noise(index,salt+5)*.55, color, restored ? .72 : .55, width);
        }
      }
      for (let s = firstRepeat(lo-course, course, 0, phase); s < hi+course; s += course) {
        const index = Math.round((s+phase)/course);
        if (s >= lo-band && s <= hi+band) {
          for (let row = -1; row <= 1; row++) {
            if (!restored && noise(index,row+271)<.25) continue;
            face(g,m,s,row*width*.29,band,width*.25,0xa79b82,restored?.75:.57,width,index+row);
          }
        }
        for (const side of [-1,1]) {
          if (s+course/2 < lo-course/2 || s+course/2 > hi+course/2) continue;
          if (!restored && noise(index,side+173)<.3) continue;
          face(g,m,s+course/2,side*width*.32,course-4,band,0xa89c83,restored?.72:.53,width,index);
        }
      }
      // Low, broken neutral shoulders; never a continuous grass/black border.
      for (const side of [-1,1]) {
        for (let s=firstRepeat(lo,11,side>0?3:8,phase); s<hi; s+=11) {
          const index=Math.round(s+phase), off=side*width*.455;
          edge(g,[at(m,s,off),at(m,Math.min(hi,s+5),off)],1.6,0x756c59,restored?.30:.4,width);
        }
      }
      if (!restored && g.cutPath) {
        for (let s=firstRepeat(lo,31,13,phase);s<hi;s+=31) {
          const index=Math.round((s+phase-13)/31),side=index&1?-1:1;
          g.cutPath(3+noise(index,89)*3,[at(m,s,side*width*.49),at(m,s+2,side*width*.40)],width);
        }
      }
    }
  }
  function large(g, m, spans, width, restored, phase) {
    for (const [lo, hi] of spans) {
      if (!restored) {
        const scar = trace(m, lo, hi, phase, 0, width*.065, 5);
        stroke(g, scar, width*.14, 0x387f75, .25, width);
        stroke(g, scar, 2.2, 0x71cdb7, .85, width);
        stroke(g, scar, .9, 0x071c22, 1, width);
        // Small broken slate plates stagger irregularly along both banks.
        // A thin bevel and muted face read as flat fracture, not round gravel.
        for (const side of [-1,1]) for (let row=0;row<2;row++) {
          for (let s=firstRepeat(lo-9,19,row*8+side*3,phase);s<hi+9;s+=19) {
            const index=Math.round(s+phase),salt=row*71+side+91;
            if(noise(index,salt+7)<.13)continue;
            const center=s+(noise(index,salt+6)-.5)*5;
            const off=side*width*(.18+row*.21)+(noise(index,salt)-.5)*4;
            const length=10+noise(index,salt+1)*6,breadth=7+noise(index,salt+2)*3;
            const tone=noise(index,salt+3);
            face(g,m,center,off,length,breadth,
              tone>.7?0x4b595b:tone>.3?0x405053:0x35454a,.86,width,index+salt);
            stroke(g,[at(m,center-length*.32,off-side*breadth*.38),
              at(m,center+length*.24,off-side*breadth*.42)],.7,0x7a9690,.44,width);
          }
        }
      } else {
        for (const side of [-1, 1]) {
          edge(g, trace(m, lo, hi, phase, width*.32*side), 2.8, 0x152b31, .9, width);
          edge(g, trace(m, lo, hi, phase, width*.32*side), 1.1, 0x99d9c2, .9, width);
        }
        // Subtle narrow joints retain the quieter restored option; there is
        // no bulky outer row of brick trim.
        for (let s=firstRepeat(lo,27,9,phase);s<hi;s+=27) {
          stroke(g,[at(m,s,-width*.27),at(m,s+.6,width*.27)],.7,0x15292e,.38,width);
        }
        for (let s = firstRepeat(lo, 65, 22, phase); s < hi; s += 65) glyph(g, m, s, width);
      }
    }
  }
  // run is projected road geometry; startM identifies its first point along
  // the ORIGINAL source way. Partial repairs therefore keep the same phase.
  function decorate(scene, g, run, widthPx, family, restored, options = {}) {
    if (!g?.decorPath || !run || run.length < 2 || !(widthPx > 0)) return;
    if (family !== 'md' && family !== 'lg') return;
    // Preserve original vertex tangents across repair intervals. A cropped
    // source run can otherwise shift its miters near a bend when repaired.
    const sourceRun = options.sourceRun || run;
    const m = metrics(sourceRun);
    if (!m.length) return;
    const pxPerM = options.pxPerM || ((global.SpriteLayout?.CELL_PX || 32) / (scene?.cellM || 7));
    const phase = options.sourceRun ? 0 : (options.startM || 0) * pxPerM;
    let spans = visibleSpans(m, scene, widthPx);
    if (options.sourceRun) {
      const lo=(options.startM || 0)*pxPerM;
      const hi=Number.isFinite(options.endM) ? options.endM*pxPerM : m.length;
      spans=spans.map(([a,b])=>[Math.max(a,lo),Math.min(b,hi)]).filter(([a,b])=>b>a);
    }
    if (family === 'md') medium(g, m, spans, widthPx, !!restored, phase);
    else large(g, m, spans, widthPx, !!restored, phase);
  }
  global.RoadSurfaces = { TILE_PX, MEAN_COLOR, familyFor, setSource, tile, decorate };
})(window);
