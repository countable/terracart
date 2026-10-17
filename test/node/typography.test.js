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

// Toast type sizes are what the player sees, now that phaserFontUI() passes
// them through: a bold tier above the note tier's 12px covers the map (the
// 22 / 26px rows had only ever rendered at the canvas's 10px fallback).
test('typography: no toast tier renders larger than the note tier', () => {
  const rows = [...SCENE_SRC.matchAll(/\n  (\w+):\s*\{ font: '(?:bold )?(\d+)px'/g)];
  assert.truthy(rows.length >= 6, 'TOAST_TIER rows found');
  for (const [, tier, px] of rows) assert.truthy(Number(px) <= 12, `${tier} tier is ${px}px`);
});
