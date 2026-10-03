(function () {
  const scene = () => ({ save: { energy: 100, caught: [] }, cellM: 10,
    startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 } });
  const creature = (kind = 'slime') => ({ id: `potion_${kind}`, kind, x: 0, y: 0 });

  test('Thrown potions: every potion has a recipient effect, including Taming', () => {
    for (const item of ITEMS.filter(item => item.potion)) {
      const s = scene(), c = creature();
      if (item.id === 'revival_potion' || item.id === 'resurrection_potion') c._hp = 0;
      assert.truthy(PotionEffects.apply(s, c, item.id), item.id);
    }
    assert.falsy(PotionEffects.apply(scene(), creature(), 'thunder_scroll'));
  });

  test('Thrown potions: Giant and Shrinking stack, expire, and preserve melee-only scaling', () => {
    const s = scene(), c = creature('spirit_raven');
    const hp = Combat.maxHp(c), bite = Combat.petBlow(c);
    PotionEffects.apply(s, c, 'giant_potion');
    assert.eq(Combat.maxHp(c), hp + 100);
    assert.eq(Combat.hp(c), hp, 'capacity is not healing');
    assert.eq(Combat.petBlow(c), bite + 5);
    PotionEffects.apply(s, c, 'shrinking_potion');
    assert.eq(Combat.maxHp(c), Math.ceil((hp + 100) / 2));
    assert.eq(Combat.petBlow(c), (bite + 5) / 2);
    assert.eq(PotionEffects.scaleMul(c), 0.75);
    assert.eq(PotionEffects.visionReduction(c), 1);
    c.giantPotionUntil = c.shrinkingPotionUntil = Date.now();
    assert.eq(Combat.maxHp(c), hp);
    assert.eq(Combat.petBlow(c), bite);
    const odd = creature('slime'); odd.kind = 'chicken';
    PotionEffects.apply(s, odd, 'shrinking_potion');
    assert.eq(Combat.maxHp(odd), Math.ceil(Combat.creatureMaxHp(odd.kind) / 2));
  });

  test('Thrown potions: healing and revival restore wounded NPCs and their saved rest state', () => {
    const s = scene(), c = creature('npc');
    NPC.hit(s, c);
    assert.truthy(NPC.isDormant(c));
    const restUntil = s.save.npcRestUntil[c.id];
    c._frozenUntil = Date.now() + 10000;
    assert.falsy(PotionEffects.apply(s, c, 'elixir'), 'Elixir cannot revive a downed neighbour');
    assert.eq(Combat.hp(c), 0);
    assert.eq(s.save.npcRestUntil[c.id], restUntil);
    assert.truthy(c._frozenUntil > Date.now(), 'refused Elixir does not cure afflictions');
    assert.truthy(PotionEffects.apply(s, c, 'revival_potion'));
    assert.eq(Combat.hp(c), Math.round(Combat.maxHp(c) * 0.3));
    assert.falsy(NPC.isDormant(c));
    assert.falsy(s.save.npcRestUntil[c.id]);
    assert.falsy(PotionEffects.apply(s, c, 'revival_potion'), 'healthy recipients cannot be revived');
    PotionEffects.apply(s, c, 'elixir');
    assert.eq(Combat.hp(c), Combat.maxHp(c));
  });

  test('Thrown potions: protection, shielding, immortality, and fire immunity reach actual damage', () => {
    const s = scene(), c = creature('npc');
    PotionEffects.apply(s, c, 'giant_potion');
    PotionEffects.apply(s, c, 'elixir');
    PotionEffects.apply(s, c, 'protection_potion');
    assert.eq(Combat.damageDealt(c, 20), 15);
    PotionEffects.apply(s, c, 'shielding_potion');
    assert.eq(Combat.damageDealt(c, 20), 10, 'protection does not multiply with shielding');
    PotionEffects.apply(s, c, 'immortal_potion');
    assert.eq(Combat.damageDealt(c, 20), 0);
    assert.falsy(NPC.hit(s, c));
    c.immortalPotionUntil = 0;
    PotionEffects.apply(s, c, 'fire_resistance_potion');
    assert.falsy(Combat.ignite(c));
    assert.eq(Combat.damageDealt(c, 20), 10, 'ordinary damage still lands through fire resistance');
  });

  test('Thrown potions: Time removes recipient buffs, afflictions and action cooldowns', () => {
    const s = scene(), c = creature();
    PotionEffects.apply(s, c, 'giant_potion');
    PotionEffects.apply(s, c, 'speed_potion');
    Combat.ignite(c);
    c._attackNextT = 10000; c._frozenUntil = Date.now() + 10000; c._tomeReadyAt = 10000;
    c._nextStealT = 10000; c._nextShotT = 10000;
    PotionEffects.apply(s, c, 'time_potion');
    assert.eq(PotionEffects.scaleMul(c), 1);
    assert.eq(PotionEffects.speedMul(c), 1);
    assert.falsy(Combat.burning(c));
    assert.eq(c._attackNextT, 0);
    assert.eq(c._frozenUntil, 0);
    assert.eq(c._tomeReadyAt, 0);
    assert.eq(c._nextStealT, 0, 'slime, deer and legacy melee cooldown resets');
    assert.eq(c._nextShotT, 0, 'legacy ranged cooldown resets');
    assert.eq(s.save.potionEffects[c.id], undefined);
  });

  test('Thrown potions: live timers survive recipient tile reconstruction and reject expired saves', () => {
    const s = scene(), c = creature();
    PotionEffects.apply(s, c, 'reach_potion');
    PotionEffects.apply(s, c, 'speed_potion');
    const rebuilt = creature();
    PotionEffects.restore(s, rebuilt);
    assert.eq(rebuilt.reachPotionUntil, c.reachPotionUntil);
    assert.eq(PotionEffects.speedMul(rebuilt), 2);
    assert.eq(PotionEffects.range(rebuilt, 1), Fog.REVEAL_CELLS);
    const expired = creature();
    PotionEffects.restore(s, expired, c.reachPotionUntil);
    assert.falsy(expired.reachPotionUntil);
  });

  test('Thrown potions: rebuilding Giant and Shrinking recipients preserves ordinary initial health', () => {
    for (const id of ['giant_potion', 'shrinking_potion']) {
      const s = scene(), c = creature();
      const base = Combat.maxHp(c);
      PotionEffects.apply(s, c, id);
      const rebuilt = creature();
      PotionEffects.restore(s, rebuilt);
      assert.eq(Combat.hp(rebuilt), Math.min(base, Combat.maxHp(rebuilt)), id);
      assert.truthy(PotionEffects.active(rebuilt, id));
    }
    const s = scene(), c = creature();
    PotionEffects.apply(s, c, 'giant_potion');
    PotionEffects.apply(s, c, 'shrinking_potion');
    const rebuilt = creature();
    PotionEffects.restore(s, rebuilt);
    assert.eq(Combat.hp(rebuilt), Combat.creatureMaxHp(rebuilt.kind), 'stacked buffs cannot heal on rebuild');
  });

  test('Thrown potions: collision can hit friendly NPCs without changing ordinary shot targets', () => {
    const c = creature('npc'); c.x = 1;
    const shot = () => ({ x: 0, y: 0, vx: 1, vy: 0, speedMps: 1,
      travelledM: 0, rangeM: 10, pierce: false });
    let hits = 0;
    Combat.stepShots([{ ...shot(), potionId: 'healing_potion' }], 1, [], 1,
      target => { assert.eq(target, c); hits++; }, { potionTargets: [c] });
    assert.eq(hits, 1);
    Combat.stepShots([shot()], 1, [], 1, () => hits++, { potionTargets: [c] });
    assert.eq(hits, 1);
  });

  test('Thrown potions: missing bottle refuses the real throw without changing attacker health or cooldown', () => {
    const method = name => {
      const start = SCENE_SRC.indexOf('\n  ' + name + '(');
      const end = SCENE_SRC.indexOf('\n  }\n', start);
      assert.truthy(start >= 0 && end > start);
      return new Function('return ({' + SCENE_SRC.slice(start, end + 4) + '})[' + JSON.stringify(name) + ']')();
    };
    const s = scene();
    s.save.inv = [{ id: 'giant_potion', count: 0 }]; s.save.selSlot = 0;
    s._shots = []; s._throwReadyAt = 0;
    s.canThrowItem = method('canThrowItem');
    s.throwCooldownLeft = method('throwCooldownLeft');
    s.isShadowActive = () => false;
    const before = JSON.stringify(s.save);
    assert.falsy(method('_throwItem').call(s, 'giant_potion'));
    assert.eq(JSON.stringify(s.save), before);
    assert.eq(s._shots.length, 0);
    assert.eq(s._throwReadyAt, 0);
    const recipient = creature();
    assert.falsy(PotionEffects.apply(s, recipient, 'missing_potion'));
    assert.eq(recipient._hp, undefined, 'invalid payload cannot mutate recipient health');
  });

  test('Thrown potions: Blight follows its recipient allegiance, stops at expiry, and prunes its ledger', () => {
    const s = scene(), ally = creature('npc'), foe = creature('slime'), now = Date.now();
    ally.x = 0; foe.x = 1;
    const each = WorldGen.forEachItemNear;
    const hits = [];
    s.playerToWorldCell = () => ({ tx: 0, ty: 0 });
    s._damageEnemy = (target, amount) => { hits.push(target.id); Combat.damageDealt(target, amount, { bypassArmor: true }); };
    s._losePlayerEnergy = amount => { s.save.energy -= amount; };
    WorldGen.forEachItemNear = (list, tx, ty, fn) => [ally, foe].forEach(fn);
    try {
      PotionEffects.apply(s, ally, 'blight_potion', now);
      PotionEffects.tick(s, ally, now + 1000);
      assert.eq(hits.join(','), foe.id);
      assert.eq(s.save.energy, 100, 'friendly aura spares player');
      PotionEffects.apply(s, foe, 'blight_potion', now);
      PotionEffects.tick(s, foe, now + 1000);
      assert.eq(s.save.energy, 98, 'enemy aura damages player');
      assert.eq(Combat.hp(ally), Combat.maxHp(ally) - 2, 'enemy aura damages friendly NPC');
      const count = hits.length;
      PotionEffects.tick(s, ally, ally.blightPotionUntil);
      assert.eq(hits.length, count);
      PotionEffects.prune(s, now + CONSUMABLE_SPEC.blight_potion.durationMs);
      assert.eq(Object.keys(s.save.potionEffects).length, 0);
    } finally { WorldGen.forEachItemNear = each; }
  });

  test('Immortal potion: poison time keeps elapsing without damage, then resumes after immunity expires', () => {
    const now = Date.now(), save = { energy: 100, immortalPotionUntil: now + 60000 };
    Conditions.apply(save, 'poison');
    assert.eq(Conditions.tick(save, 2000, { now }).lost, 0);
    assert.truthy(Conditions.active(save, 'poison'));
    assert.eq(Conditions.tick(save, 2000, { now: now + 60000 }).lost, 1);
  });
})();
