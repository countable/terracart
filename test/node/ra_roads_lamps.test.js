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
test('RA lamps: native intact and snapped source frames share their ground anchor', () => {
  const calls = [], source = {};
  const cx = {save(){},restore(){},drawImage(...args){calls.push(args);}};
  assert.truthy(RoadOverlay.paintSelectedLamp(cx, 128, source, false));
  assert.truthy(RoadOverlay.paintSelectedLamp(cx, 128, source, true));
  assert.eq(calls[0][1], 0); assert.eq(calls[1][1], 32);
  assert.eq(JSON.stringify(calls[0].slice(5)), JSON.stringify(calls[1].slice(5)));
  const [, , , , , x, y, w, h] = calls[0];
  assert.eq(x + w * 8 / 32, 64, 'native shaft stands on the original world point');
  assert.eq(y + h * 31 / 32, 128 * RoadOverlay.LAMP_GROUND_FRAC);
});
test('RA lamps: hanging light stays on the lantern at every map heading', () => {
  const light = { dxPx: 14.4, dyPx: -19.2 };
  for (const angle of [0, Math.PI/2, Math.PI, -Math.PI/3]) {
    const scene = {_headingUp:true,mapRot:angle,viewCenterX:0,viewCenterY:0};
    const lift = Lighting.liftPx(scene, light);
    const screen = HeadingUp.toScreenPt(scene,lift.x,lift.y);
    assert.inRange(screen.x,14.3999,14.4001);
    assert.inRange(screen.y,-19.2001,-19.1999);
  }
});
test('RA lamps: theme repaint touches only the seven glass pixels, never wood or broken posts', () => {
  const paints = [], cx = {save(){},restore(){},drawImage(){},fillRect(...rect){paints.push({rect,color:this.fillStyle});}};
  const source = {};
  RoadOverlay.paintSelectedLamp(cx, 128, source, false, '#40c880');
  assert.eq(paints.length, 7);
  const glass = paints.map(p => [Math.round((p.rect[0] - 48) / 2), Math.round((p.rect[1] - (128 * RoadOverlay.LAMP_GROUND_FRAC - 62)) / 2)]);
  assert.eq(JSON.stringify(glass), JSON.stringify([[18,16],[20,16],[22,16],[18,17],[20,17],[22,17],[20,18]]));
  assert.eq(paints[1].color, 'rgb(64,200,128)', 'mid glass matches the light colour');
  paints.length = 0;
  RoadOverlay.paintSelectedLamp(cx, 128, source, true, '#40c880');
  assert.eq(paints.length, 0, 'the snapped post has no glass');
});
