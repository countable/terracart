// Regression guard: BARE HANDS WEAR NO TOOL BADGE.
//
// The work wheel hangs a 16 px relic icon in the middle of the ring
// (app.js _setWorkProgressIcon), and its job is to say what you are swinging.
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
    'an unequipped slot returns before any DOM node is built');
});

// Run the real helper against a stub scene. `new Function` wraps the lifted
// method body the same way spawn_rebuild.test.js drives the spawn gate.
const runHelper = (relics, toolSlot) => {
  const body = helper.replace(/^\s*_setWorkProgressIcon\(toolSlot\) \{/, '').replace(/\}\s*$/, '');
  const calls = [];
  const scene = {
    save: { relics },
    _workProgressIcon: null,
    gearIconHTML(kind, slot, tier, px) { calls.push({ kind, slot, tier, px }); return '<span></span>'; },
  };
  // The helper appends to document.body when it builds a badge; record that
  // instead of needing a DOM.
  const document = {
    createElement: () => ({ style: { cssText: '' }, innerHTML: '', remove() {} }),
    body: { appendChild: (el) => { calls.push({ appended: true }); return el; } },
  };
  new Function('document', 'toolSlot', `(function(){${body}}).call(this)`)
    .call(scene, document, toolSlot);
  return { calls, icon: scene._workProgressIcon };
};

test('work badge: a bare-handed catch draws nothing', () => {
  const { calls, icon } = runHelper({}, 'bugnet');
  assert.eq(calls.length, 0, 'no icon HTML is built and nothing is appended');
  assert.eq(icon, null, 'no badge element is stashed');
});

test('work badge: an owned net still draws, at ITS tier', () => {
  const { calls, icon } = runHelper({ bugnet: { tier: 4 } }, 'bugnet');
  assert.truthy(icon, 'a badge element is stashed');
  const built = calls.find((c) => c.slot === 'bugnet');
  assert.truthy(built, 'gearIconHTML was asked for the net');
  assert.eq(built.tier, 4, 'at the tier actually owned, not Wood');
  assert.eq(built.px, 16, 'at the wheel badge size');
});

test('work badge: every bare-handable job is covered by the one gate', () => {
  // The slots below all reach the wheel through a call site that passes the
  // slot unconditionally, and all of them have a tier-0 (bare hands) rung.
  for (const slot of ['bugnet', 'hoe', 'pick', 'axe', 'rod', 'sword']) {
    const { icon } = runHelper({}, slot);
    assert.eq(icon, null, `bare-handed "${slot}" wears no badge`);
  }
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
