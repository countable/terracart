// Tiny shared utilities used across loot / interact / render / worldgen.
// Plain globals (no bundler). Every `rng` arg is a function returning a float
// in [0, 1); it defaults to Math.random when omitted. Each helper consumes
// exactly one rng() call so callers stay deterministic under a seeded stream.

// Uniform random element from a non-empty array.
function pickFromArray(arr, rng) {
  return arr[Math.floor((rng ?? Math.random)() * arr.length)];
}

// #game's screen rect, cached. getBoundingClientRect forces a synchronous
// style-recalc + layout, and three per-frame consumers (the delivery-house
// callouts, the work-wheel icon, the reserved-corner icons) each read it every
// frame — layout thrash interleaved with the same frame's style WRITES. The
// rect only actually changes when fitGame rescales (#game is a fixed 352×844
// box under a CSS transform), so serve a cached copy: invalidated by resize /
// visualViewport events and, belt-and-braces, re-measured once a second in
// case some rescale path escapes both listeners.
let _gameRectCache = null;
let _gameRectT = 0;
function gameScreenRect() {
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  if (!_gameRectCache || now - _gameRectT > 1000) {
    const el = document.getElementById('game');
    if (!el) return null;
    _gameRectCache = el.getBoundingClientRect();
    _gameRectT = now;
  }
  return _gameRectCache;
}
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => { _gameRectCache = null; });
  window.visualViewport?.addEventListener('resize', () => { _gameRectCache = null; });
}

// Uniform integer in the inclusive range [min, max].
function randInt(min, max, rng) {
  return min + Math.floor((rng ?? Math.random)() * (max - min + 1));
}

// === Countdown notation =====================================================
// ONE way to write "how long is left" anywhere in the game. Every timed thing
// the player can see — a crop's stage badge, a fruit tree's regrow, a shop's
// hourly bucket, an animal's produce cooldown, the dragon buff, the walk-home
// stick — renders through shortDuration(), so a wait never reads as a bare
// number in one place and "43m" in another. This is the same discipline as
// roadOverlayWidthM: one table both sides read.
//
// The format is deliberately tiny: the LARGEST unit that applies, and nothing
// below it — "20d", "3h", "30m", "12s". Never "1h 5m", never "0m". The unit
// letter is always present (that is the point of the helper), so a two-glyph
// number plus one letter is the widest it ever gets at a sane duration, which
// is what lets it sit in a 9px corner badge and on the move-pad's cap alike.
//
// Rounding is UP at every step, and it CASCADES: 59.5 minutes is "1h", not
// "60m", because each unit is re-derived from the one below it after that
// unit's own ceil. A wait that has not actually elapsed never reads "0" — the
// smallest non-zero duration is "1s" — so the label can't promise a thing is
// ready while the gate still refuses it. Only a genuinely finished (or
// negative) duration gives "0s"; callers that want a "✓" test for that
// themselves rather than string-matching this.
function shortDuration(ms) {
  if (!(ms > 0)) return '0s';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.ceil(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.ceil(h / 24)}d`;
}

// Milliseconds from `now` to the next UTC midnight — the reset the game's
// day-gated things actually run on. A fed house's "happy" (Delivery.dayKey), the
// castle's daily favour and the coin-burst POIs all key off a UTC "YYYYMMDD"
// stamp, so "come back tomorrow" can mean anything from a minute to 24 hours.
// Feeding this to shortDuration() turns that into the honest number ("in 23h",
// "in 40m"). Use it wherever a UTC day key is the gate; a LOCAL-midnight gate
// would need its own helper, and there isn't one because there isn't one.
function msToNextUtcDay(now = Date.now()) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  return DAY_MS - (now % DAY_MS);
}

// === Shared hashing / seeded RNG ============================================
// One FNV-1a implementation for every id-derived hash in the game (the shiny
// roll below, the shop bucket offset, the delivery day-seed + theme pick, and
// the sandbox flora placer each used to hand-roll this same 32-bit loop —
// same seed 2166136261 / prime 16777619 everywhere, differing only in what
// string gets salted in and what the caller does with the final uint32).
// Callers that need [0,1) divide by 4294967296 themselves; callers that need
// a bounded pick take `% n`.
function fnv1a(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Seeded [0,1) generator (splitmix-style state advance + a mulberry-style
// output mix) shared by shops_math.js's per-bucket offer rng and delivery.js's
// per-day wishlist rng — both hashed a seed with fnv1a and then ran this exact
// 8-line mixer to turn it into a stream; now one copy, two seeds.
function makeRng32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 0x9e3779b1) + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t ^= (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// === Rare "shiny" variants =================================================
// A small fraction of biome flora, trees and wild animals spawn as a rare
// yellow-tinted ("shiny") version. Harvesting / catching one pays a 10× money
// bonus plus a Discovery badge (a 'discovery' inventory stack), all with a
// fanfare popup.
// Cave monsters go shiny too — an ELITE: the same gold sheen and sparkle, with
// double HP and double damage (combat.js › ELITE_MUL). Killing one banks a
// Discovery badge the first time per kind and a relic-biased treasure roll
// every time after (app.js › resolveDefeat). The surface slime, the tutorial
// foe, never does.
// Spawn rates per category. Tuned per the design: flora + trees 1%, animals
// and monsters 5%.
const SHINY_RATE = { flora: 0.01, tree: 0.01, animal: 0.05, monster: 0.05 };
// Deterministic [0,1) hash off a stable id string (FNV-1a). Returns the SAME
// value for the same id every time, so a flora/tree's shiny status survives
// reloads + tile re-rasterise WITHOUT storing anything on the object or save.
// Salted with '#shiny' so it never collides with other id-derived hashes
// (e.g. the wildplant sprite-variant hash in render.js).
function shinyHash01(id) {
  return fnv1a(String(id) + '#shiny') / 4294967296;
}
// True for the rare shiny variant of the entity identified by `id`.
function isShiny(id, rate) {
  if (id == null) return false;
  return shinyHash01(id) < rate;
}
// Is this WILD ANIMAL a shiny one? The rate plus the one exception: the
// surface slime never rolls shiny, because shiny is a promise of a payout
// (a 10× catch bonus and a Discovery badge) and a slime is an energy pest
// with nothing to catch. Both spawners read this rather than restating the
// `kind !== 'slime' && …` test — the tile's fauna roll and the guaranteed
// doorstep greeter (app.js) — so the exception can't hold in one and not the
// other. Cave monsters DO go shiny (they become elites) and use
// SHINY_RATE.monster directly; this is the animal ladder only.
function faunaShiny(kind, id) {
  if (kind === 'slime') return false;
  return isShiny(id, SHINY_RATE.animal);
}
// Warm yellow multiply-tint used for every shiny sprite (flora, tree, animal).
const SHINY_TINT = 0xffd23a;
// A Frost Powder's victim — icy blue-white over the creature sprite while its
// _frozenUntil is in the future (render.js drawCreatures).
const FROZEN_TINT = 0x9ad8ff;

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
// Per-species canopy base — the scale a tree of that species draws at with no
// crown/size information. Maple's sheet is drawn smaller inside its frame, so
// its base is larger; that difference is a SPRITE-SHEET fact, not a size one,
// which is why treeSizeClass divides it back out before thresholding.
function treeSpeciesBaseScale(o) {
  return (o.species && o.species !== 'maple') ? 0.62 : 0.85;
}
// Maple-sheet growth stage: the maple sheet (also the fallback for a tree with
// no species) draws 1=sprout, 2=young, 3=mature off `variant`, so a size-less
// maple's DRAWN size is its growth stage, not its canopy scale. render.js picks
// the frame with this same function so the art and the size class can't drift.
function treeUsesGrowthSheet(o) {
  return !o.size && (!o.species || o.species === 'maple');
}
// A tree the PLAYER planted (an acorn) grows on the CLOCK, not off a static
// `variant`: sprout → young at the halfway mark → mature at the full window,
// which is the same four days a fruit-tree sapling takes to bear. One window,
// one ladder, and it comes back through treeGrowthStage so the frame render.js
// draws, the size class the axe gate reads and the wood the fell pays all move
// together — a sapling can't draw tiny and gate like a full canopy.
const PLANTED_TREE_GROW_MS = 4 * 24 * 60 * 60 * 1000;
function plantedTreeStage(plantedT, now) {
  const age = (now == null ? Date.now() : now) - (Number(plantedT) || 0);
  const f = age / PLANTED_TREE_GROW_MS;
  if (f >= 1) return 3;      // mature
  return f >= 0.5 ? 2 : 1;   // young / sprout
}
function treeGrowthStage(o) {
  if (o && o.planted_t) return plantedTreeStage(o.planted_t);
  const v = Math.round(Number(o && o.variant));
  // Frames 0 and 4 are stumps — clamp to the live 1..3 range (default 2/young).
  return Number.isFinite(v) ? Math.max(1, Math.min(3, v)) : 2;
}
// Gameplay/classification scale — the canopy size BEFORE the maple visual
// shrink. A tree is one of FOUR sizes, or it is size-less and draws its
// species' flat base.
//
// THERE IS NO SMOOTH SCALING, and the continuous path that used to be here is
// worth a note because it looked load-bearing. DeepForest hands every detected
// tree a crown diameter in metres, and this function used to scale by
// crown_m/5 clamped to 0.8–1.6 whenever no discrete `size` was present. But the
// detector's own classifier (satextract/trees.py) buckets that same crown_m
// into bush / small / medium / large before the geojson is ever written — the
// cut-points are 1.8 / 2.5 / 4 m — so every one of the 804 trees in
// data/satextract_osm.geojson carries BOTH fields, `size` always wins, and the
// smooth branch had not scaled a tree since the classifier shipped. It was a
// leftover from the crown_m-only sidecars (data/trees_z20_t10.geojson and
// friends, no longer loaded).
//
// Leaving it in was not harmless. It disagreed with the table it stood behind:
// its 0.8 floor is nearly TWICE the bush multiplier of 0.42, so a tree that
// reached it would have drawn a bush-sized crown at small-tree size — and since
// treeSizeClass thresholds the same multiplier, that tree could never have
// classed as a bush at all, whatever its crown said.
//
// crown_m is still carried and still used — worldgen thins a crowded tile
// biggest-crown-first — it just doesn't set a sprite size any more.
function treeBaseScale(o) {
  const base = treeSpeciesBaseScale(o);
  return (o.size && TREE_SIZE_MUL[o.size]) ? base * TREE_SIZE_MUL[o.size] : base;
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
  // Size-less: an OSM street/yard tree or the procedural forest. There is no
  // crown to measure, so they all class the same — 'medium', the middle gate.
  // This used to threshold treeBaseScale/treeSpeciesBaseScale against 1.37 and
  // 1, which for a size-less tree is exactly 1 by construction (the species
  // base divides itself out) and so only ever returned 'medium' anyway; the
  // ladder was there for the crown_m scaling that treeBaseScale no longer does.
  // Dividing the species base back out was still the right idea and is worth
  // keeping in mind if a continuous size ever returns: thresholding the RAW
  // scale read maple's larger sheet base (0.85 vs 0.62) as a larger TREE, so
  // every size-less maple classed 'full' — and with the hardwood +1 on top, a
  // sapling-sized maple demanded the same Gold axe as a large one.
  //
  // A maple-sheet tree draws its growth stage, so cap the class by what's
  // actually on screen — a sprout/young frame can't gate like a mature canopy.
  return (treeUsesGrowthSheet(o) && treeGrowthStage(o) < 3) ? 'small' : 'medium';
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

// Combine two packed-RGB tints channel-wise (each channel a 0..1 multiplier),
// so a dim/red state tint can stack on the player's own colour instead of
// replacing it. mulTint(0xffffff, c) === c; mulTint(a, undefined) === a.
function mulTint(a, b) {
  if (b == null) return a;
  const ch = (sh) => Math.round((((a >> sh) & 0xff) * ((b >> sh) & 0xff)) / 255) << sh;
  return ch(16) | ch(8) | ch(0);
}
// Packed 0xRRGGBB → CSS '#rrggbb', for the canvas overlays (road_overlay.js,
// building_overlay.js) that hand a Phaser-style int to a 2D context. One copy
// here rather than a local per file. `>>> 0` keeps a sign-bit int positive.
function cssOf(c) {
  return '#' + (c >>> 0).toString(16).padStart(6, '0');
}
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
// TWO ROLES CARRY MEANING (spec §UI COLOUR LANGUAGE):
//   blue-white = TREASURE & POWERUPS — anything the WORLD gives the player
//                (chest/treasure ceremonies, POI pads + halos, powerup grants)
//   gold       = PLAYER CONTROLS — anything the PLAYER drives (buttons, pads,
//                HUD chrome, money) — that's the UI_GOLD family above, and
//                UI_CONTROL below names the role so a control reads as a
//                control rather than as "the gold one".
// Keeping the two apart means a glance at a screen answers "is this something
// I press, or something I just won?" without reading a word of it.
const UI_TREASURE      = '#f4f8ff';   // near-white with a blue cast — treasure surfaces + frames
const UI_TREASURE_INK  = '#cfe2ff';   // blue-white as TEXT on a dark ground
const UI_TREASURE_DEEP = '#7fb0ff';   // saturated blue — glow, side faces, deep accents
// The LIT COBBLE colour, inside the same treasure/powerup role: a stone you
// have walked, and the "3/10" that counts it. One constant, two readers —
// app.js bakes the lit stone texture with it and the trail counter is drawn in
// it, so the number and the stone under it can never end up different colours.
// Violet-leaning rather than the sky blue it started as: still unmistakably in
// the blue treasure family beside UI_TREASURE_DEEP, but far enough round the
// wheel that a walked stone doesn't read as the same colour as water.
const UI_TRAIL_LIT     = '#9a8cff';   // lit cobble — the stone and its counter
const UI_CONTROL       = UI_GOLD;     // player controls: buttons, pads, HUD accents
const UI_CONTROL_DIM   = UI_GOLD_DARK;// control borders / rules / inactive controls

// Keep a CENTRED text object inside the canvas. A label placed at its raw
// screen x with origin 0.5 runs past the edge and gets sliced by the viewport
// mask — an out-of-reach tap near the right edge rendered as "Just out o", and
// long POI names were cut on every viewport size. Returns the clamped x.
// `textW` is the object's rendered width (tx.width AFTER setText), `canvasW`
// the game canvas width. A label wider than the canvas is centred instead:
// there is no x that fits it, and centring loses the same amount off each end.
function clampTextX(x, textW, canvasW, pad = 2) {
  const half = textW / 2;
  if (textW + pad * 2 >= canvasW) return canvasW / 2;
  return Math.min(Math.max(x, half + pad), canvasW - half - pad);
}

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

// ── Building roof scale ──────────────────────────────────────────────────
// ONE RULE FOR EVERY BUILDING: draw at your own FOOTPRINT, clamped to the range
// your role is allowed. sqrt(area) is the footprint's side in metres and /cellM
// turns it into cells, so `fit` is the size at which the art exactly covers the
// polygon it stands on.
//
// THE RANGE IS IN DRAWN CELLS, NOT IN SPRITE SCALE, and that is the whole point
// of this table. A scale is meaningless on its own: it means one size on the
// 72px house frame and quite another on the 214px fort PNG. Houses and forts
// used to be two separate expressions for that reason — houses clamped a scale
// DOWN from 0.6, forts clamped one UP from 0.28 — and the shared 0.6 the
// residential roles were said to "share so they look like neighbours from one
// village" did no such thing: at 0.6 the blacksmith drew 1.35 cells wide, the
// trader 1.43, the wreck and the wizard 1.50, the market 1.99 and the trailer
// 2.02. The village was sized by whatever width each artist had chosen for
// their PNG. Worse, a wreck (80px) and the house it restores into (72px) drew
// at different widths, so REPAIRING a building shrank it by 10%.
//
// In cells all of that disappears: a role names the size it draws at, every
// frame reaches it, and the two roles differ only in the numbers on their row.
//
// FORTS GROW, HOUSES DON'T — now visible as the shape of a range rather than as
// two different formulas. A house's range is a sliver (1.2–1.35) because the
// sprite is one dwelling and a footprint can only ever pull it slightly under
// its natural size. A fort's footprint has no fixed size at all: buildingTier
// gives BUILDING_MED to anything over 350 m², and enforceBuildingDistribution
// promotes a tile's largest polygons into that band behind the single castle,
// so a re-tiered civic block can be 5000 m² (10 cells across) or 20000 m² (20).
// Pinned at one size those drew the same roof as a 19 m fort and the footprint
// read as a field of bare brick with a toy building parked in the middle.
//
// `def` is what a building with NO footprint draws at — the synthetic starter
// trailer, sandbox houses. It sits at the top of the house range and the bottom
// of the fort range because that is where each role's real buildings cluster.
//
// The fort cap has come down twice: ~7 cells read as oversized against an
// 11-cell viewport rather than as a landmark you could see around, then ~4.3
// still read ~25% too big. The game runs pixelArt:true, so growing the art
// stays crisp rather than blurring.
const BUILDING_ART = {
  // fitMul — how much of its own footprint the role fills. Forts keep a small
  //          brick margin inside theirs; exact fill read ~25% too big.
  // min/def/max — drawn width in CELLS (a cell is CELL_M = 7 m).
  house: { fitMul: 1,   min: 1.2,  def: 1.35, max: 1.35 },
  fort:  { fitMul: 0.8, min: 1.87, def: 1.87, max: 3.48 },
};
// The residential 1.35 is the width the plain house has always drawn at
// (72px × 0.6 ÷ 32), so the commonest building on the map is unmoved and the
// odd ones out come to meet it. The floor of 1.2 keeps a sub-cell polygon from
// shrinking a dwelling into yard clutter, and pairs with the 2-cell footprint
// bias in worldgen's assignBuildingFootprints (FOOT_HOUSE_MIN) so the floored
// roof has a pad to stand on. The fort's 1.87 and 3.48 are its previous 0.28
// and 0.52 on the 214px frame, in cells — the curve is unchanged.
function buildingArt(isFort) { return isFort ? BUILDING_ART.fort : BUILDING_ART.house; }
// Sprite scale that draws `cells` cells wide from a frame `frameW` px wide.
// An unmeasurable frame can't be sized at all — but render.js has already
// hidden that sprite (the texture check in RENDER_SPEC), so the number only
// has to be finite and to agree with buildingBaseScale below, which the
// shadow pass divides by.
function buildingCellsToScale(cells, frameW, cellPx) {
  if (!(frameW > 0) || !(cellPx > 0)) return 1;
  return (cells * cellPx) / frameW;
}
// What this role draws at with no footprint to go on.
function buildingBaseScale(frameW, isFort, cellPx) {
  return buildingCellsToScale(buildingArt(isFort).def, frameW, cellPx);
}
function houseArtScale(area, frameW, isFort, cellM, cellPx) {
  const a = buildingArt(isFort);
  const cells = (area > 0 && cellM > 0)
    ? Math.min(a.max, Math.max(a.min, a.fitMul * (Math.sqrt(area) / cellM)))
    : a.def;
  return buildingCellsToScale(cells, frameW, cellPx);
}
