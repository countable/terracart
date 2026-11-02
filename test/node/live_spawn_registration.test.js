(function () {
  function world(run) {
    const N = 32, edge = N * 7, cache = WorldGen.tileCache, prior = new Map(cache);
    const entry = { _spawned: true, tileEdgeM: edge, cellsPerEdge: N, creatures: [], objects: [],
      grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS), gameplayTiers: new Uint8Array(N * N).fill(1),
      _spawnOpts: { occupied: new Set(Array.from({length: N * N}, (_, i) => i)) } };
    const scene = { depth: 0, cellM: 7, tileEdgeM: edge, cellsPerTile: N, save: { caught: [] } };
    cache.clear(); cache.set(WorldGen.tileKey(0, 0), entry);
    try { run(scene, entry); } finally { cache.clear(); for (const [key, value] of prior) cache.set(key, value); }
  }
  test('live creature placement: props permit births, solid terrain and living reservations do not', () => world((scene, entry) => {
    const point = { kind: 'goblin', id: 'triggered', x: 108.5, y: 108.5 };
    entry.objects.push({ kind: 'chest', x: point.x, y: point.y });
    const legal = () => CreatureSpawns.canPlaceAt(scene, entry, point.x, point.y, point.kind, { id: point.id, clearance: 7 });
    assert.truthy(legal());
    entry.creatures.push({ ...point, id: 'other' }); assert.falsy(legal());
    scene.save.caught.push('other'); assert.truthy(legal(), 'defeated creatures follow the controller liveness policy');
    assert.truthy(CreatureSpawns.register(entry, point)); assert.falsy(legal());
    assert.eq(CreatureSpawns.register(entry, { ...point }), null, 'same identity cannot be committed twice');
    assert.eq(entry.creatures.length, 2);
    entry.creatures = []; entry.objects[0].pushable = true; assert.falsy(legal());
    entry.objects = []; entry.grid[15 * 32 + 15] = WorldGen.T.CAVE_WALL; assert.falsy(legal());
    assert.falsy(CreatureSpawns.canPlaceAt(scene, null, point.x, point.y, point.kind));
  }));
  test('bounty restoration: passable props preserve saved seats, solid blockers defer without rerolling or duplicates', () => world((scene, entry) => {
    const at = SCENE_SRC.indexOf('  _tickGuildBounty() {'), end = SCENE_SRC.indexOf('\n  }\n', at);
    const ledger = SCENE_SRC.match(/\nconst GUILD_BOUNTY_LEDGER = [^\n]+/)[0];
    const restore = new Function(ledger + '\nreturn ({' + SCENE_SRC.slice(at, end + 4) + '})._tickGuildBounty;')();
    const key = new Function(ledger + '\nreturn GUILD_BOUNTY_LEDGER;')();
    const foe = { id: 'saved-bounty', kind: 'goblin', x: 108.5, y: 108.5, tx: 0, ty: 0 };
    scene.save.guildBounty = { id: 'contract', foes: [foe] };
    Macros.markToday(scene.save, key);
    entry.objects = [{ kind: 'rock', pushable: true, x: foe.x, y: foe.y }];
    restore.call(scene); assert.eq(entry.creatures.length, 0);
    assert.eq(scene.save.guildBounty.foes[0].x, foe.x, 'blocked restoration retains its saved request');
    entry.objects[0] = { kind: 'chest', x: foe.x, y: foe.y };
    restore.call(scene); assert.eq(entry.creatures.length, 1);
    assert.eq(entry.creatures[0].id, foe.id); assert.eq(entry.creatures[0].x, foe.x);
    restore.call(scene); assert.eq(entry.creatures.length, 1);
    scene.save.caught.push(foe.id); entry.creatures = [];
    restore.call(scene); assert.eq(entry.creatures.length, 0, 'defeated bounty never returns');
  }));
  test('bounty generation: passable prop coverage preserves the same three contract seats', () => world((scene, entry) => {
    const at = SCENE_SRC.indexOf('  _spawnGuildBounty(b, now = Date.now()) {'), end = SCENE_SRC.indexOf('\n  }\n', at);
    const ledger = SCENE_SRC.match(/\nconst GUILD_BOUNTY_LEDGER = [^\n]+/)[0];
    const spawn = new Function(ledger + '\nreturn ({' + SCENE_SRC.slice(at, end + 4) + '})._spawnGuildBounty;')();
    Object.assign(scene, { homeWorldPos: () => null,
      findWalkableDestination(dist, options) { return walkableDestination(this, 108.5, 108.5, dist, options); } });
    const contract = { id: 'three-foes', kinds: ['goblin', 'goblin', 'goblin'], pay: 10 };
    entry._spawnOpts.occupied.clear();
    assert.eq(spawn.call(scene, contract, Date.now()), 3);
    const baseline = entry.creatures.map(c => [c.id, c.x, c.y]);
    entry.creatures = [];
    entry._spawnOpts.occupied = new Set(Array.from({ length: 1024 }, (_, i) => i));
    entry.objects = baseline.map(([id, x, y]) => ({ kind: 'chest', id: 'prop-' + id, x, y }));
    assert.eq(spawn.call(scene, contract, Date.now()), 3);
    assert.eq(JSON.stringify(entry.creatures.map(c => [c.id, c.x, c.y])), JSON.stringify(baseline));
  }));
})();
