// Tool access does not dim scenery, and nothing fades over the player. Only
// actual foreground overlap of a building or a medium-or-larger tree with the
// player's body, including cached pool slots, shows the 40% player ghost.
(function () {
const box = { x0: 94, x1: 106, y0: 76, y1: 92 };
const appearance = { texKey: 'occlusion_fixture', frameVal: 0, spec: {}, ground: false };
function sprite(o = { kind: 'tree', size: 'medium' }) {
  return { _staticObject: o, x: 100, y: 100, originX: 0.5, originY: 1, scaleX: 1, scaleY: 1,
    frame: { width: 32, height: 48 }, depth: 5, alpha: 1, visible: true,
    writes: 0, setAlpha(a) { this.alpha = a; this.writes++; return this; } };
}

const covers = (s, b, view, depth = 4) => Render.objectCoversPlayer(s, appearance, b, depth, view);

test('player occlusion: foreground props hide the body only while covering it', () => {
  const s = sprite();
  assert.truthy(covers(s, box), 'overlapping foreground prop hides the body');
  assert.eq(s.writes, 0, 'the occluder itself keeps its opacity');
  assert.falsy(covers(s, { ...box, x0: 140, x1: 152 }), 'walking clear');
  assert.falsy(covers(s, box, null, 6), 'player drawing in front is not hidden');
  assert.falsy(covers(s, { ...box, y0: 105, y1: 125 }), 'behind a nearby object without overlap');
  assert.falsy(covers(s, null), 'a missing or hidden body is never hidden');
  assert.falsy(Render.objectCoversPlayer(s, { ...appearance, layer: WorldLayers.GROUND_DECAL }, box, 4),
    'ground art never obscures the body');
});

test('player occlusion: only buildings and medium-or-larger trees count as occluders', () => {
  for (const o of [{ kind: 'tree', size: 'medium' }, { kind: 'tree', size: 'large' },
    { kind: 'fruittree', size: 'medium' }, { kind: 'house' }]) {
    assert.truthy(covers(sprite(o), o.kind === 'house' ? { x0: 96, x1: 104, y0: 60, y1: 90 } : box),
      `${o.kind} ${o.size || ''} hides the body`);
  }
  for (const o of [{ kind: 'tree', size: 'small' }, { kind: 'tree', size: 'bush' },
    { kind: 'rock' }, { kind: 'chest' }, null]) {
    assert.falsy(covers(sprite(o), box), `${o ? o.kind + ' ' + (o.size || '') : 'an unowned sprite'} never counts`);
  }
});

test('player occlusion: inside castle grounds its other pieces count when they cover the body', () => {
  const wall = sprite({ kind: 'castle_wall', castle: 'c1' });
  assert.falsy(covers(wall, box), 'an ordinary wall piece never counts');
  assert.truthy(Render.objectCoversPlayer(wall, appearance, box, 4, null, true), 'standing on its footprint');
  assert.falsy(Render.objectCoversPlayer(wall, appearance, { ...box, x0: 140, x1: 152 }, 4, null, true),
    'but only where its art actually covers the body');
});

test('player occlusion: a turned heading-up map tests by the turned feet', () => {
  const scene = { _headingUp: true, mapRot: Math.PI, playerScreen: () => ({ x: 100, y: 100 }) };
  const { view, box: turned } = Render.headingFadeView(scene, box);
  assert.truthy(view, 'a turned map supplies turned feet');
  // North of the player: behind it north-up, in front of it at a half turn.
  const north = sprite(); north.y = 80; north.depth = 3; north._huAnchor = { x: 100, y: 80 };
  assert.falsy(covers(north, box), 'north-up, the prop behind the player does not hide it');
  assert.truthy(covers(north, turned, view), 'turned to face south, the same prop stands over the body');
  // South of the player: in front north-up, behind it at a half turn.
  const south = sprite(); south.y = 120; south.depth = 6; south._huAnchor = { x: 100, y: 120 };
  assert.falsy(covers(south, turned, view), 'a prop now behind the player never hides it');
  const still = Render.headingFadeView({ ...scene, mapRot: 0 }, box);
  assert.eq(still.view, null, 'a north-up map keeps the depth test');
  assert.eq(still.box, box);
});

test('player occlusion: trimmed art excludes transparent frame margins', () => {
  const s = sprite(), art = { fw: 32, fh: 48, minX: 12, maxX: 20, minY: 8, maxY: 40 };
  SpriteLayout.ART_BOUNDS['occlusion_fixture:0'] = art;
  try {
    assert.falsy(covers(s, { ...box, x0: 108, x1: 112 }), 'transparent side padding cannot obscure the player');
    assert.truthy(covers(s, box), 'trimmed content overlaps');
    s.scaleX = 2;
    assert.truthy(covers(s, { ...box, x0: 105, x1: 107 }), 'scaled art bounds match the displayed content');
  } finally { delete SpriteLayout.ART_BOUNDS['occlusion_fixture:0']; }
});

test('player occlusion: cached props still report cover when body overlap changes', () => {
  // Exercise the shipping reuse callback rather than duplicating its guard.
  const start = RENDER_SRC.indexOf('  const reuseStaticObject = (s, item) => {');
  const body = RENDER_SRC.slice(start, RENDER_SRC.indexOf('\n  };', start));
  const factory = new Function('scene', 'setWorldDepth', 'coverCheck',
    body + '\n  }; return reuseStaticObject;');
  const s = sprite(), o = s._staticObject, item = { o, _appearance: appearance, _appearanceStable: true, _z: 5 };
  s._staticObject = o; s._staticAppearance = appearance;
  let currentBox = box, covered = false;
  const reuse = factory({ _boot_still: true }, (sprite, depth) => { sprite.depth = depth; },
    (sprite, art) => { covered = Render.objectCoversPlayer(sprite, art, currentBox, 4); });
  assert.truthy(reuse(s, item));
  assert.truthy(covered);
  currentBox = { ...box, x0: 140, x1: 152 };
  assert.truthy(reuse(s, item));
  assert.falsy(covered, 'reusing the same appearance re-tests the body');
  assert.eq(s.alpha, 1, 'and never touches the prop opacity');
});

test('player ghost: a 40% copy of the body shows only while something hides it', () => {
  const ghost = { visible: false, texture: null, frame: { name: null }, alpha: 1, isTinted: false,
    setVisible(v) { this.visible = v; return this; },
    setTexture(k, f) { this.texture = { key: k }; this.frame = { name: f }; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setOrigin(x, y) { this.originX = x; this.originY = y; return this; },
    setScale(x, y) { this.scaleX = x; this.scaleY = y; return this; },
    setFlip(x, y) { this.flipX = x; this.flipY = y; return this; },
    setRotation(r) { this.rotation = r; return this; },
    setAlpha(a) { this.alpha = a; return this; },
    setTint() { this.isTinted = true; return this; }, clearTint() { this.isTinted = false; return this; } };
  const player = { visible: true, alpha: 1, x: 50, y: 60, originX: .5, originY: 1, scaleX: 2, scaleY: 2,
    flipX: true, flipY: false, rotation: 0, isTinted: false, texture: { key: 'farmer' }, frame: { name: 7 } };
  const scene = { player, playerGhost: ghost, playerScreen: () => ({ x: 50, y: 61 }) };
  Render.syncPlayerGhost(scene);
  assert.falsy(ghost.visible, 'nothing covers the player');
  scene._objectsCoverPlayer = true;
  Render.syncPlayerGhost(scene);
  assert.truthy(ghost.visible, 'a covering prop shows the ghost');
  assert.eq(ghost.alpha, 0.4);
  assert.eq(ghost.texture.key, 'farmer'); assert.eq(ghost.frame.name, 7);
  assert.eq(ghost.x, 50); assert.eq(ghost.y, 60); assert.eq(ghost.scaleX, 2); assert.truthy(ghost.flipX);
  assert.eq(ghost._huAnchor.y, 61, 'heading-up turns the ghost about the player feet');
  player.alpha = .5; Render.syncPlayerGhost(scene);
  assert.eq(ghost.alpha, 0.2, 'a translucent body stays proportionally translucent');
  scene._objectsCoverPlayer = false;
  scene._wallPerspective = { polygon: { coversPlayer: true } };
  Render.syncPlayerGhost(scene);
  assert.truthy(ghost.visible, 'retained wall groups count');
  scene._wallPerspective = null; scene._lowpoly = { coversPlayer: true };
  Render.syncPlayerGhost(scene);
  assert.truthy(ghost.visible, 'low-poly buildings count');
  player.visible = false; Render.syncPlayerGhost(scene);
  assert.falsy(ghost.visible, 'a hidden player leaves no ghost');
});

test('player occlusion: tool tiers no longer set tree or rock opacity', () => {
  assert.falsy(RENDER_TREE_ROCK_SPEC_SRC.includes('toolGatedAlpha'), 'no tool-based opacity hooks');
  assert.falsy(RENDER_TREE_ROCK_SPEC_SRC.includes('s.setAlpha('), 'tree and rock art has no tier-based opacity');
  assert.truthy(RENDER_FRUIT_PASS_SRC.includes('s.setAlpha(item.treeSprite.alpha)'),
    'fruit sitting on a faded canopy follows its tree');
});
test('player occlusion: native street lamps never hide the player', () => {
  const spec = Render.objectAppearance({ textures: { exists: () => true }, save: {} }, new Map()).RENDER_SPEC._streetlamp;
  for (const lit of [true, false]) {
    const key = spec.key({ lit }), frame = key + ':__BASE';
    const native = ROGUE_OBJECT_BOUNDS[lit ? 'lamp' : 'lamp_unlit'];
    const previous = SpriteLayout.ART_BOUNDS[frame];
    SpriteLayout.ART_BOUNDS[frame] = native;
    try {
      const lamp = { ...sprite({ kind: '_streetlamp', lit }), originX: spec.origin[0], originY: spec.origin[1],
        frame: { width: native.fw, height: native.fh }, scaleX: spec.scale, scaleY: spec.scale };
      const art = { texKey: key, frameVal: '__BASE', spec, ground: false };
      const centerY = lamp.y + ((native.minY + native.maxY) / 2 - lamp.originY * native.fh) * lamp.scaleY;
      const body = { x0: lamp.x - 2, x1: lamp.x + 2, y0: centerY - 2, y1: centerY + 2 };
      assert.falsy(Render.objectCoversPlayer(lamp, art, body, 4), 'a native lamp never counts as hiding the player');
      const edge = lamp.x + (native.maxX - lamp.originX * native.fw) * lamp.scaleX;
      assert.falsy(Render.objectCoversPlayer(lamp, art, { ...body, x0: edge + .1, x1: edge + 2 }, 4),
        'transparent source margins never count');
      assert.falsy(Render.objectCoversPlayer(lamp, art, body, 6), 'nor does walking in front');
    } finally {
      if (previous) SpriteLayout.ART_BOUNDS[frame] = previous;
      else delete SpriteLayout.ART_BOUNDS[frame];
    }
  }

});

})();
