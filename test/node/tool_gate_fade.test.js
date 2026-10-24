// Tool access does not dim scenery. Only actual foreground overlap with the
// player's body fades a building or a medium-or-larger tree, including cached
// pool slots; every other prop stays opaque.
(function () {
const box = { x0: 94, x1: 106, y0: 76, y1: 92 };
const appearance = { texKey: 'occlusion_fixture', frameVal: 0, spec: {}, ground: false };
function sprite(o = { kind: 'tree', size: 'medium' }) {
  return { _staticObject: o, x: 100, y: 100, originX: 0.5, originY: 1, scaleX: 1, scaleY: 1,
    frame: { width: 32, height: 48 }, depth: 5, alpha: 1, visible: true,
    writes: 0, setAlpha(a) { this.alpha = a; this.writes++; return this; } };
}

test('player occlusion: foreground props fade only while covering the body', () => {
  const s = sprite();
  Render.fadeObjectOverPlayer(s, appearance, box, 4, 1);
  assert.eq(s.alpha, 0.5, 'overlapping foreground prop is half opaque');
  Render.fadeObjectOverPlayer(s, appearance, { ...box, x0: 140, x1: 152 }, 4, 1);
  assert.eq(s.alpha, 1, 'walking clear restores opacity');
  Render.fadeObjectOverPlayer(s, appearance, box, 6, 1);
  assert.eq(s.alpha, 1, 'player drawing in front does not fade the object');
  Render.fadeObjectOverPlayer(s, appearance, { ...box, y0: 105, y1: 125 }, 4, 1);
  assert.eq(s.alpha, 1, 'being behind a nearby object without overlap does not fade it');
});

test('player occlusion: only buildings and medium-or-larger trees fade', () => {
  for (const o of [{ kind: 'tree', size: 'medium' }, { kind: 'tree', size: 'large' },
    { kind: 'fruittree', size: 'medium' }, { kind: 'house' }]) {
    const s = sprite(o);
    Render.fadeObjectOverPlayer(s, appearance, o.kind === 'house'
      ? { x0: 96, x1: 104, y0: 60, y1: 90 } : box, 4, 1);
    assert.eq(s.alpha, 0.5, `${o.kind} ${o.size || ''} fades over the body`);
  }
  for (const o of [{ kind: 'tree', size: 'small' }, { kind: 'tree', size: 'bush' },
    { kind: 'rock' }, { kind: 'chest' }, null]) {
    const s = sprite(o);
    Render.fadeObjectOverPlayer(s, appearance, box, 4, 1);
    assert.eq(s.alpha, 1, `${o ? o.kind + ' ' + (o.size || '') : 'an unowned sprite'} stays opaque`);
  }
});

test('player occlusion: faded shinies suspend their gold glow and restore it when clear', () => {
  const s = sprite();
  const glow = s._shinyGlowFx = { active: true };
  const shine = s._shineFx = { active: true };
  Render.fadeObjectOverPlayer(s, appearance, box, 4, 1);
  assert.eq(s.alpha, 0.5);
  assert.falsy(glow.active, 'faded body pixels must not become gold outer-glow pixels');
  assert.truthy(shine.active, 'the glint remains available');
  Render.fadeObjectOverPlayer(s, appearance, box, 4, 1);
  assert.falsy(glow.active, 'cached faded frames keep the glow off');
  Render.fadeObjectOverPlayer(s, appearance, { ...box, x0: 140, x1: 152 }, 4, 1);
  assert.eq(s.alpha, 1);
  assert.truthy(glow.active, 'walking clear restores the same rim controller');
  assert.eq(s._shinyGlowFx, glow, 'no effect reallocation during movement');
  Render.fadeObjectOverPlayer(s, appearance, null, 4, 0.6);
  assert.falsy(glow.active, 'inherently translucent objects also avoid the gold fill');
});

test('player occlusion: a turned heading-up map fades by the turned feet', () => {
  const scene = { _headingUp: true, mapRot: Math.PI, playerScreen: () => ({ x: 100, y: 100 }) };
  const { view, box: turned } = Render.headingFadeView(scene, box);
  assert.truthy(view, 'a turned map supplies turned feet');
  // North of the player: behind it north-up, in front of it at a half turn.
  const north = sprite(); north.y = 80; north.depth = 3; north._huAnchor = { x: 100, y: 80 };
  Render.fadeObjectOverPlayer(north, appearance, box, 4, 1);
  assert.eq(north.alpha, 1, 'north-up, the prop behind the player stays opaque');
  Render.fadeObjectOverPlayer(north, appearance, turned, 4, 1, view);
  assert.eq(north.alpha, 0.5, 'turned to face south, the same prop stands over the body');
  // South of the player: in front north-up, behind it at a half turn.
  const south = sprite(); south.y = 120; south.depth = 6; south._huAnchor = { x: 100, y: 120 };
  Render.fadeObjectOverPlayer(south, appearance, turned, 4, 1, view);
  assert.eq(south.alpha, 1, 'a prop now behind the player never fades');
  const still = Render.headingFadeView({ ...scene, mapRot: 0 }, box);
  assert.eq(still.view, null, 'a north-up map keeps the depth test');
  assert.eq(still.box, box);
});

test('player occlusion: trimmed art excludes transparent frame margins', () => {
  const s = sprite(), art = { fw: 32, fh: 48, minX: 12, maxX: 20, minY: 8, maxY: 40 };
  SpriteLayout.ART_BOUNDS['occlusion_fixture:0'] = art;
  try {
    Render.fadeObjectOverPlayer(s, appearance, { ...box, x0: 108, x1: 112 }, 4, 1);
    assert.eq(s.alpha, 1, 'transparent side padding cannot obscure the player');
    Render.fadeObjectOverPlayer(s, appearance, box, 4, 1);
    assert.eq(s.alpha, 0.5, 'trimmed content overlaps');
    s.scaleX = 2;
    Render.fadeObjectOverPlayer(s, appearance, { ...box, x0: 105, x1: 107 }, 4, 1);
    assert.eq(s.alpha, 0.5, 'scaled art bounds match the displayed content');
  } finally { delete SpriteLayout.ART_BOUNDS['occlusion_fixture:0']; }
});

test('player occlusion: base opacity survives repeated fades and ground art stays unchanged', () => {
  const s = sprite();
  Render.fadeObjectOverPlayer(s, appearance, box, 4, 0.6);
  assert.eq(s.alpha, 0.3);
  const writes = s.writes;
  Render.fadeObjectOverPlayer(s, appearance, box, 4, 0.6);
  assert.eq(s.alpha, 0.3, 'cached frames do not multiply the fade repeatedly');
  assert.eq(s.writes, writes, 'unchanged cached alpha requires no setter');
  Render.fadeObjectOverPlayer(s, appearance, null, 4, 0.6);
  assert.eq(s.alpha, 0.6, 'missing/hidden body restores the original style');
  Render.fadeObjectOverPlayer(s, { ...appearance, layer: WorldLayers.GROUND_DECAL }, box, 4, 0.6);
  assert.eq(s.alpha, 0.6, 'ground art never obscures the body');
});

test('player occlusion: cached props still react when body overlap changes', () => {
  // Exercise the shipping reuse callback rather than duplicating its guard.
  const start = RENDER_SRC.indexOf('  const reuseStaticObject = (s, item) => {');
  const body = RENDER_SRC.slice(start, RENDER_SRC.indexOf('\n  };', start));
  const factory = new Function('scene', 'setWorldDepth', 'fadeObject',
    body + '\n  }; return reuseStaticObject;');
  const s = sprite(), o = s._staticObject, item = { o, _appearance: appearance, _appearanceStable: true, _z: 5 };
  s._staticObject = o; s._staticAppearance = appearance; s._objectBaseAlpha = 1;
  let currentBox = box;
  const reuse = factory({ _boot_still: true }, (sprite, depth) => { sprite.depth = depth; },
    (sprite, art) => Render.fadeObjectOverPlayer(sprite, art, currentBox, 4, sprite._objectBaseAlpha));
  assert.truthy(reuse(s, item));
  assert.eq(s.alpha, 0.5);
  currentBox = { ...box, x0: 140, x1: 152 };
  assert.truthy(reuse(s, item));
  assert.eq(s.alpha, 1, 'reusing the same appearance cannot leave stale translucency');
});

test('player occlusion: tool tiers no longer set tree or rock opacity', () => {
  assert.falsy(RENDER_TREE_ROCK_SPEC_SRC.includes('toolGatedAlpha'), 'no tool-based opacity hooks');
  assert.falsy(RENDER_TREE_ROCK_SPEC_SRC.includes('s.setAlpha('), 'tree and rock art has no tier-based opacity');
  assert.truthy(RENDER_FRUIT_PASS_SRC.includes('s.setAlpha(item.treeSprite.alpha)'),
    'fruit sitting on a faded canopy follows its tree');
});
test('player occlusion: a street lamp never fades, even standing behind the post', () => {
  const spec = Render.objectAppearance({ textures: { exists: () => true }, save: {} }, new Map(), false)
    .RENDER_SPEC._streetlamp;
  const px = 32 * RoadOverlay.LAMP_DRAW_CELLS;
  const lamp = { ...sprite({ kind: '_streetlamp' }), originY: RoadOverlay.LAMP_GROUND_FRAC, frame: { width: 128, height: 128 },
    scaleX: px / 128, scaleY: px / 128 };
  const art = { texKey: 'streetlamp_fixture', frameVal: '__BASE', spec, ground: false };
  // The body box sits a cell above the lamp's feet, as the player stands just north.
  const body = { x0: -6, x1: 6, y0: lamp.y - 40, y1: lamp.y - 24 };
  Render.fadeObjectOverPlayer(lamp, art, { ...body, x0: body.x0 + 100, x1: body.x1 + 100 }, 4, 1);
  assert.eq(lamp.alpha, 1, 'a lamp is not a building or a tree');
});
})();
