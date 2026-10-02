(function () {
  test('castle materials: restoration preserves identity and restores light across every material', () => {
    const luma = c => ((c >> 16) * 0.299 + ((c >> 8) & 255) * 0.587 + (c & 255) * 0.114);
    for (const id of CastleStyles.ids) {
      const lit = CastleStyles.get(id), old = CastleStyles.get(id, false);
      assert.eq(lit.id, old.id);
      assert.eq(lit.towerFrame, old.towerFrame);
      for (const [a, b] of [[lit.floor, old.floor], ...Object.keys(lit.stone).map(k => [lit.stone[k], old.stone[k]]), ...Object.keys(lit.wood).map(k => [lit.wood[k], old.wood[k]])]) {
        assert.gt(luma(a), luma(b) * 1.25, `${id}: condition stays visible`);
      }
    }
  });
  test('castle materials: stable identity selects four families, with an unguarded bastion', () => {
    const found = new Set();
    for (let i = 0; i < 50; i++) {
      const key = `castle_${i}`;
      const first = CastleStyles.get(key);
      assert.eq(first, CastleStyles.get(key), 'material descriptor is reused');
      assert.eq(first.id, CastleStyles.variantFor(key), 'tower and wall choose identical family');
      found.add(first.id);
    }
    assert.eq(found.size, 4);
    assert.eq(CastleStyles.get('bastion').guards, false);
    assert.eq(CastleStyles.get('citadel').name, 'Citadel');
    assert.eq(CastleStyles.ids.includes('mended'), false);
  });
})();
