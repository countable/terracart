(() => {
  function method(signature) {
    const start = SCENE_SRC.indexOf('\n  ' + signature);
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    assert.truthy(start >= 0 && end > start);
    return SCENE_SRC.slice(start + 1, end + 4);
  }
  const Scene = new Function(`return class {
    ${method('_storySplashOnce(key, { art, title, body, okLabel, onDismiss } = {}) {')}
    ${method('addToInv(id, n = 1, silent = false, opts = {}) {')}
    ${method('hatchEgg() {')}
  }`)();
  function scene() {
    const s = new Scene();
    s.save = { inv: [], caught: [], released: [], selSlot: -1 };
    s.modals = [];
    s._dialogOpen = () => !!document.body?.classList?.contains('modal-open');
    s.showMessageModal = card => s.modals.push(card);
    return s;
  }
  function withPortrait(fn) {
    const oldArt = PetStoryArt.forKind, oldBody = document.body;
    let busy = false;
    PetStoryArt.forKind = (_scene, kind) => 'portrait:' + kind;
    document.body = { classList: { contains: () => busy } };
    try { fn(value => { busy = value; }); }
    finally { PetStoryArt.forKind = oldArt; document.body = oldBody; }
  }

  test('pet stories: accepted pickups queue every animal, with baby and shiny sharing a species', () => {
    const s = scene();
    for (const item of Object.values(ITEM_BY_ID).filter(item => item.kind === 'animal')) {
      assert.eq(s.addToInv(item.id, 1, true), 1);
      assert.truthy(s.save.petStoriesPending.includes(item.base || item.id), item.id);
    }
    const species = new Set(Object.values(ITEM_BY_ID).filter(item => item.kind === 'animal').map(item => item.base || item.id));
    assert.eq(s.save.petStoriesPending.length, species.size);
    assert.eq(s.modals.length, 0, 'acquisition never interrupts its own reward dialog');
  });

  test('pet stories: full stacks, invalid pickups and produce never queue a pet', () => {
    const s = scene();
    s.save.inv = [{ id: 'cat', count: Inventory.stackCap(s.save) }];
    assert.eq(s.addToInv('cat', 1, true), 0);
    assert.eq(s.addToInv('dog', 0, true), 0);
    s.addToInv('milk', 1, true);
    assert.falsy(s.save.petStoriesPending);
  });

  test('pet stories: a hatched egg queues its first pet after a successful hatch only', () => {
    const s = scene();
    Object.assign(s, { _clampSelSlot() {}, buildInventoryDOM() {}, showBabyFound() {} });
    assert.falsy(s.hatchEgg());
    assert.falsy(s.save.petStoriesPending);
    s.save.inv = [{ id: 'egg', count: 1 }]; s.save.selSlot = 0;
    s.save.eggHatchM = EggHatch.METERS;
    assert.truthy(s.hatchEgg());
    const baby = s.save.inv.find(item => ITEM_BY_ID[item.id]?.baby);
    assert.eq(s.save.petStoriesPending.join(','), ITEM_BY_ID[baby.id].base);
  });

  test('pet stories: busy dialogs preserve queue through reload; each species opens once', () => withPortrait(setBusy => {
    let s = scene();
    s.addToInv('baby_cat', 1, true);
    s.addToInv('dog', 1, true);
    setBusy(true);
    assert.falsy(PetStories.drain(s));
    assert.falsy(s.save.storySeen?.['pet:cat']);
    const save = JSON.parse(JSON.stringify(s.save));
    s = scene(); s.save = save;
    setBusy(false);
    assert.truthy(PetStories.drain(s));
    assert.eq(s.modals.length, 1);
    assert.eq(s.modals[0].art, 'portrait:cat');
    assert.eq(s.save.petStoriesPending.join(','), 'dog');
    s.addToInv('shiny_cat', 1, true);
    assert.eq(s.save.petStoriesPending.join(','), 'dog');
    assert.truthy(PetStories.drain(s));
    assert.eq(s.modals[1].art, 'portrait:dog');
    assert.falsy(PetStories.drain(s));
    assert.eq(s.modals.length, 2);
  }));

  test('pet stories: in-place taming queues the new pet without a bag item', () => {
    const s = scene();
    s.save.inv = [{ id: 'mango', count: 1 }]; s.save.selSlot = 0;
    Object.assign(s, { tileEdgeM: 1000, buildInventoryDOM() {}, flashLoot() {}, homeWorldPos: () => null });
    const pet = { id: 'wild_slime', kind: 'slime', x: 20, y: 0 };
    tameInPlace(s, s.save, pet, 'Tamed', 'mango', 1);
    assert.eq(s.save.petStoriesPending.join(','), 'slime');
    assert.truthy(pet.id.startsWith('released_'));
    assert.eq(s.save.inv.length, 0);
  });

  test('pet stories: a missing portrait leaves the story pending and unseen', () => withPortrait(() => {
    const s = scene();
    s.addToInv('cat', 1, true);
    PetStoryArt.forKind = () => null;
    assert.falsy(PetStories.drain(s));
    assert.eq(s.save.petStoriesPending.join(','), 'cat');
    assert.falsy(s.save.storySeen?.['pet:cat']);
  }));

  test('pet stories: sapphire taming and the modal retry loop include pet stories', () => {
    const source = String(TAP_HANDLERS.find(h => h.name === 'creature').try);
    assert.truthy(/target.id = tameId;\s+PetStories.queue\(scene, target.kind\)/.test(source)
      || /tameInPlace\(scene, save, target, '💎 slime tamed!'/.test(source));
    assert.truthy(SCENE_SRC.includes('PetStories.drain(this);'));
  });
})();
