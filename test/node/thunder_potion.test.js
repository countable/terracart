// The Scroll of Thunder (T4): a white flash, THUNDER_DMG to every ENEMY
// visible on screen through the one damage lane, and whatever it leaves
// standing turns tail on the ordinary wander-off (monsterRout) — away from the
// player, to the usual random range, standing down the whole way.
//
// The drink is a Phaser scene method, so the wiring is pinned as source text;
// the retreat itself is the real monsterRout, run below.

(function () {
const app = SCENE_SRC;
// The scroll is a CAST_ROWS row cast by _castOnFoes (the one "every foe in
// sight" lane); the targets come from _enemiesWhere / _onscreenEnemies.
const row = (() => {
  const a = app.indexOf('  thunder_scroll: { noun:');
  assert.truthy(a > 0, 'found the thunder row of CAST_ROWS');
  return app.slice(a, app.indexOf('\n  fear_scroll:', a));
})();
const cast = app.match(/\n  _castOnFoes\(id, [^\n]*\) \{\n([\s\S]*?)\n  \}\n/)[1];
const body = row + cast + app.match(/\n  _enemiesWhere\(where\) \{\n([\s\S]*?)\n  \}\n/)[1]
  + app.match(/\n  _onscreenEnemies\(\) \{\n([\s\S]*?)\n  \}\n/)[1];

test('thunder scroll: a T4 scroll with a price, an icon and a ✦ line quoting its damage', () => {
  assert.eq(THUNDER_DMG, 25, '25 damage');
  assert.eq(BASE_TIER.thunder_scroll, 4, 'tier 4');
  assert.eq(ITEM_BY_ID.thunder_scroll?.kind, 'magic', 'read, not eaten');
  assert.eq(FOOD_ENERGY.thunder_scroll, undefined, 'never on the Eat button');
  assert.gt(PRICES.thunder_scroll, 0, 'priced');
  assert.truthy(ITEM_BY_ID.thunder_scroll.scroll);
  assert.eq(inventoryIconSource('thunder_scroll').sheet, 'icon_thunder_scroll', 'lightning-stamped parchment');
  assert.eq(inventoryIconSource('thunder_scroll').frame, 0, 'dedicated icon frame');
  assert.falsy(isPotion('thunder_scroll'));
  assert.eq(CONSUMABLE_SPEC.thunder_scroll.verb, 'Read');
  assert.truthy(HOME_RECIPES.some(r => r.id === 'thunder_scroll'));
  assert.truthy(cast.includes('this._spendScroll(id);'), 'successful cast teaches its recipe');
  assert.truthy(CONSUMABLE_SPEC.thunder_scroll.damage > 0 && !CONSUMABLE_SPEC.thunder_scroll.buff, 'a cast, not a timed buff');
  assert.falsy(/\d/.test(ITEM_EFFECTS.thunder_scroll), 'the storm hints at its power');
  assert.truthy(SCENE_SRC.includes('\n  thunder_scroll: { noun:'), 'the Read button routes it as a cast row');
  assert.truthy(Shops.themedStock('potion', 4).includes('thunder_scroll'), 'a T4 potion shop stocks it');
});

test('thunder scroll: enemies in SIGHT, through _damageEnemy, the rest routed', () => {
  assert.truthy(/Combat\.isEnemy\(c\)/.test(body), 'enemies only — never a crow, a deer or a pet');
  assert.truthy(/caught\.has\(c\.id\)/.test(body), 'never a caught creature');
  assert.truthy(/Particles\.onScreen\(this, p\.x, p\.y\)/.test(body) && /this\.worldMetersToScreen\(c\.x, c\.y\)/.test(body),
    '"visible" is the draw-space viewport test, not reach');
  assert.truthy(/s\._damageEnemy\(c, damage\)/.test(row) && /_castOnFoes\(id, \{ damage = CONSUMABLE_SPEC\[id\]\?\.damage/.test(app),
    'through the one damage lane, at the row\'s THUNDER_DMG (a tome passes half)');
  assert.truthy(/if \(!c\.lair\) monsterRout\(c, now, s\.cellM\);/.test(row),
    'survivors take the ordinary wander-off; a lair guard keeps its own leash');
  assert.truthy(/s\.cameras\?\.main\?\.flash\(THUNDER_FLASH_MS, 255, 255, 255\)/.test(row), 'the screen flashes white');
  assert.truthy(/noun: 'scroll'/.test(row) && /kept\(reach \? 'No foe in reach' : 'No foe in sight', noun \|\| row\.noun\)/.test(cast)
    && cast.indexOf('return false;') < cast.indexOf('this._spendScroll(id);'), 'nothing in sight: refused before the spend, scroll kept');
});

test('thunder scroll: the retreat is the wander-off, to the usual random range', () => {
  const rout = eval('(' + CREATURE_AI_SRC.match(/function monsterRout\(c, now, cellM\) \{[\s\S]*?\n\}/)[0] + ')');
  const g = globalThis;
  // monsterRout reads these module constants; lift their values.
  const num = (k) => Number(CREATURE_AI_SRC.match(new RegExp(`const ${k} = ([^;]+);`))[1].replace(/\s*\*\s*/g, '*').split('*').reduce((a, b) => a * Number(b), 1));
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
  assert.truthy(/if \(c\._wanderOffInMs > 0\) return false;\s*\n\s*monsterRout\(c, now, cellM\);/.test(CREATURE_AI_SRC),
    'the scheduled wander-off starts through the same function');
});
})();
