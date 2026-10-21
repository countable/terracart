# Live Rogue Adventure studies

Run `node tools/ra-preview/server.cjs` from the repository. It extracts the reviewed source crops into `/tmp/terracart-ra-preview` and serves an opt-in game instance on localhost port 8017.

- Village: http://localhost:8017/?sandbox=true&headingUp=false&raPreview=village
- Jungle: http://localhost:8017/?sandbox=true&headingUp=false&raPreview=jungle

These are authored study maps running the actual game scene, input, object interactions, terrain grid, and renderer. Walk with WASD/arrows or the touch stick; tap objects normally. The village hatch is a downward staircase and enters the existing cave generator. Cave art keeps normal appearances. Returning brings back the authored surface. They are not geographic-world reskins.

The preview server transforms its responses without changing production files: it widens the viewport, enables normal debug keyboard walking at ordinary speed, attaches absolute world-cell indices to terrain sprites, uses the source-study lighting adjustments on the surface, and injects the fixture/bootstrap. Ground frames follow those world coordinates while walking. Source textures are baked once by the study modules; normal updates select cached frames. The Canvas terrain batching is disabled here because it otherwise captures terrain before the opt-in source texture pass; WebGL follows its normal sprite path.

`village-fixture.js` and `jungle-fixture.js` adapt the respective capture fixtures for live use. Keep their object positions and terrain inputs synchronized with the corresponding study when changing those compositions. The originals remain reproducible screenshot tools. `live.js` loads their source art, resumes the actual scene, and retains the player and input controls. The screenshots' single-frame hide/pause behavior is not used as the live game loop.

Local and session storage are replaced with in-memory Storage-compatible objects before game startup. Reloading starts fresh, and this page neither reads nor clears any real browser save. Service-worker registration is disabled for this isolated preview origin. The server binds only to localhost; use `PORT` to select another unused local port.

Run `node tools/ra-preview/check.cjs` with the preview server running to check both scenes: live keyboard movement, stable world-cell textures, visible player, no browser/WebGL errors, and a real village descent/return through the staircase handler. Results and screenshots go to `/tmp/ra-live/`. The preview shell crops the unused inventory band; the menu, touch stick, and object dialogs remain available.
