(() => {
  const l = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 20 },
    { x: 20, y: 20 }, { x: 20, y: 60 }, { x: 0, y: 60 }];
  const triangleArea = p => Math.abs(p.reduce((a, v, i) => {
    const q = p[(i + 1) % p.length]; return a + v.x * q.y - q.x * v.y;
  }, 0)) / 2;
  test('building styles: concave caps preserve footprint area and open notch', () => {
    const mesh = BuildingStyles.build(l, 'adobe');
    const caps = mesh.prisms.filter(p => p.capped && p.top === 10);
    const roof = caps.slice(0, l.length - 2);
    assert.eq(roof.reduce((n, p) => n + triangleArea(p.points), 0), 2000);
    for (const cap of mesh.prisms.filter(p => p.capped)) {
      assert.eq(cap.points.length, 3, 'retained cap uses triangles, never a concave fan');
      const x = cap.points.reduce((n, p) => n + p.x, 0) / 3;
      const y = cap.points.reduce((n, p) => n + p.y, 0) / 3;
      assert.falsy(x > 20 && y > 20, 'no triangle covers the L-shaped notch');
    }
  });
  test('building styles: narrow inset terminates before edge inversion', () => {
    assert.truthy(BuildingStyles.inset(l, 3));
    assert.eq(BuildingStyles.inset(l, 12), null);
    const narrow = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 3 }, { x: 0, y: 3 }];
    for (const id of Object.keys(BuildingStyles.STYLES)) {
      const geometry = BuildingStyles.build(narrow, id);
      assert.gt(geometry.prisms.length, 0);
      for (const prism of geometry.prisms) for (const p of prism.points) {
        assert.truthy(Number.isFinite(p.x) && Number.isFinite(p.y));
      }
    }
  });
  test('building styles: pyramid and Japanese roofs retain sloping geometry', () => {
    for (const id of ['pyramid', 'japanese']) {
      const mesh = BuildingStyles.build(l, id);
      const slopes = mesh.prisms.filter(p => p.topPoints);
      assert.gt(slopes.length, 0);
      for (const p of slopes) {
        assert.eq(p.points.length, p.topPoints.length);
        assert.gt(p.top, p.bottom);
        assert.truthy(p.allFaces, 'rear roof slope remains visible from above');
        assert.falsy(p.capped, 'caps tessellated separately');
      }
    }
  });
  test('building styles: repeated floors and low open wrecks retain distinct heights', () => {
    assert.gt(BuildingStyles.build(l, 'multistorey').height, BuildingStyles.build(l, 'adobe').height);
    const wreck = BuildingStyles.build(l, 'ruin');
    assert.lte(wreck.height, 4);
    assert.lt(wreck.prisms.filter(p => p.capped).reduce((a, p) => a + triangleArea(p.points), 0), 600, 'wreck floor is open');
  });
  test('building styles: delivery houses have one floor in both renderers', () => {
    const house = BuildingLowPoly.recipeFor('plain');
    assert.eq(house.stories, 1);
    assert.eq(BuildingLowPoly.recipeFor('shop').stories, 2, 'specialised shop keeps its upper floor');
    const one = BuildingStyles.build(l, house.style, { stories: house.stories });
    const two = BuildingStyles.build(l, house.style, { stories: 2 });
    assert.lt(one.height, two.height * 0.6, 'fallback removes the upper storey');
    assert.truthy(one.prisms.every(p => p.top <= one.height));
  });
  test('building styles: winding and duplicate close do not change generated area', () => {
    const first = BuildingStyles.build(l, 'pyramid');
    const reverse = BuildingStyles.build([...l].reverse().concat(l.at(-1)), 'pyramid');
    assert.eq(first.prisms.length, reverse.prisms.length);
    assert.eq(first.height, reverse.height);
    assert.eq(BuildingStyles.build([{ x: NaN, y: 0 }], 'adobe').prisms.length, 0);
    assert.eq(BuildingStyles.build([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }]).prisms.length, 0);
  });
})();

(() => {
  function scene() {
    const gfx = { clear() {}, fillStyle() {}, fillTriangle() {}, setPosition() {} };
    return { _headingUp: false, depth: 0, mapRot: 0, buildingWallContainer: { add() {} }, add: { graphics: () => gfx } };
  }
  test('building styles: retained slopes project vertical elevation at every compass octant', () => {
    const s = scene();
    const ring = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 40 }, { x: 0, y: 40 }];
    const group = WallPerspective.begin(s, 'polygon');
    BuildingStyles.emit(s, 'polygon', ring, 'japanese');
    const slope = group.blocks.find(b => b.allFaces), vertices = slope.projected;
    WallPerspective.finish(s, 'polygon');
    assert.truthy(group.gfx.visible, 'procedural architecture also draws north-up');
    for (let step = 0; step < 8; step++) {
      s.mapRot = step * Math.PI / 4; WallPerspective.update(s);
      const sin = Math.sin(s.mapRot), cos = Math.cos(s.mapRot);
      for (let i = 0; i < slope.points.length; i++) {
        const dx = vertices[i * 4 + 2] - slope.topPoints[i].x;
        const dy = vertices[i * 4 + 3] - slope.topPoints[i].y;
        assert.lt(Math.abs(cos * dx - sin * dy), 1e-8, 'raised roof vertex shares ground screen X');
        assert.lt(Math.abs(sin * dx + cos * dy + slope.top), 1e-8, 'elevation stays screen up');
      }
      assert.eq(slope.projected, vertices, 'heading reuses vertex buffer');
    }
    WallPerspective.clear(s, 'polygon'); WallPerspective.update(s);
    assert.falsy(group.gfx.visible, 'legacy north-up restores normal wall visibility');
  });
})();

test('building styles: flat roof material follows concave footprint and stays bounded', () => {
  const p = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 1000 }, { x: 0, y: 1000 }];
  const marks = BuildingStyles.build(p, 'whitewash').prisms.filter(v => v.top > 11 && v.top < 11.1);
  assert.gt(marks.length, 0);
  assert.lte(marks.length, 80, 'fixed detail budget independent of footprint area');
  for (const mark of marks) for (const v of mark.points) assert.falsy(v.x > 30 && v.y > 30, 'material does not bridge notch');
  const shifted = BuildingStyles.build(p.map(v => ({ x: v.x + 17, y: v.y - 37 })), 'whitewash').prisms.filter(v => v.top > 11 && v.top < 11.1);
  assert.eq(shifted.length, marks.length);
  for (let i = 0; i < marks.length; i++) for (let j = 0; j < marks[i].points.length; j++) {
    assert.lt(Math.abs(shifted[i].points[j].x - marks[i].points[j].x - 17), 1e-8);
    assert.lt(Math.abs(shifted[i].points[j].y - marks[i].points[j].y + 37), 1e-8);
  }
});
