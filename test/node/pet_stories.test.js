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

  test('pet stories: feeding and hatching do not queue a bonded-pet story', () => {
    const s = scene();
    const wild = { id: 'dog_wild', kind: 'dog' };
    Pets.feedWild(s.save, wild, 'meat');
    assert.falsy(s.save.petStoriesPending);
    s.save.inv = [{id: 'egg', count: 1}]; s.save.eggHatchM = EggHatch.METERS;
    EggHatch.hatch(s.save, () => 0);
    assert.falsy(s.save.petStoriesPending);
  });

  test('pet stories: busy dialogs preserve queue through reload; each species opens once', () => withPortrait(setBusy => {
    let s = scene();
    PetStories.queue(s, 'baby_cat');
    PetStories.queue(s, 'dog');
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
    PetStories.queue(s, 'shiny_cat');
    assert.eq(s.save.petStoriesPending.join(','), 'dog');
    assert.truthy(PetStories.drain(s));
    assert.eq(s.modals[1].art, 'portrait:dog');
    assert.falsy(PetStories.drain(s));
    assert.eq(s.modals.length, 2);
  }));

  test('pet stories: a missing portrait leaves the story pending and unseen', () => withPortrait(() => {
    const s = scene();
    PetStories.queue(s, 'cat');
    PetStoryArt.forKind = () => null;
    assert.falsy(PetStories.drain(s));
    assert.eq(s.save.petStoriesPending.join(','), 'cat');
    assert.falsy(s.save.storySeen?.['pet:cat']);
  }));

  test('pet stories: modal retry loop drains completed bonds', () => {
    assert.truthy(SCENE_SRC.includes('PetStories.drain(this);'));
  });
})();
