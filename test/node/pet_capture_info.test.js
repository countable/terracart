(() => {
  const start = SCENE_SRC.indexOf('\n  catchCreature(c, sx, sy) {');
  const end = SCENE_SRC.indexOf('\n  }\n', start);
  const Scene = new Function(`return class { ${SCENE_SRC.slice(start, end + 4)} }`)();
  function scene() {
    const s = new Scene();
    s.save = { inv: [], released: [], wildAnimals: [], caught: [] };
    s.cards = [];
    s.flashLoot = () => {};
    s.awardShinyBonus = () => {};
    s.selectInvCat = category => { s.category = category; };
    s.presentPetInfo = (id, options) => s.cards.push({ id, options });
    return s;
  }
  const wild = (id = 'capture-info-dog', kind = 'dog') => ({ id, kind, x: 1, y: 1, _hp: 3 });

  test('pet capture info: successful first and later catches open the bonded individual', () => {
    const s = scene();
    const first = s.catchCreature(wild());
    assert.eq(s.cards[0].id, first.id);
    assert.truthy(s.cards[0].options.fromCatch);
    assert.eq(first.hp, 3);
    assert.eq(s.category, 'animal');
    assert.eq(s.save.petStoriesPending.join(','), 'dog');
    Pets.release(s.save, first.id);
    s.save.petStoriesPending = [];
    s.save.storySeen = { 'pet:dog': true };
    const next = s.catchCreature(wild('second-dog'));
    assert.eq(s.cards.length, 2, 'stats appear even when the first-pet story was already seen');
    assert.eq(s.cards[1].id, next.id);
    assert.eq(s.save.petStoriesPending.length, 0);
  });

  test('pet capture info: refused, stale and already-owned catches do not open stats', () => {
    const s = scene();
    assert.falsy(s.catchCreature(wild('crow', 'crow')));
    assert.eq(s.cards.length, 0);
    const c = wild(), row = s.catchCreature(c);
    assert.falsy(s.catchCreature(c), 'stale duplicate cannot bond again');
    s.catchCreature(row);
    assert.eq(s.cards.length, 1, 'carrying an existing pet does not announce a new capture');
  });

  test('pet capture info: queued first-pet story waits until the stats modal closes', () => {
    const s = scene(), originalBody = document.body, originalArt = PetStoryArt.forKind;
    let modalOpen = false, stories = 0;
    document.body = { classList: { contains: name => name === 'modal-open' && modalOpen } };
    PetStoryArt.forKind = () => 'test-portrait';
    s.presentPetInfo = () => { modalOpen = true; };
    s._storySplashOnce = () => { stories++; return true; };
    try {
      s.catchCreature(wild());
      assert.falsy(PetStories.drain(s));
      assert.eq(stories, 0);
      assert.eq(s.save.petStoriesPending.join(','), 'dog');
      modalOpen = false;
      assert.truthy(PetStories.drain(s));
      assert.eq(stories, 1);
      assert.eq(s.save.petStoriesPending.length, 0);
    } finally {
      document.body = originalBody;
      PetStoryArt.forKind = originalArt;
    }
  });
})();
