// Compass dots use the visible map boundary, and saved sightings survive reloads.
(function () {
  // The rim bearings are rows of MARKERS, each drawn by _drawMarker (the
  // table is lifted beside the two methods; its predicates read globals).
  const names = ['_drawMarkers() {', '_tapEdgeDot(sx, sy) {', '_drawEdgeDotLabel(row, target, marker, point) {', '_drawEdgeDot(targetWX, targetWY, fillColor) {', '_drawMarker(row) {'];
  const MARKERS = new Function(SCENE_SRC.match(/\nconst _markClaimed = [\s\S]*?\nconst MARKERS = \[[\s\S]*?\n\];/)[0] + 'return MARKERS;')();
  const row = (key) => MARKERS.find((r) => r.key === key);
  const methods = new Function('W', 'H', 'persistSave', 'MARKERS', 'return ({' + names.map(signature => {
    const start = SCENE_SRC.indexOf('\n  ' + signature);
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return SCENE_SRC.slice(start + 1, end + 4);
  }).join(',') + '});')(352, 844, save => { save.persisted = true; }, MARKERS);
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
  test('edge labels: source and destination stay inside the map and stack without overlap', () => {
    const s = fixture();
    s.add = { text() {
      return { width: 60, height: 28,
        setDepth() { return this; }, setOrigin() { return this; },
        setText(value) { this.text = value; return this; },
        setPosition(x, y) { this.x = x; this.y = y; return this; },
        setVisible(value) { this.visible = value; return this; },
      };
    } };
    const point = { x: 347, y: 443, left: 5, right: 347, top: 101, bottom: 443 };
    s._drawEdgeDotLabel(row('telescopeCompass'), { name: 'Bryn' }, {}, point);
    s._drawEdgeDotLabel(row('wayfarerCompass'), { roleLabel: 'Keeper' }, { source: 'Wayfinder' }, point);
    assert.eq(s._edgeDotLabels.telescopeCompass.text, 'Telescope\nBryn');
    assert.eq(s._edgeDotLabels.wayfarerCompass.text, 'Wayfinder\nKeeper', 'a neighbour\'s mark names its speaker, not the Wayfarer\'s post');
    const [a, b] = s._edgeDotLabelBounds;
    assert.truthy(a.right <= point.right && a.bottom <= point.bottom);
    assert.truthy(b.bottom <= a.top && b.top >= point.top);
  });
  test('edge dots: tapping toggles only the nearest label and survives redraws', () => {
    const s = fixture();
    s.add = { text() { return {
      width: 60, height: 28,
      setDepth() { return this; }, setOrigin() { return this; },
      setText() { return this; }, setPosition() { return this; },
      setVisible(value) { this.visible = value; return this; },
    }; } };
    const now = Date.now();
    s.save.telescopeCompass = { depth: 0, until: now + 10000, x: 100, y: 0 };
    s.save.wayfarerCompass = { depth: 0, until: now + 10000, x: 0, y: 100 };
    s._telescopeTrackedTarget = marker => marker;
    s._drawMarkers();
    const a = s._edgeDotLabels.telescopeCompass, b = s._edgeDotLabels.wayfarerCompass;
    assert.truthy(a.visible && b.visible, 'labels start visible');
    const point = s._edgeDotPoints.telescopeCompass;
    assert.truthy(s._tapEdgeDot(point.x - 10, point.y), 'touch near the small dot counts');
    assert.falsy(a.visible);
    assert.truthy(b.visible, 'other labels remain visible');
    s._drawMarkers();
    assert.falsy(a.visible, 'rendering does not reveal hidden labels');
    assert.truthy(s._edgeDotPoints.telescopeCompass, 'hidden label keeps its dot tappable');
    assert.eq(s._edgeDotLabelBounds.length, 1, 'hidden label reserves no layout space');
    assert.truthy(s._tapEdgeDot(point.x, point.y));
    s._drawMarkers();
    assert.truthy(a.visible, 'second tap restores label');
    assert.falsy(s._tapEdgeDot(176, 272), 'ordinary map tap falls through');
    s.depth = 1;
    s._drawMarkers();
    assert.falsy(a.visible);
    assert.falsy(s._tapEdgeDot(point.x, point.y), 'absent dots have no stale hit targets');
  });
  test('edge dots: label taps are consumed before walk reset or world interaction', () => {
    const start = SCENE_SRC.indexOf('const endPeekPointer = (p) => {');
    const handler = SCENE_SRC.slice(start, SCENE_SRC.indexOf("this.input.on('pointerup'", start));
    const toggle = handler.indexOf('if (this._tapEdgeDot(up.x, up.y)) return;');
    assert.gt(toggle, handler.indexOf('if (wasDrag) return;'), 'drag release never toggles');
    assert.lt(toggle, handler.indexOf('this._resetWalkHome()'));
    assert.lt(toggle, handler.indexOf('this.handleWorldTap('));
  });
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
    s._drawEdgeDot = (...args) => { drawn.push(args); };
    s._telescopeTrackedTarget = () => ({ x: 450, y: 300 });
    s.save.telescopeCompass = { depth: 0, until: Date.now() + 86400000, x: 100, y: 100 };
    s._drawMarker(row('telescopeCompass'));
    assert.eq(drawn[0].join(','), [450, 300, 0xffd24a].join(','), 'the row\'s colour');
    s.depth = 1;
    s._drawMarker(row('telescopeCompass'));
    assert.eq(drawn.length, 1);
    assert.truthy(s.save.telescopeCompass);
    s.depth = 0; s._telescopeTrackedTarget = () => null;
    s._edgeDotTargets.telescopeCompass.at -= 500;
    s._drawMarker(row('telescopeCompass'));
    assert.eq(s.save.telescopeCompass, undefined);
    assert.truthy(s.save.persisted);
    s.save.wayfarerCompass = { depth: 0, until: Date.now() - 1 };
    s._drawMarker(row('wayfarerCompass'));
    assert.eq(s.save.wayfarerCompass, undefined);
    assert.eq(drawn.length, 1);
    // A scene-side mark (the Pairy's) clears without a persist; a claimed one goes too.
    s.pairyCompass = { targetId: 'c', x: 1, y: 2, until: Date.now() + 1000 };
    s.save.opened = ['c'];
    s._drawMarker(row('pairyCompass'));
    assert.eq(s.pairyCompass, null, 'claimed: cleared');
    assert.eq(drawn.length, 1);
    assert.eq(MARKERS.map((r) => r.key).join(), 'pairyCompass,telescopeCompass,wayfarerCompass,treasureCompass,deliveryCompass', 'the five rim bearings, one table');
  });
})();
