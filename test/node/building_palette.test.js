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
  assert.lt(brightness(4), 104, 'half-strength lift avoids washing out the weathered floor');
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

// Background treatment changes only colour intensity, not building condition.
test('building materials: background colours lose chroma while retaining luminance', () => {
  const channels = c => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const luminance = c => c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
  const chroma = c => Math.max(...c) - Math.min(...c);
  for (const colour of [0xae685d, 0xaa9577, 0x345728, 0x804010]) {
    const before = channels(colour), after = channels(buildingBackgroundColor(colour));
    assert.lt(chroma(after), chroma(before), 'masonry recedes through reduced colour intensity');
    assert.lt(Math.abs(luminance(after) - luminance(before)), 1, 'condition contrast keeps its lightness');
  }
  for (const gray of [0x000000, 0x171717, 0x808080, 0xffffff]) {
    assert.eq(buildingBackgroundColor(gray), gray, 'neutral ink and highlights stay neutral');
  }
});

test('building materials: background palettes preserve the original tower colours', () => {
  const original = CastleStyles.get('citadel', true);
  const before = JSON.stringify(original);
  const muted = buildingBackgroundMaterial(original);
  assert.eq(JSON.stringify(original), before, 'foreground source palette remains untouched');
  assert.truthy(muted !== original && muted.stone !== original.stone && muted.wood !== original.wood,
    'background owns separate colour tables');
  assert.eq(buildingBackgroundMaterial(original), muted, 'repeated frames reuse the palette');
});
