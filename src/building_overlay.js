// Original OSM building geometry overlay — POLYGONAL footprints.
//
// Buildings reach the player as CELLS: worldgen assigns each `building`
// polygon an exclusive set of grid cells (assignBuildingFootprints) and paints
// them in the tier's colour, and render.js draws the silhouette from those
// cells — a south-facing extrusion and an outline along every cell edge whose
// neighbour isn't the same building. That rasterization is lossy in a way you
// can see from the street: a house at 30° to the grid squares off into a
// staircase, an L-shaped block loses its notch, a bay or a porch smaller than
// a cell disappears, and two buildings that abut weld into one span of tier
// colour separated only by a seam.
//
// This layer draws the SOURCE rings instead — `entry.buildingShapes`, the
// polygons worldgen kept from the decoded MVT (tile-local metres, carrying the
// tier the distribution pass settled on and the ownerKey the footprint was
// stamped with). Same idea as road_overlay.js, one dimension up: the roads
// overlay strokes the raw linework the rasterizer turned into road cells; this
// one FILLS the raw rings it turned into building cells.
//
// It is a REPLACEMENT, not a decoration. While it's on (BuildingOverlay
// .enabled()), render.js paints building cells as the ground around them — the
// same neighbour-zone colour and texture a road cell inherits — and skips the
// tiled floor, extrusion, outline, palisade and rampart passes entirely, so
// what you see IS the polygon. Flip it off (`__POLY_BUILDINGS = false`, or
// BuildingOverlay.setEnabled(scene, false) from the console) and the tiled art
// comes straight back — that A/B is the whole point of the layer.
//
// What the polygon draws, tier for tier, is what the cells used to:
//   • the floor, in the tier's colour, carrying the tier's own biome texture
//     (house cobbles / fort planks / castle paving) so the material reads;
//   • a south-facing wall: the ring filled again, shifted down by the tier's
//     face depth, UNDER the floor — one fill that lands a wall on exactly the
//     south-facing edges of any polygon, however it's shaped;
//   • a 1px silhouette outline;
//   • a castle's rampart, as a stone band running INSIDE the ring with the
//     merlon rhythm dashed along it;
//   • and the unclaimed shade — the same transform textures.js bakes the
//     unclaimed castle palette with, applied to the colours rather than washed
//     over the top, so two overlapping footprints can't wash one twice.
//
// Painter rule (CLAUDE.md): the LOWER object renders in front. Shapes are
// drawn in order of their SOUTHERNMOST point, so a building's wall face lands
// over the floor of whatever sits north of it, exactly as the cell-row z-order
// does for sprites.
//
// Depends on:
//   scene fields (read-only): buildingGeomGfx, buildingGeomContainer,
//     startWorldM, playerM, cellM, cellsPerTile, depth, textures,
//     viewCenterX/Y, viewLeft, viewTop, viewSize
//     helpers: playerToWorldCell(), isClaimedKey()
//   worldgen.js — WorldGen.tileCache, WorldGen.tileKey;
//                 per-tile `entry.buildingShapes` + `entry.tileEdgeM`
//   render.js   — Render.BUILDING_FACE_COLOR / BUILDING_FACE_PX (the tiled
//                 pass's own wall colours + depths, so the two can't drift)
//   textures.js — CASTLE_STONE / CASTLE_STONE_UNCLAIMED, unclaimedShade
//   app.js consts — COLORS, CELL_PX
//
// Exports as globals:
//   BuildingOverlay.draw(scene)       — per-frame entry point (cheap when cached)
//   BuildingOverlay.invalidate(scene) — force a rebuild on the next draw
//   BuildingOverlay.enabled()         — is the polygonal mode on?
//   BuildingOverlay.setEnabled(scene, on)
(function (global) {
  const CASTLE = 12;   // BUILDING_LARGE — the one tier that draws a rampart

  // Floor colours come from app.js's terrain palette — the very table the
  // tiled floor fill reads — so a polygon and the cells under it are the same
  // colour by construction. The fallbacks are for the headless suite, where
  // app.js isn't loaded.
  const FLOOR_FALLBACK = { 9: 0x9d6350, 11: 0x9b8365, 12: 0x787a80 };
  const floorColor = (tier) =>
    (typeof COLORS !== 'undefined' && COLORS[tier] != null) ? COLORS[tier]
      : (FLOOR_FALLBACK[tier] ?? 0x9d6350);

  // Wall face + its depth: render.js's own SOUTH_FACE_COLOR / SOUTH_FACE_PX,
  // read through Render so the polygonal wall and the tiled one are the same
  // material at the same height. The fallback is DERIVED rather than copied —
  // 40% brightness of the floor, which is what those constants are (see the
  // comment above them in render.js) — so a missing table can't silently
  // introduce a third set of numbers.
  const FACE_MUL = 0.4;
  const dim = (c, m) => {
    const r = Math.round(((c >> 16) & 255) * m);
    const g = Math.round(((c >> 8) & 255) * m);
    const b = Math.round((c & 255) * m);
    return (r << 16) | (g << 8) | b;
  };
  const faceColor = (tier) => {
    const tbl = (typeof Render !== 'undefined' && Render.BUILDING_FACE_COLOR) || null;
    return (tbl && tbl[tier] != null) ? tbl[tier] : dim(floorColor(tier), FACE_MUL);
  };
  const facePx = (tier) => {
    const tbl = (typeof Render !== 'undefined' && Render.BUILDING_FACE_PX) || null;
    return (tbl && tbl[tier] != null) ? tbl[tier] : (tier === CASTLE ? 5 : 4);
  };

  // The silhouette. The tiled pass draws its outline as black at 50% over the
  // floor; mixing the same black into the floor colour lands the identical
  // pixel without a translucent stroke that would double up wherever two
  // rings touch.
  const OUTLINE_MUL = 0.5;
  const OUTLINE_PX = 1;

  // Castle rampart: a stone band run INSIDE the ring (the cell version's
  // 5px side walls), with the merlon grid dashed along it — 4px tooth,
  // 4px crenel, the same 8px rhythm the tiled battlements tile at.
  const BAND_PX = 5;
  // The teeth sit on the OUTER lip of that band, not across the whole of it:
  // a dashed stroke as wide as the band replaces the stone rather than
  // crowning it, and the wall reads as a dashed ribbon instead of masonry.
  const MERLON_PX = 2;
  const MERLON_DASH = [4, 4];

  // "Somebody else's". The tiled pass washes the finished cells; here the
  // COLOURS are shaded instead — the same unclaimedShade() transform
  // textures.js bakes the unclaimed castle palette with. Overlapping OSM
  // footprints (a shed drawn inside a house, say) would take a translucent
  // wash twice and read darker than their neighbours; a shaded colour can't.
  const shadeOf = (claimed) => {
    if (claimed || typeof unclaimedShade !== 'function') return (c) => c;
    return (c) => unclaimedShade(c);
  };

  // Castle masonry, from the shared palette so a polygon rampart is the same
  // stone as the turret sprites standing on it.
  const castleStone = (claimed) => {
    const CS = (typeof CASTLE_STONE === 'undefined') ? null
      : (claimed || typeof CASTLE_STONE_UNCLAIMED === 'undefined'
        ? CASTLE_STONE : CASTLE_STONE_UNCLAIMED);
    const sh = shadeOf(claimed);
    return {
      body: CS ? CS.BODY.n : sh(0x8f9298),
      lite: CS ? CS.LITE.n : sh(0xb9bcc2),
      dark: CS ? CS.DARK.n : sh(0x303134),
    };
  };

  // The dashed cell grid, from render.js so the lattice over a footprint is
  // the SAME lattice as the one over the ground it stands on — same hairline,
  // same softness, same 4-on-4-off rhythm — and continues across the building
  // instead of restarting at its wall.
  const GRID_FALLBACK = { width: 1, color: 0x000000, alpha: 0.08, dash: 4, gap: 4 };
  const gridStyle = () =>
    ((typeof Render !== 'undefined' && Render.GRID_LINE) || GRID_FALLBACK);
  // …with ONE thing changed per building: the ink. The ground's grid is a
  // black hairline, which works over grass and stone and disappears entirely
  // into a dark floor — an unclaimed house is shaded most of the way to black,
  // and 8% black on near-black is nothing. So the ink flips to white where the
  // floor is too dark to take a dark line, at the same weight, rhythm and
  // alpha: the lattice stays the ground's lattice, it just stays VISIBLE.
  // Rec. 601 luma, and the threshold is where a mid-grey stops reading dark.
  const LUMA_FLIP = 0.42;
  const luma = (c) => (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;
  // …and one thing more: the WEIGHT. 8% reads on the ground because the ground
  // is quiet — grass tufts, sand ripples, a park's flowers are all low-contrast
  // at this scale. A floor is not: house cobbles, fort planks and castle paving
  // are high-frequency patterns with far more local contrast than the hairline
  // carries, and measured over one, an 8% line moves a pixel by ~10/255 while
  // the material itself swings ~20. The lattice was there and invisible. This
  // multiple puts the line's contrast against a paved floor roughly where 8%
  // puts it against grass — same hairline, same rhythm, same softness to the
  // eye; it is the BACKGROUND that changed, not the intent.
  const GRID_OVER_FLOOR_MUL = 2;
  const gridInkFor = (style, floor) => ({
    ...style,
    alpha: style.alpha * GRID_OVER_FLOOR_MUL,
    color: luma(floor) >= LUMA_FLIP ? style.color : 0xffffff,
  });

  const cssOf = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
  const rgbaOf = (c, a) =>
    `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

  // ── The polygonal mode switch ────────────────────────────────────────────
  // Default ON — this branch exists to look at it. `false` (not merely falsy)
  // turns it off so an undefined flag still means on.
  function enabled() {
    return (typeof global === 'undefined') || global.__POLY_BUILDINGS !== false;
  }
  function setEnabled(scene, on) {
    global.__POLY_BUILDINGS = !!on;
    invalidate(scene);
    // The road band's keep-out depends on this flag too (it stops punching
    // building cells out once the buildings aren't cells any more), and that
    // layer caches its canvas the same way — so flip both or the roads keep
    // last mode's holes until the player walks a cell.
    if (typeof RoadOverlay !== 'undefined') RoadOverlay.invalidate(scene);
    return !!on;
  }

  // ── Fill target ──────────────────────────────────────────────────────────
  // The overlay paints into a Graphics-SHAPED object: clear / fillPoly /
  // strokePoly / insetStroke / texturePoly, plus commit() once the pass is
  // done. In the game that's the canvas-2D adapter below; the headless tests
  // inject a recording stub as scene.buildingGeomGfx.
  //
  // Canvas 2D rather than a Phaser Graphics for the same reasons the road
  // overlay uses it: real path fills with holes and joins, `clip()` for the
  // rampart band, and pattern fills for the materials — none of which Phaser's
  // Graphics offers. The whole layer is opaque, so unlike the roads there's no
  // alpha to keep off itself.
  const TEX_KEY = 'buildinggeom_overlay';
  function canvasTarget(scene) {
    if (typeof document === 'undefined' || !scene.textures || !scene.buildingGeomContainer) return null;
    if (scene._buildingGeomTarget) return scene._buildingGeomTarget;
    const pad = CELL_PX * 2;
    const size = Math.ceil(scene.viewSize + pad * 2);
    const originX = scene.viewLeft - pad, originY = scene.viewTop - pad;
    if (scene.textures.exists(TEX_KEY)) scene.textures.remove(TEX_KEY);
    const tex = scene.textures.createCanvas(TEX_KEY, size, size);
    if (!tex) return null;
    const ctx = tex.getContext();
    ctx.lineJoin = 'round';
    const img = scene.add.image(originX, originY, TEX_KEY).setOrigin(0, 0);
    scene.buildingGeomContainer.add(img);
    // Material patterns, one per tier, taken from the biome textures the tiled
    // floors already wear (textures.js bakes them as canvas textures, and they
    // are pure black/white alpha — a modulation, so they sit correctly over a
    // shaded unclaimed fill without repainting it back to lit). Built lazily
    // and kept for the life of the target.
    const patterns = new Map();
    const patternFor = (tier) => {
      if (patterns.has(tier)) return patterns.get(tier);
      let p = null;
      const key = `biome${tier}_0`;
      if (scene.textures.exists(key)) {
        const src = scene.textures.get(key).getSourceImage();
        // Width/height guard: createPattern THROWS on a zero-sized source, and
        // a texture that hasn't been baked yet would take the whole pass —
        // every building on screen — down with it. No material is fine; the
        // floor is still the tier's colour.
        if (src && src.width && src.height) p = ctx.createPattern(src, 'repeat');
      }
      patterns.set(tier, p);
      return p;
    };
    // The material patterns are anchored to the WORLD, not the canvas: the
    // texture is screen-fixed while the buildings slide across it, so an
    // un-phased pattern would swim over the floors as the player walks. Whole
    // pixels only — a fractional translate resamples the tile and mushes it.
    let phaseX = 0, phaseY = 0;
    const TILE = (typeof SpriteLayout !== 'undefined' && SpriteLayout.CELL_PX) || CELL_PX;
    const wrap = (v) => ((Math.round(v) % TILE) + TILE) % TILE;
    const trace = (pts) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x - originX, pts[0].y - originY);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x - originX, pts[i].y - originY);
      ctx.closePath();
    };
    const target = {
      clear() { ctx.clearRect(0, 0, size, size); },
      fillPoly(pts, color) {
        if (!pts || pts.length < 3) return;
        trace(pts);
        ctx.fillStyle = cssOf(color);
        ctx.fill();
      },
      strokePoly(pts, width, color) {
        if (!pts || pts.length < 3) return;
        trace(pts);
        ctx.lineWidth = width;
        ctx.strokeStyle = cssOf(color);
        ctx.stroke();
      },
      // A band running INSIDE the ring: clip to the polygon and stroke it at
      // double width, so the outer half falls away and the inner half is a
      // band of exactly `width` hugging the wall. `dash` (optional) gives the
      // band the crenellation rhythm.
      insetStroke(pts, width, color, dash) {
        if (!pts || pts.length < 3) return;
        ctx.save();
        trace(pts);
        ctx.clip();
        trace(pts);
        ctx.lineWidth = width * 2;
        ctx.strokeStyle = cssOf(color);
        if (dash) ctx.setLineDash(dash);
        ctx.stroke();
        ctx.restore();
      },
      // The ground's own cell lattice, continued across the footprint. Clipped
      // to the ring and stroked only over its bounding box, so the cost is
      // proportional to the footprint's area rather than the whole canvas per
      // building. The lines are placed from the VIEWPORT, exactly where
      // render.js's gridGfx places them (cell edges, offset half a cell from
      // the viewport corner), and both layers ride the same container scroll —
      // so the lattice is continuous from the grass onto the floor rather than
      // a second grid that happens to be nearby.
      gridPoly(pts, style) {
        if (!pts || pts.length < 3) return;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of pts) {
          if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
          if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
        }
        x0 -= originX; x1 -= originX; y0 -= originY; y1 -= originY;
        // Where the grid's first line falls on THIS canvas, and the dash phase
        // that goes with it — both measured from the viewport corner, so a
        // change to the canvas pad can't slide the lattice or its dashes.
        const vx = scene.viewLeft - originX, vy = scene.viewTop - originY;
        const gx = vx + CELL_PX / 2, gy = vy + CELL_PX / 2;
        const period = style.dash + style.gap;
        // gridGfx runs each dash sequence from the VIEWPORT corner (vLeft for
        // the horizontals, vTop for the verticals), not from the first line —
        // so the dashes are anchored there too, or the two lattices would meet
        // at a building's wall out of step.
        const phase = (v) => v - Math.ceil(v / period) * period;   // ≤ 0, in step with v
        ctx.save();
        trace(pts);
        ctx.clip();
        ctx.lineWidth = style.width;
        ctx.strokeStyle = rgbaOf(style.color, style.alpha);
        ctx.setLineDash([style.dash, style.gap]);
        ctx.beginPath();
        for (let x = gx + Math.ceil((x0 - gx) / CELL_PX) * CELL_PX; x <= x1; x += CELL_PX) {
          const sy = phase(vy) + Math.floor((y0 - phase(vy)) / period) * period;
          const cx = Math.round(x) + 0.5;   // half-pixel: a crisp 1px column, not two grey ones
          ctx.moveTo(cx, sy);
          ctx.lineTo(cx, y1);
        }
        for (let y = gy + Math.ceil((y0 - gy) / CELL_PX) * CELL_PX; y <= y1; y += CELL_PX) {
          const sx = phase(vx) + Math.floor((x0 - phase(vx)) / period) * period;
          const cy = Math.round(y) + 0.5;
          ctx.moveTo(sx, cy);
          ctx.lineTo(x1, cy);
        }
        ctx.stroke();
        ctx.restore();
      },
      // The tier's material, laid inside the ring. One clip + one pattern fill
      // per building; rebuilds are rare (a cell crossing or a tile load), so
      // this is nothing per frame.
      texturePoly(pts, tier) {
        const p = patternFor(tier);
        if (!p || !pts || pts.length < 3) return;
        ctx.save();
        trace(pts);
        ctx.clip();
        ctx.fillStyle = p;
        ctx.translate(phaseX, phaseY);
        ctx.fillRect(-TILE, -TILE, size + TILE * 2, size + TILE * 2);
        ctx.restore();
      },
      texturePhase(x, y) { phaseX = wrap(x - originX); phaseY = wrap(y - originY); },
      commit() { tex.refresh(); },
    };
    scene._buildingGeomTarget = target;
    return target;
  }
  function fillTarget(scene) {
    return scene.buildingGeomGfx || canvasTarget(scene);
  }

  function invalidate(scene) {
    if (scene) scene._buildingGeomKey = null;
  }

  // Same cache the road overlay uses: the world→screen transform is a pure
  // translation, so the geometry is drawn ONCE at the cell-snapped camera
  // position and the container is scrolled by the sub-cell fraction every
  // frame. Without it a dense downtown would be re-filled every frame.
  function draw(scene) {
    const g = fillTarget(scene);
    if (!g) return;
    const container = scene.buildingGeomContainer;
    // Off underground (cave tiles carry no building polygons) and off whenever
    // the tiled art is the one being drawn.
    const on = (scene.depth ?? 0) === 0 && enabled();
    if (container) container.setVisible(on);
    if (!on) {
      // Wipe the canvas the first time it goes off, not merely when the cache
      // key is live: setEnabled() invalidates on its way out, and a hidden
      // container full of last frame's buildings would come back the moment
      // anything else made the layer visible. `_buildingGeomPainted` tracks
      // what is actually ON the canvas, which the key never did.
      if (scene._buildingGeomPainted) {
        g.clear();
        if (g.commit) g.commit();
        scene._buildingGeomPainted = false;
      }
      scene._buildingGeomKey = null;
      return;
    }

    // Camera anchor, not the body — a peek drag slides these footprints with
    // the ground they're painted on (coords.js viewAnchorCell).
    const pc = viewAnchorCell(scene);
    const fracX = pc.cx - Math.floor(pc.cx);
    const fracY = pc.cy - Math.floor(pc.cy);
    const baseCellIX = pc.tx * scene.cellsPerTile + Math.floor(pc.cx);
    const baseCellIY = pc.ty * scene.cellsPerTile + Math.floor(pc.cy);

    // Rebuild key: the snapped camera cell, which of the 3×3 tiles have their
    // shapes in hand (so a tile that finishes loading repaints even while the
    // player stands still), and the claim epoch — restoring a wreck or taking
    // a castle has to lift the shade off that footprint on the next frame.
    const tiles = [];
    let ready = '';
    for (let dty = -1; dty <= 1; dty++) {
      for (let dtx = -1; dtx <= 1; dtx++) {
        const tx = pc.tx + dtx, ty = pc.ty + dty;
        const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
        if (!entry || !entry.buildingShapes || !entry.tileEdgeM) continue;
        tiles.push({ tx, ty, entry });
        ready += `${dtx}${dty}|`;
      }
    }
    const key = `${baseCellIX},${baseCellIY},${ready},${claimEpoch(scene)}`;
    if (key !== scene._buildingGeomKey) {
      scene._buildingGeomKey = key;
      scene._buildingGeomPainted = true;
      // Only the rebuild is timed, same reasoning as the road overlay: draw()
      // runs every frame but the key check above only rebuilds on a cell
      // crossing, a tile load, or a claim change.
      const B = window.__boot;
      if (B) {
        const t0 = performance.now();
        rebuild(scene, tiles, fracX, fracY);
        B.tick('building overlay rebuild', performance.now() - t0);
      } else {
        rebuild(scene, tiles, fracX, fracY);
      }
    }
    if (container) container.setPosition(-fracX * CELL_PX, -fracY * CELL_PX);
  }

  // A cheap stamp that changes whenever a claim could have changed. The tiled
  // pass re-reads ownership every frame (it redraws every frame anyway); this
  // layer caches its canvas, so it needs a signal. Counts, not contents: a
  // claim only ever ADDS an entry to one of these.
  function claimEpoch(scene) {
    const s = scene.save || {};
    const n = (o) => (o ? (Array.isArray(o) ? o.length : Object.keys(o).length) : 0);
    return n(s.restoredHouses) + ',' + n(s.unlockedForts) + ',' + n(s.claimedCastles)
      + ',' + (s.starterShopId || '');
  }

  function rebuild(scene, tiles, fracX, fracY) {
    const g = fillTarget(scene);
    g.clear();
    const _a = viewAnchorWorldM(scene);
    const pWorldX = _a.x;
    const pWorldY = _a.y;
    // Cell-snapped projection (the container re-applies the sub-cell offset) —
    // the same one the road overlay strokes with.
    const projX = (wmx) => scene.viewCenterX + ((wmx - pWorldX) / scene.cellM) * CELL_PX + fracX * CELL_PX;
    const projY = (wmy) => scene.viewCenterY + ((wmy - pWorldY) / scene.cellM) * CELL_PX + fracY * CELL_PX;
    const PAD = CELL_PX * 2;
    const minX = scene.viewLeft - PAD, maxX = scene.viewLeft + scene.viewSize + PAD;
    const minY = scene.viewTop - PAD, maxY = scene.viewTop + scene.viewSize + PAD;

    // Per-pass memo of ownerKey → claimed, the same one the tiled pass keeps:
    // a footprint asks the save once instead of once per shape.
    const claimMemo = new Map();
    const claimed = (k) => {
      if (!k) return true;                       // no key = nothing to own
      let v = claimMemo.get(k);
      if (v === undefined) {
        v = scene.isClaimedKey ? scene.isClaimedKey(k) : true;
        claimMemo.set(k, v);
      }
      return v;
    };

    const GRID = gridStyle();
    const draws = [];
    for (const { tx, ty, entry } of tiles) {
      const originMx = tx * entry.tileEdgeM;
      const originMy = ty * entry.tileEdgeM;
      for (const shape of entry.buildingShapes) {
        const r = shape.ring;
        if (!r || r.length < 6) continue;        // fewer than 3 points is not a footprint
        const pts = [];
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (let i = 0; i < r.length; i += 2) {
          const x = projX(originMx + r[i]);
          const y = projY(originMy + r[i + 1]);
          pts.push({ x, y });
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
          if (y < by0) by0 = y;
          if (y > by1) by1 = y;
        }
        // Cull on the bounding box, grown by the wall depth so a building just
        // off the north edge still drops its face into view.
        if (bx1 < minX || bx0 > maxX || by1 + facePx(shape.tier) < minY || by0 > maxY) continue;
        draws.push({ pts, south: by1, left: bx0, tier: shape.tier, key: shape.key });
      }
    }

    // Painter rule: the LOWER building draws in front. Ties break on the
    // leftmost x so the order is fully determined by the geometry rather than
    // by which tile happened to load first.
    draws.sort((a, b) => (a.south - b.south) || (a.left - b.left));

    // Anchor the material patterns to the WORLD before anything is filled:
    // texturePoly paints immediately (unlike the road overlay, which defers
    // its pattern to commit()), so the phase has to be in hand first or the
    // floors would wear the previous pass's phase and the material would swim
    // a cell behind the buildings as the player walks.
    if (g.texturePhase) g.texturePhase(projX(0), projY(0));

    for (const d of draws) {
      const isMine = claimed(d.key);
      const shade = shadeOf(isMine);
      const floor = shade(floorColor(d.tier));
      const depth = facePx(d.tier);
      // The wall, as the ring filled again one face-depth south and painted
      // UNDER the floor: whatever survives is exactly the polygon's
      // south-facing edges, at any angle, with no per-edge normal test.
      g.fillPoly(d.pts.map((p) => ({ x: p.x, y: p.y + depth })), shade(faceColor(d.tier)));
      g.fillPoly(d.pts, floor);
      if (g.texturePoly) g.texturePoly(d.pts, d.tier);
      // The cell grid goes on OVER the floor and its material. The tiled
      // floors wore it a layer lower (gridContainer sits under noiseContainer),
      // but a hairline this faint loses to a cobble or plank pattern laid on
      // top of it — and the point of the pass is that the ground's squares
      // stay readable across a footprint, so it goes last.
      if (g.gridPoly) g.gridPoly(d.pts, gridInkFor(GRID, floor));
      if (d.tier === CASTLE) {
        // Rampart: the stone band inside the wall line, then the merlon teeth
        // dashed along it in the light stone — the polygon's answer to the
        // tiled battlements.
        const stone = castleStone(isMine);
        g.insetStroke(d.pts, BAND_PX, stone.body);
        g.insetStroke(d.pts, MERLON_PX, stone.lite, MERLON_DASH);
        g.strokePoly(d.pts, OUTLINE_PX, stone.dark);
      } else {
        g.strokePoly(d.pts, OUTLINE_PX, dim(floor, OUTLINE_MUL));
      }
    }
    if (g.commit) g.commit();
  }

  global.BuildingOverlay = { draw, invalidate, enabled, setEnabled };
})(window);
