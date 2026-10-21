(() => {
  const recipe = (...args) => AuthoredBuildings.recipeFor(...args);
  test('authored buildings: native PP flat shops retain their raised deck and full-height facade', () => {
    for (const color of ['red', 'brown', 'orange', 'blue', 'green', 'pink']) {
      const key = 'pp_flat_' + color, spec = FlatBuildings.specs[key];
      for (const ring of [undefined, [[0,0],[120,0],[120,48],[64,48],[64,96],[0,96]]]) {
        const faces = FlatBuildings.build({}, spec, key, ring);
        const points = faces.flatMap(f => f.points);
        assert.truthy(points.every(p => ['x','y','z','tu','tv'].every(k => Number.isFinite(p[k]))));
        assert.eq(Math.max(...points.map(p => p.z)), 48 / Math.cos(Math.PI / 6));
        const walls = faces.filter(f => f.kind === 'wall' && f.points.some(p => p.tv >= 900 / 1024));
        assert.eq(Math.max(...walls.flatMap(f => f.points.map(p => p.tv * 1024))), 932, 'all 32 facade texels survive');
        if (!ring) {
          const wallPoints = walls.flatMap(f => f.points);
          assert.eq(Math.min(...wallPoints.map(p => p.x)), 3, 'left wall sits under roof lip');
          assert.eq(Math.max(...wallPoints.map(p => p.x)), 93, 'right wall sits under roof lip');
          assert.truthy(faces.filter(f => f.kind === 'roof').some(f => f.points.some(p => p.x === 0)), 'roof retains original outline');
        }
        assert.eq(faces.footprintInfo.roofPitch, 0);
      }
    }
  });
  test('authored buildings: Home alone uses the cabin and residences retain stable palettes', () => {
    assert.eq(recipe('home', 'player').key, 'pp_cabin');
    assert.eq(recipe('home', 'player').palette, 'orange');
    assert.falsy(AuthoredBuildings.RESIDENCES.includes('pp_cabin'), 'no other house is a log cabin');
    for (const role of [...Shops.THEMES, ...Object.keys(Shops.SOLO_LINES), 'blacksmith', 'trader', 'wizard', 'fort'])
      assert.falsy(recipe(role, 'x').palette === 'orange', role);
    const seen = new Set();
    for (let i = 0; i < 1000; i++) {
      const id = `house:${i}`, first = recipe('plain', id), again = recipe('plain', id, 7);
      assert.eq(first.palette, AuthoredBuildings.SPECS[first.key].ppFlat ? 'native' : 'yellow');
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
  test('authored buildings: every tier-one business uses the white cottage with its trade identity', () => {
    const colors = { blacksmith: 'slate', trader: 'green', seed: 'lime', supply: 'blue',
      potion: 'teal', relic: 'red', pet: 'rose', book: 'plum', shop: 'blue' };
    for (const [role, palette] of Object.entries(colors)) {
      for (const id of ['shop:first', 'shop:second']) {
        const r = recipe(role, id, 1);
        assert.eq(r.key, 'pp_plaster', role + ': white cottage');
        assert.eq(r.palette, palette, role + ': original roof color');
        assert.eq(r.emblem, role, role + ': sign and roof emblem identity');
        assert.eq(r.facadeRows, undefined, role + ': full cottage facade');
        assert.eq(recipe(role, id).key, r.key, 'default tier is one');
      }
    }
    assert.eq(recipe('plain', 'residence').emblem, undefined, 'residences have no trade emblem');
    assert.eq(recipe('home', 'player').key, 'pp_cabin');
  });
  test('authored buildings: startup prepares both cottage and upgraded service models', () => {
    const requested = new Set();
    AuthoredBuildings.prepare({ textures: { exists(key) { requested.add(key); return false; } } });
    for (const key of ['pp_plaster', 'fdr', 'steam_blacksmith', 'trader', 'market', 'city_storefront'])
      assert.truthy(requested.has('authored_source_' + key), key + ': available after an upgrade without restarting');
  });
  test('authored buildings: wizard towers and the fort hall keep whole shells', () => {
    const scene = { textures: { exists: () => false } };
    for (const key of ['wizard', 'steam_wizard', 'city_gearhouse']) assert.eq(AuthoredBuildings.skin(scene, key, 'purple'), null, key);
  });
  test('authored buildings: upgraded shops keep commercial models and distinct roof colors', () => {
    const colors = new Set();
    for (const role of [...Shops.THEMES, ...Object.keys(Shops.SOLO_LINES)]) {
      for (const tier of [2, 3, 4, 7]) {
        const r = recipe(role, 'shop:fixture', tier);
        assert.eq(r.key, ['supply', 'relic', 'book'].includes(role) ? 'city_storefront' : 'market', role);
        assert.eq(r.emblem, undefined, 'cottage dressing is limited to tier one');
        assert.falsy(r.palette === 'yellow', 'residential color is reserved');
        assert.eq(r.palette, recipe(role, 'another-shop', 1).palette, 'signature persists across rank and identity');
      }
      colors.add(recipe(role, 'shop:fixture').palette);
    }
    assert.eq(colors.size, Shops.THEMES.length + Object.keys(Shops.SOLO_LINES).length);
    assert.includes(['market', 'city_storefront'], recipe('shop', 'legacy', 2).key);
  });
  test('authored buildings: service landmarks preserve their role across upgrades', () => {
    assert.eq(recipe('blacksmith', 'smith', 1).key, 'pp_plaster');
    assert.eq(recipe('blacksmith', 'smith', 2).key, 'fdr');
    assert.eq(recipe('blacksmith', 'smith', 2).facadeRows, undefined);
    assert.eq(recipe('blacksmith', 'smith', 3).key, 'fdr');
    assert.eq(recipe('blacksmith', 'smith', 4).key, 'steam_blacksmith');
    assert.eq(recipe('blacksmith', 'smith', 1).palette, recipe('blacksmith', 'smith', 7).palette);
    assert.eq(recipe('fort', 'fort').key, 'city_gearhouse');
    assert.eq(recipe('fort', 'fort').palette, 'copper');
    assert.eq(recipe('trader', 'trader', 2).key, 'trader');
    assert.eq(recipe('trader', 'trader', 7).key, 'trader');
    assert.eq(recipe('trader', 'trader').palette, 'green');
    assert.eq(recipe('wizard', 'first', 1, false).key, 'wizard');
    assert.eq(recipe('wizard', 'second', 1, true).key, 'steam_wizard');
    assert.eq(recipe('wizard', 'first').palette, 'purple');
    assert.eq(recipe('wizard', 'second', 1, true).palette, 'purple');
    assert.eq(recipe('potion', 'magic-shop').palette, 'teal');
    for (const role of ['turret', 'castle', 'wreck', 'unknown']) assert.eq(recipe(role, 'fixture'), null);
  });
})();

test('authored blacksmith: widening the barrel preserves the gear panel and separates entry overlays', () => {
  const C = Math.cos(Math.PI / 6), spec = SteamBlacksmith.spec, depth = 180;
  const sourceWidth = spec.right - spec.left, wallHeight = (spec.base - spec.eave) / C;
  for (const width of [sourceWidth * 2, sourceWidth * 3]) {
    const faces = SteamBlacksmith.build({}, spec, 'steam_blacksmith', [[0,0],[width,0],[width,depth],[0,depth]]);
    const gear = faces.filter(f => f.kind === 'wall' && f.points.every(p => p.y > depth) && f.points.some(p => p.z > wallHeight + 1));
    assert.truthy(gear.length, 'wide front retains its original gear artwork');
    const points = gear.flatMap(f => f.points), left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x));
    assert.eq(right - left, sourceWidth, 'gear artwork keeps native width as the building widens');
    assert.eq((left + right) / 2, width / 2, 'gear panel stays centred');
    const entries = faces.filter(f => f.kind === 'wall' && f.points.every(p => p.y > depth && p.z <= spec.door[3] / C));
    assert.truthy(entries.length, 'entry overlay exists');
    const standOff = Math.min(...entries.flatMap(f => f.points.map(p => p.y - depth))) * 16 / spec.door[3];
    assert.truthy(standOff > 2 * 2048 / 65535, 'entry clears two 16-bit preview depth steps at game scale');
  }
});
