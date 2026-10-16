test('typography: DOM and canvas share the approved system sans stack', () => {
  const stack = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", Ubuntu, Cantarell, system-ui, Tahoma, "Liberation Sans", Arial, sans-serif';
  const dom = INDEX_HTML_SRC.match(/--font-ui:\s*([^;]+);/)[1];
  assert.eq(dom, stack, 'DOM fallback order');
  assert.eq(fontUI('bold 12px'), `bold 12px ${stack}`, 'CSS shorthand fallback order');
  const canvas = phaserFontUI('bold 12px');
  assert.eq(canvas.fontFamily, stack, 'Phaser gets the complete family list');
  assert.eq(canvas.fontSize, '12px');
  assert.eq(canvas.fontStyle, 'bold');
  assert.eq(phaserFontUI('10px').fontStyle, '', 'unweighted text keeps normal weight');
});
