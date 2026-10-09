// A named macro stall (an inn, a chapel, …) labels itself on two lines: its
// kind (Macros.stallLabel — KIND_DIALOG's label, or a training hall's
// discipline) then the place's name, with no gap —
// the stroke Phaser counts into each line's height is taken back out.
// render.js can't run headlessly, so the wiring is pinned as source text.

test('stall label: kind on line one, the name on line two', () => {
  const src = RENDER_SRC;
  assert.truthy(/const mac = isFallback \? null : macroFor\(o\);/.test(src), 'only a named macro stall');
  assert.truthy(/Macros\.stallLabel\(mac\.kind, o\)/.test(src), 'the kind word its dialog opens under (a training hall names its discipline)');
  assert.truthy(/kindLabel: Macros\.stallLabel\(kind, o\) \|\| d\.label/.test(SCENE_SRC), 'the same word on the dialog');
  assert.truthy(/`\$\{macLabel\}\\n\$\{rusticifyName\(o\.name\)\}`/.test(src), 'then the name on the next line');
});

test('stall label: no space between the lines', () => {
  assert.truthy(/setLineSpacingOnce\(tx, -LABEL_STROKE_W\);/.test(RENDER_SRC),
    'set on every pooled label, cancelling the stroke');
  assert.eq(Macros.KIND_DIALOG.inn.label, 'Inn', 'the kind label table');
});

test('stall dialog: every booth kind names its presenter in KIND_DIALOG, shelf counters with their stock and title', () => {
  // The `present` column is the scene method presentMacro calls, `(sx, sy, o,
  // dress)`; a counter that sells off a shelf goes through _presentStallOffer
  // with its own `stock(o)` (an array of item ids) and `title`. The chapel is
  // interactables.js' daily visit, no dialog of its own.
  const stub = { id: 'stall_1', macro: {} };
  for (const [kind, row] of Object.entries(Macros.KIND_DIALOG)) {
    if (kind === 'chapel') { assert.eq(row.present, undefined, 'the chapel names no presenter'); continue; }
    assert.truthy(/^_present[A-Z]\w+$/.test(row.present), `${kind}: a scene presenter (${row.present})`);
    if (row.present === '_presentStallOffer') {
      assert.truthy(Array.isArray(row.stock(stub)) && row.stock(stub).every((id) => ITEM_BY_ID[id] || (kind === 'sundries' && Macros.isSundriesGear(id))), `${kind}: stock(o) is item ids or sundries gear`);
      assert.truthy(typeof row.title === 'string' && row.title.endsWith(':'), `${kind}: a shelf title`);
    } else {
      assert.eq(row.stock, undefined, `${kind}: no shelf`);
    }
  }
  assert.eq(['apothecary', 'scriptorium', 'sundries'].map((k) => Macros.KIND_DIALOG[k].present).join(),
    '_presentStallOffer,_presentStallOffer,_presentStallOffer', 'the three shelf counters share the offer presenter');
});
