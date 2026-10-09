// Exercise the real worker with isolated CacheStorage and fetch, without a browser.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const source = () => fs.readFileSync(require('path').join(__dirname, '../sw.js'), 'utf8');
const origin = 'https://game.example/';
const urlOf = req => new URL(typeof req === 'string' ? req : req.url, origin).href;
function storage(add = async () => new Response('shell')) {
  const stores = new Map();
  return {
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const rows = stores.get(name);
      return {
        async match(req, opts = {}) {
          const url = urlOf(req);
          const key = opts.ignoreSearch ? [...rows.keys()].find(k => k.split('?')[0] === url.split('?')[0]) : url;
          return rows.get(key)?.clone();
        },
        async put(req, response) { rows.set(urlOf(req), response.clone()); },
        async keys() { return [...rows.keys()].map(k => new Request(k)); },
        async delete(req) { return rows.delete(urlOf(req)); },
        async add(req) { rows.set(urlOf(req), await add(req)); },
      };
    },
  };
}
function worker(caches, version, hash, network = () => new Response('network')) {
  const handlers = {}, calls = [];
  const code = source().replace(/const SHELL_VERSION = '[^']*'/, `const SHELL_VERSION = '${version}'`)
    .replace(/\/\* ASSET_HASHES_START \*\/[\s\S]*?\/\* ASSET_HASHES_END \*\//,
      `const ASSET_HASHES = { 'assets/test.png': '${hash}' };`);
  const ctx = {
    URL, Request, Response, Date, caches,
    fetch: async req => { calls.push(urlOf(req)); return network(req); },
    self: { location: new URL('sw.js', origin), skipWaiting() {}, clients: { async claim() {} },
      addEventListener(name, fn) { handlers[name] = fn; } },
  };
  vm.runInNewContext(code, ctx);
  return {
    calls,
    async event(name, path, opts = {}) {
      const pending = []; let response;
      handlers[name]({ request: path ? new Request(new URL(path, origin), opts) : undefined,
        waitUntil(p) { pending.push(p); }, respondWith(p) { response = p; } });
      const result = await response;
      for (let i = 0; i < pending.length; i++) await pending[i];
      return result;
    },
  };
}
const CHECKS = [
  { name: 'worker: immutable scripts and images survive deploys without background requests', async run() {
    const caches = storage();
    let w = worker(caches, 'shell-one', 'aaaaaaaa');
    await w.event('fetch', 'src/a.js?v=11111111');
    await w.event('fetch', 'assets/test.png');
    assert.equal(w.calls[1], origin + 'assets/test.png?v=aaaaaaaa', 'asset network URL busts HTTP cache too');
    w = worker(caches, 'shell-two', 'aaaaaaaa');
    await w.event('fetch', 'src/a.js?v=11111111');
    await w.event('fetch', 'assets/test.png');
    assert.equal(w.calls.length, 0);
    w = worker(caches, 'shell-three', 'bbbbbbbb');
    await w.event('fetch', 'assets/test.png');
    assert.deepEqual(w.calls, [origin + 'assets/test.png?v=bbbbbbbb']);
  } },
  { name: 'worker: install reuses exact cached scripts and explicit retries reach network', async run() {
    const caches = storage();
    const old = await caches.open('shell-legacy');
    await old.put('src/a.js?v=11111111', new Response('old exact script'));
    const w = worker(caches, 'shell-new', 'aaaaaaaa', req => urlOf(req).endsWith('index.html')
      ? new Response('<script src="src/a.js?v=11111111"></script>') : new Response('retry'));
    await w.event('install');
    assert.deepEqual(w.calls, [origin + 'index.html']);
    assert.equal(await (await w.event('fetch', 'src/a.js?v=11111111')).text(), 'old exact script');
    await w.event('fetch', 'src/a.js?retry=123');
    await w.event('fetch', 'assets/test.png', { cache: 'reload' });
    assert.equal(w.calls.length, 3);
  } },
  { name: 'worker: activation keeps current and previous resources, tiles and unrelated caches', async run() {
    const caches = storage();
    for (const [version, urls] of [['shell-old', ['src/old.js?v=00000000']], ['shell-prev', ['src/prev.js?v=11111111']], ['shell-now', ['src/now.js?v=22222222']]]) {
      const shell = await caches.open(version);
      await shell.put('./__terracart_resource_manifest__', new Response(JSON.stringify(urls.map(u => origin + u))));
      const resources = await caches.open('terracart-resources-v1');
      for (const u of urls) await resources.put(u, new Response(u));
    }
    await caches.open('tiles-v1'); await caches.open('another-app');
    const w = worker(caches, 'shell-now', 'aaaaaaaa'); await w.event('activate');
    assert(!(await caches.keys()).includes('shell-old'));
    assert((await caches.keys()).includes('another-app'));
    assert((await caches.keys()).includes('tiles-v1'));
    const resources = await caches.open('terracart-resources-v1');
    assert.equal((await resources.keys()).length, 2);
    assert(await resources.match('src/prev.js?v=11111111'));
  } },
  { name: 'worker: HTML and explicit retry queries always reach the network', async run() {
    const caches = storage();
    const w = worker(caches, 'shell-now', 'aaaaaaaa');
    for (const path of ['index.html?v=12345678', 'src/a.js?v=11111111&retry=1']) {
      await w.event('fetch', path);
      await w.event('fetch', path);
      assert.equal(w.calls.filter(url => url === origin + path).length, 2, path);
    }
    const resources = await caches.open('terracart-resources-v1');
    assert.equal((await resources.keys()).length, 0, 'neither request belongs in the immutable cache');
  } },
  { name: 'worker: quota failures preserve successful fetch and migrated script responses', async run() {
    const caches = storage();
    const old = await caches.open('shell-legacy');
    await old.put('src/legacy.js?v=11111111', new Response('legacy bytes'));
    const open = caches.open.bind(caches);
    caches.open = async name => {
      const cache = await open(name);
      return name === 'terracart-resources-v1'
        ? { ...cache, async put() { throw Error('QuotaExceededError'); } } : cache;
    };
    const w = worker(caches, 'shell-now', 'aaaaaaaa');
    assert.equal(await (await w.event('fetch', 'src/a.js?v=22222222')).text(), 'network');
    assert.equal(await (await w.event('fetch', 'assets/test.png')).text(), 'network');
    assert.equal(await (await w.event('fetch', 'src/legacy.js?v=11111111')).text(), 'legacy bytes');
    assert.equal(w.calls.length, 2, 'migration still uses the existing bytes');
  } },
  { name: 'worker: offline install preserves HTML and exact scripts without substituting stale resources', async run() {
    const caches = storage(async () => { throw Error('offline'); }); const old = await caches.open('shell-old');
    await old.put('index.html', new Response('offline HTML'));
    await old.put('src/a.js?v=11111111', new Response('offline script'));
    const resource = await caches.open('terracart-resources-v1');
    await resource.put('assets/test.png?v=aaaaaaaa', new Response('old image'));
    const w = worker(caches, 'shell-new', 'bbbbbbbb', () => { throw Error('offline'); });
    await w.event('install'); await w.event('activate');
    assert((await caches.keys()).includes('shell-old'));
    assert.equal(await (await w.event('fetch', 'index.html?offline=1')).text(), 'offline HTML');
    assert.equal(await (await w.event('fetch', 'src/a.js?v=11111111')).text(), 'offline script');
    assert.equal((await w.event('fetch', 'src/a.js?v=22222222')).status, 504);
    assert.equal((await w.event('fetch', 'assets/test.png')).status, 504);
    assert(await resource.match('assets/test.png?v=aaaaaaaa'));
  } },
  { name: 'worker: failed new scripts never load another version from either cache', async run() {
    for (const cacheName of ['terracart-resources-v1', 'shell-old']) {
      for (const failure of ['offline', 'unavailable']) {
        const caches = storage();
        const cache = await caches.open(cacheName);
        await cache.put('src/a.js?v=11111111', new Response('old incompatible script'));
        const w = worker(caches, 'shell-new', 'aaaaaaaa', () => {
          if (failure === 'offline') throw Error('network changed');
          return new Response('temporarily unavailable', { status: 503 });
        });
        const missing = await w.event('fetch', 'src/a.js?v=22222222');
        assert.equal(missing.status, failure === 'offline' ? 504 : 503, cacheName);
        assert.notEqual(await missing.text(), 'old incompatible script');
        const exact = await w.event('fetch', 'src/a.js?v=11111111');
        assert.equal(await exact.text(), 'old incompatible script', 'exact versions remain available offline');
        assert.deepEqual(w.calls, [origin + 'src/a.js?v=22222222'], 'exact cached version needs no network');
        const resources = await caches.open('terracart-resources-v1');
        assert.equal(await resources.match('src/a.js?v=22222222'), undefined, 'failed version is not cached');
      }
    }
  } },
];
module.exports = { CHECKS };
if (require.main === module) (async () => {
  for (const check of CHECKS) { await check.run(); console.log('PASS', check.name); }
})().catch(err => { console.error(err); process.exitCode = 1; });
