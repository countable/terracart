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

  test('plant aura: shared circle uses default radius and resets frost art for blight', () => {
    const slot = sprite(), pool = [slot];
    const scene = { auraContainer: {} };
    const project = (x, y) => ({ x: x + 10, y: y + 20 });
    Render.renderAuras(scene, pool, [{ dx: 3, dy: 7, aura: Crops.EFFECTS.iceflower.aura }], project);
    assert.eq(slot.texture.key, 'aura_frost');
    assert.eq(slot.size[0], 2 * CELL_PX);
    assert.eq(slot.size[1], 2 * CELL_PX);
    assert.eq(slot.position[0], 13);
    assert.eq(slot.position[1], 27);
    assert.eq(auraRadiusCells(Crops.EFFECTS.iceflower.aura), 1);
    Render.renderAuras(scene, pool, [{ dx: 0, dy: 0, aura: { radiusCells: 2 } }], project);
    assert.eq(slot.texture.key, 'aura_blight', 'an untinted source never inherits the previous frost');
    assert.eq(slot.size[0], 4 * CELL_PX);
    Render.renderAuras(scene, pool, [], project);
    assert.falsy(slot.visible, 'harvested or culled plants leave no aura behind');
  });
})();
