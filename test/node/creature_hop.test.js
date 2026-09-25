// How a creature hops is its ART ROW's. The slime sheets DRAW a hop (row 3:
// rise, airtime, squashed landing), so a slime plays that row across each
// step it takes and oozes on row 0 between — no code bounce on top
// (SpriteLayout.creatureHopRow). A kind with no hop art (the goblins) wears
// the code bounce (creatureHop). The slimes used to wear the code bounce over
// their idle ooze: two rhythms out of step, bouncing in place, reading as
// rapid and airborne.

test('creature hop: the slimes play their sheet\'s own hop row, with no code bounce', () => {
  for (const k of ['slime', 'cave_slime', 'purple_slime', 'giant_cave_slime']) {
    const r = SpriteLayout.creatureHopRow(k);
    assert.truthy(r, `${k} has a hop row`);
    assert.eq(r.row, SpriteLayout.SLIME_HOP_ROW, `${k}: row ${SpriteLayout.SLIME_HOP_ROW}`);
    assert.eq(r.cols, 4, 'four frames a row');
    assert.eq(SpriteLayout.creatureHop(k), null, `${k}: no code bounce on top`);
  }
  assert.eq(JSON.stringify(SpriteLayout.creatureHopRow('slime')), JSON.stringify(SpriteLayout.creatureHopRow('cave_slime')),
    'the cave slime is the surface slime\'s body — one hop');
});

test('creature hop: goblins keep the code bounce; a cow does neither', () => {
  assert.eq(JSON.stringify(SpriteLayout.creatureHop('goblin')),
    JSON.stringify({ ms: SpriteLayout.HOP_MS, px: SpriteLayout.HOP_PX }), 'goblin: the code bounce');
  assert.eq(SpriteLayout.creatureHopRow('goblin'), null, 'no hop art');
  assert.eq(SpriteLayout.creatureHop('cow'), null);
  assert.eq(SpriteLayout.creatureHopRow('cow'), null);
});

test('creature hop: while moving, hop on a beat — the row, then a rest on idle frame 0', () => {
  const hr = SpriteLayout.creatureHopRow('cave_slime');
  const F = SpriteLayout.SLIME_HOP_FRAME_MS, R = SpriteLayout.SLIME_HOP_REST_MS;
  const f = (t) => SpriteLayout.hopRowFrame(hr, t);
  assert.eq(f(0), 12, 'row 3, frame 0 (3 × 4 + 0)');
  assert.eq(f(F * 2 + 1), 14, 'mid-hop: the airborne frame');
  assert.eq(f(F * 4 + 1), 0, 'the rest after the hop: idle frame 0');
  assert.eq(f(F * 4 + R + 1), 12, 'then the next hop');
  assert.lte(F * 4, 800, 'one hop is quick, not stretched over a 7 s glide');
});

test('creature hop: render.js plays it only mid-step, as app.js stamps the step', () => {
  const r = RENDER_SRC;
  assert.truthy(/const hopRow = creatureHopRow\(c\.kind\);/.test(r), 'reads the row');
  assert.truthy(/const stepping = tStep >= 0 && tStep < \(c\._hopMs \|\| 0\)/.test(r), 'only while a step is under way');
  assert.truthy(/s\.setFrame\(hopRowFrame\(hopRow, tStep/.test(r), 'the beat off the step clock');
  assert.truthy(/c\._stepT0 = now;\s*c\._hopMs = stepMs;/.test(APP_JS_SRC), 'app.js stamps the step it picks');
});
