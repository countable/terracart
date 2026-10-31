(() => {
  function scene() {
    return { save: {}, depth: 0, tileEdgeM: 256, cellsPerTile: 16, cellM: 16,
      mPerPx: 1, originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
      playerM: { x: 88, y: 88 } };
  }
  test('pet concealment: shiny animals wait until an adjacent cell, and stay discovered', () => {
    for (const kind of ['dog', 'chicken', 'cow', 'rabbit', 'horse', 'butterfly']) {
      const s = scene(), c = WorldGen.makeCreature(kind, 120, 88, `wild_${kind}`, { shiny: true });
      assert.truthy(c.hidden, kind);
      assert.truthy(enemyConcealmentTick(s, c), 'inactive two cells away');
      assert.truthy(Combat.isConcealed(c));
      s.playerM.x += 16;
      assert.falsy(enemyConcealmentTick(s, c), 'active one cell away');
      s.playerM.x = 0;
      assert.falsy(enemyConcealmentTick(s, c), 'discovery persists');
    }
    assert.falsy(WorldGen.makeCreature('dog', 0, 0, 'ordinary').hidden);
    assert.falsy(WorldGen.makeCreature('skeleton', 0, 0, 'elite', { shiny: true }).hidden);
  });
  test('pet concealment: cats and crabs use vision even when shiny', () => {
    for (const kind of ['cat', 'crab']) for (const shiny of [false, true]) {
      const s = scene(), c = WorldGen.makeCreature(kind, 88 + (Fog.REVEAL_CELLS + 1) * 16, 88,
        `${kind}_${shiny}`, { shiny });
      assert.truthy(c.stealthy);
      assert.falsy(c.hidden);
      assert.truthy(enemyConcealmentTick(s, c));
      assert.truthy(Combat.isConcealed(c), 'invisible outside vision');
      s.playerM.x += 16;
      assert.falsy(enemyConcealmentTick(s, c));
      assert.falsy(Combat.isConcealed(c), 'visible in vision');
    }
  });
  test('pet concealment: an authored hidden cat waits for the feet, not the vision disc', () => {
    // A Grassy Lane's pet (StreetVariants hiddenPets) is `hidden` whatever its
    // kind's own concealment: a cat is stealthy by nature, but hiding in the
    // grass it is found only from a neighbouring cell.
    const s = scene(), c = WorldGen.makeCreature('cat', 88 + 2 * 16, 88, 'street_pet_cat', { hidden: true });
    assert.truthy(c.hidden && c.stealthy);
    assert.eq(HiddenObjects.mode(c), 'hidden');
    assert.truthy(enemyConcealmentTick(s, c), 'two cells away, inside the vision disc: still hidden');
    assert.truthy(Combat.isConcealed(c));
    s.playerM.x += 16;
    assert.falsy(enemyConcealmentTick(s, c), 'one cell away: found');
    assert.truthy(s.save.hiddenDiscoveries.street_pet_cat, 'remembered');
  });
  test('pet concealment: owned animals are already known and explicit defaults can be overridden', () => {
    for (const kind of ['dog', 'cat', 'crab']) {
      const c = WorldGen.makeCreature(kind, 0, 0, `pet_${kind}`, { shiny: true, pet: true });
      assert.falsy(Combat.isConcealed(c));
      assert.falsy(enemyConcealmentTick(scene(), c));
    }
    assert.falsy(WorldGen.makeCreature('dog', 0, 0, 'authored', { shiny: true, hidden: false }).hidden);
  });
})();
