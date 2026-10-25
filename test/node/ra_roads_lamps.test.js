// Phase 1 changes material selection, not street geometry or restoration IDs.
test('RA roads: restoration keeps variant material and repairs ordinary pavers', () => {
  assert.eq(RoadOverlay.roadMaterialFor('', false), 'ROAD-natural');
  assert.eq(RoadOverlay.roadMaterialFor('', true), 'ROAD-natural');
  for (const [variant, material] of Object.entries({ lantern:'ROAD-warm', hedgerow:'ROAD-moss',
      toadstool:'ROAD-mauve', burned:'ROAD-charcoal', poison_path:'ROAD-marsh' })) {
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
