// Story splashes: the banner art (assets/art/*.png) wired into the one-time
// game moments - a first delivery, a first shiny, a castle's claim, a wreck
// restored, a fort unsealed.
//
// Every moment goes through app.js _storySplashOnce, the STORY LEDGER:
// `save.storySeen` remembers each key ever shown, so a reload can never
// replay one; and a busy screen (body.modal-open, the same signal
// _showTrailIntro waits on) returns false WITHOUT marking the key, so the
// caller falls back to its plain flash and the moment asks again next time
// instead of burning unseen.
//
// app.js needs Phaser and can't load headlessly, so the method is lifted out
// of APP_JS_SRC and run for real on a stub scene (the same trick
// home_ward.test.js uses), and the call sites are pinned as source text. The
// art stems are checked against the real PNGs via pngDims (the vm sandbox
// has no fs, so a typo'd stem fails loudly through the same path the item
// icon tests use).

(function () {
const app = APP_JS_SRC;

const lift = (sig, what) => {
  const start = app.indexOf('\n  ' + sig);
  const end = start < 0 ? -1 : app.indexOf('\n  }\n', start);
  assert.truthy(start > 0 && end > start, `found ${what} in app.js`);
  return app.slice(start + 1, end + 4);
};

const SPLASH_SRC = lift('_storySplashOnce(key, { art, title, body, okLabel } = {}) {',
  '_storySplashOnce');

// The restored-wreck card, for the restore-role pins.
const WRECK_SRC = lift('presentWreckRestoreModal(sx, sy, house) {',
  'presentWreckRestoreModal');
const FORT_SRC = lift('presentFortUnlockModal(sx, sy, house) {',
  'presentFortUnlockModal');
const SHINY_SRC = lift("flashShiny(money, isNew = true, title = '✨ SHINY FIND ✨') {",
  'flashShiny');

// ── The ledger, as source ─────────────────────────────────────────────────
test('story splash: the ledger is save.storySeen, written once per key', () => {
  assert.truthy(/this\.save\.storySeen = this\.save\.storySeen \|\| \{\};/.test(SPLASH_SRC),
    '_storySplashOnce creates the storySeen map like save.discovered');
  assert.truthy(/if \(seen\[key\]\) return false;/.test(SPLASH_SRC),
    'a key already in the ledger never replays');
  assert.truthy(/seen\[key\] = 1;/.test(SPLASH_SRC),
    'a shown splash is banked in the ledger');
});

test('story splash: showing a splash persists the save', () => {
  assert.truthy(/persistSave\(this\.save\);/.test(SPLASH_SRC),
    'the ledger write is persisted at once, so a reload cannot replay the moment');
});

test('story splash: a busy screen returns false WITHOUT marking the key seen', () => {
  const busy = SPLASH_SRC.indexOf("if (document.body?.classList?.contains('modal-open')) return false;");
  assert.truthy(busy > 0, 'the modal-open busy guard is there');
  const mark = SPLASH_SRC.indexOf('seen[key] = 1;');
  assert.truthy(busy < mark, 'the guard runs BEFORE the ledger write - a busy screen does not burn the moment');
});

test('story splash: the guard re-syncs the class first, for moments fired from a closing modal', () => {
  // body.modal-open is mirrored off a MutationObserver, so it lags a
  // wrap.remove() by a microtask: the delivery and castle splashes fire from
  // inside the accept handler of the modal they just closed, and without the
  // re-sync the guard would read busy on every single one of them.
  const sync = SPLASH_SRC.indexOf('this._syncModalGate?.();');
  const busy = SPLASH_SRC.indexOf("contains('modal-open')");
  assert.truthy(sync > 0 && sync < busy, '_syncModalGate runs before the busy check');
});

test('story splash: the splash is a showMessageModal carrying the art stem', () => {
  assert.truthy(/this\.showMessageModal\(\{ title, body, art, okLabel \}\);/.test(SPLASH_SRC),
    'the banner goes through showMessageModal, which renders dialogArtHTML');
});

// ── The call sites, as source ─────────────────────────────────────────────
test('story splash: first delivery captures the tally BEFORE it moves off zero', () => {
  const cap = app.indexOf('const wasFirstDelivery = (this.save.deliveryCount ?? 0) === 0;');
  const inc = app.indexOf('this.save.deliveryCount = (this.save.deliveryCount ?? 0) + sets;');
  assert.truthy(cap > 0 && inc > cap, 'wasFirstDelivery is read before the increment');
  const splash = app.indexOf("this._storySplashOnce('delivery', {", inc);
  assert.truthy(splash > inc, 'the delivery splash fires after the delivery is banked');
  assert.truthy(/if \(wasFirstDelivery\) \{[\s\S]{0,400}art: 'delivery_first'/.test(app.slice(inc, splash + 400)),
    "the splash is gated on wasFirstDelivery and carries the delivery_first banner");
});

test('story splash: the first shiny splash precedes the fanfare toasts', () => {
  const splash = SHINY_SRC.indexOf("this._storySplashOnce('shiny', {");
  assert.truthy(splash > 0, 'flashShiny opens with the shiny splash');
  assert.truthy(/art: 'shiny_first'/.test(SHINY_SRC), 'the splash carries the shiny_first banner');
  const fanfare = SHINY_SRC.indexOf('this._toast(title,');
  assert.truthy(fanfare > splash, 'the splash is asked before the fanfare toasts fire');
});

test('story splash: a castle claim splashes once per castle, flash as fallback', () => {
  const splash = app.indexOf("this._storySplashOnce('castle:' + (this._castleKey(house) || house.id), {");
  assert.truthy(splash > 0, 'the castle splash is keyed on the castle itself');
  assert.truthy(/art: 'castle_claim'/.test(app.slice(splash, splash + 400)),
    'the splash carries the castle_claim banner');
  assert.truthy(/const splashed = this\._storySplashOnce\('castle:'/.test(app),
    'the caller keeps the return value');
  assert.truthy(/if \(!splashed\) \{[\s\S]{0,200}this\.flash\('The castle vault is yours\.'/.test(app.slice(splash - 60, splash + 600)),
    'the plain flash survives as the busy-screen fallback');
});

test('story splash: the Restored! card shows the role banner, not the building sprite', () => {
  assert.truthy(!/buildingImgHTML/.test(app),
    'buildingImgHTML is gone - the banners replaced both of its call sites');
  assert.truthy(/iconHTML: '',/.test(WRECK_SRC), 'the icon row is empty');
  assert.truthy(/art: role === 'plain' \? 'restore_house' : 'restore_' \+ role,/.test(WRECK_SRC),
    'the banner stem is restore_house for a plain house, restore_<role> for a themed shop');
});

test('story splash: the Unsealed! card shows the fort_unseal banner, not the building sprite', () => {
  assert.truthy(!/buildingImgHTML/.test(FORT_SRC),
    'presentFortUnlockModal no longer calls buildingImgHTML');
  assert.truthy(/art: 'fort_unseal'/.test(FORT_SRC), 'the banner is fort_unseal');
});

test('story splash: the chest reward modal collapses an empty icon row', () => {
  const modal = lift('showChestRewardModal({ iconHTML, name, sub, qty, color = UI_TREASURE, accent = UI_TREASURE,',
    'showChestRewardModal');
  assert.truthy(/iconHTML \? `<div style="margin:6px 0 10px;font-size:0">\$\{iconHTML\}<\/div>` : ''/.test(modal),
    'an empty iconHTML leaves no blank band under the banner');
});

// ── The art files exist ───────────────────────────────────────────────────
test('story splash: every art stem app.js names exists as a PNG in assets/art/', () => {
  const stems = new Set();
  for (const m of app.matchAll(/\bart: '([^']+)'/g)) stems.add(m[1]);
  // The dynamic restore stems, derived from the INFO role table in
  // presentWreckRestoreModal so a new role demands its art file here.
  const roles = [...WRECK_SRC.matchAll(/^ {12}(\w+): *\{/gm)].map((m) => m[1]);
  assert.includes(roles, 'plain', 'the INFO role table still has the plain house row');
  for (const role of roles) stems.add(role === 'plain' ? 'restore_house' : 'restore_' + role);
  assert.includes([...stems], 'delivery_first', 'the delivery stem was collected');
  assert.includes([...stems], 'shiny_first', 'the shiny stem was collected');
  assert.includes([...stems], 'castle_claim', 'the castle stem was collected');
  assert.includes([...stems], 'fort_unseal', 'the fort stem was collected');
  for (const stem of stems) {
    const dims = pngDims(`assets/art/${stem}.png`);
    assert.truthy(dims, `assets/art/${stem}.png exists and is a PNG`);
  }
});

// ── The ledger, run for real ──────────────────────────────────────────────
// new Function inside the vm resolves persistSave / document against the
// context globals at call time, so the test can spy on the one and stub the
// other.
const splashMethods = new Function(`return {\n${SPLASH_SRC}\n};`)();

const mkScene = () => {
  const modals = [];
  return {
    save: {},
    modals,
    showMessageModal(opts) { modals.push(opts); },
    _storySplashOnce: splashMethods._storySplashOnce,
  };
};

test('story splash (behaviour): first call marks seen, persists and shows the modal', () => {
  const s = mkScene();
  const realPersist = globalThis.persistSave;
  const persisted = [];
  globalThis.persistSave = (save) => persisted.push(save);
  try {
    const out = s._storySplashOnce('delivery', { art: 'delivery_first', title: 'T', body: 'B' });
    assert.eq(out, true, 'returns true when the splash opened');
    assert.eq(s.save.storySeen.delivery, 1, 'the key is banked in save.storySeen');
    assert.eq(persisted.length, 1, 'persistSave ran once');
    assert.eq(persisted[0], s.save, 'persistSave was handed this save');
    assert.eq(s.modals.length, 1, 'one modal opened');
    assert.eq(s.modals[0].art, 'delivery_first', 'the modal carries the art stem');
    assert.eq(s.modals[0].title, 'T', 'the modal carries the title');
    assert.eq(s.modals[0].body, 'B', 'the modal carries the body');
  } finally {
    globalThis.persistSave = realPersist;
  }
});

test('story splash (behaviour): a seen key never replays', () => {
  const s = mkScene();
  s._storySplashOnce('shiny', { art: 'shiny_first', title: 'T', body: 'B' });
  const out = s._storySplashOnce('shiny', { art: 'shiny_first', title: 'T', body: 'B' });
  assert.eq(out, false, 'returns false for a key already in the ledger');
  assert.eq(s.modals.length, 1, 'no second modal opened');
});

test('story splash (behaviour): a busy screen returns false unmarked, then recovers', () => {
  const s = mkScene();
  const realBody = globalThis.document.body;
  globalThis.document.body = { classList: { contains: (c) => c === 'modal-open' } };
  try {
    const out = s._storySplashOnce('castle:x', { art: 'castle_claim', title: 'T', body: 'B' });
    assert.eq(out, false, 'returns false behind another modal');
    assert.eq(s.save.storySeen && s.save.storySeen['castle:x'], undefined,
      'the key was not marked seen');
    assert.eq(s.modals.length, 0, 'no modal opened');
  } finally {
    globalThis.document.body = realBody;
  }
  const retry = s._storySplashOnce('castle:x', { art: 'castle_claim', title: 'T', body: 'B' });
  assert.eq(retry, true, 'the same key opens once the screen is clear - the moment was not burned');
  assert.eq(s.modals.length, 1, 'the retry shows the modal');
});

test('story splash (behaviour): the re-sync lets a splash out of a just-closed modal', () => {
  // The accept handler removes the offer modal's wrap and fires onAccept in
  // the same click - body.modal-open still latches on until the observer's
  // microtask. The stub's _syncModalGate does what the real one does: read
  // the DOM and correct the class. Without that call the splash could never
  // leave a modal's accept handler.
  const s = mkScene();
  const classes = new Set(['modal-open']);
  const realBody = globalThis.document.body;
  globalThis.document.body = { classList: { contains: (c) => classes.has(c) } };
  let syncs = 0;
  s._syncModalGate = () => { syncs++; classes.delete('modal-open'); };
  try {
    const out = s._storySplashOnce('delivery', { art: 'delivery_first', title: 'T', body: 'B' });
    assert.eq(out, true, 'the splash opens once the class is re-synced');
    assert.eq(syncs, 1, 'the re-sync ran');
    assert.eq(s.modals.length, 1, 'the modal opened');
  } finally {
    globalThis.document.body = realBody;
  }
});
})();
