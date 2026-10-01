(function () {
  const T0 = Date.UTC(2026, 8, 30, 12);
  function withScene(fn) {
    const key = WorldGen.tileKey(0, 0), old = WorldGen.tileCache.get(key), realNow = Date.now;
    let wall = T0;
    Date.now = () => wall;
    const entry = { creatures: [] };
    WorldGen.tileCache.set(key, entry);
    const scene = {
      save: { money: 100, caught: [] }, cellM: 7,
      startWorldM: { x: 0, y: 0 }, playerM: { x: 7, y: 7 },
      playerToWorldCell: () => ({ tx: 0, ty: 0 }), flashAtWorld() {},
    };
    try { fn(scene, entry, ms => { wall += ms; }); }
    finally {
      Date.now = realNow;
      if (old) WorldGen.tileCache.set(key, old); else WorldGen.tileCache.delete(key);
    }
  }
  test('companions: mercenary uses the existing summoned hunter and combat stats', () => {
    assert.truthy(SpriteLayout.isSummoned('mercenary'));
    assert.truthy(SpriteLayout.creatureFollows('mercenary'));
    assert.truthy(huntsPrey('mercenary', { kind: 'slime', id: 'enemy' }));
    assert.falsy(huntsPrey('mercenary', { kind: 'dog', id: 'released_dog' }));
    assert.falsy(Combat.isEnemy({ kind: 'mercenary' }));
    assert.eq(Combat.creatureMaxHp('mercenary'), Combat.creatureMaxHp('goblin'));
    assert.eq(Combat.petBlow({ kind: 'mercenary' }), Combat.enemyBlow('goblin'));
    assert.eq(SpriteLayout.CREATURE_BEHAVIOUR.mercenary.stepMs, EnemyRoster.get('goblin').damageIntervalSeconds * 1000);
    assert.eq(Companions.KINDS.mercenary.durationMs, 24 * 60 * 60 * 1000);
    assert.eq(Companions.KINDS.mercenary.hireCost, 50);
  });
  test('companions: paid hire is singular and survives reload, tile loss and expiry', () => withScene((s, entry, advance) => {
    assert.truthy(Companions.hire(s, 'mercenary'));
    const first = s._mercenary;
    assert.truthy(first);
    assert.eq(s.save.money, 50);
    assert.falsy(Companions.hire(s, 'mercenary'));
    Companions.tickAll(s);
    assert.eq(s._mercenary, first);
    first._hp = 12;
    Companions.tickAll(s);
    assert.eq(s.save.companionState.mercenary.hp, 12);
    entry.creatures = [];
    s._mercenary = null;
    const saved = JSON.parse(JSON.stringify(s.save));
    s.save = saved;
    Companions.tickAll(s);
    assert.eq(Combat.hp(s._mercenary), 12, 'reload keeps wounds');
    const second = s._mercenary;
    second.x = 10000;
    Companions.tickAll(s);
    assert.truthy(s._mercenary !== second, 'out-of-range companion returns');
    assert.includes(s.save.caught, second.id);
    assert.eq(Combat.hp(s._mercenary), 12, 'return is not free healing');
    advance(Companions.KINDS.mercenary.durationMs);
    Companions.tickAll(s);
    assert.eq(s._mercenary, null);
    assert.falsy(Companions.active(s.save, 'mercenary'));
  }));
  test('companions: mercenary recovers like a pet; the raven still ends when spent', () => withScene((s, entry, advance) => {
    Companions.hire(s, 'mercenary');
    s._mercenary._hp = 0; s._mercenary._spent = true;
    Companions.tickAll(s);
    assert.eq(s._mercenary, null);
    assert.truthy(Companions.active(s.save, 'mercenary'));
    Companions.tickAll(s);
    assert.eq(s._mercenary, null, 'waits through recovery');
    advance(Companions.RECOVERY_MS);
    Companions.tickAll(s);
    assert.eq(Combat.hp(s._mercenary), Combat.creatureMaxHp('mercenary'));
    s.save.spiritRavenUntil = Date.now() + SPIRIT_RAVEN_MS;
    Companions.tickAll(s);
    assert.truthy(s._spiritRaven);
    assert.truthy(s._mercenary, 'both kinds coexist');
    s._spiritRaven._spent = true;
    Companions.tickAll(s);
    assert.eq(s._spiritRaven, null);
    assert.eq(s.save.spiritRavenUntil, 0);
  }));
  test('companions: insufficient funds or a loading tile never duplicates charges or creatures', () => withScene((s, entry) => {
    s.save.money = 49;
    assert.falsy(Companions.hire(s, 'mercenary'));
    assert.eq(s.save.money, 49);
    assert.falsy(s.save.mercenaryUntil);
    delete entry.creatures;
    s.save.money = 50;
    assert.truthy(Companions.hire(s, 'mercenary'));
    assert.eq(s.save.money, 0);
    assert.falsy(s._mercenary);
    entry.creatures = [];
    Companions.tickAll(s);
    assert.truthy(s._mercenary, 'contract spawns once tile finishes loading');
    assert.eq(entry.creatures.length, 1);
  }));
})();
