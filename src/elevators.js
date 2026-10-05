// Home lift repair and floor-local route parts share one saved state.
(function (root) {
  'use strict';
  const REPAIR_COST = Object.freeze({ wood: 9, rubble: 9 });
  const FLOORS = Object.freeze([0, 1, 2, 3]);
  const CHESTS_REQUIRED = 10;
  const PARTS_STORY = 'You found the elevator parts for this floor! Now you can return here from home.';
  const dungeonFloor = depth => Number.isInteger(depth) && depth > 0;

  function isRepaired(save) { return save?.elevators?.repaired === true; }
  function hasParts(save) { return save?.elevators?.partsFound === true; }
  function normalize(save) {
    if (!save.elevators || typeof save.elevators !== 'object' || Array.isArray(save.elevators)) save.elevators = {};
    const state = save.elevators;
    if (!state.chests || typeof state.chests !== 'object' || Array.isArray(state.chests)) state.chests = {};
    for (const key of Object.keys(state.chests)) {
      if (!dungeonFloor(Number(key)) || !Number.isInteger(state.chests[key]) || state.chests[key] < 0) delete state.chests[key];
    }
    if (!Array.isArray(state.floors)) state.floors = [];
    state.floors = [...new Set(state.floors.filter(dungeonFloor))].sort((a, b) => a - b);
    return state;
  }
  function unlockedFloors(save) {
    const local = Array.isArray(save?.elevators?.floors) ? save.elevators.floors.filter(dungeonFloor) : [];
    const repaired = isRepaired(save) ? (hasParts(save) ? FLOORS.filter(depth => depth > 0) : [1]) : [];
    return [...new Set([...local, ...repaired])].sort((a, b) => a - b);
  }
  // With no floor argument this is the original L1 repair-parts lane. With a
  // floor and quota tier it is the independent permanent route for that floor.
  function partsDue(save, depth, tier) {
    if (depth == null) return !hasParts(save) && (save?.elevators?.level1Chests || 0) >= CHESTS_REQUIRED - 1;
    return dungeonFloor(depth) && (tier === 1 || tier === 2)
      && !unlockedFloors(save).includes(depth)
      && (save?.elevators?.chests?.[depth] || 0) >= CHESTS_REQUIRED - 1;
  }
  function recordChest(save, depth, tier) {
    if (depth != null && !dungeonFloor(depth)) return false;
    const state = normalize(save);
    if (depth == null) {
      const found = partsDue(save);
      state.level1Chests = (state.level1Chests || 0) + 1;
      if (found) state.partsFound = true;
      return found;
    }
    const found = partsDue(save, depth, tier);
    state.chests[depth] = (state.chests[depth] || 0) + 1;
    if (found) state.floors.push(depth);
    // Level-one opens continue to feed the repaired lift's deeper-stop lane.
    if (depth === 1) {
      const legacyFound = partsDue(save);
      state.level1Chests = (state.level1Chests || 0) + 1;
      if (legacyFound) state.partsFound = true;
    }
    return found;
  }
  function canRepair(save) {
    return !isRepaired(save) && Object.entries(REPAIR_COST).every(([id, n]) => Inventory.count(save, id) >= n);
  }
  function repair(save) {
    if (!canRepair(save)) return false;
    for (const [id, n] of Object.entries(REPAIR_COST)) Inventory.remove(save, id, n);
    save.elevators = { ...save.elevators, repaired: true };
    save.selSlot = -1;
    return true;
  }
  root.Elevators = { REPAIR_COST, FLOORS, CHESTS_REQUIRED, PARTS_STORY, normalize,
    hasParts, partsDue, recordChest, isRepaired, unlockedFloors, canRepair, repair };
})(typeof globalThis !== 'undefined' ? globalThis : window);
