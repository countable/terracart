// Run against a served checkout. Exercises real IndexedDB across page reloads;
// the relay stays disabled and no player save is written by map review.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const DB = 'mapgame-generated-tiles';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext(), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let revision = '', changedSource = false, changedTile = '';
    await page.route('**/index.html', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace(/(window\.__shellVersion\s*=\s*')([^']*)(')/,
        (_, a, version, b) => a + version + revision + b);
      await route.fulfill({ response, body });
    });
    await page.route('**/map-review.html*', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace('    await loadGame();', `    await loadGame();
        window.__cacheTrace=[];
        const prepare=WorldGen.prepareTile;
        WorldGen.prepareTile=async (...args)=>{
          const start=performance.now(),result=await prepare(...args);
          __cacheTrace.push({tx:args[2],ty:args[3],hit:result.fromCache,ms:performance.now()-start});
          return result;
        };`);
      await route.fulfill({ response, body });
    });
    await page.route('**/test/fixtures/*.pbf', async route => {
      const response = await route.fetch(), bytes = await response.body();
      // A valid unknown protobuf field changes the content hash without changing
      // decoded geometry, allowing an exact-world comparison after invalidation.
      const body = changedSource && route.request().url().includes(changedTile)
        ? Buffer.concat([bytes, Buffer.from([8, 1])]) : bytes;
      await route.fulfill({ response, body });
    });
    const base = process.env.REVIEW_BASE_URL || 'http://localhost:8765';
    async function load() {
      const start = Date.now();
      await page.goto(`${base}/tools/map-review.html?geometry=off`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__world && !building || document.querySelector('#status').textContent.startsWith('failed:'), null, { timeout: 180000 });
      assert.equal(await page.locator('#status').textContent(), 'ready');
      const totalMs = Date.now() - start;
      const result = await page.evaluate(async () => {
        const fields = ['grid','baseGrid','owners','ownerKeys','syntheticBuildingCells','mappedLand','roadMask','roadClass','spawnWhy','gameplayTiers','gameplayReasons','objects','wildplants','creatures','traps','buildingShapes','caveSource','streetDress','zoneDress','parkingTreasures'];
        const world = { tiles: __world.tiles.map(e => Object.fromEntries([['tx', e.tx], ['ty', e.ty], ...fields.map(key => [key, e[key]]), ['coverage', e.zone?.coverage]])), guards: __world.guards };
        const data = JSON.stringify(world, (_, value) => ArrayBuffer.isView(value) ? Array.from(value) : value);
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)))].map(b => b.toString(16).padStart(2, '0')).join('');
        return { hash, trace: __cacheTrace, version: window.__shellVersion, errors: __world.errors };
      });
      assert.deepEqual(result.errors, []); assert.deepEqual(errors, []);
      assert.equal(result.trace.length, 9);
      return { totalMs, ...result };
    }
    const cold = await load();
    assert.ok(cold.trace.every(t => !t.hit), 'first visit generates all nine bases');
    const warm = await load();
    assert.ok(warm.trace.every(t => t.hit), 'reload reads all nine bases from disk');
    assert.equal(warm.hash, cold.hash, 'cached arrays, source layer edits, objects and guard placements match');
    assert.equal(await page.evaluate(async () => {
      let checked=0;
      for(const e of raw) {
        const {result:r}=await WorldGen.prepareTile(e.bytes,WorldGen.cellsPerEdgeForTile(e.ty),e.tx,e.ty,EDGE);
        if(!r.zone?.caveSource)continue;
        if(WorldGen.gameplayTiersOf(r.zone.caveSource.grid)!==r.gameplayTiers)throw Error('Nexus cave source lost its geographic tier policy');
        checked++;
      }
      return checked>0;
    }),true,'cached Nexus cave-mouth inputs restore their policy registrations');
    // The live loadTile path must use the same cache as the review tool.
    assert.equal(await page.evaluate(async () => {
      const bytes = raw[0].bytes, {tx,ty} = raw[0], lat = WorldGen.latOfRowCentre(raw[Math.floor(raw.length/2)].ty);
      WorldGen.tileCache.clear();
      const decode = MVT.decodeTileSliced;
      MVT.decodeTileSliced = () => { throw Error('cache hit attempted MVT decode'); };
      try {
        const entry = await WorldGen.loadTile(tx,ty,lat,{bytesPromise:Promise.resolve({bytes,fromCache:true})});
        await entry.promise;
        return entry.status;
      } finally { MVT.decodeTileSliced = decode; }
    }), 'ready', 'game tile loading reuses the tool base before applying its own live bins');
    revision = '-test-next';
    const updated = await load();
    assert.ok(updated.trace.every(t => !t.hit), 'new shell version regenerates every tile');
    assert.equal(updated.hash, cold.hash);
    const updatedWarm = await load();
    assert.ok(updatedWarm.trace.every(t => t.hit));
    assert.equal(updatedWarm.hash, cold.hash);
    changedTile = `${cold.trace[0].tx}_${cold.trace[0].ty}.pbf`; changedSource = true;
    const changed = await load();
    assert.equal(changed.trace.filter(t => !t.hit).length, 1, 'only the changed source tile regenerates');
    assert.equal(changed.hash, cold.hash);
    // Corrupt one active-version record and verify that it is discarded/repaired.
    await page.evaluate(async ({name,version}) => {
      const db = await new Promise((resolve,reject) => {const request=indexedDB.open(name,1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      try {
        await new Promise((resolve,reject) => {
          const tx=db.transaction('tiles','readwrite'),store=tx.objectStore('tiles'),request=store.openCursor();
          request.onsuccess=()=>{const c=request.result;if(!c)return;
            const last=raw[raw.length-1],prefix=`1/${version}/14/${last.tx}/${last.ty}/`;
            if(String(c.key).startsWith(prefix)){const record=c.value;record.result.grid=new Uint8Array(1);c.update(record);}else c.continue();};
          tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
        });
      } finally { db.close(); }
    }, {name:DB,version:changed.version});
    const repaired = await load();
    assert.equal(repaired.trace.filter(t => !t.hit).length, 1, 'a malformed base regenerates independently');
    assert.equal(repaired.hash, cold.hash);
    const quota = await page.evaluate(async name => {
      await WorldGen.clearGeneratedTileCache();
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name===name&&this.name==='tiles')throw new DOMException('quota','QuotaExceededError');return put.apply(this,args);};
      try {const e=raw[0];const result=await WorldGen.prepareTile(e.bytes,WorldGen.cellsPerEdgeForTile(e.ty),e.tx,e.ty,EDGE);return {hit:result.fromCache,cells:result.result.grid.length};}
      finally { IDBObjectStore.prototype.put=put; }
    }, DB);
    assert.equal(quota.hit,false); assert.ok(quota.cells>0, 'quota refusal still generates playable terrain');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({coldMs:cold.totalMs,warmMs:warm.totalMs,coldPreparationMs:cold.trace.reduce((n,t)=>n+t.ms,0),warmPreparationMs:warm.trace.reduce((n,t)=>n+t.ms,0),hash:cold.hash},null,2));
    console.log('Persistent hits, world parity, game/tool sharing, version/source invalidation, corruption recovery and quota fallback passed.');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
