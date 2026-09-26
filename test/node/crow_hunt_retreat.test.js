// A crow retreats IN FULL when the player starts hunting it — the same
// departure a crow makes after eating (app.js _crowDepart, creature_ai.js CROW_DEPART_MS):
// out of its perch on the spot, then straight away from the player for the
// usual ~2.5–4 minutes. It used to ignore the hunt wheel and keep orbiting.

(function () {
const app = APP_JS_SRC;
const a = app.indexOf('\n  _crowDepart(c, now = performance.now()) {');
assert.truthy(a > 0, 'found _crowDepart');
const body = app.slice(app.indexOf('{', a) + 1, app.indexOf('\n  }\n', a));
const depart = eval(CREATURE_AI_SRC.match(/const CROW_DEPART_MS = (\[[^\]]*\]);/)[1]);

test('crow retreat: the departure is the usual 2.5–4 minutes, launched at once', () => {
  assert.eq(depart[0], 150000, 'base 2.5 min');
  assert.eq(depart[0] + depart[1], 240000, 'up to 4 min');
  const c = { _perchUntilT: 99999, _flightUntilT: 12345 };
  new Function('c', 'now', 'CROW_DEPART_MS', body)(c, 1000, depart);
  assert.truthy(c._departUntilT >= 1000 + depart[0] && c._departUntilT <= 1000 + depart[0] + depart[1],
    'departing for the usual stretch');
  assert.eq(c._perchUntilT, 1000, 'out of its perch this tick');
  assert.eq(c._flightUntilT, null, 'any flight in progress cut short so it launches outbound');
});

test('crow retreat: one departure, two reasons — a meal and a hunt', () => {
  assert.falsy(/c\._departUntilT = now \+ 150000/.test(app), 'no second copy of the departure');
  assert.truthy(/this\._crowDepart\(c, now\);/.test(app), 'a sated crow departs through it');
  assert.truthy(/if \(victim\.kind === 'crow'\) scene\._crowDepart\?\.\(victim\);/.test(INTERACT_SRC),
    'and so does a crow the moment the hunt wheel starts on it');
});
})();
