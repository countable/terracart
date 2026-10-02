// A single reward that is EARNED (a neighbour's gift, an elite's drop) is
// shown as a card — the item's sprite, name and amount on the chest shell —
// not read off a toast: app.js showRewardCard, and the `ceremony` option of
// interact.js grantTreasureRoll that routes a roll through it.

test('reward card: showRewardCard frames the one reward card on the chest shell', () => {
  const at = SCENE_SRC.indexOf('\n  showRewardCard(reward, extra = {}) {');
  assert.gt(at, 0, 'the method exists');
  const body = SCENE_SRC.slice(at, SCENE_SRC.indexOf('\n  }\n', at));
  assert.truthy(/const card = this\._trailRewardCard\(reward\);/.test(body), 'one card builder for every reward');
  assert.truthy(/this\.showChestRewardModal\(\{ \.\.\.card, \.\.\.extra, sub \}\);/.test(body),
    'the caller frames it, the card fills it');
  assert.truthy(/const sub = \[extra\.sub, own\]\.filter\(Boolean\)\.join\(' '\) \|\| undefined;/.test(body),
    'a relic\'s "equipped" follows the framing line rather than being dropped');
});

function rollScene(save) {
  const calls = { cards: [], toasts: [], jackpots: 0 };
  const scene = Object.assign(makeScene(), {
    save,
    addToInv: (id, n) => Inventory.add(save, id, n).accepted,
    flashLoot: (...a) => calls.toasts.push(a),
    flashJackpot: () => { calls.jackpots++; },
    showRewardCard: (reward, extra) => { calls.cards.push({ reward, extra }); return true; },
    coinIconEl: () => null, markRelicsDirty() {},
  });
  return { scene, calls };
}

test('reward card: a roll with a ceremony shows the card and no toast; without, the toast as before', () => {
  for (const ceremony of [{ kind: 'treasure', header: 'Elite slain', sub: 'Yours.' }, null]) {
    let shown = 0, toasted = 0;
    for (let i = 0; i < 30; i++) {
      const save = { inv: [], money: 0, relics: {}, armor: {}, caught: [] };
      const { scene, calls } = rollScene(save);
      grantTreasureRoll(scene, save, 0, 0, '💀', 'treasure:default', ceremony ? { ceremony } : undefined);
      if (calls.cards.length) {
        shown++;
        assert.eq(calls.cards.length, 1);
        assert.eq(calls.cards[0].extra.header, 'Elite slain', 'the caller\'s framing rides along');
        assert.truthy(['item', 'gold', 'relic', 'armor'].includes(calls.cards[0].reward.kind));
        // Shown is paid: an item is in the bag or coins in the purse or gear worn.
        const r = calls.cards[0].reward;
        if (r.kind === 'item') assert.gte(Inventory.count(save, r.id), 1, `${r.id} banked`);
        if (r.kind === 'gold') assert.gte(save.money, r.amount);
        assert.eq(calls.toasts.filter(t => /→/.test(t[0])).length, 0, 'no toast doubles the card');
      }
      if (calls.toasts.length) toasted++;
    }
    if (ceremony) { assert.eq(shown, 30, 'every ceremony roll shows a card'); }
    else { assert.eq(shown, 0, 'no ceremony, no card'); assert.eq(toasted, 30, 'the toast as before'); }
  }
});

test('reward card: the ceremony key never reaches the roll', () => {
  const grant = INTERACT_SRC.slice(INTERACT_SRC.indexOf('function grantTreasureRoll('));
  assert.truthy(/const \{ ceremony, \.\.\.rollOpts \} = opts \|\| \{\};/.test(grant), 'ceremony is peeled off');
  assert.truthy(/pickReward\(contextKey, save, undefined, opts \? rollOpts : undefined\)/.test(grant), 'the roll sees the rest');
});
