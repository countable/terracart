(() => {
  function fixture(run) {
    const saved = [...WorldGen.tileCache];
    WorldGen.tileCache.clear();
    const scene = { depth: 1, startWorldM: {x:0,y:0}, originPx: {x:0,y:0},
      mPerPx: 7 / 16, cellM: 7, cellsPerTile: 16, playerM: {x:10.5,y:17.5}, feetOffsetM:0 };
    const block = {id:'block',kind:'sandboxprop',pushable:true,x:17.5,y:17.5,sandboxArtKey:'crate'};
    const entry = {grid:new Uint8Array(256).fill(WorldGen.T.CAVE_FLOOR),cellsPerEdge:16,objects:[block],creatures:[]};
    WorldGen.tileCache.set(WorldGen.tileKey(0,0),entry);
    try { run(scene,block,entry); }
    finally { WorldGen.tileCache.clear(); for (const [key,value] of saved) WorldGen.tileCache.set(key,value); }
  }
  test('push blocks: adjacent tap moves one cell, preserves identity/art and terrain, updates collision',()=>fixture((scene,block,entry)=>{
    const terrain = Array.from(entry.grid).join(',');
    assert.eq(PushBlocks.at(scene,17.5,17.5),block);
    assert.eq(PushBlocks.tryPush(scene,block,1,0),true);
    assert.eq(block.x,24.5); assert.eq(block.y,17.5);
    assert.eq(block.id,'block'); assert.eq(block.sandboxArtKey,'crate');
    assert.eq(PushBlocks.at(scene,17.5,17.5),null);
    assert.eq(PushBlocks.at(scene,24.5,17.5),block);
    assert.eq(Array.from(entry.grid).join(','),terrain);
    assert.eq(PushBlocks.tryPush(scene,block,1,0),false,'cannot push a now-distant block');
  }));
  test('push blocks: walls, water, lava, occupied and unloaded cells refuse without moving',()=>fixture((scene,block,entry)=>{
    for (const terrain of [WorldGen.T.CAVE_WALL,WorldGen.T.WATER,WorldGen.T.CAVE_LAVA,WorldGen.T.WETLAND]) {
      entry.grid[2*16+3]=terrain;
      assert.eq(PushBlocks.tryPush(scene,block,1,0),false);
      assert.eq(block.x,17.5);
    }
    entry.grid[2*16+3]=WorldGen.T.CAVE_FLOOR;
    entry.depth=1;entry.underground={lane:new Set([2*16+3])};
    assert.eq(PushBlocks.tryPush(scene,block,1,0),false,'sewer channel');
    delete entry.underground;
    for(const prop of ['objects','creatures','wildplants']) {
      const o={id:'occupied',x:24.5,y:17.5}; (entry[prop] ||= []).push(o);
      assert.eq(PushBlocks.tryPush(scene,block,1,0),false,prop);
      entry[prop].pop();
    }
    scene.playerM.x=101.5;block.x=108.5;
    assert.eq(PushBlocks.tryPush(scene,block,1,0),false,'unloaded next tile');
  }));
  test('push blocks: diagonal, pulling, unmarked props and chain pushes are refused',()=>fixture((scene,block,entry)=>{
    assert.eq(PushBlocks.tryPush(scene,block,1,1),false);
    assert.eq(PushBlocks.tryPush(scene,block,-1,0),false);
    block.pushable=false;assert.eq(PushBlocks.tryPush(scene,block,1,0),false);block.pushable=true;
    const second={id:'second',pushable:true,x:24.5,y:17.5};entry.objects.push(second);
    assert.eq(PushBlocks.tryPush(scene,block,1,0),false);assert.eq(second.x,24.5);
    assert.eq(PushBlocks.destination({x:0,y:0},.5,.5,()=>false),null);
  }));
  test('push blocks: crossing tile/chunk edges transfers ownership and invalidates object buckets',()=>fixture((scene,block,entry)=>{
    const target={grid:new Uint8Array(256).fill(WorldGen.T.CAVE_FLOOR),cellsPerEdge:16,objects:[]};
    WorldGen.tileCache.set(WorldGen.tileKey(1,0),target);
    scene.playerM.x=101.5;block.x=108.5;
    PushBlocks.at(scene,block.x,block.y);
    assert.truthy(entry._chunkIdx.objects);
    assert.eq(PushBlocks.tryPush(scene,block,1,0),true);
    assert.eq(entry.objects.length,0);assert.eq(target.objects[0],block);
    assert.eq(block.x,115.5);assert.eq(entry._chunkIdx.objects,undefined);
    assert.eq(PushBlocks.at(scene,block.x,block.y),block);
  }));
  test('push blocks: tap reports adjacency and obstruction without consuming or replacing a block',()=>fixture((scene,block,entry)=>{
    const messages=[];scene.flash=text=>messages.push(text);
    scene.playerM.y=10.5;
    assert.eq(PushBlocks.interact({scene},block),true);
    assert.truthy(messages.pop().includes('Stand beside'));
    assert.eq(block.x,17.5);
    scene.playerM.y=17.5;
    entry.grid[2*16+3]=WorldGen.T.WATER;
    PushBlocks.interact({scene},block);
    assert.truthy(messages.pop().includes('clear, dry'));
    entry.grid[2*16+3]=WorldGen.T.CAVE_FLOOR;
    PushBlocks.interact({scene},block);
    assert.eq(messages.pop(),'Pushed block.');
    assert.eq(entry.objects[0],block);assert.eq(block.x,24.5);
  }));
})();
