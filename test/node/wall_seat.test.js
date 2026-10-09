// SEATED AGAINST AN ANGLED WALL (render.js Render.seatAgainstWalls): a long
// angled wall is cut into pieces sorted by their own low ends, so a wide
// booth / Home, or a player, standing in front of the wall where it stands
// could lose to a neighbouring piece further south (and the reverse behind).
// They are now judged against each overlapping piece's base line at their own x.
(function () {
  // A wall slanting south-east: base line y = x / 2 (world m), cut into 2 m
  // pieces, each seated at its low (east) end as building_overlay does.
  const line = { x0: 0, y0: 0, x1: 10, y1: 5 };
  const walls = [0, 1, 2, 3, 4].map(i => ({ groundY: i + 1, base: { ...line, wx0: 2 * i, wx1: 2 * i + 2 } }));
  const sorted = (rows) => { const all = [...rows, ...walls]; Render.sortWorldDepth(all); return all; };

  test('wall seat: in front of the wall where it stands, a wide booth draws over every piece it overlaps', () => {
    const booth = { groundY: 1.4, wallSeat: { x: 2.5, halfW: 1.5 } };   // the line is at 1.25 here
    const naive = sorted([{ ...booth, wallSeat: null }]);
    assert.lt(naive.findIndex(r => r.groundY === 1.4), naive.indexOf(walls[2]), 'the bug: piece 2 covered it');
    Render.seatAgainstWalls([booth], walls, 6);
    const all = sorted([booth]);
    for (const w of walls.slice(0, 3)) assert.gt(all.indexOf(booth), all.indexOf(w), 'in front of each overlapping piece');
    assert.lt(all.indexOf(booth), all.indexOf(walls[3]), 'pieces it does not overlap keep their order');
  });

  test('wall seat: behind the wall where it stands, it stays behind every piece it overlaps', () => {
    const player = { groundY: 3.2, wallSeat: { x: 7, halfW: 1.5 } };   // the line is at 3.5 here
    Render.seatAgainstWalls([player], walls, 6);
    const all = sorted([player]);
    for (const w of walls.slice(2, 5)) assert.lt(all.indexOf(player), all.indexOf(w), 'hidden by each overlapping piece');
  });

  test('wall seat: unmarked rows, side edges and far pieces are untouched', () => {
    const tree = { groundY: 1.4 };
    Render.seatAgainstWalls([tree], walls, 6);
    assert.eq(tree.groundY, 1.4, 'only booths, Home and players are seated');
    const side = [{ groundY: 9, base: { x0: 3, y0: 0, x1: 3, y1: 9, wx0: 2.5, wx1: 3.5 } }];
    const a = { groundY: 2, wallSeat: { x: 3, halfW: 1 } };
    Render.seatAgainstWalls([a], side, 20);
    assert.eq(a.groundY, 2, 'a north–south edge keeps its own foot');
    const b = { groundY: 1.4, wallSeat: { x: 2.5, halfW: 1.5 } };
    Render.seatAgainstWalls([b], walls, 0.1);
    assert.eq(b.groundY, 1.4, 'beyond reach: no screen overlap to settle');
  });

  test('wall seat: booths, Home and players are the rows marked; wall pieces carry their base line', () => {
    assert.truthy(/chestLook\(it\.o\)\.macro/.test(RENDER_SRC) && /it\.o\.id === homeId/.test(RENDER_SRC), 'booths and Home');
    assert.truthy(/wallSeat: \{ x: playerWorldM\(scene\)\.x, halfW: scene\.cellM \/ 2 \}/.test(RENDER_SRC), 'the player');
    assert.truthy(/Render\.seatAgainstWalls\(zList, scene\._buildingUprightPieces/.test(RENDER_SRC), 'run before the sort');
    assert.truthy(RENDER_SRC.indexOf('Render.seatAgainstWalls(zList') < RENDER_SRC.indexOf('Render.sortWorldDepth(zList)'));
  });
})();
