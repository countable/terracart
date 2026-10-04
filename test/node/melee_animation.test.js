test('melee animation expires, points at the target, and scales for giant enemies', () => {
  const swing = { startT: 100, dir: { x: 0, y: -1 } };
  for (const weapon of ['fist', 'sword', 'dagger', 'lance', 'claw']) {
    const duration = Render.MELEE_LOOKS[weapon].ms;
    assert.eq(Render.meleePose(swing, 99, weapon), null);
    assert.eq(Render.meleePose(swing, 100 + duration, weapon), null);
    const pose = Render.meleePose(swing, 100 + duration / 2, weapon);
    assert.eq(pose.angle, -Math.PI / 2);
    const giant = Render.meleePose(swing, 100 + duration / 2, weapon, 2);
    assert.eq(giant.radius, pose.radius * 2);
  }
});
test('melee weapon motions distinguish a sword sweep from spear and dagger thrusts', () => {
  const swing = { startT: 0, dir: { x: 1, y: 0 } };
  assert.lt(Render.meleePose(swing, 20, 'sword').angle, 0);
  assert.gt(Render.meleePose(swing, 200, 'sword').angle, 0);
  assert.eq(Render.meleePose(swing, 20, 'lance').angle, 0);
  assert.gt(Render.meleePose(swing, 150, 'lance').radius,
    Render.meleePose(swing, 90, 'dagger').radius);
  assert.eq(Render.enemyMeleeColor({ kind: 'fire_elemental' }), 0xff863f);
  assert.eq(Render.enemyMeleeColor({ kind: 'fire_elemental', shiny: true }), 0xffd36a);
});
