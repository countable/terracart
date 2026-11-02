(function () {
  test('rare effects: mute expires in foreground time and preserves ordinary attacks', () => {
    const save = { energy: 100 };
    Conditions.apply(save, 'mute', 0, { durationMs: 120000 });
    assert.truthy(Conditions.spellsBlocked(save));
    assert.eq(Conditions.attacksBlocked(save), false);
    assert.eq(Conditions.meleeOnly(save), false);
    Conditions.tick(save, 119999);
    assert.truthy(Conditions.spellsBlocked(save));
    Conditions.tick(save, 1);
    assert.eq(Conditions.spellsBlocked(save), false);
  });
  test('rare effects: slime curse forces bare melee and restores selected weapon after three minutes', () => {
    const save = { energy: 100, activeWeapon: 'bow', relics: { bow: { tier: 2 } } };
    Conditions.apply(save, 'slime_form', 0);
    assert.truthy(Conditions.spellsBlocked(save));
    assert.truthy(Gear.meleeActive(save));
    assert.eq(Gear.activeWeapon(save), null);
    assert.eq(save.activeWeapon, 'bow');
    Conditions.normalize(save);
    Conditions.tick(save, 180000);
    assert.eq(Conditions.meleeOnly(save), false);
    assert.eq(Gear.activeWeapon(save), 'bow');
  });
  test('rare effects: paralysis dose and ten-second curse never change default definitions', () => {
    const save = { energy: 100 };
    Conditions.apply(save, 'paralysis', 0, { durationMs: 3000 });
    assert.eq(save.conditions.paralysis.remainingMs, 3000);
    assert.eq(Conditions.DEFINITIONS.paralysis.durationMs, 5000);
    for (let i = 0; i < Conditions.CURSE_DEBUFFS.length; i++) {
      const target = { energy: 100 }, id = Conditions.curseDebuff(i);
      Conditions.apply(target, id, 0, { durationMs: 10000 });
      assert.eq(target.conditions[id].remainingMs, 10000);
      Conditions.tick(target, 10000);
      assert.eq(Conditions.active(target, id), false);
    }
    assert.eq(Conditions.DEFINITIONS.poison.durationMs, 60000);
    assert.eq(Conditions.DEFINITIONS.mute.durationMs, 120000);
  });
  test('rare effects: venom is stronger than ordinary poison and antidote removes it', () => {
    const save = { energy: 100 };
    Conditions.apply(save, 'venom', 0);
    Conditions.tick(save, 2000);
    assert.eq(save.energy, 96);
    assert.truthy(Conditions.useAntidote(save));
    assert.eq(Conditions.active(save, 'venom'), false);
  });
  test('rare effects: hit dispatch preserves the roster-derived shot duration', () => {
    const body = SCENE_SRC.match(/\n  _shotHitsPlayer\(shot\) \{([\s\S]*?)\n  \}\n/)[1];
    const hit = new Function('shot', 'Conditions', 'Combat', 'foeBlowLands', body);
    let received;
    const land = (scene, source, damage, options) => { received = options; return 1; };
    hit.call({ save: {} }, { projectile: 'curse_star', curseSeed: 4, conditionDurationMs: 37000, damage: 3 }, Conditions,
      { incomingProjectileDamage: () => 3 }, land);
    assert.eq(received.condition, 'mute');
    assert.eq(received.conditionDurationMs, 37000);
  });
  test('rare effects: mute refuses spell use before consuming inventory but still permits cures', () => {
    const body = SCENE_SRC.match(/\n  _selectedConsumable\(id\) \{([\s\S]*?)\n  \}\n/)[1];
    const selected = new Function('id', 'ITEM_BY_ID', 'Conditions', 'getSelectedSlot', body);
    const save = { energy: 100 };
    Conditions.apply(save, 'mute', 0);
    const scene = { save }, slot = { id: 'fireball_scroll', count: 2 };
    const get = () => slot;
    assert.eq(selected.call(scene, slot.id, ITEM_BY_ID, Conditions, get), null);
    assert.eq(slot.count, 2);
    slot.id = 'antidote';
    assert.eq(selected.call(scene, slot.id, ITEM_BY_ID, Conditions, get), slot);
    slot.id = 'tome_frost_aura';
    assert.eq(selected.call(scene, slot.id, ITEM_BY_ID, Conditions, get), null);
  });
  test('rare effects: slime expiration restarts human animation even when facing has not changed', () => {
    const body = SCENE_SRC.match(/\n  _playDirected\(sprite, baseKey, dx, dy\) \{([\s\S]*?)\n  \}\n/)[1];
    const play = new Function('sprite', 'baseKey', 'dx', 'dy', 'Conditions', 'HeadingUp', 'SpriteLayout', 'performance', body);
    let texture = 'farmer', plays = 0;
    const sprite = { anims: { currentAnim: { key: 'farmer-idle-down' }, stop() {} },
      setTexture(key) { texture = key; return this; }, setFlipX() { return this; },
      play(key) { texture = key; plays++; return this; } };
    const save = { energy: 100 }, scene = { save, player: sprite, _spriteDir: { x: 0, y: 1 },
      _slimeFormTexture: () => 'player_slime_form', _syncPlayerSkin() {} };
    const heading = { toScreenVec: (scene, x, y) => ({ x, y }) };
    const layout = { PLAYER_ART: { farmer: { sheet: 'farmer' } } };
    Conditions.apply(save, 'slime_form', 0);
    play.call(scene, sprite, 'idle', 0, 1, Conditions, heading, layout, { now: () => 0 });
    assert.eq(texture, 'player_slime_form');
    Conditions.tick(save, 180000);
    play.call(scene, sprite, 'idle', 0, 1, Conditions, heading, layout, { now: () => 180000 });
    assert.eq(texture, 'farmer-idle-down');
    assert.eq(plays, 1);
  });
  test('rare effects: a running moonbeam and tome buttons are suppressed while muted', () => {
    const segment = new Function('Conditions', SCENE_SRC.match(/\n  _moonbeamSegment\(now = Date.now\(\)\) \{([\s\S]*?)\n  \}\n/)[1]);
    const usable = new Function('id', 'Conditions', SCENE_SRC.match(/tomeUsable\(id\) \{([^}]+)\}/)[1]);
    const scene = { save: { energy: 100 }, _tomeWait() { throw Error('must refuse before cooldown'); } };
    Conditions.apply(scene.save, 'mute', 0);
    assert.eq(segment.call(scene, Conditions), null);
    assert.eq(usable.call(scene, 'tome_frost_aura', Conditions), false);
  });
  test('rare effects: illusion damage dissolves its actual HP without a defeat reward or capture', () => {
    const body = SCENE_SRC.match(/\n  _damageEnemy\(c, amount, source = 'player', options = \{\}\) \{([\s\S]*?)\n  \}\n/)[1];
    const hit = new Function('c', 'amount', body);
    const c = { id: 'copy', kind: 'spectrus', _rareIllusion: true, _hp: 1, _illusionUntil: 5000 };
    const scene = { save: { caught: [], money: 0 } };
    assert.truthy(hit.call(scene, c, 1));
    assert.eq(Combat.hp(c), 0); assert.truthy(c.dead);
    assert.eq(scene.save.caught.length, 0); assert.eq(scene.save.money, 0);
    assert.eq(Pets.catchable(c), false); assert.eq(Pets.bond(scene.save, c), false);
  });
  test('rare effects: actual pet contact dissolves an illusion before retaliation or rewards', () => {
    const start = SCENE_SRC.indexOf('        // Fight resolution: if chasing pet is in fight range, deal damage.');
    const end = SCENE_SRC.indexOf('        for (let attempt = 0; attempt < 6; attempt++)', start);
    assert.truthy(start > 0 && end > start);
    const contact = new Function('c', 'Combat', 'Multiplayer', 'creatureMeleeSwing', SCENE_SRC.slice(start, end));
    const damageBody = SCENE_SRC.match(/\n  _damageEnemy\(c, amount, source = 'player', options = \{\}\) \{([\s\S]*?)\n  \}\n/)[1];
    const target = { id: 'spectrus-copy', kind: 'spectrus', _rareIllusion: true, _hp: 1, x: 1, y: 0 };
    const pet = { id: 'pet-goblin', kind: 'goblin', pet: true, _hp: 8, x: 0, y: 0, _chaseTarget: target };
    let swings = 0;
    const scene = { cellM: 7, save: { caught: [], money: 0 },
      _damageEnemy: new Function('c', 'amount', damageBody),
      resolveDefeat() { throw Error('illusion must not enter pet reward path'); },
      _popDamageNumber() { throw Error('illusion must not retaliate'); } };
    contact.call(scene, pet, Combat, { shouldApplyDamage: () => true }, () => swings++);
    assert.truthy(target.dead); assert.eq(target._hp, 0);
    assert.eq(pet._hp, 8); assert.eq(pet._chaseTarget, null); assert.eq(swings, 1);
    assert.eq(scene.save.caught.length, 0); assert.eq(scene.save.money, 0);
  });
  test('rare effects: direct defeat of an illusion never enters the reward or permanent capture ledger', () => {
    const body = SCENE_SRC.match(/\n  resolveDefeat\(victim, source = 'player'\) \{([\s\S]*?)\n  \}\n/)[1];
    const defeat = new Function('victim', 'source', body);
    const target = { id: 'copy', _rareIllusion: true, _hp: 1 };
    let dissolved = 0;
    const scene = { save: { money: 7 }, _damageEnemy(victim, amount, source) {
      assert.eq(victim, target); assert.eq(amount, 1); assert.eq(source, 'pet'); dissolved++;
    } };
    defeat.call(scene, target, 'pet');
    assert.eq(dissolved, 1); assert.eq(scene.save.caught, undefined); assert.eq(scene.save.money, 7);
  });
})();
