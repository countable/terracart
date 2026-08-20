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

// === Rare "shiny" variants =================================================
// A small fraction of biome flora, trees and wild animals spawn as a rare
// yellow-tinted ("shiny") version. Harvesting / catching one pays a 10× money
// bonus plus a Discovery badge (a 'discovery' inventory stack), all with a
// fanfare popup.
// Spawn rates per category. Tuned per the design: flora + trees 1%, animals 5%.
const SHINY_RATE = { flora: 0.01, tree: 0.01, animal: 0.05 };
// Deterministic [0,1) hash off a stable id string (FNV-1a). Returns the SAME
// value for the same id every time, so a flora/tree's shiny status survives
// reloads + tile re-rasterise WITHOUT storing anything on the object or save.
// Salted with '#shiny' so it never collides with other id-derived hashes
// (e.g. the wildplant sprite-variant hash in render.js).
function shinyHash01(id) {
  let h = 0x811c9dc5;
  const s = String(id) + '#shiny';
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}
// True for the rare shiny variant of the entity identified by `id`.
function isShiny(id, rate) {
  if (id == null) return false;
  return shinyHash01(id) < rate;
}
// Warm yellow multiply-tint used for every shiny sprite (flora, tree, animal).
const SHINY_TINT = 0xffd23a;

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
// Maple's medium/large canopies still render ~10% oversized relative to the
// other species at those sizes — knock an extra 10% off those two classes
// only (stacks on MAPLE_VISUAL_MUL). Visual-only, like the factor above.
const MAPLE_BIG_VISUAL_MUL = 0.90;
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
// Maple gets the flat 10% shrink at every size, plus a further 10% on the two
// biggest classes (medium/large) which still read oversized.
function treeScale(o) {
  if (o.species !== 'maple') return treeBaseScale(o);
  const cls = treeSizeClass(o);
  const bigMul = (cls === 'full' || cls === 'medium') ? MAPLE_BIG_VISUAL_MUL : 1;
  return treeBaseScale(o) * MAPLE_VISUAL_MUL * bigMul;
}
// 'full' (needs an Iron axe, 4× wood) | 'medium' (Copper axe, 2× wood) |
// 'small' (any axe, base wood) | 'bush' (smallest crowns — any axe, base wood,
// rendered as a bush). Shiny trees are handled separately — they need a Gold
// axe regardless of size.
function treeSizeClass(o) {
  // Detected trees carry a discrete DeepForest crown class — map it straight to
  // the gameplay class so the axe-tier gate tracks the SIZE, not the species
  // sprite scale (a maple's base 0.85 would otherwise push every 'small' maple
  // up into 'medium'/'full'). bush→bush (hands 0), small→small (Wood 1, or
  // hands for softwood), medium→medium (Copper 2), large→full (Iron 3).
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
// "hardwood", bush-size is always "bush"; other species keep their own name.
function treeSpeciesName(o) {
  if (o.size === 'bush')     return 'bush';
  if (o.species === 'pine')  return 'softwood';
  if (o.species === 'maple') return 'hardwood';
  return o.species || 'tree';
}
// Axe tier required to fell a tree: Gold(4) for shiny, otherwise +1 axe tier
// per size class — bush(hands 0) → small(Wood 1) → medium(Copper 2) →
// full(Iron 3) — shifted by species (softwood −1 / hardwood +1) and clamped
// to the 0–4 range (0 = bare hands). Wood is multiplied 4×/2×/1× off the SIZE
// class, so yield ignores the species shift.
function treeAxeReqTier(o) {
  if (isShiny(o.id, SHINY_RATE.tree)) return 4;
  const size = treeSizeClass(o);
  // Bushes are one uniform type — always bare-hands (tier 0), no wood/species
  // shift, so a maple bush is no harder than any other.
  if (size === 'bush') return 0;
  // +1 required axe tier for every step up in size class.
  const base = size === 'full' ? 3 : size === 'medium' ? 2 : size === 'small' ? 1 : 0;
  return Math.max(0, Math.min(4, base + treeSpeciesTierShift(o)));
}
function treeWoodMul(o) {
  const size = treeSizeClass(o);
  // bush & small both yield base (1×) wood; medium 2×, full (large) 4×.
  return size === 'full' ? 4 : size === 'medium' ? 2 : 1;
}

// === Shared look: fonts + palette ==========================================
// One home for the typefaces and colours the game draws with, so a new call
// site can't quietly invent a seventh gold or a second monospace stack. The
// DOM side mirrors these as CSS custom properties on :root (index.html) —
// keep the two in sync when either changes.
//
// FONTS. Canvas text (Phaser) and DOM text share ONE monospace stack.
// `ui-monospace` is a distinct generic from bare `monospace`: it resolves to
// the platform's UI mono (SF Mono on Apple, Cascadia/Consolas on Windows)
// where bare `monospace` resolves to the browser's default fixed font, often
// Courier. Mixing the two put two different typefaces a cell apart on Apple
// devices, so every text style goes through these helpers.
const FONT_MONO_STACK  = 'ui-monospace, monospace';
// Map lettering (road names) and the shop plaque. One serif stack, not two —
// they used to differ by whether Georgia was in the list.
const FONT_SERIF_STACK = 'ui-serif, Georgia, "Times New Roman", serif';
// `spec` is everything before the family: 'bold 10px', '700 12px', 'italic 8px'.
const fontMono  = (spec) => `${spec} ${FONT_MONO_STACK}`;
const fontSerif = (spec) => `${spec} ${FONT_SERIF_STACK}`;

// PALETTE. Named roles, not shades — reach for the role that fits rather than
// adding a near-duplicate. The three secondary golds below are genuinely
// different roles; a trio of near-identical ones (within 8/255 of each other
// in a single channel) used to sit alongside them and now all read UI_GOLD.
const UI_GOLD       = '#ffe066';   // the game's gold: money, highlights, accents
const UI_GOLD_DEEP  = '#ffd23a';   // saturated gold — shiny tint + jackpot accents
const UI_GOLD_DARK  = '#c8a64a';   // dim gold — borders, rules, inactive accents
const UI_GOLD_PALE  = '#fff3b0';   // pale gold — the lit core of a highlight
const UI_GREEN      = '#a7ffb0';   // success / ready / energy gain
const UI_DANGER     = '#b71c1c';   // destructive action + error surfaces
const UI_DANGER_INK = '#ff8a7a';   // destructive action as TEXT on a dark ground
const UI_INK        = '#ffffff';   // default text on world/dark backgrounds
const UI_SHADOW     = '#000000';   // text stroke / drop shadow

// ── Memoised array → Set lookups ────────────────────────────────────────
// The render loop asks "is this id in save.opened / save.chopped / save.picked
// / …?" for every object in view, on every frame, and used to answer by
// building a fresh Set from the array each time. Those arrays only ever grow —
// a long session opens hundreds of chests and chops hundreds of trees — so the
// cost was O(save size) allocation at 60 fps, getting steadily worse the longer
// someone played. drawObjects alone rebuilt six of them per frame.
//
// Every writer of these arrays either push()es onto it (the length changes) or
// assigns a whole new array (the identity changes); nothing rewrites an element
// in place at an unchanged length. That makes (identity, length) a sound cache
// key: the Set is rebuilt exactly when one of the two moves, and reused on
// every frame in between.
//
// The returned Set is SHARED between callers — treat it as read-only. Anything
// that needs to mutate should copy it (`new Set(setOf(arr))`).
const _EMPTY_SET = new Set();
const _setOfMemo = new WeakMap();
function setOf(arr) {
  if (!arr) return _EMPTY_SET;
  const hit = _setOfMemo.get(arr);
  if (hit && hit.len === arr.length) return hit.set;
  const set = new Set(arr);
  _setOfMemo.set(arr, { set, len: arr.length });
  return set;
}
