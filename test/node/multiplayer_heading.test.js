// Exercise the shipped draw passes with synthetic peers; no relay or GPS.
function mpHeadingFixture(angle, zoom = 1) {
  const module = new Function('window', 'HeadingUp', 'Visibility', 'worldMetersToScreen',
    'screenToWorldMeters', 'playerWorldM',
    MULTIPLAYER_SRC.replace('return { start, stop, tick,',
      'return { _draw: { S, drawPeers, drawPings }, start, stop, tick,') + '\nreturn Multiplayer;')(
    {}, HeadingUp, { hidden: () => false }, (sc, x, y) => ({ x, y }),
    (sc, x, y) => ({ x, y }), () => ({ x: 100, y: 100 }));
  function art() {
    const o = { anims: {}, width: 80, height: 16, visible: true, rotation: 0, circles: [], triangles: [] };
    for (const k of ['setOrigin', 'setScale', 'setTint', 'setDisplaySize', 'setAlpha', 'lineStyle', 'fillStyle']) o[k] = function () { return this; };
    o.setPosition = function (x, y) { this.x = x; this.y = y; return this; };
    o.setRotation = function (r) { this.rotation = r; return this; };
    o.setVisible = function (v) { this.visible = v; return this; };
    o.setText = function (s) { this.text = s; return this; };
    o.play = function (key) { this.anims.currentAnim = { key }; return this; };
    o.clear = function () { this.circles = []; this.triangles = []; return this; };
    o.strokeCircle = o.fillCircle = function (...args) { this.circles.push(args); return this; };
    o.strokeTriangle = o.fillTriangle = function (...args) { this.triangles.push(args); return this; };
    o.add = function () {};
    return o;
  }
  const scene = { _headingUp: true, mapRot: angle, mapZoom: zoom, viewCenterX: 100, viewCenterY: 100,
    viewSize: 200, mPerPx: 1, cellM: 7, depth: 0, playerFeetNudgeY: -12, save: {},
    _peerUprightPieces: [], worldContainer: { add() {} }, shadowContainer: { add() {} },
    add: { image: art, sprite: art, text: art, graphics: art },
    _drawEnemyHealthBar(gfx, x, y) { this.bar = { x, y }; } };
  const state = module._draw.S;
  Object.assign(state, { scene, status: 'off', container: art(), dotGfx: art(), barGfx: art() });
  return { module, scene, state };
}
function mpHeadingNear(a, b) { assert.lt(Math.abs(a - b), 1e-7, `${a} should equal ${b}`); }

test('multiplayer heading: peer body faces screen direction, label and health stay above ground anchor', () => {
  for (const [angle, facing] of [[0, 'right'], [-Math.PI / 2, 'up'], [Math.PI, 'left'], [Math.PI / 2, 'down']]) {
    const { module, scene, state } = mpHeadingFixture(angle);
    const peer = { x: 130, y: 120, fx: 1, fy: 0, e: 0.5, m: 1, d: 0, seenAt: 1000, name: 'Ada', color: 0xffffff };
    state.peers.set(1, peer);
    module._draw.drawPeers(scene, 1000, 0.016);
    assert.truthy(peer.spr.anims.currentAnim.key.endsWith(`-walk-${facing}`));
    assert.eq(peer.spr._huAnchor.x, 130); assert.eq(peer.spr._huAnchor.y, 120);
    const anchor = HeadingUp.toScreenPt(scene, 130, 120);
    mpHeadingNear(peer.lbl.x, anchor.x);
    mpHeadingNear(peer.lbl.y, anchor.y - 35);
    assert.eq(scene.bar.x, Math.round(anchor.x));
    assert.eq(scene.bar.y, Math.round(anchor.y - 35) + 1);
    assert.eq(peer.fx, 1); assert.eq(peer.fy, 0, 'wire direction stays world-relative');
    peer.seenAt = performance.now();
    module.tick(scene);
    // Parent container plus camera cancels text rotation and preserves its
    // already-turned coordinate, without removing the world clip or zoom.
    const c = Math.cos(-angle), s = Math.sin(-angle);
    const wx = state.container.x + c * peer.lbl.x - s * peer.lbl.y;
    const wy = state.container.y + s * peer.lbl.x + c * peer.lbl.y;
    const drawn = HeadingUp.toScreenPt(scene, wx, wy);
    mpHeadingNear(drawn.x, peer.lbl.x); mpHeadingNear(drawn.y, peer.lbl.y);
    mpHeadingNear(state.container.rotation + angle, 0);
  }
});

test('multiplayer heading: square corner peer becomes visible circle-edge dot at every angle and zoom', () => {
  for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI]) for (const zoom of [1, 1.5, 2]) {
    const { module, scene, state } = mpHeadingFixture(angle, zoom);
    state.peers.set(1, { x: 180, y: 180, fx: 1, fy: 0, e: 1, seenAt: 1000, d: 0 });
    module._draw.drawPeers(scene, 1000, 0.016);
    assert.eq(scene._peerUprightPieces.length, 0);
    const dot = state.dotGfx.circles[1];
    assert.truthy(dot);
    mpHeadingNear(Math.hypot(dot[0] - 100, dot[1] - 100), 100 / zoom - Multiplayer.PEER_DOT_INSET);
    const dir = HeadingUp.toScreenVec(scene, 80, 80);
    mpHeadingNear((dot[0] - 100) * dir.y - (dot[1] - 100) * dir.x, 0);
  }
});

test('multiplayer heading: corner ping arrow and every label corner fit circular mask', () => {
  for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI]) for (const zoom of [1, 1.5]) {
    const { module, scene, state } = mpHeadingFixture(angle, zoom);
    const ping = { x: 180, y: 180, at: 1000, name: 'Ada', color: 0xffffff };
    state.pings.push(ping);
    module._draw.drawPings(scene, 1000);
    assert.truthy(ping.txt.visible);
    assert.eq(ping.gfx.triangles.length, 2);
    for (let i = 0; i < 6; i += 2) {
      const a = ping.gfx.triangles[0];
      assert.lt(Math.hypot(a[i] - 100, a[i + 1] - 100), 100 / zoom);
    }
    for (const dx of [-40, 40]) for (const dy of [-8, 8]) {
      assert.lt(Math.hypot(ping.txt.x + dx - 100, ping.txt.y + dy - 100), 100 / zoom);
    }
  }
});

test('multiplayer north up: peer placement and facing ignore inactive map rotation', () => {
  const { module, scene, state } = mpHeadingFixture(Math.PI / 2);
  scene._headingUp = false;
  const peer = { x: 130, y: 120, fx: 1, fy: 0, e: 0.5, m: 1, d: 0, seenAt: performance.now(), name: 'Ada', color: 0xffffff };
  state.peers.set(1, peer);
  module.tick(scene);
  assert.truthy(peer.spr.anims.currentAnim.key.endsWith('-walk-right'));
  assert.eq(peer.spr.x, 130); assert.eq(peer.spr.y, 108);
  assert.eq(peer.sh.x, 130); assert.eq(peer.sh.y, 119);
  assert.eq(peer.lbl.x, 130); assert.eq(peer.lbl.y, 85);
  assert.eq(scene.bar.x, 130); assert.eq(scene.bar.y, 86);
  assert.eq(state.container.rotation, 0);
});
