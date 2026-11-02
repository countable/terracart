(function () {
  const house = () => ({ kind: 'house', id: 'hive_render_test', tier: 9, hive: 'mushroom', x: 0, y: 0 });
  function scene() {
    return { save: { restoredHouses: {}, hives: {} }, cellM: 7, depth: 0,
      textures: { exists: () => true, get: () => ({ get: () => ({ width: 96, height: 96 }) }) },
      _proceduralBuildings: new Map([['hive_render_test', { height: 20 }]]) };
  }
  test('hive art: living house stays upright in the standing billboard layer at every heading', () => {
    const o = house(), s = scene();
    for (const heading of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      s._headingUp = true; s._headingAngle = heading;
      const art = Render.objectAppearance(s, new Map([[o, 'wreck']])).resolveAppearance(o);
      assert.eq(art.texKey, 'hive_mushroom');
      assert.eq(art.frameVal, 0);
      assert.eq(art.layer, WorldLayers.STANDING_PROP);
      assert.eq(art.scaleYMul, 1);
      assert.eq(Render.proceduralHouse(o, s), false);
    }
    assert.eq(Render.hiveLabel(o, s), 'Mushroom House · 120/120 HP');
  });
  test('hive art: damage updates its sign and destruction restores ordinary wreck appearance', () => {
    const o = house(), s = scene();
    s.save.hives[o.id] = { hp: 35 };
    assert.eq(Render.hiveLabel(o, s), 'Mushroom House · 35/120 HP');
    s.save.hives[o.id].hp = 34.125;
    assert.eq(Render.hiveLabel(o, s), 'Mushroom House · 35/120 HP');
    s.save.hives[o.id].hp = 0;
    assert.eq(Render.houseTextureKey('wreck', o, s), 'house_wreck');
    assert.eq(Render.hiveLabel(o, s), null);
    const pass = Render.objectAppearance(s, new Map([[o, 'wreck']]));
    assert.eq(pass.RENDER_SPEC.house.layer(o, s, pass), WorldLayers.GROUND_DECAL);
    assert.eq(pass.RENDER_SPEC.house.scaleYMul(o, s, pass), 0.4);
  });
  test('hive art: L3 goblin hive is an upright labelled house and clears to a wreck', () => {
    const o={...house(),hive:'goblin',depth:3},s=scene();s.depth=3;
    const art=Render.objectAppearance(s,new Map([[o,'wreck']])).resolveAppearance(o);
    assert.eq(art.texKey,'house');assert.eq(art.frameVal,'front');
    assert.eq(art.layer,WorldLayers.STANDING_PROP);assert.eq(art.scaleYMul,1);
    assert.eq(Render.hiveLabel(o,s),'Goblin Hive · 120/120 HP');
    s.save.hives[o.id]={hp:0};
    assert.eq(Render.houseTextureKey('wreck',o,s),'house_wreck');
  });
})();
