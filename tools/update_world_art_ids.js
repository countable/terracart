#!/usr/bin/env node
// Append new catalog identities; never renumber or recycle removed entries.
// In the world-art browser console: copy(JSON.stringify(worldArt.rows.map(r => ({id:r.id}))))
// Save that JSON, then run: node tools/update_world_art_ids.js /tmp/world-art-rows.json
const fs = require('node:fs');
const path = require('node:path');
function appendIds(registry, rows) {
  const entries = {...registry.entries};
  const used = Object.values(entries);
  if (new Set(used).size !== used.length || used.some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('Invalid or duplicate catalog numbers');
  let next = Math.max(0, ...used) + 1;
  for (const id of [...new Set(rows.map(row => row.id))].sort()) {
    if (typeof id !== 'string' || !id) throw new Error('Every catalog row needs its stable identity');
    if (!Object.hasOwn(entries, id)) entries[id] = next++;
  }
  return {schemaVersion:1, identity:'Catalog row identity, independent of sorting, filtering and sprite replacement. Retired numbers remain reserved.', entries};
}
if (require.main === module) {
  if (!process.argv[2]) throw new Error('Usage: node tools/update_world_art_ids.js ROWS.json');
  const file = path.join(__dirname, 'world-art-ids.json');
  const registry = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {entries:{}};
  const result = appendIds(registry, JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
  fs.writeFileSync(file, JSON.stringify(result,null,2)+'\n');
  console.log(`${Object.keys(result.entries).length} reserved world-art numbers`);
}
module.exports = {appendIds};
