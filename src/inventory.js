// Inventory core — pure operations on `save.inv`, extracted from app.js so the
// stack/cap/dedupe rules are testable headlessly (no scene, no DOM).
//
// Invariants this enforces (unchanged from the original MapScene methods):
//   - At most ONE stack per item id; legacy duplicate stacks self-heal (fold
//     into one) on the next add.
//   - Each stack is capped at stackCapForBags(bags relic): 9 with no bag, 249
//     at tier 7. Excess is rejected (this game has no ground drops). Items
//     flagged `capExempt` in items.js (the Discovery badge) are uncapped.
//
// The scene keeps thin wrappers (app.js addToInv / invRoomFor) that call these
// and then do the side effects cores must not own: persistSave, buildInventory
// DOM, the tab switch that surfaces a new pickup, and the 'bag full' flash.
//
// A pickup NEVER moves the selection. Until Sep 2026 a brand-new stack
// auto-selected itself (save.selSlot jumped to it), so walking over a pebble
// silently swapped the seeds out of the player's hand and the next tap on the
// soil did the wrong thing. Nothing selected (-1) is the resting state and no
// path may pick an item on the player's behalf.
//
// Depends on globals from items.js: ITEM_BY_ID, stackCapForBags.

(function (root) {
  'use strict';

  // Per-stack cap for the equipped bag tier (9 with no bag … 249 at tier 7).
  function stackCap(save) {
    return (typeof stackCapForBags === 'function') ? stackCapForBags(save?.relics?.bags) : 9;
  }

  // Effective cap for ONE item id. Items flagged `capExempt` in items.js (the
  // Discovery badge) ignore the bag cap entirely — they're irreplaceable
  // one-per-type earns, so "bag full" must never reject one.
  function stackCapFor(save, id) {
    const item = (typeof ITEM_BY_ID !== 'undefined') ? ITEM_BY_ID[id] : null;
    if (item && item.capExempt) return Infinity;
    return stackCap(save);
  }

  // Total held of `id` across the inventory (folds any stray duplicate stacks).
  function count(save, id) {
    let have = 0;
    for (const s of (save?.inv || [])) if (s && s.id === id) have += (s.count || 0);
    return have;
  }

  // How many more of `id` would fit right now (0 = full, Infinity for
  // cap-exempt items). Mirrors add()'s cap so a caller can detect overflow
  // before committing (chest "leave it for later").
  function roomFor(save, id) {
    return Math.max(0, stackCapFor(save, id) - count(save, id));
  }

  // Add up to `n` of `id`. Pure: mutates save.inv (folding duplicates, creating
  // the canonical stack, raising its count up to the cap). save.selSlot and
  // save.invPage are never touched — see the header. Returns metadata so the
  // scene wrapper can decide side effects:
  //   valid      — false iff the id isn't a real item or n <= 0 (caller returns
  //                early WITHOUT persisting / rebuilding, matching the original)
  //   accepted   — count actually added (≤ n, capped)
  //   rejected   — n - accepted (>0 means the player hit the cap → 'bag full')
  //   isNewStack — true iff this add created the stack
  function add(save, id, n = 1) {
    const item = (typeof ITEM_BY_ID !== 'undefined') ? ITEM_BY_ID[id] : null;
    if (!item || n <= 0) return { valid: false, accepted: 0, rejected: 0, isNewStack: false };

    const cap = stackCapFor(save, id);
    save.inv = save.inv || [];
    // Fold any duplicate stacks for this id into one canonical stack — the
    // no-duplicate invariant self-heals here (legacy saves could create dupes).
    let stack = null;
    for (let i = save.inv.length - 1; i >= 0; i--) {
      const s = save.inv[i];
      if (!s || s.id !== id) continue;
      if (!stack) { stack = s; continue; }
      stack.count = (stack.count || 0) + (s.count || 0);
      save.inv.splice(i, 1);
    }

    const isNewStack = !stack;
    if (!stack) { stack = { id, count: 0 }; save.inv.push(stack); }

    const room = Math.max(0, cap - (stack.count || 0));
    const accepted = Math.min(room, n);
    stack.count = (stack.count || 0) + accepted;
    const rejected = n - accepted;

    return { valid: true, accepted, rejected, isNewStack };
  }

  // Remove up to `n` of `id`. Pure: walks every stack of the id (legacy dupes
  // included), deducting and splicing emptied stacks. Returns the count
  // actually removed (≤ n; 0 if none held). The caller owns side effects —
  // persist, DOM rebuild, and re-clamping save.selSlot after the splice.
  function remove(save, id, n = 1) {
    if (n <= 0) return 0;
    let left = n;
    const inv = save?.inv || [];
    for (let i = inv.length - 1; i >= 0 && left > 0; i--) {
      const s = inv[i];
      if (!s || s.id !== id) continue;
      const take = Math.min(left, s.count || 0);
      s.count = (s.count || 0) - take;
      left -= take;
      if (s.count <= 0) inv.splice(i, 1);
    }
    return n - left;
  }

  root.Inventory = { stackCap, count, roomFor, add, remove };
})(typeof globalThis !== 'undefined' ? globalThis : this);
