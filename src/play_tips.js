// Book curriculum - loaded after the mechanic owners whose values it teaches.
// The array order is persistent behaviour because save.tipsRead bookmarks it.

// === Book of Tips ============================================
// Non-obvious play tips revealed when the player uses a Book consumable.
//
// WHAT DOES *NOT* BELONG HERE: what a single item or relic DOES. That is the
// item's own description - ITEM_EFFECTS in items.js (the "✦ ..." line under the
// selected stack) for a consumable or material, RELIC_DEFS.blurb (the same
// line for a relic, plus the Stats panel's per-slot row) for a relic, the Eat
// button's "+N⚡" for a food, and the Stats panel's "−N damage" row for armour.
// The player reads those while HOLDING the thing, exactly when the answer is
// wanted; a Book that restates them spends a consumable to tell you something
// the inventory bar was already showing, and the two copies then drift apart.
// Until Sep 2026 a third of this list was that — the Rope tip and
// ITEM_EFFECTS.rope said the same sentence twice, the Hoe tip was its blurb
// verbatim, and one tip explained what a Book does, which you could only read
// by burning a Book. When a tip and a description overlap, the description
// wins and the tip goes.
//
// What a tip IS for: knowledge no single item can carry — where things grow,
// how a shop or a gate behaves, what an animal wants, what a screen readout
// means, and the odd riddle pointing at a secret.
// The Book handler in interact.js mixes ~50% of these with ~50% directional
// chest hints (computed live from the nearest unopened chest).
// THE ORDER IS THE CURRICULUM — this list is READ FRONT TO BACK. app.js
// readBook walks it one page per Book, bookmarked in save.tipsRead, so the
// position of a tip decides when in a playthrough it is taught. It used to be
// a uniform random draw with no memory, which threw the ordering away and put
// a repeat inside the first ~10 reads.
//
// The pages are therefore ordered by WHEN A TIP FIRST BECOMES ACTIONABLE —
// which is NOT the same as grouping it by subject, and the difference is the
// whole point. Grouping by subject produced two inversions worth remembering:
//
//   • 'A ruined house can be rebuilt: 5 wood…' sat at page 63, because it
//     read as a "progression gate". Rebuilding a wreck is starter-chain STEP
//     FOUR — so the game was teaching what your first rebuild becomes (page
//     17) forty-six pages before it taught you that you could rebuild at all.
//   • Chests sat at page 37, behind the entire village economy and twelve
//     consecutive pages of animal husbandry — when a POI chest is the first
//     thing most players open, minutes in.
//
// The stages: the first ten minutes (you cannot act without them), the
// starter loop, what is already lying around, the village economy, the land
// you walk over, animals, fighting, underground, the long gates — and the one
// riddle last, so the secret is the end of the course rather than a 1-in-72
// accident.
//
// Reading the screen sits in the first ten minutes on purpose, beside the
// snares: a slime is chewing on you inside the first few minutes, and what
// the bar over its head means is literacy, not trivia — as is knowing the
// verge you are walking along hides traps.
//
// So WHERE you add a tip is a decision, not an append. Ask when the player
// can first ACT on it, not what it is about.
//
// EVERY tip here is a claim about live behaviour — when a mechanic changes,
// the tip that describes it has to change with it, or the Book starts lying
// to the player. Cross-check against: energy.js (rest + the first-taste cap),
// coords.js (reach), crops.js (growth), combat.js (weapons, HP, the health
// BAR), traps.js (the snares), quests.js (the castle board), delivery.js
// (wishlists), shops_math.js (deal caps + stall prices), rarity.js
// (chest/shop tables), loot.js (chest tiers by density, restock days,
// barrels, pots of gold), gear.js
// (recipes), interactables.js (the slow grind, mining gates), items.js
// (foods, relics, animal foods), interact.js (taming / hunting / placeables)
// and worldgen.js (biomes, caves).
//
// THE OTHER HALF OF THE RULE: a mechanic the player cannot discover by
// looking at it — a derived number, a gate, a side-effect, a place that
// behaves differently — and that NO single item's description can carry,
// belongs here. The prune above deleted the tips that were restating an
// item; it must not become a licence to leave the rest undocumented. The Sep
// 2026 audit found the first-taste energy cap, the slow grind, the reach the
// dark takes back, the snares, giants, the coin a kill pays, the chest Home
// rings, the delivery premium, the quest board and the stall discount all
// live in the code and nowhere a player could read them. When you add a
// mechanic of that shape, add its tip.
//
// And a tip nobody draws is a tip nobody has. The Book carries a dropWeight
// (see its catalog entry in items.js) so it is the plurality of the T2 consumable
// pool everywhere, and the places of learning — POI_CATEGORY 'school' in
// loot.js, pinned through rarity.js 'chest:school' — hand one over from about
// a third of their chests. That is what makes this list worth keeping honest.
const PLAY_TIPS = [
  // ── The first ten minutes — you cannot act without these ────
  `Actions cost energy. Eat to refill - or just rest; ${shortDuration(Energy.OFFLINE_FULL_REST_MS)} away hands the whole bar back.`,
  'Hard mode makes you take 2.5 times as much damage after armour. Enemies have the same health and attacks in both modes.',
  'Hard mode is harsher on an empty tank: food, a campfire and time away all stop working. Only your trailer, a Crow Feather or a revival potion will put you back on your feet.',
  ITEM_GUIDE_TIPS.crow_feather,
  'Only your OWN home rests you — a full bar in fifty seconds. A stranger\'s roof is just a roof.',
  'A campfire rests you slowly out in the open, and slimes keep their distance.',
  'Resting stops while a work wheel turns. A job done on the doorstep still costs what it costs; the sit-down afterwards is what earns it back.',
  'Selling is home-only. Carry your haul back to your trailer, select a stack, and tap it to cash out.',
  'Every tool works bare-handed — just slowly. A Wood relic is twice as quick, a Frost one thirty times.',
  'How far you can touch is your own light: nothing at all on an empty bar, and half a cell less for every level you descend.',
  // The off-GPS penalty (combat.js OFF_GPS_ATTACK_MUL, app.js _attackMul):
  // taught before the first fight, since the stick is the first thing a player
  // at a desk reaches for. books.test.js re-derives "a third".
  'Fight where you truly stand. While the stick has carried you off your real footing, every blow and shot lands a third softer — walk there yourself to strike at full strength.',
  'The bar over a foe is its health, not a timer — green, then amber, then red.',
  'The ring around a thing you are working on is the wheel, and it is a different readout entirely: it says how far along the job is, never how hurt anything is.',
  'Snares lie hidden beside footpaths and along park edges — never by a road — and around the stairs underground. Treading on one bites 10\u26a1; standing on a sprung one bleeds 3 a second, so step off rather than wait it out.',
  ITEM_GUIDE_TIPS.trap_kit,
  // SAFETY (owner, Sep 2026) — taught in the first ten minutes, beside the
  // snares. THE KERB (creature_ai.js: WorldGen.ROAD_CLASS_MAJOR_BUFFER, the
  // kerbTurn reason in wanderCreatures, isFastFoe's spawn and step rule), THE
  // PASSENGER GATE (util.js GPS_MAX_WALK_MPS / speedGateStep — books.test.js
  // re-derives "16 km/h"), the stick (never the street), and heat / water.
  'Nothing hostile follows you to the pavement of a busy road: step onto the kerb and every chase ends there. Never into the road itself — nothing out there is worth it.',
  'Something out of reach across a street? Walk your farmer to it with the stick, never your feet.',
  'Faster than a run — about 16 km/h, in a car or on a bike — and the game stops: the street will not mend, nothing can be picked up, and nothing hunts you until you are on foot again.',
  'On a hot day carry water, keep to the shady side and rest often. Nothing in the lane is going anywhere.',
  // The ghosts (app.js GHOST_*, combat.js MONSTERS.ghost): the first night
  // can be the first session, and a touch is an eighth of a fresh bar — so
  // this is safety, taught beside the snares. books.test.js re-derives the
  // five minutes, the "twice", the touch (Combat.GHOST_TOUCH_DMG) and
  // the haunted levels (creature_ai.js GHOST_CAVE_EVERY).
  'After dark, ghosts rise out of the dark every five minutes or so. One hovers a moment, then rushes you at a run, and its touch costs 12\u26a1 before armour. Below ground, every second level is haunted at every hour. A torch or a lamp burns them, a campfire drives them off, and none will linger near Home or a castle you\'ve taken back.',
  // ── The starter loop — till, plant, rebuild, harvest, sell ───
  'Tilling refuses a cell holding a wildplant, rock, or building.',
  `An ordinary watered crop climbs one stage every ${shortDuration(Crops.STAGE_HOLD_MS)}, even while you are away, then needs watering again. Magical flowers take hours per stage; check their growing timer.`,
  'Pack an Antidote before exploring underground. Purple Slimes leave a sickness that follows you after the fight.',
  'A ripe crop pays one to three of itself, and about one pick in four hands a seed back as well.',
  'A ruined house can be rebuilt for 1 stone, and each one you rebuild adds a stone to the next, up to 20.',
  'The first wreck you rebuild becomes your own smithy, and it will beat out a wooden pickaxe, axe or hoe for 5 wood apiece.',
  'Crows and deer raid your crops, though crows never touch potatoes — and nothing raids the ones growing right by your Home.',
  ITEM_GUIDE_TIPS.scarecrow,
  `A wild slime beside you drains ${SLIME_LEECH_ENERGY} energy a second. Kill it, walk away, or stand by a fire — they will not come near one.`,
  // Placed with the slime it is about, and BEFORE the swing-reach page: the
  // first thing a player does about a slime is hit it, so what a half-hearted
  // swing turns it into is actionable the moment the pest tip above is.
  'Hostile plants in parks stay rooted. Walk around them to stay out of biting range.',
  'Strike a slime and it stops meandering: for eight seconds it comes straight at you, and a pet\'s bite provokes it just the same. Home\'s circle and a lit fire still turn it back.',
  'Swinging reaches one cell — exactly as far as a monster\'s bite. Your light reaches further, but only for work: closing in is what a fight costs.',
  'Your home turns enemies away inside its circle, and they cannot bite while they go. Strike one there and it does not merely leave — it runs until it is out of sight.',
  'Every new food you taste for the first time raises your maximum energy by its tier, for good — the rarer the food, the bigger the gain.',
  'A job one tier past your equipment is not refused outright: you can grind it out for 15\u26a1 and half a minute. Two tiers short is a flat no.',
  // ── What is already lying around — chests, X marks, foraging ───
  'Treasure X marks are buried in car parks — every parking lot hides one.',
  // THE BEACH (src/scenic.js): shore sand's X marks follow the shoreline
  // (Scenic.BEACH_X_SHORE_M, BEACH_X_MAX) and the tide line is the UTC day's
  // (Scenic.tideLive, the day ledger) — books.test.js re-derives both.
  `Sand by the water is dug ground: a beach hides an X mark for every ${typeof Scenic !== 'undefined' ? Scenic.BEACH_X_SHORE_M : 40}m of shoreline, far thicker than anywhere inland.`,
  'The sea leaves shells, driftwood and now and then a bottle along the waterline. What you take is gone for the day; a fresh tide comes in at midnight UTC.',
  'The gem above a chest is its tier. Gemless chests never hold relics; only the violet and the gold ones reach Frost.',
  // THE TIER IS DENSITY (loot.js CHEST_DENSITY_TIERS / chestTier): how many
  // of the chest's kind its tile holds. books.test.js re-derives "the only
  // one" (T4 at 1, the violet gem) and "twenty-five" (CHEST_DENSITY_T1_AT).
  'A chest\'s gem says how rare its kind is on that stretch of map: the only one of its kind wears violet, and where twenty-five or more of a kind crowd together each is a plain crate.',
  // THE CRATE (interactables.js restocks): the gemless crate comes back at
  // its own tier after loot.js crateRestoreDays (the day ledger) — a day for
  // an ordinary crate, one more per further CRATE_RESTORE_PER of its kind,
  // up to CRATE_RESTORE_MAX_DAYS ("a week"); every other chest, public art
  // and every X mark is one-off (save.opened / foundTreasures).
  // books.test.js re-derives the day and the week.
  'A plain crate refills at midnight UTC a day after you take it — or up to a week later where its kind crowds the streets. A trunk, a wagon, public art, a cave chest or an X mark gives once, for good.',
  // THE BARREL (loot.js isBarrel / rollBarrel / barrelEmptyP): bins and
  // recycling points. books.test.js re-derives "most" (BARREL_EMPTY_P_BASE
  // over a half) and the torch / rope (BARREL_LOOT).
  'Bins and recycling points are barrels: smash one for a coin or three, an apple, now and then a torch or a rope. Most are empty, and the more of them crowd a street the emptier they run. A smashed barrel mends like a crate.',
  // THE POT OF GOLD (an ATM — loot.js potCoinsFor off POT_COINS_BY_DENSITY):
  // books.test.js re-derives "thirty" (the lone pot) and "one" (the crowd).
  'A pot of gold spills coins once a day: thirty where it stands alone, fewer the more of them share its streets, down to a single coin in a crowd. They wait ten minutes for you, on your side of the street and never in the road.',
  // THE COURIER'S POST (the bike rack POI — loot.js isBikeRack, items.js
  // BIKE_RACK_SPEED_MUL / BIKE_RACK_MS): books.test.js re-derives "twice" and
  // "three minutes". Renamed Sep 2026: it lends the STICK its speed, and a
  // "bike" said ride one while you play.
  'A courier\'s post lends you its swift step once a day: for three minutes the stick carries you twice as fast.',
  // The POI light (interactables.js poiLit) — one mark for "still there".
  'A chest, crate, barrel, courier\'s post, pot of gold, chapel or park shrine that glows still has something for you. Take it and the light goes out until it comes back.',
  'One stone in ten gathered off the ground hides a gemfruit.',
  'Every new kind of thing you discover brings back a memory, and a full tank with it. Unspent, they hum with a power you might yet learn to use.',
  'A shiny flower or tree is worth ten times the money, and brings back a memory with it.',
  // THE INFLUENCE ZONES' finds (src/zones.js): the shrine's daily gift (the
  // coin-burst ledger), the headstones' ghost and one-off hoard rates
  // (Zones.HEADSTONE_GHOST_P / HEADSTONE_HOARD_SHARE — zones.test.js
  // re-derives both) and the nexus chest's extra tier (loot.js
  // ZONE_NEXUS_TIER_BONUS, "one").
  'A stone shrine at the heart of a named park leaves one gift a day for whoever touches it.',
  `Touch a church's headstone and one time in ${typeof Zones !== 'undefined' ? Math.round(1 / Zones.HEADSTONE_GHOST_P) : 3} the grave gives up a ghost, at any hour. About one stone in ${typeof Zones !== 'undefined' ? Math.round(1 / Zones.HEADSTONE_HOARD_SHARE) : 5} still hides a find, once.`,
  // A churchyard's anchor is a CHAPEL now (a macro stall — loot.js macroFor),
  // which wears no gem: its blessing rolls the bonus instead (Macros.chapelRollTier).
  'The chest at the heart of a grove or a fuel yard wears a gem one tier finer than its kind, and a churchyard\'s chapel gives a blessing one tier finer.',
  // Fishing: available from the first water tile with nothing in hand, so it
  // is taught here beside the other things already lying around — and what
  // the ✦ row on the rod cannot carry is the landing rule (items.js
  // fishCatchChance: each tier the fish is above the rod halves the odds).
  'A fish finer than your rod can slip the hook — every tier short halves your odds — but it stays where it was, waiting for a better rod.',
  'Now and then a cast hooks a slime instead of a fish. It lands beside you, and it is not happy about it.',
  // items.js rollEmptyCast (FISH_EMPTY_TREASURE_CHANCE: 1 in 50).
  'A cast with nothing biting is not always empty: it can drag up an old boot, a stone or a stick, and about one in fifty brings up treasure.',
  // items.js rollTillFind (TILL_*_CHANCE: 1 in 10, 1 in 10, 1 in 100).
  'Turning soil with the hoe now and then unearths a flint or a stone — and about one furrow in a hundred strikes buried treasure.',
  // ── The village economy, once you have a house to trade with ───
  'A house numbered ending in 9 is a Blacksmith — it forges your gems and bars into relics.',
  'Addresses ending 2 or 6 are shops. Each one you rebuild sells the next line — seeds, supplies, magic, ore, relics, pets — then round again, a tier up. Endings 1 and 8 are Traders, who barter only.',
  'Plain houses sell nothing. Each posts a wishlist of produce and pays half again what the same goods would fetch sold loose — for up to five sets, once.',
  'A household never changes its mind about what it wants — and one bundle keeps it happy for good.',
  'Every 20 deliveries behind you, the houses you rebuild from then on start asking for the next tier of crop.',
  'A shop makes one deal an hour. Castles and towers never make you wait.',
  ITEM_GUIDE_TIPS.flowers,
  'A fort runs a slot machine: three prizes a day, and three of a kind wins one — a natural three pays double, and a star completes any pair. The dearest is the jackpot — two of it pays 3 coin back. Two stars pay back double your stake; three stars bring back a memory the first time, then 100 coin. Two stars beside the jackpot turn the machine deluxe: the next 10 spins pay every prize and coin double, and the first time brings back a memory. A spin costs exactly what it wins on average, each memory counted as 100 coin.',
  'A castle you have claimed offers one favour a day: a rest, or its taxes.',
  'A roadside stall undercuts the listed price, and the finer your sword the smaller that discount gets — there is no buying cheap from one and selling on at a profit.',
  // THE MACRO STALLS (loot.js macroFor, src/macros.js): the in-building POIs.
  // macro_poi.test.js re-derives "half" (Macros.INN_RATE), "a tier"
  // (CHAPEL_TIER_DROP), "the same again" (BOUNTY_MATCH) and the curio
  // milestones (CURIO_MILESTONES). The day gate is the coin-burst ledger.
  'A building-front on the map is a place, not a chest, and it is never picked clean. An inn rests you to full once a day for half what a Potion of Vigor charges for the same energy; a chapel gives a blessing once a day, a tier humbler than a chest of its kind.',
  'A guildhall posts one bounty a day: take it and a pack comes for you close by, on your side of the street. Each kill drops its own coin, and clearing the pack pays the same again. The pack waits for you until the day turns; then the bounty is lost.',
  'A curio hall pays no coin. Every hall keeps the one collection of things that last — metal, gems, shells, feathers, lasting supplies — one of each, and a memory comes back at the 5th, 10th and 15th thing given.',
  // ── The land you walk over ──────────────────────────────────
  // StreetVariants.ROCK_STREET_SHARE (a quarter) — books.test.js re-derives it.
  'Wild rock lines about one residential street in four; shrubs grow in parks, woods and industrial lots.',
  // The old trade roads (src/street_variants.js MAJOR size: WAGON_STOP_SHARE
  // wagons, the look only — no guard, no snares, no dogs since Sep 2026, the
  // safety rule) and a barricade road's goblin, seated back past the kerb
  // buffer (StreetVariants foeSeat, lairs.js 'barricade').
  'The big roads are old trade roads: wheel ruts, and a broken wagon at the odd stop. Nothing lies in wait on them, but a barricade road\'s goblin still holds the ground behind its barricade.',
  // app.js SLOW_BODY_M_S / _bodyHold.
  'Tar and iron stakes on a burned road drag at your feet: your body falls behind where you truly stand until you step clear.',
  // The influence zones (src/zones.js): the halo ground, the tar yard's tar
  // (the same slow) and its fire slimes (lairs.js 'tar', every mode).
  'Parks, churches and fuel yards spread their own ground around them. A fuel yard weeps tar that drags at your feet the same way.',
  // interactables.js INTERACTABLES.waystone / .infoboard (one lane).
  'Touch a waystone on a pilgrim\'s way, or read a notice board, and it tells you one page of old lore — once per stone or board.',
  // THE GATES (worldgen.js gatePostsAt, lairs.js 'gate' — DAILY_TIERS, the
  // slime / goblin ladder, every mode).
  'A gate between two posts is a way something comes through: every day a slime or a goblin rises there, in every mode.',
  // StreetVariants café hoards (HOARDS_PER_TILE) + lairs.js 'cafe' (a giant
  // goblin, every mode — only where the hoard sits clear of the kerb buffer).
  'Some coffee shops have a hoard buried nearby, and a giant goblin sits on most of them.',
  // StreetVariants.LANTERN_SPACING_DIV (twice).
  'A lantern row, once rebuilt, stands its lamps twice as thick as any other street.',
  'Roads and footpaths lie derelict until you stand by them: three seconds inside your light rebuilds that stretch for good. The first 200m restored pays a seed, and each prize after asks 200m more. Pick one of three: coin, seeds or supplies, and potions or boots — boots no finer than a tier for every km mended.',
  // ONE ROAD AT A TIME (app.js _oneRoadPay, ONE_ROAD_WINDOW_MS) and the
  // stick's share (Trail.STICK_METRES_MUL) — books.test.js re-derives both.
  'Roads side by side pay as one: rebuild two at once and only the one that mended most counts toward your next prize. Lamps are not held to it — each pays its own. Steered off where you truly stand with the stick, road counts only 40%.',
  // LIVING LAMPS (src/streets.js): Streets.LAMP_FADE_MS (a day) fade,
  // lampCredit (the gap to the next lamp x how dim), LAMP_PATH_SPACING_DIV
  // (twice) — books.test.js re-derives all three.
  'A rebuilt street\'s lamps fade over a day. Walk by one again and it flares, adding road to your total — three quarters of a lamp\'s worth once it has gone a day dark. Footpaths stand their lamps twice as close, and pay as much apiece.',
  // SCENIC PATHS and VIEWPOINTS (src/scenic.js): Scenic.SCENIC_MUL (the
  // shore's and the park / greenway's multiplier on the ladder, never the
  // distance — Trail.restoredMetres), the sidewalk rule, and the vista:
  // VISTA_CHEST_TIER.grail (the violet gem), the daily gift (the day
  // ledger), the rest on the fire's ring and the first vista's relic —
  // books.test.js re-derives the numbers.
  `A path by the water counts ${typeof Scenic !== 'undefined' ? Scenic.SCENIC_MUL.shore : 2}\u00d7 toward your next road prize, and one through a named park or along a greenway ${typeof Scenic !== 'undefined' ? Scenic.SCENIC_MUL.park : 1.5}\u00d7 — but a pavement beside a road is just road. The distance you have mended still reads true.`,
  `A viewpoint's old scope gives once — the chest beside it wears ${typeof Scenic !== 'undefined' && Scenic.VISTA_CHEST_TIER.grail === 4 ? 'violet' : 'a fine gem'} — and a little every day after. Sit within its light and you rest as by a fire. The first one you find hands you something for the walking.`,
  'Long grass takes to grassland, farmland, parks and orchards — but never deep forest.',
  'Softwood fells a tier easier than most timber and hardwood a tier harder — and everything growing within 100m of where you began is soft pine.',
  'A planted tree takes four days to come up, and only a full-grown one pays a full load of timber.',
  'In either mode, ruins are held — about a third of wrecked houses, most forts, and nearly every castle — and the bigger the building the bigger the garrison: a castle can hide fifteen. Wrecked houses are infested by slimes; forts hold goblins and archers; castles hold skeletons and giant skeletons.',
  'On hard, you learn to make a thing only by first finding one out in the world.',
  'A held ruin waits. Come within a few cells and the whole garrison comes at you at once — but it never strays far from its own building, so get seventy metres from the ruin and they give up and walk back to it.',
  // ── Animals — meeting them, then keeping them ───────────────
  'Feeding an animal its favourite tames it where it stands — it stays in the world, it does not go in your bag.',
  `Feed any plant or crop to a chicken or cow for an egg or milk - but only once every ${shortDuration(SpriteLayout.ANIMAL_INTERACTION.produceCooldownMs)} from each.`,
  `Tap a tame animal to pet it. Pet a cow or chicken and for ${shortDuration(SpriteLayout.ANIMAL_INTERACTION.petBoostMs)} its next yield has a ${Math.round(SpriteLayout.ANIMAL_INTERACTION.doubleYieldChance * 100)}% chance of doubling.`,
  `Pet a tame cat and it trails after you for ${shortDuration(SpriteLayout.ANIMAL_INTERACTION.followMs)}.`,
  'A tame cat hunts crows for you; a tame dog hunts deer and chases slimes away.',
  'Chasing an animal down is a chase: it bolts while the wheel turns, and if it stays out of your reach for a second it is gone.',
  'Deer and crows are game: you hunt them, never shoot them. Bare-handed a hunt is a long stalk. No weapon hurries a hunt — that is what the net is for. And a hunted deer does not run from the net: it turns and charges you until the hunt is over.',
  'A shiny animal pays ten times its plain kind, bolts half again as fast, and takes twice the work to bring down.',
  ITEM_GUIDE_TIPS.slime,
  // ── Fighting, once you are armed ────────────────────────────
  'Only one weapon is ever in play. Tap another in the Relics tab to make it the one that answers a foe.',
  // The Training Hall (combat.js TRAINING_*, src/macros.js lesson prices):
  // books.test.js re-derives every number here.
  // macro_poi.test.js pins every quoted number against Combat.
  `A training hall sells lessons: +1% damage for good each, up to +25%. The first costs $${Macros.TRAINING_LESSON_FIRST}, each one after $${Macros.TRAINING_LESSON_STEP} more, up to $${Macros.TRAINING_LESSON_TOP}. Or a drill: +10% for a day, one at a time. Both ride on every blow and shot of your own, never a pet's.`,
  'Worn armour soaks what a blow takes off your bar, and a set stacks: the pool covers half a hit, then half of what is left, four times over. It can never soak a blow to nothing — something always gets through.',
  'A loosed arrow stops in the first thing it meets, timber and stone included; a bolt of magic passes through the lot and strikes everything on the line.',
  'A bow shoots across the street; a staff will not wake for anything further than a single cell past your reach — and underground that shrinks with your lit ring.',
  'Anything hostile you put down drops its pay as one coin where it fell — about a coin per 5 hit points, a little more for every level down. Walk over and pick it up.',
  'Towers on a castle you have CLAIMED fight on your side: any in sight looses an arrow at the nearest foe, at a fifth of your own rate, and a foe that strays near its walls turns and runs, as it would from Home. A tower\'s kill leaves its coin and nothing more. An unclaimed castle\'s walls stay silent.',
  // ── Underground, which you go looking for ───────────────────
  'Tap a staircase to go down. Barely a tenth of surface rock bears ore; underground, every level is a mine of its own metal and the one before it — iron and copper three levels down, and so on to the deepest.',
  ITEM_GUIDE_TIPS.torch,
  ITEM_GUIDE_TIPS.rope,
  'A cave wall mines out like any rock, bare-handed, and the passage you dig stays open.',
  'Ore wants a pickaxe one tier under what it holds, and every tier it out-tiers yours adds 9\u26a1 to the swing.',
  'Gems come only out of the deeper stone: sapphire from gold-bearing rock, ruby from platinum, emerald from crimson, and a diamond only from frost.',
  'Some cave clusters are veins: one ore tier concentrated tenfold. Work the whole seam once you strike it.',
  'A chest mirrored underground climbs a tier every two levels down, to a gold gem no surface chest ever wears.',
  'Underground chests keep their location’s specialty, with extra potions, powders and travelling supplies. Buried X marks keep their own coin and supply mix.',
  'The deeper chests and X marks underground hoard instead: potions, powders, and — once they run rich enough — gems.',
  'Goblins hold the deep — level 2 and below. By level 3 their archers shoot from three cells off.',
  // The trapper: what it does (lays snares, never swings) and what it pays
  // (its own trap, tamed) are mechanics no item line can carry — the Magic
  // Trap's ✦ says what the trap does, not where it comes from.
  'A red goblin never swings at you: it hangs back and lays snares on the ground between you. Put it down and one of its traps is yours.',
  'Every monster has a giant form: four times the health, met two levels below its ordinary kind.',
  'One cave monster in ten is standing on a buried hoard.',
  'A shiny monster underground is twice the fight and hits twice as hard — and its end always pays past the usual wage.',
  // ── The long gates — hours in ───────────────────────────────
  'Forts are sealed until you pay the quartermaster in wood — 6 for your first, rising by 6 up to 30.',
  'A castle stays sealed until you finish the job on its board — then it is yours.',
  'The castle board always holds three jobs, and each castle offers only one of them: the next castle along has different work.',
  'A castle job grows with the number you have already finished, and so does the purse it pays.',
  'The wizard sees power in your memories. Each visit he offers two gifts from four — wider reach, bigger finds, the Ring, more energy — and every purchase changes the pair.',
  'Your third purchase from the wizard is a calling instead: Hunter, Runner, Enforcer or Enchanter. You choose once, for good. An Enchanter can channel a timed potion for energy and keep the flask.',
  'No shop, smithy or castle vault deals in Rings. The wizard\'s Keen Eye is what puts one on your hand.',
  'Platinum, Crimson and Frost bars are smelted from a magical flower and the bar below it — or prised out of the rarest deep rock, if your tools are nearly its equal.',
  'No shop stocks sunflower, fireflower or iceflower seeds. The magical flowers have to be found.',
  // ── Secret — slime taming. The last page, so it is earned. ───
  'The old texts speak of a gem that calms even the most wretched creature. Perhaps a sapphire offered to a slime...',
];

