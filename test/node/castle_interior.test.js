(() => {
  function fixture(ring = [0,0,50,0,50,50,0,50]) {
    const cache = new Map();
    const world = { T: WorldGen.T, tileCache: cache, tileKey: (x,y) => `${x}/${y}` };
    const scene = { depth: 0, save: {}, tileEdgeM: 100,
      startWorldM: { x: 1000, y: 1000 }, playerM: { x: 5, y: 5 },
      homeInterior: () => null,
      activeInterior: liftSceneMethod('activeInterior', { WorldGen: world,
        worldMetersToTile: (s,x,y) => ({tx:Math.floor(x/100),ty:Math.floor(y/100)}) }) };
    const shape = { key: 'b_10_10', tier: WorldGen.T.BUILDING_LARGE, ring: Float32Array.from(ring) };
    cache.set('10/10', { tileEdgeM: 100, buildingShapes: [shape] });
    return {scene,cache,shape};
  }
  test('castle interiors: every castle opens indoors before and after claim', () => {
    const {scene,shape}=fixture();
    for(const claimed of [false,true]) {
      scene.save.claimedCastles=claimed?{[shape.key]:0}:{};
      const room=scene.activeInterior();
      assert.eq(room.kind,'castle');assert.eq(room.key,shape.key);assert.eq(room.buildingKey,shape.key);
      assert.eq(JSON.stringify(room.ring[0]),JSON.stringify({x:1000,y:1000}),'source coordinates become world metres');
    }
    scene.playerM={x:50.01,y:5};
    assert.eq(scene.activeInterior(),null,'walking outside restores exterior view');
  });
  test('castle interiors: exact concave footprint, body position and surface depth control entry', () => {
    const {scene}=fixture([0,0,50,0,50,20,20,20,20,50,0,50]);
    scene._peekM={x:1000,y:1000};
    assert.eq(scene.activeInterior().kind,'castle','peeking out does not exit');
    scene.playerM={x:30,y:30};scene._peekM={x:-25,y:-25};
    assert.eq(scene.activeInterior(),null,'a bounding-box notch remains outdoors even when peeking inside');
    scene.playerM={x:5,y:5};scene.depth=1;
    assert.eq(scene.activeInterior(),null,'surface castles never mask caves');
  });
  test('castle interiors: distant owning tiles, reload and eviction update occupancy at rest', () => {
    const {scene,cache,shape}=fixture();
    const ring=Float32Array.from([500,500,550,500,550,550,500,550]);
    cache.clear();assert.eq(scene.activeInterior(),null);
    cache.set('5/5',{tileEdgeM:100,buildingShapes:[{...shape,ring}]});
    assert.eq(scene.activeInterior().key,shape.key,'a footprint crossing several tiles still opens');
    cache.clear();assert.eq(scene.activeInterior(),null,'eviction does not leave a stale room');
    cache.set('5/5',{tileEdgeM:100,buildingShapes:[{...shape,ring:Float32Array.from([0,0,50,0,50,50,0,50])}]});
    assert.eq(scene.activeInterior(),null,'reloaded geometry replaces the old footprint');
  });
  test('castle interiors: Home takes precedence and temples and forts remain outside', () => {
    const {scene,shape}=fixture();
    scene.homeInterior=()=>({key:'home',ring:[]});scene.save.starterShopId='home';
    assert.eq(scene.activeInterior().kind,'home');
    scene.homeInterior=()=>null;shape.templeZone=true;
    assert.eq(scene.activeInterior(),null);
    delete shape.templeZone;shape.tier=WorldGen.T.BUILDING_MED;
    assert.eq(scene.activeInterior(),null);
  });
})();
