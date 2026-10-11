// The scene's STREETS AND TRAIL — restoring roads as you walk them:
//   · street sight, ripening and metre banking (Streets owns the intervals);
//   · street lamps: textures, per-tile lists, visits and restoration;
//   · the trail's intro, prizes and reward cards, and the treasure pick.
//
// Moved out of app.js. The methods live on `class SceneStreets`, a MIXIN:
// app.js installs them onto MapScene.prototype right after the class closes
// (installSceneMixin, from modal_shell.js), so callers still say `this.x()`.
// This file loads BEFORE app.js: the methods read app.js names and this.* at
// CALL time only.

class SceneStreets {
  // ─── STREET RESTORATION ──────────────────────────────────────────────────
  // The road band is DILAPIDATED by default — cracked, damp, missing setts
  // (road_overlay.js's base pass) — and wherever a stretch of it has sat
  // inside the player's lit reach CONTINUOUSLY for PATH_STONE_DWELL_MS it is
  // rebuilt: clean black cobble with a hairline kerb, forever, saved. There is
  // no tap and no step to make. Linger by a street and it comes back under
  // you, which is what the reach circle is already telling you it covers.
  //
  // A STRETCH IS METRES, NOT CELLS. What restores is an interval of arclength
  // along ONE LINE of one OSM way (src/streets.js), because that is the
  // coordinate the band is stroked in. The terrain grid under-reports a road
  // every time (see the road rule in CLAUDE.md) — a motorway rasterizes one
  // cell wide however wide it really is — so a per-cell rule could never line
  // up with what the player sees restored. Until Sep 2026 this swept lit
  // PEBBLES, one sprite per 20 m, thinned by the renderer: half a street
  // restored between two stones paid nothing at all.
  //
  // Sight is CONTINUOUS: clip the edge of the bubble in passing and the clock
  // restarts next time (Streets.createSight drops a key's history when it goes
  // empty), and the auto-walk home earns none of it — that is the game moving
  // the body, not the player looking at anything.
  //
  // State shape (save_state.js documents it):
  //   save.streets      = { "<z/tx/ty>": { "<lineKey>": [s0,s1, s0,s1, …] } }
  //   save.streetsEpoch = n           ← what repaints the restored canvas
  //   save.trail        = { metres, prizes }
  //
  // THE SWEEP, in two halves. The SCAN (which metres of which lines are in
  // reach and not yet restored) is memoised on the reach CELL plus the radius:
  // standing still finds nothing new, and the only things that can bring fresh
  // street into the bubble are moving to another cell or the reach itself
  // changing (an upgrade, a potion, running out of energy). The RIPEN pass
  // runs every frame over the sight's small history, because the thing it is
  // waiting on is the clock, not the player.
  _sweepStreets() {
    if (typeof Streets === 'undefined') return;
    this._openTrailIntroIfDue();
    const surface = (this.depth ?? 0) === 0;
    // Cave levels carry no streets at all, so don't pay for the scan down
    // there — and the auto-walk home banks nothing.
    // …and a PASSENGER mends nothing (isTooFast): no restore, so no metres.
    if (!surface || this._driftingHome || this.isTooFast?.()) { this._resetStreetSight(); return; }
    const reachM = reachRadiusM(this);
    if (!(reachM > 0)) { this._resetStreetSight(); return; }
    const now = Date.now();
    const p = playerReachCell(this);
    const sight = this._streetSight || (this._streetSight = Streets.createSight());
    const sweepKey = `${p.cellIX},${p.cellIY},${Math.round(reachM)}`;
    if (this._streetSweepKey !== sweepKey) {
      this._streetSweepKey = sweepKey;
      this._rescanStreets(p, reachM, now, sight);
    }
    this._ripenStreets(now, sight);
  }

  // Forget every stretch the sight pass was watching. A line whose clock is
  // dropped here starts its dwell over the next time it comes into reach —
  // which is the point: sight has to be CONTINUOUS.
  _resetStreetSight() {
    this._streetSweepKey = null;
    this._streetLines = null;
    if (this._streetSight) this._streetSight.clear();
  }

  // THE SCAN. Every transportation line within reach, in the 3×3 tiles around
  // the player, snapshotted with the metres of it that are in reach, inside
  // this tile's own square, and not already restored.
  //
  // Measured from the REACH CELL, never the camera anchor (QC rules: a peek
  // drag must not restore three cells further than the arm reaches).
  // `cellInReach` is the same gate the lit silhouette and every tap use, so
  // what rebuilds is exactly what the lit area covers.
  //
  // ONLY THE TILE SQUARE COUNTS. MVT geometry runs past the tile edge into the
  // buffer, and the same metres come back inside the NEIGHBOUR tile's copy of
  // the way — so `tileSpans` clips to the square and nothing is paid twice.
  //
  // Rail is skipped (a railway is not a street to rebuild), and so are
  // parking aisles — they draw no band anywhere (WorldGen.isParkingAisle),
  // so there is no street to rebuild and no metres to be paid for them.
  _rescanStreets(p, reachM, now, sight) {
    const lines = this._streetLines || (this._streetLines = new Map());
    const seen = new Set();
    // The reach circle's centre in ABSOLUTE metres — the bbox prefilter below
    // works in each tile's local metres, so this is shifted per tile rather
    // than recomputed.
    const rc = absCellCenterMeters(this, p.cellIX, p.cellIY);
    // A cell of slack: reachIntervals charges a whole cell to the reach, so a
    // line grazing the cell at the rim is still in bounds.
    const pad = reachM + this.cellM;
    const pt = absCellToTile(this, p.cellIX, p.cellIY);
    eachTile3x3(pt.tx, pt.ty, (tx, ty) => {
      const tileKey = WorldGen.tileKey(tx, ty);
      const entry = WorldGen.tileCache.get(tileKey);
      if (!entry || !entry.layers || !(entry.tileEdgeM > 0)) return;
      const tileEdgeM = entry.tileEdgeM;
      const N = entry.cellsPerEdge || rowCells(this, ty);
      // The line is walked over THIS tile's own grid (its row's cells, in
      // frame metres), and each local cell asked of the reach through its
      // absolute key — never tx * N + lix by hand (coords.js encoding).
      const tileCellM = tileEdgeM / N;
      const base = tileCellToAbs(this, tx, ty, 0, 0);
      const baseIX = base.cellIX, baseIY = base.cellIY;
      const lx = rc.x - tx * tileEdgeM, ly = rc.y - ty * tileEdgeM;
      // Restoration is clipped to this tile's own square. Reject a neighbour
      // whose square the padded reach cannot touch before building or walking
      // its line catalogue; buffered MVT metres outside the square never count.
      if (lx + pad < 0 || lx - pad > tileEdgeM || ly + pad < 0 || ly - pad > tileEdgeM) return;
      // Build the immutable line catalogue once on the tile entry. A city
      // tile can carry hundreds of lines; before this cache every reach-cell
      // move walked every vertex merely to rediscover each bbox. New tile
      // entries (and sandbox's replacement layers) miss by object identity,
      // so rebuilds derive fresh geometry without a global epoch.
      let reachLines = entry._streetReachLines;
      if (!reachLines || entry._streetReachLinesLayers !== entry.layers
          || entry._streetReachLinesEdgeM !== tileEdgeM) {
        reachLines = [];
        for (const layer of entry.layers) {
          if (layer.name !== 'transportation') continue;
          const extent = layer.extent || 4096;
          const mvtToM = tileEdgeM / extent;
          for (const f of layer.features) {
            if (f.type !== 2 || !f.geom) continue;      // lines only
            const cls = (f.tags && f.tags.class) || '';
            if (cls === 'rail' || cls === 'transit') continue;
            if (WorldGen.isParkingAisle(f.tags)) continue;
            for (let i = 0; i < f.geom.length; i++) {
              const line = f.geom[i];
              if (!line || line.length < 2) continue;
              const b = Streets.lineBounds(f, i);
              if (!b) continue;
              reachLines.push({
                feature: f, lineIdx: i, line, lineKey: null, tags: f.tags,
                mvtToM, extent,
                x0: b.x0 * mvtToM, y0: b.y0 * mvtToM,
                x1: b.x1 * mvtToM, y1: b.y1 * mvtToM,
                tileSpans: null,
              });
            }
          }
        }
        entry._streetReachLines = reachLines;
        entry._streetReachLinesLayers = entry.layers;
        entry._streetReachLinesEdgeM = tileEdgeM;
      }
      for (const rec of reachLines) {
        if (rec.x1 < lx - pad || rec.x0 > lx + pad || rec.y1 < ly - pad || rec.y0 > ly + pad) continue;
        const line = rec.line, mvtToM = rec.mvtToM;
        // Hash only the handful of lines whose cached bounds touch reach.
        const lineKey = rec.lineKey || (rec.lineKey = Streets.lineKey(rec.feature, rec.lineIdx));
        let iv = Streets.reachIntervals(line, mvtToM, tileCellM,
          (lix, liy) => cellInReach(this, baseIX + lix, baseIY + liy));
        if (!iv.length) continue;
        // Tile clipping is immutable too, but only derive it for a line that
        // survived the bbox. Most city lines never pay even this first pass.
        const spans = rec.tileSpans || (rec.tileSpans = Streets.tileSpans(line, mvtToM, rec.extent));
        iv = Streets.intersect(iv, spans);
        if (!iv.length) continue;
        iv = Streets.subtract(iv, Streets.restoredList(this.save, tileKey, lineKey));
        if (!iv.length) continue;
        // One sight for every tile, so the key carries the tile too.
        const key = `${tileKey}|${lineKey}`;
        seen.add(key);
        const prev = lines.get(key);
        const meta = prev || { tileKey, lineKey, line, mvtToM, tx, ty, tileEdgeM, tags: rec.tags, t0: now };
        // A tile REBUILT under us hands back a new feature object, so
        // the geometry is refreshed even on a key we already hold — but
        // the clock is not: the player has been standing there the whole
        // time (see the rebuild rule in CLAUDE.md).
        meta.line = line; meta.mvtToM = mvtToM; meta.tags = rec.tags;
        meta.tileEdgeM = tileEdgeM;
        this._setStreetPreview(meta, iv);
        lines.set(key, meta);
        sight.snapshot(now, key, iv);
      }
    });
    // Anything that left the reach — or was fully restored — loses its clock
    // and its preview. An empty snapshot would do the same thing; dropping is
    // the same rule said once.
    for (const key of sight.keys()) if (!seen.has(key)) sight.drop(key);
    for (const key of [...lines.keys()]) if (!seen.has(key)) lines.delete(key);
  }

  // Cache one line's in-sight-unrestored intervals AND the world-metre
  // polylines that draw them. The preview is redrawn every frame but the
  // GEOMETRY only changes when the scan runs or a stretch is restored, so the
  // sub-polylines are cut once here rather than sixty times a second — a
  // merged way can carry thousands of vertices and subLineM walks them all.
  _setStreetPreview(meta, iv) {
    meta.iv = iv;
    meta.pts = [];
    for (const seg of iv) {
      const pts = Streets.runPtsWorld(meta, seg[0], seg[1]);
      if (pts) meta.pts.push(pts);
    }
  }

  // `k` points spread EVENLY by arclength across [s0, s1] of one line, in
  // WORLD metres — the gather burst's targets (see _ripenStreets /
  // GATHER_SPREAD_POINTS), so the "whole restored section" sink actually
  // covers the whole section rather than the raw polyline's own vertices. A
  // short dwell's restored stretch is often a single straight OSM segment —
  // two points, its ends — which would leave the middle of the section bare
  // and put every particle on one endpoint or the other; sampling by
  // arclength (Streets.pointAtM, the same resolver pointAtWorld uses)
  // spreads the targets however few vertices the underlying way actually has.
  _streetSpreadPts(meta, s0, s1, k) {
    const out = [];
    for (let i = 0; i < k; i++) {
      const s = s0 + (s1 - s0) * (k === 1 ? 0.5 : i / (k - 1));
      const p = Streets.pointAtWorld(meta, s);
      if (p) out.push(p);
    }
    return out;
  }

  // ── THE STREET LAMPS ─────────────────────────────────────────────────────
  // One gilded lamp every Streets.lampSpacingM() metres of RESTORED street.
  // Three passes, in the order the frame needs them:
  //
  //   _streetLampsForTile  where every lamp in one tile stands (geometry)
  //   _updateStreetLamps   which of them are lit and near enough to matter
  //
  // …and render.js's sprite pass draws them (RENDER_SPEC._streetlamp, off this
  // same list), in the shared world layer so each lamp takes its turn in the
  // screen-row z-order rather than sitting under every sprite on the map.
  //
  // and lighting.js's collectLamps turns the same list into the light each one
  // throws. Nothing here reaches the save: a lamp is generated from the way
  // and lit by the restored intervals that are already stored, the same
  // discipline traps.js keeps (generated, never stored — only what the player
  // DID is written down).

  // The broken post every lamp wears before its stretch is restored: the
  // same painter as the lit lamp below with `broken` set
  // (RoadOverlay.paintBrokenLamp), in the same square, baked once under
  // STREET_LAMP_BROKEN_TEX. One bake for every street — a broken lamp sheds
  // no glow, so it has no colour to key by.
  _ensureBrokenLampTex() {
    const key = STREET_LAMP_BROKEN_TEX;
    if (this.textures.exists(key)) return key;
    if (typeof RoadOverlay === 'undefined' || !RoadOverlay.paintBrokenLamp) return key;
    return this._ensureCanvasTex(key, RoadOverlay.LAMP_TEX_PX, (ctx, S) => RoadOverlay.paintBrokenLamp(ctx, S));
  }
  // ONE canvas-texture bake for a square piece (the lamps, the ghost's
  // glow, the Blight aura): skip a key the texture manager holds, else a
  // sizePx canvas, `paint(ctx, sizePx)`, uploaded once (textures.js
  // bakeCanvas). Returns the key.
  _ensureCanvasTex(key, sizePx, paint) {
    bakeCanvas(this, key, sizePx, sizePx, (ctx) => paint(ctx, sizePx));
    return key;
  }

  // Bake the lamp art for one GLOW colour, once: RoadOverlay.paintLamp with
  // that colour as its glass, bloom and pool, under streetLampTexKey(glow).
  // Cached BY COLOUR (the texture manager is the cache), so a street of forty
  // orange lamps is one bake. Returns the key render.js draws the lamp by.
  _ensureStreetLampTex(glow) {
    const key = streetLampTexKey(glow);
    if (this.textures.exists(key)) return key;
    if (typeof RoadOverlay === 'undefined' || !RoadOverlay.paintLamp) return key;
    return this._ensureCanvasTex(key, RoadOverlay.LAMP_TEX_PX, (ctx, S) => RoadOverlay.paintLamp(ctx, S, glow || UI_LAMP_GLOW));
  }

  // Every lamp of ONE tile, in ABSOLUTE world metres — lit or not. Cached on
  // the TILE ENTRY: it is a pure function of that tile's geometry, so it is
  // computed once per tile rather than per frame, and a tile REBUILT under us
  // hands back a new entry object that simply has no cache yet (the rebuild
  // rule in CLAUDE.md — carried across, or re-derived; this is re-derived).
  //
  // Only the lamps inside the TILE SQUARE are kept. MVT geometry runs past the
  // edge into the buffer and the same way comes back inside the neighbour's
  // copy, so without the tileSpans test the two tiles would each stand a stone
  // on the same stretch — two sprites and two stacked lights on one street.
  //
  // Rail is skipped: a railway is not a street to rebuild, so it never
  // lights. Parking aisles are skipped too (WorldGen.isParkingAisle) — no
  // band, no lamps beside it.
  //
  // Each lamp carries the way's TIER (WorldGen.classifyLine — the terrain
  // code the grid was painted with), which is what picks its unlit stone's
  // frame: the old cobble sheet drew a different cluster per road tier.
  //
  // AND IT STANDS ON THE VERGE, not on the centreline. `lampsAlong` says how
  // far along the way each stone is; how far OFF it is Streets.lampOffsetM —
  // half the way's own drawn width (WorldGen.roadOverlayWidthM, the number
  // the band is stroked with) plus the stone's own radius
  // (STREET_LAMP_R_CELLS x this tile's metres per cell), so the art just
  // touches the band's edge. The cell size is the TILE's own
  // (tileEdgeM / cellsPerEdge, the basis its geometry is in) rather than the
  // scene's global CELL_M, for the same reason rasterizeTile uses it.
  // One point comes out of it, and BOTH readers take that point: the sprite
  // the world pass seats and the light Lighting.collectLamps stamps, so the
  // glow can never be left behind on the tarmac.
  _streetLampsForTile(tx, ty, entry) {
    if (entry._streetLamps) return entry._streetLamps;
    // Never cache a loading tile's empty list.
    if (!entry.layers || !(entry.tileEdgeM > 0) || typeof Streets === 'undefined') return [];
    const out = RoadOverlay.lampSitesForTile(tx, ty, entry);
    entry._streetLamps = out;
    return out;
  }

  // The lamps near the frame, on this._streetLamps, each flagged `lit` — read
  // by render.js's sprite pass for the art (a lit one as the baked lamp, a dark
  // one as the old grey cobble) and by Lighting.collectLamps for the lights
  // (lit ones only), so the two can never disagree about which lamps are on:
  // ONE list, one flag, both readers.
  //
  // Measured from the CAMERA ANCHOR, not the feet: this asks "what do I DRAW",
  // and a peek drag has to bring the lamps at the peeked edge with it (the
  // camera rule in CLAUDE.md). Rebuilt only when the anchor CELL moves or a
  // stretch is restored (Streets.epoch) — standing still changes nothing, and
  // the epoch is exactly the integer the restored canvas repaints on.
  //
  // Surface only: the world is GPS-mirrored, and a cave has no streets to
  // light.
  _updateStreetLamps() {
    if (typeof Streets === 'undefined' || (this.depth ?? 0) !== 0) {
      this._streetLamps = null;
      this._streetLampKey = null;
      return;
    }
    // The anchor's tile and its absolute cell, exactly as the overlay frame
    // derives them (coords.js overlayFrame) — the tile ring is the anchor's
    // 3×3, so a peek at a tile edge still finds the lamps it drags into view.
    const a = viewAnchorCell(this);
    const { cellIX, cellIY } = viewAnchorAbsCell(this, a);
    // …and the LIVING-LAMP inputs: a visit (this._lampVisitEpoch, bumped by
    // _visitStreetLamps / _markLampsRestored) and the fade's clock, bucketed
    // at Streets.LAMP_REFRESH_MS — each lamp's `bright` is quantised
    // (Streets.lampBrightness), so the lightmap repaints only when a step
    // actually changes, not on every rebuild of this list.
    const now = Date.now();
    const key = `${cellIX},${cellIY}|${Streets.epoch(this.save)}|${this._lampVisitEpoch | 0}`
      + `|${Math.floor(now / Streets.LAMP_REFRESH_MS)}`;
    if (this._streetLampKey === key && this._streetLamps) return;
    const c = absCellCenterMeters(this, cellIX, cellIY);
    // Reach of the pass: the furthest a lamp can be and still show. The
    // viewport's half-diagonal plus the lamp's own light radius, so one a cell
    // off-screen still lights the edge — the same cull lighting.js pads with,
    // rather than the sprite cull.
    const lampR = (typeof Lighting !== 'undefined' && Lighting.radiusCells)
      ? Lighting.radiusCells('cobble') : 2.5;
    const pad = (Math.hypot(VIEW_CELLS, VIEW_CELLS) / 2 + lampR + PEEK_MAX_CELLS) * this.cellM;
    const ptx = a.tx, pty = a.ty;
    const out = [];
    // Set by any tile of the ring that has no data yet — the answer is then
    // provisional, so it is used for this frame but not memoised.
    let pending = false;
    eachTile3x3(ptx, pty, (tx, ty) => {
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
      // A tile still fetching/building answers nothing yet, and neither its
      // lamp list NOR this pass's own memo may be stamped on the strength of
      // it (see _streetLampsForTile) — otherwise standing still while the
      // ring lands leaves the lamps already in the save unlit until the
      // player happens to step onto another cell.
      // …but only a tile that could hold a lamp inside the pad (coords.js
      // tileBoxReach: a lamp stands in its tile's square, a verge offset off
      // its way). Waiting on one that cannot rebuilt this list every frame
      // while the far ring streamed in; its arrival changes nothing here.
      if (!entry || !entry.layers || !(entry.tileEdgeM > 0)) {
        const E = (entry && entry.tileEdgeM) || this.tileEdgeM;
        if (!(E > 0) || tileBoxReach(E, tx, ty, c.x - pad, c.y - pad, c.x + pad, c.y + pad)) pending = true;
        return;
      }
      const lamps = this._streetLampsForTile(tx, ty, entry);
      if (!lamps.length) return;
      // One restored list per LINE, not per lamp: unflattening the save's
      // flat pairs is the cost here and a long way carries several lamps.
      const restored = new Map();
      for (const L of lamps) {
        if (Math.abs(L.x - c.x) > pad || Math.abs(L.y - c.y) > pad) continue;
        let iv = restored.get(L.lineKey);
        if (iv === undefined) {
          iv = Streets.restoredList(this.save, L.tileKey, L.lineKey);
          restored.set(L.lineKey, iv);
        }
        // A lamp on a stretch still dilapidated is kept, DARK: it draws as
        // the plain cobble and throws no light. A fresh object per frame
        // the list rebuilds, never a flag written onto the tile's cached
        // geometry — that cache is per tile, this answer is per save.
        // `bright`: the living lamp's gain on the cobble row (Streets
        // .lampBrightness off save.lampVisits) — read by collectLamps.
        out.push({ ...L, lit: Streets.covers(iv, L.s),
                   bright: Streets.lampBrightness(Streets.lampVisitAt(this.save, L.id), now) });
      }
    });
    // Every LIT lamp's glow has its art baked before the sprite pass asks
    // for it — once per colour, however many lamps share it.
    if (this._ensureStreetLampTex) {
      const glows = new Set();
      for (const L of out) if (L.lit) glows.add(L.glow);
      for (const g of glows) this._ensureStreetLampTex(g);
    }
    this._streetLamps = out;
    this._streetLampKey = pending ? null : key;
  }

  // THE RIPEN PASS. Everything that has been in sight for the whole dwell is
  // rebuilt, and the whole step is banked ONCE: one blast, one counter, one
  // prize check, one save write however many stretches came back.
  _ripenStreets(now, sight) {
    const lines = this._streetLines;
    if (!lines || !lines.size) return;
    const ripe = sight.ripeAll(now, PATH_STONE_DWELL_MS);
    if (!ripe.length) return;
    let addedM = 0;
    // SCENIC METRES (src/scenic.js): what the same restore banks ON TOP on the
    // one ladder — a path by the water, along a greenway or through a park
    // (Scenic.bonusMetres off the tile's scenic intervals). A new REASON on
    // the ladder, never a second one; the km chip still reads true metres.
    let scenicKind = null;
    // What each way restored this sweep (true metres and scenic bonus) — the
    // pay is ONE of them (_oneRoadPay), the restore is all of them.
    const perLine = new Map();
    // The blast and the counter land on the LONGEST piece this sweep brought
    // back — the stretch the player will actually be looking at, rather than
    // a metre of driveway at the far rim of the bubble.
    let best = null, bestLen = 0;
    for (const { key, intervals } of ripe) {
      const meta = lines.get(key);
      if (!meta) { sight.drop(key); continue; }
      const out = Streets.restore(this.save, meta.tileKey, meta.lineKey, intervals);
      if (!(out.addedM > 0)) continue;
      addedM += out.addedM;
      const line = perLine.get(key) || { m: 0, bonus: 0 };
      perLine.set(key, line);
      line.m += out.addedM;
      const sIvs = this._scenicIntervals(meta.tileKey, meta.lineKey);
      if (sIvs) {
        const b = Scenic.bonusMetres(sIvs, out.newly, meta.mvtToM);
        if (b > 0) {
          line.bonus += b;
          const k = Scenic.kindOfNewly(sIvs, out.newly, meta.mvtToM);
          if (k && (!scenicKind || Scenic.SCENIC_MUL[k] > Scenic.SCENIC_MUL[scenicKind])) scenicKind = k;
        }
      }
      this._markLampsRestored(meta, out.newly, now);
      for (const seg of out.newly) {
        const len = seg[1] - seg[0];
        if (len > bestLen) {
          bestLen = len;
          best = {
            meta, s: (seg[0] + seg[1]) / 2,
            // The GATHER's targets: the whole piece, not its midpoint alone
            // (see _streetSpreadPts / GATHER_SPREAD_POINTS).
            spread: this._streetSpreadPts(meta, seg[0], seg[1], GATHER_SPREAD_POINTS),
          };
        }
        // THE SHINE: a white run down the stretch, fading over STREET_SHINE_MS
        // — and its alpha IS its switch (see STREET_SHINE_ALPHA), so at 0
        // the run is never recorded rather than kept for a pass that would
        // throw it away.
        if (STREET_SHINE_ALPHA > 0) {
          const pts = Streets.runPtsWorld(meta, seg[0], seg[1]);
          if (pts) {
            (this._streetShine || (this._streetShine = [])).push({ pts, tags: meta.tags, t0: now });
          }
        }
      }
      // What is left of this line's watched metres is what has NOT come back
      // yet, so the preview stops drawing over the clean band the same frame.
      this._setStreetPreview(meta, Streets.subtract(meta.iv || [], out.newly));
    }
    if (!(addedM > 0)) return;
    const at = best ? Streets.pointAtWorld(best.meta, best.s) : null;
    if (at) {
      // THE BLAST, on the stretch's own midpoint (projected): the near-white
      // flash on the lightmap, chips of pale sett, a ring of stone sparks and
      // the setts of `stonegather` pulling themselves back together over the
      // WHOLE piece (gatherPts: best.spread) — the repair read, not just the
      // impact one, and not just a repair of one point on the street. ONE per
      // sweep — the whole step is one moment, however many separate pieces of
      // street it brought back. durationMs ties the light to the street's own
      // (longer) shine clock rather than Lighting.BLAST_MS's generic default:
      // a street repair's moment is the slower one, whether or not the run
      // that clock was named for is drawn (STREET_SHINE_ALPHA). It plays a
      // beat after the restore itself — see _afterRestoreBeat.
      this._afterRestoreBeat(() => this._blastAt(at.x, at.y, {
        radiusCells: BLAST_STONE_R_CELLS, chips: 'stone', sparks: 'trailspark',
        gather: 'stonegather', gatherPts: best.spread, durationMs: STREET_SHINE_MS,
      }));
    }
    const pay = this._oneRoadPay(perLine, now);
    const mul = this._roadMetresMul();
    if (pay.m > 0 || pay.bonus > 0) {
      this._bankStreetMetres(pay.m * mul, at, now, pay.bonus > 0 ? { bonusM: pay.bonus * mul } : undefined);
    }
    if (scenicKind) this._scenicWalkStory(scenicKind);
    persistSave(this.save);
  }

  // ONE ROAD AT A TIME (ONE_ROAD_WINDOW_MS): of every way restored inside the
  // current window, only the one that restored the most pays, and only what
  // it has restored past what the window already paid. `perLine` is this
  // sweep's key → { m, bonus }; returns { m, bonus } to bank now. Living
  // lamps are NOT held to it — a lamp's credit is its own (_visitStreetLamps).
  _oneRoadPay(perLine, now) {
    let w = this._roadPayWin;
    if (!w || now - w.t0 >= ONE_ROAD_WINDOW_MS || now < w.t0) {
      w = this._roadPayWin = { t0: now, lines: new Map(), paidM: 0, paidBonus: 0 };
    }
    for (const [key, l] of perLine) {
      const acc = w.lines.get(key) || { m: 0, bonus: 0 };
      acc.m += l.m; acc.bonus += l.bonus;
      w.lines.set(key, acc);
    }
    let best = null;
    for (const acc of w.lines.values()) {
      if (!best || acc.m + acc.bonus > best.m + best.bonus) best = acc;
    }
    if (!best) return { m: 0, bonus: 0 };
    const m = Math.max(0, best.m - w.paidM), bonus = Math.max(0, best.bonus - w.paidBonus);
    w.paidM += m; w.paidBonus += bonus;
    return { m, bonus };
  }

  // THE STICK PAYS LESS: road metres earned while the body is off the GPS —
  // walked there by the stick or keyboard, or with no fix at all — bank at
  // Trail.STICK_METRES_MUL. The ladder is a reward for walking. Restores and
  // lamp visits alike (the ladder's two sources); the km chip reads the same
  // banked metres, so it too counts a stick km as less.
  _roadMetresMul() {
    return (!this.gpsM || this._offGps()) ? Trail.STICK_METRES_MUL : 1;
  }

  // A line's scenic intervals (src/scenic.js, entry.scenic — MVT arclength
  // units, generated), or null.
  _scenicIntervals(tileKey, lineKey) {
    if (typeof Scenic === 'undefined') return null;
    const entry = WorldGen.tileCache.get(tileKey);
    const sc = entry && entry.scenic;
    return (sc && sc.lines && sc.lines.get(lineKey)) || null;
  }

  // THE SCENIC WALK'S STORY: the first scenic metre a save restores tells its
  // row's story once (_storySplashOnce, the street_scenic painting —
  // StreetVariants' 'path' rows); a later restore on a scenic way gets the
  // row's map line, no oftener than STREET_FLASH_GAP_MS per row.
  _scenicWalkStory(kind) {
    const row = Scenic.rowFor(kind);
    if (!row) return;
    if (!(this.save.storySeen && this.save.storySeen[row.story])) {
      this._storySplashOnce(row.story, { art: row.art || row.story, title: row.title, body: row.body });
      return;
    }
    const last = (this._streetFlashAt = this._streetFlashAt || {});
    const t = performance.now();
    if (t - (last[row.id] || -Infinity) < STREET_FLASH_GAP_MS) return;
    last[row.id] = t;
    // The row's map line (≤ MAP_MSG_MAX — scenic.test.js measures every row).
    const line = row.flash;
    const ps = this.playerScreen ? this.playerScreen() : null;
    this.flash(line, ps ? ps.x : undefined, ps ? ps.y - ENERGY_POP_HEAD_PX - 22 : undefined);
  }

  // ── LIVING LAMPS ─────────────────────────────────────────────────────────
  // A lit lamp fades over a day (Streets.lampBrightness off save.lampVisits)
  // and a VISIT flares it: the player's FEET (playerM — gameplay, never the
  // camera anchor) coming within the lamp's range, the wider of its own light
  // radius (Lighting.radiusCells('cobble')) and the player's reach. EDGE-
  // triggered: a lamp is visited when it ENTERS range (this._lampsInRange is
  // the session's set of lamps the feet are already by), so standing beside
  // one pays once, and stepping out and back pays only the fade since.
  //
  // THE CREDIT is restore-ladder metres (Streets.lampCredit: the lamp's own
  // spacing x how dim it had got) banked through _bankStreetMetres — the ONE
  // lane the restore sweep adds metres by — and popped quietly as +Nm on the
  // lamp's own cell (_popCellNumber, the cell toast tier).
  //
  // THE SAME GATES AS THE SWEEP: surface only, no auto-walk home, no
  // passenger (isTooFast) and no reach (downed). While any holds, nothing is
  // visited, brightened or paid, and the in-range set is forgotten.
  // Re-derived from the same fix every call, memoised on the feet's cell +
  // Streets.epoch, so standing still costs one string compare.
  // Flavour toast when the feet step onto a house's own cell: a wreck grumbles
  // about itself, a restored house greets you. The `cell` toast tier, same as
  // the energy pops (_popCellNumber); one line per entry, keyed on the
  // house id so standing still (or shuffling within the cell) says nothing.
  // Each line fits MAP_MSG_MAX. Surface only, like the lamp visits.
  // HOME SAYS NOTHING (owner, Oct 2026): the lines are a NEIGHBOUR's voice
  // ("Thanks for fixing my house!"), and Home — the starter trailer or an
  // adopted house, one verdict: Houses.displayRole 'trailer' — is the
  // player's own, walked through a dozen times a session (see the rest
  // splash's settling above, the same complaint). Its tier-9 body is a
  // restored house to isHouseWreck, so the Home check comes first.
  _houseMutter() {
    if ((this.depth ?? 0) !== 0 || this._driftingHome || !this.startWorldM || !this.playerM
        || !this.originPx || typeof Houses === 'undefined') return;
    const p = playerReachCell(this);
    const key = `${p.cellIX},${p.cellIY}`;
    if (this._mutterCell === key) return;
    this._mutterCell = key;
    const pt = absCellToTile(this, p.cellIX, p.cellIY);
    const entry = WorldGen.tileCache.get(WorldGen.tileKey(pt.tx, pt.ty));
    if (!entry || !entry.layers) { this._mutterCell = null; return; }   // still loading: retry
    const { x: px, y: py } = playerWorldM(this);
    const r = this.cellM;
    let house = null;
    WorldGen.forEachItemInBox(entry, 'objects', px - r, py - r, px + r, py + r, (o) => {
      if (house || o.kind !== 'house') return;
      const c = worldMetersToAbsCell(this, o.x, o.y);
      if (c.cellIX === p.cellIX && c.cellIY === p.cellIY) house = o;
    });
    if (!house) return;
    if (Houses.displayRole(this.save, house) === 'trailer') return;   // Home: your own door
    const wreck = Houses.isHouseWreck(this.save, house);
    if (!wreck && house.tier !== 9) return;      // forts / castles keep their peace
    const lines = wreck ? HOUSE_WRECK_MUTTERS : HOUSE_RESTORED_MUTTERS;
    // Hash the id so a given house always has its own line for its state.
    let h = 0;
    for (let i = 0; i < house.id.length; i++) h = (h * 31 + house.id.charCodeAt(i)) >>> 0;
    const text = lines[(h + (this._mutterN = (this._mutterN | 0) + 1)) % lines.length];
    this._popCellNumber(text, wreck ? UI_DANGER_INK : UI_GREEN, p.cellIX, p.cellIY);
  }

  _visitStreetLamps(now) {
    if (typeof Streets === 'undefined') return 0;
    const surface = (this.depth ?? 0) === 0;
    const reachM = surface ? reachRadiusM(this) : 0;
    if (!surface || this._driftingHome || this.isTooFast?.() || !(reachM > 0)
        || !this.startWorldM || !this.playerM) {
      this._lampsInRange = null;
      this._lampVisitKey = null;
      return 0;
    }
    const p = playerReachCell(this);
    const key = `${p.cellIX},${p.cellIY}|${Math.round(reachM)}|${Streets.epoch(this.save)}`;
    if (this._lampVisitKey === key) return 0;
    const { x: px, y: py } = playerWorldM(this);
    const lightR = ((typeof Lighting !== 'undefined' && Lighting.radiusCells)
      ? Lighting.radiusCells('cobble') : 2.5) * this.cellM;
    const R = Math.max(lightR, reachM);
    const pt = absCellToTile(this, p.cellIX, p.cellIY);
    const inRange = new Set();
    const entered = [];
    let pending = false;
    const prev = this._lampsInRange || new Set();
    eachTile3x3(pt.tx, pt.ty, (tx, ty) => {
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
      // (Only a tile that could hold a lamp in range — see _updateStreetLamps.)
      if (!entry || !entry.layers || !(entry.tileEdgeM > 0)) {
        const E = (entry && entry.tileEdgeM) || this.tileEdgeM;
        if (!(E > 0) || tileBoxReach(E, tx, ty, px - R, py - R, px + R, py + R)) pending = true;
        return;
      }
      const lamps = this._streetLampsForTile(tx, ty, entry);
      const restored = new Map();
      for (const L of lamps) {
        if (Math.abs(L.x - px) > R || Math.abs(L.y - py) > R) continue;
        if (Math.hypot(L.x - px, L.y - py) > R) continue;
        let iv = restored.get(L.lineKey);
        if (iv === undefined) {
          iv = Streets.restoredList(this.save, L.tileKey, L.lineKey);
          restored.set(L.lineKey, iv);
        }
        if (!Streets.covers(iv, L.s)) continue;      // a dark stone is nobody's lamp yet
        inRange.add(L.id);
        if (!prev.has(L.id)) entered.push(L);
      }
    });
    this._lampsInRange = inRange;
    this._lampVisitKey = pending ? null : key;
    if (!entered.length) return 0;
    let paid = 0;
    const mul = this._roadMetresMul();
    for (const L of entered) {
      const m = Streets.visitLamp(this.save, L, now) * mul;
      if (!(m > 0)) continue;
      paid += m;
      const shown = Math.round(m);
      if (shown >= 1 && this._popCellNumber && typeof worldMetersToAbsCell === 'function') {
        const c = worldMetersToAbsCell(this, L.x, L.y);
        this._popCellNumber(`+${shown}m`, UI_STREET_INK, c.cellIX, c.cellIY);
      }
    }
    this._lampVisitEpoch = (this._lampVisitEpoch | 0) + 1;
    if (paid > 0) this._bankStreetMetres(paid, null, now, { quiet: true });
    Save.persist(this.save);
    return paid;
  }

  // A lamp LIT BY THE RESTORE ITSELF is visited now, for nothing: the sweep
  // just paid those metres, and the player is standing at it — so a freshly
  // rebuilt street's lamps flare, and pay again only when walked a later day.
  // `newly` is one line's intervals Streets.restore just added.
  _markLampsRestored(meta, newly, now) {
    if (!meta || !newly || !newly.length || typeof Streets === 'undefined' || !this._streetLampsForTile) return;
    const entry = WorldGen.tileCache.get(meta.tileKey);
    if (!entry || !entry.layers) return;
    let n = 0;
    for (const L of this._streetLampsForTile(meta.tx, meta.ty, entry)) {
      if (L.lineKey !== meta.lineKey || !Streets.covers(newly, L.s)) continue;
      Streets.visitLamp(this.save, L, now, false);
      if (this._lampsInRange) this._lampsInRange.add(L.id);
      n++;
    }
    if (n) this._lampVisitEpoch = (this._lampVisitEpoch | 0) + 1;
  }

  // A restore's EFFECTS (the stone blast, the metres counter) play
  // RESTORE_FX_DELAY_MS after it: the restore's own frame does the
  // bookkeeping and the frame after repaints the restored canvas, and piling
  // the particle emitter and a fresh text texture onto the first of those
  // made one ~19 ms frame out of three light ones (render-loop audit,
  // 2026-09-27). The save, the ladder and every prize move NOW — only the
  // picture waits, by less than an eye can tell. No clock (a headless stub
  // scene) runs it at once.
  _afterRestoreBeat(fn) {
    if (this.time && typeof this.time.delayedCall === 'function') {
      this.time.delayedCall(RESTORE_FX_DELAY_MS, fn);
    } else {
      fn();
    }
  }

  // A WRECK'S GATHER: the beat between the restore and its card, long enough
  // for `stonegather` (550–850 ms of lifespan) to land. Same headless rule as
  // _afterRestoreBeat: no clock runs it at once.
  _afterWreckGather(fn) {
    if (this.time && typeof this.time.delayedCall === 'function') {
      this.time.delayedCall(WRECK_GATHER_MS, fn);
    } else {
      fn();
    }
  }

  // The metres a sweep just restored, banked against the one ladder: show the
  // counter and queue whatever prizes the new total has earned.
  // `opts.quiet` (a living-lamp visit): the lamp popped its own +Nm on its
  // cell, so the ladder counter shows only when this banking PAYS a prize.
  // `opts.bonusM` (a scenic restore, src/scenic.js): extra LADDER metres on
  // top of the true ones — banked with them, and kept apart in
  // save.trail.bonusM so the km chip (Trail.restoredMetres) still shows true
  // metres; the bonus shows in the prizes.
  _bankStreetMetres(addedM, at, now, opts) {
    const st = this.save.trail = this.save.trail || { metres: 0, prizes: 0 };
    const bonusM = (opts && opts.bonusM > 0) ? opts.bonusM : 0;
    const out = Trail.bank(st.metres, st.prizes, addedM + bonusM, this.save.playerClass);
    st.metres = out.metres;
    st.prizes = out.prizes;
    if (bonusM > 0) st.bonusM = (st.bonusM || 0) + bonusM;
    // The counter: metres banked toward the current goal, popped ON THE STREET
    // in the colour a restored street is made of (UI_STREET_INK — the same
    // constant the chips and the sparks are thrown in), so the number and the
    // thing it counts read as one event.
    //
    // Seated through worldMetersToScreen, never off the player: a peek drag
    // moves the camera, and the counter has to stay on the stretch it is about
    // (QC rules — "where do I DRAW this?" goes through the projection). Falls
    // back to the centred toast if the point can't be projected — a headless
    // scene, or a sweep before the camera exists.
    //
    // THROTTLED. Walking along a street restores metres on nearly every frame,
    // and a number redrawn sixty times a second is a flicker. The ladder banks
    // regardless; only the toast waits (STREET_COUNTER_MIN_MS). A sweep that
    // PAYS jumps the queue — its readout is the goal just completed, which is
    // the number the prize ceremony opening beside it also prints.
    //
    // Trail.readout, not Trail.progress: on the sweep that pays, the counter
    // reads the goal just completed ("200/200 m"), so the street and the prize
    // modal agree; the carried remainder against the next, longer goal shows
    // from the next sweep on.
    const due = !(opts && opts.quiet) && (now - (this._streetCounterAt || 0)) >= STREET_COUNTER_MIN_MS;
    if (due || out.owed > 0) {
      this._streetCounterAt = now;
      const label = Trail.readout(out, this.save.playerClass).label;
      this._afterRestoreBeat(() => this._toast(label, {
        tier: 'note', color: UI_STREET_INK,
        ...(at ? this._worldToastAt(at.x, at.y, STREET_COUNTER_LIFT_PX) : {}),
      }));
    }
    // THE FIRST REPAIR. The very first metres this save ever banks ARM the one
    // dialog that says what a road is for (TRAIL_INTRO_TITLE) — it opens
    // TRAIL_INTRO_DELAY_MS later, once the repair it is about has played.
    // Flagged on the SAVE, so it is once per player and not once per reload;
    // The flag is set where the dialog actually
    // OPENS (_sweepStreets), never here — a greeting that lands behind the
    // how-to card is refused, and the next sweep that banks metres arms it
    // again. `greeting` is therefore "a greeting is owed", which is what holds
    // a prize ceremony back: whatever this sweep queues waits for the dialog
    // rather than opening in front of it. Nothing is owed until the save has
    // TRAIL_INTRO_MIN_M of road behind it — the first stretches play
    // unexplained, on purpose (see the constant).
    const greeting = !st.greeted && this._armTrailIntro(now, st);
    if (out.owed <= 0) return;
    // A wide reach can sweep past more than one goal in a single step, so this
    // is a COUNT, not a boolean — the queue hands the ceremonies out one at a
    // time rather than stacking modals on top of each other. Each entry is the
    // prize's ORDINAL, which is what decides how good its roll is.
    // Each is a `prize` ceremony; one owed a greeting holds until the greeting
    // has opened (its beat passes, _openTrailIntroIfDue queues it ahead).
    const hold = greeting ? () => !!this._trailIntroAt : undefined;
    for (let n = out.prizes - out.owed + 1; n <= out.prizes; n++) {
      this._enqueueCeremony('prize', (done) => this._fireTrailPrize(n, done), { hold });
    }
  }

  // ARM the first-repair dialog, and say whether a greeting is owed. A walker
  // banks metres on nearly every frame, so this is asked many times over the
  // wait and must set the deadline exactly once — an arm per sweep would push
  // the dialog out ahead of a player who keeps walking, which is every player.
  //
  // NOT OWED YET while the save's restored road (`st` is save.trail) is still
  // short of TRAIL_INTRO_MIN_M: the sweep then treats its prizes as it would
  // on a greeted save (none can be due that early — the threshold sits under
  // the first goal) and asks again on the next metres banked. Once armed, the
  // deadline stands whatever the later sweeps bank.
  //
  // A DEADLINE, not a timer: it is read by _sweepStreets, which runs every
  // frame whatever the player is doing, so the wait can't fire into a scene
  // that has moved on — and it is the shape this file already waits with
  // (_restHoldUntil, _streetCounterAt, the lightmap's own clock).
  _armTrailIntro(now, st) {
    if (this._trailIntroAt) return true;
    if (Trail.restoredMetres(st, this.save?.playerClass) < TRAIL_INTRO_MIN_M) return false;
    this._trailIntroAt = now + TRAIL_INTRO_DELAY_MS;
    return true;
  }

  // …and the other half: queue it once the beat has passed. Read from the
  // top of _sweepStreets — before that pass's own surface and reach gates,
  // because a greeting armed by a repair the player then walked away from
  // (into a cave, onto an empty bar) is still owed. The dialog is an `intro`
  // ceremony (app.js _enqueueCeremony): it waits for a clear screen (the
  // first sweep can land seconds into a brand new session, exactly when the
  // how-to card is up) and opens ahead of any prize the same sweep paid,
  // never beside it.
  _openTrailIntroIfDue() {
    if (!this._trailIntroAt || Date.now() < this._trailIntroAt) return;
    this._trailIntroAt = 0;
    this._enqueueCeremony('intro', (done) => this._showTrailIntro(done), { key: 'trail:intro' });
  }

  // The one-time "you start repairing roads" dialog, a beat after the sweep
  // that banks a save's first metres. The save's one greeting is spent as it
  // opens — on a dialog the player sees.
  _showTrailIntro(onDone) {
    this.showMessageModal({
      title: TRAIL_INTRO_TITLE,
      body: trailIntroBody(this.save.playerClass),
      // The banner the promise is made in: survivors watching the repair —
      // the story this dialog tells, drawn rather than described.
      art: 'trail_intro',
      onDismiss: onDone,
    });
    const st = this.save.trail = this.save.trail || { metres: 0, prizes: 0 };
    st.greeted = true;
    persistSave(this.save);
    return true;
  }

  // THE LIVE PASS — everything about a street that changes every frame, handed
  // to road_overlay.js as world-metre polylines (RoadOverlay.drawLive). Two
  // things, and neither can live on either baked canvas: a canvas rebuild is a
  // hundred strokes and a pattern fill, and these move sixty times a second.
  //
  //   the PREVIEW  the clean carriageway creeping in under the player while
  //                the dwell runs, at up to STREET_PREVIEW_ALPHA in
  //                STREET_PREVIEW_COLOR — the ghost of what is about to
  //                happen, so the two seconds read as a thing being done
  //                rather than a delay. Its alpha is the dwell's own
  //                progress: how long this line has been in sight. OFF while
  //                STREET_PREVIEW_ALPHA is 0 (see it) — the dwell still runs,
  //                it just isn't drawn, so the blast's flash is the first
  //                thing the player sees of a stretch coming back.
  //   the SHINE    a pale run down a stretch the instant it comes back, from
  //                STREET_SHINE_ALPHA to nothing over STREET_SHINE_MS beside
  //                the blast's flash. OFF while STREET_SHINE_ALPHA is 0 (see
  //                it) — the stretch still comes back on the same beat, and
  //                the blast's flash, chips, sparks and gather are the whole
  //                of what says so.
  //
  // With both switched off this pass has nothing left to draw, and that is
  // deliberate: it still runs, and still CLEARS the Graphics, which is what
  // keeps either switch a one-number edit instead of a re-wiring.
  //
  // Called every frame from drawRoadGeometry, AFTER RoadOverlay.draw has moved
  // the container by this frame's sub-cell scroll — drawLive subtracts that
  // offset back out, so running it from the sweep (which is earlier in
  // update()) would seat the preview against the PREVIOUS frame's scroll. It
  // runs on the frames the sweep's gates refuse too: with nothing to draw it
  // clears the Graphics, which is what stops a preview freezing on the ground
  // when the player walks into a cave.
  _drawStreetLive(now) {
    if (typeof RoadOverlay === 'undefined' || !RoadOverlay.drawLive) return;
    const t = (now == null) ? Date.now() : now;
    const runs = [];
    // The preview is the one thing here that can be switched off outright —
    // its alpha IS its switch, so at 0 the walk is skipped rather than run to
    // be thrown away by the gate below.
    const lines = STREET_PREVIEW_ALPHA > 0 ? this._streetLines : null;
    if (lines) {
      for (const meta of lines.values()) {
        if (!meta.pts || !meta.pts.length) continue;
        const alpha = clamp01((t - meta.t0) / PATH_STONE_DWELL_MS) * STREET_PREVIEW_ALPHA;
        if (!(alpha > 0.01)) continue;
        for (const pts of meta.pts) runs.push({ pts, tags: meta.tags, alpha, colour: STREET_PREVIEW_COLOR });
      }
    }
    const shine = STREET_SHINE_ALPHA > 0 ? this._streetShine : null;
    if (shine && shine.length) {
      // Compacted in place, never a splice per rejection: this walks the list
      // every frame and the list is at most a few sweeps deep.
      let w = 0;
      for (let i = 0; i < shine.length; i++) {
        const e = shine[i];
        const st = (t - e.t0) / STREET_SHINE_MS;
        if (!(st < 1)) continue;
        shine[w++] = e;
        // Eased out (the square), so the gleam is brightest for an instant and
        // spends most of its life on the way to gone rather than lingering
        // half-lit over the stretch behind the player.
        runs.push({ pts: e.pts, tags: e.tags,
                    alpha: STREET_SHINE_ALPHA * (1 - st) * (1 - st), colour: 0xffffff });
      }
      shine.length = w;
    }
    RoadOverlay.drawLive(this, runs);
  }

  // A toast's x/y at WORLD METRES (wmx, wmy), lifted `liftPx` so the text
  // (which hangs from `y`) sits above the thing rather than across it. THE one
  // seating for anything drawn at a place rather than at the player: the
  // street counter hangs on the stretch it just rebuilt, the energy pops on
  // their cell (through _cellToastAt below). Through worldMetersToScreen —
  // the camera-anchored projection — so a peek drag carries the number with
  // the ground (QC rules: "where do I DRAW this?" goes through the
  // projection). Returns {} — the toast's own centred default — when there's
  // nothing to project against.
  _worldToastAt(wmx, wmy, liftPx) {
    if (!Number.isFinite(wmx) || !Number.isFinite(wmy)) return {};
    if (!this.worldMetersToScreen || !this.startWorldM || !this.originPx) return {};
    const p = this.worldMetersToScreen(wmx, wmy);
    if (!p || !isFinite(p.x) || !isFinite(p.y)) return {};
    return { x: Math.round(p.x), y: Math.round(p.y) - liftPx };
  }

  // The same, for an absolute CELL: its centre, then as above. Read by the
  // energy pops (_energyPopAt), so a cell number and a street number seat
  // through the ONE projection.
  _cellToastAt(ix, iy, liftPx) {
    if (ix == null || iy == null) return {};
    if (typeof absCellCenterMeters !== 'function') return {};
    const c = absCellCenterMeters(this, ix, iy);
    return this._worldToastAt(c.x, c.y, liftPx);
  }

  // Reward fired when the lit-stone count reaches its goal. `n` is the prize's
  // ORDINAL — the 1st, 2nd, 3rd… — which is both what it took to get here
  // (Trail.GOAL_STEP × n stones) and how good the roll is.
  //
  // Uses the unified rarity picker on the ROAD's own context
  // (Trail.PRIZE_CONTEXT — rarity.js 'treasure:road': seeds first, with coins
  // and produce as the other faces) plus Trail.rollBonusFor extra chain steps
  // — one, and one more per prize already won, so a longer walk lands a better
  // find — while still not competing with the actual T4 epic POI chests.
  // Those bonus steps buy TIER only: the QUANTITY on the card is the curve's
  // own standard roll, not something the walk inflates (a bonus that fell
  // through to a quantity bracket is what pinned the ceremony at "× 2").
  // Routed through showChestRewardModal so it shares the same fanfare +
  // sparkles as chest opens. `onDismiss` is the ceremony queue's `done`
  // (one prize opens as the last is dismissed, never on top of it).
  //
  // PRIZE #1 LEADS WITH THE ONION SEED: Trail.firstPrize is the first card,
  // so the first thing a road ever offers names what roads pay in — and the
  // rest of the row is rolled, so rung one is a choice like every other.
  // PRIZE #4 IS THE SERPENT IDOL, alone (Trail.FIXED_PRIZES `sole`).
  //
  // THE PRIZE IS A CHOICE: it rolls Trail.PRIZE_CHOICES rewards and the
  // player keeps ONE. Nothing is granted until they pick — the roll they turn
  // down was never theirs — so the payout lives in _claimTrailReward and fires
  // from the button, not from here. Trail.rollCardRow owns the "the options
  // have to actually differ" rule and may hand back a single reward (a picker
  // with only one thing to give); that opens the plain one-reward ceremony it
  // always did, rather than a choice with one answer.
  //
  // ONE CARD PER GROUP (Trail.PRIZE_CARDS): cash, a seed or supply, and boots
  // or a magic item — boots held to Trail.bootsTierCap (a tier a kilometre).
  _fireTrailPrize(n, onDismiss) {
    const bonus = Trail.rollBonusFor(Math.max(0, (n | 0) - 1));
    const pc = this.save.playerClass;
    const bootsCap = Trail.bootsTierCap(n, pc);
    const ownedBoots = this.save.armor?.boots?.tier ?? 0;
    const rollFor = (g) => {
      if (typeof pickReward !== 'function') return null;
      const classes = Trail.prizeCardClasses(g, n, pc, ownedBoots);
      if (!classes.length) return null;
      return pickReward(Trail.PRIZE_CONTEXT, this.save, undefined,
        { rollBonus: bonus, classes, classMaxTier: { boots: bootsCap } });
    };
    const fixed = Trail.fixedPrize(n);
    const choices = fixed?.sole ? [fixed] : Trail.rollCardRow(rollFor, fixed ? [fixed] : []);
    // The ceremony carries the survivors' thanks; the road counter shows progress.
    const header = TRAIL_PRIZE_HEADER;
    if (!choices.length) {
      // Defensive fallback — give 5 coins so the player isn't stiffed.
      addMoney(this.save, 5);
      this.showChestRewardModal({
        kind: 'trail',
        header,
        art: 'trail_prize',
        iconHTML: this.coinIconHTML ? this.coinIconHTML(48) : '',
        name: '+5',
        sub: TRAIL_PRIZE_THANKS,
        color: UI_GOLD,
        onDismiss,
      });
      return;
    }
    if (choices.length === 1) {
      // One option is not a choice — claim it and run the ceremony as before.
      // A book grant defers its read (deferBookRead) so it doesn't stack on
      // top of this ceremony modal. On dismiss, reveal it first and only
      // THEN run the caller's own onDismiss (which may drain the next
      // queued prize into its own ceremony modal) — otherwise the next
      // prize's modal could open while the book read is still queued,
      // stacking the two again just one call later.
      const card = this._claimTrailReward(choices[0], { deferBookRead: true });
      if (!card) { if (typeof onDismiss === 'function') onDismiss(); return; }
      this.showChestRewardModal({
        kind: 'trail', header, ...card, art: 'trail_prize',
        sub: TRAIL_PRIZE_THANKS,
        onDismiss: () => this._revealPendingBookReads(onDismiss),
      });
      return;
    }
    // No flavour line: the header already carries the thanks, and the pick
    // names itself ("Choose one gift"). One picture row, one line, one button.
    // The thanks are the line under the card the kept gift then opens as.
    this._offerTreasurePick({ kind: 'trail', header, art: 'trail_prize', choices, takenSub: TRAIL_PRIZE_THANKS, onDismiss });
  }

  // The button face for one option: the reward's own icon over its name, so
  // the options read as small ceremonies rather than words. What the reward
  // DOES is not on the face — it is the line under the row once the card is
  // selected (_trailRewardBlurb, showChestRewardModal's `info`), so three
  // cards fit across.
  // The card's `sub` is deliberately NOT drawn here — it's the ceremony's
  // outcome line ("equipped"), and on an option the player hasn't taken yet
  // that would state as done the very thing the button is asking about.
  _trailChoiceLabel(reward) {
    // A smaller icon than the single-reward ceremony's own (64px): this one
    // sits in a button, stacked under the banner and the "Take your pick"
    // copy, and at 64px the choice row was the last straw that pushed the
    // ceremony past the viewport height into a scroll.
    const card = Rewards.card(this, reward, 44);
    if (!card) return '';
    const qty = card.qty
      ? `<div style="font-size:12px;font-weight:700;color:${card.color}">${card.qty}</div>` : '';
    return '<div style="display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0">' +
           `<div style="font-size:0;line-height:0">${card.iconHTML}</div>` +
           `<div style="font-size:11px;font-weight:700;color:${card.color};line-height:1.2">${card.name}</div>` +
           qty + '</div>';
  }

  // How ONE reward PRESENTS (icon, name, quantity, colour) is Rewards.card —
  // display only, it grants nothing, because an option the player didn't
  // take still has to be drawn; _claimTrailReward is the half that pays out.
  // The choice row asks for a smaller icon (_trailChoiceLabel) so it doesn't
  // push the ceremony past the viewport height.

  // What ONE reward DOES, the line under the pick row while its card is
  // selected — the same line the item already carries elsewhere (the ✦
  // effect, a relic's blurb, the soak an armour piece prints in the shop),
  // never a second description. Null when there is nothing to say (gold, an
  // item with no ✦ line): that card's line stays empty rather than saying
  // nothing at length.
  _trailRewardBlurb(reward) {
    if (!reward) return null;
    if (reward.kind === 'item') {
      const fx = (typeof ITEM_EFFECTS !== 'undefined') ? ITEM_EFFECTS[reward.id] : null;
      return fx ? `✦ ${fx}` : null;
    }
    if (reward.kind === 'relic') {
      return (typeof gearDef === 'function' ? gearDef('relic', reward.slot)?.blurb : null) || null;
    }
    if (reward.kind === 'armor') {
      return ARMOR_DEFS[reward.slot]?.blurb || null;
    }
    return null;
  }

  // ONE REWARD, SHOWN. The ceremony for a single reward already paid: its
  // own sprite, name, tier badge and amount on the chest shell, framed by the
  // caller (`kind`, `header`, `art`, `sub`, `onDismiss`). A seed a neighbour
  // hands over or the roll an elite drops is SEEN here, not read off a toast
  // (Oct 2026, owner's call: every quest reward that is an item shows the
  // item). The card's own sub ('equipped') follows a given one as its own
  // short sentence, so a relic's card still says it is worn. False, and
  // nothing shown, for a reward that draws no card.
  showRewardCard(reward, extra = {}) {
    // No fanfare of its own: the moment was framed by the caller (a pick
    // refuses it; an elite's roll fanfares from grantTreasureRoll).
    return Rewards.present(this, { ...reward, jackpot: 0 }, { extra });
  }

  // Pay out the reward the player KEPT — item into the bag, gold into the
  // purse, gear equipped — and hand back its card so the caller can say what
  // arrived. Consolation coins ride along with whatever was taken; a roll
  // nobody claimed pays none.
  _claimTrailReward(reward, opts = {}) {
    const card = Rewards.card(this, reward);
    if (!card) return null;
    Rewards.apply(this.save, reward, this, opts);
    return card;
  }

  // THE PICK — one lane for every "several finds, keep one" in the game
  // (Trail.PRIZE_CHOICES of them): the road ladder above. (A dug-up X was a
  // pick for a while in Sep 2026; it went back to paying one find.) Each card
  // IS a reward card (the shell takes HTML labels), so the player reads them
  // the way they read a single ceremony. A tap SELECTS a card and shows what
  // it does under the row (`info`); the one Take button pays it (Oct 2026 —
  // this replaced an ⓘ on every card, which cluttered the row and made a
  // tap on the card itself the irreversible act). An actions modal has no
  // tap-to-dismiss, so the prize can't be lost to a stray tap on the overlay.
  // Nothing is paid until Take is pressed: the option turned down was never theirs.
  //
  // AND THE KEPT GIFT IS SHOWN (Oct 2026, owner's call: every quest reward
  // that is an item shows the item). Take closes the pick and opens the kept
  // reward as its own card — sprite, name, tier and amount under the same
  // banner, `takenSub` (the giver's thanks) as its line — through
  // showRewardCard, the lane the single-reward ceremony and every other
  // earned reward use (a toast under a closing dialog is missed).
  //
  // The caller's `onDismiss` (the prize queue walking on) fires when the
  // CARD closes, not when the pick does: a queued prize draining on the
  // pick's close would open its own ceremony on the same shell id and
  // replace the card before it was read (makeModalShell drops a same-id
  // dialog). A book taken from the row reads after the card, as on the
  // single-reward path (deferBookRead → _revealPendingBookReads).
  _offerTreasurePick({ kind, header, art, choices, takenSub, kindIcon, onDismiss }) {
    let taken = null;
    this.showChestRewardModal({
      kind,
      header,
      art,
      kindIcon,
      // No icon: the banner is the picture and each choice button carries its
      // own. A gem here made the dialog taller than the screen.
      name: 'Choose one gift',
      cards: true,
      confirmLabel: 'Take',
      pickHint: 'Tap a gift to see what it does',
      actions: choices.map((reward) => ({
        label: this._trailChoiceLabel(reward),
        info: this._trailRewardBlurb(reward),
        onClick: () => {
          const card = this._claimTrailReward(reward, { deferBookRead: true });
          if (!card) return;
          taken = reward;
          // NO jackpot fanfare on a pick: with several finds on offer, the
          // boost chain that fattened one of them is not a moment the player
          // won — they chose among what was laid out.
          persistSave(this.save);
        },
      })),
      onDismiss: () => {
        const done = () => this._revealPendingBookReads(onDismiss);
        if (!taken || !this.showRewardCard(taken, { kind, header, art, kindIcon, sub: takenSub, onDismiss: done })) done();
      },
    });
  }

  // What a dig passes pickReward: underground, the depth and the depth's
  // tier (2, one more every CHEST_TIER_DEPTH_STEP levels — the ramp a cave
  // chest climbs), so a cave X takes the same cave skew a cave chest does:
  // supplies in the shallows, the deep hoard below (rarity.js caveSkewable).
  // On the surface, nothing — the X pays the pool it always has.
  digTreasureOpts() {
    const depth = this.depth || 0;
    if (depth <= 0) return undefined;
    const bonus = (typeof chestTierDepthBonus === 'function') ? chestTierDepthBonus(depth) : 0;
    return { depth, tier: 2 + bonus };
  }
}
