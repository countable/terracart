// Rendering must conceal the same full-cover targets as interactions, while
// retaining partial cover and reusing its darkness mask between changes.
(function () {
  function fixture() {
    let revision = 1, allocations = 0, clears = 0, samples = 0;
    const fills = [];
    const ctx = {
      globalAlpha: 1,
      clearRect() { clears++; },
      fillRect(x, y, width, height) {
        fills.push({ x, y, width, height, alpha: this.globalAlpha, colour: this.fillStyle });
      },
    };
    const visibility = { CLEAR: 0, PARTIAL: 1, FULL: 2, PARTIAL_DARKNESS: .5, FULL_DARKNESS: .88,
      revision: () => revision,
      playerCover(scene, x) { samples++; return Math.floor(x / 2) % 3; },
    };
    const document = { createElement(kind) {
      assert.eq(kind, 'canvas'); allocations++;
      return { width: 0, height: 0, getContext: () => ctx };
    } };
    const start = LIGHTING_SRC.indexOf('  function coverFrame(scene, ax, ay, W, H) {');
    const end = LIGHTING_SRC.indexOf('\n  }\n', start);
    assert.gte(start, 0, 'cover mask helper exists');
    const frame = new Function('Visibility', 'document', 'playerWorldM', 'CELL_PX',
      LIGHTING_SRC.slice(start, end + 4) + '\nreturn coverFrame;')(
      visibility, document, scene => scene.playerM, 32);
    const scene = { depth: 0, cellM: 4, playerM: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
      viewCenterX: 0, viewCenterY: 0, viewLeft: 0, viewTop: 0 };
    return { scene, frame, fills, ctx, bumpRevision() { revision++; },
      stats: () => ({ allocations, clears, samples }) };
  }

  test('cover render: full targets are removed in place, partial targets keep their order', () => {
    const start = RENDER_SRC.indexOf('Render.coverHidden = function');
    const end = RENDER_SRC.indexOf('\nRender.drawObjects =', start);
    const render = new Function('Visibility',
      'const Render = {};\n' + RENDER_SRC.slice(start, end) + '\nreturn Render;')(
      { FULL: 2, playerCover: (scene, x) => x });
    for (const field of ['o', 'p', 'tr', 'h']) {
      const list = [2, 0, 2, 1, 2].map(x => ({ [field]: { x, y: 0 } }));
      const clear = list[1], partial = list[3], original = list;
      render.cullCovered({}, list, field);
      assert.eq(list, original, 'reuse the existing sprite list');
      assert.eq(list.length, 2);
      assert.eq(list[0], clear);
      assert.eq(list[1], partial);
      assert.falsy(render.coverHidden({}, partial[field]));
      assert.truthy(render.coverHidden({}, { x: 2, y: 0 }));
    }
  });

  test('cover render: tree shadows are half dark, cave full cover is opaque', () => {
    const f = fixture();
    f.frame(f.scene, 0, 0, 32, 16);
    assert.eq(f.fills.length, 6, 'clear cells never receive darkness');
    assert.eq(f.fills[0].alpha, .5);
    assert.eq(f.fills[1].alpha, .88, 'surface terrain stays faintly readable');
    assert.truthy(f.fills.every(fill => fill.colour === '#000'));
    assert.eq(f.ctx.globalAlpha, 1, 'restore context alpha after painting');
    const surfaceCount = f.fills.length;
    f.scene.depth = 1;
    f.frame(f.scene, 0, 0, 32, 16);
    assert.eq(f.fills[surfaceCount].alpha, .5, 'partial cover remains half dark underground');
    assert.eq(f.fills[surfaceCount + 1].alpha, 1, 'full cave cover is opaque');
  });

  test('cover render: stationary and subcell camera frames reuse the mask; movement and blockers redraw', () => {
    const f = fixture();
    const first = f.frame(f.scene, 0, 0, 32, 16);
    const samples = f.stats().samples;
    const still = f.frame(f.scene, 0, 0, 32, 16);
    assert.eq(still.canvas, first.canvas);
    assert.eq(still.key, first.key);
    assert.eq(f.stats().samples, samples, 'stationary frames perform no sight sampling');
    assert.eq(f.stats().clears, 1);
    const camera = f.frame(f.scene, .25, 0, 32, 16);
    assert.eq(camera.canvas, first.canvas);
    assert.eq(f.stats().clears, 1, 'subcell camera movement changes only the blit');
    assert.eq(camera.x, -2);
    assert.truthy(camera.key !== first.key, 'lightmap must upload the changed blit position');
    f.scene.playerM.x = .25;
    const moved = f.frame(f.scene, .25, 0, 32, 16);
    assert.eq(f.stats().clears, 2, 'player movement changes sight');
    assert.truthy(moved.key !== camera.key);
    f.bumpRevision();
    const changed = f.frame(f.scene, .25, 0, 32, 16);
    assert.eq(f.stats().clears, 3, 'mining or removing a blocker changes sight');
    assert.truthy(changed.key !== moved.key);
    assert.eq(f.stats().allocations, 1, 'all updates reuse one canvas');
  });
})();
