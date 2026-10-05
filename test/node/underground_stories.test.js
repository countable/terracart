test('underground stories: every draft variant has a distinct painted panel', () => {
  const ids = ['spring_cave', 'goblin_warrens', 'mushroom_cavern', 'gemstone_cavern',
    'mine_tunnels', 'root_passage', 'seep_passage', 'miners_way', 'warren_run',
    'gemstone_path', 'sm_road_passage', 'depth2_rock_scatter', 'bone_gallery'];
  const arts = new Set();
  for (const id of ids) {
    const row = UndergroundStories.KINDS[id];
    assert.truthy(row?.title && row?.body, id);
    assert.truthy(!arts.has(row.art), `${id} has its own painting`);
    arts.add(row.art);
    const dims = webpDims(`assets/art/${row.art}.webp`);
    assert.truthy(dims && Math.abs(dims.w / dims.h - 352 / 448) < .01, `${id} scene framing`);
  }
  assert.eq(UndergroundStories.KINDS.bone_gallery.body,
    'The floor is littered with bones. Perhaps you should go another way...');
});

test('underground stories: route discovery retries a busy modal and respects the story ledger', () => {
  const key = WorldGen.tileKey(71, 72), previous = WorldGen.tileCache.get(key);
  WorldGen.tileCache.set(key, { _spawned: true, cellsPerEdge: 4,
    underground: { routeAt: new Map([[5, { theme: 'bone_gallery' }]]) } });
  let calls = 0;
  const scene = { depth: 1, startWorldM: { x: 0, y: 0 }, save: { storySeen: {} },
    playerToWorldCell: () => ({ tx: 71, ty: 72, cx: 1.5, cy: 1.5 }),
    _storySplashOnce(key) { calls++; if (calls === 1) return false; this.save.storySeen[key] = true; return true; } };
  try {
    assert.falsy(UndergroundStories.tick(scene), 'busy panel retries');
    assert.truthy(UndergroundStories.tick(scene), 'next frame opens');
    assert.falsy(UndergroundStories.tick(scene), 'seen stays quiet');
    assert.eq(calls, 2);
    scene.depth = 0;
    scene.save.storySeen = {};
    assert.falsy(UndergroundStories.tick(scene), 'surface never opens cave stories');
  } finally {
    if (previous) WorldGen.tileCache.set(key, previous); else WorldGen.tileCache.delete(key);
  }
});

test('underground stories: placed nexus takes priority over crossing routes', () => {
  for (const kind of ['spring_cave', 'goblin_warrens', 'mushroom_cavern', 'gemstone_cavern', 'mine_tunnels']) {
    const entry = { cellsPerEdge: 4, caveAreas: { areas: [{ kind, reserved: new Set([5]) }] },
      underground: { routeAt: new Map([[5, { theme: 'root_passage' }], [6, { theme: 'root_passage' }]]) } };
    assert.eq(UndergroundStories.at(entry, 1, 1), UndergroundStories.KINDS[kind]);
    assert.eq(UndergroundStories.at(entry, 2, 1), UndergroundStories.KINDS.root_passage);
    assert.eq(UndergroundStories.at(entry, 0, 0), null);
  }
});
