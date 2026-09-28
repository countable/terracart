# First-pass performance validation

## Purpose

Keep frame work bounded as farms grow, make failed saves visible, and bound
multiplayer queues without changing the storage format or scene architecture.

## Scope

Changes were developed in `/tmp/terracart-perf-first-pass` on `perf/first-pass`,
starting at `079da33`. This report records local measurements, not device-wide
performance guarantees. The browser used Chromium's Canvas renderer at
390 × 844; it does not establish mobile WebGL performance.

## Crop query

`Crops.forEachInBox` indexes crops by depth and 20-metre buckets. Both render
passes use it. The index keeps the save's order and references to crop objects,
so watering and growth appear immediately. Planting, harvesting and pest
removal invalidate it; replacing a save or crop array rebuilds it automatically.
The index stays outside the persisted save.

`node tools/bench_crops.js` compares the original two filters with the indexed
queries in one JavaScript realm. Both collect results, and the benchmark checks
that the results match in each pass and retain their order. Timings below are
medians of nine batches, in milliseconds per pair of queries.

| Farm | Original candidates | Indexed candidates | Original warm | Indexed warm | Indexed cold |
| --- | ---: | ---: | ---: | ---: | ---: |
| Empty | 0 | 0 | 0.0001 | 0.0001 | 0.0001 |
| 4 local crops | 8 | 8 | 0.0001 | 0.0021 | 0.0025 |
| 4 local + 10,000 distant crops | 20,008 | 8 | 0.0541 | 0.0027 | 0.4686 |

The large index adds about 0.466 ms on rebuilding and pays that back after
about ten warm frames in this run. The small farm is about 0.002 ms slower.
This supports the small, contained index; it does not justify wider scene or
persistence changes. A new crop-list mutation incurs another rebuild.

The real-browser profiler also runs both shipping render passes for 40 samples
with four local crops, then with 10,000 distant crops added:

| Farm | Candidate visits per frame | Warm rebuild entries | Two render passes, ms/frame | Cold pair, ms |
| --- | ---: | ---: | ---: | ---: |
| 4 local | 8 | 0 | 0.2675 | 1.0 |
| 4 local + 10,000 distant | 8 | 0 | 0.3125 | 1.7 |

The profiler asserts equal candidate counts and no warm rebuilds, rather than
a machine-dependent timing threshold. Whole-loop timings varied across idle,
walking and street-restoration runs; no overall FPS improvement is claimed.
Other gameplay operations, including crop growth, still scan the crop list.

## Multiplayer

The welcome regression test delivers 100 peers through the client's message
handler. Batching reduces HUD writes from 101 to one and near-count visits
from 5,050 to 100. The test observes the HUD write and coordinate reads rather
than matching source text.

The relay drops position frames before its outbound queue exceeds 64 KiB and
terminates a socket before a data frame pushes it past 256 KiB. Its existing
20-second heartbeat terminates clients above the soft limit on two consecutive
checks. Queue tests simulate a stalled transport, recovery, control traffic,
and sustained pressure; the live relay tests also pass. This bounds retained
outbound data without adding a separate queue or per-socket timer.

## Save reliability

A failed write retains pending progress and displays one persistent notice.
A successful retry hides it; reset clears it. The browser check injected a
`QuotaExceededError`, verified that repeated failures left one readable notice
above a dialog, then restored storage and verified recovery. The profiler
records serialized character count and write duration without serializing twice.

## Reproduction

```sh
node tools/bench_crops.js
node test/node/run.js
npm --prefix server install
node server/test.js
PW_CHROMIUM=/usr/bin/chromium node tools/perf_loop.js /tmp/perf.json
```

The browser profiler needs `playwright-core`, Chromium, and recorded `.pbf`
fixtures under `test/fixtures` (see `test/fetch_fixtures.sh`). A fresh worktree
does not contain these ignored dependencies or fixtures. `PW_CHROMIUM` is
optional when Playwright's expected browser is installed.
The runner disables live Overpass queries through the existing `overpass=off`
option, so external map services cannot alter or interrupt the fixture run.

Validation on the feature implementation: 2,681 headless checks and 11 relay
tests passed. The complete browser profiler passed with zero runtime errors.
A separate run injected `console.error('PERF_REGRESSION_ERROR_SENTINEL')` before
page scripts and exited with status 1. Only expected offline map-tile network
failures are excluded; runtime errors on either profiler page fail the command.

## Integration with current main

After merging `origin/main` at `e79b29c`, all 2,865 headless checks passed. The
crop benchmark retained the same 20,008-to-8 candidate reduction and roughly
ten-frame payback (0.0535 ms original, 0.0027 ms indexed, 0.4869 ms cold).
The integrated idle/walk/street profiler passed with zero runtime errors and
eight crop candidate visits per frame in both farm sizes.

The broader browser harness reported 107 passes and 17 failures. Running the
same harness with the six changed runtime modules replaced by their unchanged
`origin/main` versions produced the identical 17 failure messages and zero page
errors. These include old shop-method and balance expectations; this change
does not repair that existing test backlog. The dedicated crop profiler and
save-notice browser checks validate the new behavior separately.
