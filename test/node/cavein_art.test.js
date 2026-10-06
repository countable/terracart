test('cave-in art: the warning and permanent hole use shipped single-cell frames', () => {
  const cfg = EnvironmentHazards.CONFIG.cavein;
  const dims = pngDims('assets/Objects/HazardAnimationsV2/cavein.png');
  assert.eq(dims.w, cfg.crackVariants * cfg.frameSize);
  assert.eq(dims.h, cfg.frameSize);
  assert.eq(cfg.widthCells, 1); assert.eq(cfg.heightCells, 1);
  assert.eq(cfg.crackVariants, 3);
  assert.eq(cfg.openTexture, 'cave_chasm');
  assert.eq(cfg.openFrame, 15, 'same isolated gap frame as L1 ground holes');
  const frames = new Set();
  for (let i = 0; i < 30; i++) {
    const h = { type: 'cavein', id: `crack-${i}`, elapsedMs: 0 };
    EnvironmentHazards.update(h); const frame = h.frame; frames.add(frame);
    h.elapsedMs = 4999; EnvironmentHazards.update(h); assert.eq(h.frame, frame);
    h.elapsedMs = 5000; EnvironmentHazards.update(h); assert.eq(h.frame, 15);
  }
  assert.eq(frames.size, 3);
  assert.truthy(ASSETS_SRC.includes("cavein.png', frameWidth: 24, frameHeight: 24"));
});
