// The depth tag under the ☰ menu button: "Depth N" underground, nothing at
// ground level. One element, painted by updateHUD through _paintIfChanged.
test('depth tag: one element under the menu, painted from scene.depth, blank on the surface', () => {
  assert.truthy(/<div id="depth-tag"/.test(INDEX_HTML_SRC), 'the element ships in the shell');
  assert.truthy(/#depth-tag:empty[^{]*\{ display: none; \}/.test(INDEX_HTML_SRC), 'empty means hidden');
  const m = SCENE_SRC.match(/this\._paintIfChanged\('_depthDOM', this\.depth \| 0, \(\) => \{\n([\s\S]*?)\n    \}\);/);
  assert.truthy(m, 'updateHUD paints it behind the change guard');
  const paints = [];
  const paint = new Function('document', 'return function () {' + m[1] + '};');
  for (const depth of [0, 1, 3]) {
    const doc = { getElementById: () => ({ set textContent(v) { paints.push(v); } }) };
    paint(doc).call({ depth });
  }
  assert.eq(paints.join('|'), '|Depth 1|Depth 3', 'blank at ground level, the floor number below it');
  assert.lte('Depth 12'.length, MAP_MSG_MAX);
});
