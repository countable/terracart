// A crow retreats IN FULL when the player starts hunting it — the same
// departure a crow makes after eating (scene_creatures.js _crowDepart, creature_ai.js CROW_DEPART_MS):
// straight away from the player for the usual ~2.5–4 minutes. TWO REASONS,
// one departure: a SATED crow is out of its perch on the spot; a HUNTED one
// keeps its rhythm — the perch it is sitting, or the glide it is on — and
// leaves on its next launch, so the net's wheel races the perch the crow had
// left when it was tapped (creature_ai.js CROW_DEPART_HOP: the hunt is timed,
// not rolled; crow_hunt_odds.test.js pins the odds).

(function () {
const app = SCENE_SRC;   // _crowDepart and its caller are the SceneCreatures mixin's
const SIG = '\n  _crowDepart(c, now = performance.now(), reason = \'sated\') {';
const a = app.indexOf(SIG);
assert.truthy(a > 0, 'found _crowDepart');
const body = app.slice(app.indexOf('{', a) + 1, app.indexOf('\n  }\n', a));
const depart = eval(CREATURE_AI_SRC.match(/const CROW_DEPART_MS = (\[[^\]]*\]);/)[1]);
const run = (c, now, reason) => new Function('c', 'now', 'reason', 'CROW_DEPART_MS', body)(c, now, reason, depart);

test('crow retreat: the departure is the usual 2.5–4 minutes', () => {
  assert.eq(depart[0], 150000, 'base 2.5 min');
  assert.eq(depart[0] + depart[1], 240000, 'up to 4 min');
  for (const reason of ['sated', 'hunted', undefined]) {
    const c = {};
    run(c, 1000, reason);
    assert.truthy(c._departUntilT >= 1000 + depart[0] && c._departUntilT <= 1000 + depart[0] + depart[1],
      `${reason}: departing for the usual stretch`);
  }
});

test('crow retreat: a SATED crow launches at once', () => {
  const c = { _perchUntilT: 99999, _flightUntilT: 12345 };
  run(c, 1000, 'sated');
  assert.eq(c._perchUntilT, 1000, 'out of its perch this tick');
  assert.eq(c._flightUntilT, null, 'any flight in progress cut short so it launches outbound');
  const d = { _perchUntilT: 99999, _flightUntilT: 12345 };
  run(d, 1000);
  assert.eq(d._perchUntilT, 1000, 'the default reason is the meal');
});

test('crow retreat: a HUNTED crow keeps its perch — or its glide — and leaves on its next launch', () => {
  const perched = { _perchUntilT: 4200, _flightUntilT: null };
  run(perched, 1000, 'hunted');
  assert.eq(perched._perchUntilT, 4200, 'the perch it was sitting is the timing window');
  assert.eq(perched._flightUntilT, null, 'no glide conjured');
  const flying = { _perchUntilT: null, _flightUntilT: 1900, _flightT0: 1000 };
  run(flying, 1500, 'hunted');
  assert.eq(flying._flightUntilT, 1900, 'a glide in progress flies out');
  assert.eq(flying._perchUntilT, null, 'and lands into its usual perch');
});

test('crow retreat: one departure, two reasons — a meal and a hunt', () => {
  assert.falsy(/c\._departUntilT = now \+ 150000/.test(app), 'no second copy of the departure');
  assert.truthy(/this\._crowDepart\(c, now\);/.test(app), 'a sated crow departs through it, at once');
  assert.truthy(/if \(victim\.kind === 'crow'\) scene\._crowDepart\?\.\(victim, performance\.now\(\), 'hunted'\);/.test(INTERACT_SRC),
    'and a hunted crow through the same call, on its own rhythm');
  // The retreat hop is the table's, past the approach cap, on its own glide.
  assert.truthy(/const d = CROW_DEPART_HOP\.cells \* this\.cellM;/.test(WILD_CROW_TICK_SRC), 'the hop is the row\'s cells');
  assert.truthy(/if \(!departing && legD > MAX_LEG\) \{/.test(WILD_CROW_TICK_SRC), 'a retreat is not an approach: no cap');
  assert.truthy(/\(departing \? CROW_DEPART_HOP\.ms : 800 \+ Math\.random\(\) \* 400\)/.test(WILD_CROW_TICK_SRC), 'and glides for the row\'s ms');
});
})();
