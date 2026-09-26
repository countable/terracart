// EVERY SCRIPT index.html LOADS PARSES AS A WHOLE FILE.
//
// Most of this suite lifts single methods out of src/app.js by regex, so a
// stray `}` BETWEEN two methods — which closes the class early and turns the
// next method into a syntax error — passed every test while the shipped page
// died on load ("Unexpected token '{'"). This compiles (never runs) each
// local script index.html loads, whole — every `path.js?v=` it names (the
// form tools/cachebust.js stamps, tag or APP_SRC alike).

(function () {
const html = INDEX_HTML_SRC;

test('scripts: every local script index.html loads parses', () => {
  const srcs = [...new Set([...html.matchAll(/\b((?:src|vendor)\/[\w\/.-]+\.js)\?v=/g)].map(m => m[1]))];
  assert.truthy(srcs.includes('src/app.js'), 'the scan finds src/app.js');
  const bad = srcs.map(__parseScript).filter(Boolean);
  assert.eq(bad.length, 0, bad.join('\n'));
});
})();
