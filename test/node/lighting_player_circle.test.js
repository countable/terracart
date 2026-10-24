test('lighting: the circle follows fractional player movement and ignores grid crossings', () => {
  const start = LIGHTING_SRC.indexOf('  function playerCircleContribution(');
  const end = LIGHTING_SRC.indexOf('  // Colour the single', start);
  const arcs = [];
  const document = { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ clearRect() {}, beginPath() {}, fill() {},
      arc(...args) { arcs.push(args); } }) }) };
  const draw = new Function('document', LIGHTING_SRC.slice(start, end) + '; return playerCircleContribution;')(document);
  const scene = {};
  const first = draw(scene, 400, 400, 10, 20, { x: 100.25, y: 120.75 }, 80);
  assert.eq(arcs[0][0], 90.25, 'fractional x stays exact');
  assert.eq(arcs[0][1], 100.75, 'fractional y stays exact');
  assert.eq(first.items[0].weight, 1, 'one full-strength circle, no old-position fade');
  assert.falsy(draw(scene, 400, 400, 10, 20, { x: 100.25, y: 120.75 }, 80).rebuilt, 'still circle reuses its mask');
  draw(scene, 400, 400, 10, 20, { x: 100.5, y: 120.9 }, 80);
  assert.eq(arcs[1][0], 90.5, 'subpixel movement repaints the centre');
  assert.eq(arcs[1][2], 80, 'movement does not change the radius');
  assert.eq(draw(scene, 400, 400, 10, 20, { x: 100.5, y: 120.9 }, 0).items.length, 0, 'zero reach hides the circle');
  assert.truthy(LIGHTING_SRC.includes('playerCircleContribution(scene, W, H, ox, oy, ps, plateau ? r0 : 0)'), 'live draw uses the player-centred circle');
});

test('lighting: coloured reach mask survives world repaint and invalidates all paint inputs', () => {
  const start = LIGHTING_SRC.indexOf('  function paintReachContribution(');
  const end = LIGHTING_SRC.indexOf('  // One exact copy', start);
  let paints = 0, blits = 0;
  const document = { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ clearRect() {}, drawImage() {}, fillRect() { paints++; } }) }) };
  const draw = new Function('document', 'plateauFill', 'REACH_OUTPUT_K',
    LIGHTING_SRC.slice(start, end) + '; return paintReachContribution;')(document, () => 'gradient', 1);
  const output = { drawImage() { blits++; } }, scene = {};
  const item = { canvas: {}, revision: 1 };
  const contribution = { items: [item] };
  const prof = { lit: 1, edge: .2, litColour: 0xffffff };
  const ps = { x: 100.25, y: 120.75 };
  const paint = (w = 400, h = 400) => draw(output, scene, contribution, prof, ps, 10, 20, 80, w, h);
  paint(); paint();
  assert.eq(paints, 1, 'unrelated world-light repaints reuse the coloured mask');
  assert.eq(blits, 2, 'every lightmap still receives the reach contribution');
  for (const change of [() => ps.x += .25, () => ps.y += .25,
    () => prof.lit = .8, () => prof.edge = .1, () => prof.litColour = 0xffaaaa,
    () => item.revision++, () => item.canvas = {}]) {
    const before = paints;
    change(); paint(); paint();
    assert.eq(paints, before + 1, 'changed geometry, mask or colour repaints exactly once');
  }
  paint(500); paint(500, 600);
  assert.eq(paints, 10, 'each viewport dimension invalidates the composite');
  const before = blits;
  draw(output, scene, { items: [] }, prof, ps, 10, 20, 80, 500, 600);
  assert.eq(blits, before, 'zero reach never blits stale cached light');
});
