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


test('modal delay: all dialog kinds are immediately usable', () => {
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
  const shell = new Function('document', 'MODAL_KINDS', 'setTimeout', 'UI_CONTROL_DIM',
    'return ({' + SCENE_SRC.slice(start, end) + 'return wrap; }});')
    (document, kinds, (...args) => timers.push(args), '#000');
  for (const replacing of [false, true]) {
    swapping = replacing;
    for (const kind of Object.keys(kinds)) {
      const wrap = shell.makeModalShell('test', { kind });
      assert.falsy(wrap.classes.has('modal-arming'), kind + ' is immediately usable');
      assert.eq(wrap.listeners.length, 0, kind + ' does not swallow clicks');
    }
  }
  assert.eq(timers.length, 0, 'no delayed button reveal');
});
