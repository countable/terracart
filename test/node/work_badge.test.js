// Regression guard: BARE HANDS WEAR NO TOOL BADGE.
//
// The work wheel draws the equipped tool, at its tier, in the middle of the
// ring (app.js _setWorkProgressIcon picks it, _drawWorkProgress draws it in
// the canvas at the ring's centre), and its job is to say what you are
// swinging.
// Every job the wheel runs can be done with NOTHING in hand — that is the
// tier-0, 9 s rung of items.js toolDurationMs — so an unowned slot must draw
// no badge at all.
//
// Until Sep 2026 the tier fell back to `|| 1`, i.e. to WOOD, so a bare-handed
// wheel invented a Wood tool and hung it over the ring. On the CATCH that read
// as a bug rather than a mistake: the Bug Net's icon is a pale hoop on a short
// stick, so a bare-handed catch put a tiny white circle inside the wheel,
// belonging to no item the player owned. startCombat and the hunt wheel had
// each hand-written the ownership test; the catch, the till, the cave-wall dig,
// the shrub chop and the whole interactables table had not — so the test lives
// in the shared helper now, where a new wheel starter cannot forget it.
//
// app.js needs Phaser and can't load headlessly, so the helper is pinned as
// source text (APP_JS_SRC, lifted by run.js) and then RUN: the body is small
// and self-contained, so the test re-evaluates it against a stub scene and
// checks what it actually does with an empty relics table.

(function () {
const app = APP_JS_SRC;

const helper = (() => {
  const a = app.indexOf('  _setWorkProgressIcon(toolSlot) {');
  assert.truthy(a > 0, 'found _setWorkProgressIcon in app.js');
  const b = app.indexOf('\n  }\n', a);
  assert.truthy(b > a, 'found the end of _setWorkProgressIcon');
  return app.slice(a, b + 4);
})();

test('work badge: the wood fallback is gone', () => {
  assert.truthy(!/relics\?\.\[toolSlot\]\?\.tier \|\| 1/.test(helper),
    "the tier no longer falls back to `|| 1` (Wood) for a slot the player doesn't own");
  assert.truthy(/const tier = this\.save\.relics\?\.\[toolSlot\]\?\.tier;\s*\n\s*if \(!tier\) return;/.test(helper),
    'an unequipped slot returns before any texture is asked for');
});

// Run the real helper against a stub scene. `new Function` wraps the lifted
// method body the same way spawn_rebuild.test.js drives the spawn gate.
const runHelper = (relics, toolSlot) => {
  const body = helper.replace(/^\s*_setWorkProgressIcon\(toolSlot\) \{/, '').replace(/\}\s*$/, '');
  const calls = [];
  const scene = {
    save: { relics },
    _workProgressToolKey: 'stale-from-the-last-wheel',
    _workProgressIcon: { setVisible(v) { calls.push({ visible: v }); return this; } },
    _toolTexture(slot, tier) { calls.push({ slot, tier }); return `tex:${slot}:${tier}`; },
  };
  new Function('toolSlot', `(function(){${body}}).call(this)`).call(scene, toolSlot);
  return { calls, key: scene._workProgressToolKey };
};

test('work badge: a bare-handed catch draws nothing', () => {
  const { calls, key } = runHelper({}, 'bugnet');
  assert.truthy(!calls.some((c) => c.slot), 'no tool texture is asked for');
  assert.eq(key, null, "the last wheel's tool is cleared, not carried over");
});

test('work badge: an owned net still draws, at ITS tier', () => {
  const { calls, key } = runHelper({ bugnet: { tier: 4 } }, 'bugnet');
  const built = calls.find((c) => c.slot === 'bugnet');
  assert.truthy(built, 'the net texture was asked for');
  assert.eq(built.tier, 4, 'at the tier actually owned, not Wood');
  assert.eq(key, 'tex:bugnet:4', 'and the wheel will draw that texture');
});

test('work badge: every bare-handable job is covered by the one gate', () => {
  // The slots below all reach the wheel through a call site that passes the
  // slot unconditionally, and all of them have a tier-0 (bare hands) rung.
  for (const slot of ['bugnet', 'hoe', 'pick', 'axe', 'rod', 'sword']) {
    const { key } = runHelper({}, slot);
    assert.eq(key, null, `bare-handed "${slot}" wears no badge`);
  }
});

test('work badge: every owned wheel tool is drawn at its tier', () => {
  for (const slot of ['bugnet', 'hoe', 'pick', 'axe', 'rod', 'sword']) {
    for (let tier = 1; tier <= 7; tier++) {
      const { key } = runHelper({ [slot]: { tier } }, slot);
      assert.eq(key, `tex:${slot}:${tier}`, `${slot} tier ${tier} is drawn`);
    }
  }
});

test('work badge: drawn in the canvas at the ring centre, not a DOM overlay', () => {
  const a = app.indexOf('  _drawWorkProgress() {');
  const b = app.indexOf('\n  }\n', a);
  const draw = app.slice(a, b);
  assert.truthy(/icon\.setPosition\(cx, cy\)/.test(draw),
    'the tool is placed at the same (cx, cy) the ring is stroked around');
  assert.truthy(!/gameScreenRect\(\)/.test(draw),
    'no second, screen-space conversion that could drift off the ring');
  assert.truthy(!/document\.createElement/.test(helper), 'no DOM badge is built');
});

test('work badge: the call sites hand over the slot plainly', () => {
  // The ownership question is answered in the helper, so no call site
  // re-asks it — a second copy is exactly how the catch wheel came to
  // disagree with startCombat.
  assert.truthy(/this\._setWorkProgressIcon\('sword'\);/.test(app),
    "startCombat passes 'sword' plainly");
  assert.truthy(!/_setWorkProgressIcon\([^)]*\?[^)]*:/.test(app),
    'no call site in app.js re-tests ownership with a ternary');
  assert.truthy(/const netSlot = 'bugnet';/.test(INTERACT_SRC),
    "the hunt wheel names the net slot plainly");
  assert.truthy(!/const netSlot = r\.bugnet \? 'bugnet' : null;/.test(INTERACT_SRC),
    'the hunt wheel no longer carries its own copy of the ownership test');
});
})();
