// A bow's arrow wears its bow's MATERIAL colour (items.js MATERIAL_TIERS
// .color): one colour per tier, all distinct, set on the shot where app.js
// looses it; _drawShots prefers a shot's own `color` over the slot's.

test('arrow colour: every material tier has its own colour', () => {
  const cols = MATERIAL_TIERS.map((t) => t.color);
  assert.eq(cols.length, 7);
  for (const c of cols) assert.truthy(Number.isInteger(c) && c >= 0 && c <= 0xffffff, `a colour: ${c}`);
  assert.eq(new Set(cols).size, 7, 'all seven distinct');
});

test('arrow colour: the bow and staff shots are stamped with their tier colour, and drawn in it', () => {
  assert.truthy(/if \(shot && \(slot === 'bow' \|\| slot === 'staff'\)\) \{\s*shot\.color = shotTierColour\(slot, relics\[slot\]\.tier\);/.test(SCENE_SRC),
    'app.js stamps the tier colour on the arrow and the bolt');
  assert.truthy(/function shotTierColour\(slot, tier\) \{\s*const c = TIER_BY_NUM\[tier\]\?\.color;/.test(SCENE_SRC),
    'the tier colour is the MATERIAL_TIERS colour');
  assert.truthy(/g\.lineStyle\(spec\.widthPx, s\.color != null \? s\.color : spec\.color, 0\.9\)/.test(SCENE_SRC),
    '_drawShots draws an arrow in its own colour');
  assert.truthy(/this\._drawBolt\(s, s\.color != null \? s\.color : spec\.color, lift\)/.test(SCENE_SRC),
    'and a bolt in its own colour');
  assert.truthy(/this\._boltGlowKey\(shotTierColour\('staff', tier\)\)/.test(SCENE_SRC),
    'the charging orb is the colour of the bolt it becomes');
});
