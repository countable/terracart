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
  // ONE SIGN PER JUNCTION. Every end of every road is a candidate, so a road
  // whose far end meets another road earns a sign there too, and the junction
  // point itself is the dedupe key (not the road), so two roads ending at the
  // same corner share one sign that lists them both. A road end that meets no
  // OTHER street (its own next section does not count) — a dead end, or the
  // clip at a tile edge — gets no sign.
  function candidates(index, cellM = 7) {
    const scale = index.mvtToM || 1;
    const rows = (index.dressingLines || index.lines || []).filter(r => r.variant && r.line?.length > 1);
    const result = [], seen = new Set();
    for (const rec of rows) for (const end of [0, rec.line.length - 1]) {
      const p = rec.line[end];
      const key = `${rec.tags?.layer || 0}|${rec.tags?.brunnel || ''}|${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
      if (seen.has(key)) continue;
      const directions = [], listed = new Set();
      let meeting = null;   // the nearest OTHER road at this end
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
        // Another STREET: a duplicate mapped piece or the next section of the
        // same street shares its key and makes no junction.
        if (other.key !== rec.key && (!meeting || d2 < meeting.d2)) meeting = { rec: other, d2, tangent };
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
      if (!meeting || !directions.length) continue;
      seen.add(key);
      const adjacent = rec.line[end ? end - 1 : 1];
      const dx=adjacent.x-p.x,dy=adjacent.y-p.y,len=Math.hypot(dx,dy);
      if (!len) continue;
      // `inside`: the seat side (about the direction into this road) that the
      // meeting road's body runs to — the angle between the two roads.
      // `lineSign` maps a seat side to this road's own left (+1) or right.
      const nx=-dy/len, ny=dx/len, { a, b } = meeting.tangent;
      const toward = nx*(a.x+b.x-2*p.x) + ny*(a.y+b.y-2*p.y);
      result.push({rec,x:p.x*scale,y:p.y*scale,dx:dx/len,dy:dy/len,nx,ny,
        inside: toward < 0 ? -1 : 1, lineSign: end ? -1 : 1, meetsHalfW: meeting.rec.halfW || 0,
        directions:directions.sort((a,b)=>a.direction.localeCompare(b.direction)||a.title.localeCompare(b.title))});
    }
    return result;
  }
  // THE CORNER WHERE THE ROADS MEET. The post stands in the angle between the
  // sign's road and the road it meets: off the meeting road by its half width
  // along this road, off this road by its half width across it, each plus a
  // step into the verge — the verge cell diagonally off the junction point,
  // never on either band and never out along one road alone. The inside
  // corner comes first (the side the meeting road runs to), then the outside
  // one, then each a cell further out for when the nearer seats are taken.
  // `lineSide` keeps every seat to one side of the road in its own terms (+1
  // its left), for a variant whose verge row must stay continuous. The caller
  // checks and claims the cell containing the post's feet.
  function cornerSeats(sign, cellM = 7, { lineSide = null } = {}) {
    const out = [];
    for (let k = 0; k < 3; k++) for (const side of [sign.inside, -sign.inside]) {
      if (lineSide != null && side * sign.lineSign !== lineSide) continue;
      const along = sign.meetsHalfW + cellM * (.4 + k), across = sign.rec.halfW + cellM * (.4 + k);
      const x = sign.x + sign.dx * along + sign.nx * side * across;
      const y = sign.y + sign.dy * along + sign.ny * side * across;
      out.push({ x, y, side, ix: Math.floor(x / cellM), iy: Math.floor(y / cellM) });
    }
    return out;
  }
  // FINGERPOST. A sign is a set of small closed solids for the retained mesh
  // path the crates take (render.js Render.drawRoadSignMeshes →
  // WallPerspective.prism): a square post standing straight on the ground with
  // no footing, and one thin vertical board per listed heading hung on it, a
  // plank with a pointed end — an elongated pentagon, never an arrowhead —
  // that points along its road in WORLD space, so a compass turn shows its
  // other faces instead of turning a flat picture. Dimensions are mesh px:
  // screen px at 1× on the north-up map (CELL_PX a cell); heights project
  // straight up like every low-poly solid. The wood is the cel wall sheet's
  // own wood (WallMaterials woodSide / woodTop, through the `texel` the
  // renderer hands mesh()), tinted by face: a cel step by orientation
  // (`faceTint`; the light sits west and a little south, so a post always
  // shows one lit and one shaded face when two are visible) and, on the post,
  // a step darker for each lower third (`bands`). The sprite fallback
  // (textures.js makeRoadSignTextures, RENDER_SPEC.roadsign) bakes the post
  // alone from these same rows, in the sheet's flat wood colours (`wood`).
  //   post:  side of the square section, height from the ground.
  //   board: length from the post axis, height, thickness; `tip` is the
  //          pointed length from the shoulders to the tip. Boards hang one
  //          under another from `topInset` below the post top, a board
  //          height and `gap` apart, compressed so the lowest stays
  //          `minBottom` above the ground; which heading takes the top is the
  //          sign's own (`rows`, by its id).
  //   grain: the slice of the wood slot each surface samples (s across the
  //          slot, 0..1): the post's faces a dark edge into the mid band, the
  //          boards' faces the light centre band along their length.
  const ART = Object.freeze({
    post: Object.freeze({ side: 4, height: 24 }),
    board: Object.freeze({ length: 19, height: 5.6, thickness: 1.6, tip: 4.8, gap: .8, topInset: 1.6, minBottom: 2.4 }),
    grain: Object.freeze({ post: [.05, .25], board: [.22, .42] }),
    tint: Object.freeze({ top: 1, lit: 1, mid: .86, shade: .7 }),
    bands: Object.freeze([1, .86, .72]),
    wood: Object.freeze({ side: 0x9e7e50, top: 0xb59969 }),
    ink: 0x14110c,
    // The plan light, unit length: west with a touch of south.
    light: Object.freeze({ x: -0.9578, y: 0.2873 }),
  });
  function vector(direction) {
    const i = COMPASS.indexOf(direction);
    return i < 0 ? null : { x: Math.cos(i * Math.PI / 4), y: Math.sin(i * Math.PI / 4) };
  }
  // ROWS. One board under another: the top one, then each a board height
  // lower (rowTop). Which heading takes the top is drawn from the sign's id,
  // so every junction wears its own arrangement and the same one every time.
  function rows(directions, id = '') {
    const listed = (directions || []).map(d => vector(d.direction)).filter(Boolean);
    let seed = 2166136261;
    for (const c of String(id)) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
    const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    const order = listed.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return order.map((at, row) => ({ vector: listed[at], row }));
  }
  // The top of row `row` of `count` rows, in mesh px above the ground.
  function rowTop(row, count) {
    const { post, board } = ART, start = post.height - board.topInset;
    const pitch = count > 1 ? Math.min(board.height + board.gap, (start - board.height - board.minBottom) / (count - 1)) : 0;
    return start - row * pitch;
  }
  // Cel step for a face by its outward normal: the top, or the plan light.
  function faceTint(normal) {
    if (normal.z > 0.5) return ART.tint.top;
    const len = Math.hypot(normal.x, normal.y) || 1;
    const d = (normal.x * ART.light.x + normal.y * ART.light.y) / len;
    return d > 0.3 ? ART.tint.lit : d < -0.3 ? ART.tint.shade : ART.tint.mid;
  }
  const grey = f => { const c = Math.round(255 * Math.min(1, f)); return (c << 16) | (c << 8) | c; };
  const shade = (color, f) => [16, 8, 0].reduce((out, sh) => out | Math.min(255, Math.round(((color >>> sh) & 255) * f)) << sh, 0);
  // One convex solid from its polygons, each wound outward (flipped when its
  // normal points at the solid's centre) and fanned into the triangles the
  // mesh renderer draws. A polygon is { ring, material, [tint] }: its colour
  // is its tint (the orientation step unless given) as a grey the renderer
  // multiplies the wood texel by; `flatColor` is the same over the slot's
  // flat colour, for the untextured path.
  function solid(polygons) {
    const all = polygons.flatMap(p => p.ring);
    const centre = { x: 0, y: 0, z: 0 };
    for (const p of all) { centre.x += p.x / all.length; centre.y += p.y / all.length; centre.z += p.z / all.length; }
    const faces = [];
    for (const { ring: given, material, tint } of polygons) {
      let ring = given;
      const [a, b, c] = ring;
      let n = { x: (b.y-a.y)*(c.z-a.z)-(b.z-a.z)*(c.y-a.y), y: (b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z), z: (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x) };
      const mid = ring.reduce((m, p) => ({ x: m.x + p.x / ring.length, y: m.y + p.y / ring.length, z: m.z + p.z / ring.length }), { x: 0, y: 0, z: 0 });
      if (n.x * (mid.x - centre.x) + n.y * (mid.y - centre.y) + n.z * (mid.z - centre.z) < 0) {
        ring = ring.slice().reverse(); n = { x: -n.x, y: -n.y, z: -n.z };
      }
      const f = (tint ?? 1) * faceTint(n), color = grey(f), flatColor = shade(ART.wood[material], f);
      for (let i = 1; i < ring.length - 1; i++) faces.push({ points: [ring[0], ring[i], ring[i + 1]], color, flatColor });
    }
    return faces;
  }
  // The sign's solids about its foot (x, y): the post first, then a board per
  // listed heading. Each is { points (plan footprint), faces, colors }, ready
  // for WallPerspective.prism with the faces as its materialFaces. `texel`
  // (material, s, t) → { u, v } places a point of a wood slot (s across, t
  // down, both 0..1) on the sheet; without it the vertices carry no texel.
  function mesh(sign, { x = 0, y = 0, texel = null } = {}) {
    const { post, board, grain, bands, wood } = ART, h = post.side / 2;
    const v = (px, py, z, material, s, t) => ({ x: px, y: py, z, ...(texel ? texel(material, s, t) : {}) });
    const [g0, g1] = grain.post;
    const across = s => g0 + (g1 - g0) * s;
    const corner = i => [[-h, -h], [h, -h], [h, h], [-h, h]][i % 4];
    const polygons = [];
    // The post: its cap, and each side in `bands` stacked quads, the grain
    // running up the pole and the lower quads tinted darker.
    const cap = z => [0, 1, 2, 3].map(i => { const [cx, cy] = corner(i); return v(x + cx, y + cy, z, 'top', (cx + h) / post.side, (cy + h) / post.side); });
    polygons.push({ ring: cap(0), material: 'top', tint: bands.at(-1) }, { ring: cap(post.height), material: 'top' });
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corner(i), [bx, by] = corner(i + 1);
      for (let b = 0; b < bands.length; b++) {
        const z0 = post.height * (1 - (b + 1) / bands.length), z1 = post.height * (1 - b / bands.length);
        const t0 = 1 - z0 / post.height, t1 = 1 - z1 / post.height;
        polygons.push({ material: 'side', tint: bands[b], ring: [
          v(x + ax, y + ay, z0, 'side', across(0), t0), v(x + bx, y + by, z0, 'side', across(1), t0),
          v(x + bx, y + by, z1, 'side', across(1), t1), v(x + ax, y + ay, z1, 'side', across(0), t1)] });
      }
    }
    const out = [{ points: [0, 1, 2, 3].map(i => { const [cx, cy] = corner(i); return { x: x + cx, y: y + cy }; }),
      colors: { face: wood.side, top: wood.top }, faces: solid(polygons) }];
    const listed = rows(sign.directions, sign.id), count = listed.length;
    const [b0, b1] = grain.board;
    for (const { vector: dir, row } of listed) {
      // The root sits on the post's own face (its corner for a diagonal), so
      // no board reaches inside the post and draw order never shows a root.
      const root = h / Math.max(Math.abs(dir.x), Math.abs(dir.y));
      const shoulder = root + board.length - board.tip, tip = root + board.length;
      const zt = rowTop(row, count), zb = zt - board.height, zm = (zt + zb) / 2;
      const n = { x: -dir.y, y: dir.x }, t = board.thickness / 2;
      // Grain runs along the plank: its length down the slot, its height
      // across the light centre band. The thin edges take the flat top wood.
      const at = (u, s, z) => v(x + dir.x * u + n.x * s, y + dir.y * u + n.y * s, z, 'side', b0 + (b1 - b0) * (zt - z) / board.height, (u - root) / board.length);
      const edge = (u, s, z) => v(x + dir.x * u + n.x * s, y + dir.y * u + n.y * s, z, 'top', (u - root) / board.length, (s + t) / board.thickness);
      const side = s => ({ a: at(root, s, zb), b: at(shoulder, s, zb), tip: at(tip, s, zm), c: at(shoulder, s, zt), d: at(root, s, zt) });
      const rim = s => ({ a: edge(root, s, zb), b: edge(shoulder, s, zb), tip: edge(tip, s, zm), c: edge(shoulder, s, zt), d: edge(root, s, zt) });
      const L = side(t), R = side(-t), l = rim(t), r = rim(-t);
      const faces = solid([
        { ring: [L.a, L.b, L.tip, L.c, L.d], material: 'side' }, { ring: [R.a, R.b, R.tip, R.c, R.d], material: 'side' },
        { ring: [l.a, l.d, r.d, r.a], material: 'top' }, { ring: [l.a, l.b, r.b, r.a], material: 'top' },
        { ring: [l.d, l.c, r.c, r.d], material: 'top' }, { ring: [l.b, l.tip, r.tip, r.b], material: 'top' },
        { ring: [l.c, l.tip, r.tip, r.c], material: 'top' }]);
      out.push({ points: [L.a, L.tip, R.tip, R.a].map(({ x, y }) => ({ x, y })), colors: { face: wood.side, top: wood.top }, faces });
    }
    return out;
  }
  return {direction,candidates,cornerSeats,ART,vector,rows,rowTop,faceTint,mesh};
})();
if (typeof window !== 'undefined') window.StreetSigns = StreetSigns;
