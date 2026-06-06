# Headless node tests

Fast, browser-free unit tests for terracart's **pure logic + data tables + the
interactable registry**. No Phaser, no DOM, no Playwright/Chromium.

```sh
node test/node/run.js
```

Exit code is `0` when everything passes, `1` on any failure — drop it straight
into CI or a pre-push hook.

## What this covers (and what it doesn't)

`run.js` loads the render-free modules (`mvt`, `util`, `coords`, `worldgen`,
`save`, `items`, `shops`, `rarity`, `loot`, `interactables`) into a single
`vm` context with light browser stubs, then runs every `*.test.js` in this
folder. It's the right home for anything that's a pure function of its inputs:

- `tables.test.js`   — tool-duration ladder, energy costs, `ITEM_BY_ID` /
  `TIER_BY_NUM`, tree tier/yield helpers, the `WorldGen` namespace.
- `loot.test.js`     — `pickReward` (seeded PRNG → deterministic), reward
  validity, ring luck.
- `registry.test.js` — the `INTERACTABLES` registry driven through
  `runInteractable()` against a stub scene (gates, loot, gather-luck flag).

It does **not** replace the browser harness (`test/harness.html` +
`run_tests.py`). Anything that needs the live Phaser scene, real tile
rasterization, tap geometry, or rendering still belongs there.

## Writing a test

Add a `*.test.js` file here. The runner injects these globals (no imports):

- `test(name, fn)` — register a case; `fn` may be async. Throw to fail.
- `assert` — `eq`, `truthy`, `falsy`, `gt/gte/lt`, `inRange`, `includes`.
- `makeScene(overrides?)` — stub scene that records inventory (`invCount(id)`),
  swallows UI calls, and runs the work wheel synchronously.
- `makeCtx(scene, save)` — the `{ scene, save, sx, sy, dirty }` the tap-driver expects.
- Every source export reachable by bare name: `INTERACTABLES`, `runInteractable`,
  `pickReward`, `toolDurationMs`, `ITEM_BY_ID`, `WorldGen`, etc.

```js
test('plain rock drops stone', () => {
  const scene = makeScene();
  const save = { relics: { pick: { tier: 7 } } };
  runInteractable(makeCtx(scene, save), { kind: 'mineralrock', id: 'r', x: 0, y: 0, yieldTier: 1 });
  assert.inRange(scene.invCount('rockfruit'), 1, 3);
});
```
