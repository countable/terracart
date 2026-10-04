// Work-tool ownership: animated work uses only the tool and tier owned by the
// player. A missing tool clears stale art and lets the generic sweep render.
// Lift the shared lookup helper because the scene requires Phaser to load.

(function () {
const app = SCENE_SRC;

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
  const { calls, key } = runHelper({}, 'net');
  assert.truthy(!calls.some((c) => c.slot), 'no tool texture is asked for');
  assert.eq(key, null, "the last wheel's tool is cleared, not carried over");
});

test('work badge: an owned net still draws, at ITS tier', () => {
  const { calls, key } = runHelper({ net: { tier: 4 } }, 'net');
  const built = calls.find((c) => c.slot === 'net');
  assert.truthy(built, 'the net texture was asked for');
  assert.eq(built.tier, 4, 'at the tier actually owned, not Wood');
  assert.eq(key, 'tex:net:4', 'and the wheel will draw that texture');
});

test('work badge: every bare-handable job is covered by the one gate', () => {
  // The slots below all reach the wheel through a call site that passes the
  // slot unconditionally, and all of them have a tier-0 (bare hands) rung.
  for (const slot of ['net', 'hoe', 'pickaxe', 'axe', 'fishing_rod', 'sword']) {
    const { key } = runHelper({}, slot);
    assert.eq(key, null, `bare-handed "${slot}" wears no badge`);
  }
});

test('work badge: every owned wheel tool is drawn at its tier', () => {
  for (const slot of ['net', 'hoe', 'pickaxe', 'axe', 'fishing_rod', 'sword']) {
    for (let tier = 1; tier <= 7; tier++) {
      const { key } = runHelper({ [slot]: { tier } }, slot);
      assert.eq(key, `tex:${slot}:${tier}`, `${slot} tier ${tier} is drawn`);
    }
  }
});

test('work tool: animated in the canvas at the target wheel, not a DOM overlay', () => {
  const a = app.indexOf('  _drawWorkProgress() {');
  const b = app.indexOf('\n  }\n', a);
  const draw = app.slice(a, b);
  assert.truthy(/this\._drawWorkTool\(wp, cx, cy, now\)/.test(draw),
    'the animation receives the same target centre as the work wheel');
  assert.truthy(!/gameScreenRect\(\)/.test(draw),
    'no second, screen-space conversion that could drift off the ring');
  assert.truthy(!/document\.createElement/.test(helper), 'no DOM badge is built');
});

test('work badge: the call sites hand over the slot plainly', () => {
  // The ownership question is answered in the helper, so no call site
  // re-asks it — a second copy is exactly how the catch wheel came to
  // disagree with startCombat.
  assert.truthy(/this\._setWorkProgressIcon\(Gear\.activeWeapon\(this\.save\) \|\| 'sword'\);/.test(app),
    "startCombat passes the equipped melee weapon, with the bare-hands sword fallback");
  assert.truthy(!/_setWorkProgressIcon\([^)]*\?[^)]*:/.test(app),
    'no call site in app.js re-tests ownership with a ternary');
  assert.truthy(/const netSlot = 'net';/.test(INTERACT_SRC),
    "the hunt wheel names the net slot plainly");
  assert.truthy(!/const netSlot = r\.net \? 'net' : null;/.test(INTERACT_SRC),
    'the hunt wheel no longer carries its own copy of the ownership test');
});
})();
