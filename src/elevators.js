// Repair the shared Home lift once; its routes never depend on random loot.
(function (root) {
  'use strict';
  const REPAIR_COST = Object.freeze({ wood: 9, rubble: 9 });
  const FLOORS = Object.freeze([0, 1, 2, 3]);
  function isRepaired(save) { return save?.elevators?.repaired === true; }
  function unlockedFloors(save) { return isRepaired(save) ? FLOORS.filter(depth => depth > 0) : []; }
  function canRepair(save) { return !isRepaired(save) && Object.entries(REPAIR_COST).every(([id, n]) => Inventory.count(save, id) >= n); }
  function repair(save) {
    if (!canRepair(save)) return false;
    for (const [id, n] of Object.entries(REPAIR_COST)) Inventory.remove(save, id, n);
    save.elevators = { repaired: true };
    save.selSlot = -1;
    return true;
  }
  root.Elevators = { REPAIR_COST, FLOORS, isRepaired, unlockedFloors, canRepair, repair };
})(typeof globalThis !== 'undefined' ? globalThis : window);
