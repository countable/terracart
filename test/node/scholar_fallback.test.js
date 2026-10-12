(function () {
  const poi = (id, poiClass, extra = {}) => ({ kind: 'chest', id, poiClass, x: 0, y: 0, ...extra });

  test('scholar fallback: one stable scriptorium becomes a scholar without changing its source identity', () => {
    const library = poi('a-library', 'library', { tierSeed: 3 });
    const college = poi('z-college', 'college');
    const objects = [college, library, poi('shop', 'shop')];
    assert.eq(chestLook(library).texKey, 'macro_scriptorium', 'prime the old look');
    assert.eq(WorldGen.assignScholarFallback(objects), library);
    assert.eq(chestLook(library).texKey, 'macro_scholar', 'refresh the cached look');
    assert.eq(macroFor(college).kind, 'scriptorium');
    assert.eq(macroFor(objects[2]).kind, 'sundries');
    assert.eq(library.poiClass, 'library');
    assert.eq(library.id, 'a-library');
    assert.eq(library.tierSeed, 3);
    assert.eq(WorldGen.assignScholarFallback([...objects].reverse()), library, 'reorder and revisit keep the selection');
    assert.eq(objects.filter(o => o.scholarFallback).length, 1);
    assert.eq(macroFor({ ...library, depth: 1 }), null, 'underground remains a chest even with a copied flag');
  });

  test('scholar fallback: existing scholars win and only surface service counters qualify', () => {
    const library = poi('library', 'library');
    WorldGen.assignScholarFallback([library]);
    assert.eq(WorldGen.assignScholarFallback([library, poi('school', 'school')]), null);
    assert.eq(macroFor(library).kind, 'scriptorium', 'a school replaces the fallback');
    const excluded = [poi('cave', 'library', { depth: 1 }), poi('crate', 'college', { crate: true }),
      poi('scripted', 'library', { fixedLoot: { id: 'wood', qty: 1 } })];
    assert.eq(WorldGen.assignScholarFallback(excluded), null);
    assert.eq(WorldGen.assignScholarFallback([]), null);
    const surface = poi('surface', 'library');
    assert.eq(WorldGen.assignScholarFallback([poi('school-cave', 'school', { depth: 1 }), surface]), surface);
  });

  test('scholar fallback: tile generation promotes a library only when no school counter survives', () => {
    const generate = (classes) => WorldGen.rasterizeTile([
      { name: 'landcover', features: [{ type: 3, tags: { class: 'grass' },
        geom: [[{ x: -64, y: -64 }, { x: 4160, y: -64 }, { x: 4160, y: 4160 }, { x: -64, y: 4160 }, { x: -64, y: -64 }]] }] },
      { name: 'poi', features: classes.map((cls, i) => ({ type: 1, tags: { class: cls, name: cls },
        geom: [[{ x: 1024 + i * 1024, y: 2048 }]] })) },
    ], 64, 0, 0, 640).objects.filter(o => o.kind === 'chest' && !o.chestTopUp);
    const libraries = generate(['library', 'college']);
    assert.eq(libraries.filter(o => macroFor(o)?.kind === 'scholar').length, 1);
    assert.eq(libraries.filter(o => macroFor(o)?.kind === 'scriptorium').length, 1);
    const withSchool = generate(['library', 'school']);
    assert.eq(macroFor(withSchool.find(o => o.poiClass === 'library')).kind, 'scriptorium');
    assert.eq(withSchool.filter(o => o.scholarFallback).length, 0);
  });
}());
