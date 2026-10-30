(function () {
test('street signs: posts follow vector edges without snapping their feet to cell centres', () => {
  for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
    const sign = {rec:{halfW:4},x:103,y:107,nx:Math.cos(angle),ny:Math.sin(angle)};
    const seats = StreetSigns.edgeSeats(sign, 7);
    seats.forEach((seat, i) => {
      const distance = (seat.x-sign.x)*sign.nx + (seat.y-sign.y)*sign.ny;
      assert.truthy(Math.abs(distance - (i ? -5.4 : 5.4)) < 1e-9);
      assert.eq(seat.ix, Math.floor(seat.x/7));
      assert.eq(seat.iy, Math.floor(seat.y/7));
    });
  }
});
test('street signs: directions describe only actual junction geometry', () => {
  const index = {mvtToM:1, lines:[
    {key:'a',variant:'hedgerow',line:[{x:100,y:100},{x:300,y:100}]},
    {key:'b',variant:'thorny',line:[{x:100,y:100},{x:100,y:300}]},
    {key:'far',variant:'pilgrim',line:[{x:900,y:900},{x:900,y:1200}]},
  ]};
  const sign = StreetSigns.candidates(index).find(s=>s.rec.key==='a');
  assert.truthy(sign.directions.some(d=>d.direction==='East'&&d.variant==='hedgerow'));
  assert.truthy(sign.directions.some(d=>d.direction==='South'&&d.variant==='thorny'));
  assert.falsy(sign.directions.some(d=>d.variant==='pilgrim'));
  const reversed = {...index,lines:index.lines.map(r=>({...r,line:r.line.slice().reverse()}))};
  assert.eq(JSON.stringify(StreetSigns.candidates(reversed).find(s=>s.rec.key==='a').directions),JSON.stringify(sign.directions));
});
test('street signs: headings share a row only when their boards cannot meet', () => {
  const { post, board } = StreetSigns.ART;
  const rows = (...names) => StreetSigns.rows(names.map(direction => ({ direction }))).map(b => b.row).join();
  assert.eq(rows('East', 'North'), '0,0', 'a right angle apart, each hangs off its own post face');
  assert.eq(rows('East', 'Northeast'), '0,1', 'boards that would cross stack');
  assert.eq(rows('East', 'East'), '0,1', 'two roads leaving the same way stack');
  assert.eq(rows('East', 'West', 'North', 'South'), '0,0,0,0', 'four cardinals fill one row');
  assert.eq(rows('East', 'North', 'Northeast', 'Northwest', 'South', 'Southeast', 'Southwest', 'West'), '0,0,1,1,0,1,1,0', 'the compass fills two rows');
  assert.eq(rows('East', 'Nowhere'), '0', 'only compass headings have a board');
  assert.eq(StreetSigns.rowTop(0, 1), post.height - board.topInset, 'the first row hangs under the post top');
  assert.eq(StreetSigns.rowTop(1, 2), post.height - board.topInset - board.height - board.gap, 'the next a gap below it');
  for (const n of [1, 2, 3, 4, 8]) {
    assert.eq(StreetSigns.rowTop(0, n), post.height - board.topInset, `${n} rows: the first hangs at the top`);
    assert.gte(StreetSigns.rowTop(n - 1, n) - board.height, board.minBottom - 1e-9, `${n} rows: the last stays above the ground`);
    for (let i = 1; i < n; i++) assert.lt(StreetSigns.rowTop(i, n), StreetSigns.rowTop(i - 1, n), 'rows descend');
  }
});
test('street signs: the mesh is a square post with no footing and pentagonal boards', () => {
  const { post, board } = StreetSigns.ART;
  const near = (a, b, msg) => assert.truthy(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);
  assert.lte(post.height, 32, 'half the old sprite: about one cell tall');
  const sign = { directions: [{ direction: 'East', title: 'A' }, { direction: 'North', title: 'B' }, { direction: 'Northeast', title: 'C' }, { direction: 'Nowhere', title: 'D' }] };
  const parts = StreetSigns.mesh(sign, { x: 0, y: 0, uv: { u: .25, v: .75 } });
  assert.eq(parts.length, 4, 'the post and one board per compass heading');
  const vertices = part => part.faces.flatMap(f => f.points);
  for (const part of parts) {
    assert.truthy(part.points.length >= 4 && part.faces.length >= 12, 'a plan footprint and a closed set of triangles');
    assert.truthy(vertices(part).every(p => p.u === .25 && p.v === .75), 'every vertex carries the texel');
    assert.truthy(part.faces.every(f => f.flatColor === f.color && Number.isInteger(f.color)), 'flat cel colours');
  }
  const [postPart, east, north, northeast] = parts;
  const pv = vertices(postPart);
  near(Math.min(...pv.map(p => p.z)), 0, 'the post stands on the ground');
  near(Math.max(...pv.map(p => p.z)), post.height, 'to its full height');
  assert.truthy(pv.every(p => Math.abs(p.x) <= post.side / 2 + 1e-9 && Math.abs(p.y) <= post.side / 2 + 1e-9), 'a square section all the way down: no footing');
  assert.eq(postPart.faces.length, 12, 'six quads');
  const ev = vertices(east), xs = ev.map(p => p.x), zs = ev.map(p => p.z);
  near(Math.min(...xs), post.side / 2, 'the board roots on the post face');
  near(Math.max(...xs), post.side / 2 + board.length, 'and runs its length east');
  near(Math.max(...zs), StreetSigns.rowTop(0, 2), 'the first row');
  near(Math.max(...zs) - Math.min(...zs), board.height, 'one board high');
  assert.truthy(ev.every(p => Math.abs(p.y) <= board.thickness / 2 + 1e-9), 'a thin slab');
  const tips = ev.filter(p => Math.abs(p.x - Math.max(...xs)) < 1e-9);
  const tipKeys = new Set(tips.map(p => `${p.y},${p.z}`));
  assert.eq(tipKeys.size, 2, 'the end comes to a point: one tip vertex per side');
  tips.forEach(p => near(p.z, StreetSigns.rowTop(0, 2) - board.height / 2, 'on the centre line'));
  const shoulders = ev.filter(p => Math.abs(p.x - (post.side / 2 + board.length - board.tip)) < 1e-9);
  assert.eq(new Set(shoulders.map(p => p.z)).size, 2, 'the shoulders span the full height: an elongated pentagon, no arrowhead wider than the plank');
  near(Math.max(...vertices(north).map(p => p.z)), StreetSigns.rowTop(0, 2), 'north shares the top row');
  near(Math.max(...vertices(northeast).map(p => p.z)), StreetSigns.rowTop(1, 2), 'northeast hangs below them');
  const d = StreetSigns.vector('Northeast');
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
    const parts = StreetSigns.mesh({ directions }, { x: 100, y: 100, uv: WallMaterials.WHITE });
    for (const part of parts) WallPerspective.prism(s, 'signs', part.points, 0, StreetSigns.ART.post.height, part.colors, null, true,
      { materialFaces: part.faces, topOutline: PropLowPoly.outline(part.faces, StreetSigns.ART.colours.ink) });
    WallPerspective.finish(s, 'signs');
    s.mapRot = angle; WallPerspective.update(s);
    return { parts, group, triangles: group.gfx.triangles };
  };
  const { post } = StreetSigns.ART.colours;
  let { parts, triangles } = draw(0, [{ direction: 'North' }]);
  const [postPart, north] = parts;
  const visible = part => part.faces.filter(f => f.visible);
  assert.eq(visible(postPart).length, 4, 'north-up the post shows its top and its south face');
  assert.eq(visible(postPart).map(f => f.color).sort().join(), [post.top, post.top, post.mid, post.mid].sort().join(), 'lit top, mid south face');
  const sides = north.faces.filter(f => f.points.every(p => Math.abs(p.x - f.points[0].x) < 1e-9));
  assert.eq(sides.length, 6, 'the two pentagons, three triangles each');
  assert.truthy(sides.every(f => !f.visible), 'a board pointing away is seen edge-on');
  assert.truthy(north.faces.some(f => f.visible), 'its top and root still show');
  assert.truthy(triangles.length > 0 && triangles.every(t => t.points.every(Number.isFinite)), 'drawn');
  ({ parts } = draw(Math.PI / 2, [{ direction: 'North' }]));
  const turned = parts[1].faces.filter(f => f.points.every(p => Math.abs(p.x - f.points[0].x) < 1e-9));
  assert.eq(turned.filter(f => f.visible).length, 3, 'turned a quarter, one pentagon faces the camera');
  assert.truthy(turned.filter(f => f.visible).every(f => f.points[0].x > 100), 'the east one');
  assert.eq(visible(parts[0]).length, 4, 'and the post shows its east face');
  const outline = PropLowPoly.outline(parts[0].faces, StreetSigns.ART.colours.ink);
  assert.eq(outline.color, StreetSigns.ART.colours.ink);
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
  const { post, colours } = StreetSigns.ART;
  assert.eq([...images.keys()].join(), 'roadsign_post', 'only the post is baked; boards are mesh');
  const p = images.get('roadsign_post');
  assert.eq(p.w + 'x' + p.h, (post.side + 2) + 'x' + post.height);
  const ink = '#' + colours.ink.toString(16).padStart(6, '0');
  const pole = row => [...Array(p.w).keys()].filter(x => p.pixels.get(`${x},${row}`) !== ink).join();
  assert.eq(pole(p.h - 1), pole(Math.floor(p.h / 2)), 'no footing: the bottom row is as wide as the pole');
  assert.eq(pole(p.h - 1).split(',').length, post.side, 'the pole is the square section');
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
