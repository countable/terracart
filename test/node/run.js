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
ctx.document = { visibilityState: 'visible', addEventListener() {} };
ctx.addEventListener = () => {};      // window.addEventListener('pagehide', …)
vm.createContext(ctx);

// ── Load the pure / data modules (index.html order, render/app/etc. omitted) ─
const FILES = [
  'mvt.js', 'util.js', 'placed_floor.js', 'coords.js', 'biome_profiles.js', 'home.js', 'worldgen.js', 'save.js',
  'items.js', 'inventory.js', 'energy.js', 'crops.js', 'delivery.js', 'savemigrate.js', 'gear.js', 'shops_math.js', 'shops.js', 'rarity.js', 'loot.js', 'interactables.js',
  'interact.js',
];
// Bridge: copy the `const` exports onto the context global so the test files
// (loaded as separate scripts) can reach them by bare name. Functions + IIFE
// `window.X` exports already live on the global.
const BRIDGE = `;Object.assign(globalThis, {
  INTERACTABLES, runInteractable, gatherLuck, gatherLuckEnabled,
  ITEM_BY_ID, TIER_BY_NUM, SHINY_RATE,
  toolDurationMs, effectivePickCost, effectiveChopCost,
  treeWoodMul, treeAxeReqTier, treeSpeciesName,
  HomeArea,
  itemValue, randInt, pickFromArray, isShiny,
  CROP_SPRITE, CROP_ROW, MINERAL_ICON_SHEET, MAX_GROWTH_STAGE, PRODUCE_COL,
  CROPS_SHEET_COLS, SPRING_CROPS_COLS, SEEDBOX_COL,
  TAP_HANDLERS,
});`;
try {
  vm.runInContext(FILES.map(readSrc).join('\n;\n') + '\n' + BRIDGE, ctx,
    { filename: 'src-bundle.js' });
} catch (e) {
  console.error('Failed to load source bundle headlessly:\n', e && e.stack || e);
  process.exit(2);
}

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
