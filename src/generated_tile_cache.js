// Optional persistent generated data. Keys and payload validity belong to WorldGen.
const GeneratedTileCache = (() => {
  const IO_TIMEOUT_MS = 1500;
  function create(options = {}) {
    const name = options.name || 'mapgame-generated-tiles';
    const maxEntries = Number.isFinite(options.maxEntries) ? Math.max(0, Math.floor(options.maxEntries)) : 64;
    let database = null, opening = null;
    function forget(db) {
      if (database === db) database = null;
      try { db.close(); } catch (_) { /* already closed */ }
    }
    function open() {
      if (database) return Promise.resolve(database);
      if (opening) return opening;
      opening = new Promise(resolve => {
        let request, timer, settled = false;
        const finish = value => {
          if (settled) return;
          settled = true; clearTimeout(timer); resolve(value);
        };
        try {
          const factory = Object.prototype.hasOwnProperty.call(options, 'indexedDB') ? options.indexedDB : globalThis.indexedDB;
          if (!factory) { finish(null); return; }
          request = factory.open(name, 1);
          timer = setTimeout(() => finish(null), IO_TIMEOUT_MS);
          request.onerror = request.onblocked = () => finish(null);
          request.onupgradeneeded = () => {
            try {
              if (settled) { request.transaction.abort(); return; }
              const db = request.result;
              if (!db.objectStoreNames.contains('tiles')) db.createObjectStore('tiles');
              if (!db.objectStoreNames.contains('usage')) db.createObjectStore('usage', { keyPath: 'key' }).createIndex('usedAt', 'usedAt');
            } catch (_) {
              try { request.transaction.abort(); } catch (_) { /* upgrade already aborted */ }
              finish(null);
            }
          };
          request.onsuccess = () => {
            const db = request.result;
            if (settled) { forget(db); return; }
            database = db;
            db.onversionchange = () => forget(db);
            db.onclose = () => { if (database === db) database = null; };
            finish(db);
          };
        } catch (_) { finish(null); }
      }).finally(() => { opening = null; });
      return opening;
    }
    async function transact(mode, fallback, run) {
      const db = await open();
      if (!db) return fallback;
      return new Promise(resolve => {
        let tx, timer, settled = false, result = fallback;
        const finish = value => {
          if (settled) return;
          settled = true; clearTimeout(timer); resolve(value);
        };
        const fail = () => {
          try { tx?.abort(); } catch (_) { /* inactive transaction */ }
          finish(fallback);
        };
        // IDB request callbacks must enqueue their follow-up requests before
        // returning; awaiting between them would let the transaction commit.
        const success = (request, callback) => {
          request.onsuccess = () => { try { callback(request.result); } catch (_) { fail(); } };
        };
        try {
          tx = db.transaction(['tiles', 'usage'], mode);
          timer = setTimeout(fail, IO_TIMEOUT_MS);
          tx.oncomplete = () => finish(result);
          tx.onerror = tx.onabort = () => finish(fallback);
          run(tx, value => { result = value; }, success);
        } catch (_) {
          if (!tx) forget(db);
          fail();
        }
      });
    }
    function nextUse(store, success, callback) {
      success(store.index('usedAt').openCursor(null, 'prev'), cursor => {
        // Transactions serialize across clients. Increment past the latest
        // stored value so same-millisecond accesses still have a strict order.
        callback(Math.max(Date.now(), (cursor?.value.usedAt || 0) + 1));
      });
    }
    function get(key) {
      return transact('readwrite', null, (tx, result, success) => {
        const usage = tx.objectStore('usage');
        success(tx.objectStore('tiles').get(key), value => {
          if (value === undefined) return;
          nextUse(usage, success, usedAt => {
            usage.put({ key, usedAt });
            result(value);
          });
        });
      });
    }
    function put(key, value) {
      if (!maxEntries) return Promise.resolve(false);
      return transact('readwrite', false, (tx, result, success) => {
        const tiles = tx.objectStore('tiles'), usage = tx.objectStore('usage');
        // IDB structured-clones directly: typed arrays, Maps, Sets and shared
        // references survive without a lossy JSON conversion or extra copy.
        tiles.put(value, key);
        nextUse(usage, success, usedAt => {
          usage.put({ key, usedAt });
          success(usage.count(), count => {
            let excess = count - maxEntries;
            if (excess <= 0) return;
            success(usage.index('usedAt').openCursor(), cursor => {
              if (!cursor || excess <= 0) return;
              tiles.delete(cursor.value.key); cursor.delete(); excess--;
              if (excess > 0) cursor.continue();
            });
          });
        });
        result(true);
      });
    }
    function remove(key) {
      return transact('readwrite', false, (tx, result) => {
        tx.objectStore('tiles').delete(key); tx.objectStore('usage').delete(key); result(true);
      });
    }
    function clear() {
      return transact('readwrite', false, (tx, result) => {
        tx.objectStore('tiles').clear(); tx.objectStore('usage').clear(); result(true);
      });
    }
    return { get, put, remove, clear };
  }
  return { create };
})();
