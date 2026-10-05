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
  test('companions: pets follow without a timer unless released within two Home cells', () => withScene((s, entry) => {
    s.homeWorldPos=()=>({x:0,y:0}); s.tileEdgeM=1000;
    for (const distance of [0,14,14.01]) {
      const policy=Companions.releasePolicy(s,distance,0);
      assert.eq(policy.stayHome,distance<=14);
      const c={kind:'dog',id:'released_dog',...policy};
      assert.eq(Companions.follows(c),distance>14);
      assert.eq(Companions.follows(JSON.parse(JSON.stringify(c))),distance>14,'reload preserves assignment');
    }
    Companions.hire(s,'mercenary');
    assert.truthy(Companions.follows(s._mercenary),'hiring near Home still follows');
    assert.falsy(pickUpPet(s,s.save,s._mercenary,0,0),'mercenary cannot be pocketed');
    const pet={kind:'dog',id:'released_dog_far',x:1000,y:1000,tx:1,ty:1,stayHome:false};
    const stay={kind:'cat',id:'released_cat_home',x:0,y:0,tx:0,ty:0,stayHome:true};
    s.save.released=[pet,stay];
    Companions.tickPets(s);
    const live=entry.creatures.find(c=>c.id===pet.id);
    assert.truthy(live,'pet catches up when its old tile is unloaded');
    assert.eq(live.x,s.playerM.x);
    assert.falsy(entry.creatures.find(c=>c.id===stay.id),'Home pet stays behind');
    live._hp=3; live.x=10000; s._petFollowCheck=0;
    Companions.tickPets(s);
    assert.eq(entry.creatures.filter(c=>c.id===pet.id).length,1);
    assert.eq(live._hp,3,'catch-up retains health');
    const surface=entry.creatures;
    entry.creatures=[];
    s._travellingPets.get(pet.id).entry={creatures:surface};
    s._petFollowCheck=0;
    Companions.tickPets(s);
    assert.eq(entry.creatures.filter(c=>c.id===pet.id).length,1,'level transition has one pet');
    assert.falsy(surface.includes(live),'pet leaves prior level');
    assert.eq(entry.creatures.find(c=>c.id===pet.id)._hp,3,'level transition retains wounds');

    s.save.caught.push(pet.id); entry.creatures=entry.creatures.filter(c=>c.id!==pet.id); s._petFollowCheck=0;
    Companions.tickPets(s);
    assert.falsy(entry.creatures.find(c=>c.id===pet.id),'carried pet stays in inventory');
  }));
  test('companions: Home pets save their wounds without joining travelling followers', () => withScene((s, entry) => {
    const c=WorldGen.makeCreature('dog',0,0,'released_home_dog',{stayHome:true,_hp:3,_lastDamagedT:T0});
    const row={kind:c.kind,id:c.id,x:0,y:0,tx:0,ty:0,stayHome:true};
    s.save.released=[row]; entry.creatures.push(c);
    Companions.tickPets(s);
    assert.eq(row.hp,3);
    assert.eq(JSON.parse(JSON.stringify(s.save)).released[0].hp,3,'reload save retains wounds');
    assert.eq(row.lastDamagedAt,T0,'healing clock survives save');
    assert.falsy(s._travellingPets.has(c.id));
    c._hp=1; s._petFollowCheck=0;
    Companions.tickPets(s);
    assert.eq(row.hp,1,'subsequent wounds are saved as well');
    c._hp=Combat.maxHp(c); c._lastDamagedT=null; s._petFollowCheck=0;
    Companions.tickPets(s);
    assert.eq(row.lastDamagedAt,null,'healing clears the saved damage clock');
    row.stayHome=false; row.hp=3; row.lastDamagedAt=T0;
    s.save=JSON.parse(JSON.stringify(s.save)); entry.creatures=[];
    s._travellingPets=new Map(); s._petFollowCheck=0;
    Companions.tickPets(s);
    const restored=entry.creatures.find(p=>p.id===row.id);
    assert.eq(restored._lastDamagedT,T0,'materialization restores original healing clock');
    assert.eq(Combat.hp(restored),3);

  }));
  test('companions: mercenary melee reach matches the player sword', () => {
    const reach = Combat.petReachCells({ kind: 'mercenary' });
    assert.eq(reach, Combat.meleeReachM(1, 'sword'));
    assert.eq(Combat.petReachCells({ kind: 'dog' }), 1.5, 'ordinary pet reach is unchanged');
    assert.truthy(Combat.inMeleeReach(0, 0, reach * 7, 0, 7, 'sword'));
    assert.falsy(Combat.inMeleeReach(0, 0, reach * 7 + 0.01, 0, 7, 'sword'));
  });

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
  function method(name) {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    assert.truthy(start >= 0 && end > start);
    return new Function('return ({' + SCENE_SRC.slice(start, end + 4) + '})[' + JSON.stringify(name) + ']')();
  }
  test('companions: pirate mercenary is a friendly sword fighter with distinct pirate stats and art', () => {
    const kind = 'pirate_mercenary', c = { kind };
    assert.eq(Combat.creatureMaxHp(kind), 65);
    assert.eq(Combat.petBlow(c), 12);
    assert.truthy(Combat.creatureMaxHp(kind) !== Combat.creatureMaxHp('mercenary'));
    assert.truthy(Combat.petBlow(c) !== Combat.petBlow({ kind: 'mercenary' }));
    assert.eq(SpriteLayout.creatureArt(kind).sheet, SpriteLayout.creatureArt('pirate_captain').sheet);
    assert.eq(SpriteLayout.CREATURE_BEHAVIOUR[kind], SpriteLayout.CREATURE_BEHAVIOUR.mercenary);
    assert.truthy(SpriteLayout.isSummoned(kind));
    assert.truthy(huntsPrey(kind, { kind: 'pirate_grunt', id: 'enemy' }));
    assert.falsy(huntsPrey(kind, { kind: 'mercenary', id: 'ally' }));
    assert.falsy(Combat.isEnemy(c));
    assert.falsy(Pirates.isPirate(c), 'friendly pirate is never a bribe target');
    const s = { save: { money: 100 } };
    assert.eq(Pirates.onHit(s, c), 0);
    assert.eq(s.save.money, 100, 'ally cannot charge pirate hit tax');
    assert.eq(Combat.petReachCells(c), Combat.petReachCells({ kind: 'mercenary' }));
  });
  test('companions: pirate contract retains wounds through reload and tile loss, recovers and expires', () => withScene((s, entry, advance) => {
    const kind = 'pirate_mercenary', row = Companions.KINDS[kind];
    s.save.money = 74;
    assert.falsy(Companions.hire(s, kind));
    assert.eq(s.save.money, 74);
    s.save.money = 100;
    assert.truthy(Companions.hire(s, kind));
    assert.eq(s.save.money, 25);
    assert.eq(s.save[row.field], T0 + 24 * 60 * 60 * 1000);
    assert.falsy(Companions.hire(s, kind));
    assert.eq(s.save.money, 25);
    assert.truthy(Companions.follows(s[row.instance]));
    assert.falsy(pickUpPet(s, s.save, s[row.instance], 0, 0));
    s[row.instance]._hp = 11;
    Companions.tickAll(s);
    s.save = JSON.parse(JSON.stringify(s.save));
    s[row.instance] = null; entry.creatures = [];
    Companions.tickAll(s);
    assert.eq(Combat.hp(s[row.instance]), 11, 'reload keeps wounds');
    const old = s[row.instance];
    entry.creatures = [];
    Companions.tickAll(s);
    assert.truthy(s[row.instance] !== old, 'tile replacement restores the ally');
    assert.includes(s.save.caught, old.id);
    assert.eq(Combat.hp(s[row.instance]), 11, 'tile replacement keeps wounds');
    s[row.instance]._spent = true; s[row.instance]._hp = 0;
    Companions.tickAll(s);
    assert.eq(s[row.instance], null);
    advance(29999); Companions.tickAll(s);
    assert.eq(s[row.instance], null);
    advance(1); Companions.tickAll(s);
    assert.eq(Combat.hp(s[row.instance]), 65);
    advance(row.durationMs); Companions.tickAll(s);
    assert.eq(s[row.instance], null);
    assert.falsy(Companions.active(s.save, kind));
  }));
  test('companions: pirate mercenary keeps collected coins in its own saved purse', () => withScene((s, entry) => {
    Companions.hire(s, 'pirate_mercenary');
    const c = s._pirateMercenary;
    s.flash = () => {};
    entry.coinDrops = [{ kind: 'coindrop', id: 'pirate_wages', x: c.x, y: c.y, amount: 9, seeded: true }];
    tickGroundCoins(s, T0);
    assert.eq(entry.coinDrops.length, 0);
    assert.eq(s.save.money, 25, 'mercenary keeps the purse, just like the ordinary mercenary');
    assert.eq(s.save.companionState.pirate_mercenary.coins, 9);
    assert.eq(JSON.parse(JSON.stringify(s.save)).companionState.pirate_mercenary.coins, 9);
    assert.includes(s.save.foundTreasures, 'pirate_wages');
  }));
  for (const [id, kind, model, tier] of [
    ['bones_scroll', 'summoned_skeleton', 'skeleton', 3],
    ['wraith_scroll', 'summoned_wraith', 'ghost', 4],
  ]) {
    test(`companions: ${id} is learned by use and summons one friendly fighter through reload and expiry`, () => withScene((s, entry, advance) => {
      assert.eq(BASE_TIER[id], tier);
      assert.truthy(ITEM_BY_ID[id].scroll);
      assert.falsy(isPotion(id));
      assert.eq(MINERAL_ICON_SHEET[id].sheet, 'icon_' + id);
      assert.truthy(HOME_RECIPES.some(r => r.id === id && r.cost[0].id === 'blank_scroll'));
      assert.truthy(homeRecipeLocked(s.save, id));
      assert.truthy(Shops.themedStock('potion', tier).includes(id));
      assert.eq(Combat.summonedAs(kind), model);
      assert.eq(Combat.creatureMaxHp(kind), Combat.creatureMaxHp(model));
      assert.eq(Combat.petBite(kind), Combat.enemyBlow(model));
      assert.truthy(SpriteLayout.isSummoned(kind));
      assert.truthy(huntsPrey(kind, { kind: 'goblin', id: 'foe' }));
      assert.falsy(huntsPrey(kind, { kind: 'dog', id: 'released_dog' }));
      assert.falsy(Combat.isEnemy({ kind }));
      assert.eq(SpriteLayout.creatureArt(kind).sheet, SpriteLayout.creatureArt(model).sheet);
      s.save.inv = [{ id, count: 3 }]; s.save.selSlot = 0;
      s.buildInventoryDOM = () => {};
      s.showMessageModal = () => {};
      s._spendScroll = method('_spendScroll');
      const read = method('readSummoningScroll'), row = Companions.KINDS[kind];
      assert.truthy(read.call(s));
      assert.eq(s.save.inv[0].count, 2);
      assert.falsy(homeRecipeLocked(s.save, id));
      const first = s[row.instance];
      assert.truthy(first);
      first._hp = 5;
      advance(1000);
      assert.truthy(read.call(s));
      assert.eq(s[row.instance], first, 'refresh keeps the same ally');
      assert.eq(Combat.hp(first), 5, 'refresh does not heal');
      s.save = JSON.parse(JSON.stringify(s.save));
      s[row.instance] = null; entry.creatures = [];
      assert.truthy(read.call(s), 'refresh immediately after reload');
      assert.eq(Combat.hp(s[row.instance]), 5, 'refresh after reload preserves wounds');
      assert.falsy(read.call(s), 'empty slot cannot summon');
      advance(row.durationMs);
      Companions.tickAll(s);
      assert.eq(s[row.instance], null);
      assert.falsy(Companions.active(s.save, kind));
    }));
    test(`companions: ${id} ends when defeated and is removed by the time potion`, () => withScene((s, entry) => {
      const row = Companions.KINDS[kind];
      s.save[row.field] = Date.now() + row.durationMs;
      Companions.tick(s, kind);
      s[row.instance]._spent = true;
      Companions.tick(s, kind);
      assert.eq(s[row.instance], null);
      assert.eq(s.save[row.field], 0);
      s.save[row.field] = Date.now() + row.durationMs;
      Companions.tick(s, kind);
      assert.truthy(s[row.instance]);
      PlayerTime.reset(s);
      assert.eq(s[row.instance], null);
      assert.falsy(Companions.active(s.save, kind));
    }));
  }
})();
