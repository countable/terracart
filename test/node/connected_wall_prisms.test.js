// Heading-up draws connected stronghold walls and hedge walls as retained,
// ground-attached prisms (render.js drawConnectedWallPrisms) instead of
// billboarded connected-frame sprites; north-up keeps the sprite sheets.
(() => {
  // 8 px cells: TILE_PX 256 / 32 cells; cellM 5 → mPerPx 5/8.
  function makeScene() {
    const list = [];
    return { _headingUp: true, depth: 0, mapRot: 0, list,
      startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 }, mPerPx: 5 / 8,
      cellsPerTile: 32, cellM: 5, playerM: { x: 0, y: 0 },
      viewCenterX: 176, viewCenterY: 176, viewLeft: 0, viewTop: 0, viewSize: 352,
      buildingWallContainer: { add(g) { list.push(g); } },
      add: { graphics() { return { visible: true, clears: 0, triangles: [], color: 0,
        clear() { this.clears++; this.triangles.length = 0; return this; },
        fillStyle(c) { this.color = c; return this; },
        fillTriangle(...points) { this.triangles.push({ color: this.color, points }); return this; },
        setPosition(x, y) { this.x = x; this.y = y; return this; } }; } } };
  }
  const wallAt = (cx, cy, variant) => ({ kind: 'stronghold_wall', id: `w${cx}_${cy}`, variant,
    x: (cx + 0.5) * 5, y: (cy + 0.5) * 5 });
  const hedgeAt = (cx, cy, frame) => ({ crop: 'shrub', wildId: `h${cx}_${cy}`, _plantArt: 'zone_hedge',
    _hedgeFrame: frame, x: (cx + 0.5) * 5, y: (cy + 0.5) * 5 });
  const same = (a, b, m) => assert.eq(a.join(','), b.join(','), m);
  const item = o => ({ o, dx: 0, dy: 0 });
  const plant = p => ({ p, dx: 0, dy: 0 });

  test('connected wall prisms: footprints run from the core to every connected cell edge', () => {
    const core = Render.connectedWallFootprints(0, 8);
    assert.eq(core.length, 1);
    same(core[0], [12, 12, 20, 20], 'core block is centred');
    const straight = Render.connectedWallFootprints(10, 8);
    assert.eq(straight.length, 3);
    same(straight[1], [20, 12, 32, 20], 'east arm reaches the east edge');
    same(straight[2], [0, 12, 12, 20], 'west arm starts at the west edge');
    const cross = Render.connectedWallFootprints(15, 16);
    assert.eq(cross.length, 5);
    same(cross[1], [8, 0, 24, 8], 'north arm reaches the north edge');
    same(cross[3], [8, 24, 24, 32], 'south arm reaches the south edge');
  });

  test('connected wall prisms: only connected walls and hedges are pieces', () => {
    const wall = Render.connectedWallPiece(wallAt(0, 0, 0), { variant: 0 });
    assert.eq(wall.art, Render.CONNECTED_WALL_ART.stronghold_wall);
    assert.eq(wall.mask, 10, 'straight east-west wall');
    assert.eq(Render.connectedWallPiece(wallAt(0, 0, 0), { kind: 'mineralrock' }), null, 'isolated wall keeps its rubble sprite');
    assert.eq(Render.connectedWallPiece(wallAt(0, 0, undefined), undefined), null);
    assert.eq(Render.connectedWallPiece(wallAt(0, 0, 11), undefined).mask, 4, 'the plan frame serves without a connected-art record');
    const hedge = Render.connectedWallPiece(hedgeAt(0, 0, 1), null);
    assert.eq(hedge.art, Render.CONNECTED_WALL_ART.hedge);
    assert.eq(hedge.mask, 5, 'straight north-south hedge');
    assert.eq(Render.connectedWallPiece({ ...hedgeAt(0, 0, 0), _plantArt: 'zone_hedge_single', _hedgeFrame: undefined }, null), null, 'a lone bush is not a wall');
    assert.eq(Render.connectedWallPiece({ crop: 'shrub', _plantArt: 'ordinary' }, null), null);
    assert.eq(Render.connectedWallPiece({ kind: 'mineralrock', variant: 0 }, { variant: 0 }), null);
  });

  test('connected wall prisms: heading-up moves connected pieces from the sprite pools to the wall batch', () => {
    const s = makeScene();
    const items = [item(wallAt(0, 0, 0)), item(wallAt(1, 0, 0)), item({ kind: 'tree', id: 't', x: 12.5, y: 12.5 })];
    const art = new Map([[items[0].o, { variant: 0 }], [items[1].o, { variant: 0 }]]);
    const plants = [plant(hedgeAt(0, 2, 0)), plant({ crop: 'shrub', wildId: 'b', _plantArt: 'zone_hedge_single', x: 7.5, y: 17.5 })];
    const drawn = Render.drawConnectedWallPrisms(s, items, plants, art);
    assert.eq(drawn.size, 3);
    assert.truthy(drawn.has(items[0]) && drawn.has(items[1]) && drawn.has(plants[0]));
    assert.falsy(drawn.has(items[2]), 'a tree stays a sprite');
    assert.falsy(drawn.has(plants[1]), 'a lone bush stays a sprite');
    const group = s._wallPerspective.props;
    assert.eq(group.blocks.length, 3, 'one joined material mesh per cell');
    const wallHeight = ObstacleStep.PROFILES.wall.liftPx, hedgeHeight = ObstacleStep.PROFILES.hedge.liftPx;
    assert.eq(group.blocks.filter(b => b.top === wallHeight).length, 2, 'walls rise by their step-over lift');
    assert.eq(group.blocks.filter(b => b.top === hedgeHeight).length, 1, 'hedges rise by their step-over lift');
    assert.truthy(group.gfx.triangles.length > 0, 'the batch painted');
  });

  test('connected wall prisms: neighbouring pieces share their seam exactly and the batch is retained while panning', () => {
    const s = makeScene();
    const items = [item(wallAt(0, 0, 0)), item(wallAt(1, 0, 0))];
    const art = new Map([[items[0].o, { variant: 0 }], [items[1].o, { variant: 0 }]]);
    Render.drawConnectedWallPrisms(s, items, [], art);
    const group = s._wallPerspective.props;
    const byX = group.blocks.slice().sort((a, b) => a.x - b.x);
    const left = byX[0], right = byX[1], seam = Math.max(...left.points.map(p => p.x));
    assert.eq(seam, Math.min(...right.points.map(p => p.x)), 'neighbours meet at their cell edge');
    const capAt = block => [...new Set(block.materialFaces.flatMap(f => f.points)
      .filter(p => p.z === block.top && Math.abs(p.x - seam) < 1e-8).map(p => p.y.toFixed(8)))].sort();
    same(capAt(left), capAt(right), 'bevel cap endpoints agree across the joined cells');
    assert.eq(right.x - left.x, CELL_PX, 'walls remain centred on their data cells');
    const clears = group.gfx.clears, blocks = group.blocks.slice();
    s.playerM = { x: 1, y: 0 };   // snaps to the 6.4 px/m pixel grid: 6 px into the cell
    Render.drawConnectedWallPrisms(s, items, [], art);
    assert.eq(group.gfx.clears, clears, 'a sub-cell pan does not rebuild');
    assert.eq(group.blocks[0], blocks[0], 'geometry is retained');
    assert.eq(group.gfx.x, -6, 'the pan scrolls the batch');
    s.playerM = { x: 5, y: 0 };
    Render.drawConnectedWallPrisms(s, items, [], art);
    assert.eq(group.gfx.clears, clears + 1, 'crossing a cell rebuilds once');
    Render.drawConnectedWallPrisms(s, items.slice(0, 1), [], art);
    assert.eq(group.blocks.length, 1, 'a removed piece leaves the batch');
  });

  test('connected wall prisms: north-up and underground keep the sprites', () => {
    const s = makeScene();
    const items = [item(wallAt(0, 0, 0))], art = new Map([[items[0].o, { variant: 0 }]]);
    Render.drawConnectedWallPrisms(s, items, [], art);
    assert.eq(s._wallPerspective.props.blocks.length, 1);
    s._headingUp = false;
    assert.eq(Render.drawConnectedWallPrisms(s, items, [], art).size, 0);
    assert.eq(s._wallPerspective.props.blocks.length, 0, 'leaving heading-up empties the batch');
    s._headingUp = true; s.depth = 1;
    assert.eq(Render.drawConnectedWallPrisms(s, items, [], art).size, 0);
  });

  test('connected wall prisms: the sprite pools skip prism-drawn pieces', () => {
    assert.truthy(RENDER_SRC.includes('const prismDrawn = Render.drawConnectedWallPrisms(scene, filteredObj, plantedList, connectedArt)'));
    assert.truthy(RENDER_SRC.includes("it.o.kind !== 'tower' && !prismDrawn.has(it)"));
    assert.truthy(RENDER_SRC.includes('plantedList.filter(it => !prismDrawn.has(it))'));
  });
})();
