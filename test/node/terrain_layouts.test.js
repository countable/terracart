// Promoted terrain geometry stays shared between the lab and live zone dressing.
(function () {
  const grove = { layout: 'hilbert', width: 33, height: 33, seed: 2718,
    order: 4, skip: [40, 0, 0], bias: 0, side: 2, inverted: true };
  const key = p => `${p.cx},${p.cy}`;
  const keys = points => points.map(key).sort().join('|');
  const slots = [{ material: 'giant_mushroom', share: 50 }, { material: 'mushroom', share: 50 }];

  test('terrain Hilbert: irregular grids retain one non-touching connected path', () => {
    for (const [width, height, order] of [[33, 33, 4], [30, 30, 5], [19, 27, 5]]) {
      for (const bias of [0, 1, 2]) {
        const options = { ...grove, width, height, order, bias };
        const path = TerrainLayouts.path(options), occupied = new Set(path.map(key));
        assert.gt(path.length, 2);
        assert.eq(occupied.size, path.length, 'each path cell occurs once');
        assert.eq(JSON.stringify(TerrainLayouts.path(options)), JSON.stringify(path), 'seeded route');
        path.forEach((p, i) => {
          assert.truthy(Number.isInteger(p.cx) && Number.isInteger(p.cy));
          assert.inRange(p.cx, 1, width - 2); assert.inRange(p.cy, 1, height - 2);
          const degree = [[1, 0], [-1, 0], [0, 1], [0, -1]]
            .filter(([dx, dy]) => occupied.has(`${p.cx + dx},${p.cy + dy}`)).length;
          assert.eq(degree, i === 0 || i === path.length - 1 ? 1 : 2, 'no adjacent facing folds');
          if (i) assert.eq(Math.abs(p.cx - path[i - 1].cx) + Math.abs(p.cy - path[i - 1].cy), 1, 'continuous route');
        });
      }
    }
  });

  test('terrain Hilbert: bias cannot change a fully rendered curve without skips', () => {
    const options = { ...grove, skip: [0, 0, 0], side: 0, inverted: false };
    const neutral = JSON.stringify(TerrainLayouts.path(options));
    for (const bias of [1, 2]) assert.eq(JSON.stringify(TerrainLayouts.path({ ...options, bias })), neutral);
  });

  test('terrain Hilbert: side fills cover the interior and inversion complements the selected side', () => {
    const a = TerrainLayouts.generate({ ...grove, side: 1, inverted: false });
    const b = TerrainLayouts.generate({ ...grove, side: 2, inverted: false });
    const inverted = TerrainLayouts.generate(grove), filled = new Set(b.map(key));
    const union = new Set([...a, ...b].map(key));
    assert.eq(union.size, (grove.width - 2) * (grove.height - 2));
    assert.eq(filled.size, b.length);
    assert.gt(inverted.length, 0);
    assert.eq(inverted.length + b.length, union.size);
    assert.truthy(inverted.every(p => !filled.has(key(p))), 'inversion excludes the complete filled boundary');
    for (const p of [...a, ...b, ...inverted]) {
      assert.inRange(p.cx, 1, grove.width - 2); assert.inRange(p.cy, 1, grove.height - 2);
      assert.eq(p.x, (p.cx + .5) / grove.width); assert.eq(p.y, (p.cy + .5) / grove.height);
    }
    assert.eq(keys(TerrainLayouts.generate({ ...grove, side: 0, inverted: false })), keys(TerrainLayouts.path(grove)));
  });

  test('terrain assignment: mushroom shares preserve seats and deterministic size variation', () => {
    const points = TerrainLayouts.generate(grove);
    for (const selection of ['density', 'patches']) {
      const options = { ...grove, selection, affinity: 51, variation: 35, clusterSize: false };
      const assigned = TerrainLayouts.assign(points, options, slots);
      assert.eq(keys(assigned), keys(points), 'shares never reduce overall count');
      const giants = assigned.filter(p => p.type === 0).length;
      assert.lte(Math.abs(giants - (assigned.length - giants)), 1, 'equal shares round by at most one seat');
      assert.truthy(assigned.every(p => p.material === slots[p.type].material));
      assert.eq(JSON.stringify(TerrainLayouts.assign(points, options, slots)), JSON.stringify(assigned));
      assigned.forEach(p => assert.inRange(p.scale, .8775, 1.1225));
      assert.gt(new Set(assigned.map(p => p.scale)).size, 1, 'variation changes rendered size');
      assert.truthy(TerrainLayouts.assign(points, { ...options, variation: 0 }, slots).every(p => p.scale === 1));
      const allSmall = TerrainLayouts.assign(points, options, [{ ...slots[0], share: 0 }, { ...slots[1], share: 100 }]);
      assert.eq(keys(allSmall), keys(points));
      assert.truthy(allSmall.every(p => p.material === 'mushroom'), 'zero share reallocates every seat');
    }
  });
})();
