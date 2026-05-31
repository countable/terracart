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
