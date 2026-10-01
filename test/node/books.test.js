
function bookRng(seed) {
  let x = (seed >>> 0) || 1;
  return () => {
    x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}
const BOOK_SAVE = () => ({ relics: {}, armor: {} });
function bookShare(contextKey, tier, n = 4000) {
  const rng = bookRng(0xB00C + tier);
  let books = 0;
  for (let i = 0; i < n; i++) {
    const r = pickReward(contextKey, BOOK_SAVE(), rng, { tier });
    if (r && r.kind === 'item' && r.id === 'book') books++;
  }
  return books / n;
}


test('books: the Book is the heaviest draw in its class/tier pool', () => {
  const book = ITEM_BY_ID['book'];
  assert.truthy(book, 'the Book is in the catalog');
  assert.eq(book.kind, 'supply', 'it is a consumable');
  assert.gt(book.dropWeight || 1, 1, 'it carries a dropWeight above the even draw');
  const peers = ITEMS.filter((i) => i.kind === 'supply' && i.baseTier === book.baseTier);
  assert.gt(peers.length, 1, 'the T2 consumable pool has more than one member');
  for (const p of peers) {
    if (p.id === 'book') continue;
    assert.lt(p.dropWeight || 1, book.dropWeight, `${p.id} does not out-draw the Book`);
  }
});

test('books: a school chest is a book chest — about a quarter of opens', () => {
  const share = bookShare('chest:school', 3);
  assert.gt(share, 0.15, `a school chest hands over a Book often (got ${(share * 100).toFixed(1)}%)`);
  assert.lt(share, 0.60, 'but it is still a chest, not a book dispenser');
});

test('books: a school chest beats every other chest at handing one over', () => {
  const school = bookShare('chest:school', 3);
  for (const key of Object.keys(LOOT_CONTEXTS)) {
    if (!key.startsWith('chest:') || key === 'chest:school') continue;
    const other = bookShare(key, 3);
    assert.lt(other, school, `${key} yields fewer Books than a school (${(other * 100).toFixed(1)}%)`);
  }
});

test('books: themed civic uses a dedicated Book group', () => {
  assert.eq(ChestThemes.weights('civic', 3).books, 20);
  const share = bookShare('chest:civic', 3);
  assert.inRange(share, 0.12, 0.24, 'low quality can fall back, but civic retains a reliable Book source');
});

test('books: a school dense enough to be T1 still pays a book', () => {
  const rng = bookRng(0x5C4001);
  let books = 0, otherConsumables = 0;
  for (let i = 0; i < 4000; i++) {
    const r = pickReward('chest:school', BOOK_SAVE(), rng, { tier: 1 });
    if (!r || r.kind !== 'item' || r.cls !== 'supply') continue;
    if (r.id === 'book') books++; else otherConsumables++;
  }
  assert.gt(books, 0, 'a T1 school chest can still produce a Book');
  assert.gt(books, otherConsumables, 'and the Book is what its consumable roll usually is');
});


const SCHOOL_CLASSES = ['school', 'college', 'library', 'books'];

test('school category: every place of learning maps to it', () => {
  for (const cls of SCHOOL_CLASSES) {
    assert.eq(POI_CATEGORY[cls], 'school', `${cls} is a place of learning`);
  }
  assert.truthy(LOOT_CONTEXTS['chest:school'], 'and the loot row it names exists');
});

test('school category: the split re-priced nothing — tier, pad and cave mirror match civic', () => {
  for (const n of [1, 3, 10, 40]) {
    assert.eq(chestTier({ kind: 'chest', poiClass: 'school', poiDensity: n }),
      chestTier({ kind: 'chest', poiClass: 'town_hall', poiDensity: n }), `the same tier at ${n} of a kind`);
  }
  assert.eq(padShapeKeyForPoi('school'), padShapeKeyForPoi('town_hall'),
    'and it keeps the civic pad');
  for (const cls of SCHOOL_CLASSES) {
    assert.truthy(chestMirrorsUnderground(cls), `${cls} still mirrors underground`);
  }
});

test('school category: Book odds have one owner, without a second favorite roll', () => {
  assert.eq(ChestThemes.weights('school', 3).books, 55);
  assert.eq(LOOT_CONTEXTS['chest:school'].favourite, undefined);
});

test('school category: the favourite only fires inside its own class', () => {
  const rng = bookRng(0xC1A55);
  const kinds = new Set();
  for (let i = 0; i < 3000; i++) {
    const r = pickReward('chest:school', BOOK_SAVE(), rng, { tier: 3 });
    if (r && r.kind === 'item' && r.id !== 'book') kinds.add(ITEM_BY_ID[r.id]?.kind);
  }
  assert.truthy(kinds.size > 1, 'a school chest still pays seeds, produce and ore too');
});



test('course: play_tips loads after its mechanic owners and before app', () => {
  const at = (src) => INDEX_HTML_SRC.indexOf(src);
  const tips = at('src/play_tips.js');
  assert.gt(tips, at('src/items.js'), 'item guides exist before the course uses them');
  assert.gt(tips, at('src/energy.js'), 'offline-rest timing exists before the course quotes it');
  assert.gt(tips, at('src/crops.js'), 'crop timing exists before the course quotes it');
  assert.gt(tips, at('src/interact.js'), 'animal interaction code and owners load before the course');
  assert.lt(tips, at("const APP_SRC = 'src/app.js"), 'the course exists before app boots');
});

test('course: readBook walks the list in order and bookmarks its place', () => {
  assert.falsy(/PLAY_TIPS\[Math\.floor\(Math\.random\(\) \* PLAY_TIPS\.length\)\]/.test(SCENE_SRC),
    'the uniform random draw is gone');
  assert.truthy(/const read = this\.save\.tipsRead \?\? 0;/.test(SCENE_SRC),
    'the bookmark is read off the save, defaulted for saves that predate it');
  assert.truthy(/const page = read % PLAY_TIPS\.length;/.test(SCENE_SRC),
    'and wrapped at READ time, so adding a tip cannot scramble a bookmark');
  assert.truthy(/this\.save\.tipsRead = read \+ 1;/.test(SCENE_SRC),
    'the cursor is stored unwrapped');
  assert.truthy(/bookPageHTML\(page\)/.test(SCENE_SRC), 'and the page is what is read out');
});

test('course: the chest hint waits until there is nothing left to teach', () => {
  assert.truthy(/const coursePending = \(this\.save\.tipsRead \?\? 0\) < PLAY_TIPS\.length;/.test(SCENE_SRC),
    'app.js asks whether the course is still running');
  assert.truthy(/if \(!coursePending && Math\.random\(\) < 0\.5\)/.test(SCENE_SRC),
    'and the hint branch is gated on it');
});

test('course: the reader opens the book as a story', () => {
  assert.truthy(/title: '📖 The worn book falls open'/.test(SCENE_SRC),
    'the title describes opening the book');
});

test('course: story topics retain their saved-bookmark positions', () => {
  assert.eq(PLAY_TIPS.length, 137, 'three displaced opening tips are appended, then the gull\'s page, the road\'s bargain, the spear');
  const topics = {1:/strength/, 11:/wounded goblin/, 13:/snare/, 20:/hoe/, 24:/ruined house/, 25:/smithy/, 35:/car park/, 56:/smith/, 69:/stone/, 77:/path/, 88:/favourite food/, 98:/weapon/, 106:/stairs/, 121:/quartermaster/, 130:/sapphire/};
  for (const [page, topic] of Object.entries(topics)) assert.truthy(topic.test(PLAY_TIPS[page]), 'topic stays at page ' + page);
});

test('mechanics: ghost cadence, damage and crypt habitats match their owners', () => {
  const ms = EnemyRoster.GHOST_SCALING.cadenceSeconds * 1000;
  assert.eq(__ghost.GHOST_SPAWN_MS, ms, 'the pump derives the roster cadence');
  assert.eq(__ghost.GHOST_SPAWN_JITTER_MS, EnemyRoster.GHOST_SCALING.jitterSeconds * 1000,
    'the pump derives the roster jitter');
  assert.eq(ms, 5 * 60000, 'every five minutes, from the live roster');
  assert.eq(Combat.GHOST_SPEED_MPS, 3, 'a run, from the live roster');
  const touch = Combat.monster('ghost').dmg;
  assert.eq(touch, Combat.GHOST_TOUCH_DMG, 'the live row carries the touch');
  const first = EnemyRoster.GHOST_SCALING.minCryptDepth;
  assert.truthy(__ghost.ghostsHaunt(first, 1, 'crypt'));
  assert.falsy(__ghost.ghostsHaunt(first - 1, 0, 'crypt'));
  assert.falsy(__ghost.ghostsHaunt(first, 0, 'natural'));
  assert.truthy(/nightfall.*ghosts/.test(PLAY_TIPS[19]), 'the early ghost page warns about nightfall');
});

test('tips: the list is substantial and every entry is a real sentence', () => {
  assert.gt(PLAY_TIPS.length, 60, 'a Book read repeats itself rarely');
  assert.eq(new Set(PLAY_TIPS).size, PLAY_TIPS.length, 'no tip is duplicated');
  for (const t of PLAY_TIPS) {
    assert.eq(typeof t, 'string', 'tip is a string');
    assert.gt(t.length, 20, `tip is a sentence: ${t}`);
  }
});

test('mechanics: home rest uses its own duration', () => {
  const m = SCENE_SRC.match(/const HOME_FULL_REST_S = (\d+);/);
  assert.truthy(m, 'app.js still owns HOME_FULL_REST_S');
  assert.eq(Number(m[1]), 50, 'the home rest is fifty seconds');
  assert.falsy(/^const INDOOR_FULL_REST_S/m.test(SCENE_SRC),
    'the constant behind it is gone from app.js too');
});

test('mechanics: offline rest restores energy after an hour', () => {
  assert.eq(Energy.OFFLINE_FULL_REST_MS, 60 * 60 * 1000, 'an hour away refills the bar');
});

test('mechanics: work prevents resting', () => {
  assert.truthy(/const working = !!this\._workProgress/.test(SCENE_SRC),
    'app.js still gates the rests on the work wheel');
});

test('mechanics: first tastes raise the energy cap', () => {
  const save = { armor: {}, eaten: [] };
  const before = Energy.maxEnergy(save);
  save.eaten = ['potato', 'berry', 'nut'];
  assert.eq(Energy.maxEnergy(save), before + 4, 'each new food tasted adds its tier (potato 1 + berry 1 + nut 2)');
});

test('mechanics: armour applies the mitigation ladder', () => {
  assert.eq(Combat.MITIGATION_ROUNDS, 4, 'the ladder really is four rounds');
  assert.eq(Combat.MIN_PLAYER_DAMAGE, 1, 'a blow always lands for at least 1');
  assert.eq(Combat.mitigate(40, 12), 40 - 12, 'round one spends the pool against the hit');
  assert.eq(Combat.mitigate(40, 30), 40 - 20 - 5, 'and the pool halves between rounds');
  assert.eq(Combat.mitigate(40, 1e9), 3, 'even an unlimited pool leaves 40 → 20 → 10 → 5 → 3');
});

test('mechanics: bare hands and tools use the duration ladder', () => {
  const bare = toolDurationMs({}, 'pick');
  assert.eq(bare / TOOL_DURATION_MS[1], 2.25, 'a Wood relic is 2.25× quicker, not 3×');
  assert.eq(bare / TOOL_DURATION_MS[7], 30, 'a Frost one is 30×');
});

test('mechanics: slow grinding has an energy and time cost', () => {
  assert.eq(SLOW_GRIND_ENERGY, 15, 'the grind costs 15⚡');
  assert.eq(SLOW_GRIND_MS, 30000, 'and half a minute');
});

test('mechanics: depth trims reach and empty energy removes it', () => {
  const scene = { save: { energy: 100, reachUpgrades: 0 }, cellM: 7, depth: 0 };
  const surface = reachCells(scene);
  scene.depth = 2;
  assert.eq(surface - reachCells(scene), 1, 'two levels down costs a whole cell of reach');
  scene.depth = 0; scene.save.energy = 0;
  assert.eq(reachRadiusM(scene), 0, 'and an empty tank reaches nothing');
});

test('mechanics: crop stages and harvesting keep their live timing and yields', () => {
  assert.eq(Crops.STAGE_HOLD_MS, 2 * 60 * 1000, 'a tier-1 stage is 2 minutes');
  assert.gt(Crops.stageHoldMs('coffee'), Crops.STAGE_HOLD_MS, 'finer crops take longer (the tip says so)');
  assert.truthy(/randInt\(1, 3\) \+ Math\.floor\(qual \/ 3\)/.test(INTERACT_SRC),
    'a pick still pays one to three');
  assert.truthy(/Math\.random\(\) < \(0\.25 \+ qual \* 0\.10\)/.test(INTERACT_SRC),
    'and hands a seed back a quarter of the time bare-handed');
});

test('stories: animal pages hint at produce and companionship', () => {
  const a = SpriteLayout.ANIMAL_INTERACTION;
  const produce = PLAY_TIPS[89];
  const follow = PLAY_TIPS[91];
  assert.truthy(/egg/.test(produce), 'feeding is told through its produce');
  assert.gt(a.produceCooldownMs, 0, 'produce retains a cooldown');
  assert.truthy(/follow/.test(follow), 'the cat story hints at companionship');
  assert.gt(a.followMs, 0, 'companionship has a real duration');
});

test('mechanics: ranged weapons keep their cadence and sensory hints', () => {
  assert.eq(Combat.FIRE_INTERVAL_MS, 2000, 'a bow or staff fires every two seconds');
  assert.truthy(/compass/.test(RELIC_DEFS.bow.blurb), 'the bow says how it aims');
  assert.truthy(/spark|foe/.test(RELIC_DEFS.staff.blurb), 'the staff says what a bolt costs');
});

test('mechanics: enemy health uses a bar', () => {
  assert.truthy(/_drawEnemyHealthBar/.test(SCENE_SRC), 'app.js draws a bar');
});

test('mechanics: sword, bow and staff occupy weapon slots', () => {
  assert.truthy(Gear.WEAPON_SLOTS.includes('sword') && Gear.WEAPON_SLOTS.length === 3,
    'sword / bow / staff are the three weapon slots');
});

test('descriptions: the net and the rod speed a job, they do not unlock one', () => {
  assert.gt(toolDurationMs({}, 'bugnet'), toolDurationMs({ bugnet: { tier: 1 } }, 'bugnet'),
    'a net only shortens the wheel');
  assert.truthy(/const netSlot = 'bugnet';/.test(INTERACT_SRC),
    'the hunt wheel reads the bugnet slot, not a weapon');
  assert.truthy(/swiftly.*fleeing/i.test(RELIC_DEFS.bugnet.blurb), 'the net says it speeds a hunt');
  assert.truthy(/fish BARE-HANDED/.test(INTERACT_SRC), 'interact.js still allows a bare cast');
  assert.truthy(/pull.*fish/i.test(RELIC_DEFS.rod.blurb), 'and the rod\'s blurb admits it');
});

test('mechanics: delivery progression keeps household wishlists stable', () => {
  assert.eq(Delivery.TIER_UNLOCK_EVERY, 20, 'the produce tier climbs every 20 deliveries');
  const save = { restoredHouses: { h1: {} }, houseWishlists: {} };
  const house = { id: 'h1' };
  const first = Delivery.wantedProduce(save, house);
  assert.truthy(first.length, 'a house wants something');
  assert.eq(JSON.stringify(Delivery.wantedProduce(save, { id: 'h1' })), JSON.stringify(first),
    'and it wants the same thing next time it is asked');
});

test('mechanics: requested deliveries pay a premium', () => {
  const m = SCENE_SRC.match(/const DELIVERY_BONUS_MULT = ([\d.]+);/);
  assert.truthy(m, 'app.js still owns the premium');
  assert.eq(Number(m[1]), 1.5, 'a set pays half again');
});

test('mechanics: the castle board holds three jobs', () => {
  assert.eq(QUEST_SLOTS, 3, 'the board holds three jobs');
});

test('mechanics: chest density and depth determine their tiers', () => {
  assert.eq(chestDensityTier(1), 4, 'the only one of its kind is T4');
  assert.eq(CHEST_TIER_COLOR[4], 0xc77dff, 'which is the violet gem');
  assert.eq(CHEST_DENSITY_T1_AT, 25, 'a crowd of twenty-five is T1');
  assert.eq(chestDensityTier(CHEST_DENSITY_T1_AT), 1, '…which is the crate');
  assert.eq(CHEST_TIER_DEPTH_STEP, 2, 'a chest climbs a tier every two levels down');
  assert.eq(CHEST_TIER_COLOR[CHEST_TIER_MAX], 0xffc23d, 'the deepest chest wears a gold gem');
});

test('mechanics: crates, barrels, gold pots, courier posts and gates retain their rewards', () => {
  assert.eq(CRATE_RESTORE_MAX_DAYS, 7, 'the longest restock is a week');
  assert.eq(crateRestoreDays({ poiDensity: CHEST_DENSITY_T1_AT }), 1, 'an ordinary crate: a day');
  assert.gt(BARREL_EMPTY_P_BASE, 0.5, '"most are empty"');
  const supply = BARREL_LOOT.find((r) => r.kind === 'supply');
  assert.eq(JSON.stringify(supply.ids), JSON.stringify(['torch', 'spear']), 'the supply is a torch or a spear (Oct 2026: the rope left, the spear joined)');
  const coin = BARREL_LOOT.find((r) => r.kind === 'coin');
  assert.eq(coin.min + '-' + coin.max, '1-3', '"a coin or three"');
  assert.eq(potCoinsFor(1), 30, 'a lone pot spills thirty');
  assert.eq(potCoinsFor(1000), 1, 'a crowded one a single coin');
  assert.eq(BIKE_RACK_SPEED_MUL, 2, '"twice as fast"');
  assert.eq(BIKE_RACK_MS, 3 * 60 * 1000, '"three minutes"');
  assert.eq(JSON.stringify(Lairs.KIND_ORDER.gate), JSON.stringify(['slime', 'goblin']), 'a slime or a goblin');
  assert.truthy(Lairs.DAILY_TIERS.has('gate') && Lairs.ALWAYS_AWAKE_TIERS.has('gate'), 'every day, every mode');
});

test('mechanics: ruined buildings roll the expected garrisons', () => {
  assert.eq(Lairs.LAIR_MAX_PER_STRUCTURE, 10, 'castles support ten guards');
  assert.eq(Lairs.capFor(12, 1), 10);
  assert.gt(Lairs.TIER_GUARDS[12], Lairs.TIER_GUARDS[9]);
  assert.truthy(Difficulty.PROFILES.easy.derelictLairs);
  assert.truthy(Difficulty.PROFILES.hard.derelictLairs);
  assert.eq(Lairs.OCCUPANCY[9].rate, 1 / 3, 'a third of wrecks are occupied');
  assert.eq(Lairs.OCCUPANCY[11].rate, 2 / 3, 'and "most forts"');
  assert.gte(Lairs.OCCUPANCY[12].rate, 0.9, 'and "nearly every castle"');
  assert.eq(Lairs.kindsAt(9, 1).join(), 'slime');
  assert.eq(Lairs.kindsAt(11, 1).join(), 'goblin,goblin_archer');
  assert.eq(Lairs.kindsAt(12, 1).join(), 'skeleton,skeleton_soldier');

});

test('mechanics: ruin guards chase within their leash', () => {
  const leashM = Lairs.LAIR_LEASH_CELLS * WorldGen.CELL_M;
  assert.eq(leashM, 70, 'the guard leash is seventy metres');
  assert.lt(Lairs.LAIR_AGGRO_CELLS, Lairs.LAIR_LEASH_CELLS, 'the chase begins within the leash');
  assert.lt(Lairs.LAIR_LEASH_CELLS, Lairs.LAIR_WAKE_CELLS,
    'a garrison could be pursued clean out of the ring that woke it');
});

test('mechanics: only claimed castles fire at enemies', () => {
  const fire = SCENE_SRC.slice(SCENE_SRC.indexOf('  _turretFire(now, px, py, halfSpanM, enemies, pc) {'),
                                SCENE_SRC.indexOf('  _drawShots() {'));
  assert.truthy(/if \(!this\.isClaimedKey\(o\.castle\)\) return;/.test(fire),
    'app.js still gates the turrets on the claim');
  assert.eq(Combat.TURRET_RATE_DIV, 5, 'a turret fires at a fifth of the player rate');
});

test('mechanics: no shop rations its deals; only the re-roll ladder eases with the hour', () => {
  assert.eq(typeof ShopsMath.dealCap, 'undefined', 'no shop waits an hour between deals');
  assert.eq(ShopsMath.easedRerolls({ bucket: 0, rerolls: 3 }, 1), 2, 'a re-roll rung comes off an hour');
});

test('mechanics: fort slots retain their prizes and bonuses', () => {
  assert.eq(ShopsMath.SLOT_PRIZES, 3, 'three prizes');
  assert.eq(ShopsMath.SLOT_REELS, 3, 'three of a kind');
  const S = ShopsMath;
  assert.eq(S.SLOT_NATURAL_MUL, 2, 'a natural three pays double');
  assert.eq(S.SLOT_STAR_BADGES, 1, 'three stars pay one memory');
  assert.eq(S.SLOT_DELUXE_MUL, 2, 'deluxe doubles');
});

test('mechanics: shiny animals retain their value premium', () => {
  assert.eq(PRICES.shiny_chicken, itemValue('chicken') * 10, 'a shiny pays ten times');
});

test('descriptions: coffee explains its movement effect', () => {
  assert.truthy(/quick|swift|step|stride|feet/.test(ITEM_EFFECTS.coffee),
    'the effect names faster control-stick walking');
  assert.gt(CONSUMABLE_SPEC.coffee.durationMs, 0, 'coffee has a real timed benefit');
});

test('mechanics: deep rock follows the gem table', () => {
  const m = INTERACTABLES_SRC.match(/const GEM_BY_TIER = \{([^}]*)\}/);
  assert.truthy(m, 'interactables.js still owns the gem table');
  for (const [tier, gem] of [[4, 'sapphire'], [5, 'ruby'], [6, 'emerald'], [7, 'diamond']]) {
    assert.truthy(new RegExp(`${tier}: \\[[^\\]]*'${gem}'`).test(m[1]),
      `T${tier} rock still pays a ${gem}`);
  }
});

test('mechanics: vendors never offer unique jewelry as gear', () => {
  const save = { relics: {}, armor: {} };
  const rng = bookRng(0x21C0);
  for (let i = 0; i < 2000; i++) {
    const offer = Gear.buildRelicOffer(save, rng);
    assert.truthy(!offer || !['ring', 'amulet'].includes(offer.slot), 'no jewelry gear slot remains');
  }
});

test('mechanics: melee reaches adjacent foes', () => {
  assert.eq(Combat.MELEE_REACH_CELLS, 1, 'a sword still reaches adjacent foes');
  assert.truthy(/too close/.test(RELIC_DEFS.sword.blurb),
    `the sword blurb says how far it swings: ${RELIC_DEFS.sword.blurb}`);
  assert.falsy(/in reach/.test(RELIC_DEFS.sword.blurb),
    'and never claims the lit reach again');
});

test('mechanics: struck slimes have a reaction window', () => {
  const m = CREATURE_AI_SRC.match(/const STRUCK_REACTION_MS = (\d+);/);
  assert.truthy(m, 'app.js still owns the reaction window');
  assert.eq(Number(m[1]), 8000, 'struck slimes react for eight seconds');
});

test('mechanics: gathering luck remains absent and Keen Eye favours chests', () => {
  assert.eq(typeof globalThis.gatherLuck, 'undefined', 'the gather-luck path is gone');
  assert.truthy(/Rarer/.test(Wizard.TRACKS.find(t => t.key === 'eye').sub), 'Keen Eye copy favours rare finds');
});

test('mechanics: snares hurt on entry and while standing on them', () => {
  assert.eq(Traps.STEP_ENERGY, 10, 'treading on one bites 10⚡');
  assert.eq(Traps.STAND_ENERGY_PER_S, 3, 'and standing on it bleeds 3 a second');
});

test('mechanics: street restoration retains its dwell and reward ladder', () => {
  assert.eq(Trail.GOAL_STEP_M, 200, 'the first rung is two hundred metres');
  const dwell = +/const PATH_STONE_DWELL_MS = (\d+);/.exec(SCENE_SRC)[1];
  assert.eq(dwell, 3000, 'three seconds of sight rebuilds a stretch');
  assert.eq(Trail.goalFor(1) - Trail.goalFor(0), Trail.GOAL_STEP_M, 'the rungs grow by a step');
  const road = LOOT_CONTEXTS[Trail.PRIZE_CONTEXT].classBias;
  assert.lt(road.seed, road.magic + road.supply + road.boots, 'road supplies outweigh seeds');
  assert.eq(ITEM_BY_ID[Trail.firstPrize(1).id].kind, 'seed',
    'the first prize really is a seed');
});

test('mechanics: roads use the shared reward window', () => {
  assert.truthy(/const ONE_ROAD_WINDOW_MS = /.test(SCENE_SRC) && /_oneRoadPay\(perLine, now\)/.test(SCENE_SRC),
    'the sweep pays through the one-road window');
  assert.eq(Trail.BOOTS_M_PER_TIER, 1000, 'a tier per km');
});

test('mechanics: rebuilding adds stone to later restoration costs', () => {
  assert.eq(WRECK_RESTORE_PER_HOUSE, 1, 'each restored house adds one stone to the next cost');
});

test('restore cost: 1 stone, one more per house restored, capped at 20', () => {
  assert.eq([0, 1, 2, 6, 18, 19, 20, 50].map(wreckRestoreExact).join(','), '1,2,3,7,19,20,20,20', 'the ladder');
  for (const k of ['a', 'b', 'c']) assert.eq(wreckRestoreQty(4, k), 5, 'same price for every house');
});

test('stories: wizard memories precede the permanent calling', () => {
  const at = 125;
  assert.eq(Wizard.CLASS_AT_BUYS + 1, 3, 'the third purchase offers a calling');
  assert.eq(Wizard.TRACKS.length, 4, 'the wizard has four gift tracks');
  assert.eq(Wizard.OFFER_COUNT, 2);
  assert.truthy(/unspent memories/.test(PLAY_TIPS[at]), 'the wizard hints at the value of memories');
  assert.truthy(/calling.*for good/.test(PLAY_TIPS[at + 1]), 'the next page warns that a calling is permanent');
});

test('mechanics: leaving your real position weakens attacks', () => {
  assert.eq(Math.round((1 - Combat.OFF_GPS_ATTACK_MUL) * 3), 1, 'the penalty is a third');
});

test('books: pages carry brief stories instead of numeric mechanics', () => {
  for (const [i, page] of PLAY_TIPS.entries()) {
    assert.eq(typeof page, 'string');
    assert.gt(page.length, 20, 'page ' + i + ' is a complete thought');
    assert.lt(page.length, 200, 'page ' + i + ' leaves room for one discovery');
    assert.falsy(/[0-9%⚡×]|\btier\b|Relics tab|hit points|UTC/.test(page), 'page ' + i + ' avoids tuning and interface instructions');
  }
  assert.eq(new Set(PLAY_TIPS).size, 137, 'each page offers a distinct moment');
});

test('books: real-world road and heat safety stays direct', () => {
  assert.truthy(/Never step into the road/.test(PLAY_TIPS[15]));
  assert.truthy(/Never enter the road/.test(PLAY_TIPS[16]));
  assert.truthy(/safely on foot/.test(PLAY_TIPS[17]));
  assert.truthy(/carry water.*shade.*rest often/.test(PLAY_TIPS[18]));
});

test('books: every saved page has a named volume and a consistent author voice', () => {
  assert.eq(PLAY_TIP_VOLUMES.length, PLAY_TIPS.length);
  for (const id of PLAY_TIP_VOLUMES) {
    const volume = BOOK_VOLUMES[id];
    assert.truthy(volume && volume.title && volume.author && volume.voice, id);
  }
  assert.eq(PLAY_TIP_ASIDES[0], 'a few passages stand out');
  assert.eq(PLAY_TIPS[10], 'Your wandering shadow can scout ahead. It cannot put your weight behind a blow. Plant your own boots where the fighting is. Strike true.');
  assert.eq(PLAY_TIPS[14], 'I laid snares here when the orders came. Today I returned with my tools. No one thanked me. The iron jaws are slack. That will have to be enough.');
  for (let page = 0; page < PLAY_TIPS.length; page++) {
    const html = bookPageHTML(page);
    assert.truthy(html.includes('class="book-volume"'));
    assert.truthy(html.includes('class="story-copy">“'));
    assert.truthy(html.endsWith('”</div>'));
    assert.eq(html.includes('<em>'), !!PLAY_TIP_ASIDES[page]);
    assert.falsy(/<blockquote/.test(html), 'page excerpts stay editable');
  }
});
