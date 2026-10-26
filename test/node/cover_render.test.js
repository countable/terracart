// Rendering must conceal the same covered targets as interactions (any cover
// hides what stands behind it).
(function () {
  test('cover render: covered targets are removed in place, clear targets keep their order', () => {
    const start = RENDER_SRC.indexOf('Render.coverHidden = function');
    const end = RENDER_SRC.indexOf('\nRender.drawObjects =', start);
    const render = new Function('Visibility',
      'const Render = {};\n' + RENDER_SRC.slice(start, end) + '\nreturn Render;')(
      { hidden: (scene, x) => x !== 0 });
    for (const field of ['o', 'p', 'tr', 'h']) {
      const list = [2, 0, 1, 0, 2].map((x, i) => ({ [field]: { x, y: i } }));
      const first = list[1], second = list[3], original = list;
      render.cullCovered({}, list, field);
      assert.eq(list, original, 'reuse the existing sprite list');
      assert.eq(list.length, 2);
      assert.eq(list[0], first);
      assert.eq(list[1], second);
      assert.truthy(render.coverHidden({}, { x: 1, y: 0 }), 'partial cover hides');
      assert.truthy(render.coverHidden({}, { x: 2, y: 0 }));
    }
  });
})();
