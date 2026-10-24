// Retired art URLs must boot the same renderer and offline policy as normal play.
(() => {
  const registration = INDEX_HTML_SRC.slice(INDEX_HTML_SRC.indexOf("    if ('serviceWorker' in navigator && location.protocol !== 'file:')"))
    .split('  </script>')[0];
  async function boot(url, supported = true) {
    const events = new Map(), registered = [];
    const navigator = supported ? { serviceWorker: {
      register: async path => { registered.push(path); },
      unregister() { throw new Error('Art URLs cannot unregister the game worker'); },
    } } : {};
    new Function('window', 'navigator', 'location', registration)(
      { addEventListener: (event, callback) => events.set(event, callback) }, navigator, new URL(url));
    events.get('load')?.();
    await Promise.resolve();
    return registered;
  }
  test('sole art renderer: normal and retired art URLs retain the same offline worker', async () => {
    for (const search of ['', '?artTrial=rogue', '?artTrial=dreamland', '?artTrial=trees-water', '?artTrial=unknown']) {
      for (const host of ['http://localhost:8000', 'https://game.example']) {
        assert.eq((await boot(host + '/index.html' + search)).join(), 'sw.js');
      }
    }
    assert.falsy(INDEX_HTML_SRC.includes('__localArtTrial'));
    assert.falsy(INDEX_HTML_SRC.includes('__artTrialCacheReady'));
    assert.falsy(INDEX_HTML_SRC.includes('artTrialWorkerReload'));
  });
  test('sole art renderer: file and unsupported browsers still skip worker registration', async () => {
    assert.eq((await boot('file:///game/index.html?artTrial=rogue')).length, 0);
    assert.eq((await boot('https://game.example/index.html?artTrial=rogue', false)).length, 0);
  });
})();
