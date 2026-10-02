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
    for (const row of EnemyRoster.ROWS.filter(r => r.variantOf && SL.creatureArt(r.variantOf).directions)) {
      const a = SL.creatureArt(row.id), base = SL.creatureArt(row.variantOf);
      assert.eq(a.directions, base.directions, row.id);
      const c = { kind: row.id, _facing: 'left', _moveUntil: 2000, _artScale: 0.65 };
      assert.eq(SL.creatureScale(row.id, SL.creatureInstScale(c)), a.scale * 0.65);
      // The first MOVE frame of the base's side-facing row: 16 on an enemy48
      // sheet, the row's own first frame on a sheet with an authored table
      // (the goblin runt walks the club goblin's).
      const side = base.directions.side || base.directions.left;
      assert.eq(SL.creatureAppearance(c, 0).frame, side.move[0]);
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
    SL.faceCreature(c, 5, 0); assert.eq(c._facePending, 'right'); assert.eq(c._moveUntil, until, 'aiming does not walk');
  });
  test('enemy direction: a new facing shows only once wanted for a second, and motion stamps still land', () => {
    const H = SL.CREATURE_FACE_HOLD_MS;
    const c = { kind: 'zombie' };
    SL.updateCreatureFacing(c, 5, 0, 10000); assert.eq(c._facing, 'right', 'the first facing is immediate');
    SL.updateCreatureFacing(c, 0, 5, 10400); assert.eq(c._facing, 'right', 'held');
    assert.eq(c._moveUntil, 10400 + SL.CREATURE_MOVE_GRACE_MS, 'movement animation unaffected');
    SL.updateCreatureFacing(c, 0, 5, 10400 + H - 1); assert.eq(c._facing, 'right', 'not yet a full second');
    SL.updateCreatureFacing(c, 0, 5, 10400 + H); assert.eq(c._facing, 'down');
  });
  test('enemy direction: dithering between two facings never turns the drawn body', () => {
    const c = { kind: 'zombie' };
    SL.updateCreatureFacing(c, 5, 0, 0);
    // A chase that wants down / right / down every 100 ms for 5 s.
    for (let t = 100; t <= 5000; t += 100) {
      SL.updateCreatureFacing(c, (t / 100) % 2 ? 0 : 5, (t / 100) % 2 ? 5 : 0, t);
      assert.eq(c._facing, 'right', 'held at ' + t);
    }
  });
  test('enemy direction: motion just past the diagonal keeps the facing it has', () => {
    const c = { kind: 'zombie' };
    SL.updateCreatureFacing(c, 5, 0, 0);
    const a = Math.PI / 4 + 0.2;   // past the diagonal, inside the hysteresis
    for (let t = 16; t <= 3000; t += 16) SL.updateCreatureFacing(c, Math.cos(a), Math.sin(a), t);
    assert.eq(c._facing, 'right');
    assert.eq(c._facePendingT, null, 'not even pending');
  });
})();
