// SAFETY (owner, Sep 2026): the PASSENGER GATE, the safety card and the
// heads-up buzz.
//   · util.js GPS SPEED is ONE lane two readers share: the egg's hatch walk
//     (egg_hatch.js) and the passenger gate (speedGateStep).
//   · a ride's pace, sustained, trips the gate: no street restores (so no
//     trail metres), no taps (so no pickups), and nothing hostile notices the
//     player — the gate is a third reason ORed into isUnnoticed.
//   · a full-screen, bold, tap-to-continue safety card at launch, a short one
//     on resume and at dusk; each says to use the stick, never the street.
(function () {

// A straight northward track at `mps`, one fix a second from t0.
const LAT0 = 49.88, LON0 = -119.49;
const M_PER_DEG = 6371000 * Math.PI / 180;
function track(mps, seconds, t0 = 1e12, opts = {}) {
  const out = [];
  for (let i = 0; i <= seconds; i++) {
    out.push({ lat: LAT0 + (mps * i) / M_PER_DEG, lon: LON0, accuracy: opts.accuracy ?? 8,
      timestamp: t0 + i * 1000, speed: opts.speed });
  }
  return out;
}
function feed(fixes, state = null) {
  let s = state;
  const trace = [];
  for (const f of fixes) { s = speedGateStep(s, f, f.timestamp); trace.push(s.tooFast); }
  return { s, trace };
}

test('passenger gate: a walk and a run never trip it', () => {
  assert.falsy(feed(track(1.4, 120)).s.tooFast, 'a walk');
  assert.falsy(feed(track(4.0, 120)).s.tooFast, 'a brisk run');
  assert.eq(GPS_MAX_WALK_MPS, 4.5, 'the ceiling: about 16 km/h');
});

test('passenger gate: a ride trips it only when SUSTAINED', () => {
  const brief = feed(track(10, Math.floor(SPEED_GATE_TRIP_MS / 1000) - 2));
  assert.falsy(brief.s.tooFast, 'a few fast seconds (a GPS jump, a sprint) do not');
  const ride = feed(track(10, 30));
  assert.truthy(ride.s.tooFast, 'a ride does');
  const first = ride.trace.indexOf(true);
  assert.inRange(first, SPEED_GATE_TRIP_MS / 1000, SPEED_GATE_TRIP_MS / 1000 + 2, `tripped after the trip window (${first}s)`);
});

test('passenger gate: the device\'s own speed is read when it reports one', () => {
  // Standing still by position, but the phone says 12 m/s: a ride.
  assert.truthy(feed(track(0, 20, 1e12, { speed: 12 })).s.tooFast, 'coords.speed trips it');
  // Moving fast by position, but the phone says 1.2 m/s: trust the phone.
  assert.falsy(feed(track(10, 20, 1e12, { speed: 1.2 })).s.tooFast, 'and clears it');
});

test('passenger gate: on foot again only after SPEED_GATE_CLEAR_MS of walking', () => {
  const ride = feed(track(10, 20));
  assert.truthy(ride.s.tooFast);
  const t0 = ride.s.last.timestamp + 1000;
  const lat0 = ride.s.last.lat;
  const walk = [];
  for (let i = 0; i <= 40; i++) walk.push({ lat: lat0 + (1.4 * (i + 1)) / M_PER_DEG, lon: LON0, accuracy: 8, timestamp: t0 + i * 1000 });
  const after = feed(walk, ride.s);
  const cleared = after.trace.indexOf(false);
  assert.gte(cleared, SPEED_GATE_CLEAR_MS / 1000 - 1, `not before the clear window (${cleared}s)`);
  assert.falsy(after.s.tooFast, 'and then it clears');
});

test('passenger gate: an unreliable fix neither trips nor clears it', () => {
  const blurry = feed(track(10, 30, 1e12, { accuracy: GPS_MAX_ACCURACY_M + 20 }));
  assert.falsy(blurry.s.tooFast, 'a blurry track proves nothing');
  const ride = feed(track(10, 20));
  const junk = { lat: NaN, lon: 0, accuracy: 5, timestamp: ride.s.last.timestamp + 1000 };
  assert.truthy(speedGateStep(ride.s, junk, junk.timestamp).tooFast, 'a junk fix does not clear it');
  const late = ride.s.last.timestamp + SPEED_GATE_STALE_MS + 5000;
  assert.falsy(speedGateStep(ride.s, null, late).tooFast, 'but a phone silent past SPEED_GATE_STALE_MS does');
});

test('GPS speed: one lane — the egg reads the same reliable-leg rule and ceiling', () => {
  const src = ALL_SRC['egg_hatch.js'];
  assert.truthy(/const MAX_SPEED = GPS_MAX_WALK_MPS;/.test(src), 'the same ceiling');
  assert.truthy(/gpsFixReliable\(fix, now\)/.test(src) && /gpsLegMps\(tracker\.last, fix\)/.test(src), 'the same fix and leg rules');
  assert.falsy(/function distance\(|MAX_ACCURACY = |MAX_GAP_MS = /.test(src), 'no private copy left');
  assert.inRange(gpsDistanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 111100, 111300, 'a degree of latitude');
});

test('passenger gate: the scene wiring — every fix steps it, and three things read it', () => {
  const geo = SCENE_GEO_SRC;
  assert.truthy(/this\._trackEggHatch\(pos\);\s*this\._trackSpeedGate\(pos\);/.test(geo), 'every physical fix');
  assert.truthy(/speed: pos\.coords\.speed,/.test(geo), 'with the device\'s own speed');
  assert.truthy(/if \(!was && this\._speedGate\.tooFast\) this\._showPassengerCard\?\.\(\);/.test(geo), 'the card, once per ride');
  const app = APP_JS_SRC;
  assert.truthy(/return this\.isShadowActive\(\) \|\| Combat\.playerDowned\(this\.save\.energy\) \|\| this\.isTooFast\(\);/.test(app),
    'nothing hunts a passenger — ORed into isUnnoticed');
  assert.truthy(/if \(!surface \|\| this\._driftingHome \|\| this\.isTooFast\?\.\(\)\) \{ this\._resetStreetSight\(\); return; \}/.test(app),
    'no street restores, so no trail metres');
  assert.truthy(/handleWorldTap\(sx, sy\) \{\s*if \(this\.isTooFast\?\.\(\)\) \{ this\.flash\('Too fast — on foot only\.', sx, sy\); return; \}/.test(app),
    'no taps, so no pickups');
  assert.lte([...'Too fast — on foot only.'].length, MAP_MSG_MAX, 'the refusal fits a map line');
  assert.truthy(/title: 'Too fast — are you a passenger\?'/.test(app), 'the card asks');
});

test('safety card: full-screen, bold, tap to continue — launch, resume and dusk', () => {
  const app = APP_JS_SRC;
  const body = app.slice(app.indexOf('  _showSafetyCard(which) {'));
  const card = body.slice(0, body.indexOf('\n  }\n'));
  assert.truthy(/position:absolute;left:0;right:0;top:var\(--view-top,0px\);height:var\(--view-h,100%\)/.test(card),
    'it covers the visible slice of the game box, so it centres on the screen');
  assert.truthy(/font-weight:900/.test(card) && /font-weight:700/.test(card), 'bold');
  assert.truthy(/Tap to continue/.test(card) && /addEventListener\('pointerup', done\)/.test(card), 'dismissed by a tap');
  assert.truthy(/this\._bootOverlayGone = true;[^\n]*\n[^\n]*\n\s*this\._showSafetyCard\('launch'\);/.test(app), 'at every launch');
  assert.truthy(/this\._safetyOnResume\?\.\(Date\.now\(\) - this\._hiddenAt\)/.test(SCENE_GEO_SRC), 'on resume');
  assert.truthy(/this\._showSafetyCard\('dusk'\)/.test(app), 'and at dusk');
  assert.truthy(/this\._tickGuildBounty\(\);\s*this\._tickSafetyReminders\(\);/.test(app), 'the dusk check ticks');
  // Every version says it: the stick, never the street.
  const cards = /const SAFETY_CARDS = (\{[\s\S]*?\n\});/.exec(app)?.[1];
  assert.truthy(cards, 'the card copy is one table');
  const table = new Function(`return ${cards};`)();
  for (const [k, c] of Object.entries(table)) {
    assert.truthy(c.lines.some((l) => /stick/i.test(l) && /(never|not).*street|street.*(never|not)/i.test(l)), `${k}: use the stick, never the street`);
  }
  assert.truthy(table.launch.lines.some((l) => /driving|cycling/i.test(l)), 'launch: not while driving');
  // Only the game's own risks (owner, Sep 2026): no general heat advice.
  assert.falsy(table.launch.lines.some((l) => /water|hot day/i.test(l)), 'launch: no heat and water line');
});

test('heads-up buzz: a hostile taking an interest close by vibrates the phone, throttled', () => {
  const app = APP_JS_SRC;
  assert.truthy(/this\._foeHeadsUp\?\.\(interestedFoeM, now\);/.test(SCENE_CREATURES_SRC), 'the sim hands over the nearest interested foe');
  assert.truthy(/if \(!isTame && !standDown && !unnoticed && \(Combat\.isEnemy\(c\) \|\| enraged\)\)/.test(SCENE_CREATURES_SRC),
    'only one that is taking an interest');
  const m = app.slice(app.indexOf('  _foeHeadsUp(distM, now) {'));
  const f = new Function('SAFETY_FOE_BUZZ_CELLS', 'SAFETY_FOE_BUZZ_GAP_MS', 'SAFETY_FOE_BUZZ',
    `return function (distM, now) {${m.slice(m.indexOf('{') + 1, m.indexOf('\n  }\n'))}\n};`)(5, 20000, [1]);
  const buzz = [];
  const scene = { cellM: 7, haptic: (p) => buzz.push(p) };
  f.call(scene, 50, 0);
  assert.eq(buzz.length, 0, 'far off: nothing');
  f.call(scene, 20, 1000);
  assert.eq(buzz.length, 1, 'close: a buzz');
  f.call(scene, 20, 5000);
  assert.eq(buzz.length, 1, 'not again inside the gap');
  f.call(scene, 20, 30000);
  assert.eq(buzz.length, 2, 'again after it');
});

test('tips: real-world safety stays direct', () => {
  const tip = re => PLAY_TIPS.find(t => re.test(t));
  assert.truthy(tip(/game pauses.*travel/i), 'travelling pauses play');
  assert.truthy(tip(/safely on foot/i), 'only play safely on foot');
  assert.truthy(tip(/pavement.*busy road/i), 'stay beside the road');
  assert.truthy(tip(/Never enter the road/i), 'never enter traffic to collect');
  assert.truthy(tip(/carry water/i), 'water in heat');
  assert.falsy(PLAY_TIPS.some(t => /bike rack|lends you a bike/i.test(t)), 'the courier offers magic, not a bike');
});

})();
