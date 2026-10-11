'use strict';
// Standalone runner boundaries/replay drift contracts: node test/qa-runner.test.js
const assert = require('node:assert/strict');
const { boundedAdvance, requestAllowed } = require('../tools/qa/run');
const { resolveControl, compareObservation } = require('../tools/qa/replay');
const port = process.env.QA_PORT || 7732;
assert.equal(boundedAdvance(300000, 7199980, 7200000), 20, 'final wait cannot exceed two-hour cap');
assert.equal(boundedAdvance(100, 7200000, 7200000), 0);
assert.equal(boundedAdvance(100, 7200001, 7200000), 0);
assert.equal(boundedAdvance(250, 0, 7200000), 250);
for (const invalid of [-1, Infinity, NaN]) assert.throws(() => boundedAdvance(invalid, 0, 7200000));
assert.ok(requestAllowed({ headers: { host: `127.0.0.1:${port}` } }), 'local CLI commands need no Origin');
assert.ok(requestAllowed({ headers: { host: `localhost:${port}`, origin: `http://localhost:${port}` } }));
assert.equal(requestAllowed({ headers: { host: `127.0.0.1:${port}`, origin: 'https://example.com' } }), false);
assert.equal(requestAllowed({ headers: { host: `evil.example:${port}` } }), false);
assert.equal(requestAllowed({ headers: { host: `127.0.0.1:${port}`, 'sec-fetch-site': 'cross-site' } }), false);
const expected = { ready: true, menus: [{ kind: 'inventory', text: 'Choose item' }],
  position: { cellIX: 1, cellIY: 2 }, depth: 0,
  hud: { money: 3, energy: 40, objective: 'Harvest' },
  inventory: [{ slot: 0, id: 'potato', count: 2, selected: true }],
  controls: [{ id: 'control:4', label: 'Equip', slot: 1, gear: 'hoe' }] };
const actual = structuredClone(expected);
actual.controls = [{ id: 'control:19', label: 'Equip', slot: 1, gear: 'hoe' },
  { id: 'control:20', label: 'Equip', slot: 1, gear: 'axe' }];
assert.equal(resolveControl(expected, actual, 'control:4'), 'control:19');
assert.throws(() => resolveControl(expected, actual, 'control:missing'), /missing from the transcript/);
assert.throws(() => resolveControl(expected, { controls: [] }, 'control:4'), /missing\/ambiguous/);
assert.throws(() => resolveControl(expected, { controls: [actual.controls[0], actual.controls[0]] }, 'control:4'), /ambiguous/);
compareObservation(expected, actual, 'matching');
for (const [mutate, error] of [
  [o => o.position.cellIX++, /player cell/], [o => o.depth++, /depth/],
  [o => o.hud.money++, /money\/energy/], [o => o.hud.energy -= 2, /money\/energy/],
  [o => o.hud.objective = 'Sell', /objective/], [o => o.inventory[0].count--, /inventory/],
  [o => o.menus[0].text = 'Other', /menu/], [o => o.ready = false, /readiness/],
]) {
  const changed = structuredClone(actual); mutate(changed);
  assert.throws(() => compareObservation(expected, changed, 'drift'), error);
}
console.log('QA runner/replay contracts passed');
