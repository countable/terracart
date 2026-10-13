// Castle walls are ground art; towers and actors use ordinary ground order.
(() => {
  const sprite = () => ({ depth: -1, setDepth(v) { this.depth = v; return this; } });
  test('castle art: tiled teeth have square roofs seated on the cap', () => {
    const rects = [];
    const g = { color: null, fillStyle(c) { this.color = c; },
      fillRect(x, y, w, h) { rects.push({ x, y, w, h, color: this.color }); } };
    for (const id of CastleStyles.ids) {
      rects.length = 0;
      const r = CastleStyles.get(id).rampart;
      Render.paintRampartTooth(g, 10, 20, r.toothWidth, r.toothHeight, 1, 2, 3);
      const roof = rects.find(p => p.color === 2), face = rects.find(p => p.color === 1);
      assert.eq(roof.w, roof.h, 'roof has equal sides');
      assert.eq(roof.w, r.toothWidth, 'roof uses the style tooth width');
      assert.eq(roof.y + r.toothHeight, 20, 'rear foot remains on the cap');
      assert.eq(face.y + face.h, 20 + r.toothWidth, 'front face meets the cap at its front foot');
      assert.eq(r.toothWidth, r.topDepth, 'front and rear tooth faces are flush with the wall');
      assert.eq(r.toothHeight, ['ruin', 'archive'].includes(id) ? 1.5 : 2, 'merlons stand half their original height');
    }
  });
  test('castle art: clean wall faces retain only the bottom silhouette and top highlight', () => {
    const rects = [];
    const g = { color: null, fillStyle(c) { this.color = c; },
      fillRect(x, y, w, h) { rects.push({ x, y, w, h, color: this.color }); } };
    Render.paintMasonryFace(g, 0, 10, 32, 6, 1, 2, 3, false);
    const dark = rects.filter(p => p.color === 3);
    assert.eq(dark.length, 1, 'no dark course through the middle');
    assert.eq(dark[0].y, 15, 'bottom silhouette remains');
  });
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
  test('castle depth: tiled wall sections belong to the building background and reuse their pool', () => {
    const graphics = () => ({ visible: false, depth: -1,
      setVisible(v) { this.visible = v; return this; }, setDepth(v) { this.depth = v; return this; } });
    const walls = [];
    const scene = { _uprightPieces: [], _rampartPoolUsed: 0,
      add: { graphics },
      buildingWallContainer: { add(sprite) { sprite.parentContainer = this; walls.push(sprite); } },
      worldContainer: { add() { throw new Error('walls must stay out of the world layer'); } } };
    const north = Render.rampartPiece(scene, 100);
    Render.rampartPiece(scene, 107, 0);
    Render.rampartPiece(scene, 107);
    assert.eq(walls.length, 3, 'all tiled sections enter the background container');
    assert.truthy(walls.every(wall => wall.parentContainer === scene.buildingWallContainer),
      'actors always draw above tiled walls');
    scene._uprightPieces = []; scene._rampartPoolUsed = 0;
    assert.eq(Render.rampartPiece(scene, 114), north, 'tiled wall graphics reuse their pool');
    assert.eq(walls.length, 3, 'reuse adds no new wall');
    assert.eq(north.parentContainer, scene.buildingWallContainer, 'reuse preserves the background layer');
    assert.eq(scene._uprightPieces[0].groundY, 114, 'reuse reads current ground anchor');
  });
})();
