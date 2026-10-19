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

  test('furniture HUD: indoor score renders instantly in white above Home and fades over the player', () => withHome((scene, labels) => {
    assert.truthy(scene.homeInside(), 'player stands in the owned Home cell');
    Render.drawObjects(scene);
    assert.eq(visible(scene).length, 2, 'Home sign and luxury share the shop label pool');
    const [sign, score] = visible(scene);
    assert.truthy(labels.list.includes(score), 'score is attached to the label container');
    assert.eq(sign.text, '', 'Home is still waiting to type');
    assert.eq(score.text, '9', 'luxury appears immediately during the Home introduction');
    assert.eq(score.style.color, '#ffffff');
    assert.eq(scene._homeSignT0, undefined, 'luxury does not start the Home typing clock');
    assert.eq(score.x, Math.round(scene.viewCenterX + HomeArea.SIGN_NUDGE_PX.x));
    assert.eq(sign.y, Math.round(scene.viewCenterY - HomeArea.HOUSE.signLiftPx - sign.height + HomeArea.SIGN_NUDGE_PX.y));
    assert.eq(score.y, sign.y - score.height - 4, 'one text height plus four pixels above the sign');
    assert.eq(score.alpha, 1, 'unobstructed score is opaque');

    // Complete Home's typing, then move the screen-space player box over each
    // label. World feet stay in Home, just as when sprite art overlaps its roof.
    scene._homeSignT0 = performance.now() - 10000;
    scene.player = { visible: true, x: score.x, y: score.y + score.height / 2,
      displayWidth: 24, displayHeight: 20, originX: 0.5, originY: 0.5 };
    Render.drawObjects(scene);
    assert.eq(score.alpha, 0.3, 'score fades when its text overlaps the player');
    assert.eq(sign.alpha, 1, 'non-overlapping Home label stays opaque');
    scene.player.y = sign.y + sign.height / 2;
    Render.drawObjects(scene);
    assert.eq(sign.text, Shops.BUILDING_LABEL.trailer);
    assert.eq(sign.alpha, 0.3, 'ordinary Home label uses the same overlap alpha');
    assert.eq(score.alpha, 1, 'score opacity recovers after the overlap ends');
  }));

  test('furniture HUD: retained score updates with luxury and disappears when the player leaves Home', () => withHome(scene => {
    scene.playerM.x = 7.5;
    assert.falsy(scene.homeInside());
    Render.drawObjects(scene);
    assert.eq(visible(scene).length, 1, 'no score is allocated while outside');
    scene.playerM.x = 2.5;
    Render.drawObjects(scene);
    const score = visible(scene)[1], cached = scene._homeLuxuryLabel;
    assert.eq(score.text, '9');
    Render.drawObjects(scene);
    assert.eq(scene._homeLuxuryLabel, cached, 'unchanged state reuses the cached label');
    assert.eq(visible(scene)[1], score, 'unchanged frames reuse the pooled text');
    scene.save.houseLuxury.home.score = 16;
    Render.drawObjects(scene);
    assert.eq(visible(scene)[1], score, 'score changes update the existing text slot');
    assert.eq(score.text, '16');
    assert.truthy(scene._homeLuxuryLabel.key !== cached.key, 'luxury invalidates the cache key');
    scene.save.houseLuxury.home.score = 0;
    Render.drawObjects(scene);
    assert.eq(score.text, '0', 'empty Home still shows its score');
    scene.playerM.x = 7.5;
    assert.falsy(scene.homeInside(), 'one cell east is outside Home');
    Render.drawObjects(scene);
    assert.eq(visible(scene).length, 1, 'only the Home sign remains visible outside');
    assert.falsy(score.visible, 'retained score slot is hidden');
    assert.falsy(score.active, 'retained score slot is deactivated');
    scene.playerM.x = 2.5;
    Render.drawObjects(scene);
    assert.eq(visible(scene)[1], score, 're-entering Home reuses the retired slot');
    assert.eq(score.text, '0');
    assert.truthy(score.active);
  }));
})();
