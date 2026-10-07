// The Developer menu's item cheat hands out relics and armour as well as
// items: every slot at every tier it comes in, set outright on the save.
test('item cheat: relics and armour join the catalogue and are equipped outright', () => {
  const block = INDEX_HTML_SRC.slice(INDEX_HTML_SRC.indexOf("id: 'item-cheats-modal'"));
  assert.truthy(/\[\['relic', RELIC_DEFS\], \['armor', ARMOR_DEFS\]\]/.test(block), 'both gear tables feed the catalogue');
  assert.truthy(/defs\[slot\]\.tiers \|\| MATERIAL_TIERS\.map\(t => t\.tier\)/.test(block), 'a slot with its own tier ladder keeps it');
  assert.truthy(/table\[slot\] = \{ tier \};/.test(block), 'a pick sets the slot outright');
  for (const slot of Object.keys(RELIC_DEFS)) assert.truthy(gearName('relic', slot, 1).length > 2, `${slot}: a name to search by`);
});
