// Energy is a WHOLE number, and Energy.set is its one writer.
//
// A blow is scaled by Combat.powerMul (elite / lair) and the mode's
// enemyDmgMul, so it can be fractional; banked with a raw
// `save.energy = Math.max(0, before - dmg)` it left a save on 99.948…⚡.
// Energy.set rounds, floors at 0 and caps at the max it's handed. These pin
// the rule, and sweep src/ for any write that goes around it.

test('Energy.set: rounds, floors at 0, caps at the given max', () => {
  const save = { energy: 100 };
  assert.eq(Energy.set(save, 100 - 1.5), 99, 'a fractional blow lands whole');
  assert.eq(save.energy, 99, 'and is what the save holds');
  assert.eq(Energy.set(save, 99.948488484), 100, 'the reported reading heals');
  assert.eq(Energy.set(save, -7), 0, 'floored at 0');
  assert.eq(Energy.set(save, 140, 120), 120, 'a gain is capped at maxE');
  assert.eq(Energy.set(save, 50.2, 120), 50, 'under the cap, just rounded');
  assert.eq(Energy.set(save, NaN), 50, 'a non-finite value keeps the reading');
  assert.eq(Energy.set({}, undefined), 0, 'nothing to keep → 0, never NaN');
});

test('Energy.set: a blow of at least 1 always costs at least 1', () => {
  // mitigate floors a blow at MIN_PLAYER_DAMAGE (1); rounding the RESULT must
  // never turn a real hit into a free one.
  for (const dmg of [1, 1.2, 1.5, 1.8, 2.5, 3.49]) {
    const save = { energy: 50 };
    Energy.set(save, 50 - dmg);
    assert.lte(save.energy, 49, `a ${dmg}⚡ blow`);
  }
});

test('Energy.set: spend and offline rest leave whole numbers', () => {
  const save = { energy: 80, maxEnergy: 100 };
  Energy.spend(save, 2.4);
  assert.eq(save.energy, Math.round(save.energy), 'spend');
  Energy.applyOfflineRest(save, Energy.OFFLINE_FULL_REST_MS / 7);
  assert.eq(save.energy, Math.round(save.energy), 'offline rest');
});

test('Energy.set is the only writer of save.energy in src/', () => {
  // save_state.js normalises a LOADED save (a missing reading becomes a full
  // bar, then rounded) before any of this runs — the one sanctioned exception.
  const EXEMPT = new Set(['energy.js', 'save_state.js']);
  const WRITE = /\.energy\s*(=(?!=)|\+\+|--|[-+*/]=)/;
  const bad = [];
  for (const [file, src] of Object.entries(ENERGY_WRITE_SOURCES)) {
    if (EXEMPT.has(file)) continue;
    src.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (WRITE.test(code)) bad.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.eq(bad.length, 0, 'raw energy writes (use Energy.set):\n  ' + bad.join('\n  '));
});

test('bed Sleep restores through the shared integer energy writer and preserves other state', () => {
  const record = { id: 'bed', itemId: 'bed_quilted' };
  const save = { furniture: [record], energy: 13, money: 25, eatReadyAt: 12345 };
  const scene = Object.assign(Object.create(SceneFurniture.prototype), {
    save, depth: 0, _furnitureAbilityAllowed: () => true, _zeroEnergyLocked: () => false,
    getMaxEnergy: () => 117, _popEnergy(gain) { this.gain = gain; },
    _restoreEnergy: liftSceneMethod('_restoreEnergy'),
  });
  assert.truthy(scene.useFurniture(record));
  assert.eq(save.energy, 117); assert.eq(scene.gain, 104);
  assert.eq(save.money, 25); assert.eq(save.eatReadyAt, 12345);
});

test('luxury rest: stochastic rounding is integer, time-scaled and unbiased with a seeded RNG', () => {
  const rng = makeRng32(1903);
  let total = 0;
  for (let i=0;i<10000;i++) {
    const gain = Furniture.restBonus(16,0.25,rng);
    assert.truthy(gain === 0 || gain === 1);
    total += gain;
  }
  assert.inRange(total,3800,4200,'expected 0.4 energy per quarter second');
  assert.eq(Furniture.restBonus(16,2,()=>0.1),4,'floor plus winning fractional draw');
  assert.eq(Furniture.restBonus(16,2,()=>0.9),3,'floor plus losing fractional draw');
  const noDraw = () => { throw new Error('integer or zero mean must not draw'); };
  assert.eq(Furniture.restBonus(0,1,noDraw),0);
  assert.eq(Furniture.restBonus(100,1,noDraw),10);
  assert.eq(Furniture.restBonus(16,0,noDraw),0);
});

test('luxury rest: the existing accrual caps the whole bonus and preserves fractional base healing', () => {
  const scene = {save:{energy:98},_bankDrain(){},_accrueRestEnergy:liftSceneMethod('_accrueRestEnergy')};
  scene._accrueRestEnergy('_restAccrueE',0.2+Furniture.restBonus(100,1),100);
  assert.eq(scene.save.energy,100);
  Energy.set(scene.save,50);
  scene._restAccrueE=0;
  for (let i=0;i<5;i++) scene._accrueRestEnergy('_restAccrueE',0.2+Furniture.restBonus(0,0.1),100);
  assert.eq(scene.save.energy,51,'zero luxury retains the base fractional bank');
});
