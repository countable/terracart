// Memory story (was the Discovery badge story): every memory the ledger
// banks opens the discovery_badge splash — "A memory returns" — with the
// caller's label in the blank, adds one to save.memories (a save counter, not
// a bag stack) and fills the energy bar. The ledger (_bankDiscovery) queues
// the story; _drainBadgeStories opens the queue one dialog at a time on a
// clear screen, off the modal-gate tick.
//
// app.js can't load headlessly, so the methods are lifted out of APP_JS_SRC
// and run on a stub scene (the story_splashes idiom); the three call sites
// and the tick are pinned as source text.

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
const TOTAL_SRC = lift('memoriesTotal() {', 'memoriesTotal');
const UNSPENT_SRC = lift('memoriesUnspent() {', 'memoriesUnspent');
const SPEND_SRC = lift('spendMemories(n) {', 'spendMemories');
const HELP_SRC = lift('showMemoriesHelp() {', 'showMemoriesHelp');
const MET_SRC = lift('_metWizard() {', '_metWizard');

function mkScene({ energy = 100, max = 100 } = {}) {
  const methods = new Function('persistSave',
    `return class { ${BANK_SRC}\n${DRAIN_SRC}\n${TOTAL_SRC}\n${UNSPENT_SRC}\n${SPEND_SRC}\n${HELP_SRC}\n${MET_SRC} }`);
  const s = new (methods((save) => { s.persisted = (s.persisted || 0) + 1; }))();
  s.save = { inv: [], energy };
  s.getMaxEnergy = () => max;
  s.pops = [];
  s._popEnergy = (d, o) => s.pops.push([d, o]);
  s.energyDOM = 0;
  s.updateEnergyDOM = () => { s.energyDOM++; };
  s.chipDOM = 0;
  s.updateMemoriesDOM = () => { s.chipDOM++; };
  s.addToInv = () => { throw new Error('a memory never enters the bag'); };
  s.modals = [];
  s.showMessageModal = (o) => s.modals.push(o);
  return s;
}

function withBody(busy, fn) {
  const real = globalThis.document.body;
  globalThis.document.body = { classList: { contains: (c) => c === 'modal-open' && busy() } };
  try { fn(); } finally { globalThis.document.body = real; }
}

test('memory story: a banked memory queues its dialog, a refused key queues none', () => {
  const s = mkScene();
  assert.eq(s._bankDiscovery('cow', 'a shiny Cow'), true);
  assert.eq(s._bankDiscovery('cow', 'a shiny Cow'), false, 'one memory per key');
  assert.eq(s.save.memories, 1, 'the counter took it — not the bag');
  assert.eq(s.save.inv.length, 0);
  assert.eq(s._badgeStories.length, 1, 'only the banked memory tells its story');
  assert.eq(s.modals.length, 0, 'queued, never opened on the spot');
  assert.truthy(s.chipDOM > 0, 'the HUD chip repaints');
});

test('memory story: the drain opens one dialog per memory, with the label in the blank', () => {
  const s = mkScene();
  s._bankDiscovery('cow', 'a shiny Cow');
  s._bankDiscovery('goblin', 'slaying an elite Goblin');
  withBody(() => false, () => { s._drainBadgeStories(); });
  assert.eq(s.modals.length, 1, 'one at a time');
  assert.eq(s.modals[0].art, 'discovery_badge');
  assert.eq(s.modals[0].title, 'A memory returns');
  assert.eq(s.modals[0].body,
    'A glimpse of a memory comes back as you find a shiny Cow.');
  let busy = true;
  withBody(() => busy, () => {
    s._drainBadgeStories();
    assert.eq(s.modals.length, 1, 'a busy screen holds the queue');
    busy = false;
    s._drainBadgeStories();
  });
  assert.eq(s.modals.length, 2);
  assert.truthy(/slaying an elite Goblin\.$/.test(s.modals[1].body), 'the second memory follows');
});

test('memory: every memory fills the bar to the live cap, popped on the body', () => {
  const s = mkScene({ energy: 23, max: 140 });
  s._bankDiscovery('cow', 'a shiny Cow');
  assert.eq(s.save.energy, 140, 'full, at the live cap');
  assert.eq(s.pops.length, 1, 'one pop');
  assert.eq(s.pops[0][0], 117, 'the pop is the gain');
  assert.eq(s.pops[0][1], undefined, 'on the player\'s own cell (the default)');
  assert.truthy(s.energyDOM > 0, 'the gauge repaints');
  // Already full: no pop (a +0 is not a gain), still exactly full.
  s._bankDiscovery('pig', 'a shiny Pig');
  assert.eq(s.pops.length, 1, 'a full bar pops nothing');
  assert.eq(s.save.energy, 140);
  // A refused key heals nothing.
  s.save.energy = 5;
  s._bankDiscovery('cow', 'a shiny Cow');
  assert.eq(s.save.energy, 5, 'an old key is no memory, and no heal');
});

test('memory: total is the ledger, unspent is the counter; spend refuses a shortfall', () => {
  const s = mkScene();
  s.save.discovered = { a: 1, b: 1, c: 1 };
  s.save.memories = 2;
  assert.eq(s.memoriesTotal(), 3);
  assert.eq(s.memoriesUnspent(), 2);
  assert.eq(s.spendMemories(3), false, 'not enough → nothing spent');
  assert.eq(s.save.memories, 2);
  assert.eq(s.spendMemories(2), true);
  assert.eq(s.save.memories, 0);
  assert.truthy(s.persisted >= 1, 'a spend is written');
  assert.eq(s.spendMemories(0), false, 'n<=0 is no spend');
  s.save.memories = -3;
  assert.eq(s.memoriesUnspent(), 0, 'junk reads as none');
});

test('memory chip: the explainer is a declared kind, and says both numbers', () => {
  const s = mkScene();
  s.save.discovered = { a: 1, b: 1 };
  s.save.memories = 1;
  s.showMemoriesHelp();
  const m = s.modals[0];
  assert.eq(m.kind, 'memory');
  assert.truthy(/const MODAL_KINDS = \{[\s\S]*?\n  memory:/.test(MODAL_SHELL_SRC), 'memory is a MODAL_KINDS row');
  assert.truthy(/2 recovered/.test(m.title) && /1 unspent/.test(m.title), 'both numbers');
  assert.falsy(/wizard/i.test(m.body), 'the wizard is a secret until his tower is restored');
  assert.truthy(/use it somehow/.test(m.body), 'only a vague sense of the power');
  s.save.restoredHouses = { h1: 'blacksmith', h2: 'wizard' };
  s.showMemoriesHelp();
  assert.truthy(/Wizard Tower/.test(s.modals[1].body), 'once his tower stands, it names where they are spent');
  s.save.restoredHouses = {};
  s.save.wizardBuys = 1;
  s.showMemoriesHelp();
  assert.truthy(/Wizard Tower/.test(s.modals[2].body), 'a save that has already bought from him knows him too');
  assert.truthy(/showMessageModal\(\{ title, body, okLabel = 'OK', onDismiss, art, kind = art \? 'story' : 'note' \}\)/.test(MODAL_SHELL_SRC),
    'showMessageModal forwards a kind, defaulting to note (a story when it has a painting)');
});

test('memory chip: built beside #energy, repainted by updateHUD, dimmed under a modal, tap swallowed', () => {
  const build = lift('_buildMemoriesChip() {', '_buildMemoriesChip');
  assert.truthy(/row\.insertBefore\(el, energy\)/.test(build), 'sits beside the energy gauge');
  assert.truthy(/this\.renderItemIcon\('memory', 18, 'block'\)/.test(build), 'draws the gold star');
  assert.truthy(/e\.stopPropagation\(\); this\.showMemoriesHelp\(\);/.test(build), 'the tap explains, and stops there');
  assert.truthy(/'pointerdown'/.test(build), 'the press never reaches the map');
  assert.truthy(/this\.updateEnergyDOM\(\);\s*\n\s*this\.updateMemoriesDOM\(\);/.test(app), 'updateHUD repaints it');
  assert.truthy(/body\.modal-open #memories \{ opacity: 0\.25; pointer-events: none; \}/.test(app),
    'dims with its neighbours');
  assert.truthy(inventoryIconSource('memory'), 'the star resolves with no ITEMS row');
  assert.eq(ITEM_BY_ID.memory, undefined, 'and is no item');
});

test('memory copy: no player-facing "Discovery badge" is left', () => {
  const code = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  for (const [name, src] of [['app.js', APP_JS_SRC], ['items.js', ITEMS_JS_SRC],
    ['interact.js', INTERACT_SRC], ['interactables.js', INTERACTABLES_SRC]]) {
    assert.falsy(/discovery badge/i.test(code(src)), `${name}: no "discovery badge" outside comments`);
    assert.falsy(/'Discovery!'/.test(src), `${name}: the old splash title is gone`);
  }
  for (const t of PLAY_TIPS) assert.falsy(/\bDiscovery\b/.test(t), `tip still says Discovery: ${t}`);
  for (const it of ITEMS) assert.falsy(/discovery/i.test(it.name), `item named ${it.name}`);
  assert.falsy(ITEMS.some((it) => it.kind === 'badge'), 'no badge kind in the catalog');
  assert.truthy(PLAY_TIPS.some((t) => /wizard/i.test(t) && /memories/.test(t)), 'the wizard tip speaks of memories');
  assert.truthy(/wizard: +\{ name: 'Wizard Tower', blurb: '[^']*memories/.test(APP_JS_SRC), 'and so does the tower blurb');
  assert.truthy(/🌟 \+1 memory/.test(APP_JS_SRC), 'the shiny fanfare line says memory');
});

test('memory story: every ledger caller names what the memory is for, and the tick drains', () => {
  const calls = [...app.matchAll(/this\._bankDiscovery\(([^\n]*)/g)].map((m) => m[1]);
  assert.eq(calls.length, 5, 'shiny, elite, first delivery, three slot stars, the first slot deluxe');
  for (const c of calls) assert.truthy(/,\s*\S/.test(c) || /,$/.test(c.trim()), `label passed: ${c}`);
  assert.truthy(/_syncModalGate\?\.\(\);\s*this\._drainBadgeStories\(\);/.test(app),
    'the modal-gate tick drains the queue right after the sync');
});
})();
