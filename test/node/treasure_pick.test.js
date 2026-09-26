// A dug-up X is a CHOICE: two finds, keep one — the road ladder's pick.
//
// The road ladder was the only "take your pick" in the game until Sep 2026.
// A buried X now opens the same dialog, through the same one lane
// (app.js _offerTreasurePick), rolled by the same "the two must differ" rule
// (Trail.rollChoices) from the pool an X always paid ('treasure:default').
// app.js can't load headlessly, so the wiring is pinned as source text.

const methodBody = (src, sig) => {
  const at = src.indexOf('\n  ' + sig);
  assert.gt(at, 0, 'found ' + sig);
  return src.slice(at, src.indexOf('\n  }\n', at));
};

test('treasure pick: digging an X routes to the pick, the old single roll is the fallback', () => {
  const src = INTERACT_SRC;
  assert.truthy(/save\.foundTreasures = \[\.\.\.found, tr\.id\];\s*\n[^\n]*\n\s*if \(typeof scene\.digTreasurePick === 'function'\) scene\.digTreasurePick\(sx, sy\);/.test(src),
    'the mark is spent BEFORE the pick opens (no reload re-roll), then the pick opens');
  assert.truthy(/else grantTreasureRoll\(scene, save, sx, sy, '✕', 'treasure:default', scene\.digTreasureOpts\?\.\(\)\);/.test(src),
    'a scene without the pick still pays the single roll (with the cave skew underground)');
});

test('treasure pick: the X rolls its own pool through Trail.rollChoices', () => {
  const body = methodBody(APP_JS_SRC, 'digTreasurePick(sx, sy) {');
  assert.truthy(/pickReward\('treasure:default', this\.save, undefined, opts\)/.test(body),
    'the pool an X has always paid (skewed underground by digTreasureOpts)');
  assert.truthy(/Trail\.rollChoices\(roll\)/.test(body), 'the two options must differ — the road\'s rule');
  assert.truthy(/isLowTierSeed\(r\.id\)\) r\.qty \+= LOW_TIER_SEED_QTY_BONUS/.test(body),
    'low-tier seeds keep the bulk bonus the single roll gave them');
  assert.truthy(/this\._offerTreasurePick\(\{/.test(body), 'and it opens the shared pick');
  assert.truthy(/kindIcon/.test(body), 'under the X it came out of, not the chest gem');
});

test('treasure pick: ONE pick lane — the road ladder and the X both open it', () => {
  const trail = methodBody(APP_JS_SRC, '_fireTrailPrize(n, onDismiss) {');
  assert.truthy(/this\._offerTreasurePick\(\{/.test(trail), 'the road ladder opens the shared pick');
  const pick = methodBody(APP_JS_SRC, '_offerTreasurePick({');
  assert.truthy(/const card = this\._claimTrailReward\(reward\);/.test(pick), 'paid only from the button');
  const n = (APP_JS_SRC.match(/actions: choices\.map\(/g) || []).length;
  assert.eq(n, 1, 'no second copy of the pick modal');
});

test('treasure pick: Trail.rollChoices gives two DIFFERENT finds or settles for fewer', () => {
  let i = 0;
  const seq = [{ kind: 'item', id: 'potato', qty: 1 }, { kind: 'item', id: 'potato', qty: 3 },
               { kind: 'gold', amount: 5 }];
  const got = Trail.rollChoices(() => seq[i++ % seq.length]);
  assert.eq(got.length, 2, 'two options');
  assert.falsy(Trail.rewardKey(got[0]) === Trail.rewardKey(got[1]), 'and they differ');
});
