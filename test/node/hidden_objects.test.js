(function () {
  function scene() {
    return { save: {}, depth: 0, tileEdgeM: 256, cellsPerTile: 16, cellM: 16,
      mPerPx: 1, originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
      playerM: { x: 88, y: 88 }, showMessageModal() {},
    };
  }
  function hidden(dx = 0, dy = 0) {
    return { id: `hidden_${dx}_${dy}`, hidden: true, kind: 'test_discovery', depth: 0,
      x: 88 + dx * 16, y: 88 + dy * 16 };
  }
  test('hidden objects: walking onto the same cell or any of eight adjacent cells reveals', () => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const s = scene(), o = hidden(dx, dy);
      assert.eq(HiddenObjects.isHidden(s.save, o), true);
      assert.eq(HiddenObjects.reveal(s, o), true);
      assert.eq(HiddenObjects.isHidden(s.save, o), false);
    }
  });
  test('hidden objects: two cells away remains hidden despite camera peek and extra reach', () => {
    const s = scene();
    s.cameraM = { x: 120, y: 88 }; s.peekM = { x: 32, y: 0 };
    s.save.reachUpgrades = 7; s.save.reachPotionUntil = Date.now() + 100000;
    const o = hidden(2, 0);
    assert.eq(HiddenObjects.reveal(s, o), false);
    assert.eq(HiddenObjects.isHidden(s.save, o), true);
    s.playerM.x += 16;
    assert.eq(HiddenObjects.reveal(s, o), true);
  });
  test('hidden objects: discovery survives reload and does not cross cave depths', () => {
    const s = scene(), o = hidden();
    o.depth = 1;
    assert.eq(HiddenObjects.reveal(s, o), false);
    s.depth = 1;
    assert.eq(HiddenObjects.reveal(s, o), true);
    s.save = JSON.parse(JSON.stringify(s.save));
    assert.eq(HiddenObjects.isHidden(s.save, o), false);
    assert.eq(HiddenObjects.reveal(s, o), false);
  });
  test('hidden objects: adjacency crosses a tile row with a different cell count', () => {
    const s = scene();
    s.cellsForRow = ty => ty <= 0 ? 16 : 20;
    s.playerM = { x: 200, y: 248 };
    const o = { ...hidden(), x: 198.4, y: 262.4 };
    assert.eq(HiddenObjects.reveal(s, o), true);
  });
  test('hidden objects: spirit discovery activates once without claiming shrine treasure', () => {
    const s = scene(), o = { ...hidden(1, 1), kind: 'shrine_spirit', templeZone: 'spirit-park' };
    let story;
    s.showMessageModal = row => { story = row; };
    assert.eq(HiddenObjects.reveal(s, o), true);
    assert.eq(story.body, 'Shrine spirit discovered. The shrine begins to glow.');
    assert.eq(Temples.isActive(s.save, o), true);
    assert.eq(s.save.temples['spirit-park'].rewardClaimed, false);
    assert.eq(HiddenObjects.reveal(s, o), false);
  });
  test('hidden objects: hidden generated and saved objects cannot intercept taps', () => {
    const s = scene(), o = { ...hidden(), kind: 'staircase' };
    const previous = WorldGen.forEachItem;
    WorldGen.forEachItem = (layer, fn) => { fn(o); };
    s.save.hiddenObjects = [{ ...hidden(), id: 'saved-spirit', kind: 'shrine_spirit' }];
    try {
      assert.eq(findItemInTapCell(s, 'objects', { x: 88, y: 88 }), null);
      assert.eq(TAP_HANDLERS.find(h => h.name === 'object').try({ scene: s, save: s.save, wm: { x: 88, y: 88 } }), false);
      HiddenObjects.reveal(s, o);
      assert.eq(findItemInTapCell(s, 'objects', { x: 88, y: 88 }), o);
    } finally { WorldGen.forEachItem = previous; }
  });
})();
