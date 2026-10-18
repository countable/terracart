// Apply an already-chosen reward, and PRESENT it. Callers own rolls,
// capacity decisions and persistence; item grants keep the scene's book/tab
// behavior.
//
// `card(scene, reward)` is THE ONE kind → card ladder (icon, name, qty,
// colour, line, tier — the shape showChestRewardModal takes) for every
// ceremony and toast: a chest's, a dug X's, an elite's drop, the first
// vista's relic, a neighbour's gift, a barrel. `present(scene, reward, opts)`
// shows it — as a card (mode 'card', with opts.extra laid over: the header,
// the painting, the chest glyph, the caller's own line, onDismiss) or as a
// toast (mode 'toast', led by opts.mark, or opts.text in full) — and fires
// the jackpot fanfare once for any reward the roll stamped (`jackpot`). A
// converted reward is presented as ordinary coins. Depends on
// (call time): items.js (ITEM_BY_ID, itemName, itemTierOf, gearName),
// loot.js (lootFlashColor), util.js (UI_GOLD, UI_TREASURE) and the scene's
// icon helpers (app.js iconSpanHTML / coinIconHTML / gearIconHTML).
(function (root) {
  'use strict';

  function gearCard(scene, kind, slot, tier, iconPx) {
    return {
      iconHTML: scene.gearIconHTML ? scene.gearIconHTML(kind, slot, tier, iconPx) : '★',
      name: (typeof gearName === 'function') ? gearName(kind, slot, tier) : slot,
      tier, qty: '× 1',
    };
  }
  // What ONE reward IS, in the words the item already carries elsewhere — an
  // item's ITEM_EFFECTS line (the inventory's selected-stack hint), gear's
  // def blurb — never a second description. Plain text, or null (gold, an
  // item with no line). The card carries it as `desc`: the right half of the
  // loot ceremony (showChestRewardModal).
  function desc(reward) {
    if (!reward) return null;
    if (reward.kind === 'item') {
      return (typeof ITEM_EFFECTS !== 'undefined' && ITEM_EFFECTS[reward.id]) || null;
    }
    if (reward.kind === 'relic' || reward.kind === 'armor') {
      return (typeof gearDef === 'function' && gearDef(reward.kind, reward.slot)?.blurb) || null;
    }
    return null;
  }
  function card(scene, reward, iconPx = 64) {
    if (!reward) return null;
    if (reward.kind === 'item') {
      return {
        iconHTML: scene.iconSpanHTML ? scene.iconSpanHTML(reward.id, iconPx) : '',
        name: String(itemName(reward.id)),
        qty: `× ${reward.qty || 1}`,
        color: lootFlashColor(reward.id),
        tier: itemTierOf(reward.id),
        desc: desc(reward),
      };
    }
    if (reward.kind === 'gold') {
      return {
        iconHTML: scene.coinIconHTML ? scene.coinIconHTML(Math.round(iconPx * 0.75)) : '',
        name: `+${reward.amount || 0}`,
        color: UI_GOLD,
      };
    }
    if (reward.kind === 'relic' || reward.kind === 'armor') {
      return { ...gearCard(scene, reward.kind, reward.slot, reward.tier, iconPx), sub: 'equipped', color: UI_TREASURE, desc: desc(reward) };
    }
    return null;   // an unrecognised kind draws no card and opens no modal
  }
  // The fanfare a roll stamped (`jackpot` steps), once.
  function jackpot(scene, reward) {
    if (reward?.jackpot >= 1 && typeof scene.flashJackpot === 'function') scene.flashJackpot(reward.jackpot);
  }
  function present(scene, reward, { mode = 'card', extra = {}, mark = '', text } = {}) {
    const c = card(scene, reward);
    if (!c) return false;
    if (mode === 'card') {
      if (typeof scene.showChestRewardModal !== 'function') return false;
      // The card's own line ("equipped") follows the
      // caller's framing line rather than being dropped.
      const own = c.sub ? c.sub[0].toUpperCase() + c.sub.slice(1) + (/[.!?]$/.test(c.sub) ? '' : '.') : '';
      const sub = [extra.sub, own].filter(Boolean).join(' ') || undefined;
      scene.showChestRewardModal({ ...c, ...extra, sub });
    } else {
      const lead = mark ? `${mark} ` : '';
      if (reward.kind === 'relic' || reward.kind === 'armor') {
        scene.flashLoot(`${lead}→ ✨ ${c.name} (equipped!)`, UI_GOLD, 1.6);
      } else if (reward.kind === 'item') {
        scene.flashLoot(text ?? `${c.name}${reward.qty > 1 ? ` ×${reward.qty}` : ''}`, c.color, 1, reward.id);
      } else {
        scene.flashLoot(text ?? `${lead}→ ${reward.amount}`, UI_GOLD, 1, null, scene.coinIconEl?.());
      }
    }
    jackpot(scene, reward);
    return true;
  }

  // An item reward may have waited in a chest while another copy was found.
  // Like equipment's duplicate consolation, pay its value instead of a second
  // held unique. Check again at grant time for delayed capacity-dialog actions.
  function reconcileUnique(save, reward) {
    if (reward?.kind !== 'item' || ITEM_BY_ID[reward.id]?.kind !== 'unique_relic') return reward;
    if (carriesItem(save, reward.id)) {
      const value = itemValue(reward.id);
      // Elite signatures use the same half-price cash-out as their equipment.
      const amount = reward.signatureIndex != null ? Math.max(1, Math.floor(value / 2)) : value;
      return { ...reward, kind: 'gold', amount };
    }
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
      const newArmor = reward.kind === 'armor' && !save.armor?.[reward.slot];
      Gear.equip(save, reward.kind, reward.slot, reward.tier);
      scene.markRelicsDirty?.();
      // A first armor slot surfaces like a new item stack; upgrades leave the
      // player's browsed category alone.
      if (newArmor && save.armor?.[reward.slot]) scene.selectInvCat?.('armour');
      result.equipped = true;
    } else {
      return null;
    }
    result.money += Math.max(0, reward.consolation || 0);
    if (result.money) addMoney(save, result.money);
    return result;
  }

  root.Rewards = { apply, reconcileUnique, card, desc, present, jackpot };
})(typeof globalThis !== 'undefined' ? globalThis : this);
