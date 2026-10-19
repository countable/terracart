// Reviewed 16px source cells, zero-based columns/rows. Review only: never loaded by the game.
// Rogue 01_2 is the transparent colour sheet; 02/03 variants add backgrounds.
// Dreamland 03 is the transparent cyan glyph sheet; 01/02/04/05/07/08 add UI treatments.
const ItemArtCandidates = (() => {
  const packs = {
    rogue: { name: 'Rogue Adventure', file: 'RA_Item_Icons01_2.png',
      source: 'extra_assets/16x16/Rogue Adventure World/Rogue Adventure World [Sprites]/Tilesets/RA_Item_Icons01_2.png' },
    dreamland: { name: 'Fantasy Dreamland', file: 'Fantasy_Dreamland_Icons03.png',
      source: 'extra_assets/16x16/Fantasy Dreamland World/Fantasy Dreamland/Item Icons/Fantasy_Dreamland_Icons03.png' },
  };
  const rows = {};
  const add = (id, pack, col, row, note) => {
    (rows[id] ||= {})[pack] = { col, row, note };
  };
  const food = 'Readable food silhouette and warm colour. Compare its coarser 16px clusters with current art.';
  for (const [id,col,row] of [
    ['apple',22,26],['cherry',23,26],['banana',26,26],['orange',22,27],
    ['mushroom',17,26],['onion',25,27],
    ['egg',16,27],['meat',17,28],['grilled_meat',17,29],
    ['minnow',16,25],['bass',17,25],['salmon',18,25],['goldenfish',19,25],
  ]) add(id,'rogue',col,row,food);
  for (const [id,col,row] of [
    ['sapphire',18,18],['ruby',22,18],['emerald',30,18],['diamond',30,17],
    ['quartz',28,15],['topaz',26,18],['amethyst',19,19],
  ]) add(id,'rogue',col,row,'Distinct gem colour and facet silhouette. Cut-gem treatment differs from rough mineral art.');
  for (const [id,col,row] of [
    ['sugar_potion',26,12],['taming_potion',22,13],['healing_potion',18,12],
    ['poison_flask',18,13],['antidote',19,13],['elixir',30,12],
  ]) add(id,'rogue',col,row,'Clear bottle and liquid colour; check potion colour meanings before adoption.');
  for (const [id,col,row,note] of [
    ['book',16,23,'Closed book with warm cover; clear inventory silhouette.'],
    ['tome_healing',25,23,'Cross-marked cover suggests healing; retains a distinct spell emblem.'],
    ['tome_shielding',16,24,'Shield-marked cover offers a direct protection cue.'],
    ['lucky_key',17,14,'Warm gold key with a clear bow and teeth.'],
    ['wood_shield',16,0,'Wood-grain round shield reads as low-tier protection.'],
    ['metal_shield',19,0,'Broad silver face reads well at inventory scale.'],
    ['gold_shield',19,2,'Warm metal distinguishes the gold shield.'],
    ['old_boot',24,4,'Single brown boot; would need wear or damage for the discarded-item story.'],
    ['crow_feather',29,28,'Clear feather shape; needs a dark recolour to read as crow.'],
    ['renovation_permit',23,28,'Document silhouette; needs a distinct permit seal.'],
  ]) add(id,'rogue',col,row,note);
  // One representative tier per equipment family. These are silhouette studies,
  // not an assertion that source colours encode the game's seven materials.
  for (const [id,col,row] of [
    ['relic:sword:1',1,0],['relic:dagger:1',1,4],['relic:axe:1',0,12],
    ['relic:pickaxe:1',3,12],['relic:bow:1',0,16],['relic:staff:1',0,8],
    ['relic:lance:1',0,20],['relic:amulet:1',18,8],
    ['armor:helmet:1',1,24],['armor:chestplate:1',0,28],['armor:boots:1',25,4],
  ]) add(id,'rogue',col,row,'Equipment silhouette study at T1. Material colour and all seven tier variants still need review.');
  const glyph = 'Cyan outline glyph: strong silhouette, but needs a material palette to match the game. Style study only.';
  for (const [id,col,row] of [
    ['relic:sword:1',1,0],['relic:dagger:1',1,2],['relic:axe:1',0,5],
    ['relic:pickaxe:1',3,5],['relic:bow:1',0,6],['relic:staff:1',0,4],
    ['relic:lance:1',0,7],['relic:amulet:1',2,17],
    ['armor:helmet:1',1,9],['armor:chestplate:1',0,11],['armor:boots:1',1,15],
    ['book',8,15],['tome_healing',13,15],['tome_shielding',10,15],
    ['wood_shield',1,8],['metal_shield',12,8],['gold_shield',13,8],
    ['lucky_key',9,13],['old_boot',0,15],['mushroom',9,10],['banana',13,10],
    ['sugar_potion',14,9],['taming_potion',15,9],['healing_potion',11,9],
    ['poison_flask',10,9],['antidote',13,9],['elixir',9,9],
    ['renovation_permit',14,15],
  ]) add(id,'dreamland',col,row,glyph);
  return { packs, rows };
})();
