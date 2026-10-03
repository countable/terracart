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

// ── The road pick shows what was KEPT ─────────────────────────────────────
// Take used to close the pick and flash the kept card as a toast — on the
// first road prize, the only word the player got of what they had taken.
// Now Take opens the kept reward as its own card under the same banner, and
// the prize queue (the caller's onDismiss) walks on when THAT card closes:
// draining on the pick's close would open the next ceremony on the same shell
// id and replace the card (makeModalShell drops a same-id dialog).
test('reward card: the road pick opens the kept gift as a card, and the queue waits for it', () => {
  const at = SCENE_SRC.indexOf('\n  _offerTreasurePick({');
  assert.gt(at, 0);
  const pick = SCENE_SRC.slice(at, SCENE_SRC.indexOf('\n  }\n', at));
  assert.truthy(/taken = reward;/.test(pick), 'Take remembers what was kept');
  assert.falsy(/flashLoot/.test(pick), 'no toast stands in for the card');
  assert.truthy(/_claimTrailReward\(reward, \{ deferBookRead: true \}\)/.test(pick), 'a book taken reads after the card');
  assert.truthy(/const done = \(\) => this\._revealPendingBookReads\(onDismiss\);/.test(pick),
    'the caller\'s onDismiss waits for the card (and any book read)');
  assert.truthy(/if \(!taken \|\| !this\.showRewardCard\(taken, \{ kind, header, art, kindIcon, sub: takenSub, onDismiss: done \}\)\) done\(\);/.test(pick),
    'the kept reward opens as a card under the pick\'s own banner; a pick closed without a take just walks on');
  const fa = SCENE_SRC.indexOf('_fireTrailPrize(n, onDismiss) {');
  const fire = SCENE_SRC.slice(fa, SCENE_SRC.indexOf('\n  _trailChoiceLabel', fa));
  assert.truthy(/takenSub: TRAIL_PRIZE_THANKS/.test(fire), 'the road\'s thanks line rides to the kept card');
  assert.eq((fire.match(/TRAIL_PRIZE_THANKS/g) || []).length, 3, 'one thanks line for all three shapes of the ceremony');
});

// ── The first vista's relic ───────────────────────────────────────────────
// Paid on the tap, shown as a card once the vista's story has been read (the
// card waits on the splash's dismiss); a save that has had the story gets the
// card at once. Its dismissal opens the looking-glass menu.
test('reward card: the first vista\'s relic is a card after the story, never a toast', () => {
  const realGrant = globalThis.grantTreasureRoll;
  globalThis.grantTreasureRoll = () => {};
  try {
    const vista = (save, over) => {
      const cards = [], loot = [], menus = [];
      const scene = makeScene({ save, flashLoot: (t) => loot.push(t),
        presentTelescopeMenu: () => menus.push(true),
        showRewardCard: (reward, extra) => { cards.push({ reward, extra }); return true; }, ...over });
      scene.save = save;
      runInteractable({ scene, save, sx: 0, sy: 0 }, { kind: 'vista_scope', id: 'scope_1_2_3_4', x: 0, y: 0 });
      return { cards, loot, menus };
    };
    // A new save: the story opens first, the card on its dismiss.
    let splash = null;
    const save = { relics: {}, coinBurstClaimed: {}, inv: [] };
    const a = vista(save, { _storySplashOnce(key, o) { splash = o; return true; } });
    assert.eq(save.relics[Scenic.FIRST_VISTA_SLOT].tier, 1, 'the relic is paid on the tap');
    assert.eq(a.cards.length, 0, 'but shown only once the story is read');
    assert.eq(typeof splash.onDismiss, 'function', 'the card waits on the story');
    splash.onDismiss();
    assert.eq(a.cards.length, 1, 'then the card');
    assert.eq(a.cards[0].reward.kind, 'relic');
    assert.eq(a.cards[0].reward.slot, Scenic.FIRST_VISTA_SLOT);
    assert.eq(a.cards[0].extra.art, Scenic.VISTA_STORY.story, 'under the vista\'s own painting');
    assert.eq(a.loot.filter((t) => /\u{1F52D}/u.test(t)).length, 0, 'no toast doubles the card');
    // A save that has had the story: the card at once.
    const save2 = { relics: {}, coinBurstClaimed: {}, inv: [] };
    const b = vista(save2, { _storySplashOnce() { return false; } });
    assert.eq(b.cards.length, 1, 'the card opens on the tap');
    assert.eq(save2.relics[Scenic.FIRST_VISTA_SLOT].tier, 1);
    assert.includes(a.cards[0].extra.sub, "You'll need this for all the things you'll find with this looking glass!");
    assert.eq(a.menus.length, 0);
    a.cards[0].extra.onDismiss();
    assert.eq(a.menus.length, 1, 'the menu follows the bag');
    // A scene without the card shell still reaches the menu.
    const save3 = { relics: {}, coinBurstClaimed: {}, inv: [] };
    const c = vista(save3, { showRewardCard: undefined, _storySplashOnce() { return false; } });
    assert.eq(c.cards.length, 0);
    assert.eq(c.menus.length, 1, 'no missing card can swallow the menu');
    // Once per save: a second vista shows nothing.
    const d = vista(save, { _storySplashOnce() { return false; } });
    assert.eq(d.cards.length, 0, 'no second relic card');
    assert.eq(d.menus.length, 1, 'later visits open the menu');
  } finally {
    globalThis.grantTreasureRoll = realGrant;
  }
});
