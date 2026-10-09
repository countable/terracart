// THE REVIVAL STORYBOARD (app.js _reviveStoryboard): the first time Home
// lifts a downed player off zero (update()'s hard-mode lockout branch), three
// story panels play in order — out cold, found by villagers, back at Home.
// Home only: a Crow Feather or a revival potion is the player's own doing and
// tells no such story. Once per save, in the story ledger under 'revive'.

(function () {
const app = SCENE_SRC;
const lift = (sig) => {
  const i = app.indexOf('\n  ' + sig);
  assert.truthy(i > 0, `found ${sig}`);
  return app.slice(i + 1, app.indexOf('\n  }\n', i) + 4);
};
const SRC = lift('_reviveStoryboard() {') + '\n' + lift('_dialogOpen() {') + '\n' + lift('_gpsNearHome() {');

function mkScene() {
  const K = new Function('persistSave', 'Energy', `return class { ${SRC} }`)(() => {}, { REVIVE_FRAC: 0.25 });
  const s = new K();
  s.save = {};
  s.modals = [];
  s.showMessageModal = (o) => s.modals.push(o);
  return s;
}

test('death story: both collapse paths show memories before the existing outcome', () => {
  const methods = ['_deathStory(onDismiss) {', '_passOutToSurface() {', '_passOutOnSurface() {'].map(lift).join('\n');
  const K = new Function('persistSave', 'addMoney', 'WorldGen', `return class { ${methods} }`)(
    () => {}, (save, delta) => { save.money += delta; }, { setDepth: () => {} });
  for (const underground of [false, true]) {
    const s = new K();
    s.save = { money: 101, energy: 0, exhausted: true, depth: underground ? 2 : 0 };
    s.depth = s.save.depth;
    s.modals = [];
    s.showMessageModal = s.showChestRewardModal = o => s.modals.push(o);
    s.moneyHTML = String;
    s.syncMoveTarget = () => {};
    s.cameras = { main: { setBackgroundColor: () => {} } };
    s.ensureTilesAround = () => Promise.resolve();
    s[underground ? '_passOutToSurface' : '_passOutOnSurface']();
    assert.eq(s.modals.length, 1);
    assert.eq(s.modals[0].art, 'death_memories');
    assert.eq(s.modals[0].body, 'You desperately try to hold onto your memories... your vision goes dark and red.');
    assert.eq(s.modals[0].okLabel, 'Next');
    assert.truthy(s.modals[0].mustAcknowledge, 'backdrop dismissal cannot skip the collapse continuation');
    assert.eq(s.save.money, 51);
    assert.eq(s.save.energy, 0);
    assert.eq(s.depth, 0);
    assert.truthy(s._passingOut);
    s.modals[0].onDismiss();
    assert.eq(s.modals[1].header, 'Exhausted');
    assert.truthy(s._passingOut);
    assert.eq(s.save.money, 51);
    s.modals[1].onDismiss();
    assert.falsy(s._passingOut);
    assert.truthy(s.save.exhausted);
  }
});

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
    assert.eq(s.modals[2].okLabel, 'OK', 'the last page ends it (MemoryStory.showPages)');
    assert.truthy(/farmhand|carer/.test(s.modals[2].body), 'a silent carer');
    assert.falsy(/\d|%|energy|strength/i.test(s.modals[2].body), 'no numbers — the energy pop says what was restored');
    for (const m of s.modals) assert.eq(m.kind, 'story');
    s._reviveStoryboard();
    assert.eq(s.modals.length, 3, 'a second revival tells nothing');
  } finally { globalThis.document.body = real; }
});

test('revive story: only when the player is REALLY near Home — the GPS fix, not a stick-walked body', () => {
  const real = globalThis.document.body;
  globalThis.document.body = { classList: { contains: () => false } };
  try {
    const s = mkScene();
    s.startWorldM = { x: 1000, y: 2000 };
    s.homeWorldPos = () => ({ x: 1000, y: 2000 });
    s.gpsM = { x: HomeArea.NEAR_M + 50, y: 0 };   // the phone is a street away
    s._reviveStoryboard();
    assert.eq(s.modals.length, 0, 'the body was walked home by hand: no story');
    assert.falsy(s.save.storySeen.revive, 'not burned — the next real revival at Home tells it');
    s.gpsM = { x: 10, y: -5 };
    s._reviveStoryboard();
    assert.eq(s.modals.length, 1, 'at Home for real: the story plays');
    assert.eq(s.save.storySeen.revive, 1);
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
