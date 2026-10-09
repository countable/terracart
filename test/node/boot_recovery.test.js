(() => {
  const source = INDEX_HTML_SRC.split('// Boot recovery stays inline:')[1].split('// End boot recovery.')[0];
  function harness(storage = new Map(), online = true) {
    const listeners = {}, timers = [], nodes = [];
    let reloads = 0;
    const window = { addEventListener(name, cb) { listeners[name] = cb; } };
    const document = {
      body: { appendChild(node) { nodes.push(node); } },
      createElement() { return { style: {}, children: [], setAttribute() {}, append(...kids) { this.children.push(...kids); } }; }
    };
    const navigator = { onLine: online };
    const sessionStorage = { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
    new Function('window', 'document', 'navigator', 'sessionStorage', 'location', 'setTimeout', 'clearTimeout',
      '// Boot recovery stays inline:' + source)(window, document, navigator, sessionStorage,
      { reload() { reloads++; } }, cb => { timers.push(cb); return timers.length; }, () => {});
    return { window, listeners, timers, nodes, navigator, reloads: () => reloads,
      fail: () => listeners.error({ target: { tagName: 'SCRIPT', src: '/src/geo.js', dataset: {} } }) };
  }
  test('boot recovery: a burst of failed dependencies schedules only one ordered page retry', () => {
    const store = new Map(), h = harness(store);
    for (let i = 0; i < 126; i++) h.fail();
    assert.eq(h.nodes.length, 1); assert.eq(h.timers.length, 1);
    assert.eq(store.get('terracart.bootRetries'), '1');
    h.timers[0](); assert.eq(h.reloads(), 1);
  });
  test('boot recovery: persistent failure exhausts its budget and manual retry preserves saves', () => {
    const store = new Map([['terracart.save', 'keep']]);
    for (let i = 0; i < 2; i++) { const h = harness(store); h.fail(); assert.eq(h.timers.length, 1); h.timers[0](); }
    const h = harness(store); h.fail(); assert.eq(h.timers.length, 0);
    h.nodes[0].children[1].onclick(); assert.eq(h.reloads(), 1);
    assert.eq(store.get('terracart.save'), 'keep'); assert.eq(store.has('terracart.bootRetries'), false);
  });
  test('boot recovery: offline waits for online without spending additional retries', () => {
    const store = new Map(), h = harness(store, false); h.fail();
    assert.eq(h.timers.length, 0); h.navigator.onLine = true;
    h.listeners.online(); h.listeners.online(); assert.eq(h.timers.length, 1);
    assert.eq(store.get('terracart.bootRetries'), '1');
  });
  test('boot recovery: disconnect during backoff waits and reconnect rearms once', () => {
    const store = new Map(), h = harness(store); h.fail();
    h.navigator.onLine = false; h.timers[0](); assert.eq(h.reloads(), 0);
    h.navigator.onLine = true; h.listeners.online(); h.listeners.online();
    assert.eq(h.timers.length, 2); h.timers[1](); assert.eq(h.reloads(), 1);
    assert.eq(store.get('terracart.bootRetries'), '1');
  });
  test('boot recovery: denied storage offers manual recovery without reload loop', () => {
    const h = harness({ get() { throw new Error('blocked'); } }); h.fail();
    assert.eq(h.timers.length, 0); assert.eq(h.nodes.length, 1);
  });
  test('boot recovery: only dependency resource errors retry, and playable startup resets budget', () => {
    const store = new Map([['terracart.bootRetries', '2']]), h = harness(store);
    h.listeners.error({ target: h.window, error: new Error('runtime') });
    h.listeners.error({ target: { tagName: 'IMG', src: '/image.png' } });
    h.listeners.error({ target: { tagName: 'SCRIPT', src: '/src/app.js', dataset: { bootApp: 'true' } } });
    assert.eq(h.window.__bootRecovery.failed, false); assert.eq(h.timers.length, 0);
    h.window.__bootRecovery.ready(); assert.eq(store.has('terracart.bootRetries'), false);
    h.fail(); assert.eq(h.window.__bootRecovery.failed, false);
    assert.eq(h.nodes.length, 0);
    const failed = harness(store); failed.fail(); failed.window.__bootRecovery.ready();
    assert.eq(store.get('terracart.bootRetries'), '1');
  });
})();
