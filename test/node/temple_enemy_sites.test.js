(() => {
  test('temple enemy sites: generated provenance survives defeats and tile reloads', () => {
    const tx = 2753, ty = 5567, N = WorldGen.cellsPerEdgeForTile(ty);
    const edge = WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(ty));
    const build = () => {
      const r = WorldGen.rasterizeTile(MVT.decodeTile(FIXTURE_TILES[`${tx}_${ty}`]), N, tx, ty, edge);
      return { ...r, status: 'ready', depth: 0, cellsPerEdge: N, tileEdgeM: edge,
        baseGrid: r.grid.slice(), genObjects: r.objects.slice(), objects: r.objects.slice(),
        wildplants: r.wildplants.slice(), parkingTreasures: r.parkingTreasures || [] };
    };
    const scene = caught => Object.assign(new SceneCreatures(), {
      tileEdgeM: edge, save: { caught },
      _pestFreeZone: () => null, _starterTrailAnchor: () => null,
      _provisionStarterHome() {}, _carveStarterPond() {},
    });
    const previous = window.__TEST_MODE;
    window.__TEST_MODE = false;
    try {
      const a = build(); scene([]).spawnInTile(a, tx, ty);
      assert.gt(a.templeEnemySites.length, 0, 'fixture contains generated enemies');
      const caught = a.templeEnemySites.map(c => c.id);
      const b = build(); scene(caught).spawnInTile(b, tx, ty);
      const signature = e => JSON.stringify(e.templeEnemySites.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      assert.eq(signature(b), signature(a), 'defeat ledger does not erase park provenance');
      assert.falsy(b.creatures.some(c => caught.includes(c.id)), 'defeated bodies remain absent');
      for (const site of b.templeEnemySites) {
        assert.truthy(Combat.isEnemyKind(site.kind));
        assert.truthy(Number.isFinite(site.x) && Number.isFinite(site.y));
      }
    } finally { window.__TEST_MODE = previous; }
  });
})();
