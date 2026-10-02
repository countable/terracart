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
  test('castle depth: tiled sections share wall, tower, and actor ground ordering', () => {
    const graphics = () => ({ visible: false, depth: -1,
      setVisible(v) { this.visible = v; return this; }, setDepth(v) { this.depth = v; return this; } });
    const scene = { _uprightPieces: [], _rampartPoolUsed: 0,
      add: { graphics }, worldContainer: { add() {} } };
    const north = Render.rampartPiece(scene, 100);
    const side = Render.rampartPiece(scene, 107, 0);
    const south = Render.rampartPiece(scene, 107);
    const tower = { sprite: sprite(), groundY: 107, rank: 2 };
    const actor = { sprite: sprite(), groundY: 106.9, rank: 3 };
    const pieces = [...scene._uprightPieces, tower, actor];
    Render.sortWorldDepth(pieces);
    assert.lt(north.depth, actor.sprite.depth, 'north wall stays behind approaching actor');
    assert.lt(actor.sprite.depth, side.depth, 'side sorts by its southern endpoint');
    assert.lt(side.depth, south.depth, 'horizontal wall wins the exact corner tie');
    assert.lt(south.depth, tower.sprite.depth, 'tower wins only the ordinary exact foot tie');
    actor.groundY = 107.1;
    Render.sortWorldDepth(pieces);
    assert.gt(actor.sprite.depth, south.depth, 'actor crossing ground foot passes in front');
    scene._uprightPieces = []; scene._rampartPoolUsed = 0;
    assert.eq(Render.rampartPiece(scene, 114), north, 'tiled wall graphics reuse their pool');
    assert.eq(scene._uprightPieces[0].groundY, 114, 'reuse reads current ground anchor');
  });
})();
