// Apply an already-chosen reward. Callers own rolls, capacity decisions,
// persistence and presentation; item grants keep the scene's book/tab behavior.
(function (root) {
  'use strict';

  // An item reward may have waited in a chest while another copy was found.
  // Like equipment's duplicate consolation, pay its value instead of a second
  // held unique. Check again at grant time for delayed capacity-dialog actions.
  function reconcileUnique(save, reward) {
    if (reward?.kind !== 'item' || ITEM_BY_ID[reward.id]?.kind !== 'unique_relic') return reward;
    if (carriesItem(save, reward.id)) return { ...reward, kind: 'gold', amount: itemValue(reward.id) };
    return { ...reward, qty: Math.min(1, reward.qty) };
  }

  function apply(save, reward, scene, itemOptions = {}) {
    reward = reconcileUnique(save, reward);
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

  root.Rewards = { apply, reconcileUnique };
})(typeof globalThis !== 'undefined' ? globalThis : this);
