// Apply an already-chosen reward. Callers own rolls, capacity decisions,
// persistence and presentation; item grants keep the scene's book/tab behavior.
(function (root) {
  'use strict';

  function apply(save, reward, scene, itemOptions = {}) {
    if (!reward) return null;
    const result = { accepted: 0, money: 0, equipped: false };
    if (reward.kind === 'item') {
      result.accepted = scene.addToInv(reward.id, reward.qty, false, itemOptions);
    } else if (reward.kind === 'gold') {
      result.money = reward.amount || 0;
    } else if (reward.kind === 'relic' || reward.kind === 'armor') {
      Gear.equip(save, reward.kind, reward.slot, reward.tier);
      scene.markRelicsDirty?.();
      result.equipped = true;
    } else {
      return null;
    }
    result.money += Math.max(0, reward.consolation || 0);
    if (result.money) addMoney(save, result.money);
    return result;
  }

  root.Rewards = { apply };
})(typeof globalThis !== 'undefined' ? globalThis : this);
