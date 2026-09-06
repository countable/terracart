// The Book — what it says, how often it turns up, and where.
//
// A Book is not loot, it is DOCUMENTATION: reading one is the only way the
// game explains a derived number, a gate or a side-effect the player cannot
// see by looking at the world. Two things follow from that, and this file
// pins both.
//
//   1. IT HAS TO BE TRUE. Every tip in PLAY_TIPS (items.js) is a claim about
//      live behaviour, so the tests below re-derive the numbers the tips quote
//      from the modules that own them — the rest rates, the firing cadence,
//      the growth hold, the delivery ladder, the chest rings — and fail when a
//      mechanic moves and its tip doesn't. They also blacklist the exact stale
//      sentences the Sep 2026 audit found: a five-minute rest in "any
//      building" (only your own home rests you since the campfire landed), a
//      shot "a second" (the cadence is two), a health "ring" (it is a bar
//      beside the crown), a wishlist that "rerolls every day" (a household's
//      never changes), and the three-step castle chain the quest BOARD
//      replaced.
//   2. IT HAS TO BE READ. A tip nobody draws is a tip nobody has. The Book
//      carries a dropWeight (items.js) so it is the commonest T2 consumable
//      everywhere, and the places of learning — school, college, library,
//      bookshop — pin it outright (loot.js POI_CATEGORY → 'school', rarity.js
//      'chest:school' favourite), so there is somewhere on the map a player
//      can walk to and reliably come back from with one.

// ── A deterministic RNG so the sampling tests can't flake ────────────────────
function bookRng(seed) {
  let x = (seed >>> 0) || 1;
  return () => {
    x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}
const BOOK_SAVE = () => ({ relics: {}, armor: {} });
// Fraction of `n` opens of a chest context that hand over a Book.
function bookShare(contextKey, tier, n = 4000) {
  const rng = bookRng(0xB00C + tier);
  let books = 0;
  for (let i = 0; i < n; i++) {
    const r = pickReward(contextKey, BOOK_SAVE(), rng, { tier });
    if (r && r.kind === 'item' && r.id === 'book') books++;
  }
  return books / n;
}
// Every tip, lowercased, as one blob — for the "no tip still says X" sweeps.
const TIPS_BLOB = PLAY_TIPS.join('\n').toLowerCase();
const someTip = (re) => PLAY_TIPS.some((t) => re.test(t));

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE BOOK TURNS UP
// ─────────────────────────────────────────────────────────────────────────────

test('books: the Book is the heaviest draw in its class/tier pool', () => {
  const book = ITEM_BY_ID['book'];
  assert.truthy(book, 'the Book is in the catalog');
  assert.eq(book.kind, 'consumable', 'it is a consumable');
  assert.gt(book.dropWeight || 1, 1, 'it carries a dropWeight above the even draw');
  // Nothing else at its tier in its class may out-weigh it, or "the commonest
  // consumable" is a comment rather than a fact.
  const peers = ITEMS.filter((i) => i.kind === 'consumable' && i.baseTier === book.baseTier);
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

test('books: the dropWeight lifts books everywhere, not just at school', () => {
  // An ORDINARY chest, with no favourite to help: of the consumables a T2
  // civic chest pays out, the Book must be the plurality — an even draw of
  // the seven-strong T2 pool would put it at 1/7.
  const peers = ITEMS.filter((i) => i.kind === 'consumable' && i.baseTier === 2);
  const even = 1 / peers.length;
  const rng = bookRng(0xD0FF);
  const seen = {};
  let consumables = 0;
  for (let i = 0; i < 6000; i++) {
    const r = pickReward('chest:civic', BOOK_SAVE(), rng, { tier: 2 });
    if (!r || r.kind !== 'item' || r.cls !== 'consumable') continue;
    consumables++;
    seen[r.id] = (seen[r.id] || 0) + 1;
  }
  assert.gt(consumables, 100, 'the sample actually drew consumables');
  // Measured inside the Book's OWN tier: a T2 chest can jackpot up to the T3
  // consumable (dragon powder), and that draw says nothing about the weight.
  let t2 = 0;
  for (const id of Object.keys(seen)) if (ITEM_BY_ID[id]?.baseTier === 2) t2 += seen[id];
  const share = (seen.book || 0) / t2;
  assert.gt(share, even * 2, `the Book out-draws an even share (got ${(share * 100).toFixed(1)}%)`);
  for (const id of Object.keys(seen)) {
    if (id === 'book' || ITEM_BY_ID[id]?.baseTier !== 2) continue;
    assert.lt(seen[id], seen.book, `the Book out-draws ${id}`);
  }
});

test('books: a school demoted to T1 by the Home rings still pays a book', () => {
  // The Home rings drop a school chest to T1 within 350 m of the trailer
  // (loot.js chestTierHomeDrop), and the whole T1 consumable pool is the
  // scarecrow — so without the pin the school on your own street would be the
  // one that never handed over a book. The favourite ignores the rolled tier
  // for exactly this case.
  const rng = bookRng(0x5C4001);
  let books = 0, otherConsumables = 0;
  for (let i = 0; i < 4000; i++) {
    const r = pickReward('chest:school', BOOK_SAVE(), rng, { tier: 1 });
    if (!r || r.kind !== 'item' || r.cls !== 'consumable') continue;
    if (r.id === 'book') books++; else otherConsumables++;
  }
  assert.gt(books, 0, 'a T1 school chest can still produce a Book');
  assert.gt(books, otherConsumables, 'and the Book is what its consumable roll usually is');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE SCHOOL CATEGORY IS CIVIC IN EVERYTHING BUT ITS LOOT
// ─────────────────────────────────────────────────────────────────────────────

const SCHOOL_CLASSES = ['school', 'college', 'library', 'books'];

test('school category: every place of learning maps to it', () => {
  for (const cls of SCHOOL_CLASSES) {
    assert.eq(POI_CATEGORY[cls], 'school', `${cls} is a place of learning`);
  }
  assert.truthy(LOOT_CONTEXTS['chest:school'], 'and the loot row it names exists');
});

test('school category: the split re-priced nothing — tier, pad and cave mirror match civic', () => {
  assert.eq(CHEST_TIER_BY_CATEGORY.school, CHEST_TIER_BY_CATEGORY.civic,
    'a school chest is the tier it always was');
  assert.eq(padShapeKeyForPoi('school'), padShapeKeyForPoi('town_hall'),
    'and it keeps the civic pad');
  for (const cls of SCHOOL_CLASSES) {
    assert.truthy(chestMirrorsUnderground(cls), `${cls} still mirrors underground`);
  }
});

test('school category: the row declares the Book, and a heavier consumable share', () => {
  const ctx = LOOT_CONTEXTS['chest:school'];
  assert.eq(ctx.favourite?.id, 'book', 'the favourite is the Book');
  assert.gt(ctx.favourite.p, 0.5, 'and it wins the consumable roll more often than not');
  assert.gt(ctx.classBias.consumable, LOOT_CONTEXTS['chest:civic'].classBias.consumable,
    'the consumable share is heavier than civic\'s');
});

test('school category: the favourite only fires inside its own class', () => {
  // A pin that leaked across classes would turn every seed roll into a book.
  const rng = bookRng(0xC1A55);
  const kinds = new Set();
  for (let i = 0; i < 3000; i++) {
    const r = pickReward('chest:school', BOOK_SAVE(), rng, { tier: 3 });
    if (r && r.kind === 'item' && r.id !== 'book') kinds.add(ITEM_BY_ID[r.id]?.kind);
  }
  assert.truthy(kinds.size > 1, 'a school chest still pays seeds, produce and ore too');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE TIPS ARE TRUE — re-derived from the modules that own the numbers
// ─────────────────────────────────────────────────────────────────────────────

test('tips: the list is substantial and every entry is a real sentence', () => {
  assert.gt(PLAY_TIPS.length, 60, 'a Book read repeats itself rarely');
  assert.eq(new Set(PLAY_TIPS).size, PLAY_TIPS.length, 'no tip is duplicated');
  for (const t of PLAY_TIPS) {
    assert.eq(typeof t, 'string', 'tip is a string');
    assert.gt(t.length, 20, `tip is a sentence: ${t}`);
  }
});

test('tips: the home rest quotes HOME_FULL_REST_S, and no tip rests you in a stranger\'s house', () => {
  const m = APP_JS_SRC.match(/const HOME_FULL_REST_S = (\d+);/);
  assert.truthy(m, 'app.js still owns HOME_FULL_REST_S');
  assert.eq(Number(m[1]), 90, 'the home rest is ninety seconds');
  assert.truthy(someTip(/ninety seconds/i), 'and a tip says so');
  // The stale claim: every building used to rest you at INDOOR_FULL_REST_S.
  assert.falsy(/stand inside any building/i.test(TIPS_BLOB), 'no tip rests you indoors anywhere');
  assert.falsy(/full bar in five minutes/i.test(TIPS_BLOB), 'and none quotes the dead 5-minute rate');
  // The rate the old tip quoted has no constant left in app.js — only the
  // comment explaining why it went.
  assert.falsy(/^const INDOOR_FULL_REST_S/m.test(APP_JS_SRC),
    'the constant behind it is gone from app.js too');
});

test('tips: the offline rest quotes Energy.OFFLINE_FULL_REST_MS', () => {
  assert.eq(Energy.OFFLINE_FULL_REST_MS, 60 * 60 * 1000, 'an hour away refills the bar');
  assert.truthy(someTip(/an hour away from the game/i), 'and a tip says an hour, not just "trickles back"');
});

test('tips: working-is-not-resting is documented, because it is enforced', () => {
  assert.truthy(/const working = !!this\._workProgress/.test(APP_JS_SRC),
    'app.js still gates the rests on the work wheel');
  assert.truthy(someTip(/resting pauses while a work wheel/i), 'and a tip warns about it');
});

test('tips: the first-taste bonus is documented, because it is in the cap', () => {
  const save = { armor: {}, eaten: [] };
  const before = Energy.maxEnergy(save);
  save.eaten = ['potato', 'berry', 'nut'];
  assert.eq(Energy.maxEnergy(save), before + 3, 'each new food tasted is +1 max energy');
  assert.truthy(someTip(/first time raises your maximum energy/i), 'and a tip says so');
});

test('tips: the bare-hand ladder quotes the real TOOL_DURATION_MS ratios', () => {
  const bare = toolDurationMs({}, 'pick');
  assert.eq(bare / TOOL_DURATION_MS[1], 2.25, 'a Wood relic is 2.25× quicker, not 3×');
  assert.eq(bare / TOOL_DURATION_MS[7], 30, 'a Frost one is 30×');
  assert.falsy(/three times quicker/i.test(TIPS_BLOB), 'the old 3× claim is gone');
  assert.truthy(someTip(/twice as quick/i) && someTip(/thirty times/i),
    'the tip quotes both ends of the ladder');
});

test('tips: the slow grind quotes interactables.js\' own two numbers', () => {
  assert.eq(SLOW_GRIND_ENERGY, 15, 'the grind costs 15⚡');
  assert.eq(SLOW_GRIND_MS, 30000, 'and half a minute');
  assert.truthy(someTip(/15⚡ and half a minute/), 'and the tip quotes both');
});

test('tips: reach — the underground trim and the zero-energy floor are documented', () => {
  const scene = { save: { energy: 100, reachUpgrades: 0 }, cellM: 7, depth: 0 };
  const surface = reachCells(scene);
  scene.depth = 2;
  assert.eq(surface - reachCells(scene), 1, 'two levels down costs a whole cell of reach');
  scene.depth = 0; scene.save.energy = 0;
  assert.eq(reachRadiusM(scene), 0, 'and an empty tank reaches nothing');
  assert.truthy(someTip(/zero energy you cannot reach/i), 'a tip says so');
  assert.truthy(someTip(/trims it half a cell/i), 'and a tip says what depth costs');
});

test('tips: the crop clock quotes Crops.STAGE_HOLD_MS and the can\'s jump ladder', () => {
  assert.eq(Crops.STAGE_HOLD_MS, 15 * 60 * 1000, 'a stage is 15 minutes');
  assert.truthy(someTip(/every 15 minutes/i), 'and a tip says so');
  assert.eq(Crops.waterJumpChance({}), 0, 'bare hands never jump a stage');
  assert.eq(Crops.waterJumpChance({ can: { tier: 1 } }), 1 / 7, 'a Wood can jumps one in seven');
  assert.eq(Crops.waterJumpChance({ can: { tier: Crops.CAN_TOP_TIER } }), 1, 'a Frost can jumps every time');
  assert.truthy(someTip(/one watering in seven at Wood, every one at Frost/i),
    'and a tip quotes the whole ladder');
});

test('tips: the shot cadence is the one in combat.js', () => {
  assert.eq(Combat.FIRE_INTERVAL_MS, 2000, 'a bow or staff fires every two seconds');
  assert.falsy(/one shot a second/i.test(TIPS_BLOB), 'no tip still claims one a second');
  assert.truthy(someTip(/one shot every two seconds/i), 'the tip quotes the real cadence');
  assert.eq(Combat.BOLT_MAX_TIER_MUL, 2, 'a Frost bolt is twice a Wood one');
  assert.truthy(someTip(/twice the size of a Wood one/i), 'and a tip says so');
});

test('tips: enemy health is a BAR — no tip calls it a ring again', () => {
  assert.truthy(/_drawEnemyHealthBar/.test(APP_JS_SRC), 'app.js draws a bar');
  assert.falsy(/ring over a foe is its health/i.test(TIPS_BLOB), 'the old ring tip is gone');
  assert.truthy(someTip(/bar over a wounded foe is its health/i), 'and a tip names the bar');
});

test('tips: only one weapon fights, and the Book says which knob picks it', () => {
  assert.truthy(Gear.WEAPON_SLOTS.includes('sword') && Gear.WEAPON_SLOTS.length === 3,
    'sword / bow / staff are the three weapon slots');
  assert.truthy(someTip(/only one weapon fights at a time/i), 'and a tip says so');
});

test('tips: a butterfly and a fish are both takeable bare-handed', () => {
  // The old tip called the Bug Net "the only way" to take a butterfly; the
  // catch path has no tool gate at all, only a longer wheel.
  assert.gt(toolDurationMs({}, 'bugnet'), toolDurationMs({ bugnet: { tier: 1 } }, 'bugnet'),
    'a net only shortens the wheel');
  assert.falsy(/only way to take a butterfly/i.test(TIPS_BLOB), 'the tool-gate claim is gone');
  assert.truthy(someTip(/butterfly can be taken bare-handed/i), 'and a tip says bare hands work');
  assert.truthy(/fish BARE-HANDED/.test(INTERACT_SRC), 'interact.js still allows a bare cast');
});

test('tips: the delivery ladder quotes Delivery.TIER_UNLOCK_EVERY, and no tip rerolls a wishlist', () => {
  assert.eq(Delivery.TIER_UNLOCK_EVERY, 20, 'the produce tier climbs every 20 deliveries');
  assert.truthy(someTip(/every 20 deliveries/i), 'and a tip says so');
  // A pinned wishlist is read back forever — only the SATISFIED flag is daily.
  const save = { restoredHouses: { h1: {} }, houseWishlists: {} };
  const house = { id: 'h1' };
  const first = Delivery.wantedProduce(save, house);
  assert.truthy(first.length, 'a house wants something');
  assert.eq(JSON.stringify(Delivery.wantedProduce(save, { id: 'h1' })), JSON.stringify(first),
    'and it wants the same thing next time it is asked');
  assert.falsy(/wishlists reroll every day/i.test(TIPS_BLOB), 'the reroll claim is gone');
  assert.truthy(someTip(/wishlist never changes/i), 'and a tip says the list is standing');
});

test('tips: the delivery premium quotes DELIVERY_BONUS_MULT', () => {
  const m = APP_JS_SRC.match(/const DELIVERY_BONUS_MULT = ([\d.]+);/);
  assert.truthy(m, 'app.js still owns the premium');
  assert.eq(Number(m[1]), 1.5, 'a set pays half again');
  assert.truthy(someTip(/half again what the set would fetch/i), 'and a tip says so');
});

test('tips: the castle board replaced the three-step chain, and the Book knows', () => {
  assert.eq(QUEST_SLOTS, 3, 'the board holds three jobs');
  assert.truthy(someTip(/board always holds three jobs/i), 'and a tip says so');
  // The stale tip named the old hand-written chain outright.
  assert.falsy(/cull ten slimes/i.test(TIPS_BLOB), 'the dead chain is gone from the tips');
  assert.falsy(/old well/i.test(TIPS_BLOB), 'including its second step');
});

test('tips: the chest rings and the depth step are the ones loot.js applies', () => {
  assert.eq(JSON.stringify(CHEST_TIER_HOME_RINGS_M), JSON.stringify([700, 350]),
    'the Home rings are 700 m and 350 m');
  assert.truthy(someTip(/700m/) && someTip(/350m/), 'and a tip quotes both');
  assert.eq(CHEST_TIER_DEPTH_STEP, 2, 'a chest climbs a tier every two levels down');
  assert.truthy(someTip(/every two levels down/i), 'and a tip says so');
  assert.eq(CHEST_TIER_COLOR[CHEST_TIER_MAX], 0xffc23d, 'the deepest chest wears a gold gem');
  assert.truthy(someTip(/violet and the gold ones/i), 'and the gem tip names both top gems');
});

test('tips: the shop ladder quotes ShopsMath.dealCap', () => {
  assert.eq(ShopsMath.dealCap({ kind: 'house', tier: 11 }), 5, 'a fort takes 5 deals an hour');
  assert.eq(ShopsMath.dealCap({ kind: 'house', tier: 9 }), 1, 'a plain house just 1');
  assert.eq(ShopsMath.dealCap({ kind: 'tower' }), Infinity, 'a tower never waits');
  assert.truthy(someTip(/up to 5 deals per hour, plain houses just 1/i), 'and a tip says so');
});

test('tips: the bag ladder quotes stackCapForBags', () => {
  assert.eq(stackCapForBags(null), 9, 'bare-handed is 9 to a slot');
  assert.eq(stackCapForBags({ tier: 7 }), 249, 'a Frost bag is 249');
  assert.truthy(someTip(/9 bare-handed, 249 at Frost/), 'and a tip quotes both ends');
});

test('tips: the shiny multiplier quotes PRICES', () => {
  assert.eq(PRICES.shiny_chicken, itemValue('chicken') * 10, 'a shiny pays ten times');
  assert.truthy(someTip(/ten times its plain kind/i), 'and a tip says so');
});

test('tips: the sell ladder quotes sellMultiplier', () => {
  assert.eq(sellMultiplier({ sword: { tier: 7 } }) / sellMultiplier({}), 2,
    'a Frost sword doubles the sell price');
  assert.truthy(someTip(/Frost sword doubles/i), 'and a tip says so');
});

test('tips: the coffee buff quotes COFFEE_AMULET_BOOST, on both surfaces that state it', () => {
  const m = APP_JS_SRC.match(/const COFFEE_AMULET_BOOST = (\d+);/);
  assert.truthy(m, 'app.js still owns the boost');
  assert.eq(Number(m[1]), 2, 'a coffee is worth two amulet tiers, not one');
  assert.truthy(someTip(/two extra tiers of amulet/i), 'the tip says two');
  assert.truthy(/\+2 amulet tiers/.test(ITEM_EFFECTS.coffee),
    'and so does the inventory effect line — the two disclosures agree');
});

test('tips: no tip promises a mechanic that is switched OFF', () => {
  // Gather luck (ring/amulet on tree/rock/fruit yields) ships disabled, so the
  // Book must not advertise it — the ring's CHEST effect is the live one.
  assert.falsy(gatherLuckEnabled(), 'gather luck is still off by default');
  assert.falsy(someTip(/\bRing\b[^.]*\b(ore|stone|wood|gem|dig|fell)/i),
    'no tip claims the Ring improves what you dig or fell');
  assert.falsy(someTip(/\bAmulet\b[^.]*\b(ore|stone|wood|bonus)/i),
    'nor that the Amulet pads a gathered stack');
});
