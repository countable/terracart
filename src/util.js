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
