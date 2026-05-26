// Testing tools — convenience helpers attached to window.TestTools that
// let an external driver (preview_eval, manual console, or a fixture script)
// exercise game mechanics without going through the UI gestures.
//
// Why this exists separately from test/runner.js + test/tests.js:
//   The harness runs ONE big batch at page load and reports pass/fail. These
//   tools are pokeable LIVE in the running game — meant for the sandbox where
//   you want to (a) reproduce a bug with one eval call, (b) advance a
//   work-progress wheel without waiting 10 s in real time, or (c) snapshot
//   state into a single JSON for diffing.
//
// Loaded unconditionally but inert until something calls TestTools.X(). Safe
// to ship in prod since it never auto-runs.
//
// Depends on:
//   app.js — scene (window.__scene), addToInv, spendEnergy, handleWorldTap,
//            buildInventoryDOM, _workProgress, cancelWorkProgress, REACH_*
//   items.js — ITEM_BY_ID, RELIC_DEFS
//   save.js — persistSave

(function (global) {
  // Resolve scene each call so it works even if the scene was re-created.
  const S = () => global.__scene;

  // ── Time / work-progress helpers ───────────────────────────────────
  // Force the in-flight work wheel to its completion handler without waiting
  // for the real-time duration. Returns true if a wheel was running.
  function flushWorkProgress() {
    const s = S();
    if (!s || !s._workProgress) return false;
    const wp = s._workProgress;
    const cb = wp.onComplete;
    s.cancelWorkProgress();
    cb();
    return true;
  }

  // Sleep utility wrapping setTimeout — useful for awaiting async tile work.
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Inventory / state mutators ─────────────────────────────────────
  function give(itemId, n = 1) {
    const s = S();
    s.addToInv(itemId, n);
  }

  // Select the inventory slot containing itemId. Returns the slot index or -1.
  function select(itemId) {
    const s = S();
    const idx = (s.save.inv || []).findIndex(e => e && e.id === itemId);
    if (idx < 0) return -1;
    s.save.selSlot = idx;
    s.refreshInventoryHighlight?.();
    return idx;
  }

  function setRelic(slot, tier) {
    const s = S();
    s.save.relics = s.save.relics || {};
    s.save.relics[slot] = { tier };
  }

  function setEnergy(n) {
    const s = S();
    s.save.energy = n;
  }

  function clearWorkProgress() {
    const s = S();
    if (s) s.cancelWorkProgress();
  }

  // ── Tap helpers ────────────────────────────────────────────────────
  // Tap a cell at offset (dxCells, dyCells) from the player's CELL CENTRE.
  // Cancels any in-flight work wheel first so the new tap isn't swallowed
  // by the "any tap cancels work" handler.
  function tapCellOffset(dxCells, dyCells) {
    const s = S();
    if (!s) return;
    if (s._workProgress) s.cancelWorkProgress();
    // Convert player WORLD → screen, then add cell offset in screen pixels.
    const pc = (typeof worldMetersToAbsCell === 'function')
      ? worldMetersToAbsCell(s, s.startWorldM.x + s.playerM.x, s.startWorldM.y + s.playerM.y)
      : null;
    let centreX, centreY;
    if (pc && typeof absCellCenterMeters === 'function') {
      const c = absCellCenterMeters(s, pc.cellIX, pc.cellIY);
      centreX = c.x; centreY = c.y;
    } else {
      centreX = s.startWorldM.x + s.playerM.x;
      centreY = s.startWorldM.y + s.playerM.y;
    }
    const wx = centreX + dxCells * s.cellM;
    const wy = centreY + dyCells * s.cellM;
    const ss = s.worldMetersToScreen(wx, wy);
    s.handleWorldTap(ss.x, ss.y);
  }

  // Tap a world-meter point directly. Useful for tapping an object whose
  // exact x/y was found via findObject().
  function tapWorld(wx, wy) {
    const s = S();
    if (s._workProgress) s.cancelWorkProgress();
    const ss = s.worldMetersToScreen(wx, wy);
    s.handleWorldTap(ss.x, ss.y);
  }

  // ── Locator helpers — find nearby content for tap targeting ──────────
  function nearestObject(predicate) {
    const s = S();
    const pWX = s.startWorldM.x + s.playerM.x;
    const pWY = s.startWorldM.y + s.playerM.y;
    let best = null, bestD2 = Infinity;
    for (const entry of WorldGen.tileCache.values()) {
      for (const o of (entry.objects || [])) {
        if (!predicate(o)) continue;
        const dx = o.x - pWX, dy = o.y - pWY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { best = o; bestD2 = d2; }
      }
    }
    return best;
  }

  function nearestWildplant(predicate) {
    const s = S();
    const pWX = s.startWorldM.x + s.playerM.x;
    const pWY = s.startWorldM.y + s.playerM.y;
    let best = null, bestD2 = Infinity;
    for (const entry of WorldGen.tileCache.values()) {
      for (const wp of (entry.wildplants || [])) {
        if (!predicate(wp)) continue;
        const dx = wp.x - pWX, dy = wp.y - pWY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { best = wp; bestD2 = d2; }
      }
    }
    return best;
  }

  function nearestCreature(predicate) {
    const s = S();
    const pWX = s.startWorldM.x + s.playerM.x;
    const pWY = s.startWorldM.y + s.playerM.y;
    let best = null, bestD2 = Infinity;
    for (const entry of WorldGen.tileCache.values()) {
      for (const c of (entry.creatures || [])) {
        if (s.save.caught.includes(c.id)) continue;
        if (!predicate(c)) continue;
        const dx = c.x - pWX, dy = c.y - pWY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { best = c; bestD2 = d2; }
      }
    }
    return best;
  }

  // Teleport: shift playerM directly. Cell centres are easier to reason about
  // than arbitrary world metres, so we accept WORLD METRES of the target.
  function teleport(wx, wy) {
    const s = S();
    s.playerM.x = wx - s.startWorldM.x;
    s.playerM.y = wy - s.startWorldM.y;
    s._ease = null;
  }

  // Move the player one CELL adjacent to the target (south by default) so
  // a tap on the target is in reach. Useful for "go interact with X" flows.
  function teleportAdjacent(target, side = 'south', cells = 1) {
    if (!target) return false;
    const s = S();
    const dx = side === 'west' ? -cells : side === 'east'  ? cells : 0;
    const dy = side === 'north' ? -cells : side === 'south' ? cells : 0;
    teleport(target.x + dx * s.cellM, target.y + dy * s.cellM);
    return true;
  }

  // ── Snapshots ──────────────────────────────────────────────────────
  // Compact state dump — what we usually want to assert against.
  function snapshot() {
    const s = S();
    const sv = s.save;
    return {
      money: sv.money,
      energy: sv.energy,
      maxEnergy: sv.maxEnergy,
      inv: (sv.inv || []).map(e => ({ id: e?.id, count: e?.count })),
      selSlot: sv.selSlot,
      picked: (sv.picked || []).length,
      caught: (sv.caught || []).length,
      opened: (sv.opened || []).length,
      planted: (sv.planted || []).length,
      tilled: (sv.tilled || []).length,
      placedRocks: (sv.placedRocks || []).length,
      brokenRocks: (sv.brokenRocks || []).length,
      foundTreasures: (sv.foundTreasures || []).length,
      chopped: (sv.chopped || []).length,
      relics: sv.relics ? Object.fromEntries(Object.entries(sv.relics).map(
        ([k, v]) => [k, v && v.tier])) : {},
      playerM: { x: +s.playerM.x.toFixed(2), y: +s.playerM.y.toFixed(2) },
      workProgress: !!s._workProgress,
    };
  }

  function invCount(itemId) {
    const s = S();
    return (s.save.inv || []).reduce((n, e) =>
      n + (e && e.id === itemId ? (e.count || 1) : 0), 0);
  }

  // ── Verify scenarios ───────────────────────────────────────────────
  // Each returns { name, pass, details } so a driver can collect and report.
  const VERIFY = {
    // 1) Walk into a tree. Equip an axe, tap, flush the chop wheel, expect
    //    the tree to be flagged chopped and 'tree' produce in the inventory.
    async chop_tree() {
      const s = S();
      setRelic('axe', 1);
      const tree = nearestObject(o => o.kind === 'tree' && !o.chopped);
      if (!tree) return { name: 'chop_tree', pass: false, details: 'no tree near player' };
      teleportAdjacent(tree, 'south', 1);
      const before = invCount('tree');
      tapWorld(tree.x, tree.y);
      const hadWheel = !!s._workProgress;
      flushWorkProgress();
      const after = invCount('tree');
      return {
        name: 'chop_tree',
        pass: hadWheel && after > before && !!tree.chopped,
        details: { hadWheel, before, after, chopped: tree.chopped },
      };
    },

    // 2) Break a rock cell. Equip a pick, stand next to a rock plot in the
    //    sandbox, tap, flush. Expect cell key in brokenRockSet.
    async break_rock() {
      const s = S();
      setRelic('pick', 3);   // iron = 1.5 s wheel
      setEnergy(50);
      // Find any rock cell in the start tile.
      const N = s.cellsPerTile;
      const pc = s.playerToWorldCell();
      const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${pc.tx}/${pc.ty}`);
      let target = null;
      for (let iy = 0; iy < N && !target; iy++) {
        for (let ix = 0; ix < N; ix++) {
          if (entry.grid[iy * N + ix] === 10) { target = { ix, iy }; break; }
        }
      }
      if (!target) return { name: 'break_rock', pass: false, details: 'no rock cell' };
      // Teleport to the rock cell, then tap it (cell-resolve uses our cell).
      const wmx = pc.tx * s.tileEdgeM + (target.ix + 0.5) * s.cellM;
      const wmy = pc.ty * s.tileEdgeM + (target.iy + 0.5) * s.cellM;
      teleport(wmx, wmy);
      const before = s.brokenRockSet.size;
      tapWorld(wmx, wmy);
      const hadWheel = !!s._workProgress;
      flushWorkProgress();
      return {
        name: 'break_rock',
        pass: hadWheel && s.brokenRockSet.size === before + 1,
        details: { hadWheel, before, after: s.brokenRockSet.size },
      };
    },

    // 3) Pick an instant wildplant (longgrass / nut / shrub-free). Walk over
    //    it and tap; expect inv + picked grows by 1.
    async pick_wildplant_instant() {
      const wp = nearestWildplant(w => w.crop === 'longgrass');
      if (!wp) return { name: 'pick_wildplant_instant', pass: false, details: 'no longgrass' };
      teleport(wp.x, wp.y);
      const s = S();
      const before = invCount(wp.crop);
      const pickedBefore = (s.save.picked || []).length;
      tapWorld(wp.x, wp.y);
      return {
        name: 'pick_wildplant_instant',
        pass: invCount(wp.crop) === before + 1 &&
              (s.save.picked || []).length === pickedBefore + 1,
        details: { crop: wp.crop, before, after: invCount(wp.crop) },
      };
    },

    // 4) Pick a rockfruit (uses work wheel — pick tier scales speed). Flush
    //    and expect the work wheel ran AND the produce landed in the inventory.
    async pick_rockfruit() {
      const s = S();
      setRelic('pick', 3);
      const wp = nearestWildplant(w => w.crop === 'rockfruit');
      if (!wp) return { name: 'pick_rockfruit', pass: false, details: 'no rockfruit' };
      teleport(wp.x, wp.y);
      const before = invCount('rockfruit');
      tapWorld(wp.x, wp.y);
      const hadWheel = !!s._workProgress;
      flushWorkProgress();
      return {
        name: 'pick_rockfruit',
        pass: hadWheel && invCount('rockfruit') === before + 1,
        details: { hadWheel, before, after: invCount('rockfruit') },
      };
    },

    // 5) Catch a chicken. Hold its favourite food (rainberry), tap, expect
    //    chicken in inv + creature flagged caught.
    async catch_chicken() {
      const s = S();
      give('rainberry', 1);
      select('rainberry');
      setEnergy(50);
      const c = nearestCreature(c => c.kind === 'chicken');
      if (!c) return { name: 'catch_chicken', pass: false, details: 'no chicken' };
      teleport(c.x, c.y);
      const before = invCount('chicken');
      tapWorld(c.x, c.y);
      return {
        name: 'catch_chicken',
        pass: invCount('chicken') > before && s.save.caught.includes(c.id),
        details: { before, after: invCount('chicken'), caughtId: c.id },
      };
    },

    // 6) Open a chest. Stand adjacent, tap, expect entry in save.opened AND
    //    at least one new inventory entry.
    async open_chest() {
      const s = S();
      const chest = nearestObject(o => o.kind === 'chest' && !s.save.opened.includes(o.id));
      if (!chest) return { name: 'open_chest', pass: false, details: 'no unopened chest' };
      teleportAdjacent(chest, 'south', 1);
      const invLenBefore = (s.save.inv || []).length;
      tapWorld(chest.x, chest.y);
      return {
        name: 'open_chest',
        pass: s.save.opened.length > 0 && (s.save.inv || []).length >= invLenBefore,
        details: { openedCount: s.save.opened.length, invDelta: (s.save.inv || []).length - invLenBefore },
      };
    },

    // 7) Till → plant → harvest a crop. Stand on an empty grass cell, till,
    //    plant a seed, force-grow the crop to stage 4, harvest.
    async crop_cycle() {
      const s = S();
      setEnergy(50);
      // Find an empty grass cell near the player plot — the sandbox's farmland
      // / player plots are reliable starts.
      const N = s.cellsPerTile;
      const pc = s.playerToWorldCell();
      const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${pc.tx}/${pc.ty}`);
      let cellIX = -1, cellIY = -1;
      for (let r = 1; r < 10 && cellIX < 0; r++) {
        for (let dy = -r; dy <= r && cellIX < 0; dy++) {
          for (let dx = -r; dx <= r && cellIX < 0; dx++) {
            const ix = Math.floor(pc.cx) + dx, iy = Math.floor(pc.cy) + dy;
            if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
            if (entry.grid[iy * N + ix] !== 0) continue;
            cellIX = ix; cellIY = iy;
          }
        }
      }
      if (cellIX < 0) return { name: 'crop_cycle', pass: false, details: 'no grass cell' };
      // Use the SAME cell-centre coords the cell-resolve handler will compute,
      // so the entries the planter writes are findable by exact equality.
      const cc = absCellCenterMeters(s, cellIX, cellIY);
      const wmx = cc.x, wmy = cc.y;
      teleport(wmx, wmy + s.cellM);   // stand south of target
      // Till — empty hands.
      s.save.selSlot = -1;
      tapWorld(wmx, wmy);
      const tilled = s.tilledSet.size > 0;
      // Plant — give and select a fast seed.
      give('potato_seed', 1);
      select('potato_seed');
      tapWorld(wmx, wmy);
      const cropEntry = (s.save.planted || []).find(p =>
        Math.abs(p.x - wmx) < 0.1 && Math.abs(p.y - wmy) < 0.1);
      const planted = !!cropEntry;
      // Force-grow: bump stage to mature directly so we can harvest.
      if (cropEntry) cropEntry.stage = 4;
      // Harvest — empty hands on a mature crop.
      s.save.selSlot = -1;
      const before = invCount('potato');
      tapWorld(wmx, wmy);
      const after = invCount('potato');
      return {
        name: 'crop_cycle',
        pass: tilled && planted && after > before,
        details: { tilled, planted, before, after },
      };
    },
  };

  // Reset transient save state that scenarios mutate, so a runAll is
  // reproducible from any starting point. NOT a full save wipe — keeps
  // money/maxEnergy/relics inv/etc. — only zeroes the slices each scenario
  // touches. Also resets the in-memory mirrors (brokenRockSet, tilledSet,
  // placedRockSet) and unflags in-memory chopped trees / opened chests.
  function resetTestState() {
    const s = S();
    if (!s) return;
    const sv = s.save;
    sv.picked = [];
    sv.caught = [];
    sv.opened = [];
    sv.chopped = [];
    sv.planted = [];
    sv.tilled = [];
    sv.placedRocks = [];
    sv.brokenRocks = [];
    sv.foundTreasures = [];
    sv.inv = [];
    sv.selSlot = -1;
    sv.energy = sv.maxEnergy ?? 100;
    sv.relics = sv.relics || {};
    s.tilledSet = new Set();
    s.placedRockSet = new Set();
    s.brokenRockSet = new Set();
    // Clear in-memory `chopped` flag on every cached tree object so prior
    // chop_tree runs don't poison nearestObject's filter.
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) {
        if (o.kind === 'tree') o.chopped = false;
      }
    }
    // Teleport back to the sandbox player plot so all "nearest X" lookups
    // start from the same anchor.
    if (typeof Sandbox !== 'undefined' && Sandbox.detect()) Sandbox.install(s);
    s.cancelWorkProgress?.();
    s.buildInventoryDOM?.();
  }

  async function runAll() {
    const out = [];
    for (const name of Object.keys(VERIFY)) {
      try {
        // Reset between scenarios so each one starts from a known state.
        resetTestState();
        const r = await VERIFY[name]();
        out.push(r);
      } catch (e) {
        out.push({ name, pass: false, details: 'threw: ' + (e?.message || e) });
      }
    }
    const passed = out.filter(r => r.pass).length;
    return { passed, total: out.length, results: out };
  }

  global.TestTools = {
    // mutation
    give, select, setRelic, setEnergy, resetTestState,
    // tap
    tapCellOffset, tapWorld, teleport, teleportAdjacent,
    // work-progress
    flushWorkProgress, clearWorkProgress,
    // search
    nearestObject, nearestWildplant, nearestCreature,
    // inspect
    snapshot, invCount, sleep,
    // verify
    VERIFY, runAll,
  };
})(window);
