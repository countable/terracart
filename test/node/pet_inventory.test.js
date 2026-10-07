test('pet inventory: animal catalog rows cannot become inventory stacks', () => {
  const save = { inv: [] };
  for (const id of ['dog', 'shiny_dog', 'baby_dog', 'slime']) {
    assert.eq(Inventory.roomFor(save, id), 0, id);
    Inventory.add(save, id, 1);
    assert.eq(Inventory.count(save, id), 0, id);
  }
  Inventory.add(save, 'pet_collar', 1);
  assert.eq(Inventory.count(save, 'pet_collar'), 1, 'accessories remain inventory items');
});
