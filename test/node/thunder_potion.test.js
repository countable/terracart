// The Potion of Thunder (T4): a white flash, THUNDER_DMG to every ENEMY
// visible on screen through the one damage lane, and whatever it leaves
// standing turns tail on the ordinary wander-off (monsterRout) — away from the
// player, to the usual random range, standing down the whole way.
//
// The drink is a Phaser scene method, so the wiring is pinned as source text;
// the retreat itself is the real monsterRout, run below.

(function () {
const app = APP_JS_SRC;
const body = (() => {
  const a = app.indexOf('  drinkThunderPotion() {');
  assert.truthy(a > 0, 'found drinkThunderPotion');
  return app.slice(a, app.indexOf('\n  }\n', a));
})();

test('thunder potion: a T4 potion with a price, an icon and a ✦ line quoting its damage', () => {
  assert.eq(THUNDER_DMG, 10, '10 damage');
  assert.eq(BASE_TIER.thunder_potion, 4, 'tier 4');
  assert.eq(ITEM_BY_ID.thunder_potion?.kind, 'consumable', 'drunk, not eaten');
  assert.eq(FOOD_ENERGY.thunder_potion, undefined, 'never on the Eat button');
  assert.gt(PRICES.thunder_potion, 0, 'priced');
  assert.truthy(ITEM_EFFECTS.thunder_potion.includes(`${THUNDER_DMG} damage`), 'the ✦ line prints the live number');
  assert.truthy(/thunder_potion: \{ verb: 'Drink', method: 'drinkThunderPotion'/.test(app), 'the Drink button offers it');
  assert.truthy(Shops.themedStock('potion', 4).includes('thunder_potion'), 'a T4 potion shop stocks it');
});

test('thunder potion: enemies in SIGHT, through _damageEnemy, the rest routed', () => {
  assert.truthy(/Combat\.isEnemy\(c\)/.test(body), 'enemies only — never a crow, a deer or a pet');
  assert.truthy(/caughtSet\.has\(c\.id\)/.test(body), 'never a caught creature');
  assert.truthy(/Particles\.onScreen\(this, p\.x, p\.y\)/.test(body) && /this\.worldMetersToScreen\(c\.x, c\.y\)/.test(body),
    '"visible" is the draw-space viewport test, not reach');
  assert.truthy(/this\._damageEnemy\(c, THUNDER_DMG\)/.test(body), 'through the one damage lane');
  assert.truthy(/if \(!c\.lair\) monsterRout\(c, now, this\.cellM\);/.test(body),
    'survivors take the ordinary wander-off; a lair guard keeps its own leash');
  assert.truthy(/this\.cameras\?\.main\?\.flash\(THUNDER_FLASH_MS, 255, 255, 255\)/.test(body), 'the screen flashes white');
  assert.truthy(/potion kept/.test(body) && /return false;/.test(body), 'nothing in sight: refused, potion kept');
});

test('thunder potion: the retreat is the wander-off, to the usual random range', () => {
  const rout = eval('(' + app.match(/function monsterRout\(c, now, cellM\) \{[\s\S]*?\n\}/)[0] + ')');
  const g = globalThis;
  // monsterRout reads these module constants; lift their values.
  const num = (k) => Number(app.match(new RegExp(`const ${k} = ([^;]+);`))[1].replace(/\s*\*\s*/g, '*').split('*').reduce((a, b) => a * Number(b), 1));
  g.WANDER_OFF_TIMEOUT_MS = g.WANDER_OFF_TIMEOUT_MS ?? num('WANDER_OFF_TIMEOUT_MS');
  g.CREATURE_SIM_CELLS = g.CREATURE_SIM_CELLS ?? num('CREATURE_SIM_CELLS');
  g.WANDER_OFF_MAX_MUL = g.WANDER_OFF_MAX_MUL ?? num('WANDER_OFF_MAX_MUL');
  const c = { _nextChooseT: 5 };
  rout(c, 1000, 5);
  assert.gt(c._wanderOffUntilT, 1000, 'walking off, on a timeout');
  const edge = g.CREATURE_SIM_CELLS * 5;
  assert.truthy(c._wanderOffDistM >= edge && c._wanderOffDistM <= edge * g.WANDER_OFF_MAX_MUL,
    'out past the sim bubble\'s edge, by the usual random margin');
  assert.eq(c._nextChooseT, 1000, 'turning now, not finishing a hop at the player');
  assert.truthy(/if \(c\._wanderOffInMs > 0\) return false;\s*\n\s*monsterRout\(c, now, cellM\);/.test(app),
    'the scheduled wander-off starts through the same function');
});
})();
