(() => {
  const source = INDEX_HTML_SRC.split('// Local art trials use the current checkout,')[1]
    .split('// End local art trial cache reset.')[0];
  async function run({ url = 'http://localhost:8000/index.html?artTrial=dreamland',
    controlled = true, scopes = ['http://localhost:8000/'], stored = new Map(), unregister = true } = {}) {
    const removed = [], window = {};
    let reloads = 0, queries = 0;
    const location = new URL(url);
    location.reload = () => reloads++;
    const navigator = { serviceWorker: { controller: controlled ? {} : null,
      async getRegistrations() { queries++; return scopes.map(scope => ({ scope,
        async unregister() { removed.push(scope); return unregister; } })); } } };
    new Function('window', 'location', 'navigator', 'sessionStorage',
      '// Local art trials use the current checkout,' + source)(window, location, navigator, {
      getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key)
    });
    await window.__artTrialCacheReady;
    return { window, removed, reloads, queries, stored };
  }
  test('art trial cache: controlled local preview releases only its exact worker scope and preserves saves', async () => {
    const stored = new Map([['terracart.save', 'keep']]);
    const result = await run({ scopes: ['http://localhost:8000/other/', 'http://localhost:8000/'], stored });
    assert.eq(result.removed.join(), 'http://localhost:8000/');
    assert.eq(result.reloads, 1);
    assert.eq(stored.get('terracart.save'), 'keep');
    const repeated = await run({ stored });
    assert.eq(repeated.reloads, 0);
    const released = await run({ controlled: false, stored });
    assert.eq(released.reloads, 0);
    assert.eq(stored.size, 1);
  });
  test('art trial cache: uncontrolled preview skips reload and future worker registration', async () => {
    const result = await run({ controlled: false });
    assert.eq(result.window.__localArtTrial, true);
    assert.eq(result.reloads, 0);
    assert.eq(INDEX_HTML_SRC.includes("location.protocol !== 'file:' && !window.__localArtTrial"), true);
  });
  test('art trial cache: normal games, other trials, and remote hosts retain workers', async () => {
    for (const url of ['http://localhost:8000/index.html', 'http://localhost:8000/?artTrial=unknown',
      'https://game.example/?artTrial=dreamland', 'https://localhost.example/?artTrial=rogue']) {
      const result = await run({ url });
      assert.eq(result.window.__localArtTrial, false);
      assert.eq(result.queries, 0);
      assert.eq(result.reloads, 0);
    }
  });
  test('art trial cache: a parent or another application worker is not unregistered', async () => {
    const result = await run({ url: 'http://localhost:8000/game/index.html?artTrial=rogue',
      scopes: ['http://localhost:8000/', 'http://localhost:8000/other/'] });
    assert.eq(result.removed.length, 0);
    assert.eq(result.reloads, 0);
    assert.eq((await run({ unregister: false })).reloads, 0);
  });
  test('art trial cache: IPv4 and IPv6 loopback previews opt out too', async () => {
    for (const host of ['127.0.0.1', '[::1]']) {
      const result = await run({ url: `http://${host}:8000/?artTrial=rogue`, scopes: [], controlled: false });
      assert.eq(result.window.__localArtTrial, true);
    }
  });
})();
