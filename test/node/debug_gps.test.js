// Simulated GPS drives the ordinary fix path while the movement stick keeps
// its independent offset. A queued device callback must never win takeover.
(function () {
  function setup() {
    let callbacks, removed = 0, watched = 0;
    const doc = { hidden: false, body: { classList: { contains: () => false } } };
    const geo = {
      subscribe: (fix, error) => { callbacks = { fix, error }; watched++; return 'watch'; },
      unsubscribe: () => removed++,
    };
    const Scene = new Function('document', 'Geo', 'navigator', 'window', '_teleportOverride',
      'WALK_M_S', 'DEBUG_SPEED_MUL', 'GPS_SNAP_M',
      SCENE_GEO_SRC + '; return SceneGeo;')(doc, geo, { geolocation: {} }, {}, null, 2.8, 5, 200);
    Scene.prototype._dialogOpen = () => !!doc.body.classList.contains('modal-open');   // app.js's busy test, stubbed
    Scene.prototype.flashAtPlayer = () => {};
    const scene = new Scene();
    Object.assign(scene, {
      playerM: { x: 25, y: 30 }, _manualOffsetM: { x: 5, y: 0 },
      _debugGpsEnabled: true, _debugGpsVec: { x: 1, y: 0 },
      flash() {}, _warnStrandedOrigin() {},
      _placeBodyOnFix() { this.playerM = { ...this.gpsM }; },
      _teleportCut(fn) { fn(); },
    });
    return { scene, doc, callbacks: () => callbacks, removed: () => removed, watched: () => watched };
  }

  test('debug GPS: first movement replaces live watch and queued callbacks cannot overwrite it', () => {
    const f = setup(), s = f.scene;
    s.startGps();
    s._gpsManualOverride = true;
    s._stepDebugGps(1);
    assert.eq(f.removed(), 1);
    assert.eq(s.gpsWatchId, null);
    assert.truthy(s._gpsSimulated);
    assert.falsy(s._gpsManualOverride);
    assert.eq(s.gpsM.x, 34);
    assert.eq(s._targetM.x, 39, 'preserves separate movement-stick offset');
    assert.eq(s.playerM.x, 25, 'body follows normally, rather than teleporting');
    f.callbacks().fix({ coords: { latitude: 80, longitude: 80 } });
    f.callbacks().error({ code: 1, message: 'late denial' });
    assert.eq(s.gpsM.x, 34);
    assert.truthy(s.gpsAvailable);
    s.startGps();
    s._retryGps();
    assert.eq(f.watched(), 1, 'lifecycle cannot restart live tracking');
  });

  test('debug GPS: enabled but idle leaves device tracking intact; disabled and modal states never move it', () => {
    const f = setup(), s = f.scene;
    s.startGps();
    s._debugGpsVec = { x: 0, y: 0 };
    s._stepDebugGps(1);
    assert.falsy(s._gpsSimulated);
    assert.eq(f.removed(), 0);
    s._debugGpsVec.x = 1;
    f.doc.body.classList.contains = () => true;
    s._stepDebugGps(1);
    assert.falsy(s._gpsSimulated);
    f.doc.body.classList.contains = () => false;
    s._stepDebugGps(1);
    const x = s.gpsM.x;
    s._debugGpsEnabled = false;
    s._stepDebugGps(1);
    assert.eq(s.gpsM.x, x);
    assert.truthy(s._gpsSimulated, 'hiding the control keeps the last simulated fix');
  });
})();
