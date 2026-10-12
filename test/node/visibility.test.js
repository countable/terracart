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

test('cover classification shares bushes, hedges, walls and rocks with obstacle profiles', () => {
  for (const o of [{kind:'tree', size:'bush'}, {kind:'wildplant',crop:'shrub'},
    {kind:'wildplant',crop:'berry'}, {kind:'stronghold_wall'}, {kind:'mineralrock'}]) {
    assert.eq(Visibility.objectCover(o), Visibility.FULL);
  }
  for (const kind of ['tree','fruittree']) assert.eq(Visibility.objectCover({kind}), Visibility.PARTIAL);
  assert.eq(Visibility.objectCover({kind:'wildplant',crop:'longgrass'}), Visibility.CLEAR);
});

test('full cover hides behind a blocker but preserves its facing cell; rays are reciprocal', () => {
  const f = coverFixture([{id:'wall',kind:'stronghold_wall',x:2.5,y:0.5}]);
  try {
    assert.eq(Visibility.playerCover(f.scene,2.5,0.5), Visibility.CLEAR);
    assert.eq(Visibility.playerCover(f.scene,4.5,0.5), Visibility.FULL);
    assert.eq(Visibility.coverBetween(f.scene,4.5,0.5,0.5,0.5), Visibility.FULL);
    assert.eq(Visibility.playerCover(f.scene,0.5,4.5), Visibility.CLEAR);
  } finally { f.done(); }
});

test('multiple trees remain partial and cleared blockers invalidate the retained player field', () => {
  const f = coverFixture([1.5,2.5].map((x,i) => ({id:'tree'+i,kind:'tree',x,y:0.5})));
  try {
    const revision = Visibility.revision(f.scene);
    assert.eq(Visibility.playerCover(f.scene,4.5,0.5), Visibility.PARTIAL);
    assert.eq(Visibility.PARTIAL_DARKNESS,0.5);
    assert.eq(Visibility.TREE_SIGHT_PENALTY,2);
    f.entry.objects.forEach(o => { o.chopped = true; });
    f.scene.save.chopped = ['tree0', 'tree1'];
    f.scene.game.loop.frame++;
    assert.gt(Visibility.revision(f.scene),revision);
    assert.eq(Visibility.playerCover(f.scene,4.5,0.5), Visibility.CLEAR);
  } finally { f.done(); }
});

test('two touching full-cover corners prevent diagonal sight in either direction', () => {
  const f = coverFixture([{id:'a',kind:'stronghold_wall',x:1.5,y:0.5},
    {id:'b',kind:'stronghold_wall',x:0.5,y:1.5}]);
  try {
    assert.eq(Visibility.playerCover(f.scene,2.5,2.5), Visibility.FULL);
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
