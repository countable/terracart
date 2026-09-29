(function () {
  const SL = SpriteLayout;
  test('enemy direction: full sheets select authored front, back and side cycles with left-facing source art', () => {
    const c = { kind: 'bat', _moveUntil: 1000 };
    const cases = [['down', 12, false], ['up', 20, false], ['left', 16, false], ['right', 16, true]];
    for (const [direction, frame, flipX] of cases) {
      c._facing = direction;
      const a = SL.creatureAppearance(c, 0);
      assert.eq(a.frame, frame, direction); assert.eq(a.flipX, flipX, direction);
    }
    c._facing = 'up';
    assert.eq(SL.creatureAppearance(c, 1000).frame, 8, 'after stopping retain back-facing idle');
  });
  test('enemy direction: goblins use their different row order, right-facing sides and still idle poses', () => {
    for (const kind of ['goblin', 'goblin_archer', 'goblin_trapper', 'giant_goblin']) {
      const c = { kind, _facing: 'up', _moveUntil: 1000 };
      assert.eq(SL.creatureAppearance(c, 160).frame, 7, kind + ' back walk');
      assert.eq(SL.creatureAppearance(c, 1000).frame, 6, kind + ' back rest');
      c._facing = 'left';
      assert.eq(SL.creatureAppearance(c, 160).frame, 13);
      assert.truthy(SL.creatureAppearance(c, 160).flipX, 'mirror right-facing goblin art');
      c._facing = 'right'; assert.falsy(SL.creatureAppearance(c, 160).flipX);
      assert.eq(SL.creatureHop(kind), null, 'walking has no code bounce');
    }
  });
  test('enemy direction: attacks use facing-specific art, finish once, and return to the retained idle direction', () => {
    const c = { kind: 'plant', _facing: 'up', _attackT0: 1000, _attackUntil: 1600 };
    for (let i = 0; i < 4; i++) assert.eq(SL.creatureAppearance(c, 1000 + i * 150).frame, 32 + i);
    assert.eq(SL.creatureAppearance(c, 1600).frame, 8 + Math.floor(1600 / SL.creatureFrameMs('plant')) % 4);
    c._facing = 'right'; assert.truthy(SL.creatureAppearance(c, 1200).flipX);
  });
  test('enemy direction: variants inherit layouts without losing their size or texture identity', () => {
    for (const row of EnemyRoster.ROWS.filter(r => r.variantOf)) {
      const a = SL.creatureArt(row.id), base = SL.creatureArt(row.variantOf);
      assert.eq(a.directions, base.directions, row.id);
      const c = { kind: row.id, _facing: 'left', _moveUntil: 2000, _artScale: 0.65 };
      assert.eq(SL.creatureScale(row.id, SL.creatureInstScale(c)), a.scale * 0.65);
      assert.eq(SL.creatureAppearance(c, 0).frame, 16);
    }
  });
  test('enemy direction: unsupported sheets keep their original cycle, mirroring and sheet hop', () => {
    for (const kind of ['purple_slime', 'fire_slime']) {
      const c = { kind, _facing: 'up', _faceFlip: true };
      assert.falsy(SL.creatureArt(kind).directions);
      assert.eq(SL.creatureAppearance(c, SL.creatureFrameMs(kind) * 2).frame, 2);
      assert.truthy(SL.creatureAppearance(c, 0).flipX);
      Object.assign(c, { _stepT0: 0, _hopMs: 2000, _startX: 0, _startY: 0, _targetX: 1, _targetY: 0 });
      const hop = SL.creatureHopRow(kind);
      assert.eq(SL.creatureAppearance(c, hop.frameMs).frame, hop.row * hop.cols + 1);
    }
    assert.eq(SL.creatureAppearance({ kind: 'unknown' }, 1000).frame, 0);
  });
  test('enemy direction: facing uses dominant accepted displacement and does not reset while stationary', () => {
    const c = { kind: 'zombie' };
    SL.updateCreatureFacing(c, -2, -5, 1000); assert.eq(c._facing, 'up');
    const until = c._moveUntil;
    SL.updateCreatureFacing(c, 0, 0, 2000); assert.eq(c._facing, 'up'); assert.eq(c._moveUntil, until);
    SL.faceCreature(c, 5, 0); assert.eq(c._facing, 'right'); assert.eq(c._moveUntil, until, 'aiming does not walk');
  });
})();
