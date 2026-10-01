// The browser harness boots the REAL page: test/harness.html loads the same
// src modules, in index.html's order, plus the test runner. It keeps its own
// copy of that list, and the copy is the danger — when the shops extraction
// (f0b8ade) moved code into scene_shops.js, the harness kept booting straight
// into "SceneShops is not defined" and the WHOLE browser suite silently
// stopped running for weeks, because nothing compared the two lists. These
// pins do, so the next extraction fails here instead of in production.

test('harness scripts: the list mirrors index.html order', () => {
  const pageScripts = [...INDEX_HTML_SRC.matchAll(/src="src\/([^"'?]+)/g)].map((m) => m[1]);
  const harnessScripts = [...HARNESS_HTML_SRC.matchAll(/'\/src\/([^']+)'/g)].map((m) => m[1]);
  assert.truthy(pageScripts.length > 60, 'index.html script list parsed');
  assert.truthy(harnessScripts.length > 60, 'harness script list parsed');

  // app.js is the one legal difference: the page injects it after a GPS gate
  // (index.html APP_SRC), while the harness loads it statically — last, which
  // is also its position in the page's effective order.
  const order = harnessScripts.filter((f) => f !== 'app.js');
  if (harnessScripts.includes('app.js')) {
    assert.eq(harnessScripts[harnessScripts.length - 1], 'app.js', 'app.js loads last');
  }
  // COMPLETENESS, not just order: every page module must be here. A missing
  // module does not break the subsequence walk below — it just makes the
  // harness throw "X is not defined" on first use, which is exactly how the
  // shops and shrines extractions each blinded the suite.
  for (const f of pageScripts) {
    assert.truthy(harnessScripts.includes(f), `${f} loads in the harness`);
  }
  // `order` must walk pageScripts forward without ever going back: a module
  // that moved, or one the harness loads before its provider, fails here.
  let pi = 0;
  for (const f of order) {
    while (pi < pageScripts.length && pageScripts[pi] !== f) pi++;
    assert.truthy(pi < pageScripts.length, `${f} appears in index.html after the previous harness module`);
    pi++;
  }
});

test('harness scripts: the two stragglers from the outage are pinned', () => {
  const harnessScripts = [...HARNESS_HTML_SRC.matchAll(/'\/src\/([^']+)'/g)].map((m) => m[1]);
  // scene_shops.js and scenic.js are named because their absence is the
  // recorded failure; the order test above guards every other module
  // generically.
  assert.truthy(harnessScripts.includes('scene_shops.js'), 'scene_shops.js present');
  assert.truthy(harnessScripts.includes('scenic.js'), 'scenic.js present');
});
