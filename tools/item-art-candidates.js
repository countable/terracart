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
  Object.assign(packs, {
    dungeon: { name: 'Dungeon Gathering', file: 'dungeon-gathering-items.png', cell: 32, inset: 8, group: 'smaller',
      source: 'extra_assets/Dungeon Gathering Full Ver. 1.1/16x16 Items v2.png' },
    plains: { name: 'Pixel Plains', file: 'pixel-plains-items.png', cell: 32, inset: 8, group: 'smaller',
      source: 'extra_assets/Pixel Plains Premium Pack/Items/16x16 All Items v1.png' },
    farm: { name: '16x16 Farm Game', file: 'farm-game-items.png', group: 'smaller',
      source: 'extra_assets/16x16/Farm Game - Complete Item Icons/FG_Item_Icons.png' },
  });
  const rows = {};
  const add = (id, pack, col, row, note) => {
    ((rows[id] ||= {})[pack] ||= []).push({ col, row, note });
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
  // Dungeon Gathering and Pixel Plains share many silhouettes. Their 16px
  // artwork occupies padded 32px source cells; preserve that source geometry.
  for (const [id,col,row] of [
    ['relic:sword:1',0,0],['relic:axe:1',0,1],['relic:bow:1',0,2],
    ['relic:dagger:1',0,3],['relic:lance:1',0,4],['relic:staff:1',0,6],
    ['wood_shield',0,5],['metal_shield',2,5],['gold_shield',3,5],
    ['book',0,7],['tome_healing',4,7],['armor:boots:1',0,12],
    ['sapphire',4,11],['quartz',5,11],['emerald',6,11],['topaz',3,11],
  ]) {
    if (['relic:dagger:1','sapphire','quartz','emerald','topaz'].includes(id)) add(id, 'dungeon', col, row + 1, 'Compact 16px silhouette with a bright edge. Shares shapes with Pixel Plains; compare palette and outline. Equipment is a T1 shape study, not a material match.');
    add(id, 'plains', col, row, 'Softer outline and muted shading on a silhouette also used by Dungeon Gathering. Equipment needs the game’s tier palette.');
  }
  for (const [id,col,row] of [
    ['apple',18,2],['banana',28,2],['cherry',27,2],['orange',21,2],
    ['mushroom',18,3],['onion',25,3],['meat',20,1],['grilled_meat',19,1],
    ['minnow',16,4],['bass',17,4],['salmon',18,4],['goldenfish',19,4],
    ['healing_potion',17,5],['antidote',29,5],['elixir',25,6],['sugar_potion',21,6],
  ]) add(id,'farm',col,row,'Full-colour inventory icon with stronger shading. Check its apparent pixel size and saturation beside current art.');
  for (const [id,col,row] of [
    ['relic:sword:1',1,0],['relic:axe:1',0,12],['relic:bow:1',0,16],
  ]) add(id,'farm',col,row,'Full-colour tool silhouette; T1 comparison only. Material colours and all tiers still need review.');
  // Dedicated Dreamland Item Icons are cyan glyphs, but its world tilesets
  // also contain coloured objects that can be assessed as inventory crops.
  for (const [id,col,row,note] of [
    ['mushroom',15,4,'Coloured world-prop crop: red mushroom cap. Small source silhouette; assess at inventory scale.'],
    ['flowers',14,1,'Coloured world-prop crop: white flowering plant. A plant silhouette rather than a picked bouquet.'],
    ['rubble',9,7,'Coloured world-prop crop: blue-grey loose rock, compatible with the top-down world camera.'],
  ]) {
    add(id,'dreamland',col,row,note);
    Object.assign(rows[id].dreamland.at(-1), { file: 'dreamland-grasslands.png', status: 'Coloured world prop',
      source: 'extra_assets/16x16/Fantasy Dreamland World/Fantasy Dreamland/Tilesets/FD_Grasslands.png' });
  }
  // Sheet-first second pass: selected against the full catalogue. Do not
  // substitute generic seeds, animals or tools for missing object identities.
  for (const [id,col,row] of [
    ['explosive_flask',19,5],['hardworking_potion',18,6],['grip_potion',22,6],
    ['stoneskin_potion',30,6],['poison_flask',30,5],['reach_potion',22,5],
    ['speed_potion',20,5],['shielding_potion',23,5],['protection_potion',31,6],
    ['time_potion',26,5],['immortal_potion',27,6],['flight_potion',24,6],
    ['shrinking_potion',24,5],['giant_potion',27,5],['fire_resistance_potion',20,6],
    ['blight_potion',28,5],['revival_potion',17,6],['resurrection_potion',19,6],
    ['taming_potion',31,5],
  ]) add(id,'farm',col,row,'Bottle shape and liquid-colour option. Its effect is not encoded by the source art; retain a distinct colour/emblem language for this potion.');
  for (const [id,col,row,note] of [
    ['sleep_powder',17,18,'Tied powder pouch; needs a sleep emblem.'],
    ['psychosis_powder',18,18,'Leaning powder pouch; needs an effect emblem.'],
    ['dragon_powder',20,18,'Broad powder pouch; needs a dragon emblem.'],
    ['growth_powder',19,18,'Tied powder pouch; needs a plant emblem.'],
    ['frost_powder',23,18,'White powder pouch; needs an ice emblem.'],
    ['shadow_powder',29,18,'Dark powder pouch supports the shadow theme.'],
    ['copper_bar',22,12,'Copper ingot with a clear top face.'],
    ['iron_bar',22,13,'Cool grey ingot; preserve iron/platinum distinction.'],
    ['platinum_bar',22,14,'Bright grey ingot; preserve iron/platinum distinction.'],
    ['gold_bar',22,15,'Yellow ingot with a clear top face.'],
    ['frost_bar',22,16,'Blue ingot supports frost material colouring.'],
    ['sapphire',21,7,'Blue faceted gemstone; round-cut option.'],
    ['ruby',29,8,'Red faceted gemstone; round-cut option.'],
    ['emerald',21,8,'Green faceted gemstone; round-cut option.'],
    ['diamond',29,9,'White faceted gemstone; round-cut option.'],
    ['quartz',29,7,'Pink faceted gemstone; round-cut option.'],
    ['topaz',21,10,'Yellow faceted gemstone; round-cut option.'],
    ['amethyst',31,10,'Purple round gemstone; a different cut from the current crystal.'],
    ['old_boot',8,35,'Dark boot silhouette; needs visible wear to read as discarded.'],
    ['lucky_key',27,15,'Gold key with clearly separated teeth.'],
    ['depth_key',31,16,'Blue key with a more elaborate bow; needs its progression emblem.'],
    ['book',16,19,'Simple brown closed book.'],
    ['tome_healing',24,19,'Cross-marked brown cover for healing.'],
    ['tome_shielding',16,20,'Shield-crested cover for protection.'],
    ['pet_collar',1,36,'Brown collar with a light buckle.'],
    ['pet_guard_collar',4,37,'Blue collar with a small front pendant.'],
    ['pet_fang_charm',3,43,'Small pointed pendant; needs a fang-shaped centre.'],
    ['pet_rest_charm',2,40,'Warm pendant with pale centre; needs a rest emblem.'],
    ['stealth_ring',8,43,'Dark plain band supports stealth.'],
    ['perception_ring',11,41,'Silver ring with a light central gem.'],
    ['coin_ring',8,40,'Plain gold ring supports a wealth theme.'],
    ['invisibility_ring',14,41,'Bright plain band; needs an invisibility emblem.'],
    ['ember_ring',10,43,'Dark band with red-orange gem.'],
    ['vampire_ring',9,43,'Dark band with a small red gem.'],
    ['xray_ring',13,42,'Blue band with pale gem; needs a sight emblem.'],
    ['regeneration_amulet',4,40,'Gold pendant with a light jewel; needs a healing emblem.'],
    ['vigor_amulet',5,40,'Gold pointed pendant; needs a distinct vigour emblem.'],
  ]) add(id,'farm',col,row,note);
  // Distinct silhouettes within a pack remain separate review options.
  add('ruby','rogue',30,16,'Angular red gem; alternative to the round cut.');
  add('sapphire','rogue',21,15,'Angular blue gem; alternative to the round cut.');
  add('mushroom','farm',19,3,'Green-cap mushroom variant; recolour if green implies poison in the game.');
  return { packs, rows };
})();
