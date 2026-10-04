// Procedural textures + per-POI concrete-pad shapes.
// Extracted from app.js for maintainability. Loaded BEFORE app.js so all
// names (BIOME_TEX, draw* fns, makeBiomeTextures, …) are available as plain globals.
//
// Depends on:
//   nothing external. Pure draws-to-canvas — no Phaser scene work other than
//   makeBiomeTextures which takes the scene as a parameter.
//

// --- Castle stone palette -------------------------------------------------
// ONE set of stone colours for everything castle: the rampart walls (drawn as
// graphics in render.js drawCells) and the turret texture below, so a tower
// looks cut from the same rock as its rampart.
// `.n` is the 0xRRGGBB form the Phaser graphics API wants; `.s` is the CSS
// string the canvas 2D contexts want.
const CASTLE_STONE = (() => {
  const mk = (n) => ({ n, s: '#' + n.toString(16).padStart(6, '0') });
  return {
    LITE:   mk(0xc2c7c2),   // lit battlement tops / merlon crowns
    BODY:   mk(0x949895),   // battlement + parapet stone
    FACE:   mk(0x7e837f),   // the tall extruded wall faces (and the turret column)
    SIDE:   mk(0x797e7a),   // E/W side-wall crenel dashes
    SHADOW: mk(0x575d59),   // shadow lines / joints
    DARK:   mk(0x2c302d),   // grounding line + silhouette
  };
})();

// --- The unclaimed shade, and the second castle palette -------------------
// An unclaimed building is shifted toward dark green and then murked down. A
// HOUSE gets that as a wash over the finished art (render.js drawCells); a
// CASTLE is GENERATED in a second palette run through this exact transform
// (rampart stone, turret and court floor alike).
//
// Baking beats washing: a wash over drawn geometry showed seams (a north wall
// crest off-frame stayed lit, overlapping extrusions banded, the turret's
// multiply tint never matched the wall). Both sides still come through
// unclaimedShade(), so a baked castle and a washed house land on the same colour.
const UNCLAIMED_SHADE = { wash: 0x1e3b24, washA: 0.35, murk: 0x05070c, murkA: 0.12 };
function unclaimedShade(rgb) {
  // `lerp` is util.js's (loaded first, including in test/node/run.js contexts).
  const ch = (sh) => {
    const w = lerp((rgb >> sh) & 255, (UNCLAIMED_SHADE.wash >> sh) & 255, UNCLAIMED_SHADE.washA);
    return Math.round(lerp(w, (UNCLAIMED_SHADE.murk >> sh) & 255, UNCLAIMED_SHADE.murkA));
  };
  return (((ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0);
}
// Unclaimed masonry keeps its original weathering rather than shading the much
// lighter restored palette. The final 5% treatment is applied after painting,
// so mortar, translucent sludge and outlines keep their contrast.
const UNCLAIMED_BUILDING_BASE = {
  floors: { 9: 0x984f45, 11: 0x9b8365, 12: 0x787a80 },
  faces: { 9: 0x401f1c, 11: 0x3c2e22, 12: 0x36373a },
  stone: { LITE: 0xb9bcc2, BODY: 0x8f9298, FACE: 0x7e8188,
    SIDE: 0x7a7d84, SHADOW: 0x5a5d63, DARK: 0x303134 },
};
const UNCLAIMED_MATERIAL_PALETTE = [0x171717, 0x26342a, 0x3e4b2c, 0x403e34,
  0x777462, 0xb0aa8a, 0x4c3018, 0x6c431d].map(n => [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
const _unclaimedMaterialColours = new Map();
// Half the approved colour/lightness treatment keeps gameplay masonry legible.
// Source shadows below 55 and glints above 235 remain exact; alpha never changes.
function tuneUnclaimedMaterialPixels(pixels) {
  const luma = c => c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    const cached = _unclaimedMaterialColours.get(key);
    if (cached !== undefined) {
      pixels[i] = (cached >> 16) & 255; pixels[i + 1] = (cached >> 8) & 255; pixels[i + 2] = cached & 255;
      continue;
    }
    const source = [pixels[i], pixels[i + 1], pixels[i + 2]], light = luma(source);
    if (light < 55 || light > 235) continue;
    let best = Infinity, target;
    for (const colour of UNCLAIMED_MATERIAL_PALETTE) {
      const cl = luma(colour);
      const distance = source.reduce((sum, v, k) => sum + (v - light - (colour[k] - cl)) ** 2, 0);
      if (distance < best) { best = distance; target = colour.map(v => light + v - cl); }
    }
    const adapted = source.map((v, k) => v + (target[k] - v) * .05);
    const adaptedLight = luma(adapted), lifted = light + (255 - light) * .05;
    for (let k = 0; k < 3; k++) pixels[i + k] = Math.max(0, Math.min(255, Math.round(lifted + (adapted[k] - adaptedLight) * .95)));
    if (_unclaimedMaterialColours.size >= 4096) _unclaimedMaterialColours.clear();
    _unclaimedMaterialColours.set(key, (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
  }
  return pixels;
}
function unclaimedMaterialColor(rgb) {
  const cached = _unclaimedMaterialColours.get(rgb);
  if (cached !== undefined) return cached;
  const px = new Uint8ClampedArray([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255]);
  tuneUnclaimedMaterialPixels(px);
  return (px[0] << 16) | (px[1] << 8) | px[2];
}
const CASTLE_STONE_UNCLAIMED = (() => {
  const mk = (n) => ({ n, s: '#' + n.toString(16).padStart(6, '0') });
  const out = {};
  for (const k of Object.keys(UNCLAIMED_BUILDING_BASE.stone)) out[k] = mk(unclaimedShade(UNCLAIMED_BUILDING_BASE.stone[k]));
  return out;
})();

// --- Water animation timing ---
// 8 phases × 220ms ≈ a 1.8s loop in which the highlight bands drift one band-
// period (8px) downward, about 4.5px/s: ambience, not a current. 8 phases over
// an 8px period is exactly 1px per step, so it reads as smooth motion.
const WATER_ANIM_PHASES = 8;
const WATER_ANIM_MS = 220;

// --- Biome texture registry ---
// Terrain class id → { variants, draw(ctx, size, rng, phaseFrac) }. Each
// variant becomes a Phaser canvas texture keyed `biome${type}_${v}` via
// makeBiomeTextures. Specs with `animPhases` additionally bake phases 1..N-1
// as `biome${type}_${v}p${p}` (phase 0 keeps the plain key), and render.js
// picks the phase from the wall clock when it builds the key.
const BIOME_TEX = {
  0:  { variants: 2, draw: drawGrassTex },        // grass: tufts
  1:  { variants: 2, patternOpacity: 0.75, draw: drawForestTex },       // forest: dense leaf litter
  2:  { variants: 2, patternOpacity: 0.925, draw: drawSandTex },         // sand: horizontal ripple marks
  // Water animates: `animPhases` pre-baked frames per variant, stepped every
  // `animMs` (see the "Animated biome textures" note above makeBiomeTextures).
  3:  { variants: 2, draw: drawWaterTex, animPhases: WATER_ANIM_PHASES, animMs: WATER_ANIM_MS },
  4:  { variants: 2, patternOpacity: 0.9, draw: drawFarmlandTex },     // farmland: muddy pasture + grass
  5:  { variants: 1, draw: drawResidentialTex },  // residential: concrete
  6:  { variants: 2, draw: drawParkTex },         // park: grass + flowers
  8:  { variants: 2, draw: drawPathTex },         // path: pebble grain
  9:  { variants: 1, draw: drawBuildingTex },     // building: cobbles
  11: { variants: 1, draw: drawWoodFloorTex },    // building_med: wooden plank floor
  12: { variants: 2, draw: drawCastleFloorTex },  // building_large / castle: subtle stone cobbles
  10: { variants: 2, patternOpacity: 0.9, draw: drawRockTex },         // rock: cracks
  // Subtype splits — each biome gets its own low-res texture so it reads
  // qualitatively different from the others (see src/biome_profiles.js for the
  // matching flora/fauna/tint profile).
  15: { variants: 2, draw: drawSchoolTex },       // SCHOOL — mown grass bands
  16: { variants: 2, draw: drawCommercialTex },   // COMMERCIAL — grey ceramic floor tile
  17: { variants: 1, patternOpacity: 0.9, draw: drawIndustrialTex },   // INDUSTRIAL — concrete + gravel
  27: { variants: 2, patternOpacity: 0.9, draw: drawWastelandTex },    // WASTELAND — dry grit + dead scrub tufts
  // The influence-zone halos (src/zones.js).
  28: { variants: 2, draw: drawGroveTex },        // GROVE — lush clover sward
  29: { variants: 2, draw: drawChurchyardTex },   // CHURCHYARD — worn sward, stone chips
  31: { variants: 2, patternOpacity: 0.9, draw: drawTarYardTex },      // TAR_YARD — oily ground, black pools
  18: { variants: 2, patternOpacity: 0.9, draw: drawPlaygroundTex },   // PLAYGROUND — bark mulch
  19: { variants: 2, patternOpacity: 0.94, draw: drawPitchTex },        // PITCH — mown stripes + chalk
  20: { variants: 2, patternOpacity: 1, draw: drawWetlandTex },      // WETLAND — marsh mottle + glints
  21: { variants: 2, patternOpacity: 1, draw: drawGolfTex },         // GOLF — fine fairway stripes
  22: { variants: 2, patternOpacity: 0.9, draw: drawOrchardTex },      // ORCHARD — dappled grass
  // PIER (type 23) — the water ripple as base texture; render.js overlays the
  // plank sprite via the cobblePool. Without it the cell would be bare colour,
  // and it animates in lockstep with WATER so the pier edge doesn't break the
  // "one body of water" read.
  23: { variants: 2, draw: drawWaterTex, animPhases: WATER_ANIM_PHASES, animMs: WATER_ANIM_MS },
  // Underground cave biome
  24: { variants: 3, patternOpacity: 0.9, draw: drawCaveFloorTex }, // CAVE_FLOOR — packed grit + pebbles
  25: { variants: 3, patternOpacity: 0.9, draw: drawCaveWallTex  }, // CAVE_WALL  — packed boulder faces
  // CAVE_LAVA (26) — the WATER tile, ember palette (drawLavaTex): same bands,
  // same animation clock, so it reads as the same kind of thing gone red.
  // One periodic wave shape keeps neighbouring cells aligned at every phase.
  26: { variants: 1, draw: drawLavaTex, animPhases: WATER_ANIM_PHASES, animMs: WATER_ANIM_MS },
  // UNMAPPED (30) — render-only pseudo-terrain for cells whose tile hasn't
  // loaded yet (never in a tile's grid): dark fog with drifting scan lines, so
  // a slow tile reads as "being charted" rather than fake grass that pops into streets.
  30: { variants: 1, draw: drawUnmappedTex, animPhases: 8, animMs: 260 },
};

// Tilled soil is per-cell state (not a terrain class).
const TILLED_COLOR = 0x927245;        // richer, darker turned earth
const TILLED_VARIANTS = 2;
// A tilled cell is drawn as ONE BED: an opaque soil pad baked into the
// `tilled_N` texture, inset TILLED_INSET_PX from every cell edge with corners
// of TILLED_CORNER_PX, the ring outside left transparent so ground shows
// between beds. The shape lives in the texture, not a per-frame path
// (fillRoundedRect tessellates ~400 points per cell per frame). The gap is in
// LOGICAL px (the canvas renders at up to 4× that): 1 would be a hairline on a
// phone, 2 reads as a real edge.
const TILLED_INSET_PX = 2;
const TILLED_CORNER_PX = 4;

// Tiny deterministic RNG factory so each texture variant is stable across reloads.
// NOT road_overlay.js' lcg(): this one divides by 0xffffffff (so it can return
// exactly 1.0) and floors a zero seed to 1; neither can adopt the other's
// divisor without re-rolling baked textures.
function seededRand(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// ── Painter idioms ─────────────────────────────────────────────────────────
// The strokes every ground painter below is made of. The textures are
// pinned byte for byte (ground_texture_seams, tilled_bed, lava, the palette
// audit), so a helper never rolls the dice on a painter's behalf: each one
// keeps its own `rng()` order, and the helper is told the numbers, or hands
// the rng over at exactly the moment the painter used to roll.
//
// A filled disc, and an axis-aligned filled ellipse. `style` set first when
// given, as the painters did.
function dot(ctx, x, y, r, style) {
  if (style !== undefined) ctx.fillStyle = style;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
function blob(ctx, x, y, rx, ry, style) {
  if (style !== undefined) ctx.fillStyle = style;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}
// `n` specks at rng positions, each rolled x then y, THEN `pick(rng)` chooses
// its ink (and any further rolls — a 2px width, a taller tick): returns
// [style, w = 1, h = 1].
function speckle(ctx, size, rng, n, pick) {
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    const [style, w = 1, h = 1] = pick(rng);
    ctx.fillStyle = style;
    ctx.fillRect(x, y, w, h);
  }
}
// `n` w×h grains whose ink is decided BEFORE the position is rolled: a fixed
// string, or `ink(rng)` for a per-grain roll.
function grain(ctx, size, rng, n, ink, w = 1, h = 1) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = typeof ink === 'function' ? ink(rng) : ink;
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), w, h);
  }
}
// Mown stripes every `step` px across the tile, `band` px wide, in
// `ink(stripeIndex)`; vertical when asked.
function stripes(ctx, size, step, ink, vertical = false, band = step) {
  for (let p = 0; p < size; p += step) {
    ctx.fillStyle = ink(Math.floor(p / step));
    if (vertical) ctx.fillRect(p, 0, band, size);
    else ctx.fillRect(0, p, size, band);
  }
}
// The canvas-texture shell every baked art shares: skip a key the scene
// already has, else create the canvas, hand `paint` its 2D context (and the
// texture, for makers that register frames) and upload it once.
function bakeCanvas(scene, key, w, h, paint) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  paint(tex.getContext(), tex);
  tex.refresh();
}

function drawGrassTex(ctx, size, rng) {
  // Short, dense lawn: specks only, no tall blades (tufts are reserved for the
  // harvestable "longgrass" wildplant so they read as pickable).
  ctx.clearRect(0, 0, size, size);
  // Mostly mid-green specks with occasional dark roots; very subtle.
  speckle(ctx, size, rng, 30, (rng) => {
    const r = rng();
    return [r < 0.20
      ? 'rgba(45,55,30,0.35)'        // dark root speck
      : r < 0.55
      ? 'rgba(95,110,65,0.25)'       // dry mid-green speck
      : 'rgba(170,175,130,0.18)'];   // bleached highlight
  });
}

function drawForestTex(ctx, size, rng) {
  // Dense leaf-litter clumps — small dark blobs + a few bright leaf specks.
  ctx.clearRect(0, 0, size, size);
  drawGroundMottle(ctx, size, rng, 0xF047, 14, 1.5, 1.5, 'rgba(15,28,12,0.35)');
  grain(ctx, size, rng, 10, 'rgba(140,150,105,0.25)');
}

function drawSandTex(ctx, size, rng) {
  // Horizontal wind-ripple marks on beach sand (3-4 wavy lines per tile).
  ctx.clearRect(0, 0, size, size);
  // Every hash-picked variant shares the same periodic ripple paths, so cell
  // edges do not chop the bands into squares.
  const ripples = seededRand(0x5A4D);
  const numLines = 3 + Math.floor(ripples() * 2);
  for (let r = 0; r < numLines; r++) {
    const baseY = Math.floor((r + 0.3 + ripples() * 0.4) * (size / numLines));
    const amp = 0.7 + ripples() * 0.9;
    const phase = ripples() * Math.PI * 2;
    ctx.strokeStyle = ripples() < 0.65 ? 'rgba(105,95,80,0.30)' : 'rgba(175,170,155,0.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Continue one sample beyond each edge so the clipped stroke joins the adjoining tile.
    for (let x = -1; x <= size + 1; x++) {
      const y = baseY + Math.sin(x * 2 * Math.PI / size + phase) * amp;
      if (x === -1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Scattered fine grain specks.
  grain(ctx, size, rng, 10, (rng) => rng() < 0.5 ? 'rgba(90,82,68,0.14)' : 'rgba(235,232,222,0.12)');
}

// Toroidally-wrapped primitives for tileable textures: draw the feature at
// every ±size offset where it would be visible, so anything crossing a tile
// edge re-enters on the opposite side instead of being clipped flat.
function wrapArc(ctx, size, x, y, r, style) {
  ctx.fillStyle = style;
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      if (x + ox + r < 0 || x + ox - r > size) continue;
      if (y + oy + r < 0 || y + oy - r > size) continue;
      dot(ctx, x + ox, y + oy, r);
    }
  }
}
function wrapRect(ctx, size, x, y, w, h, style) {
  ctx.fillStyle = style;
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      if (x + ox + w <= 0 || x + ox >= size) continue;
      if (y + oy + h <= 0 || y + oy >= size) continue;
      ctx.fillRect(x + ox, y + oy, w, h);
    }
  }
}

// Hash-picked variants need identical boundary features, not merely a wrap
// within each individual tile. Keep variable blobs clear of the border and
// share wrapped edge blobs, as farmland does, so mixed neighbours join too.
function drawGroundMottle(ctx, size, rng, edgeSeed, count, minR, radiusSpan, style) {
  const edge = seededRand(edgeSeed);
  const edgeCount = Math.ceil(count / 3);
  for (let i = 0; i < edgeCount; i++) {
    const along = edge() * size;
    const across = (edge() - 0.5) * minR;
    const r = minR + edge() * radiusSpan;
    const x = i % 2 ? across : along;
    const y = i % 2 ? along : across;
    wrapArc(ctx, size, x, y, r, style);
  }
  ctx.fillStyle = style;
  for (let i = edgeCount; i < count; i++) {
    const r = minR + rng() * radiusSpan;
    const margin = r + 1; // include the antialiased edge
    const x = margin + rng() * (size - 2 * margin);
    const y = margin + rng() * (size - 2 * margin);
    dot(ctx, x, y, r);
  }
}

function drawFarmlandTex(ctx, size, rng) {
  // Muddy pasture — churned brown mud patches with tufts of grass poking
  // through, plus a few hoof/churn marks.
  //
  // Tileability: cells hash-pick a variant, so any edge can abut any other
  // edge. Clipping blobs flat at the canvas edge read as a light grid at
  // every cell boundary, so features that may
  // touch an edge come from a FIXED seed shared by all variants and are drawn
  // toroidally wrapped; per-variant features stay fully inside the tile. All
  // variants therefore have pixel-identical borders and tile seamlessly in
  // any arrangement.
  ctx.clearRect(0, 0, size, size);

  // ── Seam pass: fixed seed, identical across variants, wrapped ──
  // Features sit ON the tile edges (alternating top/left; the toroidal wrap
  // gives the bottom/right halves) so borders carry the interior's mud density.
  const edge = seededRand(0xFA47);
  // Mud blobs straddling the edges.
  for (let i = 0; i < 3; i++) {
    const style = edge() < 0.5 ? 'rgba(70,50,25,0.22)' : 'rgba(95,70,35,0.18)';
    const along = edge() * size;                  // position along the edge
    const across = (edge() - 0.5) * 4;            // small offset across it
    const horiz = edge() < 0.5;                   // top edge vs left edge
    const x = horiz ? along : (across + size) % size;
    const y = horiz ? (across + size) % size : along;
    wrapArc(ctx, size, x, y, 3 + edge() * 4, style);
  }
  // Grass tufts scattered over the edges.
  for (let i = 0; i < 10; i++) {
    const r = edge();
    const style = r < 0.5 ? 'rgba(88,100,58,0.30)'
                : r < 0.8 ? 'rgba(52,62,38,0.28)'
                          : 'rgba(150,150,105,0.22)';
    const along = Math.floor(edge() * size);
    const across = Math.floor(edge() * 3) - 1;
    const horiz = edge() < 0.5;
    const x = horiz ? along : (across + size) % size;
    const y = horiz ? (across + size) % size : along;
    wrapRect(ctx, size, x, y, 1, edge() < 0.4 ? 2 : 1, style);
  }
  // Edge hoof marks.
  for (let i = 0; i < 2; i++) {
    const along = Math.floor(edge() * size);
    const across = Math.floor(edge() * 3) - 1;
    const horiz = edge() < 0.5;
    const x = horiz ? along : (across + size) % size;
    const y = horiz ? (across + size) % size : along;
    wrapRect(ctx, size, x, y, 2, 1, 'rgba(40,25,12,0.30)');
  }

  // ── Interior pass: per-variant rng, kept clear of the edges ──
  // Soft mud patches — irregular brown blobs, fully contained in the tile.
  for (let i = 0; i < 3; i++) {
    const r = 3 + rng() * 4;
    const style = rng() < 0.5 ? 'rgba(70,50,25,0.22)' : 'rgba(95,70,35,0.18)';
    dot(ctx, r + rng() * (size - 2 * r), r + rng() * (size - 2 * r), r, style);
  }
  // Grass tufts poking through — green specks, some 2px tall.
  for (let i = 0; i < 16; i++) {
    const r = rng();
    ctx.fillStyle = r < 0.5 ? 'rgba(88,100,58,0.30)'
                  : r < 0.8 ? 'rgba(52,62,38,0.28)'
                            : 'rgba(150,150,105,0.22)';
    const h = rng() < 0.4 ? 2 : 1;
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * (size - h + 1)), 1, h);
  }
  // A few dark churned / hoof marks.
  for (let i = 0; i < 2; i++) {
    ctx.fillStyle = 'rgba(40,25,12,0.30)';
    ctx.fillRect(Math.floor(rng() * (size - 1)), Math.floor(rng() * size), 2, 1);
  }
}

function drawParkTex(ctx, size, rng) {
  // Park = grass + occasional tiny flower.
  drawGrassTex(ctx, size, rng);
  // No yellow bloom: yellow is the interaction colour, and a yellow speck
  // reads as something to tap. Faded pink / rust / mauve instead.
  const colors = ['rgba(216,150,165,0.55)', 'rgba(190,120,95,0.55)', 'rgba(178,150,195,0.55)'];
  speckle(ctx, size, rng, 3, (rng) => [colors[Math.floor(rng() * colors.length)]]);
}

function drawTilledTex(ctx, size, rng) {
  // Ploughed earth — one rounded bed per cell (see TILLED_INSET_PX), with
  // clear horizontal furrows + grain clipped to the pad. Brown, never gold:
  // yellow is the interaction colour and tilled ground is terrain.
  // The pad is OPAQUE: render.js paints no soil fill under it, the cell's own
  // terrain colour is what shows through the transparent border ring.
  ctx.clearRect(0, 0, size, size);
  const x0 = TILLED_INSET_PX, y0 = TILLED_INSET_PX;
  const w = size - 2 * TILLED_INSET_PX, h = size - 2 * TILLED_INSET_PX;
  const r = Math.min(TILLED_CORNER_PX, w / 2, h / 2);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.lineTo(x0 + w - r, y0);
  ctx.arcTo(x0 + w, y0, x0 + w, y0 + r, r);
  ctx.lineTo(x0 + w, y0 + h - r);
  ctx.arcTo(x0 + w, y0 + h, x0 + w - r, y0 + h, r);
  ctx.lineTo(x0 + r, y0 + h);
  ctx.arcTo(x0, y0 + h, x0, y0 + h - r, r);
  ctx.lineTo(x0, y0 + r);
  ctx.arcTo(x0, y0, x0 + r, y0, r);
  ctx.closePath();
  ctx.fillStyle = '#' + TILLED_COLOR.toString(16).padStart(6, '0');
  ctx.fill();
  ctx.clip();
  const rowH = 8;
  for (let y = 2; y < size; y += rowH) {
    ctx.fillStyle = 'rgba(60,35,10,0.55)';
    ctx.fillRect(0, y, size, 1);
    ctx.fillStyle = 'rgba(214,198,170,0.16)';
    ctx.fillRect(0, y + 3, size, 1);
  }
  speckle(ctx, size, rng, 8, (rng) => [rng() < 0.5
    ? 'rgba(64,44,22,0.35)'
    : 'rgba(206,190,162,0.22)']);
  ctx.restore();
}

// The liquid's inks: the crest band, its leading edge and the depth speck.
// Water is the original; lava is the same drawing in embers (drawLavaTex).
const WATER_INKS = {
  crest: 'rgba(150,200,205,0.26)', edge: 'rgba(205,225,225,0.12)', speck: 'rgba(0,20,50,0.18)',
};
const LAVA_INKS = {
  crest: 'rgba(218,107,35,0.24)', edge: 'rgba(241,157,69,0.16)', speck: 'rgba(40,0,0,0.30)',
};
function drawLavaTex(ctx, size, rng, phaseFrac = 0) {
  drawWaterTex(ctx, size, rng, phaseFrac, LAVA_INKS);
}

function drawWaterTex(ctx, size, rng, phaseFrac = 0, inks = WATER_INKS) {
  // Horizontal highlight bands. `phaseFrac` (0..1) slides them downward by that
  // fraction of one band-period; a full unit returns to itself, so the
  // WATER_ANIM_PHASES baked frames loop seamlessly. The rng call sequence is
  // phase-independent, so the depth specks hold still while only bands move.
  ctx.clearRect(0, 0, size, size);
  // The band grid is FIXED across variants and divides the tile exactly (period
  // 8 into a 32px cell, no per-variant offset), so every water cell's crests
  // sit on the same rows and step in lockstep: a crest leaving one cell's
  // bottom edge is the one entering the next cell's top edge.
  const bandH = 2;
  const period = 8;                        // must divide `size` for the wrap below
  const off = Math.round(phaseFrac * period);
  // Horizontal variation: a gentle sine swell plus one broken-crest window,
  // SHARED by every band in the tile (after one cycle band k sits where band
  // k+1 was, so a per-band shape would pop at the wrap). The wave slides one
  // wavelength sideways per loop, so water shimmers diagonally.
  const waveLen = size / (1 + Math.floor(rng() * 2));   // 1-2 waves per tile (x-periodic)
  const wavePhase = rng() * Math.PI * 2;
  const waveAmp = 0.8 + rng() * 0.7;                    // ~1px swell
  const gapStart = Math.floor(rng() * size);            // broken-crest window (wraps)
  const gapLen = 4 + Math.floor(rng() * 5);             // 4-8 px of open water
  const xPhase = phaseFrac * Math.PI * 2;   // one wavelength per loop — seamless
  // 1px row with toroidal y-wrap, so bands scroll through without clipping flat at y=0.
  const row = (x, y, style) => {
    ctx.fillStyle = style;
    ctx.fillRect(x, ((y % size) + size) % size, 1, 1);
  };
  for (let y = off; y < size + off; y += period) {
    for (let x = 0; x < size; x++) {
      if ((x - gapStart + size) % size < gapLen) continue;
      const yy = y + Math.round(Math.sin(x * 2 * Math.PI / waveLen + wavePhase + xPhase) * waveAmp);
      for (let r = 0; r < bandH; r++) row(x, yy + r, inks.crest); // dull crest band
      row(x, yy, inks.edge);                                     // faint leading edge
    }
  }
  // Subtle dark depth specks.
  grain(ctx, size, rng, 4, inks.speck, 2, 1);
}

function drawUnmappedTex(ctx, size, rng, phaseFrac = 0) {
  // The "still charting this ground" shimmer (pseudo-terrain 30 above): faint
  // diagonal survey lines over the dark fog base. The grid is tile-periodic and
  // every unmapped cell shares one variant and clock, so the pattern runs
  // continuously across the unloaded area. Pre-baked phases like water.
  ctx.clearRect(0, 0, size, size);
  const P = 8;                                   // diagonal line spacing; divides 32
  const off = Math.round(phaseFrac * P);
  ctx.fillStyle = 'rgba(200,210,220,0.07)';      // survey line — barely-there steel
  for (let y = 0; y < size; y++) {
    for (let x = (((off - y) % P) + P) % P; x < size; x += P) {
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // Static specks (same rng sequence every phase, so only the lines move).
  grain(ctx, size, rng, 6, 'rgba(0,0,0,0.20)', 2, 1);
}

function drawResidentialTex(ctx, size, rng) {
  // Concrete — subtle, infrequent aggregate flecks on transparent bg.
  ctx.clearRect(0, 0, size, size);
  speckle(ctx, size, rng, 14, (rng) => [rng() < 0.5
    ? 'rgba(0,0,0,0.18)'
    : 'rgba(255,255,255,0.10)']);
  for (let i = 0; i < 3; i++) {
    const x = 2 + Math.floor(rng() * (size - 4));
    const y = 2 + Math.floor(rng() * (size - 4));
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawPathTex(ctx, size, rng) {
  // Scattered pebbles — small darker and lighter dots.
  ctx.clearRect(0, 0, size, size);
  speckle(ctx, size, rng, 18, (rng) => {
    const dark = rng() < 0.6;
    const w = rng() < 0.3 ? 2 : 1;
    return [dark ? 'rgba(38,32,24,0.4)' : 'rgba(226,222,212,0.25)', w, w];
  });
}

function drawBuildingTex(ctx, size, rng) {
  // Small rounded cobbles packed across the cell.
  ctx.clearRect(0, 0, size, size);
  const step = 6;
  for (let row = 0; row * step < size + step; row++) {
    const offset = (row % 2) * (step / 2);
    for (let col = 0; col * step < size + step; col++) {
      const cx = col * step + offset + (rng() - 0.5) * 1.5;
      const cy = row * step + step / 2 + (rng() - 0.5) * 1.5;
      const r = 2 + rng() * 0.6;
      dot(ctx, cx, cy, r, 'rgba(0,0,0,0.35)');
      dot(ctx, cx - 0.6, cy - 0.6, r - 1.2, 'rgba(255,255,255,0.18)');
    }
  }
}

function drawCastleFloorTex(ctx, size, rng) {
  // Subtle stone cobbles for the castle court — coarser and much fainter
  // than the house cobble (drawBuildingTex) so the paving reads without
  // competing with the bright rampart walls. Drawn as a transparent overlay
  // baked over the slate base colour.
  ctx.clearRect(0, 0, size, size);
  const step = 8;
  for (let row = 0; row * step < size + step; row++) {
    const offset = (row % 2) * (step / 2);
    for (let col = 0; col * step < size + step; col++) {
      const cx = col * step + offset + (rng() - 0.5) * 2;
      const cy = row * step + step / 2 + (rng() - 0.5) * 2;
      const r = 2.6 + rng() * 0.8;
      dot(ctx, cx, cy, r, 'rgba(0,0,0,0.15)');
      dot(ctx, cx - 0.7, cy - 0.7, r - 1.4, 'rgba(255,255,255,0.08)');
    }
  }
}

function drawWoodFloorTex(ctx, size, rng) {
  // Horizontal planks with staggered seams + faint grain.
  ctx.clearRect(0, 0, size, size);
  const PLANK_H = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  for (let y = PLANK_H; y < size; y += PLANK_H) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(size, y + 0.5); ctx.stroke();
  }
  // Plank-end seams — one per row, staggered.
  for (let row = 0; row * PLANK_H < size; row++) {
    const ex = 4 + Math.floor(rng() * (size - 8));
    ctx.beginPath();
    ctx.moveTo(ex + 0.5, row * PLANK_H);
    ctx.lineTo(ex + 0.5, row * PLANK_H + PLANK_H);
    ctx.stroke();
  }
  // Light grain streaks.
  ctx.strokeStyle = 'rgba(222,214,196,0.18)';
  for (let i = 0; i < 20; i++) {
    const y = rng() * size, x = rng() * size, len = 3 + rng() * 10;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
  }
  // Occasional knot.
  if (rng() < 0.5) dot(ctx, rng() * size, rng() * size, 1.4 + rng() * 0.6, 'rgba(62,48,30,0.55)');
}

function drawRockTex(ctx, size, rng) {
  // A few jagged dark cracks plus a couple highlights.
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  const cracks = 2 + Math.floor(rng() * 2);
  for (let c = 0; c < cracks; c++) {
    let x = rng() * size;
    let y = rng() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < segs; i++) {
      x += (rng() - 0.5) * (size / 2);
      y += (rng() - 0.5) * (size / 2);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  grain(ctx, size, rng, 4, 'rgba(255,255,255,0.12)', 2, 1);
}

// ── Cave biome textures ────────────────────────────────────────────────────

function drawCaveWallTex(ctx, size, rng) {
  // Packed boulder faces — irregular ellipses with shadow outlines and a
  // highlight sliver on the top-left so the rocks read as three-dimensional
  // against the near-black base colour (0x241f1b).
  ctx.clearRect(0, 0, size, size);
  const step = 7;
  for (let row = 0; row * step < size + step; row++) {
    const offset = (row % 2) * 3;
    for (let col = 0; col * step < size + step; col++) {
      const cx = col * step + offset + (rng() - 0.5) * 2.5;
      const cy = row * step + step * 0.5 + (rng() - 0.5) * 2;
      const rw = 2.5 + rng() * 1.2;
      const rh = 1.8 + rng() * 1.0;
      // Faint warm face — catches a tiny glimmer off the cave floor below
      blob(ctx, cx, cy, rw, rh, 'rgba(200,170,130,0.07)');
      // Crack / shadow outline around each boulder
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2); ctx.stroke();
      // Highlight sliver — top-left edge
      blob(ctx, cx - rw * 0.3, cy - rh * 0.35, rw * 0.45, rh * 0.38, 'rgba(255,220,180,0.13)');
    }
  }
  // 1-2 longer crack lines cutting across the face
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1;
  const cracks = 1 + Math.floor(rng() * 2);
  for (let c = 0; c < cracks; c++) {
    let x = rng() * size, y = rng() * size;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 3; s++) {
      x += (rng() - 0.5) * 6; y += (rng() - 0.5) * 6;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Rare mineral glint — a single bright pixel
  if (rng() < 0.45) {
    ctx.fillStyle = 'rgba(200,240,255,0.45)';
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
  }
}

function drawCaveFloorTex(ctx, size, rng) {
  // Packed grit and small pebbles over the earthy brown base (0x4a423b).
  ctx.clearRect(0, 0, size, size);
  // Fine grit — dark and light specks
  speckle(ctx, size, rng, 22, (rng) => [rng() < 0.6
    ? 'rgba(0,0,0,0.28)'
    : 'rgba(255,215,170,0.13)']);
  // Small pebbles (2×1 or 1×2)
  const pebbles = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < pebbles; i++) {
    const x = 1 + Math.floor(rng() * (size - 3));
    const y = 1 + Math.floor(rng() * (size - 3));
    const horiz = rng() < 0.5;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, y, horiz ? 2 : 1, horiz ? 1 : 2);
    ctx.fillStyle = 'rgba(255,210,160,0.18)';
    ctx.fillRect(x, y, 1, 1);
  }
  // Occasional shallow groove
  if (rng() < 0.4) {
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    const gx = rng() * size, gy = rng() * size;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + (rng() - 0.5) * 8, gy + (rng() - 0.5) * 4);
    ctx.stroke();
  }
}

// ── Subtype-biome textures ─────────────────────────────────────────────────
// Each builds on grass or concrete to give the biome its own read at a glance.

function drawSchoolTex(ctx, size, rng) {
  // Schoolyard turf — grass with faint horizontal mown bands.
  drawGrassTex(ctx, size, rng);
  stripes(ctx, size, 8, () => 'rgba(255,255,255,0.05)', false, 4);
}

function drawPitchTex(ctx, size, rng) {
  // Sports pitch — bold alternating mown stripes + the odd chalk sideline.
  drawGrassTex(ctx, size, rng);
  stripes(ctx, size, 8, (i) => (i % 2) ? 'rgba(255,255,255,0.06)' : 'rgba(0,30,0,0.08)');
  if (rng() < 0.25) {
    ctx.fillStyle = 'rgba(235,235,225,0.22)';
    ctx.fillRect(rng() < 0.5 ? 2 : size - 3, 0, 1, size);
  }
}

function drawGolfTex(ctx, size, rng) {
  // Fairway — fine vertical mowing stripes on bright turf.
  drawGrassTex(ctx, size, rng);
  stripes(ctx, size, 4, (i) => (i % 2) ? 'rgba(255,255,255,0.03)' : 'rgba(0,30,0,0.04)', true);
}

function drawPlaygroundTex(ctx, size, rng) {
  // Bark / rubber mulch — warm brown chips, no green.
  ctx.clearRect(0, 0, size, size);
  speckle(ctx, size, rng, 40, (rng) => {
    const r = rng();
    const style = r < 0.5 ? 'rgba(96,84,62,0.30)'
                : r < 0.8 ? 'rgba(128,116,92,0.25)'
                          : 'rgba(72,62,44,0.30)';
    return [style, rng() < 0.3 ? 2 : 1, 1];
  });
}

function drawCommercialTex(ctx, size, rng) {
  // Grey anti-slip matte ceramic floor tile (one big tile per cell). Drawn over
  // the flat grey COMMERCIAL fill: a fine matte speckle for the anti-slip
  // finish, a faint ceramic mottle, and a recessed grout seam on the top + left
  // edges so adjacent cells read as a continuous large-format tile grid.
  ctx.clearRect(0, 0, size, size);
  // Anti-slip matte speckle — many very-low-contrast dots, evenly spread.
  speckle(ctx, size, rng, 70, (rng) => [rng() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)']);
  // Faint ceramic mottle — a couple of soft tonal patches.
  for (let i = 0; i < 3; i++) dot(ctx, rng() * size, rng() * size, 5 + rng() * 5, 'rgba(0,0,0,0.04)');
  // Grout seam (top + left) with a soft inner highlight = a subtle bevel.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, 0, size, 1);
  ctx.fillRect(0, 0, 1, size);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(0, 1, size, 1);
  ctx.fillRect(1, 0, 1, size);
}

function drawIndustrialTex(ctx, size, rng) {
  // Industrial yard — rough concrete with scattered gravel + the odd oil stain.
  ctx.clearRect(0, 0, size, size);
  speckle(ctx, size, rng, 22, (rng) => {
    const style = rng() < 0.55 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.10)';
    const w = rng() < 0.25 ? 2 : 1;
    return [style, w, w];
  });
  if (rng() < 0.5) dot(ctx, rng() * size, rng() * size, 2 + rng() * 2, 'rgba(0,0,0,0.16)');
}

function drawWastelandTex(ctx, size, rng) {
  // Wasteland — abandoned lot gone to scrub: dry grit, a hairline crack or
  // two, and a few pale dead-grass ticks. Same family as residential's
  // concrete flecks, but looser and dustier, so a vacant lot reads as
  // neglected ground rather than a yard.
  ctx.clearRect(0, 0, size, size);
  speckle(ctx, size, rng, 16, (rng) => {
    const style = rng() < 0.6 ? 'rgba(52,42,26,0.22)' : 'rgba(236,224,190,0.12)';
    return [style, rng() < 0.3 ? 2 : 1, 1];
  });
  ctx.strokeStyle = 'rgba(40,32,20,0.20)';
  ctx.lineWidth = 1;
  for (let c = 0; c < 2; c++) {
    let x = rng() * size, y = rng() * size;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      x += (rng() - 0.5) * 8; y += (rng() - 0.5) * 8;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let t = 0; t < 4; t++) {
    const x = 2 + Math.floor(rng() * (size - 4)), y = 3 + Math.floor(rng() * (size - 5));
    ctx.fillStyle = 'rgba(214,196,140,0.28)';
    ctx.fillRect(x, y - 2, 1, 2);
    ctx.fillRect(x + 1, y - 1, 1, 1);
    ctx.fillRect(x - 1, y - 1, 1, 1);
  }
}

function drawGroveTex(ctx, size, rng) {
  // Grove — deep yellow-olive clover with a pale blossom or two.
  drawGrassTex(ctx, size, rng);
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(rng() * (size - 2)), y = Math.floor(rng() * (size - 2));
    ctx.fillStyle = 'rgba(83,105,48,0.40)';
    ctx.fillRect(x, y, 2, 1); ctx.fillRect(x, y + 1, 1, 1);
  }
  grain(ctx, size, rng, 2, (rng) => rng() < 0.5 ? 'rgba(230,225,240,0.45)' : 'rgba(216,160,175,0.45)');
}

function drawChurchyardTex(ctx, size, rng) {
  // Churchyard — earthy heather ground, muted moss tufts and pale stone chips.
  ctx.clearRect(0, 0, size, size);
  speckle(ctx, size, rng, 22, (rng) => {
    const k = rng();
    return [k < 0.45 ? 'rgba(76,62,73,0.34)' : k < 0.75 ? 'rgba(112,96,108,0.26)' : 'rgba(150,160,140,0.20)', k < 0.25 ? 2 : 1, 1];
  });
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(rng() * (size - 2)), y = Math.floor(rng() * (size - 2));
    ctx.fillStyle = 'rgba(200,200,190,0.30)';
    ctx.fillRect(x, y, 2, 1);
    ctx.fillStyle = 'rgba(40,40,36,0.25)';
    ctx.fillRect(x, y + 1, 2, 1);
  }
}

function drawTarYardTex(ctx, size, rng) {
  // Tar yard — dark oily ground: grit, a black pool or two with a dull
  // blue-violet sheen on its lip.
  ctx.clearRect(0, 0, size, size);
  speckle(ctx, size, rng, 16, (rng) => [rng() < 0.6 ? 'rgba(0,0,0,0.30)' : 'rgba(255,255,255,0.07)']);
  const pools = 1 + Math.floor(rng() * 2);
  for (let p = 0; p < pools; p++) {
    const x = rng() * size, y = rng() * size, r = 2 + rng() * 3;
    dot(ctx, x, y, r, 'rgba(8,8,10,0.45)');
    ctx.strokeStyle = 'rgba(120,110,170,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
  }
}

function drawWetlandTex(ctx, size, rng) {
  // Marsh — dark mossy mottle, faint water glints, a few vertical reed flecks.
  ctx.clearRect(0, 0, size, size);
  drawGroundMottle(ctx, size, rng, 0x4A45, 10, 1.5, 2, 'rgba(30,42,28,0.30)');
  const glints = seededRand(0x61A7);
  ctx.strokeStyle = 'rgba(150,175,175,0.20)';
  ctx.lineWidth = 1;
  for (let r = 0; r < 2; r++) {
    const baseY = 2 + glints() * (size - 4), phase = glints() * Math.PI * 2;
    ctx.beginPath();
    for (let x = -1; x <= size + 1; x++) {
      const y = baseY + Math.sin((x / size) * Math.PI * 2 + phase);
      if (x === -1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = 'rgba(96,108,66,0.30)';
    const h = 2 + Math.floor(rng() * 2);
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * (size - h + 1)), 1, h);
  }
}

function drawOrchardTex(ctx, size, rng) {
  // Orchard understory — grass dappled with soft tree-shade pools.
  drawGrassTex(ctx, size, rng);
  for (let i = 0; i < 3; i++) dot(ctx, rng() * size, rng() * size, 4 + rng() * 3, 'rgba(0,30,0,0.10)');
}

// (longgrass uses frame 0 of the 'props' sheet via CROP_SPRITE, not a
// procedural texture.)

// Approved sprite silhouettes, baked once per restoration state. Source
// luminance selects a shared material shade; no per-frame pixel readbacks.
function castleTowerInk(r, g, b, material) {
  const timber = material.rampart.woodTop && r > g * 1.16 && r > b * 1.3;
  const p = timber ? material.wood : material.stone;
  const light = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const shade = light < 42 ? 'DARK' : light < 74 ? 'SHADOW' : light < 104 ? 'SIDE'
    : light < 137 ? 'FACE' : light < 168 ? 'BODY' : 'LITE';
  return p[shade] ?? p.FACE;
}
function makeTowerTexture(scene, palette, key) {
  const W = CastleStyles.TOWER_WIDTH, H = CastleStyles.TOWER_HEIGHT;
  bakeCanvas(scene, key || 'tower', W * CastleStyles.ids.length, H, (ctx, tex) => {
  const source = scene.textures.get('castle_tower_shapes').getSourceImage();
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, W * CastleStyles.ids.length, H);
  const claimed = palette !== CASTLE_STONE_UNCLAIMED;
  const crowns = CastleStyles.ids.map(() => H);
  const materials = CastleStyles.ids.map(id => CastleStyles.get(id, claimed));
  // Soften the masonry's join with irregular castle geometry. The bottom
  // ten rows rise from 30% opacity at the foot to fully opaque above it.
  const fadeRows = 10, footAlpha = 0.3;
  for (let y = 0; y < H; y++) for (let x = 0; x < W * materials.length; x++) {
    const i = (y * W * materials.length + x) * 4, pixels = image.data;
    if (pixels[i + 3] < 128) { pixels[i + 3] = 0; continue; }
    const frame = Math.floor(x / W);
    const ink = castleTowerInk(pixels[i], pixels[i + 1], pixels[i + 2], materials[frame]);
    pixels[i] = ink >> 16; pixels[i + 1] = (ink >> 8) & 255; pixels[i + 2] = ink & 255;
    pixels[i + 3] = Math.round(255 * (footAlpha + (1 - footAlpha)
      * Math.min(1, (H - 1 - y) / (fadeRows - 1))));
    crowns[frame] = Math.min(crowns[frame], y);
  }
  ctx.putImageData(image, 0, 0);
  for (let frame = 0; frame < materials.length; frame++) {
    tex.add(frame, 0, frame * W, 0, W, H);
    const f = tex.get(frame);
    if (f) f.castleCrownY = crowns[frame];
  }
  });
}

// Square dark heraldry shares the restored banner's pole foot and canvas.
// Each family keeps a readable skull, with distinct cloth and pixel geometry.
function makeCastleSkullFlagTexture(scene) {
  const heraldry = {
    citadel: { cloth: '#111111', edge: '#494949', bone: '#e8e3ce', accent: '#929292', glyph: [
      '.........', '..XXXXX..', '.XXXXXXX.', '.X..X..X.', '.X..X..X.', '..XX.XX..', '...XXX...', '...X.X...', '.........',
    ] },
    ruin: { cloth: '#111111', edge: '#494949', bone: '#d9d1b1', accent: '#8a877b', glyph: [
      '.........', '..XX.XX..', '.XXX.XXX.', '.X..X..X.', '.X..X..X.', '..XX..X..', '...XX....', '...X.X...', 'O.......O',
    ] },
    bastion: { cloth: '#484848', edge: '#737373', bone: '#eee2cb', accent: '#bc9862', glyph: [
      'OOOOOOOOO', 'O.XXXXX.O', 'OXXXXXXXO', 'OX..X..XO', 'OX..X..XO', 'O.XX.XX.O', '.O.XXX.O.', '..O.X.O..', '...OOO...',
    ] },
    archive: { cloth: '#493425', edge: '#79614b', bone: '#e7dfcd', accent: '#b49c76', glyph: [
      '..XXXXX..', '.XXXXXXX.', '.X..X..X.', '..XX.XX..', '...XXX...', 'OOOO.OOOO', 'O..O.O..O', 'OOOOOOOOO', '....O....',
    ] },
  };
  for (const [id, art] of Object.entries(heraldry)) {
    const key = `castle_skull_flag_${id}`;
    if (scene.textures.exists(key)) continue;
    const texture = scene.textures.createCanvas(key, 16, 18), ctx = texture.getContext();
    ctx.fillStyle = '#29251d'; ctx.fillRect(2, 0, 3, 18);
    ctx.fillStyle = '#8b795e'; ctx.fillRect(2, 1, 2, 17);
    ctx.fillStyle = art.edge; ctx.fillRect(4, 1, 12, 12);
    ctx.fillStyle = art.cloth; ctx.fillRect(5, 2, 10, 10);
    for (let y = 0; y < art.glyph.length; y++) for (let x = 0; x < art.glyph[y].length; x++) {
      const mark = art.glyph[y][x];
      if (mark === '.') continue;
      ctx.fillStyle = mark === 'X' ? art.bone : art.accent;
      ctx.fillRect(5 + x, 2 + y, 1, 1);
    }
    texture.refresh();
  }
}

// Procedural "pot of gold" — the in-world art for the coin-burst POIs
// (ATM + bicycle_parking). Tapping one of these spills a burst of collectible
// coins, so a little cast-iron cauldron brimming with gold reads the mechanic
// at a glance.
// Single-frame canvas texture keyed 'potofgold'; the render spec leaves `frame`
// undefined for it, exactly like the themed-house sprites.
function makePotOfGoldTexture(scene) {
  const W = 24, H = 22;
  bakeCanvas(scene, 'potofgold', W, H, (ctx) => {
  ctx.clearRect(0, 0, W, H);
  const cx = 12;

  // ── Cast-iron cauldron body ─────────────────────────────────────────
  // A dark rounded pot drawn as an ellipse, with a belly highlight/shadow
  // and three stubby feet so it reads as a pot rather than a blob.
  const bodyCY = 14, bodyRX = 9, bodyRY = 7;
  blob(ctx, cx, bodyCY, bodyRX, bodyRY, '#2b2b32');
  blob(ctx, cx - 3, bodyCY + 1, 3, 5, 'rgba(255,255,255,0.12)');   // left-belly highlight
  blob(ctx, cx + 4, bodyCY + 1, 3, 5, 'rgba(0,0,0,0.30)');          // right-belly shadow

  // Rim band + dark inner mouth (so the gold reads as overflowing the pot).
  blob(ctx, cx, 8, 9, 3, '#3b3b44');
  blob(ctx, cx, 8, 7, 2, '#1a1a1e');

  // Three little feet.
  ctx.fillStyle = '#1f1f24';
  ctx.fillRect(cx - 7, 19, 3, 2);
  ctx.fillRect(cx - 1, 20, 3, 2);
  ctx.fillRect(cx + 4, 19, 3, 2);

  // ── Green coin pile overflowing the mouth ───────────────────────────
  const gold = '#45c878', goldHi = '#b2f5ba', goldLo = '#21894f';
  blob(ctx, cx, 7, 8, 4, gold);                // base mound
  // Rounded coin bumps on top — each is a low-shadow + body + highlight dot.
  const coins = [
    [cx - 4, 5, 2.4], [cx + 1, 4, 2.6], [cx + 5, 6, 2.2],
    [cx - 1, 7, 2.2], [cx + 3, 8, 1.8],
  ];
  for (const [x, y, r] of coins) {
    blob(ctx, x, y + 0.6, r, r * 0.7, goldLo);
    blob(ctx, x, y, r, r * 0.7, gold);
    blob(ctx, x - r * 0.3, y - r * 0.25, r * 0.4, r * 0.3, goldHi);
  }
  // A couple of coins spilling down each side of the pot.
  for (const [x, y] of [[cx - 8, 11], [cx + 9, 12]]) {
    blob(ctx, x, y, 2, 1.5, gold);
    blob(ctx, x - 0.4, y - 0.4, 0.8, 0.6, goldHi);
  }

  // Crisp dark outline along the lower belly for pixel-art pop (the top is
  // hidden behind the gold, so only stroke the visible bottom arc).
  ctx.strokeStyle = '#15151a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, bodyCY, bodyRX, bodyRY, 0, Math.PI * 0.12, Math.PI * 0.88);
  ctx.stroke();
  });
}

// === Traps — TEMPORARY procedural art ==================================
// Two single-frame canvas textures, both exactly one cell (TRAP_PX) square so
// the mark reads as belonging to ONE cell (CLAUDE.md: interactables must be
// clearly in one cell) — the art is inset from every edge, and the renderer
// centres it on the cell, so nothing spills onto a neighbour.
//
// These are STAND-INS for hand-drawn sprites: a trap has to say two opposite
// things with one silhouette.
//
//   trap_hidden — a scuff of disturbed ground: a broken ring of small round
//     stones (a shadowed underside, a paler lit top), a couple of twig slivers
//     and one small dark gap where the covering has sagged. All low alpha, in
//     tones taken off the ground, so it reads as "something is odd" to a
//     careful player and as nothing to one who is not (flat 2×1 dots at
//     0.20-0.30 alpha were too faint to spot). It stays under the 0.4-alpha
//     ceiling the sprung trap's opaque ink clears. Under the lightmap an unlit
//     cell hides it completely, which is why caves are the dangerous half.
//
//   trap_open — a sprung iron jaw: dark pit, rust-brown ring, two arcs of
//     triangular teeth meeting across it, lit from the top-left. Loud on
//     purpose: once it has bitten, standing on it is an ongoing cost, so the
//     art's job is "get off, and don't walk back onto it".
const TRAP_PX = 32;                 // one cell — CELL_PX in app.js

function makeTrapTextures(scene) {
  makeHiddenTrapTexture(scene);
  makeSprungTrapTexture(scene);
}

function makeHiddenTrapTexture(scene) {
  const S = TRAP_PX, c = S / 2;
  bakeCanvas(scene, 'trap_hidden', S, S, (ctx) => {
  ctx.clearRect(0, 0, S, S);

  // Disturbed-earth ring: small round stones, each a shadowed underside plus a
  // paler lit top, drawn close enough to overlap into one rounded shape. Broken,
  // not continuous: a complete circle on the ground reads as a manhole.
  const R = c - 4;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.35;
    if (i % 5 === 3) continue;                    // gaps in the ring
    const x = c + Math.cos(a) * R, y = c + Math.sin(a) * R * 0.92;
    blob(ctx, x, y + 0.6, 1.8, 1.3, 'rgba(24,18,12,0.40)');      // shadowed underside of the stone
    blob(ctx, x, y - 0.5, 1.4, 1.0, 'rgba(224,210,182,0.32)');   // its lit top, catching the light
  }
  // The sag: a small dark crescent just below centre, deliberately fainter than
  // the ring (the ring is the tell; the centre should all but disappear).
  ctx.fillStyle = 'rgba(18,14,10,0.15)';
  ctx.beginPath();
  ctx.ellipse(c + 1, c + 2, 3, 1.5, -0.25, 0, Math.PI * 2);   // tilted: not blob's axis-aligned ellipse
  ctx.fill();
  // Twigs laid over the covering: straight strokes read as PLACED cover, not bare dirt.
  ctx.strokeStyle = 'rgba(150,132,92,0.28)';
  ctx.lineWidth = 1;
  const twigs = [[-7, -4, 6, 3], [-5, 4, 8, -2], [1, -6, 5, 6]];
  for (const [dx0, dy0, dx1, dy1] of twigs) {
    ctx.beginPath();
    ctx.moveTo(c + dx0 + 0.5, c + dy0 + 0.5);
    ctx.lineTo(c + dx0 + dx1 + 0.5, c + dy0 + dy1 + 0.5);
    ctx.stroke();
  }
  });
}

function makeSprungTrapTexture(scene) {
  const S = TRAP_PX, c = S / 2;
  bakeCanvas(scene, 'trap_open', S, S, (ctx) => {
  ctx.clearRect(0, 0, S, S);

  // The whole jaw is drawn at SPRUNG_K of the cell and EVERY number below is
  // scaled by it, so resizing is one constant. Edge to edge it crowded the
  // ground marks and neighbouring sprites; at 0.85 it still shouts.
  const SPRUNG_K = 0.85;
  const k = SPRUNG_K;
  const RX = (c - 3) * k, RY = (c - 3) * 0.84 * k;   // squashed — seen from above
  const IRON = '#7b6553', IRON_HI = '#ac967f', IRON_LO = '#332a22';
  const RUST = '#8a4a28';

  // The plate and the dark hole inside it, which the teeth bite into (without
  // it the whole thing reads as a disc).
  blob(ctx, c, c, RX, RY, 'rgba(38,27,18,0.9)');
  blob(ctx, c, c, RX - 4 * k, RY - 2 * k, '#0b0908');
  ctx.lineWidth = 1;
  ctx.strokeStyle = RUST;
  ctx.beginPath(); ctx.ellipse(c, c, RX - 0.5 * k, RY - 0.5 * k, 0, 0, Math.PI * 2); ctx.stroke();

  // TWO JAWS, not a ring: each a thick arc over roughly the top (or bottom)
  // two-thirds of the plate, with a GAP at each side for the hinge and spring.
  // The gaps and the dark slit between tooth tips make a closed mouth rather
  // than a wheel.
  const A0 = 0.14, A1 = 0.86;                 // jaw arc, in units of π
  const jaw = (flip) => {
    const s = flip ? Math.PI * (1 + A0) : Math.PI * A0;
    const e = flip ? Math.PI * (1 + A1) : Math.PI * A1;
    ctx.lineWidth = 3 * k;
    ctx.strokeStyle = IRON;
    ctx.beginPath(); ctx.ellipse(c, c, RX - 2 * k, RY - 2 * k, 0, s, e); ctx.stroke();
    // Lit edge on the OUTSIDE of each jaw, so the bands read as separate pieces of metal.
    ctx.lineWidth = 1;
    ctx.strokeStyle = flip ? IRON_HI : IRON_LO;
    ctx.beginPath(); ctx.ellipse(c, c, RX - 0.8 * k, RY - 0.8 * k, 0, s, e); ctx.stroke();
  };
  jaw(true);      // upper
  jaw(false);     // lower

  // The teeth hang STRAIGHT DOWN off the upper jaw and straight up off the
  // lower, never along the radius, over the middle of each arc only, so the
  // rows meet in a narrow horizontal zigzag: the mouth of a CLOSED trap.
  // Radial teeth read as a WHEEL at every length (near the sides they point
  // sideways, and no jaw has sideways teeth).
  const TOOTH = 4.6 * k, HALF_W = 1.5 * k;
  const B0 = 0.20, B1 = 0.80;                 // tooth span, in units of π
  const tooth = (ang, down) => {
    const bx = c + Math.cos(ang) * (RX - 3 * k);
    const by = c + Math.sin(ang) * (RY - 3 * k);
    ctx.fillStyle = IRON_HI;
    ctx.beginPath();
    ctx.moveTo(bx - HALF_W, by);
    ctx.lineTo(bx + HALF_W, by);
    ctx.lineTo(bx, by + (down ? TOOTH : -TOOTH));
    ctx.closePath();
    ctx.fill();
  };
  const TEETH = 5;
  for (let i = 0; i < TEETH; i++) {
    const t = (i + 0.5) / TEETH;
    tooth(Math.PI * (1 + B0 + (B1 - B0) * t), true);    // upper jaw, biting down
    tooth(Math.PI * (B0 + (B1 - B0) * t), false);       // lower jaw, biting up
  }

  // Hinge and spring, one each side, filling the jaws' gaps. They break the
  // circle (a plain disc reads as a treasure pad here; see makeRoundPadTexture).
  // Anchored to the PLATE's rim (2 units outside the ellipse, running inward),
  // so they bridge the gap at any SPRUNG_K.
  const HW = 5 * k, HH = 4 * k, LIP = 1 * k;
  const hxL = c - RX - 2 * k, hxR = c + RX + 2 * k - HW, hy = c - HH / 2;
  ctx.fillStyle = IRON;
  ctx.fillRect(hxL, hy, HW, HH);
  ctx.fillRect(hxR, hy, HW, HH);
  ctx.fillStyle = RUST;
  ctx.fillRect(hxL, hy, HW, LIP);
  ctx.fillRect(hxR, hy, HW, LIP);
  ctx.fillStyle = IRON_LO;
  ctx.fillRect(hxL, hy + HH - LIP, HW, LIP);
  ctx.fillRect(hxR, hy + HH - LIP, HW, LIP);
  });
}

// === Animated biome textures ===
// A spec with `animPhases: N` bakes N phase frames per variant at startup:
// phase 0 keeps the plain `biome${type}_${v}` key (so anything holding that
// key still works), phases 1..N-1 get a `p${p}` suffix. drawCells already
// calls setTexture on every visible ground cell every frame, so animating is
// just building the key with the clock-derived phase — no per-frame canvas
// redraws, no texture uploads, no per-cell tweens. Each phase re-seeds the
// SAME rng, so static features stay put and only the phase-driven motion moves.
// Restore mark strength halfway toward the original for gameplay readability.
// Apply it once when baking a biome. Raw painters
// remain available to the audit's original/proposal comparison.
function drawBiomeTexture(ctx, size, type, variant = 0, phase = 0) {
  const spec = BIOME_TEX[type];
  ctx.save();
  spec.draw(ctx, size, seededRand((Number(type) + 1) * 1000 + variant + 1), phase);
  if (spec.patternOpacity != null && spec.patternOpacity !== 1) {
    // Scale the finished alpha, including overlaps, exactly as the proposal
    // composites its complete texture layer over the base colour.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.globalAlpha = spec.patternOpacity;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
  }
  ctx.restore();
}

// Render-only accents use the same anchor grid as ZoneDressing. They never
// alter terrain, occupancy, or the cave source. Cache anchor transforms, not
// a cell answer, so a player-edited terrain cell still keeps its own paint.
const ZONE_GROUND_ACCENTS = {
  mushroom_grove: { terrain: 28, color: 0x2f462e, fullCoverage: true },
  ancient_grove: { terrain: 28, color: 0x58623a },
  silent_circle: { terrain: 29, color: 0xc9c596 },
};
const _zoneGroundStates = new WeakMap();
function zoneGroundColor(entry, ix, iy, type, tx = entry && entry.tx, ty = entry && entry.ty) {
  const field = entry && entry.zone, V = typeof ZoneVariants !== 'undefined' && ZoneVariants;
  if (!field || !V || (type !== 28 && type !== 29)) return null;
  const N = entry.cellsPerEdge, coverage = field.coverage || field.idx;
  const ai = coverage && coverage[iy * N + ix] - 1;
  if (!(ai >= 0)) return null;
  let states = _zoneGroundStates.get(field);
  if (!states) {
    states = (field.anchors || []).map(a => {
      const variant = V.pick(a), accent = ZONE_GROUND_ACCENTS[variant.id];
      if (!accent) return null;
      const unit = WorldGen.CELL_M / (a.upm || N * WorldGen.CELL_M / 4096);
      const snap = p => {
        const origin = Math.floor(p / 4096) * 4096;
        return origin + (Math.floor((p - origin) / unit) + 0.5) * unit;
      };
      return { a, variant, accent, unit, rotation: V.rotation(a),
        x: snap(a.originGX == null ? a.gx : a.originGX),
        y: snap(a.originGY == null ? a.gy : a.originGY) };
    });
    _zoneGroundStates.set(field, states);
  }
  const s = states[ai];
  if (!s || type !== s.accent.terrain) return null;
  if (s.accent.fullCoverage) return s.accent.color;
  const dx = Math.round((tx * 4096 + (ix + 0.5) * 4096 / N - s.x) / s.unit);
  const dy = Math.round((ty * 4096 + (iy + 0.5) * 4096 / N - s.y) / s.unit);
  if (s.variant.id === 'silent_circle') return dx === 0 && dy === 0 ? s.accent.color : null;
  const [u, v] = V.inverseRotate(dx, dy, s.rotation), p = V.poiOrigin(s.variant);
  const material = V.sample(s.variant, u + p[0], v + p[1], s.a.key);
  return material === 'tree' || material === 'shrub' ? s.accent.color : null;
}

function makeBiomeTextures(scene, size) {
  for (const [type, spec] of Object.entries(BIOME_TEX)) {
    const phases = spec.animPhases || 1;
    for (let v = 0; v < spec.variants; v++) {
      for (let p = 0; p < phases; p++) {
        bakeCanvas(scene, `biome${type}_${v}` + (p ? `p${p}` : ''), size, size,
          (ctx) => drawBiomeTexture(ctx, size, type, v, p / phases));
      }
    }
  }
  for (let v = 0; v < TILLED_VARIANTS; v++) {
    bakeCanvas(scene, `tilled_${v}`, size, size, (ctx) => drawTilledTex(ctx, size, seededRand(7919 + v)));
  }
}

// === Concrete pads ===
// Every POI pad is the same: a single rounded slab sitting in the one cell
// directly under the chest. PAD_SHAPES still maps a shape key → cell occupancy
// + the chest's cell (the render layer anchors that cell's centre on the
// chest's ground point), but there is only one shape now: `round1`.
//
// Coordinate convention: [col, row] with col=x, row=y. (0,0) = top-left.
const PAD_CELL = 32;
// The pad is drawn a touch larger than its cell so it spills ~10% past the
// cell boundary into neighbouring cells, reading as a soft oversized base
// rather than a tile-aligned square.
const PAD_OVERSIZE = 1.10;
const PAD_SHAPES = {
  // Single rounded cell, chest centred on it. The only pad shape — used for
  // every pad-bearing POI regardless of type.
  round1: {
    cells: [[0, 0]],
    chest: [0, 0],
    round: true,
  },
};
// Pre-compute bounding box for each shape (cols × rows).
for (const s of Object.values(PAD_SHAPES)) {
  s.cols = Math.max(...s.cells.map(c => c[0])) + 1;
  s.rows = Math.max(...s.cells.map(c => c[1])) + 1;
}

// Trace a rounded-rectangle path (clamped so the radius never exceeds half the
// shorter side — at the max it degenerates to a circle/stadium).
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// The rounded single-cell pad. The canvas is PAD_OVERSIZE × PAD_CELL on a side
// so that, anchored at its centre on the chest's ground point, the slab spills
// evenly past the cell into its neighbours.
const POI_PAD_INKS = { top: '#dce4da', side: '#cbd2c9' };
function makeRoundPadTexture(scene, key, inks = POI_PAD_INKS) {
  const size = Math.round(PAD_CELL * PAD_OVERSIZE);
  const tex = scene.textures.createCanvas(key, size, size);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, size, size);
  const inset = 2;                          // keeps the slab off the texture edge
  // Pedestal: the slab top sits `depth` px above the silhouette's bottom; the
  // exposed band below it is drawn as a darker side face, so the pad reads as
  // a raised plinth the chest stands on rather than a flat painted disc.
  const depth = 4;
  const x = inset, y = inset, w = size - inset * 2, h = size - inset * 2 - depth;
  const radius = w * 0.32;                  // generously rounded corners
  // BORDERLESS: the pad is a backdrop, so it carries no perimeter outline —
  // just the two stone fills, so the eye goes to the POI standing on it. The
  // darker side face is the only thing separating plinth from top slab.
  // Warm ivory distinguishes this sacred/reward surface from rustic ground.
  // The same-hue side is about 8% darker, preserving the raised slab's depth
  // at the low alpha used by the renderer.
  // Side face first: the same rounded rect shifted down by `depth`.
  roundRectPath(ctx, x, y + depth, w, h, radius);
  ctx.fillStyle = inks.side;
  ctx.fill();
  // Top slab.
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = inks.top;
  ctx.fill();
  // Subtle top sheen + bottom shadow, clipped to the top slab, for the same
  // faint "beveled flagstone" feel.
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.restore();
  tex.refresh();
}

// Build a texture for one shape. Every shape is round (see PAD_SHAPES above),
// so this just dispatches to the dedicated rounded-pad drawer.
function makePadShapeTexture(scene, shapeKey) {
  const key = `pad_${shapeKey}`;
  if (scene.textures.exists(key)) return;
  const shape = PAD_SHAPES[shapeKey];
  if (!shape) return;
  makeRoundPadTexture(scene, key);
}

function makeAllPadShapes(scene) {
  for (const k of Object.keys(PAD_SHAPES)) makePadShapeTexture(scene, k);
}
