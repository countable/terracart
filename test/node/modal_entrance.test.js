// Dialogs enter with a short fade + pop (index.html .modal-anim, added by
// app.js makeModalShell's mount) — but only when nothing was on screen, so a
// dialog that replaces another in the same tap (a pager turn, a re-roll, a
// tab) swaps in place rather than popping every page.

test('modal entrance: every shell dialog gets it, unless it replaces one', () => {
  const start = APP_JS_SRC.indexOf('    const mount = () => {');
  const body = APP_JS_SRC.slice(start, APP_JS_SRC.indexOf('\n    };', start));
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
