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
    assert.eq(inner.length, 8, 'two triangles per inner face');
    const T = api.LOOK.wallThickness;
    for (const f of inner) for (const p of f.points) {
      assert.truthy(p.x >= T - 1e-6 && p.x <= 96 - T + 1e-6 && p.y >= T - 1e-6 && p.y <= 96 - T + 1e-6, 'inner faces stand a wall\'s thickness in');
      assert.truthy(p.z >= -1e-9 && p.z <= base.height + 1e-9, 'floor to eaves');
    }
    // Each inner face runs against its outer wall, so it faces into the room.
    const outer = room.faces.filter(f => f.kind === 'wall' && !f.interior);
    assert.gt(outer.length, 0, 'the outer faces stay');
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
})();
