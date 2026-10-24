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
// This is a conservative scan, not a JS parser (see docs/art/ASSET_INVENTORY.md).
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
    if (typeof file !== 'string' || !file) return; // Procedural textures have no file.
    file = file.split(/[?#]/)[0];
    if (!references.has(file)) references.set(file, new Set());
    references.get(file).add(evidence);
  }
  const profiles = ['rogue'];
  const modules = ['src/util.js', 'src/enemy_roster.js', 'src/sprite_layout.js',
    'src/selected_item_art.js', 'src/items.js', 'src/art_atlas.js',
    'src/selected_world_atlas.js', 'src/assets.js',
    'src/ra_terrain_trial.js', 'src/rogue_object_bounds.js',
    'src/rogue_prop_profile.js', 'src/rogue_objects.js', 'src/street_variants.js',
    'src/character_portraits.js'];
  let context;
  for (const profile of profiles) {
    context = { console, URLSearchParams, location: {search: profile ? '?artTrial=' + profile : ''}, addEventListener() {} };
    context.window = context;
    vm.createContext(context);
    for (const file of modules) vm.runInContext(read(file), context, { filename: file });
    for (const [key, asset] of Object.entries(context.ASSETS)) {
      add(asset.path, `ASSETS.${key} (${profile || 'default'} profile preload)`);
    }
  }
  for (const id of vm.runInContext('[...CharacterPortraits.PET_IDS, ...CharacterPortraits.NPC_IDS]', context)) {
    add(`assets/portraits/${id}.png`, 'CharacterPortraits dynamic portrait');
  }
  // Compass emission filenames are assembled from this local source table.
  for (const match of read('src/compass_shine.js').matchAll(/['"](reference-[a-z-]+)['"]/g)) {
    add(`assets/ui/compass/shine/${match[1]}.webp`, 'CompassShine source layer');
  }

  const declared = read('src/assets.js').match(/const ASSETS = (\{[\s\S]*?\n\});/);
  const baseAssets = vm.runInContext('(' + declared[1] + ')', context);
  const overrides = Object.entries(baseAssets).filter(([key, asset]) => asset.path && context.ASSETS[key]?.path !== asset.path)
    .map(([key, asset]) => ({key, from: asset.path, to: context.ASSETS[key]?.path, metadata: context.ASSETS[key], preserveOnLoad: !!asset.onLoad && String(asset.onLoad) === String(context.ASSETS[key]?.onLoad)}));

  // Street story IDs can select a different painting through an explicit art override.
  for (const row of [...context.StreetVariants.STREET_VARIANTS, context.StreetVariants.BANDIT_STORY]) {
    if (row.story) add(`assets/art/${row.art || row.story}.webp`, `src/street_variants.js: ${row.story} painting`);
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

  const loadedScripts = new Set([...read('index.html').matchAll(/<script[^>]+src=["'](src\/[^"'?]+)(?:\?[^"']*)?["']/g)].map(match => match[1]));
  loadedScripts.add('src/app.js');
  const paintingStems = new Set(walk('assets/art').filter(file => file.endsWith('.webp')).map(file => path.basename(file, '.webp')));
  for (const file of [...loadedScripts].filter(file => fs.existsSync(path.join(ROOT, file)))) {
    const source = uncomment(read(file));
    const line = (match) => source.slice(0, match.index).split('\n').length;
    // Paintings also occur in arrays, returns and conditional expressions.
    // The generated thumbnail index is coverage metadata, not a consumer.
    if (file !== 'src/art_thumbs.js') for (const match of source.matchAll(/['"]([a-z][a-z0-9_]+)['"]/g)) {
      if (paintingStems.has(match[1])) add(`assets/art/${match[1]}.webp`, `${file}:${line(match)} painting stem`);
    }

    // ASSETS has already been evaluated; overridden literals are not live references.
    for (const match of (file === 'src/assets.js' ? '' : source).matchAll(/['"`](assets\/[^'"`\n]*?\.(?:png|webp|jpe?g|gif|svg|avif)(?:\?[^'"`\n]*)?)['"`]/g)) {
      if (!match[1].includes('${')) add(match[1], `${file}:${line(match)} literal reference`);
    }
    for (const match of (file === 'src/street_variants.js' ? '' : source).matchAll(/\b(?:art|story)\s*:\s*['"]([a-z_]+)['"]/g)) {
      add(`assets/art/${match[1]}.webp`, `${file}:${line(match)} scene painting stem`);
    }
  }
  for (const tier of vm.runInContext('Object.keys(TIER_BY_NUM)', context)) {
    add(`assets/art/chest_t${tier}.webp`, 'chestOpeningArt dynamic tier painting');
  }
  const index = read('index.html').replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g,
    (m) => m.replace(/[^\n]/g, ' '));
  for (const match of index.matchAll(/assets\/[^'"<>\n]*?\.(?:png|webp|jpe?g|gif|svg|avif)/g)) {
    if (!match[0].includes('${')) {
      add(match[0], `index.html:${index.slice(0, match.index).split('\n').length} image/CSS reference`);
    }
  }

  for (const file of walk('css').filter(file => file.endsWith('.css'))) {
    for (const match of uncomment(read(file)).matchAll(/(?:\.\.\/)?(assets\/[^'"()\n]*?\.(?:png|webp|jpe?g|gif|svg|avif))(?:\?[^'"()\n]*)?/g)) {
      add(match[1], `${file}: CSS image`);
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
  const supportFiles = ['tools', 'docs', 'test', 'assets'].flatMap(walk)
    .filter(file => /\.(?:js|cjs|mjs|py|json|md|html|css|txt)$/.test(file)
      && !['tools/asset_inventory.js', 'tools/art-usage-audit.json'].includes(file));
  const support = supportFiles.map(file => ({file, text:read(file)}));
  const candidates = walk('assets').filter((file) => IMAGE.test(file) && !references.has(file)).map(file => {
    const evidence = support.filter(row => row.text.includes(file)).map(row => row.file);
    const source = /\/(?:sources?|masters?|originals?|raw|candidates?)(?:\/|$)/i.test(file);
    return {...record(file), category: source ? 'source' : evidence.length ? 'tool-or-documentation' : 'unreferenced',
      supportReferences: evidence};
  });
  const sourceRoot = path.resolve(process.env.TERRACART_ART_ROOT || path.join(require('os').homedir(), '.artifacts', 'terracart-art'));
  const sources = fs.existsSync(sourceRoot) ? fs.readdirSync(sourceRoot, { recursive: true })
    .filter((file) => IMAGE.test(file) && fs.statSync(path.join(sourceRoot, file)).isFile())
    .sort().map((file) => ({ path: path.join(sourceRoot, file), status: 'external', bytes: fs.statSync(path.join(sourceRoot, file)).size })) : [];
  const byStatus = (rows) => Object.fromEntries(['tracked', 'untracked', 'ignored']
    .map((status) => [status, rows.filter((row) => row.status === status).length]));
  return {
    summary: { referenced: used.length, missing: missing.length,
      candidates: byStatus(candidates), sources: { external: sources.length } },
    references: used, missing, candidates, sources, overrides,
  };
}

if (require.main === module) try {
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
    console.log('Scope and limitations: docs/art/ASSET_INVENTORY.md');
  }
  if (result.missing.length) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

module.exports = { inventory, uncomment };
