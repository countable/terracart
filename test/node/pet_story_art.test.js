test('pet story art: composes a full 4:3 painting without stretching the clearing', () => {
  const originalCreate = document.createElement;
  const canvases = [];
  const background = { width: 432, height: 324 };
  const sprite = { width: 1, height: 1 };
  const frame = { width: 1, height: 1, cutX: 0, cutY: 0, source: { image: sprite } };
  document.createElement = () => {
    const draws = [];
    const context = {
      drawImage: (...args) => draws.push(args),
      getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }),
      putImageData() {}, beginPath() {}, ellipse() {}, fill() {},
    };
    const canvas = { draws, getContext: () => context, toDataURL: () => 'data:image/png;pet' };
    canvases.push(canvas);
    return canvas;
  };
  try {
    const scene = { textures: {
      exists: () => true,
      get: key => key === 'pet_story_clearing'
        ? { getSourceImage: () => background }
        : { frameTotal: 1, get: () => frame },
    } };
    assert.eq(PetStoryArt.forKind(scene, 'chicken'), 'data:image/png;pet');
    const painting = canvases[1];
    assert.eq(painting.width / painting.height, 4 / 3);
    assert.eq(painting.draws[0][0], background);
    assert.eq(painting.draws[0][3], painting.width);
    assert.eq(painting.draws[0][4], painting.height);
    const pet = painting.draws[1];
    assert.gte(pet[6], 0, 'pet top is inside the painting');
    assert.lte(pet[6] + pet[8], painting.height, 'pet feet are inside the painting');
  } finally {
    document.createElement = originalCreate;
  }
});
