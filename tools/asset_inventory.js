#!/usr/bin/env node
// Read-only reference inventory. Candidates require review before deletion.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const IMAGE = /\.(?:png|webp|jpe?g|gif|svg|avif)$/i;
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// Preserve quoted strings and line numbers while removing ordinary comments.
// This is a conservative scan, not a JS parser (see docs/ASSET_INVENTORY.md).
function uncomment(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
    (m) => m.startsWith('//') || m.startsWith('/*') ? m.replace(/[^\n]/g, ' ') : m);
}

function walk(dir) {
  if (!fs.existsSync(path.join(ROOT, dir))) return [];
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((entry) => {
      const file = `${dir}/${entry.name}`;
      return entry.isDirectory() ? walk(file) : entry.isFile() ? [file] : [];
    }).sort();
}

function inventory() {
  const references = new Map();
  function add(file, evidence) {
    file = file.split(/[?#]/)[0];
    if (!references.has(file)) references.set(file, new Set());
    references.get(file).add(evidence);
  }
  const context = { console, addEventListener() {} };
  context.window = context;
  vm.createContext(context);
  for (const file of ['src/util.js', 'src/enemy_roster.js', 'src/sprite_layout.js', 'src/items.js', 'src/assets.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  for (const [key, asset] of Object.entries(context.ASSETS)) {
    add(asset.path, `src/assets.js: ASSETS.${key} (preload, including enemy roster)`);
  }

  const app = read('src/app.js');
  const iconTable = app.match(/const ICON_SHEETS = \{[\s\S]*?\n\};/);
  if (!iconTable) throw new Error('Cannot locate ICON_SHEETS; update the inventory scanner.');
  vm.runInContext(iconTable[0], context);
  for (const [key, sheet] of Object.entries(vm.runInContext('ICON_SHEETS', context))) {
    add(sheet.url, `src/app.js: ICON_SHEETS.${key} (DOM icons)`);
  }
  const gear = vm.runInContext(`['relic', 'armor'].flatMap(kind =>
    Object.keys(kind === 'relic' ? RELIC_DEFS : ARMOR_DEFS).flatMap(slot =>
      Object.keys(TIER_BY_NUM).map(tier => ({
        path: gearAssetPath(kind, slot, Number(tier)), kind, slot, tier,
      }))))`, context);
  for (const row of gear) {
    add(row.path, `src/items.js: gearAssetPath(${row.kind}, ${row.slot}, ${row.tier})`);
  }

  for (const file of walk('src').filter((file) => file.endsWith('.js'))) {
    const source = uncomment(read(file));
    const line = (match) => source.slice(0, match.index).split('\n').length;
    // ASSETS has already been evaluated; overridden literals are not live references.
    for (const match of (file === 'src/assets.js' ? '' : source).matchAll(/['"`](assets\/[^'"`\n]*?\.(?:png|webp|jpe?g|gif|svg|avif)(?:\?[^'"`\n]*)?)['"`]/g)) {
      if (!match[1].includes('${')) add(match[1], `${file}:${line(match)} literal reference`);
    }
    for (const match of source.matchAll(/\b(?:art|story)\s*:\s*['"]([a-z_]+)['"]/g)) {
      add(`assets/art/${match[1]}.webp`, `${file}:${line(match)} scene painting stem`);
    }
  }
  // Restore paintings are assembled from the local role INFO table.
  const restoreInfo = uncomment(app).match(/const INFO = \{([\s\S]*?)\n\s*\};\s*const info = INFO\[role\]/);
  if (!restoreInfo) throw new Error('Cannot locate restoration roles; update the inventory scanner.');
  for (const match of restoreInfo[1].matchAll(/^\s*(\w+):/gm)) {
    const role = match[1] === 'plain' ? 'house' : match[1];
    add(`assets/art/restore_${role}.webp`, `src/app.js: restoration INFO.${match[1]}`);
  }
  const index = read('index.html').replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g,
    (m) => m.replace(/[^\n]/g, ' '));
  for (const match of index.matchAll(/assets\/[^'"<>\n]*?\.(?:png|webp|jpe?g|gif|svg|avif)/g)) {
    if (!match[0].includes('${')) {
      add(match[0], `index.html:${index.slice(0, match.index).split('\n').length} image/CSS reference`);
    }
  }

  function gitFiles(args) {
    return new Set(execFileSync('git', ['ls-files', '-z', ...args, '--', 'assets', 'art-source'],
      { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean));
  }
  const tracked = gitFiles(['--cached']);
  const ignored = gitFiles(['--others', '--ignored', '--exclude-standard']);
  function record(file) {
    return {
      path: file,
      status: tracked.has(file) ? 'tracked' : ignored.has(file) ? 'ignored' : 'untracked',
      bytes: fs.statSync(path.join(ROOT, file)).size,
    };
  }
  const used = [...references].sort(([a], [b]) => a.localeCompare(b)).map(([file, evidence]) => ({
    path: file, evidence: [...evidence],
  }));
  const missing = used.filter((row) => !fs.existsSync(path.join(ROOT, row.path)));
  const candidates = walk('assets').filter((file) => IMAGE.test(file) && !references.has(file)).map(record);
  const sources = walk('art-source').filter((file) => IMAGE.test(file)).map(record);
  const byStatus = (rows) => Object.fromEntries(['tracked', 'untracked', 'ignored']
    .map((status) => [status, rows.filter((row) => row.status === status).length]));
  return {
    summary: { referenced: used.length, missing: missing.length,
      candidates: byStatus(candidates), sources: byStatus(sources) },
    references: used, missing, candidates, sources,
  };
}

try {
  if (process.argv.slice(2).some((arg) => arg !== '--json')) throw new Error('Usage: node tools/asset_inventory.js [--json]');
  const result = inventory();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Referenced images: ${result.summary.referenced}; missing: ${result.missing.length}`);
    for (const row of result.missing) console.log(`MISSING ${row.path}\n  ${row.evidence.join('\n  ')}`);
    console.log(`Unreferenced candidates: ${result.candidates.length} (review before deleting)`);
    for (const row of result.candidates) console.log(`  ${row.status.padEnd(9)} ${String(row.bytes).padStart(9)} B  ${row.path}`);
    console.log(`Preserved source/reserve images outside runtime assets: ${result.sources.length}`);
    console.log('Scope and limitations: docs/ASSET_INVENTORY.md');
  }
  if (result.missing.length) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
