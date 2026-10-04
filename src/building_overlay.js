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
// What the polygon draws, tier for tier:
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
//     over the top, so two overlapping footprints can't wash one twice — then
//     the unclaimed MATERIAL lift (textures.js unclaimedMaterialColor), applied
//     to the same colours. Tuning colours reads no pixels back (a per-building
//     canvas read-back was the walking stutter on phones).
//
// A DILAPIDATED footprint (unclaimed — the wreck you can still restore) also
// grows dark green slime splotches across its floor (see the slime block
// below): seeded from the building's own identity so they don't crawl as you
// walk, scattered inside the ring rather than its bounding box, and coloured
// by running the unclaimed shade over the floor twice more.
//
// Floors share the cached ground canvas. Upright faces and castle ramparts
// are split into short perimeter pieces in worldContainer, each ordered at
// its own ground foot with characters and scenery. A character can therefore
// stand behind a south wall while remaining in front of the north wall.
//
// Depends on:
//   scene fields (read-only): buildingGeomGfx, buildingGeomContainer,
//     startWorldM, playerM, cellM, cellsPerTile / cellsForRow (coords.js), depth, textures,
//     viewCenterX/Y, viewLeft, viewTop, viewSize
//     helpers: playerToWorldCell(), isClaimedKey()
//   worldgen.js — WorldGen.tileCache, WorldGen.tileKey, WorldGen.makeRng;
//                 per-tile `entry.buildingShapes` + `entry.tileEdgeM`
//   coords.js   — overlayFrame / overlayProjection / timedOverlayRebuild (the
//                 camera-anchored draw frame both geometry overlays share)
//   biome_profiles.js — BiomeProfiles.mixHex (the one colour lerp)
//   render.js   — Render.BUILDING_FACE_COLOR / BUILDING_FACE_PX (the tiled
//                 pass's own wall colours + depths, so the two can't drift)
//   castle_styles.js — castle tower, wall and courtyard materials
//   textures.js — unclaimedShade,
//                 unclaimedMaterialColor
//   app.js consts — COLORS, CELL_PX
//
// Exports as globals:
//   BuildingOverlay.draw(scene)       — per-frame entry point (cheap when cached)
//   BuildingOverlay.enabled()         — is the polygonal mode on?
//   BuildingOverlay.setEnabled(scene, on) — flip the mode (forces a rebuild)
(function (global) {
  const CASTLE = 12;   // BUILDING_LARGE — the one tier that draws a rampart

  // Floor colours come from app.js's terrain palette, the table the tiled
  // floor fill reads, so a polygon and the cells under it match. The
  // fallbacks are for the headless suite, where app.js isn't loaded.
  const FLOOR_FALLBACK = { 9: 0xae685d, 11: 0xaa9577, 12: 0x919395 };
  const floorColor = (tier, claimed = true) =>
    (!claimed && typeof UNCLAIMED_BUILDING_BASE !== 'undefined') ? UNCLAIMED_BUILDING_BASE.floors[tier]
      : (typeof COLORS !== 'undefined' && COLORS[tier] != null) ? COLORS[tier]
      : (FLOOR_FALLBACK[tier] ?? 0xae685d);

  // Wall face + depth: render.js's SOUTH_FACE_COLOR / SOUTH_FACE_PX via Render,
  // so the polygonal and tiled walls match. The fallback is DERIVED (40%
  // brightness of the floor, as those constants are), not a third set of numbers.
  const FACE_MUL = 0.4;
  // Colour maths is BiomeProfiles.mixHex, the one lerp every module shares;
  // scaling a colour by `m` is the lerp from black.
  const mix = BiomeProfiles.mixHex;
  const dim = (c, m) => mix(0x000000, c, m);
  const faceColor = (tier, claimed = true) => {
    if (!claimed && typeof UNCLAIMED_BUILDING_BASE !== 'undefined') return UNCLAIMED_BUILDING_BASE.faces[tier];
    const tbl = (typeof Render !== 'undefined' && Render.BUILDING_FACE_COLOR) || null;
    return (tbl && tbl[tier] != null) ? tbl[tier] : dim(floorColor(tier), FACE_MUL);
  };
  const facePx = (tier) => {
    const tbl = (typeof Render !== 'undefined' && Render.BUILDING_FACE_PX) || null;
    return (tbl && tbl[tier] != null) ? tbl[tier] : (tier === CASTLE ? 5 : 4);
  };

  // The silhouette: the tiled pass draws black at 50% over the floor; mixing
  // the same black into the floor colour lands the identical pixel without a
  // translucent stroke that would double up where two rings touch.
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

  // "Somebody else's": colours are shaded (the unclaimed castle palette's
  // unclaimedShade() transform) rather than washed over, since overlapping OSM
  // footprints (a shed inside a house) would take a translucent wash twice.
  const shadeOf = (claimed) => {
    if (claimed || typeof unclaimedShade !== 'function') return (c) => c;
    return (c) => unclaimedShade(c);
  };
  // …and the material lift over the shaded colour: what render.js's tiled
  // pass does to an unclaimed court floor and its stone (courtShaded, `stone`).
  const tuneOf = (claimed) => {
    if (claimed || typeof unclaimedMaterialColor !== 'function') return (c) => c;
    return (c) => unclaimedMaterialColor(c);
  };

  // ── Slime: what "dilapidated" looks like up close ────────────────────────
  // Dark green splotches across an unclaimed footprint's floor say WHY it is
  // dim. Unclaimed buildings only; a restore clears them in the same repaint
  // the claim epoch already forces.
  //
  // The colour is DERIVED: the unclaimed shade run over the already shaded
  // floor twice more (each a 35% lerp toward textures.js's green wash), so
  // retuning UNCLAIMED_SHADE moves the slime too. SLIME_FALLBACK is only
  // reached when textures.js isn't loaded (the headless suite).
  const SLIME_FALLBACK = 0x1e3b24;      // = textures.js UNCLAIMED_SHADE.wash
  const SLIME_FALLBACK_A = 0.73;        // ≈ where three 35% lerps land (1 − 0.65³)
  // Translucent, so the floor's own material grains through the stain.
  const SLIME_ALPHA = 0.8;
  // One splotch per ~30×30 px of floor, capped so a cathedral-sized footprint
  // stays speckled instead of solid.
  const SLIME_PER_PX2 = 1 / (30 * 30);
  const SLIME_MAX = 28;
  const SLIME_MIN_R = 5, SLIME_MAX_R = 11;   // px
  const SLIME_LOBES = 9;                     // points around one blob
  const SLIME_WOBBLE = 0.45;                 // radius jitter, ± of the mean
  const SLIME_TRIES = 6;                     // rejection sampling per splotch
  const SLIME_CACHE_MAX = 2048;

  const slimeColor = (floor, shade) => {
    const s = shade(shade(floor));
    return s === floor ? mix(floor, SLIME_FALLBACK, SLIME_FALLBACK_A) : s;
  };

  // The seed. A building's splotches must be the SAME every rebuild (the layer
  // repaints on every cell crossing), so the scatter is a pure function of the
  // building's identity: its ownerKey where it has one, its tile and ring where
  // it doesn't (a sliver clipped at a tile seam owns no cells and has no key).
  //
  // NOT util.js' fnv1a: it is seeded from the two TILE COORDINATES and eats
  // NUMBERS (every quantised ring vertex), not just string char codes. One
  // call site, so it stays here.
  const seedOf = (tx, ty, ring, key) => {
    let h = (0x811c9dc5 ^ ((tx & 0xffff) << 16) ^ (ty & 0xffff)) >>> 0;
    const eat = (n) => { h = Math.imul(h ^ (n | 0), 0x01000193) >>> 0; };
    if (key) for (let i = 0; i < key.length; i++) eat(key.charCodeAt(i));
    // …and the whole ring: the seed is also the blob cache's key, so two
    // footprints sharing one would share splotches.
    for (let i = 0; i < ring.length; i++) eat(Math.round(ring[i] * 16));
    return h >>> 0;
  };
  // …fed to worldgen's mulberry32 (WorldGen.makeRng).
  const rngFrom = (seed) => WorldGen.makeRng(seed);

  // Shoelace area and a ray-cast containment test on the PROJECTED ring: area
  // drives the splotch count off the real footprint, and containment keeps the
  // scatter off the empty quadrant of an L-shaped block.
  const polyArea = (pts) => {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    }
    return Math.abs(a) / 2;
  };
  const inPoly = (pts, x, y) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const yi = pts[i].y, yj = pts[j].y;
      if ((yi > y) !== (yj > y)
        && x < ((pts[j].x - pts[i].x) * (y - yi)) / (yj - yi) + pts[i].x) inside = !inside;
    }
    return inside;
  };

  // Blobs are generated in LOCAL px (relative to the footprint's NW bbox
  // corner) and translated at draw time: the projection is a pure translation,
  // so one generation serves every rebuild this session.
  const slimeCache = new Map();
  function slimeBlobs(d) {
    let blobs = slimeCache.get(d.seed);
    if (blobs) return blobs;
    const w = d.right - d.left, h = d.south - d.north;
    const area = polyArea(d.pts);
    const n = clamp(Math.round(area * SLIME_PER_PX2), 1, SLIME_MAX);
    // A splotch can't be a third of the building: on a shed, the cap comes off
    // the footprint's own size rather than the constant.
    const maxR = clamp(Math.sqrt(area) / 3, 2, SLIME_MAX_R);
    const minR = Math.min(SLIME_MIN_R, maxR);
    const rnd = rngFrom(d.seed);
    blobs = [];
    for (let i = 0; i < n; i++) {
      let cx = 0, cy = 0, ok = false;
      for (let t = 0; t < SLIME_TRIES && !ok; t++) {
        cx = d.left + rnd() * w;
        cy = d.north + rnd() * h;
        ok = inPoly(d.pts, cx, cy);
      }
      if (!ok) continue;                    // a spindly ring: fewer splotches, none outside it
      const r = minR + rnd() * (maxR - minR);
      const spin = rnd() * Math.PI * 2;
      const pts = [];
      for (let k = 0; k < SLIME_LOBES; k++) {
        const a = spin + (k / SLIME_LOBES) * Math.PI * 2;
        const rr = r * (1 + (rnd() * 2 - 1) * SLIME_WOBBLE);
        pts.push({ x: cx - d.left + Math.cos(a) * rr, y: cy - d.north + Math.sin(a) * rr });
      }
      blobs.push(pts);
    }
    if (slimeCache.size >= SLIME_CACHE_MAX) slimeCache.clear();
    slimeCache.set(d.seed, blobs);
    return blobs;
  }

  // Castle masonry, from the shared palette so a polygon rampart is the same
  // stone as the turret sprites standing on it.
  const castleStone = (claimed, key) => {
    const style = CastleStyles.get(key, claimed);
    const top = style.rampart.woodTop ? style.wood : style.stone;
    return { body: style.stone.BODY, lite: top.LITE, dark: style.stone.DARK,
      top: top.BODY, style };
  };

  // The dashed cell grid, from render.js, so the lattice over a footprint is
  // the SAME lattice as the ground's and continues across the building.
  const GRID_FALLBACK = { width: 1, color: 0x000000, alpha: 0.08, dash: 4, gap: 4 };
  const gridStyle = () =>
    ((typeof Render !== 'undefined' && Render.GRID_LINE) || GRID_FALLBACK);
  // …with ONE thing changed per building: the ink flips to white where the
  // floor is too dark to take a dark line (an unclaimed house is shaded nearly
  // to black), at the same weight, rhythm and alpha. Rec. 601 luma
  // (luminance() from util.js).
  const LUMA_FLIP = 0.42;
  // …and the WEIGHT: floors (cobbles, planks, paving) carry far more local
  // contrast than the ground, so an 8% hairline vanishes on them. This
  // multiple puts its contrast against a floor roughly where 8% is on grass.
  const GRID_OVER_FLOOR_MUL = 2;
  const gridInkFor = (style, floor) => ({
    ...style,
    alpha: style.alpha * GRID_OVER_FLOOR_MUL,
    color: luminance(floor) >= LUMA_FLIP ? style.color : 0xffffff,
  });

  // cssOf / rgbaOf (int → '#rrggbb' / 'rgba(...)') come from util.js.

  // ── The polygonal mode switch ────────────────────────────────────────────
  // Default ON — this branch exists to look at it. `false` (not merely falsy)
  // turns it off so an undefined flag still means on.
  function enabled() {
    return (typeof global === 'undefined') || global.__POLY_BUILDINGS !== false;
  }
  function setEnabled(scene, on) {
    global.__POLY_BUILDINGS = !!on;
    invalidate(scene);
    // The road band's keep-out depends on this flag too and that layer caches
    // its canvas the same way, so flip both.
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
  // overlay uses it: path fills with holes and joins, `clip()` for the
  // rampart band, and pattern fills for the materials.
  const TEX_KEY = 'buildinggeom_overlay';
  function canvasTarget(scene) {
    if (typeof document === 'undefined' || !scene.textures || !scene.buildingGeomContainer) return null;
    if (scene._buildingGeomTarget) return scene._buildingGeomTarget;
    // The padded viewport layer (render.js Render.viewportCanvas — the grid
    // and border bakes open theirs the same way). A texture left by an
    // earlier scene is dropped first, so this canvas is this scene's own.
    if (scene.textures.exists(TEX_KEY)) scene.textures.remove(TEX_KEY);
    const { tex, x: originX, y: originY } = Render.viewportCanvas(scene, TEX_KEY, CELL_PX * 2);
    if (!tex) return null;
    const ctx = tex.getContext();
    ctx.lineJoin = 'round';
    const img = scene.add.image(originX, originY, TEX_KEY).setOrigin(0, 0);
    scene.buildingGeomContainer.add(img);
    // Material patterns, one per tier, taken from the biome textures the tiled
    // floors wear (pure black/white alpha modulation, so they sit correctly
    // over a shaded unclaimed fill). Built lazily.
    const patterns = new Map();
    const patternFor = (tier) => {
      if (patterns.has(tier)) return patterns.get(tier);
      let p = null;
      const key = `biome${tier}_0`;
      if (scene.textures.exists(key)) {
        const src = scene.textures.get(key).getSourceImage();
        // createPattern THROWS on a zero-sized source (a texture not baked yet)
        // and would take the whole pass down. No material is fine.
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
      // The ground's own cell lattice, continued across the footprint: clipped
      // to the ring, stroked over its bounding box only, and placed from the
      // VIEWPORT exactly where render.js's gridGfx places it, so the lattice is
      // continuous from the grass onto the floor.
      gridPoly(pts, style) {
        if (!pts || pts.length < 3) return;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of pts) {
          if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
          if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
        }
        x0 -= originX; x1 -= originX; y0 -= originY; y1 -= originY;
        // Where the grid's first line falls on THIS canvas, and its dash phase,
        // both measured from the viewport corner.
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
      // The dilapidated floor's slime, clipped to the ring so a splotch that
      // overhangs the wall is cut off at it. `blobs` arrive in local px
      // (relative to the ring's NW bbox corner) and are offset here — see
      // slimeBlobs().
      blobsPoly(pts, blobs, ox, oy, color, alpha) {
        if (!pts || pts.length < 3 || !blobs || !blobs.length) return;
        ctx.save();
        trace(pts);
        ctx.clip();
        ctx.fillStyle = rgbaOf(color, alpha);
        ctx.beginPath();
        for (const b of blobs) {
          ctx.moveTo(b[0].x + ox - originX, b[0].y + oy - originY);
          for (let i = 1; i < b.length; i++) ctx.lineTo(b[i].x + ox - originX, b[i].y + oy - originY);
          ctx.closePath();
        }
        // One path for every splotch on the building: two that overlap fill as
        // one puddle instead of stacking two alphas into a dark spot.
        ctx.fill();
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
      damagePoly(pts, key, claimed, anchorX, anchorY) {
        const texture = CastleStyles.damageTexture(scene, key, claimed);
        if (!texture) return false;
        if (!patterns.has(texture)) patterns.set(texture,
          ctx.createPattern(scene.textures.get(texture).getSourceImage(), 'repeat'));
        ctx.save(); trace(pts); ctx.clip();
        ctx.translate(anchorX - originX, anchorY - originY);
        ctx.fillStyle = patterns.get(texture);
        ctx.fillRect(originX - anchorX, originY - anchorY, size, size);
        ctx.restore();
        return true;
      },
      columnsPoly(pts, columns, claimed) {
        if (!columns.length) return;
        const key = CastleStyles.columnTexture(scene, claimed);
        if (!key) return;
        const source = scene.textures.get(key).getSourceImage();
        ctx.save(); trace(pts); ctx.clip(); ctx.imageSmoothingEnabled = false;
        for (const p of columns) ctx.drawImage(source, 0, 20 - p.height, 16, p.height,
          Math.round(p.x - originX - 8), Math.round(p.y - originY - p.height), 16, p.height);
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

  // Floors stay under the world. Each short perimeter segment is an upright
  // piece, so a long north/south wall can interleave with walking characters.
  // Canvas clipping keeps angled walls inside the source footprint.
  //
  // Pieces are cached across rebuilds, keyed by their WORLD geometry: the
  // projection is a pure translation (whole cells between rebuilds), so a
  // piece baked once stays valid and only moves. A cell crossing then bakes
  // just the edges newly in view instead of every wall on screen.
  //
  // ── The wall atlas ───────────────────────────────────────────────────────
  // Pieces share ATLAS PAGES: square canvas textures cut into fixed slots, one
  // per piece, each exposed to its sprite as a Phaser frame. Per-piece canvas
  // textures cost a read-back each (Phaser's CanvasTexture reads pixels back
  // on creation) and were most of the 60–190 ms stall on every cell crossing.
  // A crossing paints new pieces into free slots and uploads each touched page
  // once (commitWallAtlas); nothing reads pixels back. Slots are freed when a
  // piece scrolls out of the padded view; an empty page is dropped.
  const PAGE_PX = 512;
  // A slot holds the largest piece uprightEdges can cut: one edge segment of
  // at most a cell in either axis, its wall depth below, the rampart band and
  // outline padding on every side, and the pixel of floor/ceil rounding at
  // each end. Derived from the constants the bake pads with, so a retune of
  // BAND_PX can't overflow a slot.
  const SLOT_PAD = BAND_PX + OUTLINE_PX;
  const slotSize = () => {
    const tbl = (typeof Render !== 'undefined' && Render.BUILDING_FACE_PX) || null;
    const deepest = tbl ? Math.max(...Object.values(tbl)) : facePx(CASTLE);
    return { w: CELL_PX + SLOT_PAD * 2 + 2, h: CELL_PX + deepest + SLOT_PAD * 2 + 2 };
  };
  function wallAtlas(scene) {
    let A = scene._buildingWallAtlas;
    if (!A) {
      const { w, h } = slotSize();
      A = scene._buildingWallAtlas = {
        pages: [], slotW: w, slotH: h,
        cols: Math.floor(PAGE_PX / w), rows: Math.floor(PAGE_PX / h), seq: 0,
      };
    }
    return A;
  }
  // A free slot on some page: { page, slot, sx, sy }. Opens a page when every
  // slot in hand is taken.
  function allocSlot(scene) {
    const A = wallAtlas(scene);
    let page = A.pages.find((p) => p.free.length);
    if (!page) {
      const key = `buildinggeom_walls_${++A.seq}`;
      if (scene.textures.exists(key)) scene.textures.remove(key);
      const tex = scene.textures.createCanvas(key, PAGE_PX, PAGE_PX);
      const free = [];
      for (let i = A.cols * A.rows - 1; i >= 0; i--) free.push(i);
      page = { key, tex, ctx: tex.getContext(), free, used: 0, dirty: false, seq: 0 };
      A.pages.push(page);
    }
    const slot = page.free.pop();
    page.used++;
    return { page, slot, sx: (slot % A.cols) * A.slotW, sy: Math.floor(slot / A.cols) * A.slotH };
  }
  // Upload every page a rebuild painted on, once, and drop the pages the
  // release pass emptied.
  function commitWallAtlas(scene) {
    const A = scene._buildingWallAtlas;
    if (!A) return;
    A.pages = A.pages.filter((page) => {
      if (!page.used) { scene.textures.remove(page.key); return false; }
      if (page.dirty) { page.tex.refresh(); page.dirty = false; }
      return true;
    });
  }
  function releasePiece(scene, p) {
    p.sprite.destroy();
    p.page.tex.remove(p.frame);
    p.page.free.push(p.slot);
    p.page.used--;
  }
  function clearUprights(scene) {
    for (const p of (scene._buildingUprightCache || new Map()).values()) p.sprite.destroy();
    for (const page of (scene._buildingWallAtlas ? scene._buildingWallAtlas.pages : [])) {
      scene.textures.remove(page.key);
    }
    scene._buildingWallAtlas = null;
    scene._buildingUprightCache = new Map();
    scene._buildingUprightPieces = [];
  }

  function uprightEdges(scene, d, isMine, projX, projY, seen) {
    const shade = shadeOf(isMine), tune = tuneOf(isMine), depth = facePx(d.tier);
    const stone = d.tier === CASTLE ? castleStone(isMine, d.key) : null;
    const face = stone ? stone.style.stone.FACE : tune(shade(faceColor(d.tier, isMine)));
    const outline = stone ? stone.dark : tune(dim(shade(floorColor(d.tier, isMine)), OUTLINE_MUL));
    const points = d.pts;
    // Only outward south-facing edges retain the downward face after the
    // floor is erased from the piece. Their physical base includes that
    // face depth; the other edges end at the perimeter. Winding keeps the
    // classification stable for clockwise and counterclockwise rings.
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      area += a.x * b.y - b.x * a.y;
    }
    const winding = Math.sign(area);
    const trace = (ctx) => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();
    };
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / CELL_PX));
      for (let j = 0; j < count; j++) {
        const at = (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        const p = at(j / count), q = at((j + 1) / count);
        const pad = BAND_PX + OUTLINE_PX;
        const x = Math.floor(Math.min(p.x, q.x) - pad);
        const y = Math.floor(Math.min(p.y, q.y) - pad);
        const w = Math.ceil(Math.max(p.x, q.x) + pad) - x;
        const h = Math.ceil(Math.max(p.y, q.y) + depth + pad) - y;
        if (x + w < scene.viewLeft - CELL_PX * 2 || x > scene.viewLeft + scene.viewSize + CELL_PX * 2
          || y + h < scene.viewTop - CELL_PX * 2 || y > scene.viewTop + scene.viewSize + CELL_PX * 2) continue;
        // World-relative placement: the same edge at a later camera cell sits
        // at the same offset from the projected world origin.
        const wx = x - projX(0), wy = y - projY(0);
        const cacheKey = `${d.seed}|${d.tier}|${stone?.style.id || ''}|${isMine ? 1 : 0}|${i}|${j}|${Math.round(wx)}|${Math.round(wy)}|${w}|${h}`;
        const cached = scene._buildingUprightCache.get(cacheKey);
        if (cached) {
          if (!seen.has(cacheKey)) {
            seen.add(cacheKey);
            cached.x = projX(0) + cached.wx;
            cached.y = projY(0) + cached.wy;
            scene._buildingUprightPieces.push(cached);
          }
          continue;
        }
        const { page, slot, sx, sy } = allocSlot(scene);
        const A = scene._buildingWallAtlas;
        const ctx = page.ctx;
        // Paint into the slot: clear it (a freed slot still wears its last
        // piece), clip to it so the erase below can't reach a neighbour, and
        // move the piece's own pixel box onto it.
        ctx.save();
        ctx.clearRect(sx, sy, A.slotW, A.slotH);
        ctx.beginPath(); ctx.rect(sx, sy, A.slotW, A.slotH); ctx.clip();
        ctx.translate(sx - x, sy - y);
        // Extrude this edge downward, then remove its part inside the floor.
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
        ctx.lineTo(q.x, q.y + depth); ctx.lineTo(p.x, p.y + depth); ctx.closePath();
        ctx.fillStyle = cssOf(face); ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        trace(ctx); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        if (stone) {
          ctx.save(); trace(ctx); ctx.clip();
          const stroke = (width, color, dash) => {
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
            ctx.lineWidth = width; ctx.strokeStyle = cssOf(color);
            ctx.setLineDash(dash || []);
            ctx.lineDashOffset = -Math.hypot(p.x - a.x, p.y - a.y);
            ctx.stroke();
          };
          stroke(BAND_PX * 2, stone.body);
          const rampart = stone.style.rampart;
          if (rampart.woodTop) stroke(6, stone.top);
          const tooth = rampart.toothWidth;
          const dash = rampart.broken ? [tooth, 4, tooth - 1, 7] : [tooth, 8 - tooth];
          stroke(MERLON_PX * 2, stone.lite, dash);
          // Sample just inside the edge, so east/south boundaries use the
          // same owner's cell as the tiled wall rather than its neighbour.
          const damageX = (p.x + q.x) / 2 - Math.sign(q.y - p.y) * winding * 0.01;
          const damageY = (p.y + q.y) / 2 + Math.sign(q.x - p.x) * winding * 0.01;
          const damage = CastleStyles.damageCell(d.key,
            Math.floor((damageX - d.damageOriginX) / CELL_PX),
            Math.floor((damageY - d.damageOriginY) / CELL_PX));
          if (damage) {
            const chip = damage.chip / CELL_PX;
            const cx = Math.round(p.x + (q.x - p.x) * chip);
            const cy = Math.round(p.y + (q.y - p.y) * chip);
            ctx.fillStyle = cssOf(stone.style.stone.SHADOW); ctx.fillRect(cx - 1, cy - 3, 2, 6);
            if (damage.missing >= 0) {
              const t = (damage.missing + 0.5) / 4;
              ctx.fillStyle = cssOf(stone.style.floor);
              ctx.fillRect(Math.round(p.x + (q.x - p.x) * t) - 2,
                Math.round(p.y + (q.y - p.y) * t) - 2, 4, 4);
            }
          }
          ctx.restore();
        }
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
        ctx.lineWidth = OUTLINE_PX;
        ctx.strokeStyle = cssOf(outline);
        ctx.stroke();
        ctx.restore();
        page.dirty = true;
        // The piece's frame on its page. The slot bounds the piece by
        // construction (slotSize); the min is belt-and-braces against a
        // frame that would read a neighbour's pixels.
        const frame = `p${++page.seq}`;
        page.tex.add(frame, 0, sx, sy, Math.min(w, A.slotW), Math.min(h, A.slotH));
        const sprite = scene.add.image(x, y, page.key, frame).setOrigin(0, 0);
        scene.worldContainer.add(sprite);
        const piece = {
          sprite, page, frame, slot, x, y, wx, wy, width: w, height: h, rank: 1,
          // Lowest visible masonry, excluding transparent frame padding.
          groundY: (Math.max(p.y, q.y) + ((a.x - b.x) * winding > 1e-6 ? depth : 0)
            - projY(0)) * scene.cellM / CELL_PX,
        };
        scene._buildingUprightCache.set(cacheKey, piece);
        seen.add(cacheKey);
        scene._buildingUprightPieces.push(piece);
      }
    }
  }

  function invalidate(scene) {
    if (scene) scene._buildingGeomKey = null;
  }

  // The world→screen transform is a pure translation, so the geometry is drawn
  // ONCE at the cell-snapped camera position and the container scrolled by the
  // sub-cell fraction every frame (as the road overlay does).
  function draw(scene) {
    const g = fillTarget(scene);
    if (!g) return;
    const container = scene.buildingGeomContainer;
    // Off underground (cave tiles carry no building polygons) and off whenever
    // the tiled art is the one being drawn.
    const on = (scene.depth ?? 0) === 0 && enabled();
    if (container) container.setVisible(on);
    if (!on) {
      clearUprights(scene);
      // Wipe the canvas the first time it goes off: setEnabled() invalidates
      // on its way out, and a hidden container full of last frame's buildings
      // would come back. `_buildingGeomPainted` tracks what is ON the canvas.
      if (scene._buildingGeomPainted) {
        g.clear();
        if (g.commit) g.commit();
        scene._buildingGeomPainted = false;
      }
      scene._buildingGeomKey = null;
      return;
    }

    // Camera anchor, not the body — a peek drag slides these footprints with
    // the ground they're painted on (coords.js overlayFrame → viewAnchorCell).
    // Rebuild key: the snapped camera cell, which of the 3×3 tiles have their
    // shapes in hand (so a tile that finishes loading repaints even while the
    // player stands still), and the claim epoch — restoring a wreck or taking
    // a castle has to lift the shade off that footprint on the next frame.
    const { fracX, fracY, baseCellIX, baseCellIY, tiles, ready } =
      overlayFrame(scene, (entry) => !!entry.buildingShapes);
    const key = `${baseCellIX},${baseCellIY},${ready},${claimEpoch(scene)}`;
    if (key !== scene._buildingGeomKey) {
      scene._buildingGeomKey = key;
      scene._buildingGeomPainted = true;
      timedOverlayRebuild('building overlay rebuild',
        () => rebuild(scene, tiles, fracX, fracY));
    }
    if (container) container.setPosition(-fracX * CELL_PX, -fracY * CELL_PX);
    for (const p of scene._buildingUprightPieces || []) {
      const x = p.x - fracX * CELL_PX, y = p.y - fracY * CELL_PX;
      p.sprite.setPosition(x, y);
      // Keep the padded cache for the next crossing, but do not submit walls
      // wholly outside the world's viewport mask to the renderer. One pixel
      // of slack preserves filtered/rounded edge pixels at fractional scales.
      p.sprite.visible = x + p.width >= scene.viewLeft - 1
        && y + p.height >= scene.viewTop - 1
        && x <= scene.viewLeft + scene.viewSize + 1
        && y <= scene.viewTop + scene.viewSize + 1;
    }
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
    if (!scene._buildingUprightCache) clearUprights(scene);
    scene._buildingUprightPieces = [];
    const seen = new Set();
    if (scene.events && !scene._buildingUprightCleanup) {
      scene._buildingUprightCleanup = true;
      scene.events.once('shutdown', () => {
        clearUprights(scene);
        scene._buildingUprightCleanup = false;
        scene._buildingGeomKey = null;
        scene._buildingGeomTarget = null;
      });
    }
    const separateUprights = !!(scene.worldContainer && scene.add && scene.textures);
    // Cell-snapped projection (the container re-applies the sub-cell offset) —
    // the same one the road overlay strokes with — and its padded cull bounds.
    const { projX, projY, minX, maxX, minY, maxY } = overlayProjection(scene, fracX, fracY);

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
        draws.push({
          pts, south: by1, left: bx0, north: by0, right: bx1,
          tier: shape.tier, key: shape.key,
          damageOriginX: projX(originMx), damageOriginY: projY(originMy),
          columns: shape.tier === CASTLE ? CastleStyles.columnSites(shape.key, r,
            entry.tileEdgeM / (entry.cellsPerEdge || scene.cellsPerTile))
            .map(p => ({ x: projX(originMx + p.x), y: projY(originMy + p.y), height: p.height })) : [],
          seed: seedOf(tx, ty, r, shape.key),
        });
      }
    }

    // Painter rule: the LOWER building draws in front. Ties break on the
    // leftmost x so the order is fully determined by the geometry rather than
    // by which tile happened to load first.
    draws.sort((a, b) => (a.south - b.south) || (a.left - b.left));

    // Anchor the material patterns to the WORLD before anything is filled:
    // texturePoly paints immediately, so the phase has to be in hand first.
    if (g.texturePhase) g.texturePhase(projX(0), projY(0));

    for (const d of draws) {
      const isMine = claimed(d.key);
      const shade = shadeOf(isMine), tune = tuneOf(isMine);
      // The shaded floor is what the slime derives from (three shades deep —
      // see slimeColor); the material lift goes over every colour after.
      const style = d.tier === CASTLE ? CastleStyles.get(d.key, isMine) : null;
      const shaded = style ? style.floor : shade(floorColor(d.tier, isMine));
      const floor = style ? style.floor : tune(shaded);
      const depth = facePx(d.tier);
      // The wall, as the ring filled again one face-depth south and painted
      // UNDER the floor: whatever survives is exactly the polygon's
      // south-facing edges, at any angle, with no per-edge normal test.
      if (!separateUprights) g.fillPoly(d.pts.map((p) => ({ x: p.x, y: p.y + depth })), (style ? style.stone.FACE : tune(shade(faceColor(d.tier, isMine)))));
      g.fillPoly(d.pts, floor);
      const damagedFloor = style?.id === 'ruin' && g.damagePoly
        && g.damagePoly(d.pts, d.key, isMine, d.damageOriginX, d.damageOriginY);
      if (!damagedFloor && g.texturePoly) g.texturePoly(d.pts, d.tier);
      // Dilapidated: the slime, over the floor and its material (it is growing
      // on them) but under the lattice, the rampart and the outline — the
      // building's own lines stay clean, only its floor is overgrown.
      if (!isMine && g.blobsPoly) {
        g.blobsPoly(d.pts, slimeBlobs(d), d.left, d.north, tune(slimeColor(shaded, shade)), SLIME_ALPHA);
      }
      // The cell grid goes on OVER the floor and its material: a hairline this
      // faint loses to a cobble or plank pattern laid on top of it.
      if (g.gridPoly) g.gridPoly(d.pts, gridInkFor(GRID, floor));
      if (d.columns.length && g.columnsPoly) g.columnsPoly(d.pts, d.columns, isMine);
      // Every short wall section joins the ordinary upright painter pass.
      if (separateUprights) {
        uprightEdges(scene, d, isMine, projX, projY, seen);
      } else if (d.tier === CASTLE) {
        // Rampart: the stone band inside the wall line, then the merlon teeth
        // dashed along it in the light stone — the polygon's answer to the
        // tiled battlements.
        const stone = castleStone(isMine, d.key);
        g.insetStroke(d.pts, BAND_PX, stone.body);
        if (style.rampart.woodTop) g.insetStroke(d.pts, 3, stone.top);
        const tooth = style.rampart.toothWidth;
        const dash = style.rampart.broken ? [tooth, 4, tooth - 1, 7] : [tooth, 8 - tooth];
        g.insetStroke(d.pts, MERLON_PX, stone.lite, dash);
        g.strokePoly(d.pts, OUTLINE_PX, stone.dark);
      } else {
        g.strokePoly(d.pts, OUTLINE_PX, tune(dim(shaded, OUTLINE_MUL)));
      }
    }
    // Pieces that scrolled out of view (or changed claim state) go.
    for (const [k, p] of scene._buildingUprightCache) {
      if (!seen.has(k)) { releasePiece(scene, p); scene._buildingUprightCache.delete(k); }
    }
    if (separateUprights) commitWallAtlas(scene);
    if (g.commit) g.commit();
  }

  global.BuildingOverlay = { draw, enabled, setEnabled };
})(window);
