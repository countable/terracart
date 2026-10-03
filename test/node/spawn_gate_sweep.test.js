// THE SPAWN GATE (Sep 2026), completed: every SPAWN decision goes through
// WorldGen.isSpawnCell with its class (spawn_class.test.js sweeps that every
// call names one) — no spawner may read entry.roadMask directly to decide
// whether something may seat on a cell. roadMask is only HALF the rule (the
// other half is entry.spawnWhy / opts.occupied), and a raw roadMask read
// silently drops the other reasons the gate refuses a cell for (a quiet
// corner, a yard behind a house, a field's interior, restricted land).
//
// This sweeps every module for a raw read of `roadMask` — `roadMask[…]`,
// `.roadMask && …` or a bare `roadMask && …` — and fails unless that read is
// on a short, NAMED allowlist. Three kinds of read legitimately survive:
//   1. THE GATE'S OWN CONSTRUCTION — worldgen.js stamping entry.spawnWhy's
//      ROAD reason from the mask, and isSpawnCell's own definition (the
//      thing every other spawner's roadMask question resolves through).
//   2. GEOMETRY, not the gate — a read that answers a SHAPE question (how
//      close a road may come before ground stops counting as trap-ground at
//      all; which way a gate's fence runs so its posts seat along it; where
//      a decorative connecting avenue's walk stops) rather than "may I spawn
//      here". Every one of these sits beside a SEPARATE call that DOES ask
//      isSpawnCell before anything is actually placed.
//   3. A NON-SPAWN reader — tilling (render.js's self-heal, mirroring
//      items.js isTillableCell), a general-purpose cell query (app.js
//      cellAt(), read by tilling/movement/flavour-text callers, never a
//      spawner), and the doorstep greeter's documented road-only "always"
//      fallback (starter.js), which deliberately does NOT want the gate's
//      softer reasons.
// Every surviving site also carries its own "ALLOWLISTED raw roadMask read"
// comment in situ — this test is the enforcement, not the explanation.
(function () {
  const ROADMASK_READ = /\.?\broadMask\b\s*(?:\[|&&)/;

  // { file, re }: `re` matches the (trimmed) source line the read sits on.
  // Keep these tight — a looser regex here would silently wave through a
  // new, unrelated read on the same file.
  const ALLOW = [
    // ── worldgen.js: the gate's own construction and definition ──────────
    { file: 'worldgen.js', re: /^if \(roadMask && roadMask\[cy \* w \+ cx\] && !obstacle\) return false;/ },
    { file: 'worldgen.js', re: /^if \(roadMask\[i\]\) v \|= W_\.ROAD;/ },
    // ── worldgen.js: geometry (a separate isSpawnCell call gates the seat) ─
    { file: 'worldgen.js', re: /isCobbleTerrain\(grid\[y \* N \+ x\]\) \|\| \(roadMask && roadMask\[y \* N \+ x\] === 1\)\)/ },
    { file: 'worldgen.js', re: /^const _underRoadBand = \(ix, iy\) => roadMask\[iy \* w \+ ix\] === 1;/ },
    // ── traps.js: geometry (trap-ground SHAPE; spawnSurface's isSpawnCell
    //    ('enemy') call is the actual seat gate) ──────────────────────────
    { file: 'traps.js', re: /if \(isRoadCode\(T, grid\[i\]\) \|\| \(roadMask && roadMask\[i\]\)\) return true;/ },
    { file: 'traps.js', re: /^if \(roadMask && roadMask\[i\]\) return 0;/ },
    // ── zone_dressing.js: geometry (the connecting avenue's own walk stops
    //    at a road; place()/allowed() always calls WG.isSpawnCell) ────────
    { file: 'zone_dressing.js', re: /opts\.roadMask && opts\.roadMask\[i\]/ },
    // ── zone_coverage.js: terrain paint retains the visible road band ───
    { file: 'street_variants.js', re: /^if \(roadMask && roadMask\[i\]\) continue;/ },
    { file: 'zone_coverage.js', re: /^if \(roadMask && roadMask\[i\]\) \{/ },
    // ── render.js: tilling self-heal (draw-side, not a spawn) ────────────
    { file: 'render.js', re: /e3\.roadMask\[_ringIY\[_si\] \* N3 \+ _ringIX\[_si\]\]/ },
    // ── app.js: cellAt()'s general-purpose .underRoad flag (tilling /
    //    NPC movement / flavour text read it; nothing here places anything) ─
    { file: 'app.js', re: /entry\.roadMask\[iy \* N \+ ix\]/ },
    // ── creature_ai.js: the roadside run's geometry (which way the street
    //    runs, so a retreat runs along it — no spawn) ──────────────────────
    { file: 'creature_ai.js', re: /^return !!t && \(!!\(t\.entry\.roadMask && t\.entry\.roadMask\[t\.i\]\) \|\| WorldGen\.isRoadTerrain/ },
    // ── starter.js: the doorstep greeter's documented road-only fallback,
    //    which deliberately skips the gate's softer reasons ────────────────
    { file: 'starter.js', re: /^const onRoad = \(cx, cy\) => !!entry\.roadMask && entry\.roadMask\[cy \* N \+ cx\] === 1;/ },
  ];

  test('spawn gate sweep: no raw roadMask read outside a short named allowlist', () => {
    let total = 0;
    const bad = [];
    for (const [file, src] of Object.entries(ALL_SRC)) {
      const lines = src.split('\n');
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        if (!ROADMASK_READ.test(line)) continue;
        total++;
        const trimmed = line.trim();
        const allowed = ALLOW.some((a) => a.file === file && a.re.test(trimmed));
        if (!allowed) bad.push(`${file}:${li + 1}: ${trimmed}`);
      }
    }
    assert.gt(total, 5, `the sweep found roadMask reads to check (${total})`);
    assert.eq(bad.length, 0,
      `every roadMask read must route through WorldGen.isSpawnCell or be on the named allowlist:\n${bad.join('\n')}`);
    // The allowlist itself must not silently grow stale — an entry that
    // matches nothing is either hiding a fixed bug (good, but drop the row)
    // or a typo that let a real regression through unchecked.
    for (const a of ALLOW) {
      const lines = (ALL_SRC[a.file] || '').split('\n');
      const hit = lines.some((l) => a.re.test(l.trim()));
      assert.truthy(hit, `allowlist entry for ${a.file} (${a.re}) matches nothing — drop it or it is hiding a new read`);
    }
  });

  test('spawn gate sweep: the starter placers name a spawn class through isSpawnCell, not a bare roadMask test', () => {
    const src = ALL_SRC['starter.js'];
    // Every one of these placers used to read entry.roadMask directly; each
    // now asks the gate. Pinning the call text (not just "isSpawnCell
    // appears somewhere") keeps this from passing on an unrelated call.
    const wants = [
      /function placeStarterTrail\([\s\S]{0,2000}WorldGen\.isSpawnCell\(entry\.grid, N, N, cx, cy, spawnOpts, 'minor'\)/,
      /function scatterStarterStash\([\s\S]{0,2500}WorldGen\.isSpawnCell\(entry\.grid, N, N, cx, cy,\s*\{ roadMask: entry\.roadMask, spawnWhy: entry\.spawnWhy \}, 'minor'\)/,
      /function carveStarterPlot\([\s\S]{0,4000}WorldGen\.isSpawnCell\(grid, N, N, cx, cy,\s*\{ roadMask: entry\.roadMask, spawnWhy: entry\.spawnWhy \}, 'minor'\)/,
      /function carveStarterPond\([\s\S]{0,9000}spawnOkAt\(cx, cy, 'minor'\)/,
    ];
    for (const re of wants) assert.truthy(re.test(src), `starter.js: expected a gated placer matching ${re}`);
    const provision = src.slice(src.indexOf('  function provisionStarterHome('),
      src.indexOf('  function placeHomeGreeter('));
    assert.truthy(/spawnOkAt\(cx, cy, 'minor'\)/.test(provision),
      'provisionStarterHome uses its gated spawn class');
  });

  test('spawn gate sweep: the goblin trapper\'s snare (traps.js canLay) asks the gate unconditionally, no separate roadMask test', () => {
    const src = ALL_SRC['traps.js'];
    assert.truthy(/function canLay\(entry, lix, liy\)/.test(src), 'canLay exists');
    const body = src.slice(src.indexOf('function canLay('), src.indexOf('function canLay(') + 1500);
    assert.falsy(/entry\.roadMask && entry\.roadMask\[i\]/.test(body), 'no separate raw roadMask check left in canLay');
    assert.truthy(/if \(!WG\.isSpawnCell\(entry\.grid, N, N, lix, liy,\s*\{ roadMask: entry\.roadMask, spawnWhy: entry\.spawnWhy \}, 'enemy'\)\) return false;/.test(body),
      'canLay asks isSpawnCell unconditionally (mask or no mask)');
  });

  test('spawn gate sweep: a kill\'s bounty coin (_dropBountyCoin) asks the gate, like every other coin drop', () => {
    const src = ALL_SRC['app.js'];
    const at = src.indexOf('_dropBountyCoin(victim, amount)');
    assert.truthy(at >= 0, '_dropBountyCoin exists');
    const body = src.slice(at, at + 1600);
    assert.falsy(/WorldGen\.isRoadTerrain\(entry\.grid\[y \* N \+ x\]\)/.test(body), 'no bare isRoadTerrain-only test left');
    assert.truthy(/WorldGen\.isSpawnCell\(entry\.grid, N, N, x, y, spawnOpts, 'minor'\)/.test(body),
      '_dropBountyCoin routes its nudge through the shared spawn rule, class minor');
  });
})();
