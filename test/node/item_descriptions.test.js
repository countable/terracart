// Narrative descriptions hint at a use; gameplay numbers remain in their owners.
test('item descriptions: real items carry brief story hints without numeric effects', () => {
  for (const [id, line] of Object.entries(ITEM_EFFECTS)) {
    assert.truthy(ITEM_BY_ID[id], `${id}: a real item`);
    assert.truthy(typeof line === 'string' && line.length > 0, `${id}: a description`);
    assert.falsy(/[0-9%⚡×]|;/.test(line), `${id}: no numeric effect or list of effects`);
  }
  for (const [slot, def] of Object.entries(RELIC_DEFS)) {
    assert.truthy(def.blurb, `${slot}: a story hint`);
    assert.falsy(/[0-9%⚡×]|;| · /.test(def.blurb), `${slot}: no numeric effect or list`);
  }
  assert.eq(ITEM_EFFECTS.dragon_powder,
    'The powder lets you soar in dragon form, for a short time.', 'approved dragon wording');
});

test('item guides: each guide belongs to the Book and keeps exact effects out of prose', () => {
  for (const [id, tip] of Object.entries(ITEM_GUIDE_TIPS)) {
    assert.truthy(PLAY_TIPS.includes(tip), `${id}: guide is in the Book`);
    assert.falsy(/[0-9%⚡×]|;/.test(tip), `${id}: story rather than an effect list`);
  }
  for (const recipe of HOME_RECIPES) {
    assert.truthy(ITEM_GUIDE_TIPS[recipe.id], `${recipe.id}: a craftable has a guide`);
  }
  assert.falsy(/sapphire/i.test(ITEM_GUIDE_TIPS.slime), 'the slime guide preserves the riddle');
});

test('consumable confirmations: outcomes stay brief and enigmatic', () => {
  for (const [id, row] of Object.entries(CONSUMABLE_SPEC)) {
    if (!row.method) continue;
    const scene = { isTorchActive: () => false, depth: 0 };
    const line = typeof row.get === 'function' ? row.get(scene, row) : row.get;
    assert.truthy(typeof line === 'string' && line.length > 0, `${id}: an outcome`);
    assert.falsy(/[0-9%⚡×]|;/.test(line), `${id}: no exact effects in confirmation`);
  }
});

test('consumables: one action row names every button method', () => {
  const ids = [
    'orb', 'egg', 'book', 'honey', 'reach_potion', 'antidote', 'elixir',
    'vigor_potion', 'speed_potion', 'shield_potion', 'raven_scroll', 'skeleton_scroll', 'wraith_scroll',
    'giant_potion', 'fire_resistance_potion', 'protection_potion', 'time_potion', 'immortal_potion', 'shrinking_potion',
    'thunder_scroll', 'blight_potion', 'revive_potion',
    'resurrection_potion', 'dragon_powder', 'growth_powder', 'shadow_powder',
    'frost_powder', 'torch', 'sapphire', 'rope', 'spear', 'javelin', 'rockfruit', 'forgetmenot', 'wildrose', 'horse', 'shiny_horse',
    'tome_sight', 'tome_raven', 'tome_storm', 'tome_speed', 'tome_shield', 'tome_healing', 'tome_blight', 'tome_firewall',
    'fireball_scroll', 'explosive_flask', 'fear_scroll', 'treasure_map', 'sleep_powder', 'psychosis_powder',
  ];
  const actionIds = Object.keys(CONSUMABLE_SPEC).filter(id => CONSUMABLE_SPEC[id].method);
  assert.eq(actionIds.slice().sort().join('|'), ids.slice().sort().join('|'),
    'the button action set and the spec are the same set');
  for (const id of ids) {
    const row = CONSUMABLE_SPEC[id];
    assert.truthy(ITEM_BY_ID[id], `${id}: real item`);
    assert.truthy(row && row.verb && row.title && row.method, `${id}: complete action row`);
    assert.truthy(new RegExp(`\\n  ${row.method}\\(`).test(SCENE_SRC),
      `${id}: MapScene implements ${row.method}`);
  }
  assert.truthy(/const cfg = sel && CONSUMABLE_SPEC\[sel\.id\];/.test(SCENE_SRC),
    'the button reads the static owner instead of rebuilding a local registry');
  assert.falsy(/const CONSUMABLE = \{/.test(SCENE_SRC),
    'app.js has no second action registry');
});

test('consumables: gameplay numbers read the owning spec rows', () => {
  assert.eq(CONSUMABLE_SPEC.torch.radiusMul, 2, 'torch range remains in the gameplay spec');
  assert.eq(CONSUMABLE_SPEC.growth_powder.radiusM, CONSUMABLE_SPEC.rainberry.radiusM,
    'growth powder reuses the rainberry crop radius');
  assert.truthy(/const DRAGON_WALK_COST_TIER = CONSUMABLE_SPEC\.dragon_powder\.movementTier;/.test(SCENE_SRC),
    'dragon walking derives from the row');
  assert.truthy(/const SPEED_POTION_WALK_COST_TIER = CONSUMABLE_SPEC\.speed_potion\.movementTier;/.test(SCENE_SRC),
    'speed-potion walking derives from the row');
});

test('effect line: a tap opens the whole description in a dialog', () => {
  const m = SCENE_SRC.match(/\n  _effectLineEl\(text, titleHTML\) \{[\s\S]*?\n  \}\n/);
  assert.truthy(m, '_effectLineEl exists');
  assert.truthy(/pointer-events:auto/.test(m[0]), 'the line opts back into taps');
  assert.truthy(/showMessageModal\(/.test(m[0]), 'the tap opens a message dialog');
  const uses = SCENE_SRC.match(/this\._effectLineEl\(/g) || [];
  assert.eq(uses.length, 2, 'both ✦ lines (item and relic) go through it');
  assert.eq((SCENE_SRC.match(/textContent = `✦/g) || []).length, 1, 'the helper builds the only ✦ line');
});
