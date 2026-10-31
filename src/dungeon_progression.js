// Saved milestones shared by every dungeon entrance and the arena.
(function (root) {
  'use strict';
  function state(save) {
    if (!save.dungeonProgression || typeof save.dungeonProgression !== 'object' || Array.isArray(save.dungeonProgression)) save.dungeonProgression = {};
    return save.dungeonProgression;
  }
  // THE SEALED SEGMENTS (docs/design/floors.md): descent out of floors 2, 3,
  // 4 and 6 is gated - 2 -> 3 by the elevator, 3 -> 4 by digging, 4 -> 5 by
  // the arena trials' key, 6 -> 7 by the second wizard tower's key. The rope
  // never breaks those seals, and nothing may fall out of those floors either
  // (environment_hazards and hazard_falls read this same table).
  const ROPE_SEALED_FLOORS = Object.freeze([2, 3, 4, 6]);
  function ropeCanDescend(from) {
    return !ROPE_SEALED_FLOORS.includes(from);
  }
  function canEnterDepth(save, depth) {
    const entryKey = depth > 0 && root.WorldGen.floorProfile(depth).entryKey;
    return !entryKey || save?.dungeonProgression?.[entryKey] === true;
  }
  function canUseDescent(save, from, target, source) {
    if (!Number.isInteger(from) || !Number.isInteger(target) || from < 0 || target < 0) return false;
    // Falling is involuntary and cannot be stopped by a locked stair route.
    if (source === 'sinkhole') return target === from + 1 && target !== Arena.DEPTH && from !== Arena.DEPTH;
    if (source === 'elevator') {
      if (!Elevators.isRepaired(save) || !Elevators.FLOORS.includes(from)
          || (target !== 0 && !Elevators.unlockedFloors(save).includes(target))) return false;
    } else if (Math.abs(target - from) !== 1) return false;
    if (source === 'rope' && target > from && !ropeCanDescend(from)) return false;
    return (target <= from || canEnterDepth(save, target)) && !(from === 1 && target > from && source !== 'rope' && source !== 'elevator');
  }
  // Base-tier T2 treasure is counted independently on each floor. Keep the
  // reward table sparse until the other floors' progression items are designed.
  const TREASURE_REQUIRED = 10;
  const TREASURE = Object.freeze({ 1: 'commerce_key', 4: 'portal_stone' });
  function treasureCount(save, depth) {
    const n = save?.dungeonProgression?.treasureCounts?.[depth];
    return Number.isInteger(n) && n > 0 ? n : 0;
  }
  function treasureDue(save, { depth, tier }) {
    const id = TREASURE[depth];
    if (tier !== 2 || !id || treasureCount(save, depth) < TREASURE_REQUIRED - 1) return null;
    if (save?.dungeonProgression?.treasures?.[depth] || Inventory.count(save, id) > 0
        || (id === 'portal_stone' && save?.dungeonProgression?.portalStoneFound)) return null;
    return id;
  }
  function recordTreasure(save, depth, tier) {
    if (!Number.isInteger(depth) || depth < 0 || tier !== 2) return;
    const progress = state(save);
    progress.treasureCounts ||= {};
    progress.treasureCounts[depth] = treasureCount(save, depth) + 1;
    const id = TREASURE[depth];
    if (id && Inventory.count(save, id) > 0) {
      progress.treasures ||= {};
      progress.treasures[depth] = id;
      if (id === 'portal_stone') progress.portalStoneFound = true;
    }
  }
  function completeChallenge(save, id) {
    if (typeof id !== 'string' || !id) return false;
    const progress = state(save);
    progress.challenges = [...new Set((Array.isArray(progress.challenges) ? progress.challenges : []).filter(x => typeof x === 'string' && x))];
    if (progress.challenges.includes(id)) return false;
    progress.challenges.push(id);
    if (progress.challenges.length >= 5) progress.level4Key = true;
    return true;
  }
  root.DungeonProgression = { state, canEnterDepth, canUseDescent, treasureDue, recordTreasure, treasureCount, TREASURE, TREASURE_REQUIRED, completeChallenge,
    ROPE_SEALED_FLOORS, ropeCanDescend };
})(typeof globalThis !== 'undefined' ? globalThis : window);
