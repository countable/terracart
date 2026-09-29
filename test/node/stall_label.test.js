// A named macro stall (an inn, a chapel, …) labels itself on two lines: its
// kind (Macros.stallLabel — KIND_DIALOG's label, or a training hall's
// discipline) then the place's name, with no gap —
// the stroke Phaser counts into each line's height is taken back out.
// render.js can't run headlessly, so the wiring is pinned as source text.

test('stall label: kind on line one, the name on line two', () => {
  const src = RENDER_SRC;
  assert.truthy(/const mac = isFallback \? null : macroFor\(o\);/.test(src), 'only a named macro stall');
  assert.truthy(/Macros\.stallLabel\(mac\.kind, o\)/.test(src), 'the kind word its dialog opens under (a training hall names its discipline)');
  assert.truthy(/kindLabel: Macros\.stallLabel\(kind, o\) \|\| d\.label/.test(APP_JS_SRC), 'the same word on the dialog');
  assert.truthy(/`\$\{macLabel\}\\n\$\{rusticifyName\(o\.name\)\}`/.test(src), 'then the name on the next line');
});

test('stall label: no space between the lines', () => {
  assert.truthy(/setLineSpacingOnce\(tx, -LABEL_STROKE_W\);/.test(RENDER_SRC),
    'set on every pooled label, cancelling the stroke');
  assert.eq(Macros.KIND_DIALOG.inn.label, 'Inn', 'the kind label table');
});
