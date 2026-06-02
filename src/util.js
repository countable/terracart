// Tiny shared utilities used across loot / interact / render / worldgen.
// Plain globals (no bundler). Every `rng` arg is a function returning a float
// in [0, 1); it defaults to Math.random when omitted. Each helper consumes
// exactly one rng() call so callers stay deterministic under a seeded stream.

// Uniform random element from a non-empty array.
function pickFromArray(arr, rng) {
  return arr[Math.floor((rng ?? Math.random)() * arr.length)];
}

// Uniform integer in the inclusive range [min, max].
function randInt(min, max, rng) {
  return min + Math.floor((rng ?? Math.random)() * (max - min + 1));
}

// === Rare "golden" variants =================================================
// A small fraction of biome flora, trees and wild animals spawn as a rare
// yellow-tinted ("golden") version. Harvesting / catching one pays a 10× money
// bonus plus a Discovery point (save.discovery), all with a fanfare popup.
// Spawn rates per category. Tuned per the design: flora + trees 1%, animals 5%.
const GOLDEN_RATE = { flora: 0.01, tree: 0.01, animal: 0.05 };
// Deterministic [0,1) hash off a stable id string (FNV-1a). Returns the SAME
// value for the same id every time, so a flora/tree's golden status survives
// reloads + tile re-rasterise WITHOUT storing anything on the object or save.
// Salted with '#golden' so it never collides with other id-derived hashes
// (e.g. the wildplant sprite-variant hash in render.js).
function goldenHash01(id) {
  let h = 0x811c9dc5;
  const s = String(id) + '#golden';
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}
// True for the rare golden variant of the entity identified by `id`.
function isGolden(id, rate) {
  if (id == null) return false;
  return goldenHash01(id) < rate;
}
// Warm yellow multiply-tint used for every golden sprite (flora, tree, animal).
const GOLDEN_TINT = 0xffd23a;

// === Tree size tiers =========================================================
// How big a tree renders also sets how much wood it drops and which axe tier
// can fell it. Size is derived purely from the tree's own fields (species +
// optional DeepForest crown_m) so it stays stable across reloads/re-rasterise
// without storing anything. render.js scales the sprite by the SAME value, so
// the visual size and the gameplay size never diverge.
// Discrete DeepForest crown-size tiers. The smallest crowns ('bush') render as
// bushes (see render.js); 'small'/'medium'/'large' are the three tree sizes
// above. The multiplier feeds the gameplay/classification scale below — bushes
// render off their own fixed scale in render.js, so this value just keeps a
// bush classing below 'small' for any size-less fallback path.
const TREE_SIZE_MUL = { bush: 0.42, small: 0.64, medium: 1.15, large: 1.55 };
// Maples render 10% smaller than their canopy class at every size — pines (and
// the other non-maple species) read as the generally larger tree. This is a
// VISUAL-only factor: treeSizeClass keys off treeBaseScale (below) so a maple's
// gameplay size / axe-tier / wood yield is unchanged by the shrink.
const MAPLE_VISUAL_MUL = 0.90;
// Gameplay/classification scale — the canopy size BEFORE the maple visual
// shrink. treeSizeClass thresholds against this so the size tiers stay stable.
function treeBaseScale(o) {
  const base = (o.species && o.species !== 'maple') ? 0.62 : 0.85;
  // A tree may carry a discrete crown SIZE class (small/medium/large) → fixed
  // sprite tiers, which the "tier harvesting by size" gating reads back via
  // treeSizeClass. Prefer it over the continuous crown_m scale.
  if (o.size && TREE_SIZE_MUL[o.size]) return base * TREE_SIZE_MUL[o.size];
  // DeepForest trees carry a crown diameter (m); scale around a 5 m reference
  // (the median detection), clamped 0.8–1.6. OSM trees have no crown_m and
  // keep the flat species scale.
  if (o.crown_m == null) return base;
  const mul = Math.max(0.8, Math.min(1.6, o.crown_m / 5));
  return base * mul;
}
// Rendered sprite scale — the canopy size with the maple shrink folded in.
function treeScale(o) {
  return treeBaseScale(o) * (o.species === 'maple' ? MAPLE_VISUAL_MUL : 1);
}
// 'full' (needs an Iron axe, 4× wood) | 'medium' (Copper axe, 2× wood) |
// 'small' (any axe, base wood) | 'bush' (smallest crowns — any axe, base wood,
// rendered as a bush). Golden trees are handled separately — they need a Gold
// axe regardless of size.
function treeSizeClass(o) {
  // Detected trees carry a discrete DeepForest crown class — map it straight to
  // the gameplay class so the axe-tier gate tracks the SIZE, not the species
  // sprite scale (a maple's base 0.85 would otherwise push every 'small' maple
  // up into 'medium'/'full'). bush→bush (Wood), small→small (Wood),
  // medium→medium (Copper), large→full (Iron).
  if (o.size === 'bush')   return 'bush';
  if (o.size === 'small')  return 'small';
  if (o.size === 'medium') return 'medium';
  if (o.size === 'large')  return 'full';
  // Size-less trees (OSM / procedural forest) fall back to the canopy scale —
  // the pre-maple-shrink value so a maple still classes 'full' off its 0.85.
  const s = treeBaseScale(o);
  if (s >= 0.85) return 'full';
  if (s >= 0.62) return 'medium';
  return 'small';
}
// Species shifts the felling difficulty on top of the size class. Pine is a
// SOFTWOOD — one tier easier to fell than its size would imply. Maple is a
// HARDWOOD — one tier tougher. Every other species fells at its plain size
// tier. (This only moves the axe gate; wood yield still tracks size below.)
function treeSpeciesTierShift(o) {
  if (o.species === 'pine')  return -1;   // softwood
  if (o.species === 'maple') return +1;   // hardwood
  return 0;
}
// Player-facing name for a tree species. Pine reads as "softwood", maple as
// "hardwood"; other species keep their own name.
function treeSpeciesName(o) {
  if (o.species === 'pine')  return 'softwood';
  if (o.species === 'maple') return 'hardwood';
  return o.species || 'tree';
}
// Axe tier required to fell a tree: Gold(4) for golden, otherwise the size
// tier — Iron(3) full, Copper(2) medium, any(1) small/bush — shifted by species
// (softwood −1 / hardwood +1) and clamped to the 1–3 axe range. Wood is
// multiplied 4×/2×/1× off the SIZE class, so yield ignores the species shift.
function treeAxeReqTier(o) {
  if (isGolden(o.id, GOLDEN_RATE.tree)) return 4;
  const size = treeSizeClass(o);
  const base = size === 'full' ? 3 : size === 'medium' ? 2 : 1;
  return Math.max(1, Math.min(3, base + treeSpeciesTierShift(o)));
}
function treeWoodMul(o) {
  const size = treeSizeClass(o);
  // bush & small both yield base (1×) wood; medium 2×, full (large) 4×.
  return size === 'full' ? 4 : size === 'medium' ? 2 : 1;
}
