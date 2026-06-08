// ─────────────────────────────────────────────────────────────────────────
// PlacedFloor — the ONE place "which level does this placed floor-tile thing
// belong to?" is answered.
//
// THE PROBLEM IT SOLVES:
//   The world is GPS-mirrored across levels: a surface cell and the cave cell
//   directly below it (scene.depth = 0 surface, 1+ underground) share the same
//   world (x, y). Anything the player drops on a cell — crops, scarecrows,
//   campfires, placed rocks — is stored by world coords, so without a per-level
//   tag it renders (and reacts) on EVERY level at once. That was the
//   "scarecrow shows on every floor" bug (2026-06).
//
//   Before this module the isolation was ad-hoc and per-interactable: crops
//   carried their own `.depth` and were filtered inline; placed rocks were
//   gated `_curDepth === 0`; scarecrows and fires were filtered by nothing at
//   all. This collects the rule in one spot so the next placeable can't
//   re-introduce the leak.
//
// TWO IDIOMS, both live here:
//   • Depth-tagged objects (crops, scarecrows, fires): each stored object
//     carries a `depth` field stamped at placement time. `forDepth` / `onDepth`
//     keep the ones on the level being rendered/tapped. These work on ANY
//     level (a cave campfire is just as valid as a surface one).
//   • Surface-locked sets (placed rocks, tilling): these are stored as Sets of
//     bare "ix_iy" cell-key strings with no room for a per-item tag, and they
//     only ever exist on the surface. `isSurface(depth)` gates them.
//
// LEGACY SAVES: objects placed before depth-tagging have no `depth` field.
// `?? 0` treats them as surface — correct, since every pre-tag placeable
// (crops/scarecrows/fires) could only be dropped on the surface anyway. No
// save migration needed.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';

  // The level an object belongs to. Untagged (legacy) objects are surface (0).
  function placedDepth(item) { return (item && item.depth != null) ? item.depth : 0; }

  // Normalise a level value (scene.depth may be undefined very early).
  function levelOf(depth) { return depth != null ? depth : 0; }

  // Stamp the current level onto a freshly-placed object. Call at EVERY
  // placement site so the filters below can isolate it later. Returns the item
  // so callers can `arr.push(stampDepth({ x, y }, depth))`.
  function stampDepth(item, depth) { item.depth = levelOf(depth); return item; }

  // True when a single object belongs on the level currently in play.
  function onDepth(item, depth) { return placedDepth(item) === levelOf(depth); }

  // Filter an array of placed objects down to the current level.
  function forDepth(list, depth) {
    const d = levelOf(depth);
    return (list || []).filter((it) => placedDepth(it) === d);
  }

  // Gate for the surface-locked, Set-based interactables (placed rocks,
  // tilling) that can't carry a per-item depth tag.
  function isSurface(depth) { return levelOf(depth) === 0; }

  const api = { placedDepth, stampDepth, onDepth, forDepth, isSurface };
  root.PlacedFloor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
