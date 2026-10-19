// Mixed 3D meshes and billboards must share ground depth, while only the
// billboard artwork counterrotates. Material generation is outside this test.
(() => {
  const api = new Function('window', BUILDING_LOWPOLY_SRC + '\nreturn window.BuildingLowPoly;')({});
  const depthTest = (name, fn) => test(name, () => {
    const previous = globalThis.BuildingLowPoly;
    globalThis.BuildingLowPoly = api;
    try { fn(); } finally {
      if (previous === undefined) delete globalThis.BuildingLowPoly;
      else globalThis.BuildingLowPoly = previous;
    }
  });
  const near = (a, b) => assert.lt(Math.abs(a - b), 1e-8);
  const container = () => ({ list: [], add(o) { this.list.push(o); o.parentContainer = this; } });
  function scene() {
    return { _headingUp: true, gpsM: { x: 0, y: 0 }, mapRot: 0,
      viewCenterX: 100, viewCenterY: 100, viewSize: 200, mapZoom: 1,
      startWorldM: { x: 400, y: 800 }, playerM: { x: 6, y: 12 }, cellM: 6,
      game: { renderer: { type: 2 } }, cameras: { main: { id: 1 } }, uiCam: { id: 2 },
      children: { list: [] }, worldContainer: container(), buildingWallContainer: container(),
      add: { graphics: () => ({ type: 'Graphics', visible: true, x: 0, y: 0,
        rotation: 0, depth: 0, setDepth(d) { this.depth = d; return this; },
        setPosition(x, y) { this.x = x; this.y = y; return this; },
        setVisible(v) { this.visible = v; return this; } }) },
      textures: { exists: key => key.startsWith('fallback:lowpoly:'), get: key => ({ key }) } };
  }
  function building(s, x, y, key) {
    return BuildingLowPoly.add(s, [{ x, y }, { x: x + 24, y },
      { x: x + 24, y: y + 24 }, { x, y: y + 24 }],
    { role: 'fort', stories: 1, material: 'stone', body: 0x999999, roof: 0x777777, trim: 0x444444 }, 'flat', key);
  }
  const billboard = (x, y) => ({ type: 'Sprite', visible: true, x, y,
    rotation: 0, depth: 0, _huAnchor: { x, y }, setDepth(d) { this.depth = d; } });

  depthTest('building depth: individual buildings interleave with props in world metres', () => {
    const s = scene(); BuildingLowPoly.begin(s);
    const back = building(s, 60, 60, 'back'), front = building(s, 60, 120, 'front');
    BuildingLowPoly.update(s);
    const pieces = BuildingLowPoly.worldPieces(s), prop = billboard(72, 100);
    assert.eq(pieces.length, 2); assert.truthy(back.obj !== front.obj);
    assert.includes(s.worldContainer.list, back.obj); assert.includes(s.worldContainer.list, front.obj);
    Render.sortWorldDepth([...pieces, { sprite: prop, groundY: 812, rank: 1 }]);
    assert.lt(back.obj.depth, prop.depth); assert.lt(prop.depth, front.obj.depth);
    for (const p of pieces) near(p.groundY, 812 + (p.sprite._huAnchor.y - 100) * 6 / CELL_PX);
  });

  depthTest('building depth: inside Home each wall sorts on its own — the player between the wall behind and the wall in front', () => {
    const s = scene(); BuildingLowPoly.begin(s);
    // The home role draws the cel facade sheet; headless, a stub texture stands in for it.
    s.textures = { exists: (k) => k.startsWith('fallback:lowpoly:') || k.startsWith('lowpoly:cel'), get: (k) => ({ key: k }) };
    const room = BuildingLowPoly.add(s, [{ x: 60, y: 60 }, { x: 84, y: 60 }, { x: 84, y: 84 }, { x: 60, y: 84 }],
      { role: 'home', stories: 1, material: 'stone', body: 0x999999, roof: 0x777777, trim: 0x444444, interior: true }, 'flat', 'home');
    BuildingLowPoly.update(s);
    const walls = s._lowpoly.buildings.filter((m) => m.key === 'home');
    assert.eq(walls.length, 4, 'one render object per wall');
    assert.truthy(walls.every((m) => m.edge && m.obj && m.faces.length), 'each with its edge and its faces');
    assert.eq(new Set(walls.map((m) => m.obj)).size, 4, 'four distinct objects');
    // No ink inside (owner, Oct 2026): a wall inking its own edge over its
    // neighbour's fill left seams, and the dark mask outside is edge enough.
    assert.truthy(walls.every((m) => m.obj._noInk), 'no wall inks inside');
    assert.eq(s._lowpoly.buildings.filter((m) => m.key === 'home').length, 4, 'and no outline object either');
    assert.truthy(room && room.height > 0, 'add still answers a mesh with the house height');
    const byY = (y) => walls.filter((m) => m.edge.a.y === y && m.edge.b.y === y)[0];
    const north = byY(60), south = byY(84), flanks = walls.filter((m) => m !== north && m !== south);
    near(north.support.y, 60); near(south.support.y, 84);
    for (const f of flanks) near(f.support.y, 84);   // a flank's top overlaps the player only south of their feet
    // North-up: a player in the middle of the room draws over the north wall and under the south.
    const player = billboard(72, 72);
    const pieces = BuildingLowPoly.worldPieces(s);
    Render.sortWorldDepth([...pieces, { sprite: player, groundY: 812 + (72 - 100) * 6 / CELL_PX, rank: 3 }]);
    assert.lt(north.obj.depth, player.depth); assert.lt(player.depth, south.obj.depth);
    for (const f of flanks) assert.lt(player.depth, f.obj.depth);
    // Turned half round, the north wall is the one lowest on screen: it comes in front.
    s.worldContainer.add(player);
    s.mapRot = Math.PI; HeadingUp._preRender(s);
    near(north.support.y, 60); near(south.support.y, 84);
    const list = s.worldContainer.list;
    assert.truthy(list.indexOf(north.obj) > list.indexOf(player), 'turned: the north wall in front');
    assert.truthy(list.indexOf(south.obj) < list.indexOf(player), 'and the south wall behind');
    HeadingUp._postRender(s);
    // A standing house (no interior) is still one object at its centroid.
    const whole = building(s, 120, 120, 'whole'); BuildingLowPoly.update(s);
    assert.falsy(whole.edge); near(whole.support.x, 132); near(whole.support.y, 132);
  });

  depthTest('building depth: compass sweep interleaves billboards without rotating building geometry', () => {
    const s = scene(); BuildingLowPoly.begin(s);
    const mesh = building(s, 88, 88, 'house'); BuildingLowPoly.update(s);
    const prop = billboard(140, 120); s.worldContainer.add(prop);
    for (let step = 1; step < 32; step++) {
      s.mapRot = step * Math.PI / 16;
      const order = s.worldContainer.list.slice();
      HeadingUp._preRender(s);
      const anchor = mesh.obj._huAnchor;
      const delta = Math.sin(s.mapRot) * (140 - anchor.x) + Math.cos(s.mapRot) * (120 - anchor.y);
      assert.eq(s.worldContainer.list.indexOf(prop) > s.worldContainer.list.indexOf(mesh.obj), delta > 0);
      near(mesh.obj.rotation, 0); near(prop.rotation, -s.mapRot);
      HeadingUp._postRender(s);
      order.forEach((o, i) => assert.eq(s.worldContainer.list[i], o));
    }
  });

  depthTest('building depth: panning updates ground anchors at cached heading and clear retires meshes', () => {
    const s = scene(); BuildingLowPoly.begin(s);
    const first = building(s, 40, 50, 'first'), second = building(s, 90, 110, 'second');
    BuildingLowPoly.update(s);
    const x = first.obj._huAnchor.x, y = first.obj._huAnchor.y;
    BuildingLowPoly.offset(s, -17, 23);
    near(first.obj._huAnchor.x, x - 17); near(first.obj._huAnchor.y, y + 23);
    near(first.obj.x, -17); near(first.obj.y, 23);
    assert.truthy(BuildingLowPoly.covers(s, { id: 'first' }));
    s.depth = 1; BuildingLowPoly.update(s);
    assert.falsy(first.obj.visible); assert.falsy(BuildingLowPoly.covers(s, { id: 'first' }));
    assert.eq(BuildingLowPoly.worldPieces(s).length, 0);
    s.depth = 0; BuildingLowPoly.update(s);
    assert.truthy(first.obj.visible);
    BuildingLowPoly.clear(s);
    assert.falsy(first.obj.visible); assert.falsy(second.obj.visible);
    assert.eq(BuildingLowPoly.worldPieces(s).length, 0);
    assert.falsy(BuildingLowPoly.covers(s, { id: 'first' }));
    BuildingLowPoly.begin(s);
    const replacement = building(s, 20, 30, 'replacement'); BuildingLowPoly.update(s);
    assert.eq(s.worldContainer.list.length, 2, 'rebuild reuses graphics objects');
    assert.truthy(replacement.obj.visible); assert.falsy(second.obj.visible);
    assert.eq(BuildingLowPoly.worldPieces(s).length, 1);
  });

  // Home's room (building_overlay.js drawHome, recipe.interior): the same
  // house with its roof off, cut level at the eaves, with inner wall faces
  // and a top band for the walls' thickness.
  depthTest('low-poly: Home\'s interior is the house with no roof, level walls, inner faces and thick tops', () => {
    const ring = [{ x: 0, y: 0 }, { x: 96, y: 0 }, { x: 96, y: 96 }, { x: 0, y: 96 }];
    const base = api.geometry(ring, 'ridge', 36, 5, null);
    assert.gt(base.faces.filter(f => f.kind === 'roof').length, 0, 'the house has a roof');
    const room = api.interiorGeometry(base, api.LOOK.wallThickness);
    assert.eq(room.faces.filter(f => f.kind === 'roof').length, 0, 'the room has none');
    assert.eq(room.height, base.height, 'the same walls');
    assert.truthy(room.faces.every(f => f.points.every(p => p.z <= base.height + 1e-6)), 'nothing stands above the eaves');
    assert.truthy(room.faces.every(f => f.kind !== 'trim' || f.wallTop), 'no beams, chimney or fascia');
    const inner = room.faces.filter(f => f.interior);
    assert.eq(inner.length, room.faces.filter(f => f.kind === 'wall' && !f.interior).length, 'inner faces mirror the clipped exterior triangles');
    const T = api.LOOK.wallThickness;
    for (const f of inner) for (const p of f.points) {
      assert.truthy(p.x >= -1e-6 && p.x <= 96 + 1e-6 && p.y >= -1e-6 && p.y <= 96 + 1e-6, 'inner faces preserve the full floor footprint');
      assert.truthy(p.z >= -1e-9 && p.z <= base.height + 1e-9, 'floor to eaves');
    }
    // Each inner face runs against its outer wall, so it faces into the room.
    const outer = room.faces.filter(f => f.kind === 'wall' && !f.interior);
    assert.gt(outer.length, 0, 'the outer faces stay');
    assert.truthy(outer.every(f => f.points.every(p => p.x < 0 || p.x > 96 || p.y < 0 || p.y > 96)), 'wall thickness sits outside the floor');
    for (const f of inner) {
      const o = outer.find(w => w.edge === f.edge && w.points.every(p => f.points.some(q => q.u === p.u && q.v === p.v && q.z === p.z)));
      assert.truthy(o, 'inside and outside retain the same opening UVs');
    }
    for (const f of inner) {
      const o = outer.find(w => Math.abs(w.wallDirection.x * f.wallDirection.y - w.wallDirection.y * f.wallDirection.x) < 1e-6
        && w.wallDirection.x * f.wallDirection.x + w.wallDirection.y * f.wallDirection.y < 0);
      assert.truthy(o, 'an outer wall runs the other way');
    }
    const band = room.faces.filter(f => f.wallTop);
    assert.eq(band.length, 8, 'two triangles of top band per wall');
    assert.truthy(band.every(f => f.points.every(p => Math.abs(p.z - base.height) < 1e-9)), 'the band lies on the wall tops');
    assert.eq(api.interiorGeometry(base, T), room, 'built once per house');
  });

  depthTest('low-poly: styled interior triangles stay on their own wall at corners', () => {
    const ring = [{ x: 0, y: 0 }, { x: 170, y: 0 }, { x: 170, y: 160 }, { x: 0, y: 160 }];
    const recipe = { ...api.recipeFor('trader'), stories: 1 };
    const base = api.styleGeometry(ring, recipe.style, recipe);
    const room = api.interiorGeometry(base, api.LOOK.wallThickness);
    for (let edge = 0; edge < ring.length; edge++) {
      const a = ring[edge], b = ring[(edge + 1) % ring.length], dx = b.x - a.x, dy = b.y - a.y;
      const walls = room.faces.filter(f => f.interior && f.edge === edge);
      assert.eq(walls.length, 2, 'both triangles survive on every wall');
      assert.truthy(walls.every(f => f.points.every(p => Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) < 1e-6)),
        'each triangle belongs to the edge that contains it');
    }
  });

  depthTest('building depth: a wall sorts at its baseline point in the player\'s screen column, re-asked as they move', () => {
    const s = scene(); BuildingLowPoly.begin(s);
    s.textures = { exists: (k) => k.startsWith('fallback:lowpoly:') || k.startsWith('lowpoly:cel'), get: (k) => ({ key: k }) };
    BuildingLowPoly.add(s, [{ x: 60, y: 60 }, { x: 84, y: 60 }, { x: 84, y: 84 }, { x: 60, y: 84 }],
      { role: 'home', stories: 1, material: 'stone', body: 0x999999, roof: 0x777777, trim: 0x444444, interior: true }, 'flat', 'home');
    let feet = { x: 80, y: 70 };
    s.playerScreen = () => feet;
    // Turned 45°: the across-screen coordinate is (x − y)/√2. The player at
    // (80, 70) shares it with (70, 60) on the north wall and (84, 74) on the
    // east flank; the south wall and the west flank clamp to their ends.
    s.mapRot = Math.PI / 4; BuildingLowPoly.update(s);
    const walls = s._lowpoly.buildings.filter((m) => m.key === 'home' && m.edge);
    const wall = (ax, ay, bx, by) => walls.find((m) => m.edge.a.x === ax && m.edge.a.y === ay && m.edge.b.x === bx && m.edge.b.y === by);
    const north = wall(60, 60, 84, 60), east = wall(84, 60, 84, 84), south = wall(84, 84, 60, 84), west = wall(60, 84, 60, 60);
    near(north.support.x, 70); near(north.support.y, 60);
    near(east.support.x, 84); near(east.support.y, 74);
    near(south.support.x, 84); near(south.support.y, 84);
    near(west.support.x, 60); near(west.support.y, 60);
    // The player steps west: the north wall's point follows (clamped at its end).
    feet = { x: 62, y: 70 }; BuildingLowPoly.update(s);
    near(north.support.x, 60); near(north.support.y, 60);
    near(east.support.x, 84); near(east.support.y, 84);
    // The same rule, through the one shared helper.
    const p = WallPerspective.wallSortPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, Math.PI / 4, { x: 30, y: 0 });
    near(p.x, 30); near(p.y, 0);
    const q = WallPerspective.wallSortPoint({ x: 0, y: 0 }, { x: 0, y: 50 }, 0, { x: 10, y: 20 });
    near(q.x, 0); near(q.y, 50);   // end-on: the end lowest on screen
  });
})();
