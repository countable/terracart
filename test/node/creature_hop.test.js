// The hop a creature wears is its ART ROW's (SpriteLayout.creatureHop). A
// slime's must stay on its contact shadow: the shadow (render.js, 22px wide ×
// 0.34) is centred on the feet, so a bounce taller than half its height
// opens a gap under the body at the top of each hop — the cave slime read as
// floating on the old shared 6px bounce.

test('creature hop: slimes bounce slow and low enough to stay on their shadow', () => {
  const SHADOW_HALF_H = (22 * 0.34) / 2;
  for (const k of ['slime', 'cave_slime', 'purple_slime', 'giant_cave_slime']) {
    const h = SpriteLayout.creatureHop(k);
    assert.truthy(h, `${k} hops`);
    assert.lte(h.px, SHADOW_HALF_H, `${k}: a ${h.px}px bounce stays within the shadow's ${SHADOW_HALF_H.toFixed(2)}px`);
    assert.gte(h.ms, 1000, `${k}: a slow ooze, not a flutter`);
  }
  assert.eq(JSON.stringify(SpriteLayout.creatureHop('slime')), JSON.stringify(SpriteLayout.creatureHop('cave_slime')),
    'the cave slime is the surface slime\'s body — one bounce');
});

test('creature hop: other hoppers keep the default, non-hoppers have none', () => {
  assert.eq(JSON.stringify(SpriteLayout.creatureHop('goblin')),
    JSON.stringify({ ms: SpriteLayout.HOP_MS, px: SpriteLayout.HOP_PX }), 'goblin: the default bounce');
  assert.eq(SpriteLayout.creatureHop('cow'), null, 'a cow does not hop');
  assert.truthy(/const hop = creatureHop\(c\.kind\);/.test(RENDER_SRC), 'render.js draws the row\'s hop');
});
