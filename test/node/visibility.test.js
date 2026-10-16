function coverFixture(objects = [], walls = []) {
  const old = WorldGen.tileCache.get(WorldGen.tileKey(0, 0));
  const scene = {
    depth: 0, cellM: 1, cellsPerTile: 256, mPerPx: 1, tileEdgeM: 256,
    originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
    playerM: { x: 0.5, y: 0.5 }, save: {}, brokenRockSet: new Set(), dugWallSet: new Set(),
    game: { loop: { frame: 1 } },
    cellAt: (x, y) => ({ loaded: true, type: walls.includes(Math.floor(x) + '_' + Math.floor(y)) ? 25 : 24 }),
  };
  const entry = { objects, grid: new Uint8Array(256 * 256), wildplants: [] };
  WorldGen.tileCache.set(WorldGen.tileKey(0, 0), entry);
  return { scene, entry, done() {
    if (old) WorldGen.tileCache.set(WorldGen.tileKey(0, 0), old);
    else WorldGen.tileCache.delete(WorldGen.tileKey(0, 0));
  } };
}

test('only cave terrain is opaque; low rocks are clear and tall props give partial cover', () => {
  for (const o of [{kind:'wildplant',crop:'shrub'},
    {kind:'wildplant',crop:'berry'}, {kind:'stronghold_wall'}, {kind:'mineralrock',sightBlocking:true}]) {
    assert.eq(Visibility.objectCover(o), Visibility.PARTIAL);
  }
  for (const kind of ['tree','fruittree']) assert.eq(Visibility.objectCover({kind}), Visibility.PARTIAL);
  assert.eq(Visibility.objectCover({kind:'wildplant',crop:'longgrass'}), Visibility.CLEAR);
  assert.eq(Visibility.objectCover({kind:'mineralrock'}), Visibility.CLEAR);
  assert.eq(Visibility.objectCover({kind:'mineralrock',sightBlocking:false}), Visibility.CLEAR);
});

test('only the smallest rendered timber and fruit saplings provide no cover', () => {
  for (const species of ['maple','pine']) {
    for (const o of [{size:'small'}, {size:'bush'}, {variant:1}, {planted_t:Date.now()}]) {
      assert.eq(Visibility.objectCover({kind:'tree',species,...o}),Visibility.CLEAR);
    }
    // Young and mature art both obscure sight, even when their harvest class
    // is "small" or their explicit size overrides a variant-1 seed.
    for (const o of [{variant:2}, {variant:3}, {size:'medium',variant:1}, {size:'large'}]) {
      assert.eq(Visibility.objectCover({kind:'tree',species,...o}),Visibility.PARTIAL);
    }
  }
  for (const species of ['apple','worldpeach']) {
    assert.eq(Visibility.objectCover({kind:'fruittree',species,planted:true,planted_t:Date.now()}),Visibility.CLEAR);
    assert.eq(Visibility.objectCover({kind:'fruittree',species,planted:true,planted_t:Date.now()-Crops.FRUIT_STAGE_MS-1000}),Visibility.PARTIAL);
    // Wild fruit-tree size metadata does not shrink its mature artwork.
    assert.eq(Visibility.objectCover({kind:'fruittree',species,size:'small'}),Visibility.PARTIAL);
  }
});

test('a sight line through saplings is clear while young trees and shrubs still provide cover', () => {
  const tree = {id:'sapling',kind:'tree',variant:1,x:2.5,y:.5};
  const f = coverFixture([tree]);
  try {
    assert.eq(Visibility.playerCover(f.scene,4.5,.5),Visibility.CLEAR);
    assert.eq(Visibility.coverBetween(f.scene,4.5,.5,.5,.5),Visibility.CLEAR);
    tree.variant = 2;
    Visibility.invalidate(f.scene);
    assert.eq(Visibility.playerCover(f.scene,4.5,.5),Visibility.PARTIAL);
    f.entry.objects = [{id:'shrub',kind:'wildplant',crop:'shrub',x:2.5,y:.5}];
    Visibility.invalidate(f.scene);
    assert.eq(Visibility.playerCover(f.scene,4.5,.5),Visibility.PARTIAL);
  } finally { f.done(); }
});

test('surface wall shades behind its facing cell; rays are reciprocal', () => {
  const f = coverFixture([{id:'wall',kind:'stronghold_wall',x:2.5,y:0.5}]);
  try {
    assert.eq(Visibility.playerCover(f.scene,2.5,0.5), Visibility.CLEAR);
    assert.eq(Visibility.playerCover(f.scene,4.5,0.5), Visibility.PARTIAL);
    assert.eq(Visibility.coverBetween(f.scene,4.5,0.5,0.5,0.5), Visibility.PARTIAL);
    assert.eq(Visibility.playerCover(f.scene,0.5,4.5), Visibility.CLEAR);
    assert.falsy(Visibility.hidden(f.scene,2.5,0.5), 'the facing blocker itself stays visible');
    assert.truthy(Visibility.hidden(f.scene,4.5,0.5), 'partial cover hides an actor behind it');
    assert.falsy(Visibility.hidden(f.scene,4.5,0.5,true), 'scenery behind partial cover stays drawn');
    assert.falsy(Visibility.hidden(f.scene,0.5,4.5));
  } finally { f.done(); }
});

test('multiple trees remain partial and cleared blockers invalidate the retained player field', () => {
  const f = coverFixture([1.5,2.5].map((x,i) => ({id:'tree'+i,kind:'tree',x,y:0.5})));
  try {
    const revision = Visibility.revision(f.scene);
    assert.eq(Visibility.playerCover(f.scene,4.5,0.5), Visibility.PARTIAL);
    assert.eq(Visibility.PARTIAL_DARKNESS,0.5);
    assert.eq(Visibility.HEAR_CELLS,2);
    f.entry.objects.forEach(o => { o.chopped = true; });
    f.scene.save.chopped = ['tree0', 'tree1'];
    f.scene.game.loop.frame++;
    assert.gt(Visibility.revision(f.scene),revision);
    assert.eq(Visibility.playerCover(f.scene,4.5,0.5), Visibility.CLEAR);
  } finally { f.done(); }
});

test('two touching full-cover corners prevent diagonal sight in either direction', () => {
  const f = coverFixture([], ['1_0', '0_1']); f.scene.depth = 1;
  try {
    assert.eq(Visibility.playerCover(f.scene,2.5,2.5), Visibility.FULL);
    assert.truthy(Visibility.hidden(f.scene,2.5,2.5,true), 'full cover hides scenery too');
    assert.eq(Visibility.coverBetween(f.scene,2.5,2.5,0.5,0.5), Visibility.FULL);
  } finally { f.done(); }
});

test('cave walls obstruct sight and dug passages become visible on the next frame', () => {
  const walls = ['2_0'];
  const f = coverFixture([],walls); f.scene.depth = 1;
  try {
    assert.eq(Visibility.playerCover(f.scene,4.5,0.5), Visibility.FULL);
    walls.length = 0; f.scene.dugWallSet.add('1:2_0'); // Mining invalidates even in the same frame.
    assert.eq(Visibility.playerCover(f.scene,4.5,0.5), Visibility.CLEAR);
  } finally { f.done(); }
});

test('visibility retains canonical coordinates across rows with different cell widths', () => {
  const f = coverFixture();
  const k = WorldGen.tileKey(0,1), old = WorldGen.tileCache.get(k);
  f.scene.cellsForRow = ty => ty >= 1 ? 128 : 256;
  f.scene.playerM = {x:10.5,y:254.5};
  WorldGen.tileCache.set(k,{objects:[{id:'seam-tree',kind:'tree',x:11,y:257}],wildplants:[]});
  try {
    assert.eq(Visibility.playerCover(f.scene,10.5,261),Visibility.PARTIAL);
    assert.eq(Visibility.coverBetween(f.scene,10.5,261,10.5,254.5),Visibility.PARTIAL);
  } finally {
    f.done(); if(old) WorldGen.tileCache.set(k,old); else WorldGen.tileCache.delete(k);
  }
});

test('minimal headless scenes have clear cover without canonical coordinates', () => {
  assert.eq(Visibility.playerCover({},1,2),Visibility.CLEAR);
  assert.eq(Visibility.coverBetween({},0,0,1,2),Visibility.CLEAR);
  assert.eq(Visibility.revision({}),0);
});

// Road safety hides roadside props after dark; their invisible art must not
// leave an unexplained sight barrier behind.
test('night-hidden roadside props do not cast cover', () => {
  const f = coverFixture([{ id: 'road-wall', kind: 'stronghold_wall', x: 2.5, y: .5 }]);
  const night = RoadSafety.isNight, hidden = RoadSafety.objectHidden;
  try {
    RoadSafety.isNight = () => true;
    RoadSafety.objectHidden = (scene, o) => o.id === 'road-wall';
    assert.eq(Visibility.playerCover(f.scene, 4.5, .5), Visibility.CLEAR);
    RoadSafety.isNight = () => false;
    Visibility.invalidate(f.scene);
    assert.eq(Visibility.playerCover(f.scene, 4.5, .5), Visibility.PARTIAL);
  } finally {
    RoadSafety.isNight = night; RoadSafety.objectHidden = hidden; f.done();
  }
});


test('small surface and cave rocks leave sight clear; boulders cast removable partial shade', () => {
  for (const depth of [0, 1]) {
    const rock = { id: 'size-rock', kind: 'mineralrock', x: 2.5, y: .5 };
    const f = coverFixture([rock]); f.scene.depth = depth;
    try {
      assert.eq(Visibility.playerCover(f.scene, 4.5, .5), Visibility.CLEAR);
      rock.sightBlocking = true;
      Visibility.invalidate(f.scene);
      assert.eq(Visibility.playerCover(f.scene, 2.5, .5), Visibility.CLEAR);
      assert.eq(Visibility.playerCover(f.scene, 4.5, .5), Visibility.PARTIAL);
      f.scene.save.brokenRocks = [rock.id];
      f.scene.brokenRockSet.add(rock.id);
      f.scene.game.loop.frame++;
      assert.eq(Visibility.playerCover(f.scene, 4.5, .5), Visibility.CLEAR);
    } finally { f.done(); }
  }
});

test('a bush, a hedge or a grown tree conceals its occupant from every viewer not directly adjacent', () => {
  const bush = {id:'bush',kind:'wildplant',crop:'shrub',x:4.5,y:0.5};
  const f = coverFixture([bush]);
  try {
    assert.truthy(Visibility.objectConceals(bush), 'a shrub conceals');
    assert.truthy(Visibility.objectConceals({kind:'tree',variant:3}), 'a grown tree conceals');
    assert.falsy(Visibility.objectConceals({kind:'tree',variant:1}), 'a sapling does not');
    assert.falsy(Visibility.objectConceals({kind:'stronghold_wall'}), 'a wall covers but hides nobody inside it');
    assert.falsy(Visibility.objectConceals({kind:'mineralrock',sightBlocking:true}), 'nor a tall rock');
    assert.eq(Visibility.playerCover(f.scene,4.5,0.5), Visibility.PARTIAL, 'concealed from four cells off');
    assert.truthy(Visibility.hidden(f.scene,4.5,0.5), 'an actor in the bush is undrawn');
    assert.falsy(Visibility.hidden(f.scene,4.5,0.5,true), 'the bush itself still shows');
    f.scene.playerM = {x:3.5,y:1.5};
    assert.eq(Visibility.playerCover(f.scene,4.5,0.5), Visibility.CLEAR, 'a diagonal neighbour sees in');
    assert.eq(Visibility.sightCover(f.scene,0.5,0.5,4.5,0.5), Visibility.PARTIAL, 'a foe four cells off cannot see a body in it');
    assert.eq(Visibility.sightCover(f.scene,3.5,0.5,4.5,0.5), Visibility.CLEAR, 'a foe beside it can');
    assert.eq(Visibility.sightCover(f.scene,4.5,0.5,0.5,0.5), Visibility.CLEAR, 'the one in the bush sees out');
  } finally { f.done(); }
});

test('the X-Ray Ring sees through partial cover and into a bush, never through cave rock', () => {
  const f = coverFixture([{id:'hedge',kind:'wildplant',crop:'shrub',x:4.5,y:0.5},{id:'t',kind:'tree',x:2.5,y:2.5}], ['0_3']);
  try {
    assert.truthy(Visibility.hidden(f.scene,4.5,0.5));
    f.scene.save.inv = [{id:'xray_ring',count:1}];
    assert.truthy(Gear.hasXRay(f.scene.save));
    assert.falsy(Gear.hasPerception(f.scene.save), 'apart from the Ring of Perception');
    assert.falsy(Visibility.hidden(f.scene,4.5,0.5), 'into the hedge');
    assert.falsy(Visibility.hidden(f.scene,4.5,4.5), 'past the tree');
    f.scene.depth = 1; Visibility.invalidate(f.scene);
    assert.truthy(Visibility.hidden(f.scene,0.5,5.5), 'cave rock still hides');
  } finally { f.done(); }
});

test('a lurker finds the nearest concealing cell, and two lurkers spread over a hedge', () => {
  const hedge = [4,5].map(x => ({id:'h'+x,kind:'wildplant',crop:'shrub',x:x+.5,y:3.5}));
  const f = coverFixture(hedge);
  try {
    const a = Visibility.concealingCellNear(f.scene, 4.5, 1.5, 2, 'a');
    assert.truthy(a && a.y === 3.5 && (a.x === 4.5 || a.x === 5.5), 'a hedge cell');
    const b = Visibility.concealingCellNear(f.scene, 4.5, 1.5, 3, 'b', new Set([a.key]));
    assert.truthy(b && b.key !== a.key, 'the second takes the other cell');
    assert.eq(Visibility.concealingCellNear(f.scene, 20.5, 20.5, 2, 'c'), null, 'none in range');
  } finally { f.done(); }
});


test('downed players retain covered actors and scenery, with cover restored on revival', () => {
  const f = coverFixture([{id:'hedge',kind:'wildplant',crop:'shrub',x:2.5,y:.5}], ['0_2']);
  try {
    f.scene.save.energy = 10;
    assert.truthy(Visibility.hidden(f.scene,4.5,.5));
    f.scene.save.energy = 0;
    assert.falsy(Visibility.hidden(f.scene,4.5,.5));
    f.scene.depth = 1;
    assert.falsy(Visibility.hidden(f.scene,.5,4.5,true));
    assert.eq(Visibility.coverBetween(f.scene,.5,.5,.5,4.5),Visibility.FULL,
      'physical cover and enemy sight remain independent of the player state');
    f.scene.save.energy = 1;
    assert.truthy(Visibility.hidden(f.scene,.5,4.5,true));
  } finally { f.done(); }
});
