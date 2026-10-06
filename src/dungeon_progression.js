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
    return depth < 5 || save?.dungeonProgression?.level4Key === true;
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
  // The stone rides the first GOOD chest far from home on floor 4: the depth
  // bonus there lifts every chest to effective T3, so the bar is T4 or better
  // (the same not-the-first-junk-chest intent the T3 bar served on floor 3).
  function portalStoneDue(save, { depth, tier, distanceM }) {
    return !save?.dungeonProgression?.portalStoneFound && depth === 4 && tier >= 4 && Number.isFinite(distanceM) && distanceM >= 1000;
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
  root.DungeonProgression = { state, canEnterDepth, canUseDescent, portalStoneDue, completeChallenge,
    ROPE_SEALED_FLOORS, ropeCanDescend };
})(typeof globalThis !== 'undefined' ? globalThis : window);
