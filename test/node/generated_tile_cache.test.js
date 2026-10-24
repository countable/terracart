(() => {
  const Cache = new Function(ALL_SRC['generated_tile_cache.js'] + '\nreturn GeneratedTileCache;')();
  const later = callback => Promise.resolve().then(callback);
  // Minimal request/transaction fixture. The browser checks exercise actual
  // structured cloning; this fixture tests cache policy and failure recovery.
  function memoryIDB() {
    const databases = new Map(), connections = [];
    const factory = { opens: 0, payloadWrites: 0, failOpen: false, failWrite: false, connections,
      open(name) {
        const request = {}; factory.opens++;
        later(() => {
          if (factory.failOpen) { request.onerror?.(); return; }
          const fresh = !databases.has(name);
          if (fresh) databases.set(name, new Map());
          const stores = databases.get(name);
          const db = { closed: false, objectStoreNames: { contains: key => stores.has(key) },
            close() { this.closed = true; },
            createObjectStore(key, options) { stores.set(key, { data: new Map(), keyPath: options?.keyPath }); return { createIndex() {} }; },
            transaction(names) {
              if (db.closed) throw Error('closed database');
              const local = new Map(names.map(key => [key, new Map(stores.get(key).data)]));
              let pending = 0, aborted = false;
              const tx = { abort() { if (!aborted) { aborted = true; later(() => tx.onabort?.()); } },
                objectStore(key) {
                  const data = local.get(key), keyPath = stores.get(key).keyPath;
                  const operation = (fn, request = {}) => {
                    pending++;
                    later(() => {
                      if (aborted) return;
                      try { request.result = fn(); request.onsuccess?.(); }
                      catch (_) { aborted = true; tx.onerror?.(); return; }
                      pending--;
                      if (!pending) later(() => {
                        if (aborted || pending) return;
                        for (const [k, value] of local) stores.get(k).data = value;
                        tx.oncomplete?.();
                      });
                    });
                    return request;
                  };
                  return {
                    get: id => operation(() => data.get(id)),
                    put(value, id = value?.[keyPath]) {
                      if (factory.failWrite || typeof value === 'function') throw Error('quota or clone failure');
                      if (key === 'tiles') factory.payloadWrites++;
                      return operation(() => { data.set(id, value); return id; });
                    },
                    delete: id => operation(() => data.delete(id)),
                    clear: () => operation(() => data.clear()), count: () => operation(() => data.size),
                    index: () => ({ openCursor(_range, direction) {
                      const rows = [...data.values()].sort((a, b) => a.usedAt - b.usedAt);
                      if (direction === 'prev') rows.reverse();
                      let at = 0;
                      const request = {}, read = () => {
                        if (at >= rows.length) return null;
                        const row = rows[at];
                        return { value: row, delete: () => operation(() => data.delete(row.key)),
                          continue() { at++; operation(read, request); } };
                      };
                      return operation(read, request);
                    } }),
                  };
                },
              };
              return tx;
            },
          };
          request.result = db; connections.push(db);
          if (fresh) request.onupgradeneeded?.();
          request.onsuccess?.();
        });
        return request;
      },
    };
    return factory;
  }
  test('generated tile cache: unavailable, denied and blocked storage bypass without rejection', async () => {
    const factories = [null, { open() { throw Error('denied'); } },
      { open() { const request = {}; later(() => request.onerror()); return request; } }];
    for (const indexedDB of factories) {
      const cache = Cache.create({ indexedDB });
      assert.eq(await cache.get('tile'), null); assert.eq(await cache.put('tile', {}), false);
      assert.eq(await cache.remove('tile'), false); assert.eq(await cache.clear(), false);
    }
    let closed = 0;
    const blocked = Cache.create({ indexedDB: { open() {
      const request = {};
      later(() => {
        request.onblocked(); request.result = { close() { closed++; } }; request.onsuccess();
      });
      return request;
    } } });
    assert.eq(await blocked.get('tile'), null);
    assert.eq(closed, 1, 'late success closes the bypassed connection');
  });
  test('generated tile cache: hits touch metadata and evict the least recently used payload', async () => {
    const indexedDB = memoryIDB(), cache = Cache.create({ indexedDB, maxEntries: 2 });
    assert.truthy(await cache.put('a', { seed: 1 }));
    assert.truthy(await cache.put('b', { seed: 2 }));
    const writes = indexedDB.payloadWrites;
    assert.eq((await cache.get('a')).seed, 1);
    assert.eq(indexedDB.payloadWrites, writes, 'a cache hit never reserializes its payload');
    assert.truthy(await cache.put('c', { seed: 3 }));
    assert.eq(await cache.get('b'), null, 'untouched entry was evicted');
    assert.eq((await cache.get('a')).seed, 1); assert.eq((await cache.get('c')).seed, 3);
    assert.truthy(await cache.put('a', { seed: 4 }));
    assert.eq((await cache.get('a')).seed, 4, 'replacement retains one LRU record');
    assert.truthy(await cache.remove('a')); assert.eq(await cache.get('a'), null);
    assert.truthy(await cache.clear()); assert.eq(await cache.get('c'), null);
  });
  test('generated tile cache: a restarted client shares disk recency and enforces a smaller bound', async () => {
    const indexedDB = memoryIDB(), original = Cache.create({ indexedDB, maxEntries: 4 });
    for (const key of ['a', 'b', 'c', 'd']) assert.truthy(await original.put(key, key));
    assert.eq(await original.get('a'), 'a');
    const restarted = Cache.create({ indexedDB, maxEntries: 2 });
    assert.truthy(await restarted.put('e', 'e'));
    assert.eq(await restarted.get('b'), null); assert.eq(await restarted.get('c'), null);
    assert.eq(await restarted.get('d'), null); assert.eq(await restarted.get('a'), 'a');
    assert.eq(await restarted.get('e'), 'e');
  });
  test('generated tile cache: transient open, quota and connection failures stay retryable', async () => {
    const indexedDB = memoryIDB(), cache = Cache.create({ indexedDB });
    indexedDB.failOpen = true; assert.eq(await cache.get('a'), null);
    indexedDB.failOpen = false; assert.truthy(await cache.put('a', 1));
    indexedDB.failWrite = true; assert.eq(await cache.put('b', 2), false);
    assert.eq(await cache.get('b'), null);
    indexedDB.failWrite = false; assert.truthy(await cache.put('b', 2));
    assert.eq(await cache.get('a'), 1);
    const connection = indexedDB.connections.at(-1), opens = indexedDB.opens;
    connection.onversionchange();
    assert.truthy(connection.closed);
    assert.eq(await cache.get('b'), 2); assert.eq(indexedDB.opens, opens + 1, 'version change reopens instead of retaining a closed handle');
    assert.truthy(await cache.clear()); assert.truthy(await cache.put('c', 3));
    assert.eq(await cache.get('c'), 3);
    assert.eq(await Cache.create({ indexedDB, maxEntries: 0 }).put('disabled', 1), false);
  });
})();
