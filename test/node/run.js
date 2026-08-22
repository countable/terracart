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

// ── Context: browser-ish globals the modules expect at load time ──────────
const ctx = {};
ctx.window = ctx;            // modules do `(function(window){…})(window)` and `window.X = …`
ctx.self = ctx;
ctx.console = console;
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
  'sprite_layout.js',
  'mvt.js', 'util.js', 'placed_floor.js', 'coords.js', 'fog.js', 'biome_profiles.js', 'home.js', 'worldgen.js', 'save.js',
  'items.js', 'inventory.js', 'energy.js', 'crops.js', 'delivery.js', 'savemigrate.js', 'gear.js', 'shops_math.js', 'shops.js', 'rarity.js', 'loot.js', 'interactables.js',
  // Fight maths — enemy HP, melee dps, bow/staff shot damage + flight. Pure by
  // design (the monster stat table is registered from app.js at boot, and
  // combat.test.js registers a synthetic one), so it runs headless.
  'combat.js',
  'interact.js',
  // Pure save-state ladders (castle chain + starter chain), no Phaser/DOM.
  'quests.js',
  // Pure draw-math module: it only touches WorldGen + a stub Graphics, so the
  // road-geometry overlay's projection/culling can be pinned without Phaser.
  'road_overlay.js',
  // render.js needs Phaser to DRAW, but it deliberately reads no globals at
  // load time (see the CANVAS_W comment in drawObjects), so loading it here is
  // safe and gives the pure decision helpers it exports — edgeNeedsBorder —
  // a home in the headless suite.
  'render.js',
];
// Bridge: copy the `const` exports onto the context global so the test files
// (loaded as separate scripts) can reach them by bare name. Functions + IIFE
// `window.X` exports already live on the global.
const BRIDGE = `;Object.assign(globalThis, {
  INTERACTABLES, runInteractable, gatherLuck, gatherLuckEnabled,
  ITEM_BY_ID, TIER_BY_NUM, SHINY_RATE,
  toolDurationMs, TOOL_DURATION_MS, TIER_STEP, effectivePickCost, effectiveChopCost,
  treeWoodMul, treeAxeReqTier, treeSpeciesName, treeSizeClass, treeGrowthStage,
  HomeArea,
  itemValue, randInt, pickFromArray, isShiny,
  CROP_SPRITE, CROP_ROW, MINERAL_ICON_SHEET, MAX_GROWTH_STAGE, PRODUCE_COL,
  CROPS_SHEET_COLS, SPRING_CROPS_COLS, SEEDBOX_COL,
  TAP_HANDLERS, TERRAIN, TERRAIN_FLAVOR,
  Quests, QUEST_CHAIN, STARTER_CHAIN,
});`;
try {
  vm.runInContext(FILES.map(readSrc).join('\n;\n') + '\n' + BRIDGE, ctx,
    { filename: 'src-bundle.js' });
} catch (e) {
  console.error('Failed to load source bundle headlessly:\n', e && e.stack || e);
  process.exit(2);
}

// app.js can't load headlessly (it needs Phaser), but its NON_TILLABLE set is
// the contract interact.js' TERRAIN_FLAVOR has to cover — every non-tillable
// terrain code reaches the 'flavor' handler and needs a real label instead of
// a bare '·'. Lift the codes straight out of the source text so the coverage
// test in interact_tap.test.js can't drift from app.js.
{
  const m = readSrc('app.js').match(/const NON_TILLABLE = new Set\(\[([^\]]*)\]\)/);
  if (!m) {
    console.error('Could not find NON_TILLABLE in src/app.js — update run.js');
    process.exit(2);
  }
  ctx.NON_TILLABLE_CODES = m[1].split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  // interact.js calls the global isTillable (defined in app.js) — stub it from
  // the same parsed set so handlers that gate on it can be driven headlessly.
  const nonTillable = new Set(ctx.NON_TILLABLE_CODES);
  ctx.isTillable = (type) => !nonTillable.has(type);
  // …and isTillableCell (also app.js): the cell-level test that additionally
  // refuses cells under a drawn road band (cellAt's roadMask-derived
  // underRoad flag). Mirrors the app.js one-liner exactly.
  ctx.isTillableCell = (cell) => ctx.isTillable(cell.type) && !cell.underRoad;
}

// The walk-home timings live in app.js too. Lift them the same way, so the
// tests below assert on the REAL numbers rather than a copy that would quietly
// drift the moment someone retunes the feel.
{
  const src = readSrc('app.js');
  for (const name of ['WALK_HOME_IDLE_MS', 'WALK_HOME_HINT_IDLE_MS', 'WALK_HOME_RAMP_MS',
                      // The walk-home behaviour tests below drive the REAL
                      // _driftHome, so they need the numbers it reads: walking
                      // pace, and the gap past which a return is placed rather
                      // than walked (the same constant the GPS fix path snaps
                      // on — that shared number is the point).
                      'WALK_M_S', 'GPS_SNAP_M', 'DEBUG_SPEED_MUL',
                      // VIEW_CELLS is the ceiling on the fog reveal radius —
                      // see fog.test.js. Lifted for the same reason: a copy
                      // would drift the moment the viewport was resized.
                      'VIEW_CELLS',
                      // CELL_PX is the cell edge in px — render.js's fog-shell
                      // fills are laid out in it, and fog_shells.test.js drives
                      // them against a recording Graphics stub.
                      'CELL_PX',
                      // The starting-neighbourhood reveal radii — fog.test.js
                      // checks they actually cover the trail the onboarding
                      // seater lays, which is what broke when fog shipped.
                      'HOME_REVEAL_CELLS', 'TRAIL_REVEAL_CELLS']) {
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

// The walk home is BEHAVIOUR, not just timings: whether a return is walked or
// placed outright is decided inside _driftHome. Lift the method itself —
// alongside the two it calls — and run it on a stub scene, the same trick
// tools/layout_audit.js uses on layOutVertically. A reimplementation here would
// pass while the real return crawled home across half a kilometre.
{
  const src = readSrc('app.js');
  const lift = (sig) => {
    const start = src.indexOf('\n  ' + sig);
    // Class methods sit at two-space indent, so the first line that is exactly
    // `  }` closes the method — every brace inside it is deeper than that.
    const end = start < 0 ? -1 : src.indexOf('\n  }\n', start);
    if (start < 0 || end < 0) {
      console.error(`Could not lift ${sig} out of src/app.js — update run.js`);
      process.exit(2);
    }
    return src.slice(start + 1, end + 4);
  };
  const methods = ['_driftHome(dt) {', 'syncMoveTarget() {', '_gpsAwayM() {']
    .map(lift).join(',\n');
  vm.runInContext(`globalThis.__walkHome = {\n${methods}\n};`, ctx,
                  { filename: 'app.js#_driftHome' });
  for (const k of ['_driftHome', 'syncMoveTarget', '_gpsAwayM']) {
    if (typeof ctx.__walkHome[k] !== 'function') {
      console.error(`__walkHome.${k} did not come back as a function — update run.js`);
      process.exit(2);
    }
  }
}

// The monster table and the defeat bounty derived from it are pure data + pure
// math, but they live in app.js (which needs Phaser). Lift the whole block as
// text — same trick as above — so the reward tests below run the REAL table and
// the REAL formula rather than a copy that would drift the first time a kind is
// added or a number retuned.
//
// The block includes app.js's `Combat.registerMonsters(MONSTERS)` call, which
// is what lets the bounty ask Combat how much HP a kind has: without it every
// monster would fall through to the fauna ladder's default and the coins would
// be measured against the wrong numbers here but not in the game.
{
  const src = readSrc('app.js');
  const start = src.indexOf('const MONSTERS = {');
  const endMark = 'function isMonster(kind)';
  const end = src.indexOf('\n', src.indexOf(endMark));
  if (start < 0 || end < 0) {
    console.error('Could not find the MONSTERS / bounty block in src/app.js — update run.js');
    process.exit(2);
  }
  const block = src.slice(start, end + 1);
  if (!/Combat\.registerMonsters\(MONSTERS\)/.test(block)) {
    console.error('The lifted MONSTERS block no longer registers the table with combat.js — '
      + 'move the registration back beside the table, or update run.js');
    process.exit(2);
  }
  // The stats the table is AUTHORED at, before CAVE_ENEMY_MUL doubles them —
  // evaluated from the same literal text, so a test can prove the doubling is
  // actually applied (and applied once) instead of trusting the numbers.
  const tableEnd = src.indexOf('};', start) + 2;
  if (tableEnd < 2) {
    console.error('Could not find the end of the MONSTERS literal — update run.js');
    process.exit(2);
  }
  vm.runInContext(
    src.slice(start, tableEnd).replace('const MONSTERS =', 'globalThis.MONSTERS_BASELINE ='),
    ctx, { filename: 'monsters-baseline.js' });
  vm.runInContext(block
    + '\n;Object.assign(globalThis, { MONSTERS, isMonster, enemyBounty, CAVE_ENEMY_MUL,'
    + ' ENEMY_COIN_PER_HP, ENEMY_DEPTH_BONUS, MONSTER_TREASURE_CHANCE });',
    ctx, { filename: 'monsters.js' });
}

// The inventory category tabs are declared in app.js (which needs Phaser, so it
// can't load here). Lift the {key, label, sym} triples straight out of the
// source text — same trick as NON_TILLABLE above — so the tab-chrome tests can
// assert on the real table instead of a copy that would drift.
{
  const m = readSrc('app.js').match(/const INV_CATS = \[([\s\S]*?)\n\];/);
  if (!m) {
    console.error('Could not find INV_CATS in src/app.js — update run.js');
    process.exit(2);
  }
  const cats = [];
  const re = /\{\s*key:\s*'([^']+)'[^}]*?label:\s*'([^']+)'[^}]*?sym:\s*'([^']+)'/g;
  let row;
  while ((row = re.exec(m[1])) !== null) {
    cats.push({ key: row[1], label: row[2], sym: row[3] });
  }
  if (!cats.length) {
    console.error('Parsed no entries out of INV_CATS — update run.js');
    process.exit(2);
  }
  ctx.INV_CATS = cats;
}

// The starter-home provisioner seats the wood / rock / wreck a new player needs
// onto real cells and freezes the result. It's pure grid + save math, but it
// lives on the Phaser scene class, so lift both methods out as text (same trick
// as _carveStarterPlot below) and expose them for a test to .call() with a
// scene stub — exercising the real shipping code instead of a copy of it.
{
  const src = readSrc('app.js');
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
  const objBody = grab('  _starterHomeObject(rec) {\n');
  const provBody = grab('  _provisionStarterHome(entry, tx, ty, spawnIX, spawnIY, usedSeats) {\n');
  vm.runInContext(
    'globalThis.StarterHomeMethods = {\n'
    + '  _starterHomeObject(rec) {\n' + objBody + '\n  },\n'
    + '  _provisionStarterHome(entry, tx, ty, spawnIX, spawnIY, usedSeats) {\n' + provBody + '\n  },\n'
    + '};', ctx, { filename: 'starterHome.js' });
}

// The cash-storefront offer path must derive every roll behind an offer from
// the shop's hour bucket (shopRng), never Math.random — otherwise closing and
// reopening the modal re-rolls what the shop sells, which is exactly the bug
// where a player could reopen a fort until it offered a relic and then reopen
// until the price came up cheap. app.js needs Phaser so it can't load here;
// lift the two method bodies as text (same trick as NON_TILLABLE / INV_CATS /
// _carveStarterPlot above) so shops_math.test.js asserts on the real shipping
// source rather than a transcription that could drift.
{
  const src = readSrc('app.js');
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

// The starter plot (_carveStarterPlot) is pure grid math — no Phaser, no
// rendering — but it lives on the Phaser scene class, so it can't be imported.
// Lift the METHOD BODY straight out of the source text (same trick as
// NON_TILLABLE / INV_CATS above) and expose it as a plain function the test can
// .call() with a scene stub. The test then exercises the real shipping code
// rather than a transcription of it, so the two can't drift.
{
  const src = readSrc('app.js');
  const head = '  _carveStarterPlot(entry, tx, ty, spawnIX, spawnIY, usedSeats) {\n';
  const at = src.indexOf(head);
  if (at < 0) {
    console.error('Could not find _carveStarterPlot in src/app.js — update run.js');
    process.exit(2);
  }
  // The method ends at the first line that is exactly two-space-indented '}'.
  const bodyStart = at + head.length;
  const end = src.indexOf('\n  }\n', bodyStart);
  if (end < 0) {
    console.error('Could not find the end of _carveStarterPlot — update run.js');
    process.exit(2);
  }
  const body = src.slice(bodyStart, end);
  vm.runInContext(
    `globalThis.carveStarterPlot = function (entry, tx, ty, spawnIX, spawnIY, usedSeats) {\n${body}\n};`,
    ctx, { filename: 'carveStarterPlot.js' });
}

// The spawn relic chest (_placeStarterRelicChest) seats a treasure chest one
// screen out from the anchor and decides which wooden relic is inside it. Pure
// grid + seeded-rng math, but it lives on the Phaser scene class — lift the
// method body as text (same trick as _carveStarterPlot above) plus the two
// constants and VIEW_CELLS it reads, so the test drives the REAL placer and the
// REAL slot list rather than a transcription that could drift.
{
  const src = readSrc('app.js');
  const head = '  _placeStarterRelicChest(entry, tx, ty, spawnIX, spawnIY, usedSeats) {\n';
  const at = src.indexOf(head);
  if (at < 0) {
    console.error('Could not find _placeStarterRelicChest in src/app.js — update run.js');
    process.exit(2);
  }
  const bodyStart = at + head.length;
  const end = src.indexOf('\n  }\n', bodyStart);
  if (end < 0) {
    console.error('Could not find the end of _placeStarterRelicChest — update run.js');
    process.exit(2);
  }
  const body = src.slice(bodyStart, end);
  const consts = ['VIEW_CELLS', 'STARTER_RELIC_TIER'];
  let decls = '';
  for (const name of consts) {
    const m = src.match(new RegExp(`const ${name} = (\\d+);`));
    if (!m) {
      console.error(`Could not find ${name} in src/app.js — update run.js`);
      process.exit(2);
    }
    decls += `const ${name} = ${m[1]};\n`;
    ctx[name] = parseInt(m[1], 10);
  }
  const slots = src.match(/const STARTER_RELIC_SLOTS = (\[[^\]]*\]);/);
  if (!slots) {
    console.error('Could not find STARTER_RELIC_SLOTS in src/app.js — update run.js');
    process.exit(2);
  }
  decls += `const STARTER_RELIC_SLOTS = ${slots[1]};\n`;
  for (const n of ['HOME_REVEAL_CELLS', 'TRAIL_REVEAL_CELLS']) {
    const m = src.match(new RegExp(`const ${n} = (\\d+);`));
    if (!m) { console.error(`Could not find ${n} in src/app.js — update run.js`); process.exit(2); }
    decls += `const ${n} = ${m[1]};\n`;
  }
  // The trail layer above it — same lift, because the thing worth testing is
  // that the crates come down ALONG the route the chest placer hands back.
  const trailHead = '  _placeStarterTrail(entry, tx, ty) {\n';
  const trailAt = src.indexOf(trailHead);
  if (trailAt < 0) {
    console.error('Could not find _placeStarterTrail in src/app.js — update run.js');
    process.exit(2);
  }
  const trailBodyStart = trailAt + trailHead.length;
  const trailEnd = src.indexOf('\n  }\n', trailBodyStart);
  if (trailEnd < 0) {
    console.error('Could not find the end of _placeStarterTrail — update run.js');
    process.exit(2);
  }
  const trailBody = src.slice(trailBodyStart, trailEnd);
  // ...and the fog lift that runs at the end of it. Fog of war hid the whole
  // trail when it shipped (the walk reveals 3 cells, the seater reaches 15), so
  // the reveal is lifted for real rather than stubbed — starter_relic.test.js
  // drives it against the real seater to check no crate is laid under fog.
  const revealHead = '  _revealStarterTrail(entry, tx, ty, spawnIX, spawnIY) {\n';
  const revealAt = src.indexOf(revealHead);
  if (revealAt < 0) {
    console.error('Could not find _revealStarterTrail in src/app.js — update run.js');
    process.exit(2);
  }
  const revealBodyStart = revealAt + revealHead.length;
  const revealEnd = src.indexOf('\n  }\n', revealBodyStart);
  if (revealEnd < 0) {
    console.error('Could not find the end of _revealStarterTrail — update run.js');
    process.exit(2);
  }
  const revealBody = src.slice(revealBodyStart, revealEnd);
  vm.runInContext(
    decls
    + `globalThis.placeStarterTrail = function (entry, tx, ty) {\n${trailBody}\n};\n`
    + 'globalThis.HOME_REVEAL_CELLS = HOME_REVEAL_CELLS;\n'
    + 'globalThis.TRAIL_REVEAL_CELLS = TRAIL_REVEAL_CELLS;\n'
    + `globalThis.revealStarterTrail = function (entry, tx, ty, spawnIX, spawnIY) {\n${revealBody}\n};\n`
    + 'globalThis.STARTER_RELIC_SLOTS = STARTER_RELIC_SLOTS;\n'
    + 'globalThis.STARTER_RELIC_TIER = STARTER_RELIC_TIER;\n'
    + 'globalThis.VIEW_CELLS = VIEW_CELLS;\n'
    + `globalThis.placeStarterRelicChest = function (entry, tx, ty, spawnIX, spawnIY, usedSeats) {\n${body}\n};`,
    ctx, { filename: 'placeStarterRelicChest.js' });
}

// The road-geometry overlay must keep stroking its bands with the same width
// function worldgen stamps its no-spawn road mask from — a private copy there
// would let a way be DRAWN wider than the ground the spawners keep clear, which
// is how rocks ended up sitting in the traffic. Hand the source text over so
// spawn_roads.test.js can pin it (the vm sandbox has no require/fs).
ctx.ROAD_OVERLAY_SRC = readSrc('road_overlay.js');

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
    inRange(v, lo, hi, m) { if (v < lo || v > hi) throw new Error((m||'inRange')+': '+v+' not in ['+lo+','+hi+']'); },
    includes(arr, v, m)   { if (!arr || !arr.includes(v)) throw new Error((m||'includes')+': '+JSON.stringify(v)+' not in '+JSON.stringify(arr)); },
  };
  // Minimal scene stub: records inventory, swallows UI calls, runs the work
  // wheel synchronously (startWorkProgress fires its callback at once) so a
  // gather completes within the test instead of on a timer.
  globalThis.makeScene = (over = {}) => {
    const inv = {};
    const s = {
      _inv: inv,
      brokenRockSet: new Set(),
      addToInv: (id, n = 1) => { inv[id] = (inv[id] || 0) + n; },
      invCount: (id) => inv[id] || 0,
      spendEnergy: () => true,
      startWorkProgress: (x, y, cb) => { if (cb) cb(); },
      flash: () => {}, flashLoot: () => {}, flashJackpot: () => {},
      awardShinyBonus: () => {},
      shopInteract: () => {}, shrineInteract: () => {},
      showChestRewardModal: () => {}, iconSpanHTML: () => '', gearIconHTML: () => '',
      invRoomFor: () => Infinity, _coinBurstInteract: () => {},
    };
    return Object.assign(s, over);
  };
  // Build a ctx the tap-driver expects (scene + save + screen coords).
  globalThis.makeCtx = (scene, save) => ({ scene, save, sx: 0, sy: 0, dirty: false });
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
// STARTER_RELIC_SLOTS names the slots the spawn chest can hand out, and the
// thing that makes each of them a WOODEN relic is that tier-1 art exists for
// it. That's a claim about files on disk, so it's checked against the shipped
// PNGs here in node scope (the vm sandbox has no fs) rather than trusted.
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

// ── Sprite-position rule (tools/sprite_audit.js) ──────────────────────────
// Folded into the suite so a non-compliant sprite — or a stale ART_BOUNDS
// table in src/sprite_layout.js — fails CI. The audit decodes the real PNGs,
// so it runs in plain node scope (fs/zlib), not the vm sandbox; each scenario
// becomes one test case via the node-scope closures pushed onto ctx.__tests.
{
  const audit = require('../../tools/sprite_audit.js');
  for (const sc of audit.SCENARIOS) {
    ctx.__tests.push({ name: `sprite seat (one-cell rule): ${sc.name}`, fn: () => {
      const r = audit.evaluate(sc);
      if (r.error) throw new Error(r.error);
      if (r.violations.length) throw new Error(r.violations.join('; '));
    } });
  }
  // Creatures skip the seat rule but own the wheel crown rule — same audit,
  // same PNG decode, so a resized creature sheet can't strand its work wheel.
  for (const kind of Object.keys(audit.CREATURE_SHEETS)) {
    ctx.__tests.push({ name: `creature wheel (crown rule): ${kind}`, fn: () => {
      const r = audit.evaluateCreature(kind);
      if (r.violations.length) throw new Error(r.violations.join('; '));
    } });
  }
}

// ── App-shell audit (tools/shell_audit.js) ────────────────────────────────
// File-level checks that index.html and sw.js still agree about what the app
// is made of. Runs in plain node scope (fs), like the sprite audit above.
{
  const shell = require('../../tools/shell_audit.js');
  for (const c of shell.CHECKS) ctx.__tests.push({ name: c.name, fn: c.run });
}

// ── Vertical-layout audit (tools/layout_audit.js) ─────────────────────────
// Lifts fitGame's budget out of index.html and checks it against real device
// sizes: the map clears both chrome stacks, the stick never covers the
// inventory or the player, and no screen is left with a big empty band.
{
  const layout = require('../../tools/layout_audit.js');
  for (const c of layout.CHECKS) ctx.__tests.push({ name: c.name, fn: c.run });
}

// ── Viewport-vignette audit (tools/vignette_audit.js) ─────────────────────
// The map's rim fades differently on the two axes: the top and bottom keep the
// near-opaque lip that stops overhanging art being sliced mid-pixel, while the
// left and right — which ARE the screen edges on a phone — get the soft ramp
// alone, so the vignette can't paint black bars down the sides again.
{
  const vignette = require('../../tools/vignette_audit.js');
  for (const c of vignette.CHECKS) ctx.__tests.push({ name: c.name, fn: c.run });
}

// ── Offer-modal audit (tools/modal_audit.js) ──────────────────────────────
// Scans app.js for showOfferModal callers that fill BOTH halves of the "you
// get X for Y" dialog with the same text — which is how the castle quest
// board printed its progress line twice.
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
