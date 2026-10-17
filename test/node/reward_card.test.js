// A single reward that is EARNED (a neighbour's gift, an elite's drop) is
// shown as a card — the item's sprite, name and amount on the chest shell —
// not read off a toast: app.js showRewardCard, and the `ceremony` option of
// interact.js grantTreasureRoll that routes a roll through it.

test('reward card: showRewardCard frames the one reward card on the chest shell', () => {
  const at = SCENE_SRC.indexOf('\n  showRewardCard(reward, extra = {}) {');
  assert.gt(at, 0, 'the method exists');
  const body = SCENE_SRC.slice(at, SCENE_SRC.indexOf('\n  }\n', at));
  assert.truthy(/return Rewards\.present\(this, \{ \.\.\.reward, jackpot: 0 \}, \{ extra \}\);/.test(body), 'one presenter for every reward (Rewards.present — no fanfare of its own)');
  const present = Rewards.present.toString();
  assert.truthy(/scene\.showChestRewardModal\(\{ \.\.\.c, \.\.\.extra, sub \}\);/.test(present),
    'the caller frames it, the card fills it');
  assert.truthy(/const sub = \[extra\.sub, own\]\.filter\(Boolean\)\.join\(' '\) \|\| undefined;/.test(present),
    'a relic\'s "equipped" follows the framing line rather than being dropped');
  assert.falsy(/_trailRewardCard\(reward, iconPx/.test(SCENE_SRC), 'the scene keeps no card builder of its own');
});

function rollScene(save) {
  const calls = { cards: [], toasts: [], jackpots: 0 };
  const scene = Object.assign(makeScene(), {
    save,
    addToInv: (id, n) => Inventory.add(save, id, n).accepted,
    flashLoot: (...a) => calls.toasts.push(a),
    flashJackpot: () => { calls.jackpots++; },
    // The card lands on the chest shell (Rewards.present → showChestRewardModal).
    showChestRewardModal: (card) => { calls.cards.push({ reward: calls.lastReward, extra: card }); },
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
      const realPick = globalThis.pickReward;
      globalThis.pickReward = (...a) => (calls.lastReward = realPick(...a));
      try { grantTreasureRoll(scene, save, 0, 0, '💀', 'treasure:default', ceremony ? { ceremony } : undefined); }
      finally { globalThis.pickReward = realPick; }
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
// Take opens the kept reward as its own card under the same banner, and
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
  assert.truthy(/if \(!taken \|\| !this\.showRewardCard\(taken, \{ kind, header, art, kindIcon, onDismiss: done \}\)\) done\(\);/.test(pick),
    'the kept reward opens as a card under the pick\'s own banner, with no line of its own; a pick closed without a take just walks on');
  assert.falsy(/takenSub|sub:/.test(pick), 'no thanks line under the kept gift (owner, Oct 2026)');
  const fa = SCENE_SRC.indexOf('_fireTrailPrize(n, onDismiss) {');
  const fire = SCENE_SRC.slice(fa, SCENE_SRC.indexOf('\n  _trailChoiceLabel', fa));
  assert.falsy(/takenSub/.test(fire), 'the road\'s thanks line does not ride to the kept card');
  assert.eq((fire.match(/TRAIL_PRIZE_THANKS/g) || []).length, 2, 'the thanks line only under the one-step ceremonies');
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
        // The card lands on the chest shell (Rewards.present); the reward's
        // shape is read back off the relic it equipped.
        showChestRewardModal: (card) => { cards.push({ reward: { kind: 'relic', slot: Scenic.FIRST_VISTA_SLOT }, extra: card }); }, ...over });
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
    const c = vista(save3, { showChestRewardModal: undefined, _storySplashOnce() { return false; } });
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

test('reward card: the card carries what the reward IS, and the ceremony splits to show it', () => {
  const fxId = Object.keys(ITEM_EFFECTS).find((id) => ITEM_BY_ID[id]);
  const scene = makeScene();
  assert.eq(Rewards.card(scene, { kind: 'item', id: fxId, qty: 1 }).desc, ITEM_EFFECTS[fxId], 'an item: its ITEM_EFFECTS line');
  assert.eq(Rewards.card(scene, { kind: 'relic', slot: 'axe', tier: 3 }).desc, RELIC_DEFS.axe.blurb, 'gear: its def blurb');
  assert.eq(Rewards.card(scene, { kind: 'gold', amount: 5 }).desc, undefined, 'gold says nothing');
  const at = MODAL_SHELL_SRC.indexOf('  showChestRewardModal({');
  const body = MODAL_SHELL_SRC.slice(at, MODAL_SHELL_SRC.indexOf('\n  }\n', at));
  assert.truthy(/box\.innerHTML = desc\s*\n?\s*\? '<div class="reward-split"/.test(body), 'a desc splits the body');
  assert.truthy(/<div style="flex:1 1 0;min-width:0">\$\{found\}<\/div>` \+\s*\n\s*`<div class="reward-desc"/.test(body), 'found on the left, desc on the right');
  assert.truthy(/: found;/.test(body), 'no desc keeps the single column');
});
