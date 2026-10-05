test('pet art: neutral sheets retain eyes, transparency and tonal shading', () => {
  const bytes = new Uint8ClampedArray([90, 30, 10, 255, 4, 3, 2, 255, 240, 220, 170, 128, 50, 20, 0, 0]);
  Render.neutralPetPixels(bytes);
  assert.eq([...bytes].join(), '90,90,90,255,4,4,4,255,240,240,240,128,50,20,0,0');
});
test('pet art: KO turns the body upside down around its own centre', () => {
  const s = { x: 20, y: 40, originY: 0.9, displayHeight: 30, rotation: 0,
    setOrigin(x, y) { this.originX = x; this.originY = y; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setRotation(a) { this.rotation = a; return this; } };
  Render.petDownPose(s, true);
  assert.eq(s.rotation, Math.PI); assert.eq(s.originY, 0.5); assert.eq(s.y, 28);
});
test('pet art: neutral pet cycles retain the species animation frames', () => {
  const s = { anims: { get: () => ({ frameRate: 4, frames: [{ textureFrame: 2 }, { textureFrame: 3 }] }) } };
  assert.eq(Render.petFrame(s, 'cat-idle', 0, 0), 2);
  assert.eq(Render.petFrame(s, 'cat-idle', 0, 250), 3);
  assert.eq(Render.petFrame(s, 'cat-idle', 0, 500), 2);
});
