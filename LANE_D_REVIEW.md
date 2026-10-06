# Lane D review handoff - drawObjects steady state

## Diff summary

- `src/render.js`
  - Caches resolved texture/frame/scale/origin/ART_BOUNDS seating tuples in a scene-local `WeakMap` for generated object kinds whose appearance inputs never change after tile build.
  - Keeps animated, save-driven, connected-art and clock-grown rows on the live resolver.
  - Counts actual appearance resolutions as `object appearances resolved`.
  - Keeps `Render.sortWorldDepth` running each frame to compute the correct order, but skips Phaser's full `worldContainer.sort('depth')` unless a real child depth or membership changed.
  - Marks world-pool growth and retirement, remembers the last sorted child count, and stamps each sorted sprite with `_worldDepthOrder` so a one-for-one external pool replacement cannot hide behind the same child count and Phaser's default depth 0.
- `test/node/draw_objects_cache.test.js`
  - Pins cache hits, dynamic/connected bypasses, late texture registration, unchanged depth order, depth-zero replacement detection, world-pool membership dirtying and the final sort gate.
- `docs/design/rendering.md`
  - Records the cacheability and dirty-sort invariants in the owning purpose document.
- `index.html`, `sw.js`
  - Generated cache-bust hashes only.

## Review checklist

### Cache-key completeness, including `fruitNow` and epochs

- [x] The cache is identity-keyed only for generated records with immutable appearance inputs: `zone_prop`, `reef_coral`, non-clock-grown `tree`, `mineralrock`, `waystone`, `stakes`, `tar`, `infoboard`, `bottle`, `gatepost`, `hive`, `headstone`, `vista_scope`, `well`, and `groundstack`.
- [x] `fruittree` bypasses the cache because its frame and scale read `fruitNow`, growth state and `save.fruitPicked`.
- [x] Houses, towers and staircases bypass because save/claim/restore state can change their art.
- [x] Chests bypass because spent/smashed state can change in place.
- [x] `_fire`, `torch`, `shrine_spirit` and `_streetlamp` bypass because time or live lamp state changes their appearance.
- [x] Every connected-art override bypasses, including stronghold joins, quarry joins, chasm masks and hedge frames.
- [x] No Streets/visit/restore epoch is needed by a cached kind; rows fed by those live states bypass.
- [x] `visible:false` is never cached, so late texture registration heals on the next draw.
- [x] Per-frame `spec.after`, sprite tint, shine and work-impact still run after a cached tuple is read.

### Dirty-pool correctness

- [x] `Render.renderPool` marks world membership dirty when it creates or retires a shared-world slot.
- [x] Pools outside `scene.worldContainer` do not dirty world order.
- [x] The last sorted child count catches external add/remove work before `drawObjects` starts.
- [x] `_worldDepthOrder` is absent on a newly added upright sprite, so equal-count one-for-one swaps still force one sort even when the target depth is 0.
- [x] Manual melee-effect creation marks the order dirty.

### Sort dirty-check

- [x] `Render.sortWorldDepth` still sorts the frame's logical rows and stamps every frame item's `_z`; gameplay occlusion order is still recalculated every frame.
- [x] Player/upright sprite depth changes mark the order dirty directly.
- [x] Object, plant, creature, hazard, flag and fruit pooled sprites compare their real Phaser depth through `setWorldDepth`.
- [x] `worldContainer.sort('depth')` remains the sole physical container sort and runs after all world sprites have been configured.
- [x] Profiler counter `world depth sorted` exposes the hit rate.

### Seating and ART_BOUNDS

- [x] The first resolve still calls the unchanged `resolveAppearance` and `SpriteLayout.seatInCell` path.
- [x] The cached value is the exact resolver result; no seating formulas were copied or changed.
- [x] Animated/stage-changing rows resolve live, so seat frame, scale and foot geometry cannot stale.
- [x] No changes were made to `src/sprite_layout.js` or `ART_BOUNDS`.

## Measurement

The browser run shared CPU with four parallel optimization lanes, so absolute milliseconds are not comparable to the uncontended baseline. Its deterministic profiler counts are still useful:

- Walking: 26.86 objects kept/step; 7.18 appearance resolutions/step; about 73% of kept appearances avoided resolution/seating after warm-up.
- Walking: `world depth sorted` averaged 0.29, so the physical container sort ran on 29% of steps instead of 100%.
- Idle: 25.23 objects kept/step; 6 appearance resolutions/step; `world depth sorted` averaged 0.095 (9.5% of steps).

Integration should rerun `tools/perf_loop.js` without competing lanes before accepting the absolute `drawObjects` target.

## Verification

- `node tools/cachebust.js --write`
- `node test/node/run.js` - 4,996 passed, 0 failed after the final depth-zero marker and membership test.
- `PW_CHROMIUM=/usr/bin/chromium PORT=7813 RESTORE_MS=0 node tools/perf_loop.js /tmp/perf-objects-after.json` - real scene booted and completed; counts above.

## Residual risk

- The optimization intentionally leaves dynamic rows live, so the remaining 6-7 resolutions per starting-area step are expected. Integration should use the unified profile to decide whether a second, epoch-keyed house/chest cache is worth its invalidation complexity.
- Phaser timing from the parallel run is noisy; only the counters are accepted as lane-local measurement evidence.
