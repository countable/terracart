(function () {
const lift = sig => {
  const start = SCENE_SRC.indexOf('\n  ' + sig);
  return SCENE_SRC.slice(start + 1, SCENE_SRC.indexOf('\n  }\n', start) + 4);
};
const methods = ['_queueLowHealthStory() {', '_lowHealthStory() {', '_storySplashOnce(key, { art, title, body, okLabel, onDismiss } = {}) {',
  '_enqueueCeremony(kind, open, { key, hold, defer = false } = {}) {', '_drainCeremonies() {', '_dialogOpen() {'].map(lift).join('\n');
const K = new Function('persistSave', 'Energy', `return class { ${methods} };`)(() => {}, Energy);
function run(fn) {
  const body = document.body;
  let busy = false;
  document.body = { classList: { contains: () => busy } };
  const s = new K();
  s.save = { energy: 100, discovered: {} };
  s.modals = [];
  s.showMessageModal = panel => s.modals.push(panel);
  try { fn(s, value => { busy = value; }); } finally { document.body = body; }
}
test('low health: inclusive live 30 percent threshold, once per save, regardless of reach buff', () => run(s => {
  Energy.maxEnergy(s.save);
  const threshold = Energy.tiredThreshold(s.save);
  s.save.energy = threshold + 1;
  s._lowHealthStory();
  assert.eq(s.modals.length, 0);
  s.save.energy = threshold;
  s.save.dawnfruitUntil = Date.now() + 60000;
  s._lowHealthStory();
  assert.eq(s.modals.length, 1);
  assert.eq(s.modals[0].art, 'health_low');
  assert.truthy(s.save.storySeen['health:low']);
  assert.falsy(s.save.healthLowPending);
  s.save.energy = 1; s._lowHealthStory();
  assert.eq(s.modals.length, 1);
}));
test('low health: busy dialogs retain the pending story through healing and reload', () => run((s, busy) => {
  busy(true); s.save.energy = 10; s._lowHealthStory();
  assert.eq(s.modals.length, 0);
  assert.truthy(s.save.healthLowPending);
  assert.falsy(s.save.storySeen?.['health:low']);
  s.save.energy = 100;
  s.save = JSON.parse(JSON.stringify(s.save));
  busy(false); s._lowHealthStory();
  assert.eq(s.modals.length, 1);
}));
test('low health: a dead or collapsing character cannot open the warning', () => run(s => {
  s.save.energy = 0; s._lowHealthStory();
  assert.falsy(s.save.healthLowPending);
  s.save.healthLowPending = true; s._lowHealthStory();
  assert.eq(s.modals.length, 0);
  s.save.energy = 10; s._passingOut = true; s._lowHealthStory();
  assert.eq(s.modals.length, 0);
  s._passingOut = false; s._lowHealthStory();
  assert.eq(s.modals.length, 1);
}));
test('low health: all energy display updates queue it and the modal pass retries it', () => {
  assert.truthy(/updateEnergyDOM\(\) \{\s*this\._stopDownedActions\?\.\(\);\s*this\._queueLowHealthStory\(\)/.test(SCENE_SRC));
  assert.truthy(/this\._drainBadgeStories\(\);\s*this\._lowHealthStory\(\)/.test(SCENE_SRC));
});
})();
