// The treasure ceremony opens with the chest it came out of.
//
// Every dialog opens with a hero glyph and a one-word category (app.js
// MODAL_KINDS). TREASURE's glyph was a 💎 — which named neither the chest that
// paid out nor the thing it paid: a starter crate of onion seeds and a trunk
// full of frost bars opened under the same gem, and the crate the player had
// just tapped was nowhere in the dialog. The glyph is that object's OWN sprite
// now, resolved through the SAME look the renderer draws it from, so a crate
// opens under a crate and a trunk under a trunk.
//
// The lane is loot.js › chestLook: one resolver, four looks, each carrying the
// TEXTURE KEY it means. render.js's chest spec reads it (it owned a private
// copy as a per-frame closure until Sep 2026) and app.js's worldIconHTML turns
// the same key into a DOM icon off the frame the renderer draws. Nothing
// re-decides which art a look is, so drawn-as and shown-as can't drift apart —
// the roadOverlayWidthM discipline pointed at a sprite.
//
// app.js needs Phaser and can't load headlessly, so worldIconHTML is lifted
// and run for real and the wiring is pinned as source text (the trick
// story_splashes.test.js uses); chestLook runs for real from the bundle.

(function () {
const app = APP_JS_SRC;

const lift = (sig, what) => {
  const start = app.indexOf('\n  ' + sig);
  const end = start < 0 ? -1 : app.indexOf('\n  }\n', start);
  assert.truthy(start > 0 && end > start, `found ${what} in app.js`);
  return app.slice(start + 1, end + 4);
};

const WORLD_ICON_SRC = lift('worldIconHTML(texKey, sizePx = 26) {', 'worldIconHTML');

// ── The one resolver, run for real ────────────────────────────────────────
const chest = (over) => ({ kind: 'chest', poiClass: 'library', x: 0, y: 0, ...over });
// A chest's tier is demoted near Home (chestTier), and a demoted POI chest
// wears the crate — which is the look, not the bug. Run these away from any
// origin so each case says what it means.
const noHome = (fn) => {
  const prev = HomeArea.worldM;
  HomeArea.worldM = null;
  try { fn(); } finally { HomeArea.worldM = prev; }
};

test('treasure icon: chestLook names the sprite each chest wears', () => noHome(() => {
  assert.eq(chestLook(chest()).texKey, 'chest', 'an ordinary POI chest is the trunk');
  assert.eq(chestLook(chest({ crate: true })).texKey, 'box', 'a starter supply crate is the box');
  assert.truthy(chestLook(chest({ crate: true })).box, 'and reads as a box');
  // A tier-1 POI (an ATM, a bike rack) borrows the crate sprite without being
  // a crate — the same test render.js labels and the tier gem are gated on.
  const lowtier = chest({ poiClass: 'waste_basket' });
  assert.eq(chestTier('waste_basket', 0, 0), 1, 'a waste basket is a tier-1 chest');
  assert.eq(chestLook(lowtier).texKey, 'box', 'so it wears the crate sprite');
  assert.falsy(lowtier.crate, 'without being a supply crate');
  const stall = chestLook(chest({ poiClass: 'bakery', name: 'Corner Bakery' }));
  assert.eq(stall.texKey, 'market_stand', 'a produce stand is the stall');
  assert.truthy(stall.stand, 'and carries the stand it resolved');
}));

test('treasure icon: the look is resolved once and cached on the object', () => {
  const o = chest();
  const first = chestLook(o);
  assert.eq(chestLook(o), first, 'the same object answers with the same look');
  assert.eq(o._chestLook, first, 'memoised on the object, like produceStandFor');
});

// ── The renderer asks it rather than re-deciding ──────────────────────────
test('treasure icon: render.js draws the key the look names', () => {
  assert.truthy(/chest:  \{ key: \(o\) => chestLook\(o\)\.texKey,/.test(RENDER_SRC),
    "the chest spec's texture key IS the look's");
  assert.truthy(!/_isCoinBurst|_chestIsBox/.test(RENDER_SRC),
    'and render.js keeps no private copy of the look');
  // Everything else the spec varies per look reads the one resolver too.
  assert.truthy(!/o\._chestLook = /.test(RENDER_SRC), 'the memo is written in loot.js alone');
});

// ── The icon, run for real ────────────────────────────────────────────────
const iconMethods = (urls) => new Function('window', `return {\n${WORLD_ICON_SRC}\n};`)({
  WORLD_ICON_URLS: urls,
});

test('treasure icon: worldIconHTML paints the baked frame at the asked size', () => {
  const m = iconMethods({ chest: 'data:image/png;base64,AAAA' });
  const html = m.worldIconHTML('chest', 26);
  assert.truthy(/width:26px;height:26px/.test(html), 'sized as asked');
  assert.truthy(/data:image\/png;base64,AAAA/.test(html), 'paints the baked frame');
  assert.truthy(/image-rendering:pixelated/.test(html), 'pixel art stays crisp');
});

test('treasure icon: an unbaked key falls back to the emoji', () => {
  assert.eq(iconMethods({}).worldIconHTML('chest'), '', 'no bake → no sprite');
  assert.eq(iconMethods(undefined).worldIconHTML('chest'), '', 'no table at all → no sprite');
});

test('treasure icon: the bake reads the sheets the renderer draws', () => {
  assert.truthy(/WORLD_ICON_URLS\.chest = bakeSheetFrame\('chest', 0, 32, 32\)/.test(app),
    "the trunk's CLOSED frame is baked");
  assert.truthy(/WORLD_ICON_URLS\.box   = bakeSheetFrame\('box',   0, 16, 16\)/.test(app),
    'and the crate');
  // Both keys are real textures the preloader walks, so the bake has art.
  for (const key of ['chest', 'box']) {
    assert.truthy(new RegExp(`\\n  ${key}: *\\{`).test(ASSETS_SRC),
      `assets.js declares the '${key}' texture`);
  }
});

// ── The header takes it ───────────────────────────────────────────────────
test('treasure icon: a sprite glyph replaces the emoji, ungreyed', () => {
  const at = app.indexOf('const ico = document.createElement(\'span\');');
  assert.truthy(at > 0, 'the kind header builds its glyph span');
  const hdr = app.slice(at, at + 1200);
  assert.truthy(/if \(kindIcon\) \{/.test(hdr), 'a sprite glyph wins over the kind emoji');
  assert.truthy(/ico\.innerHTML = kindIcon;/.test(hdr), 'and is HTML, not text');
  // The greying is the EMOJI's dress — a grey chest reads as broken art.
  const sprite = hdr.slice(hdr.indexOf('if (kindIcon) {'), hdr.indexOf('} else {'));
  assert.truthy(!/grayscale/.test(sprite), 'the sprite branch is not desaturated');
  assert.truthy(/grayscale\(1\)/.test(hdr.slice(hdr.indexOf('} else {'))),
    'the emoji branch still is');
  assert.truthy(/kind, kindLabel, kindIcon \} = \{\}\) \{/.test(app),
    'makeModalShell takes the override');
  assert.truthy(/kind, kindLabel: header, kindIcon,/.test(app),
    'and showChestRewardModal forwards it');
});

test('treasure icon: every chest ceremony carries its chest', () => {
  const src = INTERACTABLES_SRC;
  assert.truthy(/const kindIcon = \(typeof chestLook === 'function' && scene\.worldIconHTML\)\s*\n?\s*\? scene\.worldIconHTML\(chestLook\(o\)\.texKey\) : '';/.test(src),
    'the glyph is resolved through the shipping look');
  // Every ceremony the chest handler opens — gear, cash, discarded gear, the
  // bag-full choice and the plain take — hands it over. A branch that forgot
  // would open under the diamond again.
  const calls = src.split('showChestRewardModal(').slice(1);
  assert.eq(calls.length, 5, 'the chest handler opens five ceremonies');
  for (const c of calls) {
    assert.truthy(/kindIcon/.test(c.slice(0, 420)),
      'this ceremony carries the chest sprite: ' + c.slice(0, 70));
  }
});
})();
