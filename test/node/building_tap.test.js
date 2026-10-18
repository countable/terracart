// Tap the rendered walls and roofs above a building's ground footprint.
// interactTap has already undone camera zoom and rotation before this lookup.
(() => {
  const triangle = [{ x: 20, y: 10 }, { x: 60, y: 50 }, { x: 20, y: 50 }];
  const mesh = (key = 'shop', overrides = {}) => ({
    key, obj: { visible: true, alpha: 1, depth: 1 },
    visibleTriangles: [triangle], support: { x: 40, y: 70 }, ...overrides,
  });
  const scene = (buildings = [mesh()], overrides = {}) => ({
    depth: 0, viewCenterX: 100, viewCenterY: 100, mapZoom: 1,
    _lowpoly: { enabled: true, buildings, offsetX: 0, offsetY: 0 }, ...overrides,
  });

  test('building tap: roof and wall above the ground activate their building', () => {
    const s = scene();
    assert.eq(Render.buildingHit(s, 25, 20), 'shop');
    assert.eq(Render.buildingHit(s, 40, 45), 'shop');
    assert.eq(Render.buildingHit(s, 40, 70), null, 'ground outside drawn faces is not an elevated hit');
  });

  test('building tap: empty triangle bounding-box corners do not steal a tap', () => {
    const s = scene();
    assert.eq(Render.buildingHit(s, 55, 15), null);
    assert.eq(Render.buildingHit(s, 19, 30), null);
    assert.eq(Render.buildingHit(s, 25, 51), null);
  });

  test('building tap: face edges and opposite triangle windings remain tappable', () => {
    const s = scene([mesh('roof', { visibleTriangles: [[...triangle].reverse()] })]);
    assert.eq(Render.buildingHit(s, 25, 20), 'roof');
    assert.eq(Render.buildingHit(s, 20, 30), 'roof');
    assert.eq(Render.buildingHit(s, 40, 30), 'roof');
  });

  test('building tap: retained geometry follows pan offsets', () => {
    const s = scene();
    s._lowpoly.offsetX = 120; s._lowpoly.offsetY = -80;
    assert.eq(Render.buildingHit(s, 145, -60), 'shop');
    assert.eq(Render.buildingHit(s, 25, 20), null);
  });

  test('building tap: already unrotated and unzoomed input is not transformed twice', () => {
    for (const mapRot of [Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const s = scene([mesh()], { _headingUp: true, gpsM: { x: 0, y: 0 }, mapRot, mapZoom: 2 });
      assert.eq(Render.buildingHit(s, 25, 20), 'shop');
      assert.eq(Render.buildingHit(s, 55, 15), null);
    }
  });

  test('building tap: overlapping buildings select the frontmost regardless of storage order', () => {
    const back = mesh('back', { obj: { visible: true, alpha: 1, depth: 2 }, support: { x: 40, y: 60 } });
    const front = mesh('front', { obj: { visible: true, alpha: 1, depth: 5 }, support: { x: 40, y: 80 } });
    for (const buildings of [[back, front], [front, back]]) {
      assert.eq(Render.buildingHit(scene(buildings), 25, 20), 'front');
    }
  });

  test('building tap: hidden and fully transparent geometry cannot intercept taps', () => {
    for (const obj of [{ visible: false, alpha: 1, depth: 1 }, { visible: true, alpha: 0, depth: 1 }]) {
      assert.eq(Render.buildingHit(scene([mesh('hidden', { obj })]), 25, 20), null);
    }
    assert.eq(Render.buildingHit(scene([mesh('faded', { obj: { visible: true, alpha: 0.5, depth: 1 } })]), 25, 20), 'faded');
  });

  test('building tap: underground and disabled renderer ignore retained geometry', () => {
    assert.eq(Render.buildingHit(scene([mesh()], { depth: 1 }), 25, 20), null);
    const s = scene(); s._lowpoly.enabled = false;
    assert.eq(Render.buildingHit(s, 25, 20), null);
    assert.eq(Render.buildingHit(scene([]), 25, 20), null);
  });

  const wallScene = (overrides = {}) => scene([], {
    _wallPerspective: { osm: {
      gfx: { visible: true, alpha: 1 }, x: 100, y: -50,
      buildings: new Map([[{ key: 'castle', anchor: { x: 40, y: 70 }, alpha: 1 }, [triangle]]]),
    } }, ...overrides,
  });

  test('building tap: wall renderer uses retained faces and group pan', () => {
    const s = wallScene();
    assert.eq(Render.buildingHit(s, 125, -30), 'castle');
    assert.eq(Render.buildingHit(s, 155, -35), null, 'empty corner of the wall bounds');
    assert.eq(Render.buildingHit(s, 25, 20), null, 'old unpanned position');
  });

  test('building tap: hidden wall groups and underground walls do not activate', () => {
    const s = wallScene(); s._wallPerspective.osm.gfx.visible = false;
    assert.eq(Render.buildingHit(s, 125, -30), null);
    assert.eq(Render.buildingHit(wallScene({ depth: 1 }), 125, -30), null);
  });
  const sprite = (overrides = {}) => ({
    visible: true, alpha: 1, x: 100, y: 100, width: 40, height: 60,
    originX: 0.5, originY: 1, scaleX: 1, scaleY: 1,
    _staticObject: { kind: 'house', id: 'legacy' },
    _staticAppearance: { texKey: 'building-tap-fixture', spec: {} }, ...overrides,
  });

  test('building tap: legacy sprite roofs use frame size, origin and scale', () => {
    const s = scene([], { objectPool: [sprite({ scaleX: 2, scaleY: 2 })] });
    assert.eq(Render.buildingHit(s, 65, -10), 'legacy');
    assert.eq(Render.buildingHit(s, 59, 50), null);
    assert.eq(Render.buildingHit(s, 100, -21), null);
    s.objectPool[0].visible = false;
    assert.eq(Render.buildingHit(s, 100, 50), null);
  });

  test('building tap: tower pool uses the same extent and excludes ordinary props', () => {
    const s = scene([], { towerPool: [sprite({ _staticObject: { kind: 'tower', id: 'tower' } })] });
    assert.eq(Render.buildingHit(s, 100, 45), 'tower');
    s.towerPool[0]._staticObject.kind = 'tree';
    assert.eq(Render.buildingHit(s, 100, 45), null);
  });

  test('building tap: trimmed sprite padding is excluded', () => {
    const artKey = 'building-tap-fixture:0', previous = SpriteLayout.ART_BOUNDS[artKey];
    SpriteLayout.ART_BOUNDS[artKey] = { fw: 40, fh: 60, minX: 10, maxX: 30, minY: 20, maxY: 55 };
    try {
      const s = scene([], { objectPool: [sprite()] });
      assert.eq(Render.buildingHit(s, 100, 70), 'legacy');
      assert.eq(Render.buildingHit(s, 85, 70), null);
      assert.eq(Render.buildingHit(s, 100, 50), null);
      assert.eq(Render.buildingHit(s, 100, 98), null);
    } finally {
      if (previous === undefined) delete SpriteLayout.ART_BOUNDS[artKey];
      else SpriteLayout.ART_BOUNDS[artKey] = previous;
    }
  });

  test('building tap: heading-up legacy sprites counterrotate about their feet', () => {
    const s = scene([], { mapRot: Math.PI / 2, objectPool: [sprite()] });
    assert.eq(Render.buildingHit(s, 50, 100), 'legacy', 'upright roof expressed in inverse-rotated map coordinates');
    assert.eq(Render.buildingHit(s, 100, 50), null, 'north-up roof position no longer contains art');
  });

  test('building tap: building handler preserves work and loot priority before creatures', () => {
    const names = TAP_HANDLERS.map(h => h.name), at = names.indexOf('building-art');
    assert.gt(at, names.indexOf('work-progress'));
    assert.gt(at, names.indexOf('treasure'));
    assert.gt(at, names.indexOf('coindrop'));
    assert.lt(at, names.indexOf('creature'));
  });

  test('building tap: handler dispatches a nearby building and blocks a distant one', () => {
    const calls = [], flashes = [];
    const s = makeScene({ cellM: 5, mPerPx: 1, cellsPerTile: 64,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, playerM: { x: 2, y: 2 },
      shopInteract: (...args) => calls.push(args), flash: (...args) => flashes.push(args) });
    const ctx = makeCtx(s, { energy: 100 }); s.save = ctx.save;
    ctx.sx = 25; ctx.sy = 20; ctx.wm = { x: 2, y: 2 };
    ctx.building = { kind: 'house', id: 'shop', x: 2, y: 2 };
    const handler = TAP_HANDLERS.find(h => h.name === 'building-art');
    assert.eq(handler.try(ctx), true);
    assert.eq(calls.length, 1); assert.eq(calls[0][2], ctx.building);
    ctx.building = { kind: 'house', id: 'far-shop', x: 10000, y: 10000 };
    ctx.wm = { x: 10000, y: 10000 };
    assert.eq(handler.try(ctx), 'far');
    assert.eq(calls.length, 1); assert.eq(flashes.length, 1);
    ctx.building = null;
    assert.eq(handler.try(ctx), false);
  });
  function withBuildingWorld(objects, fn) {
    const saved = {
      each: WorldGen.forEachItem, entries: [...WorldGen.tileCache],
      hidden: Visibility.hidden, cover: Visibility.playerCover,
      road: RoadSafety.objectHidden, retired: HiddenObjects.isHidden,
      buildingTypes: globalThis.BUILDING_TYPES,
    };
    WorldGen.tileCache.clear();
    // app.js owns this terrain set; the headless harness does not load app.js.
    globalThis.BUILDING_TYPES = new Set([WorldGen.T.BUILDING, WorldGen.T.BUILDING_MED, WorldGen.T.BUILDING_LARGE]);
    WorldGen.forEachItem = (layer, visit) => {
      if (layer === 'objects') for (const object of objects) if (visit(object)) break;
    };
    Visibility.hidden = () => false; Visibility.playerCover = () => 0;
    RoadSafety.objectHidden = () => false; HiddenObjects.isHidden = () => false;
    try { fn(); } finally {
      WorldGen.forEachItem = saved.each; WorldGen.tileCache.clear();
      for (const [key, value] of saved.entries) WorldGen.tileCache.set(key, value);
      Visibility.hidden = saved.hidden; Visibility.playerCover = saved.cover;
      RoadSafety.objectHidden = saved.road; HiddenObjects.isHidden = saved.retired;
      if (saved.buildingTypes === undefined) delete globalThis.BUILDING_TYPES;
      else globalThis.BUILDING_TYPES = saved.buildingTypes;
    }
  }

  test('building tap: full tap dispatch resolves elevated roof to its owning shop', () => {
    const owner = { kind: 'house', id: 'shop', x: 2, y: 2 };
    withBuildingWorld([owner], () => {
      const calls = [];
      const s = Object.assign(makeScene(), scene(), {
        viewLeft: 0, viewTop: 0, viewSize: 200,
        originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
        playerM: { x: 2, y: 2 }, cellM: 5, mPerPx: 1, cellsPerTile: 64,
        screenToWorldMeters: () => ({ x: 500, y: 500 }),
        shopInteract: (x, y, object) => calls.push(object),
      });
      s.save = makeCtx(s, { energy: 100 }).save;
      // The roof is visible over unrelated distant ground. Reach and shop
      // identity come from the building, not that ground cell.
      interactTap(s, 25, 20);
      assert.eq(calls.length, 1); assert.eq(calls[0], owner);
    });
  });

  test('building tap: unknown and hidden elevated owners fall through to ground handlers', () => {
    const owner = { kind: 'house', id: 'shop', x: 2, y: 2 };
    for (const reason of ['missing', 'hidden']) withBuildingWorld(reason === 'missing' ? [] : [owner], () => {
      if (reason === 'hidden') HiddenObjects.isHidden = () => true;
      let fellThrough = false;
      const creature = TAP_HANDLERS.find(h => h.name === 'creature'), original = creature.try;
      creature.try = ctx => { assert.eq(ctx.building, null); fellThrough = true; return true; };
      try {
        const s = Object.assign(makeScene(), scene(), {
          viewLeft: 0, viewTop: 0, viewSize: 200,
          screenToWorldMeters: () => ({ x: 500, y: 500 }),
          playerToWorldCell: () => ({ tx: 0, ty: 0 }),
          shopInteract: () => { throw new Error('invalid owner activated'); },
        });
        s.save = makeCtx(s, {}).save;
        interactTap(s, 25, 20);
        assert.truthy(fellThrough, reason);
      } finally { creature.try = original; }
    });
  });

  test('building tap: footprint owner beats a closer neighbouring shop', () => {
    const owner = { kind: 'house', id: 'footprint-owner', x: 20, y: 20 };
    const neighbour = { kind: 'house', id: 'neighbour', x: 2, y: 2 };
    withBuildingWorld([neighbour, owner], () => {
      WorldGen.tileCache.set(WorldGen.tileKey(0, 0), {
        cellsPerEdge: 2, owners: new Uint8Array([0, 1, 0, 0]),
        ownerKeys: [null, owner.id], objects: [neighbour, owner],
      });
      const calls = [], s = makeScene({ shopInteract: (x, y, object) => calls.push(object) });
      const ctx = makeCtx(s, {}); s.save = ctx.save;
      Object.assign(ctx, { cwmx: 2, cwmy: 2,
        cell: { type: TERRAIN.BUILDING, tx: 0, ty: 0, ix: 1, iy: 0 } });
      assert.eq(TAP_HANDLERS.find(h => h.name === 'building-zone').try(ctx), true);
      assert.eq(calls.length, 1); assert.eq(calls[0], owner);
    });
  });
})();
