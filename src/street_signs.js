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
  // straight up like every low-poly solid. Colours are flat cel steps by face
  // orientation (`faceColour`): the light sits west and a little south, so a
  // post always shows one lit and one shaded face when two are visible. The
  // sprite fallback (textures.js makeRoadSignTextures, RENDER_SPEC.roadsign)
  // bakes the post alone from these same rows.
  //   post:  side of the square section, height from the ground.
  //   board: length from the post axis, height, thickness; `tip` is the
  //          pointed length from the shoulders to the tip. Rows hang from
  //          `topInset` under the post top at `height + gap`, compressed so
  //          the lowest board stays `minBottom` above the ground.
  const ART = Object.freeze({
    post: Object.freeze({ side: 5, height: 30 }),
    board: Object.freeze({ length: 24, height: 7, thickness: 2, tip: 6, gap: 1, topInset: 2, minBottom: 3 }),
    colours: Object.freeze({
      post: Object.freeze({ top: 0xa88a5c, lit: 0x8a6d45, mid: 0x7a5f3c, shade: 0x5c4630 }),
      board: Object.freeze({ top: 0xe0cc98, lit: 0xd2b87e, mid: 0xc9b07a, shade: 0x9a7f52 }),
      ink: 0x14110c,
    }),
    // The plan light, unit length: west with a touch of south.
    light: Object.freeze({ x: -0.9578, y: 0.2873 }),
  });
  function vector(direction) {
    const i = COMPASS.indexOf(direction);
    return i < 0 ? null : { x: Math.cos(i * Math.PI / 4), y: Math.sin(i * Math.PI / 4) };
  }
  // ROWS. Like a real fingerpost, boards for different headings share a row
  // when they cannot meet — their headings at least a right angle apart, so
  // each hangs off its own face of the post — and only boards that would
  // cross (two roads leaving to the same quarter) stack. Eight compass
  // headings fill two rows. Greedy in the listed order, which candidates()
  // already sorts, so the same junction always wears the same sign.
  function rows(directions) {
    const out = [], members = [];
    for (const d of directions || []) {
      const v = vector(d.direction);
      if (!v) continue;
      let row = members.findIndex(list => list.every(u => u.x * v.x + u.y * v.y <= 1e-9));
      if (row < 0) { row = members.length; members.push([]); }
      members[row].push(v);
      out.push({ vector: v, row });
    }
    return out;
  }
  // The top of row `row` of `count` rows, in mesh px above the ground.
  function rowTop(row, count) {
    const { post, board } = ART, start = post.height - board.topInset;
    const pitch = count > 1 ? Math.min(board.height + board.gap, (start - board.height - board.minBottom) / (count - 1)) : 0;
    return start - row * pitch;
  }
  // Cel step for a face by its outward normal: the top, or the plan light.
  function faceColour(palette, normal) {
    if (normal.z > 0.5) return palette.top;
    const len = Math.hypot(normal.x, normal.y) || 1;
    const d = (normal.x * ART.light.x + normal.y * ART.light.y) / len;
    return d > 0.3 ? palette.lit : d < -0.3 ? palette.shade : palette.mid;
  }
  // One convex solid from its polygons, each wound outward (flipped when its
  // normal points at the solid's centre) and fanned into the triangles the
  // mesh renderer draws. Every vertex carries the caller's texel (`uv`), the
  // wall sheet's white one in the game, so flat colours tint it.
  function solid(polygons, palette, uv) {
    const all = polygons.flat();
    const centre = { x: 0, y: 0, z: 0 };
    for (const p of all) { centre.x += p.x / all.length; centre.y += p.y / all.length; centre.z += p.z / all.length; }
    const faces = [];
    for (let ring of polygons) {
      const [a, b, c] = ring;
      let n = { x: (b.y-a.y)*(c.z-a.z)-(b.z-a.z)*(c.y-a.y), y: (b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z), z: (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x) };
      const mid = ring.reduce((m, p) => ({ x: m.x + p.x / ring.length, y: m.y + p.y / ring.length, z: m.z + p.z / ring.length }), { x: 0, y: 0, z: 0 });
      if (n.x * (mid.x - centre.x) + n.y * (mid.y - centre.y) + n.z * (mid.z - centre.z) < 0) {
        ring = ring.slice().reverse(); n = { x: -n.x, y: -n.y, z: -n.z };
      }
      const color = faceColour(palette, n);
      for (let i = 1; i < ring.length - 1; i++) faces.push({ points: [ring[0], ring[i], ring[i + 1]], color, flatColor: color });
    }
    return faces;
  }
  // The sign's solids about its foot (x, y): the post first, then a board per
  // listed heading. Each is { points (plan footprint), faces, colors }, ready
  // for WallPerspective.prism with the faces as its materialFaces.
  function mesh(sign, { x = 0, y = 0, uv = null } = {}) {
    const { post, board, colours } = ART, h = post.side / 2;
    const v = (px, py, z) => ({ x: px, y: py, z, ...(uv || {}) });
    const square = z => [v(x - h, y - h, z), v(x + h, y - h, z), v(x + h, y + h, z), v(x - h, y + h, z)];
    const base = square(0), cap = square(post.height);
    const sides = base.map((a, i) => [a, base[(i + 1) % 4], cap[(i + 1) % 4], cap[i]]);
    const out = [{ points: base.map(({ x, y }) => ({ x, y })), colors: { face: colours.post.mid, top: colours.post.top },
      faces: solid([base, cap, ...sides], colours.post, uv) }];
    const listed = rows(sign.directions), count = listed.reduce((m, b) => Math.max(m, b.row + 1), 0);
    for (const { vector: dir, row } of listed) {
      // The root sits on the post's own face (its corner for a diagonal), so
      // no board reaches inside the post and draw order never shows a root.
      const root = h / Math.max(Math.abs(dir.x), Math.abs(dir.y));
      const shoulder = root + board.length - board.tip, tip = root + board.length;
      const zt = rowTop(row, count), zb = zt - board.height, zm = (zt + zb) / 2;
      const n = { x: -dir.y, y: dir.x }, t = board.thickness / 2;
      const at = (u, s, z) => v(x + dir.x * u + n.x * s, y + dir.y * u + n.y * s, z);
      const side = s => ({ a: at(root, s, zb), b: at(shoulder, s, zb), tip: at(tip, s, zm), c: at(shoulder, s, zt), d: at(root, s, zt) });
      const L = side(t), R = side(-t);
      const polygons = [[L.a, L.b, L.tip, L.c, L.d], [R.a, R.b, R.tip, R.c, R.d],
        [L.a, L.d, R.d, R.a], [L.a, L.b, R.b, R.a], [L.d, L.c, R.c, R.d],
        [L.b, L.tip, R.tip, R.b], [L.c, L.tip, R.tip, R.c]];
      out.push({ points: [L.a, L.tip, R.tip, R.a].map(({ x, y }) => ({ x, y })), colors: { face: colours.board.mid, top: colours.board.top },
        faces: solid(polygons, colours.board, uv) });
    }
    return out;
  }
  return {direction,candidates,cornerSeats,ART,vector,rows,rowTop,faceColour,mesh};
})();
if (typeof window !== 'undefined') window.StreetSigns = StreetSigns;
