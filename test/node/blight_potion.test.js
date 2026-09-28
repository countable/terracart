// The Potion of Blight: a minute of a round aura around the player's feet that
// takes BLIGHT_DPS HP a second off every ENEMY inside BLIGHT_R_CELLS.
//
// The bite lives in a Phaser scene method, so it is pinned as source text:
// that it asks Combat.isEnemy (never a crow, a deer or a pet), measures from
// the FEET (playerM, not the camera anchor), and lands through _damageEnemy
// (the one lane that pops the numbers and pays the kill).

(function () {
const app = APP_JS_SRC;

test('blight potion: an item with a price, a tier, an icon and a ✦ line', () => {
  assert.truthy(ITEM_BY_ID.blight_potion, 'the catalogue knows it');
  assert.eq(ITEM_BY_ID.blight_potion.kind, 'magic', 'drunk, not eaten');
  assert.eq(FOOD_ENERGY.blight_potion, undefined, 'it can never reach the Eat button');
  assert.truthy(ITEM_EFFECTS.blight_potion, 'its effect is written on the item');
  assert.truthy(ITEM_EFFECTS.blight_potion.includes(`${CONSUMABLE_SPEC.blight_potion.damagePerSecond} HP/s`),
    'the effect line reads the damage owner instead of retyping it');
  assert.eq(CONSUMABLE_SPEC.blight_potion.method, 'drinkBlightPotion', 'the Drink button offers it');
});

test('blight potion: 1.5 cells, 2 HP a second, one minute', () => {
  assert.eq(CONSUMABLE_SPEC.blight_potion.radiusCells, 1.5, 'radius');
  assert.eq(CONSUMABLE_SPEC.blight_potion.damagePerSecond, 2, 'damage per second');
  assert.eq(CONSUMABLE_SPEC.blight_potion.durationMs, 60 * 1000, 'duration');
  assert.truthy(/const BLIGHT_R_CELLS = CONSUMABLE_SPEC\.blight_potion\.radiusCells;/.test(app),
    'runtime derives the radius');
});

test('blight potion: the aura bites enemies from the feet, through _damageEnemy', () => {
  const a = app.indexOf('  _tickBlightAura() {');
  const b = app.indexOf('\n  }\n', a);
  assert.truthy(a > 0 && b > a, 'found _tickBlightAura in app.js');
  const body = app.slice(a, b);
  assert.truthy(/this\.startWorldM\.x \+ this\.playerM\.x/.test(body), 'measured from the player, not the camera');
  assert.truthy(/Combat\.isEnemy\(c\)/.test(body), 'enemies only');
  assert.truthy(/caughtSet\.has\(c\.id\)/.test(body), 'never a caught creature');
  assert.truthy(/this\._damageEnemy\(c, rate \* dt, 'player', \{ bypassArmor: true \}\)/.test(body), 'through the one damage lane');
  assert.truthy(/const rate = Combat\.mitigate\(BLIGHT_DPS, Combat\.monster\(c\.kind\)\?\.armor \|\| 0\);/.test(body), 'armour applies once to a one-second damage packet');
});

test('blight potion: the drawn disc is exactly the damage radius wide', () => {
  assert.truthy(/const d = 2 \* BLIGHT_R_CELLS \* CELL_PX;/.test(app),
    'the aura image is sized off the same radius the bite reads');
});
})();
