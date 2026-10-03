// Maud, the survivor (NPC.STORY_ROLES.witness), arrives hunted by a goblin
// archer. Records are per-save overlays; combat, death and NPC rest remain
// shared rules.
const StoryEncounters = (() => {
  // WHEN it arms: her row's minMemories (Oct 2026, owner's call; it was the
  // sixth rebuilt home). She stays where she was saved; the trailer never
  // seats her (STORY_ROLES `arrives`). The save key keeps its old name: it
  // is a stored id.
  const armAtMemories = () => NPC.STORY_ROLES.witness.minMemories;
  const KEY = 'fourth_home';
  const WORRIED = 'A goblin archer has been hunting me. Please help me!';
  const THANKS = 'You stopped the archer. Thank you! Take this starfruit seed.';
  const persist = scene => Save.persist(scene.save);
  function arm(scene) {
    if (scene.save.storyEncounter || typeof MemoryStory === 'undefined'
        || MemoryStory.total(scene.save) < armAtMemories()) return false;
    scene.save.storyEncounter = {
      key: KEY, npcId: `story_${KEY}_survivor`,
      enemyId: `story_${KEY}_survivor_archer`, status: 'hunted', greeted: false,
    };
    persist(scene);
    return true;
  }
  const busy = scene => MemoryStory.dialogOpen(scene);
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
      ? { ...NPC.storyNeighbour(id, 'witness'), storyEncounter: KEY, homeX: p.x, homeY: p.y }
      : { shiny: false, storyEncounter: KEY };
    const c = WorldGen.makeCreature(kind, p.x, p.y, id, fields);
    if (kind === 'npc') NPC.restore?.(scene, c);
    (entry.creatures || (entry.creatures = [])).push(c);
    return c;
  }
  // Credit is the one kill predicate (Macros.slainByPlayer): her archer in
  // save.caught, felled by the player's side.
  function defeated(scene, victim, source = 'player') {
    const q = scene.save.storyEncounter;
    if (!q || victim?.id !== q.enemyId || q.status !== 'hunted'
        || !Macros.slainByPlayer(scene.save, q.enemyId, source)) return false;
    q.status = 'grateful';
    persist(scene);
    return true;
  }
  function tick(scene, now = Date.now()) {
    if (scene.depth > 0) return;
    arm(scene);
    const q = scene.save.storyEncounter;
    if (!q) return;
    defeated(scene, { id: q.enemyId });
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
      scene.showMessageModal({ title: `${c.name} · ${c.roleLabel}`, body: WORRIED, art: NPC.portrait(scene, c), kind: 'note' });
    }
  }
  function interact(scene, c) {
    const q = scene.save.storyEncounter;
    // Once the seed is given she speaks as the survivor (MemoryStory).
    if (!q || c.id !== q.npcId || q.status === 'rewarded') return false;
    if (busy(scene) || NPC.isDormant?.(c)) return true;
    defeated(scene, { id: q.enemyId });
    let body = WORRIED;
    if (q.status === 'grateful') {
      // Defer refresh so the gift and its spent flag persist together. A full
      // bag leaves the reward claimable on the player's next visit.
      const accepted = scene.addToInv('starfruit_seed', 1, false, { notWild: true, deferRefresh: true });
      if (accepted === 1) {
        q.status = 'rewarded';
        q.greeted = true;
        persist(scene);
        scene._finishInventoryChange?.();
        // The gift is SHOWN — the seed's own card under her portrait, her
        // thanks as its line — not described in a note (Rewards.present).
        Rewards.present(scene, { kind: 'item', id: 'starfruit_seed', qty: 1 },
          { extra: { kind: 'story', header: `${c.name} · ${c.roleLabel}`, art: NPC.portrait(scene, c), sub: THANKS } });
        return true;
      }
      body = 'Thank you for stopping the archer. Make room in your bag; I have a starfruit seed for you.';
    }
    q.greeted = true;
    persist(scene);
    scene.showMessageModal({ title: `${c.name} · ${c.roleLabel}`, body, art: NPC.portrait(scene, c), kind: 'note' });
    return true;
  }
  return { arm, tick, defeated, interact, WORRIED, THANKS, armAtMemories };
})();
