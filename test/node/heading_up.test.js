// Rendering transforms must not leak into the north-up simulation.
function huScene(angle = Math.PI / 2) {
  return { _headingUp: true, mapRot: angle, viewCenterX: 100, viewCenterY: 100,
    viewSize: 200, mapZoom: 1, cameras: { main: { id: 1 } }, uiCam: { id: 2 },
    children: { list: [] } };
}
function huNear(actual, expected) { assert.truthy(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`); }
function huSprite(over = {}) {
  return { type: 'Sprite', visible: true, x: 130, y: 120, rotation: 0,
    originX: 0.5, originY: 32 / 48, displayWidth: 48, displayHeight: 48,
    depth: 0, ...over };
}

test('heading up: vectors and points round trip at every compass quadrant', () => {
  for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const scene = huScene(angle), screen = HeadingUp.toScreenVec(scene, 18, -7);
    const world = HeadingUp.toWorldVec(scene, screen.x, screen.y);
    huNear(world.x, 18); huNear(world.y, -7);
  }
});

test('heading up: padded feet and airborne body use explicit ground anchor', () => {
  const scene = huScene(Math.PI), sprite = huSprite({ _huAnchor: { x: 130, y: 130 } });
  const saved = [];
  HeadingUp._upright(sprite, -scene.mapRot, saved);
  const drawn = HeadingUp.toScreenPt(scene, sprite.x, sprite.y);
  const feet = HeadingUp.toScreenPt(scene, 130, 130);
  huNear(drawn.x, feet.x); huNear(drawn.y, feet.y - 10);
  scene._huSaved = saved; HeadingUp._postRender(scene);
  assert.eq(sprite.x, 130); assert.eq(sprite.y, 120); assert.eq(sprite.rotation, 0);
  assert.eq(sprite._huAnchor.y, 130);
});

test('heading up: flat ground keeps camera rotation and connected placement', () => {
  const sprite = huSprite({ _huGround: true }), saved = [];
  HeadingUp._upright(sprite, -Math.PI / 2, saved);
  assert.eq(saved.length, 0); assert.eq(sprite.rotation, 0);
  assert.eq(sprite.x, 130); assert.eq(sprite.y, 120);
});

test('heading up: body container shares ground anchor without double rotating children', () => {
  const child = huSprite(), saved = [];
  const body = { type: 'Container', visible: true, x: 0, y: 0, rotation: 0,
    list: [child], _huAnchor: { x: 130, y: 130 }, scaleX: 1, scaleY: 1 };
  HeadingUp._upright(body, -Math.PI / 2, saved);
  assert.eq(saved.length, 1); assert.eq(child.rotation, 0);
  huNear(body.rotation, -Math.PI / 2);
  const scaled = { ...body, x: 0, y: 0, rotation: 0, _huAnchor: null, scaleX: 2 };
  const other = []; HeadingUp._upright(scaled, -Math.PI / 2, other);
  assert.eq(other.length, 1); assert.eq(other[0][0], scaled);
});

test('heading up: creature, octant and NPC presentation turns without changing actor', () => {
  const scene = huScene(-Math.PI / 2);
  const c = { kind: 'npc', x: 5, y: 8, _facing: 'right', _faceFlip: false,
    _heading: 0, _targetX: 15, _targetY: 8, _startX: 5, _startY: 8 };
  const view = HeadingUp.appearanceActor(scene, c);
  assert.eq(view._facing, 'up'); huNear(view._heading, -Math.PI / 2);
  huNear(view._targetX, 5); huNear(view._targetY, -2);
  assert.eq(c._facing, 'right'); assert.eq(c._heading, 0); assert.eq(c._targetX, 15);
});

test('heading up: screen depth follows rotated ground anchors and restores order', () => {
  const scene = huScene(Math.PI / 2);
  const east = huSprite({ _huAnchor: { x: 150, y: 100 }, depth: 1 });
  const west = huSprite({ _huAnchor: { x: 50, y: 100 }, depth: 2 });
  const ground = huSprite({ _huGround: true, depth: 0 });
  scene.worldContainer = { list: [ground, east, west] }; scene._worldGroundCount = 1;
  HeadingUp._preRender(scene);
  assert.eq(scene.worldContainer.list[0], ground);
  assert.eq(scene.worldContainer.list[1], west);
  assert.eq(scene.worldContainer.list[2], east);
  HeadingUp._postRender(scene);
  assert.eq(scene.worldContainer.list[1], east);
  assert.eq(scene.worldContainer.list[2], west);
});

test('heading up: UI lifts remain above zoomed and rotated anchors', () => {
  const scene = huScene(Math.PI / 2); scene.mapZoom = 2;
  const p = HeadingUp.toOverlayPt(scene, 120, 100, -10);
  huNear(p.x, 100); huNear(p.y, 120);
  scene._headingUp = false;
  const unchanged = HeadingUp.toOverlayPt(scene, 120, 100, -10);
  assert.eq(unchanged.x, 120); assert.eq(unchanged.y, 90);
});

test('heading up: lifted UI follows anchor outside map and restores after render', () => {
  const scene = huScene(Math.PI / 2); scene.mapZoom = 2;
  const label = huSprite({ type: 'Text', depth: 100, x: 120, y: -20,
    _huAnchor: { x: 120, y: 20 } });
  scene.children.list = [label];
  HeadingUp._preRender(scene);
  huNear(label.x, 260); huNear(label.y, 60);
  assert.eq(label.cameraFilter, 1);
  HeadingUp._postRender(scene);
  assert.eq(label.x, 120); assert.eq(label.y, -20);
});

test('heading up: stationary north heading still projects zoomed UI', () => {
  const scene = huScene(0); scene.mapZoom = 2;
  const label = huSprite({ type: 'Text', depth: 100, x: 120, y: 90 });
  scene.children.list = [label];
  HeadingUp._preRender(scene);
  huNear(label.x, 140); huNear(label.y, 80);
  HeadingUp._postRender(scene);
  assert.eq(label.x, 120); assert.eq(label.y, 90);
});

test('heading up: object labels share trimmed feet and footprint offsets', () => {
  const point = { x: 100, y: 150 };
  const tree = { visible: true, foot: { footFromCentre: 15 }, dxPx: -8, dyPx: 3 };
  const foot = Render.objectGroundAnchor(tree, null, point);
  assert.eq(foot.x, 100); assert.eq(foot.y, 165);
  const house = { visible: true, spec: { groundAtOrigin: true }, dxPx: 7, dyPx: -4 };
  const home = Render.objectGroundAnchor(house, null, point);
  assert.eq(home.x, 107); assert.eq(home.y, 146);
});

test('heading up: contact shadows rotate about centre and captions keep origin', () => {
  const scene = huScene(Math.PI / 2);
  const shadow = huSprite({ type: 'Image', x: 120, y: 130, originY: 0.5 });
  scene.shadowContainer = { list: [shadow] };
  HeadingUp._preRender(scene);
  huNear(shadow.x, 120); huNear(shadow.y, 130);
  huNear(shadow.rotation, -Math.PI / 2);
  HeadingUp._postRender(scene);
  const caption = huSprite({ type: 'Text', originY: 0 });
  HeadingUp._upright(caption, -Math.PI / 2, []);
  huNear(caption.x, 130); huNear(caption.y, 120);
});

 test('heading up: building shadow shares pivot, visible width and upright inset', () => {
  const appearance = {visible:true,texKey:'test',frameVal:0,scl:2,scaleYMul:1,
    dxPx:3,dyPx:5,origin:[0.5,1],spec:{groundAtOrigin:true}};
  const shadow = Render.buildingShadow(appearance, {getFrame:()=>({width:60,height:40})}, {x:100,y:100});
  huNear(shadow.width,134.4);
  for (const angle of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
    const scene=huScene(angle);
    const sprite=huSprite({type:'Image',x:shadow.x,y:shadow.y,_huAnchor:shadow.anchor});
    scene.shadowContainer={list:[sprite]};
    HeadingUp._preRender(scene);
    const actual=HeadingUp.toScreenPt(scene,sprite.x,sprite.y);
    const base=HeadingUp.toScreenPt(scene,shadow.anchor.x,shadow.anchor.y);
    huNear(actual.x,base.x);huNear(actual.y,base.y-shadow.height*0.35);
    huNear(sprite.rotation+angle,0);
    HeadingUp._postRender(scene);
  }
 });
 test('heading up: placed fires, torches, all lamps and dropped items stay upright', () => {
  const {RENDER_SPEC:spec}=Render.objectAppearance({},new Map());
  for(const kind of ['_fire','torch','_streetlamp','_scarecrow','groundstack']) {
    assert.truthy(!spec[kind].ground || spec[kind].upright,kind+' stays upright');
    for(const angle of [Math.PI/4,Math.PI/2,Math.PI]) {
      const scene=huScene(angle),sprite=huSprite({_huAnchor:{x:130,y:130}});
      scene.worldContainer={list:[sprite]};
      HeadingUp._preRender(scene);
      huNear(sprite.rotation+angle,0);
      HeadingUp._postRender(scene);
    }
  }
  assert.truthy(spec._firepit.ground,'empty stone ring stays on the ground');
 });
