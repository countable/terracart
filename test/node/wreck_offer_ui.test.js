// Offer presentation and the shared reroll purchase route.
(() => {
  function method(name, deps = {}) {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return new Function(...Object.keys(deps), 'return ({' + SCENE_SRC.slice(start + 1, end + 4) + '});')(...Object.values(deps))[name];
  }
  const offer = { key: 'contract', reward: 50, name: 'Private Contract', blurb: 'Private Contract: earn $50 for building anything here.' };

  test('wreck offers: house type and rank screens show the site offer alongside the hammer', () => {
    const siteHouses = Object.assign({}, Houses, { wreckOffer: () => offer });
    const present = method('presentWreckRestoreModal', { Houses: siteHouses });
    let modal;
    const save = { restoredHouses: {}, inv: [{ id: 'magic_hammer', count: 1 }], discovered: Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['m' + i, true])) };
    for (let i = 0; i < 30; i++) save.restoredHouses['old-' + i] = 'plain';
    const scene = {
      save, showOfferModal(o) { modal = o; }, iconSpanHTML: () => '', worldIconHTML: () => '',
    };
    present.call(scene, 0, 0, { kind: 'house', tier: 9, id: 'site' });
    assert.eq(modal.blurb, offer.blurb);
    const ranked = modal.choices.find(c => c.onSelect);
    assert.truthy(ranked, 'advanced player has a ranked construction choice');
    ranked.onSelect();
    assert.truthy(modal.blurb.includes(offer.blurb));
    assert.truthy(modal.blurb.includes('Magic Hammer'), 'existing hammer action remains explained');
  });

  test('wreck offers: borrowed house materials cannot start a rewarded build', () => {
    let modal, worked = false;
    const scene = {
      save: { inv: [{ id: 'rubble', count: 9 }], scholarLoans: { rubble: 9 }, restoredHouses: {} },
      showOfferModal(o) { modal = o; }, iconSpanHTML: () => '', worldIconHTML: () => '', flash() {},
      _afterWreckGather() { worked = true; },
    };
    method('presentWreckRestoreModal').call(scene, 0, 0, { kind: 'house', tier: 9, id: 'loan-site' });
    assert.falsy(modal.choices.find(c => c.key === 'plain').canAfford);
    modal.onAccept('plain');
    assert.falsy(worked); assert.falsy(scene.save.restoredHouses['loan-site']);
  });

  test('wreck offers: completing a house contract pays once and visibly confirms its reward', () => {
    let modal;
    const flashes = [], save = { inv: [{ id: 'rubble', count: 9 }], restoredHouses: {} };
    let house;
    for (let i = 0; i < 1000; i++) {
      const candidate = { kind: 'house', tier: 9, id: 'ui-contract-' + i };
      if (Houses.wreckOffer(save, candidate)?.key === 'contract') { house = candidate; break; }
    }
    assert.truthy(house, 'fixture finds a contract site');
    const scene = {
      save, showOfferModal(o) { modal = o; }, iconSpanHTML: () => '', worldIconHTML: () => '', flash() {},
      _afterWreckGather: fn => fn(), _clampSelSlot() {}, buildInventoryDOM() {}, questEvent() {},
      _houseBlastGeometry: () => ({ x: 0, y: 0 }), _blastAt() {},
      flashLoot(text) { flashes.push(text); },
    };
    method('presentWreckRestoreModal').call(scene, 0, 0, house);
    modal.onAccept('plain');
    assert.eq(save.money, 50);
    assert.truthy(flashes.includes('+50 contract'));
    modal.onAccept('plain');
    assert.eq(save.money, 50, 'a stale action cannot repeat the contract');
  });

  test('blessed rerolls: quoted discount is charged only when a new offer exists', () => {
    const make = method('_makeRerollSecondary', {
      Houses: Object.assign({}, Houses, { rerollPriceMul: (save, h) => h.id === 'blessed' ? .67 : 1 }),
    });
    let presentCount = 0;
    const cur = { rerolls: 0 };
    const scene = {
      save: { money: 100 }, shopBucketState: () => cur, moneyHTML: n => String(n), flash() {},
    };
    const args = [0, 0, 'Empty', () => presentCount++, { cost: () => 10, current: { id: 'old' }, peek: () => ({ id: 'new' }) }];
    const blessed = make.call(scene, { id: 'blessed' }, ...args);
    assert.truthy(blessed.label.includes('>7</span>'));
    blessed.onClick();
    assert.eq(scene.save.money, 93); assert.eq(presentCount, 1);
    const ordinary = make.call(scene, { id: 'ordinary' }, ...args);
    ordinary.onClick();
    assert.eq(scene.save.money, 83, 'ordinary rerolls keep full price');
    const empty = make.call(scene, { id: 'blessed' }, 0, 0, 'Empty', () => presentCount++, { cost: () => 10, peek: () => null });
    empty.onClick();
    assert.eq(scene.save.money, 83, 'failed reroll is free');
    scene.save.money = 6;
    const poor = make.call(scene, { id: 'blessed' }, ...args);
    assert.truthy(poor.disabled); poor.onClick(); assert.eq(scene.save.money, 6);
  });
})();
