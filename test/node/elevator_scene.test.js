(function () {
  const lift = signature => {
    const start = SCENE_SRC.indexOf('\n  ' + signature);
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    if (start < 0 || end < 0) throw new Error(`Missing elevator method: ${signature}`);
    return SCENE_SRC.slice(start + 1, end + 4);
  };
  const makeMethods = new Function('Elevators', 'HomeArea', 'document',
    `return { ${lift('openElevator(stair) {')} };`);
  function picker(depth, unlocked) {
    const buttons = [];
    const anchor = { x: 10, y: 20 }, home = { x: 80, y: 90 };
    const methods = makeMethods({ unlockedFloors: () => unlocked }, { worldM: anchor },
      { createElement: () => ({}) });
    const trips = [];
    const scene = Object.assign({ depth, save: {},
      _elevatorHomePosition: () => home,
      changeDepth: (delta, position) => trips.push({ delta, position }),
      makeModalShell: () => ({ wrap: { remove() {} }, box: { appendChild() {} }, mount() {},
        mkBtn(label) {
          const button = { label, style: {}, addEventListener: (event, callback) => { button.click = () => callback({ stopPropagation() {} }); } };
          buttons.push(button);
          return button;
        } }),
    }, methods);
    scene.openElevator({ x: 0, y: 0 });
    return { buttons, trips, scene, anchor, home };
  }
  test('elevator: locked cave floors always offer a direct trip Home', () => {
    const p = picker(6, []);
    assert.eq(p.buttons.map(b => b.label).join(','), 'Home,Cancel');
    p.buttons[0].click();
    assert.eq(p.trips[0].delta, -6);
    assert.eq(p.trips[0].position, p.home);
  });
  test('elevator: picks all unlocked floors, excluding the current floor', () => {
    const p = picker(3, [1, 3, 7]);
    assert.eq(p.buttons.map(b => b.label).join(','), 'Home,Floor 1,Floor 7,Cancel');
    p.buttons[2].click();
    assert.eq(p.trips[0].delta, 4);
    assert.eq(p.trips[0].position, p.anchor);
  });
  test('elevator: surface offers unlocked floors and passes descent through changeDepth', () => {
    const p = picker(0, [2, 4]);
    assert.eq(p.buttons.map(b => b.label).join(','), 'Floor 2,Floor 4,Cancel');
    p.buttons[1].click();
    assert.eq(p.trips[0].delta, 4);
    assert.eq(p.trips[0].position, p.anchor);
  });
  test('elevator: stale selections recheck unlock and departure floor', () => {
    const floors = [2];
    const p = picker(0, floors);
    floors.length = 0;
    p.buttons[0].click();
    assert.eq(p.trips.length, 0);
    floors.push(2);
    p.scene.depth = 1;
    p.buttons[0].click();
    assert.eq(p.trips.length, 0);
  });
  test('elevator: surface seat survives rebuilds, respects owned cells and follows Home', () => {
    const cell = (scene, x, y) => ({ cellIX: Math.floor(x), cellIY: Math.floor(y) });
    const toTile = (scene, x, y) => ({ tx: 0, ty: 0, ix: x, iy: y });
    const point = (scene, x, y) => ({ x: x + 0.5, y: y + 0.5 });
    const offset = (scene, x, y, dx, dy) => ({ cellIX: x + dx, cellIY: y + dy });
    const fresh = () => ({ _spawned: true, grid: new Array(400).fill(0), cellsPerEdge: 20, objects: [] });
    let entry = fresh();
    const cache = new Map([['home', entry]]);
    const world = { tileCache: cache, tileKey: () => 'home', isSpawnCell: () => true };
    const ownership = {
      savedIds: () => new Set(), isProtected: object => !!object.playerOwned,
      footprintCells: (scene, object) => [cell(scene, object.x, object.y)],
      reconcileEntry(scene, e, claims) {
        e.objects = e.objects.filter(o => o.playerOwned || !claims.some(c => Math.floor(c.x) === Math.floor(o.x) && Math.floor(c.y) === Math.floor(o.y)));
      },
    };
    const makePlacement = new Function('Elevators', 'WorldGen', 'SpawnOwnership', 'PlacedFloor',
      'worldMetersToTile', 'worldMetersToAbsCell', 'absCellToTile', 'absCellCenterMeters', 'absCellOffset', 'persistSave',
      `return { ${lift('ensureHomeElevatorObject() {')} };`);
    const unlocked = [];
    const scene = Object.assign({ depth: 0, save: { starterShopId: 'home', planted: [] },
      home: { x: 10.5, y: 10.5 }, _elevatorHomePosition() { return this.home; },
    }, makePlacement({ unlockedFloors: () => unlocked }, world, ownership,
      { onDepth: () => true }, toTile, cell, toTile, point, offset, () => {}));
    scene.ensureHomeElevatorObject();
    assert.eq(entry.objects.length, 0, 'no surface elevator until a floor unlocks');
    unlocked.push(1);
    scene.save.planted.push({ x: 8.5, y: 8.5 });
    scene.ensureHomeElevatorObject();
    const first = scene.save.homeElevator;
    assert.eq(first.x, 9.5, 'the first ring cell belongs to a crop');
    assert.eq(first.y, 8.5);
    assert.eq(entry.objects[0].kind, 'staircase');
    assert.truthy(entry.objects[0].elevator);
    entry = fresh();
    entry.objects.push({ id: 'generated', x: first.x, y: first.y });
    cache.set('home', entry);
    scene.ensureHomeElevatorObject();
    assert.eq(scene.save.homeElevator.x, first.x, 'a tile rebuild retains the saved seat');
    assert.eq(entry.objects.length, 1, 'saved elevator replaces regenerated fill');
    scene.home = { x: 15.5, y: 15.5 };
    scene.ensureHomeElevatorObject();
    assert.eq(scene.save.homeElevator.x, 13.5);
    assert.eq(entry.objects.length, 1, 'moving Home removes the old elevator');
  });
})();
