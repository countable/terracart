// A bow's arrow wears its bow's MATERIAL colour (items.js MATERIAL_TIERS
// .color): one colour per tier, all distinct, set on the shot where app.js
// looses it; _drawShots prefers a shot's own `color` over the slot's.

test('arrow colour: every material tier has its own colour', () => {
  const cols = MATERIAL_TIERS.map((t) => t.color);
  assert.eq(cols.length, 7);
  for (const c of cols) assert.truthy(Number.isInteger(c) && c >= 0 && c <= 0xffffff, `a colour: ${c}`);
  assert.eq(new Set(cols).size, 7, 'all seven distinct');
});

test('arrow colour: the bow shot is stamped with its tier colour, and drawn in it', () => {
  assert.truthy(/if \(shot && slot === 'bow'\) \{\s*const c = TIER_BY_NUM\[relics\[slot\]\.tier\]\?\.color;\s*if \(c != null\) shot\.color = c;/.test(APP_JS_SRC),
    'app.js stamps the bow tier colour on the arrow');
  assert.truthy(/g\.lineStyle\(spec\.widthPx, s\.color != null \? s\.color : spec\.color, 0\.9\)/.test(APP_JS_SRC),
    '_drawShots draws a shot in its own colour');
});
