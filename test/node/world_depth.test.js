// Characters and scenery interleave at their feet, including inside one cell.
(() => {
  const sprite = () => ({ setDepth(d) { this.depth = d; } });
  test('world depth: player, NPC and monster cross a tree baseline within the same cell', () => {
    for (const kind of ['player', 'npc', 'monster']) {
      const actor = sprite(), tree = sprite();
      for (const [y, behind] of [[100.1, true], [100.3, false]]) {
        Render.sortWorldDepth([
          { sprite: actor, groundY: y, rank: 3 },
          { sprite: tree, groundY: 100.2, rank: 1 },
        ]);
        assert.eq(actor.depth < tree.depth, behind, `${kind} y=${y}`);
      }
    }
  });
  test('world depth: exact ties are stable, and attached art can stay with its owner', () => {
    const a = { it: {}, groundY: 4, rank: 1 }, b = { sprite: sprite(), groundY: 4, rank: 3 };
    Render.sortWorldDepth([b, a]);
    assert.lt(a.it._z, b.sprite.depth);
    assert.truthy(SCENE_SRC.includes('this.worldContainer.add(this.playerWorldContainer)'));
    assert.truthy(SCENE_SRC.includes('this.playerWorldContainer.add(this.player)'));
    assert.truthy(SCENE_SRC.includes('this.playerWorldContainer.add(this.swordSwingGfx)'));
    assert.truthy(RENDER_SRC.includes('groundY: scene.startWorldM.y + scene.playerM.y'),
      'player uses world feet, not relative metres or the peek camera');
  });
  test('world depth: seated trees and centred houses use their visual ground base', () => {
    assert.eq(Render.objectGroundOffsetPx({ visible: true, foot: { footFromCentre: 15 } }), 15);
    const textures = { getFrame: () => ({ height: 80 }) };
    assert.eq(Render.objectGroundOffsetPx({ visible: true, dyPx: 0, origin: [.5, .5], scl: 1, scaleYMul: 1 }, textures), 40);
    assert.eq(Render.objectGroundOffsetPx({ visible: true, dyPx: 16, origin: [.5, 1], scl: 1, scaleYMul: 1 }, textures), 16);
    assert.eq(Render.objectGroundOffsetPx({ visible: false }), 0);
  });
})();

test('world depth: pooled staff charge follows the player and returns to the projectile layer on reuse', () => {
  const start = SCENE_SRC.indexOf('\n  _boltGlow(key,');
  const end = SCENE_SRC.indexOf('\n  }', start);
  const body = SCENE_SRC.slice(SCENE_SRC.indexOf('{', start) + 1, end);
  const draw = new Function('key', 'x', 'y', 'rPx', 'alpha', 'container', 'BOLT_GLOW_TEX_PX', body);
  const layer = () => ({ add(s) { s.parentContainer = this; }, sort() {} });
  const player = layer(), projectiles = layer();
  const image = { texture: { key: 'glow' },
    setDepth(d) { this.depth = d; return this; }, setVisible() { return this; },
    setPosition() { return this; }, setScale() { return this; }, setAlpha() { return this; } };
  const scene = { _boltPool: [image], _boltUsed: 0 };
  for (const container of [player, projectiles, player]) {
    scene._boltUsed = 0;
    draw.call(scene, 'glow', 10, 10, 8, 1, container, 64);
    assert.eq(image.parentContainer, container, 'a reused glow must follow its current owner');
  }
  assert.truthy(SCENE_SRC.includes('this.playerWorldContainer.add(this.playerHalo)'));
  assert.truthy(SCENE_SRC.includes('this.shadowContainer.add(this.walkHomeGfx)'));
});
