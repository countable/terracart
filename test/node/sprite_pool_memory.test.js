(() => {
  function fixture(run) {
    const oldNow = performance.now;
    let now = 0, nextID = 0;
    const children = new Set(), destroyed = [], pool = [];
    const container = { add(s) { children.add(s); } };
    const scene = { add: { sprite() {
      return {
        id: nextID++, active: true, visible: true, animationFrame: 0,
        anims: { isPlaying: true },
        setActive(on) { this.active = on; return this; },
        setVisible(on) { this.visible = on; return this; },
        tick() { if (this.active && this.anims.isPlaying) this.animationFrame++; },
        destroy() { children.delete(this); destroyed.push(this); this.anims = null; },
      };
    } } };
    const draw = (count, configure = () => {}) => Render.renderPool(scene, pool, container,
      Array.from({ length: count }, (_, i) => i), configure);
    performance.now = () => now;
    try { run({ pool, children, destroyed, draw, time: (t) => { now = t; } }); }
    finally { performance.now = oldNow; }
  }

  test('sprite pools: hidden animation stops updating and resumes on same-slot reuse', () => fixture(({ pool, draw }) => {
    draw(1);
    const s = pool[0];
    s.tick();
    draw(0);
    assert.falsy(s.visible);
    assert.falsy(s.active, 'invisible sprites leave the active Phaser update loop');
    s.tick();
    assert.eq(s.animationFrame, 1);
    assert.truthy(s.anims.isPlaying, 'deactivation preserves the animation, including same-texture reuse');
    draw(1, (sprite) => {
      assert.truthy(sprite.active, 'reactivates before configuration');
      assert.truthy(sprite.visible);
    });
    assert.eq(pool[0], s);
    s.tick();
    assert.eq(s.animationFrame, 2);
  }));

  test('sprite pools: release peak capacity gradually after idle grace and detach children', () => fixture(({ pool, children, destroyed, draw, time }) => {
    draw(1000);
    draw(0);
    time(4999); draw(0);
    assert.eq(pool.length, 1000, 'short camera excursions retain reusable capacity');
    time(5000); draw(0);
    assert.eq(pool.length, 968, 'destruction is capped at 32 per step');
    assert.eq(children.size, 968, 'destroy also removes container references');
    for (let i = 0; i < 40; i++) { time(5033 + i * 33); draw(0); }
    assert.eq(pool.length, 32, 'a small spare pool survives');
    assert.eq(children.size, 32);
    assert.eq(destroyed.length, 968);
    assert.truthy(destroyed.every((s) => s.anims === null), 'destroy releases animation ownership');
  }));

  test('sprite pools: reusing a tail resets its grace and keeps active demand plus spare capacity', () => fixture(({ pool, destroyed, draw, time }) => {
    draw(100);
    draw(0);
    time(4999); draw(100);
    time(5000); draw(40);
    assert.eq(pool.length, 100, 'recently reused slots get a fresh grace period');
    time(9999); draw(40);
    assert.eq(pool.length, 100);
    time(10000); draw(40); draw(40);
    assert.eq(pool.length, 56, 'keeps demand plus 16 spare slots');
    assert.truthy(pool.slice(0, 40).every((s) => s.active && s.visible));
    assert.truthy(destroyed.every((s) => s.id >= 56), 'active sprites are never destroyed');
  }));

  test('sprite pools: hiding removes optional shiny FX once, restoring their padding', () => fixture(({ pool, draw }) => {
    draw(1);
    const removed = [], s = pool[0], shine = {}, glow = {};
    s._shineFx = shine; s._shinyGlowFx = glow; s._shinyGlowPadding = 2;
    s.preFX = { padding: 12, remove(fx) { removed.push(fx); }, setPadding(n) { this.padding = n; } };
    draw(0); draw(0);
    assert.eq(removed.length, 2);
    assert.eq(removed[0], shine); assert.eq(removed[1], glow);
    assert.eq(s.preFX.padding, 2);
    assert.eq(s._shineFx, null); assert.eq(s._shinyGlowFx, null);
  }));

  test('sprite pools: manually shown text pools retain their active state', () => {
    const label = { active: true, visible: true, setVisible(on) { this.visible = on; return this; } };
    hidePoolFrom([label], 0);
    assert.falsy(label.visible);
    assert.truthy(label.active, 'text callers only restore visibility');
    label.setVisible(true);
    assert.truthy(label.active && label.visible);
  });
})();
