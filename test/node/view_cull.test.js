// The viewport owners in coords.js — the player point, the one projection,
// the view-box cull and the loaded-tile ring — and the render spec that is
// built once rather than per frame.
//
// Regression guard for the footprint refactor: render.js, lighting.js and the
// overlays used to spell each of these by hand (21 cull loops, five
// projections, a dozen `startWorldM.x + playerM.x`), and the lightmap's
// cookie centre and the sprite it lit each rounded their own copy.

const S = () => ({
  startWorldM: { x: 1000, y: 2000 }, playerM: { x: 30, y: -10 },
  viewCenterX: 176, viewCenterY: 176, cellM: 5,
});

test('view: playerWorldM is startWorldM + playerM, and the anchor adds only the peek', () => {
  const s = S();
  assert.eq(JSON.stringify(playerWorldM(s)), JSON.stringify({ x: 1030, y: 1990 }));
  assert.eq(JSON.stringify(viewAnchorWorldM(s)), JSON.stringify({ x: 1030, y: 1990 }), 'no peek: the anchor is the player');
  s.peekM = { x: 4, y: -6 };
  assert.eq(JSON.stringify(viewAnchorWorldM(s)), JSON.stringify({ x: 1034, y: 1984 }), 'a peek slides the anchor, not the player');
  assert.eq(playerWorldM(s).x, 1030, 'playerWorldM ignores the peek');
});

test('view: deltaMToScreen is the one projection — render.js and lighting.js read it', () => {
  const s = S();
  const p = deltaMToScreen(s, 10, -5);
  assert.eq(p.x, 176 + 2 * CELL_PX);
  assert.eq(p.y, 176 - CELL_PX);
  assert.truthy(/const project = \(dx, dy\) => deltaMToScreen\(scene, dx, dy\);/.test(RENDER_SRC),
    'drawObjects projects every sprite through it');
  assert.truthy(/const c = deltaMToScreen\(scene, L\.dx, L\.dy\);/.test(LIGHTING_SRC),
    'and the lightmap centres every cookie through it');
  assert.falsy(/viewCenterX \+ \(dx \/ scene\.cellM\) \* CELL_PX/.test(RENDER_SRC),
    'render.js keeps no projection of its own');
  // cellScreenXY: the cell-grid slot, shared by drawCells and the plateau.
  const c = cellScreenXY(s, 0, 0, 0, 0);
  assert.eq(c.x, 176); assert.eq(c.y, 176);   // slot 0's top-left, the anchor cell
  assert.eq(cellScreenXY(s, 1, 0, 0.25, 0, 3).x, Math.round(176 + 0.75 * CELL_PX + 3), 'a cell east, a quarter-cell pan, a band phase');
  assert.truthy(/cellScreenXY\(scene, col - half, row - half, fracX, fracY, bandPh\[row \+ 2\]\)/.test(LIGHTING_SRC),
    'the plateau cells sit on drawCells\' own slots');
});

test('view: inViewBox / cullToView keep the box inclusive and hand on the deltas', () => {
  assert.truthy(inViewBox(5, -5, 5), 'the edge is inside');
  assert.falsy(inViewBox(5.01, 0, 5)); assert.falsy(inViewBox(0, -5.01, 5));
  const list = [{ id: 'a', x: 12, y: 10 }, { id: 'b', x: 30, y: 10 }, { id: 'c', x: 10, y: -4 }];
  const seen = [];
  cullToView(list, 10, 10, 6, (it, dx, dy) => seen.push(`${it.id}:${dx},${dy}`));
  assert.eq(seen.join('|'), 'a:2,0', 'b is past the box sideways, c past it northward');
  assert.eq(seen.length, 1);
  // The light collectors take the same box, widened by the row's own radius.
  assert.truthy(/return inViewBox\(dx, dy, halfM \+ radiusCells\(kind\) \* scene\.cellM\);/.test(LIGHTING_SRC),
    'lighting.js inRange is inViewBox plus the row\'s radius');
  assert.falsy(/Math\.abs\(dx\) > halfM/.test(LIGHTING_SRC) || /Math\.abs\(dx\) > halfM/.test(RENDER_SRC),
    'no hand-spelled cull is left in either pass');
});

test('view: forEachLoadedTile walks the 3x3 ring in row order and skips a tile that has not landed', () => {
  const had = new Map(WorldGen.tileCache);
  try {
    WorldGen.tileCache.clear();
    WorldGen.tileCache.set(WorldGen.tileKey(4, 7), { name: 'nw' });
    WorldGen.tileCache.set(WorldGen.tileKey(5, 8), { name: 'c' });
    WorldGen.tileCache.set(WorldGen.tileKey(6, 9), { name: 'se' });
    const out = [];
    forEachLoadedTile(5, 8, (entry, tx, ty, dtx, dty) => out.push(`${entry.name}@${tx},${ty}:${dtx},${dty}`));
    assert.eq(out.join(' '), 'nw@4,7:-1,-1 c@5,8:0,0 se@6,9:1,1');
  } finally {
    WorldGen.tileCache.clear();
    for (const [k, v] of had) WorldGen.tileCache.set(k, v);
  }
  assert.falsy(/for \(let dty = -1; dty <= 1; dty\+\+\)/.test(RENDER_SRC), 'render.js walks the ring through it');
});

test('render spec: built once, opened per pass', () => {
  const scene = { textures: { exists: () => true }, save: {} };
  const a = Render.objectAppearance(scene, new Map());
  const b = Render.objectAppearance(scene, new Map());
  assert.eq(a.RENDER_SPEC, b.RENDER_SPEC, 'the table is one object, not rebuilt');
  assert.eq(a.resolveAppearance, b.resolveAppearance, 'and so is the resolver');
  assert.truthy(a.fruitList !== b.fruitList && b.fruitList.length === 0, 'the fruit list starts empty each pass');
  assert.truthy(/^const \{ RENDER_SPEC, resolveAppearance, _houseRole, _houseKey, _houseScale, _houseBaseScale \} = \(\(\) => \{/m.test(RENDER_SRC),
    'the spec is a module-level table');
  assert.truthy(/const \{ fruitList \} = Render\.objectAppearance\(scene, houseRoles\);/.test(RENDER_SRC),
    'drawObjects opens the pass and reads only the per-pass list');
});
