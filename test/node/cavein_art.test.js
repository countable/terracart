test('cave-in art: the warning and permanent hole use shipped single-cell frames', () => {
  const cfg = EnvironmentHazards.CONFIG.cavein;
  const dims = pngDims('assets/Objects/HazardAnimationsV2/cavein.png');
  assert.eq(dims.w, 8 * cfg.frameSize);
  assert.eq(dims.h, 8 * cfg.frameSize);
  assert.eq(cfg.widthCells, 1); assert.eq(cfg.heightCells, 1);
  assert.lt(cfg.openFrame, 64);
  assert.lte(cfg.warningFrames, cfg.openFrame);
  assert.truthy(ASSETS_SRC.includes("cavein.png', frameWidth: 24, frameHeight: 24"));
});
