// Basic repairs restore L1; the tenth L1 chest supplies the deeper-route parts.
(function (root) {
  'use strict';
  const REPAIR_COST = Object.freeze({ wood: 9, rubble: 9 });
  const FLOORS = Object.freeze([0, 1, 2, 3]);
  function isRepaired(save) { return save?.elevators?.repaired === true; }
  const CHESTS_REQUIRED = 10;
  function hasParts(save) { return save?.elevators?.partsFound === true; }
  function unlockedFloors(save) { return isRepaired(save) ? (hasParts(save) ? FLOORS.filter(depth => depth > 0) : [1]) : []; }
  function partsDue(save) { return !hasParts(save) && (save?.elevators?.level1Chests || 0) >= CHESTS_REQUIRED - 1; }
  // Called only when a unique level-1 chest is actually claimed.
  function recordChest(save) {
    const found = partsDue(save);
    save.elevators = save.elevators || {};
    save.elevators.level1Chests = (save.elevators.level1Chests || 0) + 1;
    if (found) save.elevators.partsFound = true;
    return found;
  }
  function canRepair(save) { return !isRepaired(save) && Object.entries(REPAIR_COST).every(([id, n]) => Inventory.count(save, id) >= n); }
  function repair(save) {
    if (!canRepair(save)) return false;
    for (const [id, n] of Object.entries(REPAIR_COST)) Inventory.remove(save, id, n);
    save.elevators = { ...save.elevators, repaired: true };
    save.selSlot = -1;
    return true;
  }
  root.Elevators = { REPAIR_COST, FLOORS, CHESTS_REQUIRED, hasParts, partsDue, recordChest, isRepaired, unlockedFloors, canRepair, repair };
})(typeof globalThis !== 'undefined' ? globalThis : window);
