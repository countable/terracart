// drawObjects' 120 Hz steady-state gates: immutable object appearances reuse
// their texture/frame/seat tuple, and the shared world container only re-sorts
// when a piece's assigned depth actually changes.

(function () {

function appearanceScene(exists = () => true) {
  return {
    cellM: 7,
    save: {},
    textures: {
      exists,
      get() { return { get() { return { width: 32, height: 48 }; } }; },
    },
  };
}

test('drawObjects cache: immutable props resolve and seat once per scene', () => {
  const scene = appearanceScene();
  const object = { kind: 'tree', id: 'tree_1', species: 'maple', size: 'large' };
  Render.objectAppearance(scene, new WeakMap());
  scene._appearanceResolveCount = 0;
  const first = Render.resolveObjectAppearance(scene, object);
  const second = Render.resolveObjectAppearance(scene, object);
  assert.eq(second, first, 'the same generated record reuses the resolved tuple');
  assert.eq(scene._appearanceResolveCount, 1, 'only the first sight resolves appearance and seating');
  assert.truthy(first.visible, 'the cached tuple is a drawable appearance');
});

test('drawObjects cache: animated, connected and not-yet-loaded appearances stay live', () => {
  const scene = appearanceScene();
  Render.objectAppearance(scene, new WeakMap());

  const growing = { kind: 'tree', id: 'growing', species: 'maple', planted_t: Date.now() };
  assert.falsy(Render.resolveObjectAppearance(scene, growing)
    === Render.resolveObjectAppearance(scene, growing), 'clock-grown trees resolve their current growth frame');

  const joined = { kind: 'mineralrock', id: 'joined', yieldTier: 1 };
  assert.falsy(Render.resolveObjectAppearance(scene, joined, { _zoneObjectFrame: 3 })
    === Render.resolveObjectAppearance(scene, joined, { _zoneObjectFrame: 3 }),
    'connected-art overrides resolve from the current neighbour shape');

  let loaded = false;
  const lateScene = appearanceScene(() => loaded);
  Render.objectAppearance(lateScene, new WeakMap());
  const late = { kind: 'well', id: 'late' };
  const missing = Render.resolveObjectAppearance(lateScene, late);
  loaded = true;
  const visible = Render.resolveObjectAppearance(lateScene, late);
  assert.falsy(missing.visible, 'the first texture lookup can miss');
  assert.truthy(visible.visible, 'an early miss is not cached past texture registration');
});

test('drawObjects depth: an unchanged world order does not become dirty again', () => {
  const a = { groundY: 1, rank: 1, it: {} };
  const b = { groundY: 2, rank: 1, it: {} };
  const sprite = { depth: -1, writes: 0, setDepth(d) { this.depth = d; this.writes++; } };
  const player = { groundY: 1.5, rank: 3, sprite };
  assert.truthy(Render.sortWorldDepth([b, player, a]), 'the first assignment is dirty');
  const writes = sprite.writes;
  assert.falsy(Render.sortWorldDepth([b, player, a]), 'the same ordering is clean');
  assert.eq(sprite.writes, writes, 'a clean pass does not write the player depth');
  a.groundY = 3;
  assert.truthy(Render.sortWorldDepth([b, player, a]), 'crossing another ground row dirties the order');

  const replacement = { depth: 0, writes: 0, setDepth() { this.writes++; } };
  assert.truthy(Render.sortWorldDepth([{ groundY: 0, sprite: replacement }]),
    'a newly added depth-zero child is dirty even though Phaser also defaults it to zero');
  assert.eq(replacement.writes, 0, 'the identity marker avoids a redundant Phaser depth write');
});

test('drawObjects depth: world-pool membership dirties only the shared world order', () => {
  const sprite = () => {
    const s = {};
    for (const name of ['setAlpha', 'setAngle', 'setScale', 'setFlipX', 'clearTint', 'setActive', 'setVisible']) {
      s[name] = () => s;
    }
    s.destroy = () => {};
    return s;
  };
  const world = { add() {} }, overlay = { add() {} };
  const scene = { worldContainer: world, add: { sprite } };
  const pool = [];
  Render.renderPool(scene, pool, world, [{}], () => {});
  assert.truthy(scene._worldDepthMembershipDirty, 'growing a world pool marks membership dirty');
  scene._worldDepthMembershipDirty = false;
  Render.renderPool(scene, pool, world, [{}], () => {});
  assert.falsy(scene._worldDepthMembershipDirty, 'reusing the same slot leaves membership clean');
  Render.renderPool(scene, [], overlay, [{}], () => {});
  assert.falsy(scene._worldDepthMembershipDirty, 'an overlay pool does not dirty world order');
});

test('drawObjects depth: the shared Phaser container sort is dirty-gated', () => {
  const body = RENDER_SRC.slice(RENDER_SRC.indexOf('Render.drawObjects = function drawObjects(scene)'));
  assert.truthy(body.includes("if (worldDepthDirty && scene.worldContainer?.sort)"),
    'the pooled world list sorts only after a depth or membership change');
  assert.truthy(body.includes("window.__boot?.count?.('world depth sorted', worldDepthDirty ? 1 : 0)"),
    'the profiler reports how often the expensive sort ran');
  assert.eq((body.match(/worldContainer\.sort\('depth'\)/g) || []).length, 1,
    'no unconditional second sort remains');
});

})();
