// Testing tools — convenience helpers attached to window.TestTools that
// let an external driver (preview_eval, manual console, or a fixture script)
// exercise game mechanics without going through the UI gestures.
//
// Unlike the harness batch, these are pokeable LIVE in the sandbox: reproduce a
// bug with one eval call, advance a work wheel without waiting, or snapshot
// state to JSON. Loaded unconditionally but inert until TestTools.X() is called.
//
// Depends on:
//   app.js — scene (window.__scene), addToInv, spendEnergy, handleWorldTap,
//            buildInventoryDOM, _workProgress, cancelWorkProgress, REACH_*
//   items.js — ITEM_BY_ID, RELIC_DEFS
//   save.js — persistSave

(function (global) {
  // Resolved per call: the scene may be re-created.
  const S = () => global.__scene;

  // ── Time / work-progress helpers ───────────────────────────────────
  // Force the in-flight work wheel to its completion handler. Returns true if one was running.
  function flushWorkProgress() {
    const s = S();
    if (!s || !s._workProgress) return false;
    const wp = s._workProgress;
    const cb = wp.onComplete;
    s.cancelWorkProgress();
    cb();
    return true;
  }

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
    // `setRelic('axe', null)` UNEQUIPS: slot-presence checks use
    // `save.relics?.axe`, truthy for any object, so no `{ tier: null }` placeholder.
    if (tier == null) s.save.relics[slot] = null;
    else s.save.relics[slot] = { tier };
  }

  function setEnergy(n) {
    const s = S();
    Energy.set(s.save, n);
  }

  function clearWorkProgress() {
    const s = S();
    if (s) s.cancelWorkProgress();
  }

  // ── Tap helpers ────────────────────────────────────────────────────
  // Tap a cell at offset (dxCells, dyCells) from the player's CELL CENTRE,
  // cancelling any work wheel first (any tap cancels work).
  function tapCellOffset(dxCells, dyCells) {
    const s = S();
    if (!s) return;
    if (s._workProgress) s.cancelWorkProgress();
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

  // Tap a world-meter point directly (e.g. an object found via findObject()).
  function tapWorld(wx, wy) {
    const s = S();
    if (s._workProgress) s.cancelWorkProgress();
    const ss = s.worldMetersToScreen(wx, wy);
    s.handleWorldTap(ss.x, ss.y);
  }

  // ── Locator helpers — find nearby content for tap targeting ──────────
  // The closest entry to the player across every cached tile's `listKey`
  // array that passes `predicate`; the nearest* helpers below wrap it.
  function _nearest(listKey, predicate) {
    const s = S();
    const pWX = s.startWorldM.x + s.playerM.x;
    const pWY = s.startWorldM.y + s.playerM.y;
    let best = null, bestD2 = Infinity;
    for (const entry of WorldGen.tileCache.values()) {
      for (const o of (entry[listKey] || [])) {
        if (!predicate(o)) continue;
        const dx = o.x - pWX, dy = o.y - pWY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { best = o; bestD2 = d2; }
      }
    }
    return best;
  }

  function nearestObject(predicate) {
    return _nearest('objects', predicate);
  }

  function nearestWildplant(predicate) {
    return _nearest('wildplants', predicate);
  }

  function nearestCreature(predicate) {
    const s = S();
    return _nearest('creatures', (c) => !s.save.caught.includes(c.id) && predicate(c));
  }

  // Teleport: shift playerM directly; takes WORLD METRES of the target.
  function teleport(wx, wy) {
    const s = S();
    s.playerM.x = wx - s.startWorldM.x;
    s.playerM.y = wy - s.startWorldM.y;
    // Movement is target-follow (app.js _followStep): without re-parking the
    // target the body walks straight back out of the teleport.
    if (s.syncMoveTarget) s.syncMoveTarget();
  }

  // Move the player `cells` adjacent to the target (south by default) so a tap is in reach.
  function teleportAdjacent(target, side = 'south', cells = 1) {
    if (!target) return false;
    const s = S();
    const dx = side === 'west' ? -cells : side === 'east'  ? cells : 0;
    const dy = side === 'north' ? -cells : side === 'south' ? cells : 0;
    teleport(target.x + dx * s.cellM, target.y + dy * s.cellM);
    return true;
  }

  // ── Snapshots ──────────────────────────────────────────────────────
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
      sprungTraps: (sv.sprungTraps || []).length,
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
    // 1) Equip an axe, tap a tree, flush the chop wheel: tree chopped, produce in inventory.
    async chop_tree() {
      const s = S();
      // Top-tier axe: this verifies the chop flow, not the axe-tier gate.
      setRelic('axe', 4);
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

    // 2) Equip a pick, tap a rock cell, flush: cell key lands in brokenRockSet.
    async break_rock() {
      const s = S();
      setRelic('pick', 3);   // iron = 1.5 s wheel
      setEnergy(50);
      const pc = s.playerToWorldCell();
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
      const N = entry.cellsPerEdge;   // the tile's own grid (its row's)
      let target = null;
      for (let iy = 0; iy < N && !target; iy++) {
        for (let ix = 0; ix < N; ix++) {
          if (entry.grid[iy * N + ix] === 10) { target = { ix, iy }; break; }
        }
      }
      if (!target) return { name: 'break_rock', pass: false, details: 'no rock cell' };
      const { x: wmx, y: wmy } = tileCellCenterMeters(s, pc.tx, pc.ty, target.ix, target.iy);
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

    // 3) Tap an instant wildplant (longgrass): inv + picked grow by 1.
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

    // 4) Pick a rockfruit (work wheel): the wheel ran AND the produce landed.
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

    // 5) Hold the chicken's favourite food (rainberry), tap: chicken in inv + flagged caught.
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

    // 6) Tap an adjacent chest: entry in save.opened AND inventory. A one-off
    //    chest only: a crate spends into the day ledger, and a pot of gold /
    //    bike rack is no chest.
    async open_chest() {
      const s = S();
      const chest = nearestObject(o => o.kind === 'chest' && !restocks(o) && !chestNeverSpent(o)
        && !isPotOfGold(o) && !isBikeRack(o) && !isBarrel(o)
        && !s.save.opened.includes(o.id));
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

    // 7) Till, plant, force-grow to stage 4, harvest on an empty grass cell.
    async crop_cycle() {
      const s = S();
      setEnergy(50);
      // An empty grass cell near the player plot.
      const pc = s.playerToWorldCell();
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
      const N = entry.cellsPerEdge;   // the tile's own grid (its row's)
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
      // Same cell-centre coords the tap handler computes, so planted entries
      // are findable by exact equality (cellIX / cellIY are tile-LOCAL).
      const cc = tileCellCenterMeters(s, pc.tx, pc.ty, cellIX, cellIY);
      const wmx = cc.x, wmy = cc.y;
      teleport(wmx, wmy + s.cellM);   // stand south of target
      // Till with empty hands.
      s.save.selSlot = -1;
      tapWorld(wmx, wmy);
      const tilled = s.tilledSet.size > 0;
      give('potato_seed', 1);
      select('potato_seed');
      tapWorld(wmx, wmy);
      const cropEntry = (s.save.planted || []).find(p =>
        Math.abs(p.x - wmx) < 0.1 && Math.abs(p.y - wmy) < 0.1);
      const planted = !!cropEntry;
      if (cropEntry) cropEntry.stage = 4;
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

  // Reset the transient save state scenarios mutate, so a runAll is
  // reproducible. NOT a full wipe (keeps money/maxEnergy/relics). Also resets
  // the in-memory mirrors (brokenRockSet, tilledSet, placedRockSet) and unflags
  // chopped trees.
  function resetTestState() {
    const s = S();
    if (!s) return;
    const sv = s.save;
    sv.picked = [];
    sv.caught = [];
    sv.opened = [];
    sv.chopped = [];
    sv.planted = [];
    s.tilledSet.clear();
    s.placedRockSet.clear();
    s.brokenRockSet.clear();
    sv.foundTreasures = [];
    sv.sprungTraps = [];
    sv.scarecrows = [];
    // Per-creature produce cooldown (lastProduce[id] = epoch ms); else a fed
    // chicken/cow refuses to produce again for an hour.
    sv.lastProduce = {};
    sv.inv = [];
    sv.selSlot = -1;
    sv.eatReadyAt = 0;
    Energy.set(sv, sv.maxEnergy ?? 100);
    sv.relics = sv.relics || {};
    for (const e of WorldGen.tileCache.values()) {
      for (const o of (e.objects || [])) {
        if (o.kind === 'tree') o.chopped = false;
      }
      // The mirror of save.lastProduce on the creature object itself.
      for (const c of (e.creatures || [])) {
        if (c._lastProduceT) c._lastProduceT = 0;
      }
    }
    // Back to the sandbox player plot so "nearest X" lookups share an anchor.
    if (typeof Sandbox !== 'undefined' && Sandbox.detect()) Sandbox.install(s);
    s.cancelWorkProgress?.();
    s.buildInventoryDOM?.();
  }

  async function runAll() {
    const out = [];
    for (const name of Object.keys(VERIFY)) {
      try {
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
