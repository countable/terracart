// A tap on the drawn crown of a tall prop lands on the bare cell screen-north
// of its feet. Render.tallPropHit names the prop drawn there; the 'object'
// handler takes it only when the tapped cell holds nothing of its own.
(() => {
  // 5 m cells, 32 to a tile, origin at the frame's zero: cell (ix, iy) is
  // centred on ((ix + .5) * 5, (iy + .5) * 5) metres.
  const geometry = {
    cellM: 5, cellsPerTile: 32, tileEdgeM: 160, mPerPx: 5 / (WorldGen.TILE_PX / 32),
    originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
  };
  const centre = (ix, iy) => ({ x: (ix + .5) * 5, y: (iy + .5) * 5 });
  // A pooled sprite of a 16x40 frame drawn at 1.6 about (100, 100): art box
  // x 87..113, y 68..132. No ART_BOUNDS row for the test key, so the frame is the art.
  const sprite = (object, over = {}) => ({
    visible: true, alpha: 1, x: 100, y: 100, originX: .5, originY: .5, scaleX: 1.6, scaleY: 1.6,
    frame: { realWidth: 16, realHeight: 40 }, _staticObject: object,
    _staticAppearance: { spec: {}, texKey: 'tall_prop_tap_test', frameVal: 0, visible: true }, ...over,
  });
  const sign = { kind: 'roadsign', id: 'sign', ...centre(10, 11), directions: [{ direction: 'North', title: 'Hill Road' }] };

  test('tall prop tap: the drawn crown over a neighbouring cell names its prop', () => {
    const scene = { ...geometry, objectPool: [sprite(sign)] };
    assert.eq(Render.tallPropHit(scene, 100, 80, centre(10, 10)), sign, 'inside the art, from the cell above');
    assert.eq(Render.tallPropHit(scene, 100, 80, centre(11, 10)), sign, 'a diagonal neighbour counts under a turned map');
    assert.eq(Render.tallPropHit(scene, 100, 80, centre(10, 11)), null, 'its own cell is the ordinary cell hit');
    assert.eq(Render.tallPropHit(scene, 100, 80, centre(10, 9)), null, 'two cells away is never a crown');
    assert.eq(Render.tallPropHit(scene, 130, 80, centre(10, 10)), null, 'outside the drawn art');
    assert.eq(Render.tallPropHit({ ...geometry, objectPool: [sprite(sign, { visible: false })] }, 100, 80, centre(10, 10)), null, 'hidden sprites do not answer');
    assert.eq(Render.tallPropHit({ ...geometry, objectPool: [sprite({ ...sign, kind: 'house' })] }, 100, 80, centre(10, 10)), null, 'buildings keep Render.buildingHit');
    assert.eq(Render.tallPropHit({ ...geometry }, 100, 80, centre(10, 10)), null, 'no pool, no hit');
  });

  test('tall prop tap: a retained fingerpost answers for its drawn triangles and the frontmost crown wins', () => {
    // A mesh sign's triangles live in its group's space; the group scrolls by (10, 0).
    const tri = (x, y) => [{ x: x - 5, y: y + 10 }, { x: x + 5, y: y + 10 }, { x, y: y - 10 }];
    const mesh = (o, x, y, visible = true) => ({ o, blocks: [{ support: { x, y }, materialFaces: [{ visible, projected: tri(x, y) }] }] });
    const meshScene = (meshes, over = {}) => ({ ...geometry, _wallPerspective: { roadSigns: { gfx: { visible: true }, x: 10, y: 0 } }, _roadSignMeshes: meshes, ...over });
    assert.eq(Render.tallPropHit(meshScene([mesh(sign, 90, 100)]), 100, 95, centre(10, 10)), sign, 'inside a visible triangle, offset by the group scroll');
    assert.eq(Render.tallPropHit(meshScene([mesh(sign, 90, 100)]), 100, 95, centre(10, 11)), null, 'its own cell is the ordinary cell hit');
    assert.eq(Render.tallPropHit(meshScene([mesh(sign, 90, 100)]), 120, 95, centre(10, 10)), null, 'outside the triangles');
    assert.eq(Render.tallPropHit(meshScene([mesh(sign, 90, 100, false)]), 100, 95, centre(10, 10)), null, 'a culled face is not drawn');
    assert.eq(Render.tallPropHit(meshScene([mesh(sign, 90, 100)], { _wallPerspective: { roadSigns: { gfx: { visible: false }, x: 10, y: 0 } } }), 100, 95, centre(10, 10)), null, 'nor a hidden group');
    const back = { kind: 'tree', id: 'back', ...centre(10, 11) }, front = { kind: 'tree', id: 'front', ...centre(11, 11) };
    const pool = [sprite(front, { y: 101 }), sprite(back)];
    assert.eq(Render.tallPropHit({ ...geometry, objectPool: pool }, 100, 80, centre(10, 10)), front);
    assert.eq(Render.tallPropHit({ ...geometry, objectPool: pool.slice().reverse() }, 100, 80, centre(10, 10)), front, 'regardless of pool order');
    assert.eq(Render.tallPropHit(meshScene([mesh(sign, 90, 100)], { objectPool: pool }), 100, 95, centre(10, 10)), front, 'a sprite standing lower on screen is in front of the sign');
    assert.eq(Render.tallPropHit(meshScene([mesh(sign, 90, 102)], { objectPool: pool }), 100, 95, centre(10, 10)), sign, 'and the sign in front when its foot is');
  });

  test('tall prop tap: heading-up turns the point back about the ground anchor', () => {
    const scene = { ...geometry, mapRot: Math.PI / 2, objectPool: [sprite(sign, { _huAnchor: { x: 100, y: 100 } })] };
    // Screen-right of the anchor is the art's screen-down once turned back.
    assert.eq(Render.tallPropHit(scene, 120, 100, centre(10, 10)), sign);
    assert.eq(Render.tallPropHit({ ...scene, mapRot: 0 }, 120, 100, centre(10, 10)), null, 'the same point misses north-up');
  });

  test('tall prop tap: the object handler takes the crown only for a bare cell', () => {
    const handler = TAP_HANDLERS.find(h => h.name === 'object');
    const prior = [...WorldGen.tileCache.entries()];
    const other = { kind: 'roadsign', id: 'other', ...centre(10, 10), directions: [{ direction: 'East', title: 'Mill Lane' }] };
    const run = (objects, spill) => {
      WorldGen.tileCache.clear();
      WorldGen.tileCache.set('tall-prop-test', { objects, wildplants: [] });
      const shown = [];
      const scene = makeScene({ ...geometry, depth: 0, playerM: centre(10, 10), gpsM: centre(10, 10),
        showMessageModal: m => shown.push(m.body) });
      const ctx = Object.assign(makeCtx(scene, { energy: 100 }), { wm: centre(10, 10), spill });
      scene.save = ctx.save;
      return { consumed: handler.try(ctx), shown };
    };
    try {
      let r = run([sign], sign);
      assert.eq(r.consumed, true, 'the crown of the sign below answers a tap on the bare cell');
      assert.eq(r.shown.join('|'), 'North: Hill Road');
      r = run([sign], null);
      assert.eq(r.consumed, false, 'with nothing drawn over the bare cell the tap falls through');
      r = run([sign, other], sign);
      assert.eq(r.shown.join('|'), 'East: Mill Lane', 'an occupied cell keeps its own occupant');
    } finally {
      WorldGen.tileCache.clear();
      for (const [key, entry] of prior) WorldGen.tileCache.set(key, entry);
    }
  });
})();
