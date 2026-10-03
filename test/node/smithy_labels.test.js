// THE SMITHY SAYS WHICH SIDE IS THE PRICE, AND "FORGE" IS AN ACTION.
//
// The modal's category is SMITHY (FORGE is the tab and button action), and
// both smithy offers caption the price "You give", which showOfferModal
// renders in place of the "for" row so the paying side is explicit.
//
// app.js needs Phaser, so this is pinned as source text (the MODAL_KINDS row
// and showOfferModal itself in modal_shell.js).

(function () {
const app = SCENE_SRC;

test('smithy: the modal category is Smithy, so Forge names only the action', () => {
  const m = SCENE_SRC.match(/\n  forge:\s*\{ icon: '🔨', label: '([^']+)'[,\s}]/);
  assert.truthy(m, 'MODAL_KINDS.forge row');
  assert.eq(m[1], 'Smithy', 'category label');
  // The key stays `forge` — every call site and tools/modal_audit.js pin it.
  // Neither offer carries a flavour title: the chip and the tab say it.
  assert.truthy(/kind: 'forge',\n      cancelLabel: 'Leave',\n      get: first\.get,/.test(app), 'smelt offer still keys forge');
  assert.truthy(/kind: 'forge',\n      cancelLabel: 'Later',\n      get: smithyPreviewHTML\(iconHtml, name\),/.test(app), 'forge offer still keys forge');
});

test('smithy: showOfferModal renders getLabel / costLabel captions, costLabel replacing the "for" row', () => {
  assert.truthy(/showOfferModal\(\{[^}]*forLabel = 'for', getLabel, costLabel, kind, kindLabel, kindIcon, art, fullscreen = false, choices, choice = null, pickHint = 'Tap one to see what it does' \}\)/.test(SCENE_SRC),
    'the params exist');
  assert.truthy(/if \(getLabel\) box\.appendChild\(mkCaption\(getLabel\)\);\n    const getDiv/.test(SCENE_SRC),
    'the receive caption sits directly above the get line');
  // (Priced choice cards — the wreck's build pick — skip the caption first:
  // their one cost line is the caption; see showOfferModal's `priced`.)
  assert.truthy(/if \(hasCost\) \{\n      if \(priced\) \{\n[^}]*\} else if \(costLabel\) \{\n        box\.appendChild\(mkCaption\(costLabel\)\);\n      \} else \{\n        const forDiv/.test(SCENE_SRC),
    'the give caption stands in for the "for" row, never beside it');
});

// The received item is a big picture over its name (smithyPreviewHTML), so a
// "You receive" caption over it was clutter; the price keeps its caption.
test('smithy: both the Forge and the Smelt offer caption the price', () => {
  const smelt = app.match(/acceptLabel: 'Smelt',\n\s*costLabel: 'You give',/);
  const forge = app.match(/acceptLabel: 'Forge',\n\s*costLabel: 'You give',/);
  assert.truthy(smelt, 'smelt offer captions');
  assert.truthy(forge, 'forge offer captions');
});
})();
