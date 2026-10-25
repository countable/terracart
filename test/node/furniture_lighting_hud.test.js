// Run the real drawObjects / renderPool path with Phaser text metrics supplied
// by a fixture. Home membership, label caching, positioning and fading are live.
(() => {
  function textSlot(x = 0, y = 0, text = '', style = {}) {
    return {
      x, y, text, style: { ...style }, width: text.length * 8, height: 14,
      setText(value) { this.text = value; this.width = value.length * 8; return this; },
      setColor(value) { this.style.color = value; return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      setOrigin(x, y) { this.originX = x; this.originY = y; return this; },
      setDepth(value) { this.depth = value; return this; },
      setAlpha(value) { this.alpha = value; return this; },
      setAngle(value) { this.rotation = value * Math.PI / 180; return this; },
      setVisible(value) { this.visible = value; return this; },
      setActive(value) { this.active = value; return this; },
      setScale() { return this; }, setFlipX() { return this; },
      setInteractive() { this.interactive = true; return this; },
      on(event, callback) { this.handlers ||= {}; this.handlers[event] = callback; return this; },
      clearTint() { return this; }, setShadow() { return this; },
    };
  }

  function withHome(fn) {
    const home = { id: 'home', kind: 'house', tier: 1, x: 2.5, y: 2.5 };
    const entry = {
      cellsPerEdge: 32, grid: new Uint8Array(1024).fill(WorldGen.T.GRASS),
      owners: new Uint8Array(1024), ownerKeys: ['home'],
      objects: [home], wildplants: [], traps: [], creatures: [],
    };
    entry.grid[0] = WorldGen.T.BUILDING;
    const labels = { list: [], add(slot) { this.list.push(slot); } };
    const scene = {
      depth: 0, cellM: 5, cellsPerTile: 32, tileEdgeM: 160,
      mPerPx: 160 / WorldGen.TILE_PX, originPx: { x: 0, y: 0 },
      startWorldM: { x: 0, y: 0 }, playerM: { x: 2.5, y: 2.5 },
      viewCenterX: 176, viewCenterY: 176,
      save: { starterShopId: 'home', houseLuxury: { home: { score: 9 } } },
      homeInside: liftSceneMethod('homeInside'),
      upgradeHome: liftSceneMethod('upgradeHome'),
      cellAt(x, y) { return worldMetersToTileCell(this, x, y); },
      playerToWorldCell() { return viewAnchorCell(this); },
      // A footprint-rendered Home has no sprite texture; its sign uses signLiftPx.
      textures: { exists: () => false }, add: { text: textSlot, sprite: () => textSlot() },
      _daylight: { minute: Math.floor(Date.now() / 60000), value: 1 },
      labelContainer: labels, objectsContainer: { add() {} },
      shopPlateGfx: { clear() {} }, tierGfx: { clear() {} }, _homeIntro: { phase: 'wait' },
    };
    SaveState.defaults(scene.save);
    for (const name of ['object', 'tower', 'fruit', 'castleFlag', 'pad', 'chestLabel',
      'shopLabel', 'planted', 'plantedTimer', 'creature', 'spark']) scene[name + 'Pool'] = [];
    const previous = WorldGen.tileCache, previousDocument = globalThis.document;
    globalThis.document = { getElementById: () => null, body: { classList: { contains: () => false } } };
    WorldGen.tileCache = new Map([[WorldGen.tileKey(0, 0), entry]]);
    try { fn(scene, labels); } finally {
      WorldGen.tileCache = previous;
      globalThis.document = previousDocument;
    }
  }

  const visible = scene => scene.shopLabelPool.filter(slot => slot.visible);
  const homeSign = rank => `${Shops.BUILDING_LABEL.trailer} (${rank})`;

  test('Home upgrade: a tab of the Home dialog, never a map button; one-time and persisted', () => withHome((scene) => {
    Render.drawObjects(scene);
    assert.falsy(scene._homeUpgradeButton, 'no in-world upgrade button');
    const offers = [];
    Object.assign(scene, {
      _homeTabs: liftSceneMethod('_homeTabs'), presentHomeUpgrade: liftSceneMethod('presentHomeUpgrade'),
      presentHomeSell() { offers.push({ sell: true }); },
      _homeKindIcon: () => undefined, _homeKindLabel: liftSceneMethod('_homeKindLabel'), flash() {}, showOfferModal(o) { offers.push(o); },
    });
    const tabs = scene._homeTabs(0, 0, 'sell');
    assert.eq(tabs.map(t => t.label).join(','), 'Sell,Upgrade');
    assert.truthy(tabs[0].active); assert.falsy(tabs[1].active);
    tabs[1].onSelect();
    const page = offers.pop();
    assert.eq(page.acceptLabel, 'Upgrade');
    assert.truthy(page.tabs[1].active, 'the Upgrade tab is the open page');
    page.onAccept();
    assert.eq(HomeArea.storeys(JSON.parse(JSON.stringify(scene.save))), 2, 'upgrade survives save serialization');
    assert.falsy(scene.upgradeHome(), 'one-time upgrade');
    assert.eq(scene._homeTabs(0, 0, 'sell').length, 0, 'no tab row once there is nothing left to upgrade');
    scene.presentHomeUpgrade(0, 0);
    assert.truthy(offers.pop().sell, 'a stale Upgrade tab falls back to Sell');
  }));

  test('furniture HUD: the map never shows the luxury score, inside, outside or after dark', () => withHome(scene => {
    for (const [x, daylight] of [[2.5, 1], [2.5, 0], [7.5, 1], [7.5, 0]]) {
      scene.playerM.x = x;
      scene._daylight.value = daylight;
      Render.drawObjects(scene);
      assert.eq(visible(scene).length, 1, `only the Home sign at x=${x}, daylight=${daylight}`);
      assert.falsy(/^\d+$/.test(visible(scene)[0].text), 'no bare score label');
    }
  }));

  test('Home sign: inside Home it rises just above the lit room into the dark', () => withHome(scene => {
    scene._homeIntro = null;
    scene._homeSignT0 = performance.now() - 10000;
    Render.drawObjects(scene);
    const outdoorY = visible(scene)[0].y;
    const ring = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }];
    scene.homeInterior = () => (scene.homeInside() ? { ring, key: 'home@0,0' } : null);
    Render.drawObjects(scene);
    const sign = visible(scene)[0];
    const anchor = viewAnchorWorldM(scene);
    const roomTop = Lighting.indoorTopPx(scene, scene.homeInterior(), anchor.x, anchor.y);
    assert.eq(sign.y, Math.round(roomTop - sign.height - HomeArea.INDOOR_SIGN_GAP_PX),
      'sign bottom sits the gap above the lit silhouette');
    assert.truthy(sign.y < outdoorY, 'the indoor seat is higher than the roof seat');
    scene.playerM.x = 7.5;
    Render.drawObjects(scene);
    assert.eq(visible(scene)[0].y, outdoorY, 'outside, the sign returns to its roof seat');
  }));

  test('Home dialog: Sell and Upgrade pages carry the luxury score on their chip', () => withHome(scene => {
    const offers = [];
    Object.assign(scene, {
      _homeTabs: liftSceneMethod('_homeTabs'), presentHomeUpgrade: liftSceneMethod('presentHomeUpgrade'),
      presentHomeSell: liftSceneMethod('presentHomeSell'), _homeKindLabel: liftSceneMethod('_homeKindLabel'),
      _homeKindIcon: () => undefined, showOfferModal(o) { offers.push(o); },
    });
    scene.save.inv = []; scene.save.selSlot = 0;
    scene.presentHomeSell(0, 0);
    assert.eq(offers.pop().kindLabel, 'Luxury 9');
    scene.save.houseLuxury.home.score = 16;
    scene.presentHomeUpgrade(0, 0);
    assert.eq(offers.pop().kindLabel, 'Luxury 16', 'the chip re-reads Furniture.luxuryOf');
  }));

  test('Home sign: rank follows luxury indoors, outdoors, by day and by night', () => withHome(scene => {
    scene._homeIntro = null;
    scene._homeSignT0 = performance.now() - 10000;
    Render.drawObjects(scene);
    const label = visible(scene)[0];
    assert.eq(label.text, homeSign('Homely'));
    scene.save.houseLuxury.home.score = 16;
    Render.drawObjects(scene);
    assert.eq(visible(scene)[0], label, 'rank changes update the existing text slot');
    assert.eq(label.text, homeSign('Comfortable'));
    scene.save.houseLuxury.home.score = 0;
    Render.drawObjects(scene);
    assert.eq(label.text, homeSign(MemoryStory.LUXURY_BARE), 'empty Home still shows its rank');
    scene.playerM.x = 7.5;
    for (const daylight of [1, 0]) {
      scene._daylight.value = daylight;
      Render.drawObjects(scene);
      assert.eq(visible(scene)[0].text, homeSign(MemoryStory.LUXURY_BARE));
    }
  }));

  test('furniture HUD: luxury descriptor follows the milestone thresholds', () => {
    assert.eq(MemoryStory.luxuryRank(0), MemoryStory.LUXURY_BARE);
    assert.eq(MemoryStory.luxuryRank(3), MemoryStory.LUXURY_BARE);
    for (const row of MemoryStory.LUXURY_MILESTONES) assert.eq(MemoryStory.luxuryRank(row.luxury), row.rank);
    assert.eq(MemoryStory.luxuryRank(500), 'Regal');
  });

  test('resident plaque: saved housing selects the matching face and excludes player Home', () => withHome(scene => {
    const house = { id: 'tilly-house', kind: 'house', tier: 9 };
    scene.save.restoredHouses = { [house.id]: 'plain' };
    scene.save.discovered = { ['house:' + house.id]: true };
    scene.save.npcHomes = { tilly: { role: 'wanderer', houseId: house.id, x: 20, y: 20 } };
    const plaque = Render.residentPlaque(scene, house);
    assert.eq(plaque.id, 'tilly');
    assert.eq(plaque.name, 'Tilly');
    assert.eq(plaque.portrait, 'assets/portraits/wanderer_housed.png');
    assert.eq(Render.residentPlaque(scene, { id: 'empty' }), null);
    scene.save.starterShopId = house.id;
    assert.eq(Render.residentPlaque(scene, house), null);
    scene.save.starterShopId = 'home'; scene.depth = 1;
    assert.eq(Render.residentPlaque(scene, house), null);
  }));
})();
