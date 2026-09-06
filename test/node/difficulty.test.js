// The two game modes (src/difficulty.js) and what the shipping code does with
// them. The how-to card asks a new save "Easy mode, enable tutorial" or "Hard
// mode, no tutorial"; every number that differs between the answers lives in
// Difficulty.PROFILES as a multiplier over the easy value, and each consumer
// reads it at the site that already owns the base number.
//
// What these tests pin, in order of how expensive it would be to lose:
//   1. EASY IS THE GAME AS IT WAS — every easy multiplier is exactly 1 and
//      every flag on, so nothing shipped before the modes existed moved.
//   2. Every consumer actually reads the table (prices, Home payout, enemy HP,
//      bounty, offline rest, the pest amnesty), and hard mode pushes each in
//      the direction the card promises: dearer to buy, poorer to sell, richer
//      to fight.
//   3. The save rules: a played pre-mode save is easy, a fresh one is unset
//      (so the card asks) and reads as easy meanwhile.
//
// One shared vm scope holds every *.test.js, so the fixture stays in an IIFE
// and every test that flips the active mode puts it back.

(function () {
  const withMode = (mode, fn) => {
    const prev = Difficulty.mode();
    Difficulty.setMode(mode);
    try { return fn(Difficulty.get()); } finally { Difficulty.setMode(prev); }
  };

  test('difficulty: easy is the identity — every multiplier 1, every flag on', () => {
    const e = Difficulty.PROFILES.easy;
    for (const [k, v] of Object.entries(e)) {
      if (/Mul$/.test(k)) assert.eq(v, 1, `easy.${k} is 1`);
    }
    assert.eq(e.offlineRestCapFrac, 1, 'a night away can refill to full');
    assert.eq(e.passOutLossFrac, 0.5, 'passing out costs half, as it always did');
    assert.eq(e.startingMoney, STARTING_MONEY, 'the easy purse IS items.js STARTING_MONEY');
    assert.truthy(e.tutorial && e.starterCrates && e.pestAmnesty, 'the guided opening is on');
  });

  test('difficulty: hard is harsher on every axis the card names', () => {
    const e = Difficulty.PROFILES.easy, h = Difficulty.PROFILES.hard;
    assert.falsy(h.tutorial, 'no tutorial');
    assert.falsy(h.starterCrates, 'no supply crates');
    assert.falsy(h.pestAmnesty, 'pests from minute one');
    assert.lt(h.startingMoney, e.startingMoney, 'thinner purse');
    assert.gt(h.buyMul, 1, 'dearer to buy');
    assert.lt(h.sellMul, 1, 'poorer to sell');
    assert.gt(h.bountyMul, 1, 'richer to fight');
    assert.gt(h.enemyHpMul, 1); assert.gt(h.enemyDmgMul, 1);
    assert.gt(h.monsterCountMul, 1); assert.gt(h.slimeCountMul, 1); assert.gt(h.eliteRateMul, 1);
    assert.gt(h.passOutLossFrac, e.passOutLossFrac);
    assert.lt(h.offlineRestCapFrac, 1);
    // The promise on the card: fighting out-earns farming. Coins per minute of
    // fighting scale by bounty × HP / HP (time) = bountyMul; farming by sellMul.
    assert.gt(h.bountyMul, h.sellMul, 'a kill gains more than a sale loses');
  });

  test('difficulty: the active mode defaults to easy and rejects junk', () => {
    assert.eq(Difficulty.mode(), 'easy');
    assert.eq(Difficulty.of({}).id, 'easy', 'an unset save reads as easy');
    assert.eq(Difficulty.of({ mode: 'hard' }).id, 'hard');
    assert.eq(Difficulty.of({ mode: 'nightmare' }).id, 'easy', 'an unknown mode is easy, not a crash');
    assert.eq(withMode('bogus', p => p.id), 'easy', 'setMode of junk pins easy');
    assert.eq(Difficulty.mode(), 'easy', 'and the fixture restored it');
  });

  test('difficulty: hard mode scales the trader markup and the stand price', () => {
    const easy = withMode('easy', () => buyMarkupRange({}));
    const hard = withMode('hard', () => buyMarkupRange({}));
    assert.eq(easy.lo, 1.2); assert.eq(easy.hi, 3.0);
    assert.inRange(hard.lo, 1.8 - 1e-9, 1.8 + 1e-9, 'hard lo = 1.2 × 1.5');
    assert.inRange(hard.hi, 4.5 - 1e-9, 4.5 + 1e-9, 'hard hi = 3.0 × 1.5');
    // The bow still closes the spread — onto 1.5× par rather than par.
    const maxed = withMode('hard', () => buyMarkupRange({ bow: { tier: 7 } }));
    assert.inRange(maxed.lo, 1.5 - 1e-9, 1.5 + 1e-9);
    assert.inRange(maxed.hi, 1.5 - 1e-9, 1.5 + 1e-9);
    const stallEasy = withMode('easy', () => ShopsMath.standPrice({ relics: {} }, 20));
    const stallHard = withMode('hard', () => ShopsMath.standPrice({ relics: {} }, 20));
    assert.eq(stallEasy, 15, 'easy stand: 20 × 0.75');
    assert.eq(stallHard, 23, 'hard stand: 20 × 0.75 × 1.5, ceiled');
  });

  test('difficulty: hard mode cuts what Home pays, and never below $1', () => {
    const easy = withMode('easy', () => trailerSellPrice(20, {}));
    const hard = withMode('hard', () => trailerSellPrice(20, {}));
    assert.eq(easy, 8, 'easy: 20 × 0.5 × 0.75 = 7.5 → 8');
    assert.eq(hard, 5, 'hard: 20 × 0.5 × 0.75 × 0.6 = 4.5 → 5');
    assert.eq(withMode('hard', () => trailerSellPrice(1, {})), 1, 'the $1 floor holds');
    // A stand on hard is still never a profit: its price stays above the payout.
    for (const v of [1, 4, 10, 37, 120]) {
      withMode('hard', () => {
        assert.gte(ShopsMath.standPrice({ relics: { sword: { tier: 7 } } }, v),
          trailerSellPrice(v, { sword: { tier: 7 } }), `no arbitrage at $${v}, maxed sword`);
      });
    }
  });

  test('difficulty: hard mode scales enemy HP — and only enemy HP', () => {
    const slimeEasy = withMode('easy', () => Combat.creatureMaxHp('slime'));
    const slimeHard = withMode('hard', () => Combat.creatureMaxHp('slime'));
    assert.eq(slimeEasy, 15, 'the surface slime baseline');
    assert.eq(slimeHard, Math.round(15 * 1.5), 'the hard-mode slime is 1.5× the pool');
    for (const k of Object.keys(MONSTERS)) {
      const e = withMode('easy', () => Combat.creatureMaxHp(k));
      const h = withMode('hard', () => Combat.creatureMaxHp(k));
      assert.eq(h, Math.round(e * 1.5), `${k} scales by enemyHpMul`);
    }
    // Game is not an enemy and keeps its fauna HP whatever the mode.
    for (const k of ['crow', 'deer', 'cat', 'dog']) {
      assert.eq(withMode('hard', () => Combat.creatureMaxHp(k)), Combat.FAUNA_HP[k], `${k} is game, not scaled`);
    }
  });

  test('difficulty: a hard-mode kill pays bountyMul on top of the HP scaling', () => {
    for (const k of Object.keys(MONSTERS)) {
      const e = withMode('easy', () => enemyBounty(k, 0));
      const h = withMode('hard', () => enemyBounty(k, 0));
      const hpH = withMode('hard', () => Combat.creatureMaxHp(k));
      assert.eq(h, Math.max(1, Math.round(hpH * ENEMY_COIN_PER_HP * 1.5)), `${k}: hard wage is HP × coin-per-HP × bountyMul`);
      assert.gt(h, e, `${k} pays more on hard`);
    }
    // The depth bonus is the same coin on both — it's a climb, not a wage.
    const eD = withMode('easy', () => enemyBounty('goblin', 6) - enemyBounty('goblin', 0));
    const hD = withMode('hard', () => enemyBounty('goblin', 6) - enemyBounty('goblin', 0));
    assert.eq(eD, hD, 'depth bonus untouched by the mode');
  });

  test('difficulty: hard mode caps a night away at half the bar, never drains', () => {
    const rested = () => ({ energy: 10, maxEnergy: 100, armor: {} });
    const e = rested();
    withMode('easy', () => Energy.applyOfflineRest(e, Energy.OFFLINE_FULL_REST_MS * 2));
    assert.eq(e.energy, 100, 'easy: a long night refills to full');
    const h = rested();
    withMode('hard', () => Energy.applyOfflineRest(h, Energy.OFFLINE_FULL_REST_MS * 2));
    assert.eq(h.energy, 50, 'hard: the same night stops at half');
    const short = rested();
    withMode('hard', () => Energy.applyOfflineRest(short, Energy.OFFLINE_FULL_REST_MS * 0.2));
    assert.eq(short.energy, 30, 'a short rest under the cap is pro-rated as before');
    const full = { energy: 90, maxEnergy: 100, armor: {} };
    const gained = withMode('hard', () => Energy.applyOfflineRest(full, Energy.OFFLINE_FULL_REST_MS));
    assert.eq(full.energy, 90, 'a save above the cap keeps what it had');
    assert.eq(gained, 0, 'and reports no gain');
  });

  test('difficulty: hard mode has no pest amnesty', () => {
    // The lifted _pestFreeZone (pest_amnesty.test.js drives it the same way).
    const scene = {
      cellM: 7, tileEdgeM: 220 * 7,
      startWorldM: { x: 100 * 7, y: 100 * 7 },
      save: { hasHarvested: false },
    };
    assert.truthy(withMode('easy', () => pestFreeZone.call(scene, 0, 0)), 'easy: the grace runs until the first harvest');
    assert.eq(withMode('hard', () => pestFreeZone.call(scene, 0, 0)), null, 'hard: no grace, ever');
    assert.truthy(CROW_PUMP_GATE_SRC.includes('pestAmnesty'), 'the crow pump reads the same flag');
  });

  test('difficulty: the save rules — veterans are easy, a fresh save is asked', () => {
    const veteran = { tilled: ['1,1'] };
    SaveMigrate.migrate(veteran);
    assert.eq(veteran.mode, 'easy', 'a played pre-mode save was played with the tutorial');
    const fresh = {};
    SaveMigrate.migrate(fresh);
    assert.eq(fresh.mode, undefined, 'a fresh save is left for the card to ask');
    assert.eq(Difficulty.of(fresh).id, 'easy', 'and reads as easy until it does');
    const hard = { tilled: ['1,1'], mode: 'hard' };
    SaveMigrate.migrate(hard);
    assert.eq(hard.mode, 'hard', 'a chosen mode is never overwritten');
  });

  test('difficulty: the card carries the two CTAs and the choice hook (source pin)', () => {
    const html = INDEX_HTML_SRC, app = APP_JS_SRC;   // run.js exposes both as text
    const easyAt = html.indexOf('id="howto-easy"'), hardAt = html.indexOf('id="howto-hard"');
    assert.gt(easyAt, 0, 'the easy CTA exists'); assert.gt(hardAt, 0, 'the hard CTA exists');
    assert.lt(easyAt, hardAt, 'easy — the tutorial — is the top CTA');
    assert.truthy(/id="howto-easy"[\s\S]{0,200}Easy mode[\s\S]{0,200}Enable tutorial/.test(html), 'easy names the tutorial');
    assert.truthy(/id="howto-hard"[\s\S]{0,200}Hard mode[\s\S]{0,200}No tutorial/.test(html), 'hard says no tutorial');
    assert.truthy(html.includes('src/difficulty.js'), 'difficulty.js is loaded by the page');
    assert.truthy(html.includes('window.__chooseMode?.(mode)'), 'a CTA carries its mode to app.js');
    assert.truthy(app.includes('window.__chooseMode = (mode) => this.chooseMode(mode)'), 'app.js answers it');
    assert.truthy(app.includes('Quests.starterSkipAll(this.save)') && /chooseMode\(mode\) \{[\s\S]*?Quests\.starterSkipAll/.test(app),
      'hard mode retires the starter ladder for good');
    assert.truthy(/_stripStarterCrates\(entry\)/.test(app), 'and sweeps the supply crates');
  });
})();
