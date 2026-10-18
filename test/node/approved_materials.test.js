// The approved materials sheet and BuildingLowPoly's crop table move together:
// tools/build_approved_materials.py packs the sheet and prints the rectangles
// pasted into SHEET_SRC. Every rectangle must lie inside the shipped PNG, and
// every roof tile must divide the 360-texel roof period atlasFaces wraps on.
(() => {
  const dims = pngDims('assets/Objects/BuildingMaterials/approved-materials-v1.png');
  const src = BUILDING_LOWPOLY_SRC, table = src.slice(src.indexOf('const SHEET_SRC='), src.indexOf("const SHEET_IMAGE='"));
  const SHEET_SRC = new Function(table + 'return SHEET_SRC;')();
  test('approved sheet: every wall and roof crop lies inside the PNG', () => {
    assert.truthy(dims, 'approved-materials-v1.png ships');
    const rects = [];
    for (const wall of Object.values(SHEET_SRC.walls)) for (const kind of ['window', 'plain', 'door']) rects.push(wall[kind]);
    for (const roof of Object.values(SHEET_SRC.roofs)) rects.push(roof.rect);
    assert.eq(rects.length, 16);
    for (const [x0, y0, x1, y1] of rects) {
      assert.gte(x0, 0); assert.gte(y0, 0); assert.lt(x0, x1); assert.lt(y0, y1);
      assert.lte(x1, dims.w); assert.lte(y1, dims.h);
    }
  });
  test('approved sheet: every role maps to a packed wall and roof', () => {
    const api = new Function('window', src + '\nreturn window.BuildingLowPoly;')({});
    for (const [role, spec] of Object.entries(api.ROLES)) {
      if (spec.sprite) continue;
      assert.truthy(SHEET_SRC.walls[spec.material], role + ' wall ' + spec.material);
      assert.truthy(spec.roofMaterial === 'flat' || SHEET_SRC.roofs[spec.roofMaterial], role + ' roof ' + spec.roofMaterial);
    }
    for (const [name, roof] of Object.entries(SHEET_SRC.roofs)) for (const t of roof.tile) assert.eq(360 % t, 0, name + ' tile ' + t);
  });
  test('approved roof wrapping preserves every packed tile phase on both axes', () => {
    const api = new Function('window', src + '\nreturn window.BuildingLowPoly;')({});
    const points = [[600, 600], [620, 600], [600, 620]].map(([u, v]) =>
      ({ x: u, y: v, z: 30, u: u * .65, v: v * .65 }));
    const mesh = { height: 30, faces: [{ kind: 'roof', points }] };
    const wrapped = api.atlasFaces(mesh, 360);
    assert.truthy(wrapped.length);
    for (const face of wrapped) for (const p of face.points) {
      const shifts = [p.u / .65 - p.tu * 512, p.v / .65 - (p.tv * 512 - 128)];
      for (const [axis, shift] of shifts.entries()) {
        assert.truthy(shift > 0, 'fixture crosses the atlas boundary');
        for (const [name, roof] of Object.entries(SHEET_SRC.roofs)) {
          const repeats = shift / roof.tile[axis];
          assert.truthy(Math.abs(repeats - Math.round(repeats)) < 1e-8, name + ' phase on axis ' + axis);
        }
      }
    }
    // Generated fallback tiles retain their separate three-tile period.
    const fallback = api.atlasFaces(mesh);
    assert.truthy(Math.abs(points[0].u / .65 - fallback[0].points[0].tu * 512 - 576) < 1e-8);
  });
})();
