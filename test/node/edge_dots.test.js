// Compass dots use the visible map boundary, and saved sightings survive reloads.
(function () {
  // The rim bearings are rows of MARKERS, each drawn by _drawMarker (the
  // table is lifted beside the two methods; its predicates read globals).
  const names = ['_drawMarkers() {', '_tapEdgeDot(sx, sy) {', '_drawEdgeDotLabel(row, target, marker, point, key = row.key) {', '_drawEdgeDot(targetWX, targetWY, fillColor, r = EDGE_DOT_R) {', '_drawMarker(row) {', '_clearMarkers() {', '_drawGpsRimDot() {'];
  const MARKERS = new Function(SCENE_SRC.match(/\nconst _markClaimed = [\s\S]*?\nconst MARKERS = \[[\s\S]*?\n\];/)[0] + 'return MARKERS;')();
  const row = (key) => MARKERS.find((r) => r.key === key);
  const DOTS = new Function(SCENE_SRC.match(/\nconst EDGE_DOT_R = [\s\S]*?\nconst GPS_RIM_DOT = .*;/)[0] + 'return { EDGE_DOT_R, GPS_RIM_DOT };')();
  const methods = new Function('W', 'H', 'persistSave', 'MARKERS', 'EDGE_DOT_R', 'GPS_RIM_DOT', 'return ({' + names.map(signature => {
    const start = SCENE_SRC.indexOf('\n  ' + signature);
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return SCENE_SRC.slice(start + 1, end + 4);
  }).join(',') + '});')(352, 844, save => { save.persisted = true; }, MARKERS, DOTS.EDGE_DOT_R, DOTS.GPS_RIM_DOT);
  function fixture() {
    const circles = [];
    return Object.assign({
      startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
      viewLeft: 0, viewTop: 96, viewSize: 352, viewCenterX: 176, viewCenterY: 272,
      playerScreen: () => ({ x: 176, y: 272 }),
      worldMetersToScreen(x, y) { const p = this.playerScreen(); return { x: p.x + x * 10, y: p.y + y * 10 }; },
      facingGfx: { fillStyle() {}, fillCircle(x, y, r) { circles.push({ x, y, r }); } },
      circles, save: {}, depth: 0,
    }, methods);
  }
  test('edge dots: the starter tutorial wears the same labelled rim dot, never the arrow', () => {
    const lifted = new Function('ITEM_BY_ID', SCENE_SRC.match(/\nconst STARTER_MARK = [\s\S]*?\nfunction starterGoalLabel[\s\S]*?\n}/)[0] + 'return { STARTER_MARK, starterGoalLabel };')(ITEM_BY_ID);
    const s = fixture();
    const labelled = [];
    s._drawEdgeDotLabel = (row, target, marker, point) => labelled.push({ row, marker, point });
    const point = s._drawEdgeDot(40, 0, lifted.STARTER_MARK.color);
    s._drawEdgeDotLabel(lifted.STARTER_MARK, {}, { label: lifted.starterGoalLabel({ event: 'till' }, { x: 1, y: 1 }) }, point);
    assert.truthy(point && s.circles.length === 2, 'drawn as the rim dot');
    assert.eq(labelled[0].row.source, 'Tutorial');
    assert.eq(labelled[0].marker.label, 'Plot');
    assert.eq(lifted.starterGoalLabel({ event: 'plant' }, { id: 'chest_start_1', crate: true }), 'Supply crate');
    assert.eq(lifted.starterGoalLabel({ event: 'chest' }, { id: 'chest_start_9' }), 'Relic chest');
    assert.eq(lifted.starterGoalLabel({ event: 'restore' }, { kind: 'groundstack', itemId: 'wood', id: 'chest_start_4' }), ITEM_BY_ID.wood.name);
    const block = SCENE_SRC.slice(SCENE_SRC.indexOf('// Starter guidance'), SCENE_SRC.indexOf('// Starter guidance') + 3000);
    assert.truthy(block.includes('_drawEdgeDot(goal.x') && !block.includes('_drawEdgeCompass('), 'the starter bearing is a dot');
  });
  // The GPS fix is never out of sight: the ring is drawn whenever there is a
  // fix, and once the ring's centre leaves the visible map its bearing goes on
  // the rim as a micro gold dot, unlabelled, drawn after the markers so it
  // survives the per-frame wipe of the rim layer.
  test('edge dots: the GPS fix gets a micro gold rim dot only once its ring is off the map', () => {
    const s = fixture();
    s.viewCenterX = 176; s.viewCenterY = 272; s.mapZoom = 1;
    s.gpsM = { x: 0, y: 0 };
    s.gpsGhost = { visible: true, x: 176, y: 272 };
    s._drawGpsRimDot();
    assert.eq(s.circles.length, 0, 'on the feet: no rim dot');
    s.gpsGhost = { visible: true, x: 176 + 170, y: 272 };   // still inside the square
    s._drawGpsRimDot();
    assert.eq(s.circles.length, 0, 'inside the map: the ring itself shows, no dot');
    s.gpsM = { x: 60, y: 0 };
    s.gpsGhost = { visible: true, x: 176 + 190, y: 272 };   // past the right edge
    s._drawGpsRimDot();
    assert.eq(s.circles.length, 2, 'off the map: keyline and dot');
    assert.eq(s.circles[1].r, DOTS.GPS_RIM_DOT.r, 'a micro dot, smaller than a find\'s');
    assert.eq(DOTS.EDGE_DOT_R * 2, 3);
    assert.eq(s.circles[0].r, DOTS.GPS_RIM_DOT.r + 1, 'its keyline a pixel wider');
    assert.truthy(s.circles[1].x > 300 && Math.abs(s.circles[1].y - 272) < 1, 'on the right rim, toward the fix');
    // Zoomed in, the same screen point is off the map sooner.
    s.circles.length = 0;
    s.gpsGhost = { visible: true, x: 176 + 100, y: 272 };
    s._drawGpsRimDot();
    assert.eq(s.circles.length, 0, 'inside at 1×');
    s.mapZoom = 2;
    s._drawGpsRimDot();
    assert.eq(s.circles.length, 2, 'outside at 2×');
    // No fix, or a hidden ring: nothing.
    s.circles.length = 0;
    s.gpsM = null;
    s._drawGpsRimDot();
    assert.eq(s.circles.length, 0, 'no GPS: no dot');
    // Drawn right after the markers, inside the wiped layer.
    const at = SCENE_SRC.indexOf('\n    this._drawMarkers();');
    assert.truthy(SCENE_SRC.slice(at, at + 80).includes('this._drawGpsRimDot();'), 'drawn with the markers');
    assert.falsy(/_drawEdgeDotLabel\([^)]*GPS_RIM_DOT/.test(SCENE_SRC), 'unlabelled');
  });
  // North-up runs the map at MAP_DEFAULT_ZOOM about the view centre; a rim
  // measured on the full square put every dot outside the picture there.
  test('edge dots: the square rim is the VISIBLE rim at the current zoom', () => {
    const s = fixture();
    let p = s._drawEdgeDot(100, 0, 0xffffff);
    assert.eq(p.right, 352 - 5, 'at 1×: the square\'s own edge, inset');
    assert.truthy(Math.abs(s.circles[1].x - (352 - 5)) < 1e-9 && Math.abs(s.circles[1].y - 272) < 1e-9);
    s.circles.length = 0; s.mapZoom = 2;
    p = s._drawEdgeDot(100, 0, 0xffffff);
    assert.eq(p.right, 176 + 176 / 2 - 5, 'at 2×: half the square shows, so the rim is half as far');
    assert.eq(p.left, 176 - 176 / 2 + 5); assert.eq(p.top, 272 - 88 + 5); assert.eq(p.bottom, 272 + 88 - 5);
    assert.truthy(Math.abs(s.circles[1].x - p.right) < 1e-9, 'the dot sits on that rim');
    assert.eq(s.circles[1].r, 1.5 / 2, 'and shrinks with the zoom so it stays the same size on screen');
  });
  test('edge dots: the rim layer is wiped every frame before the bearings draw', () => {
    const at = SCENE_SRC.indexOf('\n    this._drawMarkers();');
    assert.truthy(at > 0, 'update draws the markers');
    assert.truthy(SCENE_SRC.slice(at - 300, at).includes('this.facingGfx.clear();'), 'facingGfx cleared just before');
  });
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
    s.save.telescopeCompass = [{ targetId: 'a', depth: 0, until: now + 10000, x: 100, y: 0 }];
    s.save.wayfarerCompass = [{ targetId: 'b', depth: 0, until: now + 10000, x: 0, y: 100 }];
    s._telescopeTrackedTarget = marker => marker;
    s._drawMarkers();
    const a = s._edgeDotLabels['telescopeCompass:a'], b = s._edgeDotLabels['wayfarerCompass:b'];
    assert.truthy(a.visible && b.visible, 'labels start visible');
    const point = s._edgeDotPoints['telescopeCompass:a'];
    assert.truthy(s._tapEdgeDot(point.x - 10, point.y), 'touch near the small dot counts');
    assert.falsy(a.visible);
    assert.truthy(b.visible, 'other labels remain visible');
    s._drawMarkers();
    assert.falsy(a.visible, 'rendering does not reveal hidden labels');
    assert.truthy(s._edgeDotPoints['telescopeCompass:a'], 'hidden label keeps its dot tappable');
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
  test('edge dots: several marks of one kind and of many kinds show at once, each clearing alone', () => {
    const s = fixture(), drawn = [];
    s._drawEdgeDot = (x, y, color) => { drawn.push({ x, y, color }); return { x, y, left: 5, right: 347, top: 101, bottom: 443 }; };
    s._drawEdgeDotLabel = (row, target, marker, point, key) => { (s._edgeDotPoints ||= {})[key] = point; };
    s._telescopeTrackedTarget = marker => marker;
    const until = Date.now() + 10000;
    // Two neighbours' directions, two finds, a legacy single map mark and the Pairy's.
    s.save.wayfarerCompass = Buffs.withMark(Buffs.withMark(undefined, { targetId: 'w1', depth: 0, until, x: 10, y: 0 }),
      { targetId: 'w2', depth: 0, until, x: 0, y: 10 });
    s.save.telescopeCompass = [{ targetId: 't1', depth: 0, until, x: 20, y: 0 }, { targetId: 't2', depth: 0, until, x: 0, y: 20 }];
    s.save.treasureCompass = { targetId: 'm1', depth: 0, until, x: 30, y: 0 };
    s.pairyCompass = [{ targetId: 'p1', until, x: 40, y: 0 }];
    s._drawMarkers();
    assert.eq(Object.keys(s._edgeDotPoints).sort().join(),
      'pairyCompass:p1,telescopeCompass:t1,telescopeCompass:t2,treasureCompass:m1,wayfarerCompass:w1,wayfarerCompass:w2');
    assert.eq(drawn.length, 6);
    s.save.wayfarerCompass[0].until = Date.now() - 1;
    s._drawMarkers();
    assert.eq(s.save.wayfarerCompass.map(m => m.targetId).join(), 'w2', 'an expired mark leaves the others standing');
    assert.truthy(s.save.persisted);
    assert.eq(Buffs.withMark(s.save.wayfarerCompass, { targetId: 'w2', until: 1 }).length, 1, 'the same target replaces its mark');
    const ext = Buffs.withMark([{ targetId: 'c', until: until }], { targetId: 'c' }, 1000, Date.now());
    assert.eq(ext.length, 1); assert.eq(ext[0].until, until + 1000, 'a timed mark on the same target extends');
    assert.eq(Buffs.KINDS.field_scope.read(s.save), until, 'the chip runs until the last mark');
  });
  test('edge dots: every bearing reaches the actual map rim', () => {
    for (const [dx, dy] of [[1000, 0], [-1000, 0], [0, 1000], [0, -1000], [1000, 400], [-20, -40]]) {
      const s = fixture();
      s._drawEdgeDot(dx, dy, 0xffd24a);
      const p = s.circles[1];
      assert.truthy(p.x === 5 || p.x === 347 || p.y === 101 || p.y === 443, 'dot touches an inset edge');
      assert.truthy(p.x >= 5 && p.x <= 347 && p.y >= 101 && p.y <= 443, 'whole dot remains visible');
      assert.eq(p.r, 1.5);
    }
  });
  test('edge dots: rotated diagonal bearings stay on the circular rim through zoom and peek', () => {
    const wasEnabled = HeadingUp.enabled;
    HeadingUp.enabled = true;
    try {
      for (const zoom of [1, 1.8]) for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
        const s = fixture();
        Object.assign(s, { _headingUp: true, mapRot: angle, mapZoom: zoom, viewCenterX: 176, viewCenterY: 272 });
        s.playerScreen = () => ({ x: 155, y: 281 });
        const point = s._drawEdgeDot(100, 100, 0xffd24a);
        const screen = HeadingUp.toOverlayPt(s, point.x, point.y);
        assert.inRange(Math.hypot(screen.x - 176, screen.y - 272), 170.999, 171.001);
        assert.inRange(s.circles[1].r * zoom, 1.499, 1.501, 'dot stays touch-visible at pinch zoom');
        s._edgeDotPoints = { target: point };
        assert.truthy(s._tapEdgeDot(point.x, point.y), 'inverse-transformed tap finds the visible dot');
      }
    } finally { HeadingUp.enabled = wasEnabled; }
  });
  test('edge dots: close targets mark their actual location through a peek', () => {
    const s = fixture();
    s.playerScreen = () => ({ x: 80, y: 190 });
    s._drawEdgeDot(2, 1, 0xffd24a);
    assert.eq(s.circles[1].x, 100);
    assert.eq(s.circles[1].y, 200);
    s._drawEdgeDot(0, 0, 0xffd24a);
    assert.eq(s.circles.length, 4, 'target at the player remains marked');
    assert.eq(s.circles[3].x, 80);
    assert.eq(s.circles[3].y, 190);
  });
  test('edge dots: clipped map boundaries stay within the screen', () => {
    const s = fixture();
    s.viewLeft = -30; s.viewTop = -40;
    s._drawEdgeDot(-100, -100, 0xffd24a);
    const p = s.circles[1];
    assert.truthy(p.x >= 5 && p.y >= 5);
    assert.truthy(p.x === 5 || p.y === 5);
  });
  test('edge dots: tracked sightings follow targets, drop on another floor, expire and clear claimed targets', () => {
    const s = fixture(), drawn = [];
    s._drawEdgeDot = (...args) => { drawn.push(args); };
    s._telescopeTrackedTarget = () => ({ x: 450, y: 300 });
    s.save.telescopeCompass = { depth: 0, until: Date.now() + 86400000, x: 100, y: 100 };
    s._drawMarker(row('telescopeCompass'));
    assert.eq(drawn[0].join(','), [450, 300, 0xffd24a].join(','), 'the row\'s colour');
    s.depth = 1;
    s._drawMarker(row('telescopeCompass'));
    assert.eq(drawn.length, 1);
    assert.eq(s.save.telescopeCompass, undefined, 'a mark made on another floor is dropped, not kept');
    s.depth = 0; s._telescopeTrackedTarget = () => null;
    s.save.telescopeCompass = { depth: 0, until: Date.now() + 86400000, x: 100, y: 100 };
    s._edgeDotTargets['telescopeCompass:0'].at -= 500;
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
  test('edge dots: switching floors clears every rim mark, depth-stamped or not', () => {
    const s = fixture(), until = Date.now() + 10000;
    s.pairyCompass = [{ targetId: 'p', x: 1, y: 2, until }];
    s.deliveryCompass = { id: 'h', x: 3, y: 4 };
    s.save.telescopeCompass = [{ targetId: 't', depth: 0, until, x: 5, y: 6 }];
    s.save.wayfarerCompass = [{ targetId: 'w', depth: 0, until, x: 7, y: 8 }];
    s.save.treasureCompass = [{ targetId: 'm', depth: 0, until, x: 9, y: 0 }];
    s._clearMarkers();
    for (const r of MARKERS) {
      assert.falsy((r.store === 'scene' ? s : s.save)[r.key], `${r.key} cleared`);
    }
    // Every depth writer calls it: stairs/rope/elevator, the realm floors, a blackout.
    for (const sig of ['\n  changeDepth(delta, stair, options = {}) {', '\n  _passOutToSurface() {', '\n  _realmSwitchDepth(depth,point) {']) {
      const start = SCENE_SRC.indexOf(sig);
      assert.truthy(start >= 0 && SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start)).includes('this._clearMarkers()'), sig.trim());
    }
  });
})();
