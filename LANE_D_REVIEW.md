# Lane D review handoff - drawObjects steady state

## Diff summary

- `src/render.js`
  - Caches resolved texture/frame/scale/origin/ART_BOUNDS seating tuples in a scene-owned, non-enumerable stamp on generated object records whose appearance inputs never change after tile build; warm frames do no map hashing/bookkeeping.
  - Keeps animated, save-driven, connected-art and clock-grown rows on the live resolver.
  - Reuses an unchanged generated object's configured Phaser slot only while body and camera are still; axe/pickaxe tier changes and work-impact start/end force a full reset/configure. Walking never receives the reuse callback, so the walking optimization remains intact.
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
- [x] The stamp is non-enumerable and scene-owner checked, so it never enters spreads/saves and a second scene cannot reuse the first scene's tuple.
- [x] `fruittree` bypasses the cache because its frame and scale read `fruitNow`, growth state and `save.fruitPicked`.
- [x] Houses, towers and staircases bypass because save/claim/restore state can change their art.
- [x] Chests bypass because spent/smashed state can change in place.
- [x] `_fire`, `torch`, `shrine_spirit` and `_streetlamp` bypass because time or live lamp state changes their appearance.
- [x] Every connected-art override bypasses, including stronghold joins, quarry joins, chasm masks and hedge frames.
- [x] No Streets/visit/restore epoch is needed by a cached kind; rows fed by those live states bypass.
- [x] `visible:false` is never cached, so late texture registration heals on the next draw.
- [x] `spec.after`, sprite tint, shine and work-impact run whenever a slot is configured. Warm still reuse is limited to stable kinds; the only cacheable `after` rows (tree/mineralrock tool alpha) are invalidated by the frame-global axe/pickaxe tier stamp, and work start/end forces a reset.

### Dirty-pool correctness

- [x] A proven-stable pool slot skips reset/configure; the test pins zero configurations for both one and 1,000 unchanged visible records.
- [x] The optional reuse callback is passed only on `_boot_still`; creatures and other animated pools continue to configure every step.
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

The original branch regression (parent's solo run) was idle `update 2.79 / drawObjects 0.84 / lighting 0.34 / Phaser render 0.73 ms`, versus baseline `1.92 / 0.58 / 0.19 / 0.50`.

After replacing the per-object `WeakMap` lookup and adding still-slot reuse, the cleanest same-host run (`/tmp/perf-objects-stillreuse.json`) recovered idle to `update 1.93 / drawObjects 0.60 / lighting 0.19 / Phaser render 0.45 ms`. It recorded six live (deliberately uncached) appearance resolutions per idle step and sorted world depth on 3.3% of steps. Its walking sample was `update 3.99 / drawObjects 1.13 / crossing 7.94 ms`; reuse is not invoked while walking, so the original walking fast path is unchanged.

Later launches varied widely as the host became busy (idle update 2.6-4.2 ms with every pass, including unchanged lighting and Phaser render, moving together). Pool capacities did not grow: `objectPool=13`, `plantedPool=17`, `creaturePool=5`, `worldContainerChildren=37`, the same fixture shape as before. The render increase was host-wide timing variance, not retained slots; `Render.renderPool` still retires every unused tail on every step. Integration should rerun once without competing work before accepting absolute numbers.

Deterministic work counters remain stable: about 73% of kept object appearances avoid resolution/seating, warm static object-pool configuration is zero regardless of object count, and the physical world sort runs only when depth or membership changes.

## Verification

- `node tools/cachebust.js --write`
- `node test/node/run.js` - 4,998 passed, 0 failed after the still-slot follow-up.
- `PW_CHROMIUM=/usr/bin/chromium PORT=7813 RESTORE_MS=0 node tools/perf_loop.js /tmp/perf-objects-stillreuse.json` - real scene booted and completed; clean sample above.

## Residual risk

- The optimization intentionally leaves dynamic rows live, so the remaining 6-7 resolutions per starting-area step are expected. Integration should use the unified profile to decide whether a second, epoch-keyed house/chest cache is worth its invalidation complexity.
- Phaser timing from the parallel run is noisy; only the counters are accepted as lane-local measurement evidence.
