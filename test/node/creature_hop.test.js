// How a creature hops is its ART ROW's. The slime sheets DRAW a hop (row 3:
// rise, airtime, squashed landing), so a slime plays that row across each
// step it takes and oozes on row 0 between — no code bounce on top
// (SpriteLayout.creatureHopRow). Ghosts bob with the code bounce
// (creatureHop); goblins use their walk cycle. Slimes used to wear a bounce over
// their idle ooze: two rhythms out of step, bouncing in place, reading as
// rapid and airborne.

test('creature hop: purple slimes retain their sheet hop; new idle sheets do not read nonexistent frames', () => {
  for (const k of ['purple_slime', 'giant_purple_slime']) {
    const r = SpriteLayout.creatureHopRow(k);
    assert.truthy(r, `${k} has a hop row`);
    assert.eq(r.row, SpriteLayout.SLIME_HOP_ROW, `${k}: row ${SpriteLayout.SLIME_HOP_ROW}`);
    assert.eq(r.cols, 4, 'four frames a row');
    assert.eq(SpriteLayout.creatureHop(k), null, `${k}: no code bounce on top`);
  }
  assert.eq(SpriteLayout.creatureHopRow('slime'), null, '16px idle sheet has no hop row');
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

test('creature hop: render.js plays it only mid-step, as wanderCreatures stamps the step', () => {
  const r = RENDER_SRC;
  assert.truthy(/const hopRow = creatureHopRow\(c\.kind\);/.test(r), 'reads the row');
  assert.truthy(/const stepping = tStep >= 0 && tStep < \(c\._hopMs \|\| 0\)/.test(r), 'only while a step is under way');
  assert.truthy(/s\.setFrame\(hopRowFrame\(hopRow, tStep/.test(r), 'the beat off the step clock');
  assert.truthy(/c\._stepT0 = now;\s*c\._hopMs = stepMs;/.test(SCENE_CREATURES_SRC),
    'wanderCreatures (scene_creatures.js) stamps the step it picks');
});
