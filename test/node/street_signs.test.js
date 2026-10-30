(function () {
test('street signs: one sign per junction, at either end of a road, and none at a lone road end', () => {
  const index = {mvtToM:1, lines:[
    {key:'a',variant:'hedgerow',halfW:3.5,line:[{x:100,y:100},{x:300,y:100}]},
    {key:'b',variant:'thorny',halfW:3.5,line:[{x:100,y:100},{x:100,y:300}]},
    {key:'c',variant:'pilgrim',halfW:3.5,line:[{x:300,y:300},{x:300,y:100}]},
    {key:'far',variant:'pilgrim',halfW:3.5,line:[{x:900,y:900},{x:900,y:1200}]},
  ]};
  const signs = StreetSigns.candidates(index);
  assert.eq(signs.map(s => `${s.x},${s.y}`).sort().join('|'), '100,100|300,100', 'the two corners where roads meet, each once');
  const corner = signs.find(s => s.x === 100 && s.y === 100), far = signs.find(s => s.x === 300);
  assert.eq(corner.directions.map(d => d.direction + ':' + d.variant).join(), 'East:hedgerow,South:thorny', 'a corner lists every road that meets there');
  assert.eq(far.rec.key, 'a', 'the far end of a road is a junction too');
  assert.eq(far.directions.map(d => d.direction).join(), 'South,West', 'c arrives from the south; a leads back west');
  assert.falsy(signs.some(s => s.rec.key === 'far' || s.directions.some(d => d.title === undefined)), 'a road meeting nothing has no sign');
  const reversed = {...index,lines:index.lines.map(r=>({...r,line:r.line.slice().reverse()}))};
  const again = StreetSigns.candidates(reversed);
  assert.eq(again.map(s => `${s.x},${s.y}`).sort().join('|'), '100,100|300,100', 'reversed geometry: the same junctions');
  assert.eq(JSON.stringify(again.find(s => s.x === 100).directions), JSON.stringify(corner.directions), 'and the same listing');
  // The corner: into road a (east), the meeting road b runs south, so the
  // inside corner is the south-east angle between them.
  assert.eq(corner.dx + ',' + corner.dy + ',' + corner.inside + ',' + corner.lineSign, '1,0,1,1');
  assert.eq(far.dx + ',' + far.dy + ',' + far.inside + ',' + far.lineSign, '-1,0,-1,-1', 'from a\'s far end the road runs back west, whose left normal is north; c lies south; that end is a\'s last point');
  const sections = {mvtToM:1, lines:[
    {key:'s',variant:'hedgerow',halfW:3.5,line:[{x:0,y:100},{x:200,y:100}]},
    {key:'s',variant:'hedgerow',halfW:3.5,line:[{x:200,y:100},{x:400,y:100}]},
    {key:'s',variant:'hedgerow',halfW:3.5,line:[{x:0,y:100},{x:200,y:100}]},
  ]};
  assert.eq(StreetSigns.candidates(sections).length, 0, 'the next section of the same street, or a duplicate piece, is no junction');
  assert.eq(far.meetsHalfW, 3.5);
});
test('street signs: the post stands in the corner between the two roads, stepping out when seats are taken', () => {
  const near = (a, b, msg) => assert.truthy(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);
  // Junction at (100, 100): this road runs east from it, 7 m wide; the
  // meeting road is 14 m wide and runs south (inside = +1, the left normal
  // of east being screen-south).
  const sign = {rec:{halfW:3.5},x:100,y:100,dx:1,dy:0,nx:0,ny:1,inside:1,lineSign:1,meetsHalfW:7};
  const seats = StreetSigns.cornerSeats(sign, 7);
  assert.eq(seats.length, 6, 'two corners, three steps out');
  near(seats[0].x, 100 + 7 + 2.8, 'off the meeting road\'s band by a step into the verge');
  near(seats[0].y, 100 + 3.5 + 2.8, 'off this road\'s band by the same step: the verge cell at the corner');
  near(seats[1].y, 100 - 3.5 - 2.8, 'then the outside corner');
  near(seats[2].x, seats[0].x + 7, 'then a cell further out'); near(seats[2].y, seats[0].y + 7);
  for (const seat of seats) {
    assert.truthy(seat.x > 100 + 7, 'never on the meeting road');
    assert.truthy(Math.abs(seat.y - 100) > 3.5, 'never on this road');
    assert.eq(seat.ix, Math.floor(seat.x / 7)); assert.eq(seat.iy, Math.floor(seat.y / 7));
  }
  assert.eq(StreetSigns.cornerSeats(sign, 7, { lineSide: -1 }).map(s => s.side).join(), '-1,-1,-1', 'a kept verge leaves only the other side');
  assert.eq(StreetSigns.cornerSeats({ ...sign, lineSign: -1 }, 7, { lineSide: -1 }).map(s => s.side).join(), '1,1,1', 'in the road\'s own terms, whichever end the junction is');
});
test('street signs: boards stack one under another, the top one the sign\'s own pick', () => {
  const { post, board } = StreetSigns.ART;
  const dirs = (...names) => names.map(direction => ({ direction }));
  const rows = (id, ...names) => StreetSigns.rows(dirs(...names), id);
  const three = rows('sign_a', 'East', 'North', 'West');
  assert.eq(three.map(b => b.row).sort().join(), '0,1,2', 'one row per board, none shared');
  assert.eq(JSON.stringify(rows('sign_a', 'East', 'North', 'West')), JSON.stringify(three), 'the same sign stacks the same way every time');
  const tops = new Set();
  for (let i = 0; i < 40; i++) tops.add(rows('sign_' + i, 'East', 'North', 'West').find(b => b.row === 0).vector.x);
  assert.gt(tops.size, 1, 'another sign may hang another heading at the top');
  assert.eq(rows('x', 'East', 'Nowhere').length, 1, 'only compass headings have a board');
  assert.eq(StreetSigns.rowTop(0, 1), post.height - board.topInset, 'the first row hangs under the post top');
  assert.lt(Math.abs(StreetSigns.rowTop(1, 2) - (post.height - board.topInset - board.height - board.gap)), 1e-9, 'the next a board height and a gap below it');
  for (const n of [1, 2, 3, 4, 8]) {
    assert.eq(StreetSigns.rowTop(0, n), post.height - board.topInset, `${n} rows: the first hangs at the top`);
    assert.gte(StreetSigns.rowTop(n - 1, n) - board.height, board.minBottom - 1e-9, `${n} rows: the last stays above the ground`);
    for (let i = 1; i < n; i++) assert.lt(StreetSigns.rowTop(i, n), StreetSigns.rowTop(i - 1, n), 'rows descend');
  }
});
test('street signs: the mesh is a square post with no footing and pentagonal boards', () => {
  const { post, board } = StreetSigns.ART;
  const near = (a, b, msg) => assert.truthy(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);
  assert.lte(post.height, 26, 'four fifths of the first mesh: well under a cell tall');
  const sign = { id: 'sign_1', directions: [{ direction: 'East', title: 'A' }, { direction: 'North', title: 'B' }, { direction: 'Northeast', title: 'C' }, { direction: 'Nowhere', title: 'D' }] };
  const sampled = [];
  const texel = (material, s, t) => { sampled.push({ material, s, t }); return { u: s, v: t }; };
  const parts = StreetSigns.mesh(sign, { x: 0, y: 0, texel });
  assert.eq(parts.length, 4, 'the post and one board per compass heading');
  const vertices = part => part.faces.flatMap(f => f.points);
  for (const part of parts) {
    assert.truthy(part.points.length >= 4 && part.faces.length >= 12, 'a plan footprint and a closed set of triangles');
    assert.truthy(vertices(part).every(p => Number.isFinite(p.u) && Number.isFinite(p.v)), 'every vertex carries a texel');
    assert.truthy(part.faces.every(f => Number.isInteger(f.color) && Number.isInteger(f.flatColor)), 'a grey tint over the wood, and its flat stand-in');
  }
  assert.truthy(sampled.every(q => ['side', 'top'].includes(q.material) && q.s >= -1e-9 && q.s <= 1 + 1e-9 && q.t >= -1e-9 && q.t <= 1 + 1e-9), 'the wood slots, sampled inside their tiles');
  const [postPart, ...boards] = parts;
  const pv = vertices(postPart);
  near(Math.min(...pv.map(p => p.z)), 0, 'the post stands on the ground');
  near(Math.max(...pv.map(p => p.z)), post.height, 'to its full height');
  assert.truthy(pv.every(p => Math.abs(p.x) <= post.side / 2 + 1e-9 && Math.abs(p.y) <= post.side / 2 + 1e-9), 'a square section all the way down: no footing');
  assert.eq(postPart.faces.length, 4 + 4 * StreetSigns.ART.bands.length * 2, 'two caps and each side in its bands');
  const southBands = postPart.faces.filter(f => f.points.every(p => Math.abs(p.y - post.side / 2) < 1e-9))
    .map(f => ({ z: Math.min(...f.points.map(p => p.z)), color: f.color })).sort((a, b) => b.z - a.z);
  assert.truthy(southBands.every((f, i) => i === 0 || f.color <= southBands[i - 1].color), 'the pole darkens toward the ground');
  assert.gt(southBands[0].color, southBands.at(-1).color, 'visibly');
  const rowsOf = StreetSigns.rows(sign.directions, sign.id);
  const east = boards[rowsOf.findIndex(b => Math.abs(b.vector.x - 1) < 1e-9)];
  const ev = vertices(east), xs = ev.map(p => p.x), zs = ev.map(p => p.z);
  near(Math.min(...xs), post.side / 2, 'the board roots on the post face');
  near(Math.max(...xs), post.side / 2 + board.length, 'and runs its length east');
  const eastRow = rowsOf.find(b => Math.abs(b.vector.x - 1) < 1e-9).row;
  near(Math.max(...zs), StreetSigns.rowTop(eastRow, 3), 'at its own row');
  near(Math.max(...zs) - Math.min(...zs), board.height, 'one board high');
  assert.truthy(ev.every(p => Math.abs(p.y) <= board.thickness / 2 + 1e-9), 'a thin slab');
  const tips = ev.filter(p => Math.abs(p.x - Math.max(...xs)) < 1e-9);
  const tipKeys = new Set(tips.map(p => `${p.y},${p.z}`));
  assert.eq(tipKeys.size, 2, 'the end comes to a point: one tip vertex per side');
  tips.forEach(p => near(p.z, StreetSigns.rowTop(eastRow, 3) - board.height / 2, 'on the centre line'));
  const shoulders = ev.filter(p => Math.abs(p.x - (post.side / 2 + board.length - board.tip)) < 1e-9);
  assert.eq(new Set(shoulders.map(p => p.z)).size, 2, 'the shoulders span the full height: an elongated pentagon, no arrowhead wider than the plank');
  const tops = boards.map(b => Math.max(...vertices(b).map(p => p.z))).sort((a, b) => b - a);
  near(tops[0], StreetSigns.rowTop(0, 3), 'one board at the top');
  near(tops[0] - tops[1], board.height + board.gap, 'the next a board height lower'); near(tops[1] - tops[2], board.height + board.gap, 'and the next');
  const d = StreetSigns.vector('Northeast'), northeast = boards[rowsOf.findIndex(b => b.vector.x > 0 && b.vector.y < 0)];
  near(Math.min(...vertices(northeast).map(p => p.x * d.x + p.y * d.y)), post.side / 2 * Math.SQRT2, 'a diagonal board roots on the post corner');
});
test('street signs: faces wind outward and cull with the heading like every retained solid', () => {
  const scene = () => ({ _headingUp: true, depth: 0, mapRot: 0,
    buildingWallContainer: { add() {} },
    add: { graphics() { return { visible: true, triangles: [], clear() { this.triangles.length = 0; return this; },
      fillStyle(c, a = 1) { this.color = c; this.alpha = a; return this; },
      fillTriangle(...points) { this.triangles.push({ color: this.color, points }); return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; } }; } } });
  const draw = (angle, directions) => {
    const s = scene(), group = WallPerspective.begin(s, 'signs');
    group.renderDepth = 0;
    const parts = StreetSigns.mesh({ id: 'cull', directions }, { x: 100, y: 100, texel: (m, u, v) => WallMaterials.texel(m === 'top' ? 'woodTop' : 'woodSide', u, v) });
    for (const part of parts) WallPerspective.prism(s, 'signs', part.points, 0, StreetSigns.ART.post.height, part.colors, null, true,
      { materialFaces: part.faces, topOutline: PropLowPoly.outline(part.faces, StreetSigns.ART.ink) });
    WallPerspective.finish(s, 'signs');
    s.mapRot = angle; WallPerspective.update(s);
    return { parts, group, triangles: group.gfx.triangles };
  };
  const { bands, tint } = StreetSigns.ART, grey = f => { const c = Math.round(255 * f); return (c << 16) | (c << 8) | c; };
  let { parts, triangles } = draw(0, [{ direction: 'North' }]);
  const [postPart, north] = parts;
  const visible = part => part.faces.filter(f => f.visible);
  assert.eq(visible(postPart).length, 2 + 2 * bands.length, 'north-up the post shows its top and its banded south face');
  assert.eq(visible(postPart).map(f => f.color).sort((a, b) => a - b).join(),
    [grey(tint.top), grey(tint.top), ...bands.flatMap(b => [grey(b * tint.mid), grey(b * tint.mid)])].sort((a, b) => a - b).join(), 'the top at full light, the south face mid and darker by band');
  const sides = north.faces.filter(f => f.points.every(p => Math.abs(p.x - f.points[0].x) < 1e-9));
  assert.eq(sides.length, 6, 'the two pentagons, three triangles each');
  assert.truthy(sides.every(f => !f.visible), 'a board pointing away is seen edge-on');
  assert.truthy(north.faces.some(f => f.visible), 'its top and root still show');
  assert.truthy(triangles.length > 0 && triangles.every(t => t.points.every(Number.isFinite)), 'drawn');
  ({ parts } = draw(Math.PI / 2, [{ direction: 'North' }]));
  const turned = parts[1].faces.filter(f => f.points.every(p => Math.abs(p.x - f.points[0].x) < 1e-9));
  assert.eq(turned.filter(f => f.visible).length, 3, 'turned a quarter, one pentagon faces the camera');
  assert.truthy(turned.filter(f => f.visible).every(f => f.points[0].x > 100), 'the east one');
  assert.eq(visible(parts[0]).length, 2 + 2 * bands.length, 'and the post shows its east face');
  const outline = PropLowPoly.outline(parts[0].faces, StreetSigns.ART.ink);
  assert.eq(outline.color, StreetSigns.ART.ink);
  assert.truthy(outline.edges.every(e => e.length === 2), 'a closed solid: every edge joins two triangles');
});
test('street signs: the fallback post bake is a plain pole to the frame bottom', () => {
  const start = TEXTURES_SRC.indexOf('function makeRoadSignTextures(');
  const end = TEXTURES_SRC.indexOf('// Procedural "pot of gold"', start);
  const bakeStart = TEXTURES_SRC.indexOf('function bakeCanvas(');
  const bakeEnd = TEXTURES_SRC.indexOf('\n}\n', bakeStart) + 3;
  const bake = new Function('StreetSigns', TEXTURES_SRC.slice(bakeStart, bakeEnd) + TEXTURES_SRC.slice(start, end)
    + '; return makeRoadSignTextures;')(StreetSigns);
  const images = new Map();
  const scene = { textures: {
    exists: key => images.has(key),
    createCanvas(key, w, h) {
      const pixels = new Map(); images.set(key, { w, h, pixels });
      const ctx = { fillStyle: '', fillRect(x, y, rw, rh) {
        for (let cy = y; cy < y + rh; cy++) for (let cx = x; cx < x + rw; cx++) {
          assert.truthy(cx >= 0 && cy >= 0 && cx < w && cy < h, `${key}: paint inside the frame`);
          pixels.set(`${cx},${cy}`, this.fillStyle);
        }
      } };
      return { getContext: () => ctx, refresh() {} };
    },
  } };
  bake(scene); bake(scene);
  const { post } = StreetSigns.ART;
  assert.eq([...images.keys()].join(), 'roadsign_post', 'only the post is baked; boards are mesh');
  const p = images.get('roadsign_post');
  assert.eq(p.w + 'x' + p.h, (post.side + 2) + 'x' + post.height);
  const ink = '#' + StreetSigns.ART.ink.toString(16).padStart(6, '0');
  const pole = row => [...Array(p.w).keys()].filter(x => p.pixels.get(`${x},${row}`) !== ink).join();
  assert.eq(pole(p.h - 1), pole(Math.floor(p.h / 2)), 'no footing: the bottom row is as wide as the pole');
  assert.eq(pole(p.h - 1).split(',').length, post.side, 'the pole is the square section');
  const lum = hex => parseInt(hex.slice(1, 3), 16);
  assert.gt(lum(p.pixels.get(`2,1`)), lum(p.pixels.get(`2,${p.h - 1}`)), 'darker lower down');
});
test('street lamps: approved silhouettes retain restoration and suppression rules', () => {
  assert.eq(StreetLights.forVariant('hedgerow'),'hanging_lantern');
  assert.eq(StreetLights.forVariant('pilgrim'),'fire_pedestal');
  assert.eq(StreetLights.forVariant('poison_path'),'green_orb');
  assert.eq(StreetLights.forVariant('golden_path'),'paired_candles');
  assert.eq(StreetLights.forVariant('burned'),'flame_pillar');
  assert.eq(StreetLights.forVariant('fire_path'),'upright_flame');
  assert.truthy(StreetLights.ART.paired_candles.rise < StreetLights.ART.flame_pillar.rise, 'low candles emit nearer the ground than the standing pillar');
  for(const key of Object.keys(StreetLights.ART)) {
    assert.eq(StreetLights.key({_streetArt:key,lit:true}),'street_decor_'+key);
    assert.eq(StreetLights.key({_streetArt:key,lit:false}),'street_decor_'+key);
    assert.eq(StreetLights.key({_streetArt:key,lit:false,suppressed:true}),'rogue_lamp_unlit');
    let tint=null; StreetLights.after({setTint:n=>tint=n,clearTint:()=>tint=null},{_streetArt:key,lit:false});
    assert.truthy(tint);StreetLights.after({clearTint:()=>tint=null},{_streetArt:key,lit:true});assert.eq(tint,null);
  }
});
})();
