// Discovery badge story: every badge the ledger banks opens the
// discovery_badge splash — "A glowing emblem appears in your vision. You have
// gained one discovery badge for ____" — with the caller's label in the
// blank. The ledger (_bankDiscovery) queues it; _drainBadgeStories opens the
// queue one dialog at a time on a clear screen, off the modal-gate tick.
//
// app.js can't load headlessly, so both methods are lifted out of
// APP_JS_SRC and run on a stub scene (the story_splashes idiom); the three
// call sites and the tick are pinned as source text.

(function () {
const app = APP_JS_SRC;

const lift = (sig, what) => {
  const start = app.indexOf('\n  ' + sig);
  const end = start < 0 ? -1 : app.indexOf('\n  }\n', start);
  assert.truthy(start > 0 && end > start, `found ${what} in app.js`);
  return app.slice(start + 1, end + 4);
};

const BANK_SRC = lift('_bankDiscovery(key, label) {', '_bankDiscovery');
const DRAIN_SRC = lift('_drainBadgeStories() {', '_drainBadgeStories');

function mkScene() {
  const methods = new Function(`return class { ${BANK_SRC}\n${DRAIN_SRC} }`)();
  const s = new methods();
  s.save = { inv: [] };
  s.added = 0;
  s.addToInv = (id, n) => { if (id === 'discovery') s.added += n; };
  s.modals = [];
  s.showMessageModal = (o) => s.modals.push(o);
  return s;
}

function withBody(busy, fn) {
  const real = globalThis.document.body;
  globalThis.document.body = { classList: { contains: (c) => c === 'modal-open' && busy() } };
  try { fn(); } finally { globalThis.document.body = real; }
}

test('badge story: a banked badge queues its dialog, a refused key queues none', () => {
  const s = mkScene();
  assert.eq(s._bankDiscovery('cow', 'a shiny Cow'), true);
  assert.eq(s._bankDiscovery('cow', 'a shiny Cow'), false, 'one badge per key');
  assert.eq(s.added, 1);
  assert.eq(s._badgeStories.length, 1, 'only the banked badge tells its story');
  assert.eq(s.modals.length, 0, 'queued, never opened on the spot');
});

test('badge story: the drain opens one dialog per badge, with the label in the blank', () => {
  const s = mkScene();
  s._bankDiscovery('cow', 'a shiny Cow');
  s._bankDiscovery('goblin', 'slaying an elite Goblin');
  withBody(() => false, () => { s._drainBadgeStories(); });
  assert.eq(s.modals.length, 1, 'one at a time');
  assert.eq(s.modals[0].art, 'discovery_badge');
  assert.eq(s.modals[0].body,
    'A glowing emblem appears in your vision. You have gained one discovery badge for a shiny Cow.');
  let busy = true;
  withBody(() => busy, () => {
    s._drainBadgeStories();
    assert.eq(s.modals.length, 1, 'a busy screen holds the queue');
    busy = false;
    s._drainBadgeStories();
  });
  assert.eq(s.modals.length, 2);
  assert.truthy(/slaying an elite Goblin\.$/.test(s.modals[1].body), 'the second badge follows');
});

test('badge story: every ledger caller names what the badge is for, and the tick drains', () => {
  const calls = [...app.matchAll(/this\._bankDiscovery\(([^\n]*)/g)].map((m) => m[1]);
  assert.eq(calls.length, 3, 'shiny, elite, first delivery');
  for (const c of calls) assert.truthy(/,\s*\S/.test(c) || /,$/.test(c.trim()), `label passed: ${c}`);
  assert.truthy(/_syncModalGate\?\.\(\);\s*this\._drainBadgeStories\(\);/.test(app),
    'the modal-gate tick drains the queue right after the sync');
});
})();
