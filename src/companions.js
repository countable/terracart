// Timed allies share their lifecycle; movement and fighting stay in the pet AI.
// ONE TABLE of the timed allies: the save field that holds the contract, the
// scene slot the live instance sits in, how long a contract runs, what the
// player is told when it ends, and `onDefeat` — what happens when the ally's
// HP runs out (knockedOut below): every timed ally is 'spent' (gone; a
// mercenary DIES — owner, Oct 2026 — hire again), where a released pet
// rests in place for one minute instead.
(function (root) {
  'use strict';
  const RECOVERY_MS = 60000;
  const KINDS = {
    spirit_raven: { field: 'spiritRavenUntil', instance: '_spiritRaven', onDefeat: 'spent',
      get durationMs() { return SPIRIT_RAVEN_MS; },
      expired: 'The spirit raven fades.', defeated: 'The spirit raven is spent.' },
    summoned_skeleton: { field: 'skeletonUntil', instance: '_summonedSkeleton', onDefeat: 'spent',
      get durationMs() { return CONSUMABLE_SPEC.bones_scroll.durationMs; }, persistHealth: true,
      expired: 'The bones settle into dust.', defeated: 'The bones fall still.' },
    summoned_wraith: { field: 'wraithUntil', instance: '_summonedWraith', onDefeat: 'spent',
      get durationMs() { return CONSUMABLE_SPEC.wraith_scroll.durationMs; }, persistHealth: true,
      expired: 'The wraith dissolves.', defeated: 'The wraith is spent.' },
    mercenary: { field: 'mercenaryUntil', instance: '_mercenary', durationMs: 24 * 60 * 60 * 1000,
      hireCost: 50, coinPickupCells: 0.75, persistHealth: true, onDefeat: 'spent',
      expired: 'The mercenary heads home.', defeated: 'The mercenary falls.' },
  };
  // A DOWNED ALLY — the one rule, asked wherever an ally's HP runs out (the
  // pet fight in wanderCreatures, a burn or poison in scene_fire.js, a thrown
  // potion's damage): a timed ally (its KINDS row, `onDefeat` 'spent') is
  // SPENT — flagged here, lifted off the map and its contract ended by tick
  // below (never spliced out of a list a scan is walking); a released pet
  // rests in place for RECOVERY_MS, then wakes at 1 HP. Returns true when
  // the ally is gone.
  function knockedOut(scene, c, now = performance.now()) {
    c._chaseTarget = null;
    if (KINDS[c.kind]?.onDefeat === 'spent' || SpriteLayout.isSummoned(c.kind)) {
      c._spent = true;
      return true;
    }
    Pets.knockedOut(scene.save, c);
    persistSave(scene.save);
    return false;
  }
  const HOME_PET_CELLS = 2;
  function releasePolicy(scene, x, y) {
    const home = scene.homeWorldPos?.();
    return { stayHome: !!home && Math.hypot(x - home.x, y - home.y) <= HOME_PET_CELLS * scene.cellM,
      petHomeX: home?.x ?? x, petHomeY: home?.y ?? y };
  }
  function follows(c, now = performance.now()) {
    if (SpriteLayout.isSummoned(c.kind)) return !c._spent && c._followUntilT > now;
    if (Combat.isTame(c)) return !Pets.isDown(c) && !c.carried && !c.stayHome;
    return false;
  }
  function rememberPetHealth(row, creature) {
    const hp = Combat.hp(creature), lastDamagedAt = creature._lastDamagedT ?? null;
    if (row.hp === hp && (row.lastDamagedAt ?? null) === lastDamagedAt) return false;
    row.hp = hp; row.lastDamagedAt = lastDamagedAt;
    return true;
  }
  function tickPets(scene) {
    if (!scene.startWorldM || !scene.playerM || !(scene.save.released?.length)) return;
    const wall = Date.now();
    if (scene._petFollowCheck > wall) return;
    scene._petFollowCheck = wall + 1000;
    const pc = scene.playerToWorldCell(), entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
    if (!entry?.creatures) return;
    const { x: px, y: py } = playerWorldM(scene);

    const live = new Map(), owners = new Map();
    const travelling = scene._travellingPets ||= new Map();
    for (const tile of WorldGen.tileCache.values()) for (const c of tile.creatures || []) {
      if (Combat.isTame(c)) { live.set(c.id, c); owners.set(c.id,tile); }
    }
    const bodies = [{id:'player',x:px,y:py}, ...live.values()];
    let changed = false;
    for (const r of Pets.list(scene.save)) {
      if (r.carried) { travelling.delete(r.id); if (Pets.tick(scene.save,r,wall)) changed=true; continue; }
      const tracked = travelling.get(r.id);
      let c = tracked?.creature || live.get(r.id);
      if (r.stayHome == null) {
        Object.assign(r, releasePolicy(scene, r.x, r.y));
        if (c) Object.assign(c, {stayHome:r.stayHome,petHomeX:r.petHomeX,petHomeY:r.petHomeY});
        changed = true;
      }
      if (c) {
        if (Pets.tick(scene.save,c,wall)) changed=true;
        Object.assign(c, {stayHome:r.stayHome,petHomeX:r.petHomeX,petHomeY:r.petHomeY});
      } else if (Pets.tick(scene.save,r,wall)) changed=true;
      if (r.stayHome) {
        if (c && rememberPetHealth(r, c)) changed=true;
        travelling.delete(r.id);
        continue;
      }
      const cached = live.get(r.id);
      if (cached && cached !== c) {
        const owner = owners.get(r.id);
        owner.creatures.splice(owner.creatures.indexOf(cached),1);
      }
      const changedLevel = tracked && ![...WorldGen.tileCache.values()].includes(tracked.entry);
      // Catch-up transport must respect the same web hold as ordinary walking.
      if (!Combat.isParalyzed(c, wall)
        && (!c || changedLevel || Math.hypot(c.x - px, c.y - py) > CREATURE_SIM_CELLS * scene.cellM)) {
        if (tracked?.entry?.creatures) {
          const i = tracked.entry.creatures.indexOf(c);
          if (i >= 0) tracked.entry.creatures.splice(i,1);
        }
        if (c) for (const tile of WorldGen.tileCache.values()) {
          const i = tile.creatures?.indexOf(c) ?? -1;
          if (i >= 0) tile.creatures.splice(i, 1);
        }
        c = c || WorldGen.makeCreature(r.kind, px, py, r.id, {...r, _lastDamagedT:r.lastDamagedAt ?? null, ...(r.hp != null ? {_hp:r.hp} : {})});
        const point = characterFreePoint(scene,c,px,py,bodies);
        if (!point) continue;
        Object.assign(c, {x:point.x,y:point.y,_startX:point.x,_startY:point.y,_targetX:point.x,_targetY:point.y,_nextChooseT:0,_chaseTarget:null});
        entry.creatures.push(c);
        if (!bodies.includes(c)) bodies.push(c);
        owners.set(r.id,entry);
      }
      travelling.set(r.id,{creature:c,entry:owners.get(r.id) || tracked?.entry});
      if (rememberPetHealth(r, c)) changed=true;
      const tx = Math.floor(c.x / scene.tileEdgeM), ty = Math.floor(c.y / scene.tileEdgeM);
      if (r.x !== c.x || r.y !== c.y || r.tx !== tx || r.ty !== ty) {
        r.x=c.x; r.y=c.y; r.tx=tx; r.ty=ty;
        changed=true;
      }
    }
    if (changed) persistSave(scene.save);
  }
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
    const { x: px, y: py } = playerWorldM(scene);
    const pc = scene.playerToWorldCell();
    const state = row.persistHealth ? ((save.companionState ||= {})[kind] ||= {}) : {};
    if (creature) {
      const here = !!WorldGen.forEachItemNear('creatures', pc.tx, pc.ty, c => c === creature);
      const simR = CREATURE_SIM_CELLS * scene.cellM;
      const lost = !Combat.isParalyzed(creature, wall)
        && (!here || Math.hypot(creature.x - px, creature.y - py) > simR);
      if (row.persistHealth && state.hp !== Combat.hp(creature)) {
        state.hp = Combat.hp(creature);
        persistSave(save);
      }
      if (!live || creature._spent || lost) {
        (save.caught ||= []).push(creature.id);
        scene[row.instance] = null;
        // Spent is gone: the contract ends (a mercenary dies — hire again).
        if (creature._spent && live) { save[row.field] = 0; live = false; }
        if (here && (creature._spent || !live)) {
          scene.flashAtWorld(creature._spent ? row.defeated : row.expired, creature.x, creature.y);
        }
        persistSave(save);
      } else {
        creature._followUntilT = performance.now() + Math.max(0, save[row.field] - wall);
      }
    }
    if (!live || scene[row.instance]) return;
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
    if (!entry || !entry.creatures) return;
    const now = performance.now();
    creature = WorldGen.makeCreature(kind, px, py,
      `${kind}_${pc.tx}_${pc.ty}_${Math.floor(now)}_${Math.floor(Math.random() * 1e4)}`,
      { _followUntilT: now + Math.max(0, save[row.field] - wall), _nextChooseT: 0 });
    if (row.persistHealth) creature._hp = Math.max(1, Math.min(Combat.creatureMaxHp(kind), Number(state.hp) || Combat.creatureMaxHp(kind)));
    entry.creatures.push(creature);
    scene[row.instance] = creature;
  }
  function tickAll(scene) { for (const kind of Object.keys(KINDS)) tick(scene, kind); tickPets(scene); }
  root.Companions = { KINDS, RECOVERY_MS, HOME_PET_CELLS, releasePolicy, follows, knockedOut, tickPets, active, hire, tick, tickAll };
})(typeof window !== 'undefined' ? window : globalThis);
