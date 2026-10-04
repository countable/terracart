// modal_shell.js: ONE button factory for every button a modal shows.
//
// Regression guard for the footprint refactor: the pager arrows, choice
// cards, stepper keys, tabs and the reward card's actions used to be
// hand-built <button>s with two different ghost styles (#eee/#666 on
// Cancel, #ddd/#555 everywhere else), a local `dim()` and a second
// `_setEnabled` on Take. Every button now comes from mkBtn, in one of two
// variants, and carries the one _setEnabled.

test('modal buttons: mkBtn is the only button factory, with one ghost and one disabled look', () => {
  const src = MODAL_SHELL_SRC;
  assert.eq((src.match(/document\.createElement\('button'\)/g) || []).length, 1,
    'one <button> is created, inside mkBtn');
  assert.truthy(/const GHOST = 'background:transparent;color:#ddd;border:2px solid #555;';/.test(src),
    'the ghost style is one constant');
  assert.falsy(/#eee;border:2px solid #666/.test(src), 'the second ghost (#eee/#666) is gone');
  assert.falsy(/const dim = \(b, off\) =>/.test(src), 'the stepper\'s local dim() is gone');
  assert.eq((src.match(/\._setEnabled = \(on\) =>/g) || []).length, 1,
    'one _setEnabled, defined by mkBtn — Take no longer carries its own');
  // Every former hand-built button asks the factory for its variant.
  for (const site of [
    /const tb = mkBtn\(t\.label, \{ variant: 'ghost', css:/,
    /const b = mkBtn\(glyph, \{ variant: 'ghost', css:/,
    /const mkStep = \(label\) => mkBtn\(label, \{ variant: 'ghost', css:/,
    /const b = mkBtn\(a\.label, a\.primary \? \{ accent, css: cardCss \} : \{ variant: 'ghost', css: cardCss \}\);/,
    /take = mkBtn\(confirmLabel, \{ accent, css:/,
  ]) assert.truthy(site.test(src), `${site} builds through mkBtn`);
  assert.truthy(/minusBtn\._setEnabled\(qty > minQ\);\s*\n\s*plusBtn\._setEnabled\(qty < maxQ\);/.test(src),
    'the stepper keys toggle through _setEnabled');
});

test('modal buttons: the delivery menu\'s house rows come from mkBtn too', () => {
  // scene_shops.js openDeliveryMenu used to build its two-line rows as its
  // own <button>; they are ghost buttons laid out by a row css now.
  const start = SCENE_SRC.indexOf('  openDeliveryMenu() {');
  const menu = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start));
  assert.truthy(start > 0 && menu.length > 0, 'openDeliveryMenu is a scene method');
  assert.falsy(/document\.createElement\('button'\)/.test(menu), 'no hand-built button in the menu');
  assert.truthy(/const row = mkBtn\(\n[\s\S]*?\{ variant: 'ghost', css: rowCss \}\);/.test(menu), 'each row asks the factory for a ghost with the row css');
  assert.truthy(/const close = mkBtn\('Close'\);/.test(menu), 'and the Close button');
});

test('modal buttons: the legacy (label, primary, disabled) spelling still reads', () => {
  // The offer modal's own Cancel / secondary / Buy calls, and the stubs the
  // other tests hand in, use the positional form.
  const src = MODAL_SHELL_SRC;
  assert.truthy(/const cancel = mkBtn\(cancelLabel, false, false\);/.test(src));
  assert.truthy(/const o = \(opts && typeof opts === 'object'\) \? opts : \{ variant: opts \? 'primary' : 'ghost', disabled \};/.test(src),
    'a boolean second argument is read as the variant');
});
