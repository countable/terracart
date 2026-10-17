test('lighting: the circle follows fractional player movement and ignores grid crossings', () => {
  const start = LIGHTING_SRC.indexOf('  function playerCircleContribution(');
  const end = LIGHTING_SRC.indexOf('  // Combine the cached', start);
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
