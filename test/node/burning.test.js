// A FOE ON FIRE (combat.js ignite / burning / burnTick): the `burning` row of
// Conditions.DEFINITIONS — accumulated exposure controls damage — lit by a
// melee blow while a Torch burns (app.js combat wheel, the player's kill), by
// standing in a campfire (FIRE_TOUCH_CELLS) or in lava (scene_creatures.js,
// the ground's kill). The player catches it the same two ways (app.js
// _tickFireTouch / _tickLava → _ignitePlayer). Both bodies wear the row's
// tint, flickering.
(function () {
const code = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const def = Conditions.DEFINITIONS.burning;

test('burning foe: exposure and decay use the player clock even after dropped frames', () => {
  const c = { kind: 'skeleton' };
  assert.truthy(Combat.ignite(c, 1000, 'player'));
  assert.truthy(Combat.burning(c, 1000));
  assert.eq(Combat.burnTick(c, 2000, true), 1);
  assert.eq(c._burnState.remainingMs, 10000);
  const expected = Conditions.advanceBurn(c._burnState, 10000, true);
  assert.eq(Combat.burnTick(c, 12000, true), expected.damage);
  assert.eq(c._burnState.remainingMs, 60000);
  assert.eq(Combat.burnTick(c, 13000, true), 6);
  assert.eq(Combat.burnTick(c, 14000), 5);
  assert.eq(c._burnState.remainingMs, 59000);
  Combat.burnTick(c, 73000);
  assert.falsy(Combat.burning(c, 73000));
  assert.eq(c._burnBy, null);
  assert.eq(Combat.burnTick({ kind: 'skeleton' }, 5), 0);
});

test('burning foe: repeat contact preserves duration and cadence, updates the source', () => {
  const c = { kind: 'skeleton' };
  Combat.ignite(c, 0, 'player');
  Combat.burnTick(c, 1000, true);
  assert.falsy(Combat.ignite(c, 1500, 'fire'));
  assert.eq(c._burnState.remainingMs, 10000);
  assert.eq(c._burnAtT + c._burnState.nextTickMs, 2000, 'the next tick keeps its cadence');
  assert.eq(c._burnBy, 'fire');
  assert.eq(Combat.burnTick(c, 2000, true), 1);
  assert.eq(c._burnState.remainingMs, 15000);
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

test('fire contact: every unit catches fire and ticks through its damage path', () => {
  const hurt = [];
  const scene = Object.assign(new SceneFire(), {
    save: {},
    _groundFireAtWorld: () => null,
    _nearAny: (key, x) => key === 'fires' && x === 1,
    _damageBurningUnit: (c, dmg, source) => { hurt.push({ kind: c.kind, dmg, source }); return false; },
  });
  for (const c of [
    { kind: 'skeleton', id: 'foe', x: 1, y: 0 },
    { kind: 'slime', id: 'released_1', x: 1, y: 0 },
    { kind: 'chicken', id: 'animal', x: 1, y: 0 },
    { kind: 'npc', id: 'neighbour', x: 1, y: 0 },
    { kind: 'spirit_raven', id: 'ally', x: 1, y: 0 },
  ]) {
    scene._tickUnitFire(c, 0);
    assert.truthy(Combat.burning(c, 1), c.kind + ' catches fire');
    scene._tickUnitFire(c, 1000);
    assert.eq(hurt.at(-1).kind, c.kind);
    assert.eq(hurt.at(-1).dmg, def.energyLoss);
  }
  assert.eq(hurt.length, 5);
  const demon = { kind: 'red_demon', x: 1, y: 0 };
  scene._tickUnitFire(demon, 0);
  assert.falsy(Combat.burning(demon, 1), 'existing fire immunity still applies');
  const torched = { kind: 'skeleton', x: 5, y: 0 };
  Combat.ignite(torched, 0, 'player');
  Combat.burnTick(torched, 3000, true);
  scene._tickUnitFire(torched, 4000);
  assert.eq(hurt.at(-1).source, 'player');
  scene._tickUnitFire(torched, 23000);
  assert.eq(hurt.at(-1).source, 'player', 'last damaging tick retains its source');
});

test('fire damage: wildlife, pets, allies and NPCs keep their existing defeat or recovery rules', () => {
  const events = [];
  const scene = Object.assign(new SceneFire(), {
    save: {},
    _damageEnemy: (c, amount, source, options) => {
      events.push({ c, amount, source, options }); return true;
    },
    _popDamageNumber: () => {},
  });
  assert.truthy(scene._damageBurningUnit({ kind: 'chicken' }, 2, 'burn', 1000));
  assert.truthy(events[0].options.bypassArmor);
  const animal = { kind: 'chicken' };
  scene._workProgress = { flee: animal };
  scene.cancelWorkProgress = () => { scene._workProgress = null; };
  scene._damageBurningUnit(animal, 2, 'burn', 1000);
  assert.eq(scene._workProgress, null, 'a dead animal cannot finish the catch wheel');
  const pet = { kind: 'dog', id: 'released_dog', _hp: 1 };
  assert.falsy(scene._damageBurningUnit(pet, 2, 'burn', 1000));
  assert.eq(pet._hp, 1);
  assert.eq(pet._retreatUntilT, 1000 + Companions.RECOVERY_MS);
  const ally = { kind: 'spirit_raven', id: 'ally', _hp: 1 };
  assert.truthy(scene._damageBurningUnit(ally, 2, 'burn', 1000));
  assert.truthy(ally._spent);
  const npc = { kind: 'npc', id: 'neighbour' };
  assert.falsy(scene._damageBurningUnit(npc, 2, 'burn', 1000));
  assert.eq(Combat.hp(npc), Combat.maxHp(npc) - 2, 'burning chips actual neighbour health');
  assert.falsy(NPC.isDormant(npc), 'a surviving neighbour stays on their feet');
  scene._damageBurningUnit(npc, Combat.hp(npc), 'burn', 2000);
  assert.truthy(NPC.isDormant(npc), 'a neighbour rests when the burn exhausts their health');
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
  assert.truthy(/tint = Conditions\.DEFINITIONS\[status\]\.tint;/.test(SCENE_SRC), 'the burning or poisoned farmer');
  const hud = SCENE_SRC.match(/\n  _syncStatusRow\(\) \{([\s\S]*?)\n  \}\n/)[1];
  assert.truthy(/Object\.entries\(Conditions\.DEFINITIONS\)/.test(hud), 'one chip per row');
  assert.falsy(/'condition-poison'/.test(hud), 'no row named by hand');
});
})();
