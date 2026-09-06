// The two game modes (src/difficulty.js) and what the shipping code does with
// them. The how-to card asks a new save "Easy mode, enable tutorial" or "Hard
// mode, no tutorial"; every number that differs between the answers lives in
// Difficulty.PROFILES as a multiplier over the easy value, and each consumer
// reads it at the site that already owns the base number.
//
// What these tests pin, in order of how expensive it would be to lose:
//   1. EASY IS THE GAME AS IT WAS — every easy multiplier is exactly 1 and
//      every flag on, so nothing shipped before the modes existed moved.
//   2. Every consumer actually reads the table (trader prices, Home payout,
//      enemy HP, the pest amnesty), and hard mode pushes each in the direction
//      the card promises: dearer to buy, poorer to sell, tougher to fight —
//      while the things the mode does NOT touch (stands, the elite rate, the
//      pass-out loss, a night's rest) stay put.
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
    assert.gt(h.enemyHpMul, 1); assert.gt(h.enemyDmgMul, 1);
    assert.gt(h.monsterCountMul, 1); assert.gt(h.slimeCountMul, 1);
    // What the mode deliberately leaves alone has no knob at all.
    for (const k of ['bountyMul', 'eliteRateMul', 'passOutLossFrac', 'offlineRestCapFrac']) {
      assert.eq(k in h, false, `${k} is not a mode difference`);
    }
  });

  test('difficulty: the active mode defaults to easy and rejects junk', () => {
    assert.eq(Difficulty.mode(), 'easy');
    assert.eq(Difficulty.of({}).id, 'easy', 'an unset save reads as easy');
    assert.eq(Difficulty.of({ mode: 'hard' }).id, 'hard');
    assert.eq(Difficulty.of({ mode: 'nightmare' }).id, 'easy', 'an unknown mode is easy, not a crash');
    assert.eq(withMode('bogus', p => p.id), 'easy', 'setMode of junk pins easy');
    assert.eq(Difficulty.mode(), 'easy', 'and the fixture restored it');
  });

  test('difficulty: hard mode scales the trader markup — and leaves the stands alone', () => {
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
    assert.eq(stallHard, 15, 'hard stand: the same — a stand is not a markup');
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
    assert.eq(slimeEasy, Combat.FAUNA_HP.slime, 'the surface slime pool, unscaled');
    assert.eq(slimeHard, Math.round(Combat.FAUNA_HP.slime * 1.5),
      'the hard-mode slime is 1.5× the pool');
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

  test('difficulty: a hard-mode kill pays for its HP, by the one per-HP rule', () => {
    for (const k of Object.keys(MONSTERS)) {
      const e = withMode('easy', () => enemyBounty(k, 0));
      const h = withMode('hard', () => enemyBounty(k, 0));
      const hpH = withMode('hard', () => Combat.creatureMaxHp(k));
      assert.eq(h, Math.max(1, Math.round(hpH * ENEMY_COIN_PER_HP)), `${k}: the wage is still HP × coin-per-HP`);
      assert.gte(h, e, `${k} never pays less on hard — the pool is bigger`);
    }
    // The depth bonus is the same coin on both — it's a climb, not a wage.
    const eD = withMode('easy', () => enemyBounty('goblin', 6) - enemyBounty('goblin', 0));
    const hD = withMode('hard', () => enemyBounty('goblin', 6) - enemyBounty('goblin', 0));
    assert.eq(eD, hD, 'depth bonus untouched by the mode');
  });

  test('difficulty: a night away rests the same in both modes', () => {
    const rested = () => ({ energy: 10, maxEnergy: 100, armor: {} });
    const e = rested(), h = rested();
    withMode('easy', () => Energy.applyOfflineRest(e, Energy.OFFLINE_FULL_REST_MS * 2));
    withMode('hard', () => Energy.applyOfflineRest(h, Energy.OFFLINE_FULL_REST_MS * 2));
    assert.eq(e.energy, 100); assert.eq(h.energy, 100, 'hard: the same night, the same full bar');
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
