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
  const sign = rank => `${Shops.BUILDING_LABEL.trailer} (${rank})`;

  test('Home sign: names the luxury rank with no score, in the sign position, and fades over the player', () => withHome(scene => {
    assert.truthy(scene.homeInside(), 'player stands in the owned Home cell');
    Render.drawObjects(scene);
    assert.eq(visible(scene).length, 1, 'one Home sign, no separate luxury line');
    const [label] = visible(scene);
    assert.eq(label.text, '', 'Home is still waiting to type');
    scene._homeIntro = null;
    scene._homeSignT0 = performance.now() - 10000;
    Render.drawObjects(scene);
    assert.eq(label.text, sign('Homely'));
    assert.falsy(/\d/.test(label.text), 'no luxury number on the sign');
    assert.eq(label.x, Math.round(scene.viewCenterX + HomeArea.SIGN_NUDGE_PX.x));
    assert.eq(label.y, Math.round(scene.viewCenterY - HomeArea.HOUSE.signLiftPx - label.height + HomeArea.SIGN_NUDGE_PX.y));
    assert.eq(label.alpha, 1, 'unobstructed sign is opaque');
    scene.player = { visible: true, x: label.x, y: label.y + label.height / 2,
      displayWidth: 24, displayHeight: 20, originX: 0.5, originY: 0.5 };
    Render.drawObjects(scene);
    assert.eq(label.alpha, 0.3, 'sign fades when its text overlaps the player');
  }));

  test('Home sign: rank follows luxury indoors, outdoors, by day and by night', () => withHome(scene => {
    scene._homeIntro = null;
    scene._homeSignT0 = performance.now() - 10000;
    Render.drawObjects(scene);
    const [label] = visible(scene);
    assert.eq(label.text, sign('Homely'));
    scene.save.houseLuxury.home.score = 16;
    Render.drawObjects(scene);
    assert.eq(visible(scene)[0], label, 'rank changes update the existing text slot');
    assert.eq(label.text, sign('Comfortable'));
    scene.save.houseLuxury.home.score = 0;
    Render.drawObjects(scene);
    assert.eq(label.text, sign(MemoryStory.LUXURY_BARE), 'empty Home still shows its rank');
    scene.playerM.x = 7.5;
    assert.falsy(scene.homeInside(), 'one cell east is outside Home');
    for (const daylight of [1, 0]) {
      scene._daylight.value = daylight;
      Render.drawObjects(scene);
      assert.eq(visible(scene).length, 1);
      assert.eq(visible(scene)[0].text, sign(MemoryStory.LUXURY_BARE));
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
