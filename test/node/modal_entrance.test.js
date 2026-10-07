// Dialogs enter with a short fade + pop (index.html .modal-anim, added by
// modal_shell.js makeModalShell's mount) — but only when nothing was on screen, so a
// dialog that replaces another in the same tap (a pager turn, a re-roll, a
// tab) swaps in place rather than popping every page.

test('modal entrance: every shell dialog gets it, unless it replaces one', () => {
  const start = SCENE_SRC.indexOf('    const mount = () => {');
  const body = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n    };', start));
  assert.truthy(/box\.classList\.add\('modal-box'\)/.test(body), 'the box is marked');
  assert.truthy(/if \(!document\.body\.classList\.contains\('modal-open'\)\) wrap\.classList\.add\('modal-anim'\)/.test(body),
    'animated only when no dialog was up');
});

test('modal entrance: short, and off for reduced motion', () => {
  const css = INDEX_HTML_SRC;
  const fade = css.match(/\.modal-anim \{ animation: modal-fade (\d+)ms/);
  const pop = css.match(/\.modal-anim > \.modal-box \{ animation: modal-pop (\d+)ms/);
  assert.truthy(fade && pop, 'both animations declared');
  assert.lte(Number(fade[1]), 250, 'the fade is quick');
  assert.lte(Number(pop[1]), 250, 'the pop is quick');
  assert.truthy(/prefers-reduced-motion: reduce\)\s*\{\s*\.modal-anim, \.modal-anim > \.modal-box \{ animation: none; \}/.test(css),
    'reduced motion turns it off');
});


test('modal delay: stories and events wait; booths and building choices are immediate', () => {
  const kindsStart = SCENE_SRC.indexOf('const MODAL_KINDS = {');
  const kindsEnd = SCENE_SRC.indexOf('\n};', kindsStart);
  const kinds = (0, eval)('(' + SCENE_SRC.slice(kindsStart + 'const MODAL_KINDS = '.length, kindsEnd + 2) + ')');
  const start = SCENE_SRC.indexOf('  makeModalShell(id, {');
  const end = SCENE_SRC.indexOf('    // The backdrop covers', start);
  const timers = [];
  let swapping = false;
  const document = {
    getElementById: () => swapping ? { remove() {} } : null,
    createElement: () => ({ id: '', dataset: {}, classes: new Set(), listeners: [],
      get classList() { return { add: name => this.classes.add(name) }; },
      addEventListener(...args) { this.listeners.push(args); },
    }),
  };
  const shell = new Function('document', 'MODAL_KINDS', 'setTimeout', 'UI_CONTROL_DIM', 'MODAL_ARM_MS', 'MODAL_UNVEIL_MS',
    'return ({' + SCENE_SRC.slice(start, end) + 'return wrap; }});')
    (document, kinds, (...args) => timers.push(args), '#000', 1000, 500);
  for (const kind of ['shop', 'trade', 'forge', 'relics', 'delivery', 'quest', 'build', 'craft', 'wizard', 'slots', 'menu']) {
    const wrap = shell.makeModalShell('test', { kind, art: 'building_painting' });
    assert.falsy(wrap.classes.has('modal-arming'), kind + ' is immediately usable');
    assert.eq(wrap.listeners.length, 0, kind + ' does not swallow clicks');
  }
  assert.eq(timers.length, 0);
  for (const kind of ['story', 'treasure', 'supplies', 'trail', 'rest']) {
    const wrap = shell.makeModalShell('test', { kind });
    assert.truthy(wrap.classes.has('modal-arming'), kind + ' protects its opening');
    assert.eq(wrap.listeners[0][0], 'click');
    assert.eq(wrap.listeners[0][2], true, 'blocks clicks in capture phase');
  }
  assert.truthy(shell.makeModalShell('test', { kind: 'farm', delayInput: true }).classes.has('modal-arming'),
    'events such as hatching retain the delay regardless of category');
  swapping = true;
  assert.falsy(shell.makeModalShell('test', { kind: 'story' }).classes.has('modal-arming'), 'page turns do not wait again');
});
