// App-shell audit — file-level checks that the page and the service worker
// agree about what the app is made of. Node-scope (needs fs), so it's wired
// into test/node/run.js the same way the sprite audit is.
//
// The bug that motivated it: index.html loads ~25 versioned modules, sw.js
// hand-listed 6 of them, and app.js was on the list while save.js was not. A
// refresh right after a deploy — new ?v= URLs, one request hiccuping — booted
// the app WITHOUT its save layer and threw "loadSave is not defined". The
// worker now reads the script list out of index.html instead of keeping its
// own copy; these checks keep it that way, and keep every referenced file real.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Every same-origin script index.html pulls in — the <script src> tags plus
// app.js, which the boot gate injects from the APP_SRC string.
function indexScripts() {
  const html = read('index.html');
  const urls = [];
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) urls.push(m[1]);
  const app = html.match(/APP_SRC\s*=\s*['"]([^'"]+)['"]/);
  if (app) urls.push(app[1]);
  return urls.filter((u) => !/^[a-z]+:\/\//i.test(u) && !u.startsWith('//'));
}

const CHECKS = [
  {
    name: 'shell: every script index.html loads exists on disk',
    run() {
      const missing = indexScripts()
        .map((u) => u.split('?')[0])
        .filter((p) => !fs.existsSync(path.join(ROOT, p)));
      if (missing.length) throw new Error(`missing files: ${missing.join(', ')}`);
    },
  },
  {
    name: 'shell: index.html loads app.js through the boot gate, not a tag',
    run() {
      const html = read('index.html');
      if (/<script[^>]+src=["'][^"']*\/app\.js/.test(html)) {
        throw new Error('app.js has a plain <script> tag — the boot gate injects it');
      }
      if (!/APP_SRC\s*=\s*['"][^'"]*app\.js/.test(html)) throw new Error('APP_SRC not found');
    },
  },
  {
    name: 'shell: the worker derives its script list from index.html',
    run() {
      const sw = read('sw.js');
      if (!/scriptUrlsFromIndex/.test(sw)) {
        throw new Error('sw.js no longer reads the script list out of index.html');
      }
      // A hand-listed subset is the drift that broke a boot once already: the
      // list is for non-scripts, and the scripts come from the page itself.
      const block = sw.match(/const SHELL_ASSETS = \[([\s\S]*?)\]/);
      if (!block) throw new Error('SHELL_ASSETS not found in sw.js');
      const scripts = block[1].split('\n').filter((l) => /\.js['"]/.test(l) && !/vendor\//.test(l));
      if (scripts.length) {
        throw new Error(`SHELL_ASSETS hand-lists app scripts again: ${scripts.map((s) => s.trim()).join(' ')}`);
      }
    },
  },
  {
    name: 'shell: both a failed script AND a failed page fall back to a cached build',
    run() {
      const sw = read('sw.js');
      // Two independent fallbacks, one per branch of the fetch handler: the
      // page itself (network-first) and the versioned modules. Counting them
      // is crude, but it catches losing EITHER — and losing the script one is
      // what half-boots the app on a hiccuped deploy.
      const n = (sw.match(/ignoreSearch:\s*true/g) || []).length;
      if (n < 2) {
        throw new Error(`sw.js has ${n} version-agnostic cache fallback(s), expected `
          + '2 (one for HTML, one for scripts) — without the script one a hiccuped '
          + 'request during a deploy drops a module and half-boots the app');
      }
    },
  },
];

module.exports = { CHECKS, indexScripts };
