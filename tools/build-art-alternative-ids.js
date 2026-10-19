#!/usr/bin/env node
// Append-only source/crop references shared by the item and world dashboards.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = __dirname;
const registryPath = path.join(root, 'art-alternative-ids.json');
const registry = fs.existsSync(registryPath)
  ? JSON.parse(fs.readFileSync(registryPath, 'utf8'))
  : { schemaVersion: 1, entries: [] };
const key = entry => JSON.stringify([entry.source, ...entry.crop]);
const byKey = new Map();
const ids = new Set();
let next = 1;
for (const entry of registry.entries) {
  if (!/^ALT-\d{4,}$/.test(entry.id) || ids.has(entry.id) || byKey.has(key(entry))) throw new Error('Invalid alternative ID registry');
  ids.add(entry.id);
  byKey.set(key(entry), entry);
  next = Math.max(next, Number(entry.id.slice(4)) + 1);
}
const current = [];
for (const name of ['world-art-alternatives.json', 'art-candidates/furniture/alternatives.json',
  'art-candidates/historical-rocks/alternatives.json', 'art-candidates/indexed/alternatives.json']) {
  current.push(...JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')).entries);
}
const legacy = vm.runInNewContext(fs.readFileSync(path.join(root, 'item-art-candidates.js'), 'utf8') + '\nItemArtCandidates;');
for (const packs of Object.values(legacy.rows)) {
  for (const [pack, options] of Object.entries(packs)) {
    for (const option of options) {
      const source = { ...legacy.packs[pack], ...option };
      const cell = source.cell || 16, inset = source.inset || 0;
      current.push({ source: source.source, crop: source.crop || [source.col * cell + inset, source.row * cell + inset, 16, 16] });
    }
  }
}
let added = 0;
for (const entry of current) {
  if (!entry.source || !Array.isArray(entry.crop) || entry.crop.length !== 4 || !entry.crop.every(Number.isInteger)) throw new Error('Invalid alternative coordinates');
  if (byKey.has(key(entry))) continue;
  if (process.argv.includes('--check')) throw new Error('Unregistered alternative: ' + key(entry));
  const record = { id: 'ALT-' + String(next++).padStart(4, '0'), source: entry.source, crop: entry.crop };
  registry.entries.push(record);
  byKey.set(key(record), record);
  added++;
}
if (!process.argv.includes('--check')) fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
console.log(`${registry.entries.length} stable alternative IDs; ${added} added.`);
