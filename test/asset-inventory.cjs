// Asset relocation safety: exercise the shipping inventory, not a duplicate manifest.
const assert = require('node:assert/strict');
const { inventory } = require('../tools/asset_inventory');
const result = inventory();
assert.deepEqual(result.missing, [], 'every active reference exists');
const active = new Set(result.references.map(row => row.path));
for (const file of ['assets/art/chest_t7.webp', 'assets/portraits/chicken.png',
  'assets/ArtTrials/RogueObjects/tree-wide-a.png', 'assets/ui/compass/shine/reference-header.webp']) {
  assert(active.has(file), `dynamic runtime reference retained: ${file}`);
}
assert(result.references.every(row => row.evidence.length), 'every live file has reference evidence');
assert(result.candidates.every(row => !active.has(row.path)), 'archive candidates exclude active paths');
assert(result.candidates.every(row => Array.isArray(row.supportReferences)), 'tool references accompany candidates');
assert(!result.references.some(row => row.path.includes('DreamlandObjects/')), 'retired profile is not live');
console.log('Asset inventory: dynamic references, Rogue-only manifest, and candidate separation passed.');
