// Castle masonry shares the moving actors' painter pass. Exercise actual
// wall-pool records through the shared sorter rather than a separate order.
(() => {
  const sprite = () => ({ visible: false, depth: -1,
    setVisible(v) { this.visible = v; return this; },
    setDepth(v) { this.depth = v; return this; },
  });
  test('castle depth: walls, turret, and crossing actor share continuous ground order', () => {
    const children = [];
    const scene = { _uprightPieces: [], _rampartPoolUsed: 0,
      add: { graphics: sprite }, worldContainer: { add(s) { children.push(s); } } };
    const north = Render.rampartPiece(scene, 100);
    const south = Render.rampartPiece(scene, 107);
    const turret = { sprite: sprite(), groundY: 107, rank: 2 };
    const actor = { sprite: sprite(), groundY: 106.9, rank: 3 };
    const pieces = [...scene._uprightPieces, turret, actor];
    Render.sortWorldDepth(pieces);
    assert.lt(north.depth, actor.sprite.depth, 'north wall is behind the actor');
    assert.lt(actor.sprite.depth, south.depth, 'actor approaching the south wall is behind it');
    assert.lt(south.depth, turret.sprite.depth, 'turret stands above its own wall at a tie');
    actor.groundY = 107.1;
    Render.sortWorldDepth(pieces);
    assert.gt(actor.sprite.depth, turret.sprite.depth, 'crossing actor passes in front within the same cell');
    assert.eq(children.length, 2, 'each wall segment is independently sortable');
  });
  test('castle depth: wall graphics reuse their pool with current world anchors', () => {
    const children = [];
    const scene = { _uprightPieces: [], _rampartPoolUsed: 0,
      add: { graphics: sprite }, worldContainer: { add(s) { children.push(s); } } };
    const first = Render.rampartPiece(scene, 100);
    scene._uprightPieces = [];
    scene._rampartPoolUsed = 0;
    const reused = Render.rampartPiece(scene, 114, 0);
    assert.eq(reused, first);
    assert.eq(children.length, 1, 'camera movement does not allocate another Graphics');
    assert.eq(scene._uprightPieces.length, 1);
    assert.eq(scene._uprightPieces[0].groundY, 114);
    assert.eq(scene._uprightPieces[0].rank, 0, 'side band tie rank remains explicit');
  });
})();
