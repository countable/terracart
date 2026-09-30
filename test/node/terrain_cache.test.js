(function () {
  function setup() {
    const paints = [], uploads = [], removed = [];
    class Matrix { constructor() { Object.assign(this, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }); } copyFrom(m) { Object.assign(this, m); } }
    const camera = { matrix: new Matrix(), alpha: 1, roundPixels: true, renderRoundPixels: true, scrollX: 0, scrollY: 0 };
    const renderer = { type: 1, currentContext: { save() {}, restore() {}, setTransform() {}, drawImage() {} },
      batchSprite(s, f) { this.currentContext.drawImage(f.source.image); } };
    let shutdown;
    const textures = new Map();
    const scene = {
      sys: { game: { renderer } },
      add: { image() { return sprite({}); } },
      noiseContainer: { add() {} },
      events: { once(event, fn) { assert.eq(event, 'shutdown'); shutdown = fn; } },
      textures: {
        createCanvas(key, width, height) {
          const tex = { width, height, canvas: {},
            context: { setTransform() {}, clearRect() {}, drawImage(...args) { paints.push(args); } },
            setFilter() {}, refresh() { uploads.push(key); },
            setSize(w, h) { this.width = w; this.height = h; } };
          textures.set(key, tex); return tex;
        },
        exists: key => textures.has(key),
        remove(key) { removed.push(key); textures.delete(key); },
      },
    };
    const oldPhaser = window.Phaser;
    window.Phaser = { CANVAS: 1, Textures: { FilterMode: { NEAREST: 0 } } };
    const cache = new Render.TerrainCache(scene);
    cache.testRenderer = renderer; cache.testCamera = camera;
    return { cache, paints, uploads, removed, shutdown: () => shutdown(),
      close() { window.Phaser = oldPhaser; } };
  }
  function sprite(overrides) {
    return Object.assign({
      scene: {}, visible: true, isTinted: false, alpha: 1, rotation: 0,
      flipX: false, flipY: false, isCropped: false, originX: 0, originY: 0,
      x: 0, y: 0, displayWidth: 32, displayHeight: 32,
      texture: {}, frame: { source: { image: {} }, cutX: 0, cutY: 0, cutWidth: 32, cutHeight: 32 },
      setOrigin(x, y) { this.originX = x; this.originY = y; return this; },
      setVisible(v) { this.visible = v; return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      setDisplaySize(w, h) { this.displayWidth = w; this.displayHeight = h; return this; },
      setTexture(key) { this.key = key; return this; },
      destroy() { this.scene = null; },
    }, overrides);
  }
  function frame(cache, sprites, scrollX = 0, scrollY = 0) {
    cache.begin(scrollX, scrollY);
    for (const s of sprites) { s.setVisible(true); cache.offer(s, !!s.animated); }
    cache.flush();
    if (cache.image.visible) cache.renderCanvas(cache.testRenderer, cache.testCamera);
  }
  test('terrain cache: unchanged cells scroll without repaint, row phase and texture changes repaint', () => {
    const f = setup();
    try {
      const a = sprite({}), b = sprite({ x: 32 });
      frame(f.cache, [a, b]);
      assert.eq(f.paints.length, 2); assert.eq(f.uploads.length, 1);
      assert.falsy(a.visible); assert.falsy(b.visible);
      a.x -= 7; b.x -= 7;
      frame(f.cache, [a, b], -7);
      assert.eq(f.uploads.length, 1, 'common integer scroll reuses the image');
      assert.eq(f.cache.x, -7);
      b.x += 1;
      frame(f.cache, [a, b], -7);
      assert.eq(f.uploads.length, 2, 'a differently phased row repaints');
      b.frame.source.image = {};
      frame(f.cache, [a, b], -7);
      assert.eq(f.uploads.length, 3, 'replacement source invalidates even a reused frame');
      b.frame.cutX = 32;
      frame(f.cache, [a, b], -7);
      assert.eq(f.uploads.length, 4, 'a changed atlas rectangle invalidates');
      frame(f.cache, [a]);
      assert.eq(f.uploads.length, 5, 'removing a cell clears its old pixels');
      frame(f.cache, []);
      assert.falsy(f.cache.image.visible, 'an empty layer hides the previous image');
    } finally { f.close(); }
  });
  test('terrain cache: animation and tint invalidate while unsupported transforms bypass the whole layer', () => {
    const f = setup();
    try {
      const a = sprite({}), water = sprite({ x: 32 });
      frame(f.cache, [a, water]);
      water.frame = { ...water.frame, cutX: 32 };
      frame(f.cache, [a, water]);
      assert.eq(f.uploads.length, 2, 'an animation frame repaints');
      a.tintTopLeft = 0xaabbcc;
      frame(f.cache, [a, water]);
      assert.eq(f.uploads.length, 3, 'watering tint invalidates');
      for (const bad of [{ alpha: .5 }, { rotation: 1 }, { flipX: true },
        { isCropped: true }, { originX: .5 }]) {
        const live = sprite(bad);
        frame(f.cache, [a, live]);
        assert.truthy(a.visible); assert.truthy(live.visible);
        assert.falsy(f.cache.image.visible, 'no partial layer can reorder overlaps');
      }
      f.cache.enabled = false;
      frame(f.cache, [a]);
      assert.truthy(a.visible); assert.falsy(f.cache.image.visible);
      f.cache.enabled = true;
      f.cache.testRenderer.type = 2;
      frame(f.cache, [a]);
      assert.truthy(a.visible); assert.falsy(f.cache.image.visible, 'WebGL retains the source image');
    } finally { f.close(); }
  });
  test('terrain cache: scene shutdown removes its private canvas texture', () => {
    const f = setup();
    try {
      frame(f.cache, [sprite({})]);
      const key = f.cache.key;
      f.shutdown();
      assert.eq(f.removed.join(), key); assert.eq(f.cache.records.length, 0);
      assert.eq(f.cache.tex, null);
    } finally { f.close(); }
  });
  test('terrain cache: a failed bake restores the renderer context', () => {
    const f = setup();
    try {
      const renderer = f.cache.testRenderer, original = renderer.currentContext;
      renderer.batchSprite = () => { throw new Error('failed draw'); };
      let failed = false;
      try { frame(f.cache, [sprite({})]); } catch (error) { failed = error.message === 'failed draw'; }
      assert.truthy(failed);
      assert.eq(renderer.currentContext, original, 'subsequent scene draws retain the real canvas');
    } finally { f.close(); }
  });
})();
