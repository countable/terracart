// Load the GAME'S OWN modules into a tool page — the review and balancing
// pages share this so neither keeps a module list of its own to drift.
//
// The list is read out of index.html at load, in its order, then app.js (which
// index.html loads from its boot script, not a tag). Phaser is replaced by one
// inert proxy — callable, constructible, every property itself — so app.js
// defines MapScene and its tables without a game ever booting. Paths are
// RELATIVE to tools/, so the pages work served from a repo root and from
// GitHub Pages' /terracart/ alike. The save is disabled once loaded: a tool
// page never writes one.
(function () {
  const inert = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'prototype' ? {} : inert),
    apply: () => inert,
    construct: () => inert,
  });
  window.Phaser = inert;

  window.loadGame = async function loadGame() {
    const html = await (await fetch('../index.html', { cache: 'no-store' })).text();
    const srcs = [...html.matchAll(/<script src="(src\/[^"?]+)(?:\?([^"]*))?"><\/script>/g)].map((m) => m[1] + (m[2] ? '?' + m[2] : ''));
    srcs.push(html.match(/const APP_SRC = '([^']+)'/)?.[1] || 'src/app.js');
    // Fetch together, execute in document order: these classic scripts share
    // globals. Keep the game's content hashes so unchanged modules can cache.
    await Promise.all(srcs.map(src =>
      new Promise((res, rej) => {
        const s = document.createElement('script');
        s.async = false;
        s.src = '../' + src;
        s.onload = res;
        s.onerror = () => rej(new Error('could not load ' + src));
        document.head.appendChild(s);
      })
    ));
    if (typeof disableSave === 'function') disableSave();
  };
})();
