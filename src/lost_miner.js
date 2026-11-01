// THE LOST MINER. Cobb (NPC.STORY_ROLES.miner) went down the shafts under the
// lane for ore before the roofs fell and never found the way back up. He is
// FOUND, not met: he stands on the first level under the starting trailer
// (seat, from spawnCaveCreatures — one deterministic cell per starter tile,
// out of sight of every way up) until the player speaks to him (interact).
// That talk marks the save (save.lostMiner), makes him eligible for a
// restored roof at once (save.npcMet) and sends him up after the player's
// light: he leaves the shafts when the talk closes and the trailer's
// arrivals pass seats him with the other story neighbours
// (NPC.storyNeighbourDue → Starter.placeSafeAreaWarden). Housed, his help is
// torches (NPCBenefits.GIFTS.miner). Records are per-save overlays; the cave
// itself, combat and NPC rest remain shared rules.
const LostMiner = (() => {
  const ROLE = 'miner';
  const DEPTH = 1;                // the shafts under the lane: the first level down
  const STAIR_CLEAR_CELLS = 8;    // lost: never within sight of a way up
  const LOST = '<em>Shields his eyes from your light.</em>\n“A face! Fifty years, give or take, and all I have met down here is rock and worse. Cobb. I came down for ore before the roofs fell, and the way up… went. Which way is the sky?”';
  const FOUND = '“You know the way? Then I will follow your light up. Find me a roof on the lane and I will keep you in torches. A man learns to make them, down here.”';
  const WAITING = [
    '<em>Squints at the sky.</em>\n“Daylight. I had stopped believing in it. Find me a roof on the lane and I will keep you in torches.”',
    '“Fifty years of rock, and now a street. I would take any roof that stands.”',
  ];
  const HOUSED = [
    '“A roof, and the sky where it belongs. I still make torches; old habits keep a man alive.”',
    '<em>Turns a torch in his hands.</em>\n“Down there a light is the difference between a man and a ghost. Take mine.”',
  ];
  function state(save) {
    if (!save.lostMiner || typeof save.lostMiner !== 'object') save.lostMiner = {};
    return save.lostMiner;
  }
  function found(save) { return save?.lostMiner?.status === 'found'; }
  // The starter tile's anchor, as the trailer's placer reads it; the id is
  // the starter tile's (`npc_miner_<tx>_<ty>`) above and below ground.
  function anchorOf(scene) {
    const a = scene._sandboxMode ? scene.homeWorldPos?.() : scene.save?.starterCratesAt;
    return a && Number.isFinite(a.x) && Number.isFinite(a.y) ? a : null;
  }
  function idFor(scene) {
    const a = anchorOf(scene);
    return a ? `npc_${ROLE}_${Math.floor(a.x / scene.tileEdgeM)}_${Math.floor(a.y / scene.tileEdgeM)}` : null;
  }
  // The one seat on the generated layer of the level-one tile under the
  // anchor: cave floor the NPC spawn gate allows, a stair clearance away from
  // every generated staircase, drawn by the save's id. The generated layer
  // (baseGrid, genObjects) keeps the seat where every player would find it;
  // a cell the live entry already holds is refused, never re-rolled.
  function seat(scene, entry, tx, ty, depth, creatures, occupiedIdx) {
    return WorldGen.runSteps(seatSteps(scene, entry, tx, ty, depth, creatures, occupiedIdx));
  }
  function* seatSteps(scene, entry, tx, ty, depth, creatures, occupiedIdx) {
    if (depth !== DEPTH || typeof NPC === 'undefined' || found(scene.save)) return null;
    const anchor = anchorOf(scene), id = idFor(scene);
    if (!anchor || !id) return null;
    const edge = entry.tileEdgeM || scene.tileEdgeM, N = entry.cellsPerEdge, cellM = edge / N;
    if (Math.floor(anchor.x / edge) !== tx || Math.floor(anchor.y / edge) !== ty) return null;
    if (creatures.some(c => c.id === id)) return null;
    const grid = entry.baseGrid || entry.grid;
    const stairs = (entry.genObjects || entry.objects || []).filter(o => o.kind === 'staircase' && !o._synthetic)
      .map(o => ({ cx: Math.floor((o.x - tx * edge) / cellM), cy: Math.floor((o.y - ty * edge) / cellM) }));
    const legal = [], clear = [];
    for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
      const i = cy * N + cx;
      if ((i & 255) === 0) yield 'lost miner seat';
      if (grid[i] !== WorldGen.T.CAVE_FLOOR || occupiedIdx?.has(i)) continue;
      if (!WorldGen.isSpawnCell(grid, N, N, cx, cy, entry._spawnOpts, 'npc')) continue;
      legal.push(i);
      if (!stairs.some(s => Math.max(Math.abs(s.cx - cx), Math.abs(s.cy - cy)) <= STAIR_CLEAR_CELLS)) clear.push(i);
    }
    const cells = clear.length ? clear : legal;
    if (!cells.length) return null;
    const i = cells[Math.floor(WorldGen.makeRng(fnv1a(`${id}:lost`))() * cells.length)];
    const x = tx * edge + ((i % N) + 0.5) * cellM, y = ty * edge + (Math.floor(i / N) + 0.5) * cellM;
    const c = CreatureSpawns.createOwned('npcs', id, 'npc', x, y, id, { ...NPC.storyNeighbour(id, ROLE), depth, homeX: x, homeY: y });
    creatures.push(c);
    occupiedIdx?.add(i);
    return c;
  }
  // Up after the player's light: gone from every cached shaft.
  function leave(scene, c) {
    for (const entry of WorldGen.tileCacheFor(DEPTH).values()) {
      if (entry?.creatures?.some(o => o.id === c.id)) entry.creatures = entry.creatures.filter(o => o.id !== c.id);
    }
  }
  // The talk that finds him. True when this module spoke (or held its
  // tongue for a modal or a rest); false hands the surface talk to NPC.dialogue.
  function interact(scene, c) {
    if (c?.role !== ROLE || (scene.depth || 0) !== DEPTH) return false;
    if (found(scene.save)) { leave(scene, c); return true; }
    if (MemoryStory.dialogOpen(scene) || NPC.isDormant?.(c)) return true;
    const s = state(scene.save);
    s.status = 'found';
    s.foundAt = Date.now();
    (scene.save.npcMet ||= {})[c.id] = true;
    Save.persist(scene.save);
    MemoryStory.showPages(scene, [LOST, FOUND], { ...NPC.speech(c), portrait: NPC.portrait(scene, c),
      source: NPC.dialogSource(scene, c), onDone: () => leave(scene, c) });
    return true;
  }
  // His surface talk, by day: waiting for a roof, or under one.
  function dialogue(scene, c, now = Date.now()) {
    const day = utcDayIndex(now), seed = fnv1a(`${c.id}:talk`);
    const housed = typeof NPCBenefits !== 'undefined' && NPCBenefits.homed(scene, c);
    const lines = housed ? HOUSED : WAITING;
    return lines[((seed + day) >>> 0) % lines.length];
  }
  return { ROLE, DEPTH, STAIR_CLEAR_CELLS, LOST, FOUND, WAITING, HOUSED, found, idFor, seat, seatSteps, leave, interact, dialogue };
})();
