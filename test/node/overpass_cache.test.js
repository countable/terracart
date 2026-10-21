(() => {
  const HOUR = 3600000;
  function fixture({ store = new Map(), unavailable = false, response, now = 100 * HOUR } = {}) {
    const requests = [], reads = [];
    const source = WORLDGEN_SRC.slice(WORLDGEN_SRC.indexOf('  const OVERPASS_MAX_CONCURRENT'),
      WORLDGEN_SRC.indexOf('  function warmPrivateVeto'));
    const env = {
      Date: { now: () => now, parse: Date.parse },
      idbGet: async key => { reads.push(key); return unavailable ? null : store.get(key); },
      idbPut: async (key, value) => { if (!unavailable) store.set(key, value); },
      fetch: async (endpoint, options) => { requests.push({ endpoint, options }); return response ? response(endpoint, options) : { ok: true, json: async () => ({ elements: [] }) }; },
      OVERPASS_ENDPOINTS: ['first', 'second'], OVERPASS_TIMEOUT_MS: 22000,
      AbortController: undefined, Z: 14, TILE_EXTENT: 4096,
      buildOverpassQL: (x, y) => `decoration ${x} ${y}`,
      buildBinsFromGeoJSON: () => new Map(), overpassToGeoJSON: rows => rows,
      emptyBin: () => ({ trees: [] }), ovpNote() {}, cellsPerEdgeForTile: () => 2,
      tileLat: y => y, tileLon: x => x,
    };
    const api = new Function(...Object.keys(env), source + '\nreturn { fetchOverpassBin, fetchPrivateVeto, _privateVeto };')(...Object.values(env));
    return { ...api, requests, reads, store, advance: amount => { now += amount; } };
  }

  test('Overpass cache: decoration is reused indefinitely and dedup includes the asynchronous cache read', async () => {
    const f = fixture();
    const a = f.fetchOverpassBin(1, 2, 49), b = f.fetchOverpassBin(1, 2, 49);
    assert.eq(a, b);
    const bin = await a;
    assert.eq(f.requests.length, 1);
    assert.eq(f.reads.filter(key => key === 'ovp2/14/1/2').length, 1);
    f.advance(365 * 24 * HOUR);
    assert.eq(await f.fetchOverpassBin(1, 2, 49), bin);
    const reloaded = fixture({ store: f.store });
    assert.truthy(await reloaded.fetchOverpassBin(1, 2, 49));
    assert.eq(reloaded.requests.length, 0);
  });

  test('Overpass cache: endpoint refusal suppresses other tiles and query kinds across reloads', async () => {
    const response = async () => ({ ok: false, status: 429, headers: { get: () => '28800' } });
    const f = fixture({ response });
    assert.eq(await f.fetchOverpassBin(1, 2, 49), null);
    assert.eq(f.requests.length, 2);
    assert.eq(f.store.get('ovp2/14/1/2').until, 108 * HOUR, 'longer Retry-After wins over six hours');
    await f.fetchPrivateVeto(3, 4);
    await f.fetchOverpassBin(5, 6, 49);
    assert.eq(f.requests.length, 2, 'both query kinds share endpoint cooldowns');
    const reloaded = fixture({ store: f.store, response });
    await reloaded.fetchOverpassBin(7, 8, 49);
    assert.eq(reloaded.requests.length, 0, 'new tiles honor persistent endpoint backoff');
    reloaded.advance(8 * HOUR + 1);
    await reloaded.fetchOverpassBin(7, 8, 49);
    assert.eq(reloaded.requests.length, 2, 'expired cooldown permits another bounded attempt');
  });

  test('Overpass cache: rate-limit backoff honors HTTP-date Retry-After and its six-hour minimum', async () => {
    for (const [retryAfter, hours] of [[null, 6], [new Date(110 * HOUR).toUTCString(), 10]]) {
      const f = fixture({ response: async () => ({ ok: false, status: 429, headers: { get: () => retryAfter } }) });
      await f.fetchOverpassBin(1, 2, 49);
      assert.eq(f.store.get('ovp2/14/1/2').until, (100 + hours) * HOUR);
    }
  });

  test('Overpass cache: success and network failure remain cached without IndexedDB', async () => {
    const good = fixture({ unavailable: true });
    await good.fetchOverpassBin(1, 2, 49); await good.fetchOverpassBin(1, 2, 49);
    assert.eq(good.requests.length, 1);
    const bad = fixture({ unavailable: true, response: async () => { throw new Error('offline'); } });
    await bad.fetchOverpassBin(1, 2, 49); await bad.fetchOverpassBin(1, 2, 49);
    await bad.fetchPrivateVeto(3, 4);
    assert.eq(bad.requests.length, 2);
    bad.advance(HOUR + 1);
    await bad.fetchOverpassBin(1, 2, 49);
    assert.eq(bad.requests.length, 4);
  });

  test('Overpass cache: a partial response is never persisted as successful decoration', async () => {
    const f = fixture({ response: async () => ({ ok: true, json: async () => ({ remark: 'runtime timeout', elements: [] }) }) });
    assert.eq(await f.fetchOverpassBin(1, 2, 49), null);
    assert.truthy(f.store.get('ovp2/14/1/2')._failed);
    assert.eq(f.requests.length, 2);
  });

  test('Overpass cache: a stale private mask stays active while refreshing and survives failure/reload', async () => {
    const mask = new Uint8Array([1, 0, 0, 1]), store = new Map([['pvt1/14/1/2', { mask, until: 1 }]]);
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    const f = fixture({ store, response: async () => { await wait; return { ok: false, status: 503 }; } });
    const pending = f.fetchPrivateVeto(1, 2);
    assert.eq(pending, f.fetchPrivateVeto(1, 2), 'cache reads and refresh share one promise');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.eq(f._privateVeto.get('1_2'), mask, 'old mask installed before network settles');
    release();
    assert.eq(await pending, mask);
    assert.eq(store.get('pvt1/14/1/2').mask, mask, 'failed refresh does not overwrite good data');
    const reloaded = fixture({ store });
    assert.eq(await reloaded.fetchPrivateVeto(1, 2), mask);
    assert.eq(reloaded.requests.length, 0);
    reloaded.advance(HOUR + 1);
    const fresh = await reloaded.fetchPrivateVeto(1, 2);
    assert.eq(fresh[0], 0, 'a complete empty answer can remove an old fence');
    assert.eq(store.get('pvt1/14/1/2').until, 101 * HOUR + 1 + 30 * 24 * HOUR);
  });
})();
