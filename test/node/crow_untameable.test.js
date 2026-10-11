// Crows are GAME, never pets: hunted with the net for a feather, but no
// favourite, no catch, no pet story, and a kept crow in an old save is dropped.
test('crow: huntable but never catchable as a pet', () => {
  assert.truthy(SpriteLayout.isGame('crow'), 'a crow is game');
  assert.truthy(SpriteLayout.isUntameable('crow'), 'and untameable');
  assert.falsy(Pets.catchable({ kind: 'crow', id: 'crow_1_1_0' }), 'a wild crow cannot be caught');
  assert.falsy(Pets.catchable({ kind: 'shiny_crow', id: 'crow_1_1_1' }), 'nor a shiny one');
  assert.falsy(Pets.canCatch({ released: [] }, { kind: 'crow', id: 'crow_1_1_0' }), 'canCatch agrees');
  assert.falsy(Object.hasOwn(ANIMAL_FOOD, 'crow'), 'no favourite food');
  assert.truthy(Pets.catchable({ kind: 'deer', id: 'deer_1_1_0' }), 'the deer stays tameable');
});

test('crow: an old save drops a kept crow and keeps its other pets', () => {
  const save = { released: [
    { id: 'pet_crow_1', kind: 'crow', pet: true },
    { id: 'pet_cat_1', kind: 'cat', pet: true },
  ] };
  SaveState.normalize(save);
  assert.eq(save.released.map(r => r.id).join(','), 'pet_cat_1', 'only the cat remains');
});
