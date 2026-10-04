// Headless node test runner for terracart's pure logic + interactable registry.
//
// The browser harness (test/harness.html + run_tests.py) boots the REAL Phaser
// scene against fixture tiles — great for integration, but it needs Chromium.
// This runner covers the logic that needs no rendering: it loads the pure /
// data modules into a single vm context with light browser stubs, then runs
// plain assertion tests with `node test/node/run.js`. No Phaser, no DOM, no
// jsdom — fast enough for every commit / CI.
//
// How the load works (mirrors how the browser shares one global scope across
// <script> tags): all modules are concatenated into ONE script so their
// top-level `const`/`let` share a lexical scope. Top-level `function`s and the
// IIFE modules' `window.X = …` exports attach to the context global directly;
// the `const` exports (INTERACTABLES, ITEM_BY_ID, …) are copied onto globalThis
// by a bridge appended to the bundle, so the separately-loaded *.test.js files
// can reach them by bare name — exactly like the browser.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const readSrc = (p) => fs.readFileSync(path.join(ROOT, 'src', p), 'utf8');
// The scene's source: app.js plus every mixin it installs with
// installSceneMixin(MapScene, X), where X is `class X` in its own module.
// Derived from app.js, so a new mixin joins without editing this file. Pins
// and lifts that read scene methods use SCENE_SRC, so moving a method between
// app.js and a mixin needs no test edits.
const SCENE_FILES = (() => {
  const app = readSrc('app.js');
  const mixins = [...app.matchAll(/^installSceneMixin\(MapScene, (\w+)\);$/gm)].map((m) => m[1]);
  const files = fs.readdirSync(path.join(ROOT, 'src')).filter((n) => n.endsWith('.js'));
  return ['app.js', ...mixins.map((name) => {
    const file = files.find((f) => new RegExp(`^class ${name} \\{`, 'm').test(readSrc(f)));
    if (!file) { console.error(`No src module declares class ${name} — update run.js`); process.exit(2); }
    return file;
  })];
})();
const SCENE_SRC = SCENE_FILES.map(readSrc).join('\n');
// Every module PARSES — compiled, never run. The bundle below only loads the
// headless modules and app.js is only ever sliced as text, so a syntax error
// in app.js (a stray brace once closed MapScene early and shipped the game
// dead) would otherwise pass the whole suite. campfire_cook.test.js asserts
// this list is empty.
const SRC_PARSE_ERRORS = {};
for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter((n) => n.endsWith('.js'))) {
  try { new vm.Script(readSrc(f), { filename: f }); }
  catch (e) { SRC_PARSE_ERRORS[f] = e.message; }
}

// ── Context: browser-ish globals the modules expect at load time ──────────
const ctx = {};
ctx.window = ctx;            // modules do `(function(window){…})(window)` and `window.X = …`
ctx.self = ctx;
ctx.console = console;
ctx.SRC_PARSE_ERRORS = SRC_PARSE_ERRORS;
ctx.Math = Math; ctx.Date = Date; ctx.JSON = JSON;
ctx.Object = Object; ctx.Array = Array; ctx.Number = Number; ctx.String = String;
ctx.Boolean = Boolean; ctx.RegExp = RegExp; ctx.Set = Set; ctx.Map = Map;
ctx.Symbol = Symbol; ctx.Error = Error; ctx.Infinity = Infinity; ctx.NaN = NaN;
ctx.isNaN = isNaN; ctx.parseInt = parseInt; ctx.parseFloat = parseFloat;
// mvt.js's Reader.readString decodes tag-value strings with TextDecoder.
ctx.TextDecoder = TextDecoder;
// save.js debounces with setTimeout; tests don't need the flush to fire, so the
// timer is a no-op (persistSave just parks _pendingSave in memory).
ctx.setTimeout = () => 0; ctx.clearTimeout = () => {};
ctx.performance = { now: () => Date.now() };
const _ls = new Map();
ctx.localStorage = {
  getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: (k) => _ls.delete(k),
};
// fog.js base64s its per-tile bitsets through the standard browser codecs.
ctx.btoa = (s) => Buffer.from(s, 'latin1').toString('base64');
ctx.atob = (s) => Buffer.from(s, 'base64').toString('latin1');
ctx.Uint8Array = Uint8Array;
ctx.document = { visibilityState: 'visible', addEventListener() {} };
ctx.addEventListener = () => {};      // window.addEventListener('pagehide', …)
vm.createContext(ctx);

// ── Load the pure / data modules (index.html order, render/app/etc. omitted) ─
const FILES = [
  // The game-mode table — first, because items.js / combat.js / energy.js
  // read Difficulty.get() at call time and app.js pins it at boot.
  'enemy_roster.js', 'enemy_spawns.js', 'enemy_habitats.js', 'difficulty.js',
  'sprite_layout.js',
  'mvt.js', 'util.js', 'particles.js', 'trail.js',
  // Street restoration's arithmetic (pure); beside trail.js, whose ladder it feeds.
  'streets.js',
  // Street variants. Pure (reads WorldGen / Streets at CALL time), before worldgen.js like the page.
  'street_variants.js',
  // Scenic paths, beaches and viewpoints. Pure, after street_variants.js like the page.
  'scenic.js',
  // Influence zones. Pure (reads WorldGen at CALL time), before worldgen.js like the page.
  'zones.js', 'zone_variant_data.js', 'zone_variants.js', 'shrines.js', 'buffs.js', 'zone_coverage.js', 'quarry_layout.js', 'zone_dressing.js', 'reef_layout.js',
  'multiplayer.js', 'placed_floor.js', 'coords.js', 'fog.js', 'biome_profiles.js', 'home.js',
  // Traps — pure (reads WorldGen at CALL time); index.html puts it first, so do we.
  'traps.js',
  // Derelict lairs — pure, reads WorldGen at CALL time like traps.js.
  'lairs.js',
  'dungeon_progression.js', 'elevators.js', 'arena.js', 'worldgen.js', 'save.js',
  'items.js', 'inventory.js', 'energy.js', 'conditions.js', 'player_time.js', 'potion_effects.js', 'crops.js', 'delivery.js', 'save_state.js', 'gear.js', 'rewards.js', 'shops_math.js', 'shops.js', 'egg_hatch.js', 'chest_themes.js', 'rarity.js', 'loot.js',
  // The macro stalls' rules (inn, chapel, apothecary, …). Pure; reads the modules around it at CALL time.
  'macros.js',
  'hidden_objects.js', 'temples.js', 'interactables.js', 'houses.js',
  // The starter-area placers. They read the scene they are handed plus app.js's
  // starter constants as GLOBALS at call time; run.js injects those below (STARTER_CONSTS).
  'spawn_ownership.js', 'starter.js',
  // Fight maths (pure; combat.test.js registers a synthetic monster table).
  'ground_fire.js', 'combat.js', 'pets.js', 'companions.js', 'creature_ai.js', 'npc.js',
  // The wizard tower's offers — pure, so wizard.test.js drives the shipping rules.
  'wizard.js', 'dragon_story.js', 'memory_story.js', 'pet_story_art.js', 'pet_stories.js', 'story_encounters.js',
  'interact.js',
  // The Book curriculum loads after the mechanic owners whose values it teaches.
  'play_tips.js',
  // Pure save-state ladders (castle chain + starter chain), no Phaser/DOM.
  'quests.js',
  // Pure draw math over WorldGen + a stub Graphics, so projection/culling pin without Phaser.
  'road_overlay.js',
  // The POLYGONAL building overlay: pure draw math over WorldGen + a stub fill target.
  'castle_styles.js', 'temple_art.js', 'building_overlay.js',
  // The sandbox's pure tile builder: the same authored scenes, roads and dressing install() uses.
  'sandbox_destinations.js',
  'sandbox.js',
  // render.js reads no globals at load time (see the CANVAS_W comment in
  // drawObjects), so it loads safely and exposes pure helpers (edgeNeedsBorder).
  // The lightmap: only draw() touches Phaser, and no test calls it.
  'lighting.js', 'obstacle_step.js',
  'render.js',
  // The modal shell: its methods are DOM work nobody runs here, but its top
  // level must load with no app.js in scope (as in the page).
  'modal_shell.js',
  // Scene mixins: classes nobody runs here plus
  // literal consts, loaded with no app.js in scope, as in the page.
  'scene_geo.js',
  'scene_creatures.js',
  'scene_fire.js', 'scene_shops.js',
  'scene_create.js', 'scene_consumables.js', 'scene_venues.js', 'scene_streets.js',
];
// Bridge: copy the `const` exports onto the context global so the test files
// (loaded as separate scripts) can reach them by bare name. Functions + IIFE
// `window.X` exports already live on the global.
const BRIDGE = `;Object.assign(globalThis, {
  Arena,
  GroundFire, SceneFire, INTERACTABLES, runInteractable, NPC, SceneModals, DragonStory, MemoryStory, PetStoryArt, PetStories, StoryEncounters, ObstacleStep,
  // The lit boundary's corner rule (coords.js) — read by the plateau fill,
  // the one pass that draws that edge; reach_corners.test.js drives it.
  REACH_CORNER_PX, ReachCorner,
  isToolGated, toolGatedAlpha, TOOL_GATED_ALPHA,
  ITEM_BY_ID, TIER_BY_NUM, SHINY_RATE, MAP_MSG_MAX,
  // Which ground takes a hoe, and the inventory's type tabs.
  NON_TILLABLE, INV_CATS, INV_CAT_BY_KEY,
  toolDurationMs, TOOL_DURATION_MS, TIER_STEP, effectivePickCost, effectiveChopCost,
  treeWoodMul, treeAxeReqTier, treeSpeciesName, treeSizeClass, treeGrowthStage,
  plantedTreeStage, TREE_SAPLING_SCALE_MUL, PLANTED_TREE_GROW_MS, acornDropChance, ACORN_P_BASE, ACORN_P_FROST,
  // The building roof-scale rule — house_scale.test.js asserts against the SHIPPING table.
  houseArtScale, buildingBaseScale, buildingCellsToScale, buildingArt, BUILDING_ART,
  HomeArea, SpawnOwnership,
  itemValue, randInt, pickFromArray, isShiny, faunaShiny,
  TRAILER_SELL_MUL, SELL_MUL,
  // The market-stall sign/stock tables (vendor_parity.test.js).
  POI_CATEGORY, CHEST_DENSITY_T1_AT, CHEST_TIER_UNSTAMPED,
  CHEST_TIER_MAX, CHEST_TIER_DEPTH_STEP, CHEST_TIER_COLOR,
  chestBaseTier, chestTierDepthBonus, ZONE_NEXUS_TIER_BONUS, chestTierZoneBonus, chestTier, chestMirrorsUnderground,
  CRATE_RESTORE_PER, CRATE_RESTORE_MAX_DAYS, crateRestoreDays,
  BARREL_CLASSES, BARREL_ART, BARREL_LOOT, CLAY_POT_LOOT, barrelProfile, barrelLootPool, rollBarrel, isBarrel, barrelFlash,
  POT_COINS_BY_DENSITY, potCoinsFor, isPotOfGold, isBikeRack, bikeRackFlash,
  BIKE_RACK_SPEED_MUL, BIKE_RACK_MS, steerSpeedMul,
  CHEST_CAVE_SKIP_CATEGORIES, produceStandFor, STAND_ITEM_FRAME, STAND_KEYWORD_ITEM, STAND_GENERIC_ITEM,
  STAND_CLASS_ITEM, STAND_NEVER_CLASSES,
  CROP_SPRITE, CROP_ROW, MINERAL_ICON_SHEET, MINERAL_TIERS, CRYSTAL_DEPOSIT, mineralDeposit, mineralRockFrame, mineralBarId,
  // The plain rock's ladder and the GLINT rock built on it — glint_rock.test.js.
  PLAIN_ROCK_FLINT_P, GEM_BY_TIER, GEM_P_BY_TIER, GLINT_ROCK_FINDS, GLINT_ROCK_PERIOD_MS, GLINT_ROCK_SHOW_MS,
  // Baby pets and the nest bush — pet_baby.test.js.
  BABY_KINDS, NEST_BUSH_BEAT,
  MAX_GROWTH_STAGE, PRODUCE_COL,
  // What a WILD plant does when tapped (drop, work relic, cost, bonus, glow);
  // wildplant_table.test.js drives the accessors.
  WILDPLANT_RULES, wildplantRule, wildplantOutput, wildplantWorkRelic,
  wildplantWorkCost, wildplantTreasure, wildplantLight,
  CROPS_SHEET_COLS, SPRING_CROPS_COLS, SEEDBOX_COL,
  TAP_HANDLERS, TERRAIN, TERRAIN_FLAVOR,
  Quests, questEnemies, questAnimals, STARTER_CHAIN,
});`;
try {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'tools/map-review-gameplay.js'), 'utf8'), ctx,
    { filename: 'map-review-gameplay.js' });
  vm.runInContext(FILES.map(readSrc).join('\n;\n') + '\n' + BRIDGE, ctx,
    { filename: 'src-bundle.js' });
} catch (e) {
  console.error('Failed to load source bundle headlessly:\n', e && e.stack || e);
  process.exit(2);
}

// NON_TILLABLE is the contract interact.js' TERRAIN_FLAVOR has to cover — every
// non-tillable terrain code reaches the 'flavor' handler and needs a real label
// instead of a bare '·' (interact_tap.test.js reads the SHIPPING codes).
ctx.NON_TILLABLE_CODES = [...ctx.NON_TILLABLE];

// ── The starter-area module (starter.js) and its app.js constants ─────────
// starter.js holds the starter placers; app.js keeps a one-line wrapper per method
// (`_paintPond(entry, …) { return Starter.paintPond(this, entry, …); }`), and
// the placers call each other THROUGH the scene, so a stub scene carrying the
// wrappers drives the real code. Their constants stay top-level in app.js and
// are read as globals at call time — lifted here, ONCE, from the app.js
// declarations (right-hand side as written: one is derived, some are tables),
// in declaration order so a derived one sees what it derives from.
ctx.STARTER_JS_SRC = readSrc('starter.js');
ctx.CREATURE_AI_SRC = readSrc('creature_ai.js');
{
  // The creature-AI consts and helpers moved to creature_ai.js; look in both.
  const src = SCENE_SRC + '\n' + readSrc('creature_ai.js');
  const STARTER_CONSTS = [
    'VIEW_CELLS', 'CREATURE_SIM_CELLS',
    'HOME_GREETER_MIN_CELLS', 'HOME_GREETER_MAX_CELLS', 'HOME_GREETER_SLACK_CELLS', 'HOME_GREETER_DIR_VEC',
    'PEST_FREE_CELLS', 'STARTER_STASH', 'STARTER_STASH_R_CELLS',
    'HOME_REVEAL_CELLS', 'TRAIL_REVEAL_CELLS', 'NEAR_ROAD_CELLS',
    'POND_MIN_CELLS', 'POND_MAX_CELLS', 'POND_POI_CELLS',
    'STARTER_SMITH_SLOTS', 'STARTER_RELIC_SLOTS', 'STARTER_RELIC_TIER',
  ];
  // Every UPPER_CASE global starter.js reads must be on this list — a
  // constant the moved code picked up later would otherwise only fail on the
  // one test path that reaches it.
  const code = ctx.STARTER_JS_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
  const own = new Set([...code.matchAll(/(?:const|let|var)\s+([A-Z][A-Z0-9_]+)/g)].map(m => m[1]));
  for (const id of new Set(code.match(/(?<![.\w])[A-Z][A-Z0-9_]{2,}\b/g))) {
    if (!own.has(id) && !STARTER_CONSTS.includes(id) && !(id in ctx)) {
      console.error(`starter.js reads ${id}, which run.js does not inject — add it to STARTER_CONSTS`);
      process.exit(2);
    }
  }
  let decls = '';
  for (const name of STARTER_CONSTS) {
    const m = src.match(new RegExp(`^const ${name} = ([\\s\\S]*?);$`, 'm'));
    if (!m) {
      console.error(`Could not find ${name} in src/app.js — update run.js`);
      process.exit(2);
    }
    decls += `globalThis.${name} = ${m[1]};\n`;
  }
  // _starterTrailAnchor reads app.js's boot-time `let _saveHome` (the saved
  // home the projection was anchored on). Headless there is none.
  decls += 'globalThis._saveHome = null;\n';
  vm.runInContext(decls, ctx, { filename: 'app.js#starterConsts' });
}
// The scene's one-line wrapper for a moved starter method, exactly as app.js
// ships it — verified to delegate to Starter.<name>(this, …) with its own
// params in order — so a lift block can hand tests the REAL scene entry point.
const STARTER_WRAPPER_RE = /^  (_(\w+))\(([^)]*)\) \{ return Starter\.(\w+)\(this((?:, [^)]*)?)\); \}$/;
const starterWrapper = (name) => {
  const src = SCENE_SRC;
  const line = src.split('\n').find(l => l.startsWith(`  ${name}(`) && l.includes('return Starter.'));
  const m = line && line.match(STARTER_WRAPPER_RE);
  const want = m && m[2].charAt(0).toLowerCase() + m[2].slice(1);
  const params = m && m[3].split(',').map(x => x.trim()).filter(Boolean).join(', ');
  const args = m && m[5].replace(/^, /, '');
  if (!m || m[4] !== want || params !== args) {
    console.error(`Could not find ${name}'s one-line Starter wrapper in src/app.js — update run.js`);
    process.exit(2);
  }
  return line.slice(2);
};

// The walk-home timings live in app.js too. Lift them the same way, so the
// tests assert on the REAL numbers rather than a copy that would drift.
{
  const src = SCENE_SRC;
  for (const name of ['WALK_HOME_IDLE_MS', 'WALK_HOME_HINT_IDLE_MS', 'WALK_HOME_RAMP_MS',
                      'WALK_HOME_SPEED_MUL',
                      // Read by the REAL _driftHome: walking pace, and the gap
                      // past which a return is placed rather than walked (the
                      // same constant the GPS fix path snaps on).
                      'WALK_M_S', 'GPS_SNAP_M', 'DEBUG_SPEED_MUL',
                      // Read by _steerManual (near-home discount, drain lump).
                      'NEAR_GPS_CELLS', 'NEAR_GPS_COST_MUL', 'STEER_DRAIN_LUMP',
                      // VIEW_CELLS is the ceiling on the fog reveal radius (fog.test.js).
                      'VIEW_CELLS',
                      // CELL_PX: the fog wash is computed at FOG_SUB samples per
                      // cell and upscaled to it (fog_soft.test.js).
                      'CELL_PX',
                      // Starting-neighbourhood reveal radii; fog.test.js checks
                      // they cover the trail the onboarding seater lays.
                      'HOME_REVEAL_CELLS', 'TRAIL_REVEAL_CELLS',
                      // The peek drag's numbers (peek_drag.test.js).
                      'PEEK_MAX_CELLS', 'PEEK_DRAG_SLOP_PX', 'PEEK_RETURN_MS',
                      // The campfire's warmth ring; lighting.js resolves the
                      // fire's light radius to it (lighting.test.js).
                      'FIRE_REST_R',
                      // Within this of the fire's point a body burns
                      // (wanderCreatures' foe block; burning.test.js).
                      'FIRE_TOUCH_CELLS',
                      // Home's ring: light, warmth AND ward (lighting.test.js,
                      // home_ward.test.js).
                      'HOME_R',
                      // Buried X mark density on sand (beach_treasure.test.js).
                      'BEACH_X_PER_CELLS',
                      // The campfire's depth cap on its ward — authored in
                      // app.js since it is the FIRE's rule, not the table's.
                      'FIRE_WARD_MAX_DEPTH']) {
    // parseFloat, not parseInt: WALK_M_S is 1.4, and rounding walking pace to
    // 1 m/s would silently retune every distance the tests below measure.
    const m = src.match(new RegExp(`const ${name} = ([\\d.]+);`));
    if (!m) {
      console.error(`Could not find ${name} in src/app.js — update run.js`);
      process.exit(2);
    }
    ctx[name] = parseFloat(m[1]);
  }
}

// The walk home is BEHAVIOUR: whether a return is walked or placed is decided
// inside _driftHome. Lift the method itself (with the ones it calls) and run it
// on a stub scene, as tools/layout_audit.js does for layOutVertically.
{
  const src = SCENE_SRC;
  const lift = (sig) => {
    const start = src.indexOf('\n  ' + sig);
    // Class methods sit at two-space indent, so the first line exactly `  }` closes the method.
    const end = start < 0 ? -1 : src.indexOf('\n  }\n', start);
    if (start < 0 || end < 0) {
      console.error(`Could not lift ${sig} out of src/app.js — update run.js`);
      process.exit(2);
    }
    return src.slice(start + 1, end + 4);
  };
  const methods = ['_driftHome(dt) {', 'syncMoveTarget() {', '_gpsAwayM() {',
                   // The stick's countdown to that walk — same gates.
                   '_walkHomeCountdownS() {',
                   // The far return PLACES the body (carving the landing cell
                   // underground) — lifted so the cave case runs the real dig.
                   '_placeBodyOnFix() {', '_carveLanding(onlyTile = null) {',
                   // syncMoveTarget snaps the peek camera back after a warp.
                   'clearPeek() {',
                   // The far return uses the fade-to-black cut a jumped fix
                   // uses; a stub scene with no camera exercises its fallback.
                   '_teleportCut(place) {',
                   // Grabbing the stick mid-walk re-anchors target AND offset.
                   '_steerManual(vx, vy, dt) {',
                   // What pauses the debounce (a wheel, a dialog), and the one dialog test.
                   '_walkHomeHeld() {', '_dialogOpen() {']
    .map(lift).join(',\n');
  vm.runInContext(`globalThis.__walkHome = {\n${methods}\n};`, ctx,
                  { filename: 'app.js#_driftHome' });
  for (const k of ['_driftHome', 'syncMoveTarget', '_gpsAwayM', '_walkHomeCountdownS',
                   '_placeBodyOnFix', '_carveLanding', 'clearPeek', '_teleportCut',
                   '_steerManual', '_walkHomeHeld', '_dialogOpen']) {
    if (typeof ctx.__walkHome[k] !== 'function') {
      console.error(`__walkHome.${k} did not come back as a function — update run.js`);
      process.exit(2);
    }
  }
}

// A TRAIL PRIZE is a CHOICE: the card a reward DRAWS as, and the payout when
// kept. Nothing may be granted by the drawing half (the declined option is
// rendered too), so both halves are lifted and run on a stub scene in trail.test.js.
{
  const src = SCENE_SRC;
  const lift = (sig) => {
    const start = src.indexOf('\n  ' + sig);
    const end = start < 0 ? -1 : src.indexOf('\n  }\n', start);
    if (start < 0 || end < 0) {
      console.error(`Could not lift ${sig} out of src/app.js — update run.js`);
      process.exit(2);
    }
    return src.slice(start + 1, end + 4);
  };
  // The card is Rewards.card now; the scene keeps no copy, so the lift wraps it.
  const methods = ['_claimTrailReward(reward, opts = {}) {', '_trailRewardBlurb(reward) {']
    .map(lift).concat(['_trailRewardCard(reward, iconPx = 64) { return Rewards.card(this, reward, iconPx); }']).join(',\n');
  vm.runInContext(`globalThis.__trailPrize = {\n${methods}\n};`, ctx,
                  { filename: 'app.js#_claimTrailReward' });
  for (const k of ['_trailRewardCard', '_claimTrailReward', '_trailRewardBlurb']) {
    if (typeof ctx.__trailPrize[k] !== 'function') {
      console.error(`__trailPrize.${k} did not come back as a function — update run.js`);
      process.exit(2);
    }
  }
}

// HOME IS A CAMPFIRE YOU OWN — one ring (HOME_R) that lights, rests and wards.
// The rest half is a distance test on a real method, so lift it and RUN it.
// homeWorldPos comes with it: all three effects ask it, and its depth gate is
// half the answer.
{
  const src = SCENE_SRC;
  const lift = (sig) => {
    const start = src.indexOf('\n  ' + sig);
    const end = start < 0 ? -1 : src.indexOf('\n  }\n', start);
    if (start < 0 || end < 0) {
      console.error(`Could not lift ${sig} out of src/app.js — update run.js`);
      process.exit(2);
    }
    return src.slice(start + 1, end + 4);
  };
  const methods = ['homeWorldPos() {', 'isRestingAtHome(pWX, pWY) {', 'inHomeRing(x, y) {',
                   '_cropRaidable(p) {']
    .map(lift).join(',\n');
  vm.runInContext(`globalThis.__home = {\n${methods}\n};`, ctx,
                  { filename: 'app.js#homeWorldPos' });
  for (const k of ['homeWorldPos', 'isRestingAtHome', 'inHomeRing', '_cropRaidable']) {
    if (typeof ctx.__home[k] !== 'function') {
      console.error(`__home.${k} did not come back as a function — update run.js`);
      process.exit(2);
    }
  }
}

// THE STREET COUNTER lands on the stretch that came back, so its seating is a
// projection question (the peek drag breaks projections measured off the
// player instead of the camera anchor). Lifted with it: the whole STREET
// SWEEP, so trail.test.js drives the shipping dwell, reach gate and bank.
{
  const src = SCENE_SRC;
  const lift = (sig) => {
    const start = src.indexOf('\n  ' + sig);
    const end = start < 0 ? -1 : src.indexOf('\n  }\n', start);
    if (start < 0 || end < 0) {
      console.error(`Could not lift ${sig} out of src/app.js — update run.js`);
      process.exit(2);
    }
    return src.slice(start + 1, end + 4);
  };
  // _worldToastAt is the ONE world→toast seating the street counter and the
  // energy pops share; _energyPopAt / _cellAtScreen / playerScreen are the
  // energy pop's own placement (energy_pop.test.js).
  const methods = ['_worldToastAt(wmx, wmy, liftPx) {', '_cellToastAt(ix, iy, liftPx) {',
                   '_energyPopAt(ix, iy) {', '_isPlayerCell(ix, iy) {',
                   '_cellAtScreen(sx, sy) {', 'playerScreen() {',
                   '_sweepStreets() {', '_resetStreetSight() {',
                   '_rescanStreets(p, reachM, now, sight) {',
                   '_setStreetPreview(meta, iv) {', '_streetSpreadPts(meta, s0, s1, k) {',
                   '_ripenStreets(now, sight) {', '_oneRoadPay(perLine, now) {',
                   '_roadMetresMul() {', '_offGps() {',
                   '_scenicIntervals(tileKey, lineKey) {',
                   '_scenicWalkStory(kind) {', '_afterRestoreBeat(fn) {',
                   '_bankStreetMetres(addedM, at, now, opts) {', '_showTrailIntro(onDone) {',
                   '_enqueueCeremony(kind, open, { key, hold, defer = false } = {}) {', '_drainCeremonies() {', '_dialogOpen() {',
                   '_visitStreetLamps(now) {', '_markLampsRestored(meta, newly, now) {',
                   '_armTrailIntro(now, st) {', '_openTrailIntroIfDue() {',
                   '_drawStreetLive(now) {',
                   '_blastAt(wmx, wmy, opts) {',
                   '_houseMutter() {']
    .map(lift).join(',\n');
  // Carry app.js constants across as SOURCE TEXT so a retune moves the test with it.
  const constOf = (name) => {
    const m = src.match(new RegExp(`const ${name} = ([^;\n]+);`));
    if (!m) {
      console.error(`Could not lift ${name} out of src/app.js — update run.js`);
      process.exit(2);
    }
    return m[1];
  };
  // A whole (possibly multi-line) `const NAME = …;` declaration, re-bound onto globalThis.
  const declOf = (name) => {
    const start = src.indexOf(`const ${name} = `);
    const end = start < 0 ? -1 : src.indexOf(';\n', start);
    if (start < 0 || end < 0) {
      console.error(`Could not lift the ${name} declaration out of src/app.js — update run.js`);
      process.exit(2);
    }
    return 'globalThis.' + src.slice(start + 'const '.length, end + 1);
  };
  vm.runInContext(
    `globalThis.CELL_PX = ${constOf('CELL_PX')};\n` +
    `globalThis.STREET_COUNTER_LIFT_PX = ${constOf('STREET_COUNTER_LIFT_PX')};\n` +
    `globalThis.PATH_STONE_DWELL_MS = ${constOf('PATH_STONE_DWELL_MS')};\n` +
    `globalThis.ONE_ROAD_WINDOW_MS = ${constOf('ONE_ROAD_WINDOW_MS')};\n` +
    // The sweep's blast, the shine's clock, the preview's ceiling and the counter's throttle.
    `globalThis.BLAST_STONE_R_CELLS = ${constOf('BLAST_STONE_R_CELLS')};\n` +
    `globalThis.STREET_SHINE_MS = ${constOf('STREET_SHINE_MS')};\n` +
    `globalThis.GATHER_SPREAD_POINTS = ${constOf('GATHER_SPREAD_POINTS')};\n` +
    `globalThis.STREET_PREVIEW_ALPHA = ${constOf('STREET_PREVIEW_ALPHA')};\n` +
    `globalThis.STREET_PREVIEW_COLOR = ${constOf('STREET_PREVIEW_COLOR')};\n` +
    `globalThis.STREET_COUNTER_MIN_MS = ${constOf('STREET_COUNTER_MIN_MS')};\n` +
    `globalThis.RESTORE_FX_DELAY_MS = ${constOf('RESTORE_FX_DELAY_MS')};\n` +
    `globalThis.STREET_SHINE_ALPHA = ${constOf('STREET_SHINE_ALPHA')};\n` +
    `globalThis.STREET_FLASH_GAP_MS = ${constOf('STREET_FLASH_GAP_MS')};\n` +
    // The first-repair dialog's copy, so the test reads the shipping sentence.
    `globalThis.TRAIL_INTRO_TITLE = ${constOf('TRAIL_INTRO_TITLE')};\n` +
    // The aside both bare-hands stories close on (barehand_story.test.js).
    `globalThis.BAREHAND_STORY_ASIDE = ${constOf('BAREHAND_STORY_ASIDE')};\n` +
    `globalThis.TRAIL_INTRO_DELAY_MS = ${constOf('TRAIL_INTRO_DELAY_MS')};\n` +
    `globalThis.TRAIL_INTRO_MIN_M = ${constOf('TRAIL_INTRO_MIN_M')};\n` +
    declOf('trailIntroBody') + '\n' +
    // What a house says underfoot (_houseMutter; house_mutter.test.js).
    declOf('HOUSE_WRECK_MUTTERS') + '\n' +
    // What a bare-handed job starts with (_barehandMutter; barehand_story.test.js).
    declOf('BAREHAND_MUTTERS') + '\n' +
    declOf('BAREHAND_MUTTER_TOOLS') + '\n' +
    declOf('HOUSE_RESTORED_MUTTERS') + '\n' +
    // The energy pop's seating, in app.js declaration order (the head
    // clearance reads the three before it).
    `globalThis.PLAYER_FEET_DROP_PX = ${constOf('PLAYER_FEET_DROP_PX')};\n` +
    `globalThis.PLAYER_FRAME_PX = ${constOf('PLAYER_FRAME_PX')};\n` +
    `globalThis.PLAYER_ART_SCALE = ${constOf('PLAYER_ART_SCALE')};\n` +
    `globalThis.ENERGY_POP_LIFT_PX = ${constOf('ENERGY_POP_LIFT_PX')};\n` +
    `globalThis.ENERGY_POP_HEAD_PX = ${constOf('ENERGY_POP_HEAD_PX')};`,
    ctx, { filename: 'app.js#STREET_COUNTER_LIFT_PX' });
  vm.runInContext(`globalThis.__trailCounter = {\n${methods}\n};`, ctx,
                  { filename: 'app.js#_worldToastAt' });
  for (const k of ['_worldToastAt', '_cellToastAt', '_energyPopAt', '_isPlayerCell',
                   '_cellAtScreen', 'playerScreen',
                   '_sweepStreets', '_resetStreetSight', '_rescanStreets',
                   '_setStreetPreview', '_ripenStreets', '_oneRoadPay', '_roadMetresMul', '_offGps',
                   '_scenicIntervals', '_scenicWalkStory',
                   '_afterRestoreBeat', '_bankStreetMetres', '_showTrailIntro', '_enqueueCeremony', '_drainCeremonies', '_dialogOpen',
                   '_armTrailIntro', '_openTrailIntroIfDue',
                   '_drawStreetLive', '_blastAt', '_houseMutter']) {
    if (typeof ctx.__trailCounter[k] !== 'function') {
      console.error(`__trailCounter.${k} did not come back as a function — update run.js`);
      process.exit(2);
    }
  }
}

// The PEEK DRAG: the camera-offset maths plus the pointer-release rule that
// decides tap vs drag, lifted and run on a stub scene like __walkHome above, so
// peek_drag.test.js drives the SHIPPING code (a drag must never also chop the
// tree it slid over).
{
  const src = SCENE_SRC;
  const lift = (sig) => {
    const start = src.indexOf('\n  ' + sig);
    const end = start < 0 ? -1 : src.indexOf('\n  }\n', start);
    if (start < 0 || end < 0) {
      console.error(`Could not lift ${sig} out of src/app.js — update run.js`);
      process.exit(2);
    }
    return src.slice(start + 1, end + 4);
  };
  const methods = ['playerScreen() {', 'isPeeking() {', '_setPeekFromDrag(dxPx, dyPx) {',
                   '_releasePeek() {', 'clearPeek() {', '_tickPeek(dt) {', '_gamePt(p) {']
    .map(lift).join(',\n');
  // The tap-or-drag decision itself, straight out of create()'s input wiring.
  const relSig = '    const endPeekPointer = (p) => {';
  const relStart = src.indexOf(relSig);
  const relEnd = relStart < 0 ? -1 : src.indexOf('\n    };\n', relStart);
  if (relStart < 0 || relEnd < 0) {
    console.error('Could not lift endPeekPointer out of src/app.js — update run.js');
    process.exit(2);
  }
  // _gamePt divides by RENDER_SCALE (a module-level `let` the browser sets).
  // Seed it at 1 so expectations read in game px; the HiDPI cases reassign it.
  ctx.RENDER_SCALE = 1;
  // Rebound as a method so `this` is the stub scene; the body is the shipped text.
  const release = 'endPeekPointer(p) {'
    + src.slice(relStart + relSig.length, relEnd) + '\n  }';
  vm.runInContext(`globalThis.__peek = {\n${methods},\n${release}\n};`, ctx,
                  { filename: 'app.js#peek' });
  for (const k of ['playerScreen', 'isPeeking', '_setPeekFromDrag', '_releasePeek',
                   'clearPeek', '_tickPeek', '_gamePt', 'endPeekPointer']) {
    if (typeof ctx.__peek[k] !== 'function') {
      console.error(`__peek.${k} did not come back as a function — update run.js`);
      process.exit(2);
    }
  }
}

// The monster table, defeat bounty and fauna's blocked terrain live in
// combat.js; republished under bare names so the test files reach them the way
// app.js does.
Object.assign(ctx, {
  MONSTERS: ctx.Combat.MONSTERS,
  isMonster: ctx.Combat.isMonster,
  enemyBounty: ctx.Combat.enemyBounty,
  ENEMY_COIN_PER_HP: ctx.Combat.ENEMY_COIN_PER_HP,
  ENEMY_DEPTH_BONUS: ctx.Combat.ENEMY_DEPTH_BONUS,
  MONSTER_TREASURE_CHANCE: ctx.Combat.MONSTER_TREASURE_CHANCE,
  ELITE_TREASURE_CONTEXT: ctx.Combat.ELITE_TREASURE_CONTEXT,
  eliteRollBonus: ctx.Combat.eliteRollBonus,
  faunaBlocksCell: ctx.Combat.faunaBlocksCell,
});

// The starter-home provisioner (pure grid + save math in starter.js, reached
// through the scene's one-line wrappers); expose those (and _worldPlaced, a
// scene method lifted as text) for a test to .call() with a scene stub.
{
  const src = SCENE_SRC;
  const grab = (head) => {
    const at = src.indexOf(head);
    if (at < 0) {
      console.error(`Could not find ${head.trim()} in src/app.js — update run.js`);
      process.exit(2);
    }
    const bodyStart = at + head.length;
    const end = src.indexOf('\n  }\n', bodyStart);
    if (end < 0) {
      console.error(`Could not find the end of ${head.trim()} — update run.js`);
      process.exit(2);
    }
    return src.slice(bodyStart, end);
  };
  // The starter-home methods are one-line wrappers over starter.js; hand the
  // test the wrappers as shipped. The provision crosses into a SECOND tile
  // stream (a mushroom is a wild plant, not an object), so both halves ride along.
  const homeWrappers = ['_starterHomeObject', '_starterHomeWildplant', '_starterHomeStream',
                        '_provisionStarterHome'].map(starterWrapper);
  // _worldPlaced decides whether a late first GPS fix may still become this
  // save's home origin, reading PROVISIONAL_ORIGIN_KEYS (the pre-capture starter
  // kit, which must NOT count). Lifted with the list for home_capture.test.js.
  const placedBody = grab('  _worldPlaced() {\n');
  const keys = src.match(/const PROVISIONAL_ORIGIN_KEYS = (\[[^\]]*\]);/);
  if (!keys) {
    console.error('Could not find PROVISIONAL_ORIGIN_KEYS in src/app.js — update run.js');
    process.exit(2);
  }
  // The capture path's clearing line (startGps, scene_geo.js), so the test can
  // pin that it clears the SAME list _worldPlaced skips.
  const clear = readSrc('scene_geo.js').match(/for \(const k of PROVISIONAL_ORIGIN_KEYS\) this\.save\[k\] = null;/);
  if (!clear) {
    console.error('The home-capture path no longer clears PROVISIONAL_ORIGIN_KEYS — update run.js');
    process.exit(2);
  }
  vm.runInContext(
    `const PROVISIONAL_ORIGIN_KEYS = ${keys[1]};\n`
    + 'globalThis.PROVISIONAL_ORIGIN_KEYS = PROVISIONAL_ORIGIN_KEYS;\n'
    + 'globalThis.StarterHomeMethods = {\n'
    + homeWrappers.map(w => '  ' + w + ',\n').join('')
    + '  _worldPlaced() {\n' + placedBody + '\n  },\n'
    + '};', ctx, { filename: 'starterHome.js' });
}

// Claiming a castle (a footprint plus turrets, no house object) and its
// once-a-day favour. The claim / key / daily-gate rules are houses.js
// (houses.test.js); the rest and tax live on the scene class, so lift those
// as text for castle_claim.test.js.
{
  const src = SCENE_SRC;
  const grab = (head) => {
    const at = src.indexOf(head);
    if (at < 0) {
      console.error(`Could not find ${head.trim()} in src/app.js — update run.js`);
      process.exit(2);
    }
    const bodyStart = at + head.length;
    const end = src.indexOf('\n  }\n', bodyStart);
    if (end < 0) {
      console.error(`Could not find the end of ${head.trim()} — update run.js`);
      process.exit(2);
    }
    return src.slice(bodyStart, end);
  };
  let decls = '';
  const rest = src.match(/const CASTLE_REST_ENERGY = (\d+);/);
  if (!rest) { console.error('Could not find CASTLE_REST_ENERGY in src/app.js — update run.js'); process.exit(2); }
  decls += `const CASTLE_REST_ENERGY = ${rest[1]};\n`;
  // CASTLE_TAX_GOLD needs no lift: scene_shops.js, in the bundle, declares it.
  vm.runInContext(
    decls
    + 'globalThis.CASTLE_REST_ENERGY = CASTLE_REST_ENERGY;\n'
    + 'globalThis.CASTLE_TAX_GOLD = CASTLE_TAX_GOLD;\n'
    + 'globalThis.CastleMethods = {\n'
    // The scene's one-line wrappers, so _castleRest / _castleTax reach the real rules.
    + '  _castleKey(house) { return Houses.castleKey(house); },\n'
    + '  isCastleClaimed(house) { return Houses.isCastleClaimed(this.save, house); },\n'
    + '  _claimCastle(house) { return Houses.claimCastle(this.save, house); },\n'
    + '  _castleServiceUsed(house) { return Houses.castleServiceUsed(this.save, house); },\n'
    + '  _castleServiceWaitMs(house) { return Houses.castleServiceWaitMs(this.save, house); },\n'
    + '  _markCastleServiceUsed(house) { return Houses.markCastleServiceUsed(this.save, house); },\n'
    + '  _castleRest(sx, sy, house) {\n' + grab('  _castleRest(sx, sy, house) {\n') + '\n  },\n'
    + '  _castleTax(sx, sy, house) {\n' + grab('  _castleTax(sx, sy, house) {\n') + '\n  },\n'
    + '};', ctx, { filename: 'castleClaim.js' });
}

// The tile-block retry backoff (_scheduleTileRetry): without it one bad moment
// at boot left a new player on an empty map for good (tile_retry.test.js).
// Pure timer logic on the SceneGeo mixin, lifted as text with its two constants.
{
  const src = readSrc('scene_geo.js');
  const head = '  _scheduleTileRetry(anyFailed) {\n';
  const at = src.indexOf(head);
  if (at < 0) {
    console.error('Could not find _scheduleTileRetry in src/scene_geo.js — update run.js');
    process.exit(2);
  }
  const bodyStart = at + head.length;
  const end = src.indexOf('\n  }\n', bodyStart);
  if (end < 0) {
    console.error('Could not find the end of _scheduleTileRetry — update run.js');
    process.exit(2);
  }
  // The call site matters: a backoff nothing arms is no backoff.
  if (!/this\._scheduleTileRetry\(anyRetry\)/.test(src)) {
    console.error('ensureTilesAround no longer arms _scheduleTileRetry — update run.js');
    process.exit(2);
  }
  // The consts are already lexical globals (scene_geo.js is bundled): checked, not re-declared.
  for (const n of ['TILE_RETRY_BASE_MS', 'TILE_RETRY_MAX_MS']) {
    const m = src.match(new RegExp(`const ${n} = (\\d+);`));
    if (!m) { console.error(`Could not find ${n} in src/scene_geo.js — update run.js`); process.exit(2); }
    ctx[n] = parseInt(m[1], 10);
  }
  // The classifier that decides WHICH of the three a tile failure was; the
  // banner and the retry both read it (tile_retry.test.js).
  const kindHead = '  _tileFailureKind(err, entry) {\n';
  const kindAt = src.indexOf(kindHead);
  if (kindAt < 0) {
    console.error('Could not find _tileFailureKind in src/scene_geo.js — update run.js');
    process.exit(2);
  }
  const kindEnd = src.indexOf('\n  }\n', kindAt + kindHead.length);
  // The call sites matter: the banner must be the CENTRE tile's verdict
  // alone, and a permanent answer must arm no retry.
  for (const [re, what] of [
    [/const kind = this\._tileFailureKind\(e, entry\);/, 'consult _tileFailureKind'],
    [/if \(kind !== 'permanent'\) anyRetry = true;/, 'skip the retry on a permanent failure'],
    [/if \(kind === 'failed' && k === centreKey\) \{ centreFailed = true; centreWhy = e\.message; \}/, 'banner only on the centre tile'],
    [/this\.showBanner\(centreFailed, centreWhy\);/, 'show the banner from centreFailed'],
  ]) {
    if (!re.test(src)) {
      console.error(`ensureTilesAround no longer appears to ${what} — update run.js`);
      process.exit(2);
    }
  }
  vm.runInContext(
    'globalThis.TILE_RETRY_BASE_MS = TILE_RETRY_BASE_MS;\n'
    + 'globalThis.TILE_RETRY_MAX_MS = TILE_RETRY_MAX_MS;\n'
    + 'globalThis.scheduleTileRetry = function (anyFailed) {\n'
    + src.slice(bodyStart, end) + '\n};\n'
    + 'globalThis.tileFailureKind = function (err, entry) {\n'
    + src.slice(kindAt + kindHead.length, kindEnd) + '\n};',
    ctx, { filename: 'scheduleTileRetry.js' });
}

// The cash-storefront offer path must derive every roll from the shop's hour
// bucket (shopRng), never Math.random, or reopening the modal re-rolls what
// the shop sells. The two method bodies are lifted as text for shops_math.test.js.
{
  const src = SCENE_SRC;
  const grab = (head, mustContain) => {
    const at = src.indexOf(head);
    if (at < 0) {
      console.error(`Could not find ${head.trim()} in src/app.js — update run.js`);
      process.exit(2);
    }
    const bodyStart = at + head.length;
    const end = src.indexOf('\n  }\n', bodyStart);
    if (end < 0) {
      console.error(`Could not find the end of ${head.trim()} — update run.js`);
      process.exit(2);
    }
    const body = src.slice(bodyStart, end);
    if (!mustContain.test(body)) {
      console.error(`${head.trim()} no longer looks like the offer path — update run.js`);
      process.exit(2);
    }
    return body;
  };
  ctx.SHOP_INTERACT_SRC   = grab('  shopInteract(sx, sy, house) {\n', /< 0\.10/);
  ctx.BUILD_SHOP_OFFER_SRC = grab('  buildShopOffer(id, baseValue, opts = {}) {\n', /buyPrice\(/);
}

// The starter plot (_carveStarterPlot) is pure grid math in starter.js behind
// the scene's one-line wrapper; expose the wrapper for a test to .call() with a scene stub.
{
  vm.runInContext(
    `globalThis.carveStarterPlot = ({\n  ${starterWrapper('_carveStarterPlot')}\n})._carveStarterPlot;`,
    ctx, { filename: 'app.js#_carveStarterPlot' });
}

// The fishing pond (_carveStarterPond): a 2x2 of water carved two screens out
// from Home, beside a POI chest when one stands in the band. Hand the test the
// scene's wrappers for it, the painter and the late-anchor sweep
// (starter_pond.test.js).
{
  // spawnInTile is the SceneCreatures mixin's (scene_creatures.js).
  const src = readSrc('scene_creatures.js');
  // The spawn pass has to actually CALL the placer (spawn_rebuild.test.js pins this shape of bug).
  if (!/this\._carveStarterPond\(entry, tx, ty\);/.test(src)) {
    console.error('spawnInTile no longer calls _carveStarterPond — update run.js');
    process.exit(2);
  }
  const methods = ['_carveStarterPond', '_paintPond', '_carveStarterPondAround']
    .map(starterWrapper).join(',\n');
  vm.runInContext(`globalThis.__pond = {\n${methods}\n};`, ctx,
                  { filename: 'app.js#_carveStarterPond' });
  for (const k of ['_carveStarterPond', '_paintPond', '_carveStarterPondAround']) {
    if (typeof ctx.__pond[k] !== 'function') {
      console.error(`__pond.${k} did not come back as a function — update run.js`);
      process.exit(2);
    }
  }
}

// The green starter arrow's per-step target (_starterGuidanceGoal): lifted with
// the helpers it calls so starter_arrow.test.js drives the REAL aiming rules
// (chip step X → the arrow points at X's own space, never a leftover crate fallback).
{
  const src = SCENE_SRC;
  const lift = (sig) => {
    const start = src.indexOf('\n  ' + sig);
    const end = start < 0 ? -1 : src.indexOf('\n  }\n', start);
    if (start < 0 || end < 0) {
      console.error(`Could not lift ${sig} out of src/app.js — update run.js`);
      process.exit(2);
    }
    return src.slice(start + 1, end + 4);
  };
  // The wreck rules are houses.js now; the scene keeps one-line wrappers.
  const methods = ['_starterGuidanceGoal(step) {', '_nearestStarterCrate() {',
    "_nearestObject(pred, { list = 'objects', from = playerWorldM(this) } = {}) {"]
    .map(lift).concat([
      '_isHouseWreck(house) { return Houses.isHouseWreck(this.save, house); }',
      '_wreckRestoreCost(house) { return Houses.wreckRestoreCost(this.save, house); }',
    ]).join(',\n');
  vm.runInContext(`globalThis.__starterArrow = {\n${methods}\n};`, ctx,
                  { filename: 'app.js#_starterGuidanceGoal' });
  for (const k of ['_starterGuidanceGoal', '_nearestStarterCrate', '_nearestObject', '_isHouseWreck', '_wreckRestoreCost']) {
    if (typeof ctx.__starterArrow[k] !== 'function') {
      console.error(`__starterArrow.${k} did not come back as a function — update run.js`);
      process.exit(2);
    }
  }
}

// The pest amnesty (_pestFreeZone): whether a save is still ahead of its first
// harvest and which cells of a tile hold no slime, crow or raven. The spawner's
// use of the zone (which KINDS it re-rolls) can't be lifted, so
// pest_amnesty.test.js pins it against source text handed over here.
{
  const src = readSrc('scene_creatures.js');
  const guard = src.match(/if \(\(kindStr === [^\n]+pestFree[^\n]+(?:continue|return);/);
  if (!guard) {
    console.error('Could not find the pest-free spawner guard in src/scene_creatures.js — update run.js');
    process.exit(2);
  }
  const pump = src.match(/if \(hasRaidableCrop && [^\n]+\{/);
  if (!pump) {
    console.error('Could not find the pest-pump gate in src/scene_creatures.js — update run.js');
    process.exit(2);
  }
  vm.runInContext(
    `globalThis.PEST_FREE_GUARD_SRC = ${JSON.stringify(guard[0])};\n`
    + `globalThis.PEST_PUMP_GATE_SRC = ${JSON.stringify(pump[0])};\n`
    + `globalThis.pestFreeZone = ({\n  ${starterWrapper('_pestFreeZone')}\n})._pestFreeZone;`,
    ctx, { filename: 'app.js#_pestFreeZone' });
}

// The creature SIM BUBBLE (the radius inside which wanderCreatures lets a
// creature think) and the pest pump's deer seating radius. The lines that USE
// them sit in the per-frame loop and can't be lifted, so their source text is
// handed over: creature_sim_range.test.js pins that the cull reads the constant,
// measures from the player (not the camera anchor), and that the spawn radius
// stays between the viewport corner and the bubble.
{
  const src = SCENE_SRC + '\n' + readSrc('creature_ai.js');
  let decls = '';
  for (const name of ['CREATURE_SIM_CELLS', 'PEST_SPAWN_CELLS', 'VIEW_CELLS',
                      // The rout's pace, and the slowest gait it has to move:
                      // home_ward.test.js measures how long the ring takes to
                      // clear in seconds a player would recognise.
                      'FLEE_STRIDE_MUL', 'FLEE_BEAT_MUL']) {
    const m = src.match(new RegExp(`const ${name} = ([^;]+);`));
    if (!m) {
      console.error(`Could not find ${name} in src/app.js — update run.js`);
      process.exit(2);
    }
    decls += `globalThis.${name} = ${m[1]};\n`;
  }
  // The lines live in wanderCreatures (scene_creatures.js), so the feet line
  // is the sim's own and not the first look-alike in app.js.
  const sim = readSrc('scene_creatures.js');
  const cull = sim.match(/const RANGE_M = [^\n]+\n\s*const RANGE_SQ = [^\n]+/);
  const feet = sim.match(/const \{ x: px, y: py \} = playerWorldM\(this\);\n\s*const kerbLeash = [^\n]+/);
  // There are two `const SPAWN_R` in scene_creatures.js (the cave entrance
  // scatter is the other), so take the one in the pump — the last before the
  // pest-deer id.
  const pumpAt = sim.indexOf('`pest_deer_${');
  const spawnAt = pumpAt < 0 ? -1 : sim.lastIndexOf('const SPAWN_R = ', pumpAt);
  const spawn = spawnAt < 0 ? null : [sim.slice(spawnAt, sim.indexOf('\n', spawnAt))];
  if (!cull || !feet || !spawn) {
    console.error('Could not find the creature sim-range lines in src/scene_creatures.js — update run.js');
    process.exit(2);
  }
  vm.runInContext(
    decls
    + `globalThis.CREATURE_CULL_SRC = ${JSON.stringify(cull[0])};\n`
    + `globalThis.CREATURE_FEET_SRC = ${JSON.stringify(feet[0])};\n`
    + `globalThis.PEST_SPAWN_SRC = ${JSON.stringify(spawn[0])};\n`,
    ctx, { filename: 'creatureSimRange.js' });
}

// The spawn relic chest (_placeStarterRelicChest): a treasure chest one screen
// out from the anchor, deciding which wooden relic is inside. Hand the test the
// scene's wrapper so it drives the REAL placer and slot list.
{
  // The trail layer rides along (crates come down ALONG the route the chest
  // placer hands back), and so does the fog lift at the end of it: fog hid the
  // whole trail when it shipped (the walk reveals 3 cells, the seater reaches
  // 15), so starter_relic.test.js checks no crate is laid under fog.
  const fns = {
    placeStarterTrail: '_placeStarterTrail',
    revealStarterTrail: '_revealStarterTrail',
    placeStarterRelicChest: '_placeStarterRelicChest',
  };
  vm.runInContext(Object.entries(fns).map(([g, m]) =>
    `globalThis.${g} = ({\n  ${starterWrapper(m)}\n}).${m};\n`).join(''),
    ctx, { filename: 'app.js#_placeStarterRelicChest' });
}

// The doorstep greeter (_placeHomeGreeter) — the ONE creature guaranteed beside
// the starting trailer, a chicken on easy and a slime on hard. It reads
// Combat.faunaBlocksCell (resolved at CALL time) plus the injected ring constants.
{
  vm.runInContext(
    `globalThis.placeHomeGreeter = ({\n  ${starterWrapper('_placeHomeGreeter')}\n})._placeHomeGreeter;`,
    ctx, { filename: 'app.js#_placeHomeGreeter' });
}

// ── The tile-rebuild contract, lifted from BOTH sides of it ───────────────
// A rebuilt tile (rebuildTileWithBin, in worldgen) is a brand-new entry that
// inherits a hand-picked set of live fields from the one it replaces, and
// app.js decides from the entry alone whether its spawn pass still has to run.
// Those two rules have to agree about which field means "already spawned", and
// nothing in either file says so — spawn_rebuild.test.js reads the contract
// out of these source slices.
{
  const appSrc = SCENE_SRC;
  const wgSrc  = readSrc('worldgen.js');
  const slice = (src, head, endMark, what) => {
    const at = src.indexOf(head);
    if (at < 0) {
      console.error(`Could not find ${what} in src/${head.slice(0, 40)} — update run.js`);
      process.exit(2);
    }
    const from = at + head.length;
    const end = src.indexOf(endMark, from);
    if (end < 0) {
      console.error(`Could not find the end of ${what} — update run.js`);
      process.exit(2);
    }
    return src.slice(from, end);
  };
  // The two lines in _ensureTilesAroundPass (scene_geo.js) that decide whether to spawn.
  ctx.SPAWN_GATE_SRC = slice(readSrc('scene_geo.js'),
    '        // Surface fauna on depth 0; hostile wandering monsters underground.\n',
    '\n        // Re-open any walls', 'the spawn gate');
  const creaturesSrc = readSrc('scene_creatures.js');
  // The pass is a steps generator, so its body holds `yield`s: a test that
  // RUNS a slice builds it with spawnPassFn (below).
  ctx.SPAWN_IN_TILE_SRC      = slice(creaturesSrc, '  *spawnInTileSteps(entry, tx, ty) {\n', '\n  // Cave fauna: hostile', 'spawnInTile');
  vm.runInContext(`globalThis.spawnPassFn = function (body) {
    const GeneratorFunction = Object.getPrototypeOf(function* () {}).constructor;
    const steps = new GeneratorFunction('entry', 'tx', 'ty', body);
    return function (entry, tx, ty) { return WorldGen.runSteps(steps.call(this, entry, tx, ty)); };
  };`, ctx, { filename: 'run.js#spawnPassFn' });
  ctx.SPAWN_CAVE_SRC         = slice(creaturesSrc, '  spawnCaveCreatures(entry, tx, ty, depth) {\n', '\n  // Catch wheel:', 'spawnCaveCreatures');
  ctx.REBUILD_WITH_BIN_SRC   = slice(wgSrc,  '  async function rebuildTileWithBin(x, y, lat) {\n', '\n  }\n', 'rebuildTileWithBin');
  // The trail placer (scene methods read `scene.`, not `this.`); the slice runs to the reveal.
  ctx.STARTER_TRAIL_SRC      = slice(ctx.STARTER_JS_SRC, '  function placeStarterTrail(scene, entry, tx, ty) {\n',
    '\n  function revealStarterTrail', 'the starter trail');
  ctx.ENSURE_STARTER_TRAILER_SRC = slice(appSrc, '  ensureStarterTrailerObject() {\n',
    '\n  }\n\n  // Nothing sits inside the Home trailer.', 'ensureStarterTrailerObject');
  // The sidecar chest injection loop in loadTile (poi_dedup.test.js: it must
  // consult the one-place-one-chest rule before pushing a chest).
  ctx.SX_CHEST_INJECT_SRC    = slice(wgSrc,  'for (const ch of sx.chests) {\n', 'entry.objects.push(ch);', 'the sidecar chest injection');
  // The tree + mineralrock RENDER_SPEC entries (a const inside drawObjects);
  // tool_gate_fade.test.js pins that both `after` hooks use the shared tool-gate fade.
  ctx.RENDER_TREE_ROCK_SPEC_SRC = slice(readSrc('render.js'), '    tree:   { key: (o) => {', '    // STREET VARIANT PROPS', 'the tree/mineralrock render specs');
  // The fruit-tree frame table, its RENDER_SPEC entry and the fruit pass, all
  // inside drawObjects; fruit_overlay.test.js pins as text that the tree's ART
  // never depends on whether it is bearing.
  ctx.RENDER_FRUIT_FRAMES_SRC = slice(readSrc('render.js'),
    '  const FRUIT_FRAMES = {', '};', 'the fruit-tree frame table');
  ctx.RENDER_FRUITTREE_SPEC_SRC = slice(readSrc('render.js'),
    '    fruittree: { key: (o) =>', '    mineralrock: {', 'the fruittree render spec');
  ctx.RENDER_FRUIT_PASS_SRC = slice(readSrc('render.js'),
    '  // ── Ripe fruit ─', '  });', 'the fruit render pass');
}

// ── Wild-crow flee (FINDING 1) + fauna spawn / caught-array fixes (FINDING 2,
// FINDING 3) — slices of scene methods that cannot load headlessly.
{
  const src = SCENE_SRC;
  const creaturesSrc = readSrc('scene_creatures.js');
  const grabBetween = (head, endMark, what) => {
    const at = creaturesSrc.indexOf(head);
    if (at < 0) { console.error(`Could not find ${what} in src/scene_creatures.js — update run.js`); process.exit(2); }
    const from = at + head.length;
    const end = creaturesSrc.indexOf(endMark, from);
    if (end < 0) { console.error(`Could not find the end of ${what} in src/scene_creatures.js — update run.js`); process.exit(2); }
    return creaturesSrc.slice(from, end);
  };

  // raiderEatsCrop is a top-level app.js helper that _cropRaidable calls; lift
  // it verbatim so the lifted bodies resolve for real.
  {
    const m = src.match(/function raiderEatsCrop\(p\) \{ return Crops\.raiderEats\(p\); \}/);
    if (!m) { console.error('Could not find raiderEatsCrop in src/app.js — update run.js'); process.exit(2); }
    vm.runInContext(m[0] + '\n;globalThis.raiderEatsCrop = raiderEatsCrop;', ctx, { filename: 'raiderEatsCrop.js' });
  }

  // FINDING 1 — _wildCrowTick, whole method body, run with a stub `this`
  // (new Function + .call(stub, …), as spawn_rebuild.test.js does).
  ctx.WILD_CROW_TICK_SRC = grabBetween(
    '  _wildCrowTick(c, now, px, py) {\n', '\n  }\n', '_wildCrowTick');

  // FINDING 2 / FINDING 3(b) — the fauna-spawn tryPlace closure (spawnInTile),
  // lifted alone: it is the one piece the findings touch (the roadMask gate,
  // the caughtSet lookup) and its closed-over names are cheap to stub.
  ctx.TRY_PLACE_SRC = grabBetween(
    '    const tryPlace = (classesOK, idx, kindStr) => {\n', '\n    };\n', 'the tryPlace closure');

  // FINDING 3(b), other half — spawnCaveCreatures runs whole via
  // SPAWN_CAVE_SRC, lifted above.

  // FINDING 3(a) — the save.caught pest-deer prune block inside
  // wanderCreatures, lifted alone: it only touches this.depth,
  // this.save.caught, this._lastCaughtPruneT and WorldGen.tileCache/tileKey.
  ctx.CAUGHT_PRUNE_SRC = grabBetween(
    '    // Prune save.caught of pest-deer markers whose tile has since fallen out\n',
    '\n    const caughtSet = setOf(this.save.caught);',
    'the save.caught pest-deer prune block');
}

// ── The bonus buried-X streams (spawnInTile) ──────────────────────────────
// The path-side and beach streams, and the single grid pass that feeds them,
// lifted as ONE runnable block for beach_treasure.test.js: the cap, the cell
// packing (wrong above 256 cells per edge) and the "on the sand, beside the
// path" difference are decided in here. It closes over entry / tx / ty / N /
// rng / ambientSpawnOpts and `this` (tileEdgeM), all cheap to stub.
{
  const appSrc = SCENE_SRC;
  // The grid pass runs AHEAD of the pass's flag (it may still yield); the
  // streams read it further down. Both pieces are lifted and driven as a generator.
  const scanFrom = appSrc.indexOf('    const shoreMask = entry.scenic && entry.scenic.shore ? entry.scenic.shore.mask : null;');
  const scanTo = appSrc.indexOf('    // DERELICT LAIRS need', scanFrom);
  const from = appSrc.indexOf('    // ONE pass over the grid for both bonus streams below');
  const to = appSrc.indexOf('    // Player-planted saplings (save.fruittrees)');
  if (scanFrom < 0 || scanTo < 0 || from < 0 || to < 0 || to < from || scanTo > from) {
    console.error('Could not lift the bonus-X streams from spawnInTile — update run.js');
    process.exit(2);
  }
  vm.runInContext(
    'globalThis.__bonusXMarks = function (entry, tx, ty, N, rng, ambientSpawnOpts) {\n'
    + 'return WorldGen.runSteps((function* () {\n'
    // Locals spawnInTile declares up top: the tile's cell size and generated grid.
    + 'const cellM = this.tileEdgeM / N;\n'
    + 'const genGrid = entry.baseGrid || entry.grid;\n'
    + appSrc.slice(scanFrom, scanTo) + '\n'
    + appSrc.slice(from, to) + '\n}).call(this));\n};', ctx, { filename: 'scene_creatures.js#bonusXMarks' });
}

// The road overlay must stroke with the same width function worldgen stamps its
// no-spawn road mask from (spawn_roads.test.js pins it; the vm has no require/fs).
ctx.ROAD_OVERLAY_SRC = readSrc('road_overlay.js');
ctx.SHOPS_MATH_SRC = readSrc('shops_math.js');
// The building overlay's, for building_overlay.test.js's read-back sweep.
ctx.BUILDING_OVERLAY_SRC = readSrc('building_overlay.js');

// ── The STREET LAMPS' two placement passes (app.js) ───────────────────────
// Where the lamp stones stand is decided by these two methods alone. They reach
// for nothing Phaser-shaped, so street_lamps.test.js drives the SHIPPING passes
// over a real tile entry (text pins missed a lamp list memoised onto a still-
// LOADING tile entry, so no tile ever grew a lamp).
{
  const appSrc = SCENE_SRC;
  const a = appSrc.indexOf('  _streetLampsForTile(tx, ty, entry) {');
  const b = appSrc.indexOf('  // The lamps near the frame');
  const c = appSrc.indexOf('  _updateStreetLamps() {');
  const d = appSrc.indexOf('  // THE RIPEN PASS.');
  if (a < 0 || b < 0 || c < 0 || d < 0 || b < a || d < c) {
    console.error('Could not lift the street-lamp passes from src/app.js — update run.js');
    process.exit(2);
  }
  // The verge seat's constants, lifted rather than retyped: each stone stands
  // off the centreline by STREET_LAMP_R_CELLS x the tile's cell, derived from
  // the two arts a lamp can wear.
  for (const name of ['STREET_LAMP_DARK_CELLS', 'STREET_LAMP_R_CELLS']) {
    const m = appSrc.match(new RegExp(`\nconst ${name} = [\\s\\S]*?;\n`));
    if (!m) {
      console.error(`Could not lift ${name} from src/app.js — update run.js`);
      process.exit(2);
    }
    vm.runInContext(m[0], ctx, { filename: `app.js#${name}` });
  }
  vm.runInContext('globalThis.__streetLampPasses = {\n'
    + appSrc.slice(a, b).trimEnd() + ',\n'
    + appSrc.slice(c, d).trimEnd() + '\n};', ctx, { filename: 'app.js#streetLamps' });
}

// app.js can't load headlessly (it needs Phaser), so the perf-profiler hooks
// there (update()/drawCells/drawObjects ticks, 'phaser render' wiring,
// window.__boot.device) are pinned as source text, as are the border-crossing
// stamp and fog-paint tick inside Render.drawCells (no Graphics-shaped scene
// fixture exists). See boot_profiler.test.js.
ctx.APP_JS_SRC = readSrc('app.js');
ctx.SANDBOX_JS_SRC = readSrc('sandbox.js');
ctx.SCENE_SRC = SCENE_SRC;
// The scene's modules by file (app.js first, then each installed mixin's) —
// scene_mixins.test.js pins that index.html loads every one before app.js.
ctx.SCENE_FILES = SCENE_FILES;
// The modal shell (makeModalShell, stock dialogs, MODAL_KINDS, scene-art frame consts).
ctx.MODAL_SHELL_SRC = readSrc('modal_shell.js');
// The scene's geography (startGps, sensors, ensureTilesAround, tile retry, dumpTileDebug).
ctx.SCENE_GEO_SRC = readSrc('scene_geo.js');
// The scene's creatures (spawning, wanderCreatures, crow tick, catch wheel).
ctx.SCENE_CREATURES_SRC = readSrc('scene_creatures.js');
// Every module's text, for sweeps across the whole tree (lexical_globals.test.js).
ctx.ALL_SRC = Object.fromEntries(fs.readdirSync(path.join(ROOT, 'src'))
  .filter(f => f.endsWith('.js')).map(f => [f, readSrc(f)]));

// ── wanderCreatures, lifted and RUN ───────────────────────────────────────
// The creature sim is a huge scene method, so a regex pin cannot tell you that
// a guard actually leaves its seat, closes the distance, turns round at the
// leash and lands back on its spot (the lair chase once shipped with its state
// machine tested and its movement loop not).
//
// So it is lifted like _driftHome: the REAL method text plus the top-level
// constants and helpers it closes over, evaluated into one function the tests
// call on a stub scene.
{
  // Consts and helpers live in app.js, creature_ai.js and scene_creatures.js; look in all three.
  const src = SCENE_SRC + '\n' + readSrc('creature_ai.js') + '\n' + readSrc('scene_creatures.js');
  const num = (name) => {
    const m = src.match(new RegExp(`const ${name} = ([-\\d.]+);`));
    if (!m) { console.error(`Could not lift ${name} for __wander — update run.js`); process.exit(2); }
    return `const ${name} = ${m[1]};`;
  };
  // A top-level function by its signature line: the whole line when it is a
  // one-liner, otherwise through the `}` that closes it at column 0.
  const fn = (sig) => {
    const i = src.indexOf('\n' + sig);
    if (i < 0) { console.error(`Could not lift ${sig} for __wander — update run.js`); process.exit(2); }
    const lineEnd = src.indexOf('\n', i + 1);
    const line = src.slice(i + 1, lineEnd);
    if (line.trimEnd().endsWith('}')) return line;
    const close = src.indexOf('\n}\n', i);
    if (close < 0) { console.error(`Could not find the end of ${sig} — update run.js`); process.exit(2); }
    return src.slice(i + 1, close + 2);
  };
  const start = src.indexOf('  wanderCreatures() {');
  const end = src.indexOf('\n  }\n', start);
  if (start < 0 || end < 0) {
    console.error('Could not lift wanderCreatures out of src/scene_creatures.js — update run.js');
    process.exit(2);
  }
  const method = src.slice(start + 2, end + 4);
  const preamble = [
    // The numbers the loop reads. Lifted, never retyped: a retune has to move
    // the simulation with it or these tests are measuring last week's game.
    num('CREATURE_SIM_CELLS'), num('SURFACE_RECHECK_MS'), num('FIRE_WARD_MAX_DEPTH'), num('WANDER_STEP_MS'),
    num('STALK_JITTER'),
    num('PEST_SPAWN_CELLS'), num('STRUCK_REACTION_MS'),
    // The struck-prey flee and Home's rout both run at this pair.
    num('FLEE_STRIDE_MUL'), num('FLEE_BEAT_MUL'),
    // The wander-off schedule, distance and timeout (wander_off.test.js).
    num('WANDER_OFF_MIN_MS'), num('WANDER_OFF_SPREAD_MS'), num('WANDER_OFF_MAX_MUL'),
    num('WANDER_OFF_TIMEOUT_MS'), num('WANDER_OFF_TICK_CAP_MS'),
    // The predicates. (faunaBlocksCell is Combat's, already loaded.)
    fn('function slimeCharging(c) {'),
    fn('function monsterRout(c, now, cellM) {'),
    fn('function monsterWanderingOff(c, now, distM, cellM) {'),
    fn('function wardTrip(c, homePos, castleWards, r2) {'),
    // The ghosts: the night pump and the mover.
    num('GHOST_DARK_DAYLIGHT'),
    'const GHOST_SPAWN_MS = EnemyRoster.GHOST_SCALING.cadenceSeconds * 1000;',
    'const GHOST_SPAWN_JITTER_MS = EnemyRoster.GHOST_SCALING.jitterSeconds * 1000;',
    num('GHOST_GROUP_SPREAD'),
    num('GHOST_SPAWN_DARK'), num('GHOST_HOVER_MS'), num('GHOST_TOUCH_CELLS'),
    num('GHOST_PLATEAU_BURN_S'), num('GHOST_LIGHT_TICK_MS'), num('GHOST_LIFETIME_MS'),
    fn('function ghostSpawnDelay(r) {'),
    fn('function ghostSunExposure(day) {'),
    fn('function ghostsHaunt(depth, day, habitat) {'),
    fn('function ghostSpawnPass(scene, now, px, py, pcW, homePos, castleWards, wardR2, caughtSet) {'),
    fn('function makeGhost(x, y, now, tx, ty, tag) {'),
    fn('function raiseGhostAt(scene, x, y, now, tag) {'),
    fn('function fireWardTrip(scene, c) {'),
    fn('function ghostTick(scene, c, now, px, py, unnoticed, warded, pace) {'),
    // The fished slime: a cast's slime, seated beside the player, angry.
    fn('function fishedSlimeSpawn(scene, now, px, py, pcW) {'),
  ].join('\n');
  // ONE script, so the method closes over the preamble's consts — a second
  // runInContext would not see them (a vm script's top-level `const` does not
  // land on the context global; that is what the BRIDGE above exists for).
  // The method text is a class method, so it is wrapped as an object literal
  // and the property taken off it.
  vm.runInContext(`(function () {\n${preamble}\nglobalThis.__wander = ({\n${method}\n}).wanderCreatures;\nglobalThis.__monsterWanderingOff = monsterWanderingOff;\nglobalThis.__wardTrip = wardTrip;\nglobalThis.__ghostTick = ghostTick;\nglobalThis.__ghostSpawnPass = ghostSpawnPass;\nglobalThis.__raiseGhostAt = raiseGhostAt;\nglobalThis.__fishedSlimeSpawn = fishedSlimeSpawn;\nconst surfaceGhosts = EnemyRoster.ghostProfile(0);\nglobalThis.__ghost = { GHOST_DARK_DAYLIGHT, ghostsHaunt, ghostSunExposureAt, GHOST_SPAWN_MS, GHOST_SPAWN_JITTER_MS, GHOST_GROUP_MIN: surfaceGhosts.groupMin, GHOST_GROUP_MAX: surfaceGhosts.groupMax, GHOST_NEAR_MAX: surfaceGhosts.nearMax, GHOST_SPAWN_DARK, GHOST_HOVER_MS, GHOST_TOUCH_CELLS, GHOST_PLATEAU_BURN_S, GHOST_LIGHT_TICK_MS, GHOST_LIFETIME_MS, ghostSunExposure, ghostSpawnDelay };\n})();`,
    ctx, { filename: 'scene_creatures.js#wanderCreatures' });
  if (typeof ctx.__wander !== 'function') {
    console.error('__wander did not come back as a function — update run.js');
    process.exit(2);
  }
}
// The burst call sites in interact.js's crop handler are pinned as source text (particles.test.js).
ctx.INTERACT_JS_SRC = readSrc('interact.js');
// Item descriptions and the Book curriculum are prose the tests sweep as
// source. An icon's PNG has to match its ICON_SHEETS row; pngDims reads its IHDR.
ctx.ITEMS_JS_SRC = readSrc('items.js');
ctx.PLAY_TIPS_JS_SRC = readSrc('play_tips.js');
ctx.pngDims = (rel) => {
  const p = path.join(ROOT, rel.replace(/\?.*$/, ''));
  if (!fs.existsSync(p)) return null;
  const b = fs.readFileSync(p);
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
// The dialog paintings ship as WebP (assets/art/*.webp, tools/gen_story_art.js).
// Reads the canvas size off the RIFF header: VP8X (extended), VP8L (lossless)
// or VP8 (lossy) — null for anything that is not a WebP.
ctx.webpDims = (rel) => {
  const p = path.join(ROOT, rel.replace(/\?.*$/, ''));
  if (!fs.existsSync(p)) return null;
  const b = fs.readFileSync(p);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (chunk === 'VP8L') {
    const v = b.readUInt32LE(21);
    return { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  return null;
};
// index.html MEASURES the screen (the CSS scale app.js sizes the canvas from is
// published by its fitGame); canvas_scale.test.js pins the two halves together.
ctx.INDEX_HTML_SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// The browser harness page: harness_scripts.test.js pins its script list against
// index.html's (a missing module once took the whole browser suite dark).
ctx.HARNESS_HTML_SRC = fs.readFileSync(path.join(ROOT, 'test/harness.html'), 'utf8');
// The Kelowna 3×3 MVT fixture tiles (test/fixtures/<tx>_<ty>.pbf), raw bytes
// keyed '<tx>_<ty>' — the vm has no fs. zones.test.js decodes them (MVT) to
// pin the influence-zone field's seam determinism on real OpenFreeMap data.
ctx.FIXTURE_TILES = {};
for (const f of fs.readdirSync(path.join(ROOT, 'test', 'fixtures')).filter((n) => /^\d+_\d+\.pbf$/.test(n))) {
  ctx.FIXTURE_TILES[f.replace('.pbf', '')] = new Uint8Array(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', f)));
}
// The canvas-resolution rule (app.js, beside W/H), lifted for canvas_scale.test.js.
{
  const m = ctx.APP_JS_SRC.match(/const RENDER_SCALE_MAX = \d+;[\s\S]*?\nfunction renderScale\(\) \{[\s\S]*?\n\}/);
  if (!m) {
    console.error('Could not lift renderScale() out of src/app.js — update run.js');
    process.exit(2);
  }
  vm.runInContext(m[0], ctx, { filename: 'app.js#renderScale' });
}
ctx.RENDER_SRC = readSrc('render.js');
// textures.js loads headlessly in its OWN context (its constants share names
// with the stubs above); tilled_bed.test.js runs drawTilledTex against a recording 2D context.
ctx.TILLED_TEX = (() => {
  const c = vm.createContext({ window: { addEventListener() {} }, console });
  vm.runInContext(readSrc('util.js') + '\n' + readSrc('textures.js')
    + '\nglobalThis.__x = { drawTilledTex, seededRand, TILLED_INSET_PX, TILLED_CORNER_PX, TILLED_VARIANTS, TILLED_COLOR };',
    c, { filename: 'textures.js#tilled' });
  return c.__x;
})();
// textures.js as TEXT: traps.test.js pins that both trap textures are baked one cell square off TRAP_PX.
ctx.TEXTURES_SRC = readSrc('textures.js');
// The trap art, in its own context like TILLED_TEX; these makers take a SCENE,
// so traps.test.js hands them a stub whose createCanvas returns a recording 2D context.
ctx.TRAP_TEX = (() => {
  const c = vm.createContext({ window: { addEventListener() {} }, console });
  vm.runInContext(readSrc('util.js') + '\n' + readSrc('textures.js')
    + '\nglobalThis.__x = { makeHiddenTrapTexture, makeSprungTrapTexture, makeTrapTextures, TRAP_PX };',
    c, { filename: 'textures.js#traps' });
  return c.__x;
})();
// The texture catalog as text (assets.js is Phaser-loader data, not bundled).
ctx.ASSETS_SRC = readSrc('assets.js');
// lighting.test.js pins the compositing model (ADD cookies, MULTIPLY map) as text.
ctx.LIGHTING_SRC = readSrc('lighting.js');
// reach_corners.test.js pins the lit boundary's corner radius as coords.js' one number.
ctx.COORDS_SRC = readSrc('coords.js');
// multiplayer.js seats peers like the local player; feet_anchor.test.js pins both as text.
ctx.MULTIPLAYER_SRC = readSrc('multiplayer.js');
ctx.INTERACT_SRC = readSrc('interact.js');
ctx.WORLDGEN_SRC = readSrc('worldgen.js');   // map_review.test.js (the review salt)
ctx.GAME_LOADER_SRC = fs.readFileSync(path.join(ROOT, 'tools', 'game-loader.js'), 'utf8');   // map_review.test.js
// The dialog-painting generator (scene_art.test.js).
ctx.ART_THUMBS_SRC = readSrc('art_thumbs.js');
ctx.MODAL_SHELL_SRC_TEXT = readSrc('modal_shell.js');
ctx.STORY_ART_GEN_SRC = fs.readFileSync(path.join(ROOT, 'tools', 'gen_story_art.js'), 'utf8');
// chest_tier.test.js pins that the chest loot roll resolves the tier WITH the chest position.
ctx.INTERACTABLES_SRC = readSrc('interactables.js');
ctx.GEAR_JS_SRC = readSrc('gear.js');
// tile_url.test.js pins that the only raw tile fetch in worldgen.js goes through the resolver.
ctx.WORLDGEN_SRC = readSrc('worldgen.js');
ctx.QUARRY_LAYOUT_SRC = readSrc('quarry_layout.js');   // cave_barrels.test.js
// wildplant_table.test.js pins that no per-crop treasure list grows back in loot.js
// (items.js' WILDPLANT_RULES owns it).
ctx.LOOT_SRC = readSrc('loot.js');

// ── Countdown notation: the source of every file that owns a timed readout ──
// duration_notation.test.js sweeps these for hand-rolled "${n}m" / "${n}h"
// ladders and unquantified "tomorrow" / "later" copy (the labels live in
// methods that can't be called headlessly). A file that grows a new countdown
// belongs in this map.
ctx.DURATION_SOURCES = {
  'app.js': readSrc('app.js'),
  'scene_create.js': readSrc('scene_create.js'),
  'scene_consumables.js': readSrc('scene_consumables.js'),
  'scene_venues.js': readSrc('scene_venues.js'),
  'scene_streets.js': readSrc('scene_streets.js'),
  'scene_creatures.js': readSrc('scene_creatures.js'),
  'interact.js': readSrc('interact.js'),
  'interactables.js': readSrc('interactables.js'),
  'render.js': readSrc('render.js'),
  'shops_math.js': readSrc('shops_math.js'),
  'util.js': readSrc('util.js'),
};

// ── Energy writes: every src module's text, keyed by file name ────────────
// energy_int.test.js sweeps these for a raw `.energy =` write that bypasses
// Energy.set, the one writer that keeps the bar a whole number.
ctx.ENERGY_WRITE_SOURCES = Object.fromEntries(
  fs.readdirSync(path.join(ROOT, 'src')).filter((n) => n.endsWith('.js'))
    .map((n) => [n, readSrc(n)]));

// ── In-context test framework: test() / assert / makeScene ────────────────
vm.runInContext(`
  globalThis.__tests = [];
  globalThis.test = (name, fn) => __tests.push({ name, fn });
  globalThis.assert = {
    eq(a, b, m)      { if (a !== b)              throw new Error((m||'eq')+': expected '+JSON.stringify(b)+', got '+JSON.stringify(a)); },
    truthy(v, m)     { if (!v)                   throw new Error((m||'truthy')+': got '+JSON.stringify(v)); },
    falsy(v, m)      { if (v)                    throw new Error((m||'falsy')+': got '+JSON.stringify(v)); },
    gt(a, b, m)      { if (!(a > b))             throw new Error((m||'gt')+': '+a+' !> '+b); },
    gte(a, b, m)     { if (!(a >= b))            throw new Error((m||'gte')+': '+a+' !>= '+b); },
    lt(a, b, m)      { if (!(a < b))             throw new Error((m||'lt')+': '+a+' !< '+b); },
    lte(a, b, m)     { if (!(a <= b))            throw new Error((m||'lte')+': '+a+' !<= '+b); },
    inRange(v, lo, hi, m) { if (v < lo || v > hi) throw new Error((m||'inRange')+': '+v+' not in ['+lo+','+hi+']'); },
    includes(arr, v, m)   { if (!arr || !arr.includes(v)) throw new Error((m||'includes')+': '+JSON.stringify(v)+' not in '+JSON.stringify(arr)); },
  };
  // Minimal scene stub: records inventory, swallows UI calls, and runs the work
  // wheel synchronously (startWorkProgress fires its callback at once).
  globalThis.makeScene = (over = {}) => {
    const inv = {};
    const s = {
      _inv: inv,
      brokenRockSet: new Set(),
      addToInv: (id, n = 1) => { inv[id] = (inv[id] || 0) + n; },
      invCount: (id) => inv[id] || 0,
      spendEnergy: () => true,
      startWorkProgress: (x, y, cb) => { if (cb) cb(); },
      flash: () => {}, flashAtWorld: () => {}, flashLoot: () => {}, flashJackpot: () => {},
      awardShinyBonus: () => {},
      shopInteract: () => {}, shrineInteract: () => {},
      showChestRewardModal: () => {}, iconSpanHTML: () => '', gearIconHTML: () => '',
      invRoomFor: () => Infinity, _coinBurstInteract: () => {},
    };
    return Object.assign(s, over);
  };
  // Build a ctx the tap-driver expects (scene + save + screen coords).
  // The live save is seeded by SaveState.normalize at boot (SAVE_DEFAULTS);
  // a test's bare save is seeded here the same way.
  globalThis.makeCtx = (scene, save) => ({ scene, save: SaveState.defaults(save), sx: 0, sy: 0, dirty: false });
`, ctx, { filename: 'framework.js' });

// ── Load every *.test.js in this directory into the same context ──────────
const testFiles = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort();
for (const f of testFiles) {
  try {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
  } catch (e) {
    console.error(`Failed to load ${f}:\n`, e && e.stack || e);
    process.exit(2);
  }
}

// ── Wooden relic art (the spawn relic chest's pool) ───────────────────────
// Each STARTER_RELIC_SLOTS slot is a WOODEN relic only if tier-1 art exists for
// it: a claim about files on disk, checked here in node scope (the vm has no fs).
{
  for (const slot of (ctx.STARTER_RELIC_SLOTS || [])) {
    ctx.__tests.push({ name: `spawn relic chest: wooden art ships for ${slot}`, fn: () => {
      const rel = ctx.gearAssetPath('relic', slot, ctx.STARTER_RELIC_TIER);
      if (!rel) throw new Error(`no gear asset path for relic/${slot}/T${ctx.STARTER_RELIC_TIER}`);
      if (!/1\. Wood/.test(rel)) throw new Error(`${slot} T1 art is not wooden-tier art: ${rel}`);
      if (!fs.existsSync(path.join(ROOT, rel))) throw new Error(`missing art file: ${rel}`);
    } });
  }
}

// ── Restore cards' paintings (houses.js BUILD_OPTIONS) ────────────────────
// Every card a wreck can be restored as names the painting its Restored!
// card opens on; a missing file is a blank banner. Files on disk, so node scope.
{
  for (const row of (ctx.Houses?.BUILD_OPTIONS || [])) {
    ctx.__tests.push({ name: `build options: ${row.key} painting ships (${row.art})`, fn: () => {
      const rel = path.join('assets', 'art', row.art + '.webp');
      if (!fs.existsSync(path.join(ROOT, rel))) throw new Error(`missing art file: ${rel}`);
    } });
  }
}

// ── Work-wheel tool art (app.js _setWorkProgressIcon / _toolTexture) ─────
// Every tool a wheel can be started with must ship art at every tier (a missing
// PNG is a wheel with an empty middle). Checked in node scope.
{
  for (const slot of ['axe', 'net', 'hoe', 'pickaxe', 'fishing_rod', 'sword']) {
    ctx.__tests.push({ name: `work wheel: ${slot} art ships at every tier`, fn: () => {
      for (const tier of Object.keys(ctx.TIER_BY_NUM || {}).map(Number)) {
        const rel = ctx.gearAssetPath('relic', slot, tier);
        if (!rel) throw new Error(`no gear asset path for relic/${slot}/T${tier}`);
        if (!fs.existsSync(path.join(ROOT, rel))) throw new Error(`missing art file: ${rel}`);
      }
    } });
  }
}

// The editable table and the shipped browser module must always agree.
ctx.__tests.push({ name: 'zone variants: generated browser data matches the canonical table', fn: () => {
  const expected = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/zone-variants.json'), 'utf8'));
  if (JSON.stringify(ctx.ZoneVariantData) !== JSON.stringify(expected)) {
    throw new Error('Zone data is stale; run node tools/zone_variant_data.js --write');
  }
} });

// ── Sprite-position rule (tools/sprite_audit.js) ──────────────────────────
// A non-compliant sprite, or a stale ART_BOUNDS table in src/sprite_layout.js,
// fails CI. The audit decodes real PNGs, so it runs in node scope; each
// scenario becomes one test case.
{
  const audit = require('../../tools/sprite_audit.js');
  for (const sc of audit.SCENARIOS) {
    ctx.__tests.push({ name: `sprite seat (one-cell rule): ${sc.name}`, fn: () => {
      const r = audit.evaluate(sc);
      if (r.error) throw new Error(r.error);
      if (r.violations.length) throw new Error(r.violations.join('; '));
    } });
  }
  // Creatures skip the seat rule but own the wheel crown rule.
  for (const kind of Object.keys(audit.CREATURE_SHEETS)) {
    ctx.__tests.push({ name: `creature wheel (crown rule): ${kind}`, fn: () => {
      const r = audit.evaluateCreature(kind);
      if (r.violations.length) throw new Error(r.violations.join('; '));
    } });
  }
  // Every opted-in direction/state must address real artwork, not blank
  // packing cells. Check decoded source art once per texture sheet.
  const directionalSheets = new Set();
  const layout = require('../../src/sprite_layout.js');
  for (const art of [...Object.values(layout.CREATURE_ART), ...Object.values(layout.PLAYER_ART)]) {
    if (!art.directions || directionalSheets.has(art.sheet)) continue;
    directionalSheets.add(art.sheet);
    ctx.__tests.push({ name: `actor directional art: ${art.sheet}`, fn: () => {
      const sheet = audit.ASSETS[art.sheet];
      const image = audit.loadPng(sheet.path);
      const frames = new Set(Object.values(art.directions).flatMap(states => Object.values(states).flat()));
      for (const frame of frames) {
        const ink = audit.frameInk(image, sheet.frameWidth, sheet.frameHeight, frame);
        if (!ink || !ink.opaque || ink.colours < 2) throw new Error(`${art.sheet} frame ${frame} has no complete artwork`);
      }
    } });
  }
  // Fruit-tree crowns, re-derived from the PNGs, so repainted art can't leave
  // fruit stuck on a trunk or floating over the canopy.
  for (const r of audit.evaluateCrowns()) {
    ctx.__tests.push({ name: `fruit-tree crown: ${r.lookup}`, fn: () => {
      if (r.violations.length) throw new Error(r.violations.join('; '));
    } });
  }
  // Every frame a wildplant DECLARES has to carry art: a blank frame ships a
  // pickup the player can tap but not see (see shell_variants.test.js).
  for (const r of audit.wildFrameRows()) {
    ctx.__tests.push({ name: `wildplant frame: ${r.name}`, fn: () => {
      if (r.violations.length) throw new Error(r.violations.join('; '));
    } });
  }
  ctx.__tests.push({ name: 'wildplant frames: Shell.png retains only the original pink shell', fn: () => {
    const sheet = audit.ASSETS.shell_sheet, img = audit.loadPng(sheet.path);
    const ink = f => audit.frameInk(img, sheet.frameWidth, sheet.frameHeight, f);
    if (!ink(0).opaque || ink(0).colours < 2) throw new Error('original shell art is missing');
    for (let f = 1; f < 12; f++) {
      if (ink(f).opaque !== 0) throw new Error(`unused shell duplicate frame ${f} was not removed`);
    }
  } });
}

// ── App-shell audit (tools/shell_audit.js) ────────────────────────────────
// File-level checks that index.html and sw.js agree about what the app is made of.
{
  const shell = require('../../tools/shell_audit.js');
  for (const c of shell.CHECKS) ctx.__tests.push({ name: c.name, fn: c.run });
}

// Cache lifecycle checks use the real worker with isolated network and storage.
{
  const worker = require('../../tools/service_worker_checks.js');
  for (const c of worker.CHECKS) ctx.__tests.push({ name: c.name, fn: c.run });
}

// ── Cache-bust audit (tools/cachebust.js) ─────────────────────────────────
// Every module's ?v= is a hash of its bytes, so a changed file cannot be served
// stale beside a fresh app.js ("Combat.playerDowned is not a function").
{
  const cachebust = require('../../tools/cachebust.js');
  for (const c of cachebust.CHECKS) ctx.__tests.push({ name: c.name, fn: c.run });
}

// ── Vertical-layout audit (tools/layout_audit.js) ─────────────────────────
// Lifts fitGame's budget out of index.html and checks it against real device
// sizes (map clears both chrome stacks, stick covers neither inventory nor
// player, no big empty band).
{
  const layout = require('../../tools/layout_audit.js');
  for (const c of layout.CHECKS) ctx.__tests.push({ name: c.name, fn: c.run });
}

// ── Viewport-vignette audit (tools/vignette_audit.js) ─────────────────────
// The map's rim fades differently per axis: top and bottom keep a near-opaque
// lip (stops overhanging art being sliced mid-pixel); left and right, the phone's
// screen edges, get the soft ramp alone (no black side bars).
{
  const vignette = require('../../tools/vignette_audit.js');
  for (const c of vignette.CHECKS) ctx.__tests.push({ name: c.name, fn: c.run });
}

// ── Offer-modal audit (tools/modal_audit.js) ──────────────────────────────
// Scans app.js for showOfferModal callers that fill BOTH halves of the dialog
// with the same text (the castle quest board once printed its progress twice).
{
  const modal = require('../../tools/modal_audit.js');
  for (const c of modal.CHECKS) ctx.__tests.push({ name: c.name, fn: c.run });
}

// ── Display-layer audit (tools/layer_audit.js) ────────────────────────────
// Phaser draws in insertion order, so create()'s sequence IS the z-order.
// Pins the layers whose stacking carries meaning: the lighting layer must
// cover every ground layer (or the out-of-reach dim can't darken the biome
// seams) and stay below the sprites.
{
  const layers = require('../../tools/layer_audit.js');
  for (const c of layers.CHECKS) ctx.__tests.push({ name: c.name, fn: c.run });
}

// ── Run + report ──────────────────────────────────────────────────────────
(async () => {
  let pass = 0, fail = 0;
  for (const t of ctx.__tests) {
    try {
      await t.fn();
      console.log('  ✓ ' + t.name);
      pass++;
    } catch (e) {
      console.log('  ✗ ' + t.name);
      const lines = String((e && e.stack) || e).split('\n').slice(0, 4);
      for (const ln of lines) console.log('      ' + ln);
      fail++;
    }
  }
  console.log(`\n${pass} passed, ${fail} failed (${ctx.__tests.length} total)`);
  process.exit(fail ? 1 : 0);
})();
