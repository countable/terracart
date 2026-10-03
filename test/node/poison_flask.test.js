// THE POISON FLASK — the purple slime's minute of poison, bottled.
//
// Thrown (the potion lane: PotionEffects.apply → Combat.poison) it lands the
// `poison` row of Conditions.DEFINITIONS on whatever it strikes: the row's
// bite every intervalMs off the creature's HP for the row's minute
// (Combat.poisonTick, levied by SceneFire._tickUnitPoison through the burn's
// damage dispatch, asked wherever the burn is). Drunk (drinkPoisonFlask) it
// is the player's own poison. One row, two bodies, no number of its own.
(function () {
const ID = 'poison_flask';
const def = Conditions.DEFINITIONS.poison;
const app = SCENE_SRC;
function sceneFire() {
  return Object.assign(new SceneFire(), { cellM: 7, tileEdgeM: 224, startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 },
    mPerPx: 7, cellsPerTile: WorldGen.TILE_PX, depth: 2, save: { energy: 100, caught: [], armor: {} },
    cellAt: () => ({ loaded: true, type: WorldGen.T.CAVE_FLOOR }),
    _cellBlocked: () => false, _nearAny: () => false, isUnnoticed: () => false, _shots: [], hits: [], pops: [],
    _popDamageNumber(c, n) { this.pops.push(n); },
    _damageEnemy(c, n, source, opts) { this.hits.push({ id: c.id, n, source }); Combat.damage(c, n, opts); return Combat.hp(c) <= 0; } });
}

test('poison flask: a T2 potion, thrown or drunk, whose minute is the poison row\'s', () => {
  const it = ITEM_BY_ID[ID];
  assert.truthy(it, 'registered'); assert.eq(it.kind, 'magic'); assert.truthy(it.potion, 'thrown through the potion lane');
  assert.truthy(isPotion(ID));
  assert.eq(it.baseTier, 2); assert.gt(PRICES[ID], 0); assert.lt(PRICES[ID], PRICES.explosive_flask);
  assert.truthy(ITEM_EFFECTS[ID]);
  const src = MINERAL_ICON_SHEET[ID];
  assert.eq(src.sheet, 'icon_potions'); assert.eq(src.frame, 23);
  assert.falsy(Object.entries(MINERAL_ICON_SHEET).some(([id, r]) => id !== ID && r.sheet === src.sheet && r.frame === src.frame), 'its own frame');
  const row = CONSUMABLE_SPEC[ID];
  assert.eq(row.verb, 'Drink'); assert.eq(row.method, 'drinkPoisonFlask');
  assert.eq(row.durationMs, def.durationMs, 'the row\'s minute, never a number of its own');
  assert.eq(def.durationMs, 60_000);
  const pool = ChestThemes.resolve('combatMagic', 2, { theme: 'authority' });
  assert.includes(ChestThemes.selectableIds(pool), ID, 'a combat-magic chest can hold it');
  assert.includes(Shops.themedStock('potion', 2), ID, 'the T2 magic shop stocks it');
});

test('poison flask: Combat.poison is the player\'s row on a creature — the same bite, the same minute', () => {
  const c = { id: 'g', kind: 'goblin', x: 0, y: 0 };
  assert.falsy(Combat.poisoned(c, 1000));
  assert.truthy(Combat.poison(c, 1000, 'player'), 'fresh');
  assert.truthy(Combat.poisoned(c, 1000));
  assert.eq(c._statusPop?.label, def.label, 'announces itself in the row\'s word');
  assert.eq(c._statusPop?.color, def.ink);
  assert.eq(Combat.poisonTick(c, 1000 + def.intervalMs - 1), 0, 'the first bite waits its interval');
  assert.eq(Combat.poisonTick(c, 1000 + def.intervalMs), def.energyLoss);
  // A delayed frame pays exactly the bites it covers; the minute ends on the last.
  assert.eq(Combat.poisonTick(c, 1000 + def.durationMs), def.energyLoss * (def.durationMs / def.intervalMs - 1));
  assert.falsy(Combat.poisoned(c, 1000 + def.durationMs), 'and it is over');
  assert.eq(c._poisonState, undefined); assert.eq(c._poisonBy, null);
  assert.eq(Combat.poisonTick(c, 2000 + def.durationMs), 0, 'nothing after');
  // A refresh runs the minute again without postponing the bite already due.
  Combat.poison(c, 5000, 'player');
  c._statusPop = null;
  Combat.poisonTick(c, 6500);
  assert.falsy(Combat.poison(c, 6500, 'player'), 'not fresh');
  assert.eq(c._statusPop, null, 'no second word while it runs');
  assert.eq(c._poisonState.remainingMs, def.durationMs);
  assert.eq(Combat.poisonTick(c, 7000), def.energyLoss, 'the bite lands on its old boundary');
  // No wound can reach an immortal body: the clock runs, the bite costs nothing.
  const i = { id: 'i', kind: 'goblin', immortalPotionUntil: Date.now() + 100000 };
  Combat.poison(i, 1000);
  assert.eq(Combat.poisonTick(i, 1000 + def.intervalMs * 3), 0);
  assert.eq(i._poisonState.remainingMs, def.durationMs - def.intervalMs * 3);
  // A thrown Antidote (or Elixir, or Time) clears it with the other debuffs.
  PotionEffects.clearDebuffs(c);
  assert.falsy(Combat.poisoned(c, 7000)); assert.eq(c._poisonBy, null);
});

test('poison flask: thrown, it poisons the struck creature; a thrown Antidote cures it', () => {
  const scene = { save: { energy: 100, caught: [] }, cellM: 10, startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 } };
  const c = { id: 'struck', kind: 'goblin', x: 0, y: 0 };
  assert.truthy(PotionEffects.apply(scene, c, ID));
  assert.truthy(Combat.poisoned(c)); assert.eq(c._poisonBy, 'player', 'the player\'s flask: a player kill');
  assert.truthy(PotionEffects.apply(scene, c, 'antidote'));
  assert.falsy(Combat.poisoned(c));
  const p = { id: 'released_pet', kind: 'slime', x: 0, y: 0 };
  assert.truthy(PotionEffects.apply(scene, p, ID), 'a careless throw poisons a pet too — it is a thrown potion');
  assert.truthy(Combat.poisoned(p));
});

test('poison flask: the scene levies the bite through the burn\'s dispatch, asked beside the burn', () => {
  const s = sceneFire();
  const foe = { id: 'foe', kind: 'goblin', x: 0, y: 0 };
  Combat.poison(foe, 1000, 'player');
  assert.falsy(s._tickUnitPoison(foe, 1000 + def.intervalMs - 1));
  assert.eq(s.hits.length, 0);
  assert.falsy(s._tickUnitPoison(foe, 1000 + def.intervalMs));
  assert.eq(s.hits.length, 1); assert.eq(s.hits[0].n, def.energyLoss); assert.eq(s.hits[0].source, 'player', 'the player\'s poison pays its bounty');
  assert.falsy(s._tickUnitPoison(foe, 1000 + def.intervalMs), 'once per frame');
  assert.eq(s.hits.length, 1);
  foe._hp = 1;
  assert.truthy(s._tickUnitPoison(foe, 1000 + def.intervalMs * 2), 'the bite that kills says so');
  // A poisoned pet is worried down and retreats; an NPC rests.
  const pet = { id: 'released_dog', kind: 'dog', x: 0, y: 0 };
  Combat.poison(pet, 1000, 'player');
  s._tickUnitPoison(pet, 1000 + def.intervalMs);
  assert.eq(s.pops[0], def.energyLoss, 'a pet\'s hurt pops like any other');
  assert.eq(s.hits.length, 2, 'not through the enemy lane');
  const npc = { id: 'npc_1', kind: 'npc', x: 0, y: 0 };
  const npcHp = Combat.hp(npc);
  Combat.poison(npc, 1000, 'player');
  s._tickUnitPoison(npc, 1000 + def.intervalMs);
  assert.eq(Combat.hp(npc), npcHp - def.energyLoss, 'a neighbour is bitten through NPC.hit');
  assert.eq(s.hits.length, 2, 'not through the enemy lane');
  const caught = { id: 'bagged', kind: 'goblin', x: 0, y: 0 };
  Combat.poison(caught, 1000); s.save.caught.push('bagged');
  assert.falsy(s._tickUnitPoison(caught, 1000 + def.intervalMs)); assert.eq(s.hits.length, 2, 'nothing in the bag is bitten');
  // Asked wherever the burn is asked, right after it.
  assert.truthy(/if \(this\._tickUnitFire\?\.\(c, now\)\) return;\s*\n\s*if \(this\._tickUnitPoison\?\.\(c, now\)\) return;/.test(app), 'wanderCreatures');
  assert.truthy(/if \(scene\._tickUnitFire\?\.\(c, now\)\) return true;\s*\n\s*if \(scene\._tickUnitPoison\?\.\(c, now\)\) return true;/.test(CREATURE_AI_SRC), 'the flower tick (a sleeper, an ally)');
  assert.truthy(/const poisoned = !frozen && !afire && Combat\.poisoned\(c, performance\.now\(\)\);/.test(RENDER_SRC), 'the body wears the row\'s tint');
});

test('poison flask: drunk, it is the player\'s own poison, and the flask is spent either way', () => {
  const match = app.match(/\n  drinkPoisonFlask\(\) \{\n([\s\S]*?)\n  \}\n/);
  assert.truthy(match, 'drinkPoisonFlask exists');
  const drink = new Function('getSelectedSlot', 'CONSUMABLE_SPEC', match[1]);
  const applied = [];
  const s = { save: { energy: 100, inv: [{ id: ID, count: 2 }], selSlot: 0 }, consumed: 0,
    _applyCondition(id) { applied.push(id); Conditions.apply(this.save, id); },
    _selectedConsumable(id) { const sel = this.save.inv[0]; return sel && sel.id === id && sel.count > 0 ? sel : null; },
    _finishConsumable() { this.consumed++; return true; } };
  const call = () => drink.call(s, save => save.inv[save.selSlot], CONSUMABLE_SPEC);
  assert.truthy(call());
  assert.eq(applied.join(','), 'poison', 'through _applyCondition — the lesson and the announcement ride along');
  assert.truthy(Conditions.active(s.save, 'poison')); assert.eq(s.consumed, 1);
  assert.eq(s.save.conditions.poison.remainingMs, def.durationMs);
  Conditions.tick(s.save, 30_000);
  assert.truthy(call(), 'already poisoned: still drunk');
  assert.eq(s.save.conditions.poison.remainingMs, def.durationMs, 'refreshed to the full minute');
  assert.eq(s.consumed, 2);
  s.save.inv[0].count = 0;
  assert.falsy(call()); assert.eq(s.consumed, 2);
  s.save.inv[0] = { id: 'wood', count: 1 };
  assert.falsy(call());
});
})();
