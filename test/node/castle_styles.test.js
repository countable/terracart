(function () {
  test('castle materials: restoration preserves identity and restores light across every material', () => {
    const luma = c => ((c >> 16) * 0.299 + ((c >> 8) & 255) * 0.587 + (c & 255) * 0.114);
    for (const id of CastleStyles.ids) {
      const lit = CastleStyles.get(id), old = CastleStyles.get(id, false);
      assert.eq(lit.id, old.id);
      assert.eq(lit.towerFrame, old.towerFrame);
      assert.gt(luma(lit.floor), luma(old.floor) * 1.06, `${id}: floor still signals condition`);
      assert.gt(luma(old.floor), luma(old.stone.BODY) + 20, `${id}: floor contrasts with masonry`);
      for (const [a, b] of [...Object.keys(lit.stone).map(k => [lit.stone[k], old.stone[k]]), ...Object.keys(lit.wood).map(k => [lit.wood[k], old.wood[k]])]) {
        assert.gt(luma(a), luma(b) * 1.12, `${id}: condition stays visible`);
        assert.gte(luma(b), luma(a) * 0.78, `${id}: unclaimed stone remains readable`);
      }
    }
  });
  test('castle materials: broken columns stay sparse, deterministic and inside ruin courts', () => {
    const ring = [0, 0, 50, 0, 50, 80, 0, 80], cell = 10;
    const columns = CastleStyles.columnSites('ruin', ring, cell);
    assert.gte(columns.length, 3, 'a five by eight court has a few columns');
    assert.lte(columns.length, 5, 'the court remains open');
    assert.eq(JSON.stringify(columns), JSON.stringify(CastleStyles.columnSites('ruin', [...ring], cell)),
      'reloaded geometry produces identical decoration');
    for (const p of columns) {
      assert.gte(p.x, cell * 0.8); assert.lte(p.x, 50 - cell * 0.8);
      assert.gte(p.y, cell * 0.8); assert.lte(p.y, 80 - cell * 0.8);
      assert.includes([12, 16, 20], p.height);
      for (const q of columns) if (q !== p) assert.gte(Math.hypot(p.x - q.x, p.y - q.y), cell * 1.3);
    }
    for (const id of ['citadel', 'bastion', 'archive']) assert.eq(CastleStyles.columnSites(id, ring, cell).length, 0);
    assert.eq(CastleStyles.columnSites('ruin', [0, 0, 10, 0, 10, 80, 0, 80], cell).length, 0,
      'narrow courts keep their passage clear');
    const concave = [0, 0, 80, 0, 80, 20, 20, 20, 20, 80, 0, 80];
    for (const p of CastleStyles.columnSites('ruin', concave, cell)) {
      assert.truthy(p.x < 20 || p.y < 20, 'no columns in an L-shaped courtyard notch');
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
