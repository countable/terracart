(() => {
  const recipe = (...args) => AuthoredBuildings.recipeFor(...args);
  test('authored buildings: Home alone is the orange-roofed cabin', () => {
    assert.eq(recipe('home', 'player').key, 'pp_cabin');
    assert.eq(recipe('home', 'player').palette, 'orange');
    assert.falsy(AuthoredBuildings.RESIDENCES.includes('pp_cabin'), 'no other house is a log cabin');
    for (const role of [...Shops.THEMES, ...Object.keys(Shops.SOLO_LINES), 'blacksmith', 'trader', 'wizard', 'fort'])
      assert.falsy(recipe(role, 'x').palette === 'orange', role);
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const id = `house:${i}`, first = recipe('plain', id), again = recipe('plain', id, 7);
      assert.eq(first.palette, 'yellow');
      assert.eq(first.key, again.key, 'rank does not replace a residential facade');
      assert.truthy(AuthoredBuildings.SPECS[first.key]);
      seen.add(first.key);
    }
    assert.eq(seen.size, AuthoredBuildings.RESIDENCES.length, 'all residential variants are reachable');
  });
  test('authored buildings: skinned walls stand on the lot outline, at any angle', () => {
    const spec = AuthoredBuildings.SPECS.pp_brick, seen = [];
    const skin = { key: 'pp_brick', spec, texture: {}, template: {}, texel: 0.5, flat: false,
      facade: { v: 900, rows: spec.base - spec.eave }, roof: { u: 256, v: 616, w: 256, h: 240 },
      door: { u: 32, v: 68, w: 32, h: 28, bottom: 0 }, wall: [16, 80], recolor: (faces) => seen.push(faces.length) };
    // A rotated, concave L: no wall may be an axis-aligned box inside it.
    const turn = (x, y) => ({ x: x * 0.8 - y * 0.6 + 100, y: x * 0.6 + y * 0.8 + 100 });
    const lot = [[0, 0], [60, 0], [60, 30], [30, 30], [30, 70], [0, 70]].map(([x, y]) => turn(x, y));
    const mesh = BuildingLowPoly.authoredOutline(skin, lot);
    const onEdge = (p) => lot.some((a, i) => { const b = lot[(i + 1) % lot.length];
      const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
      return t > -1e-6 && t < 1 + 1e-6 && Math.hypot(a.x + (b.x - a.x) * t - p.x, a.y + (b.y - a.y) * t - p.y) < 0.2; });
    const ground = mesh.faces.filter((f) => f.kind === 'wall').flatMap((f) => f.points).filter((p) => p.z < 1e-6);
    assert.truthy(ground.length > 0, 'walls reach the ground');
    for (const p of ground) assert.truthy(onEdge(p), `wall foot ${p.x.toFixed(1)},${p.y.toFixed(1)} lies on the lot outline`);
    for (const a of lot) assert.truthy(ground.some((p) => Math.hypot(p.x - a.x, p.y - a.y) < 1e-6), 'every lot corner is a wall corner');
    assert.truthy(mesh.faces.some((f) => f.kind === 'roof'), 'a roof covers the lot');
    for (const f of mesh.faces) for (const p of f.points) {
      assert.truthy(p.tu >= 0 && p.tu <= 1 && p.tv >= 0 && p.tv <= 1, 'every texel lies on the sheet');
    }
    assert.eq(seen.length, 1, 'the roof palette is applied once');
  });
  test('authored buildings: tier-one smith keeps the ground floor and full-size door', () => {
    const spec = AuthoredBuildings.SPECS.fdr;
    const skin = { spec, template: {}, texel: 0.5, flat: false,
      facade: { v: 900, rows: 64 }, roof: { u: 256, v: 616, w: 240, h: 240 },
      door: { u: 155, v: 96, w: 26, h: 26, bottom: 6 }, wall: [132, 96], recolor() {} };
    const lot = [{x:0,y:0},{x:80,y:0},{x:80,y:60},{x:0,y:60}];
    const mesh = BuildingLowPoly.authoredOutline(skin, lot, 0, recipe('blacksmith', 'smith', 1).facadeRows);
    const facade = mesh.faces.filter(f => f.kind === 'wall' && f.layer === 0 && f.points.some(p => p.z === 0));
    assert.eq(Math.max(...facade.flatMap(f => f.points.map(p => p.z))), 18);
    const pixels = facade.flatMap(f => f.points.map(p => p.tv * 1024));
    assert.eq(Math.min(...pixels), 928, 'upper-storey pixels are cropped');
    assert.eq(Math.max(...pixels), 964, 'ground-floor pixels stay seated');
    const door = mesh.faces.filter(f => f.layer === 0.1).flatMap(f => f.points.map(p => p.z));
    assert.eq(Math.max(...door) - Math.min(...door), 13, 'door is not scaled down');
  });
  test('authored buildings: wizard towers and the fort hall keep whole shells', () => {
    const scene = { textures: { exists: () => false } };
    for (const key of ['wizard', 'steam_wizard', 'city_gearhouse']) assert.eq(AuthoredBuildings.skin(scene, key, 'purple'), null, key);
  });
  test('authored buildings: every shop line uses a commercial model and a distinct signature', () => {
    const colors = new Set();
    for (const role of [...Shops.THEMES, ...Object.keys(Shops.SOLO_LINES)]) {
      for (const tier of [1, 3, 4, 7]) {
        const r = recipe(role, 'shop:fixture', tier);
        assert.includes(['market', 'city_storefront'], r.key, role);
        assert.falsy(r.palette === 'yellow', 'residential color is reserved');
        assert.eq(r.palette, recipe(role, 'another-shop', 1).palette, 'signature persists across rank and identity');
      }
      colors.add(recipe(role, 'shop:fixture').palette);
    }
    assert.eq(colors.size, Shops.THEMES.length + Object.keys(Shops.SOLO_LINES).length);
    assert.includes(['market', 'city_storefront'], recipe('shop', 'legacy').key);
  });
  test('authored buildings: service landmarks preserve their role across upgrades', () => {
    assert.eq(recipe('blacksmith', 'smith', 1).facadeRows, 36);
    assert.eq(recipe('blacksmith', 'smith', 2).facadeRows, undefined);
    assert.eq(recipe('blacksmith', 'smith', 3).key, 'fdr');
    assert.eq(recipe('blacksmith', 'smith', 4).key, 'steam_blacksmith');
    assert.eq(recipe('blacksmith', 'smith', 1).palette, recipe('blacksmith', 'smith', 7).palette);
    assert.eq(recipe('fort', 'fort').key, 'city_gearhouse');
    assert.eq(recipe('fort', 'fort').palette, 'copper');
    assert.eq(recipe('trader', 'trader').key, 'trader');
    assert.eq(recipe('trader', 'trader').palette, 'green');
    assert.eq(recipe('wizard', 'first', 1, false).key, 'wizard');
    assert.eq(recipe('wizard', 'second', 1, true).key, 'steam_wizard');
    assert.eq(recipe('wizard', 'first').palette, 'purple');
    assert.eq(recipe('wizard', 'second', 1, true).palette, 'purple');
    assert.eq(recipe('potion', 'magic-shop').palette, 'teal');
    for (const role of ['turret', 'castle', 'wreck', 'unknown']) assert.eq(recipe(role, 'fixture'), null);
  });
})();
