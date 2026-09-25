// The jackpot fanfare: over a dialog it is set in the DOM, large, above the
// dialog (the canvas toast would sit hidden behind it); a treasure dialog that
// offers a CHOICE never fires it; the slot machine's two jackpots do.

(function () {
const app = APP_JS_SRC;
const body = (name) => {
  const m = app.match(new RegExp(`\\n  ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n  \\}\\n`));
  assert.truthy(m, `${name} exists`);
  return m[1];
};

test('jackpot fanfare: over an open dialog it goes to the DOM, above it', () => {
  const fj = body('flashJackpot');
  assert.truthy(/if \(this\._dialogOpen\(\)\) \{ this\._domFanfare\(headline/.test(fj),
    'an open dialog routes the fanfare to the DOM');
  const dom = body('_domFanfare');
  assert.truthy(/z-index:300/.test(dom), 'stacked above the dialogs (z-index 50)');
  assert.truthy(/pointer-events:none/.test(dom), 'and never takes a tap meant for the dialog');
  assert.truthy(/DOM_FANFARE_PX/.test(dom), 'at its own, larger size');
  assert.truthy(/const DOM_FANFARE_PX = (\d+);/.test(app) && +app.match(/const DOM_FANFARE_PX = (\d+);/)[1] > 26,
    'larger than the canvas fanfare tier (26px)');
  assert.truthy(/this\._reducedMotion/.test(dom), 'reduced motion keeps only the fade');
});

test('jackpot fanfare: a treasure dialog with more than one choice fires none', () => {
  const pick = body('_offerTreasurePick');
  assert.falsy(/flashJackpot/.test(pick), 'no fanfare on a pick among several finds');
});

test('jackpot fanfare: the slot machine fires it for the jackpot and for three stars', () => {
  assert.truthy(/if \(p\.jackpot\) this\.flashJackpot\(1, '✨ JACKPOT ✨'\);/.test(app), 'the jackpot prize');
  assert.truthy(/this\._payStarJackpot\(\);\s*\n\s*this\.flashJackpot\(1, '✨ THREE STARS ✨'\);/.test(app), 'three stars');
});
})();
