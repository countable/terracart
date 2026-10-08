// THE FAVOURITE CATCH (owner, Oct 2026). Every animal AND enemy has one
// favourite (items.js favouriteItems): an animal's ANIMAL_FOOD row, else an
// enemy's roster-tier gem (gemForTier over GEM_DEPOSITS), an ANIMAL_FOOD row on
// an enemy kind overriding (the slimes' sapphire). Giving a wild one its
// favourite starts the catch at once — one favourite spent, the net wheel run
// for Pets.catchMs (2 × current HP at the net's tool rate) — and during the
// attempt it is nobody's enemy (Combat.isEnemy: _beingCaught). Anything else
// is refused and kept. The hunt (deer/crow, empty hand, weapon active) is not
// a catch.
(function () {
const handler = () => TAP_HANDLERS.find(h => h.name === 'creature');

// Tap `c` holding `heldId` (null = empty hand) on a stub scene that records the
// catch and hunt wheels. Inventory is the REAL bag (Inventory.count).
function tapCreature(c, save, heldId, over = {}) {
  save.inv = save.inv || [];
  if (heldId) { Inventory.add(save, heldId, 1); save.selSlot = save.inv.findIndex(s => s && s.id === heldId); }
  else save.selSlot = -1;
  const rec = { catches: [], hunts: [], flashes: [], spends: 0, caught: [] };
  const scene = Object.assign(makeScene(), {
    save, cellM: 5, cellPx: 32, cellsPerTile: 32, mPerPx: 5 / (WorldGen.TILE_PX / 32), originPx: { x: 0, y: 0 },
    startWorldM: { x: 0, y: 0 }, playerM: { x: 2.5, y: 2.5 }, feetOffsetM: 0, depth: 0, tileEdgeM: 1000,
    _starterTrailAnchor: () => ({ x: 10000, y: 10000 }),
    playerToWorldCell: () => ({ tx: 0, ty: 0 }), buildInventoryDOM: () => {}, _toolActionStory: () => {},
    addToInv: (id, n = 1) => Inventory.add(save, id, n).accepted,
    spendEnergy: () => { rec.spends++; return true; },
    flash: (text) => rec.flashes.push(text),
    startCatchProgress: (victim, ms, done, fail, tool, cost) => rec.catches.push({ victim, ms, done, fail, tool, cost }),
    startWorkProgress: (x, y, done, ms, _r, tool, victim) => rec.hunts.push({ ms, tool, victim }),
    catchCreature: (victim) => { rec.caught.push(victim.id); Pets.bond(save, victim); },
    resolveDefeat: () => {},
  }, over);
  const original = globalThis.WorldGen, originalReach = globalThis.cellInReach;
  try {
    globalThis.cellInReach = () => true;
    globalThis.WorldGen = { ...original, forEachItem: (layer, cb) => { if (layer === 'creatures') cb(c); } };
    rec.result = handler().try({ scene, save, wm: { x: c.x, y: c.y }, sx: 0, sy: 0 });
    return rec;
  } finally { globalThis.WorldGen = original; globalThis.cellInReach = originalReach; }
}
const newSave = (extra = {}) => ({ inv: [], caught: [], released: [], selSlot: -1, relics: {}, ...extra });
const foe = (kind, extra = {}) => ({ id: `wild_${kind}`, kind, x: 2.5, y: 2.5, _disguiseRevealed: true, ...extra });

test('favourite: every live roster enemy has one — its tier gem, unless an ANIMAL_FOOD row overrides', () => {
  const gems = { 1: 'quartz', 2: 'topaz', 3: 'amethyst', 4: 'sapphire', 5: 'ruby', 6: 'emerald', 7: 'diamond' };
  for (const [t, gem] of Object.entries(gems)) assert.eq(gemForTier(Number(t)), gem, `tier ${t}`);
  let rows = 0;
  for (const row of EnemyRoster.ROWS) {
    if (row.retired) continue;
    const fav = favouriteItems(row.id);
    assert.eq(fav.length > 0, true, `${row.id} has a favourite`);
    const want = favouriteOverride(row.id) || [gemForTier(row.tier)];
    assert.eq(fav.join(), want.join(), `${row.id} (tier ${row.tier})`);
    assert.truthy(animalLikesFood(row.id, fav[0]), `${row.id} likes it`);
    rows++;
  }
  assert.gt(rows, 30, 'the roster was walked');
  // Spot checks.
  const tier1 = EnemyRoster.ROWS.find(r => !r.retired && r.tier === 1 && !favouriteOverride(r.id));
  assert.truthy(tier1, 'a tier-1 enemy with no food row');
  assert.eq(favouriteItems(tier1.id).join(), 'quartz', tier1.id);
  assert.eq(EnemyRoster.get('goblin').tier, 3); assert.eq(favouriteItems('goblin').join(), 'amethyst');
  const tier7 = EnemyRoster.ROWS.find(r => !r.retired && r.tier === 7 && !favouriteOverride(r.id));
  assert.eq(favouriteItems(tier7.id).join(), 'diamond', tier7.id);
  assert.eq(EnemyRoster.get('slime').tier, 1);
  assert.eq(favouriteItems('slime').join(), 'sapphire', 'the slime keeps its sapphire, not the tier-1 quartz');
  assert.truthy(Pets.likes({ kind: 'goblin' }, 'amethyst')); assert.falsy(Pets.likes({ kind: 'goblin' }, 'quartz'));
});

test('favourite: a catch takes 2 × current HP at the net\'s rate', () => {
  const save = newSave();
  const g = foe('goblin');
  const full = Pets.catchMs(save, g);
  const netRate = Combat.dpsForDurationMs(toolDurationMs(save.relics, 'net'));
  assert.inRange(full, 2 * Combat.maxHp(g) / netRate * 1000 - 1e-6, 2 * Combat.maxHp(g) / netRate * 1000 + 1e-6, 'HP × 2 at the net rate');
  const hurt = { ...g, _hp: Combat.maxHp(g) / 2 };
  assert.inRange(Pets.catchMs(save, hurt), full / 2 - 1e-6, full / 2 + 1e-6, 'half the HP: half the time');
  const better = Pets.catchMs(newSave({ relics: { net: { tier: 5 } } }), foe('goblin'));
  assert.lt(better, full, 'a better net shortens it');
});

test('favourite: an enemy given its gem starts the catch — the gem spent, the wheel at Pets.catchMs', () => {
  const save = newSave(), g = foe('goblin');
  Inventory.add(save, 'amethyst', 1);
  const rec = tapCreature(g, save, 'amethyst');
  assert.eq(rec.result, true);
  assert.eq(Inventory.count(save, 'amethyst'), 1, 'exactly one gem given');
  assert.eq(rec.catches.length, 1, 'no confirm: the wheel starts');
  assert.eq(rec.spends, 1);
  const w = rec.catches[0];
  assert.eq(w.victim, g); assert.eq(w.tool, 'net'); assert.eq(w.ms, Pets.catchMs(save, g));
  assert.eq(Pets.list(save).length, 0, 'not caught until the wheel completes');
  w.done();
  assert.eq(rec.caught.join(), g.id);
  assert.truthy(Pets.ownedKind(save, 'goblin'), 'a goblin pet');
});

test('favourite: the Potion of Taming is every creature\'s favourite — it starts any catch, and feeds a pet', () => {
  for (const row of EnemyRoster.ROWS.filter(r => !r.retired)) assert.truthy(animalLikesFood(row.id, 'taming_potion'), row.id);
  for (const kind of ['chicken', 'cow', 'cat', 'dog', 'crab']) assert.truthy(animalLikesFood(kind, 'taming_potion'), kind);
  assert.falsy(animalLikesFood('npc', 'taming_potion'), 'a kind with no favourite takes none');
  assert.eq(favouriteItems('goblin').join(), 'amethyst', 'the tap still names the kind\'s own favourite');
  const save = newSave(), g = foe('goblin');
  const rec = tapCreature(g, save, 'taming_potion');
  assert.eq(rec.catches.length, 1, 'the wheel starts');
  assert.eq(Inventory.count(save, 'taming_potion'), 0, 'the potion is given');
  rec.catches[0].done();
  assert.truthy(Pets.ownedKind(save, 'goblin'));
});

test('favourite: thrown, the Potion of Taming charms a foe for a minute instead', () => {
  const scene = { save: { energy: 100, caught: [] }, cellM: 10, startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 } };
  const now = Date.now(), g = foe('goblin', { _hp: 30 });
  assert.truthy(PotionEffects.apply(scene, g, 'taming_potion', now));
  assert.truthy(Combat.isCharmed(g, now + 59000), 'charmed for the minute');
  assert.falsy(Combat.isCharmed(g, now + 61000), 'and then it wears off');
  assert.falsy(Combat.isEnemy(g), 'no one\'s enemy while charmed');
  assert.falsy(Pets.ownedKind(scene.save, 'goblin'), 'a charm is not a catch');
});

test('favourite: a wrong gem is refused and kept, and the tap names what it loves', () => {
  const save = newSave(), g = foe('goblin');
  const rec = tapCreature(g, save, 'quartz');
  assert.eq(Inventory.count(save, 'quartz'), 1, 'kept');
  assert.eq(rec.catches.length, 0); assert.eq(rec.spends, 0);
  assert.eq(rec.flashes[0], 'Goblin\nLoves Amethyst');
});

test('favourite: a story foe is not catchable — its gem is kept and no wheel starts', () => {
  const g = foe('goblin', { storyEncounter: 'story_key' });
  assert.falsy(Pets.catchable(g)); assert.falsy(Pets.canCatch(newSave(), g));
  const save = newSave();
  const rec = tapCreature(g, save, 'amethyst');
  assert.eq(rec.catches.length, 0); assert.eq(Inventory.count(save, 'amethyst'), 1);
  assert.eq(rec.flashes[0], 'Goblin', 'its name, no hint');
  const demon = EnemyRoster.ROWS.find(r => r.storyReward);
  assert.truthy(demon, 'a storyReward row exists');
  assert.falsy(Pets.catchable(foe(demon.id)), `${demon.id}: a story's own foe`);
});

test('favourite: mid-catch the creature is nobody\'s enemy', () => {
  const g = foe('goblin');
  assert.truthy(Combat.isEnemy(g));
  g._beingCaught = true;
  assert.falsy(Combat.isEnemy(g), 'no shot, pet or blast takes it');
  g._beingCaught = false;
  assert.truthy(Combat.isEnemy(g), 'a failed attempt leaves a foe');
});

test('favourite: a fleeing catch target runs no faster than its roster walk — a rooted plant stays put', () => {
  assert.eq(EnemyRoster.get('plant').movement.speedMetersPerSecond, 0, 'the plant is rooted');
  // app.js startCatchProgress' flee step (the shipping text; the scene does not load headless).
  const flee = SCENE_SRC.slice(SCENE_SRC.indexOf('    if (wp.flee) {'));
  assert.truthy(/const roster = EnemyRoster\.get\(c\.kind\);\n\s*const top = roster \? \(roster\.movement\?\.speedMetersPerSecond \?\? 0\) : SpriteLayout\.creatureMaxMps\(c\.kind\);\n\s*const FLEE_MPS = Math\.min\(isButterfly \? 5\.4 : 2, top\) \* shinyFast;/.test(flee),
    'the flee speed is capped by the roster walk (0 for a plant)');
});

test('favourite: a hunt (deer, empty hand, weapon active) starts the hunt wheel, not a catch', () => {
  const save = newSave({ activeWeapon: 'sword', boonUntil: {} });
  assert.truthy(Gear.activeWeapon(save), 'a weapon is active');
  const deer = { id: 'wild_deer', kind: 'deer', x: 2.5, y: 2.5 };
  const rec = tapCreature(deer, save, null);
  assert.eq(rec.hunts.length, 1, 'the hunt wheel');
  assert.eq(rec.hunts[0].tool, 'net'); assert.eq(rec.hunts[0].victim, deer);
  assert.eq(rec.catches.length, 0, 'not a catch');
  // Its favourite in hand instead: a catch, not a hunt.
  const save2 = newSave({ activeWeapon: 'sword', boonUntil: {} });
  const deer2 = { id: 'wild_deer_2', kind: 'deer', x: 2.5, y: 2.5 };
  const fav = favouriteItems('deer')[0];
  const rec2 = tapCreature(deer2, save2, fav);
  assert.eq(rec2.hunts.length, 0); assert.eq(rec2.catches.length, 1);
  assert.eq(Inventory.count(save2, fav), 0, 'the favourite is given');
});
})();
