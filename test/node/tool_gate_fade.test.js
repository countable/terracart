// Tool access does not dim scenery. Only actual foreground overlap with the
// player's body fades an upright prop, including cached pool slots.
(function () {
const box = { x0: 94, x1: 106, y0: 76, y1: 92 };
const appearance = { texKey: 'occlusion_fixture', frameVal: 0, spec: {}, ground: false };
function sprite() {
  return { x: 100, y: 100, originX: 0.5, originY: 1, scaleX: 1, scaleY: 1,
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
  const s = sprite(), o = {}, item = { o, _appearance: appearance, _appearanceStable: true, _z: 5 };
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
test('player occlusion: native lamps fade over their opaque post and not transparent margins', () => {
  const spec = Render.objectAppearance({textures:{exists:()=>true},save:{}},new Map()).RENDER_SPEC._streetlamp;
  for (const lit of [true,false]) {
    const key = spec.key({lit}), frame = key + ':__BASE';
    const native = ROGUE_OBJECT_BOUNDS[lit ? 'lamp' : 'lamp_unlit'];
    const previous = SpriteLayout.ART_BOUNDS[frame];
    SpriteLayout.ART_BOUNDS[frame] = native;
    try {
      const lamp = {...sprite(),originX:spec.origin[0],originY:spec.origin[1],
        frame:{width:native.fw,height:native.fh},scaleX:spec.scale,scaleY:spec.scale};
      const art = {texKey:key,frameVal:'__BASE',spec,ground:false};
      const centerY = lamp.y + ((native.minY+native.maxY)/2 - lamp.originY*native.fh)*lamp.scaleY;
      const body = {x0:lamp.x-2,x1:lamp.x+2,y0:centerY-2,y1:centerY+2};
      Render.fadeObjectOverPlayer(lamp,art,body,4,1);
      assert.eq(lamp.alpha,.5,'standing behind native opaque post fades either state');
      const edge = lamp.x + (native.maxX-lamp.originX*native.fw)*lamp.scaleX;
      Render.fadeObjectOverPlayer(lamp,art,{...body,x0:edge+.1,x1:edge+2},4,1);
      assert.eq(lamp.alpha,1,'transparent source margin does not fade the lamp');
      Render.fadeObjectOverPlayer(lamp,art,body,6,1);
      assert.eq(lamp.alpha,1,'walking in front leaves native lamp opaque');
    } finally { if(previous) SpriteLayout.ART_BOUNDS[frame]=previous; else delete SpriteLayout.ART_BOUNDS[frame]; }
  }
});

})();
