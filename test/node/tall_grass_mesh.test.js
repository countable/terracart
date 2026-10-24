(() => {
  test('grass volume: selected native tuft geometry has four crossed pairs and no opaque core', () => {
    const points = [{x:0,y:0},{x:32,y:0},{x:32,y:32},{x:0,y:32}];
    const faces = WallMaterials.geometry('grass', points, WallMaterials.GRASS.height);
    assert.eq(faces.length, 16, 'eight quads, two triangles each');
    assert.truthy(faces.every(f => f.twoSided), 'cutout planes draw from either side');
    assert.truthy(faces.every(f => f.points.some(p => p.z === 0) && f.points.some(p => p.z > 0)), 'every triangle is upright; there is no solid lid');
    assert.eq([...new Set(faces.flatMap(f=>f.points.map(p=>p.z)))].sort((a,b)=>a-b).join(','),'0,21,24');
    for (let i = 0; i < 4; i++) {
      const pair = faces.slice(i * 4, i * 4 + 4).flatMap(f=>f.points);
      const xs = pair.map(p=>p.x), ys = pair.map(p=>p.y);
      assert.eq(Math.max(...xs)-Math.min(...xs),23,'native tuft width');
      assert.eq(Math.max(...ys)-Math.min(...ys),23,'crossed tuft depth');
      assert.eq((Math.max(...xs)+Math.min(...xs))/2, i%2?24:8,'horizontal offsets +/-8');
      assert.eq((Math.max(...ys)+Math.min(...ys))/2, i<2?8:24,'vertical offsets +/-8');
    }
    assert.truthy(faces.every(f => f.points.every(p => Object.values(p).every(Number.isFinite)
      && p.u > 0 && p.u < 1 && p.v > 0 && p.v < 1)), 'finite geometry and native-image UVs');
    assert.eq(WallMaterials.GRASS.texture,'selected_longgrass');
    assert.truthy(/selected_longgrass:.*assets\/ArtTrials\/RogueProps\/flora-selected_longgrass\.png/.test(ASSETS_SRC), 'exact approved native RA crop');
  });
  test('grass volume: native gaps do not suppress co-located object or plant rendering', () => {
    assert.falsy(typeof Render.grassHiddenObjects === 'function','no hard concealment predicate');
    assert.falsy(RENDER_SRC.includes('_grassHidden'), 'no hidden-prop metadata or sprite culling');
  });
})();
