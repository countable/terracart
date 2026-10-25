'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { kindFor } = require('../src/weather_codes.js');
const { CACHE_MS, parsePoint, compactWeather, createWeatherService } = require('./weather');
const { createServer } = require('./index');

const response = (code, precipMm = 1) => ({ ok: true, json: async () => ({ current: { precip_mm: precipMm, condition: { code } } }) });

test('published WeatherAPI codes map to one display kind and require measured precipitation', () => {
  assert.equal(kindFor(1153, 0.2), 'drizzle');
  assert.equal(kindFor(1189, 2), 'rain');
  assert.equal(kindFor(1204, 1), 'sleet');
  assert.equal(kindFor(1225, 3), 'snow');
  assert.equal(kindFor(1000, 2), 'none');
  assert.equal(kindFor(1063, 0), 'none');
  assert.deepEqual(compactWeather({ current: { precip_mm: 2, condition: { code: 1189 } } }, 123),
    { precip: true, kind: 'rain', condition: 1189, cachedAt: 123 });
});

test('weather coordinates are strict', () => {
  assert.deepEqual(parsePoint(new URL('http://x/weather?lat=49.25&lon=-123.1')), { lat: 49.25, lon: -123.1 });
  for (const route of ['/weather', '/weather?lat=&lon=1', '/weather?lat=91&lon=0', '/weather?lat=0&lon=181', '/weather?lat=0&lat=1&lon=0']) {
    assert.throws(() => parsePoint(new URL('http://x' + route)), error => error.status === 400);
  }
});

test('nearby requests share a ten-minute cache and never expose the server key', async () => {
  let calls = 0, fetched = '', now = 1000;
  const service = createWeatherService({ apiKey: 'server-only-key', now: () => now, fetch: async url => {
    calls++; fetched = String(url); return response(1183);
  } });
  const first = await service.get({ lat: 49.251, lon: -123.101 });
  const second = await service.get({ lat: 49.252, lon: -123.102 });
  assert.deepEqual(second, first); assert.equal(calls, 1);
  assert.match(fetched, /key=server-only-key/);
  assert.equal(JSON.stringify(first).includes('server-only-key'), false);
  now += CACHE_MS + 1;
  await service.get({ lat: 49.251, lon: -123.101 });
  assert.equal(calls, 2);
});

test('weather stays disabled without a server key', async () => {
  const service = createWeatherService({ apiKey: '', fetch: async () => response(1183) });
  await assert.rejects(service.get({ lat: 49, lon: -123 }), error => error.status === 503 && error.message === 'weather disabled');
});

test('relay returns compact weather with CORS and no credential', async () => {
  const weather = createWeatherService({ apiKey: 'server-only-key', fetch: async () => response(1240) });
  const { server, relay } = createServer({ weather, geometry: { get: async () => ({}) } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/weather?lat=49&lon=-123`);
    assert.equal(res.status, 200); assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const text = await res.text(), value = JSON.parse(text);
    assert.deepEqual({ precip: value.precip, kind: value.kind, condition: value.condition },
      { precip: true, kind: 'rain', condition: 1240 });
    assert.equal(text.includes('server-only-key'), false);
  } finally {
    await relay.close();
    await new Promise(resolve => server.close(resolve));
  }
});
