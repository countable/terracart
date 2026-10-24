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
  test('authored buildings: residences use pitched PP stucco or log houses with stable palettes', () => {
    assert.eq(recipe('home', 'player').key, 'pp_cabin');
    assert.eq(recipe('home', 'player').palette, 'orange');
    assert.eq(AuthoredBuildings.RESIDENCES.join(','), 'pp_plaster,pp_cabin');
    for (const role of [...Shops.THEMES, ...Object.keys(Shops.SOLO_LINES), 'blacksmith', 'trader', 'wizard', 'fort'])
      assert.falsy(recipe(role, 'x').palette === 'orange', role);
    const seen = new Set();
    for (let i = 0; i < 1000; i++) {
      const id = `house:${i}`, first = recipe('plain', id), again = recipe('plain', id, 7);
      assert.eq(first.palette, 'yellow');
      assert.truthy(['pp_plaster','pp_cabin'].includes(first.key), 'only stucco/log homes');
      assert.falsy(AuthoredBuildings.SPECS[first.key].flatRoof, 'no flat residential roof');
      assert.truthy(AuthoredBuildings.SPECS[first.key].eave > AuthoredBuildings.SPECS[first.key].peak, 'roof rises above eaves');
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
    // The door overlay (layer .1) stands proud of its wall, clear of its depth.
    const ground = mesh.faces.filter((f) => f.kind === 'wall' && f.layer !== .1).flatMap((f) => f.points).filter((p) => p.z < 1e-6);
    assert.truthy(ground.length > 0, 'walls reach the ground');
    for (const p of ground) assert.truthy(onEdge(p), `wall foot ${p.x.toFixed(1)},${p.y.toFixed(1)} lies on the lot outline`);
    for (const a of lot) assert.truthy(ground.some((p) => Math.hypot(p.x - a.x, p.y - a.y) < 1e-6), 'every lot corner is a wall corner');
    assert.truthy(mesh.faces.some((f) => f.kind === 'roof'), 'a roof covers the lot');
    for (const f of mesh.faces) for (const p of f.points) {
      assert.truthy(p.tu >= 0 && p.tu <= 1 && p.tv >= 0 && p.tv <= 1, 'every texel lies on the sheet');
    }
    assert.eq(seen.length, 1, 'the roof palette is applied once');
  });
  test('authored buildings: Home\'s room keeps its skin on the walls, cut at the eaves', () => {
    const spec = AuthoredBuildings.SPECS.pp_cabin;
    const skin = { key: 'pp_cabin', spec, texture: {}, template: {}, texel: 0.5, flat: false,
      facade: { v: 900, rows: spec.base - spec.eave }, roof: { u: 256, v: 616, w: 256, h: 240 },
      door: { u: 32, v: 68, w: 32, h: 28, bottom: 0 }, wall: [16, 80], recolor: () => {} };
    const lot = [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 64 }, { x: 0, y: 64 }];
    const house = BuildingLowPoly.authoredOutline(skin, lot, 2);
    const room = BuildingLowPoly.interiorGeometry(house, BuildingLowPoly.LOOK.wallThickness);
    const H = house.eaveHeight;
    assert.truthy(room.authored, 'the room is drawn as source art');
    assert.eq(room.faces.filter(f => f.kind === 'roof').length, 0, 'no roof inside');
    assert.truthy(room.faces.every(f => f.points.every(p => p.z <= H + 1e-6)), 'cut level at the eaves');
    assert.gt(house.height, H, 'the skin\'s roof stands above its eaves');
    assert.eq(room.height, H, 'the room is as tall as its cut walls, not the roof peak (the indoor mask sweeps by it)');
    assert.truthy(room.faces.every(f => Number.isInteger(f.edge)), 'every face stands on a wall');
    const outside = room.faces.filter(f => f.kind === 'wall' && !f.interior);
    const skinned = house.faces.filter(f => f.kind === 'wall' && f.points.every(p => p.z <= H + 1e-6));
    assert.eq(outside.length, skinned.length, 'every facade triangle stays outside');
    for (const f of outside) assert.truthy(f.sourceArt && f.points.every(p => p.tu >= 0 && p.tu <= 1 && p.tv >= 0 && p.tv <= 1),
      'outer faces wear the skin, not the procedural atlas');
    assert.eq(room.faces.filter(f => f.interior).length, outside.length, 'each facade triangle has an inner face');
    const tops = room.faces.filter(f => f.wallTop);
    assert.eq(tops.length, 8, 'a top band per wall');
    const [tu, tv] = house.faces.find(f => f.fallbackUV).fallbackUV;
    assert.truthy(tops.every(f => f.points.every(p => p.tu === tu && p.tv === tv)), 'tops take the plain wall texel');
  });
  test('authored smithy: a broad textured stack survives the lot-outline skin', () => {
    const spec = AuthoredBuildings.SPECS.fdr;
    const skin = { key: 'fdr', spec, texture: {}, template: {}, texel: 0.5, flat: false,
      facade: { v: 900, rows: spec.base - spec.eave }, roof: { u: 256, v: 616, w: 256, h: 240 },
      door: { u: 32, v: 68, w: 32, h: 28, bottom: 0 }, wall: [16, 80],
      gable: { u: 0, v: 640, w: 32, h: 16 }, chimneys: { count: 1, scale: 1.45, flare: 1.12 }, recolor() {} };
    const lot = [{x:0,y:0},{x:120,y:0},{x:120,y:60},{x:0,y:60}];
    const mesh = BuildingLowPoly.authoredOutline(skin, lot);
    const stack = mesh.faces.filter(f => f.chimney);
    assert.eq(stack.filter(f => f.kind === 'wall').length, 8, 'four stone shaft faces');
    assert.eq(mesh.chimneyMouths.length, 1, 'smoke follows the visible mouth');
    const shaft = stack.filter(f => f.kind === 'wall').flatMap(f => f.points);
    assert.gt(Math.max(...shaft.map(p => p.x)) - Math.min(...shaft.map(p => p.x)), 15, 'broad forge chimney');
    assert.truthy(stack.some(f => f.color === BuildingLowPoly.LOOK.chimney.mouthColor), 'dark mouth');
    assert.truthy(stack.every(f => f.points.every(p => Number.isFinite(p.tu) && Number.isFinite(p.tv))));
    const house = BuildingLowPoly.authoredOutline({...skin, chimneys: null}, lot);
    assert.eq(house.faces.filter(f => f.chimney).length, 0, 'other source skins retain their roofline');
  });
  test('authored buildings: tier-one shops and traders use the white cottage with its trade identity', () => {
    const colors = { trader: 'green', seed: 'lime', supply: 'blue',
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
    assert.eq(recipe('blacksmith', 'smith', 1).key, 'fdr');
    assert.eq(recipe('blacksmith', 'smith', 2).key, 'fdr');
    assert.eq(recipe('blacksmith', 'smith', 2).facadeRows, undefined);
    assert.eq(recipe('blacksmith', 'smith', 3).key, 'fdr');
    assert.eq(recipe('blacksmith', 'smith', 4).key, 'steam_blacksmith');
    assert.eq(recipe('blacksmith', 'smith', 1).palette, recipe('blacksmith', 'smith', 7).palette);
    assert.eq(recipe('fort', 'fort').key, 'city_storefront');
    assert.eq(recipe('fort', 'fort').palette, 'copper');
    assert.eq(recipe('fort', 'fort').sourceShell, true, 'fort keeps a central native shell inside its palisade');
    assert.eq(recipe('fort', 'fort').emblem, 'fort', 'one mounted dice marker');
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
  test('authored fort: centered solid dice board sits above the native entrance and fits with the hall', () => {
    const spec=AuthoredBuildings.SPECS.city_storefront,C=Math.cos(Math.PI/6),unit=16/spec.door[3];
    const native={authoredKey:'city_storefront',faces:CityBuildings.build({},spec,'city_storefront')};
    for(const face of native.faces)for(const p of face.points){p.x*=unit;p.y*=unit;p.z*=unit;}
    const texture={},emblem={sign:texture,signUV:[0,.1,.1,.2],signSideUV:[.3,.3]};
    const lot=[{x:0,y:0},{x:120,y:0},{x:120,y:100},{x:0,y:100}];
    const model=BuildingLowPoly.authoredGeometry(native,lot,.65,null,emblem);
    const sign=model.faces.filter(f=>f.feature==='fort-sign'),sides=model.faces.filter(f=>f.feature==='fort-sign-side');
    assert.eq(sign.length,2,'one front board');assert.eq(sides.length,10,'solid back and four sides');
    assert.eq(model.mountedSign,true,'floating sign can be suppressed');
    assert.truthy(sign.every(f=>f.texture===texture));
    const ps=sign.flatMap(f=>f.points),center=(Math.min(...ps.map(p=>p.x))+Math.max(...ps.map(p=>p.x)))/2;
    assert.lt(Math.abs(center-model.center.x),1e-6,'board centered on hall facade');
    const scale=model.height/(Math.max(...native.faces.flatMap(f=>f.points.map(p=>p.z)))*C);
    assert.gt(Math.min(...ps.map(p=>p.z)),spec.door[3]*unit*C*scale,'dice board clears the door');
    assert.lt(Math.max(...model.faces.flatMap(f=>f.points.map(p=>p.x)))-Math.min(...model.faces.flatMap(f=>f.points.map(p=>p.x))),90,'hall leaves its surrounding plank deck');
    assert.falsy(native.mountedSign,'shared startup model stays unmodified');
    assert.falsy(BuildingLowPoly.authoredGeometry(native,lot,.65).mountedSign,'no marker unless requested');
  });
  test('authored buildings: Dreamland attic glazing stays source-sized on a larger real footprint', () => {
    const spec=AuthoredBuildings.SPECS.dreamland_house;
    const skin={key:'dreamland_house',spec,template:{},texel:.5,flat:false,
      facade:{v:900,rows:30},roof:{u:256,v:616,w:256,h:256},
      door:{u:24,v:102,w:16,h:24,bottom:0},wall:[14,110],trim:[3.5,100.5],
      gableWindow:{u:24,v:72,w:16,h:20,bottom:5},recolor(){}};
    const lot=[{x:0,y:0},{x:96,y:0},{x:96,y:144},{x:0,y:144}];
    const model=BuildingLowPoly.authoredOutline(skin,lot);
    assert.eq(model.authoredKey,'dreamland_house');
    const windows=model.faces.filter(f=>f.kind==='wall'&&f.layer===.01);
    assert.truthy(windows.length,'native gable glazing is emitted');
    const zs=windows.flatMap(f=>f.points.map(p=>p.z));
    assert.eq(Math.min(...zs),17.5);assert.eq(Math.max(...zs),27.5);
    for(const f of windows)for(const p of f.points){
      assert.truthy(p.tu*512>=24-1e-6&&p.tu*512<=40+1e-6);
      assert.truthy(p.tv*1024>=72-1e-6&&p.tv*1024<=92+1e-6);
    }
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
