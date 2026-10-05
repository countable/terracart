// Cache-bust derivation — the `?v=` on every module IS a hash of that module's
// bytes, and sw.js's SHELL_VERSION is a hash of the whole resulting list.
//
// Why: a hand-bumped `?v=` left combat.js at a stale URL, so returning
// players' HTTP cache served old combat.js bytes to a refetched app.js that
// called Combat.playerDowned ("not a function", invisible on a cold cache).
// Bumping SHELL_VERSION does not reach it: the HTTP cache under the service
// worker still matches the identical URL.
//
// A hand-typed counter cannot be right by construction: it records what
// somebody remembered, not what changed, and a merge that resolves index.html
// picks one side's number for a file whose content is now BOTH sides'. So the
// number is derived instead — the `roadOverlayWidthM` discipline pointed at
// the tags. What ships and what the URL claims are one value read twice:
//
//   node tools/cachebust.js            # check: names every stale tag, exits 1
//   node tools/cachebust.js --write    # rewrite index.html + sw.js
//
// The check is wired into tools/shell_audit.js, so `node test/node/run.js`
// fails on drift rather than shipping it. A merge cannot collide two numbers,
// because the hash follows the merged content.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const INDEX = 'index.html';
const SW = 'sw.js';

// Eight hex characters of sha256. Long enough that two of this repo's modules
// colliding is not a thing that happens, short enough to read in a URL bar.
const HASH_LEN = 8;

const readFile = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The bytes, not the text — a file is stale if a single byte of it moved.
function hashOf(rel) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, rel)))
    .digest('hex')
    .slice(0, HASH_LEN);
}

// A URL index.html loads from our own origin. A CDN URL isn't ours to version
// (and isn't ours to cache — sw.js filters the same way).
function isOwn(url) {
  return !/^[a-z]+:\/\//i.test(url) && !url.startsWith('//');
}

// The versioned URL for one script path: `src/combat.js` → `src/combat.js?v=<hash>`.
// Anything that is not a same-origin .js we can read is handed back untouched,
// so a future non-script <script src> can't be mangled into a 404.
function versioned(url) {
  const file = url.split('?')[0];
  if (!isOwn(url) || !file.endsWith('.js')) return url;
  if (!fs.existsSync(path.join(ROOT, file))) return url;
  return `${file}?v=${hashOf(file)}`;
}

// index.html with every script URL rewritten to its content hash. Covers both
// the plain <script src> tags and app.js, which the boot gate injects from the
// APP_SRC string rather than a tag — the same two places sw.js reads.
function expectedIndex(html = readFile(INDEX)) {
  return html
    .replace(/(<script[^>]+src=["'])([^"']+)(["'])/g,
      (_, a, url, b) => a + versioned(url) + b)
    .replace(/(APP_SRC\s*=\s*['"])([^'"]+)(['"])/,
      (_, a, url, b) => a + versioned(url) + b);
}

// Every same-origin script URL the expected index.html asks for, in order.
function scriptUrls(html = expectedIndex()) {
  const urls = [];
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) urls.push(m[1]);
  const app = html.match(/APP_SRC\s*=\s*['"]([^'"]+)['"]/);
  if (app) urls.push(app[1]);
  return urls.filter(isOwn);
}

// All shipped media, including DOM-only icons and deferred story art. Embed
// hashes in the worker so media changes also trigger its browser update check.
function assetHashes() {
  const out = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(png|webp|jpe?g|gif|svg|ico|mp3|ogg|wav|woff2?)$/i.test(rel)) out[rel] = hashOf(rel);
    }
  }
  walk('assets');
  return out;
}
function assetManifestHash() {
  return crypto.createHash('sha256').update(JSON.stringify(assetHashes())).digest('hex').slice(0, HASH_LEN);
}

// SHELL_VERSION is derived from that list, so it moves whenever any module's
// hash or media bytes move. Unchanged resources retain their individual
// content-addressed cache keys across these shell generations.
function expectedShellVersion(urls = scriptUrls()) {
  const h = crypto.createHash('sha256').update(urls.join('\n') + '\n' + assetManifestHash()).digest('hex').slice(0, HASH_LEN);
  return `shell-${h}`;
}

function expectedSw(sw = readFile(SW), version = expectedShellVersion()) {
  return sw.replace(/(const SHELL_VERSION = ')[^']*(')/, `$1${version}$2`)
    .replace(/\/\* ASSET_HASHES_START \*\/[\s\S]*?\/\* ASSET_HASHES_END \*\//,
      '/* ASSET_HASHES_START */\nconst ASSET_HASHES = ' + JSON.stringify(assetHashes(), null, 2) + ';\n/* ASSET_HASHES_END */');
}

// Every tag whose ?v= disagrees with the file it points at, as { url, want }.
// The empty array is the whole pass condition.
// Read with matchAll rather than a replace callback: replace hands the FULL
// match in first, so a (a, url, b) callback silently hashes the `<script src="`
// prefix instead of the URL and reports everything clean.
function staleTags() {
  const html = readFile(INDEX);
  const out = [];
  for (const url of scriptUrls(html)) {
    const want = versioned(url);
    if (want !== url) out.push({ url, want });
  }
  return out;
}

function check() {
  const problems = [];
  for (const { url, want } of staleTags()) {
    problems.push(`${url} → ${want}`);
  }
  const sw = readFile(SW);
  if (!sw.includes('/* ASSET_HASHES_START */') || !sw.includes('/* ASSET_HASHES_END */')) {
    problems.push('sw.js is missing generated asset hash markers');
  }
  if (sw !== expectedSw(sw)) problems.push('sw.js asset manifest/version needs refresh');
  const want = expectedShellVersion();
  const has = (sw.match(/const SHELL_VERSION = '([^']*)'/) || [])[1];
  if (has !== want) problems.push(`sw.js SHELL_VERSION ${has} → ${want}`);
  return problems;
}

// A merge that conflicts on a ?v= tag or on SHELL_VERSION leaves both sides
// inside git's markers, and hashing the tags on each side rewrites them both
// while the markers stay — an index.html that renders '<<<<<<< HEAD' as text
// and an sw.js that is a syntax error. It shipped that way once (Sep 2026:
// the tests passed, since nothing looked). The markers are the merge's to
// resolve (keep either side; the hash follows the merged bytes), so --write
// refuses to touch a file that still carries them, and the audit fails on it.
const CONFLICT_MARKER = /^(<<<<<<< |=======$|>>>>>>> )/m;
function conflictMarkers() {
  return [INDEX, SW].filter((f) => CONFLICT_MARKER.test(readFile(f)));
}

function write() {
  const marked = conflictMarkers();
  if (marked.length) {
    throw new Error(`merge conflict markers in ${marked.join(', ')} — resolve them (keep either side) `
      + 'and run node tools/cachebust.js --write again');
  }
  const html = expectedIndex();
  const changedHtml = html !== readFile(INDEX);
  if (changedHtml) fs.writeFileSync(path.join(ROOT, INDEX), html);
  const sw = expectedSw(readFile(SW), expectedShellVersion(scriptUrls(html)));
  const changedSw = sw !== readFile(SW);
  if (changedSw) fs.writeFileSync(path.join(ROOT, SW), sw);
  return { changedHtml, changedSw };
}

// ── Audit ──────────────────────────────────────────────────────────────────
// Node scope (fs + crypto), so these are CHECKS wired into test/node/run.js
// the way the sprite and shell audits are — the *.test.js sandbox has no
// require(). The first check IS the enforcement; the rest pin the derivation
// under it, because that check can only be as good as the function it asks:
// a `versioned()` that quietly skipped files would leave the audit passing
// over exactly the drift it exists to catch.
const CHECKS = [
  {
    name: 'cache-bust: no merge conflict marker survives in index.html or sw.js',
    run() {
      const marked = conflictMarkers();
      if (marked.length) throw new Error(`conflict markers left in ${marked.join(', ')}`);
      if (!CONFLICT_MARKER.test('a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> x\n')) {
        throw new Error('the marker test does not see a marker');
      }
      if (CONFLICT_MARKER.test('a === b\n  // ======= a rule of equals signs\n')) {
        throw new Error('the marker test fires on ordinary text');
      }
    },
  },
  {
    name: 'cache-bust: every ?v= matches the bytes of the file it points at',
    run() {
      const problems = check();
      if (problems.length) {
        throw new Error(`${problems.length} stale cache-bust(s) — the old URL still serves the `
          + `old file to anyone who has it: ${problems.join(', ')}. `
          + 'fix: node tools/cachebust.js --write');
      }
    },
  },
  {
    name: 'cache-bust: every same-origin script carries a version',
    run() {
      const urls = scriptUrls();
      if (urls.length < 20) throw new Error(`found ${urls.length} scripts — the scanner is broken`);
      const bare = urls.filter((u) => !/\?v=[0-9a-f]+$/.test(u));
      if (bare.length) {
        throw new Error(`unversioned script(s): ${bare.join(', ')} — an unversioned URL never invalidates`);
      }
    },
  },
  {
    // The whole point of the derivation: the number follows the CONTENT. A
    // counter records what somebody remembered instead, which is what drifted.
    // On a scratch file, never a real module — a suite that rewrites src/ can
    // leave a half-restored source behind if it dies mid-check.
    name: 'cache-bust: a changed byte changes the version, and the same bytes hash the same',
    run() {
      const rel = 'tools/.cachebust_probe.js';
      const abs = path.join(ROOT, rel);
      try {
        fs.writeFileSync(abs, '// probe\n');
        const was = versioned(rel);
        if (!/\?v=[0-9a-f]+$/.test(was)) throw new Error(`probe got no version: ${was}`);
        if (versioned(rel) !== was) throw new Error('two reads of one unchanged file disagreed');
        fs.writeFileSync(abs, '// probe changed\n');
        if (versioned(rel) === was) throw new Error(`${rel} kept ${was} after its bytes changed`);
        fs.writeFileSync(abs, '// probe\n');
        if (versioned(rel) !== was) throw new Error('restoring the bytes did not restore the version');
      } finally {
        fs.rmSync(abs, { force: true });
      }
    },
  },
  {
    name: 'cache-bust: changed media changes the worker generation without script edits',
    run() {
      const rel = 'assets/.cachebust_probe.png';
      const abs = path.join(ROOT, rel);
      try {
        fs.writeFileSync(abs, 'media bytes one');
        const first = expectedShellVersion(['script.js?v=12345678']);
        const hash = assetHashes()[rel];
        if (!hash) throw new Error('media missing from asset hash map');
        fs.writeFileSync(abs, 'media bytes two');
        if (assetHashes()[rel] === hash) throw new Error('changed media retained its hash');
        if (expectedShellVersion(['script.js?v=12345678']) === first) throw new Error('media change did not update worker');
      } finally { fs.rmSync(abs, { force: true }); }
    },
  },
  {
    // Not ours to version, and not ours to cache — sw.js filters the same way.
    name: 'cache-bust: a CDN url is left alone',
    run() {
      for (const u of ['https://cdn.example.com/x.js', '//cdn.example.com/x.js']) {
        if (versioned(u) !== u) throw new Error(`${u} was rewritten`);
      }
    },
  },
  {
    // SHELL_VERSION is the worker's cache key, derived from the script list so
    // it moves when any module does. Two branches both hand-bumping it to
    // shell-v182 for different content is the collision derivation retires.
    name: 'cache-bust: SHELL_VERSION is derived from the script list',
    run() {
      const has = (readFile(SW).match(/const SHELL_VERSION = '([^']*)'/) || [])[1];
      if (has !== expectedShellVersion()) {
        throw new Error(`sw.js SHELL_VERSION ${has} does not match the scripts index.html loads`);
      }
      if (expectedShellVersion(['a.js?v=1']) === expectedShellVersion(['a.js?v=2'])) {
        throw new Error('a changed module left SHELL_VERSION where it was');
      }
    },
  },
];

module.exports = {
  CHECKS, check, write, staleTags, conflictMarkers, expectedShellVersion, scriptUrls, versioned, HASH_LEN, assetHashes, assetManifestHash,
};

if (require.main === module) {
  if (process.argv.includes('--write')) {
    const before = check();
    const { changedHtml, changedSw } = write();
    if (!changedHtml && !changedSw) console.log('cache-bust: already up to date');
    else {
      for (const p of before) console.log(`  ${p}`);
      console.log(`cache-bust: rewrote ${[changedHtml && INDEX, changedSw && SW].filter(Boolean).join(' + ')}`);
    }
  } else {
    const problems = check();
    if (!problems.length) {
      console.log(`cache-bust: ${scriptUrls().length} scripts, every ?v= matches its file`);
    } else {
      console.log('cache-bust: STALE — a changed module still serving its old URL:');
      for (const p of problems) console.log(`  ${p}`);
      console.log('\nfix: node tools/cachebust.js --write');
      process.exit(1);
    }
  }
}
