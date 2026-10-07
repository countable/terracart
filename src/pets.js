// An animal keeps one identity and one state through capture, carrying and deployment.
(function (root) {
  'use strict';
  const RECOVERY_MS = 60000, REGEN_MS = 30000, COMBAT_REST_MS = 5000;
  const TINTS = Object.freeze([0xffffff, 0xf1dbb5, 0xc5ddf2, 0xd5c2ed, 0xc9e1c2, 0xf1c9c0]);
  const list = save => (save?.released || []).filter(r => r.pet === true);
  const get = (save, value) => list(save).find(r => r.id === (typeof value === 'string' ? value : value?.id));
  const species = kind => String(kind || '').replace(/^shiny_/, '').replace(/^baby_/, '');
  const ownedKind = (save, kind) => list(save).find(r => species(r.kind) === species(kind));
  // The ANIMAL species (per-individual tint, the farm rows). Enemies are not
  // animals, but they are catchable below.
  const eligible = kind => ITEM_BY_ID[species(kind)]?.kind === 'animal' || Object.hasOwn(ANIMAL_FOOD,species(kind));
  // What a wild one can be caught as a pet: an animal, or any ENEMY — except
  // a story's own foe (a story-encounter archer, a roster row with a
  // storyReward), whose defeat moves the story on.
  const catchable = c => {
    if (!c || c.storyEncounter) return false;
    const row = typeof EnemyRoster !== 'undefined' ? EnemyRoster.get(species(c.kind)) : null;
    return row ? !row.storyReward : eligible(c.kind);
  };
  // Does it accept this item? Its favourite (items.js favouriteItems).
  const likes = (c, itemId) => !!c && !!itemId && animalLikesFood(species(c.kind), itemId);
  // GIVING the favourite starts the catch; nothing is prepared beforehand.
  const canCatch = (save, c) => catchable(c) && !c.pet && !ownedKind(save, c.kind);
  // THE CATCH'S DIFFICULTY is the creature's CURRENT HP times two, worn down
  // at the net's tool rate (Combat.dpsForDurationMs of its toolDurationMs —
  // the rate a weapon of that tier deals damage). A hurt foe, a better net:
  // a shorter catch. Shiny and elite pools are doubled in their HP already.
  function catchMs(save, c) {
    const difficulty = 2 * Combat.hp(c);
    return difficulty / Combat.dpsForDurationMs(toolDurationMs(save?.relics, 'net')) * 1000;
  }
  function tintFor(c) {
    if (Number.isFinite(c.tint)) return c.tint;
    let h = 2166136261;
    for (const ch of String(c.id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return TINTS[(h >>> 0) % TINTS.length];
  }
  function stats(c, now = Date.now()) {
    const result = { maxHp:0, armor:0, attack:0, regen:0 };
    const sources = [c?.bonuses || {}, ...Object.values(c?.accessories || {}).map(id => ITEM_BY_ID[id]?.petAccessory?.stats || {}),
      ...(c?.effects || []).filter(e => e.until > now).map(e => e.stats || {})];
    for (const source of sources) for (const key of Object.keys(result)) result[key] += Number(source[key]) || 0;
    return result;
  }
  function bond(save, c, options = {}) {
    if (!canCatch(save, c)) return false;
    const sourceId = c.id, id = sourceId.startsWith('pet_') ? sourceId : `pet_${sourceId}`;
    const row = { id, sourceId:c.sourceId || sourceId, kind:species(c.kind), pet:true, carried:options.carried !== false,
      x:c.x, y:c.y, tx:c.tx, ty:c.ty, stayHome:false, shiny:!!c.shiny, tint:tintFor(c),
      raised:!!c.raised, born:c.born, favouriteFeeds:c.favouriteFeeds || 1,
      hp:Combat.hp(c), lastDamagedAt:c._lastDamagedT || null, recoverUntil:0, regenAt:Date.now(),
      accessories:{}, bonuses:{...(c.bonuses || {})}, effects:[...(c.effects || [])] };
    if (save.potionEffects?.[sourceId]) {
      save.potionEffects[id] = save.potionEffects[sourceId];
      if (id !== sourceId) delete save.potionEffects[sourceId];
      Object.assign(row,save.potionEffects[id]);
    }
    (save.released ||= []).push(row);
    if (sourceId !== id && !(save.caught ||= []).includes(sourceId)) save.caught.push(sourceId);
    removeLive(sourceId);
    save.wildAnimals = (save.wildAnimals || []).filter(r => r.id !== sourceId);
    return row;
  }
  function sync(row, c) {
    Object.assign(c, {pet:true, tint:row.tint, accessories:row.accessories, bonuses:row.bonuses,
      effects:row.effects, raised:row.raised, born:row.born, shiny:row.shiny, favouriteFeeds:row.favouriteFeeds,
      recoverUntil:row.recoverUntil, regenAt:row.regenAt, _hp:row.hp,
      _lastDamagedT:row.lastDamagedAt ?? null, carried:row.carried});
  }
  function publish(row) {
    if (typeof WorldGen === 'undefined') return;
    for (const tile of WorldGen.tileCache.values()) for (const c of tile.creatures || []) if (c.id === row.id) sync(row,c);
  }
  function removeLive(id) {
    if (typeof WorldGen === 'undefined') return;
    for (const tile of WorldGen.tileCache.values()) if (tile.creatures) tile.creatures = tile.creatures.filter(c => c.id !== id);
  }
  function carry(save, c) {
    const row = get(save, c); if (!row) return false;
    tick(save,row);
    if (c !== row && typeof c === 'object' && Number.isFinite(c._hp)) row.hp = c._hp;
    row.carried = true; removeLive(row.id); return row;
  }
  function deploy(save, id, position) {
    const row = get(save,id); if (!row) return false;
    Object.assign(row, position, {carried:false}); return row;
  }
  function equip(save,id,itemId) {
    const row = get(save,id), item = ITEM_BY_ID[itemId]?.petAccessory;
    if (!row || !item || Inventory.count(save,itemId) < 1) return false;
    tick(save,row);
    const old = row.accessories?.[item.slot];
    if (old === itemId || (old && Inventory.roomFor(save,old) < 1)) return false;
    Inventory.remove(save,itemId,1);
    if (old) Inventory.add(save,old,1);
    (row.accessories ||= {})[item.slot] = itemId;
    row.hp = Math.min(row.hp,Combat.maxHp(row)); publish(row); return true;
  }
  function unequip(save,id,slot) {
    const row = get(save,id), item = row?.accessories?.[slot];
    if (!item || Inventory.roomFor(save,item) < 1) return false;
    tick(save,row);
    Inventory.add(save,item,1); delete row.accessories[slot];
    row.hp = Math.min(row.hp,Combat.maxHp(row)); publish(row); return true;
  }
  function release(save,id) {
    const row = get(save,id); if (!row) return false;
    tick(save,row);
    if (isDown(row)) return false;
    const items = Object.values(row.accessories || {}), counts = {};
    for (const item of items) counts[item] = (counts[item] || 0) + 1;
    if (Object.entries(counts).some(([item,n]) => Inventory.roomFor(save,item) < n)) return false;
    for (const item of items) Inventory.add(save,item,1);
    save.released = save.released.filter(r => r !== row);
    (save.wildAnimals ||= []).push({...row, pet:false, carried:false, accessories:{}});
    save.caught = (save.caught || []).filter(value => value !== row.id);
    removeLive(row.id); return true;
  }
  const isDown = (c, wall = Date.now()) => !!c?.pet && c.recoverUntil > wall;
  function knockedOut(save,c,wall = Date.now()) {
    const row = get(save,c); if (!row) return false;
    row.hp = 0; row.recoverUntil = Math.max(row.recoverUntil || 0,wall + RECOVERY_MS);
    row.regenAt = row.recoverUntil; row.lastDamagedAt = wall;
    sync(row,c); c._chaseTarget = null; c._moving = false; return true;
  }
  function feed(save,c,food) {
    const row = get(save,c);
    if (!row || !animalLikesFood(row.kind,food)) return false;
    row.favouriteFeeds = (row.favouriteFeeds || 0) + 1;
    row.hp = Combat.maxHp(row); row.regenAt = Date.now();
    if (c && typeof c === 'object' && c !== row) { sync(row,c); c.favouriteFeeds = row.favouriteFeeds; }
    publish(row);
    return true;
  }
  function tick(save, c, wall = Date.now()) {
    let changed = false;
    const rows = c ? [get(save,c)].filter(Boolean) : list(save);
    for (const row of rows) {
      if (c === row && !row.carried && typeof WorldGen !== 'undefined') {
        for (const tile of WorldGen.tileCache.values()) {
          const live = tile.creatures?.find(actor => actor.id === row.id && actor.pet);
          if (live) { c = live; break; }
        }
      }
      if (save.potionEffects?.[row.id]) Object.assign(row,save.potionEffects[row.id]);
      if (c && c !== row && Number.isFinite(c._hp)) {
        if (row.hp !== c._hp || row.lastDamagedAt !== (c._lastDamagedT || null)) changed = true;
        row.hp = c._hp; row.lastDamagedAt = c._lastDamagedT || null;
      }
      if (row.recoverUntil) {
        if (wall >= row.recoverUntil) { row.hp = Math.max(1,row.hp); row.regenAt = wall; row.recoverUntil = 0; changed = true; }
      } else {
        const since = Math.max(row.regenAt || wall, (row.lastDamagedAt || 0) + COMBAT_REST_MS);
        const steps = Math.floor((wall - since) / REGEN_MS);
        if (steps > 0) { row.hp = Math.min(Combat.maxHp(row), row.hp + steps * Math.max(0,1 + stats(row,wall).regen)); row.regenAt = since + steps * REGEN_MS; changed = true; }
      }
      if (c && c !== row) sync(row,c);
    }
    return changed;
  }
  root.Pets = { RECOVERY_MS, REGEN_MS, COMBAT_REST_MS, TINTS, list,get,species,ownedKind,eligible,catchable,likes,canCatch,catchMs,tintFor,
    bond,carry,deploy,equip,unequip,release,feed,tick,stats,isDown,knockedOut,sync };
})(typeof window !== 'undefined' ? window : globalThis);
