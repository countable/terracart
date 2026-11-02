test('farm animals: pig and sheep can be caught with their favourites as ordinary livestock', () => {
  for (const [kind, food] of [['pig', 'potato'], ['sheep', 'cress']]) {
    const c = { id: 'wild_' + kind, kind, x: 1, y: 1 };
    const save = { released: [], caught: [], inv: [] };
    assert.truthy(Pets.catchable(c));
    assert.truthy(Pets.likes(c, food));
    assert.falsy(Combat.isEnemy(c));
    assert.truthy(SpriteLayout.isGame(kind));
    assert.eq(Combat.maxHp(c), 20);
    const row = Pets.bond(save, c);
    assert.truthy(row.pet);
    assert.falsy(Pets.canCatch(save, { ...c, id: 'second_' + kind }));
    assert.eq(SpriteLayout.creatureDrop(kind), 'meat');
    assert.eq(ITEM_BY_ID[kind].kind, 'animal');
  }
});

test('farm animals: authored walking frames cover all four directions without empty pig columns', () => {
  for (const [kind, starts, length] of [['pig', [16,20,24,28], 3], ['sheep', [0,4,8,12], 4], ['chick', [0,4,8,12], 4]]) {
    const art = SpriteLayout.creatureArt(kind);
    for (const [index, facing] of ['down', 'up', 'right', 'left'].entries()) {
      const c = { kind, _facing: facing, _moveUntil: 10000 };
      const frames = new Set();
      for (let n = 0; n < length; n++) {
        const appearance = SpriteLayout.creatureAppearance(c, n * art.frameMs);
        assert.eq(appearance.frame, starts[index] + n);
        assert.falsy(appearance.flipX, kind + ' has authored sides');
        frames.add(appearance.frame);
      }
      assert.eq(frames.size, length);
    }
  }
});

test('farm animals: alternate Chick keeps identity across capture and grows into adult chicken', () => {
  const now = Date.now();
  const babies = ['hatch_0', 'hatch_1'].map(id => ({ id, kind: 'chicken', raised: true, born: now, favouriteFeeds: 1, x: 1, y: 1 }));
  assert.eq(new Set(babies.map(c => SpriteLayout.creatureVisualKind(c))).size, 2);
  const chick = babies.find(c => SpriteLayout.creatureVisualKind(c) === 'chick');
  assert.truthy(chick);
  const save = { released: [], caught: [], inv: [] };
  const pet = Pets.bond(save, chick);
  assert.eq(pet.kind, 'chicken');
  assert.eq(SpriteLayout.creatureVisualKind(JSON.parse(JSON.stringify(pet))), 'chick');
  assert.falsy(Pets.canCatch(save, { kind: 'chicken', id: 'another_chicken' }));
  SpriteLayout.updateCreatureFacing(pet, -1, 0, 100);
  assert.eq(SpriteLayout.creatureAppearance(pet, 100).frame, 12);
  assert.eq(SpriteLayout.creatureVisualKind({ ...pet, favouriteFeeds: 7 }, now + SpriteLayout.PET_BABY.growMs), 'chicken');
  const normal = SpriteLayout.creatureArt('chicken'), alt = SpriteLayout.creatureArt('chick');
  assert.lt(Math.abs((normal.maxY-normal.minY)*normal.scale - (alt.maxY-alt.minY)*alt.scale), 1e-9);
  assert.lt(Math.abs(SpriteLayout.creatureWheelDy('chicken', .5) - SpriteLayout.creatureWheelDy('chick', .5)), 1e-9);
  assert.lt(Math.abs(SpriteLayout.creatureHealthBarTop('chicken', .5) - SpriteLayout.creatureHealthBarTop('chick', .5)), 1e-9);
});
