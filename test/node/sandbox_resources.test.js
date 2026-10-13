test('sandbox resources: both fruit species expose picked, blossom and ready states', () => {
  const built = Sandbox.buildForTest({ cellsPerEdge: 128, tx: 3, ty: 4 });
  const trees = built.entry.objects.filter(o => o._sandboxFruitState);
  const save = { fruitPicked: Object.fromEntries(trees.map(o => [o.id, Date.now()])) };
  Sandbox.seedMechanicsState({ save }, { objects: trees, creatures: [] });
  for (const species of ['apple', 'worldpeach']) {
    for (const fixture of ['picked', 'blossoming', 'ready']) {
      const tree = trees.find(o => o.species === species && o._sandboxFruitState === fixture);
      assert.truthy(tree, `${species} ${fixture} fixture exists`);
      const state = Crops.fruitTreeState(tree, save.fruitPicked[tree.id]);
      assert.truthy(state.mature, 'regrowth retains the mature tree');
      assert.eq(state.blossoming, fixture === 'blossoming', 'blossom uses the real regrowth window');
      assert.eq(state.ready, fixture === 'ready', 'ready fixture can be harvested');
    }
  }
});

test('sandbox resources: surface flint comparisons use the live mining material', () => {
  const built = Sandbox.buildForTest({ cellsPerEdge: 128, tx: 3, ty: 4 });
  for (const [tag, flint, shaded] of [
    ['flint-small', true, false], ['flint-comparison', false, false], ['flint-large', true, true],
  ]) {
    const rock = built.entry.objects.find(o => o._sandboxProbe === tag);
    assert.truthy(rock, `${tag} fixture exists`);
    assert.eq(mineralRockMaterial(rock), flint ? 'flint' : 'plain', 'real mining selects its material');
    assert.eq(rock.sightBlocking, shaded, 'small and large rocks expose sight comparisons');
  }
});

test('sandbox resources: Flint Field runs its owning tar zone dresser', () => {
  const built = Sandbox.buildForTest({ cellsPerEdge: 128, tx: 3, ty: 4 });
  const anchor = built.entry.zone.anchors.find(a => a.variant === 'flint_field');
  assert.truthy(anchor && anchor.kind === ZoneVariants.byId('flint_field').zone,
    'the authored anchor belongs to the variant zone');
  assert.truthy(built.entry.objects.some(o => o.zoneVariant === 'flint_field'
    && mineralRockMaterial(o) === 'flint'), 'real zone dressing produces flint-bearing rocks');
});
