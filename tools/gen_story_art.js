#!/usr/bin/env node
// Generate the story-splash banners (assets/art/*.webp) with gpt-image-1.5.
// Paintings ship as lossy WebP at ART_WEBP_QUALITY (about half the bytes of the
// 128-colour PNG they used to be, and indistinguishable at dialog size —
// lossless WebP saves nothing, the dithering reads as noise to it). Trimmed
// ICON pieces (the coin) stay PNG in assets/Icons/. Full-resolution masters
// live in art-source/paintings/raw/.
//
// Reads OPENAI_API_KEY from ~/.env (or the environment), renders each piece at
// 1536x1024, then downscales to 512px wide (the size the dialogs lazy-load)
// with PIL. Usage:
//
//   node tools/gen_story_art.js              # all pieces missing from assets/art/
//   node tools/gen_story_art.js --force      # regenerate everything
//   node tools/gen_story_art.js story_wake   # one piece
//
// The shared STYLE string is what keeps the set palette-matched to the four
// original banners (trail_intro etc.) — warm golden-hour, dithered 16-bit.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ART_WEBP_QUALITY = 85;
const OUT_DIR = path.join(__dirname, '..', 'assets', 'art');
const SOURCE_DIR = path.join(__dirname, '..', 'art-source', 'paintings');
const RAW_DIR = path.join(SOURCE_DIR, 'raw');
function outputPath(name, trim) {
  if (name === 'coin_icon') return path.join(__dirname, '..', 'assets', 'Icons', 'coin.png');
  return path.join(OUT_DIR, `${name}.${trim ? 'png' : 'webp'}`);
}

const STYLE =
  'Detailed 16-bit pixel art storybook illustration for a cozy village-rebuilding RPG. ' +
  'Warm golden-hour palette: amber and dusty-orange sky with visible dithering, olive-green ' +
  'foliage, brown earth, cream highlights. Retro SNES-era pixel clusters, crisp clusters, no ' +
  'anti-aliased smooth gradients. Wide landscape composition, gentle melancholy turning to hope. ' +
  'The player survivor always wears a raised brown hood concealing hair and face; NPCs keep their own clothing. ' +
  'All currency coins are jade green with a star mark, never yellow gold. ' +
  'No text, no letters, no UI, no watermark.';

// SCENE ART — the standard every dialog painting is made to (modal_shell.js
// makeModalShell `art`, ART_FRAME_ASPECT / ART_DETAIL_FRAC / SCENE_ART). The
// piece IS the dialog box: generated portrait, cut top-anchored to the box's
// 11:14 shape, and the copy sits over its lower part. So the composition is a
// rule, not a taste: subject and detail in the top ~40%, and a QUIET ZONE
// below it - broad, dark, low-detail ground with nothing in it - that a scrim
// darkens and the text sits on. scene('subject') builds such a piece.
const SCENE_ASPECT = 352 / 448;
const SCENE_RULE =
  'COMPOSITION (strict): tall portrait frame. Put the subject and ALL detail, figures and ' +
  'bright light in the TOP 40% of the frame, drawn LARGE and close so it fills the full width ' +
  'of that top band. The BOTTOM 60% is a ' +
  'calm, empty QUIET ZONE: broad dark foreground ground (soil, grass or shadow) in large ' +
  'simple dithered areas, darkening toward the bottom edge, with no objects, no figures, no ' +
  'bright spots and no fine detail - text will be printed over it.';
// THE LORE, as the paintings tell it: the world was not simply abandoned — a
// Warmonger burned it: a dragon controlled by the wizard, now the survivor,
// unremembering. MemoryStory reveals this only on the memory-30 wizard return.
// Earlier paintings never show it outright. A piece may carry ONE small hint, in
// its detail zone and only where it fits the scene; most carry none, so the
// ones that do are noticed on a second look rather than announced. Two kinds:
//   the FALL   — what the Warmonger did (claw scorches, a horned mural, a sigil)
//   the SECRET — that it is the survivor (horned shadow, leaning sparks, an
//                ember glint, a wary glance) — the subtlest, and rarest. Keep
// SECRET hints fewer than every FALL kind so they remain a rare second look.
const LORE = {
  claws:   'Subtle background detail: a ruined wall carries three huge blackened claw-rake scorch marks, old and weathered.',
  // The mural is the easiest hint to over-draw: asked for 'a vast horned
  // shadow' the model painted a demon across half the sky. Keep it a FRAGMENT.
  mural:   'Very subtle background detail: a small, cracked fragment of an old fresco on a far wall shows a tiny horned figure above burning roofs, mostly lost to moss and shadow - easy to miss.',
  sigil:   'Subtle background detail: a small scorched horned sigil is burnt into a stone, half covered by grass.',
  shadow:  'Very subtle detail: the survivor\'s long shadow on the ground shows two faint small horn shapes that the survivor does not have - easy to miss.',
  embers:  'Very subtle detail: nearby sparks and embers drift toward the survivor, as if drawn to them.',
  glint:   'Very subtle detail: a faint red ember glint in the survivor\'s eyes, barely visible.',
  wary:    'Very subtle detail: one onlooker glances at the survivor with quiet unease.',
};
// NO LORE ON HOLY OR GRAVE GROUND (Sep 2026). A demon hint on a church, a
// chapel, a shrine, a churchyard or a grave reads as the game calling the
// place demonic — the one reading the paintings must never invite. So a piece
// whose SUBJECT is sacred or funereal carries no hint at all: scene() refuses
// one (the generator throws before a single image is paid for), and
// scene_art.test.js pins the rule. The churchyard painting (zone_stones) is
// the chapel stall's painting too (macros.js KIND_DIALOG.chapel).
const LORE_FREE_SUBJECT = /\b(chapel|church|churchyard|shrine|temple|mosque|synagogue|headstones?|graves?|gravestones?|cemetery|tomb|memorial|worship|altar|cherub)\b/i;
const scene = (subject, lore) => {
  if (lore && LORE_FREE_SUBJECT.test(subject)) {
    throw new Error(`no LORE hint ('${lore}') on a sacred / grave subject: ${subject.slice(0, 60)}…`);
  }
  return {
    size: '1024x1536', width: 512, aspect: SCENE_ASPECT, colors: 128,
    subject: `${subject}${lore ? ' ' + LORE[lore] : ''}\n\n${SCENE_RULE}`,
  };
};

// A piece is either a subject string (landscape 1536x1024 -> 512px banner)
// or { subject, size, width } for a different frame - the safety screen's
// fullscreen mobile backdrop is portrait.
const PIECES = {
  trap_jaw:
    scene(
    'A rusty steel bear trap bursting out of cracked earth, its metal jaws clamped shut ' +
    'around a farmer\'s boot, dirt and small stones flying, the farmer stumbling. Shock ' +
    'moment in warm dusk light, close and low to the ground.', 'sigil'),
  trap_free:
    scene(
    'A farmer kneels on cracked dry earth prying open a rusty steel bear trap\'s jaws with ' +
    'both hands, boot just pulled free, effort turning to relief, warm dusk light, close ' +
    'and low to the ground.'),
  tool_till:
    scene(
    'A farmer drives a hoe into meadow soil, the first dark furrow turning over in neat ' +
    'squares, dew on the grass, dawn light. A satisfying first strike.', 'shadow'),
  tool_chop:
    scene(
    'A farmer swings an axe into a tree trunk, wood chips flying, a fresh notch in the ' +
    'bark, warm afternoon light.', 'claws'),
  tool_dig:
    scene(
    'A farmer swings a pickaxe into a grey boulder, sparks and stone chips flying, a crack ' +
    'forming in the rock, warm light.', 'sigil'),
  tool_water:
    scene(
    'A farmer tips a watering can over a small green sprout in a tilled bed, silver water ' +
    'arcing down, the soil darkening with damp, morning light.'),
  tool_catch:
    scene(
    'A hooded survivor sweeps a bug net through tall grass. The target is completely hidden ' +
    'outside the frame: no animal or creature is visible. A first attempt, warm light.'),
  tool_sword:
    scene(
    'A hooded survivor swings a simple iron sword toward an unseen opponent outside the frame. ' +
    'No enemy or creature is visible. A determined swing in a meadow, warm light.'),
  tool_shoot:
    scene(
    'A farmer draws a short bow and looses an arrow across a meadow, the string still ' +
    'humming, the arrow in flight, warm light.'),
  tool_staff:
    scene(
    'A young farmer holds a wooden magical staff with both hands, surprised as a small ' +
    'blue-white bolt leaves its tip across a meadow. Gentle wonder, warm sunset light. No bow or arrows.'),
  // The ONE money icon: a single JADE coin on transparency. Not a banner -
  // generated large, trimmed to its opaque bounds, downscaled to a 64px
  // runtime icon (assets/art is for banners; the coin lives under
  // assets/Icons/ - run tools/gen_story_art.js coin_icon). Green on purpose:
  // the ore ladder already owns orange (copper, gold), grey (iron,
  // platinum), red (crimson) and blue (frost), and a gold coin read as a
  // copper one. No ore is green, so the money can't be taken for a metal.
  coin_icon: {
    size: '1024x1024', width: 64, colors: 64, background: 'transparent', trim: true,
    style:
      '16-bit pixel art game icon, crisp chunky pixel clusters, jade green and verdigris ' +
      'palette. Transparent background, no shadow, no text.',
    subject:
      'A single round green jade-bronze metal coin, flat straight-on front view, centred, ' +
      'filling the frame: darker outer rim, a bright pixel highlight at the top-left, an ' +
      'embossed five-pointed star in the centre. Nothing else in frame.',
  },
  safety_welcome: {
    size: '1024x1536', width: 640, colors: 96,
    subject:
      'Tall portrait scene: a young farmer with a hammer and a satchel of seeds rebuilds a ' +
      'ruined suburban home - fresh timber framing going up over scorched brick, one wall ' +
      'already repainted, a sunflower sprouting through rubble. Around them an overgrown ' +
      'post-collapse neighbourhood of caved roofs and boarded windows stretches to a dusky ' +
      'horizon. Hopeful reconstruction amid ruin: warm light on the house being restored, ' +
      'cooler amber gloom over the wrecks.',
  },
  story_wake:
    'Morning inside-and-out of a small weathered camping trailer parked in a misty meadow. ' +
    'A young survivor stretches awake at the trailer door, first amber sunlight over the grass. Quiet, hopeful.',
  story_wrecks:
    'A suburban neighbourhood of collapsed houses: boarded windows, caved roofs, rubble piles, ' +
    'weeds through cracked pavement. The same survivor stands small in the middle of the street ' +
    'taking it in. Golden light, overgrown but not grim.',
  restore_house:
    scene(
    'A cozy restored cottage with fresh timber repairs, warm light in the windows, a small ' +
    'vegetable patch beside it. Two relieved neighbours admire it. Celebration of a home rebuilt.', 'wary'),
  restore_blacksmith:
    scene(
    'A rebuilt stone smithy, forge glowing orange inside, an anvil by the door, horseshoes and ' +
    'tools hung outside. A burly blacksmith raises a hammer in greeting. Sparks in the dusk air.', 'embers'),
  restore_market:
    scene(
    'A cheerful open-air market stand rebuilt: crates of pumpkins, apples and greens, sacks of ' +
    'seeds, a hand-painted awning. A shopkeeper arranges produce while a customer approaches with coins.'),
  restore_trader:
    scene(
    'A rebuilt trading post draped with rugs and hanging lanterns, shelves of jars and bolts of ' +
    'cloth. A travelling merchant with a pack mule barters with a villager, goods changing hands.'),
  restore_wizard:
    scene(
    'A tall crooked wizard tower restored, its crooked roof re-shingled, windows glowing violet, ' +
    'strange plants and brass instruments on the balcony. A reclusive mage in a starry robe peers ' +
    'down from the door at a visitor below.'),
  delivery_first:
    scene(
    'On the doorstep of a cottage at dusk, a farmer hands over a woven basket brimming with ' +
    'vegetables to a delighted elderly neighbour; a few jade-green star coins glint in the exchange. Warm doorway light.', 'wary'),
  shiny_first:
    scene(
    'A young farmer crouches in a meadow at dusk, gazing with wonder at a brilliant four-point ' +
    'golden-white glint between cupped hands. The unknown find is completely hidden by the ' +
    'abstract star-shaped light: no identifiable animal, item, gem, coin, egg or chicken.'),
  fire_first: scene(
    'A young survivor kneels beside a freshly lit campfire ringed with stones at dusk, flames ' +
    'leaping up and throwing a warm ring of light; at the edge of the light a green slime ' +
    'shrinks back into the shadows. A skewer of food rests over the flames. Warmth, safety ' +
    'and curiosity.', 'embers'),
  // Home's Sell page (app.js presentHomeSell) — a private sale off your own
  // doorstep, not a shopkeeper's counter, so it wears its own piece rather
  // than kind_shop.
  // THE REVIVAL STORYBOARD (app.js _reviveStoryboard, the first time Home
  // stands a downed player back up): collapse, found, home. Three panels read in order, so they share a palette and a
  // survivor — the same young survivor in a hooded brown cloak throughout.
  revive_fall: scene(
    // Nothing dropped beside the body: a collapse costs no gear, and the
    // player may own none — the picture must not promise either.
    'A young survivor in a hooded brown cloak has collapsed face-down on a dirt path at dusk, ' +
    'empty-handed, with nothing lying around them, the world around dimming and blurring at the ' +
    'edges as if their eyes are closing.'),
  revive_found: scene(
    'Two villagers - a stout woman holding up a lantern and an older man - kneel beside the ' +
    'collapsed young survivor in a hooded brown cloak on a dirt path at night, lifting them ' +
    'gently by the shoulders. Warm lantern light, concern.', 'wary'),
  revive_wake: scene(
    'The young survivor in a hooded brown cloak sits up weakly on a straw bedroll beside a ' +
    'small camper trailer at dawn, wrapped in a blanket, a small campfire crackling, while a ' +
    'kindly villager hands them a steaming bowl. No bags, packs or tools anywhere near the ' +
    'survivor. Relief, home.'),
  home_sell: scene(
    'A rough wooden crate brimming with fresh produce - potatoes, onions, apples and a few ' +
    'wheat bundles - set out on the grass beside a small camper trailer at golden hour, a little ' +
    'hand-painted wooden sign propped against it showing a jade-green star coin, meaning for sale.'),
  cave_first: scene(
    'A young survivor holding a lantern steps down worn stone stairs into a cave, the cold dark ' +
    'closing in beyond the small circle of lantern light, glints of ore in the rough walls, a ' +
    'pair of eyes shining faintly deeper in. Awe and unease.', 'claws'),
  discovery_badge:
    scene(
    'A glowing golden five-pointed star emblem hovering in the air before a young survivor\'s ' +
    'eyes, radiating soft rays and floating golden glints, the survivor looking up in wonder ' +
    'on a meadow path at dusk. A vision of discovery.'),
  castle_claim:
    scene(
    'A grand stone castle gatehouse, its drawbridge down, a cream pennant banner being raised on ' +
    'a short pole above the gate. A grey-moustached castellan in a tabard bows to a young survivor. ' +
    'Torches lit, the vault door ajar with jade-green star coins beyond.', 'mural'),
  fort_unseal:
    scene(
    'A stout stone frontier fort, its heavy timber gates swinging open for the first time in years, ' +
    'dust falling, a quartermaster in boiled leather stepping out with a relic-laden rack behind him.', 'claws'),
  book_read: scene(
    'A young survivor sits on a fallen log reading a worn leather book by lantern light at dusk, a small stack of books beside them, fireflies drifting. Quiet learning.', 'mural'),
  castle_favour: scene(
    'A grey-moustached castellan in a tabard stands at an open castle gate offering a small purse of coins and a steaming mug to a young survivor. Torches lit, banners stirring. Hospitality.'),
  trail_intro: scene(
    'A band of weary survivors - a farmer, an old man, two children - look along a cracked, overgrown old road winding toward a distant village at dusk, one pointing ahead. The road home.', 'claws'),
  trail_prize: scene(
    'Grateful survivors hand a small cloth bundle of seeds to a young traveller on a freshly restored cobbled road at dusk, a lamp post glowing beside them.'),
  kind_quest: scene(
    'A castle notice board by a stone gate, pinned with three parchment quests and a wax seal, a torch burning beside it at dusk.', 'claws'),
  kind_treasure: scene(
    'An old wooden treasure chest, lid thrown open, a glowing gem and a few jade-green star coins inside, nothing spilled on the ground, dusty light falling on it in a ruined cottage.'),
  kind_supplies: scene(
    'Two sturdy wooden supply crates on the grass beside a small camper trailer, lids pried open to show seed packets, a trowel and a lantern. Morning of a new start.'),
  kind_trail: scene(
    'A restored cobbled road winding through a meadow toward a small village, a gilded street lamp glowing violet beside it at dusk.', 'shadow'),
  kind_shop: scene(
    'A cosy village shop counter under a striped awning, jars, seed packets and produce on the shelves, a shopkeeper leaning on the counter at dusk.'),
  kind_trade: scene(
    'Two travellers shake hands over a wooden cart of goods at a crossroads - sacks of grain on one side, bundles of cloth on the other - lanterns hanging from the cart.'),
  kind_forge: scene(
    'A stone smithy\'s open forge glowing bright orange, a hammer resting on an anvil beside a fresh ingot, sparks drifting in the dark workshop.', 'embers'),
  // The forge ceremony (app.js presentBlacksmithOffer's onAccept): the piece
  // just forged is laid over this as its icon, so the painting shows the
  // forge's triumph and leaves the anvil bare - a painted blade would argue
  // with whatever was actually made. No lore: kind_forge already carries it.
  forge_done: scene(
    'Inside a stone smithy at night, the forge roaring white-hot and bright orange, a burly blacksmith in a leather apron throwing both arms up in triumph beside a bare anvil, a quench barrel billowing steam, a fountain of golden sparks showering up to the rafters. Joyful celebration of the craft.'),
  kind_relics: scene(
    'A small velvet-lined display case on a low wall shelf, seen from across the room, holding a ring, an amulet and a small enchanted pickaxe, each glinting with faint light in a dim hall.', 'sigil'),
  kind_delivery: scene(
    'A woven basket of fresh vegetables tied with twine resting on a cottage doorstep at dusk, the door ajar with warm light spilling out.'),
  kind_build: scene(
    'The timber frame of a cottage being rebuilt, a ladder against it, a hammer and a stack of fresh planks and stones beside it at golden hour.', 'claws'),
  kind_craft: scene(
    'A rough wooden workbench inside a camper-trailer workshop, planks, stones and a saw laid out, a lantern hanging overhead.'),
  kind_wizard: scene(
    'The top of a crooked wizard tower, a mage\'s desk with an open spellbook, a glowing crystal ball and floating golden stars, violet light in the windows.'),
  kind_memory: scene(
    'Golden five-pointed stars drifting upward like fireflies over a quiet dusk meadow, a faint glowing path among the grass.', 'shadow'),
  // ACT II (memory_story.js): the wizard's voice cools, the memories he
  // retold come back true, and the memory-30 return shows his own form. No
  // LORE hint on any of them: the copy carries the act, and the reveal paints
  // HIS dragon only - never the survivor's (CLAUDE.md: art never reveals it).
  wizard_cold: scene(
    'The high room of a wizard tower at dusk: an old mage in a starry robe stands half-turned at a tall window, looking out over distant village rooftops, one hand pushing a wooden chair into place for a guest. Cold violet light, long shadows, a sense of distance.'),
  wizard_map: scene(
    'A candlelit wizard\'s desk seen from above: a large old map of unfamiliar coastlines and islands, tiny town marks inked along the shores, an old mage\'s long finger resting over one small town mark. A brass compass and quills at the map\'s edge.'),
  memory_doorway: scene(
    'A remembered street at night in a burning town: in a cottage doorway a frightened woman shoves the heavy wooden door half shut with her palm pressed flat against it and her arm locked straight, bracing it against whoever is outside, her face turned away in fear, a small child hidden behind her skirts, the roof above sagging with fire and falling embers. She is NOT waving or greeting. Seen from the street, hazy at the edges like a memory.'),
  memory_grip: scene(
    'Close view of two hands beside a smoky battlefield at dusk: an old ring-heavy hand in a starry sleeve grips a younger wrist and turns it, the younger hand following the turn. Tattered banners and distant smoke behind, hazy at the edges like a memory.'),
  wizard_dragon: scene(
    'An old HUMAN wizard in a blue starry robe sits coldly at a desk in his tower, white beard, violet window light and a candle. He speaks an unsettling truth without changing form. No dragon, wings, scales or magical transformation.'),
  kind_slots: scene(
    'A rickety wooden slot machine with three spinning reels showing fruit and a star, set in the courtyard of a stone fort, torches lit, coins on a barrel.'),
  kind_farm: scene(
    'A small farm plot of tilled rows with sprouting crops, a straw scarecrow standing guard, a chicken pecking nearby at dusk.'),
  kind_energy: scene(
    'A young survivor sitting against a tree eating an apple, a small lightning-bolt glint of energy in the air above them, a meadow at golden hour.'),
  kind_rest: scene(
    'An exhausted survivor slumped asleep against a rock in a dark neutral resting place, a guttering torch beside them. No cave opening or location-specific scenery.', 'shadow'),
  kind_use: scene(
    'An open leather satchel on a tree stump, a potion flask, a coil of rope and a small book spilling out, soft light on it.'),
  kind_fire: scene(
    'A campfire ringed with stones burning brightly at night, sparks rising, a log half-consumed in the flames.', 'sigil'),
  kind_note: scene(
    'A folded parchment letter weighted with a stone on a wooden fence post at dusk, a meadow and ruined village beyond.', 'claws'),
  // The ☰ menu. Shipped as a crop of safety_welcome (the survivor rebuilding
  // a ruined home) until this is generated — the script only renders pieces
  // missing from assets/art/, so run it with this name (or --force).
  kind_menu: scene(
    'A small half-rebuilt cottage with bare roof rafters, a lone sunflower by its wall, a survivor with a hammer and a sack of stones looking at it at golden hour.'),

  // Influence zones (scratchpad/design/influence_zones.md §5.5): first-visit
  // story panels for the three zone kinds, keyed zone:grove / zone:tar /
  // zone:stones by _tickZone.
  zone_grove: scene(
    // No sigil (Sep 2026): the shrine itself is the hint, no lore layered
    // beside it — see NO LORE ON HOLY OR GRAVE GROUND above.
    'Moss-hung ancient trees crowding close around a small lichened stone shrine glowing with ' +
    'a faint green light, fireflies drifting in the dusk air, a deep quiet woodland.'),
  zone_tar: scene(
    // A QUIET ABANDONED FORECOURT CORNER, nothing more (Sep 2026): no
    // creature, no fire — the tar yard holds no garrison and no flame.
    'A quiet abandoned oil-stained forecourt corner on cracked industrial ground: black tar ' +
    'puddles pooled in the broken concrete, a single rusted fuel pump leaning at an angle, a ' +
    'scatter of flint shards among the weeds, nobody about, still dusk light.'),
  zone_stones: scene(
    // A CHURCHYARD, nothing more (Sep 2026): no ghosts, no pale figures —
    // and no lore hint on sacred ground (LORE_FREE_SUBJECT / scene() throws).
    'A small stone church and its churchyard: weathered headstones leaning in quiet rows across ' +
    'the grass, one iron lantern lit beside the church door, dusk light.'),

  // Street variants (scratchpad/design/street_variants.md §3): first-visit
  // story panels for each street flavour.
  street_hedgerow: scene(
    // The lane just continues out of frame (Sep 2026): no dead end, no
    // disturbed mound — that hoard moved to the coffee-shop POIs.
    'An empty narrow lane between clipped hedges, the unobstructed lane continuing out of ' +
    'view between the hedge rows, nobody about, dusk light. No archway, gate or structure ' +
    'crossing the lane.'),
  street_lantern: scene(
    'A long cobbled road at dusk lined with old iron lantern posts, some glowing warm amber ' +
    'light, others dark and unlit, stretching toward a village.'),
  street_overgrown: scene(
    'A clear residential lane lined with maple saplings and mature maples, roots confined to verges, ' +
    'red cream-spotted mushrooms with faint blue glow along the verge, dusk light.'),
  street_orchard: scene(
    'A quiet lane running beneath apple trees bearing red apples alternating with mature maples, no fallen fruit ' +
    'on the clear road, warm late-afternoon light.'),
  street_pilgrim: scene(
    'Close and large in frame: a tall mossy stone waystone carved with a faint worn sigil, ' +
    'standing right beside a worn dirt road, a well-trodden footpath curving past it toward a ' +
    'distant church spire, dusk light.'),
  street_burned: scene(
    'A burned-out residential street: black tar puddles pooled in the gutters, a row of ' +
    'sharpened wooden stakes and charred fence posts along the verge, ash drifting in the dusk ' +
    'air, no buildings alight.'),
  street_bandit: scene(
    // No goblin, no watcher (Sep 2026): the road's theme is now the "Old
    // trade road" itself, not an ambush — see street_variants.js's title.
    'An old trade road, deep wheel ruts worn into it, a broken wagon long abandoned at the ' +
    'verge, canvas torn and a wheel splintered, nobody about, dusk light.'),
  street_barricade: scene(
    'Stake-and-log defences standing entirely on the verges of a clear wide road, crates and barrels behind ' +
    'it, an abandoned watch post, dusk light.'),
  street_toadstool: scene(
    'A quiet residential lane at dusk, its verges crowded with clusters of red cream-spotted ' +
    'mushrooms and toadstools casting a soft blue-green glow beneath orange lamps, the lane clear and leading away into the dark.'),

  // Scenic places (src/scenic.js): the viewpoint's story panel and the first
  // scenic-path walk.
  zone_viewpoint: scene(
    'Close and large in frame: an old brass spyglass on a weathered wooden post beside a ' +
    'low stone rail at a high lookout, a wide view of a sunlit bay and distant rooftops ' +
    'beyond it, golden-hour light.'),
  street_scenic: scene(
    'A winding gravel footpath along a calm shoreline promenade, old lamp posts glowing ' +
    'soft sea-green, reeds and a low sea wall beside it, gulls far off over the water, dusk light.'),
  barehand_tree: scene("Hooded survivor fells a tree with bare hands; two survivors watch in awe; no tool, no revealed dragon traits."),
  barehand_work: scene("Hooded survivor works barehanded in grass and soil; two villagers watch in awe; hands partly concealed; no tool or specific harvest."),
  street_golden: scene("A clear village road with many jade-green star coins scattered on BOTH verges, orange street lamps, warm dusk."),
  street_snare: scene("A single closed chest surrounded by a ring of iron jaw traps on the verge beside a clear road, warm orange lamps. Nothing blocks the road."),
  zone_shore: scene("An old shrine on a grassy rise overlooking a sandy beach and open sea, reeds, no enclosing forest. Peaceful sacred ground."),
  street_greenway: scene("An inland walking path bordered by meadow and trees, green-glowing street lamps. No coast or sea wall."),
  street_parkpath: scene("A quiet inland park path through mature trees and grass, green-glowing lamps. No coast or sea wall."),
  kind_inn: scene("An ordinary innkeeper offers a mug from a modest inn doorway to a survivor whose raised brown hood hides all hair and face. No castle or steward."),
};

function loadKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envFile = path.join(process.env.HOME, '.env');
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  throw new Error('OPENAI_API_KEY not found in env or ~/.env');
}

async function generate(key, name, piece) {
  // The images endpoint 500s transiently under load - retry twice with a
  // short backoff before giving up the whole run over one hiccup.
  let res = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-image-1.5',
        prompt: `${piece.style || STYLE}\n\nScene: ${piece.subject}`,
        size: piece.size,
        ...(piece.background ? { background: piece.background } : {}),
        quality: 'high',
        n: 1,
      }),
    });
    if (res.ok || res.status < 500) break;
    if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 8000));
  }
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${name}: no b64_json in response`);
  const rawPath = path.join(RAW_DIR, `${name}.png`);
  fs.writeFileSync(rawPath, Buffer.from(b64, 'base64'));
  return rawPath;
}

function downscale(rawPath, name, width, colors, trim, aspect) {
  const outPath = outputPath(name, trim);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // The piece's own width (512 for banners, 640 for the fullscreen backdrop),
  // then quantize: pixel art survives palette reduction intact (the clusters
  // ARE the palette), and it lands a banner near the ~60-80KB of the original
  // four instead of ~370KB.
  const py = `
from PIL import Image
im = Image.open(${JSON.stringify(rawPath)})
trim = ${trim ? 'True' : 'False'}
if trim:
    im = im.convert('RGBA')
    bbox = im.getchannel('A').getbbox()
    if bbox: im = im.crop(bbox)
    # Square the canvas: a trimmed coin is round, but an icon slot is square -
    # pad the shorter side with transparency so resize never squashes it.
    w0, h0 = im.size
    if w0 != h0:
        side = max(w0, h0)
        canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        canvas.paste(im, ((side - w0) // 2, (side - h0) // 2))
        im = canvas
else:
    im = im.convert('RGB')
w, h = im.size
aspect = ${aspect || 0}
if aspect:
    # A SCENE piece: cut to the dialog box's shape, keeping the TOP (the
    # subject lives there; the quiet zone is what gives).
    ch = min(h, round(w / aspect))
    im = im.crop((0, 0, w, ch))
    w, h = im.size
tw = ${width}
im = im.resize((tw, round(h * tw / w)), Image.LANCZOS)
if im.mode == 'RGBA':
    im = im.quantize(colors=${colors || 128}, method=Image.FASTOCTREE, dither=Image.FLOYDSTEINBERG)
else:
    im = im.quantize(colors=${colors || 128}, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG)
if trim:
    im.save(${JSON.stringify(outPath)}, optimize=True)
else:
    im.convert('RGB').save(${JSON.stringify(outPath)}, 'WEBP', quality=${ART_WEBP_QUALITY}, method=6)
`;
  execFileSync('python3', ['-c', py]);
  return outPath;
}

(async () => {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  // --reprocess: skip the API, re-downscale from art-source/paintings/raw/.
  const reprocess = args.includes('--reprocess');
  const only = args.filter(a => !a.startsWith('--'));
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const key = reprocess ? null : loadKey();
  const names = only.length ? only : Object.keys(PIECES);
  for (const name of names) {
    if (!PIECES[name]) { console.error(`unknown piece: ${name}`); process.exitCode = 1; continue; }
    const piece = typeof PIECES[name] === 'string'
      ? { subject: PIECES[name], size: '1536x1024', width: 512 }
      : PIECES[name];
    const outPath = outputPath(name, piece.trim);
    if (!force && !reprocess && fs.existsSync(outPath)) { console.log(`skip ${name} (exists)`); continue; }
    const rawPath = path.join(RAW_DIR, `${name}.png`);
    const raw = reprocess ? rawPath : await generate(key, name, piece);
    const out = downscale(raw, name, piece.width, piece.colors, piece.trim, piece.aspect);
    const kb = Math.round(fs.statSync(out).size / 1024);
    console.log(`ok (${kb}KB)`);
    // Gentle pacing: the images endpoint rate-limits bursty accounts.
    await new Promise(r => setTimeout(r, 2000));
  }
  // Every painting needs its PIXEL RESOLVE thumbnail (src/art_thumbs.js).
  execFileSync('node', [path.join(__dirname, 'art_thumbs.js')], { stdio: 'inherit' });
})().catch(e => { console.error(e.message || e); process.exit(1); });
