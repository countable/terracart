(function () {
  test('Fire Resistance potion: blocks fire completely until the exact expiry', () => {
    const until = 181000;
    const save = { energy: 100, fireResistancePotionUntil: until, fireDamageRemainder: 0.8 };
    assert.truthy(Conditions.fireImmune(save, 1000));
    assert.eq(Conditions.fireDamage(save, 30, until - 1), 0);
    assert.eq(save.fireDamageRemainder, 0, 'no fractional fire damage survives immunity');
    assert.falsy(Conditions.apply(save, 'burning', until - 1));
    assert.falsy(Conditions.active(save, 'burning'));
    assert.falsy(Conditions.fireImmune(save, until));
    assert.eq(Conditions.fireDamage(save, 30, until), 30);
    assert.truthy(Conditions.apply(save, 'burning', until));
  });

  test('Fire Resistance potion: extinguishes existing burns during exposure without protecting from poison', () => {
    const save = { energy: 100 };
    Conditions.apply(save, 'burning', 1000);
    Conditions.tick(save, 10000, { burningExposure: true, now: 11000 });
    Conditions.apply(save, 'poison', 11000);
    save.fireResistancePotionUntil = 191000;
    save.fireDamageRemainder = 0.6;
    const before = save.energy;
    const result = Conditions.tick(save, 2000, { burningExposure: true, now: 13000 });
    assert.truthy(result.expired, 'burn removal refreshes condition display');
    assert.falsy(Conditions.active(save, 'burning'));
    assert.truthy(Conditions.active(save, 'poison'));
    assert.eq(save.energy, before - 1, 'poison still damages the player');
    assert.eq(save.fireDamageRemainder, 0);
    Conditions.tick(save, 1000, { burningExposure: true, now: 191000 });
    assert.falsy(Conditions.active(save, 'burning'), 'the old burn never returns');
    assert.truthy(Conditions.apply(save, 'burning', 191000), 'fresh contact burns after expiry');
  });

  test('Fire Resistance potion: Ember Ring resumes fractional resistance after expiry and reload', () => {
    let save = { inv: [{ id: 'ember_ring', count: 1 }], fireResistancePotionUntil: 181000 };
    assert.eq(Conditions.fireDamage(save, 1, 180999), 0);
    save = JSON.parse(JSON.stringify(save));
    Conditions.normalize(save);
    assert.eq(Conditions.fireDamage(save, 1, 180999), 0);
    assert.eq(Conditions.fireDamage(save, 1, 181000), 0);
    assert.eq(Conditions.fireDamage(save, 1, 181001), 0);
    assert.eq(Conditions.fireDamage(save, 1, 181002), 1);
    assert.eq(Conditions.fireDamage(save, 30, 181003), 12);
  });
})();
