// Rendering transforms must not leak into the north-up simulation.
function huScene(angle = Math.PI / 2) {
  return { _headingUp: true, gpsM: { x: 0, y: 0 }, mapRot: angle, viewCenterX: 100, viewCenterY: 100,
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
  const sprite = huSprite({ _worldLayer: WorldLayers.GROUND_DECAL }), saved = [];
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
  const ground = huSprite({ _worldLayer: WorldLayers.GROUND_DECAL, depth: 0 });
  scene.worldContainer = { list: [ground, east, west] }; scene._worldDecalCount = 1;
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

test('heading up: object labels share cell pivots and footprint offsets', () => {
  const point = { x: 100, y: 150 };
  const tree = { visible: true, foot: { footFromCentre: 15 }, dxPx: -8, dyPx: 3 };
  const foot = Render.objectGroundAnchor(tree, null, point);
  assert.eq(foot.x, 100); assert.eq(foot.y, 150); assert.eq(foot.footDy, 15);
  const house = { visible: true, spec: { groundAtOrigin: true }, dxPx: 7, dyPx: -4 };
  const home = Render.objectGroundAnchor(house, null, point);
  assert.eq(home.x, 107); assert.eq(home.y, 146);
});

test('heading up: shrine pedestal turns back about its cell centre, flat pads do not', () => {
  const scene = huScene(Math.PI / 2);
  const plinth = huSprite({ type: 'Image', x: 120, y: 130, originY: 0.5, _huAnchor: { x: 120, y: 130 } });
  const disc = huSprite({ type: 'Image', x: 160, y: 130, originY: 0.5, _huAnchor: null });
  scene.padContainer = { list: [plinth, disc] };
  HeadingUp._preRender(scene);
  huNear(plinth.x, 120); huNear(plinth.y, 130); huNear(plinth.rotation, -Math.PI / 2);
  assert.eq(disc.rotation, 0); assert.eq(disc.x, 160);
  HeadingUp._postRender(scene);
  assert.eq(plinth.rotation, 0); assert.eq(plinth.x, 120); assert.eq(plinth.y, 130);
});

test('heading up: contact shadows rotate about centre and captions keep origin', () => {
  const scene = huScene(Math.PI / 2);
  const shadow = huSprite({ type: 'Image', x: 120, y: 130, originY: 0.5 });
  scene.shadowContainer = { list: [shadow] };
  HeadingUp._preRender(scene);
  huNear(shadow.x, 120); huNear(shadow.y, 130);
  huNear(shadow.rotation, -Math.PI / 2);
  HeadingUp._postRender(scene);
  // An unpooled shadow (the player's) moves on: no anchor may survive the
  // frame, or the next frame turns it about where it used to be.
  shadow.x = 150; shadow.y = 160;
  HeadingUp._preRender(scene);
  huNear(shadow.x, 150); huNear(shadow.y, 160);
  HeadingUp._postRender(scene);
  assert.eq(shadow._huAnchor, null);
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
 test('heading up: placed fires, torches and lamps stay upright while dropped items lie flat', () => {
  const {RENDER_SPEC:spec}=Render.objectAppearance({},new Map());
  for(const kind of ['_fire','torch','_streetlamp','_scarecrow']) {
    assert.truthy(WorldLayers.forObject({kind},spec[kind]) !== WorldLayers.GROUND_DECAL,kind+' stays upright');
    for(const angle of [Math.PI/4,Math.PI/2,Math.PI]) {
      const scene=huScene(angle),sprite=huSprite({_huAnchor:{x:130,y:130}});
      scene.worldContainer={list:[sprite]};
      HeadingUp._preRender(scene);
      huNear(sprite.rotation+angle,0);
      HeadingUp._postRender(scene);
    }
  }
  assert.eq(WorldLayers.forObject({kind:'groundstack'},spec.groundstack),WorldLayers.GROUND_DECAL);
  for (const crop of ['shell', 'flint', 'driftwood']) assert.eq(WorldLayers.forObject({kind:'wildplant',crop}),WorldLayers.GROUND_DECAL);
  assert.eq(WorldLayers.forObject({kind:'_firepit'},spec._firepit),WorldLayers.STEP_OVER_PROP,'cold firepit is a step-over prop');
 });

test('heading up: supporting props remain below player after rotated depth sort', () => {
  for (const angle of [Math.PI/2, Math.PI, -Math.PI/2]) {
    const scene=huScene(angle);
    const prop=huSprite({_stepSupport:true,_huAnchor:{x:120,y:120},depth:1});
    const player=huSprite({_huAnchor:{x:100,y:100},depth:2});
    const tree=huSprite({_huAnchor:{x:140,y:140},depth:3});
    scene.worldContainer={list:[prop,player,tree]};scene.playerWorldContainer=player;
    HeadingUp._preRender(scene);
    assert.gt(scene.worldContainer.list.indexOf(player),scene.worldContainer.list.indexOf(prop));
    HeadingUp._postRender(scene);
  }
});
// A flat ground mark (an elite's rune circle, the GPS ring) is a top-down
// bake squashed to half height. Turning that SPRITE with the map stood the
// ellipse on its end at east/west headings; so the shadow-container pass
// counter-rotates it like the contact shadows beside it, and the map's turn
// reaches the runes or ticks as a frame of the rotation strip instead.
test('heading up: flat ground marks stay flat — counter-rotated like shadows, turned by strip frame', () => {
  for (const angle of [Math.PI/2, Math.PI, -Math.PI/3]) {
    const scene=huScene(angle);
    const rune=huSprite({});
    scene.shadowContainer={list:[rune]};
    HeadingUp._preRender(scene);
    huNear(rune.rotation+angle,0,'the ellipse does not turn with the map');
    assert.eq(rune.x,130);assert.eq(rune.y,120);
    HeadingUp._postRender(scene);
    assert.eq(rune.rotation,0);
  }
  assert.falsy(/s\._worldLayer = WorldLayers\.GROUND_DECAL;\s*const \{ x: sx, y: sy \} = project\(item\.dx/.test(RENDER_SRC),
    'the rune ring pass no longer tags its sprites as decals exempt from uprighting');
  assert.falsy(/gpsGhost\._worldLayer/.test(SCENE_SRC), 'the GPS ring carries no decal tag either');
  assert.truthy(/Render\.groundMarkFrame\(scene, key, \(pulseNow \/ 1000\) \* ELITE_RING_SPIN\[item\.band\]\)/.test(RENDER_SRC),
    'the rune bands take their spin AND the map turn through groundMarkFrame');
  assert.truthy(/\.setFrame\(Render\.groundMarkFrame\(this, 'gps_ring'\)\)/.test(SCENE_SRC),
    'the GPS ring takes the map turn through groundMarkFrame');
  // groundMarkFrame: the map's turn (degrees, clockwise on screen) picks the
  // strip frame; a full period wraps.
  const tex = { get: () => ({ frameTotal: 31 }) };   // a 90° strip of 30 frames + __BASE
  const sc = (rad) => ({ _headingUp: true, mapRot: rad, textures: tex });
  assert.eq(Render.groundMarkFrame(sc(0), 'gps_ring'), 0);
  assert.eq(Render.groundMarkFrame(sc(Math.PI/6), 'gps_ring'), 10, '30° → frame 10 of 3° steps');
  assert.eq(Render.groundMarkFrame(sc(-Math.PI/6), 'gps_ring'), 20, '-30° wraps within the period');
  assert.eq(Render.groundMarkFrame(sc(Math.PI/2), 'gps_ring'), 0, 'a full period wraps to the first frame');
  assert.eq(Render.groundMarkFrame(sc(0), 'gps_ring', 45), 15, 'a mark\'s own spin adds');
});

test('heading up: retired support slots cannot change player depth', () => {
  const scene=huScene(Math.PI/2);
  const retired=huSprite({visible:false,_stepSupport:true,_huFoot:{x:200,y:100},depth:1});
  const player=huSprite({_huAnchor:{x:100,y:100},depth:2});
  const tree=huSprite({_huAnchor:{x:140,y:100},depth:3});
  scene.worldContainer={list:[retired,player,tree]};scene.playerWorldContainer=player;
  HeadingUp._preRender(scene);
  assert.lt(scene.worldContainer.list.indexOf(player),scene.worldContainer.list.indexOf(tree));
  HeadingUp._postRender(scene);
});


test('heading up: player caret hides with device compass and remains without a sensor', () => {
  const start = SCENE_SRC.indexOf('    this.facingChevronGfx.clear();');
  const end = SCENE_SRC.indexOf('    // Footprint trail.', start);
  const draw = new Function('pScreen', 'FACING_CHEVRON_TILT', 'FACING_CHEVRON', SCENE_SRC.slice(start, end));
  const gfx = { strokes: 0, clear() { this.strokes = 0; }, lineStyle() {}, beginPath() {},
    moveTo() {}, lineTo() {}, strokePath() { this.strokes++; }, fillStyle() {}, fillCircle() {} };
  const scene = { _headingUp: false, facing: { x: 1, y: 0 }, facingChevronGfx: gfx };
  const paint = () => draw.call(scene, { x: 50, y: 50 }, 1, { tip: 12, arm: 8, halfW: 3, outlineW: 2, fillW: 1 });
  paint();
  assert.gt(gfx.strokes, 0, 'north-up retains the direction caret');
  scene._headingUp = true;
  paint();
  assert.gt(gfx.strokes, 0, 'desktop without sensor retains the caret in heading-up layout');
  scene.compassDeg = 90;
  paint();
  assert.gt(gfx.strokes, 0, 'Q/E simulated heading is not a device compass');
  scene._deviceCompass = { deg: 90, facing: { x: 1, y: 0 } };
  paint();
  assert.gt(gfx.strokes, 0, 'no GPS forces locking and keeps the caret');
  scene.gpsM = { x: 0, y: 0 };
  paint();
  assert.eq(gfx.strokes, 0, 'device heading clears the caret and uses map and rim north marker');
  scene._compassDirectionLocked = true;
  paint();
  assert.gt(gfx.strokes, 0, 'locking a device heading restores the player direction caret');
  scene._compassDirectionLocked = false;
  paint();
  assert.eq(gfx.strokes, 0, 'unlocking resumes compass-following without a player caret');
  scene._headingUp = false;
  paint();
  assert.gt(gfx.strokes, 0, 'north-up retains the caret even with a device sensor');
});

test('heading up: direction lock holds the current nonzero rotation through changing readings', () => {
  const heldAngle = -Math.PI / 3;
  const scene = { ...huScene(heldAngle), _compassDirectionLocked: true, _huTurning: true,
    _compassHUD: {}, _huNoCompass: { setVisible() {} }, _huNorth: { clear() {} } };
  const point = HeadingUp.toScreenPt(scene, 130, 120);
  for (const deg of [90, 180, 270, 0]) {
    scene.compassDeg = deg;
    for (let frame = 0; frame < 60; frame++) HeadingUp.tick(scene, 1 / 60);
    huNear(scene.mapRot, heldAngle);
    const projected = HeadingUp.toScreenPt(scene, 130, 120);
    huNear(projected.x, point.x); huNear(projected.y, point.y);
    const input = HeadingUp.toWorldVec(scene, projected.x - 100, projected.y - 100);
    huNear(input.x, 30); huNear(input.y, 20);
  }
});

test('heading up: confusion tracks a constant slow spin without dead-zone pauses', () => {
  const scene = { ...huScene(0), _confusedLoop: {}, _compassHUD: {},
    _huNoCompass: { setVisible() {} }, _huNorth: { clear() {} } };
  for(let frame=1;frame<=120;frame++) {
    const angle=0.3*frame/60;
    scene.compassDeg=angle*180/Math.PI;
    HeadingUp.tick(scene,1/60);
    huNear(scene.mapRot,-angle);
  }
  scene._compassDirectionLocked=true;
  scene.compassDeg=180;
  HeadingUp.tick(scene,1/60);
  huNear(scene.mapRot,-0.6);
});

test('heading up: unlocking eases from the held angle toward the latest compass reading', () => {
  const heldAngle = -Math.PI / 3, target = -Math.PI / 2;
  const scene = { ...huScene(heldAngle), compassDeg: 90, _compassDirectionLocked: true,
    _compassHUD: {}, _huNoCompass: { setVisible() {} }, _huNorth: { clear() {} } };
  HeadingUp.tick(scene, 1 / 60);
  huNear(scene.mapRot, heldAngle);
  scene._compassDirectionLocked = false;
  HeadingUp.tick(scene, 1 / 60);
  assert.lt(scene.mapRot, heldAngle, 'unlock resumes turning');
  assert.gt(scene.mapRot, target, 'unlock does not snap to the latest heading');
  for (let frame = 0; frame < 120; frame++) HeadingUp.tick(scene, 1 / 60);
  assert.lt(Math.abs(scene.mapRot - target), HeadingUp.DEAD_DEG * Math.PI / 180);
});


test('heading up: no captured GPS forces the map lock even with a compass sensor', () => {
  const scene = { ...huScene(-Math.PI / 3), gpsM: null, gpsAvailable: true,
    compassDeg: 180, _deviceCompass: true, _compassDirectionLocked: false,
    _compassHUD: {}, _huNoCompass: { setVisible() {} }, _huNorth: { clear() {} } };
  const held = scene.mapRot;
  assert.truthy(HeadingUp.directionLocked(scene), 'a running watch is not a captured fix');
  HeadingUp.tick(scene, 1 / 60);
  huNear(scene.mapRot, held);
  scene.gpsM = { x: 0, y: 0 };
  assert.falsy(HeadingUp.directionLocked(scene), 'an actual fix releases the forced lock');
  HeadingUp.tick(scene, 1 / 60);
  assert.truthy(scene.mapRot !== held, 'following resumes after capture');
  HeadingUp.toggleLock(scene);
  assert.truthy(HeadingUp.directionLocked(scene), 'manual locking still works with GPS');
});

// Padded frames and different compass headings must pin the same drawn point.
test('heading up: upright contacts stay at the cell centre at every heading', () => {
  for (const hoppable of [false, true]) for (const height of [18, 46]) {
    const box = { fw: 64, fh: 64, minX: 9, maxX: 35, minY: 7, maxY: 7 + height, baseX: 24 };
    const scale = 1.7;
    const seat = SpriteLayout.contactSeat(box, .5, .5, scale, scale, hoppable);
    const inset = hoppable && height * scale <= CELL_PX ? height / 3 : 5;
    huNear(seat.footFromCentre, inset * scale);
    const appearance = { visible: true, foot: { footFromCentre: seat.footFromCentre }, ...seat };
    const point = { x: 130, y: 120 };
    const anchor = Render.objectGroundAnchor(appearance, null, point);
    for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const scene = huScene(angle);
      const sprite = huSprite({ x: point.x + seat.dxPx, y: point.y + seat.dyPx, _huAnchor: anchor });
      HeadingUp._upright(sprite, -angle, []);
      const drawn = HeadingUp.toScreenPt(scene, sprite.x, sprite.y);
      const cell = HeadingUp.toScreenPt(scene, point.x, point.y);
      huNear(drawn.x + (box.baseX - 32) * scale, cell.x);
      huNear(drawn.y + (box.maxY - inset - 32) * scale, cell.y);
      const depth = HeadingUp.toScreenPt(scene, sprite._huFoot.x, sprite._huFoot.y);
      huNear(depth.x, cell.x); huNear(depth.y, cell.y + inset * scale);
    }
  }
});

test('heading up: the direction caret is pushed clear of the body, never behind it', () => {
  // Ground paint draws under the character, so a caret pointing up the screen
  // (the usual heading once the compass is locked) sat behind the body.
  const start = SCENE_SRC.indexOf('    this.facingChevronGfx.clear();');
  const end = SCENE_SRC.indexOf('    // Footprint trail.', start);
  const draw = new Function('pScreen', 'FACING_CHEVRON_TILT', 'FACING_CHEVRON', SCENE_SRC.slice(start, end));
  const pts = [];
  const gfx = { clear() { pts.length = 0; }, lineStyle() {}, beginPath() {}, moveTo(x, y) { pts.push({ x, y }); },
    lineTo(x, y) { pts.push({ x, y }); }, strokePath() {}, fillStyle() {}, fillCircle() {} };
  const scene = { _headingUp: false, facingChevronGfx: gfx,
    player: { displayWidth: 24, displayHeight: 24 }, playerBodyDy: () => -9 };
  const chevron = { tip: 16, arm: 10, halfW: 4.5, outlineW: 3.2, fillW: 1.6 };
  const feet = { x: 100, y: 100 };
  const headPx = 24 / 2 + 9;
  const paint = (x, y) => { scene.facing = { x, y }; draw.call(scene, feet, 0.6, chevron); return pts.slice(0, 3); };
  for (const p of paint(0, -1)) {
    assert.lt(p.y, feet.y - headPx, 'pointing up the screen, the whole caret sits above the head');
  }
  const down = paint(0, 1);
  assert.lt(Math.max(...down.map(p => p.y)), feet.y + 16, 'pointing down it stays at the feet, unpushed');
  const side = paint(1, 0);
  assert.lt(Math.max(...side.map(p => p.x)), feet.x + 17, 'pointing sideways it is not pushed out');
});

test('heading up: the caret\'s drop shadow falls down the screen at any map turn', () => {
  // The caret's graphic turns with the map, so a fixed +y shadow offset swung
  // above the caret once the map was turned round.
  const start = SCENE_SRC.indexOf('    this.facingChevronGfx.clear();');
  const end = SCENE_SRC.indexOf('    // Footprint trail.', start);
  const draw = new Function('pScreen', 'FACING_CHEVRON_TILT', 'FACING_CHEVRON', SCENE_SRC.slice(start, end));
  const starts = [];
  const gfx = { clear() { starts.length = 0; }, lineStyle() {}, beginPath() {}, moveTo(x, y) { starts.push({ x, y }); },
    lineTo() {}, strokePath() {}, fillStyle() {}, fillCircle() {} };
  const chevron = { tip: 16, arm: 10, halfW: 4.5, outlineW: 3.2, fillW: 1.6 };
  for (const rot of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    const scene = { _headingUp: true, mapRot: rot, _compassDirectionLocked: true, gpsM: { x: 0, y: 0 },
      facing: { x: 1, y: 0 }, facingChevronGfx: gfx };
    draw.call(scene, { x: 50, y: 50 }, 0.6, chevron);
    const [shadow, outline] = starts;
    const s = HeadingUp.toScreenVec(scene, shadow.x - outline.x, shadow.y - outline.y);
    assert.lt(Math.abs(s.x), 1e-9, `no sideways shadow at ${rot}`);
    assert.lt(Math.abs(s.y - 1), 1e-9, `the shadow sits 1px below on screen at ${rot}`);
  }
});

test('heading up: the direction caret never lands on the GPS ring', () => {
  const start = SCENE_SRC.indexOf('    this.facingChevronGfx.clear();');
  const end = SCENE_SRC.indexOf('    // Footprint trail.', start);
  const draw = new Function('pScreen', 'FACING_CHEVRON_TILT', 'FACING_CHEVRON', SCENE_SRC.slice(start, end));
  const pts = [];
  const gfx = { clear() { pts.length = 0; }, lineStyle() {}, beginPath() {}, moveTo(x, y) { pts.push({ x, y }); },
    lineTo(x, y) { pts.push({ x, y }); }, strokePath() {}, fillStyle() {}, fillCircle() {} };
  const feet = { x: 100, y: 100 };
  const ring = { visible: true, x: feet.x, y: feet.y, displayWidth: GPS_RING.px };
  const scene = { _headingUp: false, facingChevronGfx: gfx, gpsGhost: ring,
    player: { displayWidth: 24, displayHeight: 24 }, playerBodyDy: () => -9 };
  const chevron = { tip: 16, arm: 10, halfW: 4.5, outlineW: 3.2, fillW: 1.6 };
  const rx = GPS_RING.px * GPS_RING.r / GROUND_MARK.bakePx, ry = rx * GPS_RING.tilt;
  for (let deg = 0; deg < 360; deg += 15) {
    const a = deg * Math.PI / 180;
    scene.facing = { x: Math.sin(a), y: -Math.cos(a) };
    draw.call(scene, feet, 0.6, chevron);
    for (const p of pts.slice(0, 3)) {
      const d = ((p.x - ring.x) / rx) ** 2 + ((p.y - ring.y) / ry) ** 2;
      assert.gt(d, 1, `facing ${deg}°, the caret sits outside the ring`);
    }
  }
});

test('heading up: burning-ground flames rise up the screen at any map turn', () => {
  // The flames are map graphics, so they turn with the map; drawn toward map
  // north they leaned sideways (or hung upside down) once the compass turned it.
  const start = RENDER_SRC.indexOf("          const up = typeof HeadingUp !== 'undefined'");
  const loop = RENDER_SRC.indexOf('for (let n = 0; n < 3; n++) {', start);
  const end = RENDER_SRC.indexOf('\n          }\n', loop) + '\n          }\n'.length;
  assert.truthy(start > 0 && end > loop, 'found the flame tongues');
  const draw = new Function('scene', 'fg', 'sx', 'sy', 'texNow', '_absIX', '_absIY', 'CELL_PX',
    RENDER_SRC.slice(start, end));
  for (const rot of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    const scene = { _headingUp: true, mapRot: rot };
    const tris = [];
    const fg = { fillStyle() {}, fillTriangle(...p) { tris.push(p); } };
    draw(scene, fg, 0, 0, 0, 0, 0, 32);
    for (const [ax, ay, bx, by, tx, ty] of tris) {
      const base = HeadingUp.toScreenVec(scene, (ax + bx) / 2, (ay + by) / 2);
      const tip = HeadingUp.toScreenVec(scene, tx, ty);
      assert.lt(tip.y, base.y - 3, `at ${rot} the tongue points up the screen`);
      assert.lt(Math.abs(tip.x - base.x), 4, `at ${rot} it barely sways sideways`);
    }
  }
});

test('heading up: the direction caret lies flat on the screen\'s ground at any map turn', () => {
  // Foreshortening the map's y tipped the caret onto its end once heading-up
  // turned the map; it is foreshortened down the turned screen, like the ring.
  const start = SCENE_SRC.indexOf('    this.facingChevronGfx.clear();');
  const end = SCENE_SRC.indexOf('    // Footprint trail.', start);
  const draw = new Function('pScreen', 'FACING_CHEVRON_TILT', 'FACING_CHEVRON', SCENE_SRC.slice(start, end));
  const pts = [];
  const gfx = { clear() { pts.length = 0; }, lineStyle() {}, beginPath() {}, moveTo(x, y) { pts.push({ x, y }); },
    lineTo(x, y) { pts.push({ x, y }); }, strokePath() {}, fillStyle() {}, fillCircle() {} };
  const chevron = { tip: 16, arm: 10, halfW: 4.5, outlineW: 3.2, fillW: 1.6 };
  for (const rot of [0, Math.PI / 3, Math.PI / 2, Math.PI]) {
    const scene = { _headingUp: true, mapRot: rot, _compassDirectionLocked: true, gpsM: { x: 0, y: 0 },
      facingChevronGfx: gfx };
    // The heading that points straight across the turned screen, to the right.
    scene.facing = HeadingUp.toWorldVec(scene, 1, 0);
    draw.call(scene, { x: 50, y: 50 }, 0.5, chevron);
    const [a, tip, b] = pts.slice(3, 6).map(p => HeadingUp.toScreenVec(scene, p.x - 50, p.y - 50));
    assert.lt(Math.abs(tip.y), 1e-9, `at ${rot} a caret pointing across the screen keeps its tip on the feet's row`);
    assert.lt(Math.abs(Math.abs(a.y - b.y) - 2 * chevron.halfW * 0.5), 1e-9,
      `at ${rot} its width runs down the screen, foreshortened by the tilt`);
  }
});

test('heading up: keyboard rotates the camera without GPS or changing player facing', () => {
  const scene = { ...huScene(0), gpsM: null, compassDeg: null, facing: {x:0,y:-1},
    _compassDirectionLocked:true, _compassHUD:{}, _huNoCompass:{setVisible(){}}, _huNorth:{clear(){}} };
  const original = JSON.stringify(scene.facing);
  assert.truthy(HeadingUp.keyTurn(scene,{key:'e'}));
  for(let i=0;i<120;i++) HeadingUp.tick(scene,1/60);
  assert.lt(Math.abs(scene.mapRot+Math.PI/12),.02,'view turns 15 degrees without GPS');
  assert.eq(scene.compassDeg,null);assert.eq(JSON.stringify(scene.facing),original);
  HeadingUp.keyTurn(scene,{key:'q'});
  for(let i=0;i<120;i++) HeadingUp.tick(scene,1/60);
  assert.lt(Math.abs(scene.mapRot),.02,'opposite key returns view');
});
test('heading up: keyboard preserves typing and lock restores sensor policy', () => {
  const scene=huScene(0);scene._compassDirectionLocked=false;
  for(const event of [{key:'e',target:{tagName:'INPUT'}},{key:'q',target:{isContentEditable:true}},{key:'e',ctrlKey:true}])
    assert.falsy(HeadingUp.keyTurn(scene,event));
  assert.eq(scene._huManualAngle,undefined);
  HeadingUp.keyTurn(scene,{key:'E'});assert.truthy(scene._huManualAngle!=null);
  HeadingUp.toggleLock(scene);assert.eq(scene._huManualAngle,null);
});
