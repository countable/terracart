// Relay weather stays pure ambience: one code table, bounded polling, surface-only art.
(() => {
  test('weather: published condition codes map to display kinds only while precipitation falls', () => {
    assert.eq(Weather.conditionKind(1153, 0.2), 'drizzle');
    assert.eq(Weather.conditionKind(1189, 1), 'rain');
    assert.eq(Weather.conditionKind(1204, 1), 'sleet');
    assert.eq(Weather.conditionKind(1225, 1), 'snow');
    assert.eq(Weather.conditionKind(1189, 0), 'none');
    assert.eq(Weather.conditionKind(1000, 2), 'none');
  });

  test('weather: precipitation art stays on the surface', () => {
    assert.eq(Weather.effectiveKind('rain', 0), 'rain');
    assert.eq(Weather.effectiveKind('drizzle', 1), 'none');
    assert.eq(Weather.effectiveKind('snow', 3), 'none');
    assert.eq(Weather.effectiveKind('unknown', 0), 'none');
  });

  test('weather: time or one kilometre of movement earns one relay refresh', () => {
    const kelowna = { lat: 49.888, lon: -119.496 };
    assert.truthy(Weather.pollNeeded(0, null, 1, kelowna));
    assert.falsy(Weather.pollNeeded(1000, kelowna, 1000 + Weather.POLL_MS - 1,
      { lat: 49.889, lon: -119.496 }));
    assert.truthy(Weather.pollNeeded(1000, kelowna, 1000 + Weather.POLL_MS, kelowna));
    assert.truthy(Weather.pollNeeded(1000, kelowna, 2000,
      { lat: 49.898, lon: -119.496 }), 'about 1.1 km north refreshes before the timer');
  });
})();
