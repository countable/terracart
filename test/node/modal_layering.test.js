// Dialogs live inside #game, whose CSS transform makes its own stacking
// context — so no dialog z-index (the safety card's 400 included) can paint
// over a positive-z-index element appended to <body>. Every such element must
// therefore stand down under body.modal-open (hidden or dimmed), or it floats
// over the dialog: the Eat / Use button sat on top of the safety card.

test('modal layering: every element appended to <body> stands down under body.modal-open', () => {
  const css = INDEX_HTML_SRC + '\n' + SCENE_SRC;
  const covered = new Set();
  for (const m of css.matchAll(/body\.modal-open\s+([#.][\w-]+)/g)) covered.add(m[1]);
  const missing = [];
  let sites = 0;
  for (const [file, src] of Object.entries(ALL_SRC)) {
    for (const m of src.matchAll(/document\.body\.appendChild\((\w+)\)/g)) {
      sites++;
      const v = m[1];
      // The element's identity is set shortly before it is appended.
      const before = src.slice(Math.max(0, m.index - 15000), m.index);
      const sels = [];
      for (const a of before.matchAll(new RegExp(`\\b${v}\\.id\\s*=\\s*'([\\w-]+)'`, 'g'))) sels.push('#' + a[1]);
      for (const a of before.matchAll(new RegExp(`\\b${v}\\.className\\s*=\\s*'([\\w -]+)'`, 'g'))) sels.push(...a[1].split(/\s+/).map(c => '.' + c));
      for (const a of before.matchAll(new RegExp(`\\b${v}\\.classList\\.add\\('([\\w-]+)'\\)`, 'g'))) sels.push('.' + a[1]);
      if (!sels.some(s => covered.has(s))) missing.push(`${file}: ${v} (${sels.join(' ') || 'no id/class'})`);
    }
  }
  assert.truthy(sites >= 8, `found the body-level HUD sites (${sites})`);
  assert.eq(missing.join('; '), '', 'body-level elements without a body.modal-open rule');
});

test('modal layering: the safety card is a .game-modal inside #game', () => {
  assert.truthy(/wrap\.id = 'safety-card';\s*wrap\.className = 'game-modal';/.test(SCENE_SRC),
    'wears .game-modal so the body-level HUD stands down under it');
  assert.truthy(/body\.modal-open \.hud-action,/.test(INDEX_HTML_SRC), 'the Eat / Use buttons hide under a dialog');
});
