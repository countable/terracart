// Home adopts a nearby mapped footprint. Only an open-ground spawn creates
// a synthetic 2x2 house; neither placement nor reloading removes buildings.
// These tests execute the shipping scene methods with cell-exact fixtures.
(() => {
  const N = 60, CELL_M = 7, EDGE = N * CELL_M;
  const KEY = WorldGen.tileKey(0, 0);
  const BUILDING_TYPES = new Set([9, 11, 12]);
  const lift = (name) => liftSceneMethod(name, { BUILDING_TYPES });
  const near = (a, b, msg) => assert.truthy(Math.abs(a - b) < 1e-9, `${msg} (${a} vs ${b})`);
  const at = (ix, iy) => ({ x: (ix + 0.5) * CELL_M, y: (iy + 0.5) * CELL_M });
  const scene = (save = {}) => ({
    save: { homeCompassDetected: true, ...save }, depth: 0, tileEdgeM: EDGE, cellsPerTile: N, cellM: CELL_M,
    mPerPx: CELL_M / (WorldGen.TILE_PX / N),
    originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
    _starterTrailerObj: null,
    _placeHome: lift('_placeHome'),
    _nearbyHomeBuilding: lift('_nearbyHomeBuilding'),
    _homeSiteClear: lift('_homeSiteClear'),
    _newHomeSite: lift('_newHomeSite'),
    moveHomeTrailerHere: lift('moveHomeTrailerHere'),
    _onFirstCompass: lift('_onFirstCompass'),
    _placePendingHomeFirepit: lift('_placePendingHomeFirepit'),
    _firepitGroundOK: lift('_firepitGroundOK'),
    _makeStarterTrailer: lift('_makeStarterTrailer'),
    ensureStarterTrailerObject: lift('ensureStarterTrailerObject'),
    clearHomeFooting: lift('clearHomeFooting'),
    _homeFootingAnchor: lift('_homeFootingAnchor'),
    _eraseHomeBuildings: lift('_eraseHomeBuildings'),
    _homeFootingAt: lift('_homeFootingAt'),
    _stampHomeFootprint: lift('_stampHomeFootprint'),
    _unstampHomeFootprint: lift('_unstampHomeFootprint'),
    homeInside: lift('homeInside'),
    homeInterior: lift('homeInterior'),
    homeWorldPos: lift('homeWorldPos'),
    ensureStarterShopId() {},
  });
  // A residential tile with building footprints: each { key, x0, x1, y0, y1 }
  // paints cells [x0..x1] × [y0..y1] as small-building terrain under its key.
  const tile = (buildings, objects = []) => {
    const grid = new Uint8Array(N * N).fill(WorldGen.T.RESIDENTIAL);
    const owners = new Uint16Array(N * N), ownerKeys = [null];
    const buildingShapes = [];
    for (const b of buildings) {
      const id = ownerKeys.push(b.key) - 1;
      for (let iy = b.y0; iy <= b.y1; iy++) for (let ix = b.x0; ix <= b.x1; ix++) {
        grid[iy * N + ix] = WorldGen.T.BUILDING; owners[iy * N + ix] = id;
      }
      buildingShapes.push({ key: b.key, ring: Float32Array.from([b.x0 * CELL_M, b.y0 * CELL_M, (b.x1 + 1) * CELL_M, b.y0 * CELL_M, (b.x1 + 1) * CELL_M, (b.y1 + 1) * CELL_M, b.x0 * CELL_M, (b.y1 + 1) * CELL_M]), tier: 9 });
    }
    return { cellsPerEdge: N, grid, baseGrid: grid.slice(), owners, ownerKeys, buildingShapes, objects };
  };
  const cellsOf = (e, key) => {
    const id = e.ownerKeys.indexOf(key);
    let n = 0;
    for (let i = 0; i < e.grid.length; i++) if (e.owners[i] === id && e.grid[i] === WorldGen.T.BUILDING) n++;
    return n;
  };
  const withTile = (e, fn) => {
    WorldGen.tileCache.set(KEY, e);
    try { fn(); } finally { WorldGen.tileCache.delete(KEY); }
  };
  // The house north of a player at (30, 30): it reaches row 28, the wagon's
  // top row (the wagon stands on (30, 29)).
  const NORTH = { key: 'h_0_0_30_27', x0: 29, x1: 32, y0: 26, y1: 28 };
  const FAR = { key: 'h_0_0_45_45', x0: 44, x1: 46, y0: 44, y1: 46 };

  test('home footing: the wagon parks north of the player, the firepit three cells due south after compass detection', () => {
    const s = scene();
    withTile(tile([]), () => {
      const p = at(30, 30);
      s._placeHome(p.x, p.y);
      assert.eq(s.save.starterShopId, 'starter_trailer', 'Home is the wagon');
      assert.truthy(sameAbsCell(s, s.save.starterTrailer.x, s.save.starterTrailer.y, at(30, 29).x, at(30, 29).y),
        'the wagon is one cell north, so the player stands at its door');
      assert.truthy(sameAbsCell(s, s.save.homeFirepit.x, s.save.homeFirepit.y, at(30,32).x, at(30,32).y),
        'the firepit is three cells due south of the house\'s centre');
      const e = WorldGen.tileCache.get(KEY);
      const wagon = e.objects.find(o => o.id === 'starter_trailer');
      assert.truthy(wagon, 'the house object is injected');
      assert.eq(wagon.footDx, -0.5, 'it stands on its footprint\'s centre');
      assert.eq(wagon.footDy, -0.5, 'with no art nudge');
      assert.eq(s.save.starterTrailer.door, 'S', 'the door faces the player');
      // The footprint: a 2x2 square ending at the saved anchor cell.
      assert.eq(cellsOf(e, 'starter_trailer'), 4, 'four building cells');
      for (const [ix, iy] of [[29, 28], [30, 28], [30, 29]]) {
        assert.eq(e.ownerKeys[e.owners[iy * N + ix]], 'starter_trailer', `(${ix},${iy}) is Home's`);
      }
      assert.eq(e.grid[27 * N + 30], WorldGen.T.RESIDENTIAL, 'the row beyond is ground');
      const shape = e.buildingShapes.find(sh => sh.key === 'starter_trailer');
      assert.truthy(shape && shape.home, 'and a ring for the overlay');
      assert.eq(shape.ring.length, 8, 'a quad');
      near(shape.ring[0], 29 * CELL_M, 'NW corner x'); near(shape.ring[1], 28 * CELL_M, 'NW corner y');
      near(shape.ring[4], 31 * CELL_M, 'SE corner x'); near(shape.ring[5], 30 * CELL_M, 'SE corner y');
      near(shape.door.x, 30 * CELL_M, 'the doorway is the south wall\'s middle');
      near(shape.door.y, 30 * CELL_M, 'on the south edge, under the player');
      // Stamped once per entry and position.
      const shapes = e.buildingShapes;
      s.ensureStarterTrailerObject();
      assert.eq(e.buildingShapes, shapes, 'a second frame does not restamp');
      const c = at(30,32), pit = s.save.homeFirepit;
      near(pit.x, c.x, 'the ring is centred horizontally');
      near(pit.y, c.y, 'the ring is centred vertically, farther from the trailer');
    });
  });

  test('home footing: a new live Home waits for compass, then freezes its entrance-side layout', () => {
    withTile(tile([]), () => {
      const s = scene({ homeCompassDetected: false });
      s.gpsM = at(30,30); s.playerM = { ...s.gpsM };
      s._setStarterCratesAt = () => {};
      s.ensureStarterShopId = lift('ensureStarterShopId');
      s.ensureStarterShopId();
      assert.eq(s.save.starterTrailer, undefined, 'no trailer before the reading');
      assert.eq(s.save.homeFirepit, undefined, 'no firepit before the reading');
      s._deviceCompass = { deg: 180 };
      s._onFirstCompass();
      s.ensureStarterShopId();
      near(s.save.starterTrailer.y, at(30,31).y, 'trailer ahead when facing south');
      near(s.save.homeFirepit.y, at(30,28).y, 'firepit behind the player');
      near(s.playerM.y, at(30,30).y, 'the player never moves');
      const trailer = JSON.stringify(s.save.starterTrailer), pit = JSON.stringify(s.save.homeFirepit);
      s._deviceCompass.deg = 0; s._onFirstCompass(); s.ensureStarterShopId();
      assert.eq(JSON.stringify(s.save.starterTrailer), trailer, 'turning cannot move Home');
      assert.eq(JSON.stringify(s.save.homeFirepit), pit, 'turning cannot move the firepit');
      const reload = scene(JSON.parse(JSON.stringify(s.save)));
      reload.ensureStarterTrailerObject();
      assert.eq(JSON.stringify(reload.save.homeFirepit), pit, 'reload retains the saved layout');
    });
  });

  test('home footing: entrance-side offsets follow cardinal and diagonal compass headings', () => {
    for (let heading = 0; heading < 360; heading++) {
      const { wagon, firepit } = HomeArea.placementOffsets(heading);
      const a = heading * Math.PI / 180;
      const screenY = p => -Math.sin(a) * p.dx + Math.cos(a) * p.dy;
      assert.truthy(screenY(wagon) < 0, `${heading}: house above player`);
      assert.truthy(screenY(firepit) > 0, `${heading}: firepit below player`);
      // The door is in the wall facing the player (who stands at -wagon from
      // the house's centre); a diagonal heading takes the north/south wall.
      const side = HomeArea.doorSide(heading);
      if (side === 'S') assert.truthy(-wagon.dy > 0, `${heading}: player south of the house`);
      else if (side === 'N') assert.truthy(-wagon.dy < 0, `${heading}: player north of the house`);
      else if (side === 'E') assert.truthy(-wagon.dx > 0, `${heading}: player east of the house`);
      else assert.truthy(-wagon.dx < 0, `${heading}: player west of the house`);

    }
  });

  test('home footing: old firepit and its lit fire centre together without changing cells or fire state', () => {
    const centre = at(29, 31);
    const pit = { x: centre.x + CELL_M * 0.25, y: centre.y - CELL_M * 0.25 };
    const fire = { ...pit, depth: 0, litAt: 1234, fuel: 7 };
    const caveFire = { ...pit, depth: 1, litAt: 5678 };
    const distantFire = { ...at(40, 40), depth: 0 };
    const s = scene({ homeFirepit: pit, fires: [fire, caveFire, distantFire] });
    s.ensureStarterTrailerObject();
    near(pit.x, centre.x, 'ring centre x');
    near(pit.y, centre.y, 'ring centre y');
    near(fire.x, pit.x, 'lit fire shares ring x');
    near(fire.y, pit.y, 'lit fire shares ring y');
    assert.eq(fire.litAt, 1234, 'fire timing preserved');
    assert.eq(fire.fuel, 7, 'fire fuel preserved');
    near(caveFire.x, centre.x + CELL_M * 0.25, 'cave fire untouched');
    near(distantFire.x, at(40, 40).x, 'other cells untouched');
    s.ensureStarterTrailerObject();
    near(pit.x, centre.x, 'repeat injection is stable');
  });

  test('home footing: first compass reading places the pit once, including across reloads', () => {
    withTile(tile([]), () => {
      const s = scene({homeCompassDetected:false});
      const p = at(30,30);s._placeHome(p.x,p.y);
      assert.eq(s.save.homeFirepit,null,'no pit before a sensor reading');
      s._onFirstCompass();
      near(s.save.homeFirepit.x,at(30,32).x,'same column as trailer');
      near(s.save.homeFirepit.y,at(30,32).y,'one row farther south');
      const pit=s.save.homeFirepit;
      s._onFirstCompass();assert.eq(s.save.homeFirepit,pit,'later readings do not replace it');
      const reloaded=scene(JSON.parse(JSON.stringify(s.save))), saved=reloaded.save.homeFirepit;
      reloaded._onFirstCompass();assert.eq(reloaded.save.homeFirepit,saved,'reload preserves first-detection latch');
    });
  });
  test('home footing: sensor event unlocks placement, invalid readings do not', () => {
    withTile(tile([]), () => {
      const s=scene({homeCompassDetected:false}), callbacks={};
      const win={screen:{orientation:{angle:0}},addEventListener(name,fn){callbacks[name]=fn;}};
      const p=at(30,30);s._placeHome(p.x,p.y);
      liftSceneMethod('_attachCompass',{window:win}).call(s);
      callbacks.deviceorientationabsolute({absolute:true,alpha:null});
      assert.eq(s.save.homeFirepit,null);
      callbacks.deviceorientationabsolute({absolute:true,alpha:270});
      near(s.save.homeFirepit.x,at(30,32).x,'east-facing device still places geographically south');
      near(s.save.homeFirepit.y,at(30,32).y,'sensor places pit');
      const pit=s.save.homeFirepit;
      callbacks.deviceorientationabsolute({absolute:true,alpha:90});
      assert.eq(s.save.homeFirepit,pit,'turning west does not reposition it');
    });
  });
  test('home footing: first compass relocates an existing lit pit without resetting its fire', () => {
    withTile(tile([]), () => {
      const old=at(29,31), fire={...old,depth:0,litAt:1234,fuel:7};
      const s=scene({homeCompassDetected:false,homeFirepit:old,fires:[fire],
        starterShopId:'starter_trailer',starterTrailer:{id:'starter_trailer',...at(30,29)}});
      s._onFirstCompass();
      near(fire.x,at(30,32).x,'surface fire follows pit');near(fire.y,at(30,32).y,'new southern cell');
      assert.eq(fire.litAt,1234);assert.eq(fire.fuel,7);
    });
  });

  test('home footing: with no compass reading, the pit still appears after the grace period', () => {
    withTile(tile([]), () => {
      const s = scene({homeCompassDetected:false});
      const p = at(30,30); s._placeHome(p.x,p.y);
      s.ensureStarterTrailerObject();
      assert.eq(s.save.homeFirepit, null, 'waits for a reading at first');
      s._firepitGraceT0 = performance.now() - HomeArea.FIREPIT_COMPASS_GRACE_MS - 1;
      s.ensureStarterTrailerObject();
      near(s.save.homeFirepit.x, at(30,32).x, 'placed without a compass');
      near(s.save.homeFirepit.y, at(30,32).y, 'on the same southern cell');
      const pit = s.save.homeFirepit;
      s._onFirstCompass();
      near(s.save.homeFirepit.x, pit.x, 'a late reading keeps the same cell');
      near(s.save.homeFirepit.y, pit.y);
    });
  });

  test('home footing: compass before Home and compass underground defer placement until ready', () => {
    withTile(tile([]), () => {
      const early=scene({homeCompassDetected:false});early._onFirstCompass();
      const p=at(30,30);early._placeHome(p.x,p.y);
      near(early.save.homeFirepit.y,at(30,32).y,'early reading remembered');
      early._unstampHomeFootprint(); // Independent new save gets a fresh site.
      const late=scene({homeCompassDetected:false});late._placeHome(p.x,p.y);late.depth=1;
      late._onFirstCompass();assert.eq(late.save.homeFirepit,null);
      late.depth=0;late.ensureStarterTrailerObject();
      near(late.save.homeFirepit.y,at(30,32).y,'surface return finishes pending placement');
    });
  });

  test('home footing: no firepit on water or a road — it takes the nearest dry cell', () => {
    const s = scene();
    const e = tile([]);
    e.grid[32 * N + 30] = WorldGen.T.WATER;
    withTile(e, () => {
      const p = at(30, 30);
      s._placeHome(p.x, p.y);
      assert.truthy(s.save.homeFirepit, 'a new game still gets its pit');
      near(s.save.homeFirepit.x, at(30, 31).x, 'not dropped in the pond: a safe inner-ring cell');
      near(s.save.homeFirepit.y, at(30, 31).y, 'the inner fallback still leaves half a cell clear');
      assert.eq(s.save.starterShopId, 'starter_trailer', 'Home is still placed');
    });
  });

  test('home footing: a firepit beside an adopted Home never clears another building', () => {
    const b = { key: 'h_pit', x0: 30, x1: 31, y0: 32, y1: 33 };
    const home = { kind: 'house', id: NORTH.key, ...at(30, 27), tier: 9 };
    const neighbour = { kind: 'house', id: b.key, ...at(30, 32), tier: 9 };
    const e = tile([NORTH, b], [home, neighbour]);
    withTile(e, () => {
      const s = scene(), p = at(30, 30);
      assert.falsy(s._firepitGroundOK(neighbour.x, neighbour.y), 'building cells cannot host a firepit');
      s._placeHome(p.x, p.y);
      assert.eq(cellsOf(e, b.key), 4, 'the neighbouring building keeps every cell');
      assert.truthy(e.objects.includes(neighbour), 'its original object remains');
      if (s.save.homeFirepit) assert.truthy(s._firepitGroundOK(s.save.homeFirepit.x, s.save.homeFirepit.y), 'the pit uses open ground');
    });
  });

  test('home footing: firepit candidates keep off the doorstep and the wagon', () => {
    const { firepit, wagon } = HomeArea.placementOffsets(0);
    const c = HomeArea.firepitCandidates(firepit, wagon);
    assert.eq(JSON.stringify(c[0]), JSON.stringify(firepit), 'the turned default first');
    for (const o of c) {
      assert.truthy(o.dx || o.dy, 'never the player\'s own doorstep cell');
      assert.falsy(Math.abs(o.dx - wagon.dx) <= 1 && Math.abs(o.dy - wagon.dy) <= 1, 'never on the wagon');
    }
    assert.eq(new Set(c.map(o => o.dx + ',' + o.dy)).size, c.length, 'no cell twice');
  });

  test('home footing: every initial heading and fallback keeps the firepit out of the house', () => {
    for (let heading = 0; heading < 360; heading++) {
      const { wagon, firepit } = HomeArea.placementOffsets(heading);
      const candidates = HomeArea.firepitCandidates(firepit, wagon);
      assert.truthy(candidates.length, `${heading}: dry fallback choices remain`);
      assert.truthy(candidates[0].dx === firepit.dx && candidates[0].dy === firepit.dy, `${heading}: the preferred cell first`);
      for (const c of candidates) {
        assert.falsy(HomeArea.inHouse(c.dx - wagon.dx, c.dy - wagon.dy), `${heading}: cell ${c.dx},${c.dy} is in the yard`);
        assert.truthy(c.dx || c.dy, `${heading}: never the player's own cell`);
      }
    }
    const { wagon } = HomeArea.placementOffsets(0);
    assert.falsy(HomeArea.firepitCandidates({ dx: -1, dy: -2 }, wagon)
      .some(c => c.dx === -1 && c.dy === -2), 'a preferred cell inside the house cannot bypass the filter');
  });

  test('home footing: a nearby footprint becomes Home without replacing any building', () => {
    const s = scene();
    const roof = { kind: 'house', id: NORTH.key, ...at(30, 27), tier: 9 };
    const far = { kind: 'house', id: FAR.key, ...at(45, 45), tier: 9 };
    const e = tile([NORTH, FAR], [roof, far]);
    const before = JSON.stringify({ grid: [...e.grid], owners: [...e.owners], shapes: e.buildingShapes });
    withTile(e, () => {
      const p = at(30, 30);
      s._placeHome(p.x, p.y);
      assert.eq(s.save.starterShopId, NORTH.key, 'distance uses the footprint, not its distant anchor');
      assert.falsy(s.save.starterTrailer, 'no replacement house');
      s.ensureStarterTrailerObject();
      assert.eq(JSON.stringify({ grid: [...e.grid], owners: [...e.owners], shapes: e.buildingShapes }), before,
        'all building cells, owners and outlines are unchanged');
      assert.truthy(e.objects.includes(roof) && e.objects.includes(far), 'both original building objects remain');
      const reload = scene(JSON.parse(JSON.stringify(s.save)));
      reload.gpsM = at(45, 45); reload._setStarterCratesAt = () => {};
      reload.ensureStarterShopId = lift('ensureStarterShopId');
      reload.ensureStarterShopId();
      assert.eq(reload.save.starterShopId, NORTH.key, 'reload retains the adopted Home even beside another building');
    });
  });

  test('home footing: spawning inside a large building adopts its entire footprint', () => {
    const large = { key: 'h_large', x0: 20, x1: 35, y0: 20, y1: 35 };
    const home = { kind: 'house', id: large.key, ...at(20, 20), tier: 9 };
    const e = tile([large, NORTH], [home, { kind: 'house', id: NORTH.key, ...at(30, 27), tier: 9 }]);
    withTile(e, () => {
      const s = scene(), p = at(30, 30);
      const count = cellsOf(e, large.key);
      s._placeHome(p.x, p.y);
      assert.eq(s.save.starterShopId, home.id, 'containing building wins despite a distant anchor');
      assert.eq(cellsOf(e, home.id), count, 'the original footprint stays intact');
      assert.falsy(s.save.starterTrailer, 'no synthetic replacement');
      s.playerM = p;
      assert.truthy(s.homeInside(), 'spawn is inside the adopted Home');
    });
  });

  for (const tier of [WorldGen.T.BUILDING, WorldGen.T.BUILDING_LARGE]) {
    test(`home footing: an objectless tier ${tier} footprint survives adoption and reload`, () => {
      const b = { key: `objectless_${tier}`, x0: 25, x1: 35, y0: 25, y1: 35 };
      const makeTile = () => {
        const e = tile([b]);
        for (let i = 0; i < e.grid.length; i++) if (e.owners[i]) e.grid[i] = tier;
        e.baseGrid = e.grid.slice();
        e.buildingShapes[0].tier = tier;
        return e;
      };
      const e = makeTile(), shape = e.buildingShapes[0];
      const snapshot = entry => JSON.stringify({ grid: [...entry.grid], owners: [...entry.owners], shapes: entry.buildingShapes });
      const before = snapshot(e);
      let saved;
      withTile(e, () => {
        const s = scene(), p = at(30, 30);
        assert.truthy(s._placeHome(p.x, p.y), 'placement succeeds inside a source footprint without a sprite');
        assert.eq(s.save.starterShopId, b.key, 'the source footprint becomes Home');
        assert.truthy(s.save.starterTrailer?.adopted, 'the adopted anchor is persisted');
        assert.eq(snapshot(e), before, 'source cells and polygon are untouched');
        assert.truthy(e.buildingShapes.includes(shape), 'the original ring object remains');
        s._unstampHomeFootprint();
        assert.eq(snapshot(e), before, 'moving away cannot erase an adopted source building');
        saved = JSON.parse(JSON.stringify(s.save));
      });
      const rebuilt = makeTile();
      withTile(rebuilt, () => {
        const reload = scene(saved);
        reload.ensureStarterTrailerObject();
        reload.ensureStarterTrailerObject();
        assert.eq(rebuilt.objects.filter(o => o.id === b.key).length, 1, 'reload injects exactly one adopted Home object');
        assert.eq(snapshot(rebuilt), before, 'reload preserves the full source footprint');
        reload.playerM = at(30, 30);
        assert.truthy(reload.homeInside(), 'the source cells still resolve as Home');
        assert.eq(reload.homeInterior()?.ring.length, 4, 'the source ring supplies the interior');
      });
    });
  }

  test('home footing: the three-cell adoption limit includes its boundary', () => {
    const b = { key: 'h_limit', x0: 34, x1: 35, y0: 29, y1: 31 };
    const obj = { kind: 'house', id: b.key, ...at(35, 30), tier: 9 };
    for (const beyond of [false, true]) {
      withTile(tile([b], [obj]), () => {
        const s = scene(), p = { x: 31 * CELL_M - (beyond ? 0.01 : 0), y: at(30, 30).y };
        s._placeHome(p.x, p.y);
        assert.eq(s.save.starterShopId, beyond ? 'starter_trailer' : b.key,
          beyond ? 'farther than three cells creates Home' : 'exactly three cells adopts');
        const e = WorldGen.tileCache.get(KEY);
        assert.eq(cellsOf(e, b.key), 6, 'existing footprint remains');
        if (beyond) assert.eq(cellsOf(e, 'starter_trailer'), 4, 'new Home covers exactly four cells');
      });
    }
  });

  test('initial Home: a road-covered start finds a clear 2x2 site beyond the local search', () => {
    const e = tile([]);
    for (let iy = 24; iy <= 36; iy++) for (let ix = 24; ix <= 36; ix++) {
      e.grid[iy * N + ix] = WorldGen.T.ROAD;
    }
    const roads = e.grid.slice();
    withTile(e, () => {
      const s = scene();
      s.gpsM = at(30, 30); s.playerM = { ...s.gpsM };
      s._deviceCompass = { deg: 0 };
      s._setStarterCratesAt = () => {};
      s.ensureStarterShopId = lift('ensureStarterShopId');
      s.ensureStarterShopId();
      assert.eq(s.save.starterShopId, 'starter_trailer', 'a blocked start still receives Home');
      assert.eq(cellsOf(e, 'starter_trailer'), 4, 'the entire 2x2 footing is stamped');
      for (let i = 0; i < roads.length; i++) if (roads[i] === WorldGen.T.ROAD) {
        assert.eq(e.grid[i], WorldGen.T.ROAD, 'roads survive placement');
      }
      const saved = JSON.stringify(s.save.starterTrailer);
      s.ensureStarterShopId();
      assert.eq(JSON.stringify(s.save.starterTrailer), saved, 'subsequent frames keep the same Home');
    });
  });

  test('home footing: a house that turns up after a rebuild keeps its footprint', () => {
    const s = scene({ starterTrailer: { id: 'starter_trailer', ...at(30, 29), tier: 9, address: 1 },
      starterShopId: 'starter_trailer', homeFirepit: at(29, 31) });
    withTile(tile([]), () => s.ensureStarterTrailerObject());
    // The rebuilt tile is a fresh entry carrying the house on the wagon's cell.
    const real = { kind: 'house', id: 'h_0_0_30_29', ...at(30, 29), tier: 9 };
    const e = tile([{ key: real.id, x0: 30, x1: 31, y0: 29, y1: 29 }], [real]);
    withTile(e, () => {
      s.ensureStarterTrailerObject();
      assert.eq(s.save.starterShopId, 'starter_trailer', 'the trailer stays Home');
      assert.truthy(e.objects.includes(real), 'the original building is retained');
      assert.eq(cellsOf(e, real.id), 2, 'its footprint is never overwritten');
      assert.eq(e.objects.filter(o => o.id === 'starter_trailer').length, 1, 'one wagon');
    });
  });

  test('home footing: a restored house, a castle or a temple is never erased', () => {
    const keep = [
      { key: 'h_0_0_30_27', x0: 30, x1: 30, y0: 27, y1: 28 },
      { key: 'b_31_28', x0: 31, x1: 31, y0: 27, y1: 28 },
      { key: 'tp_0_0_29_28', x0: 29, x1: 29, y0: 27, y1: 28 },
    ];
    const s = scene({ restoredHouses: { h_0_0_30_27: 'plain' } });
    const e = tile(keep);
    withTile(e, () => {
      const p = at(30, 30);
      assert.eq(s._homeFootingAt(p.x, p.y)?.house, keep[0].key, 'Move Home adopts the nearest existing footprint');
      s._placeHome(p.x, p.y);
      for (const b of keep) assert.eq(cellsOf(e, b.key), 2, `${b.key} keeps its footprint`);
    });
  });

  test('home footing: an adopted Home from an older save keeps its footprint — its house is drawn from it', () => {
    const home = { kind: 'house', id: 'h_0_0_20_20', ...at(20, 20), tier: 9 };
    const s = scene({ starterTrailer: null, starterShopId: home.id });
    const e = tile([{ key: home.id, x0: 19, x1: 21, y0: 19, y1: 21 }], [home]);
    withTile(e, () => {
      s.ensureStarterTrailerObject();
      assert.eq(cellsOf(e, home.id), 9, 'its cells stay');
      assert.truthy(e.buildingShapes.some(sh => sh.key === home.id), 'and its ring');
      assert.truthy(e.objects.includes(home), 'Home itself stays');
      s.playerM = at(20, 20); s.startWorldM = { x: 0, y: 0 };
      assert.truthy(s.homeInside(), 'standing on it is being inside');
    });
  });

  test('home footing: inside is standing on one of the house\'s cells; the interior hands over its ring', () => {
    const s = scene({ starterTrailer: { id: 'starter_trailer', ...at(30, 29), tier: 9, address: 1, door: 'S' },
      starterShopId: 'starter_trailer' });
    s.startWorldM = { x: 0, y: 0 };
    const e = tile([]);
    withTile(e, () => {
      s.ensureStarterTrailerObject();
      const inside = [[30, 29], [29, 28], [29, 29]], outside = [[30, 30], [28, 29], [31, 28], [30, 27]];
      for (const [ix, iy] of inside) { s.playerM = at(ix, iy); assert.truthy(s.homeInside(), `(${ix},${iy}) is inside`); }
      for (const [ix, iy] of outside) { s.playerM = at(ix, iy); assert.falsy(s.homeInside(), `(${ix},${iy}) is outside`); }
      s.playerM = at(30, 29);
      const room = s.homeInterior();
      assert.eq(room.ring.length, 4, 'the ring, in world metres');
      near(room.ring[0].x, 29 * CELL_M, 'NW x'); near(room.ring[2].y, 30 * CELL_M, 'SE y');
      assert.truthy(room.key.startsWith('starter_trailer@'), 'keyed by Home and its position');
      s.playerM = at(30, 31);
      assert.eq(s.homeInterior(), null, 'no interior outside');
      s.depth = 1; s.playerM = at(30, 30);
      assert.falsy(s.homeInside(), 'the house has no cellar');
      s.depth = 0;
    });
  });

  test('home footing: moving Home lifts the old footprint and leaves no shadow', () => {
    const s = scene({ starterTrailer: { id: 'starter_trailer', ...at(30, 29), tier: 9, address: 1, door: 'S' },
      starterShopId: 'starter_trailer' });
    const e = tile([]);
    withTile(e, () => {
      s.ensureStarterTrailerObject();
      assert.eq(cellsOf(e, 'starter_trailer'), 4);
      s._unstampHomeFootprint();
      assert.eq(cellsOf(e, 'starter_trailer'), 0, 'the cells are ground again');
      assert.eq(e.grid[29 * N + 30], WorldGen.T.RESIDENTIAL, 'the ground round it');
      assert.falsy(e.buildingShapes.some(sh => sh.key === 'starter_trailer'), 'no ring');
      assert.falsy((e.clearedShapes || []).some(sh => sh.key === 'starter_trailer'), 'and no cleared shadow');
      assert.eq(e._homeHouse, null, 'the entry forgets the stamp');
      // Placed again elsewhere, the new footprint goes down.
      const p = at(40, 40);
      s._placeHome(p.x, p.y);
      assert.eq(cellsOf(e, 'starter_trailer'), 4, 'stamped at the new spot');
      assert.truthy(e.ownerKeys[e.owners[39 * N + 40]] === 'starter_trailer', 'centred on the new wagon cell');
    });
  });

  test('home footing: clutter on the footing and the firepit cell is swept; saved things stay', () => {
    const s = scene({ starterTrailer: { id: 'starter_trailer', ...at(30, 29), tier: 9, address: 1 },
      starterShopId: 'starter_trailer', homeFirepit: at(29, 31),
      fruittrees: [{ id: 'saved_tree', ...at(31, 29) }] });
    const saved = { kind: 'tree', id: 'saved_tree', ...at(31, 29) };
    const planted = { kind: 'tree', id: 'planted_tree', planted: true, ...at(29, 29) };
    const onPit = { kind: 'mineralrock', id: 'pit_rock', ...at(29, 31) };
    const loose = { kind: 'mineralrock', id: 'moat_rock', ...at(30, 30) };
    const beyond = { kind: 'mineralrock', id: 'far_rock', ...at(33, 33) };
    const e = tile([], [saved, planted, onPit, loose, beyond]);
    withTile(e, () => {
      s.ensureStarterTrailerObject();
      assert.truthy(e.objects.includes(saved) && e.objects.includes(planted), 'owned objects survive');
      assert.falsy(e.objects.includes(onPit), 'nothing sits in the firepit');
      assert.falsy(e.objects.includes(loose), 'nothing sits on the doorstep');
      assert.truthy(e.objects.includes(beyond), 'past the footing is left alone');
    });
  });

  test('move home: nearby buildings are identified without clearing them; open ground is free', () => {
    const s = scene({ starterShopId: 'starter_trailer' });
    withTile(tile([NORTH], [{ kind: 'house', id: NORTH.key, ...at(30, 27), tier: 9 }]), () => {
      assert.eq(s._homeFootingAt(at(30, 30).x, at(30, 30).y)?.house, NORTH.key, 'the house north of the player');
      assert.eq(s._homeFootingAt(at(10, 10).x, at(10, 10).y), null, 'open ground');
    });
  });

  test('move home: preflight accepts an alternative clear site beside a blocked preferred site', () => {
    const e = tile([]), s = scene(), p = at(30, 30);
    e.grid[29 * N + 30] = WorldGen.T.WATER;
    withTile(e, () => {
      assert.falsy(s._homeSiteClear(at(30, 29).x, at(30, 29).y), 'preferred house location is blocked');
      assert.eq(s._homeFootingAt(p.x, p.y), null, 'another nearby clear 2x2 site permits the move');
      assert.truthy(s._placeHome(p.x, p.y), 'placement agrees with preflight');
      assert.eq(cellsOf(e, 'starter_trailer'), 4, 'the alternative site receives all four cells');
      assert.eq(e.grid[29 * N + 30], WorldGen.T.WATER, 'the blocked cell remains water');
    });
  });

  test('move home: a failed placement leaves the previous Home intact', () => {
    const e = tile([]), s = scene();
    withTile(e, () => {
      const p = at(15, 15);
      s._placeHome(p.x, p.y);
      const before = JSON.stringify(s.save), house = e.objects.find(o => o.id === 'starter_trailer');
      for (let y = 34; y <= 44; y++) for (let x = 35; x <= 44; x++) e.grid[y * N + x] = WorldGen.T.WATER;
      s.playerM = at(40, 40);
      assert.eq(s.moveHomeTrailerHere(), false, 'an impossible move reports failure');
      assert.eq(JSON.stringify(s.save), before, 'the saved Home and firepit do not change');
      assert.truthy(e.objects.includes(house), 'the old Home object remains');
      assert.eq(cellsOf(e, 'starter_trailer'), 4, 'the old footprint remains');
    });
  });

  test('home footing: the starter passes keep clear of the wagon and the firepit', () => {
    const w = HomeArea.WAGON_OFFSET, p = HomeArea.FIREPIT_OFFSET;
    assert.truthy(HomeArea.inFooting(w.dx, w.dy - 1), 'the wagon\'s top row');
    assert.truthy(HomeArea.inFooting(0, 0), 'the doorstep');
    assert.truthy(HomeArea.inFooting(p.dx, p.dy), 'the firepit');
    assert.falsy(HomeArea.inFooting(2, 0), 'two cells out is free');
    assert.falsy(HomeArea.inFooting(0, 3), 'the cell beyond the firepit is free');
  });

  // "Move Home here" onto a real house's cell crashed when the inject adopted
  // the house and the caller read save.starterTrailer.id back. One placer now
  // makes the trailer, and nothing reads the record back after it.
  test('home footing: one placer makes the trailer, and nothing reads the record back', () => {
    let i = 0, calls = 0;
    while ((i = SCENE_SRC.indexOf('this._makeStarterTrailer(', i)) >= 0) {
      const after = SCENE_SRC.slice(i, SCENE_SRC.indexOf('\n  }\n', i));
      assert.falsy(/save\.starterTrailer\.id/.test(after), 'a caller reads save.starterTrailer.id after making it');
      i++; calls++;
    }
    assert.eq(calls, 1, '_placeHome');
    assert.eq((SCENE_SRC.match(/this\._placeHome\(/g) || []).length, 2, 'the starter placement and Move Home here');
  });

  // The opening shot: zoomed on Home while it is placed or a dialog is up,
  // a held beat once the map is clear, then a slow pull back to exactly 1×.
  test('home intro: waits close on Home, holds, then eases out to the normal view', () => {
    const I = HomeArea.INTRO;
    let dialog = true;
    const s = Object.assign(scene(), {
      peekM: { x: 0, y: 0 }, mapZoom: 1,
      _dialogOpen: () => dialog, isPeeking() { return this.peekM.x !== 0 || this.peekM.y !== 0; },
      _armHomeIntro: liftSceneMethod('_armHomeIntro'),
      _tickHomeIntro: liftSceneMethod('_tickHomeIntro'),
    });
    s._armHomeIntro();
    const zIn = 11 / I.viewCells;
    near(s.mapZoom, zIn, 'opens zoomed in');
    near(s.peekM.y, I.focus.dy * CELL_M, 'framed above the player: the wagon above, the player below');
    near(s.peekM.x, I.focus.dx * CELL_M, 'and toward the wagon\'s middle');
    s._tickHomeIntro(5);
    near(s.mapZoom, zIn, 'no Home yet: still waiting');
    s.save.starterShopId = 'starter_trailer';
    s._tickHomeIntro(5);
    near(s.mapZoom, zIn, 'a dialog covers the map: still waiting');
    dialog = false;
    s._tickHomeIntro(0);
    s._tickHomeIntro(I.holdMs / 1000 * 0.9);
    near(s.mapZoom, zIn, 'holds a beat');
    s._tickHomeIntro(I.holdMs / 1000 * 0.2);
    s._tickHomeIntro(I.outMs / 2000);
    assert.truthy(s.mapZoom > 1 && s.mapZoom < zIn, 'pulling back');
    s._tickHomeIntro(I.outMs / 1000);
    assert.eq(s.mapZoom, 1, 'ends at exactly 1×');
    assert.eq(s.peekM.y, 0, 'and on the player');
    assert.eq(s.peekM.x, 0, 'exactly');
    assert.eq(s._homeIntro, null, 'and stops');
  });

  test('home intro: a finger on the map takes the camera', () => {
    const s = Object.assign(scene({ starterShopId: 'starter_trailer' }), {
      peekM: { x: 0, y: 0 }, mapZoom: 1, _dialogOpen: () => false,
      isPeeking() { return this.peekM.x !== 0 || this.peekM.y !== 0; },
      _armHomeIntro: liftSceneMethod('_armHomeIntro'),
      _tickHomeIntro: liftSceneMethod('_tickHomeIntro'),
    });
    s._armHomeIntro();
    s._pinch = { a: 1, b: 2 };
    s._tickHomeIntro(0.1);
    assert.eq(s._homeIntro, null, 'the intro ends');
    assert.truthy(s._mapZoomReturning && s._peekReturning, 'and the camera springs home');
  });
})();
