// Exercise the shipping coordinator; storage itself is covered with real IDB
// in test/generated-tile-cache.cjs and the facade's failure/LRU tests.
(async () => {
  test('generated tile preparation: version, source, frame and seed invalidate while hits skip decode', async () => {
    const original={cache:globalThis.GeneratedTileCache,crypto:globalThis.crypto,version:globalThis.__shellVersion,
      raf:globalThis.requestAnimationFrame,decode:MVT.decodeTileSliced};
    const records=new Map();let decodes=0,writable=true;
    function clone(value,seen=new Map()) {
      if(!value||typeof value!=='object')return value;
      if(seen.has(value))return seen.get(value);
      if(ArrayBuffer.isView(value))return value.slice();
      const out=Array.isArray(value)?[]:value instanceof Set?new Set():value instanceof Map?new Map():{};seen.set(value,out);
      if(value instanceof Set){for(const v of value)out.add(clone(v,seen));}
      else if(value instanceof Map){for(const [k,v]of value)out.set(clone(k,seen),clone(v,seen));}
      else for(const [k,v]of Object.entries(value))out[k]=clone(v,seen);
      return out;
    }
    globalThis.GeneratedTileCache={create:()=>({get:async key=>clone(records.get(key))||null,
      put:async(key,value)=>{if(!writable)return false;records.set(key,clone(value));return true;},
      remove:async key=>records.delete(key),clear:async()=>{records.clear();return true;}})};
    // Deterministic stand-in for platform SHA-256, so this VM needs no WebCrypto.
    globalThis.crypto={subtle:{digest:async(_algorithm,bytes)=>new Uint8Array([bytes[0]||0,bytes[1]||0]).buffer}};
    globalThis.requestAnimationFrame=callback=>callback();
    MVT.decodeTileSliced=(...args)=>{decodes++;return original.decode(...args);};
    globalThis.__shellVersion='shell-test-a';
    const bytes=new Uint8Array([8,0]),generate=(source=bytes,N=8,edge=56)=>WorldGen.prepareTile(source,N,0,0,edge);
    try {
      const first=await generate();assert.falsy(first.fromCache);assert.eq(decodes,1);
      const record=records.values().next().value;
      record.result.zone={caveSource:{grid:record.result.grid.slice(),spawnWhy:record.result.spawnWhy.slice(),objects:[],wildplants:[]}};
      const cached=await generate();assert.truthy(cached.fromCache);assert.eq(decodes,1,'a hit skips decoding and generation');
      assert.eq(Array.from(cached.result.grid).join(','),Array.from(first.result.grid).join(','));
      assert.eq(WorldGen.gameplayTiersOf(cached.result.grid),cached.result.gameplayTiers,'rehydrated terrain uses its geographic tier field');
      assert.eq(WorldGen.gameplayTiersOf(null,{spawnWhy:cached.result.spawnWhy}),cached.result.gameplayTiers,'mask-only callers retain tier policy');
      assert.eq(WorldGen.gameplayTiersOf(cached.result.zone.caveSource.grid),cached.result.gameplayTiers,'Nexus cave-mouth input restores its own tier registration');
      first.result.grid[0]=WorldGen.T.WATER;
      assert.truthy((await generate()).result.grid[0]!==WorldGen.T.WATER,'live mutations never alter the stored base');
      globalThis.__shellVersion='shell-test-b';assert.falsy((await generate()).fromCache,'algorithm version changes regenerate');
      assert.falsy((await generate(new Uint8Array([8,1]))).fromCache,'changed MVT bytes regenerate');
      assert.falsy((await generate(bytes,8,57)).fromCache,'another world metre frame regenerates');
      assert.falsy((await generate(bytes,9,56)).fromCache,'another cell count regenerates');
      WorldGen.setReviewSalt(123);assert.falsy((await generate()).fromCache,'review rerolls never reuse another seed');
      WorldGen.setReviewSalt(0);assert.truthy((await generate()).fromCache,'the original seed still has its own base');
      const key=[...records.keys()].find(k=>k.includes('/shell-test-b/14/0/0/8/56/0/'));
      records.get(key).result.grid=new Uint8Array(1);
      assert.falsy((await generate()).fromCache,'malformed records are discarded');
      assert.truthy((await generate()).fromCache,'regeneration repairs the cached record');
      records.get(key).result.poiPadCells={};
      assert.falsy((await generate()).fromCache,'a broken pad reservation set also regenerates');
      await WorldGen.clearGeneratedTileCache();assert.eq(records.size,0,'game reset clears generated data');
      writable=false;assert.falsy((await generate()).fromCache,'a quota failure still returns generated terrain');
      assert.eq(records.size,0);
      globalThis.__shellVersion=null;assert.falsy((await generate()).fromCache,'unknown build versions bypass persistence');
    } finally {
      WorldGen.setReviewSalt(0);MVT.decodeTileSliced=original.decode;
      for(const [name,value]of Object.entries({GeneratedTileCache:original.cache,crypto:original.crypto,__shellVersion:original.version,requestAnimationFrame:original.raf})) {
        if(value===undefined)delete globalThis[name];else globalThis[name]=value;
      }
    }
  });

  test('generated tile preparation: boot burst and sliced scheduling produce the same base', async () => {
    const original = { cache: globalThis.GeneratedTileCache, version: globalThis.__shellVersion,
      raf: globalThis.requestAnimationFrame };
    globalThis.GeneratedTileCache = undefined;
    globalThis.__shellVersion = null;
    globalThis.requestAnimationFrame = callback => callback();
    const bytes = new Uint8Array([8, 0]);
    try {
      const sliced = (await WorldGen.prepareTile(bytes, 8, 0, 0, 56)).result;
      const burst = (await WorldGen.prepareTile(bytes, 8, 0, 0, 56, { bootPriority: true })).result;
      for (const name of ['grid', 'variantBaseGrid', 'mappedLand', 'owners', 'roadClass',
        'roadMask', 'quietMask', 'spawnWhy', 'gameplayTiers', 'gameplayReasons']) {
        assert.eq(Array.from(burst[name]).join(','), Array.from(sliced[name]).join(','), `${name} is byte-identical`);
      }
      assert.eq(JSON.stringify(burst.objects), JSON.stringify(sliced.objects), 'object records keep their order and identity');
      assert.eq(JSON.stringify(burst.wildplants), JSON.stringify(sliced.wildplants), 'wild plants keep their order and identity');
      assert.eq(JSON.stringify(burst.buildingShapes), JSON.stringify(sliced.buildingShapes), 'building geometry stays identical');
    } finally {
      for (const [name, value] of Object.entries({ GeneratedTileCache: original.cache,
        __shellVersion: original.version, requestAnimationFrame: original.raf })) {
        if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
      }
    }
  });
})();
