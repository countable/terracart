test('melee animation expires, points at the target, and uses the supplied combat reach', () => {
  const swing = { startT: 100, dir: { x: 0, y: -1 } };
  for (const weapon of ['fist', 'sword', 'dagger', 'lance', 'claw']) {
    const duration = (Render.MELEE_LOOKS[weapon] || Render.MELEE_LOOKS.sword).ms;
    assert.eq(Render.meleePose(swing, 99, weapon), null);
    assert.eq(Render.meleePose(swing, 100 + duration, weapon), null);
    const pose = Render.meleePose(swing, 100 + duration / 2, weapon, 20);
    assert.eq(pose.angle, -Math.PI / 2);
    const giant = Render.meleePose(swing, 100 + duration / 2, weapon, 40);
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

test('bare hands and monsters use the mercenary sweep, with one arc', () => {
  const sw = { startT: 0, dir: { x: 1, y: 0 } };
  for (const weapon of ['fist', 'claw', 'sword']) {
    const pose = Render.meleePose(sw, 130, weapon, 19.2);
    assert.eq(pose.radius, 19.2);
    let arcs = 0;
    Render.drawMelee({ lineStyle() {}, beginPath() {}, arc() { arcs++; }, strokePath() {} }, pose, 0, 0);
    assert.eq(arcs, 1);
  }
});
test('compact weapon tips meet the actual melee reach at full extension', () => {
  for (const weapon of ['sword', 'dagger', 'lance']) {
    const reach = Combat.meleeReachM(CELL_PX, weapon);
    const pose = Render.meleePose({ startT: 0, dir: { x: 1, y: 0 } },
      Render.MELEE_LOOKS[weapon].ms / 2, weapon, reach);
    const art = Render.meleeWeaponPose(pose);
    assert.lte(art.scale, 0.9);
    assert.lt(Math.abs(art.handRadius + (1 - art.grip) * 16 * Math.SQRT2 * art.scale - reach), 0.0001);
    assert.eq(pose.radius, reach);
  }
});
