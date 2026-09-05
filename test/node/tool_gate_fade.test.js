// Tool-gate fade (src/interactables.js › toolGatedAlpha, applied by the tree
// and mineralrock render specs).
//
// A tree the player's axe can't fell, or ore the pick can't mine, is drawn at
// half alpha so what is reachable NOW reads at a glance. The rule is the
// registry's own tierShort — the number the tap gate refuses on — so the fade
// and the refusal can never disagree. These pin the rule against the shipping
// gate helpers and that render.js actually applies it in both hooks.

(function () {
const axe  = (tier) => ({ relics: { axe:  { tier } } });
const pick = (tier) => ({ relics: { pick: { tier } } });
const bigMaple = { kind: 'tree', id: 'tgf_m', x: 0, y: 0, species: 'maple', size: 'large' };
const smallPine = { kind: 'tree', id: 'tgf_p', x: 7, y: 0, species: 'pine', size: 'small' };
const bush = { kind: 'tree', id: 'tgf_b', x: 14, y: 0, species: 'maple', size: 'bush' };
const ore4 = { kind: 'mineralrock', id: 'tgf_o', x: 0, y: 7, yieldTier: 4, requiredTier: 3 };
const plain = { kind: 'mineralrock', id: 'tgf_r', x: 7, y: 7, yieldTier: 1, requiredTier: 1 };
const cave = { kind: 'mineralrock', id: 'tgf_c', x: 14, y: 7, caveVariant: 2 };

test('tool-gate fade: half alpha, never invisible, never brighter than full', () => {
  assert.eq(TOOL_GATED_ALPHA, 0.5, 'the fade is 50%');
});

test('tool-gate fade: a tree fades exactly when the axe gate would refuse it', () => {
  const req = treeAxeReqTier(bigMaple);
  assert.gt(req, 0, 'fixture: a large maple needs an axe');
  assert.eq(toolGatedAlpha(bigMaple, axe(req - 1)), TOOL_GATED_ALPHA, 'one tier short → faded');
  assert.eq(toolGatedAlpha(bigMaple, axe(req)), 1, 'the right axe → full');
  assert.eq(toolGatedAlpha(bigMaple, axe(7)), 1, 'a better axe → full');
  assert.eq(toolGatedAlpha(bigMaple, { relics: {} }), TOOL_GATED_ALPHA, 'bare hands → faded');
  // The fade is the gate: whenever gate() has a refusal, the sprite is faded.
  for (const t of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const refused = INTERACTABLES.tree.gate(bigMaple, axe(t)) != null;
    assert.eq(isToolGated(bigMaple, axe(t)), refused, `axe tier ${t}: fade tracks the gate`);
  }
});

test('tool-gate fade: what bare hands can work is never faded', () => {
  assert.eq(toolGatedAlpha(smallPine, { relics: {} }), 1, 'a small softwood is bare-hands');
  assert.eq(toolGatedAlpha(bush, { relics: {} }), 1, 'a bush is always bare-hands');
  assert.eq(toolGatedAlpha(plain, { relics: {} }), 1, 'plain rock is ungated');
  assert.eq(toolGatedAlpha(cave, { relics: {} }), 1, 'cave rock is ungated');
});

test('tool-gate fade: ore fades exactly when the pick gate would refuse it', () => {
  assert.eq(toolGatedAlpha(ore4, pick(2)), TOOL_GATED_ALPHA, 'T4 ore with a T2 pick → faded');
  assert.eq(toolGatedAlpha(ore4, pick(3)), 1, 'T3 pick meets the requirement → full');
  for (const t of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const refused = INTERACTABLES.mineralrock.gate(ore4, pick(t)) != null;
    assert.eq(isToolGated(ore4, pick(t)), refused, `pick tier ${t}: fade tracks the gate`);
  }
});

test('tool-gate fade: kinds without a tool gate are never faded', () => {
  assert.eq(toolGatedAlpha({ kind: 'fruittree', species: 'apple' }, { relics: {} }), 1, 'a fruit tree is picked, not felled');
  assert.eq(toolGatedAlpha({ kind: 'chest', poiClass: 'bus' }, { relics: {} }), 1, 'a chest');
  assert.eq(toolGatedAlpha({ kind: 'not-a-thing' }, { relics: {} }), 1, 'an unknown kind');
  assert.eq(toolGatedAlpha(bigMaple, undefined), TOOL_GATED_ALPHA, 'no save at all reads as bare hands');
});

test('tool-gate fade: the tree and rock render specs both apply the shared rule', () => {
  const hits = RENDER_TREE_ROCK_SPEC_SRC.split('toolGatedAlpha(o, scene.save)').length - 1;
  assert.eq(hits, 2, 'both the tree and the mineralrock `after` hooks must call toolGatedAlpha(o, scene.save)');
  assert.truthy(RENDER_TREE_ROCK_SPEC_SRC.includes('after: (s, o, scene) =>'),
    'the hooks take the scene, which is how they reach the save');
});
})();
