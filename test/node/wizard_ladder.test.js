// The wizard tower sells a LADDER, one rung a visit, climbed in order:
//
//   1. INNER LIGHT  ×6 — +0.5 cell of reach
//   2. FULL MEASURE ×3 — QUANTITY luck (rarity.js qtyLuck)
//   3. KEEN EYE     ×7 — the RING, i.e. TIER luck (rarity.js ringLuck)
//
// Until Sep 2026 there was one rung: the Inner Light, which bought reach AND
// forged the Ring in a single purchase, while quantity luck was a bonus on the
// AMULET. Splitting them is what puts the new Full Measure BETWEEN the two
// kinds of luck instead of beside them.
//
// app.js needs Phaser and can't load headlessly, so the ladder is pinned as
// source text; the arithmetic it hands out is tested for real in loot.test.js.

(function () {
const app = APP_JS_SRC;
const ladder = app.slice(app.indexOf('  wizardLadder() {'), app.indexOf('  wizardQtyLuckAt(n) {'));

test('wizard: the ladder exists and is climbed light → measure → eye', () => {
  assert.truthy(ladder.length > 0, 'found wizardLadder()');
  const keys = [...ladder.matchAll(/key: '([a-z]+)'/g)].map((m) => m[1]);
  assert.eq(keys.join(','), 'light,measure,eye',
    'the quantity rung sits BETWEEN the reach rung and the ring rung');
  // The offer is always the first unfinished rung — that is what makes the
  // order above load-bearing rather than decorative.
  assert.truthy(/wizardNextRung\(\)\s*\{\s*\n\s*return this\.wizardLadder\(\)\.find\(\(r\) => r\.have < r\.max\)/.test(app),
    'the wizard offers the first rung not yet finished');
});

test('wizard: each rung reads and writes its own save field', () => {
  assert.truthy(/have: save\.reachUpgrades \?\? 0/.test(ladder), 'light reads save.reachUpgrades');
  assert.truthy(/save\.reachUpgrades = n;/.test(ladder), 'and writes it');
  assert.truthy(/have: save\.qtyUpgrades \?\? 0/.test(ladder), 'measure reads save.qtyUpgrades');
  assert.truthy(/save\.qtyUpgrades = n;/.test(ladder), 'and writes it');
  assert.truthy(/have: save\.relics\?\.ring\?\.tier \?\? 0/.test(ladder), 'eye reads the ring tier');
  assert.truthy(/this\._equipGear\('relic', 'ring', n\)/.test(ladder), 'and grants the ring');
});

test('wizard: reach no longer forges the Ring — that is its own rung', () => {
  // The fused purchase is the thing being undone. syncInnerLightRing was the
  // single point that kept the ring tier tracking reachUpgrades; if it comes
  // back, the Keen Eye rung is being paid for by the Inner Light again.
  assert.falsy(/syncInnerLightRing/.test(app), 'the reach → ring sync is gone');
  assert.falsy(/presentInnerLightOffer/.test(app), 'and the single-offer entry point with it');
  assert.truthy(/this\.presentWizardOffer\(sx, sy, recordDeal\);/.test(app),
    'the wizard tap goes to the ladder');
});

test('wizard: the modal prints the number the loot roll will actually pay', () => {
  // The roadOverlayWidthM discipline: one source for what is advertised and
  // what is rolled, so a rung can't promise a percentage the picker ignores.
  assert.truthy(/qtyLuck\(\{ qtyUpgrades: n \}\)/.test(app),
    'the rung asks rarity.js qtyLuck for its percentage');
  assert.falsy(/qtyLuckMaxP\s*\*/.test(app), 'app.js never re-derives the ladder itself');
  assert.truthy(/RARITY_TUNING\.qtyLuckLevels/.test(app),
    'and the rung count is rarity.js\'s, not a second copy');
});

test('wizard: every rung costs the same badges, and a stale modal cannot cheat', () => {
  assert.truthy(/WIZARD_UPGRADE_COST = 5;/.test(app), 'five Discovery a rung');
  const accept = app.slice(app.indexOf('  presentWizardOffer(sx, sy, recordDeal) {'),
                           app.indexOf('  // ─── Reach / Inner Light cap'));
  assert.truthy(/Inventory\.count\(this\.save, 'discovery'\) < cost/.test(accept),
    'the badge count is re-read on accept, not trusted from the modal');
  assert.truthy(/live\.key !== rung\.key \|\| live\.have !== rung\.have/.test(accept),
    'and so is the rung, so a modal left open cannot grant a step already climbed');
  assert.truthy(accept.indexOf("Inventory.remove(this.save, 'discovery', cost)") > accept.indexOf('live.key !== rung.key'),
    'the badges are spent AFTER both re-reads');
});

test('wizard: the ring stays the tower\'s exclusive gift', () => {
  assert.truthy(/if \(slot === 'ring'\) continue;/.test(GEAR_JS_SRC),
    'no shop, smithy or castle offer may roll a Ring');
});
})();
