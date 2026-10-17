// How a creature hops is its ART ROW's. The slime sheets DRAW a hop (row 3:
// rise, airtime, squashed landing), so a slime plays that row across each
// step it takes and oozes on row 0 between — no code bounce on top
// (SpriteLayout.creatureHopRow). Ghosts bob with the code bounce
// (creatureHop); goblins use their walk cycle. Slimes take no bounce over
// their idle ooze (two rhythms out of step read as rapid and airborne).

test('creature hop: purple slimes retain their sheet hop; new idle sheets do not read nonexistent frames', () => {
  for (const k of ['purple_slime', 'giant_purple_slime']) {
    const r = SpriteLayout.creatureHopRow(k);
    assert.truthy(r, `${k} has a hop row`);
    assert.eq(r.row, SpriteLayout.SLIME_HOP_ROW, `${k}: row ${SpriteLayout.SLIME_HOP_ROW}`);
    assert.eq(r.cols, 4, 'four frames a row');
    assert.eq(SpriteLayout.creatureHop(k), null, `${k}: no code bounce on top`);
  }
  assert.truthy(SpriteLayout.creatureHopRow('slime'), 'the surface slime keeps its sheet hop');
  assert.eq(JSON.stringify(SpriteLayout.creatureHopRow('slime')), JSON.stringify(SpriteLayout.creatureHopRow('cave_slime')),
    'the cave slime is the surface slime\'s body — one hop');
});

test('creature hop: goblins walk without a body bounce, including archer, trapper and giants', () => {
  for (const kind of ['goblin', 'goblin_archer', 'goblin_trapper']) {
    for (const k of [kind, 'giant_' + kind]) {
      assert.eq(SpriteLayout.creatureHop(k), null, `${k}: no code bounce`);
      assert.eq(SpriteLayout.creatureHopRow(k), null, `${k}: no sheet hop`);
      assert.eq(SpriteLayout.creatureFloat(k), 0, `${k}: grounded`);
      assert.eq(SpriteLayout.creatureFrames(k), 6, `${k}: retains all walk frames`);
      assert.eq(SpriteLayout.creatureFrameMs(k), 160, `${k}: retains walk timing`);
    }
  }
  assert.truthy(SpriteLayout.creatureHop('ghost'), 'ghost still bobs');
  assert.eq(SpriteLayout.creatureHop('cow'), null);
  assert.eq(SpriteLayout.creatureHopRow('cow'), null);
});

test('creature hop: while moving, hop on a beat — the row, then a rest on idle frame 0', () => {
  const hr = SpriteLayout.creatureHopRow('purple_slime');
  const F = SpriteLayout.SLIME_HOP_FRAME_MS, R = SpriteLayout.SLIME_HOP_REST_MS;
  const f = (t) => SpriteLayout.hopRowFrame(hr, t);
  assert.eq(f(0), 12, 'row 3, frame 0 (3 × 4 + 0)');
  assert.eq(f(F * 2 + 1), 14, 'mid-hop: the airborne frame');
  assert.eq(f(F * 4 + 1), 0, 'the rest after the hop: idle frame 0');
  assert.eq(f(F * 4 + R + 1), 12, 'then the next hop');
  assert.lte(F * 4, 800, 'one hop is quick, not stretched over a 7 s glide');
});

test('creature hop: renderer and preview share the appearance resolver; sim stamps the step', () => {
  assert.truthy(/s\.setFrame\(appearance\.frame\)/.test(RENDER_SRC), 'uses resolved frame');
  assert.truthy(/const actor = typeof HeadingUp !== 'undefined' \? HeadingUp\.appearanceActor\(scene, c\) : c;/.test(RENDER_SRC),
    'presentation actor derives from current creature without changing simulation');
  assert.truthy(/creatureAppearance\(actor, performance\.now\(\)\)/.test(RENDER_SRC),
    'heading-adjusted actor still uses the shared appearance resolver');
  const creature = { kind: 'green_dragon', _facing: 'right', _moveUntil: 2000 };
  const scene = { _headingUp: true, mapRot: -Math.PI / 2 };
  const actor = HeadingUp.appearanceActor(scene, creature);
  const drawn = SpriteLayout.creatureAppearance(actor, 500);
  const expected = SpriteLayout.creatureAppearance({ ...creature, _facing: 'up' }, 500);
  assert.eq(drawn.frame, expected.frame, 'turned creature keeps the shared animation timing');
  assert.eq(creature._facing, 'right', 'rendering leaves simulation facing untouched');
  assert.truthy(/launchStep\(c, tx, ty, now\);\s*c\._hopMs = stepMs;/.test(SCENE_SRC),
    'wanderCreatures stamps the step it picks (launchStep: start, target, _stepT0)');
  assert.truthy(/c\[clockField\] = now;/.test(CREATURE_AI_SRC));
});
