// A FOE ON FIRE (combat.js ignite / burning / burnTick): the `burning` row of
// Conditions.DEFINITIONS — 1 HP a second for 5 s, out on its own — lit by a
// melee blow while a Torch burns (app.js combat wheel, the player's kill), by
// standing in a campfire (FIRE_TOUCH_CELLS) or in lava (scene_creatures.js,
// the ground's kill). The player catches it the same two ways (app.js
// _tickFireTouch / _tickLava → _ignitePlayer). Both bodies wear the row's
// tint, flickering.
(function () {
const code = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const def = Conditions.DEFINITIONS.burning;

test('burning foe: five points over five seconds, then out — every tick lands however late the frame', () => {
  const c = { kind: 'skeleton' };
  assert.truthy(Combat.canBurn(c));
  assert.truthy(Combat.ignite(c, 1000, 'player'), 'fresh');
  assert.truthy(Combat.burning(c, 1000));
  assert.eq(Combat.burnTick(c, 1999), 0);
  assert.eq(Combat.burnTick(c, 2000), def.energyLoss, 'a second in');
  assert.eq(Combat.burnTick(c, 6000), 4 * def.energyLoss, 'a dropped frame still pays every tick');
  assert.falsy(Combat.burning(c, 6001), 'and it is out');
  assert.eq(Combat.burnTick(c, 7000), 0);
  assert.eq(c._burnBy, null);
  assert.eq(Combat.burnTick({ kind: 'skeleton' }, 5), 0, 'never lit: nothing due');
});

test('burning foe: a fresh contact restarts the five seconds, keeps the cadence and the kill', () => {
  const c = { kind: 'skeleton' };
  Combat.ignite(c, 0, 'player');
  Combat.burnTick(c, 1000);
  assert.falsy(Combat.ignite(c, 1500, 'fire'), 'not fresh');
  assert.eq(c._burnUntilT, 6500);
  assert.eq(c._burnNextT, 2000, 'the next tick is where it was');
  assert.eq(c._burnBy, 'fire', 'the latest source owns the burn');
});

test('burning foe: the demons\' lava immunity covers fire too — one flag', () => {
  const demon = { kind: 'red_demon' };
  assert.truthy(Combat.monster('red_demon').lavaImmune);
  assert.falsy(Combat.canBurn(demon));
  assert.falsy(Combat.ignite(demon, 0, 'player'));
  assert.falsy(Combat.burning(demon, 1));
  assert.truthy(Combat.canBurn({ kind: 'slime' }), 'the surface slime burns');
});

test('source: a lit torch\'s blow sets the foe alight after the blow lands, as the player\'s kill', () => {
  const i = SCENE_SRC.indexOf('if (this._damageEnemy(c, blow)) return;');
  assert.truthy(i > 0);
  const after = code(SCENE_SRC.slice(i, i + 600));
  assert.truthy(/if \(this\.isTorchActive\(\)\) Combat\.ignite\(c, now, 'player'\);/.test(after),
    'the torch lights what the blow leaves standing');
});

test('source: campfires and lava light foes; the burn ticks through the one damage lane, armour never soaking it', () => {
  const start = SCENE_SRC.indexOf('      // ON FIRE (Combat.ignite');
  const end = SCENE_SRC.indexOf('      // LAVA BURNS FOES TOO', start);
  assert.truthy(start > 0 && end > start);
  const body = SCENE_SRC.slice(start, end);
  const tick = new Function('c', 'isTame', 'now', 'FIRE_TOUCH_CELLS', body);
  const hurt = [];
  const scene = {
    _nearAny: (key, x, y, r) => key === 'fires' && x === 1,
    _damageEnemy: (c, dmg, source, opts) => { hurt.push({ kind: c.kind, dmg, source, opts }); return false; },
  };
  const byFire = { kind: 'skeleton', x: 1, y: 0 };
  tick.call(scene, byFire, false, 0, 0.6);
  assert.truthy(Combat.burning(byFire, 1), 'standing in the hearth lights it');
  assert.eq(byFire._burnBy, 'fire');
  tick.call(scene, byFire, false, 1000, 0.6);
  assert.eq(hurt.length, 1); assert.eq(hurt[0].source, 'burn'); assert.eq(hurt[0].dmg, def.energyLoss);
  assert.truthy(hurt[0].opts.bypassArmor, 'a burn is never soaked');
  const pet = { kind: 'slime', id: 'released_1', x: 1, y: 0 };
  tick.call(scene, pet, true, 0, 0.6);
  assert.falsy(Combat.burning(pet, 1), 'a pet is never burned');
  const demon = { kind: 'red_demon', x: 1, y: 0 };
  tick.call(scene, demon, false, 0, 0.6);
  assert.falsy(Combat.burning(demon, 1));
  const torched = { kind: 'skeleton', x: 5, y: 0 };
  Combat.ignite(torched, 0, 'player');
  tick.call(scene, torched, false, 1000, 0.6);
  assert.eq(hurt[1].source, 'player', 'a torch burn is the player\'s kill');
  // Lava sets the foe alight too, so the burn outlasts the step out.
  assert.truthy(/if \(under\.loaded && under\.type === WorldGen\.T\.CAVE_LAVA\) Combat\.ignite\(c, now, 'lava'\);/.test(SCENE_SRC));
  assert.truthy(/source === 'lava' \|\| source === 'light' \|\| source === 'burn'/.test(SCENE_SRC), '_damageEnemy bypasses armour for a burn');
  assert.falsy(Combat.isPlayerKill('burn'), 'a fire\'s or lava\'s burn pays the bounty coin and nothing past it');
});

test('player: standing in a campfire or lava sets the farmer burning, once a second, never off an empty bar', () => {
  const body = SCENE_SRC.match(/\n  _ignitePlayer\(\) \{([\s\S]*?)\n  \}\n/)[1];
  const fn = new Function('Combat', 'Conditions', 'performance', body);
  let now = 1000; const applied = [];
  const scene = { save: { energy: 10 }, _applyCondition: (id) => applied.push(id) };
  const call = () => fn.call(scene, Combat, Conditions, { now: () => now });
  assert.truthy(call()); assert.eq(applied.length, 1); assert.eq(applied[0], 'burning');
  now += 500; assert.falsy(call(), 'throttled to the tick interval'); assert.eq(applied.length, 1);
  now += 500; assert.truthy(call()); assert.eq(applied.length, 2);
  now += 1000; scene.save.energy = 0; assert.falsy(call(), 'downed: no fire');
  // Wired: the hearth's touch ring under a cell, the lava tick, and the update loop.
  const touch = SCENE_SRC.match(/\n  _tickFireTouch\(\) \{([\s\S]*?)\n  \}\n/);
  assert.truthy(touch && /this\._nearAny\('fires', px, py, FIRE_TOUCH_CELLS\)\) this\._ignitePlayer\(\)/.test(touch[1]));
  assert.truthy(/const FIRE_TOUCH_CELLS = 0\.6;/.test(SCENE_SRC), 'in the hearth, not by it');
  const lava = SCENE_SRC.match(/\n  _tickLava\(dt\) \{([\s\S]*?)\n  \}\n/)[1];
  assert.truthy(/this\._ignitePlayer\(\);/.test(lava), 'lava lights the farmer too');
  assert.truthy(/this\._tickLava\(dt\);\s*\n\s*\/\/[^\n]*\n\s*this\._tickFireTouch\(\);/.test(SCENE_SRC), 'ticked beside lava');
});

test('look: both bodies wear the row\'s tint, and the HUD chips come off the table', () => {
  assert.truthy(/Combat\.burning\(c\) && Conditions\.conditionTintOn\('burning', performance\.now\(\)\)/.test(RENDER_SRC));
  assert.truthy(/afire \? Conditions\.DEFINITIONS\.burning\.tint/.test(RENDER_SRC), 'a burning foe');
  assert.truthy(/Conditions\.DEFINITIONS\[burning \? 'burning' : 'poison'\]\.tint/.test(SCENE_SRC), 'the burning or poisoned farmer');
  const hud = SCENE_SRC.match(/\n  _syncStatusRow\(\) \{([\s\S]*?)\n  \}\n/)[1];
  assert.truthy(/Object\.entries\(Conditions\.DEFINITIONS\)/.test(hud), 'one chip per row');
  assert.falsy(/'condition-poison'/.test(hud), 'no row named by hand');
});
})();
