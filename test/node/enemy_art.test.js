// Supplied enemy sheets are 16px cells; rendering, wheels and tap bounds all
// resolve their geometry from the same creature row.
test('enemy art: ghost uses supplied art with spectral effects, without the slime tint', () => {
  const art = SpriteLayout.creatureArt('ghost');
  assert.eq(art.sheet, 'ghost');
  assert.eq(art.fw, 16);
  assert.eq(art.fh, 16);
  assert.eq(SpriteLayout.creatureTint('ghost'), 0xffffff);
  assert.eq(SpriteLayout.creatureAlpha('ghost'), SpriteLayout.GHOST_ALPHA);
  assert.truthy(SpriteLayout.creatureGlow('ghost'));
  assert.truthy(SpriteLayout.creatureAirborne('ghost'));
  for (let frame = 0; frame < 4; frame++) {
    assert.eq(SpriteLayout.creatureCycleFrame({ kind: 'ghost' }, frame * art.frameMs), frame);
  }
});

test('enemy art: rooted plant keeps its ground line and plays a complete bite before idling', () => {
  const art = SpriteLayout.creatureArt('plant');
  assert.eq(art.sheet, 'plant');
  assert.eq(art.float, 0);
  assert.eq(art.foot, 1);
  assert.falsy(SpriteLayout.creatureHop('plant'));
  assert.falsy(SpriteLayout.creatureAirborne('plant'));
  const plant = { kind: 'plant', _attackT0: 1000, _attackUntil: 1600 };
  for (let frame = 0; frame < 4; frame++) {
    assert.eq(SpriteLayout.creatureCycleFrame(plant, 1000 + 150 * frame), 24 + frame);
  }
  assert.eq(SpriteLayout.creatureCycleFrame(plant, 1600), Math.floor(1600 / art.frameMs) % 4);
  assert.eq(SpriteLayout.creatureCycleFrame({ kind: 'plant' }, 0), 0);
});

test('enemy art: timed attacks do not change existing idle cycles without attack artwork', () => {
  const slime = { kind: 'slime', _attackT0: 0, _attackUntil: 10000 };
  const art = SpriteLayout.creatureArt('slime');
  assert.eq(SpriteLayout.creatureCycleFrame(slime, art.frameMs * 3), 3);
  assert.eq(SpriteLayout.creatureCycleFrame({ kind: 'unknown' }, 1000), 0);
});
