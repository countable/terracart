// The material lift preserves alpha/ink and the green sludge contrast. It is
// applied to a completed unclaimed layer, never to a restored building.
(function () {
const material = new Function(TEXTURES_SRC + '\nreturn { tuneUnclaimedMaterialPixels, UNCLAIMED_BUILDING_BASE, CASTLE_STONE, CASTLE_STONE_UNCLAIMED };')();
test('building materials: gentle unclaimed lift preserves alpha and silhouette ink', () => {
  const pixels = new Uint8ClampedArray([23,23,23,255, 99,94,70,255, 44,57,34,210, 180,180,180,0]);
  const before = [...pixels];
  material.tuneUnclaimedMaterialPixels(pixels);
  for (let i = 3; i < pixels.length; i += 4) assert.eq(pixels[i], before[i], 'alpha is unchanged');
  assert.eq([...pixels.slice(0,4)].join(','), before.slice(0,4).join(','), 'outline ink stays exact');
  assert.eq([...pixels.slice(12)].join(','), before.slice(12).join(','), 'invisible pixels stay exact');
  const brightness = at => pixels[at]*.2126 + pixels[at+1]*.7152 + pixels[at+2]*.0722;
  assert.gt(brightness(4), 94, 'the weathered floor receives a small lift');
  assert.lt(brightness(4), 115, 'the floor does not become restored pale stone');
  assert.gt(brightness(4)-brightness(8), 30, 'sludge remains visibly darker than the floor');
});
test('building materials: restored palette cannot brighten the unclaimed source', () => {
  const old = material.CASTLE_STONE.BODY.n;
  const unclaimed = material.CASTLE_STONE_UNCLAIMED.BODY.n;
  try {
    material.CASTLE_STONE.BODY.n = 0xffffff;
    assert.eq(material.CASTLE_STONE_UNCLAIMED.BODY.n, unclaimed, 'unclaimed stone preserves its original weathering');
    assert.lt(material.UNCLAIMED_BUILDING_BASE.floors[11], 0xc0c0c0, 'fort source remains its weathered floor');
  } finally { material.CASTLE_STONE.BODY.n = old; }
});
})();
