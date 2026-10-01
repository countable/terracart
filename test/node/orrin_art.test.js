(() => {
  test('Orrin art: named role overrides old citizen variants and tints', () => {
    for (const npcVariant of [0, 1, 2]) {
      const c = { role: 'archaeologist', npcVariant, tint: 0x332211 };
      assert.eq(SpriteLayout.npcAppearance(c, 0).sheet, 'orrin_idle');
      assert.eq(SpriteLayout.npcAppearance(c, 0).tint, 0xffffff);
      assert.eq(SpriteLayout.npcSheet(c).idle, 'orrin_idle');
      assert.eq(SpriteLayout.npcAppearance({ ...c, role: 'scout' }, 0).sheet, `npc_${npcVariant}_idle`);
    }
  });
  test('Orrin art: all four directions cycle only the four authored frames', () => {
    for (const [x, y, row] of [[0, 1, 0], [0, -1, 1], [-1, 0, 2], [1, 0, 3]]) {
      const c = { role: 'archaeologist', _moving: true, _startX: 0, _startY: 0, _targetX: x, _targetY: y };
      for (let beat = 0; beat < 8; beat++) {
        const art = SpriteLayout.npcAppearance(c, beat * 260);
        assert.eq(art.sheet, 'orrin_walk');
        assert.eq(art.frame, row * 4 + beat % 4);
      }
    }
  });
})();
