// The sixth rebuilt home brings a hunted neighbour into the existing world.
// Records are per-save overlays; combat, death and NPC rest remain shared rules.
const StoryEncounters = (() => {
  // WHICH restore arms it: the count of restored houses the moment the one
  // just rebuilt is in the ledger. Was the fourth (the market, the end of
  // the fixed opening run — Houses.PRESEED_RESTORE_ROLES); moved two later
  // (owner, Oct 2026) so the tutorial shops settle before the first fight
  // with a name on it. The save key keeps its old name: it is a stored id.
  const ARM_AT_RESTORES = 6;
  const KEY = 'fourth_home';
  const WORRIED = 'A goblin archer has been hunting me. Please help me!';
  const THANKS = 'You stopped the archer. Thank you! Take this starfruit seed.';
  const persist = scene => { if (typeof persistSave === 'function') persistSave(scene.save); };
  function arm(scene, house) {
    if (scene.save.storyEncounter
        || Object.keys(scene.save.restoredHouses || {}).length !== ARM_AT_RESTORES) return false;
    scene.save.storyEncounter = {
      key: KEY, houseId: house.id, npcId: `story_${KEY}_${house.id}_npc`,
      enemyId: `story_${KEY}_${house.id}_archer`, status: 'hunted', greeted: false,
    };
    persist(scene);
    return true;
  }
  function busy(scene) {
    return !!scene._dialogOpen?.() || (typeof document !== 'undefined' && document.body?.classList?.contains('modal-open'));
  }
  function surfaceEntries() { return WorldGen.tileCacheFor(0); }
  function find(id) {
    for (const entry of surfaceEntries().values()) {
      const c = (entry.creatures || []).find(c => c.id === id);
      if (c) return c;
    }
    return null;
  }
  function seat(scene, x, y, kind, other) {
    const cell = scene.cellAt(x, y);
    if (!cell?.loaded) return null;
    const entry = surfaceEntries().get(WorldGen.tileKey(cell.tx, cell.ty));
    if (!entry?._spawned || !entry._spawnOpts) return null;
    const n = entry.cellsPerEdge, cm = scene.tileEdgeM / n;
    const px = (cell.tx + (cell.ix + 0.5) / n) * scene.tileEdgeM;
    const py = (cell.ty + (cell.iy + 0.5) / n) * scene.tileEdgeM;
    if (other && Math.hypot(px - other.x, py - other.y) < cm * 0.8) return null;
    if (kind !== 'npc' && scene.inHomeRing?.(px, py)) return null;
    if (WorldGen.privateVetoAt?.(cell.tx, cell.ty, cell.ix, cell.iy)) return null;
    if ((entry.creatures || []).some(c => !(scene.save.caught || []).includes(c.id) && Math.hypot(c.x - px, c.y - py) < cm * 0.8)) return null;
    const cls = kind === 'npc' ? 'npc' : creatureSpawnClass(kind);
    if (!WorldGen.isSpawnCell(entry.grid, n, n, cell.ix, cell.iy, entry._spawnOpts, cls)) return null;
    return { x: px, y: py, tx: cell.tx, ty: cell.ty };
  }
  function choose(scene, kind, other, anchor) {
    const x = anchor ? anchor.x : scene.startWorldM.x + scene.playerM.x;
    const y = anchor ? anchor.y : scene.startWorldM.y + scene.playerM.y;
    // Near the player's feet for the neighbour; inside the visible five-cell
    // half-width for the foe. Never defeat the Home ward to force a scene.
    const first = kind === 'npc' ? 1 : 3, last = kind === 'npc' ? 2 : 4;
    for (let r = first; r <= last; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const p = seat(scene, x + dx * scene.cellM, y + dy * scene.cellM, kind, other);
        if (p) return p;
      }
    }
    return null;
  }
  function materialize(scene, q, prop, kind, id) {
    const existing = find(id);
    if (existing) return existing;
    let p = q[prop];
    if (!p) return null;
    let entry = surfaceEntries().get(WorldGen.tileKey(p.tx, p.ty));
    if (!entry?._spawned) return null;
    // Rebuilt tiles can have new roads or player structures. Keep the quest
    // pending instead of putting a person or foe on newly occupied ground.
    const legal = seat(scene, p.x, p.y, kind);
    if (!legal) {
      const replacement = choose(scene, kind, q[prop === 'npc' ? 'enemy' : 'npc'], p);
      if (!replacement) return null;
      q[prop] = p = replacement;
      entry = surfaceEntries().get(WorldGen.tileKey(p.tx, p.ty));
      persist(scene);
    }
    const fields = kind === 'npc'
      ? { ...NPC.identity(id), role: 'scout', roleLabel: 'Neighbour', storyEncounter: KEY, homeX: p.x, homeY: p.y }
      : { shiny: false, storyEncounter: KEY };
    const c = WorldGen.makeCreature(kind, p.x, p.y, id, fields);
    if (kind === 'npc') NPC.restore?.(scene, c);
    (entry.creatures || (entry.creatures = [])).push(c);
    return c;
  }
  function defeated(scene, victim) {
    const q = scene.save.storyEncounter;
    if (!q || victim?.id !== q.enemyId || q.status !== 'hunted') return false;
    q.status = 'grateful';
    persist(scene);
    return true;
  }
  function tick(scene, now = Date.now()) {
    const q = scene.save.storyEncounter;
    if (!q || scene.depth > 0) return;
    if ((scene.save.caught || []).includes(q.enemyId)) defeated(scene, { id: q.enemyId });
    if (now < (scene._storyEncounterNext || 0)) return;
    scene._storyEncounterNext = now + 1000;
    if (!q.npc || (q.status === 'hunted' && !q.enemy)) {
      if (busy(scene)) return;
      const npc = q.npc || choose(scene, 'npc');
      const enemy = q.enemy || (npc && choose(scene, 'goblin_archer', npc));
      if (!npc || !enemy) return;
      q.npc = npc; q.enemy = enemy;
      persist(scene);
    }
    const c = materialize(scene, q, 'npc', 'npc', q.npcId);
    if (q.status === 'hunted') materialize(scene, q, 'enemy', 'goblin_archer', q.enemyId);
    const near = c && Math.hypot(c.x - scene.startWorldM.x - scene.playerM.x, c.y - scene.startWorldM.y - scene.playerM.y) <= scene.cellM * 5;
    if (!q.greeted && near && find(q.enemyId) && !busy(scene) && !NPC.isDormant?.(c)) {
      q.greeted = true;
      persist(scene);
      scene.showMessageModal({ title: `${c.name} · Neighbour`, body: WORRIED, art: NPC.portrait(scene, c), kind: 'note' });
    }
  }
  function interact(scene, c) {
    const q = scene.save.storyEncounter;
    if (!q || c.id !== q.npcId) return false;
    if (busy(scene) || NPC.isDormant?.(c)) return true;
    if ((scene.save.caught || []).includes(q.enemyId)) defeated(scene, { id: q.enemyId });
    let body = WORRIED;
    if (q.status === 'grateful') {
      // Defer refresh so the gift and its spent flag persist together. A full
      // bag leaves the reward claimable on the player's next visit.
      const accepted = scene.addToInv('starfruit_seed', 1, false, { notWild: true, deferRefresh: true });
      if (accepted === 1) {
        q.status = 'rewarded';
        persist(scene);
        scene._finishInventoryChange?.();
        body = THANKS;
      } else body = 'Thank you for stopping the archer. Make room in your bag; I have a starfruit seed for you.';
    } else if (q.status === 'rewarded') body = 'I feel safe again. Thank you for helping me.';
    q.greeted = true;
    persist(scene);
    scene.showMessageModal({ title: `${c.name} · Neighbour`, body, art: NPC.portrait(scene, c), kind: 'note' });
    return true;
  }
  return { arm, tick, defeated, interact, WORRIED, THANKS, ARM_AT_RESTORES };
})();
