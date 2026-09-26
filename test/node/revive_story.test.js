// THE REVIVAL STORYBOARD (app.js _reviveStoryboard): the first time Home
// lifts a downed player off zero (update()'s hard-mode lockout branch), three
// story panels play in order — out cold, found by villagers, back at Home.
// Home only: a Crow Feather or a revival potion is the player's own doing and
// tells no such story. Once per save, in the story ledger under 'revive'.

(function () {
const app = APP_JS_SRC;
const lift = (sig) => {
  const i = app.indexOf('\n  ' + sig);
  assert.truthy(i > 0, `found ${sig}`);
  return app.slice(i + 1, app.indexOf('\n  }\n', i) + 4);
};
const SRC = lift('_reviveStoryboard() {');

function mkScene() {
  const K = new Function('persistSave', 'Energy', `return class { ${SRC} }`)(() => {}, { REVIVE_FRAC: 0.25 });
  const s = new K();
  s.save = {};
  s.modals = [];
  s.showMessageModal = (o) => s.modals.push(o);
  return s;
}

test('revive story: three panels in order, Next between them, once per save', () => {
  const real = globalThis.document.body;
  globalThis.document.body = { classList: { contains: () => false } };
  try {
    const s = mkScene();
    s._reviveStoryboard();
    assert.eq(s.modals.length, 1, 'the first panel opens');
    assert.eq(s.modals[0].art, 'revive_fall');
    assert.eq(s.modals[0].okLabel, 'Next');
    s.modals[0].onDismiss();
    assert.eq(s.modals[1].art, 'revive_found');
    s.modals[1].onDismiss();
    assert.eq(s.modals[2].art, 'revive_wake');
    assert.eq(s.modals[2].okLabel, 'OK');
    assert.truthy(/25% of your strength/.test(s.modals[2].body), 'the quarter bar, read off Energy.REVIVE_FRAC');
    assert.eq(s.modals[2].onDismiss, undefined, 'the last panel ends it');
    for (const m of s.modals) assert.eq(m.kind, 'story');
    s._reviveStoryboard();
    assert.eq(s.modals.length, 3, 'a second revival tells nothing');
  } finally { globalThis.document.body = real; }
});

test('revive story: a busy screen leaves it for the next revival', () => {
  const real = globalThis.document.body;
  globalThis.document.body = { classList: { contains: (c) => c === 'modal-open' } };
  const s = mkScene();
  try { s._reviveStoryboard(); } finally { globalThis.document.body = real; }
  assert.eq(s.modals.length, 0);
  assert.falsy(s.save.storySeen.revive, 'not burned');
});

test('revive story: only the Home lift tells it — not a feather, not a potion', () => {
  const i = app.indexOf('if (atHome && locked) {');
  const branch = app.slice(i, app.indexOf('} else if (atHome', i));
  assert.truthy(/this\._reviveStoryboard\(\)/.test(branch), 'the Home lift calls it');
  assert.eq((app.match(/this\._reviveStoryboard\(\)/g) || []).length, 1, 'and nothing else does');
});
})();
