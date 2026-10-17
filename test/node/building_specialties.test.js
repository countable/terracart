// Roof identity must agree with the restored building, not its address.
test('building specialties: saved roles win over legacy street addresses', () => {
  const house = {kind:'house', id:'roof-test', tier:9, address:9};
  assert.eq(BuildingOverlay.specialtyFor({}, house), 'wreck');
  assert.eq(BuildingOverlay.specialtyFor({restoredHouses:{'roof-test':'plain'}}, house), 'plain');
  for (const role of ['blacksmith','trader','wizard','turret']) {
    assert.eq(BuildingOverlay.specialtyFor({restoredHouses:{'roof-test':role}}, house), role);
  }
  assert.eq(BuildingOverlay.specialtyFor({restoredHouses:{'roof-test':true}}, house), 'blacksmith');
  assert.eq(BuildingOverlay.specialtyFor({starterShopId:'roof-test'}, house), 'trailer');
});

test('building specialties: all shop roofs follow the stored line and solo shop stamps', () => {
  const house = {kind:'house', id:'roof-test', tier:9, address:9};
  const save = {restoredHouses:{'roof-test':'shop'}, shopLines:{}, shopTiers:{'roof-test':1}};
  for (const theme of Shops.THEMES) {
    save.shopLines['roof-test'] = theme;
    assert.eq(BuildingOverlay.specialtyFor(save, house), theme);
  }
  save.bookshopId = house.id;
  assert.eq(BuildingOverlay.specialtyFor(save, house), 'book');
  delete save.bookshopId;
  save.petshopId = house.id;
  assert.eq(BuildingOverlay.specialtyFor(save, house), 'pet');
});
