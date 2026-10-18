(() => {
  function sensor() {
    const listeners = {};
    let time = 100;
    const scene = { save: {}, facing: { x: 0, y: -1 } };
    liftSceneMethod('_attachCompass', {
      window: { screen: { orientation: { angle: 0 } },
        addEventListener(name, callback) { listeners[name] = callback; } },
      performance: { now: () => time },
    }).call(scene);
    return { scene, send(event) { time += 16; listeners.deviceorientation(event); } };
  }
  const near = (actual, expected) => assert.lt(Math.abs(actual - expected), 1e-6);

  test('compass sensor: iPhone rejects invalid and uncalibrated samples without changing the bearing', () => {
    const { scene, send } = sensor();
    send({ webkitCompassHeading: 90, webkitCompassAccuracy: 10 });
    near(scene.compassDeg, 90);
    const reading = scene._deviceCompass;
    for (const event of [
      { webkitCompassHeading: -1, webkitCompassAccuracy: 10 },
      { webkitCompassHeading: 0, webkitCompassAccuracy: -1 },
      { webkitCompassHeading: NaN, webkitCompassAccuracy: 10 },
      { webkitCompassHeading: Infinity, webkitCompassAccuracy: 10 },
      { webkitCompassHeading: 0, webkitCompassAccuracy: NaN },
    ]) {
      send({ alpha: 180, absolute: true, ...event });
      assert.eq(scene._deviceCompass, reading, 'unusable samples cannot replace a valid reading');
      near(scene.compassDeg, 90);
    }
    send({ webkitCompassHeading: 180, webkitCompassAccuracy: 10 });
    assert.gt(scene.compassDeg, 90, 'valid readings resume after calibration');
  });

  test('compass sensor: invalid iPhone startup does not adopt relative alpha as north', () => {
    const { scene, send } = sensor();
    send({ webkitCompassHeading: -1, webkitCompassAccuracy: -1, alpha: 180 });
    assert.eq(scene.compassDeg, undefined);
    assert.eq(scene._deviceCompass, undefined);
    send({ webkitCompassHeading: 90, webkitCompassAccuracy: 5 });
    near(scene.compassDeg, 90);
  });

  test('compass sensor: first absolute reading replaces the relative startup reference', () => {
    for (const absolute of [{ webkitCompassHeading: 90 }, { absolute: true, alpha: 270 }]) {
      const { scene, send } = sensor();
      send({ alpha: 90 });
      near(scene.compassDeg, 270);
      send(absolute);
      near(scene.compassDeg, 90);
      send({ alpha: 180 });
      near(scene.compassDeg, 90);
    }
  });
})();
