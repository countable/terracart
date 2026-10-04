(function () {
  const NOW = Date.UTC(2026, 9, 4), TX = 9871, TY = 9872;
  function withCoins(fn) {
    const realNow = Date.now, keys = [], previous = [];
    Date.now = () => NOW;
    for (const x of [TX, TX + 1]) {
      const key = WorldGen.tileKey(x, TY);
      keys.push(key); previous.push(WorldGen.tileCache.get(key));
      WorldGen.tileCache.set(key, { creatures: [], coinDrops: [] });
    }
    const scene = {
      save: { money: 10, energy: 100, inv: [], relics: {}, caught: [] }, cellM: 5,
      startWorldM: { x: TX * 1000, y: TY * 1000 }, playerM: { x: 999, y: 50 },
      playerToWorldCell: () => ({ tx: TX, ty: TY }),
      flashes: [], flash(text) { this.flashes.push(text); },
      updateMoneyDOM() { this.moneyUpdated = true; },
    };
    const entry = WorldGen.tileCache.get(keys[1]);
    const coin = (id, dx = 0, extra = {}) => ({ kind: 'coindrop', id,
      x: scene.startWorldM.x + scene.playerM.x + dx,
      y: scene.startWorldM.y + scene.playerM.y, ...extra });
    try { fn(scene, entry, coin); }
    finally {
      Date.now = realNow;
      keys.forEach((key, i) => previous[i] ? WorldGen.tileCache.set(key, previous[i]) : WorldGen.tileCache.delete(key));
    }
  }
  test('ground coins: ring draws across tile edges, pays once and remembers seeded coins', () => withCoins((s, e, coin) => {
    s.save.inv.push({ id: 'coin_ring', count: 1 });
    const c = coin('seeded_coin', 12, { amount: 7, seeded: true });
    e.coinDrops.push(c, coin('too_far', 16), coin('expired', 1, { expiresAt: NOW }));
    tickGroundCoins(s, NOW);
    assert.lt(c.x, s.startWorldM.x + s.playerM.x + 12, 'visibly pulled toward player');
    assert.eq(s.save.money, 10, 'pays on arrival');
    for (let i = 1; i <= 5; i++) tickGroundCoins(s, NOW + i * 100);
    assert.eq(s.save.money, 17);
    assert.includes(s.save.foundTreasures, c.id);
    assert.eq(e.coinDrops.length, 2, 'distant and expired coins never paid');
    assert.truthy(s.moneyUpdated);
    e.coinDrops.push(coin(c.id, 0, { seeded: true, amount: 7 }));
    tickGroundCoins(s, NOW + 600);
    assert.eq(s.save.money, 17, 'a regenerated duplicate cannot pay again');
  }));
  test('ground coins: ring requires ownership, energy and on-foot speed', () => withCoins((s, e, coin) => {
    const c = coin('untouched', 8); e.coinDrops.push(c);
    tickGroundCoins(s, NOW);
    const x = c.x;
    s.save.inv.push({ id: 'coin_ring', count: 1 }); s.save.energy = 0;
    tickGroundCoins(s, NOW + 100);
    assert.eq(c.x, x);
    s.save.energy = 100; s.isTooFast = () => true;
    tickGroundCoins(s, NOW + 200);
    assert.eq(c.x, x);
    s.isTooFast = () => false;
    tickGroundCoins(s, NOW + 300);
    assert.lt(c.x, x);
    s.save.inv = [];
    const stopped = c.x;
    tickGroundCoins(s, NOW + 400);
    assert.eq(c.x, stopped, 'removing ring stops attraction');
  }));
  test('ground coins: mercenary keeps the full purse with one viewport remark per cooldown', () => withCoins((s, e, coin) => {
    s.save.mercenaryUntil = NOW + 10000;
    s._mercenary = { kind: 'mercenary', x: coin('p').x + 2, y: coin('p').y, _hp: 10 };
    s.save.inv.push({ id: 'coin_ring', count: 1 });
    e.coinDrops.push(coin('wage', 2, { amount: 9, seeded: true }), coin('single', 3));
    tickGroundCoins(s, NOW);
    assert.eq(s.save.money, 10, 'mercenary beats the ring to coins within his grasp');
    assert.eq(s.save.companionState.mercenary.coins, 10);
    assert.eq(JSON.parse(JSON.stringify(s.save)).companionState.mercenary.coins, 10, 'purse survives saving');
    assert.includes(s.save.foundTreasures, 'wage');
    assert.eq(s.flashes.join('|'), 'ooh, coins!');
    e.coinDrops.push(coin('more', 2));
    tickGroundCoins(s, NOW + 100);
    assert.eq(s.flashes.length, 1, 'nearby piles do not spam text');
    assert.eq(s.save.companionState.mercenary.coins, 11);
    e.coinDrops.push(coin('later', 2));
    tickGroundCoins(s, NOW + 3100);
    assert.eq(s.flashes.length, 2);
  }));
  test('ground coins: spent and expired mercenaries cannot pocket coins', () => withCoins((s, e, coin) => {
    s.save.mercenaryUntil = NOW + 10000;
    s._mercenary = { kind: 'mercenary', x: coin('p').x, y: coin('p').y, _hp: 10, _spent: true };
    e.coinDrops.push(coin('left'));
    tickGroundCoins(s, NOW);
    s._mercenary._spent = false; s.save.mercenaryUntil = NOW;
    tickGroundCoins(s, NOW + 100);
    assert.eq(e.coinDrops.length, 1);
    assert.falsy(s.save.companionState);
  }));
})();
