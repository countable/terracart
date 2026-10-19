function authoredScenario() {
  return { version: 1, id: 'sewer-grove', title: 'Sewer grove', depth: 1,
    width: 4, height: 3, seed: 7, mode: 'tile',
    cells: [['wall', 'ground', 'water', 'wall'], ['ground', 'accent', 'path', 'ground'],
      ['ground', 'ground', 'ground', 'ground']],
    props: [{ x: 0, y: 2, kind: 'pipe', artKey: 'pipe' }],
    creatures: [{ x: 3, y: 2, kind: 'slime' }],
    art: { tiles: { ground: 'data:image/png;base64,YQ==' },
      props: { pipe: { uri: 'data:image/png;base64,YQ==' } } },
    returnUrl: 'http://localhost:8765/zone-variants/#ambient-L1' };
}
test('scenario sandbox: terrain, art and authored inhabitants share a padded tile', () => {
  const built = SandboxScenarios.build(authoredScenario()), e = built.entries[1], n = e.cellsPerEdge;
  assert.eq(n, 6);
  assert.eq(e.grid[n + 3], WorldGen.T.WATER);
  assert.eq(e.grid[2 * n + 2], WorldGen.T.CAVE_FLOOR);
  assert.eq(e.grid[0], WorldGen.T.CAVE_WALL);
  assert.eq(e.sandboxCells[n + 3], 'water');
  assert.eq(e.objects[0].sandboxArtKey, 'pipe');
  assert.eq(e.objects[0].sandboxDepth, 1);
  assert.eq(e.creatures[0].kind, 'slime');
  assert.truthy(e._spawned);
  const { home } = built.options, i = Math.floor(home.y) * n + Math.floor(home.x);
  assert.truthy(WorldGen.isWalkable(e.grid[i]));
  assert.truthy(e.grid[i] !== WorldGen.T.WATER);
  assert.truthy(built.entries[0]);
  const again = SandboxScenarios.build(authoredScenario());
  assert.eq(again.entries[1].creatures[0].id, e.creatures[0].id);
});
test('scenario sandbox: invalid maps and active image/link schemes fail before transfer', () => {
  for (const mutate of [s => s.cells[0].pop(), s => s.depth = 8,
    s => s.art.tiles.ground = 'https://external.example/image.png',
    s => s.art.tiles.ground = 'data:image/svg+xml;base64,YQ==',
    s => s.returnUrl = 'javascript:alert(1)', s => s.props[0].artKey = 'missing',
    s => s.creatures[0].x = 50, s => s.creatures[0].kind = 'imaginary_foo', s => s.cells = s.cells.map(row => row.map(() => 'water'))]) {
    const value = authoredScenario(); mutate(value);
    let rejected = false;
    try { SandboxScenarios.build(value); } catch (_) { rejected = true; }
    assert.truthy(rejected);
  }
});
test('scenario sandbox: explicit inhabitants keep identities when placements reorder', () => {
  const s = authoredScenario(); s.creatures.push({ x: 1, y: 2, kind: 'bat' });
  const ids = SandboxScenarios.build(s).entries[1].creatures.map(c => c.id).sort();
  s.creatures.reverse();
  assert.eq(JSON.stringify(SandboxScenarios.build(s).entries[1].creatures.map(c => c.id).sort()), JSON.stringify(ids));
});
test('scenario sandbox: shared transfer retains typed terrain, art and return metadata', () => {
  const originalStorage = globalThis.sessionStorage;
  let saved;
  globalThis.sessionStorage = { setItem: (_, value) => saved = value, getItem: () => saved };
  try {
    FloorSandbox.writeScenario(authoredScenario());
    const data = FloorSandbox.read();
    assert.truthy(data.entries[1].grid instanceof Uint8Array);
    assert.truthy(data.entries[1].poiPadCells instanceof Set);
    assert.eq(data.entries[1].sandboxArt.props.pipe.uri, 'data:image/png;base64,YQ==');
    assert.eq(data.title, 'Sewer grove');
    assert.eq(data.returnUrl, 'http://localhost:8765/zone-variants/#ambient-L1');
    assert.truthy(data.scenario);
  } finally { globalThis.sessionStorage = originalStorage; }
});
test('scenario sandbox: lava remains dangerous terrain and never becomes the starting cell', () => {
  const s = authoredScenario(); s.depth = 6; s.cells[1][1] = 'lava';
  const built = SandboxScenarios.build(s), e = built.entries[6], n = e.cellsPerEdge;
  assert.eq(e.grid[2 * n + 2], WorldGen.T.CAVE_LAVA);
  const h = built.options.home;
  assert.truthy(e.grid[Math.floor(h.y) * n + Math.floor(h.x)] !== WorldGen.T.CAVE_LAVA);
  s.creatures[0] = { kind: 'slime', x: 1, y: 1 };
  let rejected = false;
  try { SandboxScenarios.build(s); } catch (_) { rejected = true; }
  assert.truthy(rejected);
});
test('scenario sandbox: automatic Home hooks preserve authored surface props and terrain', () => {
  const original = FloorSandbox.isScenario;
  FloorSandbox.isScenario = () => true;
  try {
    const s = authoredScenario(); s.depth = 0;
    const e = SandboxScenarios.build(s).entries[0], originalGrid = Array.from(e.grid).join();
    const scene = { depth: 0, save: { starterCratesAt: { x: 20, y: 20 },
      starterShopId: 'fixture-home', starterTrailer: { id: 'fixture-home', x: 20, y: 20 } },
      tileEdgeM: e.tileEdgeM };
    // Without the guard these would enter Home adoption/insertion and require
    // scene methods, then replace authored cells and remove nearby props.
    liftSceneMethod('ensureStarterShopId').call(scene);
    liftSceneMethod('ensureStarterTrailerObject').call(scene);
    assert.falsy(HomeVariant.apply(scene, e, 0, 0));
    assert.eq(e.objects.length, 1);
    assert.eq(Array.from(e.grid).join(), originalGrid);
    assert.falsy(scene._starterShopOk);
  } finally { FloorSandbox.isScenario = original; }
});
