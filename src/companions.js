// Timed allies share their lifecycle; movement and fighting stay in the pet AI.
(function (root) {
  'use strict';
  const RECOVERY_MS = 30000;
  const KINDS = {
    spirit_raven: { field: 'spiritRavenUntil', instance: '_spiritRaven',
      get durationMs() { return SPIRIT_RAVEN_MS; },
      expired: 'The spirit raven fades.', defeated: 'The spirit raven is spent.' },
    mercenary: { field: 'mercenaryUntil', instance: '_mercenary', durationMs: 24 * 60 * 60 * 1000,
      hireCost: 50, recoveryMs: RECOVERY_MS, persistHealth: true,
      expired: 'The mercenary heads home.', defeated: 'The mercenary rests a moment.' },
  };
  function active(save, kind, now = Date.now()) {
    const row = KINDS[kind];
    return !!row && Number(save?.[row.field]) > now;
  }
  function hire(scene, kind, now = Date.now()) {
    const row = KINDS[kind], save = scene.save;
    if (!row?.hireCost || active(save, kind, now) || (save.money || 0) < row.hireCost) return false;
    addMoney(save, -row.hireCost);
    save[row.field] = now + row.durationMs;
    (save.companionState ||= {})[kind] = { hp: Combat.creatureMaxHp(kind) };
    tick(scene, kind);
    scene.updateMoneyDOM?.();
    return true;
  }
  function tick(scene, kind) {
    const row = KINDS[kind];
    if (!row) return;
    let creature = scene[row.instance] || null;
    const save = scene.save, wall = Date.now();
    let live = active(save, kind, wall);
    if (!creature && !live) return;
    if (!scene.startWorldM || !scene.playerM) return;
    const px = scene.startWorldM.x + scene.playerM.x;
    const py = scene.startWorldM.y + scene.playerM.y;
    const pc = scene.playerToWorldCell();
    const state = row.persistHealth ? ((save.companionState ||= {})[kind] ||= {}) : {};
    if (creature) {
      const here = !!WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, c => c === creature);
      const simR = CREATURE_SIM_CELLS * scene.cellM;
      const lost = !here || Math.hypot(creature.x - px, creature.y - py) > simR;
      if (row.persistHealth && state.hp !== Combat.hp(creature)) {
        state.hp = Combat.hp(creature);
        persistSave(save);
      }
      if (!live || creature._spent || lost) {
        (save.caught ||= []).push(creature.id);
        scene[row.instance] = null;
        if (creature._spent && live) {
          if (row.recoveryMs) state.restUntil = wall + row.recoveryMs;
          else { save[row.field] = 0; live = false; }
        }
        if (here && (creature._spent || !live)) {
          scene.flashAtWorld(creature._spent ? row.defeated : row.expired, creature.x, creature.y);
        }
        persistSave(save);
      } else {
        creature._followUntilT = performance.now() + Math.max(0, save[row.field] - wall);
      }
    }
    if (!live || scene[row.instance] || (state.restUntil || 0) > wall) return;
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
    if (!entry || !entry.creatures) return;
    if (state.restUntil) {
      delete state.restUntil;
      state.hp = Combat.creatureMaxHp(kind);
      persistSave(save);
    }
    const now = performance.now();
    creature = WorldGen.makeCreature(kind, px, py,
      `${kind}_${pc.tx}_${pc.ty}_${Math.floor(now)}_${Math.floor(Math.random() * 1e4)}`,
      { _followUntilT: now + Math.max(0, save[row.field] - wall) });
    if (row.persistHealth) creature._hp = Math.max(1, Math.min(Combat.creatureMaxHp(kind), Number(state.hp) || Combat.creatureMaxHp(kind)));
    entry.creatures.push(creature);
    scene[row.instance] = creature;
  }
  function tickAll(scene) { for (const kind of Object.keys(KINDS)) tick(scene, kind); }
  root.Companions = { KINDS, RECOVERY_MS, active, hire, tick, tickAll };
})(typeof window !== 'undefined' ? window : globalThis);
