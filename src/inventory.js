// Inventory core — pure operations on `save.inv`, extracted from app.js so the
// stack/cap/dedupe rules are testable headlessly (no scene, no DOM).
//
// Invariants this enforces (unchanged from the original MapScene methods):
//   - At most ONE stack per item id; legacy duplicate stacks self-heal (fold
//     into one) on the next add.
//   - Each stack is capped at stackCapForBags(bags relic): 9 with no bag, 249
//     at tier 7. Excess is rejected (this game has no ground drops).
//
// The scene keeps thin wrappers (app.js addToInv / invRoomFor) that call these
// and then do the side effects cores must not own: persistSave, buildInventory
// DOM, the autoselect-on-pickup, and the 'bag full' flash.
//
// Depends on globals from items.js: ITEM_BY_ID, stackCapForBags.

(function (root) {
  'use strict';

  // Per-stack cap for the equipped bag tier (9 with no bag … 249 at tier 7).
  function stackCap(save) {
    return (typeof stackCapForBags === 'function') ? stackCapForBags(save?.relics?.bags) : 9;
  }

  // Total held of `id` across the inventory (folds any stray duplicate stacks).
  function count(save, id) {
    let have = 0;
    for (const s of (save?.inv || [])) if (s && s.id === id) have += (s.count || 0);
    return have;
  }

  // How many more of `id` would fit right now (0 = full). Mirrors add()'s cap so
  // a caller can detect overflow before committing (chest "leave it for later").
  function roomFor(save, id) {
    return Math.max(0, stackCap(save) - count(save, id));
  }

  // Add up to `n` of `id`. Pure: mutates save.inv (folding duplicates, creating
  // the canonical stack, raising its count up to the cap) and, when
  // opts.autoselect is set and a NEW stack was created, points save.selSlot /
  // save.invPage at it. Returns metadata so the scene wrapper can decide side
  // effects:
  //   valid      — false iff the id isn't a real item or n <= 0 (caller returns
  //                early WITHOUT persisting / rebuilding, matching the original)
  //   accepted   — count actually added (≤ n, capped)
  //   rejected   — n - accepted (>0 means the player hit the cap → 'bag full')
  //   isNewStack — true iff this add created the stack
  function add(save, id, n = 1, opts = {}) {
    const item = (typeof ITEM_BY_ID !== 'undefined') ? ITEM_BY_ID[id] : null;
    if (!item || n <= 0) return { valid: false, accepted: 0, rejected: 0, isNewStack: false };

    const cap = stackCap(save);
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

    // Autoselect a freshly-obtained NEW item type so the player can immediately
    // see / use it. Only when this add created a brand-new stack — topping up an
    // existing stack keeps the current selection so harvest→replant loops aren't
    // disrupted. pageSize mirrors buildInventoryDOM's PAGE (5).
    if (isNewStack && accepted > 0 && opts.autoselect) {
      const idx = save.inv.indexOf(stack);
      if (idx >= 0) {
        save.selSlot = idx;
        save.invPage = Math.floor(idx / (opts.pageSize || 5));
      }
    }

    return { valid: true, accepted, rejected, isNewStack };
  }

  root.Inventory = { stackCap, count, roomFor, add };
})(typeof globalThis !== 'undefined' ? globalThis : this);
