// BAKED GRAPHICS (render.js BakedGfx): the grid and the biome borders are
// painted into a canvas texture shown as one image, instead of a Graphics
// command list Phaser replays every frame (render-loop audit, finding 1).
// These tests drive the real class against a recording 2D context and a stub
// scene, and pin the wiring as source text (app.js can't load headlessly).

(function () {
if (typeof CELL_PX === 'undefined') globalThis.CELL_PX = 32;

function stubScene(view = { left: 19, top: 100, size: 352 }) {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }),
    set: (t, k, v) => { t[k] = v; calls.push(['=' + String(k), v]); return true; },
  });
  const tex = { width: 0, height: 0, context: ctx, refreshed: 0,
    refresh() { this.refreshed++; }, setFilter() {}, setSize(w, h) { this.width = w; this.height = h; } };
  const image = { x: 0, y: 0, w: 0, h: 0, key: null,
    setOrigin() { return this; }, setTexture(k) { this.key = k; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setDisplaySize(w, h) { this.w = w; this.h = h; return this; } };
  const scene = {
    viewLeft: view.left, viewTop: view.top, viewSize: view.size,
    add: { image: () => image },
    textures: { exists: () => false, get: () => tex,
      createCanvas: (k, w, h) => { tex.width = w; tex.height = h; return tex; } },
  };
  const container = { kids: [], add(o) { this.kids.push(o); } };
  return { scene, container, tex, image, calls };
}

test('baked gfx: the canvas covers the view plus its pad, seated in game pixels', () => {
  const { scene, container, tex, image } = stubScene();
  const g = new Render.BakedGfx(scene, 'k', container);
  assert.eq(container.kids.length, 1, 'ONE image in the layer\'s container');
  g.clear();
  const pad = 2 * CELL_PX;
  assert.eq(image.x, 19 - pad);
  assert.eq(image.y, 100 - pad);
  assert.eq(image.w, 352 + 2 * pad, 'drawn at the view size plus the pad, whatever the canvas resolution');
  assert.eq(tex.width, 352 + 2 * pad, 'at renderScale 1 the canvas is 1:1');
});

test('baked gfx: calls land in the canvas in game coordinates, one upload per rebuild', () => {
  const { scene, container, tex, calls } = stubScene();
  const g = new Render.BakedGfx(scene, 'k', container);
  g.clear();
  const setT = calls.filter((c) => c[0] === 'setTransform');
  assert.eq(JSON.stringify(setT[setT.length - 1]), JSON.stringify(['setTransform', 1, 0, 0, 1, -(19 - 64), -(100 - 64)]),
    'the transform maps game px onto the canvas');
  g.fillStyle(0xff8800, 0.5).fillRect(10, 20, 30, 40);
  assert.truthy(calls.some((c) => c[0] === '=fillStyle' && c[1] === 'rgba(255,136,0,0.5)'), 'fill colour + alpha');
  assert.truthy(calls.some((c) => c[0] === 'fillRect' && c.slice(1).join() === '10,20,30,40'), 'the rect as given');
  g.lineStyle(1, 0x000000, 0.08).lineBetween(5, 0, 5, 4);
  assert.truthy(calls.some((c) => c[0] === '=lineCap' && c[1] === 'butt'), 'butt-ended, like Phaser\'s line quad');
  assert.truthy(calls.some((c) => c[0] === 'stroke'), 'the dash is stroked');
  g.fillCircle(50, 50, 3);
  assert.truthy(calls.some((c) => c[0] === 'arc' && c.slice(1, 4).join() === '50,50,3'), 'a circle is one arc fill');
  g.flush(); g.flush();
  assert.eq(tex.refreshed, 1, 'uploaded once, and not again with nothing new');
});

test('baked gfx: the grid and the borders are baked, and the grid skips crossings it cannot change', () => {
  assert.truthy(/this\.gridGfx = new Render\.BakedGfx\(this, 'grid_baked', this\.gridContainer\);/.test(APP_JS_SRC));
  assert.truthy(/this\.borderGfx = new Render\.BakedGfx\(this, 'border_baked', this\.borderContainer\);/.test(APP_JS_SRC));
  const render = RENDER_SRC;
  assert.truthy(/if \(gb2 && gb2\.flush\) gb2\.flush\(\);/.test(render), 'the border rebuild is uploaded');
  assert.truthy(/if \(gg\.flush\) gg\.flush\(\);/.test(render), 'the grid rebuild is uploaded');
  assert.truthy(/\|\| \(_bandKey && \(baseCellIX !== scene\._lastGridIX/.test(render),
    'with no row band in view a crossing does not repaint the grid');
});
})();
