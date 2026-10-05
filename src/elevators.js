// Permanent elevator routes are earned independently on each dungeon floor.
(function (root) {
  'use strict';
  const CHESTS_REQUIRED = 10;
  const PARTS_STORY = 'You found the elevator parts for this floor! Now you can return here from home.';
  const dungeonFloor = depth => Number.isInteger(depth) && depth > 0;
  function normalize(save) {
    if (!save.elevators || typeof save.elevators !== 'object' || Array.isArray(save.elevators)) save.elevators = {};
    const state = save.elevators;
    if (!state.chests || typeof state.chests !== 'object' || Array.isArray(state.chests)) state.chests = {};
    for (const key of Object.keys(state.chests)) {
      if (!dungeonFloor(Number(key)) || !Number.isInteger(state.chests[key]) || state.chests[key] < 0) delete state.chests[key];
    }
    state.floors = unlockedFloors(save);
    return state;
  }
  function unlockedFloors(save) {
    const floors = save?.elevators?.floors;
    return Array.isArray(floors) ? [...new Set(floors.filter(dungeonFloor))].sort((a, b) => a - b) : [];
  }
  function partsDue(save, depth, tier) {
    return dungeonFloor(depth) && (tier === 1 || tier === 2)
      && !unlockedFloors(save).includes(depth)
      && (save?.elevators?.chests?.[depth] || 0) >= CHESTS_REQUIRED - 1;
  }
  // The caller owns chest identity and only calls after claiming an unspent chest.
  function recordChest(save, depth, tier) {
    if (!dungeonFloor(depth)) return false;
    const state = normalize(save);
    const unlock = partsDue(save, depth, tier);
    state.chests[depth] = (state.chests[depth] || 0) + 1;
    if (unlock) state.floors.push(depth);
    return unlock;
  }
  root.Elevators = { CHESTS_REQUIRED, PARTS_STORY, normalize, unlockedFloors, partsDue, recordChest };
})(typeof globalThis !== 'undefined' ? globalThis : window);
