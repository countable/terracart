test('cave-in art: the warning and permanent hole use shipped single-cell frames', () => {
  const cfg = EnvironmentHazards.CONFIG.cavein;
  const dims = pngDims('assets/Objects/HazardAnimationsV2/cavein.png');
  assert.eq(dims.w, cfg.crackStages * cfg.frameSize);
  assert.eq(dims.h, cfg.frameSize);
  assert.eq(cfg.widthCells, 1); assert.eq(cfg.heightCells, 1);
  assert.eq(cfg.crackStages, 3);
  assert.eq(cfg.openTexture, 'cave_chasm');
  assert.eq(cfg.openFrame, 15, 'same isolated gap frame as L1 ground holes');
  for (const id of ['crack-a', 'crack-b']) {
    const h = { type: 'cavein', id };
    for (const [elapsedMs, frame] of [[0, 0], [1666, 0], [1667, 1], [3333, 1], [3334, 2], [4999, 2], [5000, 15]]) {
      h.elapsedMs = elapsedMs; EnvironmentHazards.update(h); assert.eq(h.frame, frame);
    }
  }
  assert.truthy(ASSETS_SRC.includes("cavein.png', frameWidth: 24, frameHeight: 24"));
});
