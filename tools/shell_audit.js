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

// ── Texture keys the renderer names ────────────────────────────────────────
// RENDER_SPEC's `key` decides which texture each world object draws with. A key
// that nothing creates is not an error anywhere — Phaser quietly resolves it to
// its __MISSING placeholder and the object renders as a checkerboard.
//
// That is how `open_box` shipped: the renderer swapped an opened crate to an
// "open lid" texture that no asset registered and no PNG provided, so every
// looted crate drew the placeholder. Nothing failed; it just looked wrong.
//
// Only STATICALLY KNOWABLE keys are checked. Several kinds compute their key
// from data (a house's role, a tree's species, a ground stack's item icon);
// those are skipped rather than guessed at, so this can't produce false alarms.
const { blankComments, objectLiteralAt, topLevelEntries, valueBranches } =
  require('./modal_audit.js');

// Keys the game can actually draw with: everything ASSETS registers, plus every
// procedural canvas texture textures.js creates.
function providedTextureKeys() {
  const assets = blankComments(read('src/assets.js'));
  const at = assets.indexOf('ASSETS');
  const body = objectLiteralAt(assets, assets.indexOf('{', at));
  if (body == null) throw new Error('shell_audit: could not parse ASSETS in src/assets.js');
  const keys = new Set([...topLevelEntries(body).keys()]);
  const tex = blankComments(read('src/textures.js'));
  for (const m of tex.matchAll(/const KEY = '([^']+)'/g)) keys.add(m[1]);
  // Not everything goes through the ASSETS table: a few sprites are loaded
  // straight from app.js's preload (the staircases are). Those are just as
  // real, and missing them here would have this audit cry wolf about them.
  const app = blankComments(read('src/app.js'));
  for (const m of app.matchAll(/this\.load\.(?:image|spritesheet|atlas)\('([^']+)'/g)) keys.add(m[1]);
  return keys;
}

// { key -> kind } for every texture key RENDER_SPEC names as a literal result.
function referencedTextureKeys() {
  const src = blankComments(read('src/render.js'));
  const at = src.indexOf('const RENDER_SPEC = {');
  if (at < 0) throw new Error('shell_audit: RENDER_SPEC not found in src/render.js');
  const body = objectLiteralAt(src, src.indexOf('{', at));
  if (body == null) throw new Error('shell_audit: could not parse RENDER_SPEC');
  const out = new Map();
  let dynamic = 0;
  for (const [kind, val] of topLevelEntries(body)) {
    const inner = objectLiteralAt(val, val.indexOf('{'));
    if (inner == null) continue;
    let k = topLevelEntries(inner).get('key');
    if (k == null) continue;
    k = k.replace(/^\([^)]*\)\s*=>\s*/, '');            // drop the arrow head
    for (const branch of valueBranches(k)) {
      const lit = branch.match(/^'([^']*)'$/);
      if (lit) out.set(lit[1], kind);
      else dynamic++;                                   // computed — not checkable
    }
  }
  return { keys: out, dynamic };
}

CHECKS.push({
  name: 'textures: the renderer only names textures that exist',
  run: () => {
    const provided = providedTextureKeys();
    const { keys, dynamic } = referencedTextureKeys();
    // Guard against a parser that quietly matches nothing: RENDER_SPEC has had
    // a dozen-plus kinds for a long time, and several name a literal key.
    if (keys.size < 8) {
      throw new Error(`only resolved ${keys.size} literal texture keys — the scanner is broken`);
    }
    if (provided.size < 20) {
      throw new Error(`only found ${provided.size} provided textures — the scanner is broken`);
    }
    if (dynamic < 1) {
      throw new Error('expected some computed keys — the branch splitter is over-matching');
    }
    const missing = [...keys].filter(([k]) => !provided.has(k));
    if (missing.length) {
      throw new Error(missing.map(([k, kind]) => `${kind} draws with '${k}'`).join(', ') +
        ' — no ASSETS entry and no textures.js canvas creates it, so Phaser will ' +
        'resolve it to __MISSING and the object renders as a placeholder.');
    }
  },
});

// A procedural texture nobody calls is the same bug from the other end: the key
// exists in textures.js, the renderer asks for it, and it is still never made.
//
// Reachability, not a flat "is it called from app.js" — several makers are
// internal helpers that a top-level maker fans out to (makeAllPadShapes calls
// makePadShapeTexture calls makeRoundPadTexture), and those are created at boot
// just as surely as the ones app.js names directly.
CHECKS.push({
  name: 'textures: every procedural texture is actually created at boot',
  run: () => {
    const tex = blankComments(read('src/textures.js'));
    const app = blankComments(read('src/app.js'));
    const makers = [...tex.matchAll(/function (make\w+)\s*\(/g)].map((m) => m[1]);
    if (makers.length < 5) throw new Error(`found only ${makers.length} texture makers — scanner broken`);
    // Body of each maker, so we can see which other makers it calls.
    const bodyOf = (fn) => {
      const at = tex.indexOf(`function ${fn}`);
      const next = makers
        .map((o) => tex.indexOf(`function ${o}`))
        .filter((i) => i > at)
        .sort((a, b) => a - b)[0];
      return tex.slice(at, next === undefined ? tex.length : next);
    };
    const calls = (src, fn) => new RegExp(`\\b${fn}\\s*\\(`).test(src);
    const reachable = new Set(makers.filter((fn) => calls(app, fn)));
    if (!reachable.size) throw new Error('no texture maker is called from app.js — scanner broken');
    for (let grew = true; grew;) {
      grew = false;
      for (const fn of makers) {
        if (reachable.has(fn)) continue;
        if ([...reachable].some((r) => calls(bodyOf(r), fn))) { reachable.add(fn); grew = true; }
      }
    }
    const dead = makers.filter((fn) => !reachable.has(fn));
    if (dead.length) {
      throw new Error(`${dead.join(', ')} defined in textures.js but never reached at boot — ` +
        'anything drawn with those keys renders as Phaser\'s __MISSING placeholder.');
    }
  },
});

module.exports = { CHECKS, indexScripts, providedTextureKeys, referencedTextureKeys };
