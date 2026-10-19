// The approved materials sheet and BuildingLowPoly's crop table move together:
// tools/build_approved_materials.py packs the sheet and prints the rectangles
// pasted into SHEET_SRC. Every rectangle must lie inside the shipped PNG, and
// every roof tile must divide the 360-texel roof period atlasFaces wraps on.
(() => {
  const dims = pngDims('assets/Objects/BuildingMaterials/approved-materials-v1.png');
  const src = BUILDING_LOWPOLY_SRC, table = src.slice(src.indexOf('const SHEET_SRC='), src.indexOf("const SHEET_IMAGE='"));
  const SHEET_SRC = new Function(table + 'return SHEET_SRC;')();
  test('approved sheet: every wall, roof and facade part crop lies inside the PNG', () => {
    assert.truthy(dims, 'approved-materials-v1.png ships');
    const rects = [];
    for (const wall of Object.values(SHEET_SRC.walls)) for (const kind of ['window', 'plain', 'door']) rects.push(wall[kind]);
    for (const roof of Object.values(SHEET_SRC.roofs)) rects.push(roof.rect);
    for (const surface of Object.values(SHEET_SRC.surfaces)) rects.push(surface);
    for (const part of Object.values(SHEET_SRC.parts)) rects.push(part);
    assert.eq(rects.length, 69, '12 legacy wall crops, 11 roofs, 12 restoration surfaces and 34 facade parts');
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
    for (const [role, spec] of Object.entries(api.RESTORED_ROLES)) {
      for(const variant of ['A','B']) {
        assert.truthy(SHEET_SRC.surfaces[variant+spec.wallCell],role+' '+variant+' ground wall');
        if(spec.upperWallCell)assert.truthy(SHEET_SRC.surfaces[variant+spec.upperWallCell],role+' '+variant+' upper wall');
      }
      assert.truthy(SHEET_SRC.roofs[spec.roofMaterial], role + ' restoration roof ' + spec.roofMaterial);
    }
    for (const name of ['copper','verdigris','blueSlate','violet','red','plum','strawGreen']) {
      const [x0,y0,x1,y1] = SHEET_SRC.roofs[name].rect;
      assert.eq(x1-x0,96,name+' keeps authored horizontal texel density');
      assert.eq(y1-y0,96,name+' keeps authored vertical texel density');
    }
    for (const [name, roof] of Object.entries(SHEET_SRC.roofs)) for (const t of roof.tile) assert.eq(360 % t, 0, name + ' tile ' + t);
  });
  test('approved sheet: processed facade files match packed openings, signs and roof-tinted canopies', () => {
    const expected={houseDoor:[19,24],porthole:[14,14],shopDoor:[20,24],shopWindow:[74,15],
      smithDoor:[23,24],cog:[18,18],timberWindow:[14,14],brassWindow:[16,16]};
    for(const role of ['shop','trader','supply','seed','pet','potion','relic','book'])expected[role]=[20,18];
    for(const roof of ['blueSlate','verdigris','strawGreen','violet','red','plum'])expected['awning'+roof]=[76,8];
    assert.eq(JSON.stringify(Object.keys(SHEET_SRC.parts).filter(n=>!n.startsWith('A')&&!n.startsWith('B')).sort()),JSON.stringify(Object.keys(expected).sort()));
    for(const [name,[width,height]] of Object.entries(expected)) {
      const [x0,y0,x1,y1]=SHEET_SRC.parts[name],file=pngDims('assets/Objects/BuildingMaterials/source/b4-facade/'+name+'.png');
      assert.truthy(file,name+' processed derivative ships');
      assert.eq(x1-x0,width,name+' packed width');assert.eq(y1-y0,height,name+' packed height');
      assert.eq(file.w,width,name+' source width');assert.eq(file.h,height,name+' source height');
    }
  });
  test('approved sheet: both PP variants ship correctly sized surfaces and oversized openings', () => {
    const expected={whitePlaster:[96,96],orangeBrick:[96,96],boards:[96,96],smithStone:[96,96],
      houseDoor:[19,24],shopDoor:[20,24],smithDoor:[23,24],timberWindow:[14,14],brassWindow:[16,16],shopWindow:[74,15]};
    for(const variant of ['A','B'])for(const [name,[width,height]] of Object.entries(expected)) {
      const key=variant+name,rect=SHEET_SRC.surfaces[key]||SHEET_SRC.parts[key];
      const file=pngDims('assets/Objects/BuildingMaterials/source/b4d-pp/'+key+'.png');
      assert.truthy(rect,key+' packed');assert.truthy(file,key+' processed derivative ships');
      assert.eq(rect[2]-rect[0],width,key+' atlas width');assert.eq(rect[3]-rect[1],height,key+' atlas height');
      assert.eq(file.w,width,key+' source width');assert.eq(file.h,height,key+' source height');
    }
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
