// THE SAFE AREA'S WARDEN — one placed neighbour by the starting trailer who
// explains the safe area (EnemySpawns.homeAllows): only weak monsters live
// near Home, and nobody knows why.
(function () {
test('warden: says the one line, as a talker not a shop', () => {
  assert.eq(NPC.WARDEN_LINE, 'This is a safe area. For some reason only weak monsters live here.');
  const w = { id: 'npc_warden_1_2', kind: 'npc', ...NPC.warden('npc_warden_1_2') };
  assert.eq(w.role, 'warden'); assert.eq(w.roleLabel, 'Warden');
  const talk = NPC.dialogue({ save: {} }, w);
  assert.eq(talk.body, NPC.WARDEN_LINE, 'every day the same line');
  assert.truthy(/· Warden$/.test(talk.title), 'titled as the warden');
  assert.eq(JSON.stringify(NPC.warden('npc_warden_1_2')), JSON.stringify(NPC.warden('npc_warden_1_2')), 'a stable look');
});

test('warden: placed once by the starting trailer, a few cells out, off the spawn gate', () => {
  const N = 40, cellM = 7, tileEdgeM = N * cellM;
  const grid = new Uint8Array(N * N).fill(WorldGen.T.GRASS);
  const anchor = { x: 20.5 * cellM, y: 20.5 * cellM };
  const entry = { grid, cellsPerEdge: N, _spawned: true, objects: [], wildplants: [], creatures: [],
    roadMask: new Uint8Array(N * N), spawnWhy: new Uint8Array(N * N) };
  const scene = { tileEdgeM, save: { starterCratesAt: anchor }, _starterTrailAnchor: () => anchor };
  Starter.placeSafeAreaWarden(scene, entry, 0, 0);
  const w = entry.creatures.filter(c => c.id === 'npc_warden_0_0');
  assert.eq(w.length, 1, 'one warden');
  const d = Math.max(Math.abs(Math.floor(w[0].x / cellM) - 20), Math.abs(Math.floor(w[0].y / cellM) - 20));
  assert.inRange(d, 3, 6, 'a few cells from the trailer');
  assert.eq(w[0].role, 'warden');
  Starter.placeSafeAreaWarden(scene, entry, 0, 0);
  assert.eq(entry.creatures.filter(c => c.id === 'npc_warden_0_0').length, 1, 'idempotent');
  assert.truthy(/this\._placeSafeAreaWarden\(entry, tx, ty\)/.test(SCENE_CREATURES_SRC), 'the starter tile seats it');
});
})();
