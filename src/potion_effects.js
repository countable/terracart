// Thrown potions keep the same numbers and deadlines as their drinkable form.
// The save ledger preserves a recipient's effects when its tile is rebuilt.
(function (root) {
  'use strict';
  const TIMERS = {
    reach_potion: 'reachPotionUntil', speed_potion: 'speedPotionUntil',
    shield_potion: 'shieldPotionUntil', protection_potion: 'protectionPotionUntil',
    giant_potion: 'giantPotionUntil', fire_resistance_potion: 'fireResistancePotionUntil',
    blight_potion: 'blightPotionUntil',
    immortal_potion: 'immortalPotionUntil',
    shrinking_potion: 'shrinkingPotionUntil',
  };
  function active(c, id, now = Date.now()) { return (c?.[TIMERS[id]] || 0) > now; }
  function speedMul(c, now = Date.now()) { return active(c, 'speed_potion', now) ? 2 : 1; }
  function scaleMul(c, now = Date.now()) {
    return (active(c, 'giant_potion', now) ? CONSUMABLE_SPEC.giant_potion.scaleMul : 1)
      * (active(c, 'shrinking_potion', now) ? CONSUMABLE_SPEC.shrinking_potion.scaleMul : 1);
  }
  function maxHpBonus(c, now = Date.now()) {
    return active(c, 'giant_potion', now) ? CONSUMABLE_SPEC.giant_potion.maxHpBonus : 0;
  }
  function meleeBonus(c, now = Date.now()) {
    return active(c, 'giant_potion', now) ? CONSUMABLE_SPEC.giant_potion.damageBonus : 0;
  }
  function maxHpMul(c, now = Date.now()) {
    return active(c, 'shrinking_potion', now) ? CONSUMABLE_SPEC.shrinking_potion.maxHpMul : 1;
  }
  function meleeMul(c, now = Date.now()) {
    return active(c, 'shrinking_potion', now) ? CONSUMABLE_SPEC.shrinking_potion.meleeDamageMul : 1;
  }
  function visionReduction(c, now = Date.now()) {
    return active(c, 'shrinking_potion', now) ? CONSUMABLE_SPEC.shrinking_potion.visionCells : 0;
  }
  function range(c, base, now = Date.now()) {
    return active(c, 'reach_potion', now) ? Math.max(base, Fog.REVEAL_CELLS) : base;
  }
  function damageMul(c, now = Date.now()) {
    if (Conditions.damageImmune(c, now)) return 0;
    return Math.min(active(c, 'shield_potion', now) ? CONSUMABLE_SPEC.shield_potion.damageMul : 1,
      active(c, 'protection_potion', now) ? CONSUMABLE_SPEC.protection_potion.damageMul : 1);
  }
  function extinguish(c) {
    delete c._burnState;
    c._burnBy = null;
    c.fireDamageRemainder = 0;
  }
  function clearDebuffs(c) {
    extinguish(c);
    c.conditions = {};
    for (const field of ['_sleepUntil', '_frozenUntil', '_fearUntilT']) c[field] = 0;
  }
  function prune(scene, now = Date.now()) {
    const ledger = scene.save.potionEffects;
    if (!ledger) return;
    for (const [id, state] of Object.entries(ledger)) {
      for (const field of Object.keys(state)) if (!(state[field] > now)) delete state[field];
      if (!Object.keys(state).length) delete ledger[id];
    }
  }
  function remember(scene, c, now = Date.now()) {
    if (!c.id) return;
    const state = {};
    for (const field of Object.values(TIMERS)) if (c[field] > now) state[field] = c[field];
    if (c._charmUntil > now) state._charmUntil = c._charmUntil;
    if (c._potionTamingUntil > now) state._potionTamingUntil = c._potionTamingUntil;
    const ledger = scene.save.potionEffects ||= {};
    if (Object.keys(state).length) ledger[c.id] = state;
    else delete ledger[c.id];
    prune(scene, now);
    c._potionLedger = scene.save.potionEffects;
    if (typeof persistSave === 'function') persistSave(scene.save);
  }
  function restore(scene, c, now = Date.now()) {
    const ledger = scene.save.potionEffects;
    if (c._potionLedger === ledger) return;
    c._potionLedger = ledger;
    const state = ledger?.[c.id];
    if (!state) return;
    // Capacity buffs must not seed a rebuilt creature with their enlarged pool.
    Combat.hp(c);
    for (const field of [...Object.values(TIMERS), '_charmUntil', '_potionTamingUntil']) {
      if (Number.isFinite(state[field]) && state[field] > now) c[field] = state[field];
    }
    c._hp = Math.min(c._hp, Combat.maxHp(c));
  }
  function wake(scene, c) {
    c._npcRestUntilEpoch = 0; c._npcRestUntil = 0; c._retreatUntilT = 0; c._spent = false;
    if (scene.save.npcRestUntil) delete scene.save.npcRestUntil[c.id];
    if (scene.save.companionState?.[c.kind]) {
      delete scene.save.companionState[c.kind].restUntil;
      scene.save.companionState[c.kind].hp = c._hp;
    }
  }
  function downed(c, now = Date.now()) {
    return (c.kind === 'npc' && NPC.isDormant(c, now)) || c._spent
      || (c._retreatUntilT || 0) > performance.now() || Combat.hp(c) <= 0;
  }
  function clearTime(scene, c) {
    for (const field of Object.values(TIMERS)) c[field] = 0;
    clearDebuffs(c);
    c._charmUntil = 0; c._potionTamingUntil = 0;
    for (const field of ['_attackNextT', '_attackWindupUntil', '_attackUntil', '_abilityNextT',
      '_abilityWindupUntil', '_reloadUntil', '_lungeNextT', '_lungeUntil', '_lungeWindupUntil',
      '_lungeRecoverUntil', '_nextChooseT', '_npcRestUntil', '_throwReadyAt', '_tomeReadyAt',
      '_lavaNextT', '_biteNextT', '_lastAttackT']) c[field] = 0;
    c._attackAim = null;
    for (const field of Object.keys(c)) {
      if (/(?:NextT|ReadyAt|ReadyT|CooldownUntil|AttackAt)$/.test(field) && typeof c[field] === 'number') c[field] = 0;
    }
    c._hp = Math.min(Combat.hp(c), Combat.maxHp(c));
    remember(scene, c);
  }
  function apply(scene, c, id, now = Date.now()) {
    if (!c || !ITEM_BY_ID[id]?.potion) return false;
    restore(scene, c, now);
    if (c.kind === 'npc') NPC.restore(scene, c);
    const spec = CONSUMABLE_SPEC[id];
    if (!spec) return false;
    if (TIMERS[id]) {
      // Seed health before Giant expands the maximum; increasing capacity is not healing.
      Combat.hp(c);
      c[TIMERS[id]] = now + spec.durationMs;
      if (id === 'blight_potion') c._potionBlightAt = now + 1000;
      c._hp = Math.min(c._hp, Combat.maxHp(c));
      if (id === 'fire_resistance_potion' || id === 'immortal_potion') extinguish(c);
    } else if (id === 'vigor_potion' || id === 'elixir') {
      if (id === 'elixir' && downed(c, now)) return false;
      if (id === 'elixir') clearDebuffs(c);
      c._hp = id === 'elixir' ? Combat.maxHp(c) : Math.min(Combat.maxHp(c), Combat.hp(c) + spec.energy);
      if (c._hp > 0) wake(scene, c);
    } else if (id === 'antidote') {
      clearDebuffs(c);
    } else if (id === 'revive_potion' || id === 'resurrection_potion') {
      if (!downed(c, now)) return false;
      c._hp = Math.max(1, Math.round(Combat.maxHp(c) * spec.energyFrac));
      clearDebuffs(c); wake(scene, c);
    } else if (id === 'honey') {
      c._potionTamingUntil = now + (spec.durationMs || 60000);
      if (Combat.isEnemyKind(c.kind)) Combat.applyCharm(c, now);
      if (scene.startWorldM && scene.playerM) {
        c._homeX = c.homeX = scene.startWorldM.x + scene.playerM.x;
        c._homeY = c.homeY = scene.startWorldM.y + scene.playerM.y;
      }
      c._nextChooseT = 0;
    } else if (id === 'time_potion') {
      clearTime(scene, c);
      return true;
    } else return false;
    remember(scene, c, now);
    return true;
  }
  function units(scene) {
    const out = [];
    if (!scene.playerToWorldCell) return out;
    const pc = scene.playerToWorldCell();
    WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, c => {
      if (!c._spent && !c._surfaceInactive && !scene.save.caught?.includes(c.id)) out.push(c);
    });
    return out;
  }
  function hostile(c) {
    return Combat.isEnemy(c);
  }
  function opponents(scene, c, candidates) {
    const enemy = hostile(c);
    const out = candidates.filter(target => target !== c
      && !downed(target) && hostile(target) !== enemy
      && (!enemy || target.kind !== 'npc' || NPC.canTarget(scene, target)));
    if (enemy && scene.startWorldM && scene.playerM && !Combat.playerDowned(scene.save.energy)
        && !scene.isUnnoticed?.(c)) {
      out.push({ id: 'player', x: scene.startWorldM.x + scene.playerM.x,
        y: scene.startWorldM.y + scene.playerM.y });
    }
    return out;
  }
  function damage(scene, c, raw, owner, bypassArmor = false) {
    if (c.id === 'player') {
      scene._losePlayerEnergy?.(Combat.incomingDamage(scene.save, raw), { closeShop: true });
    } else if (c.kind === 'npc') {
      NPC.hit(scene, c, Date.now(), raw);
    } else if (Combat.isEnemyKind(c.kind) && !String(c.id).startsWith('released_')) {
      scene._damageEnemy?.(c, raw, hostile(owner) ? 'enemy' : 'ally', { bypassArmor });
    } else {
      Combat.damageDealt(c, raw, { bypassArmor });
      if (Combat.hp(c) <= 0) {
        if (SpriteLayout.isSummoned(c.kind)) c._spent = true;
        else { c._hp = 1; c._retreatUntilT = performance.now() + Companions.RECOVERY_MS; }
      }
    }
  }
  function tick(scene, c, now = Date.now()) {
    if (now >= (scene._potionPruneAt || 0)) { prune(scene, now); scene._potionPruneAt = now + 60000; }
    restore(scene, c, now);
    if (Number.isFinite(c._hp)) c._hp = Math.min(c._hp, Combat.maxHp(c));
    if (Conditions.fireImmune(c, now)) extinguish(c);
    if (downed(c, now)) return false;
    if (active(c, 'blight_potion', now) && now >= (c._potionBlightAt || 0)) {
      const seconds = c._potionBlightAt ? Math.min(1, (now - c._potionBlightAt + 1000) / 1000) : 0;
      c._potionBlightAt = now + 1000;
      const spec = CONSUMABLE_SPEC.blight_potion;
      const wards = scene._npcWardContext;
      if (hostile(c) && wards && wardTrip(c, wards.home, wards.castles, wards.radius2)) return false;
      for (const target of opponents(scene, c, units(scene))) {
        if (Math.hypot(target.x - c.x, target.y - c.y) <= spec.radiusCells * scene.cellM) {
          damage(scene, target, spec.damagePerSecond * seconds, c, true);
        }
      }
    }
    return false;
  }
  root.PotionEffects = { TIMERS, active, speedMul, scaleMul, maxHpBonus, maxHpMul, meleeBonus, meleeMul, visionReduction, range,
    damageMul, extinguish, clearDebuffs, clearTime, restore, apply, tick, hostile, downed, prune };
})(typeof globalThis !== 'undefined' ? globalThis : this);
