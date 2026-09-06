// THE SMITHY SAYS WHICH SIDE IS THE PRICE, AND "FORGE" IS AN ACTION.
//
// The blacksmith dialog used one word three times: the modal's category
// header read FORGE (over the Smelt tab too), the tab read Forge, and the
// button read Forge. And the trade itself — gear for bars, or on the Smelt
// tab bars for bars — was two equal lines with a lone "for" between them, so
// which line you were paying was a guess. The category is SMITHY now, and
// both smithy offers caption their halves "You receive" / "You give", which
// showOfferModal renders in place of the "for" row.
//
// app.js needs Phaser, so this is pinned as source text.

(function () {
const app = APP_JS_SRC;

test('smithy: the modal category is Smithy, so Forge names only the action', () => {
  const m = app.match(/\n  forge:\s*\{ icon: '🔨', label: '([^']+)'\s*\}/);
  assert.truthy(m, 'MODAL_KINDS.forge row');
  assert.eq(m[1], 'Smithy', 'category label');
  // The key stays `forge` — every call site and tools/modal_audit.js pin it.
  assert.truthy(/kind: 'forge',\n      title: 'The blacksmith stokes the crucible:'/.test(app), 'smelt offer still keys forge');
  assert.truthy(/kind: 'forge',\n      title: this\.buildingFlavorTitle\(house, 'forge'\)/.test(app), 'forge offer still keys forge');
});

test('smithy: showOfferModal renders getLabel / costLabel captions, costLabel replacing the "for" row', () => {
  assert.truthy(/showOfferModal\(\{[^}]*forLabel = 'for', getLabel, costLabel, kind, kindLabel \}\)/.test(app),
    'the params exist');
  assert.truthy(/if \(getLabel\) box\.appendChild\(mkCaption\(getLabel\)\);\n    const getDiv/.test(app),
    'the receive caption sits directly above the get line');
  assert.truthy(/if \(hasCost\) \{\n      if \(costLabel\) \{\n        box\.appendChild\(mkCaption\(costLabel\)\);\n      \} else \{\n        const forDiv/.test(app),
    'the give caption stands in for the "for" row, never beside it');
});

test('smithy: both the Forge and the Smelt offer caption their halves', () => {
  const smelt = app.match(/acceptLabel: 'Smelt',\n\s*getLabel: 'You receive', costLabel: 'You give',/);
  const forge = app.match(/acceptLabel: 'Forge',\n\s*getLabel: 'You receive', costLabel: 'You give',/);
  assert.truthy(smelt, 'smelt offer captions');
  assert.truthy(forge, 'forge offer captions');
});
})();
