(function () {
  function sprite() {
    return {
      texture: { key: 'idle' },
      setTexture(key) { this.texture.key = key; return this; },
      setVisible(value) { this.visible = value; return this; },
      setAlpha(value) { this.alpha = value; return this; },
      setAngle() { return this; }, setScale() { return this; }, setFlipX() { return this; },
      clearTint() { this.tint = null; return this; },
      setTintFill(value) { this.tint = value; return this; },
      setOrigin() { return this; },
      setDisplaySize(w, h) { this.size = [w, h]; return this; },
      setPosition(x, y) { this.position = [x, y]; return this; },
    };
  }

  test('plant aura: shared disc uses gameplay radius and resets frost tint for blight', () => {
    const slot = sprite(), pool = [slot];
    const scene = { auraContainer: {} };
    const project = (x, y) => ({ x: x + 10, y: y + 20 });
    Render.renderAuras(scene, pool, [{ dx: 3, dy: 7, aura: { radiusCells: 1.5, tint: 0x99ddff } }], project);
    assert.eq(slot.texture.key, 'aura_blight');
    assert.eq(slot.size[0], 3 * CELL_PX);
    assert.eq(slot.size[1], 3 * CELL_PX);
    assert.eq(slot.position[0], 13);
    assert.eq(slot.position[1], 27);
    assert.eq(slot.tint, 0x99ddff);
    Render.renderAuras(scene, pool, [{ dx: 0, dy: 0, aura: { radiusCells: 2 } }], project);
    assert.eq(slot.tint, null, 'an untinted source never inherits the previous frost');
    assert.eq(slot.size[0], 4 * CELL_PX);
    Render.renderAuras(scene, pool, [], project);
    assert.falsy(slot.visible, 'harvested or culled plants leave no aura behind');
  });
})();
