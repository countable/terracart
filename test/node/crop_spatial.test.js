// The two render passes ask the same crop index for a depth/viewport box.
// These tests pin the live save references and the cost when a large farm sits
// outside the camera; drawing itself remains in render.js's Phaser pass.

function cropBox(save, depth, x0, y0, x1, y1) {
  const found = [];
  const work = Crops.forEachInBox(save, depth, x0, y0, x1, y1, p => found.push(p));
  return { found, work };
}

test('crop spatial index: exact box, depth, legacy surface, negatives and saved order', () => {
  const a = { x: -20, y: -20, crop: 'potato', stage: 0 };
  const b = { x: 20, y: 20, depth: 1, crop: 'potato', stage: 0 };
  const c = { x: -19, y: -19, depth: 0, crop: 'nut', stage: 1 };
  const d = { x: 20, y: 20, depth: 0, crop: 'nut', stage: 1 };
  const save = { planted: [d, a, b, c] };
  const surface = cropBox(save, 0, -20, -20, 20, 20);
  assert.eq(surface.found.length, 3);
  assert.eq(surface.found[0], d, 'saved order survives bucket traversal');
  assert.eq(surface.found[1], a, 'negative edge is included');
  assert.eq(surface.found[2], c);
  assert.eq(surface.work.rebuiltEntries, 4);
  assert.eq(cropBox(save, 1, 19, 19, 21, 21).found[0], b);
  assert.eq(cropBox(save, 0, -18, -18, 19, 19).found.length, 0,
    'a coarse bucket never leaks a crop outside the exact box');
  assert.eq(cropBox(save, 0, -20, -20, 20, 20).work.rebuiltEntries, 0);
});

test('crop spatial index: live growth and watering, and immediate mutations', () => {
  const first = { x: 1, y: 1, crop: 'potato', stage: 0, watered_t: 0 };
  const save = { planted: [first] };
  cropBox(save, 0, 0, 0, 2, 2);
  first.stage = 2;
  first.watered_t = 123;
  const warm = cropBox(save, 0, 0, 0, 2, 2);
  assert.eq(warm.found[0], first, 'index preserves the crop object');
  assert.eq(warm.found[0].stage, 2);
  assert.eq(warm.found[0].watered_t, 123);
  assert.eq(warm.work.rebuiltEntries, 0, 'field updates need no rebuild');

  const next = { x: 50, y: 50, crop: 'nut', stage: 0 };
  save.planted.push(next);
  Crops.invalidateSpatialIndex(save);
  assert.eq(cropBox(save, 0, 49, 49, 51, 51).found[0], next);
  save.planted.splice(0, 1);
  Crops.invalidateSpatialIndex(save);
  assert.eq(cropBox(save, 0, 0, 0, 2, 2).found.length, 0);
  // A remove followed by an add can retain array identity and length.
  const replacement = { x: -50, y: -50, crop: 'rainberry', stage: 0 };
  save.planted.splice(0, 1, replacement);
  Crops.invalidateSpatialIndex(save);
  assert.eq(cropBox(save, 0, -51, -51, -49, -49).found[0], replacement);
  save.planted = [{ x: 1, y: 1, crop: 'pairy', stage: 0 }];
  assert.eq(cropBox(save, 0, 0, 0, 2, 2).found[0], save.planted[0],
    'load/reset array replacement is seen without an explicit invalidation');
});

test('crop spatial index: ten thousand distant crops cost a bounded warm query', () => {
  const save = { planted: [{ x: 0, y: 0, crop: 'nut', stage: 0 }] };
  for (let i = 0; i < 10000; i++) save.planted.push({ x: 1000 + i, y: 1000, crop: 'potato', stage: 0 });
  const cold = cropBox(save, 0, -30, -30, 30, 30);
  assert.eq(cold.work.rebuiltEntries, 10001, 'cold build accounts for the full list');
  const warm = cropBox(save, 0, -30, -30, 30, 30);
  assert.eq(warm.work.rebuiltEntries, 0);
  assert.eq(warm.work.candidates, 1, 'distant farm does not grow frame work');
  assert.eq(warm.found.length, 1);
});
