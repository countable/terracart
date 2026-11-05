(function () {
  function withSites(fn) {
    const oldOffer = Houses.wreckOffer, oldBlessed = Houses.isBlessedSite;
    Houses.wreckOffer = (save, o) => save.offers?.[Houses.castleKey(o) || o.id] || null;
    Houses.isBlessedSite = (save, o) => !!save.blessed?.[Houses.castleKey(o) || o.id];
    try { fn(); } finally { Houses.wreckOffer = oldOffer; Houses.isBlessedSite = oldBlessed; }
  }
  test('wreck shine: every special offer shares the shine cue without Magic Hammer powers', () => withSites(() => {
    const house = { kind: 'house', id: 'site', tier: 9 };
    for (const key of ['discount', 'blessed', 'contract']) {
      const save = { offers: { site: { key } } };
      assert.truthy(Render.buildingShines(save, house), key);
      assert.falsy(Houses.isShinyHouse(save, house), 'visual marking does not grant the Magic Hammer benefit');
      assert.eq(Houses.priceMul(save, house), 1, 'no Magic Hammer trading discount');
    }
    assert.falsy(Render.buildingShines({}, house), 'ordinary wreck remains unmarked');
    assert.falsy(Render.buildingShines({ offers: { site: { key: 'discount' } } }, { kind: 'tree', id: 'site' }));
  }));
  test('wreck shine: completed blessed sites keep their glow while spent offers stop shining', () => withSites(() => {
    const house = { kind: 'house', id: 'site', tier: 9 };
    const save = { restoredHouses: { site: 'plain' }, blessed: { site: true } };
    assert.truthy(Render.buildingShines(save, house));
    assert.falsy(Houses.isShinyHouse(save, house));
    delete save.blessed.site;
    assert.falsy(Render.buildingShines(save, house));
    save.shinyHouses = { site: true };
    assert.truthy(Render.buildingShines(save, house), 'Magic Hammer visual remains supported');
  }));
  test('wreck shine: only house wreck offers produce a site light and all-renderer sparkle', () => {
    const save = {};
    let house;
    for (let i = 0; i < 1000; i++) {
      const candidate = { kind: 'house', id: 'shine-site-' + i, tier: 9 };
      if (Houses.wreckOffer(save, candidate)) { house = candidate; break; }
    }
    assert.truthy(house, 'fixture finds a deterministically marked house');
    const fort = { ...house, tier: 11 };
    const castle = { kind: 'tower', id: house.id, castle: house.id, flagPost: true };
    assert.falsy(Houses.wreckOffer(save, fort), 'forts do not receive house offers');
    assert.falsy(Houses.wreckOffer(save, castle), 'castles do not receive house offers');
    assert.falsy(Render.buildingShines(save, fort));
    assert.falsy(Render.buildingShines(save, castle));
    const items = [
      { o: castle, dx: 0, dy: 1 },
      { o: fort, dx: 2, dy: 3 },
      { o: house, dx: 4, dy: 5 },
    ];
    const sparks = Render.buildingSparkItems({ save }, items);
    assert.eq(sparks.length, 1, 'only the marked house shines');
    assert.eq(sparks[0].id, house.id);
    assert.eq(sparks[0].dx, 4);
    assert.eq(sparks[0].dy, 5);
    assert.truthy(sparks[0].building, 'procedural buildings retain their star under WebGL');
    assert.includes(RENDER_SRC, 'it.glint != null || it.building');
  });
})();
