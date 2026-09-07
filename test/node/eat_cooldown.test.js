// The bite cooldown: ten seconds between mouthfuls, potions exempt, and the
// wait shown ON the Eat button.
//
// Two halves, the same split the rest of the suite uses:
//   1. The rule itself (src/energy.js) runs for real — it is pure save math.
//   2. The button and the eatSelected gate are pinned as source text: they
//      live inside a Phaser scene method that can't load headlessly.
//
// The thing worth defending here is that ONE expression decides both what the
// button shows and what a tap does. A greyed button that still eats, or a
// bright button that refuses, is the bug this file exists to catch.

(function () {
const app = APP_JS_SRC;

test('eat cooldown: ten seconds, and a fresh save is ready to eat', () => {
  assert.eq(Energy.EAT_COOLDOWN_MS, 10 * 1000, 'ten seconds between bites');
  const save = {};
  assert.eq(Energy.eatCooldownLeft(save, 1000), 0, 'no deadline = nothing to wait for');
  assert.eq(Energy.canEat(save, 1000), true, 'a save that has never eaten can eat');
});

test('eat cooldown: a bite arms it, and it runs out on the tenth second', () => {
  const save = {};
  const t0 = 5_000_000;
  Energy.startEatCooldown(save, t0);
  assert.eq(save.eatReadyAt, t0 + Energy.EAT_COOLDOWN_MS, 'deadline is now + the cooldown');
  assert.eq(Energy.canEat(save, t0), false, 'refused the instant after a bite');
  assert.eq(Energy.eatCooldownLeft(save, t0), Energy.EAT_COOLDOWN_MS, 'the full wait stands');
  assert.eq(Energy.eatCooldownLeft(save, t0 + 4000), 6000, 'counts down in real time');
  assert.eq(Energy.canEat(save, t0 + Energy.EAT_COOLDOWN_MS - 1), false, 'still refused a ms short');
  assert.eq(Energy.canEat(save, t0 + Energy.EAT_COOLDOWN_MS), true, 'ready on the tenth second');
  assert.eq(Energy.eatCooldownLeft(save, t0 + 60_000), 0, 'long past, nothing left');
});

test('eat cooldown: the readout never claims ready while the gate refuses', () => {
  // shortDuration's contract (duration_notation.test.js) is that a pending
  // wait never reads "0s" — the button's label leans on it, so pin the pair.
  const save = {};
  Energy.startEatCooldown(save, 0);
  for (const now of [0, 1, 500, 5000, 9999]) {
    const left = Energy.eatCooldownLeft(save, now);
    assert.eq(Energy.canEat(save, now), false, `${now}ms in: still refused`);
    assert.truthy(shortDuration(left) !== '0s',
      `${now}ms in: label read "${shortDuration(left)}" while the gate refused`);
  }
  assert.eq(shortDuration(Energy.eatCooldownLeft(save, 9999)), '1s', 'the last sliver reads 1s');
});

test('eat cooldown: a wound-back clock cannot lock the button out for hours', () => {
  // A save carrying a far-future deadline (the device clock moved) would
  // otherwise grey the button — and print "3h" on it — until the clock caught up.
  const save = { eatReadyAt: 5_000_000 };
  assert.eq(Energy.eatCooldownLeft(save, 0), Energy.EAT_COOLDOWN_MS,
    'clamped to the cooldown itself, not the raw gap');
});

test('eat cooldown: eatSelected refuses on the gate, and arms it only on a landed bite', () => {
  const a = app.indexOf('eatSelected() {');
  const b = app.indexOf('\n  }\n', a);
  assert.truthy(a > 0 && b > a, 'found eatSelected in app.js');
  const body = app.slice(a, b);
  assert.truthy(/if \(!Energy\.canEat\(this\.save\)\) return false;/.test(body),
    'eatSelected refuses through the shared gate');
  assert.truthy(/Energy\.startEatCooldown\(this\.save\);/.test(body),
    'a landed bite arms the cooldown');
  // The arming must sit AFTER the refusal, or a blocked tap would extend its
  // own block — and after the consume, so it only ever follows a real bite.
  assert.lt(body.indexOf('if (!Energy.canEat(this.save)) return false;'),
            body.indexOf('Energy.startEatCooldown(this.save);'),
            'the gate is checked before the cooldown is armed');
  assert.lt(body.indexOf('consumeSelected(this.save);'),
            body.indexOf('Energy.startEatCooldown(this.save);'),
            'only a bite that actually consumed food arms the cooldown');
});

test('eat cooldown: the Eat button greys itself on the SAME expression the tap refuses on', () => {
  const a = app.indexOf('syncEatButton() {');
  const b = app.indexOf('\n  }\n', a);
  assert.truthy(a > 0 && b > a, 'found syncEatButton in app.js');
  const body = app.slice(a, b);
  assert.truthy(/const cdLeft = Energy\.eatCooldownLeft\(this\.save\);/.test(body),
    'the button reads the cooldown from the energy core, not a copy of the number');
  assert.truthy(/const cooling = cdLeft > 0;/.test(body), 'one flag drives the whole cooling face');
  // Both halves of the readout: the exact wait, and the bar.
  assert.truthy(/shortDuration\(cdLeft\)/.test(body),
    'the wait is formatted through shortDuration, like every other wait in the game');
  assert.truthy(/this\._paintEatCooldownBar\(btn, cdLeft\)/.test(body),
    'the bar is sized from the same ms');
  // The countdown is TEXT on its own span — the icon beside it is rebuilt only
  // when the selected stack changes, so a second-by-second repaint doesn't
  // re-write a background-image glyph that hasn't moved.
  assert.truthy(/btn\.querySelector\('\.eat-txt'\)\.textContent = text;/.test(body),
    'only the text span is rewritten per tick');
  assert.truthy(/if \(btn\.dataset\.id !== sel\.id\) \{/.test(body),
    'the icon is rebuilt only on a change of selection');
  assert.truthy(/cooling \? EAT_COOLING_INK/.test(body) && /cooling \? EAT_COOLING_EDGE/.test(body),
    'ink and edge go dim while cooling');
});

test('eat cooldown: the bar fills toward ready, and vanishes when there is nothing to count', () => {
  const a = app.indexOf('_paintEatCooldownBar(btn, leftMs) {');
  const b = app.indexOf('\n  }\n', a);
  assert.truthy(a > 0 && b > a, 'found _paintEatCooldownBar in app.js');
  const body = app.slice(a, b);
  // 1 - left/COOLDOWN: a full bar is a ready button, so the growing green and
  // the shrinking number both point at the next bite.
  assert.truthy(/const done = 1 - Math\.max\(0, Math\.min\(1, leftMs \/ Energy\.EAT_COOLDOWN_MS\)\)/.test(body),
    'the bar measures elapsed, clamped, off the shared constant');
  assert.truthy(/leftMs > 0 \? `\$\{done \* 100\}%` : '0'/.test(body),
    'no bar at all once the wait is over');
});

test('eat cooldown: the button is driven every frame, and rebuilt only on the second', () => {
  const a = app.indexOf('_tickEatButton() {');
  const b = app.indexOf('\n  }\n', a);
  assert.truthy(a > 0 && b > a, 'found _tickEatButton in app.js');
  const body = app.slice(a, b);
  assert.truthy(/if \(!btn\) \{ this\._eatCdShown = null; return; \}/.test(body),
    'no button selected = nothing to tick');
  assert.truthy(/this\._paintEatCooldownBar\(btn, left\)/.test(body), 'the bar moves every frame');
  assert.truthy(/if \(shown !== this\._eatCdShown\) this\.syncEatButton\(\);/.test(body),
    'the label (and the un-greying) only rebuilds when the reading changes');
  assert.truthy(/this\._tickEatButton\(\);/.test(app.slice(app.indexOf('_updateTimed(_, dtMs) {'))),
    'update() drives it');
});

test('eat cooldown: a disabled attribute is NOT how the button refuses', () => {
  // A `disabled` button swallows the tap before the click handler runs, so the
  // handler's stopPropagation never fires and the press falls through to the
  // world behind it — tilling the ground under the Eat button. The refusal
  // lives in eatSelected instead.
  const a = app.indexOf('_makeEatButton() {');
  const b = app.indexOf('\n  }\n', a);
  assert.truthy(a > 0 && b > a, 'found _makeEatButton in app.js');
  const body = app.slice(a, b);
  assert.truthy(!/\.disabled\s*=/.test(body), 'the button is never disabled outright');
  assert.truthy(/e\.stopPropagation\(\);/.test(body), 'every press is still swallowed by the button');
});

test('eat cooldown: potions are exempt because they never go through the gate', () => {
  // The exemption is structural, not an id list: a potion is drunk through its
  // own method off syncConsumableButton, which never calls eatSelected. Two
  // things have to hold for that to keep being true.
  for (const id of ['reach_potion', 'vigor_potion', 'speed_potion', 'shield_potion']) {
    assert.eq(FOOD_ENERGY[id], undefined,
      `${id} carries no FOOD_ENERGY — it can never reach the Eat button`);
  }
  const a = app.indexOf('drinkVigorPotion() {');
  const b = app.indexOf('\n  }\n', a);
  assert.truthy(a > 0 && b > a, 'found drinkVigorPotion in app.js');
  const body = app.slice(a, b);
  assert.truthy(!/Energy\.canEat|Energy\.startEatCooldown/.test(body),
    'the energy potion neither checks nor arms the bite cooldown');
  assert.truthy(/this\.save\.energy = Math\.min\(max, \(this\.save\.energy \?\? 0\) \+ 40\)/.test(body),
    'and it still restores on the spot');
});
})();
