# Headless node tests

Fast, browser-free tests for Dragon Hood's **pure logic, data tables and the
interactable registry**, plus the repo's static audits. No Phaser, no DOM, no
Playwright/Chromium.

```sh
node test/node/run.js
```

Exit code is `0` when everything passes, `1` on any failure, `2` if a test
file fails to load. There is no name filter — the whole suite runs every time
(a couple of minutes).

## What it covers

`run.js` concatenates the render-free modules (the `FILES` list at its top, in
`index.html` order — `difficulty`, `sprite_layout`, `util`, `coords`,
`worldgen`, `items`, `combat`, `wizard`, `interact`, `quests`, `lighting`,
`render`, …) into ONE `vm` script with light browser stubs, so their top-level
`const`s share a scope exactly as the browser's `<script>` tags do. A bridge
copies the `const` exports onto the global. Then it:

- runs every `*.test.js` in this folder;
- hands tests the source text of modules it cannot load headlessly
  (`APP_JS_SRC`, `INDEX_HTML_SRC`, `RENDER_SRC`, …) plus a few functions
  extracted from `app.js`, for source-level pins. Loaded scene mixins use
  their actual prototype methods and lexical dependencies. `liftSceneMethod`
  returns those methods directly unless a fixture supplies explicit globals;
  `app.js` methods retain a source-extraction fallback. Source pins read
  `SCENE_SRC`: `app.js` plus every mixin it installs with
  `installSceneMixin`, derived from `app.js`, so moving a method into a mixin
  needs no test edits. Use a single file's text only when the file matters;
- checks that the wooden-tier and per-tier relic art actually ships on disk;
- appends the tool audits' checks: `tools/sprite_audit.js`,
  `tools/shell_audit.js`, `tools/cachebust.js`, `tools/layout_audit.js`,
  `tools/vignette_audit.js`, `tools/modal_audit.js`, `tools/layer_audit.js`.

CLAUDE.md's QC rules name the test file that audits each rule.

It does **not** replace the browser harness (`test/harness.html`, driven by
`test/run_tests.py` or `test/run_tests_docker.sh` against a server on port
7731, with MVT fixtures from `test/fetch_fixtures.sh`). Anything that needs the
live Phaser scene, real tile rasterization or rendering belongs there — but it
needs a browser that isn't always available, so prefer a headless test
whenever the logic can be reached from here.

## Dungeon progression regressions

The normal command above automatically includes `dungeon_progression.test.js`,
`dungeon_terrain.test.js`, `arena.test.js`, and `arena_flow.test.js`. They cover
chest reward eligibility and retries, every elevator route, refused rope travel,
L2/L3 generation, road-clearance geometry, portal relocation and asynchronous
loading, all five trial outcomes, one-time key rewards, and interrupted-save
recovery. Scene flow tests execute the shipped methods with deterministic map
and persistence fixtures; they do not require GPS or real-time trial waits.

The browser harness additionally runs **arena: portal tap, actual menu buttons,
trial victory and safe return** in `test/tests.js`. It verifies the real Phaser
scene, menu actions, masked art, visible boundary, lighting, and return trip.
Run it through the existing browser harness when changing scene wiring or art.

## Writing a test

Add a `*.test.js` file here. The runner injects these globals (no imports):

- `test(name, fn)` — register a case; `fn` may be async. Throw to fail.
- `assert` — `eq`, `truthy`, `falsy`, `gt`, `gte`, `lt`, `lte`, `inRange`,
  `includes`.
- `makeScene(overrides?)` — stub scene that records inventory (`invCount(id)`),
  swallows UI calls, and runs the work wheel synchronously.
- `makeCtx(scene, save)` — the `{ scene, save, sx, sy, dirty }` the tap-driver
  expects.
- Every bridged source export by bare name: `INTERACTABLES`,
  `runInteractable`, `pickReward`, `toolDurationMs`, `ITEM_BY_ID`, `WorldGen`,
  `Combat`, …

```js
test('plain rock drops stone', () => {
  const scene = makeScene();
  const save = { relics: { pick: { tier: 7 } } };
  runInteractable(makeCtx(scene, save), { kind: 'mineralrock', id: 'r', x: 0, y: 0, yieldTier: 1 });
  assert.inRange(scene.invCount('rubble'), 1, 3);
});
```

A new module the tests need goes into `FILES` in `run.js` (in `index.html`
order); a new `const` export a test reads by bare name goes into the bridge.

## Compass wall geometry

`wall_perspective.test.js` covers constant screen-vertical height, face visibility
for both polygon windings, retained geometry between frames, empty/depth mode
transitions, merlon gaps, joined segments and wall ordering. Browser comparisons
use `tools/probe_wall_perspective.py` with separate baseline and candidate URLs;
its CPU timings are not target-phone GPU measurements.

`tools/probe_castle_shapes.py` exercises individual trapezoid, five-point star,
concave and angled footprints in both winding directions at eight headings,
plus pan/zoom. It checks perimeter coverage, screen-vertical height and retained
geometry, and captures screenshots for corner and occlusion review. It also
checks the baked tower-base alpha for every material in both restoration states.

Castle atlas treatment has a small source-pack-independent test:
`python3 test/fdr_castle_assets_test.py`. It checks reduced masonry contrast,
retained mean colour and alpha, brighter top materials, and unchanged decals.
`fdr_castles.test.js` checks one discrete mid-height shade per full structure,
continuous UV phase through that boundary, and stable tint under rotation.

## GPU lighting prototype

`gpu_lighting.test.js` checks backend selection, cached texture revisions and
same-frame Canvas fallback. GPU pixel output requires the browser probe:

```sh
python3 tools/probe_gpu_lighting.py --url http://127.0.0.1:8000/index.html
```

The probe compares `gpuLighting=false` and `gpuLighting=true` using isolated
saves and deterministic lighting clocks. It records runtime backend status,
lighting submission time, uploads, lightmaps and screenshots. A Canvas fallback
leaves GPU rendering unverified; these timings do not measure GPU completion,
frame-rate headroom or device power.

`--webkit /path/to/pw_run.sh` uses an installed Playwright WebKit browser for
Safari-family WebGL checks. The probe injects both compass formats and explicitly
renders the paused scene before capture. Device emulation does not replace
testing on the physical phone.
