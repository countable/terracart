// Saved milestones shared by every dungeon entrance and the arena.
(function (root) {
  'use strict';
  function state(save) {
    if (!save.dungeonProgression || typeof save.dungeonProgression !== 'object' || Array.isArray(save.dungeonProgression)) save.dungeonProgression = {};
    return save.dungeonProgression;
  }
  function canEnterDepth(save, depth) {
    return depth < 4 || save?.dungeonProgression?.level4Key === true;
  }
  function canUseDescent(save, from, target, source) {
    if (!Number.isInteger(from) || !Number.isInteger(target) || from < 0 || target < 0) return false;
    if (source === 'elevator') {
      if (save?.elevators?.repaired !== true || !Elevators.FLOORS.includes(from) || !Elevators.FLOORS.includes(target)) return false;
    } else if (Math.abs(target - from) !== 1) return false;
    return (target <= from || canEnterDepth(save, target)) && !(from === 1 && target > from && source !== 'rope' && source !== 'elevator');
  }
  function portalStoneDue(save, { depth, tier, distanceM }) {
    return !save?.dungeonProgression?.portalStoneFound && depth === 3 && tier >= 3 && Number.isFinite(distanceM) && distanceM >= 1000;
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
  root.DungeonProgression = { state, canEnterDepth, canUseDescent, portalStoneDue, completeChallenge };
})(typeof globalThis !== 'undefined' ? globalThis : window);
