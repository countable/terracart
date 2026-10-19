// Baked DOM icons must clip the Phaser frame, including aliases into atlases.
(function () {
  test('icon bakes: aliased atlas frame uses source cut rectangle, not raw frame-index arithmetic', () => {
    const start = SCENE_SRC.indexOf('    const bakeSheetFrame = ');
    const end = SCENE_SRC.indexOf('\n    };', start);
    assert.truthy(start >= 0 && end > start);
    const source = { width: 512, height: 512 };
    const frame = { source: { image: source }, cutX: 192, cutY: 64, cutWidth: 16, cutHeight: 16 };
    const draws = [];
    const canvas = { getContext: () => ({ drawImage: (...args) => draws.push(args) }), toDataURL: () => 'baked' };
    const scene = { textures: { get: key => { assert.eq(key, 'alias'); return { get: index => { assert.eq(index, 2); return frame; } }; } } };
    const bake = new Function('document', SCENE_SRC.slice(start, end + 7) + '\nreturn bakeSheetFrame;')
      .call(scene, { createElement: () => canvas });
    assert.eq(bake('alias', 2, 16, 16), 'baked');
    assert.eq(draws.length, 1);
    assert.eq(draws[0][0], source);
    assert.eq(draws[0].slice(1).join(','), '192,64,16,16,0,0,16,16');
  });
})();
