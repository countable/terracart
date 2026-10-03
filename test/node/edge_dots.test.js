// Compass dots use the visible map boundary, and saved sightings survive reloads.
(function () {
  const names = ['_drawEdgeDot(targetWX, targetWY, fillColor) {', '_drawTrackedEdgeDot(key, color) {'];
  const methods = new Function('W', 'H', 'persistSave', 'return ({' + names.map(signature => {
    const start = SCENE_SRC.indexOf('\n  ' + signature);
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return SCENE_SRC.slice(start + 1, end + 4);
  }).join(',') + '});')(352, 844, save => { save.persisted = true; });
  function fixture() {
    const circles = [];
    return Object.assign({
      startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
      viewLeft: 0, viewTop: 96, viewSize: 352,
      playerScreen: () => ({ x: 176, y: 272 }),
      facingGfx: { fillStyle() {}, fillCircle(x, y, r) { circles.push({ x, y, r }); } },
      circles, save: {}, depth: 0,
    }, methods);
  }
  test('edge dots: every bearing reaches the actual map rim', () => {
    for (const [dx, dy] of [[1000, 0], [-1000, 0], [0, 1000], [0, -1000], [1000, 400], [-20, -40]]) {
      const s = fixture();
      s._drawEdgeDot(dx, dy, 0xffd24a);
      const p = s.circles[1];
      assert.truthy(p.x === 5 || p.x === 347 || p.y === 101 || p.y === 443, 'dot touches an inset edge');
      assert.truthy(p.x >= 5 && p.x <= 347 && p.y >= 101 && p.y <= 443, 'whole dot remains visible');
      assert.eq(p.r, 3);
    }
  });
  test('edge dots: close targets retain bearings and a peek uses the player location', () => {
    const s = fixture();
    s.playerScreen = () => ({ x: 80, y: 190 });
    s._drawEdgeDot(2, 1, 0xffd24a);
    assert.eq(s.circles[1].x, 347);
    assert.eq(s.circles[1].y, 323.5);
    s._drawEdgeDot(0, 0, 0xffd24a);
    assert.eq(s.circles.length, 2, 'no undefined bearing when already on target');
  });
  test('edge dots: clipped map boundaries stay within the screen', () => {
    const s = fixture();
    s.viewLeft = -30; s.viewTop = -40;
    s._drawEdgeDot(-100, -100, 0xffd24a);
    const p = s.circles[1];
    assert.truthy(p.x >= 5 && p.y >= 5);
    assert.truthy(p.x === 5 || p.y === 5);
  });
  test('edge dots: tracked sightings follow targets, suspend underground, expire and clear claimed targets', () => {
    const s = fixture(), drawn = [];
    s._drawEdgeDot = (...args) => drawn.push(args);
    s._telescopeTrackedTarget = () => ({ x: 450, y: 300 });
    s.save.telescopeCompass = { depth: 0, until: Date.now() + 86400000, x: 100, y: 100 };
    s._drawTrackedEdgeDot('telescopeCompass', 0xffd24a);
    assert.eq(drawn[0].join(','), [450, 300, 0xffd24a].join(','));
    s.depth = 1;
    s._drawTrackedEdgeDot('telescopeCompass', 0xffd24a);
    assert.eq(drawn.length, 1);
    assert.truthy(s.save.telescopeCompass);
    s.depth = 0; s._telescopeTrackedTarget = () => null;
    s._edgeDotTargets.telescopeCompass.at -= 500;
    s._drawTrackedEdgeDot('telescopeCompass', 0xffd24a);
    assert.eq(s.save.telescopeCompass, undefined);
    assert.truthy(s.save.persisted);
    s.save.wayfarerCompass = { depth: 0, until: Date.now() - 1 };
    s._drawTrackedEdgeDot('wayfarerCompass', 0x4488ff);
    assert.eq(s.save.wayfarerCompass, undefined);
    assert.eq(drawn.length, 1);
  });
})();
