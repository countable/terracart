// Phase 1 changes material selection, not street geometry or restoration IDs.
test('RA roads: restoration keeps variant material and repairs ordinary pavers', () => {
  assert.eq(RoadOverlay.roadMaterialFor('', false), 'R02');
  assert.eq(RoadOverlay.roadMaterialFor('', true), 'R01');
  for (const [variant, material] of Object.entries({ lantern:'R03', hedgerow:'R04',
      toadstool:'R05', burned:'R06', poison_path:'R07' })) {
    assert.eq(RoadOverlay.roadMaterialFor(variant, false), material);
    assert.eq(RoadOverlay.roadMaterialFor(variant, true), material);
  }
});

test('RA lamps: hanging light stays on the lantern at every map heading', () => {
  const light = { dxPx: RoadOverlay.LAMP_LIGHT_OFFSET_CELLS * 32, dyPx: -RoadOverlay.LAMP_LIGHT_RISE_CELLS * 32 };
  for (const angle of [0, Math.PI/2, Math.PI, -Math.PI/3]) {
    const scene = {_headingUp:true,mapRot:angle,viewCenterX:0,viewCenterY:0};
    const lift = Lighting.liftPx(scene, light);
    const screen = HeadingUp.toScreenPt(scene,lift.x,lift.y);
    assert.inRange(screen.x,14.3999,14.4001);
    assert.inRange(screen.y,-19.2001,-19.1999);
  }
});
