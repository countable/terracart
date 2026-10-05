test('hive bees share bat combat and flight without entering ambient spawn bags', () => {
  const bee = EnemyRoster.get('bee'), bat = EnemyRoster.get('bat');
  for (const key of ['hp', 'armor', 'dmg', 'range', 'attackType', 'damageIntervalSeconds', 'windupSeconds', 'visionCells']) {
    assert.eq(bee[key], bat[key], key);
  }
  assert.eq(JSON.stringify(bee.movement), JSON.stringify(bat.movement));
  assert.falsy(bee.surface);
  assert.falsy(bee.cave);
  assert.falsy(bee.eliteEligible);
  assert.truthy(Combat.isEnemy({ kind: 'bee' }));
  assert.truthy(Combat.MONSTERS.bee.movement.flightOnlyOverLowObstacles);
  assert.truthy(SpriteLayout.creatureWanders('bee'));
});

test('bee wings animate through each authored direction while hovering and moving', () => {
  const art = SpriteLayout.creatureArt('bee');
  const dims = pngDims(EnemyRoster.get('bee').art.path);
  assert.eq(dims.w, 96); assert.eq(dims.h, 72);
  assert.eq(art.fw, 24); assert.eq(art.fh, 24);
  assert.truthy(SpriteLayout.creatureAirborne('bee'));
  for (const [facing, col] of [['down', 0], ['left', 1], ['up', 2], ['right', 3]]) {
    for (const moving of [false, true]) {
      const c = { kind: 'bee', _facing: facing, _moveUntil: moving ? 10000 : 0 };
      [col, col + 4, col + 8, col + 4, col].forEach((frame, step) => {
        const result = SpriteLayout.creatureAppearance(c, step * 100);
        assert.eq(result.frame, frame, facing + ' wing frame ' + step);
        assert.falsy(result.flipX, 'authored poses must not be mirrored');
      });
    }
  }
});
