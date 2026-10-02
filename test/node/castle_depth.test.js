// Castle walls are ground art; towers and actors use ordinary ground order.
(() => {
  const sprite = () => ({ depth: -1, setDepth(v) { this.depth = v; return this; } });
  test('castle depth: towers and actors keep continuous ground order without cell overrides', () => {
    const tower = { sprite: sprite(), groundY: 107, rank: 2 };
    const actor = { sprite: sprite(), groundY: 106.9, rank: 3 };
    Render.sortWorldDepth([tower, actor]);
    assert.lt(actor.sprite.depth, tower.sprite.depth, 'actor behind tower foot stays behind');
    actor.groundY = 107;
    Render.sortWorldDepth([actor, tower]);
    assert.gt(actor.sprite.depth, tower.sprite.depth, 'actor wins the ordinary foot tie');
    actor.groundY = 107.1;
    Render.sortWorldDepth([actor, tower]);
    assert.gt(actor.sprite.depth, tower.sprite.depth, 'crossing the foot paints actor in front');
  });
  test('castle depth: tiled ramparts paint onto ground and create no upright pool', () => {
    const start = RENDER_SRC.indexOf('      if (type === 12) {', RENDER_SRC.indexOf('// Tier 12 (castle)'));
    const end = RENDER_SRC.indexOf('      // South wall: tier-specific extrusion', start);
    const castle = RENDER_SRC.slice(start, end);
    assert.gt(castle.length, 0);
    assert.truthy(castle.includes('const gw = g;'), 'south wall paints on the floor graphics');
    assert.eq((castle.match(/const gb = g;/g) || []).length, 2, 'north and side walls paint on the floor graphics');
    assert.falsy(/rampartPiece|castleCell|_uprightPieces/.test(castle), 'walls require no tower-specific depth records');
  });
})();
