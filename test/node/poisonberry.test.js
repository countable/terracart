// THE POISONBERRY — a wild teal-berried bush. Eaten, its berry lands the
// `poison` row of Conditions.DEFINITIONS on the player (the mushroom's
// CONSUMABLE_SPEC `condition` lane); offered to an enemy (interact.js, the
// `feedsFoe` flag) it lands the same row on the enemy through Combat.poison,
// the Poison Flask's call. One row, two bodies, no number of its own.
(function () {
const ID = 'poisonberry';

test('poisonberry: a wild produce item eaten through the condition lane', () => {
  const it = ITEM_BY_ID[ID];
  assert.truthy(it, 'registered'); assert.eq(it.kind, 'produce'); assert.eq(it.crop, ID);
  assert.gt(PRICES[ID], 0);
  assert.truthy(ID in FOOD_ENERGY, 'the Eat button offers it');
  const row = CONSUMABLE_SPEC[ID];
  assert.eq(row.condition, 'poison');
  assert.eq(row.durationMs, undefined, 'the poison row\'s own minute');
  assert.truthy(row.feedsFoe);
  assert.truthy(Conditions.DEFINITIONS[row.condition]);
});

test('poisonberry: a bush with teal berries, its own icon, walked like a bush', () => {
  assert.eq(CROP_SPRITE[ID].sheet, 'bushes', 'seats on the shared bush frame');
  assert.eq(CROP_SPRITE[ID].texture, 'bushes_poisonberry');
  assert.eq(wildplantSprite({ crop: ID, kind: 'wildplant' }).texture, 'bushes_poisonberry');
  const icon = inventoryIconSource(ID);
  assert.eq(icon.sheet, 'springcrops');
  assert.truthy(/hue-rotate/.test(icon.filter), 'the berry icon, recoloured');
  assert.truthy(ObstacleStep.profile({ kind: 'wildplant', crop: ID }), 'a bush underfoot');
});

test('poisonberry: grows wild in forest and wetland', () => {
  const T = WorldGen.T;
  for (const type of [T.FOREST, T.WETLAND])
    assert.truthy(BiomeProfiles.flora(type).some(r => r.crop === ID), 'flora row on ' + type);
});

test('poisonberry: fed to an enemy, it poisons the enemy through Combat.poison', () => {
  const branch = INTERACT_SRC.slice(INTERACT_SRC.indexOf('A POISONBERRY, offered'));
  assert.truthy(/Combat\.isEnemy\(target\) && CONSUMABLE_SPEC\[held\]\?\.feedsFoe/.test(branch));
  assert.truthy(/Combat\.poison\(target, performance\.now\(\), 'player'\);\s*consumeSelected\(save\);/.test(branch));
  // The branch precedes the enemy-name tap, which would otherwise swallow it.
  assert.lt(INTERACT_SRC.indexOf('A POISONBERRY, offered'), INTERACT_SRC.indexOf('if (Combat.isEnemy(target)) {'));
});
})();
