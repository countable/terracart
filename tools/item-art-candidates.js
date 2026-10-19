// Reviewed 16px source cells, zero-based columns/rows. Review only: never loaded by the game.
// Rogue 01_2 is the transparent colour sheet; 02/03 variants add backgrounds.
// Dreamland candidates use coloured world props only; monochrome UI glyphs are excluded.
const ItemArtCandidates = (() => {
  const packs = {
    rogue: { name: 'Rogue Adventure', file: 'RA_Item_Icons01_2.png',
      source: 'extra_assets/16x16/Rogue Adventure World/Rogue Adventure World [Sprites]/Tilesets/RA_Item_Icons01_2.png' },
    dreamland: { name: 'Fantasy Dreamland', file: 'dreamland-grasslands.png',
      source: 'extra_assets/16x16/Fantasy Dreamland World/Fantasy Dreamland/Tilesets/FD_Grasslands.png' },
  };
  Object.assign(packs, {
    dungeon: { name: 'Dungeon Gathering', file: 'dungeon-gathering-items.png', cell: 32, inset: 8, group: 'smaller',
      source: 'extra_assets/Dungeon Gathering Full Ver. 1.1/16x16 Items v2.png' },
    plains: { name: 'Pixel Plains', file: 'pixel-plains-items.png', cell: 32, inset: 8, group: 'smaller',
      source: 'extra_assets/Pixel Plains/Items/16x16 All Items v1.png' },
    rpg: { name: '16×16 RPG Pack v3', file: 'rpg-pack-v3-items.png', group: 'smaller',
      source: 'extra_assets/16x16_RPG_Pack_v3.0_packed_no_background.png' },
  });
  packs.sunnyside = { name: 'Sunnyside World', file: 'sunnyside-native16.png', group: 'smaller',
    source: 'extra_assets/Sunnyside_World_Assets/Tileset/spr_tileset_sunnysideworld_16px.png' };
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
  // Distinct silhouettes within a pack remain separate review options.
  add('ruby','rogue',30,16,'Angular red gem; alternative to the round cut.');
  add('sapphire','rogue',21,15,'Angular blue gem; alternative to the round cut.');
  // Reviewed the complete native16 RPG sheet once against all catalogue names.
  // Its seven material-like palette rows allow actual tier comparisons, unlike
  // the T1-only silhouette samples above. Source colours are proposals, not runtime mappings.
  for (const [tier,offset,row] of [[1,0,10],[2,9,10],[3,9,11],[4,9,13],[5,9,12],[6,9,14],[7,0,14]]) {
    for (const [slot,col] of [['axe',0],['pickaxe',1],['sword',3],['dagger',4],['bow',6]]) {
      add(`relic:${slot}:${tier}`,'rpg',offset+col,row,'Compact material-coloured tool silhouette. Review wood/copper/iron/gold/platinum/crimson/frost palette separation at game scale.');
    }
    add(`armor:chestplate:${tier}`,'rpg',offset+8,row,'Compact chest armour in a material-like palette; compare its strong shoulder silhouette with current armour.');
  }
  for (const [id,col,row,note] of [
    ['relic:bag:1',23,20,'Brown drawstring supply bag; clear opening and tied neck.'],
    ['relic:lance:1',0,21,'Long brown spear silhouette; light diagonal shaft at native16.'],
    ['relic:staff:1',35,17,'Simple brown crooked staff.'],
    ['relic:staff:2',36,17,'Warm copper-coloured crooked staff.'],
    ['relic:staff:3',37,17,'Muted metal crooked staff.'],
    ['relic:staff:4',38,18,'Gold crooked staff with bright end.'],
    ['relic:staff:5',38,17,'Pale crooked staff with a white highlight.'],
    ['relic:staff:6',38,19,'Red crooked staff.'],
    ['relic:staff:7',35,19,'Blue crooked staff.'],
    ['wood_shield',26,17,'Round wooden shield with central spine.'],
    ['metal_shield',27,18,'Round metal-faced shield with wooden rim.'],
    ['gold_shield',29,18,'Bright gold-faced round shield.'],
    ['mushroom',5,8,'Red-cap mushroom with a clear pale stem.'],
    ['mushroom',6,8,'Blue-cap mushroom variant; colour meaning needs review.'],
    ['apple',6,6,'Red fruit with leafy stem.'],
    ['orange',7,6,'Yellow-orange fruit with leafy stem.'],
    ['berry',6,0,'Red berry bunch with green leaves.'],
    ['poisonberry',7,0,'Purple berry bunch; darker palette for the poison crop.'],
    ['goldenberry',8,0,'Yellow berry bunch with muted leaves.'],
    ['nut',4,2,'Small brown nut with a shaded outer shell.'],
    ['acorn',2,6,'Capped acorn with a small green sprout.'],
    ['potato',10,23,'Pale tuber silhouette; compare its read against nut crops.'],
    ['rubble',20,0,'A few small loose grey stones.'],
    ['rubble',12,0,'Chunky loose brown rock cluster.'],
    ['flint_shard',13,0,'Dark angular stone shards with lighter edges.'],
    ['sapphire',31,2,'Blue crystal cluster; rough-gem alternative.'],
    ['ruby',31,0,'Red crystal cluster; rough-gem alternative.'],
    ['emerald',31,1,'Green crystal cluster; rough-gem alternative.'],
    ['amethyst',31,3,'Purple crystal cluster; rough-gem alternative.'],
    ['diamond',31,4,'Pale crystal cluster with icy highlights.'],
    ['copper_bar',16,0,'Copper-coloured flat ingot with a broad top face.'],
    ['gold_bar',14,0,'Ochre ingot; brighten its gold highlight if needed.'],
    ['platinum_bar',17,0,'Pale ingot with a simple broad top face.'],
    ['book',18,12,'Closed brown book with framed cover.'],
    ['book',18,11,'Open blank book; clear page spread.'],
    ['tome_healing',19,11,'Open book with red page marks; needs a healing emblem.'],
    ['tome_frost_aura',21,11,'Open book with blue page marks.'],
    ['tome_blight',18,13,'Closed green book; needs the blight emblem.'],
    ['tome_fire_wall',19,12,'Closed red-orange book.'],
    ['tome_reach',20,11,'Open purple-marked book; needs a reach emblem.'],
    ['tome_thunder',20,12,'Blue framed book; needs a thunder emblem.'],
    ['tome_speed',19,13,'Rose-coloured book; needs a speed emblem.'],
    ['tome_raven',20,13,'Purple framed book; needs a raven emblem.'],
    ['treasure_map',14,9,'Marked parchment map with irregular edges.'],
    ['treasure_map',21,9,'Rolled marked parchment map.'],
    ['blank_scroll',31,10,'Unrolled parchment with small marks; remove marks for a blank scroll.'],
    ['fireball_scroll',32,16,'Gold-marked scroll; needs a fireball emblem.'],
    ['bones_scroll',31,11,'Parchment with a dark circular mark; needs the bones emblem.'],
    ['fear_scroll',32,14,'Parchment with a dark mask-like mark.'],
    ['wind_scroll',32,13,'Parchment with a sweeping dark mark.'],
    ['wraith_scroll',32,12,'Parchment with a pale spectral mark.'],
    ['raven_scroll',32,11,'Parchment with a dark symbol; needs the raven emblem.'],
    ['thunder_scroll',31,12,'Parchment with sharp dark marks; needs a thunder emblem.'],
    ['moonbeam_scroll',31,14,'Parchment with a dark lunar-like mark.'],
    ['lucky_key',32,8,'Small gold key with clear teeth.'],
    ['depth_key',32,9,'Small silver key; needs its progression emblem.'],
    ['stealth_ring',34,8,'Dark plain ring with subdued purple highlights.'],
    ['coin_ring',36,5,'Plain gold ring.'],
    ['perception_ring',36,4,'Silver ring with a pale gem.'],
    ['invisibility_ring',37,5,'Plain silver ring; needs an invisibility emblem.'],
    ['ember_ring',29,0,'Gold band with a red jewel.'],
    ['vampire_ring',39,0,'Dark copper band with a red jewel.'],
    ['xray_ring',36,2,'Silver ring with blue jewel; needs a sight emblem.'],
    ['regeneration_amulet',42,1,'Small pale pendant with a green jewel.'],
    ['vigor_amulet',41,0,'Small gold pendant with a red jewel.'],
    ['pet_fang_charm',40,5,'Small fang-like pendant with pale tip.'],
    ['pet_rest_charm',42,3,'Small pale pendant with purple jewel.'],
    ['magic_hammer',2,13,'Pale hammer with a broad head; add a magical accent if needed.'],
    ['throwing_spear',1,21,'Slim brown spear with a small tip.'],
    ['javelin',2,21,'Slim metal-tipped javelin silhouette.'],
  ]) add(id,'rpg',col,row,note);
  for (const [id,col,row] of [
    ['healing_potion',23,15],['sugar_potion',25,15],['poison_flask',24,15],
    ['antidote',24,16],['elixir',26,15],['taming_potion',22,15],
    ['speed_potion',21,15],['shielding_potion',21,16],['time_potion',22,16],
    ['revival_potion',23,16],['fire_resistance_potion',25,16],['shrinking_potion',26,16],
    ['healing_potion',11,1],['speed_potion',11,0],
  ]) add(id,'rpg',col,row,'Round potion bottle with coloured liquid. Effect emblems and colour conventions need review before adoption.');
  // Dungeon Gathering's dedicated potion atlas and unoutlined v1 sheet
  // contain complete native16 sprites. Padded/outlined larger variants and
  // the 20px boot pairs were reviewed but excluded, never cropped to fit.
  const dungeonSource = (id, col, row, file, original, note) => {
    add(id, 'dungeon', col, row, note);
    Object.assign(rows[id].dungeon.at(-1), { file, cell: 16, inset: 0,
      source: 'extra_assets/Dungeon Gathering Full Ver. 1.1/' + original });
  };
  for (const [id,col,row] of [
    ['healing_potion',1,0],['healing_potion',1,2],['healing_potion',8,0],
    ['sugar_potion',5,0],['sugar_potion',7,0],
    ['taming_potion',0,0],['taming_potion',9,1],
    ['poison_flask',2,2],['poison_flask',10,0],
    ['antidote',2,0],['antidote',2,1],
    ['elixir',0,2],['elixir',9,0],
    ['explosive_flask',10,1],['explosive_flask',5,1],
    ['hardworking_potion',5,0],['grip_potion',7,0],
    ['stoneskin_potion',4,0],['stoneskin_potion',4,1],
    ['reach_potion',9,0],['speed_potion',6,0],['speed_potion',3,0],
    ['shielding_potion',3,2],['protection_potion',3,1],
    ['time_potion',0,1],['immortal_potion',0,2],
    ['flight_potion',9,0],['shrinking_potion',6,0],
    ['giant_potion',1,2],['fire_resistance_potion',7,1],
    ['blight_potion',10,0],['revival_potion',0,0],['resurrection_potion',9,1],
  ]) dungeonSource(id,col,row,'dungeon-gathering-potions.png','All potions.png',
    'Complete native16 coloured potion. Bottle and liquid are a visual option; review effect colour/emblem conventions before adoption. Some effects intentionally share a source while comparing bottle shapes.');
  for (const [id,col,row,note] of [
    ['relic:sword:1',0,0,'Brown-hilt blade with a clear diagonal silhouette.'],
    ['relic:axe:1',0,1,'Compact brown axe from the native16 unoutlined sheet.'],
    ['relic:bow:1',0,2,'Curved wooden bow with a thin string.'],
    ['relic:dagger:1',0,3,'Small brown dagger without the v2 white outline.'],
    ['relic:lance:1',0,4,'Long spear with a short brown shaft.'],
    ['relic:staff:1',0,6,'Brown staff with a rounded head.'],
    ['armor:boots:1',0,12,'Single leather boot; the separate pair sheet exceeds16px and is excluded.'],
    ['old_boot',1,12,'Dark single boot; needs wear detail to read as discarded.'],
    ['wood_shield',0,5,'Wood-toned shield with a simple broad face.'],
    ['metal_shield',2,5,'Cool metal shield with a central crest.'],
    ['gold_shield',3,5,'Bright gold shield with a strong crest.'],
    ['book',0,7,'Brown closed book with a framed cover.'],
    ['tome_healing',4,7,'Cyan-green book with a heart-like centre; coloured object, not a monochrome glyph.'],
    ['tome_blight',6,7,'Green cover with an angular symbol; needs the blight emblem.'],
    ['tome_fire_wall',7,7,'Orange cover with a flame-like symbol.'],
    ['tome_frost_aura',2,7,'Cool blue cover with a central emblem.'],
    ['tome_raven',5,7,'Purple cover with a central emblem; needs the raven mark.'],
    ['tome_thunder',3,7,'Gold-orange book; needs a thunder emblem.'],
    ['tome_shielding',1,7,'Dark book with a pale protective-looking centre.'],
    ['sapphire',4,11,'Blue cut gemstone without the v2 white edge.'],
    ['quartz',5,11,'Pink cut gemstone without the v2 white edge.'],
    ['emerald',6,11,'Rectangular green cut gemstone without the v2 white edge.'],
    ['topaz',3,11,'Amber cut gemstone without the v2 white edge.'],
    ['flint_shard',1,11,'Dark rough mineral piece with a broad upper face.'],
    ['iron_bar',2,11,'Blue-grey rectangular ingot; compare against cut gemstones at inventory size.'],
    ['gold_bar',3,11,'Amber rectangular ingot option; same source also reads as cut topaz, so material read needs review.'],
    ['fireball_scroll',7,14,'Small orange framed parchment with a fire-like emblem.'],
    ['bones_scroll',1,14,'Dark parchment with a small central sign; needs a bones emblem.'],
    ['moonbeam_scroll',2,14,'Pale-blue parchment with a central mark.'],
  ]) dungeonSource(id,col,row,'dungeon-gathering-native-items.png','New Items [Update]/16x16 Items Pack v1.png',note);
  for (const row of [2,3,4,5]) dungeonSource('orb',0,row,'dungeon-gathering-orbs.png',
    'New Items [Update]/All Orbs anim 16x16.png',
    'First animation frame of a complete16px coloured orb. Blue-grey, gold, cyan and purple are palette alternatives; animation timing is not adopted.');
  // Sheet-first Sunnyside review: the readable native16 master contains the
  // crops/resources also distributed as currently unreadable standalone files.
  // 32px livestock and wide ordinary furniture are excluded, not downscaled.
  for (const [id,col,row,note] of [
    ['potato',57,10,'Harvested brown potato with a compact shaded silhouette.'],
    ['potato_seed',57,11,'Small potato seed sprite from the matching crop column; compare readability at inventory scale.'],
    ['sunflower',54,10,'Harvested sunflower head with bright yellow petals.'],
    ['sunflower_seed',54,11,'Sunflower seed from the matching crop column.'],
    ['egg',50,11,'Warm cream egg with a broad highlight.'],
    ['milk',50,10,'Opaque white milk bottle with a pale blue rim.'],
    ['minnow',49,12,'Small blue fish with a clear eye and tail; generic fish rather than species-specific markings.'],
    ['wood',49,11,'Single cut log; compact inventory silhouette.'],
    ['wood',49,13,'Small cluster of chopped wood; an alternative quantity silhouette.'],
    ['rubble',49,10,'Compact grey rock with a bright top plane.'],
    ['flowers',54,32,'Small white flowering plant with green leaves; a plant rather than a picked bouquet.'],
  ]) add(id,'sunnyside',col,row,note);
  for (const stem of ['red_01','blue_01','blue_02','blue_03']) {
    add('mushroom','sunnyside',0,0,'First native16 animation frame. '+(stem.startsWith('red') ? 'Red-cap mushroom with a pale stem.' : 'Blue-cap mushroom style option; review whether blue implies a different species.'));
    Object.assign(rows.mushroom.sunnyside.at(-1), {
      file: 'sunnyside-mushroom-'+stem+'.png',
      source: 'extra_assets/Sunnyside_World_Assets/Elements/Plants/spr_deco_mushroom_'+stem+'_strip4.png',
    });
  }
  for (const [id,name,crop,note] of [
    ['bookshelf_frontier','bookshelf',[672,528,16,32],'Complete tall wooden bookcase with coloured books; native16-wide footprint.'],
    ['dresser_oak','dresser',[704,528,16,32],'Complete tall drawer cabinet; compare its simpler trim with current furniture.'],
    ['table_oak','table',[784,536,16,16],'Complete compact wooden side table.'],
    ['rug_burgundy','rug',[752,576,16,16],'Complete small red patterned rug; clear diamond motif at native16.'],
  ]) {
    add(id,'sunnyside',0,0,note);
    Object.assign(rows[id].sunnyside.at(-1), { image:'art-candidates/items/sunnyside-'+name+'.png', crop,
      source:packs.sunnyside.source, status:crop[3]>16 ? 'Tall furniture · 16×32 source' : 'Coloured world prop' });
  }
  return { packs, rows };
})();
