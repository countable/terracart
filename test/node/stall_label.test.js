// A named macro stall (an inn, a chapel, …) labels itself on two lines: its
// kind (Macros.KIND_DIALOG's label) then the place's name, with no gap —
// the stroke Phaser counts into each line's height is taken back out.
// render.js can't run headlessly, so the wiring is pinned as source text.

test('stall label: kind on line one, the name on line two', () => {
  const src = RENDER_SRC;
  assert.truthy(/const mac = isFallback \? null : macroFor\(o\);/.test(src), 'only a named macro stall');
  assert.truthy(/Macros\.KIND_DIALOG\[mac\.kind\]\?\.label/.test(src), 'the kind word its dialog opens under');
  assert.truthy(/`\$\{macLabel\}\\n\$\{rusticifyName\(o\.name\)\}`/.test(src), 'then the name on the next line');
});

test('stall label: no space between the lines', () => {
  assert.truthy(/setLineSpacingOnce\(tx, -LABEL_STROKE_W\);/.test(RENDER_SRC),
    'set on every pooled label, cancelling the stroke');
  assert.eq(Macros.KIND_DIALOG.inn.label, 'Inn', 'the kind label table');
});
